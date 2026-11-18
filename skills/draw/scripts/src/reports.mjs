/**
 * Reports: one folder per report under the project's reports folder (`reports/` unless
 * `.zukai/config.json` names another, `project-config.mjs`).
 *
 *   <reportsDir>/<yyyymmdd>_<slug>/
 *     report.md          the source: written by the agent, the console's quick edit and a restore
 *     report.html        the rendered report (the default deliverable), self-contained
 *     report.json        { report: 1, title, kind, template: { id, scope, version }, lang, runs, sources, created, updated }
 *     assets/            pictures a report may inline (png, jpg, svg, webp, gif), each at most 2 MB
 *     <lang>/report.md   a translation, rendered to <lang>/report.html
 *     drafts/            polish drafts: polish-<n>.md beside polish-<n>.json { baseRev, draftRev, findings, created }
 *     history/rNNN/      revisions: report.md and the translations, with revision.json
 *
 * A folder is a report only when it holds a `report.json` that matches `report-v1`: that is
 * what the listings and the run index count. Every name a caller passes (a report, a
 * language, a revision, a draft) is looked up in a listing this module built from the real
 * folders, never joined into a path.
 *
 * Revisions have two writers (the CLI the agent calls and the console's server), so they are
 * numbered and written under `<report>/.revisions.lock`; a temporary folder of another writer
 * is removed only when it is older than ten minutes. A report keeps 20 revisions, and the
 * newest one not made by a quick edit (the snapshot before a polish, a translation or a
 * restore) is never rotated out by a storm of quick edits.
 *
 * Every write this module makes is preceded by a secret scan of each line of the text: a
 * credential by its form refuses the write. `report check` and `report render` report the
 * same findings for what the agent wrote with its own tools.
 */
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020.js';
import schema from './schema/report-v1.schema.json' with { type: 'json' };
import { scanSecrets, DEFINITE_KINDS } from './scan-secrets.mjs';
import { takeLock, releaseLock, checkProse } from './glossary.mjs';
import { REV, revisionDirs, readRecord, filesUnder } from './revisions.mjs';
import { runFoldersIn, runsPath, reportsPath } from './project-config.mjs';
import { renderMarkdown, splitSections, escapeHtml, assetMime, MAX_ASSET_BYTES, SECTION_ID_RE, MARKER_RE } from './report-markdown.mjs';

export const REPORT_FILE = 'report.md';
export const REPORT_HTML = 'report.html';
export const REPORT_META = 'report.json';
export const REPORT_KEEP = 20;
const LOCK_NAME = '.revisions.lock';
const TEMP_AGE_MS = 10 * 60 * 1000;
const NAME_RE = /^\d{8}_[^/\\]+$/;
export const LANG_RE = /^(?!(?:con|prn|aux|nul)(?:-|$))[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/i;
const DRAFT_RE = /^polish-(\d{1,6})$/;
/** The causes a revision records; only `edit` (the console's quick edit) may rotate freely. */
export const CAUSES = ['snapshot', 'edit', 'polish', 'translate', 'restore'];

export const textRev = (text) => createHash('sha256').update(typeof text === 'string' ? Buffer.from(text, 'utf8') : text).digest('hex');
const fail = (code, message, hint, extra = {}) => ({ ok: false, code, errors: [{ path: '/', message, ...(hint ? { hint } : {}) }], ...extra });
const isRealDir = (path) => { try { return lstatSync(path).isDirectory(); } catch { return false; } };
const isRealFile = (path) => { try { return lstatSync(path).isFile(); } catch { return false; } };
const readText = (path) => { try { return readFileSync(path, 'utf8'); } catch { return undefined; } };

/** Write a file through a temporary sibling and a rename. */
function writeAtomic(path, text) {
  const tmp = `${path}.${process.pid}-${randomBytes(4).toString('hex')}.tmp`;
  try {
    writeFileSync(tmp, text);
    renameSync(tmp, path);
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* not written */ }
    throw e;
  }
}

// ---------------------------------------------------------------- record

let compiled;
function validator() {
  if (!compiled) compiled = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  return compiled;
}

/** Every problem of a report record against `report-v1`. */
export function reportMetaErrors(meta) {
  const validate = validator();
  if (validate(meta)) return [];
  return (validate.errors ?? []).map((e) => ({ path: e.instancePath || '/', message: e.message ?? 'invalid' }));
}

/**
 * The record of a report folder: `{ ok: true, meta }` or `{ ok: false, code, errors }`.
 * @param {string} dir
 */
export function readReport(dir) {
  const file = join(dir, REPORT_META);
  if (!isRealFile(file)) return fail('not-a-report', `no ${REPORT_META} in ${dir}`, 'pass a report folder, <reportsDir>/<yyyymmdd>_<slug>, as report new made it');
  let meta;
  try {
    meta = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fail('invalid', `${file} is not valid JSON`);
  }
  const errors = reportMetaErrors(meta);
  if (errors.length > 0) return { ok: false, code: 'invalid', errors: errors.map((e) => ({ ...e, file })) };
  return { ok: true, meta };
}

/** Write the record of a report, validated, with `updated` set to now. */
export function writeReportMeta(dir, meta, { now = new Date() } = {}) {
  const next = { ...meta, updated: now.toISOString() };
  const errors = reportMetaErrors(next);
  if (errors.length > 0) return { ok: false, code: 'invalid', errors };
  writeAtomic(join(dir, REPORT_META), `${JSON.stringify(next, null, 2)}\n`);
  return { ok: true, meta: next };
}

/** Set `updated` of a report's record after its text changed; a record that cannot be written stays as it is. */
function touchUpdated(dir, now = new Date()) {
  const read = readReport(dir);
  if (read.ok) writeReportMeta(dir, read.meta, { now });
}

// ---------------------------------------------------------------- listings

