import { describe, it, expect } from 'vitest';
import { emit, bundle, inspect } from '../src/pipeline.mjs';
import { validateIr } from '../src/validate-ir.mjs';
import { checkModel } from '../src/check-model.mjs';
import { measureEllipse, wrapText } from '../src/layout-graph.mjs';
import { widestLine, roomFor } from '../src/text-metrics.mjs';
import { extractDrawio } from '../src/extract-drawio.mjs';
import { extractMermaid } from '../src/extract-mermaid.mjs';
import { cover } from '../src/cover.mjs';
import { relabelDrawio } from '../src/relabel.mjs';
import { driftDrawio } from '../src/drift.mjs';
import { diffIr } from '../src/ir-diff.mjs';
import { figjamNative } from '../src/figjam-native.mjs';
import { loadPlaywright } from '../src/preview.mjs';
import { checkDrawioStructure, absoluteBounds, edgePaths } from './drawio-structure.mjs';
import { loadFixture, validFixtures, scriptsDir } from './helpers.mjs';

const pw = loadPlaywright(scriptsDir);
const fixtures = validFixtures().filter((f) => f.kind === 'usecase');
const clone = (x) => JSON.parse(JSON.stringify(x));
const roleOf = (a) => a.role ?? (a.kind === 'system' ? 'supporting' : 'primary');
const small = () => ({
  schemaVersion: 1, kind: 'usecase', title: 'Lending',
  actors: [{ id: 'member', label: 'Member' }, { id: 'bank', label: 'Bank', kind: 'system' }],
  useCases: [{ id: 'borrow', label: 'Borrow a book' }, { id: 'check', label: 'Check the card' }, { id: 'pay', label: 'Pay a fee' }],
  boundaries: [{ id: 'lib', label: 'Library', children: ['borrow', 'check', 'pay'] }],
  relations: [
    { id: 'r1', from: 'member', to: 'borrow', kind: 'association' },
    { id: 'r2', from: 'borrow', to: 'check', kind: 'include' },
    { id: 'r3', from: 'pay', to: 'borrow', kind: 'extend', condition: 'the loan is late' },
    { id: 'r4', from: 'bank', to: 'pay', kind: 'association' },
  ],
});

async function drawn(ir, id = 'u') {
  const r = await emit(ir, 'drawio', { diagramId: id });
  expect(r.errors).toEqual([]);
  const { problems, cells } = checkDrawioStructure(r.output);
  expect(problems).toEqual([]);
  const abs = absoluteBounds(cells);
  return { r, cells, abs, box: (el) => abs.get(`${id}:${el}`), cell: (el) => cells.find((c) => c.id === `${id}:${el}`), paths: edgePaths(cells, abs) };
}

describe('use case diagram: validation', () => {
  it('names every relation that joins the wrong things, a use case in two boundaries and an actor inside one', () => {
    const r = validateIr(loadFixture('usecase', 'invalid-relation-ends'));
    expect(r.ok).toBe(false);
    expect(r.errors.map((e) => `${e.path}: ${e.message}`)).toEqual([
      '/boundaries/0/children/2: actor "member" cannot be inside boundary "desk"',
      '/boundaries/1/children/0: use case "return" is already in boundary "desk"',
      '/boundaries/1/children/2: unknown use case "ghost"',
      '/relations/9/to: unknown actor or use case "nowhere"',
      '/relations/0: association "r1" joins two use cases ("borrow" and "return")',
      '/relations/1: association "r2" joins two actors ("member" and "librarian")',
      '/relations/2/from: include "r3" starts at actor "member"',
      '/relations/3/to: extend "r4" ends at actor "librarian"',
      '/relations/4: generalization "r5" joins actor "member" and use case "renew"',
      '/relations/7/condition: relation "r8" is an include and cannot carry a condition',
      '/relations/8: relation "r9" joins "renew" to itself',
      '/relations/5: generalization cycle through "librarian" and "staff"',
      '/relations/6: generalization cycle through "staff" and "librarian"',
    ]);
    for (const e of r.errors) expect(e.hint, e.path).toBeTruthy();
  });

  it('rejects an unknown relation kind, a relation without a kind and fields the schema does not have', () => {
    const r = validateIr(loadFixture('usecase', 'invalid-bad-relation-kind'));
    expect(r.errors.map((e) => e.path)).toEqual(['/actors/0', '/actors/0/kind', '/relations/0/kind', '/relations/1', '/useCases/0']);
    expect(r.errors.find((e) => e.path === '/relations/0/kind').hint).toContain('"generalization"');
  });

  it('takes an association written from either end, and a generalization chain without a loop', () => {
    const ir = small();
    ir.relations[0] = { id: 'r1', from: 'borrow', to: 'member', kind: 'association' };
    ir.actors.push({ id: 'student', label: 'Student' }, { id: 'pupil', label: 'Pupil' });
    ir.relations.push({ id: 'g1', from: 'student', to: 'member', kind: 'generalization' }, { id: 'g2', from: 'pupil', to: 'student', kind: 'generalization' });
    expect(validateIr(ir)).toEqual({ ok: true, errors: [] });
    expect(checkModel(ir).warnings).toEqual([]);
  });

  it('keeps ids unique across actors, use cases, boundaries and relations', () => {
    const ir = small();
    ir.boundaries[0].id = 'member';
    expect(validateIr(ir).errors.map((e) => e.message)).toEqual(['duplicate id "member", first used at /actors/0']);
  });
});

