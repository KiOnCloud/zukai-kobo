/**
 * The life of the labs server through the committed bundle, from another working directory:
 * one server per project, a reused second start, status and stop, a stale server.json, a
 * server that answers late, another program on the port, two starts at once, the idle end,
 * the cloud refusal and pages that outlive their folder. Runs on Windows too.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scriptsDir } from './helpers.mjs';
import { labsProject } from './labs-project.mjs';

const cliPath = join(scriptsDir, 'bin', 'cli.mjs');
const elsewhere = mkdtempSync(join(tmpdir(), 'zukai-labs-cwd-'));
const baseEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'CLAUDE_CODE_REMOTE' && !k.startsWith('ZUKAI_LABS_')));
const parse = (text) => text.trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return l; } }).at(-1);
const cli = (args, { env = {}, cli: entry = cliPath } = {}) => {
  const r = spawnSync(process.execPath, [entry, ...args], { cwd: elsewhere, encoding: 'utf8', env: { ...baseEnv, ...env }, timeout: 30_000 });
  return { code: r.status, out: parse(r.stdout), err: parse(r.stderr) };
};
/** The CLI without blocking this process, for a stand-in server that lives in it. */
const cliAsync = (args) => new Promise((done) => {
  const child = spawn(process.execPath, [cliPath, ...args], { cwd: elsewhere, env: baseEnv });
  let out = '';
  let err = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });
  child.on('close', (code) => done({ code, out: parse(out), err: parse(err) }));
});
const freePort = () => new Promise((done) => {
  const s = createNetServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => done(port)); });
});
const serverJson = (root) => join(root, '.zukai', 'labs', 'server.json');
const readServer = (root) => JSON.parse(readFileSync(serverJson(root), 'utf8'));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const waitFor = async (test, ms) => { const until = Date.now() + ms; while (Date.now() < until) { if (await test()) return true; await new Promise((r) => setTimeout(r, 100)); } return false; };

const started = [];
const start = (root, port, extra = [], opts = {}) => {
  const r = cli(['labs', 'start', '--root', root, '--port', String(port), ...extra], opts);
  if (r.code === 0) started.push({ root, entry: opts.cli });
  return r;
};
afterAll(async () => {
  for (const s of started) cli(['labs', 'stop', '--root', s.root, '--force'], { cli: s.entry ?? cliPath });
});

