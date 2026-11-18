/**
 * `open` without a browser: the embed bridge and the opener page, the file a target stands
 * for, the route chosen per machine, the private page folder and its 24-hour cleanup, and
 * `--check`, which changes nothing.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EMBED_HOST, embedHostOf, embedUrl, embedBridge, openerPage, scriptJson } from '../src/drawio-embed.mjs';
import { resolveDrawio, chooseRoute, browserOpener, pagesFolder, removeOldPages, writeOpenerPage, checkOpen, openDrawio, PAGE_TTL_MS } from '../src/open-drawio.mjs';
import { emit, bundle } from '../src/pipeline.mjs';
import { loadFixture } from './helpers.mjs';

const posix = process.platform !== 'win32';
const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('base64');
const write = (file, text) => { mkdirSync(join(file, '..'), { recursive: true }); writeFileSync(file, text); return file; };
const attr = (text) => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const noDesktop = () => ({ bin: null, tried: ['drawio on PATH'], broken: [] });
const desktopAt = (bin) => () => ({ bin, tried: [], broken: [] });

let flowXml;
let runXml;
beforeAll(async () => {
  flowXml = (await emit(loadFixture('flowchart', 'valid'), 'drawio')).output;
  runXml = (await bundle([{ id: 'checkout', ir: loadFixture('flowchart', 'valid') }, { id: 'checkout-01-pay', ir: loadFixture('sequence', 'valid') }], 'drawio', { title: 'Checkout' })).output;
});

/** A project with one run of each shape the resolver tells apart. */
function runs() {
  const root = mkdtempSync(join(tmpdir(), 'zukai-open-runs-'));
  const d = join(root, 'diagrams');
  write(join(d, '20261118_checkout', 'checkout.drawio'), runXml);
  write(join(d, '20261118_checkout', 'drawio', 'checkout.drawio'), flowXml);
  write(join(d, '20261118_checkout', 'svg', 'checkout.drawio.svg'), `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" content="${attr(flowXml)}"></svg>`);
  write(join(d, '20261118_single', 'drawio', 'single.drawio'), flowXml);
  write(join(d, '20261118_several', 'drawio', 'a.drawio'), flowXml);
  write(join(d, '20261118_several', 'drawio', 'b.drawio'), flowXml);
  write(join(d, '20261118_board', 'figjam', 'board.mmd'), 'flowchart LR\n');
  write(join(d, '20261118_lifecycle', 'lifecycle.md'), '# Lifecycle\n');
  write(join(d, '20261118_lifecycle', 'mermaid', 'lifecycle.mmd'), 'stateDiagram-v2\n');
  write(join(d, '20261118_empty', 'source', 'x.ir.json'), '{}');
  write(join(root, 'notes.txt'), 'not a diagram\n');
  write(join(root, 'broken.drawio'), 'not xml at all');
  return { root, d };
}

