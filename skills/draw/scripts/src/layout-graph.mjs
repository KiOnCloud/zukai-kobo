import ELK from 'elkjs/lib/elk.bundled.js';
import { textWidth, widestLine, isWide, roomFor } from './text-metrics.mjs';

/**
 * Graph layout through elkjs (layered algorithm) for every kind except sequence. ELK never
 * measures text, so node and label sizes are estimated here, in one place, from the glyph
 * widths in text-metrics.mjs and a word wrap that breaks lines where a browser does.
 */

const LINE_HEIGHT = 20;
const ROW_HEIGHT = 18;

/**
 * Clear space between a node's border and its text, on the left and on the right. The size
 * heuristic counts it and the emitter draws it as label spacing, so draw.io wraps the text at
 * the width the height was measured for, and a line that fills that width still stops short
 * of the border and of the arrowheads that end on it.
 */
export const LABEL_PAD = 12;

/** Lines a text takes in a box of the given width: explicit breaks plus word wrap at the text area, `pad` px in from each side. */
export function wrappedLines(label, width, pad = LABEL_PAD) {
  return wrapText(label, Math.max(width - 2 * pad, 1)).lines;
}

/**
 * Size of a node from its label and the number of extra rows (attributes, members). The
 * width grows with the widest line up to `maxWidth`; past that the text wraps, and the
 * height grows by one line height per wrapped line, so a long label never spills over the
 * box onto its arrows. `maxWidth` is where text that can wrap does wrap, not a limit on the
 * box: a word that cannot break (a call, a qualified name, a URL) stands alone on its line
 * however long it is, so the box is as wide as the widest such word needs. The lines are
 * counted as draw.io breaks them, at the words, so a line the author broke by hand counts
 * once when it fits and the box is as tall as its text needs. `pad` is the room kept on each
 * side of the text: more than the default for a shape whose outline is narrower than its
 * box. `share` is the part of the width a shape takes from the text on each side on top of
 * that, such as the side bars of a subroutine.
 */
export function measureNode(label, { extraRows = 0, minWidth = 120, maxWidth = 260, baseHeight = 40, pad = LABEL_PAD, share = 0 } = {}) {
  const across = 1 - 2 * share;
  const boxFor = (text) => Math.ceil((roomFor(text) + 2 * pad) / across);
  const width = Math.max(Math.min(maxWidth, Math.max(minWidth, boxFor(widestLine(label)))), boxFor(widestWord(label)));
  const lines = wrapText(label, Math.max(width * across - 2 * pad, 1)).lines;
  const height = baseHeight + LINE_HEIGHT * (lines - 1) + ROW_HEIGHT * extraRows;
  return { width, height };
}

/** A space a line may break at: any white space but the no-break spaces. */
const BREAK_SPACE = /[^\S\u00a0\u202f\u2007\ufeff]/;
const EM_DASH = '\u2014';
const ZERO_WIDTH_SPACE = '\u200b';
const HYPHEN = /[-\u2010\u2013]/;
const LETTER = /\p{L}/u;
const DIGIT = /\p{N}/u;

/**
 * Whether a browser may break the line after `ch` when `next` follows it in the same word;
 * `starts` says that `ch` is the first character of the word. Chromium breaks after a hyphen
 * or an en dash before a letter, a digit or another hyphen (`acme-corp`, `0-5`, `--force`),
 * but not after a sign (`-5`), and after a `?` or an ellipsis before a letter or a digit
 * (`/find?id=1`). It breaks in a few more places, before a quote or an underscore; those
 * are left out, which can only count a line too many, never one too few.
 */
function breaksAfter(ch, next, starts) {
  if (next === undefined) return false;
  if (HYPHEN.test(ch)) return next === '-' || (LETTER.test(next) && !(starts && ch !== '-')) || (DIGIT.test(next) && !starts);
  if (ch === '?' || ch === '\u2026') return LETTER.test(next) || DIGIT.test(next);
  return false;
}

