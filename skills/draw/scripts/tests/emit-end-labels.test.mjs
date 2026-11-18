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
