import { vertex, edge, edgeLabel, envelope, envelopePages, htmlLabel, pageLink, cellsBounds, shiftCells } from './drawio-xml.mjs';
import { cloudIcon, cloudGroup } from './aws-icons.mjs';
import { layoutGraph, backEdges, closingEdges, cycleOf, measureNode, measureDecision, measureLabelBelow, wrapText, widestWord, LABEL_PAD } from './layout-graph.mjs';
import { measureEllipse } from './layout-graph.mjs';
import { layoutSequence, NOTE_FOLD, NOTE_PAD, SELF_LOOP, selfLabelBox } from './layout-sequence.mjs';
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
    // Two diagrams of one title would be two pages of one name: the caller hands the later one a name of its own.
    if (options.pageNames?.has(ids[i])) page.name = options.pageNames.get(ids[i]);
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
    case 'usecase': cells = await emitUsecase(ir, cid, refs, warnings); break;
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
  // The dot where lines that merge into one join it; the tag tells `extract` and the FigJam emitter that it is no element.
  junction: 'ellipse;html=1;aspect=fixed;fillColor=#000000;strokeColor=#000000;resizable=0;rotatable=0;zukaiJunction=1;',
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
  // Opaque, so the dashed line does not run through the text; it starts inside the frame's
  // border and ends close behind the text, so it covers neither the border nor more of a
  // lifeline than the words do.
  frameSeparatorLabel: 'text;html=1;align=left;verticalAlign=middle;spacingLeft=4;resizable=0;fillColor=#ffffff;strokeColor=none;',
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
 * The side of a box that a point on its border lies on. The port ELK makes for a line that
 * leads back to a loop head lies against the box from outside, so that line ends a pixel
 * off the border: a point on no border belongs to the side it is nearest to.
 */
function sideOf(pt, b) {
  const off = { left: Math.abs(pt.x - b.x), right: Math.abs(pt.x - b.x - b.width), top: Math.abs(pt.y - b.y), bottom: Math.abs(pt.y - b.y - b.height) };
  return ['left', 'right', 'top', 'bottom'].find((side) => off[side] < 0.5) ?? Object.keys(off).sort((a, c) => off[a] - off[c])[0];
}

/** The shape of a style whose outline is narrower than its box: a parallelogram (`io`) or a hexagon (`queue`). */
const slantedShape = (style = '') => (/(?:^|;)shape=parallelogram;/.test(style) ? 'io' : /(?:^|;)shape=hexagon;/.test(style) ? 'queue' : undefined);

/**
 * Where a line that reaches the box of a slanted shape at `pt`, on `side`, meets the outline
 * that is drawn: the point moved along the line's own direction onto the slanted edge, so
 * the line keeps the height (or the column) the layout routed it at. A parallelogram's left
 * edge runs from the box's bottom-left corner to SLANT in from its top-left, and its right
 * edge is parallel to that; a hexagon's two edges on each side meet at mid-height, on the
 * box. Along the top and bottom the outline is the box itself, except in the strip beside a
 * slanted edge, where the line runs on to that edge.
 * @param {'io'|'queue'} shape
 * @param {{x:number,y:number,width:number,height:number}} b the box the shape is drawn in
 */
function outlinePoint(shape, b, pt, side) {
  const hexagon = shape === 'queue';
  // draw.io draws the slant no wider than the shape allows.
  const s = Math.min(SLANT, hexagon ? b.width / 2 : b.width);
  const t = Math.max(0, Math.min(1, (pt.y - b.y) / b.height));
  // How far the left edge is from the box's left side at height t; the right edge mirrors it
  // through the centre of the box.
  const inset = (at) => (hexagon ? s * Math.abs(1 - 2 * at) : s * (1 - at));
  if (side === 'left') return { x: b.x + inset(t), y: pt.y };
  if (side === 'right') return { x: b.x + b.width - inset(1 - t), y: pt.y };
  // The height at which the left edge is `u` px from the left side, between the top (0) and
  // where the edge reaches the box (the bottom of a parallelogram, mid-height of a hexagon).
  const down = (u) => (hexagon ? b.height / 2 : b.height) * (1 - u / s);
  const fromLeft = pt.x - b.x;
  const fromRight = b.x + b.width - pt.x;
  if (side === 'top') {
    if (fromLeft < s) return { x: pt.x, y: b.y + down(fromLeft) };
    if (hexagon && fromRight < s) return { x: pt.x, y: b.y + down(fromRight) };
    return pt;
  }
  if (fromRight < s) return { x: pt.x, y: b.y + b.height - down(fromRight) };
  if (hexagon && fromLeft < s) return { x: pt.x, y: b.y + b.height - down(fromLeft) };
  return pt;
}

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

/** One stretch of a routed line: its length and the sense it runs in on each axis. */
const stretchOf = (a, b) => ({ length: Math.hypot(b.x - a.x, b.y - a.y), x: Math.sign(Math.round(b.x - a.x)), y: Math.sign(Math.round(b.y - a.y)) });

