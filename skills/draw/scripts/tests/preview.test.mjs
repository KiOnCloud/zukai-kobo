import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { preview, loadPlaywright, drawioInstallPaths, findDrawioBinary, drawioExtent, drawioVertices, tileFrames, pngSize, defaultPreviewPath, mermaidBlocks } from '../src/preview.mjs';
import { decodePng, cropPng, encodePng } from '../src/png.mjs';
import { emit } from '../src/pipeline.mjs';
import { loadFixture, scriptsDir } from './helpers.mjs';

const dir = mkdtempSync(join(tmpdir(), 'zukai-preview-'));
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const hasPlaywright = loadPlaywright(scriptsDir) !== null;
const hasDrawioDesktop = findDrawioBinary().bin !== null;
/** The .drawio renderers this machine can run; the cap and tiling tests run on each. */
const drawioRenderers = [hasDrawioDesktop && 'drawio-desktop', hasPlaywright && 'drawio-web'].filter(Boolean);

/** A long single-column chain of `steps` boxes, far taller than wide: the tiling case. */
async function longChain(steps, name) {
  const ir = { schemaVersion: 1, kind: 'flowchart', title: 'Long chain', direction: 'TB', nodes: Array.from({ length: steps }, (_, i) => ({ id: `s${i}`, shape: 'process', label: `Step ${i}: check the order line and record the result` })), edges: Array.from({ length: steps - 1 }, (_, i) => ({ id: `e${i}`, from: `s${i}`, to: `s${i + 1}` })) };
  const r = await emit(ir, 'drawio', { diagramId: 'c' });
  const file = join(dir, `${name}.drawio`);
  writeFileSync(file, r.output);
  return file;
}

/** The ER of issue 36: about 1743 x 573 units, just over a 1600 px cap, readable at scale 0.9. */
const SHOP_ER = { schemaVersion: 1, kind: 'er', title: 'Shop data model', direction: 'LR', entities: [
  { id: 'customer', label: 'Customer', attributes: [{ name: 'id', type: 'uuid', key: 'pk' }, { name: 'email', type: 'varchar(255)', key: 'none', comment: 'unique, lower-cased' }, { name: 'referred_by', type: 'uuid', key: 'fk', comment: 'another customer' }] },
  { id: 'address', label: 'Address', attributes: [{ name: 'id', type: 'uuid', key: 'pk' }, { name: 'customer_id', type: 'uuid', key: 'fk' }, { name: 'line1', type: 'varchar(200)', key: 'none' }, { name: 'country', type: 'char(2)', key: 'none' }] },
  { id: 'order', label: 'Order', attributes: [{ name: 'id', type: 'uuid', key: 'pk' }, { name: 'customer_id', type: 'uuid', key: 'fk' }, { name: 'billing_address_id', type: 'uuid', key: 'fk' }, { name: 'shipping_address_id', type: 'uuid', key: 'fk' }, { name: 'total', type: 'decimal(10,2)', key: 'none' }, { name: 'status', type: 'varchar(20)', key: 'none' }] },
  { id: 'order_line', label: 'OrderLine', attributes: [{ name: 'order_id', type: 'uuid', key: 'pk' }, { name: 'line_no', type: 'int', key: 'pk' }, { name: 'product_id', type: 'uuid', key: 'fk' }, { name: 'quantity', type: 'int', key: 'none' }, { name: 'unit_price', type: 'decimal(10,2)', key: 'none' }] },
  { id: 'product', label: 'Product', attributes: [{ name: 'id', type: 'uuid', key: 'pk' }, { name: 'sku', type: 'varchar(40)', key: 'none', comment: 'unique' }, { name: 'name', type: 'varchar(200)', key: 'none' }] },
  { id: 'category', label: 'Category', attributes: [{ name: 'id', type: 'uuid', key: 'pk' }, { name: 'name', type: 'varchar(100)', key: 'none' }] },
  { id: 'product_category', label: 'ProductCategory', attributes: [{ name: 'product_id', type: 'uuid', key: 'pk' }, { name: 'category_id', type: 'uuid', key: 'pk' }] },
], relations: [
  { id: 'r1', from: 'customer', to: 'order', label: 'places', fromCardinality: 'one', toCardinality: 'many', identifying: true },
  { id: 'r2', from: 'customer', to: 'address', label: 'has', fromCardinality: 'one', toCardinality: 'one-many', identifying: true },
  { id: 'r3', from: 'address', to: 'order', label: 'bills to', fromCardinality: 'one', toCardinality: 'many', identifying: false },
  { id: 'r4', from: 'address', to: 'order', label: 'ships to', fromCardinality: 'zero-one', toCardinality: 'many', identifying: false },
  { id: 'r5', from: 'order', to: 'order_line', label: 'contains', fromCardinality: 'one', toCardinality: 'one-many', identifying: true },
  { id: 'r6', from: 'product', to: 'order_line', label: 'appears in', fromCardinality: 'one', toCardinality: 'many', identifying: false },
  { id: 'r7', from: 'product', to: 'product_category', label: 'is in', fromCardinality: 'one', toCardinality: 'many', identifying: true },
  { id: 'r8', from: 'category', to: 'product_category', label: 'groups', fromCardinality: 'one', toCardinality: 'many', identifying: true },
  { id: 'r9', from: 'customer', to: 'customer', label: 'refers', fromCardinality: 'zero-one', toCardinality: 'many', identifying: false },
] };

