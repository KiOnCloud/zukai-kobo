/**
 * Render a .drawio or .mmd file to a temporary PNG that the agent looks at to judge the layout
 * and fix the IR. The image is not a deliverable for the user. Optional step:
 * it needs a renderer that is not bundled. In order of preference:
 *   1. the draw.io desktop CLI (`drawio` on PATH) for .drawio files, fully offline;
 *   2. Playwright with Chromium (project-local, global, or NODE_PATH), which loads the
 *      draw.io viewer page (diagram passed in the URL fragment, which never leaves the
 *      browser) or the Mermaid library in a local browser. The diagram text is rendered
 *      inside that browser and never uploaded; only the renderer itself is fetched.
 */
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { pngSize, decodePng, cropPng, encodePng } from './png.mjs';

export { pngSize };

const MERMAID_CDN = 'https://cdn.jsdelivr.net/npm/mermaid@12.3.0/dist/mermaid.esm.min.mjs';
/** White space kept around the drawing in a preview, CSS px. */
const MARGIN = 20;
/** The viewer fits the drawing to the window minus `border`, so a window of extent + 2 * MARGIN shows it at scale 1. */
const DRAWIO_VIEWER = `https://viewer.diagrams.net/?lightbox=1&nav=0&layers=0&highlight=none&edit=_blank&border=${MARGIN}`;

let globalRoot;
/** The global node_modules folder (`npm root -g`), looked up once; null when npm is missing. */
export function npmGlobalRoot() {
  if (globalRoot !== undefined) return globalRoot;
  const r = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['root', '-g'], { encoding: 'utf8', timeout: 15_000, shell: process.platform === 'win32' });
  globalRoot = !r.error && r.status === 0 && r.stdout.trim() ? r.stdout.trim() : null;
  return globalRoot;
}

/**
 * Playwright from the working directory's project, from next to this module, or from the
 * global npm root (whatever prefix npm uses), in that order; NODE_PATH works as well.
 */
export function loadPlaywright(cwd = process.cwd()) {
  const bases = [join(cwd, 'package.json'), import.meta.url];
  const root = npmGlobalRoot();
  if (root) bases.push(join(root, 'package.json'));
  for (const base of bases) {
    try {
      return createRequire(base)('playwright');
    } catch {
      // try the next resolution root
    }
  }
  return null;
}

/**
 * Where the draw.io desktop app installs its executable when it adds nothing to PATH: the
 * macOS app bundle (system or per-user), the Windows installers (per machine or per user),
 * and the Linux .deb, snap and flatpak-less tarball locations.
 */
export function drawioInstallPaths(platform = process.platform, env = process.env, home = homedir()) {
  if (platform === 'darwin') return ['/Applications/draw.io.app/Contents/MacOS/draw.io', join(home, 'Applications', 'draw.io.app', 'Contents', 'MacOS', 'draw.io')];
  if (platform === 'win32') {
    return [
      join(env.ProgramFiles ?? 'C:\\Program Files', 'draw.io', 'draw.io.exe'),
      join(env.LOCALAPPDATA ?? join(home, 'AppData', 'Local'), 'Programs', 'draw.io', 'draw.io.exe'),
    ];
  }
  return ['/opt/drawio/drawio', '/usr/bin/drawio', '/snap/bin/drawio', '/opt/draw.io/drawio'];
}

/**
 * The draw.io desktop executable: `drawio` or `draw.io` on PATH, else the first default
 * install path that exists. Returns the command and the list of places tried.
 */
export function findDrawioBinary() {
  const tried = [];
  for (const bin of ['drawio', 'draw.io']) {
    tried.push(`${bin} on PATH`);
    const r = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 10_000 });
    if (!r.error && r.status === 0) return { bin, tried };
  }
  for (const candidate of drawioInstallPaths()) {
    tried.push(candidate);
    if (existsSync(candidate)) return { bin: candidate, tried };
  }
  return { bin: null, tried };
}

/** Frame draw.io desktop draws around an export, in output pixels, whatever the scale. */
const BORDER = 20;
/** Below this single-image scale the text is too small to review; a long diagram is tiled instead. */
const TILE_BELOW = 0.6;

/**
 * Frames that cut a `width` x `height` image into tiles along its long axis, each at most
 * `maxLen` long, as few as the cap allows, all the same length and evenly spread so that
 * consecutive tiles overlap by at least `overlap` pixels (at most half a tile). An overlap
 * of the largest node along the axis keeps every node whole in at least one tile.
 */
