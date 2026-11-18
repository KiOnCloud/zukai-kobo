/**
 * The project setting `.zukai/config.json`, committed with the project:
 *
 *   { "config": 1, "runsDir": "docs/diagrams" }
 *
 * `runsDir` is the folder the runs of the project live in, a relative path inside the project
 * root with `/` between its parts. No file, or no `runsDir`, means `diagrams`, as before the
 * setting existed. A file that cannot be read, is not JSON, carries a `config` number this
 * version does not know or a `runsDir` that breaks the rule is an error (`bad-config`), never
 * a silent fall back to `diagrams/`: runs written into the wrong folder are worse than a
 * command that stops and names the file.
 *
 * `reportsDir` (default `reports`) is the folder of the project's reports, under the same
 * rules, and never the runs folder nor inside it (or the other way round). Its errors are kept
 * apart (`reports` in the result of `readProjectConfig`): a bad `reportsDir` stops the report
 * commands only, so every run command behaves as it did before reports existed.
 *
 * `runsPath(root)` is the one resolver of the runs folder: every reader and writer of runs asks
 * it, on every call, so a change of the setting reaches a running console without a restart.
 * Unknown keys of the file are kept when `runs-dir set` writes it.
 */
import { existsSync, readFileSync, readdirSync, realpathSync, renameSync, lstatSync, writeFileSync, unlinkSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { ensureZukaiDir, projectRoot, zukaiDir } from './glossary.mjs';

export const CONFIG_FILE = 'config.json';
export const CONFIG_VERSION = 1;
export const DEFAULT_RUNS_DIR = 'diagrams';
export const DEFAULT_REPORTS_DIR = 'reports';
const RUN_RE = /^\d{8}_[^/\\]+$/;
// Characters no folder name of the setting may hold: control characters, and those Windows
// refuses in a name, so a project committed on one system checks out on every other.
// eslint-disable-next-line no-control-regex
const BAD_CHARS = /[\u0000-\u001f\u007f\\:*?"<>|]/;

export const configPath = (root) => join(zukaiDir(root), CONFIG_FILE);

/** The error a bad setting gives: thrown by `runsPath`, printed by the CLI with exit 1. */
export class ConfigError extends Error {
  constructor(message, hint, path) {
    super(message);
    this.name = 'ConfigError';
    this.code = 'bad-config';
    this.hint = hint;
    this.path = path;
  }

  toJSON() {
    return { code: this.code, message: this.message, hint: this.hint, ...(this.path ? { path: this.path } : {}) };
  }
}

/** The real path of the deepest part of `path` that exists. */
function realOfExisting(path) {
  let at = path;
  for (;;) {
    if (existsSync(at)) return { real: realpathSync(at), rest: relative(at, path) };
    const parent = dirname(at);
    if (parent === at) return undefined;
    at = parent;
  }
}

const insideOf = (outer, inner) => inner === outer || inner.startsWith(outer.endsWith(sep) ? outer : outer + sep);

/**
 * Why a value cannot be a folder setting of the project (`runsDir`, `reportsDir`), or
 * undefined when it can: a string of folder names joined by `/` (one trailing `/` is
 * allowed), not absolute, no `.` or `..` part, not `.zukai` or `.git` nor under them, and, for
 * the part that exists, a real path inside the real project root (a link that leads out of
 * the project is refused).
 */
function checkFolder(root, value, key, example) {
  const fix = `${key} takes a folder inside the project, relative to its root, with / between its parts (for example "${example}")`;
  if (typeof value !== 'string') return { message: `${key} is not a string`, hint: fix };
  const trimmed = value.replace(/\/$/, '');
  if (trimmed === '') return { message: `${key} is empty`, hint: fix };
  if (isAbsolute(trimmed) || /^[A-Za-z]:/.test(trimmed) || trimmed.startsWith('/')) return { message: `${key} "${value}" is an absolute path`, hint: fix };
  if (BAD_CHARS.test(trimmed)) return { message: `${key} "${value}" holds a character a folder name cannot (a backslash, a colon, a control character or one of *?"<>|)`, hint: fix };
  const parts = trimmed.split('/');
  if (parts.some((p) => p === '')) return { message: `${key} "${value}" has an empty part`, hint: fix };
  if (parts.some((p) => p === '.' || p === '..')) return { message: `${key} "${value}" has a "." or ".." part`, hint: fix };
  // A Windows short name (GIT~1, ZUKAI~1) can stand for .git or .zukai on NTFS.
  if (parts.some((p) => /~\d+(\.|$)/.test(p))) return { message: `${key} "${value}" has a part that reads as a Windows short name (like GIT~1)`, hint: fix };
  const first = parts[0].toLowerCase();
  if (first === '.zukai' || first === '.git') return { message: `${key} "${value}" lies in ${parts[0]}/, which holds the project's own state`, hint: fix };
  const base = projectRoot(root);
  const realRoot = existsSync(base) ? realpathSync(base) : base;
  const found = realOfExisting(join(base, ...parts));
  if (found) {
    const real = join(found.real, found.rest);
    if (!insideOf(realRoot, real) || real === realRoot) return { message: `${key} "${value}" leads out of the project through a link`, hint: fix };
    const head = relative(realRoot, real).split(sep)[0].toLowerCase();
    if (head === '.zukai' || head === '.git') return { message: `${key} "${value}" leads into ${head}/ through a link`, hint: fix };
  }
  return undefined;
}

/** Why a value cannot be the runs folder of the project, or undefined when it can (see `checkFolder`). */
export function checkRunsDir(root, value) {
  return checkFolder(root, value, 'runsDir', 'docs/diagrams');
}

/** The parts of a folder setting as compared for overlap: lower case, since Windows and macOS ignore case. */
const partsOf = (value) => value.replace(/\/$/, '').toLowerCase().split('/');

/** Two folder settings name the same folder, or one lies inside the other. */
export function foldersOverlap(a, b) {
  const pa = partsOf(a);
  const pb = partsOf(b);
  const n = Math.min(pa.length, pb.length);
  return pa.slice(0, n).every((p, i) => p === pb[i]);
}

/**
 * Why a value cannot be the reports folder of the project, or undefined when it can: the
 * rules of `checkRunsDir`, and no overlap with the runs folder `runsDir` (the same folder, or
 * one inside the other), since a report folder and a run folder share their name pattern.
 */
export function checkReportsDir(root, value, runsDir) {
  const bad = checkFolder(root, value, 'reportsDir', 'docs/reports');
  if (bad) return bad;
  if (typeof runsDir === 'string' && foldersOverlap(value, runsDir)) {
    return { message: `reportsDir "${value}" overlaps the runs folder "${runsDir}"`, hint: 'the reports and the runs live in separate folders, neither inside the other: run reports-dir set <folder> with another folder (for example "docs/reports")' };
  }
  return undefined;
}

/**
 * The reports part of a setting: `{ ok: true, dir, from }` or `{ ok: false, error }`. A bad
 * `reportsDir` stops the report commands only; the runs keep their meaning.
 */
function reportsOf(root, config, runsDir, file) {
  const value = config.reportsDir;
  const dir = value === undefined ? DEFAULT_REPORTS_DIR : value;
  const bad = checkReportsDir(root, dir, runsDir);
  if (!bad) return { ok: true, dir: dir.replace(/\/$/, ''), from: value === undefined ? 'default' : 'config' };
  if (value === undefined) {
    return { ok: false, error: new ConfigError(`${file}: the default reports folder "${DEFAULT_REPORTS_DIR}" overlaps the runs folder "${runsDir}"`, `run reports-dir set <folder> to give the reports a folder of their own (for example "docs/reports"); the runs are not affected`, file) };
  }
  return { ok: false, error: new ConfigError(`${file}: ${bad.message}`, bad.hint, file) };
}

/**
 * The setting of a project: `{ ok: true, config, runsDir, from: "config" | "default", file,
 * reports }`, or `{ ok: false, error, reports }` with a `ConfigError` when the runs part of
 * the file cannot be used. `ok`, `error` and `runsDir` speak of the runs only, as before the
 * reports existed; `reports` is `{ ok: true, dir, from }` or `{ ok: false, error }`, so a bad
 * `reportsDir` stops the report commands and nothing else. A file that cannot be read or is
 * not a setting of this version is an error of both.
 */
export function readProjectConfig(root) {
  const file = configPath(root);
  const fixFile = `fix or delete ${file}; without it the runs live in ${DEFAULT_RUNS_DIR}/`;
  const both = (error) => ({ ok: false, error, reports: { ok: false, error } });
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return { ok: true, config: {}, runsDir: DEFAULT_RUNS_DIR, from: 'default', file, reports: reportsOf(root, {}, DEFAULT_RUNS_DIR, file) };
    return both(new ConfigError(`cannot read ${file}: ${e.code ?? 'error'}`, fixFile, file));
  }
  let config;
  try {
    config = JSON.parse(text);
  } catch {
    return both(new ConfigError(`${file} is not valid JSON`, fixFile, file));
  }
  if (config === null || typeof config !== 'object' || Array.isArray(config)) return both(new ConfigError(`${file} does not hold a JSON object`, fixFile, file));
  if (config.config !== undefined && config.config !== CONFIG_VERSION) return both(new ConfigError(`${file} has "config": ${JSON.stringify(config.config)}, which this version of Zukai does not read`, `this version reads "config": ${CONFIG_VERSION}; update Zukai, or ${fixFile}`, file));
  if (config.runsDir === undefined) return { ok: true, config, runsDir: DEFAULT_RUNS_DIR, from: 'default', file, reports: reportsOf(root, config, DEFAULT_RUNS_DIR, file) };
  const bad = checkRunsDir(root, config.runsDir);
  // Only the value is wrong: `runs-dir set` may replace it and keep the rest of the file. The
  // reports folder is still read, checked against no runs folder, since none is known.
  if (bad) return { ok: false, error: new ConfigError(`${file}: ${bad.message}`, bad.hint, file), config, reports: reportsOf(root, config, undefined, file) };
  const runsDir = config.runsDir.replace(/\/$/, '');
  return { ok: true, config, runsDir, from: 'config', file, reports: reportsOf(root, config, runsDir, file) };
}

/** The relative runs folder of a project, for messages; throws the `ConfigError`. */
export function runsDirOf(root) {
  const read = readProjectConfig(root);
  if (!read.ok) throw read.error;
  return read.runsDir;
}

/** The absolute runs folder of a project; throws the `ConfigError`. */
export function runsPath(root) {
  return join(projectRoot(root), ...runsDirOf(root).split('/'));
}

/** The relative reports folder of a project, for messages; throws the reports' `ConfigError`. */
export function reportsDirOf(root) {
  const read = readProjectConfig(root);
  if (!read.reports.ok) throw read.reports.error;
  return read.reports.dir;
}

/** The absolute reports folder of a project; throws the reports' `ConfigError`. */
export function reportsPath(root) {
  return join(projectRoot(root), ...reportsDirOf(root).split('/'));
}

/** The run folders under a runs folder: real folders named `yyyymmdd_<slug>`, newest first. */
export function runFoldersIn(dir) {
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names.filter((n) => {
    if (!RUN_RE.test(n)) return false;
    try { return lstatSync(join(dir, n)).isDirectory(); } catch { return false; }
  }).sort().reverse();
}

/** The real path of a folder, its case as the file system writes it; the path itself when it does not exist. */
function realOrSelf(path) {
  try { return realpathSync.native(path); } catch { return path; }
}

/**
 * The project a run folder belongs to: the nearest folder above it holding
 * `.zukai/config.json` whose runs folder is the run's parent (real paths compared, so a
 * spelling in another case or through a link still matches), else the folder above the parent
 * when the parent is named `diagrams` and that folder has no setting of its own, else
 * undefined. A setting above the run that cannot be used throws its `ConfigError`: which
 * project owns the run is then unknown, and a caller that guards a run must not guess.
 */
export function projectOfRun(runDir) {
  const parent = dirname(runDir);
  const realParent = realOrSelf(parent);
  let at = dirname(parent);
  for (;;) {
    if (existsSync(configPath(at))) {
      const read = readProjectConfig(at);
      if (!read.ok) throw read.error;
      if (realOrSelf(join(at, ...read.runsDir.split('/'))) === realParent) return at;
    }
    const up = dirname(at);
    if (up === at) break;
    at = up;
  }
  const grand = dirname(parent);
  return basename(parent) === DEFAULT_RUNS_DIR && !existsSync(configPath(grand)) ? grand : undefined;
}

/**
 * The project a report folder belongs to: the nearest folder above it holding
 * `.zukai/config.json` whose reports folder is the report's parent (real paths compared), else
 * the folder above the parent when the parent is named `reports` and that folder has no
 * setting of its own, else undefined. A setting above the report whose reports part cannot be
 * used throws its `ConfigError`, as `projectOfRun` does.
 */
export function projectOfReport(reportDir) {
  const parent = dirname(reportDir);
  const realParent = realOrSelf(parent);
  let at = dirname(parent);
  for (;;) {
    if (existsSync(configPath(at))) {
      const read = readProjectConfig(at);
      if (!read.reports.ok) throw read.reports.error;
      if (realOrSelf(join(at, ...read.reports.dir.split('/'))) === realParent) return at;
    }
    const up = dirname(at);
    if (up === at) break;
    at = up;
  }
  const grand = dirname(parent);
  return basename(parent) === DEFAULT_REPORTS_DIR && !existsSync(configPath(grand)) ? grand : undefined;
}

/** Write the setting through a temporary sibling and a rename: `{ ok: true, file }` or `{ ok: false, error }`. */
function writeConfig(root, next) {
  ensureZukaiDir(root);
  const file = configPath(root);
  const temp = join(dirname(file), `.${CONFIG_FILE}.${randomBytes(6).toString('hex')}.tmp`);
  try {
    writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`);
    renameSync(temp, file);
  } catch (e) {
    try { unlinkSync(temp); } catch { /* not written */ }
    return { ok: false, error: new ConfigError(`cannot write ${file}: ${e.code ?? 'error'}`, 'check that the project folder can be written', file) };
  }
  return { ok: true, file };
}

/**
 * Write `runsDir` into the project's setting, keeping every other key, through a temporary
 * sibling and a rename. Returns `{ ok: true, runsDir, previous, file, runsLeftIn? }`, where
 * `runsLeftIn` names the old folder and how many runs it holds when it holds any: they are
 * not moved. A bad value, one that overlaps the reports folder (the one set, else
 * `reports`), or an unreadable setting gives `{ ok: false, error }`.
 */
export function setRunsDir(root, value) {
  const read = readProjectConfig(root);
  // A file that cannot be read or parsed is replaced only after the user fixed or deleted it;
  // one whose only fault is its runsDir gets the new value and keeps the rest.
  if (!read.ok && read.config === undefined) return { ok: false, error: read.error };
  const bad = checkRunsDir(root, value);
  if (bad) return { ok: false, error: new ConfigError(bad.message, bad.hint, configPath(root)) };
  const reportsDir = read.config.reportsDir ?? DEFAULT_REPORTS_DIR;
  if (typeof reportsDir === 'string' && foldersOverlap(value, reportsDir)) {
    return { ok: false, error: new ConfigError(`runsDir "${value}" overlaps the reports folder "${reportsDir}"`, 'the runs and the reports live in separate folders, neither inside the other: pick another runs folder, or first give the reports another one with reports-dir set <folder>', configPath(root)) };
  }
  const runsDir = value.replace(/\/$/, '');
  const previous = read.ok ? read.runsDir : null;
  const written = writeConfig(root, { config: CONFIG_VERSION, ...read.config, runsDir });
  if (!written.ok) return written;
  const out = { ok: true, runsDir, previous, file: written.file };
  if (previous !== null && previous !== runsDir) {
    const left = runFoldersIn(join(projectRoot(root), ...previous.split('/'))).length;
    if (left > 0) out.runsLeftIn = { runsDir: previous, runs: left };
  }
  return out;
}

/**
 * Write `reportsDir` into the project's setting, keeping every other key. Returns `{ ok:
 * true, reportsDir, previous, file, foldersLeftIn? }`, where `foldersLeftIn` names the old
 * folder and how many dated folders it holds when it holds any: reports are never moved. A
 * bad value, one that overlaps the runs folder, or an unreadable setting gives `{ ok: false, error }`.
 */
export function setReportsDir(root, value) {
  const read = readProjectConfig(root);
  if (read.config === undefined) return { ok: false, error: read.error };
  // The runs folder the value must not overlap: the one in use, or the value written when it is bad.
  const runsDir = read.ok ? read.runsDir : typeof read.config.runsDir === 'string' ? read.config.runsDir : undefined;
  const bad = checkReportsDir(root, value, runsDir);
  if (bad) return { ok: false, error: new ConfigError(bad.message, bad.hint, configPath(root)) };
  const reportsDir = value.replace(/\/$/, '');
  const previous = read.reports.ok ? read.reports.dir : null;
  const written = writeConfig(root, { config: CONFIG_VERSION, ...read.config, reportsDir });
  if (!written.ok) return written;
  const out = { ok: true, reportsDir, previous, file: written.file };
  if (previous !== null && previous !== reportsDir) {
    const left = runFoldersIn(join(projectRoot(root), ...previous.split('/'))).length;
    if (left > 0) out.foldersLeftIn = { reportsDir: previous, folders: left };
  }
  return out;
}

/**
 * How a hint names a run folder: `<runs folder>/<yyyymmdd>_<run-slug>` with the project's
 * runs folder (the working directory's when no root is given), `diagrams` when it cannot be read.
 */
export function runFolderPattern(root) {
  const read = readProjectConfig(root);
  return `${read.ok ? read.runsDir : DEFAULT_RUNS_DIR}/<yyyymmdd>_<run-slug>`;
}

/** The run folder that holds a path: the path or one of its four nearest parents named `yyyymmdd_<slug>`. */
export function runDirAt(path) {
  let at = path;
  for (let up = 0; up <= 4; up++) {
    if (RUN_RE.test(basename(at))) return at;
    const parent = dirname(at);
    if (parent === at) break;
    at = parent;
  }
  return undefined;
}
