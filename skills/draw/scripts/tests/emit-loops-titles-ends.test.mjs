import { describe, it, expect } from 'vitest';
import { emit } from '../src/pipeline.mjs';
import { backEdges } from '../src/layout-graph.mjs';
import { figjamLabel } from '../src/mermaid-text.mjs';
import { textWidth } from '../src/text-metrics.mjs';
import { checkDrawioStructure, absoluteBounds, edgePaths } from './drawio-structure.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadFixture, scriptsDir } from './helpers.mjs';

async function drawio(ir) {
  const r = await emit(ir, 'drawio', { diagramId: 'd' });
  expect(r.ok).toBe(true);
  const { problems, cells } = checkDrawioStructure(r.output);
  expect(problems).toEqual([]);
  const abs = absoluteBounds(cells);
  return { r, cells, abs, paths: edgePaths(cells, abs), cell: (id) => cells.find((c) => c.id === `d:${id}`) };
}

const loop = {
  schemaVersion: 1, kind: 'flowchart', title: 'Check every line',
  nodes: [
    { id: 'start', label: 'Start', shape: 'terminal' },
    { id: 'take', label: 'Take next line' },
    { id: 'valid', label: 'Line valid?', shape: 'decision' },
    { id: 'collect', label: 'Collect error' },
    { id: 'more', label: 'More lines?', shape: 'decision' },
    { id: 'done', label: 'Done', shape: 'terminal' },
  ],
  edges: [
    { id: 'e1', from: 'start', to: 'take' },
    { id: 'e2', from: 'take', to: 'valid' },
    { id: 'e3', from: 'valid', to: 'collect', kind: 'conditional', label: 'no' },
    { id: 'e4', from: 'valid', to: 'more', kind: 'conditional', label: 'yes' },
    { id: 'e5', from: 'collect', to: 'more' },
    { id: 'e6', from: 'more', to: 'take', kind: 'conditional', label: 'yes' },
    { id: 'e7', from: 'more', to: 'done', kind: 'conditional', label: 'no' },
  ],
};

describe('edges that lead back to an earlier step', () => {
  it('are the edges of a cycle that run against the order of the nodes, and no others', () => {
    expect([...backEdges(loop.nodes, loop.edges)]).toEqual(['e6']);
  });

  it('are none in a graph without a cycle, whatever the order of the nodes', () => {
    const nodes = [{ id: 'b' }, { id: 'a' }];
    expect(backEdges(nodes, [{ id: 'x', from: 'a', to: 'b' }]).size).toBe(0);
  });

  it('leave a self-loop and an edge to an unknown node alone', () => {
    const nodes = [{ id: 'a' }, { id: 'b' }];
    expect(backEdges(nodes, [{ id: 's', from: 'a', to: 'a' }, { id: 'u', from: 'b', to: 'zz' }]).size).toBe(0);
  });

  it('keep two nested loops in the order they were written', () => {
    const nodes = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
    const edges = [['a', 'b'], ['b', 'c'], ['c', 'b'], ['c', 'd'], ['d', 'a']].map(([from, to], i) => ({ id: `e${i}`, from, to }));
    expect([...backEdges(nodes, edges)].sort()).toEqual(['e2', 'e4']);
  });
});

