import { vertex, edge, edgeLabel, envelope, envelopePages, htmlLabel, pageLink, cellsBounds, shiftCells } from './drawio-xml.mjs';
import { layoutGraph, measureNode, measureDecision, measureLabel } from './layout-graph.mjs';
import { layoutSequence } from './layout-sequence.mjs';
import { layoutActivity, LANE_PALETTE } from './layout-activity.mjs';
import { longestLine } from './text-metrics.mjs';

/**
 * Emit an uncompressed .drawio file with individually editable shapes. Graph-shaped kinds
 * are laid out by ELK; sequence diagrams use the deterministic grid. Cell ids are the IR ids
 * prefixed with the diagram id so a later multi-page mode can append pages without clashes.
 * @param {object} ir validated IR
 * @param {{ diagramId?: string, refs?: Map<string, { pageId: string, title: string }> }} [options]
 *   diagram id (and cell id prefix); defaults to a slug of the title, which is empty for
 *   non-Latin titles, so the CLI passes the output file name. `refs` maps the diagram ids of a
 *   bundle to their page id and title, so a `ref` can show the title and link to the page.
 * @returns {Promise<{ output: string, warnings: Array<{ path: string, message: string }> }>}
 */
export async function emitDrawio(ir, options = {}) {
  const page = await emitDrawioPage(ir, options);
  return { output: envelope(page), warnings: page.warnings };
}

/** Space kept for a diagram's title above it on a bundled page, and its left margin. */
const TITLE_BAND = 50;
const PAGE_MARGIN = 20;
const TITLE_STYLE = 'text;html=1;align=left;verticalAlign=middle;fontSize=16;fontStyle=1;strokeColor=none;fillColor=none;';

/**
 * Several diagrams in one file, one page per IR in the given order, each page named after
 * its diagram and headed by a title label placed above the content. With `canvas`, a first
 * page holds the listed diagrams side by side (left to right, top-aligned, `gap` px apart,
 * each under its own title) so a reader compares them without changing pages; the diagrams
 * still get their own pages after it, which is where page links from `ref` steps land. Cell
 * ids stay unique because every diagram uses its own id prefix.
 * @param {Array<{ ir: object, diagramId?: string }>} entries
 * @param {{ canvas?: string[], gap?: number, title?: string }} [options] `canvas` lists diagram ids in
 *   the order they go on the canvas page; `title` names that page
 */
export async function emitDrawioBundle(entries, options = {}) {
  const warnings = [];
  const ids = entries.map((entry, i) => entry.diagramId ?? `${slugify(entry.ir.title)}-${i + 1}`);
  const refs = bundleRefs(entries.map((entry, i) => ({ id: ids[i], ir: entry.ir })));
  const rendered = [];
  for (const [i, entry] of entries.entries()) {
    const page = await emitDrawioPage(entry.ir, { diagramId: ids[i], refs });
    rendered.push(page);
    warnings.push(...page.warnings.map((w) => ({ ...w, diagram: page.diagramId })));
  }
  // A diagram under its title: content starts at (x0 + margin, title band), whatever its own origin.
  const place = (page, x0) => {
    const b = cellsBounds(page.cells);
    const width = b.maxX - b.minX;
    const title = vertex({ id: `${page.diagramId}:title`, value: `<b>${htmlLabel(page.name)}</b>`, style: TITLE_STYLE, x: x0 + PAGE_MARGIN, y: 0, width: Math.max(measureNode(page.name).width + 40, width), height: 30, connectable: false });
    return { cells: [[...title], ...shiftCells(page.cells, x0 + PAGE_MARGIN - b.minX, TITLE_BAND - b.minY)], width };
  };
  const pages = [];
  if (options.canvas && options.canvas.length > 0) {
    const gap = options.gap ?? 120;
    const byId = new Map(rendered.map((p, i) => [ids[i], p]));
    const cells = [];
    let x = 0;
    for (const id of options.canvas) {
      const placed = place(byId.get(id), x);
      cells.push(...placed.cells);
      x += PAGE_MARGIN + placed.width + gap;
    }
    let canvasId = 'canvas';
    while (ids.includes(canvasId)) canvasId = `${canvasId}-1`;
    let name = options.title ?? 'Canvas';
    if (rendered.some((p) => p.name === name)) name = `${name} (canvas)`;
    pages.push({ diagramId: canvasId, name, cells });
  }
  for (const page of rendered) pages.push({ ...page, cells: place(page, 0).cells });
  return { output: envelopePages(pages), warnings };
}

/**
 * The ref table of a bundle: diagram id (what a `ref` names) to the page id and title that
 * the emitters show and link to.
 * @param {Array<{ id: string, ir: object }>} entries
 */
export function bundleRefs(entries) {
  return new Map(entries.map((e) => [e.id, { pageId: slugify(e.id), title: e.ir.title }]));
}

/**
 * Label and link for a step that references a sub-diagram. Inside a bundle the ref resolves
 * to the target's title and page link; a ref the bundle does not hold keeps the slug and is
 * reported. Outside a bundle (no `refs`) the slug is shown without a warning.
 */
function refLabel(label, ref, refs, path, warnings) {
  if (!ref) return { label, link: undefined };
  const target = refs?.get(ref);
  if (target) return { label: `${label}\n↳ ${target.title}`, link: pageLink(target.pageId) };
  if (refs) warnings.push({ path, message: `ref "${ref}" is not in this bundle: the step shows the slug and has no page link`, hint: 'bundle the referenced diagram too, or fix the ref' });
  return { label: `${label}\n↳ ${ref}`, link: undefined };
}

async function emitDrawioPage(ir, options = {}) {
  const warnings = [];
  const slug = options.diagramId ? slugify(options.diagramId) : slugify(ir.title);
  const cid = (id) => `${slug}:${id}`;
  const refs = options.refs;
  let cells;
  switch (ir.kind) {
    case 'flowchart': cells = await emitFlowchart(ir, cid, refs, warnings); break;
    case 'state': cells = await emitState(ir, cid); break;
    case 'er': cells = await emitEr(ir, cid, warnings); break;
    case 'class': cells = await emitClass(ir, cid, warnings); break;
    case 'architecture': cells = await emitArchitecture(ir, cid); break;
    case 'sequence': cells = emitSequence(ir, cid, warnings); break;
    case 'activity': cells = await emitActivity(ir, cid, warnings, refs); break;
    default: throw new Error(`unknown kind "${ir.kind}"`);
  }
  return { diagramId: slug, name: ir.title, cells, warnings };
}