/**
 * Greedy word wrap at a width in px, as a browser does. A line breaks at a space, between
 * East Asian characters, inside a word where `breaksAfter` says so, and around an em dash;
 * it never breaks at a no-break space, at a slash, a dot or an underscore, or elsewhere
 * inside a word, so a part wider than the line stands alone on it. Explicit line breaks are kept. Returns the line count and the widest line in
 * px, and `inWord`, the number of lines that start inside a word (after a break at a hyphen
 * such as the one in `invoices-pg`); `bold` measures the text in the bold face of headers and
 * titles.
 */
export function wrapText(label, width, { bold = false } = {}) {
  const px = (text) => textWidth(text, { bold });
  const blank = px(' ');
  let lines = 0;
  let widest = 0;
  let inWord = 0;
  for (const para of String(label).split(/\r\n?|\n/)) {
    // A word or one wide character: its width, whether a space precedes it, and whether it is
    // the rest of a word that a break inside it ended.
    const tokens = [];
    let word = '';
    let space = false;
    let joined = false;
    const flush = (inside = false) => {
      if (word === '') return;
      tokens.push({ px: px(word), space, joined });
      word = '';
      space = false;
      joined = inside;
    };
    const chars = [...para];
    chars.forEach((ch, i) => {
      if (BREAK_SPACE.test(ch)) { flush(); space = true; joined = false; }
      else if (isWide(ch) || ch === EM_DASH) { flush(); tokens.push({ px: px(ch), space, joined: false }); space = false; joined = false; }
      else {
        const starts = word === '';
        word += ch;
        if (ch === ZERO_WIDTH_SPACE || breaksAfter(ch, chars[i + 1], starts)) flush(true);
      }
    });
    flush();
    let line = 0;
    for (const t of tokens) {
      const gap = line > 0 && t.space ? blank : 0;
      if (line > 0 && line + gap + t.px > width) { widest = Math.max(widest, line); lines++; line = t.px; if (t.joined) inWord++; }
      else line += gap + t.px;
    }
    widest = Math.max(widest, line);
    lines++;
  }
  return { lines, widest, inWord };
}

/**
 * Width in px of the widest part of a text that cannot break: the least a box that wraps the
 * text must hold on one line. A browser breaks between East Asian characters, so a run of
 * them counts as one character wide.
 */
export const widestWord = (label, options) => wrapText(label, 1, options).widest;

const DECISION_MIN_WIDTH = 140;
const DECISION_MIN_HEIGHT = 80;
/** A decision wider than this wraps its question onto one more line before the rhombus grows further. */
const DECISION_MAX_WIDTH = 340;
/** A question is not wrapped narrower than this, in px, however long: the rhombus grows instead. */
const DECISION_MIN_WRAP = 100;
/** One line of draw.io's 12 px font. */
const TEXT_LINE = 15;

/**
 * The smallest rhombus that holds a text block of `a` by `b` px, at least the decision
 * minimum: a block fits when a/w + b/h <= 1, its corners on the slanted edges when equal.
 * The candidates are twice the block, the minimum height with the width that then fits,
 * and the minimum width with the height that then fits; the smallest area wins.
 */
function rhombusFor(a, b) {
  const even = (n) => Math.ceil(n / 2) * 2;
  const options = [{ width: Math.max(DECISION_MIN_WIDTH, even(2 * a)), height: Math.max(DECISION_MIN_HEIGHT, even(2 * b)) }];
  if (b < DECISION_MIN_HEIGHT) options.push({ width: Math.max(DECISION_MIN_WIDTH, even(a / (1 - b / DECISION_MIN_HEIGHT))), height: DECISION_MIN_HEIGHT });
  if (a < DECISION_MIN_WIDTH) options.push({ width: DECISION_MIN_WIDTH, height: Math.max(DECISION_MIN_HEIGHT, even(b / (1 - a / DECISION_MIN_WIDTH))) });
  return options.sort((p, q) => p.width * p.height - q.width * q.height || p.height - q.height)[0];
}

