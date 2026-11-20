import { describe, it, expect } from 'vitest';
import { emit } from '../src/pipeline.mjs';
import { checkDrawioStructure, absoluteBounds, edgePaths, endLabelBox } from './drawio-structure.mjs';
import { loadFixture } from './helpers.mjs';

const intersects = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const segmentBox = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) });
/** Marker lengths of the class relation kinds, as the emitter styles them. */
const MARKER = { composition: { from: 24, to: 0 }, aggregation: { from: 24, to: 0 }, inheritance: { from: 0, to: 16 }, realization: { from: 0, to: 16 }, association: { from: 0, to: 10 }, dependency: { from: 0, to: 10 } };

/** Each cardinality of a class diagram with its box, its end point and the direction the line leaves that end in. */
async function cardinalities(ir) {
  const r = await emit(ir, 'drawio', { diagramId: 'c' });
  expect(r.ok).toBe(true);
  const { problems, cells } = checkDrawioStructure(r.output);
  expect(problems).toEqual([]);
  const abs = absoluteBounds(cells);
  const paths = edgePaths(cells, abs);
  const labels = [];
  for (const rel of ir.relations) for (const end of ['from', 'to']) {
    const cell = cells.find((c) => c.id === `c:${rel.id}:${end}-card`);
    expect(Boolean(cell), `${rel.id} ${end}`).toBe(Boolean(rel[`${end}Cardinality`]));
    if (!cell) continue;
    const path = paths.get(`c:${rel.id}`);
    const fromEnd = end === 'from' ? path : [...path].reverse();
    const box = endLabelBox(cell, path);
    // The stretch of the line the label stands beside: the first one from its end, or, where
    // that one is too short for the marker and the text, the one round the bend. `before` is
    // the length of the line up to that stretch.
    const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    let before = 0;
    let stretch;
    for (let i = 1; i < fromEnd.length && !stretch; i++) {
      const a = fromEnd[i - 1];
      const b = fromEnd[i];
      const vertical = Math.abs(b.y - a.y) >= Math.abs(b.x - a.x);
      const [lo, hi] = vertical ? [Math.min(a.y, b.y), Math.max(a.y, b.y)] : [Math.min(a.x, b.x), Math.max(a.x, b.x)];
      const c = vertical ? centre.y : centre.x;
      if (c >= lo && c <= hi) stretch = { at: a, vertical, dir: Math.sign(vertical ? b.y - a.y : b.x - a.x), before };
      before += Math.hypot(b.x - a.x, b.y - a.y);
    }
    expect(Boolean(stretch), `${rel.id} ${end} beside a stretch of its line`).toBe(true);
    labels.push({ rel, end, cell, box, ...stretch });
  }
  const classes = ir.classes.map((c) => abs.get(`c:${c.id}`));
  return { r, labels, classes, paths };
}

