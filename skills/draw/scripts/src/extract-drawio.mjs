import { inflateRawSync, inflateSync } from 'node:zlib';
import { inflatePages, parseAttrs } from './relabel.mjs';
import { parseCells, plainLabel } from './figjam-native.mjs';
import catalog from './aws-icons.json' with { type: 'json' };

/**
 * The facts of a draw.io file made by anyone: what each page shows, in words the recook skill
 * maps to an IR, so the agent never reads the XML itself.
 *
 * draw.io stores geometry and styles, not meaning. This module turns a style into a shape
 * class (`decision`, `lifeline`, `store`, `icon` ...), folds the parts of one thing into it
 * (the member rows of a class box, the activation bars of a lifeline, the labels of an edge,
 * a text box laid over a shape), joins an edge that was drawn near a shape but not connected
 * to it (flagged as inferred), and scores which diagram kind each page looks like, with the
 * evidence. Positions are page coordinates; they are hints for order (lanes, participants,
 * messages), never a layout to keep.
 */

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * The mxfile XML inside a file: plain or compressed `.drawio`, a bare `mxGraphModel`, an
 * editable `.drawio.svg` (XML in the `content` attribute) or `.drawio.png` (XML in a text
 * chunk named `mxfile`).
 * @param {Buffer} buf
 * @returns {{ xml: string } | { error: string }}
 */
export function drawioXmlOf(buf) {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    const text = pngText(buf, 'mxfile');
    if (text === undefined) return { error: 'this PNG holds no draw.io diagram (no "mxfile" text chunk); export it from draw.io with "Include a copy of my diagram"' };
    return { xml: inflatePages(safeDecode(text)) };
  }
  const text = buf.toString('utf8');
  if (/<svg\b/.test(text.slice(0, 4000)) && !/<mxfile\b/.test(text.slice(0, 200))) {
    const m = /<svg\b[^>]*?\scontent="([^"]*)"/.exec(text);
    if (!m) return { error: 'this SVG holds no draw.io diagram (no "content" attribute); export it from draw.io as an editable SVG' };
    return { xml: inflatePages(parseAttrs(`content="${m[1]}"`).content) };
  }
  if (/<mxfile\b/.test(text)) return { xml: inflatePages(text) };
  if (/<mxGraphModel\b/.test(text)) return { xml: `<mxfile><diagram id="page-1" name="Page-1">${text.slice(text.indexOf('<mxGraphModel'))}</diagram></mxfile>` };
  return { error: 'not a diagram this skill can read: no draw.io XML (<mxfile> or <mxGraphModel>) and no Mermaid diagram; the sources are .drawio, .xml, .drawio.svg, .drawio.png, .mmd, Markdown with ```mermaid blocks, and a FigJam board read with --figjam-script' };
}

const safeDecode = (text) => { try { return decodeURIComponent(text); } catch { return text; } };

