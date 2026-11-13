import { figjamLabel } from './mermaid-text.mjs';
import { layoutSequence } from './layout-sequence.mjs';

/**
 * What Figma's generate_diagram leaves out of a sequence diagram, as a script for the Figma
 * MCP tool `use_figma` to draw on top of the generated board: the frames of loop, alt, opt
 * and par blocks with their conditions, a message a participant sends to itself, notes, the
 * kind of a participant (a figure above an actor, a stereotype line for the others) and the
 * activation bars, each as the draw.io file shows it.
 *
 * Figma reserves a row for a self-message but draws only a stray arrow outside the section,
 * and drops the block keywords and Note statements. The figjam text therefore writes a note
 * as a self-message too, so that it gets a row of its own (several for a long note), and one
 * more such row for the label of a block inside another block; this script removes
 * the stray arrows and draws the real thing into each reserved row.
 *
 * The script checks what it finds (participants, messages and row pitch) against the model
 * and throws before it changes anything when the board is not the one this text made.
 */

/** Lifelines stand this far apart on a board Figma generates; a row is this high. */
const LIFELINE_PITCH = 280;
const ROW_PITCH = 80;

/** Width of the box the overlay draws for a note, as the script computes it on the board. */
function noteWidth(ir, n) {
  if (n.participants.length < 2) return 200;
  const at = n.participants.map((p) => ir.participants.findIndex((x) => x.id === p));
  return Math.abs(at[1] - at[0]) * LIFELINE_PITCH + 120;
}

/** Rows a note needs so that its whole text fits: one, or more for a long text. */
export function noteRows(ir, n) {
  // A box keeps about 28 px free on either side of its text; a character of the 14 px face is 7.6 px wide on average.
  const perLine = Math.floor((noteWidth(ir, n) - 56) / 7.6);
  const lines = Math.max(1, Math.ceil(figjamLabel(n.label).label.length / perLine));
  return Math.max(1, Math.ceil((21 * lines + 36) / ROW_PITCH));
}

/** Blocks with the range of their messages and how many blocks enclose each. */
function blocksOf(ir) {
  const order = new Map(ir.messages.map((m, i) => [m.id, i]));
  const blocks = (ir.blocks ?? []).map((b, index) => {
    const sections = [{ label: b.label, ids: b.messages }, ...(b.branches ?? []).map((br) => ({ label: br.label, ids: br.messages }))].map((s) => {
      const idx = s.ids.map((id) => order.get(id));
      return { label: s.label, first: Math.min(...idx), last: Math.max(...idx) };
    });
    return { id: b.id, kind: b.kind, index, sections, first: sections[0].first, last: sections[sections.length - 1].last };
  });
  const span = (x) => x.last - x.first;
  // Of two blocks with the same range the earlier is the outer one, as in the text.
  for (const b of blocks) b.depth = blocks.filter((o) => o !== b && o.first <= b.first && o.last >= b.last && (span(o) > span(b) || (span(o) === span(b) && o.index < b.index))).length;
  return blocks;
}

/**
 * From this depth on a block gets a row of its own for its label. Only the label of an
 * outermost block fits above the first message without lying on the frame of a nested one.
 */
const HEADER_ROW_DEPTH = 1;

/** How many label rows of deeply nested blocks stand before each message, by message index. */
export function labelRowsBefore(ir) {
  const blocks = blocksOf(ir);
  return ir.messages.map((_, i) => blocks.filter((x) => x.first === i && x.depth >= HEADER_ROW_DEPTH).length);
}

/**
 * The rows of a sequence diagram in the order the figjam text writes them. Besides one row
 * per message and per note there are empty rows: the further rows of a long note, and a row
 * for the label of a block inside another block. `emitSequence` of emit-mermaid.mjs
 * writes the same rows with `noteRows` and `labelRowsBefore`; a test holds the two together.
 * @returns {Array<{ type: 'message' | 'note', index: number } | { type: 'pad', of: 'note' | 'block', index: number }>}
 */