describe('use case diagram: model warnings', () => {
  it('reports nothing for the fixtures', () => {
    for (const { name, ir } of fixtures) expect(inspect(ir), name).toEqual([]);
  });

  it('reports a use case no actor reaches, an actor without a use case and a repeated relation', () => {
    const ir = small();
    ir.useCases.push({ id: 'audit', label: 'Audit the loans' }, { id: 'export', label: 'Export the audit' });
    ir.relations.push({ id: 'r5', from: 'audit', to: 'export', kind: 'include' }, { id: 'r6', from: 'borrow', to: 'member', kind: 'association' });
    ir.actors.push({ id: 'auditor', label: 'Auditor' });
    const w = checkModel(ir).warnings;
    expect(w.map((x) => `${x.path}: ${x.message}`)).toEqual([
      '/useCases/3: model: no actor reaches use case "audit", directly or through include, extend or generalization',
      '/useCases/4: model: no actor reaches use case "export", directly or through include, extend or generalization',
      '/actors/2: model: actor "auditor" has no use case',
      '/relations/5: model: relation "r6" repeats relation "r1" (same kind, same ends)',
    ]);
    for (const x of w) expect(x.hint).toBeTruthy();
  });

  it('reaches a use case through include, extend and generalization, and an actor through the one it is a kind of', () => {
    const ir = small();
    ir.useCases.push({ id: 'pay-card', label: 'Pay by card' });
    ir.relations.push({ id: 'g1', from: 'pay-card', to: 'pay', kind: 'generalization' });
    ir.actors.push({ id: 'student', label: 'Student' });
    ir.relations.push({ id: 'g2', from: 'student', to: 'member', kind: 'generalization' });
    // Without the bank, "pay" is still reached: it extends a use case the member starts.
    ir.relations = ir.relations.filter((r) => r.id !== 'r4');
    ir.actors = ir.actors.filter((a) => a.id !== 'bank');
    expect(checkModel(ir).warnings).toEqual([]);
  });

  it('reports more than 40 actors and use cases as a size warning', () => {
    const ir = small();
    for (let i = 0; i < 40; i++) { ir.useCases.push({ id: `u${i}`, label: `Goal ${i}` }); ir.relations.push({ id: `a${i}`, from: 'member', to: `u${i}`, kind: 'association' }); }
    const w = checkModel(ir).warnings;
    expect(w).toHaveLength(1);
    expect(w[0].message).toMatch(/^size: 45 actors and use cases in one diagram/);
  });
});

describe('use case diagram: targets', () => {
  it('is a flowchart in Mermaid, with one warning for the kind and one per element that loses its form', async () => {
    const r = await emit(loadFixture('usecase', 'valid-generalization'), 'mermaid');
    expect(r.ok).toBe(true);
    expect(r.output).toContain('flowchart LR\n');
    expect(r.output).toContain('["«actor»<br/>Customer"]');
    expect(r.output).toContain('["«system»<br/>Carrier"]');
    expect(r.output).toContain('(["Place an order"])');
    expect(r.output).toMatch(/subgraph n\d+\["Online shop"\]/);
    expect(r.output).toMatch(/n\d+ -\.->\|"«include»"\| n\d+/);
    expect(r.output).toContain('-.->|"«extend»<br/>#91;the customer has a voucher code#93;"|');
    expect(r.output).toMatch(/n\d+ -->\|"«generalization»"\| n\d+/);
    // A supporting actor stands after its use case: the line is written from the use case.
    const id = (label) => r.output.match(new RegExp(`(n\\d+)[\\[(]+"(?:«\\w+»<br/>)?${label}"`))[1];
    expect(r.output).toContain(`  ${id('Track the delivery')} --- ${id('Carrier')}\n`);
    expect(r.output).toContain(`  ${id('Customer')} --- ${id('Place an order')}\n`);
    expect(r.warnings.map((w) => w.feature)).toEqual(['kind', ...Array(4).fill('actor.kind.person'), ...Array(4).fill('relation.kind.generalization')]);
    expect(r.warnings[1].message).toContain('"customer"');
    expect(r.warnings.at(-1).message).toContain('"g4"');
  });

  it('is refused for FigJam text, and drawn on the board by emit --native from the draw.io layout', async () => {
    const ir = loadFixture('usecase', 'valid');
    const refused = await emit(ir, 'figjam');
    expect(refused.ok).toBe(false);
    expect(refused.errors[0].message).toContain('kind "usecase" is unsupported on target "figjam"');
    expect(refused.errors[0].message).toContain('emit --native');
    const native = await emit(ir, 'figjam', { native: true });
    expect(native.ok).toBe(true);
    expect(native.output).toBeUndefined();
    expect(native.textSkipped).toContain('unsupported');
    expect(native.native.length).toBeGreaterThan(0);
    const script = native.native.join('\n');
    for (const text of ['Member', 'Borrow a book', 'Library system', '«include»', 'Payment provider']) expect(script, text).toContain(text);
    // Every actor figure, use case and line of the draw.io file is on the board.
    const drawio = (await emit(ir, 'drawio')).output;
    expect(figjamNative(drawio, { title: ir.title }).parts.join('\n')).toBe(script);
  });

  it('emits every fixture to draw.io without a warning, twice the same', async () => {
    for (const { name, ir } of fixtures) {
      const a = await emit(ir, 'drawio', { diagramId: name });
      expect(a.warnings, name).toEqual([]);
      expect((await emit(clone(ir), 'drawio', { diagramId: name })).output, name).toBe(a.output);
    }
  });
});

