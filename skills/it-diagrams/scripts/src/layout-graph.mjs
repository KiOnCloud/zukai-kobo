import ELK from 'elkjs/lib/elk.bundled.js';
import { longestLine, displayLength } from './text-metrics.mjs';

/**
 * Graph layout through elkjs (layered algorithm) for every kind except sequence. ELK never
 * measures text, so node and label sizes are estimated here, in one place, with a
 * character-width heuristic.
 */

const CHAR_WIDTH = 7;
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
  const usable = Math.max(width - 2 * pad, CHAR_WIDTH);
  return String(label).split(/\r\n?|\n/).reduce((n, line) => n + Math.max(1, Math.ceil((CHAR_WIDTH * displayLength(line)) / usable)), 0);
}

/**
 * Size of a node from its label and the number of extra rows (attributes, members). The
 * width grows with the longest line up to `maxWidth`; past that the text wraps, and the
 * height grows by one line height per wrapped line, so a long label never spills over the
 * box onto its arrows. `pad` is the room kept on each side of the text: more than the
 * default for a shape whose outline is narrower than its box.
 */
export function measureNode(label, { extraRows = 0, minWidth = 120, maxWidth = 260, baseHeight = 40, pad = LABEL_PAD } = {}) {
  const longest = longestLine(label);
  const width = Math.min(maxWidth, Math.max(minWidth, Math.ceil(CHAR_WIDTH * longest) + 2 * pad));
  const height = baseHeight + LINE_HEIGHT * (wrappedLines(label, width, pad) - 1) + ROW_HEIGHT * extraRows;
  return { width, height };
}

/**
 * Greedy word wrap at a width in px, as a browser does: lines break at spaces and between
 * East Asian characters, never inside a word, so a word wider than the line stands alone;
 * explicit line breaks are kept. Returns the line count and the widest line in px.
 */
export function wrapText(label, width) {
  let lines = 0;
  let widest = 0;
  for (const para of String(label).split(/\r\n?|\n/)) {
    const tokens = []; // a word or one wide character: its width, and whether a space precedes it
    let word = '';
    let space = false;
    const flush = () => {
      if (word === '') return;
      tokens.push({ px: CHAR_WIDTH * displayLength(word), space });
      word = '';
      space = false;
    };
    for (const ch of para) {
      if (/\s/.test(ch)) { flush(); space = true; }
      else if (displayLength(ch) > 1) { flush(); tokens.push({ px: CHAR_WIDTH * displayLength(ch), space }); space = false; }
      else word += ch;
    }
    flush();
    let line = 0;
    for (const t of tokens) {
      const gap = line > 0 && t.space ? CHAR_WIDTH : 0;
      if (line > 0 && line + gap + t.px > width) { widest = Math.max(widest, line); lines++; line = t.px; }
      else line += gap + t.px;
    }
    widest = Math.max(widest, line);
    lines++;
  }
  return { lines, widest };
}

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
 */
function balancedBlock(label, lines, upper) {
  let lo = 1;
  let hi = upper;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (wrapText(label, mid).lines <= lines) hi = mid;
    else lo = mid + 1;
  }
  return wrapText(label, lo);
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
 * Balanced lines matter because the width heuristic is generous (7 px a character against
 * about 5.6 px rendered): at a wrap width that leaves one line nearly full, draw.io fits a
 * little more on it and breaks at the last opportunity it finds, which can be a hyphen
 * inside a value such as `0-5`, leaving an orphan on the next line. With both lines about
 * half the text, the slack is far too small to move a whole line.
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
    const box = rhombusFor(block.widest, block.lines * TEXT_LINE);
    if (!pick || box.width < pick.box.width) pick = { block, box };
    if (box.width <= DECISION_MAX_WIDTH) break;
  }
  const { block, box } = pick;
  const spacing = block.lines > 1 ? Math.max(0, Math.floor((box.width - block.widest) / 2) - 2) : 0;
  return { width: box.width, height: box.height, spacing };
}

/**
 * Room for a label that draw.io draws below its shape (`verticalLabelPosition=bottom`), such
 * as the name under an actor figure. Such a label does not wrap at the shape, so it is given
 * a wrap width of its own (the `labelWidth` style) of at most `maxWidth`, narrowed to the
 * widest line of a balanced wrap; a word wider than that stands alone and sets the width.
 * The estimate is generous for mixed-case text (7 px a character against about 5.6 px
 * rendered), and the wrap width keeps 8 px of slack on top, so draw.io rarely needs more
 * lines than counted; a name in capitals or wide glyphs can still take one more.
 * @returns {{width:number, height:number, wrap:number}} the block below the shape and the
 *   width its text wraps at, in px
 */
