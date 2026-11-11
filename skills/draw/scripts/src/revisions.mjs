import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { validateIr } from './validate-ir.mjs';
import { orderIrFiles, runSlugOf } from './run-order.mjs';

/**
 * Revisions of a run folder (`diagrams/<yyyymmdd>_<run-slug>/`): every IR of the run copied
 * together into `history/r<NNN>/`, so a main diagram, its `ref` parts and its business views
 * are always restored as one consistent set. Only the newest revisions are kept.
 *
 *   history/r007/revision.json       { rev, number, createdAt, request, files, extras, undo, redo, bundle?, undoOf? }
 *   history/r007/source/*.ir.json    every IR of the run at that point
 *   history/r007/extras/<path>       delivered files that carried hand edits, when given
 *   history/extras/r003/<path>       the extras of a revision that was rotated away
 *
 * Extras are the only copy of a file the user edited by hand in draw.io, so rotation never
 * deletes them: when their revision goes, they move to `history/extras/<rev>/` and stay
 * until the user removes them.
 *
 * `undo` and `redo` in the newest record are the two stacks of the run as that revision left
 * them: the revisions that hold the states before the current one (nearest last) and the
 * states a redo goes forward to (nearest first). A change clears `redo`; a restore moves
 * revisions between the two, so "undo, undo, redo, redo" walks back and forth along one line
 * instead of redoing the previous restore.
 *
 * A revision is written into a temporary sibling and renamed into place, so an interrupted
 * run never leaves half a revision; temporary siblings are only created here, so stale ones
 * are dropped on the next snapshot.
 */

const REV = /^r(\d{3,})$/;

const fail = (code, message, hint) => ({ ok: false, code, errors: [{ path: '/', message, ...(hint ? { hint } : {}) }] });

function irFiles(dir) {
  if (!existsSync(dir)) return [];
  return orderIrFiles(readdirSync(dir).filter((f) => f.endsWith('.ir.json')), runSlugOf(dir));
}

function readRecord(revPath) {
  try {
    const record = JSON.parse(readFileSync(join(revPath, 'revision.json'), 'utf8'));
    return record && typeof record === 'object' && !Array.isArray(record) ? record : {};
  } catch {
    // A revision without a readable record still lists, with what its folder shows.
    return {};
  }
}

/**
 * The undo and redo stacks as the newest revision left them, without revisions that were
 * rotated away. A run written before the stacks were recorded is read by the rule it was
 * written with: after a restore the revision it made is the redo and the revisions older
 * than its target (those no restore wrote) are the undo; otherwise every revision is.
 */
function timeline(runDir) {
  const dirs = revisionDirs(runDir);
  if (dirs.length === 0) return { undo: [], redo: [] };
  const existing = new Set(dirs.map((d) => d.rev));
  const newest = dirs.at(-1);
  const record = readRecord(newest.path);
  const revs = (list) => list.filter((r) => typeof r === 'string' && existing.has(r));
  if (Array.isArray(record.undo) && Array.isArray(record.redo)) return { undo: revs(record.undo), redo: revs(record.redo) };
  const target = typeof record.undoOf === 'string' ? REV.exec(record.undoOf) : null;
  if (target) {
    const older = dirs.filter((d) => d.number < Number(target[1]) && readRecord(d.path).undoOf === undefined);
    return { undo: older.map((d) => d.rev), redo: [newest.rev] };
  }
  return { undo: dirs.map((d) => d.rev), redo: [] };
}

/** The stacks after a restore of `target` whose snapshot of the state left behind is `rev`. */
function timelineAfterRestore({ undo, redo }, target, rev) {
  const u = undo.indexOf(target);
  if (u >= 0) return { undo: undo.slice(0, u), redo: [...undo.slice(u + 1), rev, ...redo] };
  const r = redo.indexOf(target);
  if (r >= 0) return { undo: [...undo, rev, ...redo.slice(0, r)], redo: redo.slice(r + 1) };
  return { undo: [...undo, rev], redo: [] };
}

/** Every file under a folder, as paths relative to it with forward slashes. */
function filesUnder(dir, prefix = '') {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesUnder(join(dir, e.name), `${prefix}${e.name}/`) : [`${prefix}${e.name}`]));
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
  if (!existsSync(runDir)) return fail(1, `no such folder: ${runDir}`, 'pass the run folder, diagrams/<yyyymmdd>_<run-slug>');
  if (!existsSync(join(runDir, 'source')) || !statSync(join(runDir, 'source')).isDirectory()) {
    return fail(1, `no source/ folder in ${runDir}`, 'pass the run folder, diagrams/<yyyymmdd>_<run-slug>');
  }
  return null;
}

/**
 * Copy the run's current IRs (and any extra delivered files) into a new revision.
 * @param {string} runDir
 * Relative `extras` are resolved against the run folder.
 * @param {{ keep?: number, request?: string, extras?: string[], bundle?: object, undoOf?: string, allowEmpty?: boolean, now?: Date }} [options]
 *   `undoOf` and `allowEmpty` are set by `restoreRun` for the snapshot of the state it leaves
 */
