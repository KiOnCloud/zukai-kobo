/**
 * What the labs console reads about the runs of a project: the run folders under
 * `diagrams/`, the diagrams, files, revisions and stale state of one run, one diagram with
 * its labels and warnings, the description tables built in memory, and what changed since a
 * revision. Nothing here writes a file.
 *
 * Every name a caller passes (a run, a diagram, a revision, a file) is looked up in a listing
 * this module built itself from the real folders; none is joined into a path. A run is a
 * real folder (not a link) under `diagrams/` whose name starts with `yyyymmdd_`; a file is an
 * entry of the run's own listing whose real path lies inside the run folder.
 */
import { lstatSync, readFileSync, readdirSync, realpathSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, sep } from 'node:path';
import { validateIr } from './validate-ir.mjs';
import { bundle, emit, inspect, DOC_LANGS } from './pipeline.mjs';
import { drawioPages, withoutDataLinks } from './export-svg.mjs';
import { orderIrFiles, runSlugOf } from './run-order.mjs';
import { listRevisions } from './revisions.mjs';
import { staleRun, RECORD_SUFFIX } from './sources.mjs';
import { diffRun } from './ir-diff.mjs';
import { labelsOf } from './ir-labels.mjs';
import { projectRoot } from './glossary.mjs';

const RUN_RE = /^\d{8}_[^/\\]+$/;
const LANG_RE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
/** Files a run listing never holds: the revisions (shown by History) and temporary siblings. */
const HIDDEN_TOP = new Set(['history']);

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const isRealDir = (path) => { try { return lstatSync(path).isDirectory(); } catch { return false; } };
const isRealFile = (path) => { try { return lstatSync(path).isFile(); } catch { return false; } };
const readJson = (file) => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return undefined; } };

export const diagramsDir = (root) => join(projectRoot(root), 'diagrams');

/** The names of the run folders of a project, newest first. */
export function runNames(root) {
  const dir = diagramsDir(root);
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names.filter((n) => RUN_RE.test(n) && isRealDir(join(dir, n))).sort().reverse();
}

/** The absolute folder of a run named in the listing, or undefined. */
export function runPath(root, name) {
  return typeof name === 'string' && runNames(root).includes(name) ? join(diagramsDir(root), name) : undefined;
}

/** The IR file names of a run's `source/`, in run order. */
function irNames(runDir) {
  const source = join(runDir, 'source');
  if (!isRealDir(source)) return [];
  return orderIrFiles(readdirSync(source).filter((f) => f.endsWith('.ir.json') && isRealFile(join(source, f))), runSlugOf(source));
}

/** The diagrams of a run as the console lists them. */
function diagramsOf(runDir) {
  return irNames(runDir).map((name) => {
    const ir = readJson(join(runDir, 'source', name));
    return { id: name.slice(0, -'.ir.json'.length), kind: ir?.kind ?? null, title: typeof ir?.title === 'string' ? ir.title : null, audience: ir?.meta?.audience ?? 'technical', source: ir?.meta?.source ?? null, readable: ir !== undefined };
  });
}

/** Language variants of a run: translated IR folders, label maps and variant draw.io files. */
function variantsOf(runDir, slug) {
  const langs = new Map();
  const add = (lang, what) => langs.set(lang, [...new Set([...(langs.get(lang) ?? []), what])]);
  const source = join(runDir, 'source');
  if (isRealDir(source)) {
    for (const n of readdirSync(source)) {
      if (LANG_RE.test(n) && isRealDir(join(source, n))) add(n, 'translated-irs');
      const m = /^labels\.(.+)\.json$/.exec(n);
      if (m && LANG_RE.test(m[1])) add(m[1], 'label-map');
    }
  }
  for (const n of readdirSync(runDir)) {
    const m = new RegExp(`^${slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.([^.]+)\\.drawio$`).exec(n);
    if (m && LANG_RE.test(m[1])) add(m[1], 'drawio');
  }
  return [...langs].sort(([a], [b]) => (a < b ? -1 : 1)).map(([lang, kinds]) => ({ lang, kinds: kinds.sort() }));
}

