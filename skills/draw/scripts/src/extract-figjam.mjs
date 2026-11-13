import { kindHints, markLanes } from './extract-drawio.mjs';

/**
 * The facts of a FigJam board, read in two steps because only the Figma MCP tool `use_figma`
 * can see a board: `figjamReaderScript` writes a script that only reads (it creates, moves and
 * deletes nothing) and returns the board as plain JSON; the agent saves that JSON and
 * `extractFigjamBoard` turns it into facts like those of a draw.io file.
 *
 * A board holds three sorts of drawing. FigJam's own shapes, stickies, tables and connectors
 * (what people draw and what `generate_diagram` makes) carry their meaning: a connector knows
 * the two nodes it joins. A board that Zukai drew with `emit --native` is plain rectangles,
 * vectors and texts, one group per draw.io cell named like its label: a group of shapes is a
 * node, a group of lines is an edge whose ends are taken from where its longest line starts
 * and stops (flagged as inferred), and a group that holds groups is a frame. Free texts laid
 * over a shape belong to it, as in a draw.io file.
 */

/**
 * The most bytes one read returns. `use_figma` refuses a result over 48 000 bytes, so a board
 * larger than this comes back in parts: each result names the index the next read starts at
 * (`next`), and `extract` takes every part at once.
 */
export const READ_LIMIT = 45000;

/** Script for `use_figma`: read the current page, or one section of it (by name or node id), from node `from` on, and return it as JSON. */
export function figjamReaderScript({ section, from = 0 } = {}) {
  return `// Zukai recook: reads the board and returns it as JSON. Changes nothing on the board.
const SECTION = ${JSON.stringify(section ?? null)};
const FROM = ${Number(from) || 0};
const LIMIT = ${READ_LIMIT};
const page = figma.currentPage;
let root = page;
if (SECTION !== null) {
  root = page.findOne((n) => n.type === 'SECTION' && (n.id === SECTION || n.name === SECTION));
  if (!root) {
    const names = page.findAll((n) => n.type === 'SECTION').map((n) => n.name);
    throw new Error('no section named "' + SECTION + '" on page "' + page.name + '"; sections: ' + (names.length ? names.join(', ') : 'none'));
  }
}
const r = Math.round;
const boxOf = (n) => {
  const b = n.absoluteBoundingBox;
  if (b) return [r(b.x), r(b.y), r(b.width), r(b.height)];
  return [r(n.x || 0), r(n.y || 0), r(n.width || 0), r(n.height || 0)];
};
// A property a node type does not have throws when read, so every read is guarded with \`in\`.
const textOf = (n) => {
  if (n.type === 'TEXT') return n.characters;
  if ('text' in n && n.text && typeof n.text.characters === 'string') return n.text.characters;
  return '';
};
// Names carry meaning only on frames; on other nodes they repeat the text or a tool's tag.
const NAMED = { SECTION: 1, FRAME: 1, GROUP: 1, TABLE: 1 };
const apply = (t, x, y) => [r(t[0][0] * x + t[0][1] * y + t[0][2]), r(t[1][0] * x + t[1][1] * y + t[1][2])];
const out = [];
const walk = (n, parent) => {
  for (const c of ('children' in n ? n.children : [])) {
    const o = { id: c.id, type: c.type, box: boxOf(c) };
    if (NAMED[c.type]) o.name = c.name;
    if (parent) o.parent = parent;
    const text = textOf(c);
    if (text) o.text = text;
    if (c.type === 'SHAPE_WITH_TEXT') o.shapeType = c.shapeType;
    if (c.type === 'RECTANGLE' && typeof c.cornerRadius === 'number' && c.cornerRadius > 0) o.rounded = 1;
    if ('dashPattern' in c && Array.isArray(c.dashPattern) && c.dashPattern.length > 0) o.dashed = 1;
    if (c.type === 'CONNECTOR') {
      const end = (e) => (e && e.endpointNodeId ? { node: e.endpointNodeId } : e && e.position ? { at: [r(e.position.x), r(e.position.y)] } : {});
      o.start = end(c.connectorStart);
      o.end = end(c.connectorEnd);
      o.startCap = c.connectorStartStrokeCap;
      o.endCap = c.connectorEndStrokeCap;
    }
    if ((c.type === 'VECTOR' || c.type === 'LINE') && c.absoluteTransform) {
      const t = c.absoluteTransform;
      if (c.type === 'LINE') o.ends = [apply(t, 0, 0), apply(t, c.width, 0)];
      else if (c.vectorNetwork && c.vectorNetwork.vertices.length > 1) {
        const v = c.vectorNetwork.vertices;
        o.ends = [apply(t, v[0].x, v[0].y), apply(t, v[v.length - 1].x, v[v.length - 1].y)];
      }
    }
    if (c.type === 'TABLE') {
      o.rows = [];
      for (let i = 0; i < c.numRows; i++) {
        const row = [];
        for (let j = 0; j < c.numColumns; j++) row.push(c.cellAt(i, j).text.characters);
        o.rows.push(row);
      }
    }
    out.push(o);
    if ('children' in c && c.type !== 'TABLE') walk(c, c.id);
  }
};
walk(root, null);
// UTF-8 bytes, as the limit counts them; a Vietnamese or Japanese label takes more than its length.
const bytes = (s) => { let b = 0; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); b += c < 0x80 ? 1 : c < 0x800 ? 2 : c >= 0xd800 && c < 0xdc00 ? (i++, 4) : 3; } return b; };
const head = { zukaiBoard: 1, page: page.name, section: root === page ? null : root.name, root: root === page ? null : root.id, from: FROM, total: out.length, next: null, nodes: [] };
let used = bytes(JSON.stringify(head)) + 40;
let i = FROM;
for (; i < out.length; i++) {
  const size = bytes(JSON.stringify(out[i])) + 1;
  if (used + size > LIMIT && head.nodes.length > 0) break;
  used += size;
  head.nodes.push(out[i]);
}
if (i < out.length) head.next = i;
return head;
`;
}