describe('the embed bridge', () => {
  it('names embed.diagrams.net unless ZUKAI_DRAWIO_EMBED names another http(s) origin', () => {
    expect(EMBED_HOST).toBe('https://embed.diagrams.net');
    expect(embedHostOf({})).toBe(EMBED_HOST);
    expect(embedHostOf({ ZUKAI_DRAWIO_EMBED: 'http://127.0.0.1:4100/some/path' })).toBe('http://127.0.0.1:4100');
    expect(embedHostOf({ ZUKAI_DRAWIO_EMBED: 'javascript:alert(1)' })).toBe(EMBED_HOST);
    expect(embedHostOf({ ZUKAI_DRAWIO_EMBED: 'not a url' })).toBe(EMBED_HOST);
    expect(embedUrl(EMBED_HOST)).toBe('https://embed.diagrams.net/?embed=1&proto=json&spin=1&noExitBtn=1&saveAndExit=0');
  });

  it('writes JSON that no label can break out of a script block with', () => {
    const text = scriptJson({ label: '</script><script>alert(1)</script>\u2028<!--' });
    expect(text).not.toMatch(/<|\u2028/);
    expect(JSON.parse(text).label).toBe('</script><script>alert(1)</script>\u2028<!--');
  });

  it('builds an opener page whose address carries no diagram, whose one script its policy allows by hash', () => {
    const xml = flowXml.replace('</mxfile>', '<!-- </script><img src=x onerror=alert(1)> --></mxfile>');
    const html = openerPage({ host: EMBED_HOST, xml, title: 'checkout.drawio', sha256 });
    const dom = new JSDOM(html);
    const doc = dom.window.document;
    expect(doc.getElementById('drawio').getAttribute('src')).toBe(embedUrl(EMBED_HOST));
    expect(doc.querySelectorAll('img')).toHaveLength(0);
    const data = JSON.parse(doc.getElementById('zukai-diagram').textContent);
    expect(data).toMatchObject({ host: EMBED_HOST, xml, title: 'checkout.drawio', wait: 20_000 });
    const scripts = [...doc.querySelectorAll('script:not([type])')];
    expect(scripts).toHaveLength(1);
    const csp = doc.querySelector('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
    expect(csp).toContain(`script-src 'sha256-${sha256(scripts[0].textContent)}'`);
    expect(csp).toContain(`frame-src ${EMBED_HOST}`);
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toMatch(/connect-src/);
    expect(scripts[0].textContent).toContain('const embedBridge = (function embedBridge');
  });

  it('answers init with the diagram, reports load, hands a save on and clears the mark, from that window and origin only', async () => {
    const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://127.0.0.1:4999/' });
    const w = dom.window;
    const sent = [];
    const embed = { postMessage: (data, origin) => sent.push({ data: JSON.parse(data), origin }) };
    const other = { postMessage: () => { throw new Error('not this one'); } };
    const seen = [];
    const stop = embedBridge(embed, { host: EMBED_HOST, xml: '<mxfile/>', title: 'a.drawio', listenOn: w, onInit: () => seen.push('init'), onLoad: () => seen.push('load'), onSave: (xml) => seen.push(`save ${xml}`) });
    const deliver = (data, { source = embed, origin = EMBED_HOST } = {}) => w.dispatchEvent(new w.MessageEvent('message', { data, origin, source }));
    deliver(JSON.stringify({ event: 'init' }), { source: other });
    deliver(JSON.stringify({ event: 'init' }), { origin: 'https://evil.example' });
    deliver({ event: 'init' });
    deliver('not json');
    expect(sent).toEqual([]);
    deliver(JSON.stringify({ event: 'init' }));
    await Promise.resolve();
    expect(sent).toEqual([{ data: { action: 'load', xml: '<mxfile/>', title: 'a.drawio', autosave: 0 }, origin: EMBED_HOST }]);
    deliver(JSON.stringify({ event: 'load' }));
    deliver(JSON.stringify({ event: 'save', xml: '<mxfile id="x"/>' }), { origin: 'https://evil.example' });
    deliver(JSON.stringify({ event: 'save', xml: '<mxfile id="2"/>' }));
    expect(seen).toEqual(['init', 'load', 'save <mxfile id="2"/>']);
    expect(sent.at(-1)).toEqual({ data: { action: 'status', modified: false }, origin: EMBED_HOST });
    stop();
    deliver(JSON.stringify({ event: 'save', xml: '<mxfile id="3"/>' }));
    expect(seen).toHaveLength(3);
  });

  it('waits for a diagram that is still on its way before it answers init', async () => {
    const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://127.0.0.1:4999/' });
    const w = dom.window;
    const sent = [];
    const embed = { postMessage: (data) => sent.push(JSON.parse(data)) };
    let arrive;
    embedBridge(embed, { host: EMBED_HOST, xml: new Promise((done) => { arrive = done; }), title: 'a.drawio', listenOn: w });
    w.dispatchEvent(new w.MessageEvent('message', { data: JSON.stringify({ event: 'init' }), origin: EMBED_HOST, source: embed }));
    await Promise.resolve();
    expect(sent).toEqual([]);
    arrive('<mxfile id="late"/>');
    await new Promise((done) => setTimeout(done, 0));
    expect(sent).toEqual([{ action: 'load', xml: '<mxfile id="late"/>', title: 'a.drawio', autosave: 0 }]);
  });
});

describe('the file a target stands for', () => {
  it('takes the combined file of a run, else its only drawio/ file, and the diagram inside a .drawio.svg', () => {
    const { d } = runs();
    expect(resolveDrawio(join(d, '20261118_checkout'))).toMatchObject({ ok: true, file: join(d, '20261118_checkout', 'checkout.drawio'), title: 'checkout.drawio' });
    expect(resolveDrawio(join(d, '20261118_checkout')).xml).toBe(runXml);
    expect(resolveDrawio(join(d, '20261118_single'))).toMatchObject({ ok: true, file: join(d, '20261118_single', 'drawio', 'single.drawio') });
    const svg = resolveDrawio(join(d, '20261118_checkout', 'svg', 'checkout.drawio.svg'));
    expect(svg).toMatchObject({ ok: true, title: 'checkout.drawio' });
    expect(svg.xml).toContain('<diagram');
    expect(svg.file.endsWith('checkout.drawio.svg')).toBe(true);
  });

  it('refuses several drawio/ files, Mermaid, a FigJam board and what is no draw.io file, each with a reason', () => {
    const { root, d } = runs();
    const several = resolveDrawio(join(d, '20261118_several'));
    expect(several).toMatchObject({ ok: false, code: 'bad-request' });
    expect(several.message).toContain('a.drawio, b.drawio');
    expect(resolveDrawio(join(d, '20261118_lifecycle'))).toMatchObject({ ok: false, code: 'not-supported' });
    expect(resolveDrawio(join(d, '20261118_lifecycle', 'mermaid', 'lifecycle.mmd'))).toMatchObject({ ok: false, code: 'not-supported' });
    expect(resolveDrawio(join(d, '20261118_lifecycle', 'lifecycle.md'))).toMatchObject({ ok: false, code: 'not-supported' });
    const board = resolveDrawio(join(d, '20261118_board'));
    expect(board).toMatchObject({ ok: false, code: 'not-supported' });
    expect(board.hint).toContain('link');
    expect(resolveDrawio(join(d, '20261118_empty'))).toMatchObject({ ok: false, code: 'not-found' });
    expect(resolveDrawio(join(d, '20261118_gone'))).toMatchObject({ ok: false, code: 'not-found' });
    expect(resolveDrawio(join(root, 'notes.txt'))).toMatchObject({ ok: false, code: 'bad-request' });
    expect(resolveDrawio(join(root, 'broken.drawio'))).toMatchObject({ ok: false, code: 'bad-request' });
  });
});

describe('the route', () => {
  it('refuses a cloud session and Linux without a display before it looks for draw.io desktop', () => {
    const find = () => { throw new Error('not looked for'); };
    expect(chooseRoute({ env: { CLAUDE_CODE_REMOTE: 'true', DISPLAY: ':0' }, platform: 'darwin', find })).toMatchObject({ ok: false, code: 'cloud-session' });
    expect(chooseRoute({ env: {}, platform: 'linux', find })).toMatchObject({ ok: false, code: 'no-display' });
    expect(chooseRoute({ env: { WAYLAND_DISPLAY: 'wayland-0' }, platform: 'linux', find: desktopAt('/opt/drawio/drawio') })).toMatchObject({ ok: true, via: 'desktop' });
  });

  it('takes draw.io desktop when found, the web otherwise, and the web alone with --web', () => {
    expect(chooseRoute({ env: { DISPLAY: ':0' }, platform: 'linux', find: desktopAt('/opt/drawio/drawio') })).toEqual({ ok: true, via: 'desktop', bin: '/opt/drawio/drawio' });
    expect(chooseRoute({ env: {}, platform: 'darwin', find: noDesktop })).toMatchObject({ ok: true, via: 'web', opener: { cmd: 'open' } });
    expect(chooseRoute({ env: {}, platform: 'win32', find: noDesktop })).toMatchObject({ ok: true, via: 'web', opener: { cmd: 'cmd' } });
    expect(browserOpener('win32', {}).args('C:\\t\\a b.html')).toEqual(['/c', 'start', '', 'C:\\t\\a b.html']);
    expect(chooseRoute({ web: true, env: {}, platform: 'darwin', find: () => { throw new Error('not looked for'); } })).toMatchObject({ ok: true, via: 'web' });
    expect(chooseRoute({ desktop: true, env: {}, platform: 'darwin', find: noDesktop })).toMatchObject({ ok: false, code: 'not-found' });
  });

  it.skipIf(!posix)('finds xdg-open on PATH, and says no-browser without it or when ZUKAI_OPENER names nothing', () => {
    const bin = mkdtempSync(join(tmpdir(), 'zukai-open-bin-'));
    write(join(bin, 'xdg-open'), '#!/bin/sh\n');
    chmodSync(join(bin, 'xdg-open'), 0o755);
    expect(chooseRoute({ env: { DISPLAY: ':0', PATH: bin }, platform: 'linux', find: noDesktop })).toMatchObject({ ok: true, via: 'web', opener: { cmd: join(bin, 'xdg-open') } });
    expect(chooseRoute({ env: { DISPLAY: ':0', PATH: '' }, platform: 'linux', find: noDesktop })).toMatchObject({ ok: false, code: 'no-browser' });
    expect(chooseRoute({ env: { ZUKAI_OPENER: join(bin, 'gone') }, platform: 'darwin', find: noDesktop })).toMatchObject({ ok: false, code: 'no-browser' });
  });
});

describe('the opener page on disk', () => {
  it('lives in a private folder, in a private file, and pages older than a day are removed', () => {
    const base = mkdtempSync(join(tmpdir(), 'zukai-open-base-'));
    const { d } = runs();
    const resolved = resolveDrawio(join(d, '20261118_checkout'));
    const old = write(join(base, 'zukai-open', 'old.html'), 'x');
    const recent = write(join(base, 'zukai-open', 'recent.html'), 'x');
    const ago = (ms) => (Date.now() - ms) / 1000;
    utimesSync(old, ago(PAGE_TTL_MS + 60_000), ago(PAGE_TTL_MS + 60_000));
    utimesSync(recent, ago(PAGE_TTL_MS - 60_000), ago(PAGE_TTL_MS - 60_000));
    const written = writeOpenerPage(resolved, { env: { ZUKAI_DRAWIO_EMBED: 'http://127.0.0.1:4100' }, base });
    expect(written.ok).toBe(true);
    expect(existsSync(old)).toBe(false);
    expect(existsSync(recent)).toBe(true);
    expect(written.page.startsWith(join(base, 'zukai-open'))).toBe(true);
    expect(written.page).toMatch(/checkout-[0-9a-f]{12}\.html$/);
    const html = readFileSync(written.page, 'utf8');
    expect(html).toContain('http://127.0.0.1:4100/?embed=1');
    expect(new JSDOM(html).window.document.getElementById('zukai-diagram').textContent).toContain('Order checkout');
    if (posix) {
      expect(statSync(join(base, 'zukai-open')).mode & 0o777).toBe(0o700);
      expect(statSync(written.page).mode & 0o777).toBe(0o600);
    }
  });

  it.skipIf(!posix)('makes an existing folder private and refuses a link in its place', () => {
    const base = mkdtempSync(join(tmpdir(), 'zukai-open-base-'));
    mkdirSync(join(base, 'zukai-open'), { mode: 0o755 });
    chmodSync(join(base, 'zukai-open'), 0o755);
    expect(pagesFolder(base).ok).toBe(true);
    expect(statSync(join(base, 'zukai-open')).mode & 0o777).toBe(0o700);
    const linked = mkdtempSync(join(tmpdir(), 'zukai-open-base-'));
    const elsewhere = mkdtempSync(join(tmpdir(), 'zukai-open-elsewhere-'));
    symlinkSync(elsewhere, join(linked, 'zukai-open'));
    expect(pagesFolder(linked)).toMatchObject({ ok: false, code: 'bad-request' });
  });

  it('removes nothing but old .html files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zukai-open-clean-'));
    const keep = write(join(dir, 'notes.txt'), 'x');
    const ancient = (Date.now() - 2 * PAGE_TTL_MS) / 1000;
    utimesSync(keep, ancient, ancient);
    write(join(dir, 'a.html'), 'x');
    utimesSync(join(dir, 'a.html'), ancient, ancient);
    expect(removeOldPages(dir)).toBe(1);
    expect(readdirSync(dir)).toEqual(['notes.txt']);
  });
});

