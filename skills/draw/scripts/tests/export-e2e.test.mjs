/**
 * End to end, through the committed bundle and from another working directory, as an agent
 * runs it: a run is emitted to draw.io, exported to editable SVG pictures, and the pictures
 * are read back with `extract` and checked against the IRs with `cover`.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scriptsDir, loadFixture } from './helpers.mjs';
import { loadPlaywright } from '../src/preview.mjs';

const cliPath = join(scriptsDir, 'bin', 'cli.mjs');
const cwd = mkdtempSync(join(tmpdir(), 'zukai-export-e2e-cwd-'));
const run = (args, env) => {
  const r = spawnSync(process.execPath, [cliPath, ...args], { cwd, encoding: 'utf8', ...(env ? { env } : {}) });
  const parse = (text) => text.trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return l; } });
  const err = parse(r.stderr);
  return { code: r.status, out: parse(r.stdout).at(-1), err: err.at(-1), warnings: err.flatMap((e) => e?.warnings ?? []), errors: err.flatMap((e) => e?.errors ?? []) };
};
const cli = (...args) => run(args);
const write = (file, value) => { mkdirSync(join(file, '..'), { recursive: true }); writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2)); return file; };
// The labels are checked as SVG text, which takes the browser whichever renderer drew the page.
const hasPlaywright = loadPlaywright() !== null;

const flow = (title, extra = {}) => ({
  schemaVersion: 1, kind: 'flowchart', title,
  nodes: [{ id: 'start', label: 'Start', shape: 'terminal' }, { id: 'check', label: 'Check the request' }, { id: 'done', label: 'Done', shape: 'terminal' }],
  edges: [{ id: 'e1', from: 'start', to: 'check' }, { id: 'e2', from: 'check', to: 'done' }],
  ...extra,
});

/** A delivered draw.io run: IRs in source/, each diagram in drawio/, the combined file with a canvas. */
function makeRun(slug, irs) {
  const dir = join(mkdtempSync(join(tmpdir(), `zukai-export-e2e-${slug}-`)), 'diagrams', `20261117_${slug}`);
  for (const [id, ir] of Object.entries(irs)) {
    write(join(dir, 'source', `${id}.ir.json`), ir);
    expect(cli('emit', '--to', 'drawio', join(dir, 'source', `${id}.ir.json`), '--out', join(dir, 'drawio', `${id}.drawio`)).code).toBe(0);
  }
  expect(cli('bundle', '--to', 'drawio', '--canvas', 'all', '--title', 'Refund', '--out', join(dir, `${slug}.drawio`), dir).code).toBe(0);
  return dir;
}

/**
 * An environment in which the CLI finds no renderer by name: an empty PATH (no `drawio`, and
 * no `npm` to ask for the global folder) and no NODE_PATH. `extra` goes first on the PATH.
 */
const bareEnv = (extra) => {
  const empty = mkdtempSync(join(tmpdir(), 'zukai-export-e2e-path-'));
  const env = { ...process.env, PATH: extra ? `${extra}:${empty}` : empty };
  delete env.NODE_PATH;
  return env;
};