export function tileFrames(width, height, maxLen, overlap = 0) {
  const vertical = height >= width;
  const total = vertical ? height : width;
  if (total <= maxLen) return [{ x: 0, y: 0, width, height }];
  const o = Math.min(Math.max(0, Math.ceil(overlap)), Math.floor(maxLen / 2));
  const count = Math.ceil((total - o) / (maxLen - o));
  const len = Math.ceil((total + (count - 1) * o) / count);
  const step = (total - len) / (count - 1);
  return Array.from({ length: count }, (_, i) => {
    const off = Math.floor(i * step);
    return vertical ? { x: 0, y: off, width, height: len } : { x: off, y: 0, width: len, height };
  });
}

/**
 * draw.io desktop exports at scale 2. Under `maxPx` the scale that fits comes from that
 * first export: the drawing is (size - 2 * BORDER) / 2 units long, so scale s gives about
 * s * units + 2 * BORDER px, and the size is checked after the export because draw.io rounds.
 * A diagram at least twice as long as it is wide that would fall below TILE_BELOW is instead
 * exported at scale 1 (or the scale that fits its short side) and the PNG is cut into
 * overlapping tiles along its long axis, each within the cap, written as `<out>-1.png`,
 * `<out>-2.png`, ...; `xml` is the file's content, for the node sizes that set the overlap.
 */
function renderDrawioDesktop(bin, file, xml, out, maxPx) {
  const run = (scale) => {
    const args = ['-x', '-f', 'png', '-s', String(scale), '-b', String(BORDER), '-o', out, file];
    if (process.platform === 'linux') args.push('--no-sandbox', '--disable-gpu');
    const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 120_000 });
    if (r.error || r.status !== 0) return { ok: false, message: (r.stderr || r.error?.message || 'draw.io export failed').trim().slice(0, 300) };
    return { ok: true, scale, files: [out] };
  };
  let r = run(2);
  if (!r.ok || !maxPx) return r;
  const size = pngSize(out);
  if (Math.max(size.width, size.height) <= maxPx) return r;
  const units = { long: (Math.max(size.width, size.height) - 2 * BORDER) / 2, short: (Math.min(size.width, size.height) - 2 * BORDER) / 2 };
  const fit = (px, u) => Math.max(0.1, Math.floor(((px - 2 * BORDER) / Math.max(u, 1)) * 100) / 100);
  const tiled = fit(maxPx, units.long) < TILE_BELOW && units.long >= 2 * units.short;
  let scale = tiled ? Math.min(1, fit(maxPx, units.short)) : fit(maxPx, units.long);
  for (let attempt = 0; ; attempt++) {
    r = run(scale);
    if (!r.ok) return r;
    const s = pngSize(out);
    const side = tiled ? Math.min(s.width, s.height) : Math.max(s.width, s.height);
    if (side <= maxPx || scale <= 0.1 || attempt >= 2) break;
    scale = Math.max(0.1, Math.floor((scale - 0.01) * 100) / 100);
  }
  if (!tiled) return r;
  let png;
  try {
    png = decodePng(readFileSync(out));
  } catch {
    return run(fit(maxPx, units.long)); // an export this module cannot cut: fall back to the fitting scale
  }
  const vertical = png.height >= png.width;
  const extent = drawioExtent(xml);
  const pxPerUnit = ((vertical ? png.height : png.width) - 2 * BORDER) / Math.max(vertical ? extent.height : extent.width, 1);
  const node = Math.max(0, ...drawioVertices(xml).map((v) => (vertical ? v.height : v.width))) * pxPerUnit;
  const overlap = Math.min(Math.ceil(node + 2 * BORDER), Math.floor(maxPx / 2));
  const frames = tileFrames(png.width, png.height, maxPx, overlap);
  if (frames.length < 2) return r;
  const base = out.replace(/\.png$/i, '');
  const files = frames.map((frame, i) => {
    const target = `${base}-${i + 1}.png`;
    writeFileSync(target, encodePng(cropPng(png, frame)));
    return target;
  });
  rmSync(out, { force: true });
  return { ok: true, scale, files, tiled: true, overlap };
}

/**
 * The page-level cells (parent "1") of the first page of a .drawio file, each with its
 * attribute text and body. Self-closing cells ("0" and "1") are skipped, or they would
 * swallow the next cell's body.
 */