/** The report folders under a reports folder: real folders named `yyyymmdd_<slug>` with a valid record, newest first. */
export function reportFoldersIn(dir) {
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names.filter((n) => NAME_RE.test(n) && isRealDir(join(dir, n)) && readReport(join(dir, n)).ok).sort().reverse();
}

/** The names of the reports of a project, newest first; a bad `reportsDir` throws its `ConfigError`. */
export function reportNames(root) {
  return reportFoldersIn(reportsPath(root));
}

/** The folder of a report named in the listing, or undefined. */
export function reportPath(root, name) {
  return typeof name === 'string' && reportNames(root).includes(name) ? join(reportsPath(root), name) : undefined;
}

/** The languages a report is translated into: real `<lang>/report.md` files. */
export function translationLangs(dir) {
  let names;
  try { names = readdirSync(dir); } catch { return []; }
  return names.filter((n) => LANG_RE.test(n) && isRealDir(join(dir, n)) && isRealFile(join(dir, n, REPORT_FILE))).sort();
}

/** The source file of a report, or of one of its translations named in the listing; undefined for an unknown language. */
export function sourceFile(dir, lang) {
  if (lang === undefined || lang === null || lang === '') return join(dir, REPORT_FILE);
  return translationLangs(dir).includes(lang) ? join(dir, lang, REPORT_FILE) : undefined;
}

/** The pictures of a report's `assets/`, by name: real files of a picture type, at most 2 MB each. */
export function assetsOf(dir) {
  const out = new Map();
  const folder = join(dir, 'assets');
  if (!isRealDir(folder)) return out;
  for (const name of readdirSync(folder).sort()) {
    const mime = assetMime(name);
    const path = join(folder, name);
    if (!mime || !isRealFile(path) || statSync(path).size > MAX_ASSET_BYTES) continue;
    out.set(name, { bytes: readFileSync(path), mime });
  }
  return out;
}

// ---------------------------------------------------------------- secret scan

/**
 * What the secret scan finds in a text, one scan per line, so a harmless "token:" on one
 * line never hides a credential on another: `[{ file, line, kind, level, message }]`, where a
 * credential by its form is `blocking` and a guess is a `warning`.
 */
export function secretFindings(text, file) {
  const findings = [];
  String(text).replace(/\r\n?/g, '\n').split('\n').forEach((line, i) => {
    if (line.trim() === '') return;
    for (const w of scanSecrets(line).warnings) {
      findings.push({ kind: 'secret', secret: w.kind, level: DEFINITE_KINDS.has(w.kind) ? 'blocking' : 'warning', file, line: i + 1, message: w.message.replace(/the diagram/g, 'the report').replace(/a diagram names/g, 'a report names') });
    }
  });
  return findings;
}

/** A write refused because of a credential, or undefined. */
function refuseSecrets(text, file) {
  const blocking = secretFindings(text, file).filter((f) => f.level === 'blocking');
  if (blocking.length === 0) return undefined;
  return { ok: false, code: 'secret', errors: blocking.map((f) => ({ path: `${f.file}:${f.line}`, message: f.message, hint: 'remove the credential from the text; a report is shared, so it never carries one' })) };
}

// ---------------------------------------------------------------- new