describe('check and open', () => {
  it('check says whether and how, and writes and starts nothing', () => {
    const { d } = runs();
    const base = mkdtempSync(join(tmpdir(), 'zukai-open-base-'));
    const env = { DISPLAY: ':0', PATH: '' };
    expect(checkOpen(join(d, '20261118_checkout'), { env, platform: 'darwin', find: desktopAt('/Applications/draw.io.app/Contents/MacOS/draw.io') })).toEqual({ ok: true, can: true, via: 'desktop', file: join(d, '20261118_checkout', 'checkout.drawio') });
    expect(checkOpen(join(d, '20261118_checkout'), { env, platform: 'darwin', find: noDesktop })).toMatchObject({ ok: true, can: true, via: 'web' });
    expect(checkOpen(join(d, '20261118_checkout'), { env: { CLAUDE_CODE_REMOTE: 'true' }, platform: 'darwin', find: noDesktop })).toMatchObject({ ok: true, can: false, via: null, reason: 'cloud-session' });
    expect(checkOpen(join(d, '20261118_checkout'), { env: {}, platform: 'linux', find: noDesktop })).toMatchObject({ can: false, reason: 'no-display' });
    expect(checkOpen(join(d, '20261118_checkout'), { env, platform: 'linux', find: noDesktop })).toMatchObject({ can: false, reason: 'no-browser' });
    expect(checkOpen(join(d, '20261118_lifecycle'), { env, platform: 'darwin', find: noDesktop })).toMatchObject({ can: false, reason: 'not-supported' });
    expect(checkOpen(join(d, '20261118_board'), { env, platform: 'darwin', find: noDesktop })).toMatchObject({ can: false, reason: 'not-supported' });
    expect(readdirSync(base)).toEqual([]);
  });

  it.skipIf(!posix)('hands the opener nothing but the path of the page', async () => {
    const { d } = runs();
    const base = mkdtempSync(join(tmpdir(), 'zukai-open-base-'));
    const bin = mkdtempSync(join(tmpdir(), 'zukai-open-bin-'));
    const record = join(bin, 'args.json');
    write(join(bin, 'opener.mjs'), `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(record)}, JSON.stringify(process.argv.slice(2)));\n`);
    write(join(bin, 'opener'), `#!/bin/sh\nexec "${process.execPath}" "${join(bin, 'opener.mjs')}" "$@"\n`);
    chmodSync(join(bin, 'opener'), 0o755);
    const r = await openDrawio(join(d, '20261118_checkout'), { env: { DISPLAY: ':0', ZUKAI_OPENER: join(bin, 'opener') }, platform: 'linux', find: noDesktop, base });
    expect(r).toMatchObject({ ok: true, opened: 'web', file: join(d, '20261118_checkout', 'checkout.drawio') });
    for (let i = 0; i < 100 && !existsSync(record); i++) await new Promise((done) => setTimeout(done, 50));
    expect(JSON.parse(readFileSync(record, 'utf8'))).toEqual([r.page]);
    expect(r.page).not.toContain('mxfile');
  });

  it('says no-browser and leaves no page when the opener does not start', async () => {
    const { d } = runs();
    const base = mkdtempSync(join(tmpdir(), 'zukai-open-base-'));
    const gone = await openDrawio(join(d, '20261118_checkout'), { env: { ZUKAI_OPENER: join(base, 'no-such-opener') }, platform: 'darwin', find: noDesktop, base });
    expect(gone).toMatchObject({ ok: false, code: 'no-browser' });
    expect(existsSync(join(base, 'zukai-open'))).toBe(false);
  });
});
