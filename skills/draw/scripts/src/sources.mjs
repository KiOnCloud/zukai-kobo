import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { orderIrFiles, runSlugOf } from './run-order.mjs';

/**
 * The source files a run was drawn from, and whether they changed since.
 *
 * A diagram names its files in `meta.sources` (project-relative paths, forward slashes).
 * `recordSources` hashes each of them into `source/<run-slug>.sources.json`; `staleRun`
 * hashes them again and lists what differs. Nothing here runs git or reaches the network,
 * and `staleRun` never writes.
 *
 *   { "sources": 1, "root": "../..", "lineEndings": "lf",
 *     "diagrams": [ { "id", "from": "meta.sources" | "meta.notes", "recordedAt",
 *                     "files": [ { "path", "sha256" } | { "path", "missing": true } ] } ] }
 *
 * `root` is the project root as seen from the run folder, so the record still finds the
 * files when the project is checked out somewhere else. The hash is SHA-256 of the bytes
 * with every CRLF read as LF: a checkout that converts line endings (git `core.autocrlf`
 * on Windows, LF on a CI runner) must not make every diagram look out of date. A lone CR
 * is kept as it is.
 */

export const RECORD_SUFFIX = '.sources.json';

const fail = (code, path, message, hint) => ({ ok: false, code, errors: [{ path, message, ...(hint ? { hint } : {}) }] });
const slashes = (p) => p.split('\\').join('/');

/** Why a `meta.sources` entry is not a project-relative path, or undefined when it is one. */
export function sourcePathProblem(path) {
  if (typeof path !== 'string' || path.trim() === '') return undefined;
  if (/^([A-Za-z]:[\\/]|[\\/])/.test(path) || /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(path)) return 'absolute';
  if (path.includes('\\')) return 'backslash';
  if (path.split('/').includes('..')) return 'outside';
  return undefined;
}

/** `./src//a.ts` and `src/a.ts` are one file. */
const normalise = (path) => path.split('/').filter((s) => s !== '' && s !== '.').join('/');

/** SHA-256 of a file's bytes with CRLF read as LF. */
export function hashBytes(buf) {
  const out = Buffer.allocUnsafe(buf.length);
  let n = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0d && buf[i + 1] === 0x0a) continue;
    out[n++] = buf[i];
  }
  return createHash('sha256').update(out.subarray(0, n)).digest('hex');
}

/** The state of one source file now: its hash, or why there is none. */
function stateOf(root, path) {
  const abs = join(root, ...path.split('/'));
  let stat;
  try {
    stat = statSync(abs);
  } catch {
    return { missing: 'no such file' };
  }
  if (!stat.isFile()) return { missing: 'not a file' };
  try {
    return { sha256: hashBytes(readFileSync(abs)) };
  } catch (e) {
    return { missing: `cannot read: ${e.code ?? e.message}` };
  }
}

/**
 * The nearest ancestor of the run folder (itself included) that is the root of a git work
 * tree: a folder holding `.git`, as a directory or, in a linked work tree, as a file.
 */
export function gitRootOf(runDir) {
  let at = resolve(runDir);
  for (;;) {
    if (existsSync(join(at, '.git'))) return at;
    const parent = dirname(at);
    if (parent === at) return undefined;
    at = parent;
  }
}

/** The project root for a new record: `--root`, else the git work tree of the run, else the working directory. */
function rootFor(run, given) {
  const root = given !== undefined ? resolve(given) : gitRootOf(run) ?? process.cwd();
  if (!existsSync(root) || !statSync(root).isDirectory()) return { error: fail(1, given ?? root, `no such project folder: ${root}`, '--root takes the folder the meta.sources paths start from') };
  return { root };
}

/**
 * Path-like words of the notes that are files under the root: what a run drawn before
 * `meta.sources` existed cites. A word counts when it has a `/` or a file extension; a
 * trailing line number (`:42`, `#L10`) and sentence punctuation are dropped.
 */
