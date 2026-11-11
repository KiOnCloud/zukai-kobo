import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { validateIr } from './validate-ir.mjs';

/**
 * Revisions of a run folder (`diagrams/<yyyymmdd>_<run-slug>/`): every IR of the run copied
 * together into `history/r<NNN>/`, so a main diagram, its `ref` parts and its business views
 * are always restored as one consistent set. Only the newest revisions are kept.
 *
 *   history/r007/revision.json       { rev, number, createdAt, request, files, extras, bundle? }
 *   history/r007/source/*.ir.json    every IR of the run at that point
 *   history/r007/extras/<path>       delivered files that carried hand edits, when given
 *
 * A revision is written into a temporary sibling and renamed into place, so an interrupted
 * run never leaves half a revision; temporary siblings are only created here, so stale ones
 * are dropped on the next snapshot.
 */

const REV = /^r(\d{3,})$/;

const fail = (code, message, hint) => ({ ok: false, code, errors: [{ path: '/', message, ...(hint ? { hint } : {}) }] });

function irFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.ir.json')).sort();
}

/** Revision folders, oldest first, as { rev, number, path }. */
function revisionDirs(runDir) {
  const history = join(runDir, 'history');
  if (!existsSync(history)) return [];
  return readdirSync(history)
    .map((name) => ({ name, m: REV.exec(name) }))
    .filter(({ name, m }) => m && statSync(join(history, name)).isDirectory())
    .map(({ name, m }) => ({ rev: name, number: Number(m[1]), path: join(history, name) }))
    .sort((a, b) => a.number - b.number);
}

function checkRun(runDir) {
  if (!existsSync(join(runDir, 'source')) || !statSync(join(runDir, 'source')).isDirectory()) {
    return fail(1, `no source/ folder in ${runDir}`, 'pass the run folder, diagrams/<yyyymmdd>_<run-slug>');
  }
  return null;
}

/**
 * Copy the run's current IRs (and any extra delivered files) into a new revision.
 * @param {string} runDir
 * @param {{ keep?: number, request?: string, extras?: string[], bundle?: object, now?: Date }} [options]
 */
export function snapshotRun(runDir, options = {}) {
  const run = resolve(runDir);
  const bad = checkRun(run);
  if (bad) return bad;
  const keep = options.keep ?? 5;
  if (!Number.isInteger(keep) || keep < 1) return fail(1, '--keep takes a whole number, 1 or more');
  const extras = [];
  for (const extra of options.extras ?? []) {
    const abs = isAbsolute(extra) ? extra : resolve(run, extra);
    const rel = relative(run, abs);
    if (rel.startsWith('..') || isAbsolute(rel)) return fail(1, `extra file ${extra} is outside the run folder`);
    if (rel.split(/[\\/]/)[0] === 'history') return fail(1, `extra file ${extra} is inside history/`);
    if (!existsSync(abs) || !statSync(abs).isFile()) return fail(1, `extra file ${extra} does not exist`);
    extras.push({ abs, rel: rel.split('\\').join('/') });
  }
  const history = join(run, 'history');
  mkdirSync(history, { recursive: true });
  for (const name of readdirSync(history)) if (/^\.r\d+\.tmp-/.test(name)) rmSync(join(history, name), { recursive: true, force: true });

  const existing = revisionDirs(run);
  const number = (existing.at(-1)?.number ?? 0) + 1;
  const rev = `r${String(number).padStart(3, '0')}`;
  const tmp = join(history, `.${rev}.tmp-${process.pid}`);
  const files = irFiles(join(run, 'source'));
  mkdirSync(join(tmp, 'source'), { recursive: true });
  for (const f of files) cpSync(join(run, 'source', f), join(tmp, 'source', f));
  for (const e of extras) {
    mkdirSync(dirname(join(tmp, 'extras', e.rel)), { recursive: true });
    cpSync(e.abs, join(tmp, 'extras', e.rel));
  }
  const record = {
    rev,
    number,
    createdAt: (options.now ?? new Date()).toISOString(),
    request: options.request ?? '',
    files,
    extras: extras.map((e) => e.rel),
    ...(options.bundle ? { bundle: options.bundle } : {}),
  };
  writeFileSync(join(tmp, 'revision.json'), JSON.stringify(record, null, 2) + '\n', 'utf8');
  renameSync(tmp, join(history, rev));

  const all = revisionDirs(run);
  const removed = all.slice(0, Math.max(0, all.length - keep)).map((r) => r.rev);
  for (const r of removed) rmSync(join(history, r), { recursive: true, force: true });
  return { ok: true, rev, path: join(history, rev), files, extras: record.extras, removed };
}