describe('export: usage and input errors (no renderer needed)', () => {
  it('lists the command in the help', () => {
    const r = spawnSync(process.execPath, [cliPath, 'help'], { cwd, encoding: 'utf8' });
    expect(r.stdout).toContain('cli.mjs export <file.drawio|file.drawio.svg|run-dir> [--out <dir|file.svg>]');
    expect(r.stdout).toMatch(/export writes each page of a draw\.io file as a picture that still opens in draw\.io/);
  }, 60_000);

  it('exits 1 with the usage on no target or two', () => {
    for (const args of [['export'], ['export', 'a.drawio', 'b.drawio']]) {
      const r = cli(...args);
      expect(r.code).toBe(1);
      expect(r.errors[0].message).toBe('export takes exactly one .drawio file, editable picture (.drawio.svg) or run folder');
      expect(r.err.usage).toContain('cli.mjs export');
    }
    expect(cli('export', 'a.drawio', '--out').errors[0].message).toBe('option --out needs a value');
  }, 60_000);

  it('exits 1 on a missing file, on a file that is not draw.io, and on a run without a draw.io file', () => {
    const missing = cli('export', 'nope.drawio');
    expect(missing.code).toBe(1);
    expect(missing.errors[0].message).toMatch(/^cannot read: ENOENT/);

    const mmd = write(join(cwd, 'flow.mmd'), 'flowchart TD\n a --> b\n');
    const notDrawio = cli('export', mmd);
    expect(notDrawio.code).toBe(1);
    expect(notDrawio.errors[0].message).toBe('not a .drawio file (no <mxfile> root)');

    const mermaidRun = join(cwd, 'diagrams', '20261117_login');
    write(join(mermaidRun, 'source', 'login.ir.json'), flow('Login'));
    write(join(mermaidRun, 'mermaid', 'login.mmd'), 'flowchart TD\n a --> b\n');
    const noFile = cli('export', mermaidRun);
    expect(noFile.code).toBe(1);
    expect(noFile.errors[0].message).toBe('no draw.io file in this folder (looked for login.drawio and drawio/*.drawio)');
    expect(noFile.errors[0].hint).toMatch(/emit and bundle the run with --to drawio first/);
    expect(existsSync(join(mermaidRun, 'svg'))).toBe(false);
  }, 60_000);

  it('exits 1 with the usage when --out names one file for a file of several pages, and writes nothing', () => {
    const dir = makeRun('refund', { refund: flow('Refund'), 'refund-01-payout': flow('Payout') });
    const r = cli('export', dir, '--out', join(dir, 'refund.svg'));
    expect(r.code).toBe(1);
    expect(r.errors[0].message).toBe('--out names one file, but 3 pages would be written (canvas, refund, refund-01-payout)');
    expect(r.err.usage).toContain('cli.mjs export');
    expect(existsSync(join(dir, 'refund.svg'))).toBe(false);
    expect(existsSync(join(dir, 'svg'))).toBe(false);
  }, 60_000);
});

describe('export without a renderer', () => {
  it('exits 1, names every place it looked, and writes no picture', () => {
    const dir = makeRun('norender', { norender: flow('No renderer') });
    const r = run(['export', dir], bareEnv());
    // A machine with draw.io desktop at its default install path still renders; everywhere
    // else nothing is found, and nothing may be written.
    if (r.code === 0) {
      expect(r.out.renderer).toBe('drawio-desktop');
      return;
    }
    expect(r.code).toBe(1);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].message).toMatch(/^no renderer available \(draw\.io desktop not found; looked for drawio on PATH, draw\.io on PATH, .+; Playwright not found \(looked in .+, next to the CLI\)\)$/);
    expect(r.errors[0].hint).toMatch(/^install draw\.io desktop in one of the places above or put its executable on PATH, or run `npm install -g playwright && npx playwright install chromium`/);
    expect(r.errors[0].hint).toMatch(/no picture was written, and the \.drawio file itself is complete without one$/);
    expect(existsSync(join(dir, 'svg'))).toBe(false);
  }, 60_000);

  it.skipIf(process.platform === 'win32')('with draw.io desktop alone: the picture is written with HTML labels, and the warning says what that means', () => {
    // A stand-in for the desktop CLI: it answers `--version` and returns, for an SVG export,
    // the SVG draw.io draws for the stored sample (taken from the viewer, which shares the code).
    const bin = mkdtempSync(join(tmpdir(), 'zukai-export-e2e-drawio-'));
    write(join(bin, 'drawio.mjs'), `import { copyFileSync } from 'node:fs';
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('99.0.0'); process.exit(0); }
if (args[args.indexOf('-f') + 1] !== 'svg' || !args.includes('-x')) process.exit(3);
copyFileSync(${JSON.stringify(join(scriptsDir, 'tests', 'export-samples', 'refund-check.viewer.svg'))}, args[args.indexOf('-o') + 1]);
`);
    write(join(bin, 'drawio'), `#!/bin/sh\nexec "${process.execPath}" "${join(bin, 'drawio.mjs')}" "$@"\n`);
    chmodSync(join(bin, 'drawio'), 0o755);
    const file = write(join(cwd, 'desk', 'refund-check.drawio'), readFileSync(join(scriptsDir, 'tests', 'export-samples', 'refund-check.drawio'), 'utf8'));
    const r = run(['export', file], bareEnv(bin));
    expect(r.errors).toEqual([]);
    expect(r.code).toBe(0);
    expect(r.out).toMatchObject({ ok: true, renderer: 'drawio-desktop', text: 'html', warnings: 1 });
    expect(r.out.files[0].out).toBe(join(cwd, 'desk', 'refund-check.drawio.svg'));
    expect(r.warnings[0].message).toMatch(/^\d+ labels are written as HTML, which only a browser draws: a viewer that is not a browser shows "Text is not SVG" in their place$/);
    expect(r.warnings[0].hint).toMatch(/labels become SVG text when Playwright is installed beside draw\.io desktop/);
    const svg = readFileSync(r.out.files[0].out, 'utf8');
    expect(svg).toMatch(/<foreignObject/);
    expect(svg).not.toMatch(/light-dark\(|--ge-/);
    // The picture still carries the diagram: extract reads it, cover passes against the IR.
    const facts = join(cwd, 'desk', 'refund-check.facts.json');
    expect(cli('extract', r.out.files[0].out, '--out', facts).code).toBe(0);
    expect(cli('cover', facts, join(scriptsDir, 'tests', 'export-samples', 'refund-check.ir.json')).code).toBe(0);
  }, 60_000);
});