/**
 * The question wrapped into at most `lines` lines with the smallest widest line any such wrap
 * can have: the narrowest width (never above `upper`) at which the greedy wrap still takes
 * no more lines, found by bisection since the line count only falls as the width grows. The
 * lines come out balanced, so no line is a nearly full one followed by a short remainder.
 *
 * Balance alone can pick a break at a hyphen inside a word (`Cloud SQL invoices-` over
 * `pg (PostgreSQL 16)`), which splits a name the reader reads as one. When it does, the
 * narrowest width up to `upper` that takes as many lines and breaks only at spaces is taken
 * instead, even though its lines are less even; a text that cannot be wrapped so keeps the
 * balanced block. `slack` is what the renderer's wrap width adds to the widest line, so the
 * block is held to break at spaces at that width too.
 */
function balancedBlock(label, lines, upper, slack = 0) {
  let lo = 1;
  let hi = upper;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (wrapText(label, mid).lines <= lines) hi = mid;
    else lo = mid + 1;
  }
  const atSpaces = (b) => b.inWord === 0 && (slack === 0 || wrapText(label, Math.ceil(b.widest) + slack).inWord === 0);
  const block = wrapText(label, lo);
  if (atSpaces(block)) return block;
  for (let width = lo + 1; width <= upper; width++) {
    const wider = wrapText(label, width);
    if (wider.lines < block.lines) break;
    if (atSpaces(wider)) return wider;
  }
  return block;
}

/**
 * Size of a decision rhombus and the label spacing that keeps its question inside the
 * slanted edges. draw.io wraps a label at the box's width, but the rhombus is narrower than
 * its box everywhere but the centre line, so a long question wrapped to the box spills out
 * on both sides. The question takes the line count draw.io gives it in the plain box of
 * `measureNode`, wrapped at the narrowest width that still holds that count so the lines are
 * balanced; when the rhombus that holds that block would be wider than DECISION_MAX_WIDTH,
 * the question takes one more line, and so on until the rhombus fits the cap or a line
 * would be narrower than DECISION_MIN_WRAP (then the narrowest rhombus found stands). A
 * question on several lines gets `spacingLeft` and `spacingRight` so draw.io wraps it at
 * the block's width instead of the box's.
 *
 * Balanced lines matter because a line that is nearly full breaks at the last opportunity
 * before its end, which can be a hyphen inside a value such as `0-5`, leaving an orphan on
 * the next line. With both lines about half the text, the break falls at a space near the
 * middle. The block gets the room of `roomFor` on top of its widest line, so a renderer
 * that draws the text a little wider still fits each line.
 * @returns {{width:number, height:number, spacing:number}} spacing in px per side, 0 for none
 */
export function measureDecision(label) {
  const base = measureNode(label, { minWidth: DECISION_MIN_WIDTH, baseHeight: DECISION_MIN_HEIGHT });
  const natural = base.width - 4; // draw.io's default 2 px spacing on each side
  const most = wrapText(label, 1).lines;
  let pick;
  for (let lines = wrapText(label, natural).lines; lines <= most; lines++) {
    const block = balancedBlock(label, lines, natural);
    if (pick && block.widest < DECISION_MIN_WRAP) break;
    const room = roomFor(block.widest);
    const box = rhombusFor(room, block.lines * TEXT_LINE);
    if (!pick || box.width < pick.box.width) pick = { block, box, room };
    if (box.width <= DECISION_MAX_WIDTH) break;
  }
  const { block, box, room } = pick;
  const spacing = block.lines > 1 ? Math.max(0, Math.floor((box.width - room) / 2) - 2) : 0;
  return { width: box.width, height: box.height, spacing };
}

/**
 * Room for a label that draw.io draws below its shape (`verticalLabelPosition=bottom`), such
 * as the name under an actor figure. Such a label does not wrap at the shape, so it is given
 * a wrap width of its own (the `labelWidth` style) of at most `maxWidth`, narrowed to the
 * widest line of a balanced wrap; a word wider than that stands alone and sets the width.
 * The wrap width keeps 8 px of slack on top of the widest line, 5 % of the cap, so draw.io
 * rarely needs more lines than counted.
 * @returns {{width:number, height:number, wrap:number}} the block below the shape and the
 *   width its text wraps at, in px
 */