async function emitTo(ir, name) {
  const r = await emit(ir, 'drawio', { diagramId: 'd' });
  const file = join(dir, `${name}.drawio`);
  writeFileSync(file, r.output);
  return file;
}

/** How many of the last rows of `a` equal the first rows of `b`: the band two vertical tiles share. */
function sharedRows(a, b) {
  const pa = decodePng(readFileSync(a)); const pb = decodePng(readFileSync(b));
  const stride = pa.width * pa.bpp;
  for (let rows = Math.min(pa.height, pb.height); rows > 0; rows--) {
    if (pa.pixels.subarray((pa.height - rows) * stride).equals(pb.pixels.subarray(0, rows * stride))) return rows;
  }
  return 0;
}

/** The first vertex band (pixels along the cut axis) that no tile holds whole, or null. */
function firstCutVertex(bands, tiles) {
  return bands.find((v) => !tiles.some((t) => v.from >= t.from && v.to <= t.to)) ?? null;
}

/**
 * A stand-in for the draw.io desktop CLI on PATH: it answers `--version` and writes, for
 * `-x -f png -s <scale> -b <border> -o <out> <file>`, a white PNG of the size draw.io
 * produces, `ceil(scale * extent) + 2 * border` a side (the border does not scale). It
 * lets the desktop path run where draw.io is not installed; the real binary is used when it is.
 */
function fakeDrawioOnPath() {
  const bin = mkdtempSync(join(tmpdir(), 'zukai-fake-drawio-'));
  const script = `#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { drawioExtent } from ${JSON.stringify(pathToFileURL(join(scriptsDir, 'src', 'preview.mjs')).href)};
import { encodePng } from ${JSON.stringify(pathToFileURL(join(scriptsDir, 'src', 'png.mjs')).href)};
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('99.0.0'); process.exit(0); }
const opt = (flag) => args[args.indexOf(flag) + 1];
const scale = Number(opt('-s')); const border = Number(opt('-b'));
const file = args.find((a, i) => a.endsWith('.drawio') && args[i - 1] !== '-o');
const extent = drawioExtent(readFileSync(file, 'utf8'));
const width = Math.ceil(scale * extent.width) + 2 * border; const height = Math.ceil(scale * extent.height) + 2 * border;
writeFileSync(opt('-o'), encodePng({ width, height, bitDepth: 8, colorType: 6, bpp: 4, pixels: Buffer.alloc(width * height * 4, 0xff) }));
`;
  writeFileSync(join(bin, 'drawio.mjs'), script);
  writeFileSync(join(bin, 'drawio'), `#!/bin/sh\nexec node "${join(bin, 'drawio.mjs')}" "$@"\n`);
  chmodSync(join(bin, 'drawio'), 0o755);
  const path = process.env.PATH;
  process.env.PATH = `${bin}:${path}`;
  return () => { process.env.PATH = path; };
}

