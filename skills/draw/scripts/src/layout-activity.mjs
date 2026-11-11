/**
 * Cross-functional swimlane layout for activity diagrams: one full-height column per lane,
 * in IR order, and one row per step of the flow. Rows come from a longest-path layering of
 * the flows (back edges ignored). Nodes that share a lane and a row sit side by side, ordered
 * by the position of their predecessors so branches do not cross. Every edge is routed
 * explicitly: horizontal runs use the gap between rows, vertical runs between non-adjacent
 * rows use a gutter at the right edge of the source lane, and each gap and gutter is split
 * into tracks so that edges to different targets never share a segment, while edges into
 * one target merge on a shared track and enter it together from the top. Coordinates are
 * computed top-to-bottom and transposed for left-to-right flows. Sizes are taken as drawn:
 * for such a flow every node and every guard's box is turned on the way in, so that the
 * transpose gives each back the width and height it is drawn at.
 */

import { widestLine } from './text-metrics.mjs';

/** How far along its flow, in px, a guard still reads as next to its decision. */
const GUARD_NEAR = 240;
/** Minimum distance between a straight branch's guard and the sibling run it leaves below. */
const GUARD_CLEAR = 12;

export const ACTIVITY_METRICS = {
  leftMargin: 40,
  topMargin: 40,
  headerHeight: 40,
  lanePadding: 30,
  gutterMin: 30,
  trackPitch: 22,
  minLaneWidth: 220,
  rowGapMin: 60,
  nodeGap: 40,
  topGap: 30,
  bottomGap: 30,
  guardRoom: 32,
  // Room between a join that was moved below the guard room and the node it leads into.
  joinClear: 12,
};

/** Soft draw.io colours per lane index: header fill, body fill, stroke. */
export const LANE_PALETTE = [
  ['#fff2cc', '#fffbe6', '#d6b656'],
  ['#dae8fc', '#f0f6ff', '#6c8ebf'],
  ['#d5e8d4', '#f1f8f0', '#82b366'],
  ['#e1d5e7', '#f6f1f9', '#9673a6'],
  ['#ffe6cc', '#fff5eb', '#d79b00'],
  ['#f8cecc', '#fdf0ef', '#b85450'],
];

/**
 * @param {object} ir validated activity IR
 * @param {Array<{id:string,lane?:string,width:number,height:number}>} sizes one entry per action and
 *   control, at the width and height it is drawn at whatever the direction (a fork or join bar
 *   of a left-to-right diagram is already upright)
 * @param {object} [m]
 * @returns {{ lanes: Array<{id:string,index:number,x:number,y:number,width:number,height:number}>,
 *   nodes: Map<string,{x:number,y:number,width:number,height:number,lane:string,row:number}>,
 *   edges: Map<string,{points:Array<{x:number,y:number}>, exit:{x:number,y:number}, entry:{x:number,y:number}, label?:object}>,
 *   width:number, height:number, horizontal:boolean, warnings:Array<{path:string,message:string}> }}
 */