describe('a flowchart with a loop in draw.io', () => {
  it('puts the steps of the loop below one another in the order they were written', async () => {
    const { abs } = await drawio(loop);
    const top = (id) => abs.get(`d:${id}`).y;
    expect(top('start')).toBeLessThan(top('take'));
    expect(top('take')).toBeLessThan(top('valid'));
    expect(top('valid')).toBeLessThan(top('more'));
    expect(top('more')).toBeLessThan(top('done'));
  });

  it('draws the return line from the last step of the loop to its first', async () => {
    const { cell, paths, abs } = await drawio(loop);
    expect(cell('e6').source).toBe('d:more');
    expect(cell('e6').target).toBe('d:take');
    const path = paths.get('d:e6');
    const more = abs.get('d:more');
    const take = abs.get('d:take');
    expect(Math.abs(path[0].y - (more.y + more.height / 2))).toBeLessThanOrEqual(more.height / 2 + 1);
    expect(Math.abs(path.at(-1).y - (take.y + take.height / 2))).toBeLessThanOrEqual(take.height / 2 + 1);
  });

  it('lets every branch leave its decision through one tip as one line, and the return branch through a side tip', async () => {
    const { cell, paths, abs } = await drawio(loop);
    const tip = (id) => { const b = abs.get(`d:${id}`); return { bottom: { x: b.x + b.width / 2, y: b.y + b.height }, top: { x: b.x + b.width / 2, y: b.y }, right: { x: b.x + b.width, y: b.y + b.height / 2 } }; };
    const near = (p, q) => Math.hypot(p.x - q.x, p.y - q.y) < 1;
    for (const id of ['e3', 'e4']) expect(near(paths.get(`d:${id}`)[0], tip('valid').bottom), id).toBe(true);
    expect(near(paths.get('d:e7')[0], tip('more').bottom)).toBe(true);
    expect(near(paths.get('d:e6')[0], tip('more').right)).toBe(true);
    // Both lines into "More lines?" end at its top tip.
    for (const id of ['e4', 'e5']) expect(near(paths.get(`d:${id}`).at(-1), tip('more').top), id).toBe(true);
    expect(cell('e3').style).toMatch(/exitX=0.5;exitY=1;/);
  });

  it('writes each answer on the part of the line that is its branch alone', async () => {
    const { cells, abs, paths } = await drawio(loop);
    const centre = (id) => {
      const c = cells.find((x) => x.id === `d:${id}:label`);
      const path = paths.get(`d:${id}`);
      const total = path.reduce((sum, p, i) => (i === 0 ? 0 : sum + Math.hypot(p.x - path[i - 1].x, p.y - path[i - 1].y)), 0);
      let left = ((Number(c.mxGeometry.x) + 1) / 2) * total;
      for (let i = 1; i < path.length; i++) {
        const l = Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
        if (left <= l) return { x: path[i - 1].x + ((path[i].x - path[i - 1].x) * left) / l, y: path[i - 1].y + ((path[i].y - path[i - 1].y) * left) / l };
        left -= l;
      }
      return path.at(-1);
    };
    const onPath = (p, path) => path.some((q, i) => i > 0 && Math.abs(Math.hypot(p.x - path[i - 1].x, p.y - path[i - 1].y) + Math.hypot(p.x - q.x, p.y - q.y) - Math.hypot(q.x - path[i - 1].x, q.y - path[i - 1].y)) < 0.5);
    // The anchor of "no" lies on the line to "Collect error" and not on the line to "More lines?", and the other way round.
    expect(onPath(centre('e3'), paths.get('d:e4'))).toBe(false);
    expect(onPath(centre('e4'), paths.get('d:e3'))).toBe(false);
    expect(abs.get('d:valid')).toBeDefined();
  });
});

describe('the title of a plain frame in draw.io', () => {
  const crossed = (direction) => ({
    schemaVersion: 1, kind: 'architecture', title: 'Reporting', direction,
    components: [{ id: 'bus', label: 'Events', kind: 'queue' }, { id: 'job', label: 'Report job' }],
    boundaries: [{ id: 'analytics', label: 'Analytics', children: ['job'] }],
    connections: [{ id: 'c1', from: 'bus', to: 'job', label: 'invoice issued' }],
  });
  const titleBox = (cells, abs, id) => {
    const style = cells.find((c) => c.id === id).style;
    const frame = abs.get(id);
    const left = /spacingLeft=(\d+);/.exec(style);
    return { left: left ? frame.x + Number(left[1]) : undefined, frame, style };
  };

  it('steps aside when a connection enters the frame through its header', async () => {
    const { cells, abs, paths, r } = await drawio(crossed('TB'));
    const { left, frame, style } = titleBox(cells, abs, 'd:analytics');
    expect(style).toContain('align=left;');
    const line = paths.get('d:c1').find((p) => p.y >= frame.y && p.y <= frame.y + 30) ?? paths.get('d:c1').at(-1);
    // Bold "Analytics" is under 80 px wide: the line runs clear of the text on one side.
    expect(line.x < left || line.x > left + 60).toBe(true);
    expect(r.warnings.filter((w) => String(w.message).startsWith('layout:'))).toEqual([]);
  });

  it('stays centred when nothing crosses the header', async () => {
    const { cells, abs } = await drawio(crossed('LR'));
    expect(titleBox(cells, abs, 'd:analytics').style).not.toContain('spacingLeft=');
  });

  it('steps aside in a flowchart group as well', async () => {
    const { cells, abs } = await drawio({
      schemaVersion: 1, kind: 'flowchart', title: 'Grouped',
      nodes: [{ id: 'a', label: 'Start', shape: 'terminal' }, { id: 'b', label: 'Check the request' }],
      edges: [{ id: 'e1', from: 'a', to: 'b' }],
      groups: [{ id: 'g', label: 'Checks', children: ['b'] }],
    });
    expect(titleBox(cells, abs, 'd:g').style).toContain('align=left;');
  });
});

