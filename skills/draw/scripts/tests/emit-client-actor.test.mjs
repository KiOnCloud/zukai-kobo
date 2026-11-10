import { describe, it, expect } from 'vitest';
import { emit } from '../src/pipeline.mjs';
import { relabelDrawio } from '../src/relabel.mjs';
import { measureLabelBelow } from '../src/layout-graph.mjs';
import { checkDrawioStructure, absoluteBounds, edgePaths } from './drawio-structure.mjs';
import { loadFixture } from './helpers.mjs';

const intersects = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const contains = (outer, inner) => inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
const segmentBox = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) });

/**
 * The clients of an architecture diagram as draw.io draws them: the figure, and the label
 * block under it (centred on the figure, as wide as its wrap width, as tall as the lines the
 * layout counted).
 */
async function clients(ir) {
  const r = await emit(ir, 'drawio', { diagramId: 'a' });
  expect(r.ok).toBe(true);
  const { problems, cells } = checkDrawioStructure(r.output);
  expect(problems).toEqual([]);
  const abs = absoluteBounds(cells);
  const actors = ir.components.filter((c) => c.kind === 'client').map((c) => {
    const cell = cells.find((x) => x.id === `a:${c.id}`);
    const figure = abs.get(cell.id);
    const wrap = Number(cell.style.match(/labelWidth=(\d+)/)[1]);
    const label = { x: figure.x + figure.width / 2 - wrap / 2, y: figure.y + figure.height, width: wrap, height: measureLabelBelow(c.label).height };
    return { id: c.id, cell, figure, label };
  });
  return { r, cells, abs, actors, paths: edgePaths(cells, abs) };
}

