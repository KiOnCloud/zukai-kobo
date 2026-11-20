import { describe, it, expect } from 'vitest';
import { validateIr } from '../src/validate-ir.mjs';
import { extractDrawio } from '../src/extract-drawio.mjs';
import { cover } from '../src/cover.mjs';
import { driftDrawio } from '../src/drift.mjs';
import { fanInJunctions } from '../src/emit-drawio.mjs';
import { validFixtures } from './helpers.mjs';
import { drawio, outlineOf, distanceTo, offFlow, endGaps, fanIn, queueFanIn, DIRECTIONS } from './fan-in-shapes.mjs';

const MIN_GAP = 10;
const ends = (d, k) => Array.from({ length: k }, (_, i) => d.path(`e${i + 1}`));
const sameEnd = (a, b) => Math.hypot(a.at(-1).x - b.at(-1).x, a.at(-1).y - b.at(-1).y) < 0.01;

/**
 * The layout spreads the ends of a side over its length whatever that is: four ends on a
 * 40 px side lie 8 px apart, under arrowheads 7 px across. Separate ends keep 10 px, and the
 * node grows along the side when it is too short for that.
 */
describe('room between the line ends on one side of a node', () => {
  for (const shape of ['process', 'io']) {
    it(`grows a ${shape} node for four ends and spaces them 10 px apart`, async () => {
      const d = await drawio(fanIn(4, { shape }));
      const b = d.box('t');
      expect(b.height).toBe(50);
      expect(ends(d, 4).map((p) => p.at(-1).y - b.y)).toEqual([10, 20, 30, 40]);
      // The line the first layout drew straight is still straight.
      expect(ends(d, 4).filter((p) => p.length === 2)).toHaveLength(1);
      for (const p of ends(d, 4)) expect(offFlow(p, 'LR')).toBeLessThan(0.01);
    });
  }

  it('leaves a node alone whose ends already have the room', async () => {
    const d = await drawio(fanIn(3));
    expect(d.box('t').height).toBe(40);
    expect(endGaps(ends(d, 3), 'LR')).toEqual([10, 10]);
    expect(d.r.output).not.toContain('Perimeter=0');
  });

  for (const direction of DIRECTIONS) {
    it(`keeps nine separate ends 10 px apart on a rectangle and a parallelogram (${direction})`, async () => {
      for (const shape of ['process', 'io']) {
        const d = await drawio(fanIn(9, { shape, direction, extra: { fanIn: 'separate' } }));
        const gaps = endGaps(ends(d, 9), direction);
        expect(gaps).toHaveLength(8);
        for (const g of gaps) expect(g).toBeGreaterThanOrEqual(MIN_GAP);
        const outline = outlineOf(d.cell('t'), d.box('t'));
        for (const p of ends(d, 9)) {
          expect(distanceTo(outline, p.at(-1))).toBeLessThan(0.01);
          expect(offFlow(p, direction)).toBeLessThan(0.01);
        }
        expect(d.junctions).toHaveLength(0);
      }
    });
  }

  for (const direction of DIRECTIONS) {
    it(`lays out a loop head that got ports, its back edge on the side across the flow (${direction})`, async () => {
      const ir = fanIn(4, { direction });
      ir.nodes.push({ id: 'work', label: 'Do the work' }, { id: 'again', label: 'More to do?', shape: 'decision' }, { id: 'end', label: 'Done', shape: 'terminal' });
      ir.edges.push({ id: 'f1', from: 't', to: 'work' }, { id: 'f2', from: 'work', to: 'again' }, { id: 'b1', from: 'again', to: 't', kind: 'conditional', label: 'yes' }, { id: 'f3', from: 'again', to: 'end', kind: 'conditional', label: 'no' });
      const d = await drawio(ir);
      const b = d.box('t');
      const back = d.path('b1').at(-1);
      // Top-down and bottom-up flows take the back edge on the right, the others at the bottom.
      if (direction === 'TB' || direction === 'BT') expect(back.x).toBeCloseTo(b.x + b.width, 6);
      else expect(back.y).toBeCloseTo(b.y + b.height, 6);
      for (const g of endGaps(ends(d, 4), direction)) expect(g).toBeGreaterThanOrEqual(MIN_GAP);
      for (const p of ends(d, 4)) expect(offFlow(p, direction)).toBeLessThan(0.01);
    });
  }

  it('gives the transitions into a state the same room', async () => {
    const ir = { schemaVersion: 1, kind: 'state', title: 'Closing', direction: 'LR', states: [...Array.from({ length: 4 }, (_, i) => ({ id: `s${i + 1}`, label: `State ${i + 1}` })), { id: 't', label: 'Closed' }], transitions: Array.from({ length: 4 }, (_, i) => ({ id: `e${i + 1}`, from: `s${i + 1}`, to: 't', event: `close ${i + 1}` })) };
    const d = await drawio(ir);
    expect(d.box('t').height).toBe(50);
    expect(endGaps(ends(d, 4), 'LR')).toEqual([10, 10, 10]);
  });

  it('never resizes the circle of a final state', async () => {
    const ir = { schemaVersion: 1, kind: 'state', title: 'Ending', direction: 'TB', states: [...Array.from({ length: 6 }, (_, i) => ({ id: `s${i + 1}`, label: `State ${i + 1}` })), { id: 't', kind: 'final' }], transitions: Array.from({ length: 6 }, (_, i) => ({ id: `e${i + 1}`, from: `s${i + 1}`, to: 't' })) };
    const d = await drawio(ir);
    expect(d.box('t')).toMatchObject({ width: 30, height: 30 });
    expect(d.junctions).toHaveLength(0);
  });
});

