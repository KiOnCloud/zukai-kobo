import { vertex, edge, edgeLabel, envelope, envelopePages, htmlLabel, pageLink, cellsBounds, shiftCells } from './drawio-xml.mjs';
import { awsIcon, awsGroup } from './aws-icons.mjs';
import { layoutGraph, backEdges, cycleOf, measureNode, measureDecision, measureLabelBelow, wrapText, LABEL_PAD } from './layout-graph.mjs';
import { layoutSequence, NOTE_FOLD, NOTE_PAD } from './layout-sequence.mjs';
import { layoutActivity, LANE_PALETTE } from './layout-activity.mjs';
import { widestLine, roomFor, safeWidth, sameText } from './text-metrics.mjs';

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
 * @param {{ canvas?: string[], gap?: number, title?: string, legacyIds?: boolean }} [options] `canvas` lists diagram ids in
 *   the order they go on the canvas page; `title` names that page; `legacyIds` gives the page
 *   ids of 2.0.3 and older (cut at 40 characters), so `drift` can rebuild such a file
 */
export async function emitDrawioBundle(entries, options = {}) {
  const warnings = [];
  const ids = entries.map((entry, i) => entry.diagramId ?? `${slugify(entry.ir.title)}-${i + 1}`);
  const slug = options.legacyIds ? slugify : pageIdOf;
  const refs = bundleRefs(entries.map((entry, i) => ({ id: ids[i], ir: entry.ir })), slug);
  const rendered = [];
  for (const [i, entry] of entries.entries()) {
    const page = await emitDrawioPage(entry.ir, { diagramId: ids[i], refs, slug });
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
    const taken = new Set(rendered.map((p) => p.diagramId));
    const cells = [];
    let x = 0;
    for (const id of options.canvas) {
      const placed = place(byId.get(id), x);
      cells.push(...placed.cells);
      x += PAGE_MARGIN + placed.width + gap;
    }
    let canvasId = 'canvas';
    while (taken.has(canvasId)) canvasId = `${canvasId}-1`;
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
export function bundleRefs(entries, slug = pageIdOf) {
  return new Map(entries.map((e) => [e.id, { pageId: slug(e.id), title: e.ir.title }]));
}

/**
 * Label and link for a step that references a sub-diagram. Inside a bundle the ref resolves
 * to the target's title and page link; a ref the bundle does not hold keeps the slug and is
 * reported. Outside a bundle (no `refs`) the slug is shown without a warning.
 */
function refLabel(label, ref, refs, path, warnings) {
  if (!ref) return { label, link: undefined };
  const target = refs?.get(ref);
  // A part is titled after the step it details, so its title often is the step's own label:
  // the step then keeps its one line and its link, instead of reading "X / ↳ X".
  if (target && sameText(target.title, label)) return { label, link: pageLink(target.pageId) };
  if (target) return { label: `${label}\n↳ ${target.title}`, link: pageLink(target.pageId) };
  if (refs) warnings.push({ path, message: `ref "${ref}" is not in this bundle: the step shows the slug and has no page link`, hint: 'bundle the referenced diagram too, or fix the ref' });
  return { label: `${label}\n↳ ${ref}`, link: undefined };
}

async function emitDrawioPage(ir, options = {}) {
  const warnings = [];
  const slug = options.diagramId ? (options.slug ?? pageIdOf)(options.diagramId) : slugify(ir.title);
  const cid = (id) => `${slug}:${id}`;
  const refs = options.refs;
  let cells;
  switch (ir.kind) {
    case 'flowchart': cells = await emitFlowchart(ir, cid, refs, warnings); break;
    case 'state': cells = await emitState(ir, cid, refs, warnings); break;
    case 'er': cells = await emitEr(ir, cid, warnings, refs); break;
    case 'class': cells = await emitClass(ir, cid, warnings, refs); break;
    case 'architecture': cells = await emitArchitecture(ir, cid, refs, warnings); break;
    case 'sequence': cells = emitSequence(ir, cid, warnings, refs); break;
    case 'activity': cells = await emitActivity(ir, cid, warnings, refs); break;
    default: throw new Error(`unknown kind "${ir.kind}"`);
  }
  return { diagramId: slug, name: ir.title, cells, warnings };
}

/**
 * The slug of a title, for a diagram that was given no id: short enough to read in a cell id.
 * Page ids were this slug of the diagram id up to 2.0.3, so it is also how `drift` reads a
 * file delivered by those versions.
 */
export function slugify(title) {
  const s = String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/g, '');
  return s || 'diagram';
}

/**
 * The page id (and cell-id prefix) of a diagram id. A diagram id is a file name the skill
 * chose (`<slug>-NN-<part>-business`), so it is kept whole: cut at 40 characters, two
 * diagrams with a long common start shared one page id and every cell id.
 */
export function pageIdOf(diagramId) {
  const s = String(diagramId).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'diagram';
}

/**
 * The slant of a parallelogram and of a hexagon: how far their outline runs into the box on
 * the left and right (draw.io's `size` for a shape with `fixedSize=1`).
 */
const SLANT = 20;
/**
 * Room between the box and the text on each side, for the shapes whose outline is narrower
 * than their box; every other labelled node keeps LABEL_PAD. A parallelogram's side is half
 * the slant in at mid-height, where an arrowhead meets it, and a hexagon's corner cuts up to
 * the whole slant, so their text starts LABEL_PAD past the half slant: clear of the arrowhead
 * by the usual margin and of the slanted line at every height the text reaches.
 */
const SHAPE_PAD = { io: SLANT / 2 + LABEL_PAD, queue: SLANT / 2 + LABEL_PAD };
const padOf = (shape) => SHAPE_PAD[shape] ?? LABEL_PAD;
/**
 * The text area of a shape for `measureNode`. A subroutine's side bars take a tenth of its
 * width each, and draw.io wraps its label between them with 2 px of its own on each side;
 * SUBROUTINE_PAD more keeps a full line (the slug of a `ref` often is one) off the bars.
 */
const SUBROUTINE_PAD = 4;
const textArea = (shape) => (shape === 'subroutine' ? { pad: 2 + SUBROUTINE_PAD, share: 0.1 } : { pad: padOf(shape) });
/**
 * Label spacing that draws the room `measureNode` counted on each side of a node's text.
 * draw.io keeps 2 px of its own, so the rest is added: the text wraps `pad` px inside the
 * box and a full line touches neither the border nor an arrowhead on it.
 */
const labelPad = (shape) => `spacingLeft=${padOf(shape) - 2};spacingRight=${padOf(shape) - 2};`;

export const STYLE = {
  // flowchart
  process: `whiteSpace=wrap;html=1;${labelPad('process')}`,
  terminal: `rounded=1;whiteSpace=wrap;html=1;${labelPad('terminal')}`,
  decision: 'rhombus;whiteSpace=wrap;html=1;',
  io: `shape=parallelogram;perimeter=parallelogramPerimeter;whiteSpace=wrap;html=1;fixedSize=1;size=${SLANT};${labelPad('io')}`,
  // The side bars of a subroutine already bound its label, a tenth of the width in from each side (see textArea).
  subroutine: `shape=process;whiteSpace=wrap;html=1;backgroundOutline=1;spacingLeft=${SUBROUTINE_PAD};spacingRight=${SUBROUTINE_PAD};`,
  note: `shape=note;whiteSpace=wrap;html=1;backgroundOutline=1;darkOpacity=0.05;size=14;${labelPad('note')}`,
  container: 'swimlane;whiteSpace=wrap;html=1;startSize=30;',
  flowEdge: 'edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;endArrow=classic;endFill=1;jumpStyle=arc;jumpSize=8;',
  // state
  initial: 'ellipse;html=1;shape=startState;fillColor=#000000;strokeColor=#000000;',
  final: 'ellipse;html=1;shape=endState;fillColor=#000000;strokeColor=#000000;',
  state: `rounded=1;whiteSpace=wrap;html=1;arcSize=30;${labelPad('state')}`,
  composite: 'swimlane;whiteSpace=wrap;html=1;startSize=30;rounded=1;arcSize=10;',
  // er and class tables
  table: 'swimlane;fontStyle=1;align=center;verticalAlign=top;childLayout=stackLayout;horizontal=1;horizontalStack=0;resizeParent=1;resizeParentMax=0;resizeLast=0;collapsible=1;marginBottom=0;whiteSpace=wrap;html=1;',
  row: 'text;strokeColor=none;fillColor=none;align=left;verticalAlign=middle;spacingLeft=4;spacingRight=4;overflow=hidden;rotatable=0;points=[[0,0.5],[1,0.5]];portConstraint=eastwest;whiteSpace=wrap;html=1;',
  separator: 'line;strokeWidth=1;fillColor=none;align=left;verticalAlign=middle;spacingTop=-1;spacingLeft=3;spacingRight=3;rotatable=0;labelPosition=right;points=[];portConstraint=eastwest;strokeColor=inherit;',
  erEdge: 'edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;',
  classEdge: 'edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;',
  // architecture
  service: `rounded=1;whiteSpace=wrap;html=1;${labelPad('service')}`,
  database: `shape=cylinder3;whiteSpace=wrap;html=1;boundedLbl=1;backgroundOutline=1;size=15;${labelPad('database')}`,
  queue: `shape=hexagon;perimeter=hexagonPerimeter2;whiteSpace=wrap;html=1;fixedSize=1;size=${SLANT};${labelPad('queue')}`,
  cache: `shape=cylinder3;whiteSpace=wrap;html=1;boundedLbl=1;backgroundOutline=1;size=15;dashed=1;${labelPad('cache')}`,
  // A screen, from draw.io's built-in network library: a client is an application (a browser,
  // a mobile app), not a person, and a stick figure reads as a user.
  client: 'shape=mxgraph.networks.monitor;fillColor=#ffffff;strokeColor=#000000;verticalLabelPosition=bottom;verticalAlign=top;whiteSpace=wrap;html=1;outlineConnect=0;',
  external: `rounded=1;whiteSpace=wrap;html=1;dashed=1;${labelPad('external')}`,
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
  // The spacing draws the room the layout counted when it sized the note: the text wraps
  // inside it, off the left border and short of the folded corner (draw.io adds 2 px itself).
  sequenceNote: `shape=note;whiteSpace=wrap;html=1;backgroundOutline=1;darkOpacity=0.05;size=${NOTE_FOLD};spacingLeft=${NOTE_PAD.left - 2};spacingRight=${NOTE_PAD.right - 2};`,
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

/** How far a self-loop stands off its node, in px. */
const SELF_LOOP_OUT = 30;
/**
 * A self-loop goes on a side that is across the flow, where no other edge of its node ends:
 * the other edges of a node leave and arrive along the flow, so a loop drawn there lies on
 * top of the arrowhead of an incoming edge and its label reads as that edge's label.
 *
 * In a left-to-right or right-to-left layout that side is the top. ELK routes a self-loop
 * there itself and keeps room for it and for its label above the node, so the emitter draws
 * that route. In a top-down or bottom-up layout the side is the right (or the left), and the
 * emitter draws the loop itself: ELK gets the node wider by the loop and its label on both
 * sides (so edges still leave from the drawn centre), and the shape is drawn centred in that
 * box at its own width.
 */
const acrossIsVertical = (direction) => direction === 'LR' || direction === 'RL';
/** Layout spacing that makes ELK's own self-loop as deep as the drawn ones, where its route is used. */
const loopSpacing = (direction) => (acrossIsVertical(direction) ? { selfLoop: SELF_LOOP_OUT } : {});
/** An edge style without the orthogonal router, so draw.io follows the waypoints of a loop exactly. */
const waypointStyle = (style) => style.replace(/edgeStyle=[^;]*;/, '').replace(/orthogonalLoop=1;/, '');
/** A decision's rhombus style, with the label spacing that wraps a long question inside the diamond. */
const decisionStyle = (size) => (size.spacing > 0 ? `${STYLE.decision}spacingLeft=${size.spacing};spacingRight=${size.spacing};` : STYLE.decision);

const selfLoopLabelWidth = (label) => Math.ceil(widestLine(label)) + 4;
const selfLoopExtra = (label) => SELF_LOOP_OUT + (label ? selfLoopLabelWidth(label) + 12 : 0) + 10;
/**
 * Room beside each node for the loops the emitter draws on its right or left: the widest of
 * its self-loops, per node id. Empty where the loops go over the top on ELK's own route.
 */
function sideLoopRoom(edges, direction) {
  const room = new Map();
  if (acrossIsVertical(direction)) return room;
  for (const e of edges) if (e.from === e.to) room.set(e.from, Math.max(room.get(e.from) ?? 0, selfLoopExtra(e.label)));
  return room;
}
/**
 * The box a shape is drawn in when the layout was given a larger one: centred across it at
 * `drawWidth` (room for a self-loop beside the shape) and, with `drawHeight`, at its top
 * (room for a label below the shape).
 */
const drawBox = (n, box) => (n.drawWidth === undefined ? box : { ...box, x: box.x + (n.drawX ?? (box.width - n.drawWidth) / 2), width: n.drawWidth, height: n.drawHeight ?? box.height });

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
  const width = Math.ceil(widestLine(text));
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

/** Shared path for the ELK-laid kinds: containers, nodes, edges with child labels. */
function graphCells(cid, layout, { containers, nodes, edges, direction }, warnings = []) {
  const cells = [];
  const parentOf = new Map([...containers.map((c) => [c.id, c.parent]), ...nodes.map((n) => [n.id, n.parent])]);
  const emitted = new Set();
  const emitContainer = (c) => {
    if (emitted.has(c.id)) return;
    if (c.parent) emitContainer(containers.find((x) => x.id === c.parent));
    emitted.add(c.id);
    const box = layout.containers.get(c.id);
    const style = c.headerHeight ? c.style.replace(/startSize=\d+;/, `startSize=${c.headerHeight};`) : c.style;
    cells.push(vertex({ id: cid(c.id), value: htmlLabel(c.label), style, ...box, parent: c.parent ? cid(c.parent) : '1', link: c.link }));
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
  // A shape with its label below it (`drawHeight`) is met in two ways. An edge that ELK ends
  // beside the figure attaches to the figure's side at that height and runs over the empty
  // room next to it. An edge that ends below the figure, under the label, keeps ELK's point as
  // a pixel offset from the figure's bottom, so the line stops clear of the text instead of
  // running through it; `perimeter=0` makes draw.io keep that point. The layout gives such a
  // shape ports within the figure's extent (see clientPorts), so no end lies beside the label.
  const anchor = (id, pt) => {
    const n = nodeOf(id) ?? {};
    const b = drawBox(n, absoluteBox(id, layout, parentOf));
    const clamp = (v) => Math.max(0, Math.min(1, v));
    const a = { x: clamp((pt.x - b.x) / b.width), y: clamp((pt.y - b.y) / b.height), dx: 0, dy: 0 };
    if (n.drawHeight !== undefined && pt.y > b.y + b.height + 0.5) {
      a.dx = pt.x - (b.x + a.x * b.width);
      a.dy = pt.y - (b.y + b.height);
    }
    return a;
  };
  const anchorStyle = (prefix, a) => `${prefix}X=${round(a.x)};${prefix}Y=${round(a.y)};${prefix}Dx=${round(a.dx)};${prefix}Dy=${round(a.dy)};${a.dx || a.dy ? `${prefix}Perimeter=0;` : ''}`;
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
  // The labels at the two ends of an edge (class cardinalities), beside the line as drawn; a
  // self-loop has them too, at the points where it leaves and re-enters its node.
  const endLabelCells = (e, path) => {
    for (const l of e.endLabels ?? []) {
      const placed = endLabelGeometry(path, l.end, l.value, e.markers?.[l.end] ?? 0, blocked);
      taken.push(placed.box);
      if (!placed.free) warnings.push({ path: l.path, message: `layout: ${l.what} has no free place beside its line; it may sit on a neighbouring line or label`, hint: 'reorder the elements or change the direction so the lines at that end are further apart' });
      cells.push(edgeLabel({ id: `${cid(e.id)}:${l.suffix}`, value: htmlLabel(l.value), parent: cid(e.id), position: placed.position, offset: placed.offset, align: placed.align }));
    }
  };
  for (const e of edges) {
    if (e.from === e.to) {
      const own = layout.edges.get(e.id);
      // A shape drawn smaller than its layout box (a client figure over its name) keeps the
      // loop the emitter draws at the figure itself: ELK's route spans the whole box.
      const fills = nodeOf(e.from)?.drawWidth === undefined;
      if (acrossIsVertical(direction) && !e.loop && fills && own?.start && own?.end) {
        // The loop ELK routed over the top of the node, with its label above it: the layout
        // kept that room, and no other edge of the node ends on that side.
        const style = `${waypointStyle(e.style)}${anchorStyle('exit', anchor(e.from, own.start))}${anchorStyle('entry', anchor(e.to, own.end))}`;
        cells.push(edge({ id: cid(e.id), value: '', style, source: cid(e.from), target: cid(e.to), points: own.points }));
        if (e.label) {
          const placed = own.label ? labelGeometry([own.start, ...own.points, own.end], own.label, e.label) : { position: 0, offset: { x: 0, y: 0 }, align: 'center' };
          cells.push(edgeLabel({ id: `${cid(e.id)}:label`, background: e.labelBackground, value: htmlLabel(e.label), parent: cid(e.id), position: placed.position, offset: placed.offset, align: placed.align }));
        }
        endLabelCells(e, [own.start, ...own.points, own.end]);
        continue;
      }
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
      const style = `${waypointStyle(e.style)}exitX=${sx};exitY=${round(exitY)};exitDx=0;exitDy=0;entryX=${sx};entryY=${round(entryY)};entryDx=0;entryDy=0;`;
      cells.push(edge({ id: cid(e.id), value: '', style, source: cid(e.from), target: cid(e.to), points }));
      // Text anchored at the loop's outer side, aligned away from it: a fixed 4 px gap, whatever the text width.
      if (e.label) cells.push(edgeLabel({ id: `${cid(e.id)}:label`, background: e.labelBackground, value: htmlLabel(e.label), parent: cid(e.id), position: 0, offset: { x: dir * LABEL_GAP, y: 0 }, align: dir > 0 ? 'left' : 'right' }));
      endLabelCells(e, [{ x: edgeX, y: points[0].y }, ...points, { x: edgeX, y: points[1].y }]);
      continue;
    }
    const route = layout.edges.get(e.id) ?? { points: [] };
    const points = route.points ?? [];
    let style = e.style;
    if (route.start && route.end && !/exitX=/.test(style)) style += anchorStyle('exit', anchor(e.from, route.start)) + anchorStyle('entry', anchor(e.to, route.end));
    cells.push(edge({ id: cid(e.id), value: '', style, source: cid(e.from), target: cid(e.to), points }));
    if (e.label) {
      // draw.io measures a label's place along the line as it draws it, from one shape to the
      // other. A line that ends at a figure with its name below starts at the figure, not at
      // the edge of the layout box; where a label must not move off its place (beside a frame
      // border) it is measured on that line.
      const drawnEnd = (id, pt) => { const a = anchor(id, pt); const b = drawBox(nodeOf(id) ?? {}, absoluteBox(id, layout, parentOf)); return { x: b.x + a.x * b.width + a.dx, y: b.y + a.y * b.height + a.dy }; };
      const line = route.start && route.end ? (e.labelOnDrawnLine ? [drawnEnd(e.from, route.start), ...points, drawnEnd(e.to, route.end)] : [route.start, ...points, route.end]) : undefined;
      const placed = route.label && line ? labelGeometry(line, route.label, e.label) : { position: 0, offset: { x: 0, y: 0 }, align: 'center' };
      cells.push(edgeLabel({ id: `${cid(e.id)}:label`, background: e.labelBackground, value: htmlLabel(e.label), parent: cid(e.id), position: placed.position, offset: placed.offset, align: placed.align }));
    }
    endLabelCells(e, route.start && route.end ? [route.start, ...points, route.end] : [{ x: 0, y: 0 }, { x: 0, y: 1 }]);
  }
  return cells;
}

function parentMap(containers) {
  const parent = new Map();
  for (const c of containers) for (const child of c.children ?? []) parent.set(child, c.id);
  return parent;
}

/**
 * Where the lines of a decision meet its rhombus: at the tips, never on a slanted edge. Every
 * branch leaves through the tip the flow points to, as one line that splits where the
 * branches part; every line that arrives ends at the opposite tip. A branch that leads back
 * to an earlier step leaves through a side tip, and a line that comes back to a decision
 * from a later step arrives at the other side tip, so neither runs along the forward lines.
 * The tips are fixed ports for the layout, which routes the lines that share one as a
 * single line with a junction.
 */
function decisionPorts(decisionNodes, edges, back, direction = 'TB') {
  const sides = { TB: ['top', 'bottom', 'right', 'left'], BT: ['bottom', 'top', 'right', 'left'], LR: ['left', 'right', 'bottom', 'top'], RL: ['right', 'left', 'bottom', 'top'] }[direction];
  const [into, out, backOut, backInto] = sides;
  for (const n of decisionNodes) {
    // A decision with a self-loop is drawn centred in a wider layout box.
    const inset = n.drawWidth !== undefined ? (n.width - n.drawWidth) / 2 : 0;
    // A port is 1 px square and a line meets it at its centre: half a pixel back puts that centre on the tip.
    const at = { top: { x: n.width / 2 - 0.5, y: 0 }, bottom: { x: n.width / 2 - 0.5, y: n.height }, left: { x: inset, y: n.height / 2 - 0.5 }, right: { x: n.width - inset, y: n.height / 2 - 0.5 } };
    const used = new Set();
    for (const e of edges) {
      if (e.from === e.to) continue;
      if (e.from === n.id) { const side = back.has(e.id) ? backOut : out; e.fromPort = `${n.id}:port:${side}`; used.add(side); }
      if (e.to === n.id) { const side = back.has(e.id) ? backInto : into; e.toPort = `${n.id}:port:${side}`; used.add(side); }
    }
    if (used.size > 0) n.ports = [...used].map((side) => ({ id: `${n.id}:port:${side}`, ...at[side] }));
  }
}

/** How far past the point where a branch parts from the others its answer starts, in px. */
const BRANCH_LABEL_GAP = 8;
/** An answer the layout placed further than this from where its branch parts is moved next to the decision when there is room, in px. */
const BRANCH_LABEL_FAR = 60;

/**
 * Write the answer of each branch (the label of an edge that leaves a decision) on the part
 * of the line that belongs to that branch alone, next to the decision: just past the point
 * where it parts from the other branches, or just past the tip when it shares no line. On
 * the shared line an answer would read as the label of every branch.
 *
 * The layout gives a forward branch's answer a place of its own in the first layer after the
 * decision, which is next to it unless the branch leaves a group first: then that layer lies
 * beyond the group and the answer stands near the far end of a long line. Such an answer
 * moves to the place past the split when nothing is there: no step, no other line, no other
 * label. The answer of a branch that leads back has no place from the layout and always
 * goes there.
 * @param {Array<{x:number,y:number,width:number,height:number}>} boxes the steps of the chart, absolute
 * @param {Array<{x:number,y:number,width:number,height:number}>} frames the groups, absolute; an answer lies inside or outside one, never across its border
 */
function placeBranchLabels(layout, edges, boxes, frames, direction) {
  const pathOf = (e) => { const r = layout.edges.get(e.id); return r?.start && r?.end ? [r.start, ...(r.points ?? []), r.end] : undefined; };
  const step = (a, b) => ({ length: Math.hypot(b.x - a.x, b.y - a.y), x: Math.sign(Math.round(b.x - a.x)), y: Math.sign(Math.round(b.y - a.y)) });
  // Length of the line two paths from one point have in common before they part.
  const shared = (p, q) => {
    let common = 0;
    for (let i = 1; i < Math.min(p.length, q.length); i++) {
      const a = step(p[i - 1], p[i]);
      const b = step(q[i - 1], q[i]);
      if (a.x !== b.x || a.y !== b.y) break;
      common += Math.min(a.length, b.length);
      if (Math.abs(a.length - b.length) > 0.5) break;
    }
    return common;
  };
  const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  const onLine = (box, a, b) => overlaps(box, { x: Math.min(a.x, b.x) - 2, y: Math.min(a.y, b.y) - 2, width: Math.abs(a.x - b.x) + 4, height: Math.abs(a.y - b.y) + 4 });
  // How far along a path the point nearest to the centre of a box lies.
  const alongOf = (path, box) => {
    const c = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    let best = { d: Infinity, along: 0 };
    let before = 0;
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1];
      const b = path[i];
      const l = Math.hypot(b.x - a.x, b.y - a.y);
      const t = l === 0 ? 0 : Math.max(0, Math.min(1, ((c.x - a.x) * (b.x - a.x) + (c.y - a.y) * (b.y - a.y)) / (l * l)));
      const d = Math.hypot(c.x - (a.x + t * (b.x - a.x)), c.y - (a.y + t * (b.y - a.y)));
      if (d < best.d) best = { d, along: before + t * l };
      before += l;
    }
    return best.along;
  };
  const branches = edges.filter((e) => e.branch && e.label && e.from !== e.to && pathOf(e));
  for (const e of branches) {
    const path = pathOf(e);
    const route = layout.edges.get(e.id);
    const total = path.reduce((sum, p, i) => (i === 0 ? 0 : sum + Math.hypot(p.x - path[i - 1].x, p.y - path[i - 1].y)), 0);
    let parted = 0;
    for (const o of edges) {
      if (o === e || o.from !== e.from || o.from === o.to) continue;
      const other = pathOf(o);
      if (other && Math.hypot(other[0].x - path[0].x, other[0].y - path[0].y) < 0.5) parted = Math.max(parted, shared(path, other));
    }
    const width = Math.ceil(widestLine(e.label)) + 4;
    const height = 16 * String(e.label).split(/\r\n?|\n/).length;
    const insideOf = (box) => (f) => box.x >= f.x && box.y >= f.y && box.x + box.width <= f.x + f.width && box.y + box.height <= f.y + f.height;
    const takenAt = (box) => boxes.some((n) => overlaps(box, n)) || frames.some((f) => overlaps(box, f) && !insideOf(box)(f))
      || edges.some((o) => { if (o === e) return false; const q = pathOf(o); return q?.some((p, i) => i > 0 && onLine(box, q[i - 1], p)) || (o.label && layout.edges.get(o.id)?.label && overlaps(box, layout.edges.get(o.id).label)); });
    // In a left-to-right chart the branches part a few pixels from the tip, one going on
    // straight and the others turning up or down, and the layout writes every answer in the
    // corner of that split, where each reads as the answer of the line next to it. A branch
    // that turns gets its answer beside the middle of the stretch it runs across the flow,
    // away from the straight line; the branch that goes on gets it above its line, past the
    // split.
    if (acrossIsVertical(direction) && parted + 1 < total) {
      const first = pointAlong(path, parted + 1);
      let own;
      if (first.vertical) {
        // The stretch across the flow, from the split to its next corner.
        let left = parted + 1;
        let seg;
        for (let i = 1; i < path.length && !seg; i++) {
          const l = Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
          if (left <= l) seg = { a: path[i - 1], b: path[i], from: l - (l - left) - 1 }; else left -= l;
        }
        const startY = seg.a.y + first.dir * seg.from;
        if (Math.abs(seg.b.y - startY) >= height + 2 * BRANCH_LABEL_GAP) {
          const mid = (startY + seg.b.y) / 2;
          own = [{ x: seg.a.x + LABEL_GAP, y: mid - height / 2, width, height }, { x: seg.a.x - LABEL_GAP - width, y: mid - height / 2, width, height }].find((b) => !takenAt(b));
        }
      } else {
        const at = pointAlong(path, Math.min(parted + BRANCH_LABEL_GAP, total / 2)).point;
        const above = { x: first.dir > 0 ? at.x : at.x - width, y: at.y - LABEL_GAP - height, width, height };
        if (!takenAt(above)) own = above;
      }
      if (own) { route.label = own; continue; }
    }
    if (route.label && alongOf(path, route.label) - parted <= BRANCH_LABEL_FAR) continue;
    const { point, vertical, dir } = pointAlong(path, Math.min(parted + BRANCH_LABEL_GAP, total / 2));
    // Beside a vertical stretch the text starts right of the line; along a horizontal one it
    // stands above the line and runs on from the point in the direction of the branch.
    const box = vertical
      ? { x: point.x + LABEL_GAP, y: dir > 0 ? point.y : point.y - height, width, height }
      : { x: dir > 0 ? point.x : point.x - width, y: point.y - LABEL_GAP - height, width, height };
    const taken = takenAt(box);
    // A place the layout gave stays when the one next to the decision is taken.
    if (taken && route.label) continue;
    route.label = box;
  }
}

/**
 * Report each step of a loop that was left outside the group the rest of the loop is in. A
 * group is laid out as one block, so such a step cannot stand between the steps it follows
 * and precedes: it lands above or below the whole block and its lines run round it. The
 * diagram still says the right thing; the remedy is one entry in the group's `children`.
 *
 * The group of a loop is the innermost group that holds more than half of its steps. A step
 * is astray when it lies in no group, or only in a group that encloses that one. A step in
 * another group altogether is left alone: a loop that returns to an earlier phase crosses
 * groups on purpose.
 */
function strayLoopSteps(ir, parent, warnings) {
  const component = cycleOf(ir.nodes, ir.edges);
  const loops = new Map();
  for (const n of ir.nodes) {
    const key = component.get(n.id);
    if (!loops.has(key)) loops.set(key, []);
    loops.get(key).push(n);
  }
  const chain = (id) => { const out = []; for (let g = parent.get(id); g; g = parent.get(g)) out.push(g); return out; };
  const labelOf = new Map((ir.groups ?? []).map((g) => [g.id, g.label]));
  for (const steps of loops.values()) {
    if (steps.length < 2) continue;
    const count = new Map();
    for (const n of steps) { const g = parent.get(n.id); if (g) count.set(g, (count.get(g) ?? 0) + 1); }
    const [home, held] = [...count].sort((a, b) => b[1] - a[1])[0] ?? [];
    if (!home || held * 2 <= steps.length) continue;
    const around = new Set(chain(home));
    for (const n of steps) {
      const own = parent.get(n.id);
      if (own === home || chain(n.id).includes(home)) continue;
      if (own !== undefined && !around.has(own)) continue;
      warnings.push({
        path: `/nodes/${ir.nodes.indexOf(n)}`,
        message: `layout: step "${n.id}" ("${n.label}") belongs to the loop inside group "${home}" ("${labelOf.get(home)}") but lies outside it, so it stands apart from the loop and its lines run round the group`,
        hint: `add "${n.id}" to the children of group "${home}"; leave it only if the step really is outside what the group stands for`,
      });
    }
  }
}

async function emitFlowchart(ir, cid, refs, warnings) {
  const parent = parentMap(ir.groups ?? []);
  const containers = (ir.groups ?? []).map((g) => ({ id: g.id, label: g.label, parent: parent.get(g.id), style: STYLE.container, title: plainTitle(g.label) }));
  // An edge that leads back to an earlier step is laid out against the flow, so a loop reads
  // downwards and its return line runs up beside it.
  strayLoopSteps(ir, parent, warnings);
  const back = backEdges(ir.nodes, ir.edges);
  const decisions = new Set(ir.nodes.filter((n) => n.shape === 'decision' && !n.ref).map((n) => n.id));
  // The answer on a branch that leads back is written by the emitter beside the side tip it
  // leaves (see placeBranchLabels), so it takes no room in the layout.
  const edges = ir.edges.map((e) => ({ id: e.id, from: e.from, to: e.to, label: e.label, style: STYLE.flowEdge, layoutReversed: back.has(e.id) || undefined, backSide: back.has(e.id) || undefined, labelPlacedByCaller: (decisions.has(e.from) && back.has(e.id)) || undefined, branch: decisions.has(e.from) || undefined }));
  const loopExtra = sideLoopRoom(edges, ir.direction);
  const nodes = ir.nodes.map((n, i) => {
    const shape = n.ref ? 'subroutine' : (n.shape ?? 'process');
    const { label, link } = refLabel(n.label, n.ref, refs, `/nodes/${i}/ref`, warnings);
    const size = shape === 'decision' ? measureDecision(label) : measureNode(label, textArea(shape));
    const extra = loopExtra.get(n.id) ?? 0;
    return { id: n.id, label, link, parent: parent.get(n.id), style: shape === 'decision' ? decisionStyle(size) : STYLE[shape], width: size.width + 2 * extra, height: size.height, drawWidth: extra ? size.width : undefined };
  });
  decisionPorts(nodes.filter((n) => decisions.has(n.id)), edges, back, ir.direction);
  // The layout gives each label a place of its own in the first layer after the node its
  // edge leaves. The branches of a decision share one line from its tip and part before that
  // layer, so each answer stands on its own branch, next to the decision.
  const arrange = () => layoutGraph({ nodes, containers, edges, direction: ir.direction, spacing: loopSpacing(ir.direction), options: { 'elk.layered.edgeLabels.centerLabelPlacementStrategy': 'TAIL_LAYER' } });
  let layout = await arrange();
  // A flow that enters a group from above runs across its header: the title steps aside, and
  // a group too narrow for that is widened, which moves the lines, so the titles are placed again.
  let unplaced = placeGroupTitles(layout, { containers, nodes, edges });
  for (let round = 0; unplaced && round < 6; round++) {
    layout = await arrange();
    unplaced = placeGroupTitles(layout, { containers, nodes, edges });
  }
  if (unplaced) warnings.push({ path: '/groups', message: 'layout: a flow crosses the title of a group; no free place was found for it along the top of the group', hint: 'shorten the group label or change "direction"' });
  for (const c of containers) if (c.titleOffset !== undefined) c.style = titleAt(c.style, c.titleOffset);
  const parentOf = new Map([...containers.map((c) => [c.id, c.parent]), ...nodes.map((n) => [n.id, n.parent])]);
  placeBranchLabels(layout, edges, nodes.map((n) => drawBox(n, absoluteBox(n.id, layout, parentOf))), containers.map((c) => absoluteBox(c.id, layout, parentOf)), ir.direction);
  return graphCells(cid, layout, { containers, nodes, edges, direction: ir.direction });
}

async function emitState(ir, cid, refs, warnings) {
  const kindOf = (s) => s.kind ?? 'simple';
  const composites = ir.states.filter((s) => kindOf(s) === 'composite');
  const parent = parentMap(composites);
  const label = (t) => {
    const head = [t.event, t.guard ? `[${t.guard}]` : ''].filter(Boolean).join(' ');
    return [head, t.action ? `/ ${t.action}` : ''].filter(Boolean).join(' ');
  };
  const edges = ir.transitions.map((t) => ({ id: t.id, from: t.from, to: t.to, label: label(t) || undefined, style: STYLE.flowEdge }));
  const loopExtra = sideLoopRoom(edges, ir.direction);
  const shown = new Map(ir.states.map((s, i) => [s.id, refLabel(s.label, s.ref, refs, `/states/${i}/ref`, warnings)]));
  // A composite's header is as tall as the lines of its title: a ref adds one.
  const compositeHeader = (lines) => 30 + 16 * (lines - 1);
  const containers = composites.map((s) => ({ id: s.id, label: shown.get(s.id).label, link: shown.get(s.id).link, parent: parent.get(s.id), style: STYLE.composite, headerHeight: compositeHeader(shown.get(s.id).label.split('\n').length) }));
  const nodes = ir.states.filter((s) => kindOf(s) !== 'composite').map((s) => {
    const kind = kindOf(s);
    const circle = kind === 'initial' || kind === 'final';
    const { label, link } = circle ? { label: '' } : shown.get(s.id);
    const size = circle ? { width: CIRCLE, height: CIRCLE } : measureNode(label);
    const extra = loopExtra.get(s.id) ?? 0;
    return { id: s.id, label, link, parent: parent.get(s.id), style: STYLE[kind] ?? STYLE.state, width: size.width + 2 * extra, height: size.height, drawWidth: extra ? size.width : undefined };
  });
  const spacing = loopSpacing(ir.direction);
  let layout = await layoutGraph({ nodes, containers, edges, direction: ir.direction, spacing });
  // A composite is as wide as its content, which only the layout knows; a title that wraps at
  // that width needs a taller header, and the layout runs once more with it.
  let taller = false;
  for (const c of containers) {
    const height = compositeHeader(headerLines(c.label, layout.containers.get(c.id).width));
    if (height > c.headerHeight) { c.headerHeight = height; taller = true; }
  }
  if (taller) layout = await layoutGraph({ nodes, containers, edges, direction: ir.direction, spacing });
  return graphCells(cid, layout, { containers, nodes, edges, direction: ir.direction });
}

const ROW = 26;
/** What each line after the first adds to a table header (a stereotype, the title of a ref). */
const HEADER_LINE = 20;

/** A table-like node (ER entity, class) with one child row per line; rows stack from the header. */
const ROW_LINE = 14;
const TABLE_MAX_WIDTH = 300;

/**
 * Height of one table row: a line that is wider than the row wraps at its words, and the row
 * grows with it. A row keeps 6 px on each side of its text and clips what does not fit, so
 * the lines are counted at the width that is sure to hold them.
 */
export function rowHeight(text, width) {
  const lines = wrapText(text ?? '', Math.max(safeWidth(width - 12), 1)).lines;
  return ROW + ROW_LINE * (lines - 1);
}

/** Lines a bold title takes in a header of the given width: its own line breaks plus word wrap. */
const headerLines = (text, width) => wrapText(text, Math.max(safeWidth(width - 8), 1), { bold: true }).lines;

function tableNode(id, header, rows, { headerHeight: minHeaderHeight = ROW, rowHeights, link } = {}) {
  const widest = Math.max(widestLine(header, { bold: true }), ...rows.map((r) => widestLine(r.text ?? '')));
  const width = Math.min(TABLE_MAX_WIDTH, Math.max(160, roomFor(widest) + 24));
  // The header grows with its lines as a row does: a stereotype, the title of a ref, and
  // any of them that is wider than the table and wraps.
  const headerHeight = Math.max(minHeaderHeight, ROW + HEADER_LINE * (headerLines(header, width) - 1));
  // A row that several relations end at on one side is as tall as their markers need (`rowHeights`).
  const heightOf = (r, i) => (r.separator ? 8 : Math.max(rowHeight(r.text, width), rowHeights?.get(i) ?? 0));
  const height = headerHeight + rows.reduce((h, r, i) => h + heightOf(r, i), 0);
  let y = headerHeight;
  const rowTops = [];
  const children = rows.map((r, i) => {
    const rowY = y;
    const h = heightOf(r, i);
    rowTops.push({ y: rowY, height: h });
    y += h;
    return (parentId) => (r.separator
      ? vertex({ id: `${parentId}:sep-${i}`, value: '', style: STYLE.separator, x: 0, y: rowY, width, height: 8, parent: parentId })
      : vertex({ id: `${parentId}:row-${i}`, value: htmlLabel(r.text), style: STYLE.row, x: 0, y: rowY, width, height: h, parent: parentId }));
  });
  return { id, label: header, link, style: `${STYLE.table}startSize=${headerHeight};`, width, height, children, headerHeight, rowTops };
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
async function emitEr(ir, cid, warnings, refs) {
  const rowsOf = (e) => (e.attributes ?? []).map((a) => {
    const key = a.key === 'pk' ? 'PK ' : a.key === 'fk' ? 'FK ' : '';
    return { text: `${key}${a.name}: ${a.type}${a.comment ? ` (${a.comment})` : ''}` };
  });
  // The header is as tall as its anchor band or its title lines (a ref adds one), whichever is more.
  const shown = new Map(ir.entities.map((e, i) => [e.id, refLabel(e.label, e.ref, refs, `/entities/${i}/ref`, warnings)]));
  const buildNodes = (headerHeights, rowHeights = new Map()) => ir.entities.map((e) => tableNode(e.id, shown.get(e.id).label, rowsOf(e), { headerHeight: headerHeights.get(e.id) ?? ROW, rowHeights: rowHeights.get(e.id), link: shown.get(e.id).link }));
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
    // An end on the top or the bottom side is spread across the width whatever row it names,
    // so all ends of that side form one group; two of them would otherwise share the middle.
    const across = end.side === 'top' || end.side === 'bottom';
    const key = `${end.entity}|${end.side}|${across ? 'header' : end.row ?? 'header'}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(end);
  }
  const headerHeights = new Map();
  for (const [key, group] of groups) {
    if (!key.endsWith('|header')) continue;
    const [entity, side] = key.split('|');
    // Anchors on the top or the bottom side are spread across the width, not down the header.
    if (side === 'top' || side === 'bottom') continue;
    headerHeights.set(entity, Math.max(headerHeights.get(entity) ?? ROW, ROW + ER_ANCHOR_PITCH * (group.length - 1)));
  }
  // The same for an attribute row that several relations end at on one side (a key that
  // two tables refer to): 8 px apart their markers would lie on top of each other.
  const rowHeights = new Map();
  for (const [key, group] of groups) {
    const [entity, side, row] = key.split('|');
    if (row === 'header' || group.length < 2 || side === 'top' || side === 'bottom' || side === 'loop') continue;
    if (!rowHeights.has(entity)) rowHeights.set(entity, new Map());
    const rows = rowHeights.get(entity);
    rows.set(Number(row), Math.max(rows.get(Number(row)) ?? 0, ROW + ER_ANCHOR_PITCH * (group.length - 1)));
  }
  nodes = buildNodes(headerHeights, rowHeights);
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
        const along = end.row !== undefined && (end.side === 'left' || end.side === 'right' || end.side === 'loop')
          ? n.rowTops[end.row].y + n.rowTops[end.row].height / 2 + (group.length > 1 ? (k - (group.length - 1) / 2) * (end.side === 'left' || end.side === 'right' ? ER_ANCHOR_PITCH : 8) : 0)
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

async function emitClass(ir, cid, warnings, refs) {
  const nodes = ir.classes.map((c, i) => {
    const attrs = (c.attributes ?? []).map((a) => ({ text: `${a.visibility ? VISIBILITY[a.visibility] : ''}${a.name}${a.type ? `: ${a.type}` : ''}` }));
    const methods = (c.methods ?? []).map((m) => ({ text: `${m.visibility ? VISIBILITY[m.visibility] : ''}${m.name}(${m.params ?? ''})${m.returns ? `: ${m.returns}` : ''}` }));
    const rows = attrs.length && methods.length ? [...attrs, { separator: true }, ...methods] : [...attrs, ...methods];
    const { label: header, link } = refLabel(c.stereotype ? `«${c.stereotype}»\n${c.label}` : c.label, c.ref, refs, `/classes/${i}/ref`, warnings);
    return tableNode(c.id, header, rows, { link });
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
  // A self-relation drawn beside its class needs room there for the loop and its label, or
  // the label lands on the neighbouring class: the layout gets the class that much wider on
  // both sides and the table is drawn centred in it, as for an ER entity.
  for (const [id, extra] of sideLoopRoom(edges, ir.direction)) {
    const n = nodes.find((x) => x.id === id);
    n.drawWidth = n.width;
    n.width += 2 * extra;
  }
  const layout = await layoutGraph({ nodes, edges, direction: ir.direction, spacing: { nodeNode: 60, layer: 80, ...loopSpacing(ir.direction) } });
  return graphCells(cid, layout, { containers: [], nodes, edges, direction: ir.direction }, warnings);
}

/** The screen figure of a client; its label is drawn below it. */
const CLIENT_FIGURE = { width: 54, height: 44 };
/**
 * An AWS service icon, at the size draw.io's AWS library places it; its label is drawn below
 * it. `below` is room under that label: a connection that leaves the icon downwards starts
 * there, a little clear of the name instead of against its last line.
 */
const AWS_ICON = { width: 78, height: 78, below: 6 };
/**
 * The style draw.io's AWS palette gives a service icon. The colour is not part of the
 * stencil: each service category has its own fill, which the catalog records.
 */
const AWS_ICON_POINTS = 'points=[[0,0,0],[0.25,0,0],[0.5,0,0],[0.75,0,0],[1,0,0],[0,1,0],[0.25,1,0],[0.5,1,0],[0.75,1,0],[1,1,0],[0,0.25,0],[0,0.5,0],[0,0.75,0],[1,0.25,0],[1,0.5,0],[1,0.75,0]];';
const awsIconStyle = (icon) => `sketch=0;${AWS_ICON_POINTS}outlineConnect=0;fontColor=#232F3E;${icon.gradient ? `gradientColor=${icon.gradient};gradientDirection=north;` : ''}fillColor=${icon.fill};strokeColor=#ffffff;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;whiteSpace=wrap;fontSize=12;fontStyle=0;aspect=fixed;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.${icon.name};`;
/**
 * The style of a figure that is a stencil of its own: a general resource of the AWS library
 * (a server, an application) or a product logo. It is drawn in one colour without a square
 * behind it, which is how a system that is not an AWS service is told from one.
 */
const stencilStyle = (icon) => `sketch=0;outlineConnect=0;fontColor=#232F3E;gradientColor=none;fillColor=${icon.fill};strokeColor=none;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;whiteSpace=wrap;fontSize=12;fontStyle=0;aspect=fixed;shape=${icon.stencil};`;
/** The corner icon of an AWS group frame and the gap before its title (the palette's `spacingLeft=30`). */
const AWS_GROUP_ICON = 30;
/**
 * Room between an AWS group frame and its members. AWS diagrams nest four or five frames
 * (account, region, VPC, subnet) where a plain one nests one or two, so the 20 px a plain
 * boundary keeps on each side would add up to a wide empty band around the innermost members.
 */
const AWS_FRAME_INSET = 12;
/** Room kept between a frame title and its frame's side. */
const TITLE_GAP = 8;
/** Room kept between a frame title and a line that crosses the top of its frame. */
const TITLE_LINE_GAP = 12;
/**
 * An AWS group frame as a container. The palette's style is kept, with two changes. A frame
 * that is a plain rectangle there (an Availability Zone) gains the container flags the
 * stencil frames already carry. The Auto Scaling group, whose palette form has its icon and
 * title in the middle of the top side, is drawn like every other frame, icon in the corner
 * and title beside it: a title in the corner can step aside when a connection enters the
 * frame from above, a fixed icon in the middle cannot. The title of a frame stands on one
 * line, so the frame is at least that wide.
 */
function awsGroupContainer(group, label) {
  const corner = group.style
    .replace('shape=mxgraph.aws4.groupCenter;', 'shape=mxgraph.aws4.group;')
    .replace('align=center;', `align=left;spacingLeft=${AWS_GROUP_ICON};`)
    .replace('spacingTop=25;', '');
  const stencil = corner.includes('shape=mxgraph.aws4.');
  const text = measureLabelBelow(label, { maxWidth: 360 });
  const start = stencil ? AWS_GROUP_ICON : TITLE_GAP;
  return {
    style: stencil ? corner : `${corner}container=1;pointerEvents=0;collapsible=0;recursiveResize=0;`,
    title: { width: text.width, height: text.height + 4, start, centred: !stencil },
    inset: AWS_FRAME_INSET,
    minWidth: Math.min(400, 2 * Math.ceil((start + text.width + TITLE_GAP) / 2)),
  };
}

/**
 * The title of a plain frame (a boundary, a flowchart group) for `placeGroupTitles`: bold, on
 * one line, centred in the header strip. `plain` leaves a frame no line crosses exactly as
 * draw.io draws it, wrapped title included.
 */
const plainTitle = (label, header = 30) => ({ width: Math.ceil(wrapText(label, Infinity, { bold: true }).widest) + 4, height: header, start: TITLE_GAP, centred: true, plain: true });

/**
 * Put the title of each group frame where no connection crosses it. A frame title lies
 * in the header strip along the top of its frame; a connection that enters or leaves the
 * frame through its top side runs across that strip. The title keeps its usual place (beside
 * the corner icon, or centred on a plain frame) when that place is free, and otherwise moves
 * along the strip to the free stretch nearest to it. A frame with no free stretch long
 * enough is given a larger minimum width; the caller then lays the diagram out again.
 * @returns {boolean} whether a frame was widened, so the layout has to run again
 */
function placeGroupTitles(layout, { containers, nodes, edges }) {
  const parentOf = new Map([...containers.map((c) => [c.id, c.parent]), ...nodes.map((n) => [n.id, n.parent])]);
  const lines = [];
  for (const e of edges) {
    const r = layout.edges.get(e.id);
    if (!r?.start || !r?.end) continue;
    const path = [r.start, ...(r.points ?? []), r.end];
    for (let i = 1; i < path.length; i++) lines.push({ x0: Math.min(path[i - 1].x, path[i].x), x1: Math.max(path[i - 1].x, path[i].x), y0: Math.min(path[i - 1].y, path[i].y), y1: Math.max(path[i - 1].y, path[i].y) });
    if (e.label && r.label) lines.push({ x0: r.label.x, x1: r.label.x + r.label.width, y0: r.label.y, y1: r.label.y + r.label.height });
  }
  let widened = false;
  for (const c of containers) {
    if (!c.title) continue;
    const frame = absoluteBox(c.id, layout, parentOf);
    const { width, height, start, centred, plain } = c.title;
    const lo = frame.x + start;
    const hi = frame.x + frame.width - TITLE_GAP;
    // The stretches of the strip that a line runs through, each with a gap on both sides.
    const taken = lines
      .filter((l) => l.y1 >= frame.y && l.y0 <= frame.y + height && l.x1 >= frame.x && l.x0 <= frame.x + frame.width)
      .map((l) => [l.x0 - TITLE_LINE_GAP, l.x1 + TITLE_LINE_GAP])
      .sort((a, b) => a[0] - b[0]);
    if (plain && taken.length === 0) { c.titleOffset = undefined; continue; }
    const free = [];
    let at = lo;
    for (const [a, b] of taken) {
      if (a > at) free.push([at, Math.min(a, hi)]);
      at = Math.max(at, b);
    }
    if (at < hi) free.push([at, hi]);
    const usual = centred ? frame.x + (frame.width - width) / 2 : lo;
    let best;
    for (const [a, b] of free) {
      if (b - a < width) continue;
      const x = Math.min(Math.max(usual, a), b - width);
      if (best === undefined || Math.abs(x - usual) < Math.abs(best - usual)) best = x;
    }
    if (best === undefined) {
      const longest = free.reduce((m, [a, b]) => Math.max(m, b - a), 0);
      c.minWidth = 2 * Math.ceil((Math.max(c.minWidth ?? 0, frame.width) + width - longest + 2) / 2);
      c.titleOffset = undefined;
      widened = true;
    } else {
      c.titleOffset = Math.abs(best - usual) < 0.5 ? undefined : Math.round(best - frame.x);
    }
  }
  return widened;
}

/** The style of a group frame with its title moved `offset` px in from the frame's left side. */
const titleAt = (style, offset) => (/spacingLeft=\d+;/.test(style) ? style.replace(/spacingLeft=\d+;/, `spacingLeft=${offset};`) : `${style}align=left;spacingLeft=${offset};`);

/**
 * Put a component that stands outside every frame on the nearer side of the frames it talks
 * to. The layout places a component after everything that calls it, so an outside system
 * called from the middle of a frame lands beyond the far end of that frame, and its
 * connection runs past every component in between. Each such component (outside all frames
 * and only called, by components inside frames) is tried on
 * the other side; the arrangement is kept when its connections come out at least a fifth
 * shorter. The arrow still points the way the IR says.
 */
async function nearSide(layout, { nodes, edges }, arrange) {
  const inFrame = new Map(nodes.map((n) => [n.id, n.parent !== undefined]));
  const lengthOf = (l, own) => own.reduce((sum, e) => {
    const r = l.edges.get(e.id);
    if (!r?.start || !r?.end) return sum;
    const path = [r.start, ...(r.points ?? []), r.end];
    return sum + path.slice(1).reduce((s, p, i) => s + Math.abs(p.x - path[i].x) + Math.abs(p.y - path[i].y), 0);
  }, 0);
  const outside = nodes.filter((n) => !inFrame.get(n.id)).slice(0, 8);
  for (const n of outside) {
    const own = edges.filter((e) => e.from !== e.to && (e.from === n.id || e.to === n.id));
    if (own.length === 0) continue;
    // Only a system that is called: one that calls in belongs where the flow starts.
    if (!own.every((e) => e.to === n.id && inFrame.get(e.from))) continue;
    for (const e of own) e.layoutReversed = true;
    const tried = await arrange();
    if (lengthOf(tried, own) < 0.8 * lengthOf(layout, own)) { layout = tried; continue; }
    for (const e of own) delete e.layoutReversed;
  }
  // The ports on the nodes belong to the last arrangement tried; restore the kept one.
  return arrange();
}

/**
 * Write the label of each connection beside its own line. The layout engine gives a label a
 * layer of its own between the two ends, 96 px of extra room for every labelled connection
 * between two components; in a diagram of icons joined by straight lines that room is
 * already there along the line, so the label is placed on it and the layout keeps the
 * components at their usual distance.
 *
 * A label stands at the middle of a stretch of the longest segment of its line: above or
 * below a horizontal stretch, left or right of a vertical one. A stretch ends where the line
 * crosses the border of a frame, so a label never lies across a border. The place must be
 * free: no component or name, no other label, no other line, no corner icon of a frame.
 * @returns {string|undefined} the id of the first connection whose label has no such place;
 *   the caller hands that label back to the layout engine and lays out again
 */
function placeLineLabels(layout, own, { containers, nodes, edges }) {
  const parentOf = new Map([...containers.map((c) => [c.id, c.parent]), ...nodes.map((n) => [n.id, n.parent])]);
  const hit = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  const within = (a, b) => a.x >= b.x && a.y >= b.y && a.x + a.width <= b.x + b.width && a.y + a.height <= b.y + b.height;
  const boxes = nodes.filter((n) => layout.nodes.has(n.id)).map((n) => absoluteBox(n.id, layout, parentOf));
  const frames = containers.map((c) => ({ box: absoluteBox(c.id, layout, parentOf), icon: c.title && !c.title.centred }));
  const corners = frames.filter((f) => f.icon).map((f) => ({ x: f.box.x, y: f.box.y, width: AWS_GROUP_ICON, height: AWS_GROUP_ICON }));
  const pathOf = (e) => { const r = layout.edges.get(e.id); return r?.start && r?.end ? [r.start, ...(r.points ?? []), r.end] : undefined; };
  const lines = [];
  const labels = [];
  for (const e of edges) {
    const path = pathOf(e);
    if (!path) continue;
    for (let i = 1; i < path.length; i++) lines.push({ id: e.id, x: Math.min(path[i - 1].x, path[i].x) - 1, y: Math.min(path[i - 1].y, path[i].y) - 1, width: Math.abs(path[i].x - path[i - 1].x) + 2, height: Math.abs(path[i].y - path[i - 1].y) + 2 });
    const label = layout.edges.get(e.id).label;
    if (e.label && label && !own.has(e.id)) labels.push(label);
  }
  for (const e of edges) {
    if (!own.has(e.id)) continue;
    const path = pathOf(e);
    if (!path) return e.id;
    const text = { width: Math.ceil(widestLine(e.label)) + 8, height: 16 * String(e.label).split(/\r\n?|\n/).length };
    let longest;
    for (let i = 1; i < path.length; i++) {
      const length = Math.abs(path[i].x - path[i - 1].x) + Math.abs(path[i].y - path[i - 1].y);
      if (!longest || length > longest.length) longest = { a: path[i - 1], b: path[i], length };
    }
    // A line that shares a stretch with others of its caller is labelled on a stretch that is
    // its own, the longest of them that has a free place.
    const mine = layout.edges.get(e.id).own;
    const length = (sg) => Math.abs(sg.a.x - sg.b.x) + Math.abs(sg.a.y - sg.b.y);
    const candidates = mine ? mine.map(([p, q]) => ({ a: p, b: q })).sort((p, q) => length(q) - length(p)) : [longest];
    let placed;
    for (const segment of candidates) {
      const flat = Math.abs(segment.a.y - segment.b.y) < 0.5;
      const along = flat ? 'x' : 'y';
      const from = Math.min(segment.a[along], segment.b[along]);
      const to = Math.max(segment.a[along], segment.b[along]);
      const at = flat ? segment.a.y : segment.a.x;
      // Where the segment crosses a frame border, and the stretches between those points.
      const cuts = [from, to];
      for (const { box } of frames) {
        const spans = flat ? at > box.y && at < box.y + box.height : at > box.x && at < box.x + box.width;
        if (!spans) continue;
        for (const edgeAt of flat ? [box.x, box.x + box.width] : [box.y, box.y + box.height]) if (edgeAt > from && edgeAt < to) cuts.push(edgeAt);
      }
      cuts.sort((p, q) => p - q);
      const need = (flat ? text.width : text.height) + 12;
      const stretches = cuts.slice(1).map((end, i) => ({ start: cuts[i], end })).filter((s) => s.end - s.start >= need).sort((p, q) => (q.end - q.start) - (p.end - p.start));
      for (const s of stretches) {
        // The middle of the stretch; on a line's own stretch among lines that run beside it,
        // also the places towards its ends, where a neighbour may have turned off already.
        const room = (s.end - s.start - need) / 2;
        const options = (mine ? [0, -0.5, 0.5, -1, 1] : [0]).flatMap((shift) => {
          const mid = (s.start + s.end) / 2 + shift * room;
          return flat
            ? [{ x: mid - text.width / 2, y: at - text.height - 4 }, { x: mid - text.width / 2, y: at + 4 }]
            : [{ x: at - 6 - text.width, y: mid - text.height / 2 }, { x: at + 6, y: mid - text.height / 2 }];
        });
        for (const o of options) {
          const box = { ...o, width: text.width, height: text.height };
          if (boxes.some((n) => hit(box, n)) || labels.some((l) => hit(box, l)) || corners.some((c) => hit(box, c))) continue;
          if (lines.some((l) => hit(box, l))) continue;
          // Not across the border of a frame: wholly inside it or wholly outside.
          if (frames.some((f) => hit(box, f.box) && !within(box, f.box))) continue;
          placed = box;
          break;
        }
        if (placed) break;
      }
      if (placed) break;
    }
    if (!placed) return e.id;
    layout.edges.get(e.id).label = placed;
    labels.push(placed);
  }
  return undefined;
}

/**
 * The stores that stand next to the component that uses them: a component with one
 * connection, from a figure in the same frame that also passes work on to something else.
 * The layout engine gives every connection a place along the flow, so such a store takes
 * the next place on its user's row and the connection that goes on has to bend round it,
 * close by its name. Standing beside its user, across the flow, the store leaves the row
 * free: below the user in a left-to-right diagram, to its right in a top-down one.
 *
 * The user's layout box is enlarged to hold both and the store is left out of the layout;
 * `placeStores` puts it in afterwards. One store per user: a second one stays in the flow.
 * @returns {Map<string, {edge:object, user:object}>} store id to its connection and user
 */
function attachStores(nodes, edges, direction, placedElsewhere = new Map()) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const sideways = acrossIsVertical(direction);
  const out = new Map();
  const users = new Set();
  for (const store of nodes) {
    if (placedElsewhere.has(store.id)) continue;
    const own = edges.filter((e) => e.from === store.id || e.to === store.id);
    if (own.length !== 1 || own[0].to !== store.id || own[0].from === store.id) continue;
    const user = byId.get(own[0].from);
    if (user.drawWidth === undefined || user.parent !== store.parent || users.has(user.id) || out.has(user.id)) continue;
    if (!edges.some((e) => e.from === user.id && e.to !== store.id && e.to !== user.id)) continue;
    const e = own[0];
    const text = e.label ? { width: Math.ceil(widestLine(e.label)) + 8, height: 16 * String(e.label).split(/\r\n?|\n/).length } : { width: 0, height: 0 };
    const mine = { width: user.width, height: user.height };
    if (sideways) {
      // Below the user, on its column; the label stands to the right of the line between them.
      const gap = Math.max(STORE_GAP, text.height + 24);
      user.width = 2 * Math.ceil(Math.max(mine.width, store.width, 2 * (text.width + 10)) / 2);
      user.height = mine.height + gap + store.height;
      user.store = { gap, mine, text };
    } else {
      // To the right of the user, figure level with figure; the label stands above the line.
      // The room is counted between the two figures: enough for the label, and for the two
      // names, which reach past their figures on both sides, to stay apart.
      const pastUser = (mine.width - user.drawWidth) / 2;
      const pastStore = (store.width - (store.drawWidth ?? store.width)) / 2;
      const between = Math.max(STORE_GAP, text.width + 24, pastUser + pastStore + 16);
      const gap = between - pastUser - pastStore;
      user.drawX = (mine.width - user.drawWidth) / 2;
      user.width = mine.width + gap + store.width;
      user.height = Math.max(mine.height, store.height);
      user.store = { gap, mine, text };
    }
    users.add(user.id);
    out.set(store.id, { edge: e, user });
  }
  return out;
}

/** Room between a component and the store that stands beside it, when their connection has no label. */
const STORE_GAP = 50;

/** Write the place of each attached store, and the straight line to it, into `layout`. */
function placeStores(layout, stores, { containers, nodes, direction }) {
  const parentOf = new Map([...containers.map((c) => [c.id, c.parent]), ...nodes.map((n) => [n.id, n.parent])]);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const sideways = acrossIsVertical(direction);
  for (const [id, { edge: e, user }] of stores) {
    const store = byId.get(id);
    const box = layout.nodes.get(user.id);
    const abs = absoluteBox(user.id, layout, parentOf);
    const { gap, mine, text } = user.store;
    const figure = (n) => ({ width: n.drawWidth ?? n.width, height: n.drawHeight ?? n.height });
    let place; let start; let end; let label;
    if (sideways) {
      place = { x: (user.width - store.width) / 2, y: mine.height + gap };
      const x = abs.x + user.width / 2;
      start = { x, y: abs.y + mine.height };
      end = { x, y: abs.y + place.y };
      label = { x: x + 6, y: abs.y + mine.height + (gap - text.height) / 2, width: text.width, height: text.height };
    } else {
      const top = (figure(user).height - figure(store).height) / 2;
      place = { x: mine.width + gap, y: top };
      const y = abs.y + figure(user).height / 2;
      start = { x: abs.x + user.drawX + user.drawWidth, y };
      end = { x: abs.x + place.x + (store.width - figure(store).width) / 2, y };
      label = { x: (start.x + end.x - text.width) / 2, y: y - text.height - 4, width: text.width, height: text.height };
    }
    layout.nodes.set(id, { x: box.x + place.x, y: box.y + place.y, width: store.width, height: store.height });
    layout.edges.set(e.id, { start, end, points: [], label: e.label ? label : undefined });
  }
}

/**
 * Whether a component outside every frame is a system the diagram only talks to: a plain box,
 * or an external system drawn with an icon. A client has a figure too, but it is where the
 * flow starts, and an AWS service outside the frames belongs to the flow.
 */
const standsOutside = (n) => n.parent === undefined && (n.drawWidth === undefined || n.kind === 'external');

/**
 * The components that can stand beside the frames instead of at an end of the flow: a system
 * outside every frame whose one connection comes from a component inside a frame (a
 * third-party API that one service calls).
 * @returns {Map<string, object>} component id to its connection
 */
function asideCandidates(nodes, edges) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out = new Map();
  for (const n of nodes) {
    if (!standsOutside(n)) continue;
    const own = edges.filter((e) => e.from === n.id || e.to === n.id);
    if (own.length !== 1 || own[0].to !== n.id || own[0].from === n.id) continue;
    if (byId.get(own[0].from)?.parent === undefined) continue;
    out.set(n.id, own[0]);
  }
  return out;
}

/**
 * The systems that stand in a row along the frames. The layout engine gives every component
 * one place along the flow, after everything that calls it, and two kinds of system outside
 * the frames have no good place there:
 *
 * - one that is only called, and called by a component that is itself outside the frames (a
 *   browser that talks to an identity provider the API also uses): it lands at the far end of
 *   the flow and the connection from the client at the start runs the length of the picture;
 * - one that calls into the frames and is called from them, so that the connections form a
 *   circle (a partner system that pushes data in and is queried in turn): wherever it stands
 *   along the flow, one of its connections runs back past everything in between. The circle
 *   need not run through components: a system that one component in the frames calls and
 *   that calls another one further down the flow is on a circle with the frames themselves,
 *   and the layout engine, which places it against the outermost frame as a whole, would
 *   send one of the two connections round the picture.
 *
 * In a row beside the frames such a system is near every component it talks to. The same
 * holds for a system and one component that call each other, written as two connections.
 * @returns {Map<string, object[]>} component id to its connections
 */
function rowCandidates(nodes, edges, aside) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const circle = cycleOf(nodes, edges);
  const members = new Map();
  for (const id of circle.values()) members.set(id, (members.get(id) ?? 0) + 1);
  const out = new Map();
  for (const n of nodes) {
    if (!standsOutside(n) || aside.has(n.id)) continue;
    const own = edges.filter((e) => (e.from === n.id) !== (e.to === n.id));
    if (own.length === 0 || own.length !== edges.filter((e) => e.from === n.id || e.to === n.id).length) continue;
    const others = own.map((e) => (e.from === n.id ? e.to : e.from));
    const onlyCalled = own.every((e) => e.to === n.id);
    // Two connections with one component are the two ways of an exchange (it calls the
    // system, the system calls it back): each gets a line of its own in the row. Two calls
    // the same way are parallel connections, which the layout engine draws side by side.
    if (onlyCalled && new Set(others).size !== own.length) continue;
    const calledFromOutside = onlyCalled && own.some((e) => byId.get(e.from)?.parent === undefined);
    const inCircle = !onlyCalled && own.some((e) => e.to === n.id) && members.get(circle.get(n.id)) > 1;
    const inFrame = (id) => byId.get(id)?.parent !== undefined;
    const throughFrames = own.some((e) => e.to === n.id && inFrame(e.from)) && own.some((e) => e.from === n.id && inFrame(e.to));
    if (calledFromOutside || inCircle || throughFrames) out.set(n.id, own);
  }
  return out;
}