export function sequenceRows(ir) {
  const notes = ir.notes ?? [];
  const blocks = blocksOf(ir);
  const rows = [];
  const note = (ni) => {
    rows.push({ type: 'note', index: ni });
    for (let k = 1; k < noteRows(ir, notes[ni]); k++) rows.push({ type: 'pad', of: 'note', index: ni });
  };
  notes.forEach((n, i) => { if (n.after === undefined) note(i); });
  ir.messages.forEach((m, i) => {
    for (const b of blocks.filter((x) => x.first === i && x.depth >= HEADER_ROW_DEPTH).sort((a, c) => a.depth - c.depth)) rows.push({ type: 'pad', of: 'block', index: b.index });
    rows.push({ type: 'message', index: i });
    notes.forEach((n, ni) => { if (n.after === m.id) note(ni); });
    // Innermost block first, as the text closes them.
    for (const b of blocks.filter((x) => x.last === i).sort((a, c) => c.depth - a.depth)) notes.forEach((n, ni) => { if (n.after === b.id) note(ni); });
  });
  return rows;
}

/**
 * The activation bars of the draw.io layout, by message index: from the call that starts
 * one to the message it ends at (`null`: one row below the call, which nothing answers).
 */
function activationsOf(ir) {
  const L = layoutSequence(ir);
  const indexAt = new Map(ir.messages.map((m, i) => [L.messageY(m.id), i]));
  const pIndex = new Map(ir.participants.map((p, i) => [p.id, i]));
  return L.activations.map((a) => ({ at: pIndex.get(a.participant), from: indexAt.get(a.startY), to: indexAt.get(a.endY) ?? null }));
}

/** True when the board Figma generates lacks something of this sequence diagram. */
export function needsOverlay(ir) {
  if (ir.kind !== 'sequence') return false;
  return (ir.blocks ?? []).length > 0 || (ir.notes ?? []).length > 0 || ir.messages.some((m) => m.from === m.to)
    || ir.participants.some((p) => (p.kind ?? 'participant') !== 'participant') || activationsOf(ir).length > 0;
}

/**
 * @param {object} ir validated sequence IR
 * @returns {string | null} JavaScript for `use_figma`, or null when the board is complete without it
 */
export function figjamOverlay(ir) {
  if (!needsOverlay(ir)) return null;
  const text = (s) => figjamLabel(s).label;
  const pIndex = new Map(ir.participants.map((p, i) => [p.id, i]));
  const notes = ir.notes ?? [];
  const rows = sequenceRows(ir);
  const rowOfMessage = new Map();
  rows.forEach((r, k) => { if (r.type === 'message') rowOfMessage.set(r.index, k); });
  // The first row that belongs to a message: the label rows of blocks that start with it come first.
  const firstRowOf = (messageIndex) => {
    let k = rowOfMessage.get(messageIndex);
    while (rows[k - 1]?.type === 'pad' && rows[k - 1].of === 'block') k--;
    return k;
  };
  // A note written right after the last message of a section still stands inside its frame.
  const lastRowOf = (messageIndex) => {
    let k = rowOfMessage.get(messageIndex);
    const own = (r) => r && (r.type === 'note' || (r.type === 'pad' && r.of === 'note')) && notes[r.index].after === ir.messages[messageIndex].id;
    while (own(rows[k + 1])) k++;
    return k;
  };
  const blocks = blocksOf(ir);
  const data = {
    title: ir.title,
    participants: ir.participants.map((p) => text(p.label)),
    kinds: ir.participants.map((p) => p.kind ?? 'participant'),
    activations: activationsOf(ir).map((a) => ({ at: a.at, top: rowOfMessage.get(a.from), bottom: a.to === null ? null : rowOfMessage.get(a.to) })),
    rows: rows.map((r) => {
      if (r.type === 'pad') return { pad: r.of };
      if (r.type === 'note') {
        const n = notes[r.index];
        return { note: text(n.label), over: n.participants.map((p) => pIndex.get(p)), side: n.participants.length === 2 ? 'over' : (n.position ?? 'right'), rows: noteRows(ir, n) };
      }
      const m = ir.messages[r.index];
      const from = pIndex.get(m.from);
      const to = pIndex.get(m.to);
      // The text of a message with a `ref` gains the slug; the board is matched on what was sent.
      const label = text(m.label) + (m.ref ? ` ${text(`↳ ${m.ref}`)}` : '');
      return from === to ? { self: label, at: from, kind: m.kind ?? 'sync' } : { message: label, from, to };
    }),
    blocks: blocks.map((b) => ({
      kind: b.kind,
      depth: b.depth,
      // A block nested deep enough has a row for its label; the others share the room above the first row.
      header: b.depth >= HEADER_ROW_DEPTH ? rows.findIndex((r) => r.type === 'pad' && r.of === 'block' && r.index === b.index) : null,
      top: firstRowOf(b.first),
      bottom: lastRowOf(b.last),
      sections: b.sections.map((s) => ({ label: s.label === undefined ? '' : text(s.label), row: firstRowOf(s.first) })),
    })),
  };
  return `${RUNTIME_HEAD}const D = ${JSON.stringify(data)};\n${RUNTIME}`;
}