export function measureLabelBelow(label, { maxWidth = 160 } = {}) {
  const block = balancedBlock(label, wrapText(label, maxWidth).lines, maxWidth, 8);
  const wrap = Math.ceil(block.widest) + 8;
  return { width: wrap, height: block.lines * TEXT_LINE + 6, wrap };
}

const ELLIPSE_MIN_WIDTH = 120;
const ELLIPSE_MIN_HEIGHT = 50;
/** Text of an ellipse wraps at this width, in px, before the ellipse grows further. */
const ELLIPSE_WRAP = 150;
/** Room between the text block and the outline at the block's corners, in px. */
const ELLIPSE_PAD = 4;

/**
 * Size of an ellipse and the label spacing that keeps its text inside the outline. draw.io
 * wraps a label at the width of the box, but an ellipse is narrower than its box everywhere
 * but the centre line, so the text is wrapped as a balanced block (as for a decision) and the
 * ellipse is the smallest one that holds that block: a block of `a` by `b` px fits when
 * (a/w)^2 + (b/h)^2 <= 1. The height is the block's times the square root of two, at least
 * the minimum, and the width follows from it. A word that cannot break is one line of the
 * block however long it is, so the ellipse grows with it and the word never leaves the shape.
 * @returns {{width:number, height:number, spacing:number}} spacing in px per side
 */
export function measureEllipse(label) {
  const even = (n) => Math.ceil(n / 2) * 2;
  const block = balancedBlock(label, wrapText(label, ELLIPSE_WRAP).lines, Math.max(ELLIPSE_WRAP, Math.ceil(widestWord(label))));
  const a = roomFor(block.widest) + 2 * ELLIPSE_PAD;
  const b = block.lines * TEXT_LINE + 2 * ELLIPSE_PAD;
  const height = Math.max(ELLIPSE_MIN_HEIGHT, even(b * Math.SQRT2));
  const width = Math.max(ELLIPSE_MIN_WIDTH, even(a / Math.sqrt(1 - (b / height) ** 2)));
  // draw.io keeps 2 px of its own on each side; the rest makes it wrap at the block's width.
  const spacing = Math.max(0, Math.floor((width - roomFor(block.widest)) / 2) - 2);
  return { width, height, spacing };
}

function measureLabel(text) {
  const lines = String(text).split(/\r\n?|\n/);
  return { width: Math.ceil(widestLine(text)) + 8, height: 16 * lines.length };
}

/**
 * The edges that lead back to an earlier step of a loop: among the nodes of one cycle (a
 * strongly connected component), every edge that runs from a node to one given before it.
 * The order the nodes are given in is the order the author reads them in, so laying exactly
 * these edges out against the flow puts the steps of a loop below (or after) one another in
 * that order, with the return line beside them. Left to itself the layout breaks a cycle at
 * an edge of its own choosing, which can turn a loop upside down. What remains is acyclic,
 * since inside a cycle every other edge runs forward in the given order; edges outside any
 * cycle are never touched, and neither are self-loops.
 * @param {Array<{id:string}>} nodes
 * @param {Array<{id:string,from:string,to:string}>} edges
 * @returns {Set<string>} ids of the edges that lead back
 */
export function backEdges(nodes, edges) {
  const order = new Map(nodes.map((n, i) => [n.id, i]));
  const component = cycleOf(nodes, edges);
  const back = new Set();
  for (const e of edges) {
    if (e.from === e.to || !order.has(e.from) || !order.has(e.to)) continue;
    if (component.get(e.from) === component.get(e.to) && order.get(e.to) < order.get(e.from)) back.add(e.id);
  }
  return back;
}