/** Room between what is drawn and the first line that runs to a row, and between that run and the row. */
const ROW_GAP = 30;
/** Room between two lines that run side by side towards a row, at least; more where a label stands between them. */
const ROW_TRACK = 20;
/** Room between the last line that runs along a row and the systems of the row: a label fits beside the line there. */
const ROW_END = 44;
/** Room between two systems of a row. */
const ROW_BETWEEN = 40;
/** How far along the flow a line may step aside from its caller to find a free way to a row. */
const ROW_STEP_ASIDE = 240;

/**
 * Place each system of `row` in a row along the frames, across the flow from them: below or
 * above the picture in a left-to-right diagram, to its right or left in a top-down one. Each
 * stands between its callers along the flow. A connection leaves its caller straight across
 * the flow, out of the frames, turns once to run along them and once more into the system;
 * the connections of one caller share that first stretch, and each caller has a track of its
 * own for the run, so no two lines of different callers lie on each other.
 *
 * A side is usable for a system when the way out of every one of its callers is free: no
 * other component or name, no frame the caller is not in, no label, and no other connection
 * running the same way. The side that is nearer to the callers wins. The placement is written
 * into `layout`.
 * @returns {string|undefined} the id of the first system with no usable side, or undefined
 */
export function placeRow(layout, row, { containers, nodes, edges, direction, aside = new Map() }) {
  if (row.size === 0) return undefined;
  const parentOf = new Map([...containers.map((c) => [c.id, c.parent]), ...nodes.map((n) => [n.id, n.parent])]);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  // The work is done as for a left-to-right diagram, flow along x and the row below or above;
  // a top-down diagram is the same picture with x and y exchanged.
  const sideways = acrossIsVertical(direction);
  const turn = (b) => (sideways ? b : { x: b.y, y: b.x, width: b.height, height: b.width });
  // Always a new point: several lines share the way out of their caller.
  const turnPoint = (pt) => (sideways ? { x: pt.x, y: pt.y } : { x: pt.y, y: pt.x });
  const hit = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  const placed = nodes.filter((n) => layout.nodes.has(n.id) && !row.has(n.id)).map((n) => {
    const whole = absoluteBox(n.id, layout, parentOf);
    return { id: n.id, n, box: turn(whole), figure: turn(drawBox(n, whole)) };
  });
  const placedById = new Map(placed.map((x) => [x.id, x]));
  const frames = containers.map((c) => ({ id: c.id, box: turn(absoluteBox(c.id, layout, parentOf)) }));
  const segments = [];
  const labels = [];
  for (const e of edges) {
    if (row.has(e.to) || row.has(e.from)) continue;
    const r = layout.edges.get(e.id);
    if (!r?.start || !r?.end) continue;
    const path = [r.start, ...(r.points ?? []), r.end].map(turnPoint);
    for (let i = 1; i < path.length; i++) segments.push({ a: path[i - 1], b: path[i] });
    if (e.label && r.label) labels.push(turn(r.label));
  }
  // A system that stands beside the frames on its own, level with its one caller, belongs to
  // the row on its side: it is moved out to stand in line with the row (below), so the room
  // for the lines of the row is counted from the frames, not from that system.
  const alone = placed.filter((x) => aside.has(x.id));
  const drawn = [...placed.filter((x) => !aside.has(x.id)).map((x) => x.box), ...frames.map((f) => f.box), ...labels, ...segments.map((sg) => ({ x: Math.min(sg.a.x, sg.b.x), y: Math.min(sg.a.y, sg.b.y), width: Math.abs(sg.a.x - sg.b.x), height: Math.abs(sg.a.y - sg.b.y) }))];
  const top = Math.min(...drawn.map((b) => b.y));
  const bottom = Math.max(...drawn.map((b) => b.y + b.height));

  // The way out of a caller on a side: where the line starts, and the column it runs down (or
  // up) to the row. The column under the caller's own figure comes first. When something
  // stands in it (another component of the same column, a label, a line running the same
  // way), the line leaves the caller sideways instead, along the flow, and takes the nearest
  // free column: a short step aside costs one bend, where giving up would send the system
  // back to the far end of the flow.
  const columnFree = (caller, x, from, to, around) => {
    const lane = { x: x - 10, y: Math.min(from, to), width: 20, height: Math.abs(to - from) + 1 };
    if (placed.some((o) => o.id !== caller.id && hit(lane, o.box))) return false;
    if (frames.some((f) => (!around.has(f.id) && hit(lane, f.box)) || (hit(lane, f.box) && (Math.abs(f.box.x - x) < 10 || Math.abs(f.box.x + f.box.width - x) < 10)))) return false;
    if (labels.some((l) => hit(lane, l))) return false;
    // Another connection may cross the column, not run along it.
    return !segments.some((sg) => Math.abs(sg.a.x - sg.b.x) < 0.5 && hit(lane, { x: sg.a.x - 0.5, y: Math.min(sg.a.y, sg.b.y), width: 1, height: Math.abs(sg.a.y - sg.b.y) }));
  };
  const stepFree = (caller, x0, x1, y) => {
    const run = { x: Math.min(x0, x1), y: y - 8, width: Math.abs(x1 - x0), height: 16 };
    if (placed.some((o) => o.id !== caller.id && hit(run, o.box))) return false;
    if (labels.some((l) => hit(run, l))) return false;
    return !segments.some((sg) => Math.abs(sg.a.y - sg.b.y) < 0.5 && hit(run, { x: Math.min(sg.a.x, sg.b.x), y: sg.a.y - 0.5, width: Math.abs(sg.a.x - sg.b.x), height: 1 }));
  };
  const ways = new Map();
  // `offset` moves the way off the middle of the caller: two connections between one
  // component and one system leave side by side, where the lines to different systems
  // share the way out.
  const leave = (caller, side, offset = 0) => {
    const key = `${caller.id}|${side}|${offset}`;
    if (!ways.has(key)) ways.set(key, findWay(caller, side, offset));
    return ways.get(key);
  };
  const findWay = (caller, side, offset) => {
    // A store stands on that side of its user: no line leaves that way.
    if (side > 0 && caller.n.store) return undefined;
    const { figure, box } = caller;
    const edge = side > 0 ? bottom : top;
    const around = new Set();
    for (let p = parentOf.get(caller.id); p; p = parentOf.get(p)) around.add(p);
    const centre = Math.round(figure.x + figure.width / 2) + offset;
    // Downwards in a left-to-right diagram the line starts under the caller's name.
    const under = side > 0 ? (sideways ? box.y + box.height : figure.y + figure.height) : figure.y;
    if (columnFree(caller, centre, under, edge, around)) return { start: { x: centre, y: under }, via: [], x: centre };
    // Lines side by side keep their place under the caller: none steps aside on its own.
    if (offset !== 0) return undefined;
    for (let step = 20; step <= ROW_STEP_ASIDE; step += 10) {
      for (const dir of [1, -1]) {
        const x = centre + dir * step;
        const from = dir > 0 ? figure.x + figure.width : figure.x;
        if ((x - from) * dir < 25) continue;
        // The step aside leaves the figure in its half towards the row, clear of the lines along the flow.
        for (const share of side > 0 ? [0.75, 0.9, 0.6] : [0.25, 0.1, 0.4]) {
          const y = Math.round(figure.y + figure.height * share);
          if (!stepFree(caller, from, x, y) || !columnFree(caller, x, y, edge, around)) continue;
          return { start: { x: from, y }, via: [{ x, y }], x };
        }
      }
    }
    return undefined;
  };

  // The side of each system, and the callers that send a line to each side.
  const members = [];
  for (const [id, own] of row) {
    // The other end of each connection; "caller" also where the system is the one that calls.
    const callers = own.map((e) => ({ e, caller: placedById.get(e.from === id ? e.to : e.from) }));
    if (callers.some((c) => !c.caller)) return id;
    // The connections of one component with this system, `ROW_TRACK` apart around its middle.
    for (const c of callers) {
      const mates = callers.filter((o) => o.caller === c.caller).sort((p, q) => p.e.id.localeCompare(q.e.id));
      c.offset = (mates.indexOf(c) - (mates.length - 1) / 2) * ROW_TRACK;
    }
    const options = [];
    for (const side of [1, -1]) {
      const starts = callers.map((c) => leave(c.caller, side, c.offset));
      if (starts.some((st) => !st)) continue;
      const far = starts.reduce((sum, st) => sum + (side > 0 ? bottom - st.start.y : st.start.y - top) + 40 * st.via.length, 0);
      options.push({ side, starts, far });
    }
    if (options.length === 0) return id;
    options.sort((p, q) => p.far - q.far || q.side - p.side);
    const { side, starts } = options[0];
    const node = byId.get(id);
    const size = turn({ x: 0, y: 0, width: node.width, height: node.height });
    const figure = turn(drawBox(node, { x: 0, y: 0, width: node.width, height: node.height }));
    members.push({ id, side, size, figure, lines: callers.map((c, i) => ({ e: c.e, from: c.caller.id, way: starts[i] })), wants: starts.reduce((sum, st) => sum + st.x, 0) / starts.length });
  }

  const out = [];
  for (const side of [1, -1]) {
    const here = members.filter((m) => m.side === side).sort((p, q) => p.wants - q.wants || p.id.localeCompare(q.id));
    if (here.length === 0) continue;
    // The systems that stand beside the frames on this side already, each on the line from its caller.
    const inside = frames.length > 0 ? frames.map((f) => f.box) : placed.filter((x) => !aside.has(x.id)).map((x) => x.box);
    const fixed = alone.filter((x) => (side > 0 ? x.box.y >= Math.max(...inside.map((b) => b.y + b.height)) : x.box.y + x.box.height <= Math.min(...inside.map((b) => b.y))));
    // Each system under the middle of its callers, moved along the row where two would overlap.
    let after = -Infinity;
    const runs = [];
    for (const m of here) {
      // By its figure, not by its box: the name below a figure makes the box longer on one
      // side in a top-down diagram, and a line that goes straight on should meet the figure
      // in its middle.
      m.x = Math.max(Math.round(m.wants - m.figure.x - m.figure.width / 2), after);
      for (let moved = true; moved;) {
        moved = false;
        for (const f of fixed) {
          if (m.x < f.box.x + f.box.width + ROW_BETWEEN && f.box.x < m.x + m.size.width + ROW_BETWEEN) { m.x = f.box.x + f.box.width + ROW_BETWEEN; moved = true; }
        }
      }
      after = m.x + m.size.width + ROW_BETWEEN;
      // The lines end side by side on the system, in the order of their callers along the flow.
      const lines = [...m.lines].sort((p, q) => p.way.x - q.way.x || p.e.id.localeCompare(q.e.id));
      const reaches = (l) => l.way.x >= m.x + m.figure.x && l.way.x <= m.x + m.figure.x + m.figure.width;
      const straight = new Set(lines.map((l) => l.from)).size === 1 && lines.every(reaches);
      lines.forEach((l, k) => {
        runs.push({ m, l, x1: straight ? l.way.x : Math.round(m.x + m.figure.x + (m.figure.width * (k + 1)) / (lines.length + 1)) });
      });
    }
    // A line that runs along the row has a track of its own, so it lies on no other line and
    // its label, written on that run, belongs to it alone. The lines of one caller share the
    // stretch out of the frames and part one after the other: the one that runs farthest
    // parts first, nearest the frames, so the next one does not cross it on its way in.
    const turning = runs.filter((r) => Math.abs(r.x1 - r.l.way.x) >= 0.5)
      .sort((p, q) => p.l.way.x - q.l.way.x || p.l.from.localeCompare(q.l.from) || Math.abs(q.x1 - q.l.way.x) - Math.abs(p.x1 - p.l.way.x) || p.l.e.id.localeCompare(q.l.e.id));
    const edge = side > 0 ? bottom : top;
    // The room a label takes across the lines that run to the row: its height where they
    // run sideways, its width where they run up and down the page.
    const thick = (e) => (e.label ? (sideways ? 16 * String(e.label).split(/\r\n?|\n/).length : Math.ceil(widestLine(e.label)) + 8) : 0);
    let at = ROW_GAP;
    for (const r of turning) {
      r.track = edge + side * at;
      at += Math.max(ROW_TRACK, thick(r.l.e) + 12);
    }
    // Past the last run, a line that goes straight on has its label beside that last stretch.
    const lastRun = turning.length > 0 ? at - Math.max(ROW_TRACK, thick(turning.at(-1).l.e) + 12) : 0;
    const edgeOfRow = edge + side * (lastRun + Math.max(ROW_END, ...runs.map((r) => thick(r.l.e) + 28)));
    // Lines share the stretch out of the frames when they take the same way out of one caller.
    const shared = new Map();
    for (const r of runs) shared.set(r.l.way, (shared.get(r.l.way) ?? 0) + 1);
    // The figures of a row stand on one line, whatever the length of their names: each box is
    // placed by its figure, and the line of figures lies where every box clears the lines of
    // the row. A system that already stood beside the frames takes part with its own figure.
    const parts = [...here.map((m) => ({ before: m.figure.y, after: m.size.height - m.figure.y })), ...fixed.map((f) => ({ before: f.figure.y - f.box.y, after: f.box.y + f.box.height - f.figure.y }))];
    const figureLine = side > 0 ? edgeOfRow + Math.max(...parts.map((x) => x.before)) : edgeOfRow - Math.max(...parts.map((x) => x.after));
    for (const m of here) out.push({ id: m.id, box: { x: m.x, y: figureLine - m.figure.y, width: m.size.width, height: m.size.height } });
    // A system that stood beside the frames moves out into the row, its line growing with it.
    for (const f of fixed) {
      const by = figureLine - f.figure.y;
      if (by * side <= 0) continue;
      const e = aside.get(f.id);
      const route = layout.edges.get(e.id);
      const end = turnPoint(route.end);
      out.push({ id: f.id, box: { ...f.box, y: f.box.y + by } });
      out.push({ edge: e, start: turnPoint(route.start), end: { x: end.x, y: end.y + by }, points: [], label: route.label });
    }
    for (const r of runs) {
      const end = { x: r.x1, y: side > 0 ? figureLine - r.m.figure.y : figureLine - r.m.figure.y + r.m.size.height };
      const points = [...r.l.way.via, ...(r.track === undefined ? [] : [{ x: r.l.way.x, y: r.track }, { x: r.x1, y: r.track }])];
      // The stretch that is this line's alone, for its label: the run along the row, or for a
      // line that goes straight on, what is left of it past the last line that parts from it.
      // A line that leaves its caller alone is its own all the way: any stretch of it will do.
      const whole = [r.l.way.start, ...points, end];
      let own = whole.slice(1).map((pt, i) => [whole[i], pt]);
      if (shared.get(r.l.way) > 1) {
        own = undefined;
        if (r.track !== undefined) own = [[points.at(-2), points.at(-1)], [points.at(-1), end]];
        else {
          const last = turning.filter((t) => t.l.way === r.l.way).reduce((far, t) => (side > 0 ? Math.max(far, t.track) : Math.min(far, t.track)), side > 0 ? -Infinity : Infinity);
          if (Number.isFinite(last)) own = [[{ x: r.x1, y: last }, end]];
        }
      }
      out.push({ edge: r.l.e, start: r.l.way.start, end, points, own });
    }
  }
  for (const o of out) {
    if (o.id) layout.nodes.set(o.id, turn(o.box));
    else {
      // The way was worked out from the component in the picture to the system; a connection
      // the system starts runs the same way back.
      const path = [o.start, ...o.points, o.end].map(turnPoint);
      if (row.has(o.edge.from)) path.reverse();
      layout.edges.set(o.edge.id, { start: path[0], end: path.at(-1), points: path.slice(1, -1), label: o.label, ...(o.own ? { own: o.own.map((pair) => pair.map(turnPoint)) } : {}) });
    }
  }
  return undefined;
}