export function slugify(title) {
  const s = String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/g, '');
  return s || 'diagram';
}

export const STYLE = {
  // flowchart
  process: 'whiteSpace=wrap;html=1;',
  terminal: 'rounded=1;whiteSpace=wrap;html=1;',
  decision: 'rhombus;whiteSpace=wrap;html=1;',
  io: 'shape=parallelogram;perimeter=parallelogramPerimeter;whiteSpace=wrap;html=1;fixedSize=1;',
  subroutine: 'shape=process;whiteSpace=wrap;html=1;backgroundOutline=1;',
  note: 'shape=note;whiteSpace=wrap;html=1;backgroundOutline=1;darkOpacity=0.05;size=14;',
  container: 'swimlane;whiteSpace=wrap;html=1;startSize=30;',
  flowEdge: 'edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;endArrow=classic;endFill=1;',
  // state
  initial: 'ellipse;html=1;shape=startState;fillColor=#000000;strokeColor=#000000;',
  final: 'ellipse;html=1;shape=endState;fillColor=#000000;strokeColor=#000000;',
  state: 'rounded=1;whiteSpace=wrap;html=1;arcSize=30;',
  composite: 'swimlane;whiteSpace=wrap;html=1;startSize=30;rounded=1;arcSize=10;',
  // er and class tables
  table: 'swimlane;fontStyle=1;align=center;verticalAlign=top;childLayout=stackLayout;horizontal=1;horizontalStack=0;resizeParent=1;resizeParentMax=0;resizeLast=0;collapsible=1;marginBottom=0;whiteSpace=wrap;html=1;',
  row: 'text;strokeColor=none;fillColor=none;align=left;verticalAlign=middle;spacingLeft=4;spacingRight=4;overflow=hidden;rotatable=0;points=[[0,0.5],[1,0.5]];portConstraint=eastwest;whiteSpace=wrap;html=1;',
  separator: 'line;strokeWidth=1;fillColor=none;align=left;verticalAlign=middle;spacingTop=-1;spacingLeft=3;spacingRight=3;rotatable=0;labelPosition=right;points=[];portConstraint=eastwest;strokeColor=inherit;',
  erEdge: 'edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;',
  classEdge: 'edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;',
  // architecture
  service: 'rounded=1;whiteSpace=wrap;html=1;',
  database: 'shape=cylinder3;whiteSpace=wrap;html=1;boundedLbl=1;backgroundOutline=1;size=15;',
  queue: 'shape=hexagon;perimeter=hexagonPerimeter2;whiteSpace=wrap;html=1;fixedSize=1;',
  cache: 'shape=cylinder3;whiteSpace=wrap;html=1;boundedLbl=1;backgroundOutline=1;size=15;dashed=1;',
  client: 'shape=umlActor;verticalLabelPosition=bottom;verticalAlign=top;html=1;outlineConnect=0;',
  external: 'rounded=1;whiteSpace=wrap;html=1;dashed=1;',
  // activity
  lane: 'swimlane;whiteSpace=wrap;html=1;startSize=40;fontStyle=1;',
  bar: 'rounded=0;whiteSpace=wrap;html=1;fillColor=#000000;strokeColor=#000000;',
  mergeNode: 'rhombus;whiteSpace=wrap;html=1;',
  // sequence
  lifeline: 'shape=umlLifeline;perimeter=lifelinePerimeter;whiteSpace=wrap;html=1;container=1;dropTarget=0;collapsible=0;recursiveResize=0;outlineConnect=0;portConstraint=eastwest;size=40;',
  actorGlyph: 'shape=umlActor;verticalLabelPosition=bottom;verticalAlign=top;html=1;outlineConnect=0;',
  activation: 'html=1;points=[];perimeter=orthogonalPerimeter;outlineConnect=0;targetShapes=umlLifeline;portConstraint=eastwest;',
  syncMessage: 'html=1;verticalAlign=bottom;endArrow=block;endFill=1;labelBackgroundColor=#ffffff;',
  asyncMessage: 'html=1;verticalAlign=bottom;endArrow=open;endFill=0;labelBackgroundColor=#ffffff;',
  returnMessage: 'html=1;verticalAlign=bottom;endArrow=open;endFill=0;dashed=1;labelBackgroundColor=#ffffff;',
  selfMessage: 'html=1;verticalAlign=bottom;endArrow=block;endFill=1;edgeStyle=orthogonalEdgeStyle;rounded=0;labelBackgroundColor=#ffffff;',
  frame: 'shape=umlFrame;whiteSpace=wrap;html=1;boundedLbl=1;verticalAlign=top;align=left;spacingLeft=5;',
  frameTabLabel: 'text;html=1;align=left;verticalAlign=middle;spacingLeft=4;resizable=0;fillColor=#ffffff;strokeColor=none;',
  frameSeparator: 'line;strokeWidth=1;dashed=1;html=1;',
  frameSeparatorLabel: 'text;html=1;align=left;verticalAlign=middle;spacingLeft=5;resizable=0;fillColor=#ffffff;strokeColor=none;',
  sequenceNote: 'shape=note;whiteSpace=wrap;html=1;backgroundOutline=1;darkOpacity=0.05;size=14;',
};

const CIRCLE = 30;
const round = (v) => Math.round(v * 1000) / 1000;

/**
 * Lifeline heads are plain boxes; the participant kind is shown as a stereotype line above
 * the label. draw.io's robustness glyphs (`participant=umlBoundary` and friends) stretch to
 * the lifeline width and read as stray arrows, and a umlActor head paints the label over the
 * figure, so the actor gets a separate glyph above its head instead.
 */
const LIFELINE_STEREOTYPE = { participant: null, actor: null, boundary: 'boundary', control: 'control', entity: 'entity', database: 'database' };
const ACTOR_GLYPH = { width: 30, height: 40, gap: 10 };

/** Shared path for the ELK-laid kinds: containers, nodes, edges with child labels. */
/**
 * Space a self-loop takes to the right of its node: the loop itself plus its label. ELK gets
 * the node this much wider on both sides (so edges still leave from the drawn centre) and the
 * shape is drawn centred in that box at its own width.
 */
const SELF_LOOP_OUT = 30;
/** A decision's rhombus style, with the label spacing that wraps a long question inside the diamond. */
const decisionStyle = (size) => (size.spacing > 0 ? `${STYLE.decision}spacingLeft=${size.spacing};spacingRight=${size.spacing};` : STYLE.decision);