describe('use case diagram: draw.io layout', () => {
  it('draws a person as a stick figure with the name below, a system as a box marked «system», a use case as an ellipse', async () => {
    const { cell } = await drawn(loadFixture('usecase', 'valid'));
    expect(cell('member').style).toMatch(/^shape=umlActor;verticalLabelPosition=bottom;.*labelWidth=\d+;$/);
    expect(cell('member').value).toBe('Member');
    expect(cell('member').mxGeometry).toMatchObject({ width: '30', height: '60' });
    expect(cell('payment').value).toBe('«system»<br>Payment provider');
    expect(cell('payment').style).not.toContain('ellipse');
    expect(cell('borrow').style).toMatch(/^ellipse;whiteSpace=wrap;html=1;spacingLeft=\d+;spacingRight=\d+;$/);
    expect(cell('library').style).toContain('container=1;');
    expect(cell('library').style).toContain('verticalAlign=top;');
    expect(cell('borrow').parent).toBe('u:library');
    expect(cell('member').parent).toBe('1');
  });

  it('draws include and extend dashed with an open arrow and the stereotype, the condition in brackets, and a generalization as a hollow triangle', async () => {
    const { cell } = await drawn(loadFixture('usecase', 'valid-generalization'));
    for (const id of ['i1', 'x1']) {
      expect(cell(id).style).toContain('dashed=1;endArrow=open;');
      expect(cell(id).style).toContain('endFill=0;');
    }
    expect(cell('i1:label').value).toBe('«include»');
    expect(cell('x1:label').value).toBe('«extend»<br>[the customer has a voucher code]');
    expect(cell('x1').source).toBe('u:apply-voucher');
    expect(cell('x1').target).toBe('u:place-order');
    for (const id of ['g1', 'g2', 'g3']) expect(cell(id).style).toContain('endArrow=block;endSize=14;endFill=0;');
    expect(cell('g1').style).not.toContain('dashed');
    expect(cell('a1').style).toContain('endArrow=none;');
    expect(cell('a1:label')).toBeUndefined();
  });

  for (const { name, ir } of fixtures) {
    it(`${name}: primary actors before the boundaries, supporting ones after, and no line through a shape it does not end on`, async () => {
      const { cells, abs, box, paths } = await drawn(ir);
      const direction = ir.direction ?? 'LR';
      const along = direction === 'LR' ? 'x' : 'y';
      const size = along === 'x' ? 'width' : 'height';
      const frames = (ir.boundaries ?? []).map((b) => box(b.id));
      for (const a of ir.actors) {
        const b = box(a.id);
        for (const f of frames) {
          if (roleOf(a) === 'primary') expect(b[along] + b[size], a.id).toBeLessThan(f[along]);
          else expect(b[along], a.id).toBeGreaterThan(f[along] + f[size]);
        }
      }
      // Every use case is inside its boundary, and no two shapes overlap.
      for (const b of ir.boundaries ?? []) {
        const f = box(b.id);
        for (const child of b.children) {
          const c = box(child);
          expect(c.x >= f.x && c.y >= f.y + 30 && c.x + c.width <= f.x + f.width && c.y + c.height <= f.y + f.height, child).toBe(true);
        }
      }
      const shapes = [...ir.actors, ...ir.useCases].map((el) => ({ id: el.id, ...box(el.id) }));
      for (const [i, p] of shapes.entries()) for (const q of shapes.slice(i + 1)) expect(p.x < q.x + q.width && q.x < p.x + p.width && p.y < q.y + q.height && q.y < p.y + p.height, `${p.id} over ${q.id}`).toBe(false);
      // A line touches only the two shapes it joins; every segment is horizontal or vertical.
      const relations = new Map(ir.relations.map((r) => [`u:${r.id}`, r]));
      const segments = [];
      for (const [id, path] of paths) {
        const r = relations.get(id);
        for (let i = 1; i < path.length; i++) {
          const [p, q] = [path[i - 1], path[i]];
          expect(Math.min(Math.abs(p.x - q.x), Math.abs(p.y - q.y)), `${id} segment ${i}`).toBeLessThan(0.6);
          const seg = { id, x0: Math.min(p.x, q.x), x1: Math.max(p.x, q.x), y0: Math.min(p.y, q.y), y1: Math.max(p.y, q.y) };
          segments.push(seg);
          for (const s of shapes) {
            if (s.id === r.from || s.id === r.to) continue;
            expect(seg.x1 > s.x && seg.x0 < s.x + s.width && seg.y1 > s.y && seg.y0 < s.y + s.height, `${id} runs through ${s.id}`).toBe(false);
          }
        }
        // Both ends lie on their shapes: on the outline of an ellipse, on or under a figure.
        for (const [end, pt] of [[r.from, path[0]], [r.to, path.at(-1)]]) {
          const b = box(end);
          if (ir.useCases.some((u) => u.id === end)) {
            const on = ((pt.x - b.x - b.width / 2) / (b.width / 2)) ** 2 + ((pt.y - b.y - b.height / 2) / (b.height / 2)) ** 2;
            expect(Math.abs(on - 1), `${id} at ${end}`).toBeLessThan(0.06);
          } else {
            expect(pt.x >= b.x - 0.5 && pt.x <= b.x + b.width + 0.5 && pt.y >= b.y - 0.5 && pt.y <= b.y + b.height + 40, `${id} at ${end}`).toBe(true);
          }
        }
      }
      // No label on a line: the box of every stereotype label is clear of every segment and shape.
      for (const c of cells) {
        if (!String(c.id).endsWith(':label')) continue;
        const path = paths.get(c.parent);
        const lengths = path.slice(1).map((p, i) => Math.hypot(p.x - path[i].x, p.y - path[i].y));
        let left = ((Number(c.mxGeometry.x) + 1) / 2) * lengths.reduce((a, b) => a + b, 0);
        let at = path[0];
        for (const [i, l] of lengths.entries()) {
          if (left <= l || i === lengths.length - 1) { const t = l === 0 ? 0 : Math.min(1, left / l); at = { x: path[i].x + t * (path[i + 1].x - path[i].x), y: path[i].y + t * (path[i + 1].y - path[i].y) }; break; }
          left -= l;
        }
        const text = c.value.replace(/<br>/g, '\n').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
        const w = widestLine(text);
        const h = 14.4 * text.split('\n').length;
        const align = c.style.match(/align=(\w+)/)[1];
        const cx = at.x + Number(c.mxGeometry.mxPoint[0].x);
        const cy = at.y + Number(c.mxGeometry.mxPoint[0].y);
        const lb = { x: align === 'left' ? cx : align === 'right' ? cx - w : cx - w / 2, y: cy - h / 2, width: w, height: h };
        for (const s of segments) expect(s.x1 > lb.x && s.x0 < lb.x + lb.width && s.y1 > lb.y && s.y0 < lb.y + lb.height, `${c.id} on ${s.id}`).toBe(false);
        for (const s of shapes) expect(lb.x < s.x + s.width && s.x < lb.x + lb.width && lb.y < s.y + s.height && s.y < lb.y + lb.height, `${c.id} on ${s.id}`).toBe(false);
      }
      expect(abs.size).toBeGreaterThan(0);
    });
  }

  it('lets every line of an actor leave from one point of its figure', async () => {
    const { paths, box } = await drawn(loadFixture('usecase', 'valid'));
    const starts = ['r1', 'r2', 'r3'].map((id) => paths.get(`u:${id}`)[0]);
    const figure = box('member');
    for (const s of starts) expect(s).toEqual({ x: figure.x + figure.width, y: figure.y + figure.height / 2 });
  });

  it('gives the lines of each actor a track of their own, so the trunks of two actors never read as one line', async () => {
    // The receptionist books too: its new line runs past the trunk of the patient above it.
    const booking = {
      schemaVersion: 1, kind: 'usecase', title: 'Clinic',
      actors: [{ id: 'patient', label: 'Patient' }, { id: 'registered', label: 'Registered patient' }, { id: 'receptionist', label: 'Receptionist' }, { id: 'doctor', label: 'Doctor' }],
      useCases: ['search', 'register', 'book', 'cancel', 'checkin', 'today', 'schedules'].map((id) => ({ id, label: id })),
      boundaries: [{ id: 'clinic', label: 'Clinic booking', children: ['search', 'register', 'book', 'cancel', 'checkin', 'today', 'schedules'] }],
      relations: [
        { id: 'a1', from: 'patient', to: 'search', kind: 'association' },
        { id: 'a2', from: 'patient', to: 'register', kind: 'association' },
        { id: 'a3', from: 'registered', to: 'book', kind: 'association' },
        { id: 'a4', from: 'registered', to: 'cancel', kind: 'association' },
        { id: 'a5', from: 'receptionist', to: 'book', kind: 'association' },
        { id: 'a6', from: 'receptionist', to: 'checkin', kind: 'association' },
        { id: 'a7', from: 'doctor', to: 'today', kind: 'association' },
        { id: 'a8', from: 'doctor', to: 'schedules', kind: 'association' },
        { id: 'g1', from: 'registered', to: 'patient', kind: 'generalization' },
      ],
    };
    for (const [name, ir] of [...['valid-generalization', 'valid-two-boundaries'].map((n) => [n, loadFixture('usecase', n)]), ['booking', booking]]) {
      const { paths } = await drawn(ir);
      const actors = new Set(ir.actors.map((a) => a.id));
      // The stretch along the column of actors: the first one across the flow, seen from the actor.
      const trunks = [];
      for (const rel of ir.relations.filter((x) => x.kind === 'association')) {
        const actor = actors.has(rel.from) ? rel.from : rel.to;
        const path = paths.get(`u:${rel.id}`);
        const own = actor === rel.from ? path : [...path].reverse();
        for (let i = 1; i < own.length; i++) {
          if (Math.abs(own[i].x - own[i - 1].x) > 0.5) continue;
          trunks.push({ actor, x: own[i].x, lo: Math.min(own[i].y, own[i - 1].y), hi: Math.max(own[i].y, own[i - 1].y) });
          break;
        }
      }
      for (const t of trunks) for (const u of trunks) {
        if (t.actor >= u.actor || Math.abs(t.x - u.x) > 0.5) continue;
        const gap = Math.max(t.lo, u.lo) - Math.min(t.hi, u.hi);
        expect(gap, `${name}: ${t.actor} and ${u.actor} on one line at x ${t.x}`).toBeGreaterThanOrEqual(60);
      }
    }
  });

  it('draws a generalization between neighbouring actors as one straight line, and round the column past an actor between them', async () => {
    const { paths, box, cell } = await drawn(loadFixture('usecase', 'valid-generalization'));
    const [customer, guest, registered] = ['customer', 'guest', 'registered'].map(box);
    // Guest stands right below Customer: straight up from its head to under the name.
    const g1 = paths.get('u:g1');
    expect(g1).toHaveLength(2);
    expect(g1[0].x).toBe(g1[1].x);
    expect(g1[0].y).toBe(guest.y);
    expect(g1[1].y).toBeGreaterThan(customer.y + customer.height);
    expect(g1[1].y).toBeLessThan(guest.y);
    expect(cell('g1').style).toContain('entryPerimeter=0;');
    // Registered customer stands below Guest: out on the side away from the system and back.
    const g2 = paths.get('u:g2');
    expect(g2).toHaveLength(4);
    expect(g2[0]).toEqual({ x: registered.x, y: registered.y + registered.height / 2 });
    expect(g2[3]).toEqual({ x: customer.x, y: customer.y + customer.height / 2 });
    expect(g2[1].x).toBe(g2[2].x);
    expect(g2[1].x).toBeLessThan(Math.min(customer.x, guest.x, registered.x) - 15);
    expect(g2[1].x).toBeGreaterThanOrEqual(0);
  });

  it('follows the direction: top-down puts the primary actors above and the supporting ones below', async () => {
    const ir = loadFixture('usecase', 'valid-top-down');
    const { box } = await drawn(ir);
    const frame = box('garage');
    expect(box('driver').y + box('driver').height).toBeLessThan(frame.y);
    expect(box('bank').y).toBeGreaterThan(frame.y + frame.height);
    for (const direction of ['RL', 'BT']) {
      const turned = await drawn({ ...ir, direction });
      const f = turned.box('garage');
      if (direction === 'RL') expect(turned.box('driver').x).toBeGreaterThan(f.x + f.width);
      else expect(turned.box('driver').y).toBeGreaterThan(f.y + f.height);
      expect(turned.r.warnings).toEqual([]);
    }
  });

  it('draws use cases outside any boundary and a diagram without one', async () => {
    const ir = small();
    delete ir.boundaries;
    const { cell, r } = await drawn(ir);
    expect(r.warnings).toEqual([]);
    expect(cell('borrow').parent).toBe('1');
  });

  it('routes a generalization between a primary and a supporting actor through the layout', async () => {
    const ir = small();
    ir.actors.push({ id: 'clerk', label: 'Clerk', role: 'supporting' });
    ir.relations.push({ id: 'g1', from: 'clerk', to: 'member', kind: 'generalization' }, { id: 'r5', from: 'clerk', to: 'check', kind: 'association' });
    const { paths, box, r } = await drawn(ir);
    expect(r.warnings).toEqual([]);
    const g = paths.get('u:g1');
    expect(g[0].x).toBe(box('clerk').x);
    expect(g.at(-1).x).toBe(box('member').x + box('member').width);
  });
});