const SHAPE_TYPES = {
  SQUARE: 'box', ROUNDED_RECTANGLE: 'rounded', ELLIPSE: 'ellipse', DIAMOND: 'decision',
  PARALLELOGRAM_RIGHT: 'io', PARALLELOGRAM_LEFT: 'io', MANUAL_INPUT: 'io', ENG_DATABASE: 'store',
  INTERNAL_STORAGE: 'store', ENG_QUEUE: 'queue', ENG_FILE: 'document', ENG_FOLDER: 'document',
  DOCUMENT_SINGLE: 'document', DOCUMENT_MULTIPLE: 'document', PREDEFINED_PROCESS: 'subroutine',
  HEXAGON: 'box', CHEVRON: 'note', SUMMING_JUNCTION: 'bar', OR: 'bar',
};
const CAPS = { NONE: 'none', ARROW_LINES: 'open', ARROW_EQUILATERAL: 'block', TRIANGLE_FILLED: 'block', DIAMOND_FILLED: 'diamond', CIRCLE_FILLED: 'oval' };
const DRAWN = new Set(['RECTANGLE', 'ELLIPSE', 'VECTOR', 'LINE', 'TEXT', 'POLYGON', 'STAR']);
const NEAR = 8;
const DRAWN_NEAR = 16;

/**
 * Facts of the board JSON the reader script returned.
 * @param {{ zukaiBoard: 1, page: string, section: string|null, root?: string|null, nodes: object[] }} board
 */