const selfLoopLabelWidth = (label) => Math.ceil(longestLine(label) * 5.6) + 4;
const selfLoopExtra = (label) => SELF_LOOP_OUT + (label ? selfLoopLabelWidth(label) + 12 : 0) + 10;
const drawBox = (n, box) => (n.drawWidth === undefined ? box : { ...box, x: box.x + (box.width - n.drawWidth) / 2, width: n.drawWidth });

/**
 * draw.io geometry (relative position along the path, pixel offset, text alignment) that puts
 * an edge label where the layout engine placed it: the label centre is projected onto the
 * nearest point of the polyline and the position is that point's share of the path length.
 * Beside a vertical segment the text is left- or right-aligned at a 4 px gap, so its edge is
 * exact whatever the real text width; above or below a horizontal segment the offset uses
 * the line height, which is known.
 */
function labelGeometry(path, label, text) {
  const c = { x: label.x + label.width / 2, y: label.y + label.height / 2 };
  const real = { height: 16 * String(text).split(/\r\n?|\n/).length };
  let total = 0;
  const lengths = [];
  for (let i = 1; i < path.length; i++) { const l = Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y); lengths.push(l); total += l; }
  if (total === 0) return { position: 0, offset: { x: 0, y: 0 } };
  let best = { d: Infinity, along: 0, point: path[0] };
  let before = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const l = lengths[i - 1];
    const t = l === 0 ? 0 : Math.max(0, Math.min(1, ((c.x - a.x) * (b.x - a.x) + (c.y - a.y) * (b.y - a.y)) / (l * l)));
    const p = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
    const d = Math.hypot(c.x - p.x, c.y - p.y);
    if (d < best.d) best = { d, along: before + t * l, point: p };
    before += l;
  }
  const dx = c.x - best.point.x;
  const dy = c.y - best.point.y;
  const position = (2 * best.along) / total - 1;
  if (Math.abs(dx) >= Math.abs(dy)) {
    const side = Math.sign(dx || 1);
    return { position, offset: { x: side * LABEL_GAP, y: dy }, align: side > 0 ? 'left' : 'right' };
  }
  return { position, offset: { x: dx, y: Math.sign(dy || -1) * (real.height / 2 + LABEL_GAP) }, align: 'center' };
}
const LABEL_GAP = 4;

/**
 * An end label starts `gap` px past the end marker and sits `side` px beside the line; when
 * that place is taken it moves along the line in `step`s, up to `reach` px further.
 */
const END_LABEL = { gap: 6, side: 5, height: 16, step: 10, reach: 30 };
/** Half the width of an end marker (diamond, triangle), which labels stay clear of. */
const MARKER_HALF_WIDTH = 8;

/** The point `distance` px along a polyline from its first point, with the axis and sense of the segment it lies on. */
function pointAlong(path, distance) {
  let left = distance;
  let last = { point: path[0], vertical: true, dir: 1 };
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length < 0.5) continue;
    const vertical = Math.abs(b.y - a.y) >= Math.abs(b.x - a.x);
    const t = Math.min(left, length) / length;
    last = { point: { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) }, vertical, dir: Math.sign(vertical ? b.y - a.y : b.x - a.x) };
    if (left <= length) return last;
    left -= length;
  }
  return last;
}

/** The box an end marker of the given length covers at the first point of a path. */
function markerBox(path, length) {
  const { vertical, dir } = pointAlong(path, 1);
  const at = path[0];
  return vertical
    ? { x: at.x - MARKER_HALF_WIDTH, y: dir > 0 ? at.y : at.y - length, width: 2 * MARKER_HALF_WIDTH, height: length }
    : { x: dir > 0 ? at.x : at.x - length, y: at.y - MARKER_HALF_WIDTH, width: length, height: 2 * MARKER_HALF_WIDTH };
}

/**
 * Where a label that belongs to one end of an edge (a class cardinality) goes: just past the
 * marker of that end, beside the line. draw.io anchors such a label at the end point
 * (relative position -1 or 1) and adds an absolute pixel offset, so the place does not move
 * with the length of the path as a fraction of it would. The text is aligned away from its
 * anchor, so only the side it starts on has to be exact. The label follows the line, round a
 * bend when the first segment is shorter than the marker and the text; at each step both
 * sides are candidates, the right of a vertical segment and above a horizontal one first. The
 * first box that is free according to `blocked` wins, and `free` is false when none is.
 * @param {Array<{x:number,y:number}>} path the edge as drawn, source end first
 * @param {'from'|'to'} end
 * @param {number} clear length of the marker at that end, in px along the line
 */
function endLabelGeometry(path, end, text, clear, blocked) {
  const fromEnd = end === 'from' ? path : [...path].reverse();
  const at = fromEnd[0];
  const width = Math.ceil(7 * longestLine(text));
  const { gap, side, height, step, reach } = END_LABEL;
  const candidates = [];
  for (let along = clear + gap; along <= clear + gap + reach; along += step) {
    const { point, vertical, dir } = pointAlong(fromEnd, along);
    for (const s of vertical ? [1, -1] : [-1, 1]) {
      candidates.push(vertical
        ? {
          offset: { x: point.x - at.x + s * side, y: point.y - at.y + (dir * height) / 2 },
          align: s > 0 ? 'left' : 'right',
          box: { x: s > 0 ? point.x + side : point.x - side - width, y: dir > 0 ? point.y : point.y - height, width, height },
        }
        : {
          offset: { x: point.x - at.x, y: point.y - at.y + s * (height / 2 + side) },
          align: dir > 0 ? 'left' : 'right',
          box: { x: dir > 0 ? point.x : point.x - width, y: point.y + s * (height / 2 + side) - height / 2, width, height },
        });
    }
  }
  const pick = candidates.find((c) => !blocked(c.box));
  return { position: end === 'from' ? -1 : 1, ...(pick ?? candidates[0]), free: pick !== undefined };
}

/** Absolute box of a node or container whose layout coordinates are relative to its parent chain. */
function absoluteBox(id, layout, parentOf) {
  const box = layout.nodes.get(id) ?? layout.containers.get(id);
  let x = box.x;
  let y = box.y;
  for (let p = parentOf.get(id); p; p = parentOf.get(p)) {
    const pb = layout.containers.get(p);
    x += pb.x;
    y += pb.y;
  }
  return { x, y, width: box.width, height: box.height };
}