export function layoutActivity(ir, sizes, m = ACTIVITY_METRICS) {
  const horizontal = ir.direction === 'LR' || ir.direction === 'RL';
  const laneIndex = new Map(ir.lanes.map((l, i) => [l.id, i]));
  // Sizes arrive as drawn. A left-to-right flow is laid out top-to-bottom and transposed at the
  // end, so its nodes go in turned: the transpose turns them back to the size they were given.
  const byId = new Map(sizes.map((n) => [n.id, horizontal ? { ...n, width: n.height, height: n.width } : { ...n }]));
  const order = sizes.map((n) => n.id);
  const out = new Map(order.map((id) => [id, []]));
  const inn = new Map(order.map((id) => [id, []]));
  for (const f of ir.flows) {
    out.get(f.from).push(f.to);
    inn.get(f.to).push(f.from);
  }
  // Controls without a lane borrow the lane of the node they lead to, else the one they follow.
  for (const n of byId.values()) {
    if (n.lane) continue;
    const next = out.get(n.id).map((t) => byId.get(t).lane).find(Boolean);
    const prev = inn.get(n.id).map((s) => byId.get(s).lane).find(Boolean);
    n.lane = next ?? prev ?? ir.lanes[0].id;
  }

  // Rows: longest path over the flows with back edges (found by DFS in input order) ignored.
  const state = new Map();
  const back = new Set();
  const visit = (u) => {
    state.set(u, 1);
    for (const v of out.get(u)) {
      if (state.get(v) === 1) back.add(`${u}>${v}`);
      else if (!state.has(v)) visit(v);
    }
    state.set(u, 2);
  };
  for (const s of [...order.filter((id) => inn.get(id).length === 0), ...order]) if (!state.has(s)) visit(s);
  const row = new Map();
  const indeg = new Map(order.map((id) => [id, inn.get(id).filter((s) => !back.has(`${s}>${id}`)).length]));
  const queue = order.filter((id) => indeg.get(id) === 0);
  while (queue.length > 0) {
    const u = queue.shift();
    if (!row.has(u)) row.set(u, 0);
    for (const v of out.get(u)) {
      if (back.has(`${u}>${v}`)) continue;
      row.set(v, Math.max(row.get(v) ?? 0, row.get(u) + 1));
      indeg.set(v, indeg.get(v) - 1);
      if (indeg.get(v) === 0) queue.push(v);
    }
  }
  for (const id of order) if (!row.has(id)) row.set(id, 0);
  const rowCount = Math.max(...row.values()) + 1;

  /**
   * Plan routes, size lanes, place nodes and route edges. `columns` names the long flows
   * that run straight down their source's column instead of through a gutter; which flows
   * can do that is only known once nodes have positions, so the caller runs this to a fixed
   * point.
   */
  const arrange = (columns, sides = new Map()) => {
    // Route plan. Each edge's horizontal runs claim a track in a row gap and, for non-adjacent
    // rows, a track in the source lane's gutter. Edges into the same target share a track;
    // everything else gets its own, so distinct flows never lie on one line.
    const trackKey = (f) => `to:${f.to}`;
    const gapTracks = new Map(); // gap index (below row r) -> ordered keys
    const gutterTracks = new Map(); // "<lane id>:R" | "<lane id>:L" -> ordered keys
    const claim = (map, key, track) => {
      if (!map.has(key)) map.set(key, []);
      const list = map.get(key);
      if (!list.includes(track)) list.push(track);
    };
    const plans = new Map();
    for (const f of ir.flows) {
      const rs = row.get(f.from);
      const rt = row.get(f.to);
      let type;
      if (f.from === f.to) type = 'self';
      else if (rt === rs + 1) type = 'adjacent';
      else if (rt > rs + 1) type = columns.has(f.id) ? 'column' : 'skip';
      else type = 'back';
      plans.set(f.id, { type, key: trackKey(f), rs, rt, lane: byId.get(f.from).lane });
    }
    // A long edge runs down (or up) a gutter at one edge of its source lane or of its target
    // lane. Each candidate is scored by the cross-lane runs that would cut its vertical: two
    // points per run in a gap it passes through (a certain crossing), one per run in the gap
    // where it starts or ends (a conflict the track order may not resolve). The lowest score
    // wins, the source lane's right side on a tie, so a bypass in an outer lane hugs the free
    // side and a loop back to another lane climbs where nothing crosses it.
    const laneSpanCovers = (f, edgeAfterLane) => {
      const a = laneIndex.get(byId.get(f.from).lane);
      const b = laneIndex.get(byId.get(f.to).lane);
      return Math.min(a, b) <= edgeAfterLane && Math.max(a, b) > edgeAfterLane;
    };
    for (const [id, pl] of plans) {
      if (pl.type !== 'skip' && pl.type !== 'back') continue;
      const lo = Math.min(pl.rs, pl.rt - 1);
      const hi = Math.max(pl.rs, pl.rt - 1);
      const targetLane = byId.get(ir.flows.find((f) => f.id === id).to).lane;
      const candidates = [[pl.lane, 'R'], [pl.lane, 'L'], [targetLane, 'R'], [targetLane, 'L']];
      let best;
      for (const [lane, side] of candidates) {
        const edge = side === 'R' ? laneIndex.get(lane) : laneIndex.get(lane) - 1;
        let score = 0;
        for (const f of ir.flows) {
          const q = plans.get(f.id);
          if (f.id === id || q.type !== 'adjacent' || q.rs < lo || q.rs > hi || !laneSpanCovers(f, edge)) continue;
          score += q.rs === lo || q.rs === hi ? 1 : 2;
        }
        if (!best || score < best.score) best = { lane, side, score };
      }
      // The score counts runs between lanes only. Where it cannot tell the two sides of a
      // lane apart, the caller tries the other one and keeps it when fewer flows cross.
      const forced = sides.get(id);
      pl.gutterLane = best.lane;
      pl.side = forced ?? best.side;
    }
    for (const pl of plans.values()) {
      if (pl.type === 'adjacent') claim(gapTracks, pl.rs, pl.key);
      if (pl.type === 'column') claim(gapTracks, pl.rt - 1, pl.key);
      if (pl.type === 'skip' || pl.type === 'back') {
        claim(gapTracks, pl.rs, pl.key);
        claim(gutterTracks, `${pl.gutterLane}:${pl.side}`, pl.key);
        claim(gapTracks, pl.rt - 1, pl.key);
      }
    }
    const gutterWidth = (laneId, side) => {
      const n = gutterTracks.get(`${laneId}:${side}`)?.length ?? 0;
      return side === 'R' ? Math.max(m.gutterMin, m.trackPitch * (n + 1)) : (n === 0 ? 0 : m.trackPitch * (n + 1));
    };
    // A gap whose tracks hold a guarded fan-out keeps extra room below the last track: the
    // branch that goes straight on needs a private stretch below the last split for its guard.
    // In a left-to-right diagram the guard's text lies along that stretch, so the room grows
    // with the widest guard of the fan-out.
    const guardRoom = new Map(); // gap index -> extra room
    for (const f of ir.flows) {
      const pl = plans.get(f.id);
      if (!f.guard || pl.type !== 'adjacent') continue;
      if (!ir.flows.some((o) => o !== f && o.from === f.from && plans.get(o.id).type !== 'self')) continue;
      const room = horizontal ? Math.max(m.guardRoom, guardBox(f.guard, horizontal).height + GUARD_CLEAR + 6) : m.guardRoom;
      guardRoom.set(pl.rs, Math.max(guardRoom.get(pl.rs) ?? 0, room));
    }
    const trackSpan = (g) => Math.max(m.rowGapMin, m.trackPitch * ((gapTracks.get(g)?.length ?? 0) + 1));
    const gapHeight = (g) => trackSpan(g) + (guardRoom.get(g) ?? 0);

    // Cells per (lane, row).
    const cell = new Map();
    for (const id of order) {
      const key = `${byId.get(id).lane}#${row.get(id)}`;
      if (!cell.has(key)) cell.set(key, []);
      cell.get(key).push(id);
    }
    const rowHeight = Array.from({ length: rowCount }, (_, r) => Math.max(...order.filter((id) => row.get(id) === r).map((id) => byId.get(id).height), 0));
    const rowTop = [];
    let y = m.topMargin + m.headerHeight + m.topGap;
    for (let r = 0; r < rowCount; r++) {
      rowTop.push(y);
      y += rowHeight[r] + (r < rowCount - 1 ? gapHeight(r) : 0);
    }
    const height = y + m.bottomGap - m.topMargin;

    // Horizontal positions, lane by lane, in the lane's own coordinates first. Each node wants
    // to sit under the average x of the flows that reach it straight from the same lane (an
    // adjacent row, or a long flow in its own column), so chains run straight and a fan-out
    // stays centred on its source; a node fed only from other lanes, or from nothing, is
    // centred in the lane. A long flow that arrives down a gutter counts at the lane's edge
    // instead, but only when nothing arrives straight, or when every straight arrival is a
    // decision's branch: a trunk joining that branch would read as another exit of the
    // decision, so the node moves to the trunk's side and its inputs meet above it. Otherwise
    // the trunk only breaks ties: nodes that share a row are sorted by wanted x, then towards
    // the side their trunks come from, so a merge fed from the left sits left of its sibling
    // and the trunk reaches it without crossing. The row is then packed so nodes do not
    // overlap and slid together by the mean distance to the wanted positions, and the lane is
    // made as wide as its content needs, so nothing is clamped.
    const kindOf = new Map((ir.controls ?? []).map((c) => [c.id, c.kind]));
    const rel = new Map(); // id -> x in lane coordinates (0 = centre of rows without predecessors)
    const laneExtent = new Map(); // lane id -> { min, max }
    for (const l of ir.lanes) {
      let min = Infinity;
      let max = -Infinity;
      for (let r = 0; r < rowCount; r++) {
        const ids = cell.get(`${l.id}#${r}`) ?? [];
        if (ids.length === 0) continue;
        const want = new Map();
        const lean = new Map(ids.map((id) => [id, 0]));
        for (const id of ids) {
          const straight = [];
          const trunk = [];
          for (const f of ir.flows) {
            if (f.to !== id || !rel.has(f.from) || back.has(`${f.from}>${id}`) || byId.get(f.from).lane !== l.id) continue;
            const pl = plans.get(f.id);
            if (pl.type === 'skip') {
              // The rows above are placed, so the lane's extent so far says where each gutter is.
              const side = pl.gutterLane === l.id ? pl.side : laneIndex.get(pl.gutterLane) < laneIndex.get(l.id) ? 'L' : 'R';
              trunk.push(side === 'L' ? min - m.lanePadding : max + m.lanePadding);
              lean.set(id, lean.get(id) + (side === 'L' ? -1 : 1));
            } else {
              straight.push({ x: rel.get(f.from) + byId.get(f.from).width / 2, fromDecision: kindOf.get(f.from) === 'decision' });
            }
          }
          const arrivals = straight.map((a) => a.x);
          if (straight.every((a) => a.fromDecision)) arrivals.push(...trunk);
          if (arrivals.length) want.set(id, arrivals.reduce((a, b) => a + b, 0) / arrivals.length - byId.get(id).width / 2);
          // A flow that leaves straight for another lane also breaks the tie: its run crosses
          // the gap towards that lane, so the node wants the side of its row-mates nearest
          // that lane and the run cuts none of their columns. A long flow says nothing: it
          // goes down its own column when that is free, which a sibling's run must not span,
          // so the sibling's side decides. A flow that stays in the lane says nothing either,
          // as its target is placed only after this row.
          for (const f of ir.flows) {
            if (f.from !== id || plans.get(f.id).type !== 'adjacent' || byId.get(f.to).lane === l.id) continue;
            lean.set(id, lean.get(id) + (laneIndex.get(byId.get(f.to).lane) < laneIndex.get(l.id) ? -1 : 1));
          }
        }
        const total = ids.reduce((sum, id) => sum + byId.get(id).width, 0) + (ids.length - 1) * m.nodeGap;
        if (want.size === 0) {
          let nx = -total / 2;
          for (const id of ids) { rel.set(id, nx); nx += byId.get(id).width + m.nodeGap; }
        } else {
          const fallback = [...want.values()].reduce((a, b) => a + b, 0) / want.size;
          const centre = (n) => n.w + byId.get(n.id).width / 2;
          const sorted = ids.map((id, i) => ({ id, i, w: want.get(id) ?? fallback })).sort((a, b) => (Math.abs(centre(a) - centre(b)) > 0.5 ? centre(a) - centre(b) : 0) || lean.get(a.id) - lean.get(b.id) || a.i - b.i);
          let nx = -Infinity;
          for (const n of sorted) { n.x = Math.max(nx, n.w); nx = n.x + byId.get(n.id).width + m.nodeGap; }
          // Slide by the node's error nearest the mean error, so one node sits exactly where it wants.
          const mean = sorted.reduce((sum, n) => sum + (n.w - n.x), 0) / sorted.length;
          const shift = sorted.map((n) => n.w - n.x).sort((a, b) => Math.abs(a - mean) - Math.abs(b - mean) || a - b)[0];
          for (const n of sorted) rel.set(n.id, n.x + shift);
        }
        for (const id of ids) { min = Math.min(min, rel.get(id)); max = Math.max(max, rel.get(id) + byId.get(id).width); }
      }
      laneExtent.set(l.id, Number.isFinite(min) ? { min, max } : { min: 0, max: 0 });
    }
    const laneWidth = ir.lanes.map((l) => {
      const { min, max } = laneExtent.get(l.id);
      return Math.max(m.minLaneWidth, max - min + 2 * m.lanePadding + gutterWidth(l.id, 'R') + gutterWidth(l.id, 'L'));
    });

    const lanes = [];
    let x = m.leftMargin;
    ir.lanes.forEach((l, i) => {
      lanes.push({ id: l.id, index: i, x, y: m.topMargin, width: laneWidth[i], height });
      x += laneWidth[i];
    });
    const laneBox = (id) => lanes[laneIndex.get(id)];

    const nodes = new Map();
    const centerX = (id) => { const b = nodes.get(id); return b.x + b.width / 2; };
    for (const l of ir.lanes) {
      const box = laneBox(l.id);
      const { min, max } = laneExtent.get(l.id);
      const innerLeft = box.x + gutterWidth(l.id, 'L') + m.lanePadding;
      const innerWidth = box.width - 2 * m.lanePadding - gutterWidth(l.id, 'L') - gutterWidth(l.id, 'R');
      const offset = innerLeft - min + (innerWidth - (max - min)) / 2;
      for (const id of order) {
        if (byId.get(id).lane !== l.id) continue;
        const n = byId.get(id);
        const r = row.get(id);
        nodes.set(id, { x: rel.get(id) + offset, y: rowTop[r] + (rowHeight[r] - n.height) / 2, width: n.width, height: n.height, lane: l.id, row: r });
      }
    }


    // Track coordinates. A gutter's tracks are ordered by the row of their target. A gap's
    // tracks are ordered so that no horizontal run is crossed by the vertical of another
    // track: every run in the gap has verticals at its two ends, each going up (towards the
    // row above, or up the gutter) or down. A vertical going up at x must belong to a track
    // above every other track whose run spans x; one going down, to a track below it. The
    // tracks are sorted topologically under those constraints, by target x otherwise; a
    // constraint cycle means a crossing nothing can avoid, which the self-check below reports.
    const targetX = (key) => centerX(key.slice(3));
    const targetRow = (key) => row.get(key.slice(3));
    for (const list of gutterTracks.values()) list.sort((a, b) => targetRow(a) - targetRow(b));
    const gutterX = (pl) => {
      const box = laneBox(pl.gutterLane);
      const list = gutterTracks.get(`${pl.gutterLane}:${pl.side}`) ?? [];
      const i = Math.max(list.indexOf(pl.key), 0);
      const w = gutterWidth(pl.gutterLane, pl.side);
      const left = pl.side === 'L' ? box.x : box.x + box.width - w;
      return left + (w * (i + 1)) / (list.length + 1);
    };
    for (const [g, list] of gapTracks) {
      const runs = []; // { key, verticals: [{ x, up }] }
      for (const f of ir.flows) {
        const pl = plans.get(f.id);
        if (pl.type === 'self') continue;
        const sx = centerX(f.from);
        const tx = centerX(f.to);
        const gx = pl.type === 'adjacent' || pl.type === 'column' || pl.type === 'self' ? undefined : gutterX(pl);
        if (pl.type === 'adjacent' && pl.rs === g && Math.abs(sx - tx) > 0.5) runs.push({ key: pl.key, verticals: [{ x: sx, up: true }, { x: tx, up: false }] });
        if (pl.type === 'column' && pl.rt - 1 === g && Math.abs(sx - tx) > 0.5) runs.push({ key: pl.key, verticals: [{ x: sx, up: true }, { x: tx, up: false }] });
        if (pl.type === 'skip' && pl.rs === g) runs.push({ key: pl.key, verticals: [{ x: sx, up: true }, { x: gx, up: false }] });
        if (pl.type === 'skip' && pl.rt - 1 === g) runs.push({ key: pl.key, verticals: [{ x: gx, up: true }, { x: tx, up: false }] });
        if (pl.type === 'back' && pl.rs === g) runs.push({ key: pl.key, verticals: [{ x: sx, up: true }, { x: gx, up: true }] });
        if (pl.type === 'back' && pl.rt - 1 === g) runs.push({ key: pl.key, verticals: [{ x: gx, up: false }, { x: tx, up: false }] });
      }
      const before = new Map(list.map((k) => [k, new Set()]));
      for (const a of runs) for (const b of runs) {
        if (a.key === b.key) continue;
        const lo = Math.min(b.verticals[0].x, b.verticals[1].x);
        const hi = Math.max(b.verticals[0].x, b.verticals[1].x);
        for (const v of a.verticals) {
          const inside = v.x > lo + 0.5 && v.x < hi - 0.5;
          // At an endpoint of b, verticals in the same direction share a trunk or a merge; in
          // opposite directions they would overlap unless ordered.
          const atEnd = b.verticals.some((w) => Math.abs(w.x - v.x) <= 0.5 && w.up !== v.up);
          if (!inside && !atEnd) continue;
          if (v.up) before.get(b.key).add(a.key); else before.get(a.key).add(b.key);
        }
      }
      const sorted = [];
      const remaining = new Set(list);
      while (remaining.size > 0) {
        const ready = [...remaining].filter((k) => [...before.get(k)].every((d) => !remaining.has(d)));
        const pool = ready.length > 0 ? ready : [...remaining];
        pool.sort((a, b) => targetX(a) - targetX(b));
        sorted.push(pool[0]);
        remaining.delete(pool[0]);
      }
      list.splice(0, list.length, ...sorted);
    }
    // A guarded branch that goes straight down to a node other flows also reach: they join it
    // on the track of that node. In its usual place that track lies above the room kept for
    // the guard, so the guard would stand below the join and read as the guard of the joined
    // flow. When the track is the lowest of its gap anyway, it moves below that room, and the
    // branch keeps a stretch of its own for the guard between the last split and the join.
    const lateJoin = new Map(); // gap index -> track key
    for (const f of ir.flows) {
      const pl = plans.get(f.id);
      if (!f.guard || pl.type !== 'adjacent' || !guardRoom.has(pl.rs)) continue;
      if (Math.abs(centerX(f.from) - centerX(f.to)) > 0.5) continue;
      if (!ir.flows.some((o) => o !== f && o.from === f.from && plans.get(o.id).type !== 'self')) continue;
      if ((gapTracks.get(pl.rs) ?? []).at(-1) === pl.key) lateJoin.set(pl.rs, pl.key);
    }
    const gapY = (g, key) => {
      const top = rowTop[g] + rowHeight[g];
      const list = gapTracks.get(g) ?? [];
      const i = Math.max(list.indexOf(key), 0);
      if (lateJoin.get(g) === key) return top + gapHeight(g) - m.joinClear;
      return top + (trackSpan(g) * (i + 1)) / (list.length + 1);
    };
    const gapAboveY = (r, key) => (r === 0 ? m.topMargin + m.headerHeight + m.topGap / 2 : gapY(r - 1, key));

    const edges = new Map();
    for (const f of ir.flows) {
      const s = nodes.get(f.from);
      const t = nodes.get(f.to);
      const plan = plans.get(f.id);
      const sx = s.x + s.width / 2;
      const tx = t.x + t.width / 2;
      const points = [];
      let exit = { x: 0.5, y: 1 };
      let entry = { x: 0.5, y: 0 };
      switch (plan.type) {
        case 'self': {
          const side = s.x + s.width + m.nodeGap / 2;
          points.push({ x: side, y: s.y + s.height / 2 }, { x: side, y: gapY(plan.rs, plan.key) }, { x: sx, y: gapY(plan.rs, plan.key) });
          break;
        }
        case 'adjacent': {
          if (Math.abs(sx - tx) > 0.5) {
            const gy = gapY(plan.rs, plan.key);
            points.push({ x: sx, y: gy }, { x: tx, y: gy });
          }
          break;
        }
        case 'column': {
          // Straight down the source's own column, which is free, then across to the target
          // on the track of the gap above it, where flows into the same target merge.
          if (Math.abs(sx - tx) > 0.5) {
            const ay = gapAboveY(plan.rt, plan.key);
            points.push({ x: sx, y: ay }, { x: tx, y: ay });
          }
          break;
        }
        case 'skip':
        case 'back': {
          const gy = gapY(plan.rs, plan.key);
          const gx = gutterX(plan);
          const ay = gapAboveY(plan.rt, plan.key);
          points.push({ x: sx, y: gy }, { x: gx, y: gy }, { x: gx, y: ay }, { x: tx, y: ay });
          break;
        }
        default:
          break;
      }
      edges.set(f.id, { points, exit, entry });
    }
    return { plans, lanes, nodes, edges, rowTop, rowHeight, height, right: x };

  };

  // A long flow goes straight down its own column when nothing is in the way: no node of
  // any lane in the rows it passes, and no horizontal run of another flow in the gaps it
  // crosses whole. Decide from one arrangement, arrange again, and repeat until stable.
  const freeColumns = (A) => {
    const free = new Set();
    for (const f of ir.flows) {
      const pl = A.plans.get(f.id);
      if (pl.type !== 'skip' && pl.type !== 'column') continue;
      const s = A.nodes.get(f.from);
      const sx = s.x + s.width / 2;
      const top = s.y + s.height;
      const bottom = A.rowTop[pl.rt - 1] + A.rowHeight[pl.rt - 1];
      let blocked = false;
      for (const n of A.nodes.values()) {
        if (n.row <= pl.rs || n.row >= pl.rt) continue;
        if (n.x - 8 < sx && sx < n.x + n.width + 8) { blocked = true; break; }
      }
      if (!blocked) {
        for (const o of ir.flows) {
          if (o.id === f.id) continue;
          const e = A.edges.get(o.id);
          const so = A.nodes.get(o.from);
          const to = A.nodes.get(o.to);
          const path = [{ x: so.x + e.exit.x * so.width, y: so.y + e.exit.y * so.height }, ...e.points, { x: to.x + e.entry.x * to.width, y: to.y + e.entry.y * to.height }];
          for (let i = 1; i < path.length && !blocked; i++) {
            const a = path[i - 1];
            const b = path[i];
            if (Math.abs(a.y - b.y) > 0.5 || a.y <= top + 0.5 || a.y >= bottom - 0.5) continue;
            if (Math.min(a.x, b.x) + 0.5 < sx && sx < Math.max(a.x, b.x) - 0.5) blocked = true;
          }
          if (blocked) break;
        }
      }
      if (!blocked) free.add(f.id);
    }
    return free;
  };
  /** The arrangement for one choice of gutter sides, with the long flows that can run down their own column. */
  const settle = (sides) => {
    let columns = new Set();
    let arranged = arrange(columns, sides);
    for (let pass = 0; pass < 3; pass++) {
      const next = freeColumns(arranged);
      if (next.size === columns.size && [...next].every((id) => columns.has(id))) break;
      columns = next;
      arranged = arrange(columns, sides);
    }
    // Keep only columns that are still free in the final arrangement.
    const still = freeColumns(arranged);
    if ([...columns].some((id) => !still.has(id))) {
      columns = new Set([...columns].filter((id) => still.has(id)));
      arranged = arrange(columns, sides);
    }
    return arranged;
  };
  /** The segments of every flow of an arrangement, and how many pairs of flows cross in it. */
  const segmentsOf = (A) => {
    const list = [];
    for (const f of ir.flows) {
      const s = A.nodes.get(f.from);
      const t = A.nodes.get(f.to);
      const e = A.edges.get(f.id);
      const path = [{ x: s.x + e.exit.x * s.width, y: s.y + e.exit.y * s.height }, ...e.points, { x: t.x + e.entry.x * t.width, y: t.y + e.entry.y * t.height }];
      for (let i = 1; i < path.length; i++) list.push({ id: f.id, a: path[i - 1], b: path[i] });
    }
    return list;
  };
  const crossingsOf = (A) => {
    const list = segmentsOf(A);
    const pairs = new Set();
    for (const p of list) {
      if (Math.abs(p.a.y - p.b.y) > 0.5) continue;
      for (const q of list) {
        if (p.id === q.id || Math.abs(q.a.x - q.b.x) > 0.5) continue;
        if (q.a.x > Math.min(p.a.x, p.b.x) + 0.5 && q.a.x < Math.max(p.a.x, p.b.x) - 0.5 && p.a.y > Math.min(q.a.y, q.b.y) + 0.5 && p.a.y < Math.max(q.a.y, q.b.y) - 0.5) pairs.add([p.id, q.id].sort().join('|'));
      }
    }
    return pairs.size;
  };
  // A long flow takes the right gutter of its lane unless a run between lanes speaks against
  // it. Inside one lane nothing does, and a branch on the left of its row then goes round the
  // far right across its siblings. While flows cross, each long flow that goes down a gutter
  // is tried on the other side of that lane, and the side with fewer crossings is kept.
  const sides = new Map();
  let arranged = settle(sides);
  let crossings = crossingsOf(arranged);
  if (crossings > 0) {
    const long = ir.flows.filter((f) => ['skip', 'back'].includes(arranged.plans.get(f.id).type)).slice(0, 12);
    for (const f of long) {
      if (crossings === 0) break;
      const now = arranged.plans.get(f.id);
      if (now.type !== 'skip' && now.type !== 'back') continue;
      const trial = new Map(sides).set(f.id, now.side === 'R' ? 'L' : 'R');
      const other = settle(trial);
      const count = crossingsOf(other);
      if (count < crossings) { sides.set(f.id, trial.get(f.id)); arranged = other; crossings = count; }
    }
  }
  const { lanes, nodes, edges, height, right: x } = arranged;
  const warnings = [];

  // Structural hints: a merge needs two incoming flows and a decision two outgoing ones.
  for (const c of ir.controls ?? []) {
    const ins = inn.get(c.id).filter((p) => p !== c.id).length;
    const outs = out.get(c.id).filter((t) => t !== c.id).length;
    const path = `/controls/${ir.controls.indexOf(c)}`;
    if (c.kind === 'merge' && ins < 2) warnings.push({ path, message: `merge "${c.id}" has ${ins} incoming flow(s); a merge joins two or more branches, so remove it or connect the other branch` });
    if (c.kind === 'decision' && outs < 2) warnings.push({ path, message: `decision "${c.id}" has ${outs} outgoing flow(s); a decision needs at least two guarded branches` });
    if (c.kind === 'join' && ins < 2) warnings.push({ path, message: `join "${c.id}" has ${ins} incoming flow(s); a join waits for two or more parallel branches` });
    if (c.kind === 'fork' && outs < 2) warnings.push({ path, message: `fork "${c.id}" has ${outs} outgoing flow(s); a fork starts two or more parallel branches` });
  }

  // Self-check: segments of edges with different targets must not overlap.
  const segments = [];
  const paths = new Map();
  for (const f of ir.flows) {
    const s = nodes.get(f.from);
    const t = nodes.get(f.to);
    const e = edges.get(f.id);
    const start = { x: s.x + e.exit.x * s.width, y: s.y + e.exit.y * s.height };
    const end = { x: t.x + e.entry.x * t.width, y: t.y + e.entry.y * t.height };
    const path = [start, ...e.points, end];
    paths.set(f.id, path);
    for (let i = 1; i < path.length; i++) segments.push({ id: f.id, from: f.from, to: f.to, first: i === 1, a: path[i - 1], b: path[i] });
  }
  const shared = new Set();
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const p = segments[i];
      const q = segments[j];
      // Edges that merge into one target may share their approach; edges that fan out of one
      // source share the trunk that leaves it. Anything else on one line is misleading.
      if (p.id === q.id || p.to === q.to || (p.from === q.from && p.first && q.first)) continue;
      const pH = Math.abs(p.a.y - p.b.y) < 0.5;
      const qH = Math.abs(q.a.y - q.b.y) < 0.5;
      if (pH && qH && Math.abs(p.a.y - q.a.y) < 0.5 && Math.min(p.a.x, p.b.x) < Math.max(q.a.x, q.b.x) - 0.5 && Math.min(q.a.x, q.b.x) < Math.max(p.a.x, p.b.x) - 0.5) shared.add(`${p.id}|${q.id}`);
      const pV = Math.abs(p.a.x - p.b.x) < 0.5;
      const qV = Math.abs(q.a.x - q.b.x) < 0.5;
      if (pV && qV && Math.abs(p.a.x - q.a.x) < 0.5 && Math.min(p.a.y, p.b.y) < Math.max(q.a.y, q.b.y) - 0.5 && Math.min(q.a.y, q.b.y) < Math.max(p.a.y, p.b.y) - 0.5) shared.add(`${p.id}|${q.id}`);
    }
  }
  for (const pair of shared) {
    const [a, b] = pair.split('|');
    warnings.push({ path: '/flows', message: `layout: flows "${a}" and "${b}" run along the same line although they lead to different targets; reorder the flows or move a node to another lane` });
  }
  // Self-check: a horizontal segment of one flow must not cut through a vertical of another.
  const crossing = new Set();
  for (const p of segments) {
    if (Math.abs(p.a.y - p.b.y) > 0.5) continue;
    for (const q of segments) {
      if (p.id === q.id || Math.abs(q.a.x - q.b.x) > 0.5) continue;
      const x = q.a.x;
      const y = p.a.y;
      if (x > Math.min(p.a.x, p.b.x) + 0.5 && x < Math.max(p.a.x, p.b.x) - 0.5 && y > Math.min(q.a.y, q.b.y) + 0.5 && y < Math.max(q.a.y, q.b.y) - 0.5) {
        crossing.add([p.id, q.id].sort().join('|'));
      }
    }
  }
  // A crossing between flows whose four nodes share one lane is not forced by the lanes: it is
  // a column order the layout did not find, so its hint says so instead of blaming the lanes.
  for (const pair of crossing) {
    const [a, b] = pair.split('|');
    const lanesOf = [a, b].flatMap((id) => { const f = ir.flows.find((x) => x.id === id); return [byId.get(f.from).lane, byId.get(f.to).lane]; });
    const oneLane = lanesOf.every((lane) => lane === lanesOf[0]);
    warnings.push(oneLane
      ? { path: '/flows', message: `layout: flows "${a}" and "${b}" cross inside lane "${lanesOf[0]}"; no column order that avoids it was found`, hint: ir.lanes.length > 1
        ? 'the lanes do not force this crossing; moving one of the nodes to another lane avoids it, and nodes that share a row keep their order in `actions` and `controls`, so reordering those can move it'
        : 'nodes that share a row keep their order in `actions` and `controls`, so reordering those can move it; a branch that ends the flow can also take a final node of its own instead of a long line to a shared merge' }
      : { path: '/flows', message: `layout: flows "${a}" and "${b}" cross; no route around it was found, so the crossing is drawn with a line jump`, hint: 'a crossing that the lanes of the nodes force can be accepted: the jump shows that the two lines do not meet; reordering flows does not change the route, but nodes that share a row of one lane keep their order in `actions` and `controls` when nothing else separates them, so reordering those can move it' });
  }

  // Guard labels: greedy placement over candidate anchors, avoiding nodes and other labels.
  const obstacles = [...nodes.values()].map((b) => ({ x: b.x - 4, y: b.y - 4, width: b.width + 8, height: b.height + 8 }));
  // The lines of other flows are obstacles too, so a guard never sits on an arrow it does not belong to.
  const lineBoxes = segments.map((sg) => ({ id: sg.id, x: Math.min(sg.a.x, sg.b.x) - 2, y: Math.min(sg.a.y, sg.b.y) - 2, width: Math.abs(sg.a.x - sg.b.x) + 4, height: Math.abs(sg.a.y - sg.b.y) + 4 }));
  // Written along the flow (a left-to-right diagram), a guard is one line of text deep beside
  // its line, and that fits between a gutter run and the content of its lane but not between
  // the run and the lane's border, so there the borders are obstacles as well. Written across
  // the flow, a guard beside a gutter run reaches over the border whichever side it takes.
  const borders = horizontal ? lanes.flatMap((l) => [l.x, l.x + l.width].map((bx) => ({ x: bx - 1, y: l.y, width: 2, height: l.height }))) : [];
  const placed = [];
  const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  for (const f of ir.flows) {
    if (!f.guard) continue;
    const s = nodes.get(f.from);
    const t = nodes.get(f.to);
    const e = edges.get(f.id);
    // The part of the first segment that sibling flows (same source) run along is the shared
    // trunk: a guard there would read as the guard of every branch, so it is an obstacle too.
    const first = segments.find((sg) => sg.id === f.id && sg.first);
    const trunkLen = Math.max(0, ...segments.filter((sg) => sg.first && sg.id !== f.id && sg.from === f.from).map((sg) => sharedPrefix(first, sg)));
    const trunkBox = trunkLen > 0 ? { x: Math.min(first.a.x, first.a.x + Math.sign(first.b.x - first.a.x) * trunkLen) - 2, y: Math.min(first.a.y, first.a.y + Math.sign(first.b.y - first.a.y) * trunkLen) - 2, width: (Math.abs(first.b.x - first.a.x) > 0.5 ? trunkLen : 0) + 4, height: (Math.abs(first.b.y - first.a.y) > 0.5 ? trunkLen : 0) + 4 } : null;
    // The tail that flows from other sources run along on their way into the same target is
    // shared the same way: a guard there would read as the guard of whatever arrives on it.
    const mergeLen = Math.max(0, ...ir.flows.filter((o) => o.to === f.to && o.from !== f.from).map((o) => sharedSuffix(paths.get(f.id), paths.get(o.id))));
    const candidates = labelCandidates(s, t, e, f.guard, trunkLen, mergeLen, horizontal);
    const blocked = (box) => obstacles.some((o) => overlaps(box, o)) || placed.some((o) => overlaps(box, o.box)) || lineBoxes.some((o) => o.id !== f.id && overlaps(box, o)) || borders.some((o) => overlaps(box, o)) || (trunkBox && overlaps(box, trunkBox));
    const pick = candidates.find((c) => !blocked(c.box)) ?? candidates[0];
    if (pick === candidates[0] && blocked(pick.box)) {
      warnings.push({ path: `/flows/${ir.flows.indexOf(f)}/guard`, message: `layout: guard "${f.guard}" of flow "${f.id}" overlaps another label or node; shorten it or reorder the flows` });
    }
    placed.push({ id: f.id, box: pick.box });
    e.label = { position: pick.position, offset: pick.offset };
  }

  const width = x + m.leftMargin;
  const result = { lanes, nodes, edges, width, height: height + 2 * m.topMargin, horizontal, warnings };
  return horizontal ? transpose(result) : result;
}

