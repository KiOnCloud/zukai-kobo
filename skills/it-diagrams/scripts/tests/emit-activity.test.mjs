import { describe, it, expect, beforeAll } from 'vitest';
import { emit, bundle } from '../src/pipeline.mjs';
import { validateIr } from '../src/validate-ir.mjs';
import { checkDrawioStructure, cellBounds, absoluteBounds, edgePaths } from './drawio-structure.mjs';
import { layoutActivity } from '../src/layout-activity.mjs';
import { measureNode } from '../src/layout-graph.mjs';
import { widestLine } from '../src/text-metrics.mjs';
import { loadFixture, loadMermaid, validFixtures } from './helpers.mjs';

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
      expect(r.warnings.map((w) => w.feature ?? w.stage)).toEqual(['kind', 'emit']);
      expect(r.warnings[0].message).toContain('swimlane-beta');
      expect((await mermaid.parse(r.output)).diagramType).toBe('swimlane');
      await expect(r.output).toMatchFileSnapshot('snapshots/mermaid/activity-valid-fork-join.mmd');
    });

    it('writes no front-matter title for swimlane-beta, which would be drawn over the lane headers, and says so', async () => {
      const ir = loadFixture('activity', 'valid-decision-handoff-left');
      const r = await emit(ir, 'mermaid');
      expect(r.output.startsWith('swimlane-beta TB\n')).toBe(true);
      expect(r.output).not.toContain('title:');
      expect(r.output).not.toContain(ir.title);
      const w = r.warnings.filter((x) => x.stage === 'emit');
      expect(w).toHaveLength(1);
      expect(w[0].path).toBe('/title');
      expect(w[0].message).toMatch(/title is not written into the swimlane-beta text.*lane header row/);
      // The stable flowchart form lays the title out above its subgraphs, so it keeps it.
      const stable = await emit(ir, 'mermaid', { mermaidStable: true });
      expect(stable.output.startsWith(`---\ntitle: ${JSON.stringify(ir.title)}\n---\nflowchart TB\n`)).toBe(true);
      expect(stable.warnings.some((x) => x.path === '/title')).toBe(false);
      // In the combined file the heading above the block carries the title: nothing is lost, no warning.
      const md = await bundle([{ id: 'invoice', ir }], 'mermaid');
      expect(md.output).toContain(`## ${ir.title}`);
      expect(md.warnings.some((x) => x.path === '/title')).toBe(false);
    });

    it('emits a stable flowchart with --mermaid-stable, warns about what was lost, and parses', async () => {
      const r = await emit(loadFixture('activity', 'valid-fork-join'), 'mermaid', { mermaidStable: true });
      expect(r.ok).toBe(true);
      expect(r.output).toContain('flowchart TB');
      expect(r.output).not.toContain('swimlane');
      expect(r.warnings.map((w) => w.stage)).toEqual(['feature-matrix', 'emit']);
      expect(r.warnings[1].message).toContain('stable flowchart form');
      expect((await mermaid.parse(r.output)).diagramType).toBe('flowchart-v2');
      await expect(r.output).toMatchFileSnapshot('snapshots/mermaid/activity-valid-fork-join-stable.mmd');
    });

    describe('issue 53: the stable form writes no word of its own into a control node', () => {
      const ja = {
        schemaVersion: 1, kind: 'activity', title: '請求書のダウンロード', direction: 'TB', meta: { lang: 'ja' },
        lanes: [{ id: 'client', label: 'クライアント' }, { id: 'api', label: '請求API' }],
        actions: [{ id: 'ask', label: '請求書PDFを要求する', lane: 'client' }, { id: 'pdf', label: 'PDFを作成する', lane: 'api' }, { id: 'log', label: 'ダウンロードを記録する', lane: 'api' }, { id: 'save', label: 'PDFを保存する', lane: 'client' }],
        controls: [{ id: 'start', kind: 'initial', lane: 'client' }, { id: 'fork', kind: 'fork', lane: 'api' }, { id: 'join', kind: 'join', lane: 'api' }, { id: 'end', kind: 'final', lane: 'client' }],
        flows: [{ id: 'f1', from: 'start', to: 'ask' }, { id: 'f2', from: 'ask', to: 'fork' }, { id: 'f3', from: 'fork', to: 'pdf' }, { id: 'f4', from: 'fork', to: 'log' }, { id: 'f5', from: 'pdf', to: 'join' }, { id: 'f6', from: 'log', to: 'join' }, { id: 'f7', from: 'join', to: 'save' }, { id: 'f8', from: 'save', to: 'end' }],
      };
      /** Every quoted label of the text, with Mermaid's entity codes and line breaks taken out. */
      const labels = (text) => [...text.replace(/^---[\s\S]*?---\n/, '').matchAll(/"([^"]*)"/g)].map((m) => m[1].replace(/#\w+;|<br\/>/g, ''));

      it('draws initial, final, fork and join as painted shapes with blank labels', async () => {
        const r = await emit(ja, 'mermaid', { mermaidStable: true });
        expect(r.ok).toBe(true);
        const line = (id) => r.output.split('\n')[r.output.split('\n').indexOf(`    %% id: ${id}`) + 1].trim();
        expect(line('start')).toBe('n7((" "))');
        expect(line('end')).toBe('n10(((" ")))');
        expect(line('fork')).toBe(`n8[["${'#emsp;'.repeat(8)}"]]`);
        expect(line('join')).toBe(line('fork').replace('n8', 'n9'));
        // A filled circle, a double circle whose white strokes leave a ring, and two filled bars.
        expect(r.output).toContain('  style n7 fill:#000,stroke:#000\n  style n8 fill:#000,stroke:#000\n  style n9 fill:#000,stroke:#000\n  style n10 fill:#000,stroke:#fff,stroke-width:3px\n');
        expect(r.output.trimEnd().endsWith('stroke-width:3px')).toBe(true);
        // No Latin letter is left in any label but the ones the IR carries (PDF, API).
        const own = labels(r.output).join('').replace(/PDF|API/g, '');
        expect(own).not.toMatch(/[A-Za-z]/);
        for (const word of ['start', 'end', 'fork', 'join']) expect(r.output.replace(/%% id: \w+/g, '')).not.toContain(`"${word}"`);
        expect((await mermaid.parse(r.output)).diagramType).toBe('flowchart-v2');
      });

      it('stands the bars upright in a left-to-right diagram', async () => {
        for (const direction of ['LR', 'RL']) {
          const r = await emit({ ...ja, direction }, 'mermaid', { mermaidStable: true });
          expect(r.output).toContain('n8[["#emsp;<br/>#emsp;<br/>#emsp;"]]');
          expect(r.output).toContain('n9[["#emsp;<br/>#emsp;<br/>#emsp;"]]');
          expect((await mermaid.parse(r.output)).diagramType).toBe('flowchart-v2');
        }
      });

      it('leaves a decision and a merge as they were, and paints nothing in the swimlane form', async () => {
        const ir = loadFixture('activity', 'valid-two-lanes');
        const stable = await emit(ir, 'mermaid', { mermaidStable: true });
        // Only control nodes are painted: one style line for each initial, final, fork and join.
        const painted = (ir.controls ?? []).filter((c) => ['initial', 'final', 'fork', 'join'].includes(c.kind)).length;
        expect(stable.output.split('\n').filter((l) => l.startsWith('  style '))).toHaveLength(painted);
        const beta = await emit(ja, 'mermaid');
        expect(beta.output).not.toContain('style ');
        expect(beta.output).toContain('@{ shape: fork }');
      });
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

    describe('issue 38: a decision branch that hands off to a lane on the left sits left of its sibling', () => {
      const { segmentsOf, crossings } = helpers();
      const swap = (arr, a, b) => { const i = arr.findIndex((x) => x.id === a); const j = arr.findIndex((x) => x.id === b); const out = arr.slice(); [out[i], out[j]] = [out[j], out[i]]; return out; };
      const cx = (L, id) => L.nodes.get(id).x + L.nodes.get(id).width / 2;

      it('the branch whose next step is in the left lane takes the left column, whatever the declaration order; the other goes straight down its own column', async () => {
        const base = loadFixture('activity', 'valid-decision-handoff-left');
        const variants = {
          base,
          'siblings swapped in actions': { ...base, actions: swap(base.actions, 'missing', 'stream') },
          'yes and no flows swapped': { ...base, flows: swap(base.flows, 'f4', 'f6') },
          'the no-branch ends at its own final node in the decision lane': { ...base, controls: [...base.controls, { id: 'end-missing', kind: 'final', lane: 'api' }], flows: base.flows.map((f) => (f.id === 'f5' ? { ...f, to: 'end-missing' } : f)) },
        };
        for (const [name, ir] of Object.entries(variants)) {
          const { L, segments } = segmentsOf(ir);
          expect(crossings(segments), name).toBe(0);
          expect(L.warnings.filter((w) => w.message.startsWith('layout:')), name).toEqual([]);
          expect(cx(L, 'stream'), name).toBeLessThan(cx(L, 'missing'));
        }
        // The long flow of the right sibling runs down its own column and turns only above its target.
        const { L } = segmentsOf(base);
        expect(L.edges.get('f5').points.map((p) => p.x)).toEqual([cx(L, 'missing'), cx(L, 'end')]);
        const r = await emit(base, 'drawio');
        expect(r.ok).toBe(true);
        expect(r.warnings.filter((w) => String(w.message).startsWith('layout:'))).toEqual([]);
      });

      it('mirrored lanes put the hand-off branch on the right', () => {
        const base = loadFixture('activity', 'valid-decision-handoff-left');
        const { L, segments } = segmentsOf({ ...base, lanes: [...base.lanes].reverse() });
        expect(crossings(segments)).toBe(0);
        expect(cx(L, 'stream')).toBeGreaterThan(cx(L, 'missing'));
      });

      it('a long flow to another lane does not pull its node aside, so a free column stays free', () => {
        // Here the sync branch has a long flow to the worker lane on the right; it keeps the
        // declaration order and its own column, and nothing crosses.
        const { L, segments } = segmentsOf(loadFixture('activity', 'valid-sync-async'));
        expect(crossings(segments)).toBe(0);
        expect(cx(L, 'a-queue')).toBeLessThan(cx(L, 'a-call'));
        expect(L.edges.get('f-call').points).toHaveLength(2);
      });

      it('names the declaration order of row-mates in the hint of a crossing between lanes', () => {
        const { L } = segmentsOf(loadFixture('activity', 'valid-fork-join'));
        const w = L.warnings.find((x) => x.message.includes('cross'));
        expect(w.hint).toMatch(/order in `actions` and `controls`/);
      });
    });

    describe('issue 37: a merge fed by side trunks sits on their side of the sibling branch', () => {
      const { segmentsOf, crossings } = helpers();
      const swap = (arr, a, b) => { const i = arr.findIndex((x) => x.id === a); const j = arr.findIndex((x) => x.id === b); const out = arr.slice(); [out[i], out[j]] = [out[j], out[i]]; return out; };
      const cx = (L, id) => L.nodes.get(id).x + L.nodes.get(id).width / 2;

      it('three decisions whose no-branches share one merge: no crossing, the merge left of the yes-branch, whatever the declaration order', async () => {
        const base = loadFixture('activity', 'valid-merge-left-trunks');
        const variants = {
          base,
          'merge declared first': { ...base, controls: [base.controls.find((c) => c.id === 'empty'), ...base.controls.filter((c) => c.id !== 'empty')] },
          'successor declared before the sibling': { ...base, actions: swap(base.actions, 'shape', 'none') },
          'yes and no flows swapped': { ...base, flows: swap(base.flows, 'f9', 'f10') },
        };
        for (const [name, ir] of Object.entries(variants)) {
          const { L, segments } = segmentsOf(ir);
          expect(crossings(segments), name).toBe(0);
          expect(L.warnings.filter((w) => w.message.startsWith('layout:')), name).toEqual([]);
          // The merge and its successor take the column the left trunk reaches; the yes-branch stays straight.
          expect(cx(L, 'empty'), name).toBeLessThan(cx(L, 'shape'));
          expect(cx(L, 'none'), name).toBeLessThan(cx(L, 'send'));
          expect(L.edges.get('f9').points, name).toEqual([]);
          // Each trunk ends above the merge, where the no-branch of the last decision joins it, not under that decision's split.
          const join = L.edges.get('f10').points.at(-1);
          expect(Math.abs(join.x - cx(L, 'anyitem')), name).toBeGreaterThan(20);
          for (const id of ['f4', 'f7']) {
            const last = L.edges.get(id).points.at(-1);
            expect(last.x, `${name}/${id}`).toBeCloseTo(cx(L, 'empty'), 5);
            expect(last.y, `${name}/${id}`).toBeCloseTo(join.y, 5);
          }
        }
        const r = await emit(base, 'drawio');
        expect(r.ok).toBe(true);
        expect(r.warnings.filter((w) => String(w.message).startsWith('layout:'))).toEqual([]);
      });

      it('mirrored lanes send the trunks down the right gutter and the merge right of the yes-branch', () => {
        const base = loadFixture('activity', 'valid-merge-left-trunks');
        const { L, segments } = segmentsOf({ ...base, lanes: [base.lanes[2], base.lanes[1], base.lanes[0]] });
        expect(crossings(segments)).toBe(0);
        expect(cx(L, 'empty')).toBeGreaterThan(cx(L, 'shape'));
      });

      it('a merge alone under its decision still moves aside so the trunks meet the no-branch above the merge', () => {
        const base = loadFixture('activity', 'valid-merge-left-trunks');
        const ir = { ...base, actions: base.actions.filter((a) => a.id !== 'shape' && a.id !== 'send'), flows: [...base.flows.filter((f) => !['f9', 'f11', 'f13'].includes(f.id)), { id: 'f9', from: 'anyitem', to: 'end', guard: 'yes' }] };
        const { L, segments } = segmentsOf(ir);
        expect(crossings(segments)).toBe(0);
        expect(cx(L, 'empty')).toBeLessThan(cx(L, 'anyitem') - 20);
        expect(L.edges.get('f10').points.at(-1).x).toBeCloseTo(cx(L, 'empty'), 5);
      });

      it('a trunk into a node fed straight from an action only breaks the tie with its sibling; the chain stays straight', () => {
        const base = loadFixture('activity', 'valid-merge-left-trunks');
        const ir = { ...base, actions: [...base.actions, { id: 'anyitem', label: 'Collect', lane: 'api' }], controls: base.controls.filter((c) => c.id !== 'anyitem'), flows: base.flows.map((f) => (f.from === 'anyitem' ? { id: f.id, from: f.from, to: f.to } : f)) };
        const { L, segments } = segmentsOf(ir);
        expect(crossings(segments)).toBe(0);
        expect(cx(L, 'empty')).toBeLessThan(cx(L, 'shape'));
        expect(L.edges.get('f9').points).toEqual([]);
        // Without a sibling the node stays under the action, as every other fixture does.
        const { L: alone } = segmentsOf(loadFixture('activity', 'valid-fanout-right'));
        expect(cx(alone, 'a-end')).toBeCloseTo(cx(alone, 'a-done'), 5);
      });

      it('blames the lanes only for a crossing between flows of different lanes', () => {
        const { L } = segmentsOf(loadFixture('activity', 'valid-fork-join'));
        const w = L.warnings.find((x) => x.message.includes('cross'));
        expect(w.hint).toMatch(/lanes of the nodes force/);
        expect(w.message).not.toMatch(/inside lane/);
      });
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

    describe('a guard keeps to the stretch only its own flow runs along when its target has other incoming flows', () => {
      const { segmentsOf } = helpers();
      // Centre and box of a guard label, rebuilt from the edge-label geometry: a relative
      // position along the routed path plus a pixel offset.
      const labelOf = (L, ir, id) => {
        const f = ir.flows.find((x) => x.id === id);
        const s = L.nodes.get(f.from); const t = L.nodes.get(f.to); const e = L.edges.get(id);
        const path = [{ x: s.x + e.exit.x * s.width, y: s.y + e.exit.y * s.height }, ...e.points, { x: t.x + e.entry.x * t.width, y: t.y + e.entry.y * t.height }];
        const lens = path.slice(1).map((p, i) => Math.abs(p.x - path[i].x) + Math.abs(p.y - path[i].y));
        let d = ((e.label.position + 1) / 2) * lens.reduce((a, b) => a + b, 0);
        let i = 0;
        while (i < lens.length - 1 && d > lens[i]) { d -= lens[i]; i += 1; }
        const k = lens[i] ? d / lens[i] : 0;
        const anchor = { x: path[i].x + k * (path[i + 1].x - path[i].x), y: path[i].y + k * (path[i + 1].y - path[i].y) };
        const width = Math.ceil(widestLine(f.guard)) + 12;
        const centre = { x: anchor.x + e.label.offset.x, y: anchor.y + e.label.offset.y };
        return { path, anchor, centre, box: { left: centre.x - width / 2, right: centre.x + width / 2, top: centre.y - 8, bottom: centre.y + 8 } };
      };

      it('puts the guard of a straight branch in the middle of its private run, whether it is long or short', () => {
        for (const guard of ['yes: nothing is sent', 'yes']) {
          const ir = loadFixture('activity', 'valid-guard-shared-bus');
          ir.flows.find((f) => f.id === 'f7').guard = guard;
          const { L, segments } = segmentsOf(ir);
          const { path, anchor, box, centre } = labelOf(L, ir, 'f7');
          // The branch goes straight down, then turns into the bus that f10 also runs along.
          const turn = segments.find((sg) => sg.id === 'f8' && Math.abs(sg.a.y - sg.b.y) < 0.5).a.y;
          const bus = path[1].y;
          expect(segments.some((sg) => sg.id === 'f10' && Math.abs(sg.a.y - bus) < 0.5 && Math.abs(sg.b.y - bus) < 0.5), 'f10 runs along the bus').toBe(true);
          expect(bus - turn, 'the private run is long').toBeGreaterThan(100);
          expect(anchor.x, `"${guard}" is beside its own vertical`).toBeCloseTo(path[0].x, 5);
          expect(centre.y, `"${guard}" is in the middle of the private run`).toBeCloseTo((turn + bus) / 2, 5);
          expect(box.top - turn, `"${guard}" is clear of the sibling's turn`).toBeGreaterThanOrEqual(12);
          expect(bus - box.bottom, `"${guard}" is clear of the bus`).toBeGreaterThanOrEqual(6);
          expect(L.warnings.filter((w) => w.message.startsWith('layout:'))).toEqual([]);
        }
      });

      it('keeps a guard above the part of a run that no other flow shares, before the point where another flow joins', () => {
        const ir = loadFixture('activity', 'valid-guard-shared-bus');
        ir.flows.find((f) => f.id === 'f10').guard = 'ok';
        const { L } = segmentsOf(ir);
        const { path, anchor, box } = labelOf(L, ir, 'f10');
        const join = labelOf(L, ir, 'f7').path[1];
        expect(anchor.y, 'the guard is above its own run on the bus').toBeCloseTo(join.y, 5);
        expect(box.bottom).toBeLessThan(join.y);
        // f10 comes in from the right; f7 joins it on the way to the target.
        expect(path[1].x).toBeGreaterThan(join.x);
        expect(box.left, 'the guard is before the point where f7 joins').toBeGreaterThan(join.x);
        expect(L.warnings.filter((w) => w.message.startsWith('layout:'))).toEqual([]);
      });

      it('leaves the guard of a straight branch into a node of its own where it was', () => {
        const ir = loadFixture('activity', 'valid-guard-shared-bus');
        ir.controls.push({ id: 'done-dry', kind: 'final', lane: 'api' });
        ir.flows.find((f) => f.id === 'f7').to = 'done-dry';
        const { L, segments } = segmentsOf(ir);
        const { path, centre } = labelOf(L, ir, 'f7');
        expect(L.edges.get('f7').points).toEqual([]);
        const turn = segments.find((sg) => sg.id === 'f8' && Math.abs(sg.a.y - sg.b.y) < 0.5).a.y;
        expect(centre.y).toBeCloseTo((turn + path[1].y) / 2, 5);
      });
    });

    describe('a guard in a left-to-right diagram sits beside its own line, where its text is drawn', () => {
      const { sizesOf } = helpers();
      // Every guard's text box in drawn coordinates: the text is horizontal whatever the
      // direction, centred on a point of the routed path plus the label's pixel offset.
      const drawn = (ir) => {
        const L = layoutActivity(ir, sizesOf(ir));
        const paths = new Map();
        for (const f of ir.flows) {
          const s = L.nodes.get(f.from); const t = L.nodes.get(f.to); const e = L.edges.get(f.id);
          paths.set(f.id, [{ x: s.x + e.exit.x * s.width, y: s.y + e.exit.y * s.height }, ...e.points, { x: t.x + e.entry.x * t.width, y: t.y + e.entry.y * t.height }]);
        }
        const labels = new Map();
        for (const f of ir.flows.filter((x) => x.guard)) {
          const path = paths.get(f.id); const e = L.edges.get(f.id);
          const lens = path.slice(1).map((p, i) => Math.abs(p.x - path[i].x) + Math.abs(p.y - path[i].y));
          let d = ((e.label.position + 1) / 2) * lens.reduce((a, b) => a + b, 0);
          let i = 0;
          while (i < lens.length - 1 && d > lens[i]) { d -= lens[i]; i += 1; }
          const k = lens[i] ? d / lens[i] : 0;
          const anchor = { x: path[i].x + k * (path[i + 1].x - path[i].x), y: path[i].y + k * (path[i + 1].y - path[i].y) };
          const width = Math.ceil(widestLine(f.guard)) + 12;
          labels.set(f.id, { guard: f.guard, width, offset: e.label.offset, alongHorizontal: Math.abs(path[i].y - path[i + 1].y) < 0.5, box: { x: anchor.x + e.label.offset.x - width / 2, y: anchor.y + e.label.offset.y - 8, width, height: 16 } });
        }
        return { L, paths, labels };
      };
      const crosses = (box, path) => path.slice(1).some((b, i) => Math.max(path[i].x, b.x) > box.x && Math.min(path[i].x, b.x) < box.x + box.width && Math.max(path[i].y, b.y) > box.y && Math.min(path[i].y, b.y) < box.y + box.height);
      const overlap = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
      const gapTo = (box, path) => Math.min(...path.slice(1).map((b, i) => Math.hypot(Math.max(box.x - Math.max(path[i].x, b.x), 0, Math.min(path[i].x, b.x) - box.x - box.width), Math.max(box.y - Math.max(path[i].y, b.y), 0, Math.min(path[i].y, b.y) - box.y - box.height))));

      it('offsets a guard by half its height from a horizontal segment and by half its width from a vertical one', () => {
        for (const direction of ['LR', 'RL']) {
          const { labels } = drawn({ ...loadFixture('activity', 'valid-guard-collision'), direction });
          expect(labels.size).toBe(6);
          for (const [id, l] of labels) {
            if (l.alongHorizontal) {
              expect(l.offset.x, `${direction} ${id}`).toBe(0);
              expect(Math.abs(l.offset.y), `${direction} ${id} is right above or below its line`).toBe(10);
            } else {
              expect(l.offset.y, `${direction} ${id}`).toBe(0);
              expect(Math.abs(l.offset.x), `${direction} ${id} is right beside its line`).toBe(l.width / 2 + 6);
            }
          }
        }
      });

      it('keeps every guard off the lines, the nodes and the other guards, long or short', () => {
        for (const name of ['valid-guard-collision', 'valid-guard-shared-bus', 'valid-guard-straight', 'valid-business-fulfilment', 'valid-decision-handoff-left']) {
          for (const direction of ['LR', 'RL']) {
            const { L, paths, labels } = drawn({ ...loadFixture('activity', name), direction });
            expect(L.warnings.filter((w) => w.message.startsWith('layout: guard')), `${name} ${direction}`).toEqual([]);
            for (const [id, l] of labels) {
              const where = `${name} ${direction} ${id} "${l.guard}"`;
              for (const [other, path] of paths) expect(crosses(l.box, path), `${where} is crossed by ${other}`).toBe(false);
              for (const [node, b] of L.nodes) expect(overlap(l.box, b), `${where} is on ${node}`).toBe(false);
              for (const [other, o] of labels) if (other !== id) expect(overlap(l.box, o.box), `${where} is on the guard of ${other}`).toBe(false);
              expect(gapTo(l.box, paths.get(id)), `${where} is next to its own line`).toBeLessThanOrEqual(6);
            }
          }
        }
      });

      it('gives the straight branch of a decision room for a long guard along its own segment', () => {
        const ir = { ...loadFixture('activity', 'valid-guard-straight'), direction: 'LR' };
        const { paths, labels } = drawn(ir);
        const yes = labels.get('f-yes');
        const own = paths.get('f-yes');
        // Drawn left to right: the branch runs straight from the decision to its final node,
        // and its sibling leaves that line where it turns down or up.
        expect(own).toHaveLength(2);
        expect(own[0].y).toBeCloseTo(own[1].y, 5);
        const turn = paths.get('f-no')[1].x;
        expect(yes.alongHorizontal).toBe(true);
        expect(yes.box.x - turn, 'clear of the sibling\'s turn').toBeGreaterThanOrEqual(12);
        expect(own[1].x - (yes.box.x + yes.box.width), 'clear of the target').toBeGreaterThanOrEqual(6);
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

    describe('a left-to-right or right-to-left diagram is drawn as it reads', () => {
      const fixtures = validFixtures().filter((f) => f.kind === 'activity');
      const drawn = async (ir) => {
        const r = await emit(ir, 'drawio', { diagramId: 'g' });
        const { problems, cells } = checkDrawioStructure(r.output);
        expect(problems).toEqual([]);
        const abs = absoluteBounds(cells);
        const paths = edgePaths(cells, abs);
        const lanes = ir.lanes.map((l) => abs.get(`g:${l.id}`));
        const nodes = new Map([...ir.actions, ...(ir.controls ?? [])].map((n) => [n.id, abs.get(`g:${n.id}`)]));
        // The box the layout keeps free for each guard: its text and 6 px on each side, on one
        // line, centred on the point its edge-label geometry names.
        const guards = new Map();
        for (const f of ir.flows.filter((x) => x.guard)) {
          const label = cells.find((c) => c.id === `g:${f.id}:label`);
          const path = paths.get(`g:${f.id}`);
          const lengths = path.slice(1).map((q, i) => Math.abs(q.x - path[i].x) + Math.abs(q.y - path[i].y));
          let d = ((Number(label.mxGeometry.x) + 1) / 2) * lengths.reduce((a, b) => a + b, 0);
          let i = 0;
          while (i < lengths.length - 1 && d > lengths[i]) d -= lengths[i++];
          const t = lengths[i] ? Math.min(1, d / lengths[i]) : 0;
          const at = { x: path[i].x + t * (path[i + 1].x - path[i].x), y: path[i].y + t * (path[i + 1].y - path[i].y) };
          const offset = label.mxGeometry.mxPoint[0];
          const width = Math.ceil(widestLine(f.guard)) + 12;
          guards.set(f.id, { x: at.x + Number(offset.x) - width / 2, y: at.y + Number(offset.y) - 8, width, height: 16 });
        }
        return { warnings: r.warnings.filter((w) => String(w.message).startsWith('layout:')).map((w) => w.message), lanes, nodes, guards, paths: new Map(ir.flows.map((f) => [f.id, paths.get(`g:${f.id}`)])) };
      };
      /** Distance between a box and the nearest segment of an orthogonal path; 0 when they touch. */
      const distance = (box, path) => Math.min(...path.slice(1).map((q, i) => {
        const p = path[i];
        const dx = Math.max(box.x - Math.max(p.x, q.x), 0, Math.min(p.x, q.x) - box.x - box.width);
        const dy = Math.max(box.y - Math.max(p.y, q.y), 0, Math.min(p.y, q.y) - box.y - box.height);
        return Math.hypot(dx, dy);
      }));
      const overlap = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

      it('draws every node at the width and height it has top-to-bottom, with fork and join bars upright across the flow', async () => {
        let checked = 0;
        for (const { name, ir } of fixtures) {
          const tb = await drawn({ ...ir, direction: 'TB' });
          for (const direction of ['LR', 'RL']) {
            const { nodes } = await drawn({ ...ir, direction });
            for (const [id, box] of nodes) {
              const kind = (ir.controls ?? []).find((c) => c.id === id)?.kind;
              const { width, height } = tb.nodes.get(id);
              const expected = kind === 'fork' || kind === 'join' ? { width: 8, height: 120 } : { width, height };
              expect({ width: box.width, height: box.height }, `${name} ${direction} ${id}`).toEqual(expected);
              checked++;
            }
          }
        }
        expect(checked).toBeGreaterThan(200);
      });

      it('puts the lanes one under the other, each as long as the flow, and every node inside its own', async () => {
        const ir = loadFixture('activity', 'valid-guard-collision-lr');
        expect(ir.direction).toBe('LR');
        const { lanes, nodes } = await drawn(ir);
        for (let i = 1; i < lanes.length; i++) {
          expect(lanes[i].x).toBe(lanes[0].x);
          expect(lanes[i].width).toBe(lanes[0].width);
          expect(lanes[i].y).toBeCloseTo(lanes[i - 1].y + lanes[i - 1].height, 5);
        }
        for (const n of [...ir.actions, ...ir.controls]) {
          const box = nodes.get(n.id);
          const lane = lanes[ir.lanes.findIndex((l) => l.id === n.lane)];
          // Right of the lane's header, which a left-to-right lane carries on its left.
          expect(box.x, n.id).toBeGreaterThanOrEqual(lane.x + 40);
          expect(box.x + box.width, n.id).toBeLessThanOrEqual(lane.x + lane.width);
          expect(box.y, n.id).toBeGreaterThanOrEqual(lane.y);
          expect(box.y + box.height, n.id).toBeLessThanOrEqual(lane.y + lane.height);
        }
      });

      it('writes every guard beside its own line, off the nodes, the other lines, the other guards and the lane borders', async () => {
        let checked = 0;
        for (const { name, ir } of fixtures) {
          const tb = await drawn({ ...ir, direction: 'TB' });
          for (const direction of ['LR', 'RL']) {
            const { warnings, lanes, nodes, guards, paths } = await drawn({ ...ir, direction });
            // Turning the diagram adds no warning: what the lanes force top-to-bottom, they force here.
            expect(warnings, `${name} ${direction}`).toEqual(tb.warnings);
            for (const [id, box] of guards) {
              const where = `${name} ${direction} guard of ${id}`;
              const own = distance(box, paths.get(id));
              expect(own, `${where} off its own line`).toBeGreaterThan(0);
              expect(own, `${where} next to its own line`).toBeLessThanOrEqual(6);
              for (const [other, path] of paths) if (other !== id) expect(distance(box, path), `${where} off the line of ${other}`).toBeGreaterThan(0);
              for (const [node, b] of nodes) expect(overlap(box, b), `${where} off ${node}`).toBe(false);
              for (const [other, b] of guards) if (other !== id) expect(overlap(box, b), `${where} off the guard of ${other}`).toBe(false);
              for (const lane of lanes) for (const y of [lane.y, lane.y + lane.height]) expect(box.y < y && y < box.y + box.height, `${where} off a lane border`).toBe(false);
              checked++;
            }
          }
        }
        expect(checked).toBeGreaterThan(100);
      });

      it('keeps a stretch beside a straight branch as long as its guard, past the turn of its sibling', async () => {
        const base = loadFixture('activity', 'valid-guard-straight');
        const guard = 'yes: the request is complete and may go on';
        const ir = { ...base, direction: 'LR', flows: base.flows.map((f) => (f.id === 'f-yes' ? { ...f, guard } : f)) };
        const { warnings, guards, paths } = await drawn(ir);
        expect(warnings).toEqual([]);
        const path = paths.get('f-yes');
        expect(path).toHaveLength(2);
        expect(path[0].y).toBe(path[1].y);
        const box = guards.get('f-yes');
        // The sibling leaves the shared trunk where its path first turns.
        const turn = paths.get('f-no')[1].x;
        expect(box.x - turn).toBeGreaterThanOrEqual(12);
        expect(path[1].x - (box.x + box.width)).toBeGreaterThanOrEqual(6);
        // The same guard top-to-bottom needs no more than the usual room: the gap is not longer for it.
        const tb = await drawn({ ...ir, direction: 'TB' });
        const short = await drawn({ ...base, direction: 'TB' });
        expect(tb.paths.get('f-yes')[1].y - tb.paths.get('f-yes')[0].y).toBe(short.paths.get('f-yes')[1].y - short.paths.get('f-yes')[0].y);
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