export function snapshotRun(runDir, options = {}) {
  const run = resolve(runDir);
  const bad = checkRun(run);
  if (bad) return bad;
  const keep = options.keep ?? 5;
  if (!Number.isInteger(keep) || keep < 1) return fail(1, '--keep takes a whole number, 1 or more');
  // A revision without an IR could never be restored and would still push a real one out.
  if (irFiles(join(run, 'source')).length === 0 && !options.allowEmpty) {
    return fail(1, `no IR files in ${join(run, 'source')}; nothing to snapshot`, 'a run holds at least one source/<slug>.ir.json; pass the run folder the draw skill wrote');
  }
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
  const before = timeline(run);
  const stacks = options.undoOf ? timelineAfterRestore(before, options.undoOf, rev) : { undo: [...before.undo, rev], redo: [] };
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
    undo: stacks.undo,
    redo: stacks.redo,
    ...(options.bundle ? { bundle: options.bundle } : {}),
    ...(options.undoOf ? { undoOf: options.undoOf } : {}),
  };
  writeFileSync(join(tmp, 'revision.json'), JSON.stringify(record, null, 2) + '\n', 'utf8');
  renameSync(tmp, join(history, rev));

  const all = revisionDirs(run);
  const removed = all.slice(0, Math.max(0, all.length - keep)).map((r) => r.rev);
  const keptExtras = [];
  for (const r of removed) {
    // Hand-edited files exist nowhere else: they outlive their revision.
    const from = join(history, r, 'extras');
    if (filesUnder(from).length > 0) {
      const to = join(history, 'extras', r);
      mkdirSync(dirname(to), { recursive: true });
      rmSync(to, { recursive: true, force: true });
      renameSync(from, to);
      keptExtras.push(...filesUnder(to).map((f) => `history/extras/${r}/${f}`));
    }
    rmSync(join(history, r), { recursive: true, force: true });
  }
  return { ok: true, rev, path: join(history, rev), files, extras: record.extras, removed, ...(keptExtras.length > 0 ? { keptExtras } : {}) };
}

/** Revisions of a run, newest first. */
export function listRevisions(runDir) {
  const run = resolve(runDir);
  const bad = checkRun(run);
  if (bad) return bad;
  const revisions = revisionDirs(run).reverse().map((r) => {
    const record = readRecord(r.path);
    return { rev: r.rev, createdAt: record.createdAt ?? null, request: record.request ?? '', files: irFiles(join(r.path, 'source')), extras: record.extras ?? [], ...(record.bundle ? { bundle: record.bundle } : {}), ...(record.undoOf ? { undoOf: record.undoOf } : {}) };
  });
  // What a plain "undo" and a "redo" restore from here, and the hand-edited files that
  // outlived their revision.
  const { undo, redo } = timeline(run);
  const keptExtras = filesUnder(join(run, 'history', 'extras')).map((f) => `history/extras/${f}`);
  return { ok: true, undo: undo.at(-1) ?? null, redo: redo[0] ?? null, revisions, ...(keptExtras.length > 0 ? { keptExtras } : {}) };
}

/**
 * Put a revision's IRs back into `source/`. The current state is snapshotted first, so a
 * restore can itself be undone; that snapshot records `undoOf: <rev>`, takes the current
 * bundle options and any hand-edited outputs given as `extras`. IRs the revision does not
 * have are removed with their per-diagram outputs; the caller then emits and bundles again
 * with the `bundle` options of the restored revision.
 * @param {string} runDir
 * @param {string} revOrStep a revision (`r003`), or `undo` / `redo` for one step along the run's timeline
 * @param {{ keep?: number, request?: string, extras?: string[], bundle?: object, now?: Date }} [options]
 */
export function restoreRun(runDir, revOrStep, options = {}) {
  const run = resolve(runDir);
  const bad = checkRun(run);
  if (bad) return bad;
  const all = revisionDirs(run);
  let rev = revOrStep;
  if (revOrStep === 'undo' || revOrStep === 'redo') {
    const stacks = timeline(run);
    rev = revOrStep === 'undo' ? stacks.undo.at(-1) : stacks.redo[0];
    if (rev === undefined) {
      return fail(1, revOrStep === 'undo' ? `nothing earlier to go back to in ${run}` : `nothing to redo in ${run}`, all.length ? `existing revisions: ${all.map((r) => r.rev).join(', ')}; name one to restore it whatever the timeline says` : 'this run has no revisions yet');
    }
  }
  const target = all.find((r) => r.rev === rev);
  if (!target) return fail(1, `no revision ${rev} in ${run}`, all.length ? `existing revisions: ${all.map((r) => r.rev).join(', ')}` : 'this run has no revisions yet');

  // Read the revision before snapshotting: the snapshot's rotation may delete its folder.
  const files = irFiles(join(target.path, 'source'));
  if (files.length === 0) return fail(1, `revision ${rev} holds no IR files; refusing to empty source/`, 'pick another revision with `revisions`');
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

  const snap = snapshotRun(run, { keep: options.keep, request: options.request ?? `${revOrStep === 'redo' ? 'redo' : 'undo'} to ${rev}`, extras: options.extras, bundle: options.bundle, undoOf: rev, allowEmpty: true, now: options.now });
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
  // The extras of the restored revision: where they are now (its folder may just have been rotated away).
  const extrasDir = existsSync(join(target.path, 'extras')) ? `history/${rev}/extras` : `history/extras/${rev}`;
  const extras = filesUnder(join(run, extrasDir)).map((f) => `${extrasDir}/${f}`);
  return { ok: true, restored: rev, snapshot: snap.rev, removedRevisions: snap.removed, ...(snap.keptExtras ? { keptExtras: snap.keptExtras } : {}), files, removedDiagrams, ...(extras.length > 0 ? { extras } : {}), ...(bundle ? { bundle } : {}) };
}
