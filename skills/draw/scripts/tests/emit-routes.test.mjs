import { describe, it, expect } from 'vitest';
import { emit } from '../src/pipeline.mjs';
import { planArchitectureGrid } from '../src/emit-mermaid.mjs';
import { checkDrawioStructure, cellBounds } from './drawio-structure.mjs';
import { loadFixture, scriptsDir } from './helpers.mjs';
import { loadPlaywright } from '../src/preview.mjs';

/** Absolute bounds of every vertex (children are relative to their parent chain). */
function absoluteBounds(cells) {
  const byId = new Map(cells.map((c) => [c.id, c]));
  const abs = new Map();
  const of = (c) => {
    if (abs.has(c.id)) return abs.get(c.id);
    const b = cellBounds(c);
    const parent = byId.get(c.parent);
    if (parent && parent.vertex === '1') { const p = of(parent); abs.set(c.id, { ...b, x: b.x + p.x, y: b.y + p.y }); } else abs.set(c.id, b);
    return abs.get(c.id);
  };
  for (const c of cells) if (c.vertex === '1') of(c);
  return abs;
}
const num = (style, key) => { const m = style.match(new RegExp(`${key}=(-?[\\d.]+)`)); return m ? Number(m[1]) : undefined; };

/**
 * Rebuild every edge as draw.io draws it: exit anchor on the source box, the waypoints, the
 * entry anchor on the target box. Also returns the label boxes (from relative geometry) and
 * the leaf node boxes.
 */