export function extractFigjamBoard(board) {
  const all = new Map(board.nodes.map((n) => [n.id, { ...n, box: { x: n.box[0], y: n.box[1], w: n.box[2], h: n.box[3] } }]));
  const childrenOf = (id) => board.nodes.filter((n) => n.parent === id).map((n) => all.get(n.id));
  const warnings = [];
  const nodes = [];
  const edges = [];
  const owner = new Map();
  const absorbed = new Set();
  const pictograms = [];
  const byPlace = (a, b) => a.box.y - b.box.y || a.box.x - b.box.x;

  const textsBelow = (id) => {
    const texts = [];
    for (const c of childrenOf(id)) {
      if (c.type === 'TEXT' && c.text) texts.push(c);
      else if (c.type === 'GROUP' && !childrenOf(c.id).some((g) => g.type === 'GROUP')) texts.push(...textsBelow(c.id));
    }
    return texts.sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
  };
  const lines = (s) => String(s).replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
  const parentOf = (n) => {
    let at = n.parent;
    while (at && absorbed.has(at)) at = all.get(at)?.parent;
    return at && at !== board.root && all.has(at) ? at : undefined;
  };

  for (const n of all.values()) {
    if (absorbed.has(n.id)) continue;
    const node = { id: n.id };
    if (n.type === 'SHAPE_WITH_TEXT' && n.shapeType === 'ELLIPSE' && !n.text && n.box.w <= 40) Object.assign(node, { label: '', shape: 'initial' });
    else if (n.type === 'SHAPE_WITH_TEXT') Object.assign(node, { label: lines(n.text ?? ''), shape: SHAPE_TYPES[n.shapeType] ?? 'box' });
    else if (n.type === 'STICKY' || n.type === 'CODE_BLOCK') Object.assign(node, { label: lines(n.text ?? ''), shape: 'note' });
    else if (n.type === 'SECTION' || n.type === 'FRAME') Object.assign(node, { label: lines(n.name ?? ''), shape: 'container' });
    else if (n.type === 'TABLE') Object.assign(node, { label: lines(n.name ?? ''), shape: 'table', texts: (n.rows ?? []).map((row) => row.map((c) => lines(c).replace(/\n/g, ' ')).filter(Boolean).join(' ')).filter(Boolean) });
    else if (n.type === 'TEXT') Object.assign(node, { label: lines(n.text ?? ''), shape: 'text' });
    else if (n.type === 'GROUP') {
      const kids = childrenOf(n.id);
      const groups = kids.filter((k) => k.type === 'GROUP');
      const round = (k) => (k.type === 'ELLIPSE' || (k.type === 'SHAPE_WITH_TEXT' && k.shapeType === 'ELLIPSE' && !k.text)) && k.box.w <= 40;
      if (kids.length === 2 && kids.every(round)) {
        // Two circles one in the other: the end of a state diagram (generate_diagram's too).
        kids.forEach((k) => absorbed.add(k.id));
        Object.assign(node, { label: '', shape: 'final' });
      } else if (groups.length > 0 || !kids.every((k) => DRAWN.has(k.type))) {
        // A frame of other things. What it draws itself (its box, header line, title) is
        // its own; what the groups inside it are decides what kind of frame it is.
        const own = kids.filter((k) => DRAWN.has(k.type));
        own.forEach((k) => absorbed.add(k.id));
        const label = lines(own.filter((k) => k.type === 'TEXT' && k.text).sort(byPlace).map((k) => k.text).join('\n'));
        const kind = frameKind(own, groups.map((g) => ({ g, kids: childrenOf(g.id) })));
        Object.assign(node, { label, shape: kind.shape });
        if (kind.heads) node.heads = kind.heads;
        if (kind.rows) {
          // The rows of a class or entity box are lines of it, not nodes of their own.
          node.texts = kind.rows.map((r) => r.text);
          for (const r of kind.rows) { absorbed.add(r.group); for (const k of childrenOf(r.group)) absorbed.add(k.id); }
        }
        if (kind.absorb) for (const g of kind.absorb) { absorbed.add(g.id); for (const k of childrenOf(g.id)) absorbed.add(k.id); }
      } else {
        // One drawn thing: a node of shapes and texts, or an edge of lines and texts.
        kids.forEach((k) => absorbed.add(k.id));
        const texts = kids.filter((k) => k.type === 'TEXT' && k.text).sort(byPlace);
        const drawn = drawnKind(kids);
        if (drawn.edge) {
          edges.push({ id: n.id, label: lines(texts.map((t) => t.text).join('\n')), ends: drawn.edge.ends, dashed: drawn.edge.dashed === 1, endArrow: drawn.arrow ? 'classic' : 'none', drawing: true });
          continue;
        }
        if (drawn.pictogram) { pictograms.push({ id: n.id, box: n.box }); continue; }
        Object.assign(node, { label: lines(texts.map((t) => t.text).join('\n')), shape: drawn.shape });
        if (drawn.heads) node.heads = drawn.heads;
        if (drawn.icon) node.icon = drawn.icon;
        if (drawn.dashed) node.dashed = true;
      }
    } else if (n.type === 'CONNECTOR') {
      edges.push({ id: n.id, label: lines(n.text ?? ''), start: n.start, end: n.end, box: n.box, dashed: n.dashed === 1, startArrow: CAPS[n.startCap] ?? 'none', endArrow: CAPS[n.endCap] ?? 'none' });
      continue;
    } else if ((n.type === 'VECTOR' || n.type === 'LINE') && n.ends) {
      edges.push({ id: n.id, label: '', ends: n.ends, dashed: n.dashed === 1, endArrow: 'none', loose: n.type === 'VECTOR' });
      continue;
    } else if (n.type === 'RECTANGLE' || n.type === 'ELLIPSE') Object.assign(node, { label: '', shape: n.type === 'ELLIPSE' ? 'ellipse' : n.rounded ? 'rounded' : 'box' });
    else {
      if (n.type !== 'WIDGET' && n.type !== 'STAMP') warnings.push(`a ${n.type} ("${n.name}") cannot be read and was left out`);
      continue;
    }
    if (n.dashed === 1) node.dashed = true;
    node.box = { x: Math.round(n.box.x), y: Math.round(n.box.y), w: Math.round(n.box.w), h: Math.round(n.box.h) };
    nodes.push(node);
  }
  for (const node of nodes) {
    const parent = parentOf(all.get(node.id));
    if (parent && nodes.some((m) => m.id === parent)) node.parent = parent;
  }
  markLanes(nodes.filter((m) => m.shape === 'container'), (m) => m.parent ?? '');

  const inside = (p, b, pad = 0) => p.x >= b.x - pad && p.x <= b.x + b.w + pad && p.y >= b.y - pad && p.y <= b.y + b.h + pad;
  const area = (b) => b.w * b.h;
  const centreOf = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

  // A sequence diagram on a board (generate_diagram's): each participant is two boxes of one
  // name, at the top and the bottom, joined by a plain vertical connector, and each message is
  // a connector from one such line to another. The pair and its line become one lifeline.
  const alias = new Map();
  const byNodeId = new Map(nodes.map((m) => [m.id, m]));
  for (const e of [...edges]) {
    if (e.ends || e.label || e.startArrow !== 'none' || e.endArrow !== 'none') continue;
    const a = byNodeId.get(e.start?.node);
    const b = byNodeId.get(e.end?.node);
    if (!a || !b || a === b || !a.label || a.label !== b.label || Math.abs(centreOf(a.box).x - centreOf(b.box).x) > 2) continue;
    const [top, bottom] = a.box.y <= b.box.y ? [a, b] : [b, a];
    top.shape = 'lifeline';
    top.heads = [{ ...top.box }, { ...bottom.box }];
    top.box = { ...top.box, h: bottom.box.y + bottom.box.h - top.box.y };
    owner.set(bottom.id, top.id);
    alias.set(e.id, top.id);
    edges.splice(edges.indexOf(e), 1);
  }
  const lifelines = nodes.filter((m) => m.shape === 'lifeline');
  // Narrow empty bars on a lifeline are its activation bars.
  for (const m of nodes) {
    if (m.label || m.shape !== 'box' || owner.has(m.id) || m.box.w > 16 || m.box.h < 3 * m.box.w) continue;
    const line = lifelines.find((l) => Math.abs(centreOf(l.box).x - centreOf(m.box).x) <= 4);
    if (line) owner.set(m.id, line.id);
  }
  // A block frame drawn as shapes (Zukai's overlay script): an empty rounded rectangle with a
  // small tag in its corner whose text starts with the operator; further tags down its left
  // edge are the else / and branches, and the dashed lines across it divide them.
  const texts = nodes.filter((m) => m.shape === 'text');
  const textIn = (b) => texts.find((t) => !owner.has(t.id) && inside(centreOf(t.box), b));
  const empties = nodes.filter((m) => (m.shape === 'box' || m.shape === 'rounded') && !m.label && !owner.has(m.id));
  for (const f of empties.filter((m) => m.shape === 'rounded')) {
    const tag = empties.find((r) => r !== f && Math.abs(r.box.x - f.box.x) <= 4 && Math.abs(r.box.y - f.box.y) <= 4 && r.box.w < f.box.w / 2);
    const t = tag && textIn(tag.box);
    if (!t || !/^(loop|alt|opt|par|critical|break|neg|ref)\b/i.test(t.label)) continue;
    Object.assign(f, { shape: 'frame', label: t.label });
    owner.set(tag.id, f.id);
    owner.set(t.id, f.id);
    for (const r of empties) {
      if (r === tag || r === f || owner.has(r.id) || Math.abs(r.box.x - f.box.x) > 4 || r.box.y <= f.box.y || r.box.y >= f.box.y + f.box.h) continue;
      const branch = textIn(r.box);
      if (!branch || !/^(else|and)\b/i.test(branch.label)) continue;
      (f.texts ??= []).push(branch.label);
      owner.set(r.id, f.id);
      owner.set(branch.id, f.id);
    }
    for (const e of [...edges]) {
      if (!e.ends || e.ends[0][1] !== e.ends[1][1]) continue;
      const [x1, x2] = [Math.min(e.ends[0][0], e.ends[1][0]), Math.max(e.ends[0][0], e.ends[1][0])];
      if (e.ends[0][1] > f.box.y && e.ends[0][1] < f.box.y + f.box.h && x1 >= f.box.x - 4 && x2 <= f.box.x + f.box.w + 4) edges.splice(edges.indexOf(e), 1);
    }
  }

  // A block frame drawn by emit --native carries its operator on a small labelled box in
  // its corner, and each further branch on one down its left edge.
  for (const f of nodes.filter((m) => m.shape === 'frame' && m.heads && !owner.has(m.id))) {
    for (const b of nodes.filter((m) => m.shape === 'box' && m.label && !owner.has(m.id) && Math.abs(m.box.x - f.box.x) <= 4 && m.box.y >= f.box.y - 4 && m.box.y < f.box.y + f.box.h)) {
      if (!f.label && Math.abs(b.box.y - f.box.y) <= 4 && /^(loop|alt|opt|par|critical|break|neg|ref)\b/i.test(b.label)) f.label = b.label;
      else if (/^(else|and)\b/i.test(b.label)) (f.texts ??= []).push(b.label);
      else continue;
      owner.set(b.id, f.id);
    }
  }

  // Free texts laid over a shape belong to it: over the head or foot of a lifeline, never over a frame
  // (a text inside a frame is a message's or a note's, not the frame's).
  const hostBoxes = (m) => m.heads ?? [m.box];
  const solidNodes = () => nodes.filter((m) => m.shape !== 'text' && m.shape !== 'container' && (m.shape !== 'frame' || m.heads) && !owner.has(m.id));
  for (const t of texts) {
    if (owner.has(t.id)) continue;
    const centre = centreOf(t.box);
    const host = solidNodes().filter((m) => hostBoxes(m).some((b) => inside(centre, b))).sort((a, b) => area(hostBoxes(a)[0]) - area(hostBoxes(b)[0]))[0];
    if (host) {
      owner.set(t.id, host.id);
      if (!host.label) host.label = t.label;
      else if (host.label !== t.label && !(host.texts ?? []).includes(t.label)) (host.texts ??= []).push(t.label);
    }
  }
  // A stick figure drawn just above a lifeline's head makes that participant an actor.
  for (const p of pictograms) {
    const line = nodes.find((m) => m.shape === 'lifeline' && m.heads && m.heads[0].y >= p.box.y + p.box.h - 2 && m.heads[0].y - (p.box.y + p.box.h) <= 20 && p.box.x + p.box.w / 2 >= m.heads[0].x && p.box.x + p.box.w / 2 <= m.heads[0].x + m.heads[0].w);
    if (line) line.detail = 'actor';
  }
  for (const m of nodes) delete m.heads;
  const kept = nodes.filter((m) => !owner.has(m.id));
  const keptIds = new Set(kept.map((m) => m.id));

  // Edge ends: the node a connector names (the group or shape it belongs to), else the node it stops at.
  const lift = (id) => {
    let at = alias.get(id) ?? id;
    while (at && !keptIds.has(at)) at = owner.get(at) ?? all.get(at)?.parent;
    return at && keptIds.has(at) ? at : undefined;
  };
  const FRAMES = new Set(['container', 'lane', 'group', 'frame']);
  const at = ([x, y], pad = NEAR) => {
    const smallest = (list) => list.sort((a, b) => area(a.box) - area(b.box))[0]?.id;
    const near = (p) => kept.filter((m) => m.shape !== 'text' && inside({ x, y }, m.box, p));
    // A shape near the end wins over the frame around it; a drawn line may stop farther from
    // its shape (a UML end marker), so look a little wider before settling on a frame.
    return smallest(near(pad).filter((m) => !FRAMES.has(m.shape))) ?? (pad === DRAWN_NEAR ? smallest(near(2 * pad).filter((m) => !FRAMES.has(m.shape))) : undefined) ?? smallest(near(pad));
  };
  let loose = 0;
  // A plain line from one border of a frame to the other divides it (the branches of a block).
  const dividesFrame = ([[x1, y1], [x2, y2]]) => kept.some((f) => FRAMES.has(f.shape) && Math.abs(y1 - y2) <= 1 && y1 > f.box.y && y1 < f.box.y + f.box.h && Math.abs(Math.min(x1, x2) - f.box.x) <= 4 && Math.abs(Math.max(x1, x2) - (f.box.x + f.box.w)) <= 4);
  const factsEdges = edges.flatMap((e, i) => {
    const edge = { id: e.id, label: e.label };
    let from; let to; let fromInferred = false; let toInferred = false;
    // A drawn line stops short of the shape by its arrowhead and the gap the drawing leaves.
    if (e.ends) { from = at(e.ends[0], e.drawing ? DRAWN_NEAR : NEAR); to = at(e.ends[1], e.drawing ? DRAWN_NEAR : NEAR); fromInferred = toInferred = true; }
    else {
      from = e.start?.node ? lift(e.start.node) : e.start?.at ? at(e.start.at) : undefined;
      to = e.end?.node ? lift(e.end.node) : e.end?.at ? at(e.end.at) : undefined;
      fromInferred = !(e.start?.node && from !== undefined) && from !== undefined;
      toInferred = !(e.end?.node && to !== undefined) && to !== undefined;
      // An end fixed to something not on the board: take it from where the connector runs.
      if (from === undefined && !e.start?.at && e.box) { from = at([e.box.x, e.box.y]); fromInferred = from !== undefined; }
      if (to === undefined && !e.end?.at && e.box) { to = at([e.box.x + e.box.w, e.box.y + e.box.h]); toInferred = to !== undefined; }
    }
    // A free-hand stroke that joins nothing is a drawing (a pictogram, an underline), not an
    // edge, and so is a plain line without arrow or label inside one shape (a divider).
    if (e.loose && (from === undefined || to === undefined)) { loose++; return []; }
    if (e.drawing && e.endArrow === 'none' && !e.label && (from === undefined || to === undefined || from === to || dividesFrame(e.ends))) { loose++; return []; }
    edge.from = from ?? null;
    edge.to = to ?? null;
    if (fromInferred) edge.fromInferred = true;
    if (toInferred) edge.toInferred = true;
    if (e.dashed) edge.dashed = true;
    if (e.startArrow && e.startArrow !== 'none') edge.startArrow = e.startArrow;
    edge.endArrow = e.endArrow ?? 'none';
    const a = kept.find((m) => m.id === edge.from)?.box;
    const b = kept.find((m) => m.id === edge.to)?.box;
    edge.y = e.ends ? Math.round(e.ends[0][1]) : e.box ? Math.round(e.box.y) : a && b ? Math.round((a.y + a.h / 2 + b.y + b.h / 2) / 2) : i;
    return [edge];
  });
  if (loose > 0) warnings.push(`${loose} line${loose > 1 ? 's' : ''} without arrow or label that join${loose > 1 ? '' : 's'} no two shapes ${loose > 1 ? 'were' : 'was'} left out as drawing (a pictogram, a divider)`);

  const pageWarnings = (pageNodes, pageEdges) => {
    const out = [];
    for (const e of pageEdges) if (e.from === null || e.to === null) out.push(`edge "${e.id}"${e.label ? ` ("${e.label.split('\n')[0]}")` : ''} has an end that touches no shape`);
    const free = pageNodes.filter((m) => m.shape === 'text');
    if (free.length > 0) out.push(`${free.length} text${free.length > 1 ? 's stand' : ' stands'} over no shape: ${free.slice(0, 5).map((m) => `"${m.label.split('\n')[0]}"`).join(', ')}${free.length > 5 ? ', …' : ''}`);
    const drawnLines = pageEdges.filter((e) => e.fromInferred || e.toInferred).length;
    if (drawnLines > 0) out.push(`${drawnLines} edge${drawnLines > 1 ? 's are' : ' is'} not connected to a shape at one end or both; ${drawnLines > 1 ? 'their ends were' : 'its end was'} taken from the shape where the line stops (fromInferred / toInferred)`);
    return out;
  };

  // A section is one diagram. A whole page often holds several side by side (generate_diagram
  // puts each on the page itself): each group of nodes joined by connectors or frames is a page
  // of the facts, and a lone note joins the diagram it stands beside.
  const groups = board.section ? [kept] : diagramsOf(kept, factsEdges);
  const pages = groups.map((members, i) => {
    const ids = new Set(members.map((m) => m.id));
    const pageEdges = factsEdges.filter((e) => ids.has(e.from) || ids.has(e.to) || (e.from === null && e.to === null && i === 0));
    const frame = members.find((m) => !m.parent && (m.shape === 'container') && members.every((o) => o === m || within(o, m, members)));
    const id = board.section ? `section:${board.section}` : groups.length === 1 ? `page:${board.page}` : `page:${board.page}#${i + 1}`;
    const name = board.section ?? (groups.length === 1 ? board.page ?? '' : frame?.label ?? '');
    return { id, name, kindHints: kindHints(members, pageEdges), nodes: members, edges: pageEdges, warnings: [...(i === 0 ? warnings : []), ...pageWarnings(members, pageEdges)] };
  });
  return { facts: 1, format: 'figjam', pages };
}

