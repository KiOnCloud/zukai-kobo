import { describe, it, expect } from 'vitest';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { exportSvg, drawioPages, pageFileNames, standaloneSvg } from '../src/export-svg.mjs';
import { loadPlaywright } from '../src/preview.mjs';
import { drawioXmlOf } from '../src/extract-drawio.mjs';
import { extractFacts } from '../src/extract.mjs';
import { cover } from '../src/cover.mjs';
import { emit, bundle } from '../src/pipeline.mjs';
import { decodePng } from '../src/png.mjs';
import { loadFixture, scriptsDir } from './helpers.mjs';

const dir = mkdtempSync(join(tmpdir(), 'zukai-export-'));
const samples = join(scriptsDir, 'tests', 'export-samples');
const sample = (name) => readFileSync(join(samples, name), 'utf8');
const pw = loadPlaywright(scriptsDir);
const hasPlaywright = pw !== null;

const flow = (title, extra = {}) => ({
  schemaVersion: 1, kind: 'flowchart', title,
  nodes: [{ id: 'start', label: 'Start', shape: 'terminal' }, { id: 'check', label: 'Check the request' }, { id: 'done', label: 'Done', shape: 'terminal' }],
  edges: [{ id: 'e1', from: 'start', to: 'check' }, { id: 'e2', from: 'check', to: 'done', label: 'checked' }],
  ...extra,
});

async function emitTo(ir, name, folder = dir) {
  const r = await emit(ir, 'drawio', { diagramId: name });
  const file = join(folder, `${name}.drawio`);
  writeFileSync(file, r.output);
  return file;
}

/** A run of a main diagram that refers to a part, bundled with a canvas page. */
async function bundledRun(slug) {
  const run = join(mkdtempSync(join(tmpdir(), 'zukai-export-run-')), 'diagrams', `20261117_${slug}`);
  mkdirSync(join(run, 'source'), { recursive: true });
  const main = flow('Checkout', { nodes: [{ id: 'start', label: 'Start', shape: 'terminal' }, { id: 'pay', label: 'Take the payment', ref: `${slug}-01-payment` }, { id: 'done', label: 'Done', shape: 'terminal' }], edges: [{ id: 'e1', from: 'start', to: 'pay' }, { id: 'e2', from: 'pay', to: 'done' }] });
  const part = flow('Payment by card');
  const entries = [{ id: slug, ir: main }, { id: `${slug}-01-payment`, ir: part }];
  for (const e of entries) writeFileSync(join(run, 'source', `${e.id}.ir.json`), JSON.stringify(e.ir));
  const r = await bundle(entries, 'drawio', { canvas: 'all', title: 'Checkout' });
  writeFileSync(join(run, `${slug}.drawio`), r.output);
  return { run, entries, xml: r.output };
}

/** Screenshot of the file shown through an <img> tag, as GitHub and a wiki show it. */
async function shownAsImage(browser, svgText) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 });
  try {
    await page.setContent(`<body style="margin:0;background:#3355ff"><img id="i" src="data:image/svg+xml;base64,${Buffer.from(svgText).toString('base64')}"></body>`);
    await page.waitForFunction(() => { const i = document.getElementById('i'); return i.complete && i.naturalWidth > 0; }, null, { timeout: 20_000 });
    return decodePng(await page.locator('#i').screenshot());
  } finally {
    await page.close();
  }
}
const pixel = (png, x, y) => [...png.pixels.subarray((y * png.width + x) * png.bpp, (y * png.width + x) * png.bpp + 3)];
const darkPixels = (png) => { let n = 0; for (let i = 0; i < png.pixels.length; i += png.bpp) if (png.pixels[i] < 128 && png.pixels[i + 1] < 128 && png.pixels[i + 2] < 128) n += 1; return n; };