/**
 * A transition that enters a state inside a composite from above, or leaves one through the
 * top, runs across the header of the composite. Its title steps aside like the title of a
 * flowchart group; a transition that ends on the composite itself stops at the border and
 * moves nothing.
 */
describe('the title of a composite state in draw.io', () => {
  const PLAIN = 'swimlane;whiteSpace=wrap;html=1;startSize=30;rounded=1;arcSize=10;';
  /** `k` states outside a composite, each with a transition to a state inside it (from one, bottom-up, where the flow leaves through the top). */
  const through = (k, direction, title = 'Under review') => {
    const n = Array.from({ length: k }, (_, i) => i + 1);
    return {
      schemaVersion: 1, kind: 'state', title: 'Review', direction,
      states: [...n.map((i) => ({ id: `a${i}`, label: `Stage ${i}` })), { id: 'comp', label: title, kind: 'composite', children: n.map((i) => `c${i}`) }, ...n.map((i) => ({ id: `c${i}`, label: `Check ${i}` }))],
      transitions: n.map((i) => ({ id: `t${i}`, ...(direction === 'BT' ? { from: `c${i}`, to: `a${i}` } : { from: `a${i}`, to: `c${i}` }), ...(i === 2 ? { event: 'flagged' } : {}) })),
    };
  };
  /** Where draw.io puts the label of a line: its place along the drawn line, moved by its offset. */
  const labelBox = (cell, path) => {
    const lengths = path.slice(1).map((p, i) => Math.abs(p.x - path[i].x) + Math.abs(p.y - path[i].y));
    let along = ((Number(cell.mxGeometry.x) + 1) / 2) * lengths.reduce((sum, l) => sum + l, 0);
    let i = 0;
    while (i < lengths.length - 1 && along > lengths[i]) along -= lengths[i++];
    const t = lengths[i] === 0 ? 0 : along / lengths[i];
    const offset = cell.mxGeometry.mxPoint?.[0] ?? { x: 0, y: 0 };
    const width = textWidth(cell.value.replace(/<[^>]+>/g, '')) + 4;
    const align = /align=(left|right|center)/.exec(cell.style)?.[1] ?? 'center';
    const x = path[i].x + t * (path[i + 1].x - path[i].x) + Number(offset.x) - (align === 'center' ? width / 2 : align === 'right' ? width : 0);
    const y = path[i].y + t * (path[i + 1].y - path[i].y) + Number(offset.y);
    return { x0: x, x1: x + width, y0: y - 8, y1: y + 8 };
  };
  /** The least distance between the text of a composite's title and a line or a line label in its header strip. */
  const clearance = ({ cells, abs, paths }, id, label) => {
    const style = cells.find((c) => c.id === `d:${id}`).style;
    const frame = abs.get(`d:${id}`);
    const header = Number(/startSize=(\d+);/.exec(style)[1]);
    const width = Math.max(...label.split('\n').map((line) => textWidth(line, { bold: true })));
    const left = /spacingLeft=(\d+);/.exec(style);
    // draw.io keeps 2 px between a left-aligned title and its margin.
    const x0 = left ? frame.x + Number(left[1]) + 2 : frame.x + (frame.width - width) / 2;
    const inStrip = (y0, y1) => y1 > frame.y + 0.5 && y0 < frame.y + header;
    const spans = [];
    for (const path of paths.values()) for (let i = 1; i < path.length; i++) if (inStrip(Math.min(path[i - 1].y, path[i].y), Math.max(path[i - 1].y, path[i].y))) spans.push([Math.min(path[i - 1].x, path[i].x), Math.max(path[i - 1].x, path[i].x)]);
    for (const c of cells.filter((x) => /:label$/.test(x.id) && x.value)) {
      const box = labelBox(c, paths.get(c.id.replace(/:label$/, '')));
      if (inStrip(box.y0, box.y1)) spans.push([box.x0, box.x1]);
    }
    const inFrame = spans.filter(([a, b]) => b > frame.x && a < frame.x + frame.width);
    return { style, frame, crossed: inFrame.length, least: Math.min(Infinity, ...inFrame.map(([a, b]) => (b < x0 ? x0 - b : a > x0 + width ? a - (x0 + width) : 0))) };
  };
  const layoutWarnings = (r) => r.warnings.filter((w) => String(w.message).startsWith('layout:'));

  for (const direction of ['TB', 'BT']) {
    for (const k of [1, 2, 3]) {
      it(`stands 12 px or more from ${k} ${k === 1 ? "line" : "lines"} ${direction === "TB" ? "into the composite from above" : "out of it through the top"} (${direction})`, async () => {
        const d = await drawio(through(k, direction));
        const { crossed, least } = clearance(d, 'comp', 'Under review');
        expect(crossed).toBeGreaterThanOrEqual(k);
        expect(least).toBeGreaterThanOrEqual(12);
        expect(layoutWarnings(d.r)).toEqual([]);
      });
    }
  }

  it('moves the title along the header with align and spacingLeft, as a group title is moved', async () => {
    const d = await drawio(through(1, 'TB'));
    expect(d.cell('comp').style).toMatch(/^swimlane;whiteSpace=wrap;html=1;startSize=30;rounded=1;arcSize=10;align=left;spacingLeft=\d+;$/);
  });

  it('keeps its centred place and its style when no line crosses the header', async () => {
    // Left to right, the transitions enter through the side of the composite.
    const side = await drawio(through(2, 'LR'));
    expect(side.cell('comp').style).toBe(PLAIN);
    // Two lines left and right of a title that fits between them.
    expect((await drawio(through(2, 'TB'))).cell('comp').style).toBe(PLAIN);
  });

  it('stays where it is under a transition that ends on the composite itself', async () => {
    // The arrow stops at the border above the title; it does not run through the header.
    const d = await drawio(loadFixture('state', 'valid'));
    expect(d.cell('processing').style).toBe(PLAIN);
    const end = d.paths.get('d:t3').at(-1);
    expect(end.y).toBeCloseTo(d.abs.get('d:processing').y, 6);
  });

  it('widens a composite too narrow for its title beside the line, and keeps the title on one line', async () => {
    const title = 'Under review by the risk team';
    const crossed = await drawio(through(1, 'TB', title));
    const side = await drawio(through(1, 'LR', title));
    const { frame, least, style } = clearance(crossed, 'comp', title);
    expect(least).toBeGreaterThanOrEqual(12);
    expect(frame.width).toBeGreaterThan(side.abs.get('d:comp').width);
    // The whole title fits between its place and the right side of the frame.
    const left = Number(/spacingLeft=(\d+);/.exec(style)[1]);
    expect(frame.width - left - 8).toBeGreaterThanOrEqual(textWidth(title, { bold: true }));
    expect(layoutWarnings(crossed.r)).toEqual([]);
  });

  it('steps aside with both lines of a title that names a ref', async () => {
    const d = await drawio(loadFixture('state', 'valid-ref-parts'));
    const label = d.cell('fulfil').value.replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, '');
    expect(label.split('\n')).toHaveLength(2);
    expect(d.cell('fulfil').style).toContain('startSize=46;');
    const { crossed, least } = clearance(d, 'fulfil', label);
    expect(crossed).toBeGreaterThanOrEqual(1);
    expect(least).toBeGreaterThanOrEqual(12);
  });

  it('steps aside in a composite and in the composite around it, when one line crosses both headers', async () => {
    const d = await drawio({
      schemaVersion: 1, kind: 'state', title: 'Nested',
      states: [{ id: 's0', kind: 'initial' }, { id: 'outer', label: 'Processing', kind: 'composite', children: ['inner', 'x'] }, { id: 'inner', label: 'Under review', kind: 'composite', children: ['y'] }, { id: 'y', label: 'Checking' }, { id: 'x', label: 'Waiting' }],
      transitions: [{ id: 't1', from: 's0', to: 'y' }, { id: 't2', from: 'y', to: 'x', event: 'done' }],
    });
    for (const [id, label] of [['outer', 'Processing'], ['inner', 'Under review']]) {
      const { crossed, least } = clearance(d, id, label);
      expect(crossed, id).toBeGreaterThanOrEqual(1);
      expect(least, id).toBeGreaterThanOrEqual(12);
    }
  });

  it('keeps the dot of a merged fan-in on its lines when the title has moved', async () => {
    const sources = Array.from({ length: 5 }, (_, i) => `a${i + 1}`);
    const d = await drawio({
      schemaVersion: 1, kind: 'state', title: 'Closing',
      states: [...sources.map((id, i) => ({ id, label: `Stage ${i + 1}` })), { id: 'comp', label: 'Under review', kind: 'composite', children: ['c'] }, { id: 'c', label: 'Checking' }],
      transitions: sources.map((from, i) => ({ id: `t${i + 1}`, from, to: 'c' })),
    });
    expect(clearance(d, 'comp', 'Under review').least).toBeGreaterThanOrEqual(12);
    const dots = d.cells.filter((c) => /zukaiJunction=1/.test(c.style ?? ''));
    expect(dots).toHaveLength(1);
    const dot = d.abs.get(dots[0].id);
    const centre = { x: dot.x + dot.width / 2, y: dot.y + dot.height / 2 };
    const on = (p, a, b) => Math.abs(Math.hypot(p.x - a.x, p.y - a.y) + Math.hypot(p.x - b.x, p.y - b.y) - Math.hypot(a.x - b.x, a.y - b.y)) < 0.01;
    for (const t of sources.map((_, i) => `d:t${i + 1}`)) expect(d.paths.get(t).some((p, i, path) => i > 0 && on(centre, path[i - 1], p)), t).toBe(true);
  });
});