/**
 * Move the whole drawing so that it starts at the usual margin again: a system placed above
 * or to the left of the frames lies before the origin of the layout.
 */
function backToOrigin(layout, { containers, nodes }) {
  const parentOf = new Map([...containers.map((c) => [c.id, c.parent]), ...nodes.map((n) => [n.id, n.parent])]);
  const boxes = [...layout.nodes, ...layout.containers].filter(([id]) => parentOf.get(id) === undefined).map(([, box]) => box);
  const points = [...layout.edges.values()].flatMap((r) => [r.start, r.end, r.label, ...(r.points ?? []), ...(r.own ?? []).flat()]).filter(Boolean);
  const dx = Math.max(0, ASIDE_ORIGIN - Math.min(ASIDE_ORIGIN, ...boxes.map((b) => b.x), ...points.map((pt) => pt.x)));
  const dy = Math.max(0, ASIDE_ORIGIN - Math.min(ASIDE_ORIGIN, ...boxes.map((b) => b.y), ...points.map((pt) => pt.y)));
  if (!dx && !dy) return;
  // Children are positioned relative to their frame, so only what lies on the page itself moves.
  for (const b of [...boxes, ...points]) { b.x += dx; b.y += dy; }
}

/** Room between the outermost frame and a system placed beside it, when its connection has no label. */
const ASIDE_GAP = 64;
/** Where a layout starts on both axes (ELK's default padding). */
const ASIDE_ORIGIN = 12;