/** Whether node `n` lies inside container `c`, following parents among `members`. */
function within(n, c, members) {
  for (let at = n.parent; at; at = members.find((m) => m.id === at)?.parent) if (at === c.id) return true;
  return false;
}

/** The separate diagrams of a page: nodes joined by edges or by a frame they lie in, top to bottom, left to right. */
function diagramsOf(nodes, edges) {
  const root = new Map(nodes.map((n) => [n.id, n.id]));
  const find = (id) => { while (root.get(id) !== id) { root.set(id, root.get(root.get(id))); id = root.get(id); } return id; };
  const join = (a, b) => { if (root.has(a) && root.has(b)) root.set(find(a), find(b)); };
  for (const n of nodes) if (n.parent) join(n.id, n.parent);
  for (const e of edges) if (e.from && e.to) join(e.from, e.to);
  const byRoot = Map.groupBy(nodes, (n) => find(n.id));
  const bounds = (list) => {
    const xs = list.flatMap((n) => [n.box.x, n.box.x + n.box.w]);
    const ys = list.flatMap((n) => [n.box.y, n.box.y + n.box.h]);
    return { x: Math.min(...xs), y: Math.min(...ys), r: Math.max(...xs), b: Math.max(...ys) };
  };
  let groups = [...byRoot.values()];
  const lone = groups.filter((g) => g.length === 1 && !edges.some((e) => e.from === g[0].id || e.to === g[0].id));
  const linked = groups.filter((g) => !lone.includes(g));
  if (linked.length > 0) {
    const boxes = linked.map(bounds);
    for (const [n] of lone) {
      const gap = (b) => Math.max(b.x - (n.box.x + n.box.w), n.box.x - b.r, 0) + Math.max(b.y - (n.box.y + n.box.h), n.box.y - b.b, 0);
      const best = boxes.map((b, i) => [gap(b), i]).sort((a, b) => a[0] - b[0])[0];
      if (best[0] <= LONE_GAP) linked[best[1]].push(n);
      else linked.push([n]);
    }
    groups = linked;
  }
  return groups.map((g) => [g, bounds(g)]).sort((a, b) => a[1].y - b[1].y || a[1].x - b[1].x).map(([g]) => g);
}