/** The value of the first tEXt, zTXt or iTXt chunk with this keyword. */
function pngText(buf, keyword) {
  let at = 8;
  while (at + 8 <= buf.length) {
    const length = buf.readUInt32BE(at);
    const type = buf.toString('latin1', at + 4, at + 8);
    const data = buf.subarray(at + 8, at + 8 + length);
    at += 12 + length;
    if (type !== 'tEXt' && type !== 'zTXt' && type !== 'iTXt') continue;
    const nul = data.indexOf(0);
    if (nul < 0 || data.toString('latin1', 0, nul) !== keyword) continue;
    try {
      if (type === 'tEXt') return data.toString('latin1', nul + 1);
      if (type === 'zTXt') return inflateSync(data.subarray(nul + 2)).toString('latin1');
      // iTXt: keyword\0 flag method lang\0 translated\0 text
      const compressed = data[nul + 1] === 1;
      let rest = data.subarray(nul + 3);
      rest = rest.subarray(rest.indexOf(0) + 1);
      rest = rest.subarray(rest.indexOf(0) + 1);
      return (compressed ? inflateSync(rest) : rest).toString('utf8');
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/* ---- shape classes ---- */

// Several frames share one picture (a public and a private subnet): their colour tells them apart.
const AWS_GROUPS_BY_ICON = Map.groupBy(Object.entries(catalog.groups).flatMap(([name, g]) => {
  const icon = /grIcon=([^;]+)/.exec(g.style)?.[1];
  return icon ? [{ name, icon, stroke: /strokeColor=([^;]+)/.exec(g.style)?.[1]?.toLowerCase() }] : [];
}), (g) => g.icon);
const awsGroupOf = (style) => {
  const list = AWS_GROUPS_BY_ICON.get(style.grIcon) ?? [];
  return (list.find((g) => g.stroke === String(style.strokeColor ?? '').toLowerCase()) ?? list[0])?.name;
};
const AWS_GROUP_BY_TITLE = new Map(Object.entries(catalog.groups).map(([name, g]) => [g.title.toLowerCase(), name]));
const CLIENT_SHAPES = /^mxgraph\.(networks\.(monitor|pc|laptop|mobile|tablet)|ios|android|mockup)/;

/**
 * What a vertex is, from its style alone. The words are those of the facts schema; `icon`
 * and `group` also say which (`aws:lambda`, `aws:vpc`) when the name is in Zukai's catalog.
 */
function classify(style, value) {
  const shape = style.shape ?? '';
  const has = (word) => Object.hasOwn(style, word);
  if (has('edgeLabel')) return { shape: 'edgeLabel' };
  if (shape === 'umlLifeline') return { shape: 'lifeline' };
  if (shape === 'umlActor' || shape === 'mxgraph.basic.person') return { shape: 'actor' };
  if (shape === 'umlFrame') return { shape: 'frame' };
  if (shape === 'startState' || shape === 'mxgraph.flowchart.start_2' && /^#?0{3,6}$/.test(style.fillColor ?? '')) return { shape: 'initial' };
  if (shape === 'endState') return { shape: 'final' };
  if (style.perimeter === 'orthogonalPerimeter' || style.targetShapes === 'umlLifeline') return { shape: 'activation' };
  if (has('rhombus') || shape === 'rhombus' || shape === 'mxgraph.flowchart.decision') return { shape: 'decision' };
  if (style.grIcon || shape.startsWith('mxgraph.aws4.group')) {
    const group = awsGroupOf(style) ?? AWS_GROUP_BY_TITLE.get(plainLabel(value).toLowerCase());
    return { shape: 'group', ...(group ? { group: `aws:${group}` } : {}) };
  }
  const aws = /^mxgraph\.aws4\.(.+)$/.exec(style.resIcon ?? '') ?? /^mxgraph\.aws4\.(.+)$/.exec(shape);
  if (aws) return { shape: 'icon', icon: Object.hasOwn(catalog.icons, aws[1]) ? `aws:${aws[1]}` : `drawio:mxgraph.aws4.${aws[1]}` };
  const gcp = /^mxgraph\.gcp2\.(.+)$/.exec(shape);
  if (gcp) return { shape: 'icon', icon: Object.hasOwn(catalog.logos ?? {}, gcp[1]) ? `gcp:${gcp[1]}` : `drawio:${shape}` };
  if (CLIENT_SHAPES.test(shape)) return { shape: 'client' };
  if (/^mxgraph\.(azure|mscae|gcp|kubernetes|cisco|veeam|citrix|office)/.test(shape) || has('image')) return { shape: 'icon', icon: `drawio:${shape || 'image'}` };
  if (has('swimlane') && style.childLayout === 'stackLayout') return { shape: 'table' };
  if (shape === 'table') return { shape: 'table' };
  if (shape === 'tableRow') return { shape: 'row' };
  if (shape === 'partialRectangle') return { shape: 'cell' };
  if (has('swimlane') || shape === 'swimlane') return { shape: 'container' };
  if (/^(cylinder\d?|datastore|mxgraph\.flowchart\.(database|stored_data|direct_data))$/.test(shape)) return { shape: 'store' };
  if (shape === 'parallelogram' || shape === 'mxgraph.flowchart.data') return { shape: 'io' };
  if (shape === 'process' || shape === 'mxgraph.flowchart.predefined_process') return { shape: 'subroutine' };
  if (shape === 'note' || shape === 'note2' || shape === 'mxgraph.flowchart.annotation_1') return { shape: 'note' };
  if (shape === 'hexagon' || shape === 'mxgraph.flowchart.preparation') return { shape: 'box', detail: 'hexagon' };
  if (shape === 'document' || shape === 'mxgraph.flowchart.document') return { shape: 'document' };
  if (shape === 'cloud' || shape === 'mxgraph.cisco.storage.cloud') return { shape: 'cloud' };
  if (shape === 'mxgraph.flowchart.terminator' || shape === 'mxgraph.flowchart.start_1') return { shape: 'terminal' };
  if (has('line') || shape === 'line') return { shape: 'bar' };
  if (has('ellipse') || shape === 'ellipse' || shape === 'doubleEllipse') return { shape: 'ellipse' };
  if (has('text') || shape === 'text') return { shape: 'text' };
  if (style.container === '1' || has('group')) return { shape: 'container' };
  if (style.rounded === '1') return { shape: 'rounded' };
  return { shape: 'box' };
}

/**
 * The Zukai name of the stencil a style draws (`aws:lambda`, `aws:vpc`, `gcp:firebase`), or ''
 * when it draws none Zukai knows. The native FigJam board writes it into the name of a cell's
 * group, so a board read back keeps the icons its pictures cannot tell.
 */
export function stencilTag(style, value = '') {
  const kind = classify(style, value);
  const tag = kind.icon ?? kind.group ?? '';
  return /^(aws|gcp):/.test(tag) ? tag : '';
}

/** The visible text of a cell: HTML labels lose their tags, plain labels keep their breaks. */
function textOf(cell) {
  if (!cell.value) return '';
  const text = cell.style.html === '1' ? plainLabel(cell.value) : cell.value;
  return text.replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/[ \t ]+/g, ' ').trim()).join('\n').replace(/^\n+|\n+$/g, '');
}

const FLOW_SHAPES = new Set(['box', 'rounded', 'decision', 'terminal', 'io', 'subroutine', 'initial', 'final', 'ellipse', 'bar', 'document']);
const NEAR = 8;

/**
 * Facts of every page.
 * @param {string} xml mxfile XML with uncompressed pages (`drawioXmlOf`)
 */
export function extractDrawio(xml) {
  const pages = [];
  for (const m of xml.matchAll(/<diagram\b([^>]*)>([\s\S]*?)<\/diagram>/g)) {
    const attrs = parseAttrs(m[1]);
    pages.push(extractPage(attrs.id ?? `page-${pages.length + 1}`, attrs.name ?? '', m[0]));
  }
  return { facts: 1, format: 'drawio', pages };
}

function extractPage(id, name, pageXml) {
  const cells = parseCells(pageXml);
  const byId = new Map(cells.map((c) => [c.id, c]));
  const warnings = [];

  const boxes = new Map();
  const boxOf = (cell) => {
    if (boxes.has(cell.id)) return boxes.get(cell.id);
    const parent = byId.get(cell.parent);
    const base = parent && parent.vertex ? boxOf(parent) : { x: 0, y: 0 };
    const box = { x: base.x + cell.geo.x, y: base.y + cell.geo.y, w: cell.geo.w, h: cell.geo.h };
    boxes.set(cell.id, box);
    return box;
  };
  const offsetOf = (cell) => {
    const parent = byId.get(cell.parent);
    return parent && parent.vertex ? boxOf(parent) : { x: 0, y: 0 };
  };

  // Every vertex with its class; edge labels go to their edge.
  const vertices = new Map();
  const edgeTexts = new Map();
  for (const cell of cells) {
    if (cell.edge) continue;
    const parent = byId.get(cell.parent);
    if (parent?.edge) {
      const text = textOf(cell);
      if (text) (edgeTexts.get(parent.id) ?? edgeTexts.set(parent.id, []).get(parent.id)).push({ text, at: cell.geo.x });
      continue;
    }
    if (!cell.vertex) continue;
    const kind = classify(cell.style, cell.value);
    if (kind.shape === 'edgeLabel') continue;
    vertices.set(cell.id, { cell, ...kind, label: textOf(cell), box: boxOf(cell) });
  }

  // A stacked frame of frames is a pool, not a class box.
  for (const v of vertices.values()) {
    if (v.shape === 'table' && Object.hasOwn(v.cell.style, 'swimlane') && [...vertices.values()].some((c) => c.cell.parent === v.cell.id && c.shape === 'container')) v.shape = 'container';
  }

  // Parts of one thing fold into it: rows and member lines into their box, bars into their lifeline.
  const owner = new Map();
  const ownerOf = (id) => {
    let at = id;
    while (owner.has(at)) at = owner.get(at);
    return at;
  };
  for (const v of vertices.values()) {
    const parent = vertices.get(v.cell.parent);
    if (!parent) continue;
    if (parent.shape === 'table' || parent.shape === 'row' || (parent.shape === 'lifeline' && v.shape === 'activation')) owner.set(v.cell.id, parent.cell.id);
  }
  const textsOf = new Map();
  const addText = (id, text) => { if (text) (textsOf.get(id) ?? textsOf.set(id, []).get(id)).push(text); };
  // Table rows in reading order: a draw.io table row is the texts of its cells left to right.
  for (const v of [...vertices.values()].sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x)) {
    if (!owner.has(v.cell.id) || v.shape === 'activation') continue;
    const top = ownerOf(v.cell.id);
    if (v.shape === 'row') {
      const parts = [...vertices.values()].filter((c) => c.cell.parent === v.cell.id).sort((a, b) => a.box.x - b.box.x).map((c) => c.label).filter(Boolean);
      v.label = [v.label, ...parts].filter(Boolean).join(' ');
      addText(top, v.label);
    } else if (vertices.get(v.cell.parent)?.shape !== 'row' && v.shape !== 'bar') addText(top, v.label);
  }

  // A free text laid over a shape belongs to it; one over nothing stays on its own.
  const solid = [...vertices.values()].filter((v) => !owner.has(v.cell.id) && v.shape !== 'text' && v.shape !== 'lifeline' && v.box.w > 0 && v.box.h > 0);
  const inside = (p, b, pad = 0) => p.x >= b.x - pad && p.x <= b.x + b.w + pad && p.y >= b.y - pad && p.y <= b.y + b.h + pad;
  const area = (b) => b.w * b.h;
  for (const v of vertices.values()) {
    if (v.shape !== 'text' || owner.has(v.cell.id) || !v.label) continue;
    const centre = { x: v.box.x + v.box.w / 2, y: v.box.y + v.box.h / 2 };
    const host = solid.filter((s) => s.shape !== 'container' && s.shape !== 'group' && inside(centre, s.box)).sort((a, b) => area(a.box) - area(b.box))[0];
    if (host) {
      owner.set(v.cell.id, host.cell.id);
      // A shape left empty and a text box laid on it is how many people label a shape.
      if (host.label) addText(host.cell.id, v.label);
      else host.label = v.label;
    }
  }

  // Sibling containers of one size that touch are lanes.
  const containers = [...vertices.values()].filter((v) => v.shape === 'container' && !owner.has(v.cell.id));
  markLanes(containers, (v) => v.cell.parent);

  // A single frame with a header that holds nearly every step of the page is a lane too
  // (an activity diagram of one actor); a frame that holds a few of them is a group.
  if (!containers.some((v) => v.shape === 'lane')) {
    const roots = containers.filter((v) => !vertices.has(v.cell.parent));
    const steps = [...vertices.values()].filter((v) => FLOW_SHAPES.has(v.shape) && !owner.has(v.cell.id));
    const within = (v, c) => { for (let at = v.cell.parent; vertices.has(at); at = vertices.get(at).cell.parent) if (at === c.cell.id) return true; return false; };
    if (roots.length === 1 && steps.length >= 3 && Object.hasOwn(roots[0].cell.style, 'swimlane') && steps.filter((v) => within(v, roots[0])).length >= 0.8 * steps.length) roots[0].shape = 'lane';
  }

  // Nodes.
  const nodes = [];
  for (const v of vertices.values()) {
    if (owner.has(v.cell.id)) continue;
    if (v.shape === 'text' && !v.label) continue;
    let parent = v.cell.parent;
    while (parent && parent !== '1' && owner.has(parent)) parent = ownerOf(parent);
    const node = { id: v.cell.id, label: v.label, shape: v.shape };
    if (v.detail) node.detail = v.detail;
    if (v.icon) node.icon = v.icon;
    if (v.group) node.group = v.group;
    if (vertices.has(parent)) node.parent = parent;
    if (v.cell.style.dashed === '1') node.dashed = true;
    const texts = textsOf.get(v.cell.id);
    if (texts) node.texts = texts;
    const link = /^data:page\/id,(.+)$/.exec(v.cell.link ?? '');
    if (link) node.link = link[1];
    else if (v.cell.link) node.link = v.cell.link;
    node.box = roundBox(v.box);
    nodes.push(node);
  }
  const nodeIds = new Set(nodes.map((n) => n.id));

  // Edges, with ends lifted to the thing they belong to, or guessed from where they stop.
  const endOf = (cellId, point, edge) => {
    if (cellId && vertices.has(cellId)) {
      const top = ownerOf(cellId);
      return { id: top, part: top !== cellId ? vertices.get(cellId).label || undefined : undefined };
    }
    if (!point) return {};
    const off = offsetOf(edge);
    const p = { x: point.x + off.x, y: point.y + off.y };
    const near = [...vertices.values()].filter((v) => nodeIds.has(v.cell.id) && v.shape !== 'text' && inside(p, v.box, NEAR));
    const best = near.filter((v) => v.shape !== 'container' && v.shape !== 'lane' && v.shape !== 'group').sort((a, b) => area(a.box) - area(b.box))[0]
      ?? near.sort((a, b) => area(a.box) - area(b.box))[0];
    return best ? { id: best.cell.id, inferred: true } : {};
  };
  const edges = [];
  for (const cell of cells) {
    if (!cell.edge) continue;
    const from = endOf(cell.source, cell.geo.sourcePoint, cell);
    const to = endOf(cell.target, cell.geo.targetPoint, cell);
    const edge = { id: cell.id, label: textOf(cell) };
    const extra = (edgeTexts.get(cell.id) ?? []).sort((a, b) => a.at - b.at);
    for (const t of extra) {
      if (t.at <= -0.5) edge.startLabel = edge.startLabel ? `${edge.startLabel}\n${t.text}` : t.text;
      else if (t.at >= 0.5) edge.endLabel = edge.endLabel ? `${edge.endLabel}\n${t.text}` : t.text;
      else edge.label = edge.label ? `${edge.label}\n${t.text}` : t.text;
    }
    edge.from = from.id ?? null;
    edge.to = to.id ?? null;
    if (from.part) edge.fromPart = from.part;
    if (to.part) edge.toPart = to.part;
    if (from.inferred) edge.fromInferred = true;
    if (to.inferred) edge.toInferred = true;
    const s = cell.style;
    if (s.dashed === '1') edge.dashed = true;
    const start = s.startArrow ?? 'none';
    const end = s.endArrow ?? 'classic';
    if (start !== 'none') edge.startArrow = arrowName(start, s.startFill);
    edge.endArrow = end === 'none' ? 'none' : arrowName(end, s.endFill);
    const off = offsetOf(cell);
    const ys = [cell.geo.points[0]?.y, cell.geo.sourcePoint?.y].filter((y) => y !== undefined);
    if (ys.length > 0) edge.y = Math.round(ys[0] + off.y);
    else if (edge.from && edge.to) {
      const a = vertices.get(edge.from).box;
      const b = vertices.get(edge.to).box;
      edge.y = Math.round((a.y + a.h / 2 + b.y + b.h / 2) / 2);
    }
    if (edge.from === null || edge.to === null) warnings.push(`edge "${cell.id}"${edge.label ? ` ("${edge.label.split('\n')[0]}")` : ''} has an end that touches no shape`);
    edges.push(edge);
  }

  const free = nodes.filter((n) => n.shape === 'text');
  if (free.length > 0) warnings.push(`${free.length} text box${free.length > 1 ? 'es stand' : ' stands'} over no shape: ${free.slice(0, 5).map((n) => `"${n.label.split('\n')[0]}"`).join(', ')}${free.length > 5 ? ', …' : ''}`);
  const inferred = edges.filter((e) => e.fromInferred || e.toInferred).length;
  if (inferred > 0) warnings.push(`${inferred} edge${inferred > 1 ? 's were' : ' was'} not connected in draw.io; ${inferred > 1 ? 'their ends were' : 'its end was'} taken from the shape it stops at (fromInferred / toInferred)`);
  const pictures = nodes.filter((n) => n.icon === 'drawio:image');
  if (pictures.length > 0) warnings.push(`${pictures.length} image${pictures.length > 1 ? 's' : ''} without a stencil name cannot be read`);

  return { id, name, kindHints: kindHints(nodes, edges), nodes, edges, warnings };
}

/**
 * Mark as lanes the frames that stand side by side or one above the other, touching, with
 * the same height (or width) and the same parent: the lanes of a pool or of an activity
 * diagram. A frame alone, or frames of different sizes, are groups.
 * @param {Array<{ shape: string, box: { x: number, y: number, w: number, h: number } }>} frames
 */
export function markLanes(frames, parentOf) {
  for (const group of Map.groupBy(frames, parentOf).values()) {
    if (group.length < 2) continue;
    for (const axis of ['x', 'y']) {
      const size = axis === 'x' ? 'h' : 'w';
      const along = axis === 'x' ? 'w' : 'h';
      const sorted = [...group].sort((a, b) => a.box[axis] - b.box[axis]);
      for (let i = 0; i < sorted.length; i++) {
        let j = i;
        while (j + 1 < sorted.length && Math.abs(sorted[j + 1].box[size] - sorted[i].box[size]) <= 2 && Math.abs(sorted[j + 1].box[axis] - (sorted[j].box[axis] + sorted[j].box[along])) <= 2) j++;
        if (j > i) for (let k = i; k <= j; k++) sorted[k].shape = 'lane';
        i = j;
      }
    }
  }
}

const roundBox = (b) => ({ x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) });