/** The slug of a report folder: the title in ASCII letters and digits joined by `-`, else the kind. */
function slugOf(title, kind) {
  const s = String(title).normalize('NFKD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/, '');
  return s || kind;
}

/** The local date of a folder name, `yyyymmdd`, as the run folders are named. */
const day = (now) => `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;

/**
 * The Markdown a new report starts from: its title, then one `## <Section>` per section of
 * the template followed by the section's id-only marker. Guides stay in the template.
 */
export function skeletonOf(title, sections) {
  const parts = [`# ${title}`, ''];
  for (const s of sections) parts.push(`## ${s.name}`, `<!-- zukai:section id="${s.id}" -->`, '', '');
  return `${parts.join('\n').replace(/\n+$/, '')}\n`;
}

/**
 * Make a report folder: `report.md` from the template's sections, `report.json`, `assets/`.
 * @param {{ root?: string, template: { id: string, scope: string, version: string, kind?: string, sections: Array<{ id: string, name: string }> }, kind?: string, title: string, lang: string, runs?: string[], sources?: string[], now?: Date }} options
 * @returns {{ ok: true, name: string, dir: string, meta: object } | { ok: false, code: string, errors: object[] }}
 */
export function newReport({ root, template, kind, title, lang, runs = [], sources = [], now = new Date() }) {
  const reports = reportsPath(root);
  const knownRuns = (() => { try { return runFoldersIn(runsPath(root)); } catch { return []; } })();
  const unknown = runs.filter((r) => !knownRuns.includes(r));
  if (unknown.length > 0) return fail('bad-request', `no run ${unknown.join(', ')} in the runs folder`, knownRuns.length ? `runs of the project: ${knownRuns.slice(0, 10).join(', ')}` : 'the project has no runs yet');
  const meta = {
    report: 1,
    title: String(title ?? '').trim(),
    kind: kind ?? template.kind ?? template.id,
    template: { id: template.id, scope: template.scope, version: String(template.version) },
    lang,
    runs: [...new Set(runs)],
    sources,
    created: now.toISOString(),
    updated: now.toISOString(),
  };
  const errors = reportMetaErrors(meta);
  if (errors.length > 0) return { ok: false, code: 'invalid', errors };
  const text = skeletonOf(meta.title, template.sections);
  const refused = refuseSecrets(text, REPORT_FILE);
  if (refused) return refused;
  mkdirSync(reports, { recursive: true });
  const base = `${day(now)}_${slugOf(meta.title, meta.kind)}`;
  let name = base;
  // The folder is made exclusively: a second `report new` at the same moment takes the next name.
  let dir;
  for (let n = 2; ; n++) {
    try { mkdirSync(join(reports, name)); dir = join(reports, name); break; } catch (e) { if (e.code !== 'EEXIST') throw e; }
    name = `${base}-${n}`;
  }
  mkdirSync(join(dir, 'assets'));
  writeAtomic(join(dir, REPORT_FILE), text);
  writeAtomic(join(dir, REPORT_META), `${JSON.stringify(meta, null, 2)}\n`);
  return { ok: true, name, dir, meta };
}

// ---------------------------------------------------------------- revisions

/** The source files a revision of a report holds: `report.md` and each `<lang>/report.md`. */
const sourceFiles = (dir) => [REPORT_FILE, ...translationLangs(dir).map((l) => `${l}/${REPORT_FILE}`)];

/** Run `fn` under the report's revision lock; `{ ok: false, code: 'locked' }` when it stays taken. */
function underLock(dir, fn) {
  const held = takeLock(dir, LOCK_NAME);
  if (!held) return fail('locked', `the revisions of ${dir} are locked by another writer`, 'try again in a few seconds');
  try {
    return fn();
  } finally {
    releaseLock(held);
  }
}

/** Snapshot under a lock the caller holds. */
function snapshotLocked(dir, { request = '', cause = 'snapshot', keep = REPORT_KEEP, restoreOf, now = new Date() }) {
  if (!CAUSES.includes(cause)) return fail('bad-request', `unknown cause "${cause}"`);
  if (!Number.isInteger(keep) || keep < 1) return fail('bad-request', '--keep takes a whole number, 1 or more');
  if (!isRealFile(join(dir, REPORT_FILE))) return fail('bad-request', `no ${REPORT_FILE} in ${dir}; nothing to snapshot`);
  const history = join(dir, 'history');
  mkdirSync(history, { recursive: true });
  // A temporary folder may belong to another writer still at work: only an old one is left over.
  for (const name of readdirSync(history)) {
    if (!/^\.r\d+\.tmp-/.test(name)) continue;
    try { if (Date.now() - statSync(join(history, name)).mtimeMs > TEMP_AGE_MS) rmSync(join(history, name), { recursive: true, force: true }); } catch { /* gone */ }
  }
  const number = (revisionDirs(dir).at(-1)?.number ?? 0) + 1;
  const rev = `r${String(number).padStart(3, '0')}`;
  const tmp = join(history, `.${rev}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`);
  const files = sourceFiles(dir);
  for (const f of files) {
    mkdirSync(join(tmp, ...f.split('/').slice(0, -1)), { recursive: true });
    cpSync(join(dir, ...f.split('/')), join(tmp, ...f.split('/')));
  }
  const record = { rev, number, createdAt: now.toISOString(), request, cause, files, ...(restoreOf ? { restoreOf } : {}) };
  writeFileSync(join(tmp, 'revision.json'), `${JSON.stringify(record, null, 2)}\n`);
  renameSync(tmp, join(history, rev));
  // Rotation: the oldest go first, but never the newest revision a quick edit did not make.
  const all = revisionDirs(dir);
  const guarded = [...all].reverse().find((r) => readRecord(r.path).cause !== 'edit')?.rev;
  const candidates = all.filter((r) => r.rev !== guarded && r.rev !== rev);
  const excess = Math.max(0, all.length - keep);
  const removed = candidates.slice(0, excess).map((r) => r.rev);
  for (const r of removed) rmSync(join(history, r), { recursive: true, force: true });
  return { ok: true, rev, files, removed };
}

/**
 * Copy `report.md` and every translation into a new revision.
 * @param {string} dir
 * @param {{ request?: string, cause?: string, keep?: number, now?: Date }} [options]
 */
export function snapshotReport(dir, options = {}) {
  const read = readReport(dir);
  if (!read.ok) return read;
  return underLock(dir, () => snapshotLocked(dir, options));
}

/** The revisions of a report, newest first: `[{ rev, createdAt, request, cause, files, restoreOf? }]`. */
export function reportRevisions(dir) {
  return revisionDirs(dir).reverse().map((r) => {
    const record = readRecord(r.path);
    return { rev: r.rev, createdAt: record.createdAt ?? null, request: record.request ?? '', cause: CAUSES.includes(record.cause) ? record.cause : 'snapshot', files: filesUnder(r.path).filter((f) => f === REPORT_FILE || f.endsWith(`/${REPORT_FILE}`)), ...(record.restoreOf ? { restoreOf: record.restoreOf } : {}) };
  });
}

/**
 * Put a revision back: the current state is snapshotted first (cause `restore`), then
 * `report.md` and the translations of the revision are written back byte for byte, and a
 * translation the revision does not hold is removed with its HTML. The caller renders again.
 */
export function restoreReport(dir, rev, { request, now = new Date() } = {}) {
  const read = readReport(dir);
  if (!read.ok) return read;
  return underLock(dir, () => {
    const all = revisionDirs(dir);
    const target = all.find((r) => r.rev === rev);
    if (!target) return fail('bad-request', `no revision ${rev} in ${dir}`, all.length ? `revisions: ${all.map((r) => r.rev).join(', ')}` : 'this report has no revisions yet');
    const files = filesUnder(target.path).filter((f) => (f === REPORT_FILE || (f.endsWith(`/${REPORT_FILE}`) && LANG_RE.test(f.split('/')[0]) && f.split('/').length === 2)) && isRealFile(join(target.path, ...f.split('/'))));
    if (!files.includes(REPORT_FILE)) return fail('bad-request', `revision ${rev} holds no ${REPORT_FILE}`);
    const contents = new Map(files.map((f) => [f, readFileSync(join(target.path, ...f.split('/')))]));
    for (const [f, bytes] of contents) {
      const refused = refuseSecrets(bytes.toString('utf8'), f);
      if (refused) return refused;
    }
    const snap = snapshotLocked(dir, { request: request ?? `restore ${rev}`, cause: 'restore', restoreOf: rev, now });
    if (!snap.ok) return snap;
    const removedLangs = [];
    for (const lang of translationLangs(dir)) {
      if (contents.has(`${lang}/${REPORT_FILE}`)) continue;
      rmSync(join(dir, lang, REPORT_FILE), { force: true });
      rmSync(join(dir, lang, REPORT_HTML), { force: true });
      removedLangs.push(lang);
    }
    for (const [f, bytes] of contents) {
      mkdirSync(join(dir, ...f.split('/').slice(0, -1)), { recursive: true });
      writeAtomic(join(dir, ...f.split('/')), bytes);
    }
    touchUpdated(dir, now);
    return { ok: true, restored: rev, snapshot: snap.rev, removed: snap.removed, files, removedLangs };
  });
}

// ---------------------------------------------------------------- quick edit

/**
 * Replace the text of `report.md` (or a translation in the listing) when it still has `rev`:
 * snapshot (cause `edit`), secret scan, write. A stale `rev` is a `conflict`.
 */
export function writeSource(dir, { lang, text, rev, now = new Date() }) {
  const read = readReport(dir);
  if (!read.ok) return read;
  const file = sourceFile(dir, lang);
  if (!file) return fail('bad-request', `no translation ${lang} in ${dir}`);
  if (typeof text !== 'string') return fail('bad-request', 'the text is missing');
  const refused = refuseSecrets(text, lang ? `${lang}/${REPORT_FILE}` : REPORT_FILE);
  if (refused) return refused;
  return underLock(dir, () => {
    if (!isRealFile(file)) return fail('bad-request', `${file} is no plain file`);
    const current = readFileSync(file);
    if (textRev(current) !== rev) return fail('conflict', 'the report changed on disk since it was read', 'read it again and repeat the change', { rev: textRev(current) });
    const snap = snapshotLocked(dir, { request: `edit ${lang ? `${lang}/` : ''}${REPORT_FILE}`, cause: 'edit', now });
    if (!snap.ok) return snap;
    writeAtomic(file, text);
    touchUpdated(dir, now);
    return { ok: true, rev: textRev(text), snapshot: snap.rev };
  });
}

// ---------------------------------------------------------------- drafts

const draftsDir = (dir) => join(dir, 'drafts');
const closedFile = (dir) => join(draftsDir(dir), 'closed.json');

/** The number of the newest polish applied or discarded, or 0. */
function closedNumber(dir) {
  try {
    const n = JSON.parse(readFileSync(closedFile(dir), 'utf8')).closed;
    return Number.isInteger(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

/** A draft's record, or undefined when it does not parse. */
function draftRecord(dir, name) {
  try {
    const record = JSON.parse(readFileSync(join(draftsDir(dir), `${name}.json`), 'utf8'));
    return record && typeof record === 'object' && typeof record.baseRev === 'string' && typeof record.draftRev === 'string' ? record : undefined;
  } catch {
    return undefined;
  }
}

/** The pending polish drafts of a report, newest first: names `polish-<n>` with both files. */
export function draftNames(dir) {
  let names;
  try { names = readdirSync(draftsDir(dir)); } catch { return []; }
  return names
    .map((n) => /^(polish-\d{1,6})\.md$/.exec(n)?.[1])
    .filter((n) => n && isRealFile(join(draftsDir(dir), `${n}.md`)) && draftRecord(dir, n))
    .sort((a, b) => Number(DRAFT_RE.exec(b)[1]) - Number(DRAFT_RE.exec(a)[1]));
}

/** The drafts of a report with their records, newest first. */
export function reportDrafts(dir) {
  return draftNames(dir).map((name) => {
    const r = draftRecord(dir, name);
    const source = join(dir, REPORT_FILE);
    return { name, baseRev: r.baseRev, draftRev: r.draftRev, created: r.created ?? null, findings: Array.isArray(r.findings) ? r.findings : [], stale: !isRealFile(source) || r.baseRev !== textRev(readFileSync(source)) };
  });
}

/** Mark a polish applied or discarded and remove its files. */
function closeDraft(dir, name) {
  const n = Number(DRAFT_RE.exec(name)[1]);
  mkdirSync(draftsDir(dir), { recursive: true });
  writeAtomic(closedFile(dir), `${JSON.stringify({ closed: Math.max(n, closedNumber(dir)) })}\n`);
  rmSync(join(draftsDir(dir), `${name}.md`), { force: true });
  rmSync(join(draftsDir(dir), `${name}.json`), { force: true });
}

/**
 * Save a polish draft of `report.md` read at `baseRev`: `drafts/polish-<n>.md` and its record
 * with `draftRev`. Drafts older than the newest applied or discarded polish are removed first.
 */
export function newDraft(dir, { text, baseRev, findings = [], now = new Date() }) {
  const read = readReport(dir);
  if (!read.ok) return read;
  if (typeof text !== 'string' || text.trim() === '') return fail('bad-request', 'the draft is empty');
  if (typeof baseRev !== 'string') return fail('bad-request', 'a draft needs the rev of the report.md it was made from (--base-rev)', 'report check prints it as rev');
  const refused = refuseSecrets(text, 'draft');
  if (refused) return refused;
  return underLock(dir, () => {
    const current = textRev(readFileSync(join(dir, REPORT_FILE)));
    if (current !== baseRev) return fail('conflict', 'report.md changed since the polish read it', 'run report check again and polish the text it reads now', { rev: current });
    const closed = closedNumber(dir);
    mkdirSync(draftsDir(dir), { recursive: true });
    for (const name of readdirSync(draftsDir(dir))) {
      const m = /^polish-(\d{1,6})\.(md|json)$/.exec(name);
      if (m && Number(m[1]) <= closed) rmSync(join(draftsDir(dir), name), { force: true });
    }
    const numbers = draftNames(dir).map((n) => Number(DRAFT_RE.exec(n)[1]));
    const name = `polish-${Math.max(closed, ...numbers, 0) + 1}`;
    const draftRev = textRev(text);
    writeAtomic(join(draftsDir(dir), `${name}.md`), text);
    writeAtomic(join(draftsDir(dir), `${name}.json`), `${JSON.stringify({ baseRev, draftRev, findings: Array.isArray(findings) ? findings : [], created: now.toISOString() }, null, 2)}\n`);
    return { ok: true, draft: name, baseRev, draftRev };
  });
}

/**
 * Apply a polish draft: `report.md` must still have the draft's `baseRev` and the draft its
 * `draftRev` (and the ones given, when given), else nothing changes (`conflict`). Then
 * snapshot (cause `polish`), replace, and close the draft. The caller renders again.
 */
export function applyDraft(dir, name, { baseRev, draftRev, now = new Date() } = {}) {
  const read = readReport(dir);
  if (!read.ok) return read;
  if (!draftNames(dir).includes(name)) return fail('bad-request', `no draft ${name} in ${dir}`, draftNames(dir).length ? `drafts: ${draftNames(dir).join(', ')}` : 'the report has no pending draft');
  return underLock(dir, () => {
    const record = draftRecord(dir, name);
    const text = readFileSync(join(draftsDir(dir), `${name}.md`), 'utf8');
    const current = textRev(readFileSync(join(dir, REPORT_FILE)));
    if (current !== record.baseRev || (baseRev !== undefined && baseRev !== record.baseRev)) return fail('conflict', 'report.md changed since the draft was made', 'discard the draft and polish again', { rev: current });
    if (textRev(text) !== record.draftRev || (draftRev !== undefined && draftRev !== record.draftRev)) return fail('conflict', `the draft ${name} changed since it was shown`, 'look at its diff again before applying it');
    const refused = refuseSecrets(text, `drafts/${name}.md`);
    if (refused) return refused;
    const snap = snapshotLocked(dir, { request: `apply ${name}`, cause: 'polish', now });
    if (!snap.ok) return snap;
    writeAtomic(join(dir, REPORT_FILE), text);
    closeDraft(dir, name);
    touchUpdated(dir, now);
    return { ok: true, applied: name, snapshot: snap.rev, rev: textRev(text) };
  });
}

/** Discard a polish draft named in the listing. */
export function discardDraft(dir, name) {
  if (!draftNames(dir).includes(name)) return fail('bad-request', `no draft ${name} in ${dir}`);
  return underLock(dir, () => {
    closeDraft(dir, name);
    return { ok: true, discarded: name };
  });
}

// ---------------------------------------------------------------- diff

/**
 * A line diff of two texts: `[{ op: ' ' | '+' | '-', text }]`. The common head and tail are
 * matched first; the middle by the longest common subsequence, or, when it is too large to
 * compare line by line, as removed then added.
 */
export function lineDiff(a, b) {
  const x = String(a).replace(/\r\n?/g, '\n').split('\n');
  const y = String(b).replace(/\r\n?/g, '\n').split('\n');
  let head = 0;
  while (head < x.length && head < y.length && x[head] === y[head]) head++;
  let tail = 0;
  while (tail < x.length - head && tail < y.length - head && x[x.length - 1 - tail] === y[y.length - 1 - tail]) tail++;
  const xm = x.slice(head, x.length - tail);
  const ym = y.slice(head, y.length - tail);
  const middle = [];
  if (xm.length * ym.length > 16_000_000) {
    middle.push(...xm.map((text) => ({ op: '-', text })), ...ym.map((text) => ({ op: '+', text })));
  } else {
    const n = xm.length;
    const m = ym.length;
    const w = m + 1;
    const lcs = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) lcs[i * w + j] = xm[i] === ym[j] ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
    }
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && xm[i] === ym[j]) { middle.push({ op: ' ', text: xm[i] }); i++; j++; }
      else if (i < n && (j === m || lcs[(i + 1) * w + j] >= lcs[i * w + j + 1])) { middle.push({ op: '-', text: xm[i] }); i++; }
      else { middle.push({ op: '+', text: ym[j] }); j++; }
    }
  }
  return [...x.slice(0, head).map((text) => ({ op: ' ', text })), ...middle, ...x.slice(x.length - tail).map((text) => ({ op: ' ', text }))];
}