describe('class cardinalities in draw.io', () => {
  it('sit at their own end of the relation: past the marker, beside the line, on no class box and no line', async () => {
    const ir = loadFixture('class', 'valid-cardinality-ends');
    const { r, labels, classes, paths } = await cardinalities(ir);
    expect(labels).toHaveLength(6);
    expect(r.warnings).toEqual([]);
    for (const l of labels) {
      const name = `${l.rel.id} ${l.end}`;
      // Anchored at the end point itself, so the place does not depend on the length of the path.
      expect(Math.abs(Number(l.cell.mxGeometry.x)), name).toBe(1);
      // Along the line: the whole text lies past the marker, and starts within 6 px of its tip.
      // Measured along the line, also round a bend.
      const near = l.before + (l.vertical ? (l.dir > 0 ? l.box.y - l.at.y : l.at.y - (l.box.y + l.box.height)) : (l.dir > 0 ? l.box.x - l.at.x : l.at.x - (l.box.x + l.box.width)));
      const marker = MARKER[l.rel.kind][l.end];
      expect(near, `${name} clears its marker`).toBeGreaterThanOrEqual(marker);
      if (near > marker + 6) {
        // A label further along has moved there in steps of 10 px, and only because the place
        // one step nearer its end lies on a line, a class or another label.
        expect(near, `${name} stays at its end`).toBeLessThanOrEqual(marker + 6 + 30);
        const back = l.vertical ? { ...l.box, y: l.box.y - l.dir * 10 } : { ...l.box, x: l.box.x - l.dir * 10 };
        const taken = classes.some((c) => intersects(back, c))
          || labels.some((o) => o !== l && intersects(back, o.box))
          || [...paths.values()].some((path) => path.some((p, i) => i > 0 && intersects(back, { x: Math.min(path[i - 1].x, p.x) - 1, y: Math.min(path[i - 1].y, p.y) - 1, width: Math.abs(path[i - 1].x - p.x) + 2, height: Math.abs(path[i - 1].y - p.y) + 2 })));
        expect(taken, `${name} is as near its end as it can be`).toBe(true);
      }
      // Across the line: beside it, a few pixels away, not on it.
      const across = l.vertical ? Math.min(Math.abs(l.box.x - l.at.x), Math.abs(l.box.x + l.box.width - l.at.x)) : Math.min(Math.abs(l.box.y - l.at.y), Math.abs(l.box.y + l.box.height - l.at.y));
      expect(across, `${name} beside its line`).toBeGreaterThanOrEqual(3);
      expect(across, `${name} beside its line`).toBeLessThanOrEqual(6);
      for (const c of classes) expect(intersects(l.box, c), `${name} on a class box`).toBe(false);
      for (const [id, path] of paths) for (let i = 1; i < path.length; i++) expect(intersects(l.box, segmentBox(path[i - 1], path[i])), `${name} on line ${id}`).toBe(false);
      for (const o of labels) if (o !== l) expect(intersects(l.box, o.box), `${name} on ${o.rel.id} ${o.end}`).toBe(false);
    }
  });

  it('keeps the same distance from the end on a short edge and on a long routed one', async () => {
    const ir = loadFixture('class', 'valid-cardinality-ends');
    const { labels } = await cardinalities(ir);
    const offset = (id, end) => { const p = labels.find((l) => l.rel.id === id && l.end === end).cell.mxGeometry.mxPoint[0]; return { x: Math.abs(Number(p.x)), y: Math.abs(Number(p.y)) }; };
    // r1 runs straight down to the next row; r3 is routed around other classes over a long path.
    expect(offset('r3', 'from')).toEqual(offset('r1', 'from'));
    expect(offset('r3', 'to')).toEqual(offset('r1', 'to'));
  });

  it('takes the other side when a neighbouring line is in the way, and warns when neither side is free', async () => {
    // Three relations between the same two classes end 40 px apart, and the cardinality needs
    // about 100 px beside its line: the leftmost fits on its outer side, the middle one nowhere.
    const ir = {
      schemaVersion: 1, kind: 'class', title: 'Parallel relations', direction: 'TB',
      classes: [{ id: 'catalogue', label: 'Catalogue' }, { id: 'product', label: 'Product' }],
      relations: ['lists', 'features', 'archives'].map((label, i) => ({ id: `r${i + 1}`, from: 'catalogue', to: 'product', kind: 'association', label, toCardinality: '0..* {ordered}' })),
    };
    const { r, labels } = await cardinalities(ir);
    const [left, middle] = [...labels].sort((a, b) => a.at.x - b.at.x);
    expect(middle.at.x - left.at.x).toBeLessThan(100);
    const warned = (l) => r.warnings.filter((w) => w.path === `/relations/${ir.relations.indexOf(l.rel)}/toCardinality`);
    expect(left.cell.style).toContain('align=right');
    expect(warned(left)).toEqual([]);
    expect(warned(middle)).toHaveLength(1);
    expect(warned(middle)[0].message).toBe(`layout: cardinality "0..* {ordered}" of relation "${middle.rel.id}" at "product" has no free place beside its line; it may sit on a neighbouring line or label`);
    expect(warned(middle)[0].stage).toBe('emit');
  });
});

