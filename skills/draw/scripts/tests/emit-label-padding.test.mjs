import { describe, it, expect } from 'vitest';
import { emit } from '../src/pipeline.mjs';
import { measureNode, wrappedLines, LABEL_PAD } from '../src/layout-graph.mjs';
import { checkDrawioStructure, cellBounds, absoluteBounds, edgePaths } from './drawio-structure.mjs';
import { loadFixture, validFixtures, scriptsDir } from './helpers.mjs';
import { loadPlaywright } from '../src/preview.mjs';

const pw = loadPlaywright(scriptsDir);

/** draw.io keeps 2 px between a shape and its text, plus the style's `spacingLeft` / `spacingRight`. */
const DRAWIO_SPACING = 2;
const spacingOf = (cell, side) => Number(cell.style.match(new RegExp(`spacing${side}=(\\d+)`))?.[1] ?? 0);
/** The room a cell's style leaves between its box and its text, on each side. */
const padOf = (cell) => ({ left: DRAWIO_SPACING + spacingOf(cell, 'Left'), right: DRAWIO_SPACING + spacingOf(cell, 'Right') });

/**
 * The labelled nodes of an IR that are drawn as a plain shape sized by `measureNode`, with
 * the height of a one-line box. A decision is sized against its rhombus, a subroutine's side
 * bars bound its label, the name of a client or of an AWS icon stands below its figure, and a
 * `ref` adds a line.
 */
function plainNodes(ir) {
  const of = (list, keep, base = () => 40) => (list ?? []).filter((el) => !el.ref && keep(el)).map((el) => ({ id: el.id, label: el.label, baseHeight: base(el), slanted: el.shape === 'io' || el.kind === 'queue' }));
  switch (ir.kind) {
    case 'flowchart': return of(ir.nodes, (n) => n.shape !== 'decision' && n.shape !== 'subroutine');
    case 'activity': return of(ir.actions, () => true);
    case 'state': return of(ir.states, (s) => (s.kind ?? 'simple') === 'simple');
    case 'architecture': return of(ir.components, (c) => c.kind !== 'client' && !c.icon, (c) => (c.kind === 'database' || c.kind === 'cache' ? 70 : 40));
    default: return [];
  }
}

async function cellsOf(ir) {
  const r = await emit(ir, 'drawio', { diagramId: 'd', allowSensitive: true });
  expect(r.ok).toBe(true);
  const { problems, cells } = checkDrawioStructure(r.output);
  expect(problems).toEqual([]);
  return { r, cells, cell: (id) => cells.find((c) => c.id === `d:${id}`) };
}