/** Length of the line two paths from one point have in common before they part. */
function sharedLength(p, q) {
  let common = 0;
  for (let i = 1; i < Math.min(p.length, q.length); i++) {
    const a = stretchOf(p[i - 1], p[i]);
    const b = stretchOf(q[i - 1], q[i]);
    if (a.x !== b.x || a.y !== b.y) break;
    common += Math.min(a.length, b.length);
    if (Math.abs(a.length - b.length) > 0.5) break;
  }
  return common;
}

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
 * sides are candidates, the right of a vertical segment and above a horizontal one first, and
 * past a bend the side that lies beyond the marker first. The
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
  const leaves = pointAlong(fromEnd, 1);
  for (let along = clear + gap; along <= clear + gap + reach; along += step) {
    const { point, vertical, dir } = pointAlong(fromEnd, along);
    // Round a bend, one side of the line lies back beside the marker and the other beyond it,
    // further along the way the line left its end: that side comes first, so the text stays
    // past the marker as it does on a straight line.
    const sides = vertical !== leaves.vertical ? [leaves.dir, -leaves.dir] : vertical ? [1, -1] : [-1, 1];
    for (const s of sides) {
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
function graphCells(cid, layout, { containers, nodes, edges, direction, junctions = [] }, warnings = []) {
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
    // The mark of a frame (the Google Cloud mark) is a cell of its own in the frame's corner: part of the frame, never an end of a connection.
    if (c.mark) cells.push(vertex({ id: `${cid(c.id)}:mark`, value: '', style: `${c.mark.style}part=1;pointerEvents=0;`, x: c.mark.x, y: c.mark.y, width: c.mark.width, height: c.mark.height, parent: cid(c.id), connectable: false }));
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
  //
  // A parallelogram or a hexagon is narrower than its box, and ELK ends every line on the box.
  // Left to draw.io, such an end is moved onto the outline along the ray to the shape's
  // centre, which takes it off the height the line was routed at: the line gets a jog just
  // before its end and the arrowhead points along the jog. So the end is moved onto the
  // slanted edge here, along the line's own direction, as a pixel offset from the point on
  // the box (the slant is a fixed number of pixels, so the offset holds when the shape is
  // resized), and `perimeter=0` makes draw.io keep it. An end at a port that sidePorts set
  // (`exactEnds`) is kept to the pixel in the same way.
  const anchor = (id, pt) => {
    const n = nodeOf(id) ?? {};
    const b = drawBox(n, absoluteBox(id, layout, parentOf));
    const clamp = (v) => Math.max(0, Math.min(1, v));
    const a = { x: clamp((pt.x - b.x) / b.width), y: clamp((pt.y - b.y) / b.height), dx: 0, dy: 0 };
    if (n.drawHeight !== undefined && pt.y > b.y + b.height + 0.5) {
      a.dx = pt.x - (b.x + a.x * b.width);
      a.dy = pt.y - (b.y + b.height);
    }
    const shape = slantedShape(n.style);
    if (shape || n.exactEnds) {
      if (shape) a.side = sideOf(pt, b);
      const on = shape ? outlinePoint(shape, b, pt, a.side) : pt;
      // The share is written to three decimals, which can be a tenth of a pixel off; the
      // offset takes up the rest, so lines that share an end are drawn on one another.
      a.x = round(a.x);
      a.y = round(a.y);
      a.dx = on.x - (b.x + a.x * b.width);
      a.dy = on.y - (b.y + a.y * b.height);
      a.fixed = true;
    }
    return a;
  };
  const anchorStyle = (prefix, a) => `${prefix}X=${round(a.x)};${prefix}Y=${round(a.y)};${prefix}Dx=${round(a.dx)};${prefix}Dy=${round(a.dy)};${a.dx || a.dy || a.fixed ? `${prefix}Perimeter=0;` : ''}`;
  // Sides of a node that other edges touch, so a self-loop can take a free one.
  const sideUse = new Map();
  const noteSide = (id, a) => {
    const side = a.side ?? (a.x >= 0.99 ? 'right' : a.x <= 0.01 ? 'left' : a.y <= 0.01 ? 'top' : 'bottom');
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
      // A plain edge (no orthogonal router) follows exactly these waypoints, so the label's
      // midpoint anchor is on the loop's outer vertical.
      // The loop's two ends lie on the side of the box, or on the slanted edge of a shape that has one there.
      const style = `${waypointStyle(e.style)}${anchorStyle('exit', anchor(e.from, { x: edgeX, y: points[0].y }))}${anchorStyle('entry', anchor(e.to, { x: edgeX, y: points[1].y }))}`;
      cells.push(edge({ id: cid(e.id), value: '', style, source: cid(e.from), target: cid(e.to), points }));
      // Text anchored at the loop's outer side, aligned away from it: a fixed 4 px gap, whatever the text width.
      if (e.label) {
        cells.push(edgeLabel({ id: `${cid(e.id)}:label`, background: e.labelBackground, value: htmlLabel(e.label), parent: cid(e.id), position: 0, offset: { x: dir * LABEL_GAP, y: 0 }, align: dir > 0 ? 'left' : 'right' }));
        // The loop's own label is in the way of its end labels like any other: a cardinality
        // placed on the loop's corner would run into its first letter.
        const w = selfLoopLabelWidth(e.label);
        const lines = String(e.label).split(/\r\n?|\n/).length;
        const midY = (points[0].y + points[1].y) / 2;
        taken.push({ x: dir > 0 ? outX + LABEL_GAP - 2 : outX - LABEL_GAP - w - 2, y: midY - 8 * lines - 2, width: w + 4, height: 16 * lines + 4 });
      }
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
  // The dots where merged lines join, over the lines: marks on the drawing, not elements of
  // the diagram, so they take no connection and `extract` leaves them out.
  for (const j of junctions) cells.push(vertex({ id: cid(j.id), value: '', style: STYLE.junction, x: j.x - JUNCTION / 2, y: j.y - JUNCTION / 2, width: JUNCTION, height: JUNCTION, connectable: false }));
  return cells;
}

function parentMap(containers) {
  const parent = new Map();
  for (const c of containers) for (const child of c.children ?? []) parent.set(child, c.id);
  return parent;
}

/** The least distance between two line ends on one side of a node, in px: an arrowhead is 7 px across. */
const MIN_END_GAP = 10;
/** How many lines into one side of a node are drawn as one line, per `fanIn` of the diagram. */
const MERGE_FROM = { auto: 5, merge: 2, separate: Infinity };
/** Diameter of the dot where merged lines join, in px. */
const JUNCTION = 6;

/**
 * Room for the line ends on each side of a node, and one line for many. ELK spreads the ends
 * of a side over its length whatever that is, so four ends on a 40 px side lie 8 px apart
 * under arrowheads 7 px across, and on a parallelogram's top or bottom some end beside the
 * outline, in the strip the slant leaves. After a first layout has shown which side each end
 * uses and in what order, a node with such a side gets fixed ports for the next layout:
 *
 *   - the lines into one side that can share a line (no label, not leading back, the same
 *     style) merge when there are enough of them (`fanIn`: five by default): they get one
 *     port, which the layout routes as one line that the others join;
 *   - a side whose ends are closer than MIN_END_GAP, or lie off the outline, or hold a merged
 *     line, has its ends spaced evenly over the part of the side the outline covers, in the
 *     order of the first pass, a merged line counting as one end; the node grows along that
 *     side when it is shorter than (ends + 1) x MIN_END_GAP;
 *   - every other end of the node gets a port where the first pass had it, as its share of
 *     the side: a node with fixed ports must have one for each of its ends, the line that
 *     leads back to a loop head included, which so stays on the side across the flow.
 *
 * A node that already has ports (a decision, whose lines meet at its tips) is left alone, and
 * so is one with `fixedOutline` (the circle of an initial or final state, which cannot grow
 * and whose outline is no side of a box).
 * Each merged group is added to `merges`. Returns whether any port was set.
 * @param {{fanIn?: 'auto'|'merge'|'separate', merges?: Array<{node:string, edges:string[]}>}} [how]
 */
function sidePorts(layout, { containers, nodes, edges }, { fanIn = 'auto', merges = [] } = {}) {
  const parentOf = new Map([...containers.map((c) => [c.id, c.parent]), ...nodes.map((n) => [n.id, n.parent])]);
  const open = new Map(nodes.filter((n) => !n.ports?.length && !n.fixedOutline).map((n) => [n.id, n]));
  const upright = (side) => side === 'left' || side === 'right';
  // The part of a side that the outline covers, measured from the start of the layout box: a
  // shape with a loop beside it is drawn centred in a wider box, and a parallelogram's top
  // and bottom are shorter than its box.
  const extent = (n, side) => {
    if (upright(side)) return [0, n.height];
    const width = n.drawWidth ?? n.width;
    const start = (n.width - width) / 2;
    // A parallelogram's top starts the slant in from the left, and its bottom ends as far before the right.
    const slant = slantedShape(n.style) === 'io' ? Math.min(SLANT, width) : 0;
    return side === 'top' ? [start + slant, start + width] : [start, start + width - slant];
  };
  const ends = new Map();
  for (const e of edges) {
    if (e.from === e.to) continue;
    const route = layout.edges.get(e.id);
    for (const [end, id, pt] of [['from', e.from, route?.start], ['to', e.to, route?.end]]) {
      if (!open.has(id) || !pt) continue;
      const b = absoluteBox(id, layout, parentOf);
      const side = sideOf(pt, b);
      if (!ends.has(id)) ends.set(id, new Map());
      if (!ends.get(id).has(side)) ends.get(id).set(side, []);
      ends.get(id).get(side).push({ e, end, at: upright(side) ? pt.y - b.y : pt.x - b.x });
    }
  }
  let set = false;
  for (const [id, sides] of ends) {
    const n = open.get(id);
    const groups = [...sides].map(([side, list]) => {
      list.sort((a, b) => a.at - b.at || a.e.id.localeCompare(b.e.id));
      // The lines into this side that may share one line, by style; the largest set merges.
      const alike = new Map();
      for (const x of list) {
        if (x.end !== 'to' || x.e.label || x.e.layoutReversed) continue;
        if (!alike.has(x.e.style)) alike.set(x.e.style, []);
        alike.get(x.e.style).push(x);
      }
      const merged = [...alike.values()].filter((m) => m.length >= MERGE_FROM[fanIn]).sort((a, b) => b.length - a.length)[0];
      const slots = list.filter((x) => !merged?.includes(x)).map((x) => ({ ends: [x], at: x.at }));
      // The merged line stands where the middle one of its lines stood.
      if (merged) slots.push({ ends: merged, at: merged[Math.floor(merged.length / 2)].at, merged: true });
      slots.sort((a, b) => a.at - b.at);
      const [lo, hi] = extent(n, side);
      for (const slot of slots) slot.share = hi > lo ? Math.max(0, Math.min(1, (slot.at - lo) / (hi - lo))) : 0.5;
      const close = slots.some((slot, i) => i > 0 && slot.at - slots[i - 1].at < MIN_END_GAP - 0.01);
      const off = slantedShape(n.style) !== undefined && slots.some((slot) => slot.at < lo - 0.5 || slot.at > hi + 0.5);
      return { side, slots, spread: close || off || merged !== undefined };
    });
    if (!groups.some((g) => g.spread)) continue;
    for (const g of groups) {
      if (!g.spread) continue;
      const [lo, hi] = extent(n, g.side);
      const short = (g.slots.length + 1) * MIN_END_GAP - (hi - lo);
      if (short <= 0) continue;
      if (upright(g.side)) n.height += short;
      else { n.width += short; if (n.drawWidth !== undefined) n.drawWidth += short; }
    }
    n.ports = [];
    n.exactEnds = true;
    const inset = n.drawWidth !== undefined ? (n.width - n.drawWidth) / 2 : 0;
    for (const g of groups) {
      const [lo, hi] = extent(n, g.side);
      g.slots.forEach((slot, i) => {
        const along = g.spread ? Math.round(lo + ((i + 1) / (g.slots.length + 1)) * (hi - lo)) : lo + slot.share * (hi - lo);
        // A port is a 1 px box whose centre the line ends at, on the border it lies against.
        const port = {
          id: `${id}:port:${g.side}:${i + 1}`,
          x: g.side === 'left' ? inset : g.side === 'right' ? n.width - inset - 1 : along - 0.5,
          y: g.side === 'top' ? 0 : g.side === 'bottom' ? n.height - 1 : along - 0.5,
        };
        n.ports.push(port);
        for (const { e, end } of slot.ends) e[end === 'from' ? 'fromPort' : 'toPort'] = port.id;
        if (slot.merged) merges.push({ node: id, edges: slot.ends.map((x) => x.e.id) });
      });
    }
    set = true;
  }
  return set;
}

/**
 * The dots that mark where merged lines join. The lines of a merged group (see sidePorts) end
 * at one port, and the layout routes them as one line that each joins on its way. A dot
 * stands where that shared line begins: where the last of the lines has joined, seen from
 * their sources. There a line that comes straight on meets lines from the sides, and without
 * a dot the place reads as a crossing. Further from the node the lines join one by one at a
 * T, which cannot be read as a crossing; only where four of their segments meet again does
 * another dot stand.
 * @param {Array<{node:string, edges:string[]}>} merges
 * @returns {Array<{id:string, x:number, y:number}>} centres of the dots, absolute
 */
export function fanInJunctions(layout, merges) {
  const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) < 0.5;
  // Each line from the node backwards, without the points that lie on a straight stretch.
  const pathOf = (id) => {
    const r = layout.edges.get(id);
    if (!r?.start || !r?.end) return undefined;
    const all = [r.end, ...[...(r.points ?? [])].reverse(), r.start].filter((p, i, list) => i === 0 || !near(p, list[i - 1]));
    const bends = (i) => { const a = stretchOf(all[i - 1], all[i]); const b = stretchOf(all[i], all[i + 1]); return a.x !== b.x || a.y !== b.y; };
    return all.filter((p, i) => i === 0 || i === all.length - 1 || bends(i));
  };
  const within = (v, lo, hi) => v >= Math.min(lo, hi) - 0.5 && v <= Math.max(lo, hi) + 0.5;
  // The directions in which a path leaves a point it passes through or ends at.
  const armsAt = (path, pt) => {
    const arms = [];
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1];
      const b = path[i];
      const d = stretchOf(a, b);
      const on = d.x === 0 ? Math.abs(pt.x - a.x) < 0.5 && within(pt.y, a.y, b.y) : Math.abs(pt.y - a.y) < 0.5 && within(pt.x, a.x, b.x);
      if (!on) continue;
      if (!near(pt, b)) arms.push(`${d.x},${d.y}`);
      if (!near(pt, a)) arms.push(`${-d.x},${-d.y}`);
    }
    return arms;
  };
  const dots = [];
  for (const m of merges) {
    const paths = m.edges.map(pathOf).filter(Boolean);
    if (paths.length < 2) continue;
    const partings = [];
    let trunk = Infinity;
    for (let i = 0; i < paths.length; i++) {
      for (let j = i + 1; j < paths.length; j++) {
        const common = sharedLength(paths[i], paths[j]);
        trunk = Math.min(trunk, common);
        const pt = pointAlong(paths[i], common).point;
        if (!partings.some((q) => near(q, pt))) partings.push(pt);
      }
    }
    const head = pointAlong(paths[0], trunk).point;
    const points = [head, ...partings.filter((pt) => !near(pt, head) && new Set(paths.flatMap((path) => armsAt(path, pt))).size >= 4)];
    for (const pt of points) dots.push({ id: `${m.node}:junction:${dots.length + 1}`, x: pt.x, y: pt.y });
  }
  return dots;
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
      if (other && Math.hypot(other[0].x - path[0].x, other[0].y - path[0].y) < 0.5) parted = Math.max(parted, sharedLength(path, other));
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
  // The first layout shows which side each line end uses; a side with too little room for
  // its ends, or with enough lines to merge, gets fixed ports and the layout runs again.
  const merges = [];
  for (let round = 0; round < 3 && sidePorts(layout, { containers, nodes, edges }, { fanIn: ir.fanIn, merges }); round++) layout = await arrange();
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
  return graphCells(cid, layout, { containers, nodes, edges, direction: ir.direction, junctions: fanInJunctions(layout, merges) });
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
  // A title wraps at the composite's width, but a word of it cannot break: the composite is at least as wide as that word needs.
  const titleRoom = (label) => 2 * Math.ceil((roomFor(widestWord(label, { bold: true })) + 2 * LABEL_PAD) / 2);
  const containers = composites.map((s) => ({ id: s.id, label: shown.get(s.id).label, link: shown.get(s.id).link, parent: parent.get(s.id), style: STYLE.composite, headerHeight: compositeHeader(shown.get(s.id).label.split('\n').length), minWidth: titleRoom(shown.get(s.id).label) }));
  const nodes = ir.states.filter((s) => kindOf(s) !== 'composite').map((s) => {
    const kind = kindOf(s);
    const circle = kind === 'initial' || kind === 'final';
    const { label, link } = circle ? { label: '' } : shown.get(s.id);
    const size = circle ? { width: CIRCLE, height: CIRCLE } : measureNode(label);
    const extra = loopExtra.get(s.id) ?? 0;
    return { id: s.id, label, link, parent: parent.get(s.id), style: STYLE[kind] ?? STYLE.state, width: size.width + 2 * extra, height: size.height, drawWidth: extra ? size.width : undefined, fixedOutline: circle || undefined };
  });
  const spacing = loopSpacing(ir.direction);
  const arrange = () => layoutGraph({ nodes, containers, edges, direction: ir.direction, spacing });
  let layout = await arrange();
  // Room for the transitions that end on one side of a state, and one line for many (see sidePorts).
  const merges = [];
  for (let round = 0; round < 3 && sidePorts(layout, { containers, nodes, edges }, { fanIn: ir.fanIn, merges }); round++) layout = await arrange();
  // A composite is as wide as its content, which only the layout knows; a title that wraps at
  // that width needs a taller header, and the layout runs once more with it.
  let taller = false;
  for (const c of containers) {
    const height = compositeHeader(headerLines(c.label, layout.containers.get(c.id).width));
    if (height > c.headerHeight) { c.headerHeight = height; taller = true; }
  }
  if (taller) layout = await arrange();
  return graphCells(cid, layout, { containers, nodes, edges, direction: ir.direction, junctions: fanInJunctions(layout, merges) });
}