/**
 * Place each system of `aside` beside the frames, level with the component that calls it,
 * and join the two with one straight line across the flow: to the left or right of the
 * frames in a top-down diagram, below or above them in a left-to-right one. The layout
 * engine can only put such a system at an end of the flow, before or after all the frames,
 * and its connection then runs along the flow past everything in between.
 *
 * A side is usable when the line runs through nothing but the frames around the caller: no
 * other component or its name, no frame the caller is not in, no label, no stretch of
 * another connection running the same way, and the system and its label have free room.
 * Of the usable sides the one with the fewest crossed connections wins, then the shorter.
 * The placement is written into `layout`.
 * @returns {string|undefined} the id of the first system with no usable side, or undefined
 */
function placeBeside(layout, aside, { containers, nodes, edges, direction }) {
  const parentOf = new Map([...containers.map((c) => [c.id, c.parent]), ...nodes.map((n) => [n.id, n.parent])]);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  // Whether the flow runs down or up the page; the systems then stand to the left or right.
  const vertical = !acrossIsVertical(direction);
  const hit = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  const grow = (box, d) => ({ x: box.x - d, y: box.y - d, width: box.width + 2 * d, height: box.height + 2 * d });
  // What is drawn so far: the laid-out components, the routed connections and their labels.
  const placedNodes = nodes.filter((n) => layout.nodes.has(n.id) && !aside.has(n.id)).map((n) => ({ id: n.id, box: absoluteBox(n.id, layout, parentOf) }));
  const frames = containers.map((c) => ({ id: c.id, box: absoluteBox(c.id, layout, parentOf) }));
  const segments = [];
  const labels = [];
  for (const e of edges) {
    if (aside.has(e.to)) continue;
    const r = layout.edges.get(e.id);
    if (!r?.start || !r?.end) continue;
    const path = [r.start, ...(r.points ?? []), r.end];
    for (let i = 1; i < path.length; i++) segments.push({ a: path[i - 1], b: path[i] });
    if (e.label && r.label) labels.push(r.label);
  }
  const taken = [];
  for (const [id, e] of aside) {
    const node = byId.get(id);
    const caller = byId.get(e.from);
    const whole = absoluteBox(e.from, layout, parentOf);
    const figure = drawBox(caller, whole);
    const around = new Set();
    for (let p = caller.parent; p; p = parentOf.get(p)) around.add(p);
    const outer = frames.find((f) => around.has(f.id) && parentOf.get(f.id) === undefined).box;
    const text = e.label ? { width: Math.ceil(widestLine(e.label)) + 8, height: 16 * String(e.label).split(/\r\n?|\n/).length } : { width: 0, height: 0 };
    const gap = Math.max(ASIDE_GAP, (vertical ? text.width : text.height) + 24);
    const options = [];
    for (const side of vertical ? ['right', 'left'] : ['bottom', 'top']) {
      // A store stands under its user in a left-to-right diagram: no line leaves that way.
      if (side === 'bottom' && caller.store) continue;
      let start; let end; let box; let label;
      if (vertical) {
        const y = Math.round(figure.y + figure.height / 2);
        const x = side === 'right' ? outer.x + outer.width + gap : outer.x - gap - node.width;
        // A system with a figure is level with its caller figure to figure, and the line ends at its figure.
        const own = drawBox(node, { x, y: 0, width: node.width, height: node.height });
        box = { x, y: y - own.height / 2, width: node.width, height: node.height };
        start = { x: side === 'right' ? figure.x + figure.width : figure.x, y };
        end = { x: side === 'right' ? own.x : own.x + own.width, y };
        const mid = side === 'right' ? outer.x + outer.width + gap / 2 : outer.x - gap / 2;
        label = { x: mid - text.width / 2, y: y - text.height - 4, width: text.width, height: text.height };
      } else {
        const x = Math.round(figure.x + figure.width / 2);
        const y = side === 'bottom' ? outer.y + outer.height + gap : outer.y - gap - node.height;
        box = { x: x - node.width / 2, y, width: node.width, height: node.height };
        // Downwards the line starts under the caller's name, as every line leaving a figure that way does.
        start = { x, y: side === 'bottom' ? whole.y + whole.height : figure.y };
        end = { x, y: side === 'bottom' ? y : y + node.height };
        const mid = side === 'bottom' ? outer.y + outer.height + gap / 2 : outer.y - gap / 2;
        label = { x: x + 6, y: mid - text.height / 2, width: text.width, height: text.height };
      }
      const line = { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) };
      const lane = grow(line, 10);
      const things = [box, ...(e.label ? [label] : [])];
      if (placedNodes.some((n) => n.id !== e.from && (hit(lane, n.box) || things.some((b) => hit(grow(b, 10), n.box))))) continue;
      if (frames.some((f) => (!around.has(f.id) && hit(lane, f.box)) || things.some((b) => hit(grow(b, 10), f.box)))) continue;
      if (labels.some((l) => hit(lane, l) || things.some((b) => hit(b, l)))) continue;
      if (taken.some((b) => hit(lane, b) || things.some((x) => hit(grow(x, 10), b)))) continue;
      // Another connection may cross the line, not run along it.
      const along = (s) => (vertical ? Math.abs(s.a.y - s.b.y) < 0.5 : Math.abs(s.a.x - s.b.x) < 0.5);
      const boxOf = (s) => ({ x: Math.min(s.a.x, s.b.x), y: Math.min(s.a.y, s.b.y), width: Math.abs(s.a.x - s.b.x), height: Math.abs(s.a.y - s.b.y) });
      const touching = segments.filter((s) => hit(lane, grow(boxOf(s), 0.5)));
      if (touching.some(along)) continue;
      if (segments.some((s) => things.some((b) => hit(b, grow(boxOf(s), 0.5))))) continue;
      options.push({ start, end, box, label, crossed: touching.length, length: line.width + line.height });
    }
    if (options.length === 0) return id;
    options.sort((p, q) => p.crossed - q.crossed || p.length - q.length);
    const best = options[0];
    layout.nodes.set(id, best.box);
    layout.edges.set(e.id, { start: best.start, end: best.end, points: [], label: e.label ? best.label : undefined });
    taken.push(best.box, ...(e.label ? [best.label] : []), { x: Math.min(best.start.x, best.end.x) - 10, y: Math.min(best.start.y, best.end.y) - 10, width: Math.abs(best.end.x - best.start.x) + 20, height: Math.abs(best.end.y - best.start.y) + 20 });
  }
  return undefined;
}

