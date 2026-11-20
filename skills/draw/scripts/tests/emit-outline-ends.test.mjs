import { describe, it, expect } from 'vitest';
import { drawio, outlineOf, distanceTo, offFlow, startOffFlow, fanIn, queueFanIn, throughCircles, DIRECTIONS } from './fan-in-shapes.mjs';

/**
 * A parallelogram and a hexagon are narrower than their box. A line that meets one ends on
 * the slanted edge that is drawn, at the height (or the column) the layout routed it at, and
 * draw.io is told to keep that point: left to its perimeter, the end moves towards the
 * shape's centre, the line gets a jog before its end and the arrowhead points along the jog.
 */
describe('line ends on a parallelogram and a hexagon', () => {
  for (const direction of DIRECTIONS) {
    for (const k of [3, 4, 9]) {
      it(`ends ${k} lines into a parallelogram on its outline, along the flow (${direction})`, async () => {
        // Kept apart, so that each of the lines has an end of its own.
        const d = await drawio(fanIn(k, { shape: 'io', direction, extra: { fanIn: 'separate' } }));
        const outline = outlineOf(d.cell('t'), d.box('t'));
        for (let i = 1; i <= k; i++) {
          const path = d.path(`e${i}`);
          expect(d.cell(`e${i}`).style, `e${i}`).toContain('entryPerimeter=0;');
          expect(distanceTo(outline, path.at(-1)), `e${i} ends on the outline`).toBeLessThan(0.01);
          expect(offFlow(path, direction), `e${i} runs along the flow into its end`).toBeLessThan(0.01);
        }
      });

      it(`ends ${k} connections into a hexagon on its outline, along the flow (${direction})`, async () => {
        const d = await drawio(queueFanIn(k, direction));
        const outline = outlineOf(d.cell('t'), d.box('t'));
        for (let i = 1; i <= k; i++) {
          const path = d.path(`e${i}`);
          expect(d.cell(`e${i}`).style, `e${i}`).toContain('entryPerimeter=0;');
          expect(distanceTo(outline, path.at(-1)), `e${i} ends on the outline`).toBeLessThan(0.01);
          expect(offFlow(path, direction), `e${i} runs along the flow into its end`).toBeLessThan(0.01);
        }
      });
    }
  }

  it('keeps a straight line into a parallelogram straight', async () => {
    const d = await drawio(fanIn(1, { shape: 'io' }));
    const path = d.path('e1');
    expect(path).toHaveLength(2);
    expect(path[0].y).toBeCloseTo(path[1].y, 6);
    // Mid-height, the left edge is half the slant in from the box.
    expect(path[1].x - d.box('t').x).toBeCloseTo(10, 6);
  });

  it('starts a line that leaves a parallelogram on its outline too', async () => {
    const ir = { schemaVersion: 1, kind: 'flowchart', title: 'Out of a parallelogram', direction: 'LR', nodes: [{ id: 't', label: 'Read the file', shape: 'io' }, { id: 'a', label: 'Parse' }, { id: 'b', label: 'Archive' }, { id: 'c', label: 'Report' }], edges: [{ id: 'e1', from: 't', to: 'a' }, { id: 'e2', from: 't', to: 'b' }, { id: 'e3', from: 't', to: 'c' }] };
    const d = await drawio(ir);
    const outline = outlineOf(d.cell('t'), d.box('t'));
    for (const id of ['e1', 'e2', 'e3']) {
      const path = d.path(id);
      expect(d.cell(id).style).toContain('exitPerimeter=0;');
      expect(distanceTo(outline, path[0])).toBeLessThan(0.01);
      expect(Math.abs(path[0].y - path[1].y)).toBeLessThan(0.01);
    }
  });

  it('writes the end as a pixel offset from the box, which holds when the shape is resized', async () => {
    const d = await drawio(fanIn(3, { shape: 'io' }));
    // Three ends a quarter of the height apart: 15, 10 and 5 px in from the left side.
    expect(d.cell('e1').style).toMatch(/entryX=0;entryY=0\.25;entryDx=15;entryDy=0;entryPerimeter=0;$/);
    expect(d.cell('e2').style).toMatch(/entryX=0;entryY=0\.5;entryDx=10;entryDy=0;entryPerimeter=0;$/);
    expect(d.cell('e3').style).toMatch(/entryX=0;entryY=0\.75;entryDx=5;entryDy=0;entryPerimeter=0;$/);
  });

  it('leaves the ends on a rectangle as they were', async () => {
    const d = await drawio(fanIn(3));
    expect(d.cell('e1').style).toMatch(/exitX=1;exitY=0\.5;exitDx=0;exitDy=0;entryX=0;entryY=0\.25;entryDx=0;entryDy=0;$/);
    expect(d.cell('e2').style).toMatch(/exitX=1;exitY=0\.5;exitDx=0;exitDy=0;entryX=0;entryY=0\.5;entryDx=0;entryDy=0;$/);
    expect(d.cell('e3').style).toMatch(/exitX=1;exitY=0\.5;exitDx=0;exitDy=0;entryX=0;entryY=0\.75;entryDx=0;entryDy=0;$/);
    expect(d.box('t').height).toBe(40);
  });

  it('ends the lines from above on the flat top of a parallelogram, not beside it', async () => {
    // Nine ends spread over the whole box would put the first one in the strip left of the top edge.
    const d = await drawio(fanIn(9, { shape: 'io', direction: 'TB', extra: { fanIn: 'separate' } }));
    const b = d.box('t');
    for (let i = 1; i <= 9; i++) {
      const end = d.path(`e${i}`).at(-1);
      expect(end.y).toBeCloseTo(b.y, 6);
      expect(end.x).toBeGreaterThan(b.x + 20);
      expect(end.x).toBeLessThan(b.x + b.width);
    }
  });

  for (const direction of ['TB', 'LR']) {
    it(`ends a self-loop on a parallelogram on its outline (${direction})`, async () => {
      const ir = { schemaVersion: 1, kind: 'flowchart', title: 'Retry', direction, nodes: [{ id: 's', label: 'Start', shape: 'terminal' }, { id: 't', label: 'Read the file', shape: 'io' }, { id: 'end', label: 'Done', shape: 'terminal' }], edges: [{ id: 'e1', from: 's', to: 't' }, { id: 'l1', from: 't', to: 't', label: 'retry' }, { id: 'e2', from: 't', to: 'end' }] };
      const d = await drawio(ir);
      const outline = outlineOf(d.cell('t'), d.box('t'));
      const path = d.path('l1');
      expect(d.cell('l1').style).toMatch(/exitPerimeter=0;.*entryPerimeter=0;/);
      expect(distanceTo(outline, path[0])).toBeLessThan(0.01);
      expect(distanceTo(outline, path.at(-1))).toBeLessThan(0.01);
      // The loop leaves and comes back level (beside the shape) or upright (over it).
      const upright = direction === 'LR';
      expect(Math.abs(upright ? path[0].x - path[1].x : path[0].y - path[1].y)).toBeLessThan(0.01);
      expect(Math.abs(upright ? path.at(-1).x - path.at(-2).x : path.at(-1).y - path.at(-2).y)).toBeLessThan(0.01);
    });
  }

  for (const direction of ['LR', 'RL']) {
    it(`ends the line back to a parallelogram loop head on its outline, not a pixel below it (${direction})`, async () => {
      // The layout's port for a line that leads back lies against the box from outside.
      const ir = { schemaVersion: 1, kind: 'flowchart', title: 'Loop', direction, nodes: [{ id: 's', label: 'Start', shape: 'terminal' }, { id: 't', label: 'Read the next file', shape: 'io' }, { id: 'w', label: 'Check it' }, { id: 'q', label: 'More files?', shape: 'decision' }, { id: 'z', label: 'Done', shape: 'terminal' }], edges: [{ id: 'e1', from: 's', to: 't' }, { id: 'e2', from: 't', to: 'w' }, { id: 'e3', from: 'w', to: 'q' }, { id: 'b1', from: 'q', to: 't', kind: 'conditional', label: 'yes' }, { id: 'e4', from: 'q', to: 'z', kind: 'conditional', label: 'no' }] };
      const d = await drawio(ir);
      const b = d.box('t');
      const end = d.path('b1').at(-1);
      expect(distanceTo(outlineOf(d.cell('t'), b), end)).toBeLessThan(0.01);
      expect(end.y).toBeCloseTo(b.y + b.height, 6);
    });
  }

  it('leaves a self-loop on a rectangle as it was', async () => {
    const ir = { schemaVersion: 1, kind: 'flowchart', title: 'Retry', nodes: [{ id: 't', label: 'Read the file' }], edges: [{ id: 'l1', from: 't', to: 't' }] };
    const d = await drawio(ir);
    expect(d.cell('l1').style).toMatch(/exitX=1;exitY=0\.3;exitDx=0;exitDy=0;entryX=1;entryY=0\.7;entryDx=0;entryDy=0;$/);
  });
});

