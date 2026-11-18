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
 * Why a value cannot be the runs folder of the project, or undefined when it can: a string of
 * folder names joined by `/` (one trailing `/` is allowed), not absolute, no `.` or `..` part,
 * not `.zukai` or `.git` nor under them, and, for the part that exists, a real path inside the
 * real project root (a link that leads out of the project is refused).
 */
export function checkRunsDir(root, value) {
  const fix = 'runsDir takes a folder inside the project, relative to its root, with / between its parts (for example "docs/diagrams")';
  if (typeof value !== 'string') return { message: 'runsDir is not a string', hint: fix };
  const trimmed = value.replace(/\/$/, '');
  if (trimmed === '') return { message: 'runsDir is empty', hint: fix };
  if (isAbsolute(trimmed) || /^[A-Za-z]:/.test(trimmed) || trimmed.startsWith('/')) return { message: `runsDir "${value}" is an absolute path`, hint: fix };
  if (BAD_CHARS.test(trimmed)) return { message: `runsDir "${value}" holds a character a folder name cannot (a backslash, a colon, a control character or one of *?"<>|)`, hint: fix };
  const parts = trimmed.split('/');
  if (parts.some((p) => p === '')) return { message: `runsDir "${value}" has an empty part`, hint: fix };
  if (parts.some((p) => p === '.' || p === '..')) return { message: `runsDir "${value}" has a "." or ".." part`, hint: fix };
  const first = parts[0].toLowerCase();
  if (first === '.zukai' || first === '.git') return { message: `runsDir "${value}" lies in ${parts[0]}/, which holds the project's own state`, hint: fix };
  const base = projectRoot(root);
  const realRoot = existsSync(base) ? realpathSync(base) : base;
  const found = realOfExisting(join(base, ...parts));
  if (found) {
    const real = join(found.real, found.rest);
    if (!insideOf(realRoot, real) || real === realRoot) return { message: `runsDir "${value}" leads out of the project through a link`, hint: fix };
    const head = relative(realRoot, real).split(sep)[0].toLowerCase();
    if (head === '.zukai' || head === '.git') return { message: `runsDir "${value}" leads into ${head}/ through a link`, hint: fix };
  }
  return undefined;
}

/**
 * The setting of a project: `{ ok: true, config, runsDir, from: "config" | "default" }`, or
 * `{ ok: false, error }` with a `ConfigError` when the file cannot be used.
 */
export function readProjectConfig(root) {
  const file = configPath(root);
  const fixFile = `fix or delete ${file}; without it the runs live in ${DEFAULT_RUNS_DIR}/`;
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return { ok: true, config: {}, runsDir: DEFAULT_RUNS_DIR, from: 'default', file };
    return { ok: false, error: new ConfigError(`cannot read ${file}: ${e.code ?? 'error'}`, fixFile, file) };
  }
  let config;
  try {
    config = JSON.parse(text);
  } catch {
    return { ok: false, error: new ConfigError(`${file} is not valid JSON`, fixFile, file) };
  }
  if (config === null || typeof config !== 'object' || Array.isArray(config)) return { ok: false, error: new ConfigError(`${file} does not hold a JSON object`, fixFile, file) };
  if (config.config !== undefined && config.config !== CONFIG_VERSION) return { ok: false, error: new ConfigError(`${file} has "config": ${JSON.stringify(config.config)}, which this version of Zukai does not read`, `this version reads "config": ${CONFIG_VERSION}; update Zukai, or ${fixFile}`, file) };
  if (config.runsDir === undefined) return { ok: true, config, runsDir: DEFAULT_RUNS_DIR, from: 'default', file };
  const bad = checkRunsDir(root, config.runsDir);
  // Only the value is wrong: `runs-dir set` may replace it and keep the rest of the file.
  if (bad) return { ok: false, error: new ConfigError(`${file}: ${bad.message}`, bad.hint, file), config };
  return { ok: true, config, runsDir: config.runsDir.replace(/\/$/, ''), from: 'config', file };
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

/**
 * The project a run folder belongs to: the nearest folder above it holding
 * `.zukai/config.json` whose runs folder is the run's parent, else the folder above the
 * parent when the parent is named `diagrams` (the default), else undefined.
 */
export function projectOfRun(runDir) {
  const parent = dirname(runDir);
  let at = dirname(parent);
  for (;;) {
    if (existsSync(configPath(at))) {
      try {
        if (runsPath(at) === parent) return at;
      } catch {
        // a project with a bad setting owns no run until the setting is fixed
      }
    }
    const up = dirname(at);
    if (up === at) break;
    at = up;
  }
  return basename(parent) === DEFAULT_RUNS_DIR ? dirname(parent) : undefined;
}

/**
 * Write `runsDir` into the project's setting, keeping every other key, through a temporary
 * sibling and a rename. Returns `{ ok: true, runsDir, previous, file, runsLeftIn? }`, where
 * `runsLeftIn` names the old folder and how many runs it holds when it holds any: they are
 * not moved. A bad value or an unreadable setting gives `{ ok: false, error }`.
 */
export function setRunsDir(root, value) {
  const read = readProjectConfig(root);
  // A file that cannot be read or parsed is replaced only after the user fixed or deleted it;
  // one whose only fault is its runsDir gets the new value and keeps the rest.
  if (!read.ok && read.config === undefined) return { ok: false, error: read.error };
  const bad = checkRunsDir(root, value);
  if (bad) return { ok: false, error: new ConfigError(bad.message, bad.hint, configPath(root)) };
  const runsDir = value.replace(/\/$/, '');
  const previous = read.ok ? read.runsDir : null;
  const next = { config: CONFIG_VERSION, ...read.config, runsDir };
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
  const out = { ok: true, runsDir, previous, file };
  if (previous !== null && previous !== runsDir) {
    const left = runFoldersIn(join(projectRoot(root), ...previous.split('/'))).length;
    if (left > 0) out.runsLeftIn = { runsDir: previous, runs: left };
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
