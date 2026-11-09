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

function renderDrawioDesktop(bin, file, out) {
  const args = ['-x', '-f', 'png', '-s', '2', '-b', '20', '-o', out, file];
  if (process.platform === 'linux') args.push('--no-sandbox', '--disable-gpu');
  const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 120_000 });
  if (r.error || r.status !== 0) return { ok: false, message: (r.stderr || r.error?.message || 'draw.io export failed').trim().slice(0, 300) };
  return { ok: true };
}

async function renderDrawioWeb(pw, xml, out) {
  const browser = await pw.chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 2000, height: 1400 }, deviceScaleFactor: 2 });
    await page.goto(`${DRAWIO_VIEWER}#R${encodeURIComponent(xml)}`, { waitUntil: 'load', timeout: 90_000 });
    const drawing = page.locator('.geDiagramContainer svg > g').first();
    await drawing.waitFor({ state: 'visible', timeout: 60_000 });
    await page.waitForTimeout(500);
    const box = await drawing.boundingBox();
    if (!box) return { ok: false, message: 'draw.io rendered nothing' };
    const margin = 20;
    await page.screenshot({ path: out, clip: { x: Math.max(0, box.x - margin), y: Math.max(0, box.y - margin), width: box.width + 2 * margin, height: box.height + 2 * margin } });
    return { ok: true };
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

async function renderMermaidWeb(pw, text, out) {
  const browser = await pw.chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 2 });
    const html = MERMAID_PAGE.replace('<script type="module">', `<script type="application/json" id="src">${JSON.stringify(text).replace(/</g, '\\u003c')}</script><script type="module">`);
    await page.setContent(html, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__done === true || typeof window.__error === 'string', null, { timeout: 90_000 });
    const error = await page.evaluate(() => window.__error);
    if (error) return { ok: false, message: `Mermaid could not render the diagram: ${error.slice(0, 300)}` };
    await page.locator('#target svg').first().screenshot({ path: out });
    return { ok: true };
  } finally {
    await browser.close();
  }
}

/**
 * @param {string} file path to a .drawio or .mmd file
 * @param {{ out?: string, cwd?: string }} [options]
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
      const r = renderDrawioDesktop(bin, input, out);
      if (r.ok) return { ok: true, out, renderer: 'drawio-desktop', errors: [] };
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
    const r = ext === '.drawio' ? await renderDrawioWeb(pw, text, out) : await renderMermaidWeb(pw, text, out);
    if (r.ok) return { ok: true, out, renderer: ext === '.drawio' ? 'drawio-web' : 'mermaid-web', errors: [] };
    return { ok: false, errors: [{ path: file, message: r.message }] };
  } catch (e) {
    attempts.push(`browser render: ${String(e.message).slice(0, 200)}`);
    return { ok: false, errors: [{ path: file, message: `preview failed (${attempts.join('; ')})`, hint: 'the browser needs network access to load the renderer; the diagram itself is rendered locally' }] };
  }
}