function* pageCells(xml) {
  const page = xml.match(/<diagram\b[\s\S]*?<\/diagram>/)?.[0] ?? xml;
  for (const m of page.matchAll(/<mxCell\b([^>]*?)(?<!\/)>([\s\S]*?)<\/mxCell>/g)) {
    if (/\sparent="1"(?:\s|$)/.test(m[1])) yield { attrs: m[1], body: m[2] };
  }
}

/** Position and size, in diagram units, of every page-level vertex of the first page. */
export function drawioVertices(xml) {
  const out = [];
  for (const c of pageCells(xml)) {
    if (!/\svertex="1"/.test(c.attrs)) continue;
    const g = /<mxGeometry x="(-?[\d.]+)" y="(-?[\d.]+)" width="(-?[\d.]+)" height="(-?[\d.]+)"/.exec(c.body);
    if (g) out.push({ x: +g[1], y: +g[2], width: +g[3], height: +g[4] });
  }
  return out;
}

/**
 * Extent of the first page of a .drawio file in diagram units, from the page-level cells
 * (vertices with parent "1" and the waypoints of their edges). The viewer fits the page to
 * the window, so a window of this size shows the diagram at about scale 1.
 */
export function drawioExtent(xml) {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  const extend = (x, y) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); };
  for (const v of drawioVertices(xml)) { extend(v.x, v.y); extend(v.x + v.width, v.y + v.height); }
  for (const c of pageCells(xml)) {
    if (/\sedge="1"/.test(c.attrs)) for (const p of c.body.matchAll(/<mxPoint x="(-?[\d.]+)" y="(-?[\d.]+)"/g)) extend(+p[1], +p[2]);
  }
  if (!Number.isFinite(minX)) return { width: 800, height: 600 };
  return { width: Math.ceil(maxX - minX), height: Math.ceil(maxY - minY) };
}

/** Chromium refuses screenshots past about 16k px a side. */
const MAX_SIDE = 15000;

/**
 * Screenshot a region of the page at the scale that keeps its longest side within `maxPx`
 * (2 when unlimited). The region is the one `locate` measures on a probe page, or, when
 * `fixed` is given, that size with the window made to match it (draw.io's viewer fits the
 * diagram to the window). A region much taller or wider than it is high would shrink below
 * TILE_BELOW under the cap, so it is cut into tiles along its long axis instead, each one
 * within the cap at scale 1 (or at the scale that fits the short side), overlapping by the
 * largest node that `measure` reports (CSS px) so every node is whole in one tile; the
 * tiles are written as `<out>-1.png`, `<out>-2.png`, ...
 */
async function shoot(browser, url, setup, locate, measure, out, maxPx, fixed) {
  const margin = MARGIN;
  let region;
  if (fixed) {
    const cap = (v) => Math.min(Math.max(Math.ceil(v), 200), 8000);
    region = { x: 0, y: 0, width: cap(fixed.width + 2 * margin), height: cap(fixed.height + 2 * margin) };
  } else {
    const probe = await browser.newPage({ viewport: { width: 2000, height: 1400 }, deviceScaleFactor: 1 });
    await setup(probe, url);
    const box = await locate(probe);
    await probe.close();
    if (!box) return { ok: false, message: 'the renderer drew nothing' };
    region = { x: Math.max(0, box.x - margin), y: Math.max(0, box.y - margin), width: box.width + 2 * margin, height: box.height + 2 * margin };
  }
  const longest = Math.max(region.width, region.height);
  const shortest = Math.min(region.width, region.height);
  let scale = Math.min(maxPx ? maxPx / longest : 2, 2, MAX_SIDE / longest);
  const tiled = Boolean(maxPx) && scale < TILE_BELOW && longest >= 2 * shortest;
  // Tiles at scale 1 unless even the short side is over the cap.
  if (tiled) scale = Math.min(1, maxPx / shortest);
  const viewport = fixed ? { width: region.width, height: region.height } : { width: Math.ceil(region.x + region.width) + 50, height: Math.ceil(region.y + region.height) + 50 };
  const page = await browser.newPage({ viewport, deviceScaleFactor: scale });
  await setup(page, url);
  const box = await locate(page);
  if (!tiled) {
    await page.screenshot({ path: out, clip: region });
    await page.close();
    return { ok: true, scale, files: [out] };
  }
  const node = (await measure(page, box)) ?? { width: 0, height: 0 };
  // CSS px per tile; a fractional scale rounds, so leave a pixel.
  const maxLen = scale === 1 ? maxPx : Math.floor((maxPx - 1) / scale);
  const overlap = Math.min(Math.ceil((region.height >= region.width ? node.height : node.width) + 2 * margin), Math.floor(maxLen / 2));
  const base = out.replace(/\.png$/i, '');
  const files = [];
  for (const [i, frame] of tileFrames(region.width, region.height, maxLen, overlap).entries()) {
    const file = `${base}-${i + 1}.png`;
    await page.screenshot({ path: file, clip: { ...frame, x: frame.x + region.x, y: frame.y + region.y } });
    files.push(file);
  }
  await page.close();
  return { ok: true, scale, files, tiled: true, overlap: Math.round(overlap * scale) };
}