/**
 * The text a diff side names: `current`, a revision of the listing or a draft of the listing.
 * A language names the translation of `current` and of a revision; a draft is of `report.md`.
 */
function sideText(dir, side, lang) {
  const rel = lang ? `${lang}/${REPORT_FILE}` : REPORT_FILE;
  if (side === 'current') {
    const file = sourceFile(dir, lang);
    return file ? readText(file) : undefined;
  }
  if (REV.test(side)) {
    const r = revisionDirs(dir).find((x) => x.rev === side);
    return r ? readText(join(r.path, ...rel.split('/'))) ?? '' : undefined;
  }
  if (DRAFT_RE.test(side) && !lang) return draftNames(dir).includes(side) ? readText(join(draftsDir(dir), `${side}.md`)) : undefined;
  return undefined;
}

/** The line diff between two sides of a report: `{ ok, from, to, lines, added, removed }`. */
export function diffReport(dir, from, to, { lang } = {}) {
  if (lang && !LANG_RE.test(lang)) return fail('bad-request', `unknown language "${lang}"`);
  const a = sideText(dir, from, lang);
  const b = sideText(dir, to, lang);
  for (const [side, text] of [[from, a], [to, b]]) {
    if (text === undefined) return fail('bad-request', `no "${side}" in ${dir}`, 'a side is current, a revision (report revisions lists them) or a draft (polish-<n>)');
  }
  const lines = lineDiff(a, b);
  return { ok: true, from, to, ...(lang ? { lang } : {}), lines, added: lines.filter((l) => l.op === '+').length, removed: lines.filter((l) => l.op === '-').length };
}

