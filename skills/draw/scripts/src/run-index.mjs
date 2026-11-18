/**
 * The run index: one file per user that lists the projects holding runs, so `index list` can
 * say which diagrams there are in which project. It is a cache. It holds the real path of each
 * project root and when a command last saw it, nothing else: run names, titles and diagram
 * text are read from the project's runs folder on every read, so the index never holds data a
 * run folder does not, and it can be deleted and rebuilt (`index rebuild --scan <dir>`).
 *
 *   { "index": 1, "projects": [ { "root": "<absolute>", "lastSeen": "<ISO time>" } ] }
 *
 * It lives in `ZUKAI_HOME` when set, else `%LOCALAPPDATA%\zukai` on Windows, else `~/.zukai`;
 * the folder is created private to the user (0700) and the file 0600. `ZUKAI_INDEX=off` stops
 * every read and write.
 *
 * Registering is a side effect of the commands that write runs (`bundle`, `snapshot`,
 * `restore`, `sources`) and of `labs start` and `runs-dir`: it reads the file right before it
 * writes a temporary sibling and renames it, so a concurrent writer loses at most its own
 * entry, which its next command adds back. It never fails the command: any error is dropped.
 * A write also drops the projects whose folder is gone (a bad setting or a drive that is not
 * mounted keeps its entry); a read never writes. A file of a newer version, or one that cannot
 * be read, is never replaced.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { readProjectConfig, runFoldersIn, runsPath } from './project-config.mjs';

export const INDEX_VERSION = 1;
export const INDEX_FILE = 'index.json';
const SCAN_DEPTH = 4;
const SKIPPED = new Set(['node_modules']);

/** The folder of the index. */
export function indexHome(env = process.env, platform = process.platform, home = homedir()) {
  if (env.ZUKAI_HOME) return resolve(env.ZUKAI_HOME);
  if (platform === 'win32') return join(env.LOCALAPPDATA ?? join(home, 'AppData', 'Local'), 'zukai');
  return join(home, '.zukai');
}

export const indexFile = (env = process.env) => join(indexHome(env), INDEX_FILE);
export const indexOff = (env = process.env) => env.ZUKAI_INDEX === 'off';

/**
 * The entries of the file: `{ projects, corrupt, kept }`. A missing file has none. A file that
 * is not an index of this version's shape is `corrupt` and may be replaced. A file this version
 * must not replace is `kept`: one written by a newer version (another install channel may be
 * newer), or one that could not be read for another reason than being missing.
 */
function readEntries(file) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return { projects: [], corrupt: false };
    return { projects: [], corrupt: true, kept: `cannot read ${file}: ${e.code ?? 'error'}` };
  }
  try {
    const data = JSON.parse(text);
    if (typeof data?.index === 'number' && data.index !== INDEX_VERSION) return { projects: [], corrupt: true, kept: `${file} was written by another version of Zukai ("index": ${data.index})` };
    if (data?.index !== INDEX_VERSION || !Array.isArray(data.projects)) return { projects: [], corrupt: true };
    const projects = data.projects.filter((p) => typeof p?.root === 'string' && p.root !== '').map((p) => ({ root: p.root, lastSeen: typeof p.lastSeen === 'string' ? p.lastSeen : null }));
    return { projects, corrupt: false };
  } catch {
    return { projects: [], corrupt: true };
  }
}

/**
 * Whether a project root still exists and its setting resolves, and why not. Only `missing`
 * (the folder is gone) is ever dropped from the file: a setting being edited or a drive that
 * is not mounted right now is no reason to forget a project.
 */
function aliveness(root) {
  try {
    if (!statSync(root).isDirectory()) return { alive: false, reason: 'missing' };
  } catch (e) {
    return { alive: false, reason: e.code === 'ENOENT' || e.code === 'ENOTDIR' ? 'missing' : 'unreachable' };
  }
  const config = readProjectConfig(root);
  if (!config.ok) return { alive: false, reason: 'bad-config', config };
  return { alive: true, config };
}

function writeEntries(file, home, projects) {
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const temp = join(home, `.${INDEX_FILE}.${randomBytes(6).toString('hex')}.tmp`);
  const sorted = [...projects].sort((a, b) => (a.root < b.root ? -1 : a.root > b.root ? 1 : 0));
  try {
    writeFileSync(temp, `${JSON.stringify({ index: INDEX_VERSION, projects: sorted }, null, 2)}\n`, { mode: 0o600 });
    renameSync(temp, file);
    try { chmodSync(file, 0o600); } catch { /* a system without modes */ }
  } catch (e) {
    try { unlinkSync(temp); } catch { /* not written */ }
    throw e;
  }
}

/** Read, change and write the file; the change takes the kept entries (missing ones dropped). */
function update(env, change) {
  const home = indexHome(env);
  const file = join(home, INDEX_FILE);
  const { projects, kept } = readEntries(file);
  if (kept) throw Object.assign(new Error(kept), { code: 'index-kept' });
  const live = projects.filter((p) => aliveness(p.root).reason !== 'missing');
  const dropped = projects.filter((p) => !live.includes(p)).map((p) => p.root);
  const next = change(live);
  writeEntries(file, home, next);
  return { file, dropped, projects: next };
}

const realRoot = (root) => realpathSync(resolve(root));