describe('inner padding of node labels in draw.io', () => {
  it('wraps a long label inside the room its box was sized for, clear of both borders', async () => {
    const ir = loadFixture('architecture', 'valid-wrapped-labels');
    const { r, cell } = await cellsOf(ir);
    expect(r.warnings).toEqual([]);
    for (const id of ['svc', 'main-db', 'arch-db']) {
      const c = cell(id);
      const label = ir.components.find((x) => x.id === id).label;
      expect(padOf(c), id).toEqual({ left: LABEL_PAD, right: LABEL_PAD });
      const { width, height } = cellBounds(c);
      expect(width, id).toBe(260);
      // The text really wraps, and the box is as tall as the lines it takes at the padded width.
      const lines = wrappedLines(label, width);
      expect(lines, id).toBeGreaterThan(1);
      expect(height, id).toBe((id === 'svc' ? 40 : 70) + 20 * (lines - 1));
    }
  });

  it('keeps the text of a slanted shape out of the slant, and its box wider by that much', async () => {
    const label = 'Read the export settings of every tenant from the database';
    const short = 'Read input';
    const ir = {
      schemaVersion: 1, kind: 'flowchart', title: 'Shapes', direction: 'LR',
      nodes: [{ id: 'p', label, shape: 'process' }, { id: 'io', label, shape: 'io' }, { id: 'in', label: 'Parse the tenant list', shape: 'io' }, { id: 'small', label: short, shape: 'io' }],
      edges: [{ id: 'e1', from: 'p', to: 'io' }, { id: 'e2', from: 'io', to: 'in' }, { id: 'e3', from: 'in', to: 'small' }],
    };
    const { cell } = await cellsOf(ir);
    // A parallelogram's outline runs 20 px into its box; at mid-height, where an arrow ends, 10 px.
    expect(cell('io').style).toContain('size=20;');
    expect(padOf(cell('io'))).toEqual({ left: 10 + LABEL_PAD, right: 10 + LABEL_PAD });
    expect(padOf(cell('p'))).toEqual({ left: LABEL_PAD, right: LABEL_PAD });
    // A label that fits one line gets the same text width in either shape: the slanted box is wider.
    expect(cellBounds(cell('in')).width - 2 * (10 + LABEL_PAD)).toBe(measureNode('Parse the tenant list').width - 2 * LABEL_PAD);
    expect(cellBounds(cell('small')).width).toBe(120);
    const queue = await cellsOf(loadFixture('architecture', 'valid-wrapped-labels'));
    expect(queue.cell('exports').style).toContain('size=20;');
    expect(padOf(queue.cell('exports'))).toEqual({ left: 10 + LABEL_PAD, right: 10 + LABEL_PAD });
  });

  it('sizes every plain node of every fixture for the text area its style draws', async () => {
    let checked = 0;
    for (const { kind, name, ir } of validFixtures()) {
      const nodes = plainNodes(ir);
      if (nodes.length === 0) continue;
      const { cell } = await cellsOf(ir);
      for (const n of nodes) {
        const c = cell(n.id);
        const pad = padOf(c);
        const where = `${kind}/${name} ${n.id}`;
        expect(pad.left, where).toBe(pad.right);
        expect(pad.left, where).toBe(n.slanted ? 10 + LABEL_PAD : LABEL_PAD);
        expect(c.style, where).toContain('whiteSpace=wrap');
        // The box is the one the heuristic gives for a text area `pad` px in from each side.
        expect(cellBounds(c), where).toMatchObject(measureNode(n.label, { pad: pad.left, baseHeight: n.baseHeight }));
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(100);
  }, 60_000);

  it('ends every connection at least the padding away from the text of the node it meets', async () => {
    const ir = loadFixture('architecture', 'valid-wrapped-labels');
    const { cells, cell } = await cellsOf(ir);
    const abs = absoluteBounds(cells);
    const paths = edgePaths(cells, abs);
    let ends = 0;
    for (const c of ir.connections) {
      const path = paths.get(`d:${c.id}`);
      for (const [id, at] of [[c.from, path[0]], [c.to, path.at(-1)]]) {
        if (ir.components.find((x) => x.id === id).kind === 'client') continue;
        const box = abs.get(`d:${id}`);
        const pad = padOf(cell(id));
        const text = { left: box.x + pad.left, right: box.x + box.width - pad.right };
        // Left-to-right: every end lies on the left or right side of its node, at the box's edge.
        expect(Math.min(Math.abs(at.x - box.x), Math.abs(at.x - box.x - box.width)), `${c.id} at ${id}`).toBeLessThan(0.5);
        expect(Math.min(Math.abs(at.x - text.left), Math.abs(at.x - text.right)), `${c.id} at ${id}`).toBeGreaterThanOrEqual(LABEL_PAD);
        ends++;
      }
    }
    expect(ends).toBe(9);
  });

  it.skipIf(!pw)('renders in Chromium within the lines the box was sized for, at the padded width', async () => {
    const ir = loadFixture('architecture', 'valid-wrapped-labels');
    const { cell } = await cellsOf(ir);
    const nodes = ir.components.filter((c) => c.kind !== 'client').map((c) => {
      const box = cellBounds(cell(c.id));
      const pad = padOf(cell(c.id));
      const baseHeight = c.kind === 'database' ? 70 : 40;
      return { label: c.label, width: box.width - pad.left - pad.right, lines: (box.height - baseHeight) / 20 + 1 };
    });
    const browser = await pw.chromium.launch();
    try {
      const page = await browser.newPage();
      await page.setContent(`<body style="font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.2">${nodes.map((n, i) => `<div id="n${i}" style="width:${n.width}px;white-space:normal;overflow-wrap:normal">${n.label}</div>`).join('')}</body>`);
      const rendered = await page.evaluate((count) => Array.from({ length: count }, (_, i) => {
        const el = document.getElementById(`n${i}`);
        return { lines: Math.round(el.getBoundingClientRect().height / (12 * 1.2)), overflow: el.scrollWidth - el.clientWidth };
      }), nodes.length);
      rendered.forEach((got, i) => {
        expect(got.lines, nodes[i].label).toBeLessThanOrEqual(nodes[i].lines);
        expect(got.overflow, nodes[i].label).toBeLessThanOrEqual(0);
      });
    } finally {
      await browser.close();
    }
  });
});