function rebuild(xml, prefix) {
  const { cells } = checkDrawioStructure(xml);
  const abs = absoluteBounds(cells);
  const edges = [];
  for (const c of cells) {
    if (c.edge !== '1') continue;
    const s = abs.get(c.source);
    const t = abs.get(c.target);
    const pts = [...(xml.match(new RegExp(`<mxCell id="${c.id}"[\\s\\S]*?</mxCell>`))[0]).matchAll(/<mxPoint x="(-?[\d.]+)" y="(-?[\d.]+)"/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
    const ex = num(c.style, 'exitX'); const ey = num(c.style, 'exitY'); const nx = num(c.style, 'entryX'); const ny = num(c.style, 'entryY');
    const start = ex === undefined ? { x: s.x + s.width / 2, y: s.y + s.height / 2 } : { x: s.x + ex * s.width, y: s.y + ey * s.height };
    const end = nx === undefined ? { x: t.x + t.width / 2, y: t.y + t.height / 2 } : { x: t.x + nx * t.width, y: t.y + ny * t.height };
    const path = [start, ...pts, end];
    const label = cells.find((l) => l.id === `${c.id}:label`);
    let labelBox;
    if (label) {
      const geo = xml.match(new RegExp(`<mxCell id="${label.id}"[\\s\\S]*?<mxGeometry x="(-?[\\d.]+)"[\\s\\S]*?<mxPoint x="(-?[\\d.]+)" y="(-?[\\d.]+)"`));
      const position = Number(geo[1]); const off = { x: Number(geo[2]), y: Number(geo[3]) };
      let total = 0; const lens = [];
      for (let i = 1; i < path.length; i++) { const l = Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y); lens.push(l); total += l; }
      let d = ((position + 1) / 2) * total; let p = path[0];
      for (let i = 1; i < path.length; i++) { if (d <= lens[i - 1] || i === path.length - 1) { const tt = lens[i - 1] ? Math.min(1, d / lens[i - 1]) : 0; p = { x: path[i - 1].x + tt * (path[i].x - path[i - 1].x), y: path[i - 1].y + tt * (path[i].y - path[i - 1].y) }; break; } d -= lens[i - 1]; }
      const text = label.value.replace(/<[^>]+>/g, '');
      const w = text.length * 5.6 + 4; const h = 16;
      const align = label.style.match(/align=(\w+)/)?.[1] ?? 'center';
      const left = align === 'left' ? p.x + off.x : align === 'right' ? p.x + off.x - w : p.x + off.x - w / 2;
      labelBox = { x: left, y: p.y + off.y - h / 2, width: w, height: h };
    }
    edges.push({ id: c.id, source: c.source, target: c.target, path, style: c.style, labelBox });
  }
  const leaves = cells.filter((c) => c.vertex === '1' && c.id.startsWith(`${prefix}:`) && !c.id.includes(':row-') && !c.id.includes(':sep-') && !c.id.endsWith(':label') && !/swimlane|umlFrame/.test(c.style) && c.connectable !== '0').map((c) => ({ id: c.id, ...abs.get(c.id) }));
  return { edges, leaves, cells, abs };
}
const segs = (e) => { const out = []; for (let i = 1; i < e.path.length; i++) out.push({ a: e.path[i - 1], b: e.path[i] }); return out; };
const H = (s) => Math.abs(s.a.y - s.b.y) < 0.5; const V = (s) => Math.abs(s.a.x - s.b.x) < 0.5;
const overlap1d = (a1, a2, b1, b2) => Math.min(Math.max(a1, a2), Math.max(b1, b2)) - Math.max(Math.min(a1, a2), Math.min(b1, b2));
function sharedSegments(edges) {
  const out = [];
  for (let i = 0; i < edges.length; i++) for (let j = i + 1; j < edges.length; j++) for (const p of segs(edges[i])) for (const q of segs(edges[j])) {
    if (H(p) && H(q) && Math.abs(p.a.y - q.a.y) < 0.5 && overlap1d(p.a.x, p.b.x, q.a.x, q.b.x) > 1) out.push([edges[i].id, edges[j].id]);
    if (V(p) && V(q) && Math.abs(p.a.x - q.a.x) < 0.5 && overlap1d(p.a.y, p.b.y, q.a.y, q.b.y) > 1) out.push([edges[i].id, edges[j].id]);
  }
  return out;
}
function crossings(edges) {
  let n = 0;
  for (let i = 0; i < edges.length; i++) for (let j = i + 1; j < edges.length; j++) for (const p of segs(edges[i])) for (const q of segs(edges[j])) {
    const [h, v] = H(p) && V(q) ? [p, q] : V(p) && H(q) ? [q, p] : [null, null];
    if (!h) continue;
    if (v.a.x > Math.min(h.a.x, h.b.x) + 0.5 && v.a.x < Math.max(h.a.x, h.b.x) - 0.5 && h.a.y > Math.min(v.a.y, v.b.y) + 0.5 && h.a.y < Math.max(v.a.y, v.b.y) - 0.5) n++;
  }
  return n;
}
function touchesForeignNode(edges, leaves) {
  const hits = [];
  for (const e of edges) for (const s of segs(e)) for (const n of leaves) {
    if (n.id === e.source || n.id === e.target) continue;
    const x0 = Math.min(s.a.x, s.b.x); const x1 = Math.max(s.a.x, s.b.x); const y0 = Math.min(s.a.y, s.b.y); const y1 = Math.max(s.a.y, s.b.y);
    if (x1 > n.x + 1 && x0 < n.x + n.width - 1 && y1 > n.y + 1 && y0 < n.y + n.height - 1) hits.push(`${e.id} through ${n.id}`);
  }
  return hits;
}
const distToPath = (box, path) => {
  const c = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  let best = Infinity;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]; const b = path[i]; const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
    const t = l2 ? Math.max(0, Math.min(1, ((c.x - a.x) * (b.x - a.x) + (c.y - a.y) * (b.y - a.y)) / l2)) : 0;
    const p = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
    // distance from the box (not its centre) to the point
    const dx = Math.max(box.x - p.x, 0, p.x - (box.x + box.width)); const dy = Math.max(box.y - p.y, 0, p.y - (box.y + box.height));
    best = Math.min(best, Math.hypot(dx, dy));
  }
  return best;
};