/** The targets a run holds files of. */
function targetsOf(runDir, slug) {
  const has = (p) => existsSync(join(runDir, p));
  const targets = [];
  if (has(`${slug}.drawio`) || isRealDir(join(runDir, 'drawio'))) targets.push('drawio');
  if (has(`${slug}.md`) || isRealDir(join(runDir, 'mermaid'))) targets.push('mermaid');
  if (isRealDir(join(runDir, 'figjam'))) targets.push('figjam');
  if (isRealDir(join(runDir, 'svg'))) targets.push('svg');
  if (readdirSync(runDir).some((n) => n.startsWith(`${slug}.doc.`) && n.endsWith('.md'))) targets.push('doc');
  return targets;
}

const revisionCount = (runDir) => (isRealDir(join(runDir, 'history')) ? readdirSync(join(runDir, 'history')).filter((n) => /^r\d{3,}$/.test(n)).length : 0);

/** Every run of a project, newest first, as the runs list shows it. */
export function listRuns(root) {
  return runNames(root).map((name) => {
    const dir = join(diagramsDir(root), name);
    const slug = name.slice('yyyymmdd_'.length);
    const diagrams = diagramsOf(dir);
    const main = diagrams[0];
    return {
      run: name,
      date: `${name.slice(0, 4)}-${name.slice(4, 6)}-${name.slice(6, 8)}`,
      slug,
      title: main?.title ?? slug,
      origin: main?.source ?? null,
      diagrams: diagrams.map(({ id, kind, title, audience }) => ({ id, kind, title, audience })),
      targets: targetsOf(dir, slug),
      revisions: revisionCount(dir),
      variants: variantsOf(dir, slug),
      scouted: existsSync(join(dir, 'source', `${slug}${RECORD_SUFFIX}`)),
    };
  });
}

/**
 * The files of a run, as `name` (a path relative to the run folder, `/` between parts) with
 * size and date. A link is left out; so is `history/`, which History shows.
 */
export function listFiles(runDir) {
  const out = [];
  const real = realpathSync(runDir);
  const walk = (dir, prefix) => {
    for (const n of readdirSync(dir).sort()) {
      if (prefix === '' && HIDDEN_TOP.has(n)) continue;
      const path = join(dir, n);
      let st;
      try { st = lstatSync(path); } catch { continue; }
      if (st.isSymbolicLink()) continue;
      const name = prefix ? `${prefix}/${n}` : n;
      if (st.isDirectory()) walk(path, name);
      else if (st.isFile()) out.push({ name, size: st.size, modified: st.mtime.toISOString() });
    }
  };
  walk(real, '');
  return out;
}

/** The real path of a listed file of a run, or undefined when the name is not in the listing or leaves the run. */
export function filePath(root, run, name) {
  const dir = runPath(root, run);
  if (!dir || typeof name !== 'string') return undefined;
  if (!listFiles(dir).some((f) => f.name === name)) return undefined;
  const real = realpathSync(dir);
  let path;
  try { path = realpathSync(join(real, ...name.split('/'))); } catch { return undefined; }
  const rel = relative(real, path);
  return rel && !rel.startsWith('..') && !rel.split(sep).includes('..') ? path : undefined;
}

/** One run: diagrams, files, revisions with the undo and redo targets, and the stale result when it was scouted. */
export function runDetail(root, run) {
  const dir = runPath(root, run);
  if (!dir) return undefined;
  const slug = run.slice('yyyymmdd_'.length);
  const revisions = listRevisions(dir);
  let stale = null;
  if (existsSync(join(dir, 'source', `${slug}${RECORD_SUFFIX}`))) {
    const r = staleRun(dir, {});
    stale = r.ok ? { stale: r.stale, diagrams: r.diagrams ?? [] } : { error: r.errors?.[0]?.message ?? 'cannot read the record' };
  }
  const summary = listRuns(root).find((r) => r.run === run);
  return {
    ...summary,
    files: listFiles(dir),
    revisions: revisions.ok ? revisions.revisions.map(({ rev, createdAt, request, undoOf }) => ({ rev, createdAt, request, ...(undoOf ? { undoOf } : {}) })) : [],
    undo: revisions.ok ? revisions.undo : null,
    redo: revisions.ok ? revisions.redo : null,
    stale,
  };
}

/** The ids of the diagrams of a run. */
export const diagramIds = (root, run) => { const dir = runPath(root, run); return dir ? irNames(dir).map((n) => n.slice(0, -'.ir.json'.length)) : []; };