function graphCells(cid, layout, { containers, nodes, edges }, warnings = []) {
  const cells = [];
  const parentOf = new Map([...containers.map((c) => [c.id, c.parent]), ...nodes.map((n) => [n.id, n.parent])]);
  const emitted = new Set();
  const emitContainer = (c) => {
    if (emitted.has(c.id)) return;
    if (c.parent) emitContainer(containers.find((x) => x.id === c.parent));
    emitted.add(c.id);
    const box = layout.containers.get(c.id);
    cells.push(vertex({ id: cid(c.id), value: htmlLabel(c.label), style: c.style, ...box, parent: c.parent ? cid(c.parent) : '1' }));
  };
  for (const c of containers) emitContainer(c);
  for (const n of nodes) {
    // A node with a self-loop was given extra width for ELK; the shape keeps its own size.
    const box = drawBox(n, layout.nodes.get(n.id));
    cells.push(vertex({ id: cid(n.id), value: htmlLabel(n.label), style: n.style, ...box, parent: n.parent ? cid(n.parent) : '1', link: n.link }));
    for (const child of n.children ?? []) cells.push(child(cid(n.id), box));
  }
  // Where an edge meets a node, as draw.io's relative anchor, from the point ELK routed it to.
  // Fixing both ends keeps draw.io on ELK's route, so straight edges stay where the layout put
  // them instead of being re-routed at render time next to other edges.
  const nodeOf = (id) => nodes.find((x) => x.id === id);
  const anchor = (id, pt) => {
    const b = drawBox(nodeOf(id) ?? {}, absoluteBox(id, layout, parentOf));
    const clamp = (v) => Math.max(0, Math.min(1, v));
    return { x: clamp((pt.x - b.x) / b.width), y: clamp((pt.y - b.y) / b.height) };
  };
  const anchorStyle = (prefix, a) => `${prefix}X=${round(a.x)};${prefix}Y=${round(a.y)};${prefix}Dx=0;${prefix}Dy=0;`;
  // Sides of a node that other edges touch, so a self-loop can take a free one.
  const sideUse = new Map();
  const noteSide = (id, a) => {
    const side = a.x >= 0.99 ? 'right' : a.x <= 0.01 ? 'left' : a.y <= 0.01 ? 'top' : 'bottom';
    if (!sideUse.has(id)) sideUse.set(id, []);
    sideUse.get(id).push({ side, at: side === 'left' || side === 'right' ? a.y : a.x });
  };
  for (const e of edges) {
    if (e.from === e.to) continue;
    const route = layout.edges.get(e.id);
    if (route?.start) noteSide(e.from, anchor(e.from, route.start));
    if (route?.end) noteSide(e.to, anchor(e.to, route.end));
  }
  // What an end label must stay clear of: every node, every routed line, every end marker and
  // every label placed so far (the labels ELK placed, then the end labels as they are added).
  const routed = edges.filter((e) => e.from !== e.to && layout.edges.get(e.id)?.start && layout.edges.get(e.id)?.end)
    .map((e) => { const r = layout.edges.get(e.id); return { id: e.id, path: [r.start, ...(r.points ?? []), r.end], label: e.label ? r.label : undefined, markers: e.markers ?? {} }; });
  const taken = [...nodes.map((n) => drawBox(n, absoluteBox(n.id, layout, parentOf))), ...routed.map((r) => r.label).filter(Boolean)];
  for (const r of routed) {
    if (r.markers.from > 0) taken.push(markerBox(r.path, r.markers.from));
    if (r.markers.to > 0) taken.push(markerBox([...r.path].reverse(), r.markers.to));
  }
  const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  const onLine = (box, a, b) => overlaps(box, { x: Math.min(a.x, b.x) - 1, y: Math.min(a.y, b.y) - 1, width: Math.abs(a.x - b.x) + 2, height: Math.abs(a.y - b.y) + 2 });
  const blocked = (box) => taken.some((t) => overlaps(box, t)) || routed.some((r) => r.path.some((p, i) => i > 0 && onLine(box, r.path[i - 1], p)));
  for (const e of edges) {
    if (e.from === e.to) {
      // Self-loop: out of one side, along it, and back in, on a side no other edge uses there;
      // the label sits beyond the loop. The node reserved this room in the layout.
      const n = nodeOf(e.from);
      const b = drawBox(n, absoluteBox(e.from, layout, parentOf));
      // The loop takes the first band (right, then left; middle, then upper, then lower third)
      // that no other edge of this node touches.
      const bands = [['right', 0.3, 0.7], ['left', 0.3, 0.7], ['right', 0.05, 0.45], ['right', 0.55, 0.95], ['left', 0.05, 0.45], ['left', 0.55, 0.95]];
      const free = ([side, lo, hi]) => !(sideUse.get(e.from) ?? []).some((u) => u.side === side && u.at > lo - 0.05 && u.at < hi + 0.05);
      const band = e.loop?.side ? [e.loop.side, e.loop.exitY ?? 0.3, e.loop.entryY ?? 0.7] : (bands.find(free) ?? bands[0]);
      const dir = band[0] === 'left' ? -1 : 1;
      const exitY = band[1];
      const entryY = band[2];
      const edgeX = dir > 0 ? b.x + b.width : b.x;
      const outX = edgeX + dir * SELF_LOOP_OUT;
      const points = [{ x: outX, y: b.y + b.height * exitY }, { x: outX, y: b.y + b.height * entryY }];
      const sx = dir > 0 ? 1 : 0;
      // A plain edge (no orthogonal router) follows exactly these waypoints, so the label's
      // midpoint anchor is on the loop's outer vertical.
      const style = `${e.style.replace(/edgeStyle=[^;]*;/, '').replace(/orthogonalLoop=1;/, '')}exitX=${sx};exitY=${round(exitY)};exitDx=0;exitDy=0;entryX=${sx};entryY=${round(entryY)};entryDx=0;entryDy=0;`;
      cells.push(edge({ id: cid(e.id), value: '', style, source: cid(e.from), target: cid(e.to), points }));
      // Text anchored at the loop's outer side, aligned away from it: a fixed 4 px gap, whatever the text width.
      if (e.label) cells.push(edgeLabel({ id: `${cid(e.id)}:label`, value: htmlLabel(e.label), parent: cid(e.id), position: 0, offset: { x: dir * LABEL_GAP, y: 0 }, align: dir > 0 ? 'left' : 'right' }));
      continue;
    }
    const route = layout.edges.get(e.id) ?? { points: [] };
    const points = route.points ?? [];
    let style = e.style;
    if (route.start && route.end && !/exitX=/.test(style)) style += anchorStyle('exit', anchor(e.from, route.start)) + anchorStyle('entry', anchor(e.to, route.end));
    cells.push(edge({ id: cid(e.id), value: '', style, source: cid(e.from), target: cid(e.to), points }));
    if (e.label) {
      const placed = route.label && route.start && route.end ? labelGeometry([route.start, ...points, route.end], route.label, e.label) : { position: 0, offset: { x: 0, y: 0 }, align: 'center' };
      cells.push(edgeLabel({ id: `${cid(e.id)}:label`, value: htmlLabel(e.label), parent: cid(e.id), position: placed.position, offset: placed.offset, align: placed.align }));
    }
    for (const l of e.endLabels ?? []) {
      const placed = endLabelGeometry(route.start && route.end ? [route.start, ...points, route.end] : [{ x: 0, y: 0 }, { x: 0, y: 1 }], l.end, l.value, e.markers?.[l.end] ?? 0, blocked);
      taken.push(placed.box);
      if (!placed.free) warnings.push({ path: l.path, message: `layout: ${l.what} has no free place beside its line; it may sit on a neighbouring line or label`, hint: 'reorder the elements or change the direction so the lines at that end are further apart' });
      cells.push(edgeLabel({ id: `${cid(e.id)}:${l.suffix}`, value: htmlLabel(l.value), parent: cid(e.id), position: placed.position, offset: placed.offset, align: placed.align }));
    }
  }
  return cells;
}