/** How far from a diagram a lone note may stand and still belong to it. */
const LONE_GAP = 200;

/**
 * One board from the parts the reader script returned for it, in any order. Each part says
 * where it starts (`from`), how many nodes the board has (`total`) and where the next part
 * starts (`next`, `null` on the last).
 * @returns {{ board: object } | { error: string }}
 */
export function joinBoardParts(parts) {
  if (parts.length === 1 && parts[0].from === undefined) return { board: parts[0] };
  const sorted = [...parts].sort((a, b) => a.from - b.from);
  const first = sorted[0];
  for (const p of sorted) {
    if (p.page !== first.page || p.section !== first.section || p.total !== first.total) return { error: 'these parts come from different reads (page, section or node count differ); read the board again from the start' };
  }
  let at = 0;
  for (const p of sorted) {
    if (p.from !== at) return { error: `the part that starts at node ${at} is missing; run the reader script again with --from ${at}` };
    at = p.next ?? p.from + p.nodes.length;
  }
  if (sorted.at(-1).next !== null && sorted.at(-1).next !== undefined) return { error: `the board has more nodes; run the reader script again with --from ${sorted.at(-1).next}` };
  return { board: { ...first, nodes: sorted.flatMap((p) => p.nodes), from: 0, next: null } };
}

const dist = ([[x1, y1], [x2, y2]]) => Math.hypot(x2 - x1, y2 - y1);
const diag = (b) => Math.hypot(b.w, b.h);
/** A stroke that runs from one place to another (a line), not round a shape (an outline). */
const isOpen = (k) => (k.type === 'VECTOR' || k.type === 'LINE') && k.ends && dist(k.ends) >= 12 && dist(k.ends) >= 0.85 * diag(k.box);
const boxInside = (a, b, pad = 2) => a.x >= b.x - pad && a.y >= b.y - pad && a.x + a.w <= b.x + b.w + pad && a.y + a.h <= b.y + b.h + pad;
const LABEL_BACK = 18;