describe('preview', () => {
  it('knows the default install paths of draw.io desktop per platform', () => {
    expect(drawioInstallPaths('darwin', {}, '/Users/me')).toEqual(['/Applications/draw.io.app/Contents/MacOS/draw.io', '/Users/me/Applications/draw.io.app/Contents/MacOS/draw.io']);
    expect(drawioInstallPaths('win32', { ProgramFiles: 'C:\\PF', LOCALAPPDATA: 'C:\\U\\me\\AppData\\Local' }, 'C:\\U\\me')).toEqual([join('C:\\PF', 'draw.io', 'draw.io.exe'), join('C:\\U\\me\\AppData\\Local', 'Programs', 'draw.io', 'draw.io.exe')]);
    expect(drawioInstallPaths('linux', {}, '/home/me')).toContain('/opt/drawio/drawio');
    const found = findDrawioBinary();
    expect(found.tried[0]).toBe('drawio on PATH');
    expect(found.tried.length).toBeGreaterThan(2);
  });

  it.skipIf(hasPlaywright)('names every place it looked for draw.io when no renderer renders a .drawio file', async () => {
    const file = join(dir, 'x.drawio');
    writeFileSync(file, '<mxfile compressed="false"><diagram id="d" name="d"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>');
    const r = await preview(file, { out: join(dir, 'x.png') });
    if (!r.ok) {
      expect(r.errors[0].message).toContain('draw.io desktop');
      if (r.errors[0].message.includes('not found')) expect(r.errors[0].message).toMatch(/looked for drawio on PATH, draw\.io on PATH, \//);
    }
  });

  it('issue 34: reads the extent of a draw.io page from its cells', async () => {
    const r = await emit(loadFixture('activity', 'valid-business-fulfilment'), 'drawio', { diagramId: 'a' });
    const extent = drawioExtent(r.output);
    expect(extent.width).toBeGreaterThan(500);
    expect(extent.height).toBeGreaterThan(extent.width);
    expect(drawioExtent('<mxfile><diagram id="d" name="d"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>')).toEqual({ width: 800, height: 600 });
  });

  it.skipIf(drawioRenderers.length === 0).each(drawioRenderers)('issue 34: --max-px caps the longest side and tiles a tall diagram (%s)', async (renderer) => {
    const r = await emit(loadFixture('activity', 'valid-business-fulfilment'), 'drawio', { diagramId: 'a' });
    const file = join(dir, `cap-${renderer}.drawio`);
    writeFileSync(file, r.output);
    const capped = await preview(file, { out: join(dir, `cap-${renderer}.png`), maxPx: 600, renderer });
    expect(capped.ok).toBe(true);
    expect(capped.renderer).toBe(renderer);
    expect(capped.files).toHaveLength(1);
    const size = pngSize(capped.out);
    expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(600);
    // A long single-lane chain is far taller than wide: under a small cap it comes back as tiles at scale 1.
    const chain = { schemaVersion: 1, kind: 'activity', title: 'Chain', direction: 'TB', lanes: [{ id: 'l', label: 'Lane' }], actions: Array.from({ length: 10 }, (_, i) => ({ id: `a${i}`, label: `Step ${i + 1}`, lane: 'l' })), controls: [], flows: Array.from({ length: 9 }, (_, i) => ({ id: `f${i}`, from: `a${i}`, to: `a${i + 1}` })) };
    const c = await emit(chain, 'drawio', { diagramId: 'c' });
    const tallFile = join(dir, `tall-${renderer}.drawio`);
    writeFileSync(tallFile, c.output);
    const tall = await preview(tallFile, { out: join(dir, `tiles-${renderer}.png`), maxPx: 400, renderer });
    expect(tall.ok).toBe(true);
    expect(tall.tiled).toBe(true);
    expect(tall.scale).toBe(1);
    expect(tall.files.length).toBeGreaterThan(1);
    expect(tall.out).toBe(tall.files[0]);
    for (const f of tall.files) { const s = pngSize(f); expect(s.height).toBeLessThanOrEqual(400); expect(s.width).toBeLessThanOrEqual(400); }
  }, 180_000);

  it.skipIf(drawioRenderers.length === 0).each(drawioRenderers)('issue 35: a 30-step chain under --max-px 1600 comes back as readable tiles (%s)', async (renderer) => {
    const file = await longChain(30, `issue35-${renderer}`);
    const r = await preview(file, { out: join(dir, `issue35-${renderer}.png`), maxPx: 1600, renderer });
    expect(r.ok, JSON.stringify(r.errors)).toBe(true);
    expect(r.renderer).toBe(renderer);
    expect(r.tiled).toBe(true);
    expect(r.scale).toBe(1);
    expect(r.files.length).toBeGreaterThanOrEqual(2);
    for (const f of r.files) { const s = pngSize(f); expect(Math.max(s.width, s.height), f).toBeLessThanOrEqual(1600); }
    // issue 36: tiles overlap by at least the tallest box (plus margin), all the same height, and the band
    // two consecutive tiles share is really drawn twice.
    const tallest = Math.max(...drawioVertices(readFileSync(file, 'utf8')).map((v) => v.height));
    expect(r.overlap).toBeGreaterThanOrEqual(tallest);
    const heights = r.files.map((f) => pngSize(f).height);
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(1);
    expect(sharedRows(r.files[0], r.files[1])).toBeGreaterThanOrEqual(r.overlap - 2);
  }, 180_000);

  it.skipIf(drawioRenderers.length === 0).each(drawioRenderers)('issue 36: a diagram just over the cap is one image at a lower scale, not slivers (%s)', async (renderer) => {
    const file = await emitTo(SHOP_ER, `shop-er-${renderer}`);
    // A cap at 85 % of the long side with its border: the diagram is just over it, far from the scale of 0.6 where tiling starts.
    const extent = drawioExtent(readFileSync(file, 'utf8'));
    const maxPx = Math.round(0.85 * (Math.max(extent.width, extent.height) + 40));
    const r = await preview(file, { out: join(dir, `shop-er-${renderer}.png`), maxPx, renderer });
    expect(r.ok, JSON.stringify(r.errors)).toBe(true);
    expect(r.tiled).toBe(false);
    expect(r.files).toHaveLength(1);
    expect(r.scale).toBeGreaterThanOrEqual(0.6);
    expect(r.scale).toBeLessThan(1);
    expect(Math.max(...Object.values(pngSize(r.out)))).toBeLessThanOrEqual(maxPx);
  }, 180_000);

  it('issue 36: tile frames split the long axis evenly with the asked overlap and never exceed the cap', () => {
    expect(tileFrames(300, 1000, 1600, 50)).toEqual([{ x: 0, y: 0, width: 300, height: 1000 }]);
    for (const [w, h, max, o] of [[300, 3580, 1600, 90], [3580, 300, 1600, 90], [1000, 5000, 800, 400], [200, 1601, 1600, 0], [200, 4000, 1600, 1500]]) {
      const frames = tileFrames(w, h, max, o);
      const vertical = h >= w;
      const total = vertical ? h : w;
      const len = (f) => (vertical ? f.height : f.width);
      const off = (f) => (vertical ? f.y : f.x);
      expect(frames.length).toBeGreaterThanOrEqual(2);
      expect(off(frames[0])).toBe(0);
      expect(off(frames.at(-1)) + len(frames.at(-1))).toBe(total);
      for (const f of frames) { expect(len(f)).toBeLessThanOrEqual(max); expect(vertical ? f.width : f.height).toBe(vertical ? w : h); }
      expect(new Set(frames.map(len)).size).toBe(1);
      const want = Math.min(o, Math.floor(max / 2));
      for (let i = 1; i < frames.length; i++) expect(off(frames[i - 1]) + len(frames[i - 1]) - off(frames[i]), `${w}x${h}/${max}`).toBeGreaterThanOrEqual(want - 1);
      expect(frames.length).toBe(Math.ceil((total - want) / (max - want)));
    }
  });

  it.skipIf(!hasPlaywright)('issue 36: a long Mermaid flowchart is tiled with an overlap measured from its nodes', async () => {
    const lines = ['flowchart TB'];
    for (let i = 0; i < 30; i++) lines.push(`  s${i}["Step ${i}: check the order line and record the result"]`);
    for (let i = 0; i < 29; i++) lines.push(`  s${i} --> s${i + 1}`);
    const file = join(dir, 'long.mmd');
    writeFileSync(file, lines.join('\n'));
    const r = await preview(file, { out: join(dir, 'long-mmd.png'), maxPx: 1600 });
    expect(r.ok, JSON.stringify(r.errors)).toBe(true);
    expect(r.tiled).toBe(true);
    expect(r.scale).toBe(1);
    expect(r.overlap).toBeGreaterThan(40); // a node plus the margin, not the margin alone
    for (const f of r.files) { const s = pngSize(f); expect(Math.max(s.width, s.height)).toBeLessThanOrEqual(1600); }
    expect(sharedRows(r.files[0], r.files[1])).toBeGreaterThanOrEqual(r.overlap - 2);
  }, 180_000);

  it('issue 35: decodes, crops and re-encodes a PNG', () => {
    const width = 30; const height = 90;
    const pixels = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixels.set([x * 8, y * 2, 7, 255], (y * width + x) * 4);
    const source = { width, height, bitDepth: 8, colorType: 6, bpp: 4, pixels };
    const encoded = encodePng(source);
    expect(encoded.subarray(0, 4).equals(PNG_MAGIC)).toBe(true);
    const decoded = decodePng(encoded);
    expect([decoded.width, decoded.height, decoded.bpp]).toEqual([width, height, 4]);
    expect(decoded.pixels.equals(pixels)).toBe(true);
    const tile = cropPng(decoded, { x: 0, y: 40, width, height: 25 });
    expect([tile.width, tile.height]).toEqual([width, 25]);
    expect([...tile.pixels.subarray(0, 4)]).toEqual([0, 80, 7, 255]);
    expect([...tile.pixels.subarray((24 * width + 29) * 4, (24 * width + 30) * 4)]).toEqual([232, 128, 7, 255]);
    const file = join(dir, 'tile.png');
    writeFileSync(file, encodePng(tile));
    expect(pngSize(file)).toEqual({ width, height: 25 });
    expect(() => cropPng(decoded, { x: 0, y: 80, width, height: 20 })).toThrow(/outside/);
    expect(() => decodePng(Buffer.from('not a png at all'))).toThrow(/not a PNG/);
  });

  it.skipIf(!hasPlaywright)('issue 35: Chromium reads a tile cut from a Chromium screenshot', async () => {
    // A real export goes through decode -> crop -> encode; the browser must accept the result.
    const src = join(scriptsDir, 'tests', 'snapshots', 'drawio', 'sequence-valid.drawio');
    const file = join(dir, 'roundtrip.drawio');
    writeFileSync(file, readFileSync(src));
    const r = await preview(file, { out: join(dir, 'roundtrip.png'), renderer: 'drawio-web' });
    expect(r.ok).toBe(true);
    const png = decodePng(readFileSync(r.out));
    const tile = encodePng(cropPng(png, { x: 0, y: 0, width: png.width, height: Math.floor(png.height / 2) }));
    const pw = loadPlaywright(scriptsDir);
    const browser = await pw.chromium.launch();
    try {
      const page = await browser.newPage();
      const size = await page.evaluate((data) => new Promise((done, fail) => { const img = new Image(); img.onload = () => done([img.naturalWidth, img.naturalHeight]); img.onerror = () => fail(new Error('bad PNG')); img.src = `data:image/png;base64,${data}`; }), tile.toString('base64'));
      expect(size).toEqual([png.width, Math.floor(png.height / 2)]);
    } finally {
      await browser.close();
    }
  }, 120_000);

  it.skipIf(process.platform === 'win32')('issue 35: the draw.io desktop path tiles a long diagram and keeps the border within the cap', async () => {
    const restore = fakeDrawioOnPath();
    try {
      expect(findDrawioBinary().bin).toBe('drawio');
      // The repro from the issue: 30 steps in one column, cap 1600.
      const long = await preview(await longChain(30, 'fake-long'), { out: join(dir, 'fake-long.png'), maxPx: 1600, renderer: 'drawio-desktop' });
      expect(long.ok, JSON.stringify(long.errors)).toBe(true);
      expect(long.renderer).toBe('drawio-desktop');
      expect(long.tiled).toBe(true);
      expect(long.scale).toBe(1);
      expect(long.files.length).toBeGreaterThanOrEqual(2);
      expect(long.files[0]).toBe(join(dir, 'fake-long-1.png'));
      expect(existsSync(join(dir, 'fake-long.png'))).toBe(false);
      for (const f of long.files) { const s = pngSize(f); expect(s.height).toBeLessThanOrEqual(1600); expect(s.width).toBeLessThanOrEqual(1600); }
      // issue 36: the fake writes ceil(extent) + 2 * 20 px at scale 1, so a vertex at y is at 20 + (y - minY) px;
      // with an overlap of the tallest box every box is whole in at least one tile.
      const xml = readFileSync(join(dir, 'fake-long.drawio'), 'utf8');
      const vertices = drawioVertices(xml);
      const minY = Math.min(...vertices.map((v) => v.y));
      const tallest = Math.max(...vertices.map((v) => v.height));
      expect(long.overlap).toBeGreaterThanOrEqual(tallest + 40);
      const lens = long.files.map((f) => pngSize(f).height);
      expect(Math.max(...lens) - Math.min(...lens)).toBeLessThanOrEqual(1);
      const step = (Math.ceil(drawioExtent(xml).height) + 40 - lens[0]) / (long.files.length - 1);
      const tiles = long.files.map((_, i) => ({ from: Math.floor(i * step), to: Math.floor(i * step) + lens[0] }));
      expect(tiles.at(-1).to).toBe(Math.ceil(drawioExtent(xml).height) + 40);
      expect(firstCutVertex(vertices.map((v) => ({ from: 20 + v.y - minY, to: 20 + v.y - minY + v.height })), tiles)).toBeNull();
      // issue 36: the ER just over the cap is one image at about scale 0.9, not a 1600 px tile and a sliver.
      const er = await preview(await emitTo(SHOP_ER, 'fake-er'), { out: join(dir, 'fake-er.png'), maxPx: 1600, renderer: 'drawio-desktop' });
      expect(er.ok).toBe(true);
      expect(er.tiled).toBe(false);
      expect(er.files).toEqual([join(dir, 'fake-er.png')]);
      expect(er.scale).toBeGreaterThanOrEqual(0.6);
      expect(pngSize(er.out).width).toBeLessThanOrEqual(1600);
      // An 822 x 300 drawing: the old formula (2 * cap / size) gave scale 1.9 and a 1602 px wide PNG.
      const wide = join(dir, 'fake-wide.drawio');
      writeFileSync(wide, '<mxfile compressed="false"><diagram id="d" name="d"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="a" value="a" style="rounded=0" vertex="1" parent="1"><mxGeometry x="0" y="0" width="822" height="300" as="geometry"/></mxCell></root></mxGraphModel></diagram></mxfile>');
      const capped = await preview(wide, { out: join(dir, 'fake-wide.png'), maxPx: 1600, renderer: 'drawio-desktop' });
      expect(capped.ok).toBe(true);
      expect(capped.tiled).toBe(false);
      expect(capped.files).toEqual([join(dir, 'fake-wide.png')]);
      expect(pngSize(capped.out).width).toBeLessThanOrEqual(1600);
      expect(capped.scale).toBeGreaterThan(1.8);
      // Nothing to do when the scale-2 export already fits.
      const small = await preview(wide, { out: join(dir, 'fake-small.png'), maxPx: 2000, renderer: 'drawio-desktop' });
      expect(small.scale).toBe(2);
      expect(pngSize(small.out)).toEqual({ width: 1684, height: 640 });
      // A long diagram whose short side is itself over the cap is tiled at the scale that fits that side.
      const fat = join(dir, 'fake-fat.drawio');
      writeFileSync(fat, '<mxfile compressed="false"><diagram id="d" name="d"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="a" value="a" style="rounded=0" vertex="1" parent="1"><mxGeometry x="0" y="0" width="1000" height="5000" as="geometry"/></mxCell></root></mxGraphModel></diagram></mxfile>');
      const fatR = await preview(fat, { out: join(dir, 'fake-fat.png'), maxPx: 800, renderer: 'drawio-desktop' });
      expect(fatR.tiled).toBe(true);
      expect(fatR.scale).toBeLessThan(1);
      for (const f of fatR.files) { const s = pngSize(f); expect(Math.max(s.width, s.height)).toBeLessThanOrEqual(800); }
    } finally {
      restore();
    }
  }, 60_000);

  it('rejects files that are not .drawio or .mmd', async () => {
    const r = await preview(join(scriptsDir, 'package.json'));
    expect(r.ok).toBe(false);
    expect(r.errors[0].message).toContain('.drawio or .mmd');
  });

  it('reports a missing file', async () => {
    const r = await preview(join(dir, 'missing.mmd'));
    expect(r.ok).toBe(false);
    expect(r.errors[0].message).toContain('cannot read');
  });

  it.skipIf(!hasPlaywright)('renders a .drawio file to PNG through the draw.io viewer page', async () => {
    const src = join(scriptsDir, 'tests', 'snapshots', 'drawio', 'sequence-valid.drawio');
    const file = join(dir, 'sequence.drawio');
    writeFileSync(file, readFileSync(src));
    const r = await preview(file);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.out).toBe(defaultPreviewPath(file));
    expect(r.out).toMatch(/zukai-preview[\\/]sequence-drawio-[0-9a-f]{8}\.png$/);
    expect(existsSync(r.out)).toBe(true);
    expect(readFileSync(r.out).subarray(0, 4).equals(PNG_MAGIC)).toBe(true);
  }, 120_000);

  it.skipIf(!hasPlaywright)('renders a .mmd file to PNG with Mermaid', async () => {
    const src = join(scriptsDir, 'tests', 'snapshots', 'mermaid', 'flowchart-valid.mmd');
    const file = join(dir, 'flow.mmd');
    writeFileSync(file, readFileSync(src));
    const r = await preview(file, { out: join(dir, 'custom.png') });
    expect(r.errors).toEqual([]);
    expect(r.renderer).toBe('mermaid-web');
    expect(readFileSync(join(dir, 'custom.png')).subarray(0, 4).equals(PNG_MAGIC)).toBe(true);
  }, 120_000);

  it.skipIf(!hasPlaywright)('shows a Mermaid diagram wider than the window it is measured in whole, not cut at 2000 px', async () => {
    const steps = Array.from({ length: 26 }, (_, i) => `  s${i}["Step number ${i}"]`);
    const links = Array.from({ length: 25 }, (_, i) => `  s${i} --> s${i + 1}`);
    const file = join(dir, 'wide.mmd');
    writeFileSync(file, ['flowchart LR', ...steps, ...links, ''].join('\n'));
    const r = await preview(file, { out: join(dir, 'wide.png') });
    expect(r.errors).toEqual([]);
    // At scale 2 a drawing cut to the 2000 px window came out exactly 4000 px wide.
    expect(r.scale).toBe(2);
    expect(pngSize(join(dir, 'wide.png')).width).toBeGreaterThan(4200);
  }, 120_000);

  it.skipIf(!hasPlaywright)('reports a Mermaid syntax error instead of a blank image', async () => {
    const file = join(dir, 'broken.mmd');
    writeFileSync(file, 'flowchart TB\n  a --> \n  --> b\n');
    const r = await preview(file);
    expect(r.ok).toBe(false);
    expect(r.errors[0].message).toContain('Mermaid could not render');
  }, 120_000);
});