/**
 * The edges that close a circle, in the order the edges are given: an edge whose target
 * already leads to its source over the edges before it. The author lists the connections of
 * a system in the order of the flow, so the connection that comes back (a topic that pushes
 * to the service that publishes to it) is listed after the way out, and it is the one to lay
 * out against the flow. Left to itself the layout breaks a circle at an edge of its own
 * choosing, which can turn the main flow against the direction of the diagram. What remains
 * without these edges is acyclic. Self-loops are never touched.
 * @param {Array<{id:string,from:string,to:string}>} edges
 * @returns {Set<string>} ids of the edges that close a circle
 */
export function closingEdges(edges) {
  const out = new Map();
  const reaches = (from, to) => {
    const seen = new Set([from]);
    const queue = [from];
    while (queue.length > 0) {
      const at = queue.shift();
      if (at === to) return true;
      for (const next of out.get(at) ?? []) if (!seen.has(next)) { seen.add(next); queue.push(next); }
    }
    return false;
  };
  const closing = new Set();
  for (const e of edges) {
    if (e.from === e.to) continue;
    if (reaches(e.to, e.from)) { closing.add(e.id); continue; }
    if (!out.has(e.from)) out.set(e.from, []);
    out.get(e.from).push(e.to);
  }
  return closing;
}

/**
 * The cycle each node lies on: a map from node id to the id of one node that stands for its
 * strongly connected component. Two nodes share a value exactly when each can be reached
 * from the other; a node on no cycle has a value of its own.
 * @param {Array<{id:string}>} nodes
 * @param {Array<{id:string,from:string,to:string}>} edges
 * @returns {Map<string,string>}
 */
export function cycleOf(nodes, edges) {
  const order = new Map(nodes.map((n, i) => [n.id, i]));
  const out = new Map(nodes.map((n) => [n.id, []]));
  for (const e of edges) if (e.from !== e.to && order.has(e.to)) out.get(e.from)?.push(e.to);
  // Tarjan's strongly connected components, iterative so a long chain cannot overflow the stack.
  const index = new Map();
  const low = new Map();
  const component = new Map();
  const open = [];
  const onStack = new Set();
  let counter = 0;
  for (const root of nodes) {
    if (index.has(root.id)) continue;
    const work = [{ id: root.id, next: 0 }];
    index.set(root.id, counter); low.set(root.id, counter++); open.push(root.id); onStack.add(root.id);
    while (work.length > 0) {
      const top = work.at(-1);
      const to = out.get(top.id)[top.next++];
      if (to === undefined) {
        work.pop();
        if (work.length > 0) low.set(work.at(-1).id, Math.min(low.get(work.at(-1).id), low.get(top.id)));
        if (low.get(top.id) === index.get(top.id)) {
          let member;
          do { member = open.pop(); onStack.delete(member); component.set(member, top.id); } while (member !== top.id);
        }
      } else if (!index.has(to)) {
        index.set(to, counter); low.set(to, counter++); open.push(to); onStack.add(to);
        work.push({ id: to, next: 0 });
      } else if (onStack.has(to)) {
        low.set(top.id, Math.min(low.get(top.id), index.get(to)));
      }
    }
  }
  return component;
}

const ELK_DIRECTION = { TB: 'DOWN', BT: 'UP', LR: 'RIGHT', RL: 'LEFT' };

let elkInstance;
const elk = () => (elkInstance ??= new ELK());

/**
 * @param {object} input
 * @param {Array<{id:string,width:number,height:number,parent?:string}>} input.nodes
 * @param {Array<{id:string,parent?:string,headerHeight?:number,minWidth?:number,inset?:number}>} input.containers
 *   `minWidth` keeps a container at least that wide, for a title that must fit on one line;
 *   `inset` is the room between a container's sides and its members (20 px when not given)
 * @param {Array<{id:string,from:string,to:string,label?:string,layoutReversed?:boolean,labelPlacedByCaller?:boolean}>} input.edges
 *   `layoutReversed` places the ends of an edge in the opposite order along the flow; the
 *   returned route still runs from `from` to `to`
 * @param {string} [input.direction]
 * @param {Record<string,string>} [input.options] further ELK options for the whole graph
 * @param {{nodeNode?:number, layer?:number, edgeEdge?:number, selfLoop?:number}} [input.spacing]
 * @param {boolean} [input.balanceContainers] place the members of every container with the
 *   strategy of the page itself, which puts a node level with the middle of what it connects to
 * @returns {Promise<{ nodes: Map<string,{x,y,width,height}>, containers: Map<string,{x,y,width,height}>, edges: Map<string,{points:Array<{x,y}>}> }>}
 *   Node and container coordinates are relative to their parent (draw.io convention);
 *   edge bend points are absolute (edge cells sit on the root layer).
 */