describe('issue 25: every graph edge follows its layout route', () => {
  for (const [kind, name] of [['flowchart', 'valid-refund-approval'], ['class', 'valid-order-domain'], ['state', 'valid-order-lifecycle']]) {
    it(`${kind}/${name}: fixed anchors, no shared segments but the trunk of a decision, no edge through a foreign node`, async () => {
      const r = await emit(loadFixture(kind, name), 'drawio', { diagramId: 'g' });
      expect(r.ok).toBe(true);
      const { edges, leaves, cells } = rebuild(r.output, 'g');
      for (const e of edges) expect(e.style, e.id).toMatch(/exitX=.*entryX=/);
      // The branches of one decision leave its tip as one line, and the lines into one
      // decision end at its other tip as one: only those pairs may share a stretch.
      const decision = (id) => /(^|;)rhombus;/.test(cells.find((c) => c.id === id)?.style ?? '');
      const byId = new Map(edges.map((e) => [e.id, e]));
      const atOneTip = ([a, b]) => (byId.get(a).source === byId.get(b).source && decision(byId.get(a).source)) || (byId.get(a).target === byId.get(b).target && decision(byId.get(a).target));
      expect(sharedSegments(edges).filter((pair) => !atOneTip(pair))).toEqual([]);
      expect(touchesForeignNode(edges, leaves)).toEqual([]);
    });
  }

  it('a self-transition takes a side no other edge of its state uses', async () => {
    const r = await emit(loadFixture('state', 'valid-order-lifecycle'), 'drawio', { diagramId: 'g' });
    const { edges } = rebuild(r.output, 'g');
    const loop = edges.find((e) => e.id === 'g:t3');
    const side = num(loop.style, 'exitX');
    const lo = Math.min(num(loop.style, 'exitY'), num(loop.style, 'entryY')) - 0.05;
    const hi = Math.max(num(loop.style, 'exitY'), num(loop.style, 'entryY')) + 0.05;
    for (const e of edges) {
      if (e === loop) continue;
      if (e.source === loop.source && num(e.style, 'exitX') === side) expect(num(e.style, 'exitY') > lo && num(e.style, 'exitY') < hi, e.id).toBe(false);
      if (e.target === loop.source && num(e.style, 'entryX') === side) expect(num(e.style, 'entryY') > lo && num(e.style, 'entryY') < hi, e.id).toBe(false);
    }
  });
});