/**
 * What one group of plain drawings is, by its geometry (a board drawn by emit --native, or by
 * hand with plain shapes): an edge is a long line, maybe with a small arrowhead and a label on
 * a small back; a lifeline is a box with a long dashed line below it; a decision, an input or
 * a note is an outline; a state's start and end are small circles; an icon is a square with
 * a picture in it and its name below.
 */
function drawnKind(kids) {
  const rects = kids.filter((k) => k.type === 'RECTANGLE' || k.type === 'POLYGON');
  const ellipses = kids.filter((k) => k.type === 'ELLIPSE');
  const strokes = kids.filter((k) => (k.type === 'VECTOR' || k.type === 'LINE') && k.ends);
  const texts = kids.filter((k) => k.type === 'TEXT' && k.text);
  const open = strokes.filter(isOpen).sort((a, b) => dist(b.ends) - dist(a.ends));
  const main = open[0];
  // A long dashed line below a box: a lifeline.
  const head = rects.find((r) => strokes.some((k) => k.dashed === 1 && k.box.w <= 2 && k.box.h > 3 * r.box.h && Math.abs(k.box.y - (r.box.y + r.box.h)) <= 4));
  if (head) return { shape: 'lifeline', heads: [head.box] };
  // A line: long and straight or bent, or any line that ends in a small arrowhead (a message
  // to itself turns back, so its ends lie close), with at most a small back for its label.
  // An arrowhead, or the triangle or diamond of a UML end, is small beside its line.
  const small = (k) => k.box.w <= 26 && k.box.h <= 26;
  const line = main ?? strokes.filter((k) => !small(k)).sort((a, b) => diag(b.box) - diag(a.box))[0];
  const arrow = line && strokes.some((k) => k !== line && small(k));
  // A picture with its name written under it (a client screen) is not a line with a label.
  const caption = texts.length > 0 && strokes.length > 0 && texts.every((t) => strokes.every((k) => t.box.y >= k.box.y + k.box.h - 2));
  if (line && !caption && rects.every((r) => r.box.h <= LABEL_BACK) && ellipses.length === 0 && ((main && dist(main.ends) >= 20) || arrow)) {
    return { edge: line, arrow };
  }
  if (texts.length === 0 && rects.length === 0 && ellipses.length >= 1 && ellipses.every((e) => e.box.w <= 40)) {
    if (strokes.length > 0) return { pictogram: true };
    return { shape: ellipses.length >= 2 ? 'final' : 'initial' };
  }
  if (ellipses.length > 0 && rects.length === 0) return { shape: 'ellipse' };
  const rect = rects.sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h)[0];
  if (rect) {
    const inside = strokes.filter((k) => boxInside(k.box, rect.box));
    const square = Math.abs(rect.box.w - rect.box.h) <= 2 && rect.box.w >= 40;
    const below = texts.some((t) => t.box.y >= rect.box.y + rect.box.h - 2);
    if (square && inside.length > 0 && below) return { shape: 'icon', icon: 'drawio:unknown' };
    if (inside.some((k) => k.box.h >= rect.box.h - 2)) return { shape: 'subroutine' };
    // A box divided under its title by a line across it: a class or entity with no rows.
    if (texts.length > 0 && inside.some((k) => k.box.h <= 1 && Math.abs(k.box.w - rect.box.w) <= 2 && k.box.y > rect.box.y + 2)) return { shape: 'table' };
    // A sequence block: a large box with a small tag in its top-left corner for the operator.
    const tag = inside.find((k) => k.box.w <= 200 && k.box.h <= 26 && Math.abs(k.box.x - rect.box.x) <= 2 && Math.abs(k.box.y - rect.box.y) <= 2);
    if (tag && texts.length === 0 && rect.box.h > 3 * tag.box.h) return { shape: 'frame', heads: [tag.box] };
    return { shape: rect.rounded ? 'rounded' : 'box', dashed: rect.dashed === 1 };
  }
  // Outlines without a box: the largest one is the shape.
  const outline = strokes.filter((k) => !isOpen(k)).sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h)[0];
  if (outline) {
    const b = outline.box;
    const [[x0, y0]] = outline.ends;
    // A picture with its name under it: a stencil (a client screen, a product logo) that
    // the board does not name; its label says what it is.
    if (texts.length > 0 && texts.every((t) => t.box.y >= b.y + b.h - 2) && strokes.length >= 2) return { shape: 'icon', icon: 'drawio:unknown' };
    if (strokes.some((k) => k !== outline && k.box.w <= 16 && k.box.h <= 16 && k.box.x + k.box.w >= b.x + b.w - 2 && k.box.y <= b.y + 2)) return { shape: 'note' };
    if (Math.abs(x0 - (b.x + b.w / 2)) <= 0.1 * b.w && Math.abs(y0 - b.y) <= 2) return { shape: 'decision' };
    return { shape: 'io' };
  }
  return { shape: 'text' };
}