/**
 * Extents of a guard's text in the layout's own coordinates, and its gap to a line beside it
 * (`sideGap`) and to a line below it (`aboveGap`). The text is drawn horizontally whatever
 * the direction, and a left-to-right diagram is this layout transposed: there the text's
 * width lies along y and its height across x. The gaps follow the drawing too: 6 px where
 * text and line end up side by side, 2 px where the text ends up above or below the line.
 */
function guardBox(guard, horizontal) {
  const textWidth = Math.ceil(widestLine(guard)) + 12;
  const textHeight = 16;
  return horizontal
    ? { width: textHeight, height: textWidth, sideGap: 2, aboveGap: 6 }
    : { width: textWidth, height: textHeight, sideGap: 6, aboveGap: 2 };
}

/** Length of the colinear prefix two segments share when they start at the same point. */
function sharedPrefix(p, q) {
  if (Math.abs(p.a.x - q.a.x) > 0.5 || Math.abs(p.a.y - q.a.y) > 0.5) return 0;
  const dp = { x: Math.sign(p.b.x - p.a.x), y: Math.sign(p.b.y - p.a.y) };
  const dq = { x: Math.sign(q.b.x - q.a.x), y: Math.sign(q.b.y - q.a.y) };
  if (dp.x !== dq.x || dp.y !== dq.y) return 0;
  const len = (sg) => Math.abs(sg.b.x - sg.a.x) + Math.abs(sg.b.y - sg.a.y);
  return Math.min(len(p), len(q));
}

