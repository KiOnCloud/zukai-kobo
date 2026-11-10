import { describe, it, expect } from 'vitest';
import { emit } from '../src/pipeline.mjs';
import { backEdges } from '../src/layout-graph.mjs';
import { figjamLabel } from '../src/mermaid-text.mjs';
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
