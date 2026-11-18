/**
 * The life of the labs server of one project: one server per project root, on a port that is
 * the same every time, started as a detached child that ends itself when idle or on
 * `labs stop`.
 *
 *   <root>/.zukai/labs/server.json   pid, port, instance, version, startedAt, token (mode 0600)
 *   <root>/.zukai/labs/server.log    one line per request, capped at 1 MB
 *
 * A start never takes the next port when the port is busy, and never deletes `server.json`
 * unless nobody listens on its port and the file still names the same instance; a server
 * that is slow to answer keeps it. The token is sent only to a server that proved it holds
 * the same token (`proveServer`), so a program that took the port gets nothing.
 */
import { spawn } from 'node:child_process';
import { chmodSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pkg from '../package.json' with { type: 'json' };
import { projectRoot, ensureZukaiDir } from './glossary.mjs';
import { createLabsServer, loadPages, makeLogger, errorFacts } from './labs-server.mjs';
import { runNames } from './labs-runs.mjs';
import { request, probePort, proveServer, waitPortClosed } from './labs-client.mjs';

export const VERSION = pkg.version;
const PORT_BASE = 4700;
const PORT_SPAN = 200;

export const labsDir = (root) => join(projectRoot(root), '.zukai', 'labs');
export const serverFile = (root) => join(labsDir(root), 'server.json');
export const logFile = (root) => join(labsDir(root), 'server.log');

/** The port of a project: 4700 plus the first four bytes of the SHA-256 of the root's real path, modulo 200. */
export function portFor(root) {
  let real = projectRoot(root);
  try { real = realpathSync(real); } catch { /* not there yet */ }
  return PORT_BASE + (createHash('sha256').update(real).digest().readUInt32BE(0) % PORT_SPAN);
}

/** The port to use: `--port`, else `ZUKAI_LABS_PORT`, else the project's own. */
export function chosenPort(root, port) {
  const value = port ?? process.env.ZUKAI_LABS_PORT;
  if (value === undefined || value === '') return { port: portFor(root) };
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1024 || n > 65535) return { error: `the port must be a whole number from 1024 to 65535, not "${value}"` };
  return { port: n };
}

export function readServerFile(root) {
  try {
    const data = JSON.parse(readFileSync(serverFile(root), 'utf8'));
    return data && typeof data === 'object' && Number.isInteger(data.port) && typeof data.token === 'string' ? data : undefined;
  } catch {
    return undefined;
  }
}

function writeServerFile(root, data) {
  const file = serverFile(root);
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  try { chmodSync(tmp, 0o600); } catch { /* Windows keeps the profile's rules */ }
  renameSync(tmp, file);
}

/** Remove `server.json` only when it still names the given instance. */
function removeServerFile(root, instance) {
  const now = readServerFile(root);
  if (now && now.instance === instance) {
    try { unlinkSync(serverFile(root)); } catch { /* gone */ }
  }
}

export const consoleUrl = (port, token) => `http://127.0.0.1:${port}/#t=${token}`;

const ownerHint = (port) => ({
  hint: `another program answers on port ${port}. See which with ${process.platform === 'win32' ? `netstat -ano | findstr :${port}` : `lsof -i :${port}`}, or choose another port with --port <n> (ZUKAI_LABS_PORT makes the choice lasting)`,
});

/** What `start` and `status` print about a server that proved itself. */
function described(root, file, health, extra = {}) {
  return { ok: true, running: true, url: consoleUrl(file.port, file.token), port: file.port, pid: file.pid, version: health.version, root: projectRoot(root), runs: runNames(root).length, jobOpen: health.jobOpen === true, ...extra };
}

/** True in a cloud session, whose machine a browser on the user's device cannot reach. */
export const isCloudSession = (env = process.env) => env.CLAUDE_CODE_REMOTE === 'true';

/** The file the CLI runs from, for the child: the bundle, or `src/cli.mjs` in development. */
const cliEntry = () => process.argv[1];

/**
 * Start the server of a project, or reuse the one that runs.
 * @returns {Promise<{ code: number, out?: object, error?: object }>}
 */
