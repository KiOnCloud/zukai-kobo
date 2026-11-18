/**
 * `open` through the committed bundle, from another working directory, with stand-ins for
 * the browser opener (ZUKAI_OPENER), for draw.io desktop (a `drawio` on PATH) and for the
 * embed host (ZUKAI_DRAWIO_EMBED): the refusals, `--check`, the desktop route and the web
 * route. In Playwright's Chromium the opener page the bundle wrote loads a file of every
 * fixture with each page as a tab, Save downloads it and clears the unsaved mark, a message
 * from another window is ignored, and a host that stays silent in a frame is reached through
 * the popup button. The browser part is skipped where Playwright is not found.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadPlaywright } from '../src/preview.mjs';
import { bundle } from '../src/pipeline.mjs';
import { openerPage } from '../src/drawio-embed.mjs';
import { scriptsDir, validFixtures } from './helpers.mjs';
import { embedStandIn } from './embed-stand-in.mjs';

const posix = process.platform !== 'win32';
const pw = loadPlaywright(scriptsDir);
const cliPath = join(scriptsDir, 'bin', 'cli.mjs');
const elsewhere = mkdtempSync(join(tmpdir(), 'zukai-open-cwd-'));
const write = (file, text) => { mkdirSync(join(file, '..'), { recursive: true }); writeFileSync(file, text); return file; };
const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('base64');
const until = async (test, ms = 5000) => { for (let i = 0; i < ms / 50 && !test(); i++) await new Promise((done) => setTimeout(done, 50)); };

/** An executable `name` in `bin` that writes its arguments as JSON to `<bin>/<name>.args.json`, and for `drawio` answers `--version`. */
function recorder(bin, name) {
  write(join(bin, `${name}.mjs`), `import { writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('26.0.9'); process.exit(0); }
writeFileSync(${JSON.stringify(join(bin, `${name}.args.json`))}, JSON.stringify(args));
`);
  write(join(bin, name), `#!/bin/sh\nexec "${process.execPath}" "${join(bin, `${name}.mjs`)}" "$@"\n`);
  chmodSync(join(bin, name), 0o755);
  return join(bin, name);
}

/** The environment of a run of the bundle: no cloud flag, no test variables but the ones given. */
const baseEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'CLAUDE_CODE_REMOTE' && !k.startsWith('ZUKAI_') && k !== 'DISPLAY' && k !== 'WAYLAND_DISPLAY'));
function cli(args, env = {}) {
  const r = spawnSync(process.execPath, [cliPath, ...args], { cwd: elsewhere, env: { ...baseEnv, ...env }, encoding: 'utf8' });
  const parse = (text) => { try { return JSON.parse(text.trim().split('\n').at(-1)); } catch { return text; } };
  return { code: r.status, out: parse(r.stdout), err: parse(r.stderr) };
}

let project;
let pages;
beforeAll(async () => {
  project = mkdtempSync(join(tmpdir(), 'zukai-open-e2e-'));
  const entries = validFixtures().map((f, i) => ({ id: `${f.kind}-${f.name}-${i}`, ir: f.ir }));
  const all = await bundle(entries, 'drawio', { title: 'Every fixture', allowSensitive: true });
  expect(all.ok).toBe(true);
  pages = entries.length;
  write(join(project, 'diagrams', '20261118_every-fixture', 'every-fixture.drawio'), all.output);
  write(join(project, 'diagrams', '20261118_lifecycle', 'lifecycle.md'), '# Lifecycle\n');
  write(join(project, 'diagrams', '20261118_lifecycle', 'mermaid', 'lifecycle.mmd'), 'stateDiagram-v2\n');
  write(join(project, 'diagrams', '20261118_board', 'figjam', 'board.mmd'), 'flowchart LR\n');
}, 120_000);

const run = () => join(project, 'diagrams', '20261118_every-fixture');
const runFile = () => join(run(), 'every-fixture.drawio');

