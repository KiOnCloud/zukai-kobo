import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scriptsDir, fixturesDir } from './helpers.mjs';

const cli = join(scriptsDir, 'bin', 'cli.mjs');
const cwd = mkdtempSync(join(tmpdir(), 'zukai-cli-revise-'));

function run(args) {
  const r = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, json: r.stdout ? JSON.parse(r.stdout.trim().split('\n').pop()) : undefined };
}

function makeRun() {
  const dir = mkdtempSync(join(cwd, 'run-'));
  mkdirSync(join(dir, 'source'));
  copyFileSync(join(fixturesDir, 'flowchart', 'valid.json'), join(dir, 'source', 'checkout.ir.json'));
  copyFileSync(join(fixturesDir, 'sequence', 'valid.json'), join(dir, 'source', 'login.ir.json'));
  return dir;
}

describe('cli revise commands (committed bundle)', () => {
  it('diff compares two IR files and two run folders', () => {
    const a = join(fixturesDir, 'activity', 'valid-order-a.json');
    const b = join(fixturesDir, 'activity', 'valid-order-b.json');
    const r = run(['diff', a, b]);
    expect(r.code).toBe(0);
    expect(r.json).toMatchObject({ ok: true, differs: true, replaced: false, added: [], removed: [] });
    expect(run(['diff', a, a]).json.differs).toBe(false);

    const one = makeRun();
    const two = makeRun();
    const ir = JSON.parse(readFileSync(join(two, 'source', 'checkout.ir.json'), 'utf8'));
    ir.title = 'Checkout v2';
    writeFileSync(join(two, 'source', 'checkout.ir.json'), JSON.stringify(ir));
    const d = run(['diff', one, join(two, 'source')]);
    expect(d.code).toBe(0);
    expect(d.json).toMatchObject({ ok: true, differs: true, diagramsAdded: [], diagramsRemoved: [] });
    expect(d.json.diagrams.map((x) => x.id)).toEqual(['checkout']);
  });

  it('diff exits 2 on an invalid IR and 1 on bad usage or a missing file', () => {
    const valid = join(fixturesDir, 'flowchart', 'valid.json');
    expect(run(['diff', valid, join(fixturesDir, 'flowchart', 'invalid-missing-edge-target.json')]).code).toBe(2);
    expect(run(['diff', valid]).code).toBe(1);
    expect(run(['diff', valid, join(cwd, 'missing.json')]).code).toBe(1);
  });

  it('drift reports an emitted file as unchanged and a moved shape as drifted', () => {
    const dir = makeRun();
    const ir = join(dir, 'source', 'checkout.ir.json');
    const out = join(dir, 'drawio', 'checkout.drawio');
    expect(run(['emit', '--to', 'drawio', ir, '--out', out]).code).toBe(0);
    const clean = run(['drift', out, ir]);
    expect(clean.code).toBe(0);
    expect(clean.json).toMatchObject({ ok: true, drifted: false, bundled: false });
    writeFileSync(out, readFileSync(out, 'utf8').replace(/<mxGeometry x="(\d+)"/, (_, x) => `<mxGeometry x="${Number(x) + 50}"`));
    expect(run(['drift', out, ir]).json.drifted).toBe(true);
  });

  it('drift reads a whole run folder for a bundle and returns its options', () => {
    const dir = makeRun();
    const out = join(dir, 'shop.drawio');
    expect(run(['bundle', '--to', 'drawio', '--out', out, '--title', 'Shop', '--canvas', 'all', join(dir, 'source', 'checkout.ir.json'), join(dir, 'source', 'login.ir.json')]).code).toBe(0);
    const r = run(['drift', out, dir]);
    expect(r.code).toBe(0);
    expect(r.json).toMatchObject({ drifted: false, bundled: true, bundle: { title: 'Shop', canvas: ['checkout', 'login'], gap: 120 } });
  });

  it('drift exits 1 on a Mermaid file or bad usage', () => {
    const dir = makeRun();
    const mmd = join(dir, 'x.mmd');
    writeFileSync(mmd, 'flowchart TD\n a --> b\n');
    expect(run(['drift', mmd, join(dir, 'source', 'checkout.ir.json')]).code).toBe(1);
    expect(run(['drift', mmd]).code).toBe(1);
  });

  it('snapshot, revisions and restore round-trip a run', () => {
    const dir = makeRun();
    const s = run(['snapshot', dir, '--request', 'before change', '--bundle', '{"title":"Shop"}']);
    expect(s.code).toBe(0);
    expect(s.json).toMatchObject({ ok: true, rev: 'r001', files: ['checkout.ir.json', 'login.ir.json'] });
    writeFileSync(join(dir, 'source', 'checkout.ir.json'), readFileSync(join(fixturesDir, 'flowchart', 'valid.json'), 'utf8').replace('Order checkout', 'Changed'));
    const list = run(['revisions', dir]);
    expect(list.json.revisions.map((r) => r.request)).toEqual(['before change']);
    const r = run(['restore', dir, 'r001']);
    expect(r.code).toBe(0);
    expect(r.json).toMatchObject({ ok: true, restored: 'r001', snapshot: 'r002', bundle: { title: 'Shop' } });
    expect(readFileSync(join(dir, 'source', 'checkout.ir.json'), 'utf8')).toContain('Order checkout');
  });

  it('snapshot, revisions and restore exit 1 on bad usage', () => {
    const dir = makeRun();
    expect(run(['snapshot']).code).toBe(1);
    expect(run(['snapshot', dir, '--keep', '0']).code).toBe(1);
    expect(run(['snapshot', dir, '--bundle', 'not json']).code).toBe(1);
    expect(run(['revisions', join(cwd, 'nowhere')]).code).toBe(1);
    expect(run(['restore', dir]).code).toBe(1);
    expect(run(['restore', dir, 'r042']).code).toBe(1);
  });
});
