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
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { tmpdir, homedir } from 'node:os';

const MERMAID_CDN = 'https://cdn.jsdelivr.net/npm/mermaid@12.3.0/dist/mermaid.esm.min.mjs';
const DRAWIO_VIEWER = 'https://viewer.diagrams.net/?lightbox=1&nav=0&layers=0&highlight=none&edit=_blank';

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

/** Pixel size of a PNG from its header. */
export function pngSize(file) {
  const head = readFileSync(file).subarray(16, 24);
  return { width: head.readUInt32BE(0), height: head.readUInt32BE(4) };
}

/**
 * draw.io desktop exports at scale 2; when the result is longer than `maxPx` on its longest
 * side it is exported again at the scale that fits.
 */
function renderDrawioDesktop(bin, file, out, maxPx) {
  const run = (scale) => {
    const args = ['-x', '-f', 'png', '-s', String(scale), '-b', '20', '-o', out, file];
    if (process.platform === 'linux') args.push('--no-sandbox', '--disable-gpu');
    const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 120_000 });
    if (r.error || r.status !== 0) return { ok: false, message: (r.stderr || r.error?.message || 'draw.io export failed').trim().slice(0, 300) };
    return { ok: true, scale };
  };
  let r = run(2);
  if (!r.ok || !maxPx) return r;
  const size = pngSize(out);
  const longest = Math.max(size.width, size.height);
  if (longest <= maxPx) return r;
  r = run(Math.max(0.1, Math.floor(((2 * maxPx) / longest) * 100) / 100));
  return r;
}

/**
 * Extent of the first page of a .drawio file in diagram units, from the page-level cells
 * (vertices with parent "1" and the waypoints of their edges). The viewer fits the page to
 * the window, so a window of this size shows the diagram at about scale 1.
 */
export function drawioExtent(xml) {
  const page = xml.match(/<diagram\b[\s\S]*?<\/diagram>/)?.[0] ?? xml;
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  const extend = (x, y) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); };
  // Self-closing cells ("0" and "1") are skipped, or they would swallow the next cell's body.
  for (const m of page.matchAll(/<mxCell\b([^>]*?)(?<!\/)>([\s\S]*?)<\/mxCell>/g)) {
    if (!/\sparent="1"(?:\s|$)/.test(m[1])) continue;
    const g = /<mxGeometry x="(-?[\d.]+)" y="(-?[\d.]+)" width="(-?[\d.]+)" height="(-?[\d.]+)"/.exec(m[2]);
    if (g && /\svertex="1"/.test(m[1])) { extend(+g[1], +g[2]); extend(+g[1] + +g[3], +g[2] + +g[4]); }
    if (/\sedge="1"/.test(m[1])) for (const p of m[2].matchAll(/<mxPoint x="(-?[\d.]+)" y="(-?[\d.]+)"/g)) extend(+p[1], +p[2]);
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
 * scale 1 under the cap, so it is cut into tiles along its long axis instead, each one
 * within the cap at scale 1; the tiles are written as `<out>-1.png`, `<out>-2.png`, ...
 */
async function shoot(browser, url, setup, locate, out, maxPx, fixed) {
  const margin = 20;
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
  let scale = Math.min(maxPx ? maxPx / longest : 2, 2, MAX_SIDE / longest);
  const tiles = [];
  if (maxPx && scale < 1 && longest >= 2 * Math.min(region.width, region.height)) {
    scale = 1;
    const vertical = region.height >= region.width;
    const step = maxPx;
    const count = Math.ceil(longest / step);
    for (let i = 0; i < count; i++) {
      tiles.push(vertical
        ? { x: region.x, y: region.y + i * step, width: region.width, height: Math.min(step, region.height - i * step) }
        : { x: region.x + i * step, y: region.y, width: Math.min(step, region.width - i * step), height: region.height });
    }
  }
  const viewport = fixed ? { width: region.width, height: region.height } : { width: Math.ceil(region.x + region.width) + 50, height: Math.ceil(region.y + region.height) + 50 };
  const page = await browser.newPage({ viewport, deviceScaleFactor: scale });
  await setup(page, url);
  await locate(page);
  if (tiles.length === 0) {
    await page.screenshot({ path: out, clip: region });
    await page.close();
    return { ok: true, scale, files: [out] };
  }
  const base = out.replace(/\.png$/i, '');
  const files = [];
  for (const [i, clip] of tiles.entries()) {
    const file = `${base}-${i + 1}.png`;
    await page.screenshot({ path: file, clip });
    files.push(file);
  }
  await page.close();
  return { ok: true, scale, files, tiled: true };
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
    return await shoot(browser, url, setup, locate, out, maxPx, drawioExtent(xml));
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
    const r = await shoot(browser, null, setup, locate, out, maxPx);
    if (renderError) return { ok: false, message: `Mermaid could not render the diagram: ${renderError.slice(0, 300)}` };
    return r;
  } finally {
    await browser.close();
  }
}

/**
 * @param {string} file path to a .drawio or .mmd file
 * @param {{ out?: string, cwd?: string, maxPx?: number }} [options] `maxPx` caps the longest side of
 *   the PNG; a very tall or wide diagram is then cut into tiles at scale 1 instead
 * @returns {Promise<{ ok: boolean, out?: string, renderer?: string, errors: Array<{ path: string, message: string, hint?: string }> }>}
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
  if (ext === '.drawio') {
    const { bin, tried } = findDrawioBinary();
    if (bin) {
      const r = renderDrawioDesktop(bin, input, out, options.maxPx);
      if (r.ok) return { ok: true, out, files: [out], scale: r.scale, renderer: 'drawio-desktop', errors: [] };
      attempts.push(`draw.io desktop (${bin}): ${r.message}`);
    } else {
      attempts.push(`draw.io desktop not found; looked for ${tried.join(', ')}`);
    }
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
    if (r.ok) return { ok: true, out: r.files[0], files: r.files, tiled: r.tiled === true, scale: r.scale, renderer: ext === '.drawio' ? 'drawio-web' : 'mermaid-web', errors: [] };
    return { ok: false, errors: [{ path: file, message: r.message }] };
  } catch (e) {
    attempts.push(`browser render: ${String(e.message).slice(0, 200)}`);
    return { ok: false, errors: [{ path: file, message: `preview failed (${attempts.join('; ')})`, hint: 'the browser needs network access to load the renderer; the diagram itself is rendered locally' }] };
  }
}