function parentMap(containers) {
  const parent = new Map();
  for (const c of containers) for (const child of c.children ?? []) parent.set(child, c.id);
  return parent;
}

async function emitFlowchart(ir, cid, refs, warnings) {
  const parent = parentMap(ir.groups ?? []);
  const containers = (ir.groups ?? []).map((g) => ({ id: g.id, label: g.label, parent: parent.get(g.id), style: STYLE.container }));
  const edges = ir.edges.map((e) => ({ id: e.id, from: e.from, to: e.to, label: e.label, style: STYLE.flowEdge }));
  const loopExtra = new Map();
  for (const e of edges) if (e.from === e.to) loopExtra.set(e.from, Math.max(loopExtra.get(e.from) ?? 0, selfLoopExtra(e.label)));
  const nodes = ir.nodes.map((n, i) => {
    const shape = n.ref ? 'subroutine' : (n.shape ?? 'process');
    const { label, link } = refLabel(n.label, n.ref, refs, `/nodes/${i}/ref`, warnings);
    const size = shape === 'decision' ? measureDecision(label) : measureNode(label);
    const extra = loopExtra.get(n.id) ?? 0;
    return { id: n.id, label, link, parent: parent.get(n.id), style: shape === 'decision' ? decisionStyle(size) : STYLE[shape], width: size.width + 2 * extra, height: size.height, drawWidth: extra ? size.width : undefined };
  });
  const layout = await layoutGraph({ nodes, containers, edges, direction: ir.direction });
  return graphCells(cid, layout, { containers, nodes, edges });
}

async function emitState(ir, cid) {
  const kindOf = (s) => s.kind ?? 'simple';
  const composites = ir.states.filter((s) => kindOf(s) === 'composite');
  const parent = parentMap(composites);
  const containers = composites.map((s) => ({ id: s.id, label: s.label, parent: parent.get(s.id), style: STYLE.composite }));
  const label = (t) => {
    const head = [t.event, t.guard ? `[${t.guard}]` : ''].filter(Boolean).join(' ');
    return [head, t.action ? `/ ${t.action}` : ''].filter(Boolean).join(' ');
  };
  const edges = ir.transitions.map((t) => ({ id: t.id, from: t.from, to: t.to, label: label(t) || undefined, style: STYLE.flowEdge }));
  // ELK reserves no room for the loop drawn beside a state, so the state asks for it.
  const loopExtra = new Map();
  for (const e of edges) if (e.from === e.to) loopExtra.set(e.from, Math.max(loopExtra.get(e.from) ?? 0, selfLoopExtra(e.label)));
  const nodes = ir.states.filter((s) => kindOf(s) !== 'composite').map((s) => {
    const kind = kindOf(s);
    const size = kind === 'initial' || kind === 'final' ? { width: CIRCLE, height: CIRCLE } : measureNode(s.label);
    const extra = loopExtra.get(s.id) ?? 0;
    return { id: s.id, label: kind === 'initial' || kind === 'final' ? '' : s.label, parent: parent.get(s.id), style: STYLE[kind] ?? STYLE.state, width: size.width + 2 * extra, height: size.height, drawWidth: extra ? size.width : undefined };
  });
  const layout = await layoutGraph({ nodes, containers, edges, direction: ir.direction });
  return graphCells(cid, layout, { containers, nodes, edges });
}

const ROW = 26;

/** A table-like node (ER entity, class) with one child row per line; rows stack from the header. */
const ROW_LINE = 14;
const TABLE_MAX_WIDTH = 300;

/** Height of one table row: a line that is wider than the box wraps, and the row grows with it. */
export function rowHeight(text, width) {
  const lines = Math.max(1, Math.ceil((7 * longestLine(text ?? '')) / Math.max(width - 8, 1)));
  return ROW + ROW_LINE * (lines - 1);
}

function tableNode(id, header, rows, { headerHeight = ROW } = {}) {
  const longest = Math.max(longestLine(header), ...rows.map((r) => longestLine(r.text ?? '')), 1);
  const width = Math.min(TABLE_MAX_WIDTH, Math.max(160, Math.ceil(7 * longest) + 24));
  const heightOf = (r) => (r.separator ? 8 : rowHeight(r.text, width));
  const height = headerHeight + rows.reduce((h, r) => h + heightOf(r), 0);
  let y = headerHeight;
  const rowTops = [];
  const children = rows.map((r, i) => {
    const rowY = y;
    const h = heightOf(r);
    rowTops.push({ y: rowY, height: h });
    y += h;
    return (parentId) => (r.separator
      ? vertex({ id: `${parentId}:sep-${i}`, value: '', style: STYLE.separator, x: 0, y: rowY, width, height: 8, parent: parentId })
      : vertex({ id: `${parentId}:row-${i}`, value: htmlLabel(r.text), style: STYLE.row, x: 0, y: rowY, width, height: h, parent: parentId }));
  });
  return { id, label: header, style: `${STYLE.table}startSize=${headerHeight};`, width, height, children, headerHeight, rowTops };
}

const ER_ARROW = { one: 'ERmandOne', 'zero-one': 'ERzeroToOne', many: 'ERzeroToMany', 'one-many': 'ERoneToMany' };

/**
 * Which attribute row a relation end points at: the attribute named in the IR, else the one
 * FK whose name contains the other entity's id or label (for a self-relation: the one FK
 * that names no other entity), else undefined for the header band. Never a non-key row.
 */
