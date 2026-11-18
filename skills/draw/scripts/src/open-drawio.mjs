/**
 * `cli open`: a run's draw.io file in draw.io desktop when it is installed and a display is
 * there, else in draw.io on the web through an opener page that hands the diagram over by
 * `postMessage` (`drawio-embed.mjs`). The diagram never goes into a URL or onto a command
 * line; the opener page holds it in its own file, private to the user, for 24 hours.
 *
 * Routes, in order:
 *   1. a cloud session is refused: a browser on the user's device cannot reach its machine;
 *   2. Linux without DISPLAY or WAYLAND_DISPLAY is refused: no window could be shown (draw.io
 *      desktop would run under xvfb-run, invisibly, and a browser could not show either);
 *   3. draw.io desktop, when found (unless --web);
 *   4. the opener page in the default browser (`open`, `xdg-open`, Windows' `explorer.exe`, or
 *      the executable ZUKAI_OPENER names, which tests use).
 */
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { accessSync, constants, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, delimiter, extname, isAbsolute, join, resolve } from 'node:path';
import { findDrawioBinary, drawioMissing } from './preview.mjs';
import { drawioPages } from './export-svg.mjs';
import { drawioXmlOf } from './extract-drawio.mjs';
import { embedHostOf, openerPage } from './drawio-embed.mjs';
import { runFolderPattern } from './project-config.mjs';

/** How long an opener page is kept: long enough to reopen it, short enough not to pile up. */
export const PAGE_TTL_MS = 24 * 60 * 60_000;
const RUN_FOLDER = /^\d{8}_(.+)$/;

const refuse = (code, message, hint) => ({ ok: false, code, message, ...(hint ? { hint } : {}) });

/**
 * The draw.io file a target stands for. A run folder stands for its combined
 * `<run-slug>.drawio`, else its only `drawio/*.drawio`; a `.drawio.svg` stands for the diagram
 * it holds. Mermaid text and a FigJam-only run are refused with `not-supported`.
 * @returns {{ ok: true, file: string, title: string, xml: string } | { ok: false, code: string, message: string, hint?: string }}
 */
export function resolveDrawio(target) {
  const path = resolve(target);
  const st = statSync(path, { throwIfNoEntry: false });
  if (!st) return refuse('not-found', `${target} does not exist`, `give a run folder (${runFolderPattern()}), a .drawio file or a .drawio.svg file`);
  if (st.isDirectory()) return resolveRun(path);
  return resolveFile(path);
}

function resolveRun(dir) {
  const slug = RUN_FOLDER.exec(basename(dir))?.[1] ?? basename(dir);
  const combined = join(dir, `${slug}.drawio`);
  if (existsSync(combined)) return resolveFile(combined);
  const each = listFiles(join(dir, 'drawio')).filter((n) => n.endsWith('.drawio'));
  if (each.length === 1) return resolveFile(join(dir, 'drawio', each[0]));
  if (each.length > 1) return refuse('bad-request', `this run has no ${slug}.drawio and ${each.length} files under drawio/: ${each.join(', ')}`, 'name the one to open: cli open <run-folder>/drawio/<name>.drawio');
  if (existsSync(join(dir, `${slug}.md`)) || listFiles(join(dir, 'mermaid')).length > 0) {
    return refuse('not-supported', 'this run is Mermaid text, which cannot be opened in draw.io yet', 'preview <run-folder>/<run-slug>.md draws it; to edit it in draw.io, draw the run again with the drawio target');
  }
  if (listFiles(join(dir, 'figjam')).length > 0) {
    return refuse('not-supported', 'this run is a FigJam board, which lives in Figma, not in a file', "the board's link is in the run's report");
  }
  return refuse('not-found', `${dir} holds no draw.io file (no ${slug}.drawio, nothing under drawio/)`, 'give a run folder written with the drawio target, or the .drawio file itself');
}

function resolveFile(file) {
  const name = basename(file);
  if (/\.(mmd|md)$/i.test(name)) return refuse('not-supported', `${name} is Mermaid text, which cannot be opened in draw.io yet`, 'preview draws it');
  const svg = /\.drawio\.svg$/i.test(name);
  if (!svg && extname(name).toLowerCase() !== '.drawio') return refuse('bad-request', `${name} is not a draw.io file`, 'open takes a run folder, a .drawio file or a .drawio.svg file');
  let buf;
  try {
    buf = readFileSync(file);
  } catch (e) {
    return refuse('not-found', `${file} cannot be read: ${e.code ?? 'error'}`);
  }
  const read = drawioXmlOf(buf);
  if (read.error) return refuse('bad-request', `${name}: ${read.error}`);
  const pages = drawioPages(read.xml);
  if (pages.error) return refuse('bad-request', `${name}: ${pages.error}`);
  // Save on the web downloads what was edited under this name: plain draw.io XML, so a
  // picture is saved as the .drawio file it holds.
  return { ok: true, file, title: svg ? name.replace(/\.svg$/i, '') : name, xml: read.xml };
}