/**
 * What a group of groups is: a lifeline (its own box and dashed line, with activation bars
 * inside), a class or entity box (its groups are rows of text and divider lines), a cloud
 * group frame (a small picture in its top-left corner), or a plain frame.
 */
function frameKind(own, children) {
  const life = drawnKind(own);
  if (life.shape === 'lifeline') return { shape: 'lifeline', heads: life.heads, absorb: children.filter((c) => c.kids.every((k) => k.type === 'RECTANGLE')).map((c) => c.g) };
  const isRow = (c) => c.kids.length > 0 && c.kids.every((k) => k.type === 'TEXT' || ((k.type === 'VECTOR' || k.type === 'LINE') && k.box.h <= 1));
  if (children.length > 0 && children.every(isRow)) {
    const rows = children.flatMap((c) => c.kids.filter((k) => k.type === 'TEXT' && k.text).map((k) => ({ group: c.g.id, text: k.text.replace(/\s*\n\s*/g, ' '), y: k.box.y, x: k.box.x })));
    rows.sort((a, b) => a.y - b.y || a.x - b.x);
    return { shape: 'table', rows, absorb: children.filter((c) => !c.kids.some((k) => k.type === 'TEXT')).map((c) => c.g) };
  }
  const box = own.find((k) => k.type === 'RECTANGLE');
  const corner = box && own.some((k) => k.type === 'VECTOR' && k.box.w <= 30 && k.box.h <= 30 && k.box.x <= box.box.x + 8 && k.box.y <= box.box.y + 8);
  return { shape: corner ? 'group' : 'container' };
}