/**
 * Five or more lines into one side that can share a line (no label, not leading back) are
 * drawn as one: one end, one arrowhead, and a dot where they have all joined.
 */
describe('many lines into one side merge into one', () => {
  for (const direction of DIRECTIONS) {
    it(`draws nine lines into a parallelogram as one, with one dot (${direction})`, async () => {
      const d = await drawio(fanIn(9, { shape: 'io', direction }));
      const paths = ends(d, 9);
      for (const p of paths) expect(sameEnd(p, paths[0])).toBe(true);
      expect(distanceTo(outlineOf(d.cell('t'), d.box('t')), paths[0].at(-1))).toBeLessThan(0.01);
      for (const p of paths) expect(offFlow(p, direction)).toBeLessThan(0.01);
      // The shared end is the middle of the side, and the node keeps its size.
      const b = d.box('t');
      expect(b.height).toBe(40);
      if (direction === 'LR' || direction === 'RL') expect(paths[0].at(-1).y).toBeCloseTo(b.y + b.height / 2, 6);
      expect(d.junctions).toHaveLength(1);
    });
  }

  it('puts the dot where the last of the lines has joined, on the line they share', async () => {
    const d = await drawio(fanIn(9));
    const [dot] = d.junctions;
    expect(dot.connectable).toBe('0');
    expect(dot.value ?? '').toBe('');
    const j = d.abs.get(dot.id);
    expect(j).toMatchObject({ width: 6, height: 6 });
    const centre = { x: j.x + 3, y: j.y + 3 };
    // Every line passes through the dot, and from there on they run as one to the node.
    const end = d.path('e1').at(-1);
    expect(centre.y).toBeCloseTo(end.y, 6);
    expect(centre.x).toBeLessThan(end.x);
    for (const p of ends(d, 9)) {
      const through = p.some((a, i) => i > 0 && Math.abs((centre.x - p[i - 1].x) * (a.y - p[i - 1].y) - (centre.y - p[i - 1].y) * (a.x - p[i - 1].x)) < 0.01
        && centre.x >= Math.min(a.x, p[i - 1].x) - 0.01 && centre.x <= Math.max(a.x, p[i - 1].x) + 0.01 && centre.y >= Math.min(a.y, p[i - 1].y) - 0.01 && centre.y <= Math.max(a.y, p[i - 1].y) + 0.01);
      expect(through).toBe(true);
    }
  });

  it('keeps every edge in the model: extract gives back the nodes and edges of the IR, and no dot', async () => {
    const ir = fanIn(9, { shape: 'io' });
    const d = await drawio(ir);
    const [page] = extractDrawio(d.r.output).pages;
    expect(page.nodes.map((n) => n.label).sort()).toEqual(ir.nodes.map((n) => n.label).sort());
    expect(page.edges).toHaveLength(9);
    for (const e of ir.edges) expect(page.edges.some((x) => x.from === `d:${e.from}` && x.to === `d:${e.to}`), e.id).toBe(true);
    expect(cover({ pages: [page] }, [{ id: 'd', ir }]).ok).toBe(true);
    const drift = await driftDrawio(d.r.output, [{ id: 'd', ir }]);
    expect(drift.ok, JSON.stringify(drift)).toBe(true);
  });

  it('merges the five lines without a label of a group of seven and keeps the two with one apart', async () => {
    for (const shape of ['process', 'io']) {
      const d = await drawio(fanIn(7, { shape, labelled: [2, 6] }));
      const merged = [1, 3, 4, 5, 7].map((i) => d.path(`e${i}`));
      for (const p of merged) expect(sameEnd(p, merged[0])).toBe(true);
      const gaps = endGaps(ends(d, 7), 'LR');
      expect(gaps).toHaveLength(2);
      for (const g of gaps) expect(g).toBeGreaterThanOrEqual(MIN_GAP);
      expect(d.junctions).toHaveLength(1);
      expect(d.cell('e2:label').value).toBe('case 2');
    }
  });

  it('keeps a group of six apart when only four of its lines can merge', async () => {
    const d = await drawio(fanIn(6, { labelled: [2, 5] }));
    const gaps = endGaps(ends(d, 6), 'LR');
    expect(gaps).toHaveLength(5);
    for (const g of gaps) expect(g).toBeGreaterThanOrEqual(MIN_GAP);
    expect(d.junctions).toHaveLength(0);
  });

  it('never merges four lines', async () => {
    const d = await drawio(fanIn(4));
    expect(endGaps(ends(d, 4), 'LR')).toHaveLength(3);
    expect(d.junctions).toHaveLength(0);
  });

  it('never merges the line that leads back to a loop head', async () => {
    const ir = fanIn(5, { direction: 'TB' });
    ir.nodes.push({ id: 'work', label: 'Do the work' });
    ir.edges.push({ id: 'f1', from: 't', to: 'work' }, { id: 'b1', from: 'work', to: 't' });
    const d = await drawio(ir);
    const paths = ends(d, 5);
    for (const p of paths) expect(sameEnd(p, paths[0])).toBe(true);
    expect(sameEnd(d.path('b1'), paths[0])).toBe(false);
    const b = d.box('t');
    expect(d.path('b1').at(-1).x).toBeCloseTo(b.x + b.width, 6);
  });

  it('merges the transitions into a state', async () => {
    const ir = { schemaVersion: 1, kind: 'state', title: 'Cancelling', direction: 'LR', states: [...Array.from({ length: 5 }, (_, i) => ({ id: `s${i + 1}`, label: `State ${i + 1}` })), { id: 't', label: 'Cancelled' }], transitions: Array.from({ length: 5 }, (_, i) => ({ id: `e${i + 1}`, from: `s${i + 1}`, to: 't' })) };
    const d = await drawio(ir);
    const paths = ends(d, 5);
    for (const p of paths) expect(sameEnd(p, paths[0])).toBe(true);
    expect(d.junctions).toHaveLength(1);
  });

  it('never merges the connections of an architecture', async () => {
    const d = await drawio(queueFanIn(9));
    expect(endGaps(ends(d, 9), 'LR')).toHaveLength(8);
    expect(d.junctions).toHaveLength(0);
  });

  it('draws a second dot only where four of the merged lines meet again', () => {
    // Lines that end at (50, 100). D and E join the shared line from the left and the right at
    // (50, 50); A and B join what is left of it at (50, 0), where it turns: a T for each.
    const route = (start, ...points) => ({ start, points, end: { x: 50, y: 100 } });
    const edges = new Map([
      ['a', route({ x: 0, y: 0 }, { x: 50, y: 0 })],
      ['b', route({ x: 100, y: 0 }, { x: 50, y: 0 })],
      ['d', route({ x: 0, y: 50 }, { x: 50, y: 50 })],
      ['e', route({ x: 100, y: 50 }, { x: 50, y: 50 })],
    ]);
    expect(fanInJunctions({ edges }, [{ node: 't', edges: ['a', 'b', 'd', 'e'] }])).toEqual([{ id: 't:junction:1', x: 50, y: 50 }]);
    // A fifth line that comes straight down through (50, 0) makes a crossing of that place: a second dot.
    edges.set('c', route({ x: 50, y: -50 }));
    expect(fanInJunctions({ edges }, [{ node: 't', edges: ['a', 'b', 'c', 'd', 'e'] }])).toEqual([{ id: 't:junction:1', x: 50, y: 50 }, { id: 't:junction:2', x: 50, y: 0 }]);
  });
});

