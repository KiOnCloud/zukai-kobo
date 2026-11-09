import { describe, it, expect, beforeAll } from 'vitest';
import { emit } from '../src/pipeline.mjs';
import { validateIr } from '../src/validate-ir.mjs';
import { checkDrawioStructure, cellBounds } from './drawio-structure.mjs';
import { layoutActivity } from '../src/layout-activity.mjs';
import { measureNode } from '../src/layout-graph.mjs';
import { loadFixture, loadMermaid } from './helpers.mjs';

describe('activity kind', () => {
  it('rejects an action without a lane, an unknown lane, a bad control kind and bad flows together', () => {
    const r = validateIr(loadFixture('activity', 'invalid-action-without-lane'));
    expect(r.ok).toBe(false);
    expect(r.errors.map((e) => e.path)).toEqual(expect.arrayContaining(['/actions/0', '/actions/1/lane', '/controls/2/kind', '/flows/0/from', '/flows/1/to']));
  });

  describe('mermaid', () => {
    let mermaid;
    beforeAll(async () => {
      mermaid = await loadMermaid();
    }, 30_000);

    it('emits swimlane-beta by default with the beta warning and parses', async () => {
      const r = await emit(loadFixture('activity', 'valid-fork-join'), 'mermaid');
      expect(r.ok).toBe(true);
      expect(r.output).toContain('swimlane-beta TB');
      expect(r.output).toContain('@{ shape: fork }');
      expect(r.output).toContain('@{ shape: join }');
      expect(r.output).toContain('@{ shape: sm-circ }');
      expect(r.output).toContain('@{ shape: fr-circ }');
      expect(r.output).toContain('-->|"yes"|');
      expect(r.warnings.map((w) => w.feature ?? w.stage)).toEqual(['kind']);
      expect(r.warnings[0].message).toContain('swimlane-beta');
      expect((await mermaid.parse(r.output)).diagramType).toBe('swimlane');
      await expect(r.output).toMatchFileSnapshot('snapshots/mermaid/activity-valid-fork-join.mmd');
    });

    it('emits a stable flowchart with --mermaid-stable, warns about what was lost, and parses', async () => {
      const r = await emit(loadFixture('activity', 'valid-fork-join'), 'mermaid', { mermaidStable: true });
      expect(r.ok).toBe(true);
      expect(r.output).toContain('flowchart TB');
      expect(r.output).not.toContain('swimlane');
      expect(r.output).toContain('[["fork"]]');
      expect(r.output).toContain('((("end")))');
      expect(r.warnings.map((w) => w.stage)).toEqual(['feature-matrix', 'emit']);
      expect(r.warnings[1].message).toContain('stable flowchart form');
      expect((await mermaid.parse(r.output)).diagramType).toBe('flowchart-v2');
      await expect(r.output).toMatchFileSnapshot('snapshots/mermaid/activity-valid-fork-join-stable.mmd');
    });
  });

  it('is unsupported on figjam with a hint to use draw.io', async () => {
    const r = await emit(loadFixture('activity', 'valid-two-lanes'), 'figjam');
    expect(r.ok).toBe(false);
    expect(r.errors[0].message).toContain('"activity"');
    expect(r.errors[0].message).toContain('drawio');
  });

  describe('drawio', () => {
    it('renders lanes as swimlane containers with every action inside its lane and bars for fork and join', async () => {
      const ir = loadFixture('activity', 'valid-fork-join');
      const r = await emit(ir, 'drawio');
      expect(r.ok).toBe(true);
      // The only warning is the crossing that the lanes force (the "no" branch must cross the warehouse lane).
      expect(r.warnings.map((w) => w.message)).toEqual([expect.stringMatching(/^layout: flows "f10" and "f9" cross/)]);
      const { problems, cells } = checkDrawioStructure(r.output);
      expect(problems).toEqual([]);
      const byId = new Map(cells.map((c) => [c.id, c]));
      for (const lane of ir.lanes) {
        const cell = byId.get(`order-fulfilment:${lane.id}`);
        expect(cell.style.startsWith('swimlane;')).toBe(true);
        expect(cell.parent).toBe('1');
      }
      for (const a of ir.actions) {
        const cell = byId.get(`order-fulfilment:${a.id}`);
        expect(cell.parent).toBe(`order-fulfilment:${a.lane}`);
        const b = cellBounds(cell);
        const lane = cellBounds(byId.get(cell.parent));
        expect(b.x).toBeGreaterThanOrEqual(0);
        expect(b.y).toBeGreaterThanOrEqual(30);
        expect(b.x + b.width).toBeLessThanOrEqual(lane.width + 0.01);
        expect(b.y + b.height).toBeLessThanOrEqual(lane.height + 0.01);
      }
      const laneBoxes = ir.lanes.map((lane) => cellBounds(byId.get(`order-fulfilment:${lane.id}`)));
      for (const b of laneBoxes) {
        expect(b.y).toBe(laneBoxes[0].y);
        expect(b.height).toBe(laneBoxes[0].height);
      }
      for (let i = 1; i < laneBoxes.length; i++) expect(laneBoxes[i].x).toBeCloseTo(laneBoxes[i - 1].x + laneBoxes[i - 1].width, 5);
      const rowOf = (id) => cellBounds(byId.get(`order-fulfilment:${id}`)).y + cellBounds(byId.get(byId.get(`order-fulfilment:${id}`).parent)).y;
      expect(rowOf('receive')).toBeLessThan(rowOf('pick'));
      expect(rowOf('pick')).toBeLessThan(rowOf('pack'));
      expect(rowOf('paid')).toBeLessThan(rowOf('sync'));
      expect(byId.get('order-fulfilment:split').style).toContain('fillColor=#000000');
      expect(cellBounds(byId.get('order-fulfilment:split')).height).toBe(8);
      expect(byId.get('order-fulfilment:paid').style.startsWith('rhombus')).toBe(true);
    });

    it('keeps guard labels apart when several guarded flows enter one node', async () => {
      const r = await emit(loadFixture('activity', 'valid-guard-collision'), 'drawio');
      expect(r.ok).toBe(true);
      expect(r.warnings.filter((w) => String(w.message).startsWith('layout:'))).toEqual([]);
      const { cells } = checkDrawioStructure(r.output);
      const labels = cells.filter((c) => c.id.endsWith(':label'));
      expect(labels).toHaveLength(6);
      const offsets = new Set(labels.map((l) => `${l.parent}|${l.mxGeometry.x}|${l.mxGeometry.mxPoint[0].x}`));
      expect(offsets.size).toBe(6);
    });

    it('warns about a merge with one incoming flow and a decision with one branch', async () => {
      const ir = loadFixture('activity', 'valid-two-lanes');
      ir.controls.push({ id: 'lonely', kind: 'merge', lane: 'customer' });
      ir.flows = ir.flows.filter((f) => f.id !== 'f5');
      ir.flows.push({ id: 'f9', from: 'ship', to: 'lonely' }, { id: 'f10', from: 'lonely', to: 'done' });
      ir.flows = ir.flows.filter((f) => f.id !== 'f7');
      const r = await emit(ir, 'drawio');
      expect(r.ok).toBe(true);
      expect(r.warnings.map((w) => w.message)).toEqual(expect.arrayContaining([
        expect.stringContaining('merge "lonely" has 1 incoming flow'),
        expect.stringContaining('decision "eligible" has 1 outgoing flow'),
      ]));
    });

    it('attaches flows that share a node at its centre so branches share one trunk', async () => {
      const r = await emit(loadFixture('activity', 'valid-guard-collision'), 'drawio');
      const { cells } = checkDrawioStructure(r.output);
      const intoRetry = cells.filter((c) => c.edge === '1' && c.target === 'corporate-login:retry');
      expect(intoRetry).toHaveLength(2);
      for (const c of intoRetry) expect(c.style).toContain('entryX=0.5;entryY=0;');
      const outOfDecision = cells.filter((c) => c.edge === '1' && c.source === 'corporate-login:has-token');
      for (const c of outOfDecision) expect(c.style).toContain('exitX=0.5;exitY=1;');
    });

    const helpers = () => {
      const sizesOf = (ir) => [...ir.actions.map((a) => ({ id: a.id, lane: a.lane, width: 140, height: 40 })), ...ir.controls.map((c) => ({ id: c.id, lane: c.lane, width: c.kind === 'decision' ? 140 : 40, height: c.kind === 'decision' ? 80 : 40 }))];
      const segmentsOf = (ir) => {
        const L = layoutActivity(ir, sizesOf(ir));
        const out = [];
        for (const f of ir.flows) {
          const s = L.nodes.get(f.from);
          const t = L.nodes.get(f.to);
          const e = L.edges.get(f.id);
          const path = [{ x: s.x + e.exit.x * s.width, y: s.y + e.exit.y * s.height }, ...e.points, { x: t.x + e.entry.x * t.width, y: t.y + e.entry.y * t.height }];
          for (let i = 1; i < path.length; i++) out.push({ id: f.id, from: f.from, to: f.to, a: path[i - 1], b: path[i] });
        }
        return { L, segments: out };
      };
      const crossings = (segments) => {
        let n = 0;
        for (const h of segments) {
          if (Math.abs(h.a.y - h.b.y) > 0.5) continue;
          for (const v of segments) {
            if (v.id === h.id || Math.abs(v.a.x - v.b.x) > 0.5) continue;
            const x = v.a.x;
            const y = h.a.y;
            if (x > Math.min(h.a.x, h.b.x) + 0.5 && x < Math.max(h.a.x, h.b.x) - 0.5 && y > Math.min(v.a.y, v.b.y) + 0.5 && y < Math.max(v.a.y, v.b.y) - 0.5) n++;
          }
        }
        return n;
      };
      return { sizesOf, segmentsOf, crossings };
    };

    describe('issue 1: misleading routing', () => {
      const { segmentsOf, crossings } = helpers();

      it('keeps an early exit off the merge band of the other branches', async () => {
        const ir = loadFixture('activity', 'valid-routing-wide');
        const r = await emit(ir, 'drawio');
        expect(r.warnings.filter((w) => String(w.message).startsWith('layout:'))).toEqual([]);
        const { L } = segmentsOf(ir);
        // The early exit drops straight into its own final node, outside the merge band.
        const fe = L.edges.get('fe');
        const cx = (id) => L.nodes.get(id).x + L.nodes.get(id).width / 2;
        expect(fe.points).toEqual([]);
        const band = ['fo0', 'fo1', 'fo2', 'fo3'].flatMap((id) => L.edges.get(id).points.map((p) => p.x));
        expect(cx('a-400') < Math.min(...band) || cx('a-400') > Math.max(...band)).toBe(true);
      });

      it('merges a skip branch into the trunk of its target from the top, with its own guard above its run', async () => {
        const ir = loadFixture('activity', 'valid-routing-wide');
        const { L } = segmentsOf(ir);
        expect(L.edges.get('fn').entry).toEqual({ x: 0.5, y: 0 });
        expect(L.edges.get('fd').entry).toEqual({ x: 0.5, y: 0 });
        expect(L.edges.get('fn').label.offset.y).toBeLessThan(0);
      });

      it('does not cross edges whatever the declaration order', async () => {
        for (const name of ['valid-order-a', 'valid-order-b']) {
          const ir = loadFixture('activity', name);
          const { segments } = segmentsOf(ir);
          expect(crossings(segments), name).toBe(0);
          const r = await emit(ir, 'drawio');
          expect(r.warnings.filter((w) => String(w.message).startsWith('layout:')), name).toEqual([]);
        }
      });

      it('warns when two flows to different targets would share a line', () => {
        const ir = loadFixture('activity', 'valid-order-a');
        const { L } = segmentsOf(ir);
        expect(L.warnings.filter((w) => w.message.includes('same line'))).toEqual([]);
      });
    });

    describe('issue 5: fan-outs and early exits do not cross', () => {
      const { sizesOf, segmentsOf, crossings } = helpers();

      it('has no crossing in a right-going fan-out, an early exit next to a merge, and every other fixture', async () => {
        for (const name of ['valid-fanout-right', 'valid-routing-wide', 'valid-order-a', 'valid-order-b', 'valid-two-lanes', 'valid-guard-collision', 'valid-guard-straight', 'valid-sync-async']) {
          const ir = loadFixture('activity', name);
          const { segments, L } = segmentsOf(ir);
          expect(crossings(segments), name).toBe(0);
          expect(L.warnings.filter((w) => w.message.includes('cross')), name).toEqual([]);
        }
      });

      it('puts the farthest branch of a fan-out on the track nearest the decision, on both sides', () => {
        const ir = loadFixture('activity', 'valid-fanout-right');
        const { L } = segmentsOf(ir);
        const trackY = (id) => L.edges.get(id).points[0].y;
        const cx = (id) => L.nodes.get(id).x + L.nodes.get(id).width / 2;
        const right = ['fi0', 'fi1', 'fi2'].filter((id) => cx(ir.flows.find((f) => f.id === id).to) > cx('d-type')).sort((a, b) => cx(ir.flows.find((f) => f.id === b).to) - cx(ir.flows.find((f) => f.id === a).to));
        for (let i = 1; i < right.length; i++) expect(trackY(right[i - 1])).toBeLessThan(trackY(right[i]));
      });

      it('places the final node of an early exit under its own branch', () => {
        const ir = loadFixture('activity', 'valid-fanout-right');
        const { L } = segmentsOf(ir);
        const cx = (id) => L.nodes.get(id).x + L.nodes.get(id).width / 2;
        expect(cx('end-400')).toBeCloseTo(cx('a-400'), 5);
        expect(L.edges.get('fe').points).toEqual([]);
      });

      it('issue 16: a long flow with a free column goes straight down it, whatever the order of flows or nodes', () => {
        const base = loadFixture('activity', 'valid-sync-async');
        const swap = (arr, a, b) => { const i = arr.findIndex((x) => x.id === a); const j = arr.findIndex((x) => x.id === b); const out = arr.slice(); [out[i], out[j]] = [out[j], out[i]]; return out; };
        const variants = [
          base,
          { ...base, flows: swap(base.flows, 'f-async', 'f-sync') },
          { ...base, flows: swap(base.flows, 'f-job', 'f-call') },
        ];
        // Node order is a layout input: declared first, "Build the report now" sits left, under
        // the fork's branches, and its column is no longer free. That variant may keep one
        // crossing, but never more, and still raises no exception.
        const swappedNodes = { ...base, actions: swap(base.actions, 'a-queue', 'a-call') };
        expect(crossings(segmentsOf(swappedNodes).segments)).toBeLessThanOrEqual(1);
        variants.forEach((ir, i) => {
          const { L, segments } = segmentsOf(ir);
          expect(crossings(segments), `variant ${i}`).toBe(0);
          expect(L.warnings.filter((w) => w.message.startsWith('layout:')), `variant ${i}`).toEqual([]);
          // f-call keeps its own column down to the gap above its target and joins f-job's track there.
          const call = L.edges.get('f-call');
          const sx = L.nodes.get('a-call').x + L.nodes.get('a-call').width / 2;
          expect(call.points.length, `variant ${i}`).toBe(2);
          expect(call.points[0].x, `variant ${i}`).toBeCloseTo(sx, 5);
          expect(call.points[0].y, `variant ${i}`).toBeCloseTo(L.edges.get('f-job').points[0].y, 5);
        });
      });

      it('reports a crossing that lanes force', () => {
        const ir = loadFixture('activity', 'valid-fork-join');
        const { L, segments } = segmentsOf(ir);
        expect(crossings(segments)).toBe(1);
        const w = L.warnings.filter((x) => x.message.includes('cross'));
        expect(w).toHaveLength(1);
        expect(w[0].message).toMatch(/^layout: flows "f10" and "f9" cross/);
      });

      it('routes a long edge down the free side of a lane', () => {
        const ir = loadFixture('activity', 'valid-guard-collision');
        const { L } = segmentsOf(ir);
        const userLane = L.lanes[0];
        const back = L.edges.get('f13').points;
        // The loop back to the user lane climbs its left edge, left of every node there.
        expect(back[1].x).toBeLessThan(userLane.x + 30);
        expect(back[1].x).toBeLessThan(Math.min(...[...L.nodes.values()].filter((n) => n.lane === 'user').map((n) => n.x)));
      });

      void sizesOf;
    });

    describe('issue 13: a guard never sits on the trunk shared with sibling branches', () => {
      const { segmentsOf } = helpers();

      it('places the guard of a straight branch below the last split, on every fan-out', () => {
        for (const [name, flowId] of [['valid-fanout-right', 'fi1'], ['valid-fanout-right', 'fy'], ['valid-routing-wide', 'fi1'], ['valid-routing-wide', 'fy']]) {
          const ir = loadFixture('activity', name);
          const { L, segments } = segmentsOf(ir);
          const f = ir.flows.find((x) => x.id === flowId);
          const e = L.edges.get(flowId);
          expect(e.points, `${name}/${flowId} is the straight branch`).toEqual([]);
          const s = L.nodes.get(f.from);
          const t = L.nodes.get(f.to);
          const start = { x: s.x + s.width / 2, y: s.y + s.height };
          const end = { x: t.x + t.width / 2, y: t.y };
          const anchorY = start.y + ((e.label.position + 1) / 2) * (end.y - start.y);
          const box = { top: anchorY + e.label.offset.y - 8, bottom: anchorY + e.label.offset.y + 8 };
          // The trunk ends where the lowest sibling leaves the column.
          const lastSplit = Math.max(...segments.filter((sg) => sg.from === f.from && sg.id !== flowId && Math.abs(sg.a.x - start.x) < 0.5 && Math.abs(sg.a.y - start.y) < 0.5).map((sg) => sg.b.y));
          expect(box.top, `${name}/${flowId} guard below the last split`).toBeGreaterThanOrEqual(lastSplit);
          expect(box.bottom, `${name}/${flowId} guard above its target`).toBeLessThanOrEqual(end.y);
          expect(L.warnings.filter((w) => w.message.includes(`"${flowId}"`))).toEqual([]);
        }
      });
    });

    describe('issue 32 and 33: long labels and the guard of a straight branch', () => {
      const { segmentsOf } = helpers();

      it('32: an action whose label wraps gets a taller box in activity and flowchart output', async () => {
        const act = await emit(loadFixture('activity', 'valid-business-fulfilment'), 'drawio', { diagramId: 'a' });
        const { cells } = checkDrawioStructure(act.output);
        const collect = cellBounds(cells.find((c) => c.id === 'a:collect'));
        expect(collect.width).toBe(260);
        expect(collect.height).toBeGreaterThanOrEqual(100);
        const flow = await emit(loadFixture('flowchart', 'valid-refund-check'), 'drawio', { diagramId: 'f' });
        const a = cellBounds(checkDrawioStructure(flow.output).cells.find((c) => c.id === 'f:a'));
        expect(a.width).toBe(260);
        expect(a.height).toBeGreaterThanOrEqual(100);
      });

      it('33: the guard of a straight branch is 12 px clear of its sibling and nearest to its own edge', () => {
        const ir = loadFixture('activity', 'valid-business-fulfilment');
        // Real sizes, as the emitter computes them, so the label geometry is the shipped one.
        const sizes = [...ir.actions.map((x) => ({ id: x.id, lane: x.lane, ...measureNode(x.label) })), ...ir.controls.map((c) => ({ id: c.id, lane: c.lane, ...(c.kind === 'decision' ? measureNode(c.label ?? 'decision', { minWidth: 140, baseHeight: 80 }) : c.kind === 'merge' ? { width: 40, height: 40 } : { width: 30, height: 30 }) }))];
        const L = layoutActivity(ir, sizes);
        const paths = new Map();
        for (const f of ir.flows) {
          const s = L.nodes.get(f.from); const t = L.nodes.get(f.to); const e = L.edges.get(f.id);
          paths.set(f.id, [{ x: s.x + e.exit.x * s.width, y: s.y + e.exit.y * s.height }, ...e.points, { x: t.x + e.entry.x * t.width, y: t.y + e.entry.y * t.height }]);
        }
        const dist = (box, path) => {
          let best = Infinity;
          for (let i = 1; i < path.length; i++) {
            const a = path[i - 1]; const b = path[i];
            const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
            const cx = box.x + box.width / 2; const cy = box.y + box.height / 2;
            const t = l2 ? Math.max(0, Math.min(1, ((cx - a.x) * (b.x - a.x) + (cy - a.y) * (b.y - a.y)) / l2)) : 0;
            const p = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
            best = Math.min(best, Math.hypot(Math.max(box.x - p.x, 0, p.x - box.x - box.width), Math.max(box.y - p.y, 0, p.y - box.y - box.height)));
          }
          return best;
        };
        const labelBox = (id, guard) => {
          const path = paths.get(id); const e = L.edges.get(id);
          let total = 0; const lens = [];
          for (let i = 1; i < path.length; i++) { const l = Math.abs(path[i].x - path[i - 1].x) + Math.abs(path[i].y - path[i - 1].y); lens.push(l); total += l; }
          let d = ((e.label.position + 1) / 2) * total; let p = path[0];
          for (let i = 1; i < path.length; i++) { if (d <= lens[i - 1] || i === path.length - 1) { const tt = lens[i - 1] ? Math.min(1, d / lens[i - 1]) : 0; p = { x: path[i - 1].x + tt * (path[i].x - path[i - 1].x), y: path[i - 1].y + tt * (path[i].y - path[i - 1].y) }; break; } d -= lens[i - 1]; }
          const w = guard.length * 7 + 12;
          return { x: p.x + e.label.offset.x - w / 2, y: p.y + e.label.offset.y - 8, width: w, height: 16 };
        };
        const yes = labelBox('f4', 'yes');
        expect(dist(yes, paths.get('f5'))).toBeGreaterThanOrEqual(12);
        for (const [id, guard] of [['f4', 'yes'], ['f5', 'no: nothing to ship']]) {
          const box = labelBox(id, guard);
          const own = dist(box, paths.get(id));
          expect(own, `${id} on its own edge`).toBeLessThanOrEqual(6);
          for (const [other, path] of paths) if (other !== id) expect(dist(box, path), `${id} vs ${other}`).toBeGreaterThan(own);
        }
        expect(L.warnings.filter((w) => w.message.startsWith('layout:'))).toEqual([]);
      });
    });

    describe('issue 6: a guard never sits on another flow', () => {
      const { segmentsOf } = helpers();

      it('keeps the guard of a straight branch off the horizontal run of its sibling', () => {
        const ir = loadFixture('activity', 'valid-guard-straight');
        const { L, segments } = segmentsOf(ir);
        expect(L.warnings.filter((w) => w.message.startsWith('layout:'))).toEqual([]);
        const guard = ir.flows.find((f) => f.id === 'f-yes').guard;
        const width = guard.length * 7 + 12;
        const e = L.edges.get('f-yes');
        const s = L.nodes.get('d');
        // Reconstruct the label box from the edge-label geometry: position along a straight
        // vertical path plus the pixel offset.
        const t = L.nodes.get('end-a');
        const start = { x: s.x + s.width / 2, y: s.y + s.height };
        const end = { x: t.x + t.width / 2, y: t.y };
        const along = (e.label.position + 1) / 2;
        const anchor = { x: start.x, y: start.y + along * (end.y - start.y) };
        const box = { x: anchor.x + e.label.offset.x - width / 2, y: anchor.y + e.label.offset.y - 8, width, height: 16 };
        for (const sg of segments.filter((x) => x.id !== 'f-yes')) {
          const line = { x: Math.min(sg.a.x, sg.b.x) - 1, y: Math.min(sg.a.y, sg.b.y) - 1, width: Math.abs(sg.a.x - sg.b.x) + 2, height: Math.abs(sg.a.y - sg.b.y) + 2 };
          const overlap = box.x < line.x + line.width && line.x < box.x + box.width && box.y < line.y + line.height && line.y < box.y + box.height;
          expect(overlap, `guard overlaps ${sg.id}`).toBe(false);
        }
      });
    });

    it('routes cross-lane flows around unrelated actions', async () => {
      const ir = loadFixture('activity', 'valid-fork-join');
      const r = await emit(ir, 'drawio');
      const { cells } = checkDrawioStructure(r.output);
      const byId = new Map(cells.map((c) => [c.id, c]));
      // Absolute bounds of every node (children are relative to their lane).
      const abs = new Map();
      for (const c of cells) {
        if (c.vertex !== '1' || c.parent === '1' && c.style.startsWith('swimlane')) continue;
        if (c.vertex !== '1') continue;
        const b = cellBounds(c);
        const parent = byId.get(c.parent);
        if (parent && parent.vertex === '1') {
          const p = cellBounds(parent);
          abs.set(c.id, { ...b, x: b.x + p.x, y: b.y + p.y });
        } else {
          abs.set(c.id, b);
        }
      }
      let crossings = 0;
      for (const c of cells) {
        if (c.edge !== '1') continue;
        const points = (c.mxGeometry.Array?.mxPoint ?? []).map((p) => ({ x: Number(p.x), y: Number(p.y) }));
        for (let k = 0; k < points.length - 1; k++) {
          const p = points[k];
          const q = points[k + 1];
          for (const [id, b] of abs) {
            if (id === c.source || id === c.target || byId.get(id).style.startsWith('swimlane')) continue;
            const minX = Math.min(p.x, q.x);
            const maxX = Math.max(p.x, q.x);
            const minY = Math.min(p.y, q.y);
            const maxY = Math.max(p.y, q.y);
            if (maxX > b.x + 1 && minX < b.x + b.width - 1 && maxY > b.y + 1 && minY < b.y + b.height - 1) crossings++;
          }
        }
      }
      expect(crossings).toBe(0);
    });
  });
});