describe.skipIf(!hasPlaywright)('export with a renderer', () => {
  let dir;
  const irs = {
    refund: loadFixture('flowchart', 'valid-refund-approval'),
    'refund-01-payout': flow('Payout to the card'),
    'refund-business': loadFixture('activity', 'valid-business-fulfilment'),
  };
  beforeAll(() => { dir = makeRun('refund', irs); }, 120_000);

  it('writes svg/<slug>.drawio.svg for every diagram of a run folder, and the canvas page', () => {
    const r = cli('export', dir);
    expect(r.errors).toEqual([]);
    expect(r.code).toBe(0);
    expect(r.out).toMatchObject({ ok: true, text: 'svg', warnings: 0 });
    expect(['drawio-desktop', 'drawio-web']).toContain(r.out.renderer);
    expect(r.out.files.map((f) => f.page)).toEqual(['canvas', 'refund', 'refund-business', 'refund-01-payout']);
    expect(r.out.files.map((f) => f.out)).toEqual(['canvas', 'refund', 'refund-business', 'refund-01-payout'].map((id) => join(dir, 'svg', `${id}.drawio.svg`)));
    expect(readdirSync(join(dir, 'svg')).sort()).toEqual(['canvas.drawio.svg', 'refund-01-payout.drawio.svg', 'refund-business.drawio.svg', 'refund.drawio.svg']);
    for (const f of r.out.files) {
      const svg = readFileSync(f.out, 'utf8');
      expect(svg.startsWith('<svg content="&lt;mxfile ')).toBe(true);
      expect(svg).toContain(`viewBox="0 0 ${f.width} ${f.height}"`);
      expect(svg).not.toMatch(/<foreignObject|Text is not SVG|light-dark\(/);
      expect(svg.match(/<text\b/g).length).toBeGreaterThan(3);
    }
  }, 180_000);

  it('round trip: extract reads each picture back as the page it was made from, and cover passes against the run', () => {
    const whole = join(dir, 'source', 'refund.drawio.facts.json');
    expect(cli('extract', join(dir, 'refund.drawio'), '--out', whole).code).toBe(0);
    const pages = new Map(JSON.parse(readFileSync(whole, 'utf8')).pages.map((p) => [p.id, p]));
    for (const id of ['canvas', 'refund', 'refund-business', 'refund-01-payout']) {
      const facts = join(dir, 'source', `${id}.svg.facts.json`);
      const read = cli('extract', join(dir, 'svg', `${id}.drawio.svg`), '--out', facts);
      expect(read.code).toBe(0);
      expect(read.out).toMatchObject({ ok: true, format: 'drawio' });
      const got = JSON.parse(readFileSync(facts, 'utf8'));
      expect(got.pages).toEqual([pages.get(id)]);
      const covered = cli('cover', facts, dir);
      expect(covered.err ?? null).toBeNull();
      expect(covered.code).toBe(0);
      expect(covered.out.ok).toBe(true);
    }
  }, 180_000);

  it('writes the picture of one file beside it, or where --out says: a folder, or one file', () => {
    const one = join(dir, 'drawio', 'refund-01-payout.drawio');
    const beside = cli('export', one);
    expect(beside.code).toBe(0);
    expect(beside.out.files.map((f) => f.out)).toEqual([join(dir, 'drawio', 'refund-01-payout.drawio.svg')]);
    const folder = cli('export', one, '--out', join(cwd, 'wiki', 'img'));
    expect(folder.out.files[0].out).toBe(join(cwd, 'wiki', 'img', 'refund-01-payout.drawio.svg'));
    const named = cli('export', one, `--out=${join(cwd, 'wiki', 'payout.svg')}`);
    expect(named.out.files[0].out).toBe(join(cwd, 'wiki', 'payout.svg'));
    expect(readFileSync(join(cwd, 'wiki', 'payout.svg'), 'utf8')).toBe(readFileSync(folder.out.files[0].out, 'utf8'));
    // The embedded diagram is the exported file itself.
    const again = join(cwd, 'wiki', 'payout.facts.json');
    expect(cli('extract', join(cwd, 'wiki', 'payout.svg'), '--out', again).code).toBe(0);
    expect(cli('cover', again, join(dir, 'source', 'refund-01-payout.ir.json')).code).toBe(0);
  }, 180_000);

  it('takes an editable picture and draws the diagram it holds again, as preview and extract read it', () => {
    const picture = join(dir, 'svg', 'refund-01-payout.drawio.svg');
    const held = join(cwd, 'held.facts.json');
    expect(cli('extract', picture, '--out', held).code).toBe(0);
    // Into another folder: the picture keeps its name and holds the same diagram.
    const copy = cli('export', picture, '--out', join(cwd, 'again'));
    expect(copy.code).toBe(0);
    expect(copy.out.files).toHaveLength(1);
    expect(copy.out.files[0]).toMatchObject({ page: 'refund-01-payout', out: join(cwd, 'again', 'refund-01-payout.drawio.svg') });
    const text = readFileSync(copy.out.files[0].out, 'utf8');
    expect(text.startsWith('<svg content="&lt;mxfile')).toBe(true);
    if (hasPlaywright) expect(text).toContain('>Check the request</text>');
    const back = join(cwd, 'again.facts.json');
    expect(cli('extract', copy.out.files[0].out, '--out', back).code).toBe(0);
    expect(JSON.parse(readFileSync(back, 'utf8')).pages).toEqual(JSON.parse(readFileSync(held, 'utf8')).pages);
    // A page it holds is picked by name as in a .drawio file; one it does not hold is listed.
    expect(cli('export', picture, '--page', 'refund-01-payout', '--out', join(cwd, 'again')).code).toBe(0);
    const unknown = cli('export', picture, '--page', 'refund');
    expect(unknown.code).toBe(1);
    expect(unknown.errors[0].message).toBe('no page "refund" in this file');
    // Without --out the picture is written over itself.
    expect(cli('export', picture).out.files[0].out).toBe(picture);
    // A plain SVG holds no diagram.
    const plain = write(join(cwd, 'plain.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');
    const refused = cli('export', plain);
    expect(refused.code).toBe(1);
    expect(refused.errors[0].message).toMatch(/^this SVG holds no draw\.io diagram/);
  }, 180_000);

  it('writes the pictures again after a change of the run, over the earlier ones', () => {
    const before = readFileSync(join(dir, 'svg', 'refund-01-payout.drawio.svg'), 'utf8');
    expect(before).toContain('>Check the request</text>');
    const changed = flow('Payout to the card', { nodes: [{ id: 'start', label: 'Start', shape: 'terminal' }, { id: 'check', label: 'Check the card is still valid' }, { id: 'done', label: 'Done', shape: 'terminal' }] });
    write(join(dir, 'source', 'refund-01-payout.ir.json'), changed);
    expect(cli('bundle', '--to', 'drawio', '--canvas', 'all', '--title', 'Refund', '--out', join(dir, 'refund.drawio'), dir).code).toBe(0);
    expect(cli('export', dir).code).toBe(0);
    const after = readFileSync(join(dir, 'svg', 'refund-01-payout.drawio.svg'), 'utf8');
    expect(after).toContain('>Check the card is still valid</text>');
    expect(after).not.toContain('>Check the request</text>');
    expect(readFileSync(join(dir, 'svg', 'canvas.drawio.svg'), 'utf8')).toContain('>Check the card is still valid</text>');
  }, 180_000);
});