describe('a class hierarchy in draw.io', () => {
  const boxes = async (ir) => {
    const r = await emit(ir, 'drawio', { diagramId: 'c' });
    expect(r.ok).toBe(true);
    const { problems, cells } = checkDrawioStructure(r.output);
    expect(problems).toEqual([]);
    const abs = absoluteBounds(cells);
    return { at: (id) => abs.get(`c:${id}`), paths: edgePaths(cells, abs) };
  };
  const hierarchy = (direction) => ({
    schemaVersion: 1, kind: 'class', title: 'People', ...(direction ? { direction } : {}),
    classes: [
      // The special classes are listed first, as a source often declares them.
      { id: 'patient', label: 'Patient', attributes: [{ name: 'dateOfBirth', type: 'Date' }] },
      { id: 'doctor', label: 'Doctor', attributes: [{ name: 'specialty', type: 'String' }] },
      { id: 'person', label: 'Person', stereotype: 'abstract', attributes: [{ name: 'fullName', type: 'String' }] },
      { id: 'sms', label: 'SmsNotifier' },
      { id: 'notifier', label: 'Notifier', stereotype: 'interface', methods: [{ name: 'send', params: 'to: Person' }] },
      { id: 'appointment', label: 'Appointment' },
    ],
    relations: [
      { id: 'g1', from: 'patient', to: 'person', kind: 'inheritance' },
      { id: 'g2', from: 'doctor', to: 'person', kind: 'inheritance' },
      { id: 'i1', from: 'sms', to: 'notifier', kind: 'realization' },
      { id: 'a1', from: 'patient', to: 'appointment', kind: 'association', label: 'has' },
      { id: 'd1', from: 'appointment', to: 'notifier', kind: 'dependency', label: 'uses' },
    ],
  });

  it('draws the general class above the special ones and the interface above what realises it', async () => {
    const { at, paths } = await boxes(hierarchy());
    for (const [special, general] of [['patient', 'person'], ['doctor', 'person'], ['sms', 'notifier']]) {
      expect(at(general).y + at(general).height, `${general} above ${special}`).toBeLessThan(at(special).y);
    }
    // The line still runs from the special class to the general one, so the hollow triangle points up.
    for (const id of ['g1', 'g2', 'i1']) {
      const path = paths.get(`c:${id}`);
      expect(path.at(-1).y, id).toBeLessThan(path[0].y);
    }
    // The other relations keep the reading order of their ends.
    expect(at('patient').y).toBeLessThan(at('appointment').y);
    expect(at('appointment').y).toBeLessThan(at('notifier').y);
  });

  it('puts the general class before the special ones in a left-to-right diagram', async () => {
    const { at } = await boxes(hierarchy('LR'));
    for (const [special, general] of [['patient', 'person'], ['doctor', 'person'], ['sms', 'notifier']]) {
      expect(at(general).x + at(general).width, `${general} before ${special}`).toBeLessThan(at(special).x);
    }
  });

  it('does so in every class fixture', async () => {
    for (const name of ['valid', 'valid-order-domain', 'valid-cardinality-ends']) {
      const ir = loadFixture('class', name);
      const { at } = await boxes(ir);
      for (const r of ir.relations.filter((x) => x.kind === 'inheritance' || x.kind === 'realization')) {
        expect(at(r.to).y + at(r.to).height, `${name}: ${r.to} above ${r.from}`).toBeLessThan(at(r.from).y);
      }
    }
  });
});

/**
 * A class with a relation to itself is laid out in a box wider than its table, with room for
 * the loop on both sides, and the layout spreads the relations on its top and bottom over
 * that box. An end beside the table would be drawn into the table's corner from the side;
 * the ends of such a side are spread over the table itself instead.
 */