describe('client actors of an architecture diagram in draw.io', () => {
  it('keep their label inside the boundary frame and clear of the next actor', async () => {
    const ir = loadFixture('architecture', 'valid-client-labels');
    const { r, abs, actors } = await clients(ir);
    expect(r.warnings).toEqual([]);
    expect(actors).toHaveLength(2);
    const frame = abs.get('a:b-users');
    for (const a of actors) {
      expect(a.figure.width, a.id).toBe(54);
      expect(a.figure.height, a.id).toBe(44);
      expect(a.cell.style, a.id).toContain('whiteSpace=wrap');
      expect(contains(frame, a.figure), `${a.id} figure in frame`).toBe(true);
      expect(contains(frame, a.label), `${a.id} label in frame`).toBe(true);
      for (const o of actors) if (o !== a) {
        expect(intersects(a.label, o.figure), `${a.id} label on ${o.id}`).toBe(false);
        expect(intersects(a.label, o.label), `${a.id} label on ${o.id} label`).toBe(false);
      }
    }
    // The long name wraps onto two lines at its own width instead of running on one line.
    const partner = actors.find((a) => a.id === 'partner');
    expect(partner.label.width).toBeLessThanOrEqual(160);
    expect(partner.label.height).toBeGreaterThan(actors.find((a) => a.id === 'web').label.height);
    // Figures that share a frame stand on one centre line.
    expect(new Set(actors.map((a) => a.figure.x)).size).toBe(1);
  });

  it('lets no connection run through a label, left to right or top to bottom', async () => {
    for (const direction of ['LR', 'TB', 'RL', 'BT']) {
      const ir = { ...loadFixture('architecture', 'valid-client-labels'), direction };
      const { actors, paths } = await clients(ir);
      for (const a of actors) for (const [id, path] of paths) for (let i = 1; i < path.length; i++) {
        expect(intersects(a.label, segmentBox(path[i - 1], path[i])), `${direction}: ${id} through the label of ${a.id}`).toBe(false);
      }
    }
  });

  it('starts a connection that leaves downwards below the label, at a point draw.io keeps', async () => {
    const ir = { ...loadFixture('architecture', 'valid-client-labels'), direction: 'TB' };
    const { cells, actors, paths } = await clients(ir);
    for (const a of actors) {
      const edge = cells.find((c) => c.edge === '1' && c.source === a.cell.id);
      expect(edge.style, a.id).toMatch(/exitY=1;exitDx=0;exitDy=\d+;exitPerimeter=0;/);
      const start = paths.get(edge.id)[0];
      expect(start.y, a.id).toBeGreaterThanOrEqual(a.label.y + a.label.height);
      // Straight down from the figure's centre line: the first waypoint has the same x.
      expect(Math.abs(paths.get(edge.id)[1].x - start.x), a.id).toBeLessThan(0.5);
    }
  });

  it('ends several connections on the figure itself, apart from each other, whatever the width its name reserves', async () => {
    // "Ops" shares a boundary, and so a layout width, with a client whose name is long: its
    // box is far wider and taller than the figure that five services connect to.
    const fanIn = (direction) => ({
      schemaVersion: 1, kind: 'architecture', title: 'Alerts', direction,
      components: [
        { id: 'web', label: 'Customer web browser on a long name', kind: 'client' },
        { id: 'ops', label: 'Ops', kind: 'client' },
        ...[0, 1, 2, 3, 4].map((i) => ({ id: `s${i}`, label: `Service ${i}` })),
      ],
      boundaries: [{ id: 'users', label: 'Users', children: ['web', 'ops'] }],
      connections: [0, 1, 2, 3, 4].map((i) => ({ id: `c${i}`, from: `s${i}`, to: 'ops' })),
    });
    for (const direction of ['TB', 'LR', 'BT', 'RL']) {
      const { cells, actors, paths } = await clients(fanIn(direction));
      const ops = actors.find((a) => a.id === 'ops');
      const ends = cells.filter((c) => c.edge === '1').map((c) => ({ id: c.id, style: c.style, at: paths.get(c.id).at(-1) }));
      expect(ends).toHaveLength(5);
      const vertical = direction === 'TB' || direction === 'BT';
      for (const e of ends) {
        // On the figure (top or side), or straight under its name for an edge that comes from below.
        expect(e.at.x, `${direction} ${e.id} x`).toBeGreaterThanOrEqual(ops.figure.x);
        expect(e.at.x, `${direction} ${e.id} x`).toBeLessThanOrEqual(ops.figure.x + ops.figure.width);
        if (direction === 'BT') expect(e.at.y, `${direction} ${e.id} under the name`).toBeGreaterThanOrEqual(ops.label.y + ops.label.height);
        else {
          expect(e.at.y, `${direction} ${e.id} y`).toBeGreaterThanOrEqual(ops.figure.y);
          expect(e.at.y, `${direction} ${e.id} y`).toBeLessThanOrEqual(ops.figure.y + ops.figure.height);
        }
        expect(e.style, `${direction} ${e.id}`).toMatch(/entryDx=0;/);
      }
      const along = ends.map((e) => (vertical ? e.at.x : e.at.y)).sort((a, b) => a - b);
      for (let i = 1; i < along.length; i++) expect(along[i] - along[i - 1], `${direction} ends apart`).toBeGreaterThanOrEqual(5);
    }
  });

  it('relabel measures a new name at the label width, not at the 54 px figure', async () => {
    const r = await emit(loadFixture('architecture', 'valid-client-labels'), 'drawio', { diagramId: 'a' });
    const fits = relabelDrawio(r.output, { web: 'Trình duyệt khách', partner: 'Tích hợp đối tác (nhập đơn hàng)', $keep: ['Users', 'Shop', 'Order API', 'Orders DB', 'HTTPS', 'SQL'] });
    expect(fits.replaced).toBe(2);
    expect(fits.warnings).toEqual([]);
    const long = relabelDrawio(r.output, { web: 'Customer web browser on a desktop or a mobile device' });
    expect(long.warnings.map((w) => w.message)).toEqual([expect.stringMatching(/^layout: the new label wraps to \d lines below its shape, where the layout left room for 1; "a:web"/)]);
  });
});