async function renderDrawioWeb(pw, xml, out, maxPx) {
  const browser = await pw.chromium.launch();
  try {
    const url = `${DRAWIO_VIEWER}#R${encodeURIComponent(xml)}`;
    const setup = (page, target) => page.goto(target, { waitUntil: 'load', timeout: 90_000 });
    const locate = async (page) => {
      const drawing = page.locator('.geDiagramContainer svg > g').first();
      await drawing.waitFor({ state: 'visible', timeout: 60_000 });
      await page.waitForTimeout(500);
      return drawing.boundingBox();
    };
    const extent = drawioExtent(xml);
    // The largest vertex of the page in CSS px: the viewer fits the drawing to the window at
    // its own scale, read off the drawn shapes (groups and the HTML label frames span far
    // beyond the drawing).
    const measure = async (page) => {
      const v = drawioVertices(xml);
      if (v.length === 0) return null;
      const drawn = await page.evaluate(() => {
        let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
        for (const el of document.querySelectorAll('.geDiagramContainer svg rect, .geDiagramContainer svg ellipse, .geDiagramContainer svg path, .geDiagramContainer svg image')) {
          const b = el.getBoundingClientRect();
          if (b.width === 0 && b.height === 0) continue;
          minX = Math.min(minX, b.left); minY = Math.min(minY, b.top); maxX = Math.max(maxX, b.right); maxY = Math.max(maxY, b.bottom);
        }
        return Number.isFinite(minX) ? { width: maxX - minX, height: maxY - minY } : null;
      });
      if (!drawn) return null;
      const fit = Math.max(drawn.width / Math.max(extent.width, 1), drawn.height / Math.max(extent.height, 1));
      return { width: Math.max(...v.map((c) => c.width)) * fit, height: Math.max(...v.map((c) => c.height)) * fit };
    };
    return await shoot(browser, url, setup, locate, measure, out, maxPx, extent);
  } finally {
    await browser.close();
  }
}

const MERMAID_PAGE = `<!doctype html><html><body style="margin:0;background:#fff;padding:20px">
<div id="target"></div>
<script type="module">
  const text = JSON.parse(document.getElementById('src').textContent);
  try {
    const mermaid = (await import('${MERMAID_CDN}')).default;
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
    const { svg } = await mermaid.render('diagram', text);
    document.getElementById('target').innerHTML = svg;
    window.__done = true;
  } catch (e) {
    window.__error = String(e && e.message || e);
  }
</script></body></html>`;

async function renderMermaidWeb(pw, text, out, maxPx) {
  const browser = await pw.chromium.launch();
  try {
    const html = MERMAID_PAGE.replace('<script type="module">', `<script type="application/json" id="src">${JSON.stringify(text).replace(/</g, '\\u003c')}</script><script type="module">`);
    let renderError;
    const setup = async (page) => {
      await page.setContent(html, { waitUntil: 'load' });
      await page.waitForFunction(() => window.__done === true || typeof window.__error === 'string', null, { timeout: 90_000 });
      renderError = await page.evaluate(() => window.__error);
    };
    const locate = async (page) => (renderError ? null : page.locator('#target svg').first().boundingBox());
    // The largest node, label or text of the drawing; anything near the size of the whole
    // drawing is a background or a cluster and does not count.
    const measure = (page) => page.evaluate(() => {
      const root = document.querySelector('#target svg');
      if (!root) return null;
      const whole = root.getBoundingClientRect();
      let width = 0; let height = 0;
      for (const el of root.querySelectorAll('g.node, g.actor, rect, polygon, circle, ellipse, text, foreignObject, image')) {
        const b = el.getBoundingClientRect();
        if (b.width >= whole.width * 0.9 && b.height >= whole.height * 0.9) continue;
        width = Math.max(width, b.width); height = Math.max(height, b.height);
      }
      return { width, height };
    });
    const r = await shoot(browser, null, setup, locate, measure, out, maxPx);
    if (renderError) return { ok: false, message: `Mermaid could not render the diagram: ${renderError.slice(0, 300)}` };
    return r;
  } finally {
    await browser.close();
  }
}