/** An arrow end in draw.io's words; an unfilled triangle or diamond says so. */
function arrowName(name, fill) {
  if (fill === '0' && /^(block|classic|diamond|diamondThin|oval)$/.test(name)) return `${name}-open`;
  return name;
}

/**
 * Which kinds a page looks like, best first, each with the evidence that scored it. The
 * agent proposes the best one in its opening question; the user decides.
 */
export function kindHints(nodes, edges) {
  const count = (pred) => nodes.filter(pred).length;
  const of = (shape) => count((n) => n.shape === shape);
  const scores = new Map();
  const add = (kind, points, evidence) => {
    if (points <= 0) return;
    const entry = scores.get(kind) ?? { kind, score: 0, evidence: [] };
    entry.score += points;
    entry.evidence.push(evidence);
    scores.set(kind, entry);
  };
  const plural = (n, word) => `${n} ${n === 1 ? word : /(x|s|ch|sh)$/.test(word) ? `${word}es` : /[^aeiou]y$/.test(word) ? `${word.slice(0, -1)}ies` : `${word}s`}`;

  const lifelines = of('lifeline');
  if (lifelines >= 2) add('sequence', 10 * lifelines, plural(lifelines, 'lifeline'));
  if (lifelines >= 2 && of('frame') > 0) add('sequence', 2 * of('frame'), plural(of('frame'), 'block frame'));

  const lanes = nodes.filter((n) => n.shape === 'lane');
  const laneIds = new Set(lanes.map((n) => n.id));
  const inLanes = count((n) => FLOW_SHAPES.has(n.shape) && laneIds.has(n.parent));
  if (lanes.length >= 1 && inLanes > 0) add('activity', 8 * lanes.length + inLanes, `${plural(lanes.length, 'lane')} holding ${plural(inLanes, 'step')}`);

  const tables = nodes.filter((n) => n.shape === 'table');
  // A member has a visibility sign, or is a method whose name stands right before its
  // parentheses ("pay(amount)"); a column type with a size ("decimal(12,2)") is neither.
  const memberLike = (t) => /^[+\-#~]\s*\S|^\s*\w+\s*\(.*\)|^«/.test(t);
  const keyLike = (t) => /\b(PK|FK|UK)\b|🔑/.test(t);
  const classes = tables.filter((n) => (n.texts ?? []).some(memberLike) || /«/.test(n.label));
  const entities = tables.filter((n) => !classes.includes(n) && (n.texts ?? []).some(keyLike));
  const plainTables = tables.filter((n) => !classes.includes(n) && !entities.includes(n) && (n.texts ?? []).length > 0);
  const erEnds = edges.filter((e) => /^ER/.test(e.startArrow ?? '') || /^ER/.test(e.endArrow ?? '')).length;
  const umlEnds = edges.filter((e) => /^(block-open|diamond|diamondThin|diamond-open|diamondThin-open)$/.test(e.endArrow ?? '') || /^(diamond|diamondThin)/.test(e.startArrow ?? '')).length;
  if (classes.length > 0) add('class', 8 * classes.length, `${plural(classes.length, 'box')} with members or a «stereotype»`);
  if (umlEnds > 0) add('class', 5 * umlEnds, `${plural(umlEnds, 'inheritance or composition end')}`);
  // A table weighs about as much as a decision: a page of eight steps and two tables beside
  // them is a flowchart with an ER part, not an ER diagram.
  if (entities.length > 0) add('er', 5 * entities.length, `${plural(entities.length, 'table')} with key columns`);
  if (plainTables.length > 0) add('er', 3 * plainTables.length, `${plural(plainTables.length, 'table')} with rows`);
  if (erEnds > 0) add('er', 3 * erEnds, `${plural(erEnds, 'relation')} with crow's-foot ends`);

  const initial = of('initial');
  const final = of('final');
  const decisions = of('decision');
  const rounded = of('rounded');
  const eventLabels = edges.filter((e) => /\[[^\]]+\]|\s\/\s/.test(e.label ?? '')).length;
  if (initial > 0 && lanes.length === 0 && lifelines < 2) add('state', 6 * initial + 2 * final + rounded, `${plural(initial, 'initial state')}${final ? `, ${plural(final, 'final state')}` : ''}${rounded ? `, ${plural(rounded, 'rounded box', )}` : ''}`);
  if (eventLabels > 0) add('state', 2 * eventLabels, `${plural(eventLabels, 'edge')} labelled "[guard]" or "event / action"`);

  const steps = count((n) => FLOW_SHAPES.has(n.shape) && !laneIds.has(n.parent));
  if (decisions > 0 && lanes.length === 0) add('flowchart', 4 * decisions + steps, `${plural(decisions, 'decision')} among ${plural(steps, 'step')}`);
  const flowExtras = of('io') + of('subroutine') + of('terminal') + of('document');
  if (flowExtras > 0 && lanes.length === 0) add('flowchart', 2 * flowExtras, `${plural(flowExtras, 'flowchart symbol')} (input/output, subroutine, terminal, document)`);
  if (decisions === 0 && initial === 0 && lanes.length === 0 && lifelines < 2 && tables.length === 0 && steps >= 2 && edges.length > 0 && of('icon') === 0) add('flowchart', steps, `${plural(steps, 'box')} joined by arrows`);

  const icons = of('icon');
  const groups = of('group');
  const infra = of('store') + of('client') + of('cloud') + count((n) => n.detail === 'hexagon');
  if (icons > 0) add('architecture', 6 * icons, `${plural(icons, 'service icon')}`);
  if (groups > 0) add('architecture', 4 * groups, `${plural(groups, 'cloud group frame')}`);
  if (infra > 0) add('architecture', 3 * infra, `${plural(infra, 'store, client, cloud or queue shape')}`);
  const plainContainers = of('container');
  if (plainContainers > 0 && (icons > 0 || infra > 0)) add('architecture', 2 * plainContainers, `${plural(plainContainers, 'boundary')}`);

  return [...scores.values()].sort((a, b) => b.score - a.score);
}
