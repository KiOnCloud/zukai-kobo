/**
 * The console in a real browser, against the committed bundle and a stand-in agent that
 * answers the bridge with the CLI: the runs list, a picture drawn in the viewer frame, a job
 * queued from the page whose question is answered in the page and whose report comes back,
 * the page without a token, a label that holds markup, the frame trying to call the API, a
 * foreign page trying to frame the console, and the Reports section: a report in the sealed
 * report frame, a quick edit and a restore, a template preview and an import checked before
 * it is saved. Skipped where Playwright is not found.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadPlaywright } from '../src/preview.mjs';
import { scriptsDir } from './helpers.mjs';
import { labsProject, RUNS_DIRS } from './labs-project.mjs';
import { embedStandIn } from './embed-stand-in.mjs';

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

describe.skipIf(pw === null).each(RUNS_DIRS)('the console in a browser (runs folder %s)', (runsDir) => {
  let p;
  let started;
  let browser;
  let foreign;
  let embed;
  beforeAll(async () => {
    embed = await embedStandIn();
    p = labsProject({ runsDir });
    const dir = join(p.dir, '20261115_markup', 'source');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'markup.ir.json'), JSON.stringify({ schemaVersion: 1, kind: 'flowchart', title: MARKUP, nodes: [{ id: 'a', label: MARKUP }, { id: 'b', label: 'End' }], edges: [{ id: 'e', from: 'a', to: 'b' }] }));
    const port = await freePort();
    started = spawnSync(process.execPath, [cliPath, 'labs', 'start', '--root', p.root, '--port', String(port)], { env: { ...env, ZUKAI_DRAWIO_EMBED: embed.host }, encoding: 'utf8' });
    started = parse(started.stdout);
    browser = await pw.chromium.launch();
  }, 60_000);
  afterAll(async () => {
    await browser?.close();
    foreign?.close();
    await embed?.close();
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

  it('names the runs folder of the project where it names a folder', async () => {
    const page = await browser.newPage();
    await page.goto(started.url);
    // The first page is drawn before the first state arrives; it must not keep the default.
    await page.getByText(`Diagrams under ${runsDir ?? 'diagrams'}/, the jobs`).waitFor({ timeout: 10_000 });
    await page.goto(`${new URL(started.url).origin}/#/diagrams/${p.runs.checkout}`);
    await page.getByText(`${runsDir ?? 'diagrams'}/${p.runs.checkout}`, { exact: true }).waitFor({ timeout: 10_000 });
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
    await page.locator('summary', { hasText: 'Draft A applied as r003.' }).waitFor({ timeout: 10_000 });
    await page.close();
  }, 120_000);

  it('opens a run file in draw.io from the click, and Save downloads it; the popup cannot reach the console', async () => {
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    const violations = [];
    page.on('console', (m) => { if (/Content Security Policy/i.test(m.text())) violations.push(m.text()); });
    await page.goto(started.url);
    await page.goto(`${new URL(started.url).origin}/#/diagrams/${p.runs.checkout}/files`);
    await page.getByRole('button', { name: 'Open checkout.drawio in draw.io' }).first().waitFor({ timeout: 10_000 });
    const [popup] = await Promise.all([page.waitForEvent('popup'), page.locator('header').getByRole('button', { name: 'Open in draw.io' }).click()]);
    expect(popup.url().startsWith(`${embed.host}/?embed=1`)).toBe(true);
    await expect.poll(() => popup.locator('.tab').allTextContents(), { timeout: 10_000 }).toEqual(['Checkout']);
    expect(await popup.locator('#title').textContent()).toBe('checkout.drawio');
    const [download] = await Promise.all([page.waitForEvent('download'), popup.locator('#save').click()]);
    expect(download.suggestedFilename()).toBe('checkout.drawio');
    await expect.poll(() => popup.locator('body').getAttribute('data-modified')).toBe('false');
    await page.getByText('checkout.drawio was downloaded').waitFor({ timeout: 5000 });
    expect(await popup.evaluate(() => { try { return window.opener.sessionStorage.getItem('zukai-labs-token'); } catch { return 'cross-origin'; } })).toBe('cross-origin');
    expect(violations).toEqual([]);
    await context.close();
  }, 60_000);

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

describe.skipIf(pw === null)('the Reports section in a browser', () => {
  let p;
  let started;
  let browser;
  let reportName;
  let reportDir;
  beforeAll(async () => {
    p = labsProject();
    const made = parse(spawnSync(process.execPath, [cliPath, 'report', 'new', '--template', 'issue-investigation', '--title', 'Checkout fails', '--root', p.root], { env, encoding: 'utf8' }).stdout);
    reportName = made.name;
    reportDir = made.path;
    const md = readFileSync(join(reportDir, 'report.md'), 'utf8').replace('<!-- zukai:section id="summary" -->', '<!-- zukai:section id="summary" -->\nThe pool ran out. <script>window.pwned=1</script> See [the runbook](https://example.org/runbook).');
    writeFileSync(join(reportDir, 'report.md'), md);
    spawnSync(process.execPath, [cliPath, 'report', 'snapshot', reportDir, '--request', 'first'], { env });
    spawnSync(process.execPath, [cliPath, 'report', 'render', reportDir], { env });
    const port = await freePort();
    started = parse(spawnSync(process.execPath, [cliPath, 'labs', 'start', '--root', p.root, '--port', String(port)], { env, encoding: 'utf8' }).stdout);
    browser = await pw.chromium.launch();
  }, 60_000);
  afterAll(async () => {
    await browser?.close();
    spawnSync(process.execPath, [cliPath, 'labs', 'stop', '--root', p.root, '--force'], { env });
  });

  it('previews a report in the sealed frame: the template styles apply, no script runs, a link does not navigate', async () => {
    const page = await browser.newPage();
    await page.goto(started.url);
    await page.goto(`${new URL(started.url).origin}/#/reports/${reportName}`);
    const frameEl = page.locator('iframe.zl-frame-report');
    await frameEl.waitFor({ timeout: 10_000 });
    expect(await frameEl.getAttribute('sandbox')).toBe('allow-scripts allow-modals');
    await page.waitForFunction(() => document.querySelector('iframe.zl-frame-report')?.style.height !== '', null, { timeout: 10_000 });
    const frame = page.frameLocator('iframe.zl-frame-report');
    await frame.getByText('The pool ran out.').waitFor({ timeout: 10_000 });
    expect(await frame.locator('.eyebrow').evaluate((el) => getComputedStyle(el).textTransform)).toBe('uppercase');
    expect(await frame.locator('script').count()).toBe(0);
    const link = frame.getByText('the runbook');
    expect(await link.getAttribute('href')).toBeNull();
    expect(await link.getAttribute('title')).toBe('https://example.org/runbook');
    await link.click();
    expect(page.frames().find((f) => f.url().includes('example.org'))).toBeUndefined();
    expect(await page.evaluate(() => window.pwned)).toBeUndefined();
    await page.close();
  }, 60_000);

  it('saves a quick edit of the source after a snapshot, and restores the first revision', async () => {
    const page = await browser.newPage();
    await page.goto(started.url);
    await page.goto(`${new URL(started.url).origin}/#/reports/${reportName}/source`);
    const area = page.locator('textarea');
    await area.waitFor({ timeout: 10_000 });
    await area.fill((await area.inputValue()).replace('The pool ran out.', 'The connection pool ran out.'));
    await page.getByRole('button', { name: 'Save' }).click();
    await page.getByText(/Saved after snapshot r002/).waitFor({ timeout: 10_000 });
    expect(readFileSync(join(reportDir, 'report.md'), 'utf8')).toContain('The connection pool ran out.');
    await page.getByRole('tab', { name: /History/ }).click();
    await page.getByRole('button', { name: 'Restore r001' }).first().click();
    await page.locator('.sn-dialog').getByRole('button', { name: 'Restore r001' }).click();
    await page.getByText(/r001 was restored after snapshot r003/).waitFor({ timeout: 10_000 });
    expect(readFileSync(join(reportDir, 'report.md'), 'utf8')).toContain('The pool ran out.');
    await page.close();
  }, 60_000);

  it('previews a template and checks an import file before saving it', async () => {
    const page = await browser.newPage();
    await page.goto(started.url);
    await page.goto(`${new URL(started.url).origin}/#/reports/templates/feature`);
    await page.frameLocator('iframe.zl-frame-report').getByText('Staff login with a one-time code').waitFor({ timeout: 10_000 });
    const exported = parse(spawnSync(process.execPath, [cliPath, 'template', 'export', 'tech-research', '--out', p.root, '--root', p.root], { env, encoding: 'utf8' }).stdout);
    const file = join(p.root, 'vendor.zukai-template.json');
    writeFileSync(file, readFileSync(exported.out, 'utf8').replace(/tech-research/g, 'vendor-review'));
    await page.locator('input[type="file"]').setInputFiles(file);
    await page.getByText(/passed validation/).waitFor({ timeout: 10_000 });
    expect(existsSync(join(process.env.ZUKAI_HOME, 'report-templates', 'vendor-review'))).toBe(false);
    await page.getByRole('button', { name: 'Import vendor-review' }).click();
    await page.getByText(/vendor-review was imported/).waitFor({ timeout: 10_000 });
    await page.close();
  }, 60_000);
});