describe('labs start, status and stop through the bundle', () => {
  it('starts one server per project, reuses it, reports it and stops it', async () => {
    const { root } = labsProject();
    const port = await freePort();
    const first = start(root, port);
    expect(first.code).toBe(0);
    expect(first.out).toMatchObject({ ok: true, running: true, reused: false, port, runs: 4, jobOpen: false });
    expect(first.out.url).toMatch(new RegExp(`^http://127\\.0\\.0\\.1:${port}/#t=[A-Za-z0-9_-]{43}$`));
    const again = start(root, port);
    expect(again.out).toMatchObject({ reused: true, pid: first.out.pid, url: first.out.url });
    expect(cli(['labs', 'status', '--root', root]).out).toMatchObject({ running: true, pid: first.out.pid });
    if (process.platform !== 'win32') expect(readServer(root)).toMatchObject({ pid: first.out.pid, port });
    const stopped = cli(['labs', 'stop', '--root', root]);
    expect(stopped.out).toMatchObject({ ok: true, stopped: true, pid: first.out.pid });
    expect(existsSync(serverJson(root))).toBe(false);
    expect(await waitFor(() => !alive(first.out.pid), 5000)).toBe(true);
    expect(cli(['labs', 'status', '--root', root]).out).toMatchObject({ running: false });
  }, 30_000);

  it('replaces a server.json whose port nobody listens on', async () => {
    const { root } = labsProject();
    const port = await freePort();
    mkdirSync(join(root, '.zukai', 'labs'), { recursive: true });
    writeFileSync(serverJson(root), JSON.stringify({ pid: 999999, port, instance: 'old', version: '0', token: 'old-token' }));
    const r = start(root, port);
    expect(r.code).toBe(0);
    expect(readServer(root).instance).not.toBe('old');
  }, 30_000);

  it('keeps a server.json whose server answers late, and starts nothing', async () => {
    const { root } = labsProject();
    const sockets = [];
    const slow = createNetServer((s) => sockets.push(s));
    await new Promise((r) => slow.listen(0, '127.0.0.1', r));
    const port = slow.address().port;
    mkdirSync(join(root, '.zukai', 'labs'), { recursive: true });
    const file = JSON.stringify({ pid: 1, port, instance: 'slow', version: '0', token: 'slow-token' });
    writeFileSync(serverJson(root), file);
    const r = await cliAsync(['labs', 'start', '--root', root, '--port', String(port)]);
    expect(r.code).toBe(1);
    expect(r.err.error).toMatchObject({ code: 'not-this-project' });
    expect(r.err.error.message).toContain('did not answer in time');
    expect(r.err.error.message).toContain(String(port));
    await new Promise((res) => setTimeout(res, 500));
    expect(readFileSync(serverJson(root), 'utf8')).toBe(file);
    for (const s of sockets) s.destroy();
    slow.close();
  }, 30_000);

  it('sends no token to another program on the port, with or without a server.json', async () => {
    const { root } = labsProject();
    const seen = [];
    const impostor = createHttpServer((req, res) => {
      seen.push({ url: req.url, headers: req.headers });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ app: 'zukai-labs', version: '9', jobOpen: false, proof: 'not-a-proof' }));
    });
    await new Promise((r) => impostor.listen(0, '127.0.0.1', r));
    const port = impostor.address().port;
    const none = await cliAsync(['labs', 'start', '--root', root, '--port', String(port)]);
    expect(none.code).toBe(1);
    expect(none.err.error.hint).toContain('--port');
    mkdirSync(join(root, '.zukai', 'labs'), { recursive: true });
    writeFileSync(serverJson(root), JSON.stringify({ pid: 1, port, instance: 'x', version: '0', token: 'the-real-token' }));
    const withFile = await cliAsync(['labs', 'start', '--root', root, '--port', String(port)]);
    expect(withFile.code).toBe(1);
    expect(withFile.err.error.message).toContain('is not this project');
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((s) => s.headers['x-zukai-token'] === undefined && !JSON.stringify(s).includes('the-real-token'))).toBe(true);
    expect(existsSync(serverJson(root))).toBe(true);
    impostor.close();
  }, 30_000);

  it('gives two starts at once the one server that bound the port', async () => {
    const { root } = labsProject();
    const port = await freePort();
    const [a, b] = await Promise.all([cliAsync(['labs', 'start', '--root', root, '--port', String(port)]), cliAsync(['labs', 'start', '--root', root, '--port', String(port)])]);
    started.push({ root });
    expect([a.code, b.code]).toEqual([0, 0]);
    expect(a.out.pid).toBe(b.out.pid);
    expect(a.out.url).toBe(b.out.url);
  }, 30_000);

  it('ends itself when idle, closing the port and removing server.json', async () => {
    const { root } = labsProject();
    const port = await freePort();
    const r = start(root, port, [], { env: { ZUKAI_LABS_IDLE_MS: '1500' } });
    expect(r.code).toBe(0);
    expect(await waitFor(() => !existsSync(serverJson(root)), 10_000)).toBe(true);
    expect(await waitFor(() => !alive(r.out.pid), 5000)).toBe(true);
  }, 30_000);

  it('refuses a cloud session unless --skip-cloud-check is given', async () => {
    const { root } = labsProject();
    const port = await freePort();
    const refused = start(root, port, [], { env: { CLAUDE_CODE_REMOTE: 'true' } });
    expect(refused).toMatchObject({ code: 1, err: { error: { code: 'cloud-session' } } });
    expect(existsSync(serverJson(root))).toBe(false);
    const forced = start(root, port, ['--skip-cloud-check'], { env: { CLAUDE_CODE_REMOTE: 'true' } });
    expect(forced.code).toBe(0);
  }, 30_000);

  it('keeps serving its pages after the page folder is removed', async () => {
    const { root } = labsProject();
    const port = await freePort();
    const copy = mkdtempSync(join(tmpdir(), 'zukai-labs-bundle-'));
    copyFileSync(cliPath, join(copy, 'cli.mjs'));
    mkdirSync(join(copy, 'labs-ui'));
    writeFileSync(join(copy, 'labs-ui', 'index.html'), '<!doctype html><title>Zukai Labs</title><p>page-marker</p>\n');
    const r = start(root, port, [], { cli: join(copy, 'cli.mjs') });
    expect(r.code).toBe(0);
    rmSync(join(copy, 'labs-ui'), { recursive: true, force: true });
    const page = await fetch(`http://127.0.0.1:${port}/`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('page-marker');
  }, 30_000);

  it('refuses options and a port a command does not take', () => {
    expect(cli(['labs', 'status', '--force']).code).toBe(1);
    expect(cli(['labs', 'start', '--port', '80', '--root', elsewhere]).err.error.code).toBe('bad-request');
    expect(cli(['labs', 'restart']).err.errors[0].message).toBe('unknown command "labs restart"');
  });
});