/** A component that connects to at least this many others on one side is the hub of a fan. */
const FAN_MIN = 3;
/** How far off the middle of its fan a hub may stand before another arrangement is tried. */
const FAN_OFF_CENTRE = 0.5;
/** How far off the middle of the picture the hubs may stand before another arrangement is tried. */
const PAGE_OFF_CENTRE = 0.25;
/** The arrangements tried for a diagram whose main flow is off the middle, the usual one first. */
const ARRANGEMENTS = [
  { balanceContainers: false, options: {} },
  { balanceContainers: true, options: {} },
  // Without the order of the IR the layout engine orders each column to cross the fewest
  // lines, which can bring a hub between the things around it.
  { balanceContainers: false, options: { 'elk.layered.considerModelOrder.strategy': 'NONE' } },
  { balanceContainers: true, options: { 'elk.layered.considerModelOrder.strategy': 'NONE' } },
];

/**
 * How far the hubs of a diagram stand off the middle of their fans: 0 when every hub is level
 * with the middle of the components it connects to, 1 when each is level with the first or
 * the last of them, more when it stands beyond them. A fan is a component with `FAN_MIN` or
 * more connections to different components on one side of the flow (the ones it calls, or
 * the ones that call it). The positions are measured across the flow, at the centre of each
 * figure, and a fan counts by its size, so the hub most of the diagram hangs on decides.
 * `page` is the same for the picture as a whole: how far the hubs stand off the middle of
 * everything that is drawn, 0 in the middle and 1 at an edge.
 *
 * The main flow of a diagram runs through its hubs, so a diagram whose hub stands at the end
 * of its fan has its main flow along one edge of the page and everything else on one side.
 */