/**
 * @param {string} file path to a .drawio or .mmd file
 * @param {{ out?: string, cwd?: string, maxPx?: number, renderer?: 'drawio-desktop' | 'drawio-web' }} [options]
 *   `maxPx` caps the longest side of every PNG, border included; a very tall or wide diagram
 *   that would fall below scale 0.6 is instead cut into tiles at scale 1 that overlap by the
 *   largest node (`overlap`, px), with both renderers. `renderer` forces one of the two
 *   .drawio renderers instead of preferring draw.io desktop (used by the tests).
 * @returns {Promise<{ ok: boolean, out?: string, files?: string[], tiled?: boolean, overlap?: number, scale?: number, renderer?: string, errors: Array<{ path: string, message: string, hint?: string }> }>}
 */
export async function preview(file, options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const input = resolve(cwd, file);
  const ext = extname(input).toLowerCase();
  // The PNG is for the agent's own inspection, not a deliverable: keep it out of the project.
  const out = options.out ? resolve(cwd, options.out) : join(tmpdir(), 'it-diagrams-preview', `${basename(input, ext)}.png`);
  if (ext !== '.drawio' && ext !== '.mmd') {
    return { ok: false, errors: [{ path: file, message: 'preview takes a .drawio or .mmd file' }] };
  }
  let text;
  try {
    text = readFileSync(input, 'utf8');
  } catch (e) {
    return { ok: false, errors: [{ path: file, message: `cannot read file: ${e.message}` }] };
  }
  mkdirSync(dirname(out), { recursive: true });
  const attempts = [];
  if (ext === '.drawio' && options.renderer !== 'drawio-web') {
    const { bin, tried } = findDrawioBinary();
    if (bin) {
      const r = renderDrawioDesktop(bin, input, text, out, options.maxPx);
      if (r.ok) return { ok: true, out: r.files[0], files: r.files, tiled: r.tiled === true, overlap: r.overlap, scale: r.scale, renderer: 'drawio-desktop', errors: [] };
      attempts.push(`draw.io desktop (${bin}): ${r.message}`);
    } else {
      attempts.push(`draw.io desktop not found; looked for ${tried.join(', ')}`);
    }
    if (options.renderer === 'drawio-desktop') return { ok: false, errors: [{ path: file, message: `draw.io desktop could not render the file (${attempts.join('; ')})` }] };
  }
  const pw = loadPlaywright(cwd);
  if (!pw) {
    const root = npmGlobalRoot();
    attempts.push(`Playwright not found (looked in ${cwd}, next to the CLI${root ? `, and in ${root}` : ''})`);
    const playwright = `run \`npm install -g playwright && npx playwright install chromium\`; if it is already installed under another npm prefix, run the CLI with \`NODE_PATH="$(npm root -g)"\``;
    const hint = ext === '.drawio'
      ? `install draw.io desktop in one of the places above or put its executable on PATH, or ${playwright}; the preview step is optional, and a review without an image must say so`
      : `Mermaid previews need Playwright: ${playwright}; the preview step is optional, and a review without an image must say so`;
    return { ok: false, errors: [{ path: file, message: `no renderer available (${attempts.join('; ')})`, hint }] };
  }
  try {
    const r = ext === '.drawio' ? await renderDrawioWeb(pw, text, out, options.maxPx) : await renderMermaidWeb(pw, text, out, options.maxPx);
    if (r.ok) return { ok: true, out: r.files[0], files: r.files, tiled: r.tiled === true, overlap: r.overlap, scale: r.scale, renderer: ext === '.drawio' ? 'drawio-web' : 'mermaid-web', errors: [] };
    return { ok: false, errors: [{ path: file, message: r.message }] };
  } catch (e) {
    attempts.push(`browser render: ${String(e.message).slice(0, 200)}`);
    return { ok: false, errors: [{ path: file, message: `preview failed (${attempts.join('; ')})`, hint: 'the browser needs network access to load the renderer; the diagram itself is rendered locally' }] };
  }
}