/** One diagram: the IR, its `rev`, its labels, its validation errors and the warnings of `inspect`. */
export function diagramDetail(root, run, id) {
  if (!diagramIds(root, run).includes(id)) return undefined;
  const bytes = readFileSync(join(runPath(root, run), 'source', `${id}.ir.json`));
  let ir;
  try { ir = JSON.parse(bytes.toString('utf8')); } catch { return { id, rev: sha256(bytes), ir: null, labels: [], errors: [{ path: '/', message: 'the IR file is not valid JSON' }], warnings: [] }; }
  const result = validateIr(ir);
  return { id, rev: sha256(bytes), ir, labels: labelsOf(ir), errors: result.errors, warnings: result.ok ? inspect(ir) : [] };
}

/** The IR entries of a folder (a run's `source/` or a revision's), in run order. */
function entriesOf(folder) {
  if (!isRealDir(folder)) return [];
  return orderIrFiles(readdirSync(folder).filter((f) => f.endsWith('.ir.json') && isRealFile(join(folder, f))), runSlugOf(folder))
    .map((f) => ({ id: f.slice(0, -'.ir.json'.length), ir: readJson(join(folder, f)) }))
    .filter((e) => e.ir !== undefined);
}

/** The description tables of a run as Markdown, built in memory. */
export async function runDoc(root, run, lang = 'en') {
  const dir = runPath(root, run);
  if (!dir || !DOC_LANGS.includes(lang)) return undefined;
  const entries = entriesOf(join(dir, 'source')).filter((e) => validateIr(e.ir).ok);
  if (entries.length === 0) return { ok: false, errors: [{ path: '/', message: 'the run has no valid IR' }] };
  const result = await bundle(entries, 'doc', { lang, allowSensitive: true });
  return result.ok ? { ok: true, lang, markdown: result.output } : { ok: false, errors: result.errors };
}

/** The revision names of a run. */
export const revisionNames = (root, run) => {
  const dir = runPath(root, run);
  if (!dir) return [];
  const r = listRevisions(dir);
  return r.ok ? r.revisions.map((x) => x.rev) : [];
};

/** What changed between a revision of a run and its current state. */
export function changesSince(root, run, rev) {
  if (!revisionNames(root, run).includes(rev)) return undefined;
  const dir = runPath(root, run);
  return diffRun(entriesOf(join(dir, 'history', rev, 'source')), entriesOf(join(dir, 'source')));
}

/**
 * What the viewer frame draws for a diagram, with nothing in it that would reach outside: the
 * draw.io page of the run when it has one (hand edits included), else its Mermaid text, else
 * the page emitted from the IR in memory. Data links are taken off as `export` takes them off,
 * and every picture address that is not `data:` is taken out of the cell styles and labels.
 */
export function cleanForViewer(xml) {
  return withoutDataLinks(xml)
    .replace(/(style="[^"]*?)(?:^|(?<=[";]))image=(?!data:)[^;"]*;?/g, '$1')
    .replace(/((?:&lt;|<)img\b[^>]*?\bsrc=(?:&quot;|"|'))(?!data:)[^"'&]*/gi, '$1');
}

export async function diagramPicture(root, run, id) {
  if (!diagramIds(root, run).includes(id)) return undefined;
  const dir = runPath(root, run);
  const file = (rel) => { const p = filePath(root, run, rel); return p ? readFileSync(p, 'utf8') : undefined; };
  const drawio = file(`drawio/${id}.drawio`);
  if (drawio !== undefined) {
    const pages = drawioPages(drawio);
    if (!pages.error) return { ok: true, kind: 'drawio', from: `drawio/${id}.drawio`, text: cleanForViewer(pages.pages[0].xml) };
  }
  const mmd = file(`mermaid/${id}.mmd`);
  if (mmd !== undefined) return { ok: true, kind: 'mermaid', from: `mermaid/${id}.mmd`, text: mmd };
  const ir = readJson(join(dir, 'source', `${id}.ir.json`));
  if (!ir || !validateIr(ir).ok) return { ok: false, errors: [{ path: '/', message: 'the IR does not pass validation' }] };
  const r = await emit(ir, 'drawio', { allowSensitive: true, diagramId: id });
  if (!r.ok) return { ok: false, errors: r.errors };
  return { ok: true, kind: 'drawio', from: `source/${id}.ir.json`, text: cleanForViewer(r.output) };
}
