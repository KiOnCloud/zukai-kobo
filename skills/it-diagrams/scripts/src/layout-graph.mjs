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

/** Lines a text takes in a box of the given width: explicit breaks plus word wrap at the text area. */
export function wrappedLines(label, width) {
  const usable = Math.max(width - 24, CHAR_WIDTH);
  return String(label).split(/\r\n?|\n/).reduce((n, line) => n + Math.max(1, Math.ceil((CHAR_WIDTH * displayLength(line)) / usable)), 0);
}

/**
 * Size of a node from its label and the number of extra rows (attributes, members). The
 * width grows with the longest line up to `maxWidth`; past that the text wraps, and the
 * height grows by one line height per wrapped line, so a long label never spills over the
 * box onto its arrows.
 */
export function measureNode(label, { extraRows = 0, minWidth = 120, maxWidth = 260, baseHeight = 40 } = {}) {
  const longest = longestLine(label);
  const width = Math.min(maxWidth, Math.max(minWidth, Math.ceil(CHAR_WIDTH * longest) + 24));
  const height = baseHeight + LINE_HEIGHT * (wrappedLines(label, width) - 1) + ROW_HEIGHT * extraRows;
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
/** A decision wider than this wraps its question narrower before the rhombus grows further. */
const DECISION_MAX_WIDTH = 340;
/** Wrap widths tried in turn, in px, when the question is too long for one or two full lines. */
const DECISION_WRAP_STEPS = [220, 190, 160, 130, 100];
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
 * Size of a decision rhombus and the label spacing that keeps its question inside the
 * slanted edges. draw.io wraps a label at the box's width, but the rhombus is narrower than
 * its box everywhere but the centre line, so a long question wrapped to the box spills out
 * on both sides. The question is first wrapped as draw.io wraps it in the plain box of
 * `measureNode`; when the rhombus that holds that block would be wider than
 * DECISION_MAX_WIDTH, it is wrapped narrower, step by step, until the rhombus fits the cap
 * (else the narrowest step stands). A question on several lines gets `spacingLeft` and
 * `spacingRight` so draw.io wraps it at the block's width instead of the box's.
 * @returns {{width:number, height:number, spacing:number}} spacing in px per side, 0 for none
 */
export function measureDecision(label) {
  const base = measureNode(label, { minWidth: DECISION_MIN_WIDTH, baseHeight: DECISION_MIN_HEIGHT });
  const natural = base.width - 4; // draw.io's default 2 px spacing on each side
  let pick;
  for (const wrapAt of [natural, ...DECISION_WRAP_STEPS.filter((w) => w < natural)]) {
    const block = wrapText(label, wrapAt);
    const box = rhombusFor(block.widest, block.lines * TEXT_LINE);
    if (!pick || box.width < pick.box.width) pick = { block, box };
    if (box.width <= DECISION_MAX_WIDTH) break;
  }
  const { block, box } = pick;
  const spacing = block.lines > 1 ? Math.max(0, Math.floor((box.width - block.widest) / 2) - 2) : 0;
  return { width: box.width, height: box.height, spacing };
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
      layoutOptions: { 'elk.padding': `[top=${header + 20},left=20,bottom=20,right=20]` },
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
