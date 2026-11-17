/**
 * End to end, through the committed bundle and from another working directory, as an agent
 * runs it: `diff --drawio` on two IR files and on two versions of a run folder, what it
 * refuses, and what the other commands make of the file it writes.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scriptsDir, loadFixture } from './helpers.mjs';
import { checkDrawioStructure } from './drawio-structure.mjs';
import { loadPlaywright, findDrawioBinary } from '../src/preview.mjs';
import { CASES, versions, STATE_COLOURS } from './visual-diff-cases.mjs';

const FAKE = ['postgres://app:', 'Sup3r', 'S3cret', '@db.internal/shop'].join('');
const cliPath = join(scriptsDir, 'bin', 'cli.mjs');
const cwd = mkdtempSync(join(tmpdir(), 'zukai-diff-e2e-cwd-'));
const cli = (...args) => {
  const r = spawnSync(process.execPath, [cliPath, ...args], { cwd, encoding: 'utf8' });
  const parse = (text) => text.trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return l; } });
  const err = parse(r.stderr);
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, out: parse(r.stdout).at(-1), warnings: err.flatMap((e) => e?.warnings ?? []), errors: err.flatMap((e) => e?.errors ?? []) };
};
const write = (file, value) => { mkdirSync(join(file, '..'), { recursive: true }); writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2)); return file; };
const tmp = (name) => mkdtempSync(join(tmpdir(), `zukai-diff-e2e-${name}-`));
const flow = (title, extra = {}) => ({
  schemaVersion: 1, kind: 'flowchart', title,
  nodes: [{ id: 'start', label: 'Start', shape: 'terminal' }, { id: 'check', label: 'Check the request' }, { id: 'done', label: 'Done', shape: 'terminal' }],
  edges: [{ id: 'e1', from: 'start', to: 'check' }, { id: 'e2', from: 'check', to: 'done' }],
  ...extra,
});
const styles = (file) => new Map(checkDrawioStructure(readFileSync(file, 'utf8')).cells.map((c) => [c.id, c.style ?? '']));
const pageIds = (file) => [...readFileSync(file, 'utf8').matchAll(/<diagram id="([^"]+)"/g)].map((m) => m[1]);

describe('diff --drawio on two IR files', () => {
  for (const c of CASES) {
    it(`draws the change of a ${c.kind} diagram`, () => {
      const dir = tmp(c.kind);
      const { before, after } = versions(c);
      const a = write(join(dir, 'old', `${c.kind}.ir.json`), before);
      const b = write(join(dir, 'new', `${c.kind}.ir.json`), after);
      const out = join(dir, 'drafts', `${c.kind}.diff.drawio`);
      const r = cli('diff', a, b, '--drawio', out);
      expect(r.errors).toEqual([]);
      expect(r.code).toBe(0);
      expect(r.out.drawio).toMatchObject({ out, written: true, unchanged: [], pages: [{ diagram: c.kind, page: c.kind, state: 'changed' }] });
      expect(r.out.drawio.notDrawn.map((e) => e.id)).toEqual(c.notDrawn ?? []);
      expect(checkDrawioStructure(readFileSync(out, 'utf8')).problems).toEqual([]);
      const style = styles(out);
      for (const state of ['added', 'changed', 'removed']) {
        for (const id of c.cells[state]) expect(style.get(`${c.kind}:${id}`), `${state} ${id}`).toMatch(STATE_COLOURS[state]);
      }
    });
  }

  it('prints the list of the plain diff unchanged, with the picture beside it', () => {
    const dir = tmp('plain');
    const a = write(join(dir, 'a.ir.json'), flow('Request'));
    const b = write(join(dir, 'b.ir.json'), flow('Request', { nodes: flow('x').nodes.map((n) => (n.id === 'check' ? { ...n, label: 'Check the order' } : n)) }));
    const plain = cli('diff', a, b);
    const drawn = cli('diff', a, b, '--drawio', join(dir, 'ab.diff.drawio'));
    expect(plain.code).toBe(0);
    expect(drawn.code).toBe(0);
    const { drawio, ...list } = drawn.out;
    expect(list).toEqual(plain.out);
    expect(plain.out.drawio).toBeUndefined();
    // Two files are one diagram in two versions: the page is named after the new file.
    expect(drawio.pages).toEqual([{ diagram: 'b', page: 'b', state: 'changed', added: 0, changed: 1, removed: 0 }]);
    expect(readFileSync(join(dir, 'ab.diff.drawio'), 'utf8')).toContain('tooltip="label was &quot;Check the request&quot;"');
  });

  it('writes no file and says so when the two files do not differ', () => {
    const dir = tmp('same');
    const a = write(join(dir, 'a.ir.json'), flow('Request'));
    const out = join(dir, 'same.diff.drawio');
    const r = cli('diff', a, a, '--drawio', out);
    expect(r.code).toBe(0);
    expect(r.out).toMatchObject({ ok: true, differs: false, drawio: { out: null, written: false, reason: expect.stringMatching(/do not differ/), unchanged: ['a'] } });
    expect(existsSync(out)).toBe(false);
  });

  it('takes the option as --drawio=<file> and refuses a path that is not a .drawio file or has no value', () => {
    const dir = tmp('usage');
    const a = write(join(dir, 'a.ir.json'), flow('Request'));
    const b = write(join(dir, 'b.ir.json'), flow('Request v2'));
    expect(cli('diff', a, b, `--drawio=${join(dir, 'eq.diff.drawio')}`).code).toBe(0);
    expect(existsSync(join(dir, 'eq.diff.drawio'))).toBe(true);
    const png = cli('diff', a, b, '--drawio', join(dir, 'x.png'));
    expect(png.code).toBe(1);
    expect(png.errors[0].message).toMatch(/\.drawio file/);
    const none = cli('diff', a, b, '--drawio');
    expect(none.code).toBe(1);
    expect(none.errors[0].message).toMatch(/--drawio needs a value/);
  });

  it('keeps the exit codes of diff for a file that is missing or not a valid model', () => {
    const dir = tmp('bad');
    const a = write(join(dir, 'a.ir.json'), flow('Request'));
    const bad = write(join(dir, 'bad.ir.json'), { schemaVersion: 1, kind: 'flowchart', title: 'Bad', nodes: [], edges: [] });
    const out = join(dir, 'bad.diff.drawio');
    expect(cli('diff', a, join(dir, 'missing.ir.json'), '--drawio', out).code).toBe(1);
    expect(cli('diff', a, bad, '--drawio', out).code).toBe(2);
    expect(existsSync(out)).toBe(false);
  });

  it('refuses a credential of the old version with exit code 2 and writes nothing, unless --allow-sensitive is given', () => {
    const dir = tmp('secret');
    const a = write(join(dir, 'a.ir.json'), flow('Request', { nodes: flow('x').nodes.map((n) => (n.id === 'check' ? { ...n, label: `Connect to ${FAKE}` } : n)) }));
    const b = write(join(dir, 'b.ir.json'), flow('Request'));
    const out = join(dir, 'secret.diff.drawio');
    const r = cli('diff', a, b, '--drawio', out);
    expect(r.code).toBe(2);
    expect(r.errors[0].message).toMatch(/refusing to draw the old version/);
    expect(r.stdout).toBe('');
    expect(r.stderr).not.toContain(FAKE);
    expect(existsSync(out)).toBe(false);
    expect(cli('diff', a, b, '--drawio', out, '--allow-sensitive').code).toBe(0);
    expect(existsSync(out)).toBe(true);
  });
});

describe('diff --drawio on two versions of a run folder', () => {
  let root;
  let run;
  let old;
  let picture;
  const main = (label) => flow('Checkout', {
    nodes: [{ id: 'start', label: 'Start', shape: 'terminal' }, { id: 'check', label: 'Check the request', ref: 'shop-01-check' }, { id: 'pay', label: 'Pay', ref: 'shop-02-pay' }, { id: 'done', label, shape: 'terminal' }],
    edges: [{ id: 'e1', from: 'start', to: 'check' }, { id: 'e2', from: 'check', to: 'pay' }, { id: 'e3', from: 'pay', to: 'done' }],
  });
  beforeAll(() => {
    root = tmp('run');
    run = join(root, 'diagrams', '20261117_shop');
    // The old version is a revision of the run, as `snapshot` keeps it.
    old = join(run, 'history', 'r001', 'source');
    const seq = loadFixture('sequence', 'valid');
    for (const [dir, irs] of [
      [old, { shop: main('Done'), 'shop-business': flow('Checkout (business)'), 'shop-01-check': flow('Check the request in detail'), 'shop-02-pay': seq, 'shop-03-export': flow('Legacy export') }],
      [join(run, 'source'), { shop: main('Order placed'), 'shop-business': flow('Checkout (business)'), 'shop-01-check': flow('Check the request in detail', { nodes: [...flow('x').nodes, { id: 'log', label: 'Write the audit log' }], edges: [...flow('x').edges, { id: 'e3', from: 'check', to: 'log' }] }), 'shop-02-pay': seq, 'shop-04-receipt': flow('Send the receipt') }],
    ]) for (const [id, ir] of Object.entries(irs)) write(join(dir, `${id}.ir.json`), ir);
    expect(cli('bundle', '--to', 'drawio', '--canvas', 'all', '--title', 'Shop', '--out', join(run, 'shop.drawio'), run).code).toBe(0);
    picture = join(run, 'drafts', 'shop.diff.drawio');
  });

  it('writes one page per diagram that changed, was added or was removed, and names the unchanged ones', () => {
    const delivered = readFileSync(join(run, 'shop.drawio'), 'utf8');
    const r = cli('diff', old, run, '--drawio', picture);
    expect(r.errors).toEqual([]);
    expect(r.code).toBe(0);
    expect(r.out).toMatchObject({ ok: true, differs: true, diagramsAdded: ['shop-04-receipt'], diagramsRemoved: ['shop-03-export'] });
    expect(r.out.drawio).toMatchObject({ out: picture, written: true, unchanged: ['shop-business', 'shop-02-pay'], notDrawn: [] });
    expect(r.out.drawio.pages.map((p) => [p.diagram, p.state])).toEqual([['shop', 'changed'], ['shop-01-check', 'changed'], ['shop-04-receipt', 'added'], ['shop-03-export', 'removed']]);
    expect(pageIds(picture)).toEqual(['shop', 'shop-01-check', 'shop-04-receipt', 'shop-03-export']);
    expect(checkDrawioStructure(readFileSync(picture, 'utf8')).problems).toEqual([]);
    const style = styles(picture);
    expect(style.get('shop:done')).toMatch(STATE_COLOURS.changed);
    expect(style.get('shop-01-check:log')).toMatch(STATE_COLOURS.added);
    expect(style.get('shop-04-receipt:check')).toMatch(STATE_COLOURS.added);
    expect(style.get('shop-03-export:check')).toMatch(STATE_COLOURS.removed);
    // The delivered file of the run is not touched.
    expect(readFileSync(join(run, 'shop.drawio'), 'utf8')).toBe(delivered);
  });

  it('does not write over the delivered file of the run, and replaces its own earlier picture', () => {
    const delivered = readFileSync(join(run, 'shop.drawio'), 'utf8');
    const refused = cli('diff', old, run, '--drawio', join(run, 'shop.drawio'));
    expect(refused.code).toBe(1);
    expect(refused.errors[0]).toMatchObject({ message: expect.stringMatching(/not the picture of a diff/), hint: expect.stringMatching(/drafts\//) });
    expect(readFileSync(join(run, 'shop.drawio'), 'utf8')).toBe(delivered);
    const before = statSync(picture).mtimeMs;
    expect(cli('diff', old, run, '--drawio', picture).code).toBe(0);
    expect(statSync(picture).mtimeMs).toBeGreaterThanOrEqual(before);
  });

  it('leaves drift of the run as it was, and drift refuses the picture', () => {
    const fine = cli('drift', join(run, 'shop.drawio'), run);
    expect(fine.out).toMatchObject({ ok: true, drifted: false });
    const r = cli('drift', picture, run);
    expect(r.code).toBe(1);
    expect(r.errors[0].message).toMatch(/picture of a diff/);
  });

  it('writes nothing for a run compared with itself', () => {
    const out = join(run, 'drafts', 'none.diff.drawio');
    const r = cli('diff', run, run, '--drawio', out);
    expect(r.code).toBe(0);
    expect(r.out.drawio).toMatchObject({ written: false, unchanged: ['shop', 'shop-business', 'shop-01-check', 'shop-02-pay', 'shop-04-receipt'] });
    expect(existsSync(out)).toBe(false);
  });

  it('compares a draft of the run with the run, as a consult does', () => {
    const draft = join(run, 'drafts', 'shop-next');
    write(join(draft, 'shop.ir.json'), main('Order confirmed'));
    for (const id of ['shop-business', 'shop-01-check', 'shop-02-pay', 'shop-04-receipt']) write(join(draft, `${id}.ir.json`), JSON.parse(readFileSync(join(run, 'source', `${id}.ir.json`), 'utf8')));
    const out = join(run, 'drafts', 'shop-next.diff.drawio');
    const r = cli('diff', run, draft, '--drawio', out);
    expect(r.code).toBe(0);
    expect(r.out.drawio.pages).toEqual([{ diagram: 'shop', page: 'shop', state: 'changed', added: 0, changed: 1, removed: 0 }]);
    expect(readFileSync(out, 'utf8')).toContain('label was &amp;quot;Order placed&amp;quot;');
  });

  it.skipIf(!loadPlaywright() && !findDrawioBinary())('is rendered by preview like any .drawio file', () => {
    const png = join(root, 'shop.diff.png');
    const r = cli('preview', picture, '--out', png);
    expect(r.errors).toEqual([]);
    expect(r.out).toMatchObject({ ok: true, preview: png });
    expect(statSync(png).size).toBeGreaterThan(5000);
  }, 120000);
});