/** Revisions of a run, newest first. */
export function listRevisions(runDir) {
  const run = resolve(runDir);
  const bad = checkRun(run);
  if (bad) return bad;
  const revisions = revisionDirs(run).reverse().map((r) => {
    let record = {};
    try {
      record = JSON.parse(readFileSync(join(r.path, 'revision.json'), 'utf8'));
    } catch {
      // A revision without a readable record still lists, with what its folder shows.
    }
    return { rev: r.rev, createdAt: record.createdAt ?? null, request: record.request ?? '', files: irFiles(join(r.path, 'source')), extras: record.extras ?? [], ...(record.bundle ? { bundle: record.bundle } : {}) };
  });
  return { ok: true, revisions };
}

/**
 * Put a revision's IRs back into `source/`. The current state is snapshotted first, so a
 * restore can itself be undone. IRs the revision does not have are removed with their
 * per-diagram outputs; the caller then emits and bundles again.
 * @param {string} runDir
 * @param {string} rev e.g. `r003`
 * @param {{ keep?: number, request?: string, now?: Date }} [options]
 */
export function restoreRun(runDir, rev, options = {}) {
  const run = resolve(runDir);
  const bad = checkRun(run);
  if (bad) return bad;
  const all = revisionDirs(run);
  const target = all.find((r) => r.rev === rev);
  if (!target) return fail(1, `no revision ${rev} in ${run}`, all.length ? `existing revisions: ${all.map((r) => r.rev).join(', ')}` : 'this run has no revisions yet');

  // Read the revision before snapshotting: the snapshot's rotation may delete its folder.
  const files = irFiles(join(target.path, 'source'));
  const contents = new Map(files.map((f) => [f, readFileSync(join(target.path, 'source', f), 'utf8')]));
  const errors = [];
  for (const [f, text] of contents) {
    let ir;
    try {
      ir = JSON.parse(text);
    } catch (e) {
      errors.push({ path: `${rev}/source/${f}`, message: `not valid JSON: ${e.message}` });
      continue;
    }
    const v = validateIr(ir);
    if (!v.ok) errors.push(...v.errors.map((e) => ({ ...e, path: `${rev}/source/${f}${e.path}` })));
  }
  if (errors.length > 0) return { ok: false, code: 2, errors };
  let bundle;
  try {
    bundle = JSON.parse(readFileSync(join(target.path, 'revision.json'), 'utf8')).bundle;
  } catch {
    bundle = undefined;
  }

  const snap = snapshotRun(run, { keep: options.keep, request: options.request ?? `undo to ${rev}`, bundle, now: options.now });
  if (!snap.ok) return snap;

  const source = join(run, 'source');
  const removedDiagrams = [];
  for (const f of irFiles(source)) {
    if (contents.has(f)) continue;
    rmSync(join(source, f));
    const slug = basename(f, '.ir.json');
    removedDiagrams.push(slug);
    for (const out of [join(run, 'drawio', `${slug}.drawio`), join(run, 'mermaid', `${slug}.mmd`)]) rmSync(out, { force: true });
  }
  for (const [f, text] of contents) writeFileSync(join(source, f), text, 'utf8');
  return { ok: true, restored: rev, snapshot: snap.rev, removedRevisions: snap.removed, files, removedDiagrams, ...(bundle ? { bundle } : {}) };
}