describe('a relation of a class with itself in draw.io', () => {
  const ir = (direction) => ({
    schemaVersion: 1, kind: 'class', title: 'Credit notes', direction,
    classes: [{ id: 'invoice', label: 'Invoice' }, { id: 'line', label: 'InvoiceLine' }],
    relations: [
      { id: 'r1', from: 'invoice', to: 'invoice', kind: 'association', label: 'credits', fromCardinality: '0..1', toCardinality: '0..*' },
      { id: 'r2', from: 'invoice', to: 'line', kind: 'composition', fromCardinality: '1', toCardinality: '1..*' },
    ],
  });

  for (const direction of ['TB', 'LR']) {
    it(`shows both cardinalities (${direction})`, async () => {
      const { cell } = await drawio(ir(direction));
      expect(cell('r1:from-card')?.value).toBe('0..1');
      expect(cell('r1:to-card')?.value).toBe('0..*');
    });
  }
});

describe('an ER entity header in draw.io', () => {
  it('does not grow for relations that leave through the bottom side', async () => {
    // Tall children stand below the tenant, so both relations leave it through its bottom side.
    const columns = Array.from({ length: 12 }, (_, i) => ({ name: `c${i}`, type: 'text' }));
    const entity = (id) => ({ id, label: id, attributes: [{ name: 'id', type: 'uuid', key: 'pk' }, ...(id === 'tenant' ? [] : [{ name: 'tenant_id', type: 'uuid', key: 'fk' }, ...columns])] });
    const { cell } = await drawio({
      schemaVersion: 1, kind: 'er', title: 'Tenant data',
      entities: ['tenant', 'a', 'b'].map(entity),
      relations: ['a', 'b'].map((to, i) => ({ id: `r${i}`, from: 'tenant', to, fromCardinality: 'one', toCardinality: 'many' })),
    });
    const header = (id) => Number(/startSize=(\d+);/.exec(cell(id).style)[1]);
    expect(header('tenant')).toBe(header('a'));
  });
});