function erAnchorRow(entity, other, named, warnings, path, others) {
  const attrs = entity.attributes ?? [];
  if (named !== undefined) {
    const i = attrs.findIndex((a) => a.name === named);
    if (i >= 0) return i;
    warnings.push({ path, message: `attribute "${named}" is not on entity "${entity.id}"; the relation is anchored at the header instead` });
    return undefined;
  }
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
  const needlesOf = (e) => [norm(e.id), norm(e.label)].filter((s) => s.length >= 3);
  const fks = attrs.map((a, i) => ({ a, i })).filter(({ a }) => a.key === 'fk');
  if (entity.id === other.id) {
    const foreign = fks.filter(({ a }) => !others.some((o) => needlesOf(o).some((n) => norm(a.name).includes(n))));
    return foreign.length === 1 ? foreign[0].i : undefined;
  }
  const matching = fks.filter(({ a }) => needlesOf(other).some((n) => norm(a.name).includes(n)));
  return matching.length === 1 ? matching[0].i : undefined;
}

const ER_ANCHOR_PITCH = 20;

/**
 * ER diagrams are laid out twice. The first pass gives every entity a position, which
 * decides for each relation end the side it leaves from and the row (or header band) it is
 * anchored to. The second pass hands ELK those anchors as fixed ports, so the router knows
 * the real end points and its channels and crossing avoidance hold in the output. Header
 * bands grow by 20 px per extra anchor, so two markers on one side never stack.
 */