/** Length of the tail two paths run along together when they end at the same point. */
function sharedSuffix(p, q) {
  const dir = (d) => (Math.abs(d) < 0.5 ? 0 : Math.sign(d));
  let shared = 0;
  for (let i = p.length - 1, j = q.length - 1; i > 0 && j > 0; i--, j--) {
    if (Math.abs(p[i].x - q[j].x) > 0.5 || Math.abs(p[i].y - q[j].y) > 0.5) break;
    const dp = { x: p[i - 1].x - p[i].x, y: p[i - 1].y - p[i].y };
    const dq = { x: q[j - 1].x - q[j].x, y: q[j - 1].y - q[j].y };
    if (dir(dp.x) !== dir(dq.x) || dir(dp.y) !== dir(dq.y) || (dir(dp.x) !== 0 && dir(dp.y) !== 0)) break;
    const lp = Math.abs(dp.x) + Math.abs(dp.y);
    const lq = Math.abs(dq.x) + Math.abs(dq.y);
    shared += Math.min(lp, lq);
    if (Math.abs(lp - lq) > 0.5) break;
  }
  return shared;
}

/**
 * Candidate places for a guard label, best first: above the horizontal run just before it
 * turns toward the target or meets a flow from another source, beside the private part of
 * the segment leaving the source (below the shared trunk of a fan-out, `trunkLen` from the
 * start, and above the tail shared with other flows into the target, `mergeLen` from the
 * end), beside the last vertical segment above the target, and beside the gutter run of a
 * long route; each on the right and on the left. Every candidate carries its absolute box
 * (for collision checks) and draw.io edge-label geometry (relative position along the path
 * plus a pixel offset).
 *
 * In a left-to-right diagram the order differs, because once transposed the sides of a
 * segment are above and below a stretch along the flow, where a guard reads best: those
 * places come first, the side that ends up above the line before the other, and the ones
 * beside a run across the lanes come last.
 */