describe('issue 51: a self-transition in a horizontal layout loops over the top of its state', () => {
  const lr = loadFixture('state', 'valid-self-loop-lr');
  const boxHit = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

  for (const direction of ['LR', 'RL']) {
    it(`${direction}: the loop leaves and re-enters the top side, where no other transition ends, with its label above it`, async () => {
      const r = await emit({ ...lr, direction }, 'drawio', { diagramId: 'g' });
      expect(r.ok).toBe(true);
      expect(r.warnings).toEqual([]);
      const { edges, leaves, abs } = rebuild(r.output, 'g');
      const pay = abs.get('g:pay');
      const loop = edges.find((e) => e.id === 'g:t2');
      expect(num(loop.style, 'exitY')).toBe(0);
      expect(num(loop.style, 'entryY')).toBe(0);
      // Out of the top, 30 px up, across and back down: every point of the loop is on or above the top side.
      expect(loop.path).toHaveLength(4);
      expect(loop.path[1].y).toBeCloseTo(pay.y - 30, 1);
      expect(loop.path[2].y).toBeCloseTo(pay.y - 30, 1);
      for (const p of loop.path) { expect(p.y).toBeLessThanOrEqual(pay.y + 0.5); expect(p.x).toBeGreaterThan(pay.x); expect(p.x).toBeLessThan(pay.x + pay.width); }
      // The other transitions of the state end on its left and right sides only, at mid-height.
      for (const e of edges) {
        if (e === loop) continue;
        for (const [id, at] of [[e.source, e.path[0]], [e.target, e.path.at(-1)]]) {
          if (id !== 'g:pay') continue;
          expect(at.y, e.id).toBeGreaterThan(pay.y + 1);
          expect(at.y, e.id).toBeLessThan(pay.y + pay.height - 1);
        }
      }
      // The state keeps its own size: no room is added beside it, the layout keeps it above.
      expect(pay.height).toBe(40);
      expect(edges.find((e) => e.id === 'g:t1').path.at(-1).x).toBeCloseTo(direction === 'LR' ? pay.x : pay.x + pay.width, 1);
      // The label is centred above the loop, clear of every state and nearer to its loop than to any other transition.
      expect(r.output).toMatch(/<mxCell id="g:t2:label"[^>]*align=center/);
      expect(loop.labelBox.y + loop.labelBox.height).toBeLessThanOrEqual(pay.y - 30);
      expect(distToPath(loop.labelBox, loop.path)).toBeLessThanOrEqual(6);
      for (const n of leaves) expect(boxHit(loop.labelBox, n), n.id).toBe(false);
      for (const e of edges) {
        if (e === loop) continue;
        expect(distToPath(loop.labelBox, e.path), e.id).toBeGreaterThan(20);
        if (e.labelBox) expect(boxHit(loop.labelBox, e.labelBox), e.id).toBe(false);
      }
    });
  }

  it('two self-transitions of one state get a loop and a label each', async () => {
    const ir = { ...lr, transitions: [...lr.transitions, { id: 't7', from: 'pay', to: 'pay', event: 'customer changes the card' }] };
    const r = await emit(ir, 'drawio', { diagramId: 'g' });
    const { edges, abs } = rebuild(r.output, 'g');
    const pay = abs.get('g:pay');
    const loops = edges.filter((e) => e.source === 'g:pay' && e.target === 'g:pay');
    expect(loops).toHaveLength(2);
    expect(sharedSegments(edges)).toEqual([]);
    for (const l of loops) {
      expect(num(l.style, 'exitY')).toBe(0);
      expect(l.labelBox.y + l.labelBox.height).toBeLessThanOrEqual(pay.y);
      const other = loops.find((x) => x !== l);
      expect(boxHit(l.labelBox, other.labelBox)).toBe(false);
      // Each label stands just above the top line of its own loop.
      const top = Math.min(...l.path.map((p) => p.y));
      expect(l.labelBox.y + l.labelBox.height).toBeLessThanOrEqual(top);
      expect(top - (l.labelBox.y + l.labelBox.height)).toBeLessThanOrEqual(6);
    }
  });

  it('the loop of a state inside a composite is as deep as any other', async () => {
    const ir = { ...lr, states: [...lr.states, { id: 'grp', label: 'Checkout', kind: 'composite', children: ['pay', 'paid'] }] };
    const r = await emit(ir, 'drawio', { diagramId: 'g' });
    const { edges, abs } = rebuild(r.output, 'g');
    const pay = abs.get('g:pay');
    const loop = edges.find((e) => e.id === 'g:t2');
    expect(num(loop.style, 'exitY')).toBe(0);
    expect(loop.path[1].y).toBeCloseTo(pay.y - 30, 1);
    // The loop and its label stay inside the composite, below its header.
    const grp = abs.get('g:grp');
    expect(loop.labelBox.y).toBeGreaterThanOrEqual(grp.y + 30);
  });

  it('a flowchart self-edge follows the same rule', async () => {
    const ir = { schemaVersion: 1, kind: 'flowchart', title: 'Poll', direction: 'LR', nodes: [{ id: 'a', label: 'Start', shape: 'terminal' }, { id: 'b', label: 'Poll the queue' }, { id: 'c', label: 'Done', shape: 'terminal' }], edges: [{ id: 'e1', from: 'a', to: 'b' }, { id: 'e2', from: 'b', to: 'b', label: 'queue empty' }, { id: 'e3', from: 'b', to: 'c', label: 'message' }] };
    const r = await emit(ir, 'drawio', { diagramId: 'g' });
    const { edges, abs } = rebuild(r.output, 'g');
    const b = abs.get('g:b');
    const loop = edges.find((e) => e.id === 'g:e2');
    expect(num(loop.style, 'exitY')).toBe(0);
    expect(num(loop.style, 'entryY')).toBe(0);
    // The node is as wide as it is without the self-edge: the room for the loop is above it.
    const plain = rebuild((await emit({ ...ir, edges: ir.edges.filter((e) => e.id !== 'e2') }, 'drawio', { diagramId: 'g' })).output, 'g').abs.get('g:b');
    expect(b.width).toBe(plain.width);
    expect(loop.labelBox.y + loop.labelBox.height).toBeLessThanOrEqual(b.y - 30);
  });

  it('a top-down layout keeps the loop on the right side, where no other transition ends', async () => {
    const r = await emit({ ...lr, direction: 'TB' }, 'drawio', { diagramId: 'g' });
    const { edges, abs } = rebuild(r.output, 'g');
    const pay = abs.get('g:pay');
    const loop = edges.find((e) => e.id === 'g:t2');
    expect(num(loop.style, 'exitX')).toBe(1);
    expect(num(loop.style, 'entryX')).toBe(1);
    for (const e of edges) {
      if (e === loop) continue;
      for (const [id, at] of [[e.source, e.path[0]], [e.target, e.path.at(-1)]]) if (id === 'g:pay') expect(at.x, e.id).toBeLessThan(pay.x + pay.width - 1);
    }
  });
});