/**
 * The circle of an initial or final state touches its box only in the middle of each side.
 * Several lines on one side end beside that middle: each ends on the circle at the column
 * (or the height) the layout routed it at, and draw.io is told to keep that point.
 */
describe('line ends on the circle of an initial or final state', () => {
  for (const direction of DIRECTIONS) {
    for (const k of [2, 3, 4]) {
      it(`starts ${k} lines on the initial circle and ends ${k} on the final one, along the flow (${direction})`, async () => {
        const d = await drawio(throughCircles(k, direction));
        const start = outlineOf(d.cell('s0'), d.box('s0'));
        const end = outlineOf(d.cell('end'), d.box('end'));
        for (let i = 1; i <= k; i++) {
          const out = d.path(`o${i}`);
          expect(d.cell(`o${i}`).style, `o${i}`).toContain('exitPerimeter=0;');
          expect(distanceTo(start, out[0]), `o${i} starts on the circle`).toBeLessThan(0.01);
          expect(startOffFlow(out, direction), `o${i} leaves along the flow`).toBeLessThan(0.01);
          const into = d.path(`i${i}`);
          expect(d.cell(`i${i}`).style, `i${i}`).toContain('entryPerimeter=0;');
          expect(distanceTo(end, into.at(-1)), `i${i} ends on the circle`).toBeLessThan(0.01);
          expect(offFlow(into, direction), `i${i} arrives along the flow`).toBeLessThan(0.01);
        }
        // The circles keep their size, and every line an end of its own.
        expect(d.box('s0')).toMatchObject({ width: 30, height: 30 });
        expect(d.box('end')).toMatchObject({ width: 30, height: 30 });
        expect(new Set(Array.from({ length: k }, (_, i) => JSON.stringify(d.path(`i${i + 1}`).at(-1)))).size).toBe(k);
      });
    }
  }

  it('ends a line beside the middle of a side short of the box, where the circle is', async () => {
    const d = await drawio(throughCircles(3, 'TB'));
    const b = d.box('s0');
    // The outer two of three lines leave about a quarter of the width from the middle, where
    // the circle is some 2 px above the bottom of the box; the middle one leaves at the bottom.
    for (const id of ['o1', 'o3']) {
      const from = d.path(id)[0];
      const off = Math.abs(from.x - (b.x + 15));
      expect(off, id).toBeGreaterThan(5);
      // The offset is written to a thousandth of a pixel.
      expect(from.y, id).toBeCloseTo(b.y + 15 + Math.sqrt(15 * 15 - off * off), 2);
      expect(from.y, id).toBeLessThan(b.y + 29);
    }
    expect(d.path('o2')[0]).toEqual({ x: b.x + 15, y: b.y + 30 });
  });

  for (const direction of DIRECTIONS) {
    it(`leaves a line alone on its circle in the middle of the side (${direction})`, async () => {
      const d = await drawio(throughCircles(1, direction));
      const middle = (b) => ({ TB: { x: b.x + 15, y: b.y + 30 }, BT: { x: b.x + 15, y: b.y }, LR: { x: b.x + 30, y: b.y + 15 }, RL: { x: b.x, y: b.y + 15 } })[direction];
      const opposite = (b) => ({ x: 2 * (b.x + 15) - middle(b).x, y: 2 * (b.y + 15) - middle(b).y });
      expect(d.path('o1')[0]).toEqual(middle(d.box('s0')));
      expect(d.path('i1').at(-1)).toEqual(opposite(d.box('end')));
      expect(d.cell('o1').style).toMatch(/exitDx=0;exitDy=0;exitPerimeter=0;/);
      expect(d.cell('i1').style).toMatch(/entryDx=0;entryDy=0;entryPerimeter=0;$/);
    });
  }

  it('ends the lines on a circle inside a composite state on that circle', async () => {
    const d = await drawio({
      schemaVersion: 1, kind: 'state', title: 'Inside', direction: 'TB',
      states: [{ id: 'comp', label: 'Processing', kind: 'composite', children: ['s0', 'a', 'b', 'end'] }, { id: 's0', kind: 'initial' }, { id: 'a', label: 'Picking' }, { id: 'b', label: 'Packing' }, { id: 'end', kind: 'final' }],
      transitions: [{ id: 'o1', from: 's0', to: 'a' }, { id: 'o2', from: 's0', to: 'b' }, { id: 'i1', from: 'a', to: 'end' }, { id: 'i2', from: 'b', to: 'end' }],
    });
    expect(d.cell('s0').parent).toBe('d:comp');
    for (const id of ['o1', 'o2']) {
      expect(distanceTo(outlineOf(d.cell('s0'), d.box('s0')), d.path(id)[0]), id).toBeLessThan(0.01);
      expect(startOffFlow(d.path(id), 'TB'), id).toBeLessThan(0.01);
    }
    for (const id of ['i1', 'i2']) {
      expect(distanceTo(outlineOf(d.cell('end'), d.box('end')), d.path(id).at(-1)), id).toBeLessThan(0.01);
      expect(offFlow(d.path(id), 'TB'), id).toBeLessThan(0.01);
    }
  });

  it('leaves the ends on a state that is no circle as they were', async () => {
    const d = await drawio(throughCircles(1, 'TB'));
    expect(d.cell('o1').style).toMatch(/entryX=0\.5;entryY=0;entryDx=0;entryDy=0;$/);
    expect(d.cell('i1').style).toMatch(/exitX=0\.5;exitY=1;exitDx=0;exitDy=0;entry/);
  });
});
