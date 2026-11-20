import { expect } from 'vitest';
import { emit } from '../src/pipeline.mjs';
import { checkDrawioStructure, absoluteBounds, edgePaths } from './drawio-structure.mjs';

/** Geometry shared by the tests of line ends on slanted shapes and of crowded fan-in. */

/** A draw.io emit, checked for structure, with the cells, their absolute boxes and every edge as draw.io draws it. */
export async function drawio(ir) {
  const r = await emit(ir, 'drawio', { diagramId: 'd' });
  expect(r.ok, JSON.stringify(r.errors)).toBe(true);
  const { problems, cells } = checkDrawioStructure(r.output);
  expect(problems).toEqual([]);
  const abs = absoluteBounds(cells);
  const paths = edgePaths(cells, abs);
  return { r, cells, abs, paths, cell: (id) => cells.find((c) => c.id === `d:${id}`), box: (id) => abs.get(`d:${id}`), path: (id) => paths.get(`d:${id}`), junctions: cells.filter((c) => /zukaiJunction=1/.test(c.style ?? '')) };
}

const SLANT = 20;

/** The outline draw.io draws for a node, as a closed polygon: a parallelogram, a hexagon, or the box itself. */
export function outlineOf(cell, b) {
  const { x, y, width: w, height: h } = b;
  if (/shape=parallelogram/.test(cell.style)) return [{ x: x + SLANT, y }, { x: x + w, y }, { x: x + w - SLANT, y: y + h }, { x, y: y + h }];
  if (/shape=hexagon/.test(cell.style)) return [{ x: x + SLANT, y }, { x: x + w - SLANT, y }, { x: x + w, y: y + h / 2 }, { x: x + w - SLANT, y: y + h }, { x: x + SLANT, y: y + h }, { x, y: y + h / 2 }];
  return [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
}

/** Distance from a point to the nearest edge of a polygon. */
export function distanceTo(polygon, p) {
  let best = Infinity;
  polygon.forEach((a, i) => {
    const b = polygon[(i + 1) % polygon.length];
    const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2));
    best = Math.min(best, Math.hypot(p.x - (a.x + t * (b.x - a.x)), p.y - (a.y + t * (b.y - a.y))));
  });
  return best;
}

/** How far the last stretch of a path is off the flow: its change across the direction of the diagram. */
export const offFlow = (path, direction) => (direction === 'LR' || direction === 'RL' ? Math.abs(path.at(-1).y - path.at(-2).y) : Math.abs(path.at(-1).x - path.at(-2).x));

/** The gaps between the distinct places where the given paths end, along the side they end on. */
export function endGaps(paths, direction) {
  const across = direction === 'LR' || direction === 'RL' ? 'y' : 'x';
  const at = [...new Set(paths.map((p) => Math.round(p.at(-1)[across] * 100) / 100))].sort((a, b) => a - b);
  return at.slice(1).map((v, i) => v - at[i]);
}

export const DIRECTIONS = ['LR', 'RL', 'TB', 'BT'];

/** `k` sources that each lead into the node `t`; the edges named in `labelled` carry a label. */
export function fanIn(k, { shape = 'process', direction = 'LR', labelled = [], extra = {} } = {}) {
  return {
    schemaVersion: 1, kind: 'flowchart', title: `Fan-in of ${k}`, direction, ...extra,
    nodes: [...Array.from({ length: k }, (_, i) => ({ id: `s${i + 1}`, label: `Source ${i + 1}` })), { id: 't', label: 'Collect the input', shape }],
    edges: Array.from({ length: k }, (_, i) => ({ id: `e${i + 1}`, from: `s${i + 1}`, to: 't', ...(labelled.includes(i + 1) ? { label: `case ${i + 1}` } : {}) })),
  };
}

/** `k` services that each connect to one queue. */
export function queueFanIn(k, direction = 'LR') {
  return {
    schemaVersion: 1, kind: 'architecture', title: `Fan-in of ${k}`, direction,
    components: [...Array.from({ length: k }, (_, i) => ({ id: `s${i + 1}`, label: `Service ${i + 1}`, kind: 'service' })), { id: 't', label: 'Orders queue', kind: 'queue' }],
    connections: Array.from({ length: k }, (_, i) => ({ id: `e${i + 1}`, from: `s${i + 1}`, to: 't' })),
  };
}
