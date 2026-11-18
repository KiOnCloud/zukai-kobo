/**
 * draw.io desktop as it behaves: an Electron app that needs a display even for `--version`,
 * that exits 0 when an export fails (it only prints `Error: Export failed`), and that prints
 * Chromium's log on every start. Stand-ins for draw.io and xvfb-run reproduce that wherever
 * draw.io is not installed; the real binary is used when one is found.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { preview, findDrawioBinary, drawioCommand, drawioFailure, loadPlaywright, pngSize } from '../src/preview.mjs';
import { exportSvg, drawioPages } from '../src/export-svg.mjs';
import { drawioXmlOf } from '../src/extract-drawio.mjs';
import { emit, bundle } from '../src/pipeline.mjs';
import { loadFixture, scriptsDir } from './helpers.mjs';

const dir = mkdtempSync(join(tmpdir(), 'zukai-drawio-desktop-'));
const posix = process.platform !== 'win32';
const real = findDrawioBinary();
const hasPlaywright = loadPlaywright(scriptsDir) !== null;

// What draw.io desktop 26.0.9 printed on Linux, line for line (the noise shortened only by lines).
const BUS = '[25441:1118/002636.238268:ERROR:bus.cc(407)] Failed to connect to the bus: Failed to connect to socket /run/dbus/system_bus_socket: No such file or directory';
const UPDATE = ['Checking for beta autoupdate feature for deb/rpm distributions', 'Found package-type: deb'];
const NO_DISPLAY = ['[24889:1118/002626.392634:ERROR:ozone_platform_x11.cc(245)] Missing X server or $DISPLAY', '[24889:1118/002626.392650:ERROR:env.cc(258)] The platform failed to initialize.  Exiting.'];
const AS_ROOT = '[1118/002623.190331:FATAL:electron_main_delegate.cc(289)] Running as root without --no-sandbox is not supported. See https://crbug.com/638180.';

const write = (file, text) => { mkdirSync(join(file, '..'), { recursive: true }); writeFileSync(file, text); return file; };

/** An executable `name` in `bin` that runs `body`, a Node script, with its arguments. */
function tool(bin, name, body) {
  write(join(bin, `${name}.mjs`), body);
  write(join(bin, name), `#!/bin/sh\nexec "${process.execPath}" "${join(bin, `${name}.mjs`)}" "$@"\n`);
  chmodSync(join(bin, name), 0o755);
}

/**
 * A draw.io stand-in in a folder of its own. `display` makes it refuse to start without
 * DISPLAY, as the real one does (Chromium's lines on stderr, then a crash); `exportFails`
 * makes every export print draw.io's error and exit 0 without writing a file. Otherwise it
 * writes a 40 x 30 white PNG wherever `-o` says.
 */
function standIn({ display = false, exportFails = false } = {}) {
  const bin = mkdtempSync(join(tmpdir(), 'zukai-drawio-stand-in-'));
  tool(bin, 'drawio', `import { writeFileSync } from 'node:fs';
import { encodePng } from ${JSON.stringify(join(scriptsDir, 'src', 'png.mjs'))};
const args = process.argv.slice(2);
if (${display} && !process.env.DISPLAY) {
  console.error(${JSON.stringify([BUS, ...UPDATE, ...NO_DISPLAY].join('\n'))});
  process.kill(process.pid, 'SIGSEGV');
}
if (args.includes('--version')) { console.log('26.0.9'); process.exit(0); }
const file = args.find((a) => a.endsWith('.drawio'));
if (${exportFails}) { console.error(${JSON.stringify([BUS, ...UPDATE].join('\n'))} + '\\nError: Export failed: ' + file); process.exit(0); }
writeFileSync(args[args.indexOf('-o') + 1], encodePng({ width: 40, height: 30, bitDepth: 8, colorType: 6, bpp: 4, pixels: Buffer.alloc(40 * 30 * 4, 0xff) }));
`);
  return bin;
}

/** An xvfb-run stand-in: `xvfb-run -a <cmd> <args...>` runs the command with a DISPLAY set. */
function xvfbStandIn(bin) {
  tool(bin, 'xvfb-run', `import { spawnSync } from 'node:child_process';
const [flag, cmd, ...rest] = process.argv.slice(2);
if (flag !== '-a') process.exit(2);
const r = spawnSync(cmd, rest, { stdio: 'inherit', env: { ...process.env, DISPLAY: ':99' } });
process.exit(r.status ?? 1);
`);
}