function fanOffCentre(layout, { containers, nodes, edges, direction }) {
  const parentOf = new Map([...containers.map((c) => [c.id, c.parent]), ...nodes.map((n) => [n.id, n.parent])]);
  const sideways = acrossIsVertical(direction);
  const centre = new Map();
  for (const n of nodes) {
    if (!layout.nodes.has(n.id)) continue;
    const b = drawBox(n, absoluteBox(n.id, layout, parentOf));
    centre.set(n.id, sideways ? b.y + b.height / 2 : b.x + b.width / 2);
  }
  const fans = new Map();
  const note = (hub, side, other) => {
    if (hub === other || !centre.has(hub) || !centre.has(other)) return;
    const key = `${hub}|${side}`;
    if (!fans.has(key)) fans.set(key, new Set());
    fans.get(key).add(other);
  };
  for (const e of edges) {
    const [from, to] = e.layoutReversed ? [e.to, e.from] : [e.from, e.to];
    note(from, 'out', to);
    note(to, 'in', from);
  }
  // The extent of the picture across the flow: every component and every frame.
  const extents = [...nodes.map((n) => n.id), ...containers.map((c) => c.id)].filter((id) => layout.nodes.has(id) || layout.containers.has(id)).map((id) => {
    const b = absoluteBox(id, layout, parentOf);
    return sideways ? [b.y, b.y + b.height] : [b.x, b.x + b.width];
  });
  const top = Math.min(...extents.map((x) => x[0]));
  const height = Math.max(...extents.map((x) => x[1])) - top;
  let off = 0;
  let page = 0;
  let size = 0;
  for (const [key, members] of fans) {
    if (members.size < FAN_MIN) continue;
    const at = [...members].map((id) => centre.get(id));
    const lo = Math.min(...at);
    const span = Math.max(...at) - lo;
    if (span < 1) continue;
    const hub = centre.get(key.split('|')[0]);
    off += members.size * Math.abs((hub - lo) / span - 0.5) * 2;
    page += members.size * (height < 1 ? 0 : Math.abs((hub - top) / height - 0.5) * 2);
    size += members.size;
  }
  return size === 0 ? { fan: 0, page: 0 } : { fan: off / size, page: page / size };
}