function labelCandidates(s, t, e, guard, trunkLen = 0, mergeLen = 0, horizontal = false) {
  const { width, height, sideGap, aboveGap } = guardBox(guard, horizontal);
  const start = { x: s.x + e.exit.x * s.width, y: s.y + e.exit.y * s.height };
  const end = { x: t.x + e.entry.x * t.width, y: t.y + e.entry.y * t.height };
  const path = [start, ...e.points, end];
  const seg = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  let total = 0;
  for (let i = 1; i < path.length; i++) total += seg(path[i - 1], path[i]);
  const distTo = (index) => {
    let d = 0;
    for (let i = 1; i <= index; i++) d += seg(path[i - 1], path[i]);
    return d;
  };
  const anchors = [];
  const above = [];
  // Above each horizontal run, just before it turns toward the target: the natural place
  // for a guard, and unambiguous because the arrow it labels is right below it. A run that
  // another flow joins on its way into the target counts only up to that point.
  const privateEnd = total - mergeLen;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    if (Math.abs(a.y - b.y) > 0.5) continue;
    const run = Math.min(Math.abs(a.x - b.x), privateEnd - distTo(i - 1));
    if (run < width + 16) continue;
    const dir = Math.sign(b.x - a.x);
    const x = a.x + dir * (run - width / 2 - 8);
    const d = distTo(i - 1) + Math.abs(x - a.x);
    const offset = { x: 0, y: -(height / 2 + aboveGap) };
    above.push({ adrift: run < Math.abs(a.x - b.x) - 0.5 && d > GUARD_NEAR, position: (2 * d) / total - 1, offset, box: { x: x - width / 2, y: a.y + offset.y - height / 2, width, height } });
  }
  // An anchor never passes the end of the path: draw.io stops the label there, so the box
  // that is checked stays where the text is drawn also when the segment is shorter than the
  // text that lies along it.
  const push = (pointIndex, along) => {
    const p = path[pointIndex];
    const dy = Math.min(along, total - distTo(pointIndex));
    const d = distTo(pointIndex) + dy;
    anchors.push({ x: p.x, y: p.y + dy, position: total === 0 ? 0 : (2 * d) / total - 1 });
  };
  // Beside the first segment, in the middle of its private stretch: past the trunk shared
  // with siblings and before the point where flows into the same target join. The label is
  // at least GUARD_CLEAR below the sibling's turn and 6 px above the stretch's end, so it
  // reads as this branch's label and not as a second label of the sibling's horizontal run
  // or of the line the flows share. That holds for a branch that goes straight down and
  // then turns into a shared run as much as for one that ends right below its source.
  const firstLen = seg(path[0], path[1]);
  const middle = (room) => trunkLen + Math.min(Math.max(room / 2, height / 2 + GUARD_CLEAR), room - height / 2 - 6);
  const privateRoom = Math.min(firstLen, privateEnd) - trunkLen;
  if (privateRoom >= height + GUARD_CLEAR + 6) push(0, middle(privateRoom));
  // Without that much room a straight branch still takes the middle of what lies below the
  // trunk, and a branch that turns takes the spot right below the trunk.
  else if (e.points.length === 0) push(0, middle(firstLen - trunkLen));
  else if (trunkLen + height + 6 <= firstLen) push(0, trunkLen + height / 2 + 6);
  if (e.points.length > 0) {
    push(path.length - 2, height / 2 + 6);
    if (e.points.length >= 3) {
      const a = path[2];
      const b = path[3];
      const mid = { x: a.x, y: (a.y + b.y) / 2 };
      const d = distTo(2) + seg(a, mid);
      anchors.push({ x: mid.x, y: mid.y, position: (2 * d) / total - 1 });
    }
  }
  const beside = [];
  for (const a of anchors) {
    for (const side of horizontal ? [-1, 1] : [1, -1]) {
      const offset = { x: side * (width / 2 + sideGap), y: 0 };
      beside.push({ position: a.position, offset, box: { x: a.x + offset.x - width / 2, y: a.y - height / 2, width, height } });
    }
  }
  // Above a run is the first choice, with one exception. Where another flow joins the run on
  // its way, the place is right before that join; when that is also far along the flow (down
  // a lane and across two others), the guard stands next to the flow that comes in and far
  // from its own decision, and reads as the guard of the wrong one. There the private stretch
  // beside the first segment, next to the decision, comes first.
  const adrift = above.filter((c) => c.adrift);
  return horizontal ? [...beside, ...above] : [...above.filter((c) => !c.adrift), ...beside, ...adrift];
}

function transpose(r) {
  const flip = (b) => ({ ...b, x: b.y, y: b.x, width: b.height, height: b.width });
  return {
    ...r,
    lanes: r.lanes.map(flip),
    nodes: new Map([...r.nodes].map(([id, b]) => [id, flip(b)])),
    edges: new Map([...r.edges].map(([id, e]) => [id, { points: e.points.map((p) => ({ x: p.y, y: p.x })), exit: { x: e.exit.y, y: e.exit.x }, entry: { x: e.entry.y, y: e.entry.x }, label: e.label && { position: e.label.position, offset: { x: e.label.offset.y, y: e.label.offset.x } } }])),
    width: r.height,
    height: r.width,
  };
}