describe('a FigJam label', () => {
  it('keeps the sense of a comparison, a percentage and an ampersand', () => {
    expect(figjamLabel('total <= 10M').label).toBe('total ≤ 10M');
    expect(figjamLabel('qty > 0 and price >= 0').label).toBe('qty ＞ 0 and price ≥ 0');
    expect(figjamLabel('a != b, c <> d').label).toBe('a ≠ b, c ≠ d');
    expect(figjamLabel('attempts < 3').label).toBe('attempts ＜ 3');
    expect(figjamLabel('8% or 10%').label).toBe('8％ or 10％');
    expect(figjamLabel('lines & totals')).toEqual({ label: 'lines ＆ totals', altered: true });
  });

  it('has none of the characters the FigJam parser rejects', () => {
    expect(figjamLabel('ErrorOr<T> {"a": [1]} | x; #1 `y` \\ 5% & <=').label).not.toMatch(/[<>{}\[\]|#%;&`\\"]/);
  });
});

describe('lines that cross in draw.io', () => {
  it('are drawn with a jump on every flow edge, so a crossing does not read as a junction', async () => {
    const { cell } = await drawio(loop);
    for (const id of ['e1', 'e3', 'e6']) expect(cell(id).style, id).toContain('jumpStyle=arc;');
  });
});

describe('an architecture client in draw.io', () => {
  it('is a screen, not a person', async () => {
    const { cell } = await drawio({
      schemaVersion: 1, kind: 'architecture', title: 'Shop',
      components: [{ id: 'spa', label: 'Shop SPA', kind: 'client' }, { id: 'api', label: 'Shop API' }],
      connections: [{ id: 'c1', from: 'spa', to: 'api', label: 'HTTPS' }],
    });
    expect(cell('spa').style).toContain('shape=mxgraph.networks.monitor;');
    expect(cell('spa').style).not.toContain('umlActor');
  });
});

describe('the stretch before an arrowhead in draw.io', () => {
  const lastStretch = (path) => Math.hypot(path.at(-1).x - path.at(-2).x, path.at(-1).y - path.at(-2).y);

  it('is as long inside a group as outside: a line turns or joins another at least 24 px before it ends', async () => {
    const grouped = { ...loop, groups: [{ id: 'lines', label: 'Per line', children: ['take', 'valid', 'collect', 'more'] }] };
    for (const ir of [loop, grouped]) {
      const { paths } = await drawio(ir);
      for (const e of ir.edges) {
        const path = paths.get(`d:${e.id}`);
        if (path.length > 2) expect(lastStretch(path), `${ir.groups ? 'grouped' : 'plain'} ${e.id}`).toBeGreaterThanOrEqual(24);
      }
    }
  });

  it('holds inside a composite state and an architecture boundary too', async () => {
    for (const [kind, name] of [['state', 'valid-order-lifecycle'], ['architecture', 'valid-shop-platform'], ['architecture', 'valid-aws-zones'], ['flowchart', 'large-50-nodes']]) {
      const { paths } = await drawio(loadFixture(kind, name));
      for (const [id, path] of paths) if (path.length > 2) expect(lastStretch(path), `${name} ${id}`).toBeGreaterThanOrEqual(24);
    }
  });
});

describe('the answer of a branch that leaves a group in draw.io', () => {
  it('stands next to its decision, not at the far end of the line, and not across the border of the group', async () => {
    const ir = {
      schemaVersion: 1, kind: 'flowchart', title: 'Checks',
      nodes: [
        { id: 'a', label: 'Start', shape: 'terminal' },
        { id: 'found', label: 'Invoice exists?', shape: 'decision' },
        { id: 'draft', label: 'Status is Draft?', shape: 'decision' },
        { id: 'go', label: 'Issue the invoice' },
        { id: 'missing', label: 'Return not found', shape: 'terminal' },
        { id: 'conflict', label: 'Return conflict', shape: 'terminal' },
      ],
      edges: [
        { id: 'e1', from: 'a', to: 'found' },
        { id: 'e2', from: 'found', to: 'missing', kind: 'conditional', label: 'no' },
        { id: 'e3', from: 'found', to: 'draft', kind: 'conditional', label: 'yes' },
        { id: 'e4', from: 'draft', to: 'conflict', kind: 'conditional', label: 'no' },
        { id: 'e5', from: 'draft', to: 'go', kind: 'conditional', label: 'yes' },
      ],
      groups: [{ id: 'pre', label: 'Preconditions', children: ['found', 'draft'] }],
    };
    const { cells, abs, paths } = await drawio(ir);
    const frame = abs.get('d:pre');
    for (const [id, from] of [['e2', 'found'], ['e4', 'draft']]) {
      const c = cells.find((x) => x.id === `d:${id}:label`);
      const path = paths.get(`d:${id}`);
      const total = path.reduce((sum, p, i) => (i === 0 ? 0 : sum + Math.hypot(p.x - path[i - 1].x, p.y - path[i - 1].y)), 0);
      // The label is anchored within 100 px of where the line leaves the decision, on a line several times that long.
      expect(total, id).toBeGreaterThan(200);
      expect(((Number(c.mxGeometry.x) + 1) / 2) * total, id).toBeLessThanOrEqual(100);
      const tip = abs.get(`d:${from}`);
      expect(path[0].y, id).toBeCloseTo(tip.y + tip.height, 0);
      expect(path[0].y, id).toBeLessThan(frame.y + frame.height);
    }
  });
});

describe('the guard of a long activity branch in draw.io', () => {
  it('stands beside its own line next to the decision, not before the point where another flow joins it', async () => {
    // "Valid? no" runs down the system lane and across two lanes to "Correct the draft"; the
    // flow from "Reject with reason" joins that run on the way.
    const ir = JSON.parse(readFileSync(join(scriptsDir, 'tests', 'models', 'activity-approval-delivery.json'), 'utf8'));
    const { cell, paths, abs } = await drawio(ir);
    const path = paths.get('d:f5');
    const total = path.reduce((sum, p, i) => (i === 0 ? 0 : sum + Math.hypot(p.x - path[i - 1].x, p.y - path[i - 1].y)), 0);
    const along = ((Number(cell('f5:label').mxGeometry.x) + 1) / 2) * total;
    // On the first stretch, which leaves the decision downwards, and not on the run across the lanes.
    expect(along).toBeLessThan(Math.abs(path[1].y - path[0].y));
    expect(abs.get('d:valid')).toBeDefined();
  });
});

describe('a step of a loop left outside the group of the loop', () => {
  const strays = (r) => r.warnings.filter((w) => String(w.message).includes('belongs to the loop inside group'));
  const grouped = (children, more = []) => ({ ...loop, groups: [{ id: 'lines', label: 'Per line', children }, ...more] });

  it('is reported with the group to add it to', async () => {
    const { r } = await drawio(grouped(['take', 'valid', 'more']));
    const found = strays(r);
    expect(found).toHaveLength(1);
    expect(found[0].path).toBe('/nodes/3');
    expect(found[0].message).toContain('step "collect"');
    expect(found[0].message).toContain('group "lines"');
    expect(found[0].hint).toContain('add "collect" to the children of group "lines"');
  });

  it('is reported when it lies only in a group around that one', async () => {
    const { r } = await drawio(grouped(['take', 'valid', 'more'], [{ id: 'rules', label: 'Rules', children: ['lines', 'collect'] }]));
    expect(strays(r).map((w) => w.path)).toEqual(['/nodes/3']);
  });

  it('is not reported when the whole loop is in the group, or in a group inside it', async () => {
    expect(strays((await drawio(grouped(['take', 'valid', 'collect', 'more']))).r)).toEqual([]);
    expect(strays((await drawio(grouped(['take', 'valid', 'more', 'errors'], [{ id: 'errors', label: 'Errors', children: ['collect'] }]))).r)).toEqual([]);
  });

  it('is not reported when it lies in another group: a loop may cross groups on purpose', async () => {
    const { r } = await drawio(grouped(['take', 'valid', 'more'], [{ id: 'errors', label: 'Errors', children: ['collect'] }]));
    expect(strays(r)).toEqual([]);
  });

  it('is not reported when no group holds more than half of the loop, or the chart has no loop', async () => {
    expect(strays((await drawio(grouped(['take', 'valid']))).r)).toEqual([]);
    expect(strays((await drawio(loop)).r)).toEqual([]);
    const { r } = await drawio({ ...grouped(['take', 'valid']), edges: loop.edges.filter((e) => e.id !== 'e6') });
    expect(strays(r)).toEqual([]);
  });
});