const listFiles = (dir) => {
  try {
    return readdirSync(dir).filter((n) => statSync(join(dir, n)).isFile()).sort();
  } catch {
    return [];
  }
};

/** The executable `name` on PATH, or a path that exists; null when neither. */
function findExecutable(name, env) {
  if (isAbsolute(name) || name.includes('/') || name.includes('\\')) return existsSync(name) ? name : null;
  for (const dir of (env.PATH ?? '').split(delimiter)) {
    if (!dir) continue;
    for (const ext of process.platform === 'win32' ? ['', '.exe', '.cmd', '.bat'] : ['']) {
      try {
        accessSync(join(dir, name + ext), constants.X_OK);
        return join(dir, name + ext);
      } catch {
        // not here
      }
    }
  }
  return null;
}

/**
 * The command that opens a file in the default browser, as an argument list (never a shell
 * string), or null when this machine has none.
 * @returns {{ cmd: string, args: (page: string) => string[] } | null}
 */
export function browserOpener(platform = process.platform, env = process.env) {
  if (env.ZUKAI_OPENER) {
    const cmd = findExecutable(env.ZUKAI_OPENER, env);
    return cmd ? { cmd, args: (page) => [page] } : null;
  }
  if (platform === 'darwin') return { cmd: '/usr/bin/open', args: (page) => [page] };
  // explorer.exe by its full path opens a file with its default program and parses no shell
  // syntax: `cmd /c start` would read & ^ % in a user name of the temp path, and a bare name
  // is looked up in the working directory before PATH.
  if (platform === 'win32') return { cmd: `${env.SystemRoot ?? 'C:\\Windows'}\\explorer.exe`, args: (page) => [page] };
  const cmd = findExecutable('xdg-open', env);
  return cmd ? { cmd, args: (page) => [page] } : null;
}

const hasDisplay = (platform, env) => platform !== 'linux' || Boolean(env.DISPLAY || env.WAYLAND_DISPLAY);

/**
 * Which route opens the file here, without opening anything: draw.io desktop (found by its
 * `--version` probe), the web, or a refusal.
 * @returns {{ ok: true, via: 'desktop', bin: string } | { ok: true, via: 'web', opener: object } | { ok: false, code: string, message: string, hint?: string }}
 */
export function chooseRoute({ web = false, desktop = false, platform = process.platform, env = process.env, find = findDrawioBinary } = {}) {
  if (env.CLAUDE_CODE_REMOTE === 'true') {
    return refuse('cloud-session', 'this session runs on a cloud machine: neither draw.io desktop nor a browser on your device can be opened from here', "open the run's .drawio file on your own computer, or run the skill in a session there");
  }
  if (!hasDisplay(platform, env)) {
    return refuse('no-display', 'this machine has no display (no DISPLAY or WAYLAND_DISPLAY is set), so no draw.io window could be shown', "open the run's .drawio file on a computer with a screen");
  }
  if (!web) {
    const found = find();
    if (found.bin) return { ok: true, via: 'desktop', bin: found.bin };
    if (desktop) return refuse('not-found', drawioMissing(found), 'install draw.io desktop, or leave out --desktop to open draw.io on the web');
  }
  const opener = browserOpener(platform, env);
  if (!opener) return refuse('no-browser', env.ZUKAI_OPENER ? `the opener ZUKAI_OPENER names was not found: ${env.ZUKAI_OPENER}` : 'no program to open a browser was found (xdg-open is not on PATH)', "open the run's .drawio file in draw.io by hand");
  return { ok: true, via: 'web', opener };
}

/**
 * The private folder of the opener pages, created 0700 and checked to be this user's own
 * folder (not a link, not someone else's) before a diagram is written into it.
 */
export function pagesFolder(base = tmpdir()) {
  const dir = join(base, 'zukai-open');
  const notPrivate = refuse('bad-request', `${dir} is not a private folder of this user`, `remove ${dir} and run open again`);
  let st;
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    st = lstatSync(dir);
  } catch (e) {
    // A file or a dangling link in its place, or no right to create it.
    return e.code === 'EEXIST' || e.code === 'ENOENT' ? notPrivate : refuse('bad-request', `${dir} cannot be created: ${e.code ?? e.message}`);
  }
  const mine = typeof process.getuid !== 'function' || st.uid === process.getuid();
  if (!st.isDirectory() || st.isSymbolicLink() || !mine) return notPrivate;
  if (process.platform !== 'win32' && (st.mode & 0o077) !== 0) chmodSync(dir, 0o700);
  return { ok: true, dir };
}