function pathsInNotes(notes, root) {
  const found = [];
  for (const note of Array.isArray(notes) ? notes : []) {
    if (typeof note !== 'string') continue;
    for (const raw of note.split(/[\s,;()[\]{}<>"'`]+/)) {
      const token = normalise(raw.replace(/(#L\d+(-L?\d+)?|:\d+(-\d+)?(:\d+)?)$/, '').replace(/[.:!?]+$/, ''));
      if (token === '' || !(token.includes('/') || /\.[A-Za-z0-9]{1,8}$/.test(token))) continue;
      if (sourcePathProblem(token) || found.includes(token)) continue;
      if (stateOf(root, token).sha256 !== undefined) found.push(token);
    }
  }
  return found;
}

function checkRun(run, given) {
  if (!existsSync(run)) return fail(1, given, `no such folder: ${run}`, 'pass the run folder, diagrams/<yyyymmdd>_<run-slug>');
  const source = join(run, 'source');
  if (!existsSync(source) || !statSync(source).isDirectory()) return fail(1, given, `no source/ folder in ${run}`, 'pass the run folder, diagrams/<yyyymmdd>_<run-slug>');
  return null;
}

/** Every IR of the run in run order, as { id, ir }; an IR that is not JSON is an error. */
function readIrs(run) {
  const source = join(run, 'source');
  const entries = [];
  for (const f of orderIrFiles(readdirSync(source).filter((n) => n.endsWith('.ir.json')), runSlugOf(source))) {
    try {
      entries.push({ id: f.slice(0, -'.ir.json'.length), ir: JSON.parse(readFileSync(join(source, f), 'utf8')) });
    } catch (e) {
      return { error: fail(1, join(source, f), `not valid JSON: ${e.message}`) };
    }
  }
  return { entries };
}

/**
 * The file that holds the record of a run: `source/<run-slug>.sources.json`. A run folder
 * that was renamed or copied under another name still holds the record under the old slug,
 * and a run has one record, so the one `*.sources.json` its `source/` holds is the record
 * whatever it is called: the folder says which record is its own, not its name.
 */
export function recordPathOf(runDir) {
  const run = resolve(runDir);
  const source = join(run, 'source');
  const named = join(source, `${runSlugOf(run) ?? basename(run)}${RECORD_SUFFIX}`);
  if (existsSync(named)) return named;
  const held = recordsIn(source);
  return held.length === 1 ? join(source, held[0]) : named;
}

function recordsIn(source) {
  try {
    return readdirSync(source).filter((f) => f.endsWith(RECORD_SUFFIX)).sort();
  } catch {
    return [];
  }
}

function readRecord(run, given) {
  const path = recordPathOf(run);
  if (!existsSync(path)) {
    // Several records and none named after the run: nothing says which one speaks for it.
    const held = recordsIn(join(run, 'source'));
    if (held.length > 1) return { several: true, error: fail(1, given, `${held.length} sources records in ${join(run, 'source')} and none is named after the run: ${held.join(', ')}`, `a run has one record: keep the one that belongs to this run as ${basename(path)} and delete the others, or delete them all and record again with: sources <run-dir>`) };
    return { path };
  }
  let record;
  try {
    record = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    return { error: fail(1, given, `the sources record is not valid JSON: ${e.message}`, `delete ${path} and record again with: sources <run-dir>`) };
  }
  if (record === null || typeof record !== 'object' || record.sources !== 1 || !Array.isArray(record.diagrams) || record.diagrams.some((d) => d === null || typeof d !== 'object' || typeof d.id !== 'string' || !Array.isArray(d.files))) {
    return { error: fail(1, given, 'not a sources record (no "sources": 1 and "diagrams")', `delete ${path} and record again with: sources <run-dir>`) };
  }
  return { path, record };
}

/** The declared source list of an IR, without repeats; undefined when it declares none. */
function declared(ir) {
  const list = ir?.meta?.sources;
  if (!Array.isArray(list) || list.length === 0) return undefined;
  return [...new Set(list.filter((p) => typeof p === 'string' && p.trim() !== '').map(normalise))];
}

/**
 * Hash every source file of every diagram of a run and write the record.
 * @param {string} runDir
 * @param {{ root?: string, only?: string[], now?: Date }} [options]
 *   `only` records these diagrams and leaves the entries of the others as they are
 */
export function recordSources(runDir, options = {}) {
  const run = resolve(runDir);
  const bad = checkRun(run, runDir);
  if (bad) return bad;
  const read = readIrs(run);
  if (read.error) return read.error;
  if (read.entries.length === 0) return fail(1, runDir, `no IR files in ${join(run, 'source')}`, 'a run holds at least one source/<slug>.ir.json');
  const only = options.only;
  if (only) {
    const unknown = only.filter((id) => !read.entries.some((e) => e.id === id));
    if (unknown.length > 0) return fail(1, '--only', `no diagram ${unknown.map((u) => `"${u}"`).join(', ')} in this run`, `diagrams: ${read.entries.map((e) => e.id).join(', ')}`);
  }
  const existing = readRecord(run, runDir);
  // A record that cannot be read is replaced by a full recording, never patched. Several
  // records are never replaced: which of them to keep is the user's to say.
  if (existing.error && (only || existing.several)) return existing.error;
  const kept = only && existing.record ? existing.record : undefined;
  let root;
  if (options.root === undefined && kept) root = resolve(run, kept.root ?? '.');
  else {
    const r = rootFor(run, options.root);
    if (r.error) return r.error;
    root = r.root;
    // One record, one root: the entries that stay were hashed from the root it names.
    if (kept && resolve(run, kept.root ?? '.') !== root) return fail(1, '--root', `the record was taken with the project root ${resolve(run, kept.root ?? '.')}; --only cannot mix it with ${root}`, 'leave --root out, or record the whole run again without --only');
  }
  const recordedAt = (options.now ?? new Date()).toISOString();
  const diagrams = [];
  const summary = [];
  const fallback = [];
  const missing = [];
  const untracked = [];
  const problems = [];
  for (const { id, ir } of read.entries) {
    if (only && !only.includes(id)) {
      const entry = kept?.diagrams.find((d) => d.id === id);
      if (entry) diagrams.push(entry);
      continue;
    }
    let paths = declared(ir);
    let from = 'meta.sources';
    if (paths) {
      for (const p of ir.meta.sources) {
        const problem = sourcePathProblem(p);
        if (problem) problems.push({ path: `${id}:/meta/sources`, message: `"${p}" is not a path inside the project (${problem})`, hint: 'meta.sources holds paths relative to the project root, with forward slashes and no ".."' });
      }
    } else if (ir?.meta?.source === 'scout') {
      // Drawn before meta.sources existed: the paths the scout cited in its notes stand in.
      const cited = pathsInNotes(ir.meta.notes, root);
      if (cited.length > 0) {
        paths = cited;
        from = 'meta.notes';
        fallback.push(id);
      }
    }
    if (!paths) {
      untracked.push(id);
      continue;
    }
    const files = paths.map((path) => {
      const state = stateOf(root, path);
      if (state.sha256 !== undefined) return { path, sha256: state.sha256 };
      missing.push({ diagram: id, path, reason: state.missing });
      return { path, missing: true };
    });
    diagrams.push({ id, from, recordedAt, files });
    summary.push({ id, from, files: files.length, missing: files.filter((f) => f.missing).length });
  }
  if (problems.length > 0) return { ok: false, code: 2, errors: problems };
  if (diagrams.length === 0) {
    return fail(1, runDir, 'no diagram of this run names its source files, so there is nothing to record', 'a scouted diagram lists them in meta.sources; a run that was not drawn from code has no sources to follow');
  }
  const rel = slashes(relative(run, root));
  const record = { sources: 1, root: rel === '' ? '.' : rel, lineEndings: 'lf', diagrams };
  const path = existing.path ?? recordPathOf(run);
  // Written beside its place and renamed, so an interrupted run never leaves half a record.
  const tmp = `${path}.tmp-${process.pid}`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(tmp, JSON.stringify(record, null, 2) + '\n', 'utf8');
  renameSync(tmp, path);
  const warnings = [];
  if (fallback.length > 0) {
    warnings.push({ stage: 'sources', path: '/meta/sources', message: `no meta.sources in ${fallback.join(', ')}: the files named in meta.notes that exist under the project root were recorded instead`, hint: 'check the list in the record; add meta.sources to the IR to fix the list for good' });
  }
  for (const m of missing) warnings.push({ stage: 'sources', path: `${m.diagram}:${m.path}`, message: `source file not recorded (${m.reason}) under ${root}`, hint: 'fix the path in meta.sources, or pass --root when the paths start from another folder' });
  return { ok: true, record: path, root, recordedAt, diagrams: summary, fallback, missing, untracked, warnings };
}

/**
 * Compare the record of a run with the files now. Never writes.
 * @param {string} runDir
 * @param {{ root?: string }} [options] `root` replaces the root the record was taken with
 * @returns `stale` is true when a recorded file changed or is gone, or when a diagram names
 *   sources the record does not hold
 */
export function staleRun(runDir, options = {}) {
  const run = resolve(runDir);
  const bad = checkRun(run, runDir);
  if (bad) return bad;
  const existing = readRecord(run, runDir);
  if (existing.error) return existing.error;
  if (!existing.record) {
    return fail(1, runDir, `no sources record in ${join(run, 'source')}`, 'record one with `sources <run-dir>` once the diagrams match the code; a run that was not drawn from code has none');
  }
  const record = existing.record;
  let root;
  if (options.root !== undefined) {
    root = resolve(options.root);
    if (!existsSync(root) || !statSync(root).isDirectory()) return fail(1, options.root, `no such project folder: ${root}`);
  } else {
    root = resolve(run, typeof record.root === 'string' ? record.root : '.');
    if (!existsSync(root)) return fail(1, runDir, `the project root of the record does not exist: ${root}`, 'pass --root <project>');
  }
  const read = readIrs(run);
  if (read.error) return read.error;
  const diagrams = [];
  const changedAll = new Set();
  const deletedAll = new Set();
  const unrecorded = [];
  const untracked = [];
  for (const { id, ir } of read.entries) {
    const entry = record.diagrams.find((d) => d.id === id);
    const now = declared(ir);
    if (!entry) {
      (now ? unrecorded : untracked).push(id);
      continue;
    }
    // The list in the IR was changed after the record was taken: the record no longer speaks for it.
    if (now && (now.length !== entry.files.length || now.some((p) => !entry.files.some((f) => f.path === p)))) unrecorded.push(id);
    const changed = [];
    const deleted = [];
    for (const f of entry.files) {
      if (typeof f?.path !== 'string') continue;
      const state = stateOf(root, f.path);
      if (state.sha256 === undefined) {
        // Missing when recorded and still missing is no change.
        if (!f.missing) deleted.push(f.path);
      } else if (f.missing || state.sha256 !== f.sha256) changed.push(f.path);
    }
    for (const p of changed) changedAll.add(p);
    for (const p of deleted) deletedAll.add(p);
    if (changed.length + deleted.length > 0) diagrams.push({ id, recordedAt: entry.recordedAt ?? null, changed, deleted });
  }
  const notInRun = record.diagrams.map((d) => d.id).filter((id) => !read.entries.some((e) => e.id === id));
  const stale = diagrams.length > 0 || unrecorded.length > 0;
  return {
    ok: true,
    run: runDir,
    record: existing.path,
    root,
    stale,
    diagrams,
    changed: [...changedAll].sort(),
    deleted: [...deletedAll].sort(),
    unrecorded,
    untracked,
    ...(notInRun.length > 0 ? { notInRun } : {}),
  };
}