async function emitEr(ir, cid, warnings) {
  const rowsOf = (e) => (e.attributes ?? []).map((a) => {
    const key = a.key === 'pk' ? 'PK ' : a.key === 'fk' ? 'FK ' : '';
    return { text: `${key}${a.name}: ${a.type}${a.comment ? ` (${a.comment})` : ''}` };
  });
  const buildNodes = (headerHeights) => ir.entities.map((e) => tableNode(e.id, e.label, rowsOf(e), { headerHeight: headerHeights.get(e.id) ?? ROW }));
  const edgeStyle = (r) => `${STYLE.erEdge}startArrow=${ER_ARROW[r.fromCardinality]};startFill=0;endArrow=${ER_ARROW[r.toCardinality]};endFill=0;${r.identifying === false ? 'dashed=1;' : ''}`;
  const edges = ir.relations.map((r) => ({ id: r.id, from: r.from, to: r.to, label: r.label, style: edgeStyle(r) }));
  const spacing = { nodeNode: 60, layer: 80 };
  let nodes = buildNodes(new Map());
  const first = await layoutGraph({ nodes, edges, direction: ir.direction, spacing });

  // Ends: side from the relative position after the first pass, row from the attributes.
  const entityById = new Map(ir.entities.map((e) => [e.id, e]));
  const ends = [];
  ir.relations.forEach((r, i) => {
    const a = first.nodes.get(r.from);
    const b = first.nodes.get(r.to);
    const dx = (b.x + b.width / 2) - (a.x + a.width / 2);
    const dy = (b.y + b.height / 2) - (a.y + a.height / 2);
    const horizontal = r.from === r.to || Math.abs(dx) >= Math.abs(dy);
    const others = ir.entities.filter((e) => e.id !== r.from);
    const fromRow = erAnchorRow(entityById.get(r.from), entityById.get(r.to), r.fromAttribute, warnings, `/relations/${i}/fromAttribute`, others);
    const toRow = erAnchorRow(entityById.get(r.to), entityById.get(r.from), r.toAttribute, warnings, `/relations/${i}/toAttribute`, others);
    if (r.from === r.to) {
      ends.push({ r, end: 'from', entity: r.from, side: 'loop', row: fromRow }, { r, end: 'to', entity: r.to, side: 'loop', row: r.toAttribute !== undefined ? toRow : undefined });
      return;
    }
    ends.push({ r, end: 'from', entity: r.from, side: horizontal ? (dx >= 0 ? 'right' : 'left') : (dy >= 0 ? 'bottom' : 'top'), row: fromRow });
    ends.push({ r, end: 'to', entity: r.to, side: horizontal ? (dx >= 0 ? 'left' : 'right') : (dy >= 0 ? 'top' : 'bottom'), row: toRow });
  });
  // Header anchors per entity side; the header grows so they sit 20 px apart.
  const groups = new Map();
  for (const end of ends) {
    const key = `${end.entity}|${end.side}|${end.row ?? 'header'}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(end);
  }
  const headerHeights = new Map();
  for (const [key, group] of groups) {
    if (!key.endsWith('|header')) continue;
    const [entity] = key.split('|');
    headerHeights.set(entity, Math.max(headerHeights.get(entity) ?? ROW, ROW + ER_ANCHOR_PITCH * (group.length - 1)));
  }
  nodes = buildNodes(headerHeights);
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  // A self-relation needs room beside its entity (the loop takes the side with fewer ports);
  // ELK gets the entity that much wider on both sides and the table is drawn centred in it.
  const loops = new Map();
  for (const e of edges) {
    if (e.from !== e.to) continue;
    const n = nodeById.get(e.from);
    const count = (side) => ends.filter((x) => x.entity === e.from && x.side === side).length;
    loops.set(e.id, { side: count('right') > count('left') ? 'left' : 'right' });
    const extra = selfLoopExtra(e.label);
    n.drawWidth = n.width;
    n.width += 2 * extra;
  }

  // Port positions in ELK node coordinates: on the (possibly widened) border, at the anchor's y.
  // Anchors that share a band are ordered by where the other end of their relation lies, so
  // lines leaving one side do not cross each other right away. That order depends on the
  // layout, which depends on the ports, so the pass is repeated until the order is stable.
  const buildPorts = (positions) => {
    const otherCentre = (end) => {
      const otherId = end.end === 'from' ? end.r.to : end.r.from;
      const b = positions.get(otherId);
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    };
    const ports = new Map(nodes.map((n) => [n.id, []]));
    const order = [];
    for (const group of groups.values()) {
      if (group.length > 1 && group[0].side !== 'loop') {
        const horizontal = group[0].side === 'left' || group[0].side === 'right';
        group.sort((a, b) => (horizontal ? otherCentre(a).y - otherCentre(b).y : otherCentre(a).x - otherCentre(b).x) || a.r.id.localeCompare(b.r.id));
      }
      order.push(group.map((end) => `${end.r.id}:${end.end}`).join(','));
      group.forEach((end, k) => {
        const n = nodeById.get(end.entity);
        const along = end.row !== undefined
          ? n.rowTops[end.row].y + n.rowTops[end.row].height / 2 + (group.length > 1 ? (k - (group.length - 1) / 2) * 8 : 0)
          : ROW / 2 + ER_ANCHOR_PITCH * k;
        end.relY = along / n.height;
        if (end.side === 'loop') return;
        const horizontal = end.side === 'left' || end.side === 'right';
        const inset = n.drawWidth !== undefined ? (n.width - n.drawWidth) / 2 : 0;
        const pos = horizontal
          ? { x: end.side === 'right' ? n.width : 0, y: along }
          : { x: inset + ((n.drawWidth ?? n.width) * (k + 1)) / (group.length + 1), y: end.side === 'bottom' ? n.height : 0 };
        end.port = `${end.entity}:port:${end.r.id}:${end.end}`;
        ports.get(end.entity).push({ id: end.port, x: pos.x, y: pos.y });
      });
    }
    for (const n of nodes) n.ports = ports.get(n.id).length > 0 ? ports.get(n.id) : undefined;
    for (const e of edges) {
      const from = ends.find((x) => x.r.id === e.id && x.end === 'from');
      const to = ends.find((x) => x.r.id === e.id && x.end === 'to');
      e.fromPort = from.port;
      e.toPort = to.port;
      if (e.from === e.to) e.loop = { exitY: from.relY, entryY: to.relY, side: loops.get(e.id).side };
    }
    return order.join('|');
  };
  let positions = first.nodes;
  let signature = buildPorts(positions);
  let layout = await layoutGraph({ nodes, edges, direction: ir.direction, spacing });
  for (let pass = 0; pass < 2; pass++) {
    positions = layout.nodes;
    const next = buildPorts(positions);
    if (next === signature) break;
    signature = next;
    layout = await layoutGraph({ nodes, edges, direction: ir.direction, spacing });
  }
  return graphCells(cid, layout, { containers: [], nodes, edges });
}

const VISIBILITY = { public: '+', private: '-', protected: '#', package: '~' };

/** `from` and `to` are the lengths of the markers at the two ends, which a cardinality starts past. */
const CLASS_EDGE = {
  inheritance: { style: 'endArrow=block;endSize=16;endFill=0;', reverse: false, from: 0, to: 16 },
  realization: { style: 'endArrow=block;endSize=16;endFill=0;dashed=1;', reverse: false, from: 0, to: 16 },
  composition: { style: 'startArrow=diamondThin;startFill=1;startSize=24;endArrow=none;', reverse: false, from: 24, to: 0 },
  aggregation: { style: 'startArrow=diamondThin;startFill=0;startSize=24;endArrow=none;', reverse: false, from: 24, to: 0 },
  association: { style: 'endArrow=open;endFill=0;', reverse: false, from: 0, to: 10 },
  dependency: { style: 'endArrow=open;endFill=0;dashed=1;', reverse: false, from: 0, to: 10 },
};

async function emitClass(ir, cid, warnings) {
  const nodes = ir.classes.map((c) => {
    const attrs = (c.attributes ?? []).map((a) => ({ text: `${a.visibility ? VISIBILITY[a.visibility] : ''}${a.name}${a.type ? `: ${a.type}` : ''}` }));
    const methods = (c.methods ?? []).map((m) => ({ text: `${m.visibility ? VISIBILITY[m.visibility] : ''}${m.name}(${m.params ?? ''})${m.returns ? `: ${m.returns}` : ''}` }));
    const rows = attrs.length && methods.length ? [...attrs, { separator: true }, ...methods] : [...attrs, ...methods];
    const header = c.stereotype ? `«${c.stereotype}»\n${c.label}` : c.label;
    return tableNode(c.id, header, rows, { headerHeight: c.stereotype ? ROW + 20 : ROW });
  });
  const edges = ir.relations.map((r, i) => {
    const def = CLASS_EDGE[r.kind];
    const endLabels = [];
    for (const end of ['from', 'to']) {
      const value = r[`${end}Cardinality`];
      if (value) endLabels.push({ suffix: `${end}-card`, value, end, path: `/relations/${i}/${end}Cardinality`, what: `cardinality "${value}" of relation "${r.id}" at "${r[end]}"` });
    }
    return { id: r.id, from: r.from, to: r.to, label: r.label, style: `${STYLE.classEdge}${def.style}`, endLabels, markers: { from: def.from, to: def.to } };
  });
  const layout = await layoutGraph({ nodes, edges, direction: ir.direction, spacing: { nodeNode: 60, layer: 80 } });
  return graphCells(cid, layout, { containers: [], nodes, edges }, warnings);
}

async function emitArchitecture(ir, cid) {
  const parent = parentMap(ir.boundaries ?? []);
  const containers = (ir.boundaries ?? []).map((b) => ({ id: b.id, label: b.label, parent: parent.get(b.id), style: STYLE.container }));
  const nodes = ir.components.map((c) => {
    const kind = c.kind ?? 'service';
    const size = kind === 'client' ? { width: 40, height: 60 } : kind === 'database' || kind === 'cache' ? measureNode(c.label, { baseHeight: 70 }) : measureNode(c.label);
    return { id: c.id, label: c.label, parent: parent.get(c.id), style: STYLE[kind], ...size };
  });
  const edges = ir.connections.map((c) => ({ id: c.id, from: c.from, to: c.to, label: c.label, style: `${STYLE.flowEdge}${c.bidirectional ? 'startArrow=classic;startFill=1;' : ''}` }));
  const layout = await layoutGraph({ nodes, containers, edges, direction: ir.direction, spacing: { nodeNode: 50, layer: 80 } });
  return graphCells(cid, layout, { containers, nodes, edges });
}

function emitSequence(ir, cid, warnings) {
  const L = layoutSequence(ir);
  const m = L.metrics;
  warnings.push(...L.warnings);
  const cells = [];
  // Frames first so they sit behind everything else. Their tab text and the branch labels are
  // separate opaque cells added last, so a lifeline or activation never cuts through them.
  const onTop = [];
  for (const f of L.frames) {
    cells.push(vertex({ id: cid(f.id), value: '', style: `${STYLE.frame}width=${f.tabWidth + 12};height=20;`, x: f.x, y: f.y, width: f.width, height: f.height }));
    onTop.push(vertex({ id: `${cid(f.id)}:tab`, value: htmlLabel(f.sections[0].label), style: STYLE.frameTabLabel, x: f.x + 1, y: f.y + 1, width: f.tabWidth + 4, height: 18, connectable: false }));
    f.sections.slice(1).forEach((s, i) => {
      cells.push(vertex({ id: `${cid(f.id)}:sep-${i + 1}`, value: '', style: STYLE.frameSeparator, x: f.x, y: s.y, width: f.width, height: 1, connectable: false }));
      onTop.push(vertex({ id: `${cid(f.id)}:sep-label-${i + 1}`, value: htmlLabel(s.label), style: STYLE.frameSeparatorLabel, x: f.x, y: s.y - 10, width: s.width + 12, height: 20, connectable: false }));
    });
  }
  for (const p of ir.participants) {
    const box = L.participants.get(p.id);
    const kind = p.kind ?? 'participant';
    const stereotype = LIFELINE_STEREOTYPE[kind];
    const value = stereotype ? `<i>«${stereotype}»</i><br>${htmlLabel(p.label)}` : htmlLabel(p.label);
    cells.push(vertex({ id: cid(p.id), value, style: STYLE.lifeline, x: box.x, y: box.y, width: box.width, height: box.height }));
    if (kind === 'actor') {
      cells.push(vertex({ id: `${cid(p.id)}:actor`, value: '', style: STYLE.actorGlyph, x: box.centerX - ACTOR_GLYPH.width / 2, y: box.y - ACTOR_GLYPH.height - ACTOR_GLYPH.gap, width: ACTOR_GLYPH.width, height: ACTOR_GLYPH.height, connectable: false }));
    }
  }
  for (const a of L.activations) {
    const box = L.participants.get(a.participant);
    cells.push(vertex({ id: cid(a.id), value: '', style: STYLE.activation, x: box.width / 2 - m.activationWidth / 2, y: a.startY - box.y, width: m.activationWidth, height: a.endY - a.startY, parent: cid(a.participant) }));
  }
  for (const n of ir.notes ?? []) {
    const box = L.notes.get(n.id);
    cells.push(vertex({ id: cid(n.id), value: htmlLabel(n.label), style: STYLE.sequenceNote, ...box }));
  }
  for (const msg of ir.messages) {
    const y = L.messageY(msg.id);
    const from = L.participants.get(msg.from);
    const to = L.participants.get(msg.to);
    const kind = msg.kind ?? 'sync';
    if (msg.from === msg.to) {
      // Anchor both ends on the lifeline's centre line explicitly; the lifeline perimeter
      // would otherwise attach the arrow head on the far side and draw it across the line.
      const x = from.centerX + 50;
      const anchors = `exitX=0.5;exitY=0;exitDx=0;exitDy=${y - 10 - from.y};exitPerimeter=0;entryX=0.5;entryY=0;entryDx=0;entryDy=${y + 10 - from.y};entryPerimeter=0;`;
      cells.push(edge({ id: cid(msg.id), value: htmlLabel(msg.label), style: `${STYLE.selfMessage}${anchors}`, source: cid(msg.from), target: cid(msg.to), points: [{ x, y: y - 10 }, { x, y: y + 10 }] }));
      continue;
    }
    const style = kind === 'return' ? STYLE.returnMessage : kind === 'async' ? STYLE.asyncMessage : STYLE.syncMessage;
    cells.push(edge({ id: cid(msg.id), value: htmlLabel(msg.label), style, source: cid(msg.from), target: cid(msg.to), points: [{ x: (from.centerX + to.centerX) / 2, y }] }));
  }
  cells.push(...onTop);
  return cells;
}

/**
 * Activity diagrams: one full-height coloured column per lane, rows by flow order, nodes of
 * a lane inside its column, edges routed through row gaps and lane gutters (see
 * layout-activity.mjs). Node coordinates are stored relative to their lane container.
 */
async function emitActivity(ir, cid, warnings, refs) {
  const horizontal = ir.direction === 'LR' || ir.direction === 'RL';
  const sizes = [
    ...ir.actions.map((a, i) => {
      const { label, link } = refLabel(a.label, a.ref, refs, `/actions/${i}/ref`, warnings);
      return { id: a.id, lane: a.lane, ...measureNode(label), style: a.ref ? STYLE.subroutine : STYLE.terminal, label, link };
    }),
    ...(ir.controls ?? []).map((c) => {
      const base = { id: c.id, lane: c.lane, label: '' };
      switch (c.kind) {
        case 'initial': return { ...base, style: STYLE.initial, width: CIRCLE, height: CIRCLE };
        case 'final': return { ...base, style: STYLE.final, width: CIRCLE, height: CIRCLE };
        case 'fork':
        case 'join': return { ...base, style: STYLE.bar, width: horizontal ? 8 : 120, height: horizontal ? 120 : 8 };
        case 'merge': return { ...base, style: STYLE.mergeNode, width: 40, height: 40 };
        default: {
          const size = measureDecision(c.label ?? 'decision');
          return { ...base, label: c.label ?? '', style: decisionStyle(size), width: size.width, height: size.height };
        }
      }
    }),
  ];
  const L = layoutActivity(ir, sizes);
  warnings.push(...L.warnings);
  const cells = [];
  for (const lane of L.lanes) {
    const [header, body, stroke] = LANE_PALETTE[lane.index % LANE_PALETTE.length];
    const label = ir.lanes[lane.index].label;
    const style = `${STYLE.lane}${horizontal ? 'horizontal=0;' : ''}fillColor=${header};swimlaneFillColor=${body};strokeColor=${stroke};`;
    cells.push(vertex({ id: cid(lane.id), value: htmlLabel(label), style, x: lane.x, y: lane.y, width: lane.width, height: lane.height }));
  }
  const laneById = new Map(L.lanes.map((l) => [l.id, l]));
  for (const n of sizes) {
    const box = L.nodes.get(n.id);
    const lane = laneById.get(box.lane);
    cells.push(vertex({ id: cid(n.id), value: htmlLabel(n.label), style: n.style, x: box.x - lane.x, y: box.y - lane.y, width: box.width, height: box.height, parent: cid(box.lane), link: n.link }));
  }
  for (const f of ir.flows) {
    const route = L.edges.get(f.id);
    const anchors = `exitX=${round(route.exit.x)};exitY=${route.exit.y};exitDx=0;exitDy=0;entryX=${round(route.entry.x)};entryY=${route.entry.y};entryDx=0;entryDy=0;`;
    cells.push(edge({ id: cid(f.id), value: '', style: `${STYLE.flowEdge}${anchors}`, source: cid(f.from), target: cid(f.to), points: route.points }));
    const label = L.edges.get(f.id).label;
    if (label) cells.push(edgeLabel({ id: `${cid(f.id)}:label`, value: htmlLabel(f.guard), parent: cid(f.id), position: label.position, offset: label.offset }));
  }
  return cells;
}