/**
 * An architecture diagram, laid out. The main flow belongs in the middle of the picture, with
 * what it uses on both sides of it. Inside a frame the layout engine keeps the members close
 * together, which lines a hub up with one end of its fan when the fan leaves the frame, and
 * the order of the IR can put everything else on one side of the flow: the hubs and the flow
 * through them then run along one edge. When that happens the other arrangements are laid
 * out as well, each to the end (the systems beside the frames and in a row along them are
 * part of the picture and move its middle), and the one whose hubs stand nearest the middle
 * of their fans and of the picture is kept, if it is clearly better. A diagram whose hubs
 * already stand near the middle keeps the usual, compact form.
 */
async function emitArchitecture(ir, cid, refs, warnings) {
  const usual = await arrangeArchitecture(ir, refs, ARRANGEMENTS[0]);
  let best = usual;
  if (usual.containers.length > 0 && (usual.off.fan > FAN_OFF_CENTRE || usual.off.page > PAGE_OFF_CENTRE)) {
    for (const how of ARRANGEMENTS.slice(1)) {
      const tried = await arrangeArchitecture(ir, refs, how);
      if (tried.off.sum < best.off.sum - 0.05) best = tried;
    }
    if (best.off.sum >= usual.off.sum - 0.2) best = usual;
  }
  warnings.push(...best.warnings);
  return graphCells(cid, best.layout, { containers: best.containers, nodes: best.nodes, edges: best.edges, direction: ir.direction });
}