/** Run with this PATH and display, and put both back afterwards. */
const saved = { PATH: process.env.PATH, DISPLAY: process.env.DISPLAY, WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY };
function environment(path, display) {
  process.env.PATH = path;
  for (const key of ['DISPLAY', 'WAYLAND_DISPLAY']) delete process.env[key];
  if (display) process.env.DISPLAY = display;
}
afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const SMALL = '<mxfile compressed="false"><diagram id="d" name="d"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="a" value="a" style="rounded=0" vertex="1" parent="1"><mxGeometry x="0" y="0" width="80" height="40" as="geometry"/></mxCell></root></mxGraphModel></diagram></mxfile>';
// A page draw.io cannot draw: its diagram is text, not a graph model.
const BROKEN = '<mxfile><diagram id="a" name="A">not a graph &lt;broken</diagram></mxfile>';

describe('what a failed draw.io desktop call says', () => {
  it('names draw.io\'s own error for an export that failed with exit code 0', () => {
    expect(drawioFailure({ status: 0, stderr: [BUS, ...UPDATE, 'Error: Export failed: bad.drawio'].join('\n'), stdout: '' })).toBe('Error: Export failed: bad.drawio');
  });

  it('names the missing display, not the log Chromium prints on every start', () => {
    expect(drawioFailure({ status: null, signal: 'SIGSEGV', stderr: [BUS, ...UPDATE, ...NO_DISPLAY].join('\n') })).toBe('Missing X server or $DISPLAY; The platform failed to initialize.  Exiting.');
    expect(drawioFailure({ status: null, signal: 'SIGTRAP', stderr: AS_ROOT })).toBe('Running as root without --no-sandbox is not supported. See https://crbug.com/638180.');
  });

  it('falls back to the signal, the exit code or the missing file', () => {
    expect(drawioFailure({ status: null, signal: 'SIGSEGV', stderr: BUS })).toBe('draw.io stopped on signal SIGSEGV');
    expect(drawioFailure({ status: 3, stderr: '' })).toBe('draw.io exited with code 3');
    expect(drawioFailure({ status: 0, stderr: UPDATE.join('\n') })).toBe('draw.io wrote no file');
    expect(drawioFailure({ error: Object.assign(new Error('spawnSync drawio ETIMEDOUT'), { code: 'ETIMEDOUT' }) })).toBe('draw.io did not finish in time');
  });

  it('says what to install when there is no display and no xvfb-run', () => {
    expect(drawioFailure({ status: null, signal: 'SIGSEGV', stderr: NO_DISPLAY.join('\n'), noDisplay: true })).toBe('Missing X server or $DISPLAY; The platform failed to initialize.  Exiting.; draw.io desktop needs a display: no DISPLAY is set and xvfb-run is not on PATH (install the xvfb package, or run the CLI under xvfb-run -a)');
  });
});

describe('how draw.io desktop is started', () => {
  it('lends it a virtual display through xvfb-run on Linux without one, and only there', () => {
    const bin = mkdtempSync(join(tmpdir(), 'zukai-xvfb-'));
    xvfbStandIn(bin);
    const flags = ['--no-sandbox', '--disable-gpu'];
    expect(drawioCommand('drawio', ['--version'], 'linux', { PATH: bin })).toEqual({ cmd: join(bin, 'xvfb-run'), args: ['-a', 'drawio', '--version', ...flags] });
    expect(drawioCommand('drawio', ['--version'], 'linux', { PATH: bin, DISPLAY: ':0' })).toEqual({ cmd: 'drawio', args: ['--version', ...flags] });
    expect(drawioCommand('drawio', ['--version'], 'linux', { PATH: bin, WAYLAND_DISPLAY: 'wayland-0' })).toEqual({ cmd: 'drawio', args: ['--version', ...flags] });
    expect(drawioCommand('drawio', ['--version'], 'linux', { PATH: mkdtempSync(join(tmpdir(), 'zukai-empty-')) })).toEqual({ cmd: 'drawio', args: ['--version', ...flags], noDisplay: true });
    expect(drawioCommand('draw.io', ['--version'], 'darwin', { PATH: bin })).toEqual({ cmd: 'draw.io', args: ['--version'] });
  });
});

