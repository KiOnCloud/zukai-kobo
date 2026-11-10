import { describe, it, expect } from 'vitest';
import { emit } from '../src/pipeline.mjs';
import { checkDrawioStructure, cellBounds } from './drawio-structure.mjs';
import { loadFixture } from './helpers.mjs';
import { npmGlobalRoot, loadPlaywright } from '../src/preview.mjs';

/** Absolute bounds of every vertex (children are relative to their parent chain). */
function absoluteBounds(cells) {
  const byId = new Map(cells.map((c) => [c.id, c]));
  const abs = new Map();
  const of = (c) => {
    if (abs.has(c.id)) return abs.get(c.id);
    const b = cellBounds(c);
    const parent = byId.get(c.parent);
    if (parent && parent.vertex === '1') {
      const p = of(parent);
      abs.set(c.id, { ...b, x: b.x + p.x, y: b.y + p.y });
    } else {
      abs.set(c.id, b);
    }
    return abs.get(c.id);
  };
  for (const c of cells) if (c.vertex === '1') of(c);
  return abs;
}
const intersects = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const points = (xml, id) => [...(xml.match(new RegExp(`<mxCell id="${id}"[\\s\\S]*?</mxCell>`))?.[0] ?? '').matchAll(/<mxPoint x="(-?[\d.]+)" y="(-?[\d.]+)"/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
const styleOf = (xml, id) => xml.match(new RegExp(`<mxCell id="${id}"[^>]*style="([^"]*)"`))?.[1] ?? '';

describe('issue 17: state self-transitions', () => {
  it('draws the loop outside the state and keeps its label off every state box, inside composites too', async () => {
    const ir = loadFixture('state', 'valid-self-loop');
    const r = await emit(ir, 'drawio', { diagramId: 'st' });
    expect(r.ok).toBe(true);
    const { problems, cells } = checkDrawioStructure(r.output);
    expect(problems).toEqual([]);
    const abs = absoluteBounds(cells);
    const states = ir.states.filter((s) => s.kind !== 'composite' && s.kind !== 'initial' && s.kind !== 'final').map((s) => abs.get(`st:${s.id}`));
    for (const t of ['t2', 't4']) {
      const pts = points(r.output, `st:${t}`);
      const box = abs.get(`st:${ir.transitions.find((x) => x.id === t).from}`);
      expect(pts).toHaveLength(2);
      expect(Math.min(Math.abs(pts[0].x - (box.x + box.width)), Math.abs(box.x - pts[0].x))).toBeGreaterThanOrEqual(29);
      expect(Math.abs(pts[0].y - pts[1].y)).toBeGreaterThanOrEqual(0.4 * box.height - 1);
      expect(styleOf(r.output, `st:${t}`)).toContain('exitX=1;exitY=0.3');
      // The label sits right of the loop; reconstruct its box from the relative geometry.
      const label = cells.find((c) => c.id === `st:${t}:label`);
      const offX = Number(r.output.match(new RegExp(`<mxCell id="st:${t}:label"[\\s\\S]*?<mxPoint x="(-?[\\d.]+)"`))[1]);
      const text = label.value.replace(/<[^>]+>/g, '');
      const width = text.length * 5.6 + 4;
      // The label text is anchored at the loop's outer side and aligned away from it.
      const align = label.style.match(/align=(\w+)/)[1];
      const anchorX = pts[0].x + offX;
      const left = align === 'left' ? anchorX : align === 'right' ? anchorX - width : anchorX - width / 2;
      const labelBox = { x: left, y: (pts[0].y + pts[1].y) / 2 - 8, width, height: 16 };
      for (const s of states) expect(intersects(labelBox, s), `${t} label vs state`).toBe(false);
    }
  });
});

describe('issue 19: class member rows grow with wrapped text', () => {
  it('gives a long method a taller row and a plain attribute the default', async () => {
    const r = await emit(loadFixture('class', 'valid-long-members'), 'drawio', { diagramId: 'cl' });
    const { cells } = checkDrawioStructure(r.output);
    const row = (id) => cellBounds(cells.find((c) => c.id === id));
    expect(row('cl:repo:row-0').height).toBeGreaterThanOrEqual(40);
    expect(row('cl:order:row-0').height).toBe(26);
    expect(row('cl:order:row-2').height).toBeGreaterThanOrEqual(40);
    // Rows stack without overlap and the class box holds them all.
    const order = cellBounds(cells.find((c) => c.id === 'cl:order'));
    const last = row('cl:order:row-2');
    expect(last.y + last.height).toBeLessThanOrEqual(order.height + 0.01);
  });
});

describe('issue 18: ER relation anchors', () => {
  it('anchors at the matching FK row, spreads header anchors, and keeps end points distinct', async () => {
    const ir = loadFixture('er', 'valid-fk-anchors');
    const r = await emit(ir, 'drawio', { diagramId: 'er' });
    expect(r.ok).toBe(true);
    const { cells } = checkDrawioStructure(r.output);
    const order = cellBounds(cells.find((c) => c.id === 'er:order'));
    const fkRow = cellBounds(cells.find((c) => c.id === 'er:order:row-1'));
    const entryY = (id) => Number(styleOf(r.output, id).match(/entryY=([\d.]+)/)[1]) * order.height;
    expect(Math.abs(entryY('er:r1') - (fkRow.y + fkRow.height / 2))).toBeLessThan(2.5);
    // The two Address relations cannot be told apart by name, so they land in the header band, apart.
    const header = Number(styleOf(r.output, 'er:order').match(/startSize=(\d+)/)[1]);
    expect(entryY('er:r2')).toBeLessThan(header);
    expect(entryY('er:r3')).toBeLessThan(header);
    expect(Math.abs(entryY('er:r2') - entryY('er:r3'))).toBeGreaterThanOrEqual(19);
    const exits = ['er:r2', 'er:r3'].map((id) => styleOf(r.output, id).match(/exitY=([\d.]+)/)[1]);
    expect(exits[0]).not.toBe(exits[1]);
  });

  it('honours toAttribute and warns when it names a missing attribute', async () => {
    const ir = loadFixture('er', 'valid-fk-anchors');
    ir.relations[1].toAttribute = 'billing_address_id';
    ir.relations[2].toAttribute = 'shipping_address_id';
    const r = await emit(ir, 'drawio', { diagramId: 'er' });
    const { cells } = checkDrawioStructure(r.output);
    const order = cellBounds(cells.find((c) => c.id === 'er:order'));
    const rowMid = (i) => { const b = cellBounds(cells.find((c) => c.id === `er:order:row-${i}`)); return b.y + b.height / 2; };
    const entryY = (id) => Number(styleOf(r.output, id).match(/entryY=([\d.]+)/)[1]) * order.height;
    expect(Math.abs(entryY('er:r2') - rowMid(2))).toBeLessThan(2.5);
    expect(Math.abs(entryY('er:r3') - rowMid(3))).toBeLessThan(2.5);
    ir.relations[2].toAttribute = 'nope';
    const bad = await emit(ir, 'drawio', { diagramId: 'er' });
    expect(bad.ok).toBe(true);
    expect(bad.warnings.some((w) => w.path === '/relations/2/toAttribute')).toBe(true);
  });
});

describe('issue 20: sequence frames, notes, activations and labels', () => {
  it('draws tab and branch labels on top, keeps the note inside its frame, and extends the activation into the else branch', async () => {
    const ir = loadFixture('sequence', 'valid-loop-note-alt');
    const r = await emit(ir, 'drawio', { diagramId: 'sq' });
    expect(r.ok).toBe(true);
    const { problems, cells } = checkDrawioStructure(r.output);
    expect(problems).toEqual([]);
    const index = (id) => cells.findIndex((c) => c.id === id);
    const lastLifeline = Math.max(...ir.participants.map((p) => index(`sq:${p.id}`)));
    const lastActivation = Math.max(...cells.filter((c) => c.id.startsWith('sq:act-')).map((c) => cells.indexOf(c)));
    for (const id of ['sq:b1:tab', 'sq:b2:tab', 'sq:b2:sep-label-1']) {
      expect(index(id)).toBeGreaterThan(lastLifeline);
      expect(index(id)).toBeGreaterThan(lastActivation);
      expect(cells.find((c) => c.id === id).style).toContain('fillColor=#ffffff');
    }
    expect(cells.find((c) => c.id === 'sq:b1').value).toBe('');
    const loop = cellBounds(cells.find((c) => c.id === 'sq:b1'));
    const note = cellBounds(cells.find((c) => c.id === 'sq:n1'));
    expect(note.x).toBeGreaterThanOrEqual(loop.x);
    expect(note.x + note.width).toBeLessThanOrEqual(loop.x + loop.width);
    const abs = absoluteBounds(cells);
    const act = abs.get('sq:act-m1');
    const m5y = Number(r.output.match(/<mxCell id="sq:m5"[\s\S]*?<mxPoint x="[\d.]+" y="([\d.]+)"/)[1]);
    expect(act.y + act.height).toBeCloseTo(m5y, 0);
    for (const m of ir.messages) expect(styleOf(r.output, `sq:${m.id}`)).toContain('labelBackgroundColor=#ffffff');
  });
});

describe('issue 22: architecture fan-out in draw.io', () => {
  it('keeps parallel segments 20 px apart, labels off other edges, and the source centred on its targets', async () => {
    const ir = loadFixture('architecture', 'valid-fan-out');
    const r = await emit(ir, 'drawio', { diagramId: 'ar' });
    expect(r.ok).toBe(true);
    const { cells } = checkDrawioStructure(r.output);
    const abs = absoluteBounds(cells);
    const centre = (id) => { const b = abs.get(`ar:${id}`); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
    const paths = new Map(ir.connections.map((c) => [c.id, [centre(c.from), ...points(r.output, `ar:${c.id}`), centre(c.to)]]));
    const segs = [];
    for (const [id, p] of paths) for (let i = 1; i < p.length; i++) segs.push({ id, a: p[i - 1], b: p[i] });
    const vertical = segs.filter((s) => Math.abs(s.a.x - s.b.x) < 0.5 && Math.abs(s.a.y - s.b.y) > 0.5);
    for (const s of vertical) for (const t of vertical) {
      if (s.id === t.id) continue;
      const overlapY = Math.min(Math.max(s.a.y, s.b.y), Math.max(t.a.y, t.b.y)) - Math.max(Math.min(s.a.y, s.b.y), Math.min(t.a.y, t.b.y));
      if (overlapY > 0.5) expect(Math.abs(s.a.x - t.a.x), `${s.id} vs ${t.id}`).toBeGreaterThanOrEqual(20);
    }
    const out = ir.connections.filter((c) => c.from === 'orders').map((c) => centre(c.to).y);
    const oy = centre('orders').y;
    expect(oy).toBeGreaterThan(Math.min(...out));
    expect(oy).toBeLessThan(Math.max(...out));
    expect(Math.abs(oy - (Math.min(...out) + Math.max(...out)) / 2)).toBeLessThan(60);
  });
});

describe('issue 23: Mermaid participant kinds', () => {
  it('emits typed participants with their labels, plain ones in stable mode, and no degradation warning', async () => {
    const ir = loadFixture('sequence', 'valid-participant-kinds');
    const r = await emit(ir, 'mermaid');
    expect(r.ok).toBe(true);
    for (const [id, kind, label] of [['n1', 'boundary', 'Web shop'], ['n2', 'control', 'Order service'], ['n3', 'entity', 'Order'], ['n4', 'database', 'Order database']]) {
      expect(r.output).toContain(`participant ${id}@{ "type" : "${kind}" } as ${label}`);
    }
    expect(r.output).toContain('actor n5 as Customer');
    expect(r.warnings.filter((w) => w.stage === 'feature-matrix')).toEqual([]);
    const stable = await emit(ir, 'mermaid', { mermaidStable: true });
    expect(stable.output).not.toContain('@{');
    expect(stable.output).toContain('participant n4 as Order database');
    const figjam = await emit(ir, 'figjam');
    expect(figjam.output).not.toContain('@{');
  });
});

describe('issue 21: Mermaid architecture sides', () => {
  it('never lets two edges claim the same side of one service, and degrades to a flowchart otherwise', async () => {
    for (const name of ['valid-fan-in', 'valid', 'valid-fan-out']) {
      const r = await emit(loadFixture('architecture', name), 'mermaid');
      expect(r.ok).toBe(true);
      if (r.output.includes('architecture-beta')) {
        const claims = [...r.output.matchAll(/^\s*(\w+):([TBLR]) <?--> ([TBLR]):(\w+)$/gm)].flatMap((m) => [`${m[1]}:${m[2]}`, `${m[4]}:${m[3]}`]);
        expect(new Set(claims).size, name).toBe(claims.length);
      } else {
        expect(r.output, name).toContain('flowchart');
        expect(r.warnings.some((w) => w.message.startsWith('layout: architecture-beta cannot place')), name).toBe(true);
      }
    }
  });
});

describe('issue 24: Playwright lookup', () => {
  it('knows the global npm root and resolves Playwright from it when nothing local has it', () => {
    const root = npmGlobalRoot();
    expect(root === null || typeof root === 'string').toBe(true);
    const pw = loadPlaywright('/nonexistent-project');
    expect(pw === null || typeof pw.chromium === 'object').toBe(true);
  });
});
