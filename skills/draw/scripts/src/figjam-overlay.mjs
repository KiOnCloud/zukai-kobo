import { figjamLabel } from './mermaid-text.mjs';

/**
 * What Figma's generate_diagram leaves out of a sequence diagram, as a script for the Figma
 * MCP tool `use_figma` to draw on top of the generated board: the frames of loop, alt, opt
 * and par blocks with their conditions, a message a participant sends to itself, and notes.
 *
 * Figma reserves a row for a self-message but draws only a stray arrow outside the section,
 * and drops the block keywords and Note statements. The figjam text therefore writes a note
 * as a self-message too, so that it gets a row of its own; this script removes the stray
 * arrows and draws the real thing into each reserved row.
 *
 * The script checks what it finds (participants, messages and row pitch) against the model
 * and throws before it changes anything when the board is not the one this text made.
 */

/**
 * The rows of a sequence diagram in the order the figjam text writes them: one per message
 * and one per note. Must stay in step with `emitSequence` of emit-mermaid.mjs.
 * @returns {Array<{ type: 'message', index: number } | { type: 'note', index: number }>}
 */
export function sequenceRows(ir) {
  const notes = ir.notes ?? [];
  const order = new Map(ir.messages.map((m, i) => [m.id, i]));
  const blockEnd = new Map();
  for (const b of ir.blocks ?? []) {
    const all = [...b.messages, ...(b.branches ?? []).flatMap((br) => br.messages)].map((id) => order.get(id));
    const end = Math.max(...all);
    blockEnd.set(b.id, { end, span: end - Math.min(...all) });
  }
  const rows = [];
  notes.forEach((n, i) => { if (n.after === undefined) rows.push({ type: 'note', index: i }); });
  ir.messages.forEach((m, i) => {
    rows.push({ type: 'message', index: i });
    notes.forEach((n, ni) => { if (n.after === m.id) rows.push({ type: 'note', index: ni }); });
    // Innermost block first, as the text closes them.
    const closing = [...blockEnd].filter(([, v]) => v.end === i).sort((a, b) => a[1].span - b[1].span);
    for (const [id] of closing) notes.forEach((n, ni) => { if (n.after === id) rows.push({ type: 'note', index: ni }); });
  });
  return rows;
}

/** True when the board Figma generates lacks something of this sequence diagram. */
export function needsOverlay(ir) {
  if (ir.kind !== 'sequence') return false;
  return (ir.blocks ?? []).length > 0 || (ir.notes ?? []).length > 0 || ir.messages.some((m) => m.from === m.to);
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
  const rowOfNote = new Map();
  rows.forEach((r, k) => (r.type === 'message' ? rowOfMessage : rowOfNote).set(r.index, k));
  const order = new Map(ir.messages.map((m, i) => [m.id, i]));
  // A note written right after the last message of a section still stands inside its frame.
  const lastRowOf = (messageIndex) => {
    let k = rowOfMessage.get(messageIndex);
    while (rows[k + 1]?.type === 'note' && notes[rows[k + 1].index].after === ir.messages[messageIndex].id) k++;
    return k;
  };

  const blocks = (ir.blocks ?? []).map((b) => {
    const sections = [{ label: b.label, ids: b.messages }, ...(b.branches ?? []).map((br) => ({ label: br.label, ids: br.messages }))].map((s) => {
      const idx = s.ids.map((id) => order.get(id));
      return { label: s.label === undefined ? '' : text(s.label), first: Math.min(...idx), last: Math.max(...idx) };
    });
    return { kind: b.kind, sections, first: sections[0].first, last: sections[sections.length - 1].last };
  });
  const data = {
    title: ir.title,
    participants: ir.participants.map((p) => text(p.label)),
    rows: rows.map((r) => {
      if (r.type === 'note') {
        const n = notes[r.index];
        return { note: text(n.label), over: n.participants.map((p) => pIndex.get(p)), side: n.participants.length === 2 ? 'over' : (n.position ?? 'right') };
      }
      const m = ir.messages[r.index];
      const from = pIndex.get(m.from);
      const to = pIndex.get(m.to);
      // The text of a message with a `ref` gains the slug; the board is matched on what was sent.
      const label = text(m.label) + (m.ref ? ` ${text(`↳ ${m.ref}`)}` : '');
      return from === to ? { self: label, at: from, kind: m.kind ?? 'sync' } : { message: label, from, to };
    }),
    blocks: blocks.map((b) => {
      // Blocks that enclose this one; of two with the same range the earlier is the outer, as in the text.
      const span = (x) => x.last - x.first;
      const depth = blocks.filter((o, oi) => o !== b && o.first <= b.first && o.last >= b.last && (span(o) > span(b) || (span(o) === span(b) && oi < blocks.indexOf(b)))).length;
      return {
        kind: b.kind,
        depth,
        top: rowOfMessage.get(b.first),
        bottom: lastRowOf(b.last),
        sections: b.sections.map((s) => ({ label: s.label, row: rowOfMessage.get(s.first) })),
      };
    }),
  };
  return `${RUNTIME_HEAD}const D = ${JSON.stringify(data)};\n${RUNTIME}`;
}

const RUNTIME_HEAD = `// Zukai: completes the FigJam board of a sequence diagram (block frames, self-messages, notes).
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
for (let i = 0; i < life.length; i++) {
  const head = await figma.getNodeByIdAsync(life[i].connectorStart.endpointNodeId);
  if (!head || head.type !== 'SHAPE_WITH_TEXT' || head.text.characters !== D.participants[i]) fail('participant ' + (i + 1) + ' of the board is not "' + D.participants[i] + '"');
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

let right = 0;
// Frames first, so that they lie under the rows drawn after them.
const deepest = D.blocks.reduce((m, b) => Math.max(m, b.depth), 0);
for (const b of [...D.blocks].sort((a, c) => a.depth - c.depth)) {
  let lo = Infinity;
  let hi = -Infinity;
  let selfEdge = -Infinity;
  for (let k = b.top; k <= b.bottom; k++) {
    const r = D.rows[k];
    const ps = r.message !== undefined ? [r.from, r.to] : r.self !== undefined ? [r.at] : r.over;
    for (const p of ps) { lo = Math.min(lo, xOf(p)); hi = Math.max(hi, xOf(p)); }
    if (r.self !== undefined) selfEdge = Math.max(selfEdge, xOf(r.at) + 270);
    if (r.note !== undefined && r.over.length === 1 && r.side === 'right') selfEdge = Math.max(selfEdge, xOf(r.over[0]) + 230);
    if (r.note !== undefined && r.over.length === 1 && r.side === 'left') lo = Math.min(lo, xOf(r.over[0]) - 120);
  }
  const out = 12 * (deepest - b.depth);
  const left = lo - 100 - out;
  const edge = Math.max(hi + 100, selfEdge) + out;
  const top = yOf(b.top) - 58 + 20 * Math.min(b.depth, 2);
  const bottom = yOf(b.bottom) + 20 - 5 * Math.min(b.depth, 2) + (D.rows[b.bottom].message === undefined ? 14 : 0);
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
    const lines = Math.max(1, Math.ceil((r.note.length * 7.6) / (w - 24)));
    const h = Math.min(76, Math.max(44, 20 * lines + 20));
    box.resize(w, h);
    box.x = x;
    box.y = y - h / 2;
    right = Math.max(right, x + w);
  }
});

if (right + 40 > S.width) S.resizeWithoutConstraints(right + 40, S.height);
return { section: S.id, createdNodeIds: created, removedNodeIds: removed, replacedNodeIds: old.length };
`;