describe('issue 26: labels stay on their own edge', () => {
  it('issue 30: self-transition labels start 4 px from the loop, long or short', async () => {
    const r = await emit(loadFixture('state', 'valid-self-loop'), 'drawio', { diagramId: 'g' });
    const { edges } = rebuild(r.output, 'g');
    for (const id of ['g:t2', 'g:t4']) {
      const e = edges.find((x) => x.id === id);
      const label = r.output.match(new RegExp(`<mxCell id="${id}:label"[^>]*style="([^"]*)"[\\s\\S]*?<mxPoint x="(-?[\\d.]+)"`));
      expect(label[1]).toMatch(/align=(left|right)/);
      expect(Math.abs(Number(label[2]))).toBe(4);
      expect(distToPath(e.labelBox, e.path)).toBeLessThanOrEqual(6);
    }
  });

  for (const [kind, name] of [['state', 'valid-order-lifecycle'], ['class', 'valid-order-domain']]) {
    it(`${kind}/${name}: each label is within 6 px of its edge and nearer to it than to any other`, async () => {
      const r = await emit(loadFixture(kind, name), 'drawio', { diagramId: 'g' });
      const { edges } = rebuild(r.output, 'g');
      for (const e of edges) {
        if (!e.labelBox) continue;
        const own = distToPath(e.labelBox, e.path);
        expect(own, `${e.id} label distance`).toBeLessThanOrEqual(6);
        for (const o of edges) if (o !== e) expect(distToPath(e.labelBox, o.path), `${e.id} label vs ${o.id}`).toBeGreaterThanOrEqual(own);
      }
    });
  }
});