describe.skipIf(!posix)('draw.io desktop through preview, with stand-ins', () => {
  it('runs draw.io under xvfb-run when no display is set, for the probe and for the export', async () => {
    const bin = standIn({ display: true });
    xvfbStandIn(bin);
    environment(`${bin}:${saved.PATH}`);
    expect(findDrawioBinary()).toMatchObject({ bin: 'drawio', broken: [] });
    const file = write(join(dir, 'xvfb', 'small.drawio'), SMALL);
    const r = await preview(file, { out: join(dir, 'xvfb', 'small.png'), renderer: 'drawio-desktop' });
    expect(r.errors).toEqual([]);
    expect(r).toMatchObject({ ok: true, renderer: 'drawio-desktop' });
    expect(pngSize(r.out)).toEqual({ width: 40, height: 30 });
  }, 60_000);

  it('reports a draw.io on PATH that does not start as found, with the reason and what to install', async () => {
    const bin = standIn({ display: true });
    // Only the stand-in on PATH: no xvfb-run, no display.
    environment(bin);
    const found = findDrawioBinary();
    expect(found.tried.slice(0, 2)).toEqual(['drawio on PATH', 'draw.io on PATH']);
    expect(found.broken).toEqual(['drawio on PATH did not start: Missing X server or $DISPLAY; The platform failed to initialize.  Exiting.; draw.io desktop needs a display: no DISPLAY is set and xvfb-run is not on PATH (install the xvfb package, or run the CLI under xvfb-run -a)']);
    // A machine with draw.io at an install path finds that one instead.
    if (found.bin) return;
    const r = await preview(write(join(dir, 'broken', 'small.drawio'), SMALL), { out: join(dir, 'broken', 'small.png'), renderer: 'drawio-desktop' });
    expect(r.ok).toBe(false);
    expect(r.errors[0].message).toMatch(/^draw\.io desktop could not render the file \(draw\.io desktop found but it did not start \(drawio on PATH did not start: Missing X server or \$DISPLAY; .*install the xvfb package.*\); looked for drawio on PATH, draw\.io on PATH, /);
  }, 60_000);

  it('takes an export that wrote nothing for a failure, never an image an earlier preview left there', async () => {
    const bin = standIn({ exportFails: true });
    environment(`${bin}:${saved.PATH}`, ':0');
    const file = write(join(dir, 'fails', 'small.drawio'), SMALL);
    const out = join(dir, 'fails', 'small.png');
    const fresh = await preview(file, { out, renderer: 'drawio-desktop' });
    expect(fresh.ok).toBe(false);
    expect(fresh.errors[0].message).toBe(`draw.io desktop could not render the file (draw.io desktop (drawio): Error: Export failed: ${file})`);
    // The image of an earlier preview at the same path is neither reported nor kept.
    write(out, readFileSync(join(scriptsDir, 'tests', 'export-samples', 'refund-check.drawio')));
    const stale = await preview(file, { out, renderer: 'drawio-desktop' });
    expect(stale.ok).toBe(false);
    expect(existsSync(out)).toBe(false);
    // Under a size cap the missing image is reported too, not read.
    const capped = await preview(file, { out, maxPx: 100, renderer: 'drawio-desktop' });
    expect(capped.ok).toBe(false);
    expect(capped.errors[0].message).toContain('Error: Export failed: ');
  }, 60_000);

  it('export names the page and draw.io\'s error when draw.io wrote no picture', async () => {
    const bin = standIn({ exportFails: true });
    environment(`${bin}:${saved.PATH}`, ':0');
    const file = write(join(dir, 'export-fails', 'small.drawio'), SMALL);
    const r = await exportSvg(file, { renderer: 'drawio-desktop' });
    expect(r.ok).toBe(false);
    expect(r.errors[0].message).toMatch(/^draw\.io desktop could not render the file \(draw\.io desktop \(drawio\): page "d": Error: Export failed: .+page-1\.drawio\)$/);
    expect(existsSync(join(dir, 'export-fails', 'd.drawio.svg'))).toBe(false);
  }, 60_000);
});

describe.skipIf(!real.bin)('the draw.io desktop that is installed', () => {
  /** A run with a main diagram whose steps refer to two parts, bundled with a canvas page. */
  async function refRun() {
    const run = join(mkdtempSync(join(tmpdir(), 'zukai-drawio-desktop-run-')), 'diagrams', '20261118_order-sync');
    const flow = (title, a, b) => ({ schemaVersion: 1, kind: 'flowchart', title, nodes: [{ id: 's', label: 'Start', shape: 'terminal' }, { id: 'a', label: a }, { id: 'b', label: b }, { id: 'e', label: 'Done', shape: 'terminal' }], edges: [{ id: 'e1', from: 's', to: 'a' }, { id: 'e2', from: 'a', to: 'b' }, { id: 'e3', from: 'b', to: 'e' }] });
    const irs = { 'order-sync': loadFixture('architecture', 'valid-ref-parts'), 'order-sync-01-load': flow('Load the orders', 'Fetch the orders page', 'Map each order'), 'order-sync-02-store': flow('Store the orders', 'Open a transaction', 'Upsert the rows') };
    for (const [id, ir] of Object.entries(irs)) {
      write(join(run, 'source', `${id}.ir.json`), JSON.stringify(ir));
      write(join(run, 'drawio', `${id}.drawio`), (await emit(ir, 'drawio', { diagramId: id })).output);
    }
    const combined = await bundle(Object.entries(irs).map(([id, ir]) => ({ id, ir })), 'drawio', { title: 'Order sync', canvas: 'all' });
    write(join(run, 'order-sync.drawio'), combined.output);
    return run;
  }

  it('previews a page of a run, and reports a page it cannot draw', async () => {
    const run = await refRun();
    const page = await preview(join(run, 'order-sync.drawio'), { page: 'Load the orders', out: join(dir, 'real', 'page.png'), renderer: 'drawio-desktop' });
    expect(page.errors).toEqual([]);
    expect(page).toMatchObject({ ok: true, renderer: 'drawio-desktop', page: { id: 'order-sync-01-load', name: 'Load the orders' }, pages: 4 });
    const broken = write(join(dir, 'real', 'broken.drawio'), BROKEN);
    const out = write(join(dir, 'real', 'broken.png'), readFileSync(page.out));
    const r = await preview(broken, { out, renderer: 'drawio-desktop' });
    expect(r.ok).toBe(false);
    expect(r.errors[0].message).toContain('Error: Export failed: ');
    expect(existsSync(out)).toBe(false);
  }, 240_000);

  it('exports every page of a run, each picture carrying its page, then previews and draws a picture again', async () => {
    const run = await refRun();
    const r = await exportSvg(run, { renderer: 'drawio-desktop' });
    expect(r.errors).toEqual([]);
    expect(r).toMatchObject({ ok: true, renderer: 'drawio-desktop', text: hasPlaywright ? 'svg' : 'html' });
    const pages = new Map(drawioPages(readFileSync(join(run, 'order-sync.drawio'), 'utf8')).pages.map((p) => [p.id, p.xml]));
    expect(r.files.map((f) => f.page)).toEqual(['canvas', 'order-sync', 'order-sync-01-load', 'order-sync-02-store']);
    for (const f of r.files) {
      const svg = readFileSync(f.out, 'utf8');
      expect(drawioXmlOf(Buffer.from(svg, 'utf8')).xml).toBe(pages.get(f.page));
      expect(svg).not.toMatch(/light-dark\(|--ge-/);
      if (hasPlaywright) expect(svg).not.toMatch(/<foreignObject|<switch|data:image\/png/);
    }
    // The picture of a page stands for the page: previewed or drawn again, it shows that page.
    const shown = await preview(r.files[2].out, { out: join(dir, 'real', 'picture.png'), renderer: 'drawio-desktop' });
    expect(shown.errors).toEqual([]);
    expect(shown).toMatchObject({ ok: true, renderer: 'drawio-desktop', page: { id: 'order-sync-01-load' }, pages: 1 });
    const again = await exportSvg(r.files[2].out, { out: join(dir, 'real', 'again'), renderer: 'drawio-desktop' });
    expect(again.errors).toEqual([]);
    expect(drawioXmlOf(readFileSync(again.files[0].out)).xml).toBe(pages.get('order-sync-01-load'));
  }, 240_000);
});