describe('open through the bundle', () => {
  it('is in the usage, and refuses --web with --desktop and a missing target', () => {
    const help = cli(['help']);
    expect(help.code).toBe(0);
    expect(spawnSync(process.execPath, [cliPath, 'help'], { encoding: 'utf8' }).stdout).toContain('cli.mjs open --check <run-dir|file.drawio|file.drawio.svg>');
    expect(cli(['open', '--web', '--desktop', run()])).toMatchObject({ code: 1, err: { ok: false, error: { code: 'bad-request' } } });
    expect(cli(['open'])).toMatchObject({ code: 1, err: { error: { code: 'bad-request' } } });
    expect(cli(['open', '--page', 'x', run()]).code).toBe(1);
  }, 60_000);

  it('check answers can: false with a reason for a cloud session, Mermaid and FigJam, with exit 0', () => {
    expect(cli(['open', '--check', run()], { CLAUDE_CODE_REMOTE: 'true' })).toMatchObject({ code: 0, out: { ok: true, can: false, via: null, reason: 'cloud-session' } });
    expect(cli(['open', '--check', join(project, 'diagrams', '20261118_lifecycle')])).toMatchObject({ code: 0, out: { can: false, reason: 'not-supported' } });
    expect(cli(['open', '--check', join(project, 'diagrams', '20261118_board')])).toMatchObject({ code: 0, out: { can: false, reason: 'not-supported' } });
    expect(cli(['open', join(project, 'diagrams', '20261118_lifecycle')])).toMatchObject({ code: 1, err: { ok: false, error: { code: 'not-supported' } } });
  }, 60_000);

  it.skipIf(process.platform !== 'linux')('says no-display on Linux without a display', () => {
    expect(cli(['open', '--check', run()])).toMatchObject({ code: 0, out: { can: false, reason: 'no-display' } });
    expect(cli(['open', run()])).toMatchObject({ code: 1, err: { error: { code: 'no-display' } } });
  }, 60_000);

  it.skipIf(!posix)('starts draw.io desktop with the run file when it is on PATH', async () => {
    const bin = mkdtempSync(join(tmpdir(), 'zukai-open-bin-'));
    recorder(bin, 'drawio');
    const env = { PATH: `${bin}:${baseEnv.PATH}`, DISPLAY: ':0' };
    expect(cli(['open', '--check', run()], env)).toMatchObject({ code: 0, out: { can: true, via: 'desktop', file: runFile() } });
    const r = cli(['open', run()], env);
    expect(r).toMatchObject({ code: 0, out: { ok: true, opened: 'desktop', file: runFile() } });
    await until(() => existsSync(join(bin, 'drawio.args.json')));
    // The window the user edits in: the file alone, none of the headless flags (--no-sandbox).
    expect(JSON.parse(readFileSync(join(bin, 'drawio.args.json'), 'utf8'))).toEqual([runFile()]);
  }, 60_000);

  it.skipIf(!posix)('writes a private opener page and hands the opener its path alone', async () => {
    const bin = mkdtempSync(join(tmpdir(), 'zukai-open-bin-'));
    const opener = recorder(bin, 'opener');
    const r = cli(['open', '--web', run()], { ZUKAI_OPENER: opener, DISPLAY: ':0', ZUKAI_DRAWIO_EMBED: 'http://127.0.0.1:4100' });
    expect(r).toMatchObject({ code: 0, out: { ok: true, opened: 'web', file: runFile() } });
    await until(() => existsSync(join(bin, 'opener.args.json')));
    expect(JSON.parse(readFileSync(join(bin, 'opener.args.json'), 'utf8'))).toEqual([r.out.page]);
    expect(statSync(r.out.page).mode & 0o777).toBe(0o600);
    expect(statSync(join(r.out.page, '..')).mode & 0o777).toBe(0o700);
    expect(readFileSync(r.out.page, 'utf8')).toContain('src="http://127.0.0.1:4100/?embed=1&amp;proto=json');
  }, 60_000);
});

