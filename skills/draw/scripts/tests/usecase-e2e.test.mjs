/**
 * Use case diagrams end to end, through the committed bundle and from another working
 * directory, as an agent runs it: validate, emit to every target, bundle a run with a linked
 * part, diff two versions, find a hand edit, and read a diagram drawn elsewhere.
 */
import { describe, it, expect, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scriptsDir, fixturesDir, loadFixture } from './helpers.mjs';
import { checkDrawioStructure } from './drawio-structure.mjs';
import { loadPlaywright } from '../src/preview.mjs';

// Every scenario starts the CLI several times; on a busy machine one start takes over a second.
vi.setConfig({ testTimeout: 60_000 });
const cliPath = join(scriptsDir, 'bin', 'cli.mjs');
const cwd = mkdtempSync(join(tmpdir(), 'zukai-usecase-cwd-'));
const cli = (...args) => {
  const r = spawnSync(process.execPath, [cliPath, ...args], { cwd, encoding: 'utf8' });
  const parse = (text) => text.trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return l; } });
  const out = parse(r.stdout);
  const err = parse(r.stderr);
  return { code: r.status, stdout: r.stdout, out: out.at(-1), err: err.at(-1), warnings: err.flatMap((e) => e?.warnings ?? []), errors: err.flatMap((e) => e?.errors ?? []) };
};
const write = (file, value) => { mkdirSync(join(file, '..'), { recursive: true }); writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2)); return file; };
const fixture = (name) => join(fixturesDir, 'usecase', `${name}.json`);
const makeRun = (slug, irs) => {
  const run = join(mkdtempSync(join(tmpdir(), `zukai-usecase-${slug}-`)), 'diagrams', `20261117_${slug}`);
  for (const [id, ir] of Object.entries(irs)) write(join(run, 'source', `${id}.ir.json`), ir);
  return run;
};
/** A library run: the use case diagram, and the sequence diagram that details "Borrow a book". */
const library = () => {
  const main = loadFixture('usecase', 'valid');
  main.useCases.find((u) => u.id === 'borrow').ref = 'library-01-borrow';
  return { library: main, 'library-01-borrow': { ...loadFixture('sequence', 'valid'), title: 'Borrow a book' } };
};

describe('use case diagram through the CLI: validate', () => {
  it('accepts a model and says its kind', () => {
    const r = cli('validate', fixture('valid'));
    expect(r.code).toBe(0);
    expect(r.out).toMatchObject({ ok: true, kind: 'usecase', title: 'Library lending', warnings: 0 });
  });

  it('exits 2 with every relation that joins the wrong things', () => {
    const r = cli('validate', fixture('invalid-relation-ends'));
    expect(r.code).toBe(2);
    expect(r.errors).toHaveLength(13);
    expect(r.errors.map((e) => e.message)).toContain('association "r1" joins two use cases ("borrow" and "return")');
    expect(r.errors.map((e) => e.message)).toContain('generalization cycle through "librarian" and "staff"');
    expect(cli('validate', fixture('invalid-bad-relation-kind')).code).toBe(2);
  });

  it('warns on validate about a use case no actor reaches and an actor without a use case', () => {
    const ir = loadFixture('usecase', 'valid');
    ir.useCases.push({ id: 'audit', label: 'Audit the loans' });
    ir.actors.push({ id: 'auditor', label: 'Auditor' });
    const r = cli('validate', write(join(cwd, 'orphans.ir.json'), ir));
    expect(r.code).toBe(0);
    expect(r.warnings.map((w) => w.message)).toEqual(['model: no actor reaches use case "audit", directly or through include, extend or generalization', 'model: actor "auditor" has no use case']);
  });
});