export function measureLabelBelow(label, { maxWidth = 160 } = {}) {
  const block = balancedBlock(label, wrapText(label, maxWidth).lines, maxWidth);
  const wrap = Math.ceil(block.widest) + 8;
  return { width: wrap, height: block.lines * TEXT_LINE + 6, wrap };
}

export function measureLabel(text) {
  const lines = String(text).split(/\r\n?|\n/);
  const longest = longestLine(text);
  return { width: Math.ceil(CHAR_WIDTH * longest) + 8, height: 16 * lines.length };
}

const ELK_DIRECTION = { TB: 'DOWN', BT: 'UP', LR: 'RIGHT', RL: 'LEFT' };

let elkInstance;
const elk = () => (elkInstance ??= new ELK());

/**
 * @param {object} input
 * @param {Array<{id:string,width:number,height:number,parent?:string}>} input.nodes
 * @param {Array<{id:string,parent?:string,headerHeight?:number}>} input.containers
 * @param {Array<{id:string,from:string,to:string,label?:string}>} input.edges
 * @param {string} [input.direction]
 * @param {{nodeNode?:number, layer?:number, edgeEdge?:number, selfLoop?:number}} [input.spacing]
 * @returns {Promise<{ nodes: Map<string,{x,y,width,height}>, containers: Map<string,{x,y,width,height}>, edges: Map<string,{points:Array<{x,y}>}> }>}
 *   Node and container coordinates are relative to their parent (draw.io convention);
 *   edge bend points are absolute (edge cells sit on the root layer).
 */
export async function layoutGraph({ nodes, containers = [], edges, direction = 'TB', spacing = {} }) {
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
  const build = (parent) => (byParent.get(parent) ?? []).map((el) => {
    if (!el.isContainer) {
      // Fixed ports pin where edges meet the node (ER rows); ELK routes from those points.
      if (el.ports?.length) {
        return { id: el.id, width: el.width, height: el.height, layoutOptions: { 'elk.portConstraints': 'FIXED_POS' }, ports: el.ports.map((p) => ({ id: p.id, x: p.x, y: p.y, width: 1, height: 1 })) };
      }
      return { id: el.id, width: el.width, height: el.height };
    }
    const header = el.headerHeight ?? 30;
    return {
      id: el.id,
      // ELK reads the self-loop distance from the graph a node lies in, so a container repeats it.
      layoutOptions: { 'elk.padding': `[top=${header + 20},left=20,bottom=20,right=20]`, ...selfLoop },
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
      'elk.spacing.nodeNode': String(nodeSpacing),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(layerSpacing),
      'elk.spacing.edgeNode': '25',
      'elk.layered.spacing.edgeNodeBetweenLayers': '25',
      'elk.spacing.edgeEdge': String(spacing.edgeEdge ?? 20),
      'elk.layered.spacing.edgeEdgeBetweenLayers': String(spacing.edgeEdge ?? 20),
      'elk.spacing.edgeLabel': '6',
      'elk.spacing.portPort': '20',
      ...selfLoop,
      'elk.edgeLabels.placement': 'CENTER',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
    },
    children: build(null),
    edges: edges.map((e) => ({
      id: e.id,
      sources: [e.fromPort ?? e.from],
      targets: [e.toPort ?? e.to],
      labels: e.label ? [{ text: e.label, ...measureLabel(e.label) }] : [],
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
  for (const e of laid.edges ?? []) {
    const points = [];
    for (const s of e.sections ?? []) for (const p of s.bendPoints ?? []) points.push({ x: p.x, y: p.y });
    const first = e.sections?.[0];
    const last = e.sections?.at(-1);
    const lbl = e.labels?.[0];
    edgeOut.set(e.id, {
      points,
      start: first?.startPoint ? { x: first.startPoint.x, y: first.startPoint.y } : undefined,
      end: last?.endPoint ? { x: last.endPoint.x, y: last.endPoint.y } : undefined,
      // ELK's label box, absolute; the emitter turns it into draw.io's relative label geometry.
      label: lbl && lbl.x !== undefined ? { x: lbl.x, y: lbl.y, width: lbl.width, height: lbl.height } : undefined,
    });
  }
  return { nodes: nodeOut, containers: containerOut, edges: edgeOut };
}