describe('fanIn pins how a flowchart or a state diagram draws its fan-in', () => {
  it('merge merges from two lines on', async () => {
    const d = await drawio(fanIn(3, { extra: { fanIn: 'merge' } }));
    const paths = ends(d, 3);
    for (const p of paths) expect(sameEnd(p, paths[0])).toBe(true);
    expect(d.junctions).toHaveLength(1);
    expect(d.box('t').height).toBe(40);
  });

  it('separate never merges and gives every end its room', async () => {
    const d = await drawio(fanIn(9, { extra: { fanIn: 'separate' } }));
    expect(d.junctions).toHaveLength(0);
    expect(d.box('t').height).toBe(100);
    expect(endGaps(ends(d, 9), 'LR')).toEqual(Array(8).fill(10));
  });

  it('auto is the default', async () => {
    const plain = await drawio(fanIn(9));
    const auto = await drawio(fanIn(9, { extra: { fanIn: 'auto' } }));
    expect(auto.r.output).toBe(plain.r.output);
  });

  it('applies to a state diagram', async () => {
    const ir = { schemaVersion: 1, kind: 'state', title: 'Cancelling', fanIn: 'separate', direction: 'LR', states: [...Array.from({ length: 5 }, (_, i) => ({ id: `s${i + 1}`, label: `State ${i + 1}` })), { id: 't', label: 'Cancelled' }], transitions: Array.from({ length: 5 }, (_, i) => ({ id: `e${i + 1}`, from: `s${i + 1}`, to: 't' })) };
    const d = await drawio(ir);
    expect(d.junctions).toHaveLength(0);
    expect(endGaps(ends(d, 5), 'LR')).toEqual([10, 10, 10, 10]);
  });

  it('is rejected with a value it does not know', () => {
    const r = validateIr(fanIn(3, { extra: { fanIn: 'bundle' } }));
    expect(r.ok).toBe(false);
    expect(r.errors[0].path).toBe('/fanIn');
  });

  it('is rejected on an architecture, whose connections always stay apart', () => {
    const r = validateIr({ ...queueFanIn(9), fanIn: 'merge' });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /unknown property "fanIn"/.test(e.message))).toBe(true);
  });

  it('is taken by flowchart and state only: every other kind rejects it', () => {
    const kinds = new Set();
    for (const f of validFixtures()) {
      const r = validateIr({ ...f.ir, fanIn: 'merge' });
      const takes = f.ir.kind === 'flowchart' || f.ir.kind === 'state';
      expect(r.ok, `${f.kind}/${f.name}`).toBe(takes);
      if (!takes) expect(r.errors.map((e) => e.message), `${f.kind}/${f.name}`).toEqual(['unknown property "fanIn"']);
      kinds.add(f.ir.kind);
    }
    expect([...kinds].sort()).toEqual(['activity', 'architecture', 'class', 'er', 'flowchart', 'sequence', 'state', 'usecase']);
  });
});
