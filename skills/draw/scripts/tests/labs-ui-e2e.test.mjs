/**
 * The console in a real browser, against the committed bundle and a stand-in agent that
 * answers the bridge with the CLI: the runs list, a picture drawn in the viewer frame, a job
 * queued from the page whose question is answered in the page and whose report comes back,
 * the page without a token, a label that holds markup, the frame trying to call the API, and
 * a foreign page trying to frame the console. Skipped where Playwright is not found.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadPlaywright } from '../src/preview.mjs';
import { scriptsDir } from './helpers.mjs';
import { labsProject } from './labs-project.mjs';

const pw = loadPlaywright();
const cliPath = join(scriptsDir, 'bin', 'cli.mjs');
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'CLAUDE_CODE_REMOTE' && !k.startsWith('ZUKAI_LABS_')));
const MARKUP = '<img src=x onerror="window.pwned=1">';
const parse = (text) => text.trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return l; } }).at(-1);
const run = (args) => new Promise((done) => {
  const child = spawn(process.execPath, [cliPath, ...args], { env });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.on('close', (code) => done({ code, out: parse(out) }));
});
const freePort = () => new Promise((done) => { const s = createNetServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => done(port)); }); });
/** Whether the browser reaches the viewer's host: the frame can draw only then. */
async function viewerReachable(browser) {
  const probe = await browser.newPage();
  try { return await probe.evaluate(() => fetch('https://viewer.diagrams.net/js/viewer-static.min.js', { mode: 'no-cors' }).then(() => true, () => false)); } finally { await probe.close(); }
}

describe.skipIf(pw === null)('the console in a browser', () => {
  let p;
  let started;
  let browser;
  let foreign;
  beforeAll(async () => {
    p = labsProject();
    const dir = join(p.root, 'diagrams', '20261115_markup', 'source');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'markup.ir.json'), JSON.stringify({ schemaVersion: 1, kind: 'flowchart', title: MARKUP, nodes: [{ id: 'a', label: MARKUP }, { id: 'b', label: 'End' }], edges: [{ id: 'e', from: 'a', to: 'b' }] }));
    const port = await freePort();
    started = spawnSync(process.execPath, [cliPath, 'labs', 'start', '--root', p.root, '--port', String(port)], { env, encoding: 'utf8' });
    started = parse(started.stdout);
    browser = await pw.chromium.launch();
  }, 60_000);
  afterAll(async () => {
    await browser?.close();
    foreign?.close();
    spawnSync(process.execPath, [cliPath, 'labs', 'stop', '--root', p.root, '--force'], { env });
  });

  it('lists the runs, shows a label that holds markup as text and loads nothing from another host but the renderers', async () => {
    const page = await browser.newPage();
    const hosts = new Set();
    page.on('request', (r) => hosts.add(new URL(r.url()).host));
    await page.goto(started.url);
    await page.getByRole('link', { name: MARKUP }).waitFor({ timeout: 10_000 });
    expect(await page.evaluate(() => window.pwned)).toBeUndefined();
    expect(await page.locator('img[src="x"]').count()).toBe(0);
    expect(page.url()).not.toContain('#t=');
    expect([...hosts].filter((h) => h !== new URL(started.url).host)).toEqual([]);
    await page.close();
  }, 60_000);

  it('draws a run without svg/ in the viewer frame, which cannot call the API', async () => {
    const page = await browser.newPage();
    await page.goto(started.url);
    await page.goto(`${new URL(started.url).origin}/#/diagrams/${p.runs.login}/picture`);
    const frame = page.locator('iframe.zl-frame');
    await frame.waitFor({ timeout: 10_000 });
    expect(await frame.getAttribute('sandbox')).toBe('allow-scripts');
    const inner = page.frames().find((f) => f.url().endsWith('/viewer.html'));
    const call = await inner.evaluate(() => fetch('/api/state').then((r) => `status ${r.status}`, () => 'refused'));
    expect(call).toBe('refused');
    if (await viewerReachable(browser)) {
      await page.waitForFunction(() => document.querySelector('iframe.zl-frame')?.style.height !== '', null, { timeout: 60_000 });
      expect(Number.parseInt(await frame.evaluate((f) => f.style.height), 10)).toBeGreaterThan(120);
    }
    await page.close();
  }, 120_000);

  it('queues a revise from the page, answers its question in the page and shows the report', async () => {
    const page = await browser.newPage();
    await page.goto(started.url);
    await page.goto(`${new URL(started.url).origin}/#/diagrams/${p.runs.checkout}`);
    await page.getByLabel('Revise this run').fill('add a stock check after login');
    const waiting = run(['labs', 'wait', '--session', started.session, '--root', p.root]);
    await page.getByRole('button', { name: 'Revise' }).click();
    const { out } = await waiting;
    expect(out.job).toMatchObject({ kind: 'revise', params: { request: 'add a stock check after login' } });
    const question = join(out.job.folder, 'q.json');
    mkdirSync(out.job.folder, { recursive: true });
    writeFileSync(question, JSON.stringify({ id: 'pick', body: 'Draft A adds the check before payment.', questions: [{ header: 'Draft', question: 'Which draft?', options: [{ label: 'A', description: 'before payment' }, { label: 'B', description: 'after payment' }], multiSelect: false }] }));
    const asking = run(['labs', 'ask', out.job.id, '--session', started.session, '--question', `@${question}`, '--root', p.root]);
    await page.getByText('Draft A adds the check before payment.').waitFor({ timeout: 10_000 });
    await page.getByRole('radio', { name: /^A/ }).check();
    await page.getByRole('button', { name: 'Send answers' }).click();
    expect((await asking).out.answers).toEqual([{ selected: ['A'] }]);
    const report = join(out.job.folder, 'report.md');
    writeFileSync(report, 'Draft A applied as r003.');
    expect((await run(['labs', 'done', out.job.id, '--session', started.session, '--result', 'done', '--report', `@${report}`, '--root', p.root])).code).toBe(0);
    await page.getByText('Draft A applied as r003.').waitFor({ timeout: 10_000 });
    await page.close();
  }, 120_000);

  it('asks for the URL and calls nothing without the token', async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const api = [];
    page.on('request', (r) => { if (r.url().includes('/api/')) api.push(r.url()); });
    await page.goto(`${new URL(started.url).origin}/`);
    await page.getByText('Open the console with its URL').waitFor({ timeout: 10_000 });
    expect(api).toEqual([]);
    await context.close();
  }, 60_000);

  it('cannot be framed by a page of another origin', async () => {
    foreign = createHttpServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(`<!doctype html><iframe src="${started.url}" width="800" height="600"></iframe>`); });
    await new Promise((r) => foreign.listen(0, '127.0.0.1', r));
    const page = await browser.newPage();
    await page.goto(`http://localhost:${foreign.address().port}/`);
    await page.waitForTimeout(1500);
    const child = page.frames().find((f) => f !== page.mainFrame());
    const shell = await child?.evaluate(() => document.querySelector('.zl-shell') !== null).catch(() => false);
    expect(shell ?? false).toBe(false);
    await page.close();
  }, 60_000);
});