describe('issue 27: ER anchors do not add crossings or stack markers', () => {
  it('renders the customers and orders repro with no crossings, spaced end points and key-row anchors only', async () => {
    const ir = loadFixture('er', 'valid-customers-orders');
    const r = await emit(ir, 'drawio', { diagramId: 'er' });
    expect(r.ok).toBe(true);
    const { edges, abs } = rebuild(r.output, 'er');
    expect(crossings(edges.filter((e) => e.source !== e.target))).toBe(0);
    // End points on one entity side are at least 20 px apart.
    const ends = [];
    for (const e of edges) {
      if (e.source === e.target) continue;
      ends.push({ id: e.source, x: e.path[0].x, y: e.path[0].y });
      ends.push({ id: e.target, x: e.path.at(-1).x, y: e.path.at(-1).y });
    }
    for (const a of ends) for (const b of ends) if (a !== b && a.id === b.id && Math.abs(a.x - b.x) < 0.5) expect(Math.abs(a.y - b.y), `${a.id}`).toBeGreaterThanOrEqual(19.5);
    // Every end sits in the header band or on a key row, never on a plain attribute.
    const rowsOf = (entityId) => ir.entities.find((e) => e.id === entityId).attributes;
    for (const end of ends) {
      const box = abs.get(end.id);
      const header = num(r.output.match(new RegExp(`<mxCell id="${end.id}"[^>]*style="([^"]*)"`))[1], 'startSize');
      const y = end.y - box.y;
      if (y <= header + 0.5) continue;
      const rowIndex = Math.floor((y - header) / 26);
      expect(rowsOf(end.id.slice(3))[rowIndex]?.key, `${end.id} row ${rowIndex}`).toBeDefined();
    }
    // The self-relation leaves from its own FK row and comes back to the header.
    const refers = edges.find((e) => e.id === 'er:r5');
    const customer = abs.get('er:customer');
    expect(refers.path[0].y - customer.y).toBeGreaterThan(num(r.output.match(/<mxCell id="er:customer"[^>]*style="([^"]*)"/)[1], 'startSize') + 2 * 26);
    expect(refers.path.at(-1).y - customer.y).toBeLessThan(num(r.output.match(/<mxCell id="er:customer"[^>]*style="([^"]*)"/)[1], 'startSize'));
  });
});

describe('issue 28: Mermaid architecture grid plan', () => {
  it('keeps a fan-in on the grid, falls back for a triangle and for the shop platform', async () => {
    const fan = planArchitectureGrid(loadFixture('architecture', 'valid-fan-in'));
    expect(fan.fallback).toMatch(/diagonal/);
    const plain = { schemaVersion: 1, kind: 'architecture', title: 'Grid', direction: 'LR', components: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }, { id: 'd', label: 'D' }, { id: 'e', label: 'E' }], boundaries: [], connections: [{ id: 'c1', from: 'a', to: 'b' }, { id: 'c2', from: 'b', to: 'c' }, { id: 'c3', from: 'a', to: 'd' }, { id: 'c4', from: 'd', to: 'e' }] };
    const chain = planArchitectureGrid(plain);
    expect(chain.fallback).toBeUndefined();
    const claims = [...chain.sides].flatMap(([id, [f, t]]) => { const c = plain.connections.find((x) => x.id === id); return [`${c.from}:${f}`, `${c.to}:${t}`]; });
    expect(new Set(claims).size).toBe(claims.length);
    const shop = await emit(loadFixture('architecture', 'valid-shop-platform'), 'mermaid');
    expect(shop.ok).toBe(true);
    expect(shop.output).toContain('flowchart LR');
    expect(shop.warnings.some((w) => w.message.startsWith('layout: architecture-beta cannot place'))).toBe(true);
    expect(shop.warnings.some((w) => w.stage === 'feature-matrix')).toBe(false);
    // issue 29: two-way connections keep both arrowheads in the fallback, with and without a label.
    const bidi = await emit(loadFixture('architecture', 'valid-bidi-fallback'), 'mermaid');
    expect(bidi.output).toContain('flowchart LR');
    expect(bidi.output).toMatch(/n5 <--> n6$/m);
    expect(bidi.output).toMatch(/n3 <-->\|"warm"\| n6$/m);
    expect(bidi.output).not.toContain('both ways');
    expect(bidi.warnings.filter((w) => w.stage === 'feature-matrix')).toEqual([]);
    expect(bidi.warnings.filter((w) => w.message.includes('cannot place'))).toHaveLength(1);
    const r = await emit(plain, 'mermaid');
    expect(r.output).toContain('architecture-beta');
  });

  it.skipIf(!loadPlaywright(scriptsDir))('renders the triangle and the shop platform within the review cap', async () => {
    const { preview } = await import('../src/preview.mjs');
    const { mkdtempSync, writeFileSync, readFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'zukai-arch-'));
    for (const name of ['valid-fan-in', 'valid-shop-platform']) {
      const r = await emit(loadFixture('architecture', name), 'mermaid');
      const file = join(dir, `${name}.mmd`);
      writeFileSync(file, r.output);
      const p = await preview(file, { out: join(dir, `${name}.png`), maxPx: 1600 });
      expect(p.ok, name).toBe(true);
      for (const f of p.files) {
        const head = readFileSync(f).subarray(16, 24);
        const width = head.readUInt32BE(0); const height = head.readUInt32BE(4);
        expect(Math.max(width, height), name).toBeLessThanOrEqual(1600);
      }
    }
  }, 120_000);
});