const RUNTIME_HEAD = `// Zukai: completes the FigJam board of a sequence diagram (block frames, self-messages, notes,
// participant kinds, activation bars).
// Pass this text unchanged to the Figma MCP tool use_figma, with the file key of the board.
`;

/* The part that runs inside Figma. Plain JavaScript with top-level await and return, as
 * use_figma expects. Coordinates are those of the section; a floating connector end is
 * given in page coordinates, hence the offset. */
const RUNTIME = String.raw`const TAG = 'zukai-overlay';
const fail = (m) => { throw new Error('zukai overlay: ' + m + '. Nothing was changed.'); };
const sections = figma.currentPage.children.filter((n) => n.type === 'SECTION' && n.name === D.title);
if (sections.length === 0) fail('no section named "' + D.title + '" on this board; generate the diagram first, with the title as its name');
const S = sections[sections.length - 1];
const old = S.children.filter((c) => c.name === TAG);
const connectors = S.children.filter((c) => c.type === 'CONNECTOR' && c.name !== TAG);
const isLife = (c) => c.connectorStart.magnet === 'BOTTOM' && c.connectorEnd.magnet === 'TOP' && c.connectorEndStrokeCap === 'NONE';
const life = connectors.filter(isLife);
const lifeIds = new Set(life.map((c) => c.id));
if (life.length !== D.participants.length) fail('the board has ' + life.length + ' lifelines, the model ' + D.participants.length);
const heads = [];
const feet = [];
for (let i = 0; i < life.length; i++) {
  const head = await figma.getNodeByIdAsync(life[i].connectorStart.endpointNodeId);
  if (!head || head.type !== 'SHAPE_WITH_TEXT' || head.text.characters !== D.participants[i]) fail('participant ' + (i + 1) + ' of the board is not "' + D.participants[i] + '"');
  heads.push(head);
  feet.push(await figma.getNodeByIdAsync(life[i].connectorEnd.endpointNodeId));
}
const drawn = connectors.filter((c) => !isLife(c) && lifeIds.has(c.connectorStart.endpointNodeId));
const strays = connectors.filter((c) => !isLife(c) && !lifeIds.has(c.connectorStart.endpointNodeId));
const expected = D.rows.map((r, k) => ({ r, k })).filter((x) => x.r.message !== undefined);
if (drawn.length !== expected.length) fail('the board has ' + drawn.length + ' messages between participants, the model ' + expected.length);
let pitch = 80;
if (expected.length > 0) pitch = drawn[0].connectorStart.position.y / (expected[0].k + 1);
expected.forEach((x, i) => {
  if (drawn[i].text.characters !== x.r.message) fail('message ' + (i + 1) + ' of the board is "' + drawn[i].text.characters + '", the model has "' + x.r.message + '"');
  if (Math.abs(drawn[i].connectorStart.position.y - pitch * (x.k + 1)) > 1) fail('the rows of the board are not evenly spaced, so the layout Figma used is not the one this script knows');
});

const font = { family: 'Inter', style: 'Medium' };
await figma.loadFontAsync(font);
const rgb = (hex) => ({ r: ((hex >> 16) & 255) / 255, g: ((hex >> 8) & 255) / 255, b: (hex & 255) / 255 });
const GREY = rgb(0x757575);
const DARK = rgb(0x1e1e1e);
const solid = (c) => [{ type: 'SOLID', color: c }];
const ox = S.absoluteTransform[0][2];
const oy = S.absoluteTransform[1][2];
const xOf = (p) => life[p].x;
const yOf = (k) => life[0].y + pitch * (k + 1);
const created = [];
const keep = (n) => { n.name = TAG; created.push(n.id); return n; };
const label = (chars, x, y, size, width) => {
  const t = keep(figma.createText());
  S.appendChild(t);
  t.fontName = font;
  t.fontSize = size;
  t.characters = chars;
  t.fills = solid(DARK);
  if (width !== undefined && t.width > width) { t.textAutoResize = 'HEIGHT'; t.resize(width, t.height); }
  t.x = x;
  t.y = y;
  return t;
};
const tag = (chars, x, y) => {
  const back = keep(figma.createRectangle());
  S.appendChild(back);
  const t = label(chars, x + 6, y + 3, 12);
  back.x = x;
  back.y = y;
  back.resize(t.width + 12, t.height + 6);
  back.fills = solid(rgb(0xffffff));
  back.strokes = [];
  return t;
};
const arrow = (x1, y1, x2, y2, cap, dashed) => {
  const c = keep(figma.createConnector());
  S.appendChild(c);
  c.connectorLineType = 'STRAIGHT';
  c.connectorStart = { position: { x: ox + x1, y: oy + y1 } };
  c.connectorEnd = { position: { x: ox + x2, y: oy + y2 } };
  c.connectorStartStrokeCap = 'NONE';
  c.connectorEndStrokeCap = cap;
  c.strokeWeight = 4;
  c.strokes = solid(GREY);
  if (dashed) c.dashPattern = [16, 10];
  return c;
};

for (const n of old) n.remove();
const removed = strays.map((c) => c.id);
for (const c of strays) c.remove();

// The kind of a participant as the draw.io file shows it: a figure above an actor, a
// stereotype line above the name for the others.
const FIGURE = 'M 15 0 C 19 0 22 3 22 7 C 22 11 19 14 15 14 C 11 14 8 11 8 7 C 8 3 11 0 15 0 Z M 15 14 L 15 28 M 3 19 L 27 19 M 15 28 L 5 40 M 15 28 L 25 40';
D.kinds.forEach((kind, p) => {
  if (kind === 'participant') return;
  if (kind === 'actor') {
    const v = keep(figma.createVector());
    S.appendChild(v);
    v.vectorPaths = [{ windingRule: 'NONE', data: FIGURE }];
    v.strokes = solid(GREY);
    v.strokeWeight = 3;
    v.fills = [];
    v.x = xOf(p) - 12;
    v.y = heads[p].y - 44;
    return;
  }
  for (const box of [heads[p], feet[p]]) {
    if (!box) continue;
    const t = label('\u00ab' + kind + '\u00bb', 0, box.y + 14, 12);
    t.x = box.x + (box.width - t.width) / 2;
  }
});

// Activation bars go under the message arrows and over the lifelines.
const firstMessage = Math.max(0, S.children.findIndex((c) => c.type === 'CONNECTOR' && c.name !== TAG && !isLife(c)));
for (const a of D.activations) {
  const top = yOf(a.top);
  const bottom = a.bottom === null ? top + pitch : yOf(a.bottom);
  const bar = keep(figma.createRectangle());
  S.insertChild(firstMessage, bar);
  bar.x = xOf(a.at) - 6;
  bar.y = top;
  bar.resize(12, Math.max(bottom - top, 12));
  bar.fills = solid(rgb(0xffffff));
  bar.strokes = solid(GREY);
  bar.strokeWeight = 2;
}

let right = 0;
// Frames next, so that they lie under the rows drawn after them.
const deepest = D.blocks.reduce((m, b) => Math.max(m, b.depth), 0);
for (const b of [...D.blocks].sort((a, c) => a.depth - c.depth)) {
  let lo = Infinity;
  let hi = -Infinity;
  let selfEdge = -Infinity;
  for (let k = b.top; k <= b.bottom; k++) {
    const r = D.rows[k];
    if (r.pad !== undefined) continue;
    const ps = r.message !== undefined ? [r.from, r.to] : r.self !== undefined ? [r.at] : r.over;
    for (const p of ps) { lo = Math.min(lo, xOf(p)); hi = Math.max(hi, xOf(p)); }
    if (r.self !== undefined) selfEdge = Math.max(selfEdge, xOf(r.at) + 270);
    if (r.note !== undefined && r.over.length === 1 && r.side === 'right') selfEdge = Math.max(selfEdge, xOf(r.over[0]) + 230);
    if (r.note !== undefined && r.over.length === 1 && r.side === 'left') lo = Math.min(lo, xOf(r.over[0]) - 120);
  }
  const out = 12 * (deepest - b.depth);
  const left = lo - 100 - out;
  const edge = Math.max(hi + 100, selfEdge) + out;
  const top = b.header !== null ? yOf(b.header) - 26 : yOf(b.top) - 58;
  const bottom = yOf(b.bottom) + 22 - 4 * Math.min(b.depth, 4) + (D.rows[b.bottom].message === undefined ? 14 : 0);
  const frame = keep(figma.createRectangle());
  S.appendChild(frame);
  frame.x = left;
  frame.y = top;
  frame.resize(edge - left, bottom - top);
  frame.fills = [];
  frame.strokes = solid(GREY);
  frame.strokeWeight = 2;
  frame.cornerRadius = 6;
  right = Math.max(right, edge);
  tag(b.kind + (b.sections[0].label ? '  [' + b.sections[0].label + ']' : ''), left + 2, top + 2);
  for (const s of b.sections.slice(1)) {
    const y = yOf(s.row) - 40;
    const line = keep(figma.createLine());
    S.appendChild(line);
    line.x = left;
    line.y = y;
    line.resize(edge - left, 0);
    line.strokes = solid(GREY);
    line.strokeWeight = 2;
    line.dashPattern = [6, 4];
    tag((b.kind === 'par' ? 'and' : 'else') + (s.label ? '  [' + s.label + ']' : ''), left + 2, y + 2);
  }
}

D.rows.forEach((r, k) => {
  const y = yOf(k);
  if (r.self !== undefined) {
    const x = xOf(r.at);
    const dashed = r.kind === 'return';
    arrow(x, y - 14, x + 48, y - 14, 'NONE', dashed);
    arrow(x + 48, y - 14, x + 48, y + 14, 'NONE', dashed);
    arrow(x + 48, y + 14, x + 4, y + 14, r.kind === 'async' ? 'ARROW_LINES' : 'ARROW_EQUILATERAL', dashed);
    const t = label(r.self, x + 62, y, 16, 200);
    t.y = y - t.height / 2;
    right = Math.max(right, x + 62 + t.width);
  } else if (r.note !== undefined) {
    const xs = r.over.map(xOf);
    let x;
    let w = 200;
    if (r.over.length === 2) { x = Math.min(...xs) - 60; w = Math.abs(xs[1] - xs[0]) + 120; }
    else if (r.side === 'left') x = xs[0] - 216;
    else if (r.side === 'over') x = xs[0] - 100;
    else x = xs[0] + 16;
    const box = keep(figma.createShapeWithText());
    S.appendChild(box);
    box.shapeType = 'SQUARE';
    box.text.fontName = font;
    box.text.fontSize = 14;
    box.text.characters = r.note;
    box.text.fills = solid(DARK);
    box.fills = solid(rgb(0xffecbd));
    box.strokes = solid(rgb(0xffc943));
    // A long note has as many rows as its text needs; the box stands in the middle of them.
    const lines = Math.max(1, Math.ceil(r.note.length / Math.floor((w - 56) / 7.6)));
    const h = Math.min(pitch * r.rows - 8, Math.max(44, 21 * lines + 28));
    box.resize(w, h);
    box.x = x;
    box.y = y + (pitch * (r.rows - 1)) / 2 - h / 2;
    right = Math.max(right, x + w);
  }
});

if (right + 40 > S.width) S.resizeWithoutConstraints(right + 40, S.height);
return { section: S.id, createdNodeIds: created, removedNodeIds: removed, replacedNodeIds: old.length };
`;
