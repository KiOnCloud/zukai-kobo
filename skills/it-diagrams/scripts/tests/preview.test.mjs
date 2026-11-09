import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { preview, loadPlaywright, drawioInstallPaths, findDrawioBinary, drawioExtent, pngSize } from '../src/preview.mjs';
import { decodePng, cropPng, encodePng } from '../src/png.mjs';
import { emit } from '../src/pipeline.mjs';
import { loadFixture, scriptsDir } from './helpers.mjs';

const dir = mkdtempSync(join(tmpdir(), 'it-diagrams-preview-'));
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

/**
 * A stand-in for the draw.io desktop CLI on PATH: it answers `--version` and writes, for
 * `-x -f png -s <scale> -b <border> -o <out> <file>`, a white PNG of the size draw.io
 * produces, `ceil(scale * extent) + 2 * border` a side (the border does not scale). It
 * lets the desktop path run where draw.io is not installed; the real binary is used when it is.
 */
function fakeDrawioOnPath() {
  const bin = mkdtempSync(join(tmpdir(), 'it-diagrams-fake-drawio-'));
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
      let total = 0;
      for (const f of long.files) { const s = pngSize(f); expect(s.height).toBeLessThanOrEqual(1600); expect(s.width).toBeLessThanOrEqual(1600); total += s.height; }
      const extent = drawioExtent(readFileSync(join(dir, 'fake-long.drawio'), 'utf8'));
      expect(total).toBe(Math.ceil(extent.height) + 40); // the tiles together are the whole scale-1 export
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
    expect(r.out).toBe(join(tmpdir(), 'it-diagrams-preview', 'sequence.png'));
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

  it.skipIf(!hasPlaywright)('reports a Mermaid syntax error instead of a blank image', async () => {
    const file = join(dir, 'broken.mmd');
    writeFileSync(file, 'flowchart TB\n  a --> \n  --> b\n');
    const r = await preview(file);
    expect(r.ok).toBe(false);
    expect(r.errors[0].message).toContain('Mermaid could not render');
  }, 120_000);
});