describe('relations into a class with a relation to itself in draw.io', () => {
  /** `k` classes that each have a relation into `hub`, which also has a relation to itself. */
  const hubOf = (k, direction, kinds = []) => ({
    schemaVersion: 1, kind: 'class', title: 'Invoice parts', direction,
    classes: [{ id: 'hub', label: 'Invoice', attributes: [{ name: 'number', type: 'string' }] }, ...Array.from({ length: k }, (_, i) => ({ id: `c${i + 1}`, label: `Part${i + 1}` }))],
    relations: [
      { id: 'self', from: 'hub', to: 'hub', kind: 'association', label: 'credits', fromCardinality: '0..1', toCardinality: '0..*' },
      ...Array.from({ length: k }, (_, i) => ({ id: `r${i + 1}`, from: `c${i + 1}`, to: 'hub', kind: kinds[i] ?? 'association', ...(i === 0 ? { fromCardinality: '1', toCardinality: '0..*' } : {}) })),
    ],
  });
  const drawn = async (ir) => {
    const r = await emit(ir, 'drawio', { diagramId: 'c' });
    expect(r.ok).toBe(true);
    const { problems, cells } = checkDrawioStructure(r.output);
    expect(problems).toEqual([]);
    const abs = absoluteBounds(cells);
    return { r, cells, box: (id) => abs.get(`c:${id}`), path: (id) => edgePaths(cells, abs).get(`c:${id}`), style: (id) => cells.find((c) => c.id === `c:${id}`).style };
  };
  /** The end of a relation lies on the top or bottom side of the table, inside its width, and the line runs upright into it. */
  const expectOnTable = (d, id, side) => {
    const b = d.box('hub');
    const path = d.path(id);
    const end = path.at(-1);
    expect(end.y, `${id} on the ${side} side`).toBeCloseTo(side === 'top' ? b.y : b.y + b.height, 6);
    expect(end.x, `${id} right of the left corner`).toBeGreaterThan(b.x + 1);
    expect(end.x, `${id} left of the right corner`).toBeLessThan(b.x + b.width - 1);
    expect(Math.abs(end.x - path.at(-2).x), `${id} runs upright into its end`).toBeLessThan(0.01);
  };

  for (const direction of ['TB', 'BT']) {
    for (const k of [3, 4, 6]) {
      it(`ends ${k} relations on the table, none at a corner (${direction})`, async () => {
        const d = await drawn(hubOf(k, direction));
        // The table is drawn at its own width in the middle of the box the layout was given.
        expect(d.box('hub').width).toBe(160);
        for (let i = 1; i <= k; i++) expectOnTable(d, `r${i}`, direction === 'TB' ? 'top' : 'bottom');
        const at = Array.from({ length: k }, (_, i) => d.path(`r${i + 1}`).at(-1).x).sort((a, b) => a - b);
        expect(new Set(at).size, 'every relation has an end of its own').toBe(k);
        expect(d.r.warnings.filter((w) => String(w.message).startsWith('layout:'))).toEqual([]);
      });
    }
  }

  it('keeps an inheritance among them upside down: its triangle ends on the bottom of the general class', async () => {
    // Three special classes below the general one and three associations into it from above.
    const d = await drawn(hubOf(6, 'TB', ['inheritance', 'association', 'inheritance', 'association', 'inheritance', 'association']));
    for (const id of ['r1', 'r3', 'r5']) {
      expectOnTable(d, id, 'bottom');
      expect(d.box(id.replace('r', 'c')).y, `${id}: the special class stands below`).toBeGreaterThan(d.box('hub').y + d.box('hub').height);
    }
    for (const id of ['r2', 'r4', 'r6']) expectOnTable(d, id, 'top');
  });

  it('keeps the loop beside the table and both of its cardinalities', async () => {
    const d = await drawn(hubOf(4, 'TB'));
    const b = d.box('hub');
    const loop = d.path('self');
    expect(loop[0].x).toBeCloseTo(b.x + b.width, 6);
    expect(loop.at(-1).x).toBeCloseTo(b.x + b.width, 6);
    expect(Math.max(...loop.map((p) => p.x))).toBe(b.x + b.width + 30);
    for (const id of ['self:from-card', 'self:to-card', 'r1:from-card', 'r1:to-card']) expect(d.cells.find((c) => c.id === `c:${id}`), id).toBeDefined();
  });

  it('writes the cardinalities of the fixture beside their own ends, on no class and no line', async () => {
    const ir = loadFixture('class', 'valid-self-relation');
    const { r, labels, classes, paths } = await cardinalities(ir);
    expect(labels).toHaveLength(7);
    expect(r.warnings).toEqual([]);
    for (const l of labels) {
      const name = `${l.rel.id} ${l.end}`;
      for (const c of classes) expect(intersects(l.box, c), `${name} on a class box`).toBe(false);
      for (const [id, path] of paths) for (let i = 1; i < path.length; i++) expect(intersects(l.box, segmentBox(path[i - 1], path[i])), `${name} on line ${id}`).toBe(false);
      for (const o of labels) if (o !== l) expect(intersects(l.box, o.box), `${name} on ${o.rel.id} ${o.end}`).toBe(false);
    }
    const invoice = classes[ir.classes.findIndex((c) => c.id === 'invoice')];
    for (const id of ['r1', 'r2', 'r3', 'r4']) {
      const end = paths.get(`c:${id}`).at(-1);
      expect(end.y, id).toBeCloseTo(invoice.y, 6);
      expect(end.x, id).toBeGreaterThan(invoice.x + 1);
      expect(end.x, id).toBeLessThan(invoice.x + invoice.width - 1);
    }
  });

  for (const direction of ['LR', 'RL']) {
    it(`leaves the ends where the layout put them when the loop goes over the top (${direction})`, async () => {
      // The class keeps its own box there, so no end lies beside the table and none gets a fixed place.
      const d = await drawn(hubOf(4, direction));
      for (let i = 1; i <= 4; i++) expect(d.style(`r${i}`), `r${i}`).not.toContain('Perimeter=0;');
    });
  }

  it('leaves a class without a relation to itself alone, however many relations end on it', async () => {
    const ir = hubOf(6, 'TB');
    ir.relations = ir.relations.filter((r) => r.id !== 'self');
    const d = await drawn(ir);
    for (let i = 1; i <= 6; i++) expect(d.style(`r${i}`), `r${i}`).not.toContain('Perimeter=0;');
  });

  it('leaves the ends alone when they all lie on the table already', async () => {
    const ir = hubOf(1, 'TB');
    const d = await drawn(ir);
    expect(d.style('r1')).not.toContain('Perimeter=0;');
  });
});