describe('use case diagram: size of an ellipse', () => {
  it('holds its text block inside the outline, and grows with a word that cannot break', () => {
    for (const label of ['OK', 'Borrow a book', 'Attach the receipts and the supporting documents that the finance policy asks for', '出張旅費および交際費の経費精算申請を提出する', 'ExportApprovedExpenseClaimsToAccountsPayable(batch)', 'Sync the orders\n↳ order-sync-01-load']) {
      const size = measureEllipse(label);
      const wrapAt = size.width - 2 * size.spacing - 4;
      const block = wrapText(label, wrapAt);
      const a = block.widest;
      const b = block.lines * 15;
      expect((a / size.width) ** 2 + (b / size.height) ** 2, label).toBeLessThanOrEqual(1);
      expect(wrapAt, label).toBeGreaterThanOrEqual(roomFor(wrapText(label, 1).widest) - 1);
    }
    expect(measureEllipse('OK')).toMatchObject({ width: 120, height: 50 });
    expect(measureEllipse('ExportApprovedExpenseClaimsToAccountsPayable(batch)').width).toBeGreaterThan(300);
  });

  it.skipIf(!pw)('wraps every use case label in Chromium on the lines its ellipse was sized for', async () => {
    const boxes = [];
    for (const { name, ir } of fixtures) {
      const { cells } = await drawn(ir);
      for (const c of cells) {
        if (!/^ellipse;/.test(c.style ?? '')) continue;
        const spacing = Number(c.style.match(/spacingLeft=(\d+)/)[1]);
        boxes.push({ at: `${name} ${c.id}`, html: c.value, width: Number(c.mxGeometry.width), height: Number(c.mxGeometry.height), wrap: Number(c.mxGeometry.width) - 2 * spacing - 4 + 2 });
      }
    }
    expect(boxes.length).toBeGreaterThan(25);
    const browser = await pw.chromium.launch();
    try {
      const page = await browser.newPage();
      await page.setContent(`<body style="font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.2">${boxes.map((b, i) => `<div id="b${i}" style="width:${b.wrap}px;white-space:normal;overflow-wrap:normal;text-align:center"><span>${b.html}</span></div>`).join('')}</body>`);
      const seen = await page.evaluate((count) => Array.from({ length: count }, (_, i) => {
        const el = document.getElementById(`b${i}`);
        return { height: el.getBoundingClientRect().height, width: el.firstChild.getBoundingClientRect().width, overflow: el.scrollWidth - el.clientWidth };
      }), boxes.length);
      boxes.forEach((b, i) => {
        expect(seen[i].overflow, b.at).toBeLessThanOrEqual(0);
        // The corners of the text as drawn lie inside the outline.
        expect((seen[i].width / b.width) ** 2 + (seen[i].height / b.height) ** 2, b.at).toBeLessThanOrEqual(1);
      });
    } finally {
      await browser.close();
    }
  }, 60_000);
});