/** The side of a loop head that an edge leading back arrives on: across the flow. */
const BACK_SIDE = { TB: 'EAST', BT: 'EAST', LR: 'SOUTH', RL: 'SOUTH' };

export async function layoutGraph({ nodes, containers = [], edges, direction = 'TB', spacing = {}, options = {}, balanceContainers = false }) {
  const nodeSpacing = spacing.nodeNode ?? 40;
  const layerSpacing = spacing.layer ?? 60;
  const byParent = new Map();
  const add = (parent, child) => {
    if (!byParent.has(parent)) byParent.set(parent, []);
    byParent.get(parent).push(child);
  };
  for (const c of containers) add(c.parent ?? null, { ...c, isContainer: true });
  for (const n of nodes) add(n.parent ?? null, { ...n, isContainer: false });

  // ELK routes a self-loop itself, on a side that is across the flow; `selfLoop` is how far
  // it stands off its node, for the directions whose loops are drawn on that route.
  const selfLoop = spacing.selfLoop ? { 'elk.spacing.nodeSelfLoop': String(spacing.selfLoop) } : {};
  // The layered algorithm lays a top-to-bottom graph out sideways and turns the result, and it
  // reads a container's minimum size before the turn: the width goes in as the second value.
  const vertical = direction === 'TB' || direction === 'BT';
  // ELK reads the spacings from the graph a node lies in and a container does not inherit
  // them: without them a line inside a frame turns ELK's default 10 px before its arrowhead
  // where a line outside turns 25 px before it, so every container repeats them.
  const spacingOptions = {
    'elk.spacing.nodeNode': String(nodeSpacing),
    'elk.layered.spacing.nodeNodeBetweenLayers': String(layerSpacing),
    'elk.spacing.edgeNode': '25',
    'elk.layered.spacing.edgeNodeBetweenLayers': '25',
    'elk.spacing.edgeEdge': String(spacing.edgeEdge ?? 20),
    'elk.layered.spacing.edgeEdgeBetweenLayers': String(spacing.edgeEdge ?? 20),
  };
  // ELK does not hand the placement strategy down to a container either. Left to its default
  // a container lines a node up with one of its neighbours, so a node that fans out to many
  // stands level with the first or the last of them; network simplex, which the page uses,
  // puts it level with the middle of them, at the price of a little more room.
  const placement = balanceContainers ? { 'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX' } : {};
  // Ports for the edges that lead back, per loop head (`backSide` on the edge asks for them).
  const backPorts = new Map();
  for (const e of edges) {
    if (!e.layoutReversed || !e.backSide || e.toPort || e.from === e.to) continue;
    if (!backPorts.has(e.to)) backPorts.set(e.to, []);
    backPorts.get(e.to).push(`${e.to}:back:${e.id}`);
  }
  const backPortOf = (e) => (e.layoutReversed && e.backSide && !e.toPort && e.from !== e.to ? `${e.to}:back:${e.id}` : undefined);
  const build = (parent) => (byParent.get(parent) ?? []).map((el) => {
    if (!el.isContainer) {
      // Fixed ports pin where edges meet the node (ER rows); ELK routes from those points.
      if (el.ports?.length) {
        return { id: el.id, width: el.width, height: el.height, layoutOptions: { 'elk.portConstraints': 'FIXED_POS', ...el.layoutOptions }, ports: el.ports.map((p) => ({ id: p.id, x: p.x, y: p.y, width: 1, height: 1 })) };
      }
      // A loop head: the edges that lead back to it arrive on a side across the flow, so the
      // side along the flow stays with the edge that goes on and the main line runs straight.
      const back = backPorts.get(el.id);
      if (back) return { id: el.id, width: el.width, height: el.height, layoutOptions: { 'elk.portConstraints': 'FIXED_SIDE' }, ports: back.map((id) => ({ id, width: 1, height: 1, layoutOptions: { 'elk.port.side': BACK_SIDE[direction] ?? 'EAST' } })) };
      return { id: el.id, width: el.width, height: el.height, ...(el.layoutOptions ? { layoutOptions: el.layoutOptions } : {}) };
    }
    const header = el.headerHeight ?? 30;
    return {
      id: el.id,
      // ELK reads the self-loop distance from the graph a node lies in, so a container repeats it.
      layoutOptions: { ...spacingOptions, ...placement, 'elk.padding': `[top=${header + (el.inset ?? 20)},left=${el.inset ?? 20},bottom=${el.inset ?? 20},right=${el.inset ?? 20}]`, ...selfLoop, ...(el.minWidth ? { 'elk.nodeSize.constraints': 'MINIMUM_SIZE', 'elk.nodeSize.minimum': vertical ? `(0,${el.minWidth})` : `(${el.minWidth},0)` } : {}) },
      children: build(el.id),
    };
  });

  const graph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': ELK_DIRECTION[direction] ?? 'DOWN',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.json.edgeCoords': 'ROOT',
      ...spacingOptions,
      'elk.spacing.edgeLabel': '6',
      'elk.spacing.portPort': '20',
      ...selfLoop,
      'elk.edgeLabels.placement': 'CENTER',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      ...options,
    },
    children: build(null),
    edges: edges.map((e) => ({
      id: e.id,
      // An edge laid out against its direction: the layout sees it run from `to` to `from`,
      // which puts the two ends in the opposite order along the flow; the route is turned back below.
      sources: [e.layoutReversed ? (backPortOf(e) ?? e.toPort ?? e.to) : (e.fromPort ?? e.from)],
      targets: [e.layoutReversed ? (e.fromPort ?? e.from) : (e.toPort ?? e.to)],
      // A label the caller places itself takes no room in the layout.
      labels: e.label && !e.labelPlacedByCaller ? [{ text: e.label, ...measureLabel(e.label) }] : [],
    })),
  };

  const laid = await elk().layout(graph);
  const nodeOut = new Map();
  const containerOut = new Map();
  const walk = (children) => {
    for (const c of children ?? []) {
      const box = { x: c.x ?? 0, y: c.y ?? 0, width: c.width, height: c.height };
      if (c.children) {
        containerOut.set(c.id, box);
        walk(c.children);
      } else {
        nodeOut.set(c.id, box);
      }
    }
  };
  walk(laid.children);
  const edgeOut = new Map();
  const reversedIds = new Set(edges.filter((e) => e.layoutReversed).map((e) => e.id));
  for (const e of laid.edges ?? []) {
    const points = [];
    for (const s of e.sections ?? []) for (const p of s.bendPoints ?? []) points.push({ x: p.x, y: p.y });
    const first = e.sections?.[0];
    const last = e.sections?.at(-1);
    const lbl = e.labels?.[0];
    const start = first?.startPoint ? { x: first.startPoint.x, y: first.startPoint.y } : undefined;
    const end = last?.endPoint ? { x: last.endPoint.x, y: last.endPoint.y } : undefined;
    const reversed = reversedIds.has(e.id);
    edgeOut.set(e.id, {
      points: reversed ? points.reverse() : points,
      start: reversed ? end : start,
      end: reversed ? start : end,
      // ELK's label box, absolute; the emitter turns it into draw.io's relative label geometry.
      label: lbl && lbl.x !== undefined ? { x: lbl.x, y: lbl.y, width: lbl.width, height: lbl.height } : undefined,
    });
  }
  return { nodes: nodeOut, containers: containerOut, edges: edgeOut };
}