export async function startServer({ root: rootOption, port: portOption, idleMinutes, skipCloudCheck = false, env = process.env, onStarted } = {}) {
  const root = projectRoot(rootOption);
  if (isCloudSession(env) && !skipCloudCheck) {
    return { code: 1, error: { code: 'cloud-session', message: 'this session runs on a cloud machine: a browser on your device cannot reach a server started here', hint: 'run /zukai:labs in a session on your own computer; --skip-cloud-check starts it anyway, for a browser on the same machine' } };
  }
  const chosen = chosenPort(root, portOption);
  if (chosen.error) return { code: 1, error: { code: 'bad-request', message: chosen.error } };
  const idle = idleMinutes === undefined ? 30 : Number(idleMinutes);
  if (!(Number.isFinite(idle) && idle > 0)) return { code: 1, error: { code: 'bad-request', message: '--idle-minutes takes a number of minutes above 0' } };
  const ssh = env.SSH_CONNECTION ? { note: 'this session runs over SSH: forward the port to open the console on your computer, for example ssh -L <port>:127.0.0.1:<port>' } : {};

  const file = readServerFile(root);
  if (file) {
    const state = await probePort(file.port);
    if (state === 'refused') {
      const again = readServerFile(root);
      if (again && again.instance === file.instance) removeServerFile(root, file.instance);
    } else {
      const proof = await proveServer(file.port, file.token);
      if (proof.state === 'proved') {
        if (proof.health.version === VERSION || proof.health.jobOpen) {
          const later = proof.health.version !== VERSION ? { note: `the running server is version ${proof.health.version}; version ${VERSION} starts once its open job is closed` } : {};
          return { code: 0, out: described(root, file, proof.health, { reused: true, ...ssh, ...later }) };
        }
        await request(file.port, { method: 'POST', path: '/agent/shutdown', token: file.token, timeout: 5000 }).catch(() => {});
        await waitPortClosed(file.port);
      } else if (proof.state !== 'refused') {
        return { code: 1, error: { code: 'not-this-project', message: proof.state === 'timeout' ? `the server on port ${file.port} did not answer in time` : `the program on port ${file.port} is not this project's console`, ...ownerHint(file.port) } };
      }
    }
  }
  const port = readServerFile(root)?.port ?? chosen.port;
  if ((await probePort(port)) === 'open') {
    return { code: 1, error: { code: 'not-this-project', message: `port ${port} is taken by another program`, ...ownerHint(port) } };
  }
  ensureZukaiDir(root);
  const child = spawn(process.execPath, [cliEntry(), 'labs', 'serve', '--root', root, '--port', String(port), '--idle-minutes', String(idle)], { detached: true, stdio: 'ignore', windowsHide: true, env: { ...env } });
  child.unref();
  onStarted?.(child.pid);
  const until = Date.now() + 5000;
  while (Date.now() < until) {
    const now = readServerFile(root);
    if (now) {
      const proof = await proveServer(now.port, now.token, { within: Math.max(500, until - Date.now()) });
      if (proof.state === 'proved') return { code: 0, out: described(root, now, proof.health, { reused: now.pid !== child.pid, ...ssh }) };
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return { code: 1, error: { code: 'not-this-project', message: `no server answered on port ${port} within five seconds`, ...ownerHint(port) } };
}

/** The state of the project's server. */
export async function serverStatus({ root: rootOption } = {}) {
  const root = projectRoot(rootOption);
  const file = readServerFile(root);
  if (!file) return { code: 0, out: { ok: true, running: false, root, runs: runNames(root).length } };
  const proof = await proveServer(file.port, file.token);
  if (proof.state === 'refused') return { code: 0, out: { ok: true, running: false, root, runs: runNames(root).length, note: 'server.json names a server that no longer runs; labs start replaces it' } };
  if (proof.state !== 'proved') return { code: 1, error: { code: 'not-this-project', message: `the program on port ${file.port} did not prove it is this project's console`, ...ownerHint(file.port) } };
  return { code: 0, out: described(root, file, proof.health) };
}

/** Stop the project's server: refused while a job is open, unless forced. */
export async function stopServer({ root: rootOption, force = false } = {}) {
  const root = projectRoot(rootOption);
  const file = readServerFile(root);
  if (!file) return { code: 0, out: { ok: true, running: false, stopped: false, root } };
  const proof = await proveServer(file.port, file.token);
  if (proof.state === 'refused') {
    removeServerFile(root, file.instance);
    return { code: 0, out: { ok: true, running: false, stopped: false, root } };
  }
  if (proof.state !== 'proved') return { code: 1, error: { code: 'not-this-project', message: `the program on port ${file.port} did not prove it is this project's console`, ...ownerHint(file.port) } };
  if (proof.health.jobOpen && !force) return { code: 1, error: { code: 'job-open', message: 'a job is open: stopping now ends it as failed', hint: 'wait for the job, or pass --force' } };
  try {
    await request(file.port, { method: 'POST', path: '/agent/shutdown', token: file.token, timeout: 5000 });
  } catch (e) {
    return { code: 1, error: { code: 'transport', message: `the server did not take the request to stop (${e.code ?? 'error'})` } };
  }
  const closed = await waitPortClosed(file.port);
  if (!closed) return { code: 1, error: { code: 'transport', message: `the server on port ${file.port} is still listening five seconds after it was asked to stop`, hint: `stop process ${file.pid} by hand` } };
  return { code: 0, out: { ok: true, running: false, stopped: true, pid: file.pid, root } };
}

/** Where the built pages are: beside the bundle, or the built folder when run from `src/`. */
export function defaultPagesDir() {
  const here = dirname(fileURLToPath(import.meta.url));
  return dirname(here).endsWith('scripts') && here.endsWith('src') ? join(dirname(here), 'bin', 'labs-ui') : join(here, 'labs-ui');
}

/**
 * Run the server in this process (`labs serve`, what `start` runs as a child). Binds the
 * port first; only then makes the token, reads the pages into memory and writes
 * `server.json`. Ends on `POST /agent/shutdown`, on SIGTERM and when idle.
 */
export async function serve({ root: rootOption, port: portOption, idleMinutes, pagesDir, env = process.env, makeJobs } = {}) {
  const root = projectRoot(rootOption);
  const chosen = chosenPort(root, portOption);
  if (chosen.error) return 1;
  const idleMs = env.ZUKAI_LABS_IDLE_MS ? Number(env.ZUKAI_LABS_IDLE_MS) : (idleMinutes === undefined ? 30 : Number(idleMinutes)) * 60_000;
  const log = makeLogger(logFile(root));
  const instance = randomBytes(8).toString('hex');
  let token;
  let closing = false;
  const jobs = makeJobs?.({ root, log });
  const labs = createLabsServer({ root, token: () => token, pages: loadPages(pagesDir ?? defaultPagesDir()), version: VERSION, instance, log, idleMs, jobs, onShutdown: () => shutdown('requested') });

  const shutdown = (reason) => {
    if (closing) return;
    closing = true;
    log({ event: 'shutdown', reason });
    labs.beginClose();
    removeServerFile(root, instance);
    labs.server.close(() => process.exit(0));
    labs.server.closeAllConnections?.();
    setTimeout(() => process.exit(0), 2000).unref();
  };

  process.on('uncaughtException', (e) => { log({ route: 'process', error: errorFacts(e) }); });
  process.on('unhandledRejection', (e) => { log({ route: 'process', error: errorFacts(e) }); });

  const bound = await new Promise((done) => {
    labs.server.once('error', (e) => done(e.code ?? 'error'));
    labs.server.listen(chosen.port, '127.0.0.1', () => done(true));
  });
  if (bound !== true) {
    log({ event: 'bind-failed', code: String(bound), port: chosen.port });
    return 1;
  }
  token = randomBytes(32).toString('base64url');
  jobs?.started?.();
  writeServerFile(root, { pid: process.pid, port: chosen.port, instance, version: VERSION, startedAt: new Date().toISOString(), token, root });
  log({ event: 'started', port: chosen.port, version: VERSION });
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => shutdown(signal));
  const every = Math.max(50, Math.min(60_000, Math.floor(idleMs / 4)));
  setInterval(() => { if (labs.isIdle()) shutdown('idle'); }, every);
  return new Promise(() => {});
}