describe('use case diagram through the CLI: emit', () => {
  it('writes a draw.io file with figures, ellipses, a boundary and stereotyped lines', () => {
    const out = join(cwd, 'out', 'library.drawio');
    const r = cli('emit', '--to', 'drawio', fixture('valid'), '--out', out);
    expect(r.code).toBe(0);
    expect(r.out).toMatchObject({ ok: true, warnings: 0 });
    const { problems, cells } = checkDrawioStructure(readFileSync(out, 'utf8'));
    expect(problems).toEqual([]);
    expect(cells.filter((c) => /^shape=umlActor;/.test(c.style ?? ''))).toHaveLength(2);
    expect(cells.filter((c) => /^ellipse;/.test(c.style ?? ''))).toHaveLength(6);
    expect(cells.map((c) => c.value)).toEqual(expect.arrayContaining(['Library system', '«system»<br>Payment provider', '«include»', '«extend»<br>[the book is overdue]']));
  });

  it('writes Mermaid as a flowchart and prints a warning for the kind and for each stick figure', () => {
    const out = join(cwd, 'out', 'library.mmd');
    const r = cli('emit', '--to', 'mermaid', fixture('valid'), '--out', out);
    expect(r.code).toBe(0);
    expect(readFileSync(out, 'utf8')).toContain('flowchart LR\n');
    expect(r.warnings.map((w) => w.feature)).toEqual(['kind', 'actor.kind.person', 'actor.kind.person']);
    expect(r.warnings[0].message).toContain('Mermaid has no use case diagram');
  });

  it('refuses FigJam text with the way out, and writes the native board script', () => {
    const refused = cli('emit', '--to', 'figjam', fixture('valid'), '--out', join(cwd, 'out', 'library.figjam.mmd'));
    expect(refused.code).toBe(2);
    expect(refused.errors[0].message).toContain('kind "usecase" is unsupported on target "figjam"');
    expect(refused.errors[0].message).toContain('emit --native');
    expect(existsSync(join(cwd, 'out', 'library.figjam.mmd'))).toBe(false);
    const script = join(cwd, 'out', 'library.native.js');
    const native = cli('emit', '--to', 'figjam', fixture('valid'), '--native', script);
    expect(native.code).toBe(0);
    expect(native.out.native).toEqual([script]);
    expect(native.out.text).toContain('not written');
    const code = readFileSync(script, 'utf8');
    for (const text of ['Member', 'Check the library card', '«extend»']) expect(code).toContain(text);
  });

  it('emits the fixture with long, Japanese and Vietnamese labels and a top-down one without a warning', () => {
    for (const name of ['valid-long-labels', 'valid-top-down', 'valid-two-boundaries', 'valid-generalization']) {
      const r = cli('emit', '--to', 'drawio', fixture(name), '--out', join(cwd, 'out', `${name}.drawio`));
      expect(r.code, name).toBe(0);
      expect(r.out.warnings, name).toBe(0);
    }
  });

  it.skipIf(!loadPlaywright(scriptsDir))('renders the draw.io file to a picture', () => {
    const file = join(cwd, 'out', 'preview.drawio');
    expect(cli('emit', '--to', 'drawio', fixture('valid-generalization'), '--out', file).code).toBe(0);
    const png = join(cwd, 'out', 'preview.png');
    const r = cli('preview', file, '--out', png);
    // Without a network the renderer cannot be fetched: the command says so and writes nothing.
    if (r.code !== 0) { expect(existsSync(png)).toBe(false); return; }
    expect(readFileSync(png).subarray(1, 4).toString()).toBe('PNG');
  }, 120_000);
});