// ---------------------------------------------------------------- prose

/**
 * The checkable blocks of a report's Markdown: paragraphs (one block per line of text),
 * list items, table cells and headings, each with its section id and 1-based line; fenced
 * code, inline code and link targets are left out. Used by the glossary check of prose.
 * @returns {Array<{ section: string | null, line: number, text: string }>}
 */
export function blocksOf(markdown) {
  const lines = String(markdown).replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let fence = null;
  let section = null;
  lines.forEach((raw, i) => {
    const open = /^\s{0,3}(`{3,}|~{3,})/.exec(raw);
    if (fence) {
      const close = /^\s{0,3}(`{3,}|~{3,})\s*$/.exec(raw);
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length) fence = null;
      return;
    }
    if (open) { fence = open[1]; return; }
    const marker = MARKER_RE.exec(raw);
    if (marker) { section = SECTION_ID_RE.test(marker[1]) ? marker[1] : null; return; }
    if (/^\s*<!--.*-->\s*$/.test(raw)) return;
    let line = raw.trim();
    if (line === '' || /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?$/.test(line)) return;
    line = line.replace(/^#{1,6}\s+/, '').replace(/^>\s?/, '').replace(/^(?:[-*+]|\d{1,9}[.)])\s+(\[[ xX]\]\s+)?/, '');
    const clean = (t) => t
      .replace(/`[^`]*`/g, ' ')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/<https?:[^>]*>/g, ' ')
      .replace(/[*_~]{1,3}/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    const cells = line.includes('|') && /^\|.*\|$/.test(line) ? line.slice(1, -1).split('|') : [line];
    for (const cell of cells) {
      const text = clean(cell);
      if (text !== '') blocks.push({ section, line: i + 1, text });
    }
  });
  return blocks;
}

/**
 * The prose of a report: the blocks of `report.md` (in the report's language) and of each
 * translation (in its own), with `{ report, file, section, line, lang, text }`, and the
 * section ids of each file in order.
 */
export function proseOf(dir) {
  const read = readReport(dir);
  if (!read.ok) return read;
  const report = basename(dir);
  const files = [{ file: REPORT_FILE, lang: read.meta.lang }, ...translationLangs(dir).map((lang) => ({ file: `${lang}/${REPORT_FILE}`, lang }))];
  const blocks = [];
  const sections = {};
  if (!isRealFile(join(dir, REPORT_FILE))) return fail('not-a-report', `no plain ${REPORT_FILE} in ${dir}`, 'the agent writes it; a link is never followed');
  for (const { file, lang } of files) {
    const text = readFileSync(join(dir, ...file.split('/')), 'utf8');
    sections[file] = sectionIdsOf(text);
    for (const b of blocksOf(text)) blocks.push({ report, file, lang, ...b });
  }
  return { ok: true, report, meta: read.meta, files, blocks, sections };
}

/** The section ids of a Markdown text, in order. */
export const sectionIdsOf = (markdown) => splitSections(markdown).sections.map((s) => s.id);

/**
 * The check of one report: the secret scan of every line of `report.md`, its translations and
 * its drafts, and, with a glossary, its prose held to the confirmed entries. `{ ok: true,
 * report, rev, lang, translations, findings }`, where `rev` is the SHA-256 of `report.md`.
 */
export function checkReport(dir, glossary) {
  const prose = proseOf(dir);
  if (!prose.ok) return prose;
  const findings = [];
  for (const { file } of prose.files) findings.push(...secretFindings(readFileSync(join(dir, ...file.split('/')), 'utf8'), file));
  for (const draft of draftNames(dir)) findings.push(...secretFindings(readFileSync(join(draftsDir(dir), `${draft}.md`), 'utf8'), `drafts/${draft}.md`));
  if (glossary) findings.push(...checkProse(glossary, prose).findings);
  return { ok: true, report: basename(dir), rev: textRev(readFileSync(join(dir, REPORT_FILE))), lang: prose.meta.lang, translations: translationLangs(dir), findings: findings.map((f) => ({ report: basename(dir), ...f })) };
}

// ---------------------------------------------------------------- render

/** The policy every rendered report carries first in its `<head>`: no script, no fetch, inline styles and data: pictures only. */
export const REPORT_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:";

/** The layout a report is rendered with when its template cannot be used. */
export const DEFAULT_LAYOUT = `<!doctype html>
<html lang="{{lang}}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{title}}</title>
<style>
body { font-family: system-ui, -apple-system, "Segoe UI", "Hiragino Sans", "Noto Sans JP", sans-serif; line-height: 1.6; color: #1f1f1f; max-width: 52rem; margin: 2rem auto; padding: 0 1.25rem; }
h1 { font-size: 1.9rem; margin-bottom: .25rem; }
h2 { border-bottom: 1px solid #ddd; padding-bottom: .2rem; margin-top: 2rem; }
.zukai-meta { display: grid; grid-template-columns: max-content 1fr; gap: .15rem 1rem; color: #555; font-size: .9rem; margin: 0 0 1.5rem; }
.zukai-meta dt { font-weight: 600; }
.zukai-meta dd { margin: 0; }
nav.zukai-toc { background: #f6f6f4; padding: .75rem 1rem; border-radius: 6px; font-size: .95rem; }
table { border-collapse: collapse; margin: 1rem 0; }
th, td { border: 1px solid #ccc; padding: .3rem .6rem; text-align: left; vertical-align: top; }
pre { background: #f6f6f4; padding: .75rem; overflow-x: auto; }
img { max-width: 100%; }
.zukai-embed-note, .zukai-missing-image { color: #8a5a00; }
@media print { body { margin: 0; max-width: none; } nav.zukai-toc { display: none; } h2 { break-after: avoid; } }
</style>
</head>
<body>
<header><h1>{{title}}</h1>{{meta}}</header>
<nav class="zukai-toc">{{toc}}</nav>
<main>{{sections}}</main>
</body>
</html>
`;

/** The placeholders a layout may hold. */
export const PLACEHOLDER_RE = /\{\{\s*(title|lang|meta|toc|sections|section:([a-z0-9][a-z0-9-]{0,63}))\s*\}\}/g;

const LABELS = {
  en: { kind: 'Kind', template: 'Template', lang: 'Language', created: 'Created', updated: 'Updated', runs: 'Diagrams', toc: 'Contents', noPicture: 'No picture of this diagram was exported yet. Export the run (draw.io desktop or Playwright makes the picture) or open it in the labs console:', tables: 'Description tables' },
  ja: { kind: '種類', template: 'テンプレート', lang: '言語', created: '作成', updated: '更新', runs: '図', toc: '目次', noPicture: 'この図の画像はまだ書き出されていません。ランを書き出す（draw.io デスクトップまたは Playwright が画像を作ります）か、labs コンソールで開いてください:', tables: '説明表' },
  vi: { kind: 'Loại', template: 'Mẫu', lang: 'Ngôn ngữ', created: 'Tạo lúc', updated: 'Cập nhật', runs: 'Sơ đồ', toc: 'Mục lục', noPicture: 'Sơ đồ này chưa được xuất ảnh. Hãy xuất run (draw.io desktop hoặc Playwright tạo ảnh) hoặc mở nó trong labs console:', tables: 'Bảng mô tả' },
};
const labelsFor = (lang) => LABELS[String(lang).toLowerCase().split('-')[0]] ?? LABELS.en;

/** The pictures of a run: its exported `svg/*.drawio.svg` (real files, each at most 2 MB). */
function runPictures(runDir) {
  const svg = join(runDir, 'svg');
  if (!isRealDir(svg)) return [];
  return readdirSync(svg).sort().filter((n) => n.endsWith('.svg') && n !== 'canvas.drawio.svg' && isRealFile(join(svg, n)) && statSync(join(svg, n)).size <= MAX_ASSET_BYTES)
    .map((n) => ({ name: n, src: `data:image/svg+xml;base64,${readFileSync(join(svg, n)).toString('base64')}` }));
}

/** The description tables of a run for a language: `<slug>.doc.<lang>.md`, else `<slug>.doc.md`. */
function runTables(runDir, lang) {
  const slug = basename(runDir).slice('yyyymmdd_'.length);
  for (const name of [`${slug}.doc.${lang}.md`, `${slug}.doc.md`]) {
    const path = join(runDir, name);
    if (isRealFile(path) && statSync(path).size <= MAX_ASSET_BYTES) return readFileSync(path, 'utf8');
  }
  return undefined;
}

/** The HTML an embed adds after its section. */
function embedHtml(embed, { meta, runsRoot, runs, lang, ids, viewerBase }) {
  if (!embed || meta.runs.length === 0) return '';
  const L = labelsFor(lang);
  const parts = [];
  for (const run of meta.runs) {
    if (!runs.includes(run)) {
      parts.push(`<p class="zukai-embed-note">${escapeHtml(run)}: not found in the runs folder.</p>`);
      continue;
    }
    const runDir = join(runsRoot, run);
    if (embed === 'diagram') {
      const pictures = runPictures(runDir);
      if (pictures.length > 0) {
        for (const p of pictures) parts.push(`<figure class="zukai-diagram"><img src="${p.src}" alt="${escapeHtml(p.name.replace(/\.drawio\.svg$|\.svg$/, ''))}"></figure>`);
      } else {
        const link = viewerBase ? `<a href="${escapeHtml(`${viewerBase}#/diagrams/${encodeURIComponent(run)}`)}">${escapeHtml(run)}</a>` : `<code>${escapeHtml(run)}</code>`;
        parts.push(`<p class="zukai-embed-note">${escapeHtml(L.noPicture)} ${link}</p>`);
      }
    } else if (embed === 'tables') {
      const tables = runTables(runDir, lang);
      if (tables !== undefined) parts.push(`<div class="zukai-tables">${renderMarkdown(tables, { ids }).html}</div>`);
      else parts.push(`<p class="zukai-embed-note">${escapeHtml(run)}: ${escapeHtml(L.tables)} —</p>`);
    }
  }
  return parts.join('\n');
}

/** The metadata block of a report, with any further rows (a template's sample metadata). */
function metaHtml(meta, lang, extra = []) {
  const L = labelsFor(lang);
  const row = (k, v) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`;
  return `<dl class="zukai-meta">${[
    row(L.kind, meta.kind),
    row(L.template, `${meta.template.id} (${meta.template.scope}, ${meta.template.version})`),
    row(L.lang, lang),
    row(L.created, meta.created.slice(0, 10)),
    row(L.updated, meta.updated.slice(0, 10)),
    ...(meta.runs.length ? [row(L.runs, meta.runs.join(', '))] : []),
    ...extra.map(([k, v]) => row(k, v)),
  ].join('')}</dl>`;
}

/**
 * Pour a report's Markdown into a layout: the sections rendered (with their embeds), the
 * table of contents, the metadata; then the policy `<meta>` put first in `<head>`, before any
 * markup of the layout. Placeholders are replaced in one pass, so text of the report that
 * looks like a placeholder stays text.
 * @returns {string} the HTML document
 */
export function pourReport({ markdown, meta, lang, layout, sectionsInfo = [], assets = new Map(), runsRoot, runs = [], viewerBase, extraMeta = [] }) {
  const ids = new Set();
  const { preamble, sections } = splitSections(markdown);
  const embeds = new Map(sectionsInfo.map((s) => [s.id, s.embed]));
  const headings = [];
  // The title line of the preamble is the report's title, shown by {{title}}.
  const pre = renderMarkdown(preamble.replace(/^\s*#\s+.*(\n|$)/, ''), { assets, ids });
  const rendered = new Map();
  for (const s of sections) {
    const r = renderMarkdown(s.markdown, { assets, ids });
    headings.push(...r.headings);
    rendered.set(s.id, `<section class="zukai-section" data-section="${escapeHtml(s.id)}">\n${r.html}${embedHtml(embeds.get(s.id), { meta, runsRoot, runs, lang, ids, viewerBase })}\n</section>`);
  }
  const L = labelsFor(lang);
  const top = headings.filter((h) => h.depth === Math.min(...headings.map((x) => x.depth)));
  const toc = top.length ? `<p class="zukai-toc-title">${escapeHtml(L.toc)}</p><ol>${top.map((h) => `<li><a href="#${h.id}">${escapeHtml(h.text)}</a></li>`).join('')}</ol>` : '';
  const all = `${pre.html.trim() ? `<div class="zukai-preamble">${pre.html}</div>\n` : ''}${[...rendered.values()].join('\n')}`;
  const values = { title: escapeHtml(meta.title), lang: escapeHtml(lang), meta: metaHtml(meta, lang, extraMeta), toc, sections: all };
  let html = layout.replace(PLACEHOLDER_RE, (_, name, id) => (id !== undefined ? rendered.get(id) ?? '' : values[name]));
  // The policy goes first by position, never after a match of "<head>" (which a comment, a
  // <title> or a <style> of the layout could hold): the parser puts a <meta> that comes before
  // any element into the head it opens, and the layout's own <html> and <head> tags then only
  // add their attributes.
  const policy = `<meta http-equiv="Content-Security-Policy" content="${REPORT_CSP}">`;
  const body = html.replace(/^\uFEFF?\s*<!doctype[^>]*>/i, '');
  const page = /<html[\s>]/i.test(body) ? body : `\n<html lang="${escapeHtml(lang)}">\n<head>\n<meta charset="utf-8">\n<title>${escapeHtml(meta.title)}</title>\n</head>\n<body>\n${body}\n</body>\n</html>\n`;
  return `<!doctype html>\n${policy}${page.startsWith('\n') ? '' : '\n'}${page}`;
}

/** An HTML text without its `data:` URIs, for the secret scan (a picture is no text). */
const withoutDataUris = (html) => html.replace(/data:[a-z+./-]+;base64,[A-Za-z0-9+/=]+/gi, 'data:');

/**
 * Render `report.md` and every translation to `report.html` through the template's layout
 * (`template.html`, or the default layout when no template is given). Nothing is written when
 * a source or a rendered page holds a credential.
 * @param {string} dir
 * @param {{ root?: string, template?: { html: string, sections: Array<{ id: string, embed?: string }> }, viewerBase?: string }} [options]
 * @returns {{ ok: true, written: string[], findings: object[] } | { ok: false, code: string, errors: object[] }}
 */
export function renderReport(dir, { root, template, viewerBase } = {}) {
  const read = readReport(dir);
  if (!read.ok) return read;
  const meta = read.meta;
  let runsRoot;
  let runs = [];
  try { runsRoot = runsPath(root); runs = runFoldersIn(runsRoot); } catch { runs = []; }
  const assets = assetsOf(dir);
  const layout = template?.html ?? DEFAULT_LAYOUT;
  const pages = [];
  const findings = [];
  for (const lang of [null, ...translationLangs(dir)]) {
    const rel = lang ? `${lang}/${REPORT_FILE}` : REPORT_FILE;
    if (!isRealFile(join(dir, ...rel.split('/')))) return fail('not-a-report', `no plain ${rel} in ${dir}`);
    const markdown = readFileSync(join(dir, ...rel.split('/')), 'utf8');
    findings.push(...secretFindings(markdown, rel));
    const html = pourReport({ markdown, meta, lang: lang ?? meta.lang, layout, sectionsInfo: template?.sections ?? [], assets, runsRoot, runs, viewerBase });
    const out = lang ? `${lang}/${REPORT_HTML}` : REPORT_HTML;
    findings.push(...secretFindings(withoutDataUris(html), out).filter((f) => f.level === 'blocking'));
    pages.push({ out, html });
  }
  const blocking = findings.filter((f) => f.level === 'blocking');
  if (blocking.length > 0) return { ok: false, code: 'secret', findings, errors: blocking.map((f) => ({ path: `${f.file}:${f.line}`, message: f.message, hint: 'remove the credential from report.md; nothing was rendered' })) };
  for (const p of pages) writeAtomic(join(dir, ...p.out.split('/')), p.html);
  return { ok: true, written: pages.map((p) => p.out), findings };
}

// ---------------------------------------------------------------- listing for people

/** One report as a listing shows it. */
export function reportSummary(dir) {
  const read = readReport(dir);
  if (!read.ok) return undefined;
  const { meta } = read;
  return {
    name: basename(dir),
    title: meta.title,
    kind: meta.kind,
    template: meta.template,
    lang: meta.lang,
    translations: translationLangs(dir),
    runs: meta.runs,
    created: meta.created,
    updated: meta.updated,
    rendered: isRealFile(join(dir, REPORT_HTML)),
    drafts: draftNames(dir).length,
    revisions: revisionDirs(dir).length,
  };
}

/** The reports of a project as a listing shows them, newest first; a bad `reportsDir` throws. */
export function listReports(root) {
  const base = reportsPath(root);
  return reportFoldersIn(base).map((name) => ({ ...reportSummary(join(base, name)), path: join(base, name) }));
}

/** The folder of a report given by a path: it must hold a valid record. */
export function reportDirOf(path) {
  const dir = resolve(path);
  const read = readReport(dir);
  return read.ok ? { ok: true, dir, meta: read.meta } : read;
}