describe('use case diagram: what works for every kind', () => {
  const part = () => ({ id: 'order-sync-01-load', ir: { ...loadFixture('flowchart', 'valid-refund-check'), title: 'Load the orders of one shop' } });

  it('links a use case to the part that details it, and a part of another kind back to a use case diagram', async () => {
    const main = { id: 'main', ir: loadFixture('usecase', 'valid-ref-parts') };
    const r = await bundle([main, part()], 'drawio', { title: 'Order sync', canvas: 'all' });
    expect(r.ok).toBe(true);
    const { problems, cells } = checkDrawioStructure(r.output);
    expect(problems).toEqual([]);
    const sync = cells.filter((c) => c.id === 'main:sync');
    expect(sync).toHaveLength(2); // the canvas page and the diagram's own page
    for (const c of sync) {
      expect(c.value).toBe('Sync the orders<br>↳ Load the orders of one shop');
      expect(c.link).toBe('data:page/id,order-sync-01-load');
      expect(c.style).toMatch(/^ellipse;/);
    }
    // The other way round: a step of an activity diagram whose detail is a use case diagram.
    const activity = loadFixture('activity', 'valid-two-lanes');
    activity.actions[0].ref = 'lending';
    const back = await bundle([{ id: 'returns', ir: activity }, { id: 'lending', ir: loadFixture('usecase', 'valid') }], 'drawio');
    expect(back.ok).toBe(true);
    const step = checkDrawioStructure(back.output).cells.find((c) => c.id === `returns:${activity.actions[0].id}`);
    expect(step.value.endsWith('<br>↳ Library lending')).toBe(true);
    expect(step.link).toBe('data:page/id,lending');
    const md = await bundle([main, part()], 'mermaid', { title: 'Order sync' });
    expect(md.output).toContain('(["Sync the orders<br/>↳ Load the orders of one shop"])');
    expect(md.output).toContain('## Order sync (main)');
  });

  it('reads its own draw.io file back as a use case diagram that covers the model, with every relation by its ends', async () => {
    for (const { name, ir } of fixtures) {
      const facts = extractDrawio((await emit(ir, 'drawio')).output);
      const page = facts.pages[0];
      expect(page.kindHints[0].kind, name).toBe('usecase');
      expect(page.kindHints[0].evidence.join(' '), name).toMatch(/oval/);
      expect(cover(facts, [{ name, ir }]), name).toMatchObject({ ok: true, missing: [] });
      expect(page.nodes.filter((n) => n.shape === 'actor')).toHaveLength(ir.actors.filter((a) => a.kind !== 'system').length);
      expect(page.nodes.filter((n) => n.shape === 'ellipse')).toHaveLength(ir.useCases.length);
      expect(page.nodes.filter((n) => n.shape === 'container')).toHaveLength((ir.boundaries ?? []).length);
      for (const r of ir.relations) {
        const e = page.edges.find((x) => x.id.endsWith(`:${r.id}`));
        expect([e.from.split(':').pop(), e.to.split(':').pop()], `${name} ${r.id}`).toEqual([r.from, r.to]);
        expect(e.dashed === true, `${name} ${r.id}`).toBe(r.kind === 'include' || r.kind === 'extend');
        expect(e.endArrow, `${name} ${r.id}`).toBe({ association: 'none', include: 'open', extend: 'open', generalization: 'block-open' }[r.kind]);
      }
    }
  });

  it('finds a text dropped from a recooked use case diagram', async () => {
    const ir = loadFixture('usecase', 'valid');
    const facts = extractDrawio((await emit(ir, 'drawio')).output);
    const less = clone(ir);
    less.useCases = less.useCases.filter((u) => u.id !== 'register');
    less.relations = less.relations.filter((r) => r.to !== 'register').map((r) => (r.id === 'r6' ? { id: r.id, from: r.from, to: r.to, kind: r.kind } : r));
    expect(cover(facts, [{ name: 'lending', ir: less }]).missing.map((m) => m.text)).toEqual(['Register a new member', '[the book is overdue]']);
  });

  it('reads the Mermaid form back as a use case diagram', async () => {
    const page = extractMermaid((await emit(loadFixture('usecase', 'valid'), 'mermaid')).output).pages[0];
    expect(page.kindHints).toHaveLength(1);
    expect(page.kindHints[0].kind).toBe('usecase');
    expect(page.kindHints[0].evidence[1]).toBe('3 nodes marked «actor» or «system», 2 links marked «include» or «extend»');
    // A plain flowchart stays one.
    expect(extractMermaid('flowchart LR\n  a[Start] --> b([Stop])\n').pages[0].kindHints[0].kind).toBe('flowchart');
    expect(extractMermaid('flowchart LR\n  u([Buy]) -. "<<extend>>" .-> v([Pay])\n').pages[0].kindHints[0].kind).toBe('usecase');
  });

  it('relabels actors, use cases, the boundary and a condition, keeps «system» and «extend», and asks for no stereotype', async () => {
    const ir = loadFixture('usecase', 'valid');
    const xml = (await emit(ir, 'drawio', { diagramId: 'lending' })).output;
    const out = relabelDrawio(xml, { member: 'Thành viên', payment: 'Cổng thanh toán', borrow: 'Mượn sách', library: 'Hệ thống thư viện', r6: 'sách quá hạn' });
    const cell = (id) => checkDrawioStructure(out.output).cells.find((c) => c.id === `lending:${id}`);
    expect(out.unmatched).toEqual([]);
    expect(cell('member').value).toBe('Thành viên');
    expect(cell('payment').value).toBe('«system»<br>Cổng thanh toán');
    expect(cell('borrow').value).toBe('Mượn sách');
    expect(cell('library').value).toBe('Hệ thống thư viện');
    expect(cell('r6:label').value).toBe('«extend»<br>sách quá hạn');
    expect(out.untouched.map((u) => u.text)).not.toContain('«include»');
    expect(out.untouched.map((u) => u.text)).toContain('Return a book');
    // The relabelled file is not a hand edit of the model.
    const d = await driftDrawio(out.output, [{ id: 'lending', ir }]);
    expect(d.pages[0].changes.filter((c) => c.change !== 'relabelled')).toEqual([]);
  });

  it('reports a moved use case and a deleted relation as drift, and nothing on a fresh emit', async () => {
    const ir = loadFixture('usecase', 'valid');
    const xml = (await emit(ir, 'drawio', { diagramId: 'lending' })).output;
    expect(await driftDrawio(xml, [{ id: 'lending', ir }])).toMatchObject({ ok: true, drifted: false });
    const moved = xml.replace(/(<mxCell id="lending:borrow"[^>]*>\s*<mxGeometry x=")([\d.]+)/, (_, head, x) => `${head}${Number(x) + 40}`);
    const edge = /<mxCell id="lending:r5"[^>]*edge="1"[^>]*>[\s\S]*?<\/mxCell>/.exec(moved)[0];
    const d = await driftDrawio(moved.replace(edge, ''), [{ id: 'lending', ir }]);
    expect(d.drifted).toBe(true);
    expect(d.pages[0].changes).toContainEqual({ cell: 'lending:borrow', change: 'moved' });
    expect(d.pages[0].changes.some((c) => c.cell === 'lending:r5' && c.change === 'removed')).toBe(true);
  });

  it('lists what a revision changed by collection: an actor added, a use case reworded, a relation of another kind', () => {
    const ir = loadFixture('usecase', 'valid');
    const next = clone(ir);
    next.actors.push({ id: 'guest', label: 'Guest' });
    next.useCases[0].label = 'Search and filter the catalogue';
    next.relations.find((r) => r.id === 'r5').kind = 'extend';
    next.relations.push({ id: 'r8', from: 'guest', to: 'search', kind: 'association' });
    const d = diffIr(ir, next);
    expect(d.added).toEqual([{ collection: 'actors', id: 'guest', label: 'Guest' }, { collection: 'relations', id: 'r8', label: '' }]);
    expect(d.changed).toEqual([{ collection: 'relations', id: 'r5', label: '', fields: ['kind'], values: { kind: { from: expect.any(String), to: 'extend' } } }, { collection: 'useCases', id: 'search', label: 'Search and filter the catalogue', fields: ['label'], values: { label: { from: expect.any(String), to: expect.any(String) } } }]);
    expect(d.removed).toEqual([]);
  });
});

describe('use case diagram: the order of the model and the ends of the lines', () => {
  const clinic = () => ({
    schemaVersion: 1, kind: 'usecase', title: 'Clinic appointment booking',
    actors: [
      { id: 'patient', label: 'Patient' }, { id: 'registered', label: 'Registered patient' }, { id: 'receptionist', label: 'Receptionist' }, { id: 'doctor', label: 'Doctor' },
      { id: 'sms', label: 'SMS gateway', kind: 'system' }, { id: 'pay', label: 'Payment provider', kind: 'system' },
    ],
    useCases: [
      { id: 'search', label: 'Search available slots' }, { id: 'register', label: 'Register an account' }, { id: 'book', label: 'Book an appointment' },
      { id: 'cancel', label: 'Cancel an appointment' }, { id: 'reschedule', label: 'Reschedule an appointment' }, { id: 'manage', label: 'Manage doctor schedules' },
      { id: 'checkin', label: 'Check in a patient' }, { id: 'today', label: "View today's appointments" }, { id: 'signin', label: 'Sign in' }, { id: 'deposit', label: 'Pay a deposit' },
    ],
    boundaries: [{ id: 'sys', label: 'Clinic booking system', children: ['search', 'register', 'book', 'cancel', 'reschedule', 'manage', 'checkin', 'today', 'signin', 'deposit'] }],
    relations: [
      { id: 'r1', from: 'patient', to: 'search', kind: 'association' }, { id: 'r2', from: 'patient', to: 'register', kind: 'association' },
      { id: 'r3', from: 'registered', to: 'book', kind: 'association' }, { id: 'r4', from: 'registered', to: 'cancel', kind: 'association' }, { id: 'r5', from: 'registered', to: 'reschedule', kind: 'association' },
      { id: 'r6', from: 'receptionist', to: 'manage', kind: 'association' }, { id: 'r7', from: 'receptionist', to: 'checkin', kind: 'association' }, { id: 'r8', from: 'doctor', to: 'today', kind: 'association' },
      { id: 'r9', from: 'book', to: 'signin', kind: 'include' }, { id: 'r10', from: 'cancel', to: 'signin', kind: 'include' }, { id: 'r11', from: 'reschedule', to: 'signin', kind: 'include' },
      { id: 'r12', from: 'deposit', to: 'book', kind: 'extend', condition: 'first visit' },
      { id: 'r13', from: 'book', to: 'sms', kind: 'association' }, { id: 'r14', from: 'deposit', to: 'pay', kind: 'association' },
      { id: 'r15', from: 'registered', to: 'patient', kind: 'generalization' },
    ],
  });
  const placed = async (ir) => {
    const r = await emit(ir, 'drawio', { diagramId: 'u' });
    expect(r.ok).toBe(true);
    expect(r.warnings).toEqual([]);
    const { problems, cells } = checkDrawioStructure(r.output);
    expect(problems).toEqual([]);
    const abs = absoluteBounds(cells);
    return { cells, abs, at: (id) => abs.get(`u:${id}`), paths: edgePaths(cells, abs) };
  };
  /** The ids in the order they stand down the page. */
  const downThePage = (p, ids) => [...ids].sort((a, b) => p.at(a).y - p.at(b).y);

  it('stands the actors of a side in the order the model lists them, in the fixtures too', async () => {
    const ir = clinic();
    const p = await placed(ir);
    expect(downThePage(p, ['patient', 'registered', 'receptionist', 'doctor'])).toEqual(['patient', 'registered', 'receptionist', 'doctor']);
    expect(downThePage(p, ['sms', 'pay'])).toEqual(['sms', 'pay']);
    for (const { name, ir: fixture } of fixtures.filter((f) => (f.ir.direction ?? 'LR') === 'LR')) {
      const q = await placed(fixture);
      for (const role of ['primary', 'supporting']) {
        const ids = fixture.actors.filter((a) => roleOf(a) === role).map((a) => a.id);
        expect(downThePage(q, ids), `${name} ${role}`).toEqual(ids);
      }
    }
  }, 60000);

  it('keeps every actor and use case in its order when one association is added', async () => {
    const before = await placed(clinic());
    const more = clinic();
    more.relations.push({ id: 'r16', from: 'receptionist', to: 'book', kind: 'association' });
    const after = await placed(more);
    const actors = more.actors.filter((a) => roleOf(a) === 'primary').map((a) => a.id);
    expect(downThePage(after, actors)).toEqual(downThePage(before, actors));
    const useCases = more.useCases.map((u) => u.id);
    expect(downThePage(after, useCases)).toEqual(downThePage(before, useCases));
    // Nothing but the receptionist, who moves towards the new use case, leaves its place by more than a line's room.
    for (const id of [...actors, ...useCases].filter((x) => x !== 'receptionist')) {
      expect(Math.abs(after.at(id).y - before.at(id).y), id).toBeLessThanOrEqual(20);
      expect(Math.abs(after.at(id).x - before.at(id).x), id).toBeLessThanOrEqual(20);
    }
  }, 60000);

  it('keeps the order when a use case is added, removed, or an actor is put between two others', async () => {
    const before = await placed(clinic());
    const added = clinic();
    added.useCases.push({ id: 'book-for', label: 'Book for a patient' });
    added.boundaries[0].children.push('book-for');
    added.relations.push({ id: 'r16', from: 'receptionist', to: 'book-for', kind: 'association' }, { id: 'r17', from: 'book-for', to: 'book', kind: 'generalization' });
    const removed = clinic();
    removed.useCases = removed.useCases.filter((u) => u.id !== 'checkin');
    removed.boundaries[0].children = removed.boundaries[0].children.filter((c) => c !== 'checkin');
    removed.relations = removed.relations.filter((r) => r.from !== 'checkin' && r.to !== 'checkin');
    const between = clinic();
    between.actors.splice(3, 0, { id: 'admin', label: 'Administrator' });
    between.relations.push({ id: 'r20', from: 'admin', to: 'manage', kind: 'association' });
    for (const [what, ir] of [['added', added], ['removed', removed], ['between', between]]) {
      const after = await placed(ir);
      const shared = (ids) => ids.filter((id) => before.at(id) && after.at(id));
      for (const ids of [clinic().actors.slice(0, 4).map((a) => a.id), clinic().useCases.map((u) => u.id)]) {
        expect(downThePage(after, shared(ids)), what).toEqual(downThePage(before, shared(ids)));
      }
    }
    expect(downThePage(await placed(between), ['patient', 'registered', 'receptionist', 'admin', 'doctor'])).toEqual(['patient', 'registered', 'receptionist', 'admin', 'doctor']);
  }, 60000);

  it('never ends two lines at one point of an ellipse: a use case with many ends on a side is drawn taller', async () => {
    const ir = clinic();
    ir.useCases.push({ id: 'book-for', label: 'Book for a patient' });
    ir.boundaries[0].children.push('book-for');
    ir.relations.push({ id: 'r16', from: 'receptionist', to: 'book-for', kind: 'association' }, { id: 'r17', from: 'book-for', to: 'book', kind: 'generalization' });
    const p = await placed(ir);
    // Four lines end on the side of "Book an appointment" that faces away from the actors.
    const one = measureEllipse('Book an appointment');
    expect(p.at('book').height).toBeGreaterThan(one.height);
    expect(p.at('cancel').height).toBe(measureEllipse('Cancel an appointment').height);
    for (const u of ir.useCases) {
      const box = p.at(u.id);
      const ends = [];
      for (const r of ir.relations) {
        const path = p.paths.get(`u:${r.id}`);
        if (r.from === u.id) ends.push(path[0]);
        if (r.to === u.id) ends.push(path.at(-1));
      }
      for (const side of ['left', 'right']) {
        const ys = ends.filter((e) => (side === 'left' ? e.x < box.x + box.width / 2 : e.x >= box.x + box.width / 2)).map((e) => e.y).sort((a, b) => a - b);
        for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1], `${u.id} ${side}`).toBeGreaterThanOrEqual(12);
      }
    }
  }, 60000);
});