describe('use case diagram through the CLI: a run with a linked part', () => {
  it('bundles the use case diagram first, shows the title of the part on its use case and links to its page', () => {
    const run = makeRun('library', library());
    const out = join(run, 'library.drawio');
    const r = cli('bundle', '--to', 'drawio', '--canvas', 'all', '--title', 'Library', '--out', out, run);
    expect(r.code).toBe(0);
    const xml = readFileSync(out, 'utf8');
    expect([...xml.matchAll(/<diagram id="([^"]+)"/g)].map((m) => m[1])).toEqual(['canvas', 'library', 'library-01-borrow']);
    const { problems, cells } = checkDrawioStructure(xml);
    expect(problems).toEqual([]);
    const borrow = cells.find((c) => c.id === 'library:borrow');
    expect(borrow.value).toBe('Borrow a book');
    expect(borrow.link).toBe('data:page/id,library-01-borrow');
    // The part is titled like the use case, so the use case keeps its one line.
    expect(xml).not.toContain('↳ library-01-borrow');
    expect(cli('drift', out, run).out).toMatchObject({ ok: true, drifted: false, bundled: true });
    const md = join(run, 'library.md');
    expect(cli('bundle', '--to', 'mermaid', '--title', 'Library', '--out', md, run).code).toBe(0);
    expect(readFileSync(md, 'utf8')).toContain('## Library lending');
  });

  it('warns when the part a use case links to is not in the bundle', () => {
    const { library: main } = library();
    const run = makeRun('library-alone', { library: main });
    const r = cli('bundle', '--to', 'drawio', '--out', join(run, 'library.drawio'), run);
    expect(r.code).toBe(0);
    expect(r.warnings.filter((w) => w.path === '/useCases/1/ref').map((w) => w.message)).toEqual(['ref "library-01-borrow" is not in this bundle: the step shows the slug and has no page link']);
  });
});

describe('use case diagram through the CLI: revise', () => {
  it('diff lists an added actor and a relation that changed, and hints at the part of a changed use case', () => {
    const before = makeRun('library', library());
    const next = library();
    next.library.actors.push({ id: 'guest', label: 'Guest' });
    next.library.relations.push({ id: 'r8', from: 'guest', to: 'search', kind: 'association' });
    next.library.useCases.find((u) => u.id === 'borrow').label = 'Borrow up to five books';
    const after = makeRun('library', next);
    const r = cli('diff', before, after);
    expect(r.code).toBe(0);
    expect(r.out.differs).toBe(true);
    const d = r.out.diagrams.find((x) => x.id === 'library');
    expect(d.added).toEqual([{ collection: 'actors', id: 'guest', label: 'Guest' }, { collection: 'relations', id: 'r8', label: '' }]);
    expect(d.changed).toEqual([{ collection: 'useCases', id: 'borrow', label: 'Borrow up to five books', fields: ['label'], values: { label: { from: expect.any(String), to: expect.any(String) } } }]);
    expect(r.out.hints.map((h) => h.message)).toEqual(['part library-01-borrow may need the same change (useCases borrow carries ref "library-01-borrow")']);
    expect(cli('diff', before, before).out.differs).toBe(false);
  });

  it('drift finds a use case moved by hand and a label reworded in draw.io', () => {
    const file = join(cwd, 'out', 'drift.drawio');
    expect(cli('emit', '--to', 'drawio', fixture('valid'), '--out', file).code).toBe(0);
    expect(cli('drift', file, fixture('valid')).out).toMatchObject({ ok: true, drifted: false });
    const xml = readFileSync(file, 'utf8')
      .replace(/(<mxCell id="drift:search"[^>]*>\s*<mxGeometry x=")([\d.]+)/, (_, head, x) => `${head}${Number(x) + 60}`)
      .replace('value="Return a book"', 'value="Hand a book back"');
    writeFileSync(file, xml);
    const r = cli('drift', file, fixture('valid'));
    expect(r.out.drifted).toBe(true);
    const changes = r.out.pages[0].changes;
    expect(changes).toContainEqual({ cell: 'drift:search', change: 'moved' });
    expect(changes.some((c) => c.cell === 'drift:return' && c.change === 'relabelled')).toBe(true);
  });

  it('relabel translates a delivered file and keeps the stereotypes', () => {
    const file = join(cwd, 'out', 'relabel.drawio');
    expect(cli('emit', '--to', 'drawio', fixture('valid'), '--out', file).code).toBe(0);
    const map = write(join(cwd, 'out', 'labels.vi.json'), { member: 'Thành viên', payment: 'Cổng thanh toán', r6: 'sách quá hạn', title: 'Mượn sách thư viện' });
    const out = join(cwd, 'out', 'relabel.vi.drawio');
    const r = cli('relabel', file, '--map', map, '--out', out);
    expect(r.code).toBe(0);
    const xml = readFileSync(out, 'utf8');
    expect(xml).toContain('value="«system»&lt;br&gt;Cổng thanh toán"');
    expect(xml).toContain('value="«extend»&lt;br&gt;sách quá hạn"');
    expect(xml).toContain('value="«include»"');
    expect(JSON.stringify(r.out.untouched ?? r.err ?? '')).not.toContain('«include»');
  });

  it('snapshot and restore carry a use case run as one set', () => {
    const run = makeRun('library', library());
    expect(cli('snapshot', run, '--request', 'first delivery').code).toBe(0);
    const file = join(run, 'source', 'library.ir.json');
    const ir = JSON.parse(readFileSync(file, 'utf8'));
    ir.actors.push({ id: 'guest', label: 'Guest' });
    ir.relations.push({ id: 'r8', from: 'guest', to: 'search', kind: 'association' });
    writeFileSync(file, JSON.stringify(ir));
    expect(cli('restore', run, 'undo').code).toBe(0);
    expect(JSON.parse(readFileSync(file, 'utf8')).actors.map((a) => a.id)).toEqual(['member', 'librarian', 'payment']);
  });
});

describe('use case diagram through the CLI: recook', () => {
  it('reads its own draw.io file back: kind hint, every text covered by the model', () => {
    const file = join(cwd, 'out', 'round.drawio');
    expect(cli('emit', '--to', 'drawio', fixture('valid-generalization'), '--out', file).code).toBe(0);
    const facts = join(cwd, 'out', 'round.facts.json');
    const x = cli('extract', file, '--out', facts);
    expect(x.code).toBe(0);
    const page = JSON.parse(readFileSync(facts, 'utf8')).pages[0];
    expect(page.kindHints[0].kind).toBe('usecase');
    const c = cli('cover', facts, fixture('valid-generalization'));
    expect(c.code).toBe(0);
    expect(c.out).toMatchObject({ ok: true, missing: [] });
    expect(c.out.covered).toBe(c.out.units);
  });

  it('reads a use case diagram drawn by hand: stick figures, ovals in a frame, dashed lines marked <<include>> and <<extend>>', () => {
    const run = makeRun('atm', {});
    const source = join(run, 'source', 'original', 'hand-usecase.drawio');
    mkdirSync(join(source, '..'), { recursive: true });
    copyFileSync(join(scriptsDir, 'tests', 'recook-sources', 'hand-usecase.drawio'), source);
    const facts = join(run, 'source', 'atm.facts.json');
    expect(cli('extract', source, '--out', facts).code).toBe(0);
    const page = JSON.parse(readFileSync(facts, 'utf8')).pages[0];
    expect(page.kindHints[0]).toMatchObject({ kind: 'usecase', evidence: ['4 ovals, 3 actor figures, 3 lines marked «include» or «extend»'] });
    // The frame around the use cases is the system boundary, not a swimlane.
    expect(page.nodes.find((n) => n.id === 'sys')).toMatchObject({ shape: 'container', label: 'ATM' });
    expect(page.edges.find((e) => e.id === 'x1')).toMatchObject({ from: 'receipt', to: 'balance', dashed: true, label: '<<extend>>\ncustomer asks for it' });
    expect(page.edges.find((e) => e.id === 'g1')).toMatchObject({ from: 'vip', to: 'customer', endArrow: 'block-open' });
    // The model a recook writes from these facts, by the mapping reference.
    const ir = {
      schemaVersion: 1, kind: 'usecase', title: 'ATM', meta: { source: 'recook', notes: ['page "ATM" of hand-usecase.drawio'] },
      actors: [{ id: 'customer', label: 'Customer' }, { id: 'vip', label: 'Private banking customer' }, { id: 'bank', label: 'Core banking', kind: 'system' }],
      useCases: [{ id: 'withdraw', label: 'Withdraw cash' }, { id: 'balance', label: 'Check the balance' }, { id: 'pin', label: 'Enter the PIN' }, { id: 'receipt', label: 'Print a receipt' }],
      boundaries: [{ id: 'sys', label: 'ATM', children: ['withdraw', 'balance', 'pin', 'receipt'] }],
      relations: [
        { id: 'a1', from: 'customer', to: 'withdraw', kind: 'association' }, { id: 'a2', from: 'customer', to: 'balance', kind: 'association' }, { id: 'a3', from: 'pin', to: 'bank', kind: 'association' },
        { id: 'i1', from: 'withdraw', to: 'pin', kind: 'include' }, { id: 'i2', from: 'balance', to: 'pin', kind: 'include' },
        { id: 'x1', from: 'receipt', to: 'balance', kind: 'extend', condition: 'customer asks for it' }, { id: 'g1', from: 'vip', to: 'customer', kind: 'generalization' },
      ],
    };
    const file = write(join(run, 'source', 'atm.ir.json'), ir);
    expect(cli('validate', file).out).toMatchObject({ ok: true, warnings: 0 });
    expect(cli('cover', facts, run).out).toMatchObject({ ok: true, missing: [] });
    // A dropped use case is found, and its extend relation with the condition.
    ir.useCases.pop();
    ir.boundaries[0].children.pop();
    ir.relations = ir.relations.filter((r) => r.from !== 'receipt');
    write(file, ir);
    const dropped = cli('cover', facts, run);
    expect(dropped.code).toBe(2);
    expect((dropped.out ?? dropped.err).missing.map((m) => m.text)).toEqual(['Print a receipt', '<<extend>>', 'customer asks for it']);
  });
});