/** Remove the opener pages older than `ttl`; returns how many went. */
export function removeOldPages(dir, now = Date.now(), ttl = PAGE_TTL_MS) {
  let removed = 0;
  for (const name of listFiles(dir)) {
    if (!name.endsWith('.html')) continue;
    try {
      if (now - statSync(join(dir, name)).mtimeMs > ttl) {
        rmSync(join(dir, name), { force: true });
        removed += 1;
      }
    } catch {
      // gone meanwhile
    }
  }
  return removed;
}

const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('base64');

/** Write the opener page of a resolved file into the private folder (mode 0600). */
export function writeOpenerPage(resolved, { env = process.env, base } = {}) {
  const folder = pagesFolder(base);
  if (!folder.ok) return folder;
  removeOldPages(folder.dir);
  const stem = resolved.title.replace(/\.drawio$/i, '').replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 60) || 'diagram';
  const page = join(folder.dir, `${stem}-${randomBytes(6).toString('hex')}.html`);
  try {
    writeFileSync(page, openerPage({ host: embedHostOf(env), xml: resolved.xml, title: resolved.title, sha256 }), { mode: 0o600, flag: 'wx' });
  } catch (e) {
    return refuse('bad-request', `the opener page could not be written into ${folder.dir}: ${e.code ?? e.message}`);
  }
  return { ok: true, page };
}

/** Start a program detached, with an argument list; resolves once it started or failed to. */
function launch(cmd, args) {
  return new Promise((done) => {
    let child;
    try {
      child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true });
    } catch (error) {
      done({ ok: false, error });
      return;
    }
    child.once('error', (error) => done({ ok: false, error }));
    child.once('spawn', () => {
      child.unref();
      done({ ok: true });
    });
  });
}

/**
 * `open --check`: whether and how the target can be opened here. Writes nothing and starts
 * nothing but draw.io desktop's `--version` probe.
 */
export function checkOpen(target, options = {}) {
  const resolved = resolveDrawio(target);
  if (!resolved.ok) return { ok: true, can: false, via: null, reason: resolved.code, message: resolved.message, ...(resolved.hint ? { hint: resolved.hint } : {}) };
  const route = chooseRoute(options);
  if (!route.ok) return { ok: true, can: false, via: null, reason: route.code, message: route.message, ...(route.hint ? { hint: route.hint } : {}), file: resolved.file };
  return { ok: true, can: true, via: route.via, file: resolved.file };
}

/**
 * `open`: open the target in draw.io desktop or on the web.
 * @returns {Promise<{ ok: true, opened: 'desktop' | 'web', file: string, page?: string } | { ok: false, code: string, message: string, hint?: string }>}
 */
export async function openDrawio(target, { web = false, desktop = false, platform = process.platform, env = process.env, find = findDrawioBinary, base = tmpdir() } = {}) {
  // Every open, by either route, removes the pages that are older than a day.
  if (existsSync(join(base, 'zukai-open'))) {
    const folder = pagesFolder(base);
    if (folder.ok) removeOldPages(folder.dir);
  }
  const resolved = resolveDrawio(target);
  if (!resolved.ok) return resolved;
  const route = chooseRoute({ web, desktop, platform, env, find });
  if (!route.ok) return route;
  if (route.via === 'desktop') {
    // No xvfb-run and none of the flags of a headless export (--no-sandbox above all): a
    // display is there, and this is the window the user edits in.
    const started = await launch(route.bin, [resolved.file]);
    if (started.ok) return { ok: true, opened: 'desktop', file: resolved.file };
    return refuse('not-found', `draw.io desktop did not start: ${started.error.code ?? started.error.message}`, '--web opens draw.io on the web instead');
  }
  return openOnWeb(resolved, route.opener, env, base);
}

async function openOnWeb(resolved, opener, env, base) {
  const written = writeOpenerPage(resolved, { env, base });
  if (!written.ok) return written;
  const started = await launch(opener.cmd, opener.args(written.page));
  if (!started.ok) {
    rmSync(written.page, { force: true });
    return refuse('no-browser', `the browser could not be opened (${opener.cmd}: ${started.error.code ?? started.error.message})`, `open ${resolved.file} in draw.io by hand`);
  }
  return { ok: true, opened: 'web', file: resolved.file, page: written.page };
}
