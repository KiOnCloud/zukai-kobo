import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scriptsDir, fixturesDir } from './helpers.mjs';
import { standInFigma } from './figma-stand-in.mjs';

const cli = join(scriptsDir, 'bin', 'cli.mjs');
const dir = mkdtempSync(join(tmpdir(), 'zukai-figjam-calls-'));
const run = (...args) => {
  const r = spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8' });
  return { code: r.status, out: r.stdout ? JSON.parse(r.stdout) : null, err: r.stderr };
};
const fixture = (kind, name) => join(fixturesDir, kind, `${name}.json`);

describe('what a FigJam board costs in calls, and how each call is checked', () => {
  it('emit --native says how many use_figma calls the board takes and what each call must report as created', async () => {
    const r = run('emit', '--to', 'figjam', fixture('usecase', 'valid'), '--native', join(dir, 'uc.native.js'));
    expect(r.code).toBe(0);
    expect(r.out).toMatchObject({ calls: 1, native: [join(dir, 'uc.native.js')] });
    expect(r.out.bytes).toEqual([statSync(join(dir, 'uc.native.js')).size]);
    const board = standInFigma();
    const result = await board.run(readFileSync(join(dir, 'uc.native.js'), 'utf8'));
    expect(r.out.created).toEqual([result.created]);
  });

  it('counts one call per part when a drawing needs several scripts', () => {
    const r = run('emit', '--to', 'figjam', fixture('flowchart', 'valid'), '--out', join(dir, 'f.mmd'), '--native', join(dir, 'f.native.js'));
    expect(r.code).toBe(0);
    expect(r.out.calls).toBe(r.out.native.length);
    expect(r.out.created).toHaveLength(r.out.native.length);
  });

  it('bundle --to figjam --native draws several diagrams with fewer calls, each into its own section', async () => {
    const irs = [fixture('architecture', 'valid-gcp-invoicing'), fixture('usecase', 'valid'), fixture('class', 'valid')];
    const r = run('bundle', '--to', 'figjam', '--native', join(dir, 'run.native.js'), ...irs);
    expect(r.code).toBe(0);
    expect(r.out.diagrams).toBe(3);
    expect(r.out.calls).toBeLessThan(3);
    expect(r.out.drawings.reduce((a, b) => a + b, 0)).toBe(3);
    const board = standInFigma();
    const results = [];
    const returned = [];
    for (const file of r.out.native) {
      const result = await board.run(readFileSync(file, 'utf8'));
      const list = Array.isArray(result) ? result : [result];
      results.push(...list);
      returned.push(list.map((x) => x.created));
      expect(readFileSync(file, 'utf8').length).toBeLessThanOrEqual(50000);
    }
    expect(results).toHaveLength(3);
    expect(new Set(results.map((x) => x.section)).size).toBe(3);
    expect(board.page.children.map((s) => s.name)).toEqual(irs.map((f) => JSON.parse(readFileSync(f, 'utf8')).title));
    // For each script, the created count of each drawing in it, in the order the script returns them.
    expect(r.out.created).toEqual(returned);
    expect(r.out.created.map((c) => c.length)).toEqual(r.out.drawings);
    // Each diagram is drawn as its own emit --native draws it.
    for (const [i, f] of irs.entries()) {
      const one = run('emit', '--to', 'figjam', f, '--native', join(dir, `one-${i}.native.js`));
      expect(results[i].created).toBe(one.out.created[0]);
    }
    // Options of the other bundle targets are refused, and --native goes with figjam only.
    expect(run('bundle', '--to', 'figjam', '--native', join(dir, 'x.js'), '--out', join(dir, 'x.mmd'), irs[0]).code).toBe(1);
    expect(run('bundle', '--to', 'drawio', '--native', join(dir, 'x.js'), '--out', join(dir, 'x.drawio'), irs[0]).code).toBe(1);
  });

  it('draws over no section of the same title but one it drew for the same run', async () => {
    const ir = JSON.parse(readFileSync(fixture('usecase', 'valid'), 'utf8'));
    // A run, and the recook of its board: a new run whose diagram keeps the title.
    const irOf = (folder) => {
      const source = join(dir, 'diagrams', folder, 'source');
      mkdirSync(source, { recursive: true });
      writeFileSync(join(source, 'clinic.ir.json'), JSON.stringify(ir));
      return join(source, 'clinic.ir.json');
    };
    const scriptOf = (folder) => {
      const r = run('emit', '--to', 'figjam', irOf(folder), '--native', join(dir, `${folder}.native.js`));
      expect(r.code).toBe(0);
      return readFileSync(r.out.native[0], 'utf8');
    };
    const original = scriptOf('20261101_clinic');
    const recooked = scriptOf('20261118_clinic-recook');
    const leaves = (n) => (n.children ?? []).flatMap((c) => (c.children ? leaves(c) : [c]));
    const board = standInFigma();
    // A section of that title that Zukai did not draw.
    const theirs = board.figma.createSection();
    theirs.name = ir.title;
    const note = board.figma.createRectangle();
    theirs.appendChild(note);
    const first = await board.run(original);
    expect(first).toMatchObject({ name: `${ir.title} (2)`, replaced: 0 });
    expect(theirs.children).toEqual([note]);
    const S = board.page.children.find((s) => s.id === first.section);
    expect(new Set(leaves(S).map((n) => n.name))).toEqual(new Set(['zukai-native 20261101_clinic']));
    // The recook drawn back onto the board it came from leaves the source's section as it is.
    const kept = leaves(S);
    const second = await board.run(recooked);
    expect(second).toMatchObject({ name: `${ir.title} (3)`, replaced: 0, created: first.created });
    expect(leaves(S)).toEqual(kept);
    // Drawn again for the same run, the section of that run is replaced in place.
    const third = await board.run(original);
    expect(third).toMatchObject({ section: first.section, name: `${ir.title} (2)`, replaced: first.created, created: first.created });
    expect(leaves(S)).toHaveLength(first.created);
    expect(leaves(S).some((n) => kept.includes(n))).toBe(false);
    expect(board.page.children.map((s) => s.name)).toEqual([ir.title, `${ir.title} (2)`, `${ir.title} (3)`]);
    expect(theirs.children).toEqual([note]);
    expect(leaves(board.page.children.find((s) => s.id === second.section))).toHaveLength(second.created);
  });

  it('the reader script is one call per part', () => {
    expect(run('extract', '--figjam-script', join(dir, 'read.js')).out).toMatchObject({ calls: 1, from: 0 });
  });

  it('a kind FigJam text cannot show is refused with a hint that names --native', () => {
    const r = spawnSync(process.execPath, [cli, 'emit', '--to', 'figjam', fixture('usecase', 'valid')], { encoding: 'utf8' });
    expect(r.status).toBe(2);
    expect(JSON.parse(r.stderr.trim().split('\n').pop()).errors[0].hint).toMatch(/--native/);
  });
});