/**
 * Add or refresh a project. Never throws and never prints: the command that called it keeps
 * its output and exit code whatever happens here.
 */
export function registerProject(root, { env = process.env, now = new Date() } = {}) {
  if (indexOff(env) || root === undefined) return false;
  try {
    const real = realRoot(root);
    if (!aliveness(real).alive) return false;
    update(env, (live) => [...live.filter((p) => p.root !== real), { root: real, lastSeen: now.toISOString() }]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Every project of the index with what its runs folder holds now:
 * `{ file, projects: [ { root, alive, reason?, runsDir, runs, lastSeen } ], warnings }`.
 * Reading never writes.
 */
export function listIndex({ env = process.env } = {}) {
  const file = indexFile(env);
  const { projects, corrupt, kept } = readEntries(file);
  const warnings = kept
    ? [{ path: file, message: `${kept}; it is shown as empty and left as it is`, hint: 'use the newer Zukai, or delete the file and run index rebuild --scan <folder>' }]
    : corrupt ? [{ path: file, message: 'the index could not be read and is taken as empty; the next command that registers a project replaces it', hint: 'index rebuild --scan <folder> registers the projects under a folder again' }] : [];
  const out = projects.map((p) => {
    const state = aliveness(p.root);
    if (!state.alive) return { root: p.root, alive: false, reason: state.reason, runsDir: null, runs: [], lastSeen: p.lastSeen };
    return { root: p.root, alive: true, runsDir: state.config.runsDir, runs: runFoldersIn(runsPath(p.root)), lastSeen: p.lastSeen };
  });
  return { file, projects: out, warnings };
}

/**
 * The projects under a folder, at most four levels down, past dependencies and hidden folders.
 * A project is a folder with `.zukai/`, or one whose runs folder holds a run. A runs folder a
 * project above already owns makes no project of its own: with `runsDir: "docs/diagrams"`,
 * `docs/` is not a second project.
 */
export function scanProjects(dir, env = process.env) {
  const found = [];
  const owned = new Set();
  // ~/.zukai is the index's own folder, not the state of a project in the home folder.
  let home;
  try { home = realpathSync(indexHome(env)); } catch { home = indexHome(env); }
  const hasState = (at) => {
    const state = join(at, '.zukai');
    if (!existsSync(state)) return false;
    try { return realpathSync(state) !== home || existsSync(join(state, 'config.json')); } catch { return false; }
  };
  const isProject = (at) => {
    const config = readProjectConfig(at);
    const runs = config.ok ? runsPath(at) : undefined;
    const project = hasState(at) || (runs !== undefined && !owned.has(runs) && runFoldersIn(runs).length > 0);
    if (project && runs !== undefined) owned.add(runs);
    return project;
  };
  const walk = (at, depth) => {
    if (isProject(at)) found.push(at);
    if (depth === SCAN_DEPTH) return;
    let names;
    try {
      names = readdirSync(at, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of names) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || SKIPPED.has(entry.name)) continue;
      walk(join(at, entry.name), depth + 1);
    }
  };
  walk(realRoot(dir), 0);
  return found;
}

/**
 * Drop the dead projects and register the projects found under each folder of `scan`:
 * `{ ok: true, file, added, dropped, projects }` or `{ ok: false, error }`.
 */
export function rebuildIndex({ scan = [], env = process.env, now = new Date() } = {}) {
  for (const dir of scan) {
    try {
      if (!statSync(dir).isDirectory()) throw new Error('not a folder');
    } catch {
      return { ok: false, error: { code: 'bad-request', message: `--scan ${dir}: no such folder` } };
    }
  }
  const found = scan.flatMap((dir) => scanProjects(dir, env)).filter((root) => aliveness(root).alive);
  try {
    let added = [];
    const result = update(env, (live) => {
      const known = new Set(live.map((p) => p.root));
      added = [...new Set(found)].filter((root) => !known.has(root));
      return [...live.filter((p) => !found.includes(p.root)), ...[...new Set(found)].map((root) => ({ root, lastSeen: now.toISOString() }))];
    });
    return { ok: true, file: result.file, added, dropped: result.dropped, projects: result.projects.length };
  } catch (e) {
    return { ok: false, error: { code: 'index-write', message: e.code === 'index-kept' ? `${e.message}; it was left as it is` : `cannot write ${indexFile(env)}: ${e.code ?? 'error'}` } };
  }
}

/** Remove one project, given by its root as listed (it may no longer exist): `{ ok, file, removed }`. */
export function forgetProject(root, { env = process.env } = {}) {
  const wanted = new Set([resolve(root)]);
  try { wanted.add(realRoot(root)); } catch { /* gone: the listed path is the one */ }
  const home = indexHome(env);
  const file = join(home, INDEX_FILE);
  const { projects, kept: untouchable } = readEntries(file);
  if (untouchable) return { ok: false, error: { code: 'index-write', message: `${untouchable}; it was left as it is` } };
  const kept = projects.filter((p) => !wanted.has(p.root));
  if (kept.length === projects.length) return { ok: true, file, removed: false };
  try {
    writeEntries(file, home, kept);
  } catch (e) {
    return { ok: false, error: { code: 'index-write', message: `cannot write ${file}: ${e.code ?? 'error'}` } };
  }
  return { ok: true, file, removed: true };
}