describe.skipIf(pw === null || !posix)('the opener page in a browser', () => {
  let browser;
  let host;
  let silentInFrame;
  beforeAll(async () => {
    host = await embedStandIn();
    silentInFrame = await embedStandIn({ refuseFrame: true });
    browser = await pw.chromium.launch();
  }, 60_000);
  afterAll(async () => {
    await browser?.close();
    await host?.close();
    await silentInFrame?.close();
  });

  it('loads every page as a tab, saves by download, clears the unsaved mark and ignores another window', async () => {
    const bin = mkdtempSync(join(tmpdir(), 'zukai-open-bin-'));
    const r = cli(['open', '--web', run()], { ZUKAI_OPENER: recorder(bin, 'opener'), DISPLAY: ':0', ZUKAI_DRAWIO_EMBED: host.host });
    expect(r.code).toBe(0);
    expect(statSync(runFile()).size).toBeGreaterThan(800 * 1024);
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    const violations = [];
    page.on('console', (m) => { if (/Content Security Policy/i.test(m.text())) violations.push(m.text()); });
    const requests = [];
    page.on('request', (q) => requests.push(q.url()));
    await page.goto(pathToFileURL(r.out.page).href);
    const frame = page.frameLocator('#drawio');
    await expect.poll(() => frame.locator('.tab').count(), { timeout: 20_000 }).toBe(pages);
    expect(pages).toBeGreaterThanOrEqual(72);
    expect(await frame.locator('#title').textContent()).toBe('every-fixture.drawio');
    // Every address the page asked for is the page itself or the embed page, which carries no diagram.
    for (const url of requests) expect(url.length).toBeLessThan(300);
    expect(await page.locator('#bar').isHidden()).toBe(true);

    // A message from the page's own window (not the embed window) does nothing.
    let downloads = 0;
    page.on('download', () => { downloads += 1; });
    await page.evaluate(() => window.postMessage(JSON.stringify({ event: 'save', xml: '<mxfile/>' }), '*'));
    await page.waitForTimeout(500);
    expect(downloads).toBe(0);

    const [download] = await Promise.all([page.waitForEvent('download'), frame.locator('#save').click()]);
    expect(download.suggestedFilename()).toBe('every-fixture.drawio');
    expect(readFileSync(await download.path(), 'utf8')).toBe(readFileSync(runFile(), 'utf8'));
    await expect.poll(() => frame.locator('body').getAttribute('data-modified')).toBe('false');
    expect(await page.locator('#status').textContent()).toContain('every-fixture.drawio was downloaded');
    expect(violations).toEqual([]);
    await context.close();
  }, 60_000);

  it('offers the popup when the frame stays silent, and the popup gets the diagram', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zukai-open-page-'));
    const xml = readFileSync(runFile(), 'utf8');
    const file = write(join(dir, 'page.html'), openerPage({ host: silentInFrame.host, xml, title: 'every-fixture.drawio', wait: 300, sha256 }));
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    await page.goto(pathToFileURL(file).href);
    await page.locator('#bar').waitFor({ state: 'visible', timeout: 5000 });
    const [popup] = await Promise.all([page.waitForEvent('popup'), page.getByRole('button', { name: 'Open in draw.io' }).click()]);
    await expect.poll(() => popup.locator('.tab').count(), { timeout: 20_000 }).toBe(pages);
    expect(popup.url()).toBe(`${silentInFrame.host}/?embed=1&proto=json&spin=1&noExitBtn=1&saveAndExit=0`);
    // A second click brings the same window forward; it is not bridged twice.
    let popups = 1;
    context.on('page', () => { popups += 1; });
    await page.getByRole('button', { name: 'Open in draw.io' }).click();
    await page.waitForTimeout(300);
    expect(popups).toBe(1);
    let saves = 0;
    page.on('download', () => { saves += 1; });
    const [download] = await Promise.all([page.waitForEvent('download'), popup.locator('#save').click()]);
    expect(download.suggestedFilename()).toBe('every-fixture.drawio');
    await page.waitForTimeout(300);
    expect(saves).toBe(1);
    const [fallback] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download every-fixture.drawio' }).click()]);
    expect(readFileSync(await fallback.path(), 'utf8')).toBe(xml);
    await context.close();
  }, 60_000);
});