const ROW = 26;
/** What each line after the first adds to a table header (a stereotype, the title of a ref). */
const HEADER_LINE = 20;

/** A table-like node (ER entity, class) with one child row per line; rows stack from the header. */
const ROW_LINE = 14;
/** Where the text of a table wraps; a word that cannot break makes the table wider than this (see `tableNode`). */
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
  const widestOf = (measure) => Math.max(measure(header, { bold: true }), ...rows.map((r) => measure(r.text ?? '')));
  // A row clips what does not fit and a header spills, so a word that cannot break sets the least width.
  const width = Math.max(Math.min(TABLE_MAX_WIDTH, Math.max(160, roomFor(widestOf(widestLine)) + 24)), roomFor(widestOf(widestWord)) + 24);
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
    // A general class stands above the classes that specialise it, and an interface above
    // what realises it: the hollow triangle points up, as a class diagram is read. Such a
    // relation runs from the special to the general, so left to the engine the subclass
    // would take the earlier layer; it is laid out against its direction instead.
    const upward = (r.kind === 'inheritance' || r.kind === 'realization') && r.from !== r.to;
    return { id: r.id, from: r.from, to: r.to, label: r.label, style: `${STYLE.classEdge}${def.style}`, endLabels, markers: { from: def.from, to: def.to }, ...(upward ? { layoutReversed: true } : {}) };
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
 * The style of a figure that is a stencil of its own: a GCP service (a hexagon), a general
 * resource of either library (a server, an application, a bucket) or a product logo. It is
 * drawn in one colour without a square behind it, which is how a system that is not an AWS
 * service is told from one.
 */
const stencilStyle = (icon) => `sketch=0;outlineConnect=0;fontColor=#232F3E;gradientColor=none;fillColor=${icon.fill};strokeColor=none;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;whiteSpace=wrap;fontSize=12;fontStyle=0;aspect=fixed;shape=${icon.stencil};`;
/** The corner icon of a group frame and the gap before its title (the AWS palette's `spacingLeft=30`). */
const AWS_GROUP_ICON = 30;
/**
 * Room between a cloud group frame and its members. Cloud diagrams nest four or five frames
 * (account, region, VPC, subnet) where a plain one nests one or two, so the 20 px a plain
 * boundary keeps on each side would add up to a wide empty band around the innermost members.
 */
const AWS_FRAME_INSET = 12;
/** Room kept between a frame title and its frame's side. */
const TITLE_GAP = 8;
/** Room kept between a frame title and a line that crosses the top of its frame. */
const TITLE_LINE_GAP = 12;
/** The flags that make a cell a frame its members move with; the AWS stencil frames carry them already. */
const CONTAINER_FLAGS = 'container=1;pointerEvents=0;collapsible=0;recursiveResize=0;';
/**
 * How the palette style of a provider's group frame becomes the style of a container. Every
 * frame is drawn the same way, whatever its provider: the title on one line at the top left,
 * at the size of the component names, after the corner icon where the frame has one.
 *
 * AWS: the Auto Scaling group, whose palette form has its icon and title in the middle of
 * the top side, is drawn like every other frame, icon in the corner and title beside it: a
 * title in the corner can step aside when a connection enters the frame from above, a fixed
 * icon in the middle cannot. A frame that is a plain rectangle there (an Availability Zone)
 * keeps its centred title.
 *
 * GCP: the palette writes its frames in two forms (a zone with `spacing=10`, a frame of the
 * project legend with `spacingLeft=10` and a 10 px font). Both get the one left margin
 * `spacingLeft` gives, so a title that steps aside is moved by that one key. The frame with
 * the Google Cloud mark keeps the room the palette leaves for the mark before its title.
 */
const FRAME_STYLE = {
  aws: (style) => style
    .replace('shape=mxgraph.aws4.groupCenter;', 'shape=mxgraph.aws4.group;')
    .replace('align=center;', `align=left;spacingLeft=${AWS_GROUP_ICON};`)
    .replace('spacingTop=25;', ''),
  gcp: (style) => {
    const parts = style.split(';').filter(Boolean);
    const value = (key) => Number(parts.find((part) => part.startsWith(`${key}=`))?.slice(key.length + 1) ?? 0);
    const kept = parts.filter((part) => !/^(?:spacing|spacingLeft|spacingTop|fontSize)=/.test(part));
    return [...kept, 'fontSize=12', 'spacing=0', 'spacingTop=6', `spacingLeft=${value('spacing') + value('spacingLeft')}`, ''].join(';');
  },
};
/**
 * A cloud group frame as a container: the palette's style as `FRAME_STYLE` adapts it, plus
 * the container flags where the palette form is a plain shape. The title of a frame stands
 * on one line, so the frame is at least that wide.
 */