/** One arrangement of an architecture diagram (see `ARRANGEMENTS`), with how far its hubs stand off the middle. */
async function arrangeArchitecture(ir, refs, how) {
  const warnings = [];
  const parent = parentMap(ir.boundaries ?? []);
  const containers = (ir.boundaries ?? []).map((b) => {
    const group = awsGroup(b.group);
    return { id: b.id, label: b.label, parent: parent.get(b.id), style: STYLE.container, ...(group ? awsGroupContainer(group, b.label) : { title: plainTitle(b.label) }) };
  });
  const usesAws = (ir.boundaries ?? []).some((b) => awsGroup(b.group)) || ir.components.some((c) => awsIcon(c.icon));
  const kindOf = (c) => c.kind ?? 'service';
  // A figure with its label below it: the screen of a client, or an AWS service icon.
  const figureOf = (c) => {
    const icon = awsIcon(c.icon);
    if (icon?.stencil) return { ...AWS_ICON, width: icon.width, height: icon.height, style: stencilStyle(icon) };
    if (icon) return { ...AWS_ICON, style: awsIconStyle(icon) };
    return kindOf(c) === 'client' ? { ...CLIENT_FIGURE, style: STYLE.client } : undefined;
  };
  // The layout box of such a component holds the figure and the label under it, so a boundary
  // frame, the next figure and the edges all keep clear of the text; the figure is drawn at
  // its top centre. Figures that share a parent get one width, so they line up, and both
  // sides are even, so the centre the edges leave from is a whole pixel.
  const even = (v) => 2 * Math.ceil(v / 2);
  const shown = new Map(ir.components.map((c, i) => [c.id, refLabel(c.label, c.ref, refs, `/components/${i}/ref`, warnings)]));
  const figures = new Map(ir.components.map((c) => [c.id, figureOf(c)]).filter(([, f]) => f));
  const below = new Map([...figures.keys()].map((id) => [id, measureLabelBelow(shown.get(id).label)]));
  const figureWidth = new Map();
  for (const [id, b] of below) figureWidth.set(parent.get(id), Math.max(figureWidth.get(parent.get(id)) ?? 0, figures.get(id).width, even(b.width)));
  const nodes = ir.components.map((c) => {
    const kind = kindOf(c);
    const { label, link } = shown.get(c.id);
    const node = { id: c.id, label, link, parent: parent.get(c.id), style: STYLE[kind], kind };
    const figure = figures.get(c.id);
    if (figure) {
      const b = below.get(c.id);
      return { ...node, style: `${figure.style}labelWidth=${b.wrap};`, width: figureWidth.get(node.parent), height: even(figure.height + b.height + (figure.below ?? 0)), drawWidth: figure.width, drawHeight: figure.height };
    }
    return { ...node, ...measureNode(label, { pad: padOf(kind), baseHeight: kind === 'database' || kind === 'cache' ? 70 : 40 }) };
  });
  const edges = ir.connections.map((c) => ({ id: c.id, from: c.from, to: c.to, label: c.label, style: `${STYLE.flowEdge}${c.bidirectional ? 'startArrow=classic;startFill=1;' : ''}` }));
  const spacing = { nodeNode: 50, layer: 80, ...loopSpacing(ir.direction) };
  // The ports of a figure depend on the sides its connections use, so they are worked out
  // afresh for every arrangement that is tried.
  // In an AWS diagram each label is placed beside its own line after the layout (placeLineLabels).
  if (usesAws) for (const e of edges) if (e.label && e.from !== e.to) { e.labelPlacedByCaller = true; e.labelOnDrawnLine = true; }
  const aside = usesAws ? asideCandidates(nodes, edges) : new Map();
  const row = usesAws ? rowCandidates(nodes, edges, aside) : new Map();
  // A system of a row is placed with the row, also when one component alone uses it.
  const stores = usesAws ? attachStores(nodes, edges, ir.direction, row) : new Map();
  const apart = (id) => aside.has(id) || row.has(id) || stores.has(id);
  const laidOut = () => ({ nodes: nodes.filter((n) => !apart(n.id)), edges: edges.filter((e) => !apart(e.to) && !row.has(e.from)) });
  const arrange = async () => {
    const g = laidOut();
    for (const n of g.nodes) delete n.ports;
    for (const e of g.edges) { delete e.fromPort; delete e.toPort; }
    const first = await layoutGraph({ ...g, containers, direction: ir.direction, spacing, ...how });
    return below.size > 0 && clientPorts(first, { containers, ...g }) ? layoutGraph({ ...g, containers, direction: ir.direction, spacing, ...how }) : first;
  };
  // A system beside the frames is placed after the layout of everything else. One that has no
  // free place there goes back into the layout, which then runs again without it set aside.
  const placeAside = async (base) => {
    for (;;) {
      placeStores(base, stores, { containers, nodes, direction: ir.direction });
      const failed = placeBeside(base, aside, { containers, nodes, edges, direction: ir.direction });
      if (failed !== undefined) { aside.delete(failed); base = await arrange(); continue; }
      const unplaced = placeRow(base, row, { containers, nodes, edges, direction: ir.direction, aside });
      if (unplaced !== undefined) { row.delete(unplaced); base = await arrange(); continue; }
      backToOrigin(base, { containers, nodes });
      // A label with no free place beside its line goes back to the layout engine.
      const own = new Set(edges.filter((e) => e.labelPlacedByCaller && !aside.has(e.to) && !stores.has(e.to)).map((e) => e.id));
      const crowded = placeLineLabels(base, own, { containers, nodes, edges });
      if (crowded === undefined) return base;
      // The line to a system in a row is not the layout engine's: the system goes back into the flow.
      const line = edges.find((e) => e.id === crowded);
      const system = [line.to, line.from].find((id) => row.has(id));
      if (system !== undefined) row.delete(system);
      else delete line.labelPlacedByCaller;
      base = await arrange();
    }
  };
  let layout = await placeAside(await arrange());
  if (usesAws) {
    const g = laidOut();
    layout = await placeAside(await nearSide(layout, g, arrange));
  }
  // A wider frame moves the lines, so the titles are placed again after each new layout.
  let unplaced = placeGroupTitles(layout, { containers, nodes, edges });
  for (let round = 0; unplaced && round < 6; round++) {
    layout = await placeAside(await layoutGraph({ ...laidOut(), containers, direction: ir.direction, spacing, ...how }));
    unplaced = placeGroupTitles(layout, { containers, nodes, edges });
  }
  if (unplaced) warnings.push({ path: '/boundaries', message: 'layout: a connection crosses the title of a group frame; no free place was found for it along the top of the frame', hint: 'set "direction" to "LR" or shorten the boundary label' });
  for (const c of containers) if (c.titleOffset !== undefined) c.style = titleAt(c.style, c.titleOffset);
  // draw.io writes an edge label on a white patch. Inside a tinted frame (a subnet) the patch
  // takes the colour of the frame, so the label hides its line without showing as a box.
  if (usesAws) {
    const parentOf = new Map(containers.map((c) => [c.id, c.parent]));
    const depth = (id) => { let d = 0; for (let p = parentOf.get(id); p; p = parentOf.get(p)) d++; return d; };
    const framed = containers.map((c) => ({ c, box: absoluteBox(c.id, layout, parentOf), depth: depth(c.id) })).sort((a, b) => b.depth - a.depth);
    const byId = new Map(containers.map((c) => [c.id, c]));
    for (const e of edges) {
      const label = e.label ? layout.edges.get(e.id)?.label : undefined;
      if (!label) continue;
      const x = label.x + label.width / 2;
      const y = label.y + label.height / 2;
      const inner = framed.find((f) => x >= f.box.x && x <= f.box.x + f.box.width && y >= f.box.y && y <= f.box.y + f.box.height);
      // The innermost frame around the label that has a fill is what shows behind it.
      for (let c = inner?.c; c; c = byId.get(c.parent)) {
        const fill = /(?:^|;)fillColor=(#[0-9A-Fa-f]{6});/.exec(c.style)?.[1];
        if (fill) { e.labelBackground = fill; break; }
      }
    }
  }
  // The hubs among their fans, in what the layout engine placed; the hubs in the picture as a
  // whole, with the systems placed beside the frames and in a row along them.
  const fan = fanOffCentre(layout, { containers, ...laidOut(), direction: ir.direction }).fan;
  const page = fanOffCentre(layout, { containers, nodes, edges, direction: ir.direction }).page;
  return { layout, containers, nodes, edges, warnings, off: { fan, page, sum: fan + page } };
}

/**
 * A client's layout box is wider and taller than its figure, and ELK spreads the edges of a
 * side over the whole box: some would end beside the name, or past the figure's shoulders.
 * After a first layout has shown which side each connection uses and in what order, every
 * end at a client gets a fixed port on that side of the box, within the figure's extent:
 * across its height on the left and right, across its width on the top and bottom, evenly
 * spaced in the order of the first pass. The second layout routes to those points, so a
 * connection from the side meets the figure and one from below stops under the name on the
 * figure's own column. Returns whether any port was set.
 */
function clientPorts(layout, { containers, nodes, edges }) {
  const parentOf = new Map([...containers.map((c) => [c.id, c.parent]), ...nodes.map((n) => [n.id, n.parent])]);
  const clients = new Map(nodes.filter((n) => n.drawHeight !== undefined).map((n) => [n.id, n]));
  const sides = new Map();
  for (const e of edges) {
    if (e.from === e.to) continue;
    const route = layout.edges.get(e.id);
    for (const [end, id, pt] of [['from', e.from, route?.start], ['to', e.to, route?.end]]) {
      if (!clients.has(id) || !pt) continue;
      const b = absoluteBox(id, layout, parentOf);
      const side = Math.abs(pt.x - b.x) < 0.5 ? 'left' : Math.abs(pt.x - b.x - b.width) < 0.5 ? 'right' : Math.abs(pt.y - b.y) < 0.5 ? 'top' : 'bottom';
      const key = `${id}|${side}`;
      if (!sides.has(key)) sides.set(key, []);
      sides.get(key).push({ e, end, at: side === 'left' || side === 'right' ? pt.y : pt.x });
    }
  }
  for (const [key, ends] of sides) {
    const [id, side] = key.split('|');
    const n = clients.get(id);
    ends.sort((a, b) => a.at - b.at || a.e.id.localeCompare(b.e.id));
    ends.forEach(({ e, end }, k) => {
      // A port is a 1 px box whose centre the edge ends at, on the border it lies against.
      const share = (k + 1) / (ends.length + 1);
      const port = {
        id: `${id}:port:${e.id}:${end}`,
        x: side === 'left' ? 0 : side === 'right' ? n.width - 1 : Math.round((n.drawX ?? (n.width - n.drawWidth) / 2) + n.drawWidth * share) - 0.5,
        y: side === 'top' ? 0 : side === 'bottom' ? n.height - 1 : Math.round(n.drawHeight * share) - 0.5,
      };
      n.ports = [...(n.ports ?? []), port];
      e[end === 'from' ? 'fromPort' : 'toPort'] = port.id;
    });
  }
  return sides.size > 0;
}

function emitSequence(ir, cid, warnings, refs) {
  // A message that a sub-diagram details shows that diagram on a second label line and links
  // to its page; the layout sees the label as drawn, so the row makes room for the line.
  const shown = new Map(ir.messages.map((msg, i) => [msg.id, refLabel(msg.label, msg.ref, refs, `/messages/${i}/ref`, warnings)]));
  const L = layoutSequence({ ...ir, messages: ir.messages.map((msg) => ({ ...msg, label: shown.get(msg.id).label })) });
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
    const { label, link } = shown.get(msg.id);
    const y = L.messageY(msg.id);
    const from = L.participants.get(msg.from);
    const to = L.participants.get(msg.to);
    const kind = msg.kind ?? 'sync';
    if (msg.from === msg.to) {
      // Anchor both ends on the lifeline's centre line explicitly; the lifeline perimeter
      // would otherwise attach the arrow head on the far side and draw it across the line.
      const x = from.centerX + 50;
      const anchors = `exitX=0.5;exitY=0;exitDx=0;exitDy=${y - 10 - from.y};exitPerimeter=0;entryX=0.5;entryY=0;entryDx=0;entryDy=${y + 10 - from.y};entryPerimeter=0;`;
      cells.push(edge({ id: cid(msg.id), value: htmlLabel(label), style: `${STYLE.selfMessage}${anchors}`, source: cid(msg.from), target: cid(msg.to), points: [{ x, y: y - 10 }, { x, y: y + 10 }], link }));
      continue;
    }
    const style = kind === 'return' ? STYLE.returnMessage : kind === 'async' ? STYLE.asyncMessage : STYLE.syncMessage;
    cells.push(edge({ id: cid(msg.id), value: htmlLabel(label), style, source: cid(msg.from), target: cid(msg.to), points: [{ x: (from.centerX + to.centerX) / 2, y }], link }));
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
      return { id: a.id, lane: a.lane, ...measureNode(label, textArea(a.ref ? 'subroutine' : 'terminal')), style: a.ref ? STYLE.subroutine : STYLE.terminal, label, link };
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