describe('pages of a draw.io file', () => {
  it('keeps a file of one page as it is', async () => {
    const xml = (await emit(flow('One'), 'drawio', { diagramId: 'one' })).output;
    const r = drawioPages(xml);
    expect(r.zukai).toBe(true);
    expect(r.pages).toHaveLength(1);
    expect(r.pages[0]).toMatchObject({ id: 'one', name: 'One', xml });
    expect(r.pages[0].cells).toBeGreaterThan(3);
  });

  it('gives each page of a bundle an mxfile of its own that holds that page only', async () => {
    const { xml } = await bundledRun('checkout');
    const r = drawioPages(xml);
    expect(r.pages.map((p) => p.id)).toEqual(['canvas', 'checkout', 'checkout-01-payment']);
    for (const p of r.pages) {
      expect(p.xml.match(/<diagram\b/g)).toHaveLength(1);
      expect(p.xml).toMatch(/^<mxfile host="zukai" compressed="false" type="device">\n {2}<diagram id="/);
      expect(p.xml).not.toMatch(/pages="/);
      // The page is the text of the bundle, cell for cell.
      expect(xml).toContain(p.xml.slice(p.xml.indexOf('<diagram'), p.xml.indexOf('</diagram>')));
    }
  });

  it('reads a page that draw.io stored compressed', () => {
    const model = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="a" value="Hello" style="rounded=1;" vertex="1" parent="1"><mxGeometry x="10" y="10" width="80" height="40" as="geometry"/></mxCell></root></mxGraphModel>';
    const packed = deflateRawSync(Buffer.from(encodeURIComponent(model))).toString('base64');
    const r = drawioPages(`<mxfile host="app.diagrams.net"><diagram id="x1" name="Page-1">${packed}</diagram></mxfile>`);
    expect(r.zukai).toBe(false);
    expect(r.pages[0].xml).toContain('value="Hello"');
    expect(r.pages[0].cells).toBe(1);
  });

  it('refuses what is not a draw.io file or has no page', () => {
    expect(drawioPages('flowchart TD\n a --> b').error).toMatch(/no <mxfile> root/);
    expect(drawioPages('<mxfile host="x"></mxfile>').error).toMatch(/no page/);
  });

  it('names a picture after the file, the diagram id of a Zukai page, or the name of any other page', () => {
    expect(pageFileNames([{ id: 'abc', name: 'Whatever' }], 'order', false)).toEqual(['order']);
    expect(pageFileNames([{ id: 'canvas', name: 'Checkout' }, { id: 'checkout', name: 'Checkout' }], 'run', true)).toEqual(['canvas', 'checkout']);
    expect(pageFileNames([{ id: 'Qx3-9z_A', name: 'Login flow' }, { id: 'k2', name: 'Login flow' }, { id: 'k3', name: 'Đăng nhập / 注文' }, { id: 'k4', name: '???' }], 'hand', false)).toEqual(['login-flow', 'login-flow-2', 'đăng-nhập-注文', 'page-4']);
  });
});

describe('a renderer\'s SVG made a file of its own (stored draw.io viewer output)', () => {
  const mxfile = sample('refund-check.drawio');
  const raw = sample('refund-check.viewer.svg');

  it('carries the diagram where draw.io and extract read it, and gives it back unchanged', () => {
    const r = standaloneSvg(raw, mxfile);
    expect(r.error).toBeUndefined();
    expect(r.svg).toMatch(/^<svg content="&lt;mxfile host=&quot;zukai&quot;/);
    expect(drawioXmlOf(Buffer.from(r.svg)).xml).toBe(mxfile);
    const facts = extractFacts(Buffer.from(r.svg), 'refund-check.drawio.svg');
    expect(facts.ok).toBe(true);
    expect(facts.facts.pages[0].nodes.map((n) => n.label)).toEqual(expect.arrayContaining(['Start', 'Is the amount over 500 EUR & approved?', 'Pay back to the card', 'Done']));
    expect(cover(facts.facts, [{ name: 'refund-check', ir: JSON.parse(sample('refund-check.ir.json')) }]).ok).toBe(true);
  });

  it('stands on its own: namespaces, size, white background, no colour that follows dark mode, no random id', () => {
    const r = standaloneSvg(raw, mxfile);
    const root = /^<svg [^>]*>/.exec(r.svg)[0];
    expect(root).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(root).toContain('xmlns:xlink="http://www.w3.org/1999/xlink"');
    expect(root).toMatch(new RegExp(`width="${r.width}px" height="${r.height}px" viewBox="0 0 ${r.width} ${r.height}"`));
    expect(root).toContain('style="background: #ffffff;"');
    expect(root).not.toMatch(/\sid="/);
    expect(raw).toMatch(/light-dark\(/);
    expect(raw).toMatch(/var\(--ge-/);
    expect(r.svg).not.toMatch(/light-dark\(|--ge-|color-scheme|<style/);
    expect(r.svg.match(/<rect fill="#ffffff" width="100%" height="100%"/g)).toHaveLength(1);
    // The shapes keep their own colours as attributes.
    expect(r.svg).toMatch(/<rect [^>]*fill="#ffffff" stroke="#000000"/);
    // Without a browser the labels stay as draw.io wrote them, and that is counted.
    expect(r.htmlLabels).toBe((raw.match(/<foreignObject\b/g) ?? []).length);
    expect(r.htmlLabels).toBeGreaterThan(0);
    expect(r.externalImages).toBe(0);
  });

  it('adds the white background and the viewBox a renderer left out, and counts images loaded from an address', () => {
    const bare = '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="120px" height="80px" style="background: transparent; color-scheme: light dark;"><defs/><g><rect x="10" y="10" width="100" height="60" fill="#dae8fc" stroke="#6c8ebf"/><image x="20" y="20" width="16" height="16" xlink:href="https://example.com/a.png"/></g></svg>';
    const r = standaloneSvg(bare, '<mxfile><diagram id="a" name="A"/></mxfile>');
    expect(r).toMatchObject({ width: 120, height: 80, externalImages: 1, htmlLabels: 0 });
    expect(r.svg).toContain('viewBox="0 0 120 80"');
    expect(r.svg).toContain('style="background: #ffffff;"');
    expect(r.svg).toContain('><rect fill="#ffffff" width="100%" height="100%" x="0" y="0"/><defs/>');
    expect(r.svg.startsWith('<svg content=')).toBe(true);
  });

  it('never passes on a picture with nothing drawn, without a size, or that is no SVG', () => {
    expect(standaloneSvg('<svg xmlns="http://www.w3.org/2000/svg" width="40px" height="40px" viewBox="0 0 40 40"><defs/><rect fill="#ffffff" width="100%" height="100%" x="0" y="0"/><g><g/></g></svg>', '<mxfile/>').error).toMatch(/drew nothing/);
    expect(standaloneSvg('<svg xmlns="http://www.w3.org/2000/svg"><path d="M 0 0 L 1 1"/></svg>', '<mxfile/>').error).toMatch(/without a size/);
    expect(standaloneSvg('', '<mxfile/>').error).toMatch(/no SVG/);
    expect(standaloneSvg('<svg width="10" height="10"><path d="M 0 0"/>', '<mxfile/>').error).toMatch(/cut off/);
  });

  it('keeps a quote, an ampersand and a line break of the diagram through the attribute', () => {
    const odd = '<mxfile host="zukai" compressed="false">\n  <diagram id="q" name="Q &amp; A">\n    <mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="a" value="say &quot;hi&quot;&lt;br&gt;a &amp;amp; b&#10;c" style="rounded=1;" vertex="1" parent="1"><mxGeometry x="0" y="0" width="80" height="40" as="geometry"/></mxCell></root></mxGraphModel>\n  </diagram>\n</mxfile>\n';
    const r = standaloneSvg(raw, odd);
    expect(drawioXmlOf(Buffer.from(r.svg)).xml).toBe(odd);
  });
});

describe('export: what it refuses before it draws', () => {
  it('a missing file, a file that is not draw.io, a folder without a draw.io file', async () => {
    const missing = await exportSvg(join(dir, 'nope.drawio'));
    expect(missing.ok).toBe(false);
    expect(missing.errors[0].message).toMatch(/cannot read/);
    const mmd = join(dir, 'flow.mmd');
    writeFileSync(mmd, 'flowchart TD\n a --> b\n');
    const notDrawio = await exportSvg(mmd);
    expect(notDrawio.errors[0].message).toMatch(/not a \.drawio file/);
    expect(notDrawio.errors[0].hint).toMatch(/Mermaid or FigJam run has no draw\.io file/);
    const run = join(mkdtempSync(join(tmpdir(), 'zukai-export-empty-')), 'diagrams', '20261117_login');
    mkdirSync(join(run, 'source'), { recursive: true });
    mkdirSync(join(run, 'mermaid'), { recursive: true });
    const noFile = await exportSvg(run);
    expect(noFile.errors[0].message).toBe('no draw.io file in this folder (looked for login.drawio and drawio/*.drawio)');
    expect(existsSync(join(run, 'svg'))).toBe(false);
  });

  it('one output file for several pages, and a file whose pages are all empty', async () => {
    const { run } = await bundledRun('basket');
    const r = await exportSvg(run, { out: join(dir, 'one.svg') });
    expect(r).toMatchObject({ ok: false, usage: true });
    expect(r.errors[0].message).toBe('--out names one file, but 3 pages would be written (canvas, basket, basket-01-payment)');
    expect(existsSync(join(dir, 'one.svg'))).toBe(false);
    const empty = join(dir, 'empty.drawio');
    writeFileSync(empty, '<mxfile host="zukai" compressed="false"><diagram id="d" name="Empty"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>');
    const none = await exportSvg(empty);
    expect(none.ok).toBe(false);
    expect(none.errors[0].message).toMatch(/nothing to export/);
    expect(none.warnings[0].message).toBe('page "Empty" has nothing on it: no picture is written for it');
    expect(existsSync(join(dir, 'empty.drawio.svg'))).toBe(false);
  });
});

describe('export with a renderer', () => {
  const ROUND_TRIP = [['flowchart', 'valid-refund-approval'], ['sequence', 'valid-loop-note-alt'], ['state', 'valid-order-lifecycle'], ['er', 'valid-customers-orders'], ['class', 'valid-order-domain'], ['activity', 'valid-guard-collision-lr'], ['architecture', 'valid-aws']];

  it.skipIf(!hasPlaywright).each(ROUND_TRIP)('round trip of a %s diagram (%s): the picture gives back the page, and the page covers the IR', async (kind, name) => {
    const ir = loadFixture(kind, name);
    const file = await emitTo(ir, `${kind}-${name}`);
    const r = await exportSvg(file, { renderer: 'drawio-web' });
    expect(r.errors).toEqual([]);
    expect(r).toMatchObject({ ok: true, renderer: 'drawio-web', text: 'svg', warnings: [] });
    expect(r.files).toHaveLength(1);
    expect(r.files[0].out).toBe(join(dir, `${kind}-${name}.drawio.svg`));
    const svg = readFileSync(r.files[0].out);
    // The embedded diagram is the exported file, byte for byte.
    expect(drawioXmlOf(svg).xml).toBe(readFileSync(file, 'utf8'));
    const fromSvg = extractFacts(svg, r.files[0].out);
    const fromFile = extractFacts(readFileSync(file), file);
    expect(fromSvg.ok).toBe(true);
    expect(fromSvg.facts).toEqual(fromFile.facts);
    const covered = cover(fromSvg.facts, [{ name, ir }]);
    expect(covered.missing ?? []).toEqual([]);
    expect(covered.ok).toBe(true);
    // Every label is SVG text: nothing of it depends on HTML inside the picture.
    const text = svg.toString('utf8');
    expect(text).not.toMatch(/<foreignObject|<switch|light-dark\(|--ge-/);
    expect(text).toMatch(/<text [^>]*font-family="Helvetica, Arial, sans-serif"/);
    expect(text.match(/<text\b/g).length).toBeGreaterThan(5);
  }, 120_000);

  it.skipIf(!hasPlaywright)('shows as an <img>: white background, the drawing, and the labels as text a viewer needs no HTML for', async () => {
    const ir = JSON.parse(sample('refund-check.ir.json'));
    const file = await emitTo(ir, 'img-check');
    const r = await exportSvg(file, { renderer: 'drawio-web' });
    expect(r.ok).toBe(true);
    const svg = readFileSync(r.files[0].out, 'utf8');
    // Every line the browser laid out is one text element at its place.
    for (const line of ['Start', 'Is the amount over 500 EUR &amp; approved?', 'Pay back to the card', 'Done', 'yes', 'no']) expect(svg).toContain(`>${line}</text>`);
    const browser = await pw.chromium.launch();
    try {
      const shown = await shownAsImage(browser, svg);
      expect({ width: shown.width, height: shown.height }).toEqual({ width: r.files[0].width, height: r.files[0].height });
      // The page behind the image is blue; the picture brings its own white.
      expect(pixel(shown, 2, 2)).toEqual([255, 255, 255]);
      const withText = darkPixels(shown);
      const withoutText = darkPixels(await shownAsImage(browser, svg.replace(/<text\b[\s\S]*?<\/text>/g, '')));
      expect(withoutText).toBeGreaterThan(300); // the outlines and arrows
      expect(withText).toBeGreaterThan(withoutText + 500); // and the labels on top of them
      // The same drawing as draw.io's own HTML labels give in a browser, within a few pixels of ink.
      const html = standaloneSvg(sample('refund-check.viewer.svg'), '<mxfile/>').svg;
      const asHtml = darkPixels(await shownAsImage(browser, html));
      expect(Math.abs(withText - asHtml) / asHtml).toBeLessThan(0.1);
    } finally {
      await browser.close();
    }
  }, 120_000);

  it.skipIf(!hasPlaywright)('writes one picture per page of a run into svg/, the canvas page too, without the links between pages', async () => {
    const { run, entries, xml } = await bundledRun('checkout');
    const r = await exportSvg(run, { renderer: 'drawio-web' });
    expect(r.errors).toEqual([]);
    expect(r.files.map((f) => [f.page, f.title, f.out])).toEqual([
      ['canvas', 'Checkout (canvas)', join(run, 'svg', 'canvas.drawio.svg')],
      ['checkout', 'Checkout', join(run, 'svg', 'checkout.drawio.svg')],
      ['checkout-01-payment', 'Payment by card', join(run, 'svg', 'checkout-01-payment.drawio.svg')],
    ]);
    expect(readdirSync(join(run, 'svg')).sort()).toEqual(['canvas.drawio.svg', 'checkout-01-payment.drawio.svg', 'checkout.drawio.svg']);
    const pages = drawioPages(xml).pages;
    for (const [i, f] of r.files.entries()) {
      const embedded = drawioXmlOf(readFileSync(f.out)).xml;
      expect(embedded).toBe(pages[i].xml);
      expect(embedded.match(/<diagram\b/g)).toHaveLength(1);
    }
    const main = readFileSync(join(run, 'svg', 'checkout.drawio.svg'), 'utf8');
    const picture = main.slice(main.indexOf('>', main.indexOf('viewBox=')));
    // The step keeps its label and the title of the part; the link to the other page is in the diagram only.
    expect(picture).toContain('>Take the payment</text>');
    expect(picture).toContain('>↳ Payment by card</text>');
    expect(picture).not.toMatch(/data:page|<a\b/);
    expect(drawioXmlOf(Buffer.from(main)).xml).toContain('link="data:page/id,checkout-01-payment"');
    // Every picture, the canvas included, is covered by the IRs of the run (a step that
    // refers to a part shows that part's title).
    for (const f of r.files) {
      const facts = extractFacts(readFileSync(f.out), f.out).facts;
      expect(cover(facts, entries.map((e) => ({ name: e.id, ir: e.ir })))).toMatchObject({ ok: true });
    }
  }, 120_000);

  it.skipIf(!hasPlaywright)('falls back to the files of drawio/ when the run has no combined file, and writes a second export over the first', async () => {
    const run = join(mkdtempSync(join(tmpdir(), 'zukai-export-parts-')), 'diagrams', '20261117_login');
    mkdirSync(join(run, 'drawio'), { recursive: true });
    await emitTo(flow('Login'), 'login', join(run, 'drawio'));
    await emitTo(flow('Login, business view'), 'login-business', join(run, 'drawio'));
    const first = await exportSvg(run, { renderer: 'drawio-web' });
    expect(first.files.map((f) => f.out)).toEqual([join(run, 'svg', 'login-business.drawio.svg'), join(run, 'svg', 'login.drawio.svg')]);
    await emitTo(flow('Login', { nodes: [{ id: 'start', label: 'Start', shape: 'terminal' }, { id: 'check', label: 'Check the password twice' }, { id: 'done', label: 'Done', shape: 'terminal' }] }), 'login', join(run, 'drawio'));
    const second = await exportSvg(run, { renderer: 'drawio-web' });
    expect(second.ok).toBe(true);
    const svg = readFileSync(join(run, 'svg', 'login.drawio.svg'), 'utf8');
    expect(svg).toContain('>Check the password twice</text>');
    expect(svg).not.toContain('>Check the request</text>');
  }, 120_000);

  it.skipIf(!hasPlaywright)('keeps a label that holds a table as HTML and says which, and turns formatted text into text', async () => {
    const file = join(dir, 'hand.drawio');
    writeFileSync(file, `<mxfile host="app.diagrams.net"><diagram id="h1" name="Hand made"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>
<mxCell id="t" value="&lt;table&gt;&lt;tr&gt;&lt;td&gt;cell one&lt;/td&gt;&lt;/tr&gt;&lt;/table&gt;" style="rounded=0;whiteSpace=wrap;html=1;" vertex="1" parent="1"><mxGeometry x="20" y="20" width="160" height="60" as="geometry"/></mxCell>
<mxCell id="f" value="&lt;b&gt;Bold&lt;/b&gt; and &lt;i&gt;slanted&lt;/i&gt;&lt;br&gt;&lt;u&gt;second line&lt;/u&gt;" style="rounded=1;whiteSpace=wrap;html=1;align=left;spacingLeft=6;fontColor=#CC0000;" vertex="1" parent="1"><mxGeometry x="20" y="120" width="160" height="60" as="geometry"/></mxCell>
<mxCell id="v" value="Turned" style="rounded=0;html=1;horizontal=0;labelBackgroundColor=#FFE599;" vertex="1" parent="1"><mxGeometry x="220" y="20" width="40" height="160" as="geometry"/></mxCell>
</root></mxGraphModel></diagram></mxfile>`);
    const r = await exportSvg(file, { renderer: 'drawio-web', out: join(dir, 'hand-out', 'picture.svg') });
    expect(r.errors).toEqual([]);
    expect(r.files[0].out).toBe(join(dir, 'hand-out', 'picture.svg'));
    expect(r.text).toBe('svg');
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0].message).toMatch(/^1 label holds more than text \(a table, a list, an image or right-to-left text\) and is written as HTML, which only a browser draws: "t"$/);
    const svg = readFileSync(r.files[0].out, 'utf8');
    expect(svg.match(/<foreignObject\b/g)).toHaveLength(1);
    // One line with three runs, each with its own look, anchored at the left where the label starts.
    const line = /<text (?:(?!<\/text>)[\s\S])*>Bold<\/tspan>(?:(?!<\/text>)[\s\S])*<\/text>/.exec(svg)[0];
    expect(line).not.toMatch(/text-anchor/);
    expect(line).toMatch(/<tspan [^>]*fill="#cc0000"[^>]*font-weight="bold"[^>]*>Bold<\/tspan><tspan [^>]*> and <\/tspan><tspan [^>]*font-style="italic"[^>]*>slanted<\/tspan>/);
    expect(svg).toMatch(/<text [^>]*text-decoration="underline"[^>]*>second line<\/text>/);
    // A turned label stays under its rotation, on its background.
    expect(svg).toMatch(/<g transform="rotate\(-90[^>]*>(?:(?!<\/g>)[\s\S])*<rect [^>]*fill="#ffe599"[^>]*\/><text [^>]*>Turned<\/text>/);
  }, 120_000);

  it.skipIf(!hasPlaywright || process.platform === 'win32')('takes the picture of draw.io desktop when it is installed, and still writes the labels as text and the diagram itself', async () => {
    // A stand-in for the desktop CLI that answers as draw.io does and returns the SVG draw.io
    // draws for the sample (stored from the viewer, which shares its export code).
    const bin = mkdtempSync(join(tmpdir(), 'zukai-fake-drawio-'));
    const log = join(bin, 'calls.log');
    writeFileSync(join(bin, 'drawio'), `#!/bin/sh\nif [ "$1" = "--version" ]; then echo 99.0.0; exit 0; fi\necho "$@" >> "${log}"\nwhile [ $# -gt 0 ]; do if [ "$1" = "-o" ]; then cp "${join(samples, 'refund-check.viewer.svg')}" "$2"; fi; shift; done\n`);
    chmodSync(join(bin, 'drawio'), 0o755);
    const path = process.env.PATH;
    process.env.PATH = `${bin}:${path}`;
    try {
      const file = join(dir, 'desk', 'refund-check.drawio');
      mkdirSync(join(dir, 'desk'), { recursive: true });
      writeFileSync(file, sample('refund-check.drawio'));
      const r = await exportSvg(file, { renderer: 'drawio-desktop' });
      expect(r.errors).toEqual([]);
      expect(r).toMatchObject({ ok: true, renderer: 'drawio-desktop', text: 'svg', warnings: [] });
      expect(readFileSync(log, 'utf8')).toMatch(/^-x -f svg -b 20 -o \S+page-1\.svg \S+page-1\.drawio/);
      const svg = readFileSync(join(dir, 'desk', 'refund-check.drawio.svg'), 'utf8');
      expect(drawioXmlOf(Buffer.from(svg)).xml).toBe(sample('refund-check.drawio'));
      expect(svg).not.toMatch(/<foreignObject|light-dark\(/);
      expect(svg).toContain('>Pay back to the card</text>');
    } finally {
      process.env.PATH = path;
    }
  }, 120_000);
});