function groupContainer(group, label) {
  const adapted = FRAME_STYLE[group.provider](group.style);
  const text = measureLabelBelow(label, { maxWidth: 360 });
  // Where the title starts: after the corner icon or the mark, else at the frame's left margin.
  const left = /(?:^|;)align=left;/.test(adapted) ? Number(/(?:^|;)spacingLeft=(\d+);/.exec(adapted)?.[1] ?? 0) : 0;
  const start = left > 0 ? left : TITLE_GAP;
  const corner = adapted.includes('grIcon=') || group.mark !== undefined;
  return {
    style: adapted.includes('container=1;') ? adapted : `${adapted}${CONTAINER_FLAGS}`,
    title: { width: text.width, height: text.height + 4, start, centred: left === 0, corner },
    inset: AWS_FRAME_INSET,
    minWidth: Math.min(400, 2 * Math.ceil((start + text.width + TITLE_GAP) / 2)),
    ...(group.mark ? { mark: group.mark } : {}),
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
 * below a horizontal stretch, left or right of a vertical one. With `anySegment`, when that
 * segment has no free place, the next longest that has one takes it (see `emitArchitecture`
 * for the arrangement that asks for it). A stretch ends where the line
 * crosses the border of a frame, so a label never lies across a border. The place must be
 * free: no component or name, no other label, no other line, no corner icon of a frame.
 * @returns {string|undefined} the id of the first connection whose label has no such place;
 *   the caller hands that label back to the layout engine and lays out again
 */
function placeLineLabels(layout, own, { containers, nodes, edges }, { anySegment = false } = {}) {
  const parentOf = new Map([...containers.map((c) => [c.id, c.parent]), ...nodes.map((n) => [n.id, n.parent])]);
  const hit = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  const within = (a, b) => a.x >= b.x && a.y >= b.y && a.x + a.width <= b.x + b.width && a.y + a.height <= b.y + b.height;
  const boxes = nodes.filter((n) => layout.nodes.has(n.id)).map((n) => absoluteBox(n.id, layout, parentOf));
  const frames = containers.map((c) => ({ box: absoluteBox(c.id, layout, parentOf), icon: c.title?.corner === true }));
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
    // A line that shares a stretch with others of its caller is labelled on a stretch that is
    // its own, the longest of them that has a free place.
    const mine = layout.edges.get(e.id).own;
    const length = (sg) => Math.abs(sg.a.x - sg.b.x) + Math.abs(sg.a.y - sg.b.y);
    const segments = mine ? mine.map(([p, q]) => ({ a: p, b: q })) : path.slice(1).map((b, i) => ({ a: path[i], b }));
    // Longest first; of two as long, the one nearer the start of the line.
    const ranked = segments.map((sg, i) => ({ sg, i })).sort((p, q) => length(q.sg) - length(p.sg) || p.i - q.i).map(({ sg }) => sg);
    const candidates = mine || anySegment ? ranked : ranked.slice(0, 1);
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

/** A step a straight line can do without: its bends lie this close across the flow, in px. */
const STEP_MAX = 24;
/** The least room between two line ends on one side of a figure, in px. */
const STEP_PORT_GAP = 10;

/**
 * Take the small step out of a line drawn back against the flow (the one that closes a
 * circle, such as a topic that pushes back to the service that publishes to it). It shares
 * both facing sides with the line that goes on, each figure spreads the ends of its lines
 * evenly over its side, and two neighbours with a different number of lines there get ends
 * that are a few pixels out of line: the engine joins them with two bends in the middle.
 * Where one end can move level with the other within its figure, keeping the order of the
 * ends on that side, the room to its neighbours and a straight way free of shapes and other
 * lines, the line is drawn straight. A line that the engine had to route round something
 * keeps its route, and so does every line that goes with the flow.
 */
function straightenSteps(layout, { containers, nodes, edges, direction }) {
  const parentOf = new Map([...containers.map((c) => [c.id, c.parent]), ...nodes.map((n) => [n.id, n.parent])]);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const sideways = acrossIsVertical(direction);
  // `across` is the coordinate the step lies in; `along` the one the line runs in.
  const across = (p) => (sideways ? p.y : p.x);
  const along = (p) => (sideways ? p.x : p.y);
  const setAcross = (p, v) => { if (sideways) p.y = v; else p.x = v; };
  const hit = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  const figureOf = (id) => (layout.nodes.has(id) ? drawBox(byId.get(id), absoluteBox(id, layout, parentOf)) : undefined);
  const routes = () => edges.map((e) => ({ e, r: layout.edges.get(e.id) })).filter(({ r }) => r?.start && r?.end);
  for (const { e, r } of routes()) {
    const points = r.points ?? [];
    if (!e.layoutReversed || points.length === 0 || e.from === e.to) continue;
    const path = [r.start, ...points, r.end];
    // Only a line that runs along the flow from one end to the other, with bends close together across it.
    const spread = Math.max(...path.map(across)) - Math.min(...path.map(across));
    if (spread > STEP_MAX || Math.abs(across(r.start) - across(r.end)) < 0.5) continue;
    const forward = Math.sign(along(r.end) - along(r.start));
    if (forward === 0 || path.slice(1).some((p, i) => Math.sign(along(p) - along(path[i])) === -forward)) continue;
    const ends = [{ id: e.from, at: r.start, other: r.end }, { id: e.to, at: r.end, other: r.start }];
    for (const end of ends) {
      const figure = figureOf(end.id);
      if (!figure) continue;
      const to = across(end.other);
      const [lo, hi] = sideways ? [figure.y, figure.y + figure.height] : [figure.x, figure.x + figure.width];
      if (to < lo + 4 || to > hi - 4) continue;
      // The other ends on the same side of this figure: the same place along the flow.
      const side = routes().flatMap(({ e: o, r: q }) => (o.id === e.id ? [] : [q.start, q.end].filter((p) => Math.abs(along(p) - along(end.at)) < 0.5 && across(p) >= lo - 0.5 && across(p) <= hi + 0.5)));
      if (side.some((p) => Math.abs(across(p) - to) < STEP_PORT_GAP)) continue;
      if (side.some((p) => Math.sign(across(p) - across(end.at)) !== Math.sign(across(p) - to))) continue;
      // The straight way: no shape but the two ends, no stretch of another line near it along the flow.
      const [a, b] = [Math.min(along(r.start), along(r.end)), Math.max(along(r.start), along(r.end))];
      const lane = sideways ? { x: a, y: to - STEP_PORT_GAP / 2, width: b - a, height: STEP_PORT_GAP } : { x: to - STEP_PORT_GAP / 2, y: a, width: STEP_PORT_GAP, height: b - a };
      if (nodes.some((n) => n.id !== e.from && n.id !== e.to && layout.nodes.has(n.id) && hit(lane, absoluteBox(n.id, layout, parentOf)))) continue;
      const crowded = routes().some(({ e: o, r: q }) => {
        if (o.id === e.id) return false;
        const qp = [q.start, ...(q.points ?? []), q.end];
        return qp.slice(1).some((p, i) => {
          const s = qp[i];
          if (Math.abs(across(p) - across(s)) > 0.5) return false;
          const box = { x: Math.min(p.x, s.x), y: Math.min(p.y, s.y), width: Math.abs(p.x - s.x) || 1, height: Math.abs(p.y - s.y) || 1 };
          return hit(lane, box);
        });
      });
      if (crowded) continue;
      setAcross(end.at, to);
      r.points = [];
      break;
    }
  }
}

/**
 * A label that `placeLineLabels` had no place for goes back to the layout engine, which puts
 * it on either side of its line. Among the labels of a row (lines that run along one
 * coordinate, `placeLineLabels` writing above a horizontal line and left of a vertical one
 * first) one on the other side reads as belonging to something else. Such a label moves to
 * the side its neighbours on that row stand on, mirrored across its line at the same
 * distance, when that place is free of shapes, labels, lines and frame borders; otherwise it
 * stays where the engine put it.
 */
function alignLabelSides(layout, { containers, nodes, edges }) {
  const handedBack = edges.filter((e) => e.label && e.labelOnDrawnLine && !e.labelPlacedByCaller);
  if (handedBack.length === 0) return;
  const parentOf = new Map([...containers.map((c) => [c.id, c.parent]), ...nodes.map((n) => [n.id, n.parent])]);
  const hit = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  const within = (a, b) => a.x >= b.x && a.y >= b.y && a.x + a.width <= b.x + b.width && a.y + a.height <= b.y + b.height;
  const boxes = nodes.filter((n) => layout.nodes.has(n.id)).map((n) => absoluteBox(n.id, layout, parentOf));
  const frames = containers.map((c) => ({ box: absoluteBox(c.id, layout, parentOf), icon: c.title?.corner === true }));
  const corners = frames.filter((f) => f.icon).map((f) => ({ x: f.box.x, y: f.box.y, width: AWS_GROUP_ICON, height: AWS_GROUP_ICON }));
  const pathOf = (e) => { const r = layout.edges.get(e.id); return r?.start && r?.end ? [r.start, ...(r.points ?? []), r.end] : undefined; };
  // Each label beside a straight stretch of its line: the line it runs along and its side.
  const sideOf = (e) => {
    const label = layout.edges.get(e.id)?.label;
    const path = pathOf(e);
    if (!label || !path || !e.label) return undefined;
    for (let i = 1; i < path.length; i++) {
      const [a, b] = [path[i - 1], path[i]];
      const flat = Math.abs(a.y - b.y) < 0.5;
      if (!flat && Math.abs(a.x - b.x) >= 0.5) continue;
      const [lo, hi] = flat ? [Math.min(a.x, b.x), Math.max(a.x, b.x)] : [Math.min(a.y, b.y), Math.max(a.y, b.y)];
      const mid = flat ? label.x + label.width / 2 : label.y + label.height / 2;
      if (mid < lo || mid > hi) continue;
      const at = flat ? a.y : a.x;
      const [near, far] = flat ? [label.y, label.y + label.height] : [label.x, label.x + label.width];
      if (far <= at && at - far < 12) return { flat, at, side: -1, gap: at - far, label };
      if (near >= at && near - at < 12) return { flat, at, side: 1, gap: near - at, label };
    }
    return undefined;
  };
  const placed = new Map(edges.map((e) => [e.id, sideOf(e)]).filter(([, s]) => s));
  for (const e of handedBack) {
    const mine = placed.get(e.id);
    if (!mine) continue;
    const row = [...placed].filter(([id, s]) => id !== e.id && s.flat === mine.flat && Math.abs(s.at - mine.at) < 1).map(([, s]) => s.side);
    if (row.length === 0 || row.some((s) => s !== row[0]) || row[0] === mine.side) continue;
    const { label } = mine;
    const box = mine.flat
      ? { ...label, y: row[0] < 0 ? mine.at - mine.gap - label.height : mine.at + mine.gap }
      : { ...label, x: row[0] < 0 ? mine.at - mine.gap - label.width : mine.at + mine.gap };
    const lines = edges.flatMap((o) => {
      const path = pathOf(o);
      return path ? path.slice(1).map((p, i) => ({ x: Math.min(path[i].x, p.x) - 1, y: Math.min(path[i].y, p.y) - 1, width: Math.abs(p.x - path[i].x) + 2, height: Math.abs(p.y - path[i].y) + 2 })) : [];
    });
    const others = edges.filter((o) => o.id !== e.id).map((o) => (o.label ? layout.edges.get(o.id)?.label : undefined)).filter(Boolean);
    if (boxes.some((n) => hit(box, n)) || others.some((l) => hit(box, l)) || corners.some((c) => hit(box, c)) || lines.some((l) => hit(box, l))) continue;
    if (frames.some((f) => hit(box, f.box) && !within(box, f.box))) continue;
    layout.edges.get(e.id).label = box;
    placed.set(e.id, { ...mine, side: row[0], label: box });
  }
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

/**
 * The header bars of the plain frames: a boundary without a cloud group is a frame with a
 * strip at its top that holds the title, which a line should not run through.
 * @returns {Array<{id:string, box:{x:number,y:number,width:number,height:number}}>}
 */
function headerBars(containers, frames) {
  const boxOf = new Map(frames.map((f) => [f.id, f.box]));
  return containers.filter((c) => /^swimlane;/.test(c.style ?? '') && boxOf.has(c.id)).map((c) => {
    const box = boxOf.get(c.id);
    const strip = c.headerHeight ?? Number(/startSize=(\d+);/.exec(c.style)?.[1] ?? 0);
    return { id: c.id, box: { x: box.x, y: box.y, width: box.width, height: strip } };
  }).filter((h) => h.box.height > 0);
}

/**
 * The connections that run through the header bar of a plain frame, as `layout:` warnings.
 * A line that passes over a frame it does not enter is one; so is, in a left-to-right or
 * right-to-left diagram, a line that leaves or enters a frame across its top, since the flow
 * then reaches the members from the sides and such a line runs through the strip beside the
 * title. In a top-down or bottom-up diagram a line comes into a frame through its top by
 * the flow itself, which is how a frame with a header is read, and is no warning.
 */
function headerCrossings(layout, { ir, containers, nodes, edges }) {
  const parentOf = new Map([...containers.map((c) => [c.id, c.parent]), ...nodes.map((n) => [n.id, n.parent])]);
  const frames = containers.map((c) => ({ id: c.id, box: absoluteBox(c.id, layout, parentOf) }));
  const headers = headerBars(containers, frames);
  if (headers.length === 0) return [];
  const across = acrossIsVertical(ir.direction);
  const inside = (id, frame) => { for (let p = parentOf.get(id); p; p = parentOf.get(p)) if (p === frame) return true; return false; };
  const label = new Map(containers.map((c) => [c.id, c.label]));
  const out = [];
  ir.connections.forEach((c, i) => {
    const r = layout.edges.get(c.id);
    if (!r?.start || !r?.end) return;
    const path = [r.start, ...(r.points ?? []), r.end];
    for (const h of headers) {
      const ends = inside(c.from, h.id) || inside(c.to, h.id);
      if (ends && !across) continue;
      const { x, y, width, height } = h.box;
      const through = path.slice(1).some((p, k) => {
        const q = path[k];
        const lo = { x: Math.min(p.x, q.x), y: Math.min(p.y, q.y) };
        const hi = { x: Math.max(p.x, q.x), y: Math.max(p.y, q.y) };
        return lo.x < x + width && hi.x > x && lo.y < y + height && hi.y > y;
      });
      if (!through) continue;
      out.push({
        path: `/connections/${i}`,
        message: `layout: connection "${c.id}" runs through the header bar of frame "${String(label.get(h.id)).replace(/\s+/g, ' ')}", beside its title`,
        hint: 'try another "direction" or another order of the components and connections; a crossing that no order avoids is shown to the user and accepted explicitly',
      });
    }
  });
  return out;
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

/** How far off the middle of a frame the main flow may run before the turned-over layout is tried: outside the middle half. */
const FLOW_OFF_MIDDLE = 0.5;

/**
 * How far the main flow of a left-to-right or right-to-left diagram runs off the middle of
 * the frames it passes through: 0 when it runs through the middle of each, 1 when it runs
 * along an edge of one. The main flow is the longest chain of connections in the direction
 * they are laid out (of two as long, the one that starts first in the IR, going on by the
 * first connection); in each frame that holds a component of it, its place is the middle of
 * those components across the flow, at the figure where a component is drawn as one,
 * measured from the top of the frame, its header included. Of all those frames the one the
 * flow runs furthest off the middle of counts. A diagram without frames, or that runs top
 * down or bottom up, gives 0.
 */
function flowOffMiddle(layout, { containers, nodes, edges, direction }) {
  if (!acrossIsVertical(direction) || containers.length === 0) return 0;
  const parentOf = new Map([...containers.map((c) => [c.id, c.parent]), ...nodes.map((n) => [n.id, n.parent])]);
  const placed = new Set(nodes.filter((n) => layout.nodes.has(n.id)).map((n) => n.id));
  const next = new Map([...placed].map((id) => [id, []]));
  for (const e of edges) {
    const [from, to] = e.layoutReversed ? [e.to, e.from] : [e.from, e.to];
    if (from !== to && placed.has(from) && placed.has(to)) next.get(from).push(to);
  }
  // The number of connections in the longest chain that starts at each component.
  const reach = new Map();
  const longest = (id, open = new Set()) => {
    if (reach.has(id)) return reach.get(id);
    if (open.has(id)) return 0;
    open.add(id);
    const d = Math.max(0, ...next.get(id).map((to) => 1 + longest(to, open)));
    open.delete(id);
    reach.set(id, d);
    return d;
  };
  const order = nodes.map((n) => n.id).filter((id) => placed.has(id));
  let at = order.reduce((best, id) => (longest(id) > longest(best) ? id : best), order[0]);
  if (at === undefined || longest(at) === 0) return 0;
  const flow = [at];
  while (longest(at) > 0) {
    at = next.get(at).find((to) => longest(to) === longest(at) - 1 && !flow.includes(to));
    if (at === undefined) break;
    flow.push(at);
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const middle = (id) => { const b = drawBox(byId.get(id), absoluteBox(id, layout, parentOf)); return b.y + b.height / 2; };
  const inside = (id, frame) => { for (let p = parentOf.get(id); p; p = parentOf.get(p)) if (p === frame) return true; return false; };
  let off = 0;
  for (const c of containers) {
    if (!layout.containers.has(c.id)) continue;
    const members = flow.filter((id) => inside(id, c.id));
    if (members.length === 0) continue;
    const box = absoluteBox(c.id, layout, parentOf);
    const y = members.reduce((sum, id) => sum + middle(id), 0) / members.length;
    off = Math.max(off, Math.abs((y - box.y) / box.height - 0.5) * 2);
  }
  return off;
}

/** The places where two connections cross: a horizontal stretch of one through a vertical stretch of another. */
function lineCrossings(layout, edges) {
  const stretches = [];
  for (const e of edges) {
    const r = layout.edges.get(e.id);
    if (!r?.start || !r?.end || e.from === e.to) continue;
    const path = [r.start, ...(r.points ?? []), r.end];
    for (let i = 1; i < path.length; i++) stretches.push({ id: e.id, a: path[i - 1], b: path[i] });
  }
  const flat = stretches.filter((s) => Math.abs(s.a.y - s.b.y) < 0.5 && Math.abs(s.a.x - s.b.x) >= 0.5);
  const upright = stretches.filter((s) => Math.abs(s.a.x - s.b.x) < 0.5 && Math.abs(s.a.y - s.b.y) >= 0.5);
  let count = 0;
  for (const h of flat) {
    for (const v of upright) {
      if (h.id === v.id) continue;
      const x = v.a.x;
      const y = h.a.y;
      if (x > Math.min(h.a.x, h.b.x) + 0.5 && x < Math.max(h.a.x, h.b.x) - 0.5 && y > Math.min(v.a.y, v.b.y) + 0.5 && y < Math.max(v.a.y, v.b.y) - 0.5) count++;
    }
  }
  return count;
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
 *
 * Across a left-to-right flow the frames are not alike above and below: their headers are at
 * the top. A frame whose members off the main flow the engine put above it has the flow along
 * its bottom edge, while turned over, with them below, the flow runs under the header, through
 * the middle. So when the flow of the kept arrangement runs outside the middle half of a frame
 * it passes (`flowOffMiddle`), the same arrangement is laid out turned over (`mirror` in
 * `layoutGraph`), and kept when its flow runs clearly nearer the middle of the frames, it has
 * no more crossings of lines, no more warnings, and its hubs stand no further off the middle
 * or still near enough to it that no other arrangement would be tried.
 * Laying out again to make room for a label can undo the turn, so there a label tries every
 * segment of its line before it goes back to the layout engine. A diagram with a connection
 * from a component to itself is not turned: its loops belong above the components.
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
  if (best.flow > FLOW_OFF_MIDDLE && !ir.connections.some((c) => c.from === c.to)) {
    const turned = await arrangeArchitecture(ir, refs, { ...best.how, mirror: true });
    const centred = turned.off.sum <= best.off.sum + 0.05 || (turned.off.fan <= FAN_OFF_CENTRE && turned.off.page <= PAGE_OFF_CENTRE);
    if (turned.flow < best.flow - 0.05 && turned.crossings <= best.crossings && turned.warnings.length <= best.warnings.length && centred) best = turned;
  }
  warnings.push(...best.warnings);
  return graphCells(cid, best.layout, { containers: best.containers, nodes: best.nodes, edges: best.edges, direction: ir.direction });
}

/** One arrangement of an architecture diagram (see `ARRANGEMENTS`), turned over with `mirror`, with how far its hubs and its main flow stand off the middle and how often its lines cross. */
async function arrangeArchitecture(ir, refs, how) {
  const warnings = [];
  const parent = parentMap(ir.boundaries ?? []);
  const containers = (ir.boundaries ?? []).map((b) => {
    const group = cloudGroup(b.group);
    return { id: b.id, label: b.label, parent: parent.get(b.id), style: STYLE.container, ...(group ? groupContainer(group, b.label) : { title: plainTitle(b.label) }) };
  });
  // The placement rules below hold for a diagram with icons or group frames of a cloud provider, whichever it is.
  const usesCloud = (ir.boundaries ?? []).some((b) => cloudGroup(b.group)) || ir.components.some((c) => cloudIcon(c.icon));
  const kindOf = (c) => c.kind ?? 'service';
  // A figure with its label below it: the screen of a client, or the icon of a cloud service.
  const figureOf = (c) => {
    const icon = cloudIcon(c.icon);
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
  // A connection that closes a circle (a topic that pushes back to the service that publishes
  // to it) is laid out against the flow, so the connections listed before it keep the
  // direction of the diagram and a component outside the frames keeps its side.
  const closing = closingEdges(edges);
  for (const e of edges) if (closing.has(e.id)) e.layoutReversed = true;
  const spacing = { nodeNode: 50, layer: 80, ...loopSpacing(ir.direction) };
  // The ports of a figure depend on the sides its connections use, so they are worked out
  // afresh for every arrangement that is tried.
  // In a cloud diagram each label is placed beside its own line after the layout (placeLineLabels).
  if (usesCloud) for (const e of edges) if (e.label && e.from !== e.to) { e.labelPlacedByCaller = true; e.labelOnDrawnLine = true; }
  const aside = usesCloud ? asideCandidates(nodes, edges) : new Map();
  const row = usesCloud ? rowCandidates(nodes, edges, aside) : new Map();
  // A system of a row is placed with the row, also when one component alone uses it.
  const stores = usesCloud ? attachStores(nodes, edges, ir.direction, row) : new Map();
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
      straightenSteps(base, { containers, nodes, edges, direction: ir.direction });
      // A label with no free place beside its line goes back to the layout engine.
      const own = new Set(edges.filter((e) => e.labelPlacedByCaller && !aside.has(e.to) && !stores.has(e.to)).map((e) => e.id));
      const crowded = placeLineLabels(base, own, { containers, nodes, edges }, { anySegment: how.mirror === true });
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
  if (usesCloud) {
    const g = laidOut();
    layout = await placeAside(await nearSide(layout, g, arrange));
  }
  // A wider frame moves the lines, so the titles are placed again after each new layout. A
  // narrow frame that two lines enter side by side (two clouds, one below the other) grows by
  // a few pixels a round, so the rounds are not cut short.
  let unplaced = placeGroupTitles(layout, { containers, nodes, edges });
  for (let round = 0; unplaced && round < 16; round++) {
    layout = await placeAside(await layoutGraph({ ...laidOut(), containers, direction: ir.direction, spacing, ...how }));
    unplaced = placeGroupTitles(layout, { containers, nodes, edges });
  }
  if (unplaced) warnings.push({ path: '/boundaries', message: 'layout: a connection crosses the title of a group frame; no free place was found for it along the top of the frame', hint: 'set "direction" to "LR" or shorten the boundary label' });
  for (const c of containers) if (c.titleOffset !== undefined) c.style = titleAt(c.style, c.titleOffset);
  warnings.push(...headerCrossings(layout, { ir, containers, nodes, edges }));
  if (usesCloud) alignLabelSides(layout, { containers, nodes, edges });
  // draw.io writes an edge label on a white patch. Inside a tinted frame (a subnet) the patch
  // takes the colour of the frame, so the label hides its line without showing as a box.
  if (usesCloud) {
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
  const flow = flowOffMiddle(layout, { containers, nodes, edges, direction: ir.direction });
  return { layout, containers, nodes, edges, warnings, how, flow, crossings: lineCrossings(layout, edges), off: { fan, page, sum: fan + page } };
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
      const side = sideOf(pt, b);
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
      onTop.push(vertex({ id: `${cid(f.id)}:sep-label-${i + 1}`, value: htmlLabel(s.label), style: STYLE.frameSeparatorLabel, x: f.x + 1, y: s.y - 10, width: s.width + 8, height: 20, connectable: false }));
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
      const x = from.centerX + SELF_LOOP.out;
      // A label too wide to stand centred over the loop starts beside the activation bar.
      const box = selfLabelBox(label);
      const beside = box.aligned ? { style: 'align=left;', labelOffset: { x: box.left - SELF_LOOP.out, y: 0 } } : { style: '' };
      const anchors = `exitX=0.5;exitY=0;exitDx=0;exitDy=${y - 10 - from.y};exitPerimeter=0;entryX=0.5;entryY=0;entryDx=0;entryDy=${y + 10 - from.y};entryPerimeter=0;`;
      cells.push(edge({ id: cid(msg.id), value: htmlLabel(label), style: `${STYLE.selfMessage}${beside.style}${anchors}`, source: cid(msg.from), target: cid(msg.to), points: [{ x, y: y - 10 }, { x, y: y + 10 }], link, ...(beside.labelOffset ? { labelOffset: beside.labelOffset } : {}) }));
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

/** The stick figure of an actor, at the size of draw.io's UML library; its name is drawn below it. */
const ACTOR_FIGURE = { width: 30, height: 60 };
const USECASE_STYLE = {
  actor: 'shape=umlActor;verticalLabelPosition=bottom;verticalAlign=top;whiteSpace=wrap;html=1;outlineConnect=0;',
  // An outside system that takes part: a box marked «system», so nobody reads it as a person.
  system: `whiteSpace=wrap;html=1;${labelPad('process')}`,
  useCase: 'ellipse;whiteSpace=wrap;html=1;',
  // The system boundary: a rectangle with its name at the top, as UML draws the subject.
  boundary: 'rounded=0;whiteSpace=wrap;html=1;container=1;collapsible=0;recursiveResize=0;verticalAlign=top;fontStyle=1;spacingTop=4;',
  edge: 'edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;jumpStyle=arc;jumpSize=8;',
};
const USECASE_EDGE = {
  association: 'endArrow=none;',
  include: 'dashed=1;endArrow=open;endSize=10;endFill=0;',
  extend: 'dashed=1;endArrow=open;endSize=10;endFill=0;',
  generalization: 'endArrow=block;endSize=14;endFill=0;',
};
/** The side of a node that faces along the flow, and the one that faces against it. */
const FLOW_SIDE = { LR: 'right', RL: 'left', TB: 'bottom', BT: 'top' };
const OPPOSITE_SIDE = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' };
/** How far the line of a generalization between two actors that are not neighbours stands off their column, and the pitch of further ones. */
const ACTOR_BRACKET = { out: 20, step: 14 };

/** The role of an actor: a person starts use cases unless told otherwise, an outside system is called on. */
const actorRole = (a) => a.role ?? ((a.kind ?? 'person') === 'system' ? 'supporting' : 'primary');

/**
 * Where a line meets a shape of a use case diagram, as draw.io's relative anchor, from the
 * point the layout routed it to on the shape's layout box. An ellipse is narrower than its
 * box everywhere but the middle of a side, so the last stretch of the line is carried on in
 * its own direction to the outline; the anchor is that point, kept as it is (`perimeter`
 * off), so the line stays straight where draw.io would otherwise turn it towards the centre.
 * A figure with its name below is met at the figure's side, or under the name when the line
 * comes from below.
 */
function usecaseAnchor(n, layoutBox, pt) {
  const b = drawBox(n, layoutBox);
  const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
  if (n.ellipse) {
    const rx = b.width / 2;
    const ry = b.height / 2;
    const cx = b.x + rx;
    const cy = b.y + ry;
    const sideways = Math.min(Math.abs(pt.x - b.x), Math.abs(pt.x - b.x - b.width)) <= Math.min(Math.abs(pt.y - b.y), Math.abs(pt.y - b.y - b.height));
    if (sideways) {
      const t = clamp((pt.y - cy) / ry, -0.98, 0.98);
      return { x: (cx + Math.sign(pt.x - cx || 1) * rx * Math.sqrt(1 - t * t) - b.x) / b.width, y: (cy + t * ry - b.y) / b.height, dx: 0, dy: 0, fixed: true };
    }
    const t = clamp((pt.x - cx) / rx, -0.98, 0.98);
    return { x: (cx + t * rx - b.x) / b.width, y: (cy + Math.sign(pt.y - cy || 1) * ry * Math.sqrt(1 - t * t) - b.y) / b.height, dx: 0, dy: 0, fixed: true };
  }
  const a = { x: clamp((pt.x - b.x) / b.width), y: clamp((pt.y - b.y) / b.height), dx: 0, dy: 0, fixed: false };
  // Under the name of a figure: the point itself, as an offset from the figure's bottom.
  if (pt.y > b.y + b.height + 0.5) Object.assign(a, { dx: pt.x - (b.x + a.x * b.width), dy: pt.y - (b.y + b.height), fixed: true });
  return a;
}
const usecaseAnchorStyle = (prefix, a) => `${prefix}X=${round(a.x)};${prefix}Y=${round(a.y)};${prefix}Dx=${round(a.dx)};${prefix}Dy=${round(a.dy)};${a.fixed ? `${prefix}Perimeter=0;` : ''}`;

/**
 * Use case diagram. The layout engine places the primary actors in the first layer and the
 * supporting actors and outside systems in the last one, with the system boundaries and
 * their use cases between them: left and right of the boundary in the default left-to-right
 * direction, above and below it top-down. Along the flow an included use case follows its
 * base, an extending one follows the use case it extends, and a special use case follows
 * the general one, so the use cases an actor starts stand nearest to it.
 *
 * Every line of an actor leaves from one point of its figure, so its associations run as
 * one line that parts where the use cases are. A generalization between two actors of one
 * side is not the engine's: they share a layer, and the line is drawn straight between
 * neighbours, or round the outside of the column when another actor stands between them.
 */
async function emitUsecase(ir, cid, refs, warnings) {
  const direction = ir.direction ?? 'LR';
  const horizontal = direction === 'LR' || direction === 'RL';
  const even = (v) => 2 * Math.ceil(v / 2);
  const role = new Map(ir.actors.map((a) => [a.id, actorRole(a)]));
  const isActor = (id) => role.has(id);
  const portSide = (id) => (role.get(id) === 'primary' ? FLOW_SIDE[direction] : OPPOSITE_SIDE[FLOW_SIDE[direction]]);
  const parent = parentMap(ir.boundaries ?? []);

  // A boundary title stays on one line up to a width; a longer one wraps, and a word of it
  // cannot break, so the boundary is at least as wide as that word.
  const titleWidth = (label) => even(Math.max(roomFor(widestWord(label, { bold: true })), Math.min(320, roomFor(wrapText(label, Infinity, { bold: true }).widest))) + 2 * LABEL_PAD);
  const headerOf = (lines) => 30 + 16 * (lines - 1);
  const containers = (ir.boundaries ?? []).map((b) => ({ id: b.id, label: b.label, style: USECASE_STYLE.boundary, headerHeight: 30, minWidth: titleWidth(b.label), title: plainTitle(b.label) }));

  const actors = ir.actors.map((a) => {
    const side = portSide(a.id);
    const layoutOptions = { 'elk.layered.layering.layerConstraint': role.get(a.id) === 'primary' ? 'FIRST_SEPARATE' : 'LAST_SEPARATE' };
    if ((a.kind ?? 'person') === 'system') {
      const label = `«system»\n${a.label}`;
      const size = measureNode(label);
      return { id: a.id, label, style: USECASE_STYLE.system, width: size.width, height: size.height, own: size, side, layoutOptions };
    }
    const below = measureLabelBelow(a.label);
    return { id: a.id, label: a.label, style: `${USECASE_STYLE.actor}labelWidth=${below.wrap};`, width: even(Math.max(ACTOR_FIGURE.width, below.width)), height: even(ACTOR_FIGURE.height + below.height), own: ACTOR_FIGURE, drawWidth: ACTOR_FIGURE.width, drawHeight: ACTOR_FIGURE.height, side, layoutOptions };
  });
  // The actors of one side get one layout box across the flow, so their figures line up; each
  // is drawn at its own size in the middle (or at the top) of that box.
  for (const which of ['primary', 'supporting']) {
    const group = actors.filter((n) => role.get(n.id) === which);
    const across = Math.max(0, ...group.map((n) => (horizontal ? n.width : n.height)));
    for (const n of group) {
      if (horizontal) { if (n.width < across) { n.drawWidth = n.drawWidth ?? n.width; n.width = across; } }
      else if (n.height < across) { n.drawWidth = n.drawWidth ?? n.width; n.drawHeight = n.drawHeight ?? n.height; n.height = across; }
    }
  }
  // One port per actor, on the side that faces the system, at the middle of the figure: its
  // lines leave together. A port is a 1 px box whose centre the line ends at.
  const portAt = (n, shift = 0) => {
    const mid = n.own.height / 2;
    switch (n.side) {
      case 'right': return { x: n.width - 1, y: mid + shift - 0.5 };
      case 'left': return { x: 0, y: mid + shift - 0.5 };
      case 'bottom': return { x: n.width / 2 + shift - 0.5, y: n.height - 1 };
      default: return { x: n.width / 2 + shift - 0.5, y: 0 };
    }
  };
  for (const n of actors) n.ports = [{ id: `${n.id}:port`, ...portAt(n) }];

  const useCases = ir.useCases.map((u, i) => {
    const { label, link } = refLabel(u.label, u.ref, refs, `/useCases/${i}/ref`, warnings);
    const size = measureEllipse(label);
    return { id: u.id, label, link, parent: parent.get(u.id), style: `${USECASE_STYLE.useCase}spacingLeft=${size.spacing};spacingRight=${size.spacing};`, width: size.width, height: size.height, ellipse: true };
  });
  const nodes = [...actors, ...useCases];
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  const edges = ir.relations.map((r) => {
    const e = { id: r.id, from: r.from, to: r.to, style: `${USECASE_STYLE.edge}${USECASE_EDGE[r.kind]}` };
    // The end that comes first along the flow.
    let first = r.from;
    switch (r.kind) {
      case 'association': {
        const actor = isActor(r.from) ? r.from : r.to;
        first = role.get(actor) === 'primary' ? actor : (actor === r.from ? r.to : r.from);
        break;
      }
      case 'include': e.label = '«include»'; break;
      case 'extend': e.label = r.condition ? `«extend»\n[${r.condition}]` : '«extend»'; first = r.to; break;
      default:
        if (!isActor(r.from)) first = r.to;
        else if (role.get(r.from) === role.get(r.to)) e.byHand = true;
        else first = role.get(r.from) === 'primary' ? r.from : r.to;
    }
    if (first !== r.from) e.layoutReversed = true;
    if (!e.byHand) {
      // A generalization that crosses the system keeps clear of the associations of its actors.
      const port = (id) => {
        const n = nodeById.get(id);
        if (r.kind !== 'generalization') return `${id}:port`;
        n.ports.push({ id: `${id}:port:${r.id}`, ...portAt(n, 14) });
        return `${id}:port:${r.id}`;
      };
      if (isActor(r.from)) e.fromPort = port(r.from);
      if (isActor(r.to)) e.toPort = port(r.to);
    }
    return e;
  });
  const byHand = edges.filter((e) => e.byHand);
  const routed = edges.filter((e) => !e.byHand);

  // Room outside the first layer for the lines drawn round a column of actors.
  const outerRoom = { left: 0, top: 0 };
  const bracketCount = (side) => new Set(byHand.filter((e) => OPPOSITE_SIDE[nodeById.get(e.from).side] === side).map((e) => e.to)).size;
  for (const side of ['left', 'top']) if (bracketCount(side) > 0) outerRoom[side] = ACTOR_BRACKET.out + ACTOR_BRACKET.step * bracketCount(side);
  // The nodes of a layer are ordered from the model: the actors of a side stand as the model
  // lists them, the use cases as the engine derives their order from the model and its
  // edges. Left to the crossing minimisation, the order is whatever crosses the fewest
  // lines, and one added association turns a whole column round: the reader of a change
  // then finds nothing where it was. It also lets the author fix a crossing, by the order
  // of the actors in the IR.
  const options = { 'elk.padding': `[top=${12 + outerRoom.top},left=${12 + outerRoom.left},bottom=12,right=12]`, 'elk.layered.crossingMinimization.forceNodeModelOrder': 'true' };
  const arrange = () => layoutGraph({ nodes, containers, edges: routed, direction, spacing: { nodeNode: 40, layer: 70 }, options });
  let layout = await arrange();
  // A boundary is as wide as its use cases need, which only the layout knows; a title that
  // wraps at that width needs a taller header, and the layout runs once more with it.
  let taller = false;
  for (const c of containers) {
    const height = headerOf(headerLines(c.label, layout.containers.get(c.id).width));
    if (height > c.headerHeight) { c.headerHeight = height; c.title = plainTitle(c.label, height); taller = true; }
  }
  if (taller) layout = await arrange();
  const parentOf = new Map([...containers.map((c) => [c.id, c.parent]), ...nodes.map((n) => [n.id, n.parent])]);
  const boxOf = (id) => absoluteBox(id, layout, parentOf);
  // Two line ends on one ellipse never lie on each other: a use case with more ends on a
  // side than its outline has room for is drawn taller, and the layout runs again.
  for (let pass = 0; pass < 2 && growCrowdedUseCases(layout, routed, useCases, boxOf, horizontal).length > 0; pass++) layout = await arrange();
  // A line that enters a boundary from above runs across its title: the title steps aside.
  let unplaced = placeGroupTitles(layout, { containers, nodes, edges: routed });
  for (let pass = 0; unplaced && pass < 6; pass++) {
    layout = await arrange();
    unplaced = placeGroupTitles(layout, { containers, nodes, edges: routed });
  }
  if (unplaced) warnings.push({ path: '/boundaries', message: 'layout: a line crosses the title of a boundary; no free place was found for it along the top of the boundary', hint: 'set "direction" to "LR" or shorten the boundary label' });
  for (const c of containers) if (c.titleOffset !== undefined) c.style = titleAt(c.style, c.titleOffset);

  placeActorGeneralizations(layout, byHand, { actors, horizontal, boxOf });
  separateActorTrunks(layout, routed, { actors, nodes, containers, horizontal, boxOf });
  for (const e of edges) {
    const route = layout.edges.get(e.id);
    if (!route?.start || !route?.end) continue;
    e.style += usecaseAnchorStyle('exit', usecaseAnchor(nodeById.get(e.from), boxOf(e.from), route.start)) + usecaseAnchorStyle('entry', usecaseAnchor(nodeById.get(e.to), boxOf(e.to), route.end));
  }
  return graphCells(cid, layout, { containers, nodes, edges, direction }, warnings);
}

/** Trunks of two actors on one line read as one line when their ends are nearer than this; the pitches to try between their tracks; the room a moved trunk keeps to what it passes. */
const ACTOR_TRUNK = { near: 60, pitches: [14, 12, 10, 8], clear: 8 };

/**
 * Give the lines of each actor a track of their own. The associations of an actor leave its
 * figure as one line, the trunk, which runs along the column of actors and parts where the
 * use cases are. The engine sets the trunks of several actors on one line when they do not
 * overlap, and two of them that end a few pixels from each other then read as one line that
 * joins two actors. Trunks that share a line and nearly meet are moved apart across the
 * flow, each actor to its own track, in the order of the actors; only the stretches along
 * the flow get longer or shorter, and the trunks of different actors cover different ranges,
 * so no new crossing can come of it. A pitch is taken only when every moved trunk stays
 * clear of the nodes, the borders of the boundaries and the other lines; with no such pitch
 * the routes stay as the engine made them.
 */
function separateActorTrunks(layout, routed, { actors, nodes, containers, horizontal, boxOf }) {
  // Across the flow lies the coordinate a trunk runs along (`run`); `track` is the one it stands at.
  const track = (p) => (horizontal ? p.x : p.y);
  const run = (p) => (horizontal ? p.y : p.x);
  const setTrack = (p, v) => { if (horizontal) p.x = v; else p.y = v; };
  const trunks = new Map();
  for (const n of actors) {
    for (const e of routed) {
      const mine = e.fromPort === `${n.id}:port` ? 'from' : e.toPort === `${n.id}:port` ? 'to' : null;
      const route = layout.edges.get(e.id);
      if (!mine || !route?.start || !route?.end || (route.points ?? []).length < 2) continue;
      // The first two bends, seen from the actor: the ends of the stretch along the column.
      const [a, b] = mine === 'from' ? route.points : [route.points.at(-1), route.points.at(-2)];
      if (Math.abs(track(a) - track(b)) > 0.5) continue;
      const key = `${n.side}|${Math.round(track(a) * 2) / 2}`;
      if (!trunks.has(key)) trunks.set(key, new Map());
      const byActor = trunks.get(key);
      if (!byActor.has(n.id)) byActor.set(n.id, { at: track(a), lo: Infinity, hi: -Infinity, bends: [], edges: new Set() });
      const t = byActor.get(n.id);
      t.lo = Math.min(t.lo, run(a), run(b));
      t.hi = Math.max(t.hi, run(a), run(b));
      t.bends.push(a, b);
      t.edges.add(e.id);
    }
  }
  const boxes = [...nodes.map((n) => drawBox(n, boxOf(n.id))), ...nodes.filter((n) => n.drawWidth !== undefined).map((n) => boxOf(n.id))];
  const borders = containers.map((c) => boxOf(c.id)).flatMap((b) => (horizontal ? [b.x, b.x + b.width] : [b.y, b.y + b.height]));
  for (const byActor of trunks.values()) {
    const line = [...byActor.values()].sort((p, q) => p.lo - q.lo);
    // The trunks that nearly meet their neighbour on the line, as runs of neighbours.
    const groups = [];
    for (const [i, t] of line.entries()) {
      if (i > 0 && t.lo - line[i - 1].hi < ACTOR_TRUNK.near) groups.at(-1).push(t);
      else groups.push([t]);
    }
    for (const group of groups.filter((g) => g.length > 1)) {
      const own = new Set(group.flatMap((t) => [...t.edges]));
      // Every stretch across the flow of the other lines: what a moved trunk must not lie on.
      const others = [];
      for (const e of routed) {
        const route = layout.edges.get(e.id);
        if (own.has(e.id) || !route?.start || !route?.end) continue;
        const path = [route.start, ...(route.points ?? []), route.end];
        for (let i = 1; i < path.length; i++) if (Math.abs(track(path[i]) - track(path[i - 1])) < 0.5) others.push({ at: track(path[i]), lo: Math.min(run(path[i]), run(path[i - 1])), hi: Math.max(run(path[i]), run(path[i - 1])) });
      }
      const free = (at, t) => {
        const c = ACTOR_TRUNK.clear;
        if (borders.some((v) => Math.abs(v - at) < c)) return false;
        if (others.some((o) => Math.abs(o.at - at) < c && o.lo < t.hi + c && t.lo - c < o.hi)) return false;
        return !boxes.some((b) => (horizontal ? b.x - c < at && at < b.x + b.width + c && b.y < t.hi && t.lo < b.y + b.height : b.y - c < at && at < b.y + b.height + c && b.x < t.hi && t.lo < b.x + b.width));
      };
      const pitch = ACTOR_TRUNK.pitches.find((step) => group.every((t, i) => free(t.at + (i - (group.length - 1) / 2) * step, t)));
      if (pitch === undefined) continue;
      for (const [i, t] of group.entries()) for (const p of t.bends) setTrack(p, t.at + (i - (group.length - 1) / 2) * pitch);
    }
  }
}

/** The least distance between two line ends on one side of a use case: an open arrowhead and a hollow triangle side by side. */
const ELLIPSE_END_GAP = 15;

/**
 * Use cases that are too low for the line ends of one of their sides, with the height each
 * needs. The engine sets the ends of a side evenly over that side of the layout box; on a
 * one-line ellipse three of them stand some ten pixels apart, and a hollow triangle then
 * lies on the arrowhead beside it. A taller ellipse gives every end its own stretch of the
 * outline, and the lines stay straight. Returns the ids that grew.
 */
function growCrowdedUseCases(layout, edges, useCases, boxOf, horizontal) {
  const grown = [];
  for (const n of useCases) {
    const b = boxOf(n.id);
    const sides = { left: [], right: [], top: [], bottom: [] };
    for (const e of edges) {
      const route = layout.edges.get(e.id);
      if (!route?.start || !route?.end) continue;
      for (const [id, pt] of [[e.from, route.start], [e.to, route.end]]) {
        if (id !== n.id) continue;
        const dx = Math.min(Math.abs(pt.x - b.x), Math.abs(pt.x - b.x - b.width));
        const dy = Math.min(Math.abs(pt.y - b.y), Math.abs(pt.y - b.y - b.height));
        const side = dx <= dy ? (Math.abs(pt.x - b.x) <= Math.abs(pt.x - b.x - b.width) ? 'left' : 'right') : (Math.abs(pt.y - b.y) <= Math.abs(pt.y - b.y - b.height) ? 'top' : 'bottom');
        sides[side].push(dx <= dy ? pt.y : pt.x);
      }
    }
    // The sides across the flow are the ones lines end on; they are as long as the node is high (or wide, top-down).
    let need = 0;
    for (const side of horizontal ? ['left', 'right'] : ['top', 'bottom']) {
      const at = sides[side].sort((p, q) => p - q);
      if (at.length < 2 || at.every((v, i) => i === 0 || v - at[i - 1] >= ELLIPSE_END_GAP)) continue;
      need = Math.max(need, (at.length + 1) * ELLIPSE_END_GAP);
    }
    const size = horizontal ? 'height' : 'width';
    if (need > n[size]) { n[size] = 2 * Math.ceil(need / 2); grown.push(n.id); }
  }
  return grown;
}

/**
 * Route the generalizations between actors of one side, which stand in one layer. Between
 * neighbours the line runs straight from the special actor to the general one, along the
 * column (or the row, in a top-down diagram). When another actor stands between them it
 * leaves the special actor on the side away from the system, runs outside the column and
 * comes back to the general one; the lines to one general actor share that run. The routes
 * are written into `layout.edges` as the engine writes its own.
 */
function placeActorGeneralizations(layout, byHand, { actors, horizontal, boxOf }) {
  if (byHand.length === 0) return;
  const byId = new Map(actors.map((n) => [n.id, n]));
  const whole = new Map(actors.map((n) => [n.id, boxOf(n.id)]));
  const drawn = new Map(actors.map((n) => [n.id, drawBox(n, whole.get(n.id))]));
  // Along the column: y for actors beside the system, x for actors above or below it.
  const lo = (b) => (horizontal ? b.y : b.x);
  const hi = (b) => (horizontal ? b.y + b.height : b.x + b.width);
  const tracks = new Map();
  for (const e of byHand) {
    const child = byId.get(e.from);
    const general = byId.get(e.to);
    const [cw, gw, cd, gd] = [whole.get(e.from), whole.get(e.to), drawn.get(e.from), drawn.get(e.to)];
    const column = actors.filter((n) => n.side === child.side && n.id !== e.from && n.id !== e.to);
    const between = column.some((n) => lo(whole.get(n.id)) > Math.min(lo(cw), lo(gw)) && hi(whole.get(n.id)) < Math.max(hi(cw), hi(gw)));
    const after = lo(cw) > lo(gw); // the special actor stands below (or right of) the general one
    if (!between) {
      if (horizontal) {
        const x = cd.x + cd.width / 2;
        const gx = gd.x + gd.width / 2;
        const start = { x, y: after ? cd.y : cw.y + cw.height };
        const end = { x: gx, y: after ? gw.y + gw.height : gd.y };
        // Figures of different widths stand on one centre line; a step covers what is left.
        const mid = (start.y + end.y) / 2;
        layout.edges.set(e.id, { start, end, points: Math.abs(x - gx) < 0.5 ? [] : [{ x, y: mid }, { x: gx, y: mid }] });
      } else {
        const y = cd.y + cd.height / 2;
        const gy = gd.y + gd.height / 2;
        const start = { x: after ? cd.x : cd.x + cd.width, y };
        const end = { x: after ? gd.x + gd.width : gd.x, y: gy };
        const mid = (start.x + end.x) / 2;
        layout.edges.set(e.id, { start, end, points: Math.abs(y - gy) < 0.5 ? [] : [{ x: mid, y }, { x: mid, y: gy }] });
      }
      continue;
    }
    const outer = OPPOSITE_SIDE[child.side];
    const key = `${outer}|${e.to}`;
    if (!tracks.has(key)) tracks.set(key, [...tracks.keys()].filter((k) => k.startsWith(`${outer}|`)).length);
    const off = ACTOR_BRACKET.out + ACTOR_BRACKET.step * tracks.get(key);
    const all = [...column, child, general].map((n) => whole.get(n.id));
    if (horizontal) {
      const x = outer === 'left' ? Math.min(...all.map((b) => b.x)) - off : Math.max(...all.map((b) => b.x + b.width)) + off;
      const start = { x: outer === 'left' ? cd.x : cd.x + cd.width, y: cd.y + cd.height / 2 };
      const end = { x: outer === 'left' ? gd.x : gd.x + gd.width, y: gd.y + gd.height / 2 };
      layout.edges.set(e.id, { start, end, points: [{ x, y: start.y }, { x, y: end.y }] });
    } else {
      const y = outer === 'top' ? Math.min(...all.map((b) => b.y)) - off : Math.max(...all.map((b) => b.y + b.height)) + off;
      const start = { x: cd.x + cd.width / 2, y: outer === 'top' ? cd.y : cw.y + cw.height };
      const end = { x: gd.x + gd.width / 2, y: outer === 'top' ? gd.y : gw.y + gw.height };
      layout.edges.set(e.id, { start, end, points: [{ x: start.x, y }, { x: end.x, y }] });
    }
  }
}
