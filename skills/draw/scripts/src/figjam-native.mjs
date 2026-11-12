import { brotliDecompressSync } from 'node:zlib';
import { parseAttrs } from './relabel.mjs';
import stencilData from './stencil-paths.json' with { type: 'json' };

/**
 * A FigJam board drawn at the coordinates of the draw.io file, as scripts for the Figma MCP
 * tool `use_figma`.
 *
 * Figma's generate_diagram lays a diagram out itself, has its own shapes and rejects class
 * and activity diagrams. This module reads the draw.io XML that `emitDrawio` wrote, so the
 * layout is never computed a second time, and turns every cell into a few plain drawings
 * (rectangle, ellipse, vector path, text) at the place the cell has in the file. An edge is a
 * vector along the draw.io route, not a connector: a connector picks its own route and cannot
 * end on a line or a label.
 *
 * All the knowledge about draw.io shapes is here, where it can be tested without Figma; the
 * part that runs inside Figma only creates what the data block lists. The pictograms of
 * draw.io's stencils (AWS services and groups, product logos, the client screen) come from
 * stencil-paths.json, which tools/generate-stencil-paths.mjs makes from draw.io's own bundle.
 */

let unpacked;
/**
 * Geometry of the stencils by the name a style gives them (`mxgraph.aws4.cloudfront`): the
 * box `w` x `h` of each and what it paints, path numbers counting `unit`s of that box. The
 * data file holds the table packed, so it is opened once, when a diagram first shows an icon.
 * @returns {Record<string, { w: number, h: number, a?: 1, s?: number, paint: Array<Array<string>> }>}
 */
export function stencilTable() {
  unpacked ??= JSON.parse(brotliDecompressSync(Buffer.from(stencilData.stencils, 'base64')).toString('utf8'));
  return unpacked;
}
const STENCIL_UNIT = stencilData.unit;

/** `use_figma` takes at most this many characters of code. */
export const SCRIPT_LIMIT = 50000;

/** Every node the script creates carries this name, so a second run can replace the first. */
export const NATIVE_TAG = 'zukai-native';

/** Free room between the border of the section and the drawing. */
const PAD = 40;

/** What draw.io uses when a style names nothing else. */
const BLACK = '000000';
const WHITE = 'ffffff';
const FONT_SIZE = 12;
const EDGE_FONT_SIZE = 11;
const MARKER_SIZE = 6;

const num = (v, fallback = 0) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? fallback : Number(v));
const round = (v) => Math.round(v * 100) / 100;

/** `a=b;c;d=e` as a map; a word without a value (swimlane, rhombus, text) maps to ''. */
function parseStyle(text) {
  const style = {};
  for (const part of text.split(';')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    if (eq < 0) style[part] = '';
    else style[part.slice(0, eq)] = part.slice(eq + 1);
  }
  return style;
}

/** A colour of a style as six hex digits, `null` for none, `fallback` when the style is silent. */
function colour(value, fallback) {
  if (value === undefined || value === 'default' || value === 'inherit') return fallback;
  if (value === 'none') return null;
  const m = /^#?([0-9a-fA-F]{6})$/.exec(value) ?? /^#?([0-9a-fA-F]{3})$/.exec(value);
  if (!m) return fallback;
  const hex = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return hex.toLowerCase();
}

const ENTITIES = { nbsp: ' ', quot: '"', apos: "'", gt: '>', lt: '<', amp: '&' };
const BOLD = 1;
const ITALIC = 2;

/**
 * An HTML label as text and the runs of it that are bold or italic: line breaks kept, every
 * other tag dropped, entities decoded. A run is [start, end, bits] with bit 1 bold and bit 2
 * italic; the runs cover the whole text in order.
 * @returns {{ text: string, runs: Array<[number, number, number]> }}
 */
export function richLabel(html) {
  const units = [];
  let bold = 0;
  let italic = 0;
  const push = (text) => { for (const unit of text.split('')) units.push([unit, (bold > 0 ? BOLD : 0) | (italic > 0 ? ITALIC : 0)]); };
  for (const m of String(html).matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)[^>]*>|&(#x[0-9a-fA-F]+|#\d+|[a-z]+);|[^<&]+|[<&]/g)) {
    if (m[2] !== undefined) {
      const tag = m[2].toLowerCase();
      const step = m[1] === '/' ? -1 : 1;
      if (tag === 'br') { if (step === 1) push('\n'); }
      else if (tag === 'b' || tag === 'strong') bold += step;
      else if (tag === 'i' || tag === 'em') italic += step;
      // A block ends its line; one that ends the label adds nothing, the end is trimmed below.
      else if ((tag === 'div' || tag === 'p') && step === -1 && units.at(-1)?.[0] !== '\n') push('\n');
    } else if (m[3] !== undefined) {
      const e = m[3];
      if (e.startsWith('#x')) push(String.fromCodePoint(parseInt(e.slice(2), 16)));
      else if (e.startsWith('#')) push(String.fromCodePoint(Number(e.slice(1))));
      else push(Object.hasOwn(ENTITIES, e) ? ENTITIES[e] : m[0]);
    } else push(m[0]);
  }
  // No blanks at the end of a line, none around the label.
  const kept = [];
  let lineEnd = true;
  for (let i = units.length - 1; i >= 0; i--) {
    const unit = units[i][0];
    if (lineEnd && (unit === ' ' || unit === '\t' || (unit === '\n' && kept.length === 0))) continue;
    lineEnd = unit === '\n';
    kept.unshift(units[i]);
  }
  while (kept.length > 0 && /\s/.test(kept[0][0])) kept.shift();
  const runs = [];
  kept.forEach(([, bits], i) => {
    if (runs.length > 0 && runs.at(-1)[2] === bits) runs.at(-1)[1] = i + 1;
    else runs.push([i, i + 1, bits]);
  });
  return { text: kept.map((u) => u[0]).join(''), runs };
}

/** The text of an HTML label alone. */
export const plainLabel = (html) => richLabel(html).text;

function parseGeometry(inside) {
  const g = /<mxGeometry\b([^>]*?)(\/?)>([\s\S]*?)(?:<\/mxGeometry>|$)/.exec(inside);
  if (!g) return { x: 0, y: 0, w: 0, h: 0, relative: false, points: [] };
  const a = parseAttrs(g[1]);
  const geo = { x: num(a.x), y: num(a.y), w: num(a.width), h: num(a.height), relative: a.relative === '1', points: [] };
  if (g[2] === '/') return geo;
  for (const p of g[3].matchAll(/<mxPoint\b([^>]*?)\/?>/g)) {
    const pa = parseAttrs(p[1]);
    const point = { x: num(pa.x), y: num(pa.y) };
    if (pa.as === undefined) geo.points.push(point);
    else geo[pa.as] = point;
  }
  return geo;
}

/**
 * The cells of the first page, in the order of the file (which is the order draw.io paints
 * them in). A cell with a link is wrapped in `UserObject`, which then carries id and label.
 * @returns {Array<{ id: string, value: string, style: Record<string, string>, parent: string, source?: string, target?: string, vertex: boolean, edge: boolean, geo: object }>}
 */
export function parseCells(xml) {
  const page = /<diagram\b[^>]*>([\s\S]*?)<\/diagram>/.exec(xml);
  const body = page ? page[1] : xml;
  const cells = [];
  const push = (a, inside) => {
    if (a.id === undefined || a.id === '0' || a.id === '1') return;
    cells.push({ id: a.id, value: a.value ?? '', style: parseStyle(a.style ?? ''), parent: a.parent ?? '1', source: a.source, target: a.target, vertex: a.vertex === '1', edge: a.edge === '1', geo: parseGeometry(inside) });
  };
  const re = /<(UserObject|object)\b([^>]*)>([\s\S]*?)<\/\1>|<mxCell\b([^>]*?)(\/?)>/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    if (m[1]) {
      const outer = parseAttrs(m[2]);
      const inner = /<mxCell\b([^>]*?)(\/?)>([\s\S]*)$/.exec(m[3]);
      if (inner) push({ ...parseAttrs(inner[1]), id: outer.id, value: outer.label ?? '' }, inner[2] === '/' ? '' : inner[3]);
      continue;
    }
    let inside = '';
    if (m[5] !== '/') {
      const end = body.indexOf('</mxCell>', re.lastIndex);
      if (end >= 0) { inside = body.slice(re.lastIndex, end); re.lastIndex = end; }
    }
    push(parseAttrs(m[4]), inside);
  }
  return cells;
}

/* ---- paths: a flat list of letters and numbers, every number pair a point ---- */

const polygon = (points) => [...points.flatMap((p, i) => [i === 0 ? 'M' : 'L', p.x, p.y]), 'Z'];
const polyline = (points) => points.flatMap((p, i) => [i === 0 ? 'M' : 'L', p.x, p.y]);
const segment = (x1, y1, x2, y2) => ['M', x1, y1, 'L', x2, y2];

/** The kind of a vertex: its `shape`, or the word its style starts with, or a plain box. */
function shapeOf(style) {
  if (style.shape) return style.shape;
  for (const word of ['swimlane', 'rhombus', 'ellipse', 'text', 'line', 'edgeLabel']) if (word in style) return word;
  return 'rect';
}

/**
 * Turn the cells into drawings in draw.io coordinates.
 * A drawing is one of
 *   ['r' | 'e', x, y, w, h, fill, stroke, radius, dashed, strokeWidth]   rectangle, ellipse
 *   ['p', path, fill, stroke, dashed, strokeWidth]                        vector path
 *   ['t', x, y, w, h, text, options]                                      text in a box (a point when w and h are 0)
 *   ['g', key, x, y, sx, sy, fill, stroke, strokeWidth]                   a stencil path: number n of it lies at x + n * sx, y + n * sy
 * with colours as six hex digits or 0 for none. The path of a 'g' is looked up by its key
 * (`<stencil name>#<index>`), so a script carries the picture of an icon once however often
 * the diagram shows it, in the short numbers of the stencil's own box.
 */
function drawCells(cells) {
  const byId = new Map(cells.map((c) => [c.id, c]));
  const items = [];
  const rect = (x, y, w, h, fill, stroke, { radius = 0, dashed = false, width = 1 } = {}) => items.push(['r', x, y, w, h, fill ?? 0, stroke ?? 0, radius, dashed ? 1 : 0, width]);
  const ellipse = (x, y, w, h, fill, stroke, width = 1) => items.push(['e', x, y, w, h, fill ?? 0, stroke ?? 0, 0, 0, width]);
  const path = (data, fill, stroke, { dashed = false, width = 1 } = {}) => items.push(['p', data, fill ?? 0, stroke ?? 0, dashed ? 1 : 0, width]);
  const text = (x, y, w, h, chars, options = {}) => { if (chars !== '') items.push(['t', x, y, w, h, chars, options]); };

  const boxes = new Map();
  /** A vertex in page coordinates: its own geometry plus that of every vertex it lies in. */
  const boxOf = (cell) => {
    if (boxes.has(cell.id)) return boxes.get(cell.id);
    const parent = byId.get(cell.parent);
    const base = parent && parent.vertex ? boxOf(parent) : { x: 0, y: 0 };
    const box = { x: base.x + cell.geo.x, y: base.y + cell.geo.y, w: cell.geo.w, h: cell.geo.h };
    boxes.set(cell.id, box);
    return box;
  };

  /** Font options every label shares: size, colour, bold and italic of the whole label. */
  const fontOf = (cell, size = FONT_SIZE) => {
    const s = cell.style;
    const o = {};
    if (num(s.fontSize, size) !== FONT_SIZE) o.f = num(s.fontSize, size);
    const c = colour(s.fontColor, BLACK);
    if (c && c !== BLACK) o.c = c;
    // The style of the cell holds for the whole label; a tag inside the label adds to it for its part.
    const runs = richLabel(cell.value).runs.map(([from, to, bits]) => [from, to, bits | (num(s.fontStyle) & (BOLD | ITALIC))]);
    const base = runs.length === 1 ? runs[0][2] : num(s.fontStyle) & (BOLD | ITALIC);
    if (base & BOLD) o.b = 1;
    if (base & ITALIC) o.i = 1;
    const parts = runs.filter((r) => r[2] !== base).map(([from, to, bits]) => [from, to, (bits & BOLD ? 'b' : '') + (bits & ITALIC ? 'i' : '')]);
    if (parts.length > 0) o.s = parts;
    const back = colour(s.labelBackgroundColor, null);
    if (back) o.g = back;
    return o;
  };
  const alignOf = (s, o, fallback = 'center') => {
    const a = s.align ?? fallback;
    if (a === 'left') o.a = 'l';
    if (a === 'right') o.a = 'r';
    return o;
  };
  /** The label inside a box, kept clear of the border as draw.io does (2 px plus the spacing of the style). */
  const labelIn = (cell, b, options = {}) => {
    const s = cell.style;
    const left = 2 + num(s.spacingLeft);
    const right = 2 + num(s.spacingRight);
    text(b.x + left, b.y, b.w - left - right, b.h, plainLabel(cell.value), alignOf(s, { ...fontOf(cell), ...options }));
  };
  /** The label under a shape, centred on it: as wide as its text, or wrapped at the `labelWidth` of the style. */
  const labelBelow = (cell, b) => {
    const wide = num(cell.style.labelWidth);
    text(b.x + (b.w - wide) / 2, b.y + b.h + 5, wide, 0, plainLabel(cell.value), { ...fontOf(cell), v: 't' });
  };

  /**
   * The pictogram of a stencil in the box given, as draw.io's mxStencil paints it: every path
   * scaled from the stencil's own box, a stencil of fixed proportions centred in the box.
   * `fill` and `stroke` are the colours of the cell; a path that names its own keeps them.
   * @returns {boolean} false when the stencil is not in the data, so the caller draws a stand-in
   */
  const stencil = (name, x, y, w, h, fill, stroke) => {
    const g = name !== undefined && Object.hasOwn(stencilTable(), name) ? stencilTable()[name] : undefined;
    if (!g) return false;
    let sx = w / g.w;
    let sy = h / g.h;
    let ox = x;
    let oy = y;
    if (g.a) {
      sx = Math.min(sx, sy);
      sy = sx;
      ox += (w - g.w * sx) / 2;
      oy += (h - g.h * sy) / 2;
    }
    const own = (set, cell) => (set === undefined || set === '' ? cell : set === 'none' ? null : set);
    g.paint.forEach(([mode, , ownFill, ownStroke], i) => {
      const f = mode === 's' ? null : own(ownFill, fill);
      const k = mode === 'f' ? null : own(ownStroke, stroke);
      if (f || k) items.push(['g', `${name}#${i}`, ox, oy, sx * STENCIL_UNIT, sy * STENCIL_UNIT, f ?? 0, k ?? 0, g.s ? g.s * Math.min(sx, sy) : 1]);
    });
    return true;
  };

  const vertex = (cell) => {
    const s = cell.style;
    const b = boxOf(cell);
    const kind = shapeOf(s);
    const fill = colour(s.fillColor, WHITE);
    const stroke = colour(s.strokeColor, BLACK);
    const line = { dashed: s.dashed === '1', width: num(s.strokeWidth, 1) };
    const { x, y, w, h } = b;
    const below = s.verticalLabelPosition === 'bottom';
    switch (kind) {
      case 'text':
        if (colour(s.fillColor, null) || colour(s.strokeColor, null)) rect(x, y, w, h, colour(s.fillColor, null), colour(s.strokeColor, null), line);
        labelIn(cell, b);
        return;
      case 'line':
        path(segment(x, y + h / 2, x + w, y + h / 2), null, stroke, line);
        return;
      case 'swimlane': {
        const start = num(s.startSize, 23);
        const upright = s.horizontal === '0';
        // draw.io rounds a swimlane by its header, not by its sides.
        const radius = s.rounded === '1' ? start * (num(s.arcSize, 15) / 100) * 3 : 0;
        rect(x, y, w, h, colour(s.swimlaneFillColor, null), stroke, { ...line, radius });
        const head = upright ? { x, y, w: start, h } : { x, y, w, h: start };
        if (colour(s.fillColor, null) && !radius) rect(head.x, head.y, head.w, head.h, fill, stroke, line);
        else path(upright ? segment(x + start, y, x + start, y + h) : segment(x, y + start, x + w, y + start), null, stroke, line);
        // The title of a swimlane is bold unless its style says otherwise.
        labelIn(cell, head, { ...(s.fontStyle === undefined ? { b: 1 } : {}), ...(upright ? { r: 1 } : {}) });
        return;
      }
      case 'rhombus':
        path(polygon([{ x: x + w / 2, y }, { x: x + w, y: y + h / 2 }, { x: x + w / 2, y: y + h }, { x, y: y + h / 2 }]), fill, stroke, line);
        labelIn(cell, b);
        return;
      case 'startState':
        ellipse(x, y, w, h, colour(s.fillColor, BLACK), stroke);
        return;
      case 'endState': {
        // The disc of draw.io's end state leaves a ring of 4 px in a circle of 30.
        const inset = Math.max(3, (w * 2) / 15);
        ellipse(x, y, w, h, WHITE, stroke);
        ellipse(x + inset, y + inset, w - 2 * inset, h - 2 * inset, colour(s.fillColor, BLACK), null);
        return;
      }
      case 'ellipse':
        ellipse(x, y, w, h, fill, stroke, line.width);
        labelIn(cell, b);
        return;
      case 'process': {
        const inset = w * num(s.size, 0.1);
        rect(x, y, w, h, fill, stroke, line);
        path([...segment(x + inset, y, x + inset, y + h), ...segment(x + w - inset, y, x + w - inset, y + h)], null, stroke, line);
        labelIn(cell, { x: x + inset, y, w: w - 2 * inset, h });
        return;
      }
      case 'parallelogram': {
        const slant = s.fixedSize === '1' ? num(s.size, 20) : w * num(s.size, 0.2);
        path(polygon([{ x: x + slant, y }, { x: x + w, y }, { x: x + w - slant, y: y + h }, { x, y: y + h }]), fill, stroke, line);
        labelIn(cell, b);
        return;
      }
      case 'hexagon': {
        const cut = s.fixedSize === '1' ? num(s.size, 20) : w * num(s.size, 0.25);
        path(polygon([{ x: x + cut, y }, { x: x + w - cut, y }, { x: x + w, y: y + h / 2 }, { x: x + w - cut, y: y + h }, { x: x + cut, y: y + h }, { x, y: y + h / 2 }]), fill, stroke, line);
        labelIn(cell, b);
        return;
      }
      case 'note': {
        const fold = num(s.size, 30);
        path(polygon([{ x, y }, { x: x + w - fold, y }, { x: x + w, y: y + fold }, { x: x + w, y: y + h }, { x, y: y + h }]), fill, stroke, line);
        path(polygon([{ x: x + w - fold, y }, { x: x + w - fold, y: y + fold }, { x: x + w, y: y + fold }]), 'e6e6e6', stroke, line);
        labelIn(cell, b);
        return;
      }
      case 'cylinder3': {
        // Half an ellipse as one cubic curve: control points 4/3 of the radius away reach the same height.
        const r = num(s.size, 15);
        const k = (4 / 3) * r;
        path(['M', x, y + r, 'C', x, y + r - k, x + w, y + r - k, x + w, y + r, 'L', x + w, y + h - r, 'C', x + w, y + h - r + k, x, y + h - r + k, x, y + h - r, 'Z'], fill, stroke, line);
        path(['M', x, y + r, 'C', x, y + r + k, x + w, y + r + k, x + w, y + r], null, stroke, line);
        labelIn(cell, { x, y: y + r, w, h: h - r });
        return;
      }
      case 'umlLifeline': {
        const head = num(s.size, 40);
        rect(x, y, w, head, fill, stroke, line);
        path(segment(x + w / 2, y + head, x + w / 2, y + h), null, stroke, { dashed: true });
        labelIn(cell, { x, y, w, h: head });
        return;
      }
      case 'umlFrame': {
        const tw = num(s.width, 60);
        const th = num(s.height, 30);
        const cut = Math.min(10, th / 2);
        rect(x, y, w, h, null, stroke, line);
        path(polyline([{ x: x + tw, y }, { x: x + tw, y: y + th - cut }, { x: x + tw - cut, y: y + th }, { x, y: y + th }]), null, stroke, line);
        labelIn(cell, { x, y, w: tw, h: th });
        return;
      }
      case 'umlActor': {
        const cx = x + w / 2;
        ellipse(x + w / 4, y, w / 2, h / 4, fill, stroke);
        path([...segment(cx, y + h / 4, cx, y + (2 * h) / 3), ...segment(x, y + h / 3, x + w, y + h / 3), ...segment(cx, y + (2 * h) / 3, x, y + h), ...segment(cx, y + (2 * h) / 3, x + w, y + h)], null, stroke);
        if (below) labelBelow(cell, b);
        return;
      }
      case 'mxgraph.aws4.group': {
        // The frame of an AWS group with its pictogram in the corner, in the colour of the frame.
        rect(x, y, w, h, colour(s.fillColor, null), s.grStroke === '0' ? null : stroke, line);
        if (stroke && !stencil(s.grIcon, x, y, num(s.grIconSize, 25), num(s.grIconSize, 25), stroke, null)) rect(x, y, 25, 25, stroke, null);
        const left = num(s.spacingLeft, 30);
        text(x + left, y, w - left - 4, 25, plainLabel(cell.value), alignOf(s, fontOf(cell), 'left'));
        return;
      }
      default: {
        if (kind.startsWith('mxgraph.')) {
          // An AWS service is a square of its colour with the pictogram in the colour of the line (white)
          // on it; any other stencil paints itself in the colours of the cell. One that is not in
          // the data is a neutral outline.
          if (kind === 'mxgraph.aws4.resourceIcon') {
            rect(x, y, w, h, fill ?? '888888', null);
            stencil(s.resIcon, x + w * 0.1, y + h * 0.1, w * 0.8, h * 0.8, stroke ?? WHITE, null);
          } else if (!stencil(kind, x, y, w, h, fill, stroke)) rect(x, y, w, h, WHITE, stroke && stroke !== WHITE ? stroke : '666666', { radius: 6 });
          if (below) labelBelow(cell, b);
          else labelIn(cell, b);
          return;
        }
        const radius = s.rounded === '1' ? Math.min(w, h) * (num(s.arcSize, 15) / 100) : 0;
        rect(x, y, w, h, fill, stroke, { ...line, radius });
        if (below) labelBelow(cell, b);
        else labelIn(cell, b);
      }
    }
  };

  /* ---- edges ---- */

  /** Where the line from the middle of a box to `p` leaves the box; on a lifeline, the point of its axis level with `p`. */
  const leave = (cell, p) => {
    const b = boxOf(cell);
    const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    if (cell.style.shape === 'umlLifeline') {
      // A message that starts or ends an activation bar touches the side of the bar, as in draw.io; any other runs to the axis.
      for (const bar of cells) {
        if (bar.parent !== cell.id || !bar.vertex) continue;
        const bb = boxOf(bar);
        if (Math.abs(p.y - bb.y) < 0.5 || Math.abs(p.y - bb.y - bb.h) < 0.5) return { x: p.x < c.x ? bb.x : bb.x + bb.w, y: p.y };
      }
      return { x: c.x, y: p.y };
    }
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    if (dx === 0 && dy === 0) return c;
    const t = Math.min(dx === 0 ? Infinity : b.w / 2 / Math.abs(dx), dy === 0 ? Infinity : b.h / 2 / Math.abs(dy));
    return { x: c.x + dx * t, y: c.y + dy * t };
  };
  const aligned = (a, b) => Math.abs(a.x - b.x) < 1 || Math.abs(a.y - b.y) < 1;
  const routes = new Map();
  /** The points of an edge as draw.io draws it: the two ends, the waypoints and the bends it adds between them. */
  const routeOf = (cell) => {
    if (routes.has(cell.id)) return routes.get(cell.id);
    const s = cell.style;
    const source = byId.get(cell.source);
    const target = byId.get(cell.target);
    const port = (end, prefix) => {
      if (!end || s[`${prefix}X`] === undefined) return null;
      const b = boxOf(end);
      return { x: b.x + num(s[`${prefix}X`]) * b.w + num(s[`${prefix}Dx`]), y: b.y + num(s[`${prefix}Y`]) * b.h + num(s[`${prefix}Dy`]) };
    };
    const way = cell.geo.points;
    const middleOf = (end) => { const b = boxOf(end); return { x: b.x + b.w / 2, y: b.y + b.h / 2 }; };
    const far = (other, fallback) => (other ? middleOf(other) : fallback);
    const start = port(source, 'exit') ?? (source ? leave(source, way[0] ?? far(target, cell.geo.targetPoint ?? middleOf(source))) : cell.geo.sourcePoint ?? { x: 0, y: 0 });
    const end = port(target, 'entry') ?? (target ? leave(target, way.at(-1) ?? start) : cell.geo.targetPoint ?? start);
    let points = [start, ...way, end];
    if (s.edgeStyle === 'orthogonalEdgeStyle') {
      // Between two points that share neither x nor y draw.io adds a bend when it renders. The
      // side a port lies on says which way the line leaves or arrives; in between, the line turns.
      const facesY = (prefix, fallback) => (s[`${prefix}X`] === undefined ? fallback : ['0', '1'].includes(s[`${prefix}Y`]) && !['0', '1'].includes(s[`${prefix}X`]));
      const out = [points[0]];
      for (let i = 1; i < points.length; i++) {
        const a = out.at(-1);
        const b = points[i];
        if (!aligned(a, b)) {
          const first = i === 1;
          const last = i === points.length - 1;
          const before = out.at(-2);
          const leavesY = first ? facesY('exit', true) : Math.abs(before.x - a.x) >= 1;
          if (first && last && leavesY === facesY('entry', leavesY)) {
            // Both ends face the same way: a step in the middle.
            if (leavesY) out.push({ x: a.x, y: (a.y + b.y) / 2 }, { x: b.x, y: (a.y + b.y) / 2 });
            else out.push({ x: (a.x + b.x) / 2, y: a.y }, { x: (a.x + b.x) / 2, y: b.y });
          } else if (last && !first ? !facesY('entry', !leavesY) : leavesY) out.push({ x: a.x, y: b.y });
          else out.push({ x: b.x, y: a.y });
        }
        out.push(b);
      }
      points = out;
    }
    routes.set(cell.id, points);
    return points;
  };

  /** The point at `fraction` (0..1) of the length of a route. */
  const along = (points, fraction) => {
    const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
    let rest = lengths.reduce((a, l) => a + l, 0) * Math.min(1, Math.max(0, fraction));
    for (let i = 0; i < lengths.length; i++) {
      if (rest <= lengths[i] || i === lengths.length - 1) {
        const t = lengths[i] === 0 ? 0 : rest / lengths[i];
        return { x: points[i].x + (points[i + 1].x - points[i].x) * t, y: points[i].y + (points[i + 1].y - points[i].y) * t };
      }
      rest -= lengths[i];
    }
    return points[0];
  };

  /** The end of an edge at `tip`, the line arriving from `from`. Sizes follow the markers of draw.io. */
  const marker = (type, tip, from, filled, size, stroke, width) => {
    if (!type || type === 'none') return;
    const d = Math.hypot(tip.x - from.x, tip.y - from.y) || 1;
    const u = { x: (tip.x - from.x) / d, y: (tip.y - from.y) / d };
    const n = { x: -u.y, y: u.x };
    const at = (back, side) => ({ x: tip.x - u.x * back + n.x * side, y: tip.y - u.y * back + n.y * side });
    const inside = filled ? stroke : WHITE;
    const L = size + width;
    switch (type) {
      case 'classic':
        path(polygon([at(0, 0), at(L, L / 2), at((L * 3) / 4, 0), at(L, -L / 2)]), inside, stroke, { width });
        return;
      case 'block':
        path(polygon([at(0, 0), at(L, L / 2), at(L, -L / 2)]), inside, stroke, { width });
        return;
      case 'open':
        path(polyline([at(L, L / 2), at(0, 0), at(L, -L / 2)]), null, stroke, { width });
        return;
      case 'diamond':
      case 'diamondThin': {
        const half = L / (type === 'diamondThin' ? 3.4 : 2);
        path(polygon([at(0, 0), at(L / 2, half), at(L, 0), at(L / 2, -half)]), inside, stroke, { width });
        return;
      }
      default: {
        if (!type.startsWith('ER')) return;
        // Entity-relationship ends: a bar for "one", a crow's foot for "many", a ring for "zero".
        const E = size + width + 1;
        const bar = (back) => segment(at(back, E / 2).x, at(back, E / 2).y, at(back, -E / 2).x, at(back, -E / 2).y);
        const foot = [...segment(at(E, 0).x, at(E, 0).y, at(0, E / 2).x, at(0, E / 2).y), ...segment(at(E, 0).x, at(E, 0).y, at(0, -E / 2).x, at(0, -E / 2).y)];
        const ring = () => { const c = at(1.5 * E, 0); ellipse(c.x - E / 2, c.y - E / 2, E, E, WHITE, stroke, width); };
        if (type === 'ERone') path(bar(E / 2), null, stroke, { width });
        else if (type === 'ERmandOne') path([...bar(E / 2), ...bar(E)], null, stroke, { width });
        else if (type === 'ERmany') path(foot, null, stroke, { width });
        else if (type === 'ERoneToMany') path([...foot, ...bar(E)], null, stroke, { width });
        else if (type === 'ERzeroToOne') { ring(); path(bar(E / 2), null, stroke, { width }); }
        else if (type === 'ERzeroToMany') { ring(); path(foot, null, stroke, { width }); }
      }
    }
  };

  const edge = (cell) => {
    const s = cell.style;
    const points = routeOf(cell);
    const stroke = colour(s.strokeColor, BLACK);
    const width = num(s.strokeWidth, 1);
    path(polyline(points), null, stroke, { dashed: s.dashed === '1', width });
    marker(s.startArrow, points[0], points[1], s.startFill !== '0', num(s.startSize, MARKER_SIZE), stroke, width);
    marker(s.endArrow ?? 'classic', points.at(-1), points.at(-2), s.endFill !== '0', num(s.endSize, MARKER_SIZE), stroke, width);
    const p = along(points, 0.5);
    // The label of the edge itself stands on the middle of the line, or a little above it so that its background leaves the line whole.
    const above = s.verticalAlign === 'bottom';
    text(p.x, p.y - (above ? 3 : 0), 0, 0, plainLabel(cell.value), { ...fontOf(cell, EDGE_FONT_SIZE), ...(above ? { v: 'b' } : {}) });
  };

  /** A label that belongs to an edge: a point of the route plus an offset; `align` says which side of it the text runs to. */
  const edgeLabel = (cell, owner) => {
    const p = along(routeOf(owner), (cell.geo.x + 1) / 2);
    const offset = cell.geo.offset ?? { x: 0, y: 0 };
    const o = alignOf(cell.style, fontOf(cell, EDGE_FONT_SIZE));
    // draw.io puts the page colour behind the label of an edge so that the line does not cross the text.
    if (!o.g) o.g = WHITE;
    text(p.x + offset.x, p.y + offset.y, 0, 0, plainLabel(cell.value), o);
  };

  for (const cell of cells) {
    const owner = byId.get(cell.parent);
    if (cell.edge) edge(cell);
    else if (cell.vertex && owner?.edge) edgeLabel(cell, owner);
    else if (cell.vertex) vertex(cell);
  }
  return items;
}

/** Room a text takes, for the size of the section only: Figma measures the real text itself. */
function textExtent(item) {
  const [, x, y, w, h, chars, o] = item;
  if (h > 0) return { minX: x, minY: y, maxX: x + w, maxY: y + h };
  const size = o.f ?? FONT_SIZE;
  const lines = chars.split('\n');
  const natural = Math.max(...lines.map((l) => l.length)) * size * 0.62;
  // A text with a width and no height (a label under an icon) wraps at that width and grows down.
  const tw = w > 0 ? w : natural;
  const th = (w > 0 ? Math.max(lines.length, Math.ceil(natural / w)) : lines.length) * size * 1.25;
  const left = w > 0 || o.a === 'l' ? x : o.a === 'r' ? x - tw : x - tw / 2;
  const top = o.v === 't' ? y : o.v === 'b' ? y - th : y - th / 2;
  return { minX: left, minY: top, maxX: left + tw, maxY: top + th };
}

function boundsOf(items) {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const extend = (x, y) => { b.minX = Math.min(b.minX, x); b.minY = Math.min(b.minY, y); b.maxX = Math.max(b.maxX, x); b.maxY = Math.max(b.maxY, y); };
  for (const item of items) {
    if (item[0] === 'p') {
      const numbers = item[1].filter((v) => typeof v === 'number');
      for (let i = 0; i < numbers.length; i += 2) extend(numbers[i], numbers[i + 1]);
    } else if (item[0] === 'g') {
      // The box the stencil was scaled into: a figure that is a stencil of its own has no other drawing.
      const g = stencilTable()[item[1].split('#')[0]];
      extend(item[2], item[3]);
      extend(item[2] + (g.w * item[4]) / STENCIL_UNIT, item[3] + (g.h * item[5]) / STENCIL_UNIT);
    } else if (item[0] === 't') {
      const e = textExtent(item);
      extend(e.minX, e.minY);
      extend(e.maxX, e.maxY);
    } else {
      extend(item[1], item[2]);
      extend(item[1] + item[3], item[2] + item[4]);
    }
  }
  return Number.isFinite(b.minX) ? b : { minX: 0, minY: 0, maxX: 0, maxY: 0 };
}

/** The same drawing moved by (dx, dy), numbers rounded and a path written as text. */
function place(item, dx, dy) {
  if (item[0] === 'p') {
    let isX = true;
    const data = item[1].map((v) => {
      if (typeof v !== 'number') { isX = true; return v; }
      const moved = round(v + (isX ? dx : dy));
      isX = !isX;
      return moved;
    }).join(' ');
    return ['p', data, ...item.slice(2)];
  }
  if (item[0] === 'g') {
    const [, key, x, y, sx, sy, fill, stroke, width] = item;
    // The scale keeps more digits than a coordinate: it is multiplied by numbers in the hundreds.
    return ['g', key, round(x + dx), round(y + dy), Math.round(sx * 1e5) / 1e5, Math.round(sy * 1e5) / 1e5, fill, stroke, round(width)];
  }
  const [kind, x, y, w, h, ...rest] = item;
  return [kind, round(x + dx), round(y + dy), round(w), round(h), ...rest.map((v) => (typeof v === 'number' ? round(v) : v))];
}

/**
 * @param {string} drawioXml the single-diagram file `emitDrawio` wrote
 * @param {{ title: string, limit?: number }} options the name of the section the board is drawn
 *   into, and the most characters one script may have (what `use_figma` takes, unless given)
 * @returns {{ parts: string[], offset: { x: number, y: number }, width: number, height: number }}
 *   `parts` are the scripts for `use_figma`, to be run in order (one unless the drawing is
 *   larger than `use_figma` takes at once); a point (x, y) of the draw.io file lies at
 *   (x + offset.x, y + offset.y) of the section, which is `width` by `height`.
 */
export function figjamNative(drawioXml, { title, limit = SCRIPT_LIMIT }) {
  const drawn = drawCells(parseCells(drawioXml));
  const b = boundsOf(drawn);
  // Whole pixels, so that a coordinate of the board differs from the one in the file by a round number.
  const offset = { x: Math.ceil(PAD - b.minX), y: Math.ceil(PAD - b.minY) };
  const items = drawn.map((item) => place(item, offset.x, offset.y));
  const width = Math.ceil(b.maxX + offset.x + PAD);
  const height = Math.ceil(b.maxY + offset.y + PAD);

  /** The stencil paths a list of drawings refers to, by key. */
  const stencilPath = (key) => { const [name, index] = key.split('#'); return stencilTable()[name].paint[index][1]; };
  const stencilsOf = (chunk) => Object.fromEntries([...new Set(chunk.filter((item) => item[0] === 'g').map((item) => item[1]))].map((key) => [key, stencilPath(key)]));
  const script = (chunk, part, parts) => `${RUNTIME_HEAD}const D = ${JSON.stringify({ title, part, parts, width, height, offset: [offset.x, offset.y], stencils: stencilsOf(chunk), items: chunk })};\n${RUNTIME}`;
  // Every part carries the whole runtime and the stencil paths its own drawings use, so each
  // one runs on its own; the room left is for the drawings.
  const room = limit - script([], 99, 99).length;
  const chunks = [[]];
  let used = 0;
  let carried = new Set();
  /** Characters an item adds to the part being filled: itself, and its stencil path when the part does not carry it yet. */
  const cost = (item) => JSON.stringify(item).length + 1 + (item[0] === 'g' && !carried.has(item[1]) ? JSON.stringify(item[1]).length + JSON.stringify(stencilPath(item[1])).length + 2 : 0);
  for (const item of items) {
    if (used + cost(item) > room && chunks.at(-1).length > 0) { chunks.push([]); used = 0; carried = new Set(); }
    used += cost(item);
    chunks.at(-1).push(item);
    if (item[0] === 'g') carried.add(item[1]);
  }
  return { parts: chunks.map((chunk, i) => script(chunk, i + 1, chunks.length)), offset, width, height };
}

const RUNTIME_HEAD = `// Zukai: draws a diagram on a FigJam board at the coordinates of its draw.io file.
// Pass this text unchanged to the Figma MCP tool use_figma, with the file key of the board.
// When there are several parts, run them in order.
`;

/* The part that runs inside Figma. Plain JavaScript with top-level await and return, as
 * use_figma expects. A child of a section has coordinates of the section, and a vector keeps
 * the coordinates its path is written in, so nothing here knows where the section lies. */
const RUNTIME = String.raw`const TAG = '${NATIVE_TAG}';
const page = figma.currentPage;
const isOurs = (n) => n.type === 'SECTION' && n.name === D.title && (n.children.length === 0 || n.children.some((c) => c.name === TAG));
let S = page.children.filter(isOurs).pop();
let replaced = 0;
if (D.part === 1) {
  if (S) {
    const old = S.children.filter((c) => c.name === TAG);
    replaced = old.length;
    for (const n of old) n.remove();
  } else {
    const others = page.children;
    S = figma.createSection();
    S.name = D.title;
    S.x = others.length === 0 ? 0 : Math.max(...others.map((n) => n.x + n.width)) + 200;
    S.y = others.length === 0 ? 0 : Math.min(...others.map((n) => n.y));
  }
  S.resizeWithoutConstraints(D.width, D.height);
  S.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
} else if (!S || S.children.length === 0) {
  throw new Error('zukai native: no section named "' + D.title + '" drawn by part 1 on this board; run part 1 first. Nothing was changed.');
}

// Arimo has the widths of Helvetica and Arial, the faces draw.io sizes its boxes for.
const FONT = 'Arimo';
const fonts = { '': 'Regular', b: 'Bold', i: 'Italic', bi: 'Bold Italic' };
for (const style of Object.values(fonts)) await figma.loadFontAsync({ family: FONT, style });
const paint = (hex) => (hex ? [{ type: 'SOLID', color: { r: parseInt(hex.slice(0, 2), 16) / 255, g: parseInt(hex.slice(2, 4), 16) / 255, b: parseInt(hex.slice(4, 6), 16) / 255 } }] : []);
let created = 0;
const add = (n) => { S.appendChild(n); n.name = TAG; created++; return n; };
const outline = (n, stroke, dashed, width) => {
  n.strokes = paint(stroke);
  if (!stroke) return;
  n.strokeWeight = width || 1;
  if (dashed) n.dashPattern = [3, 3];
};

const vector = (data, fill, stroke, dashed, width) => {
  const n = add(figma.createVector());
  n.vectorPaths = [{ windingRule: fill ? 'NONZERO' : 'NONE', data }];
  n.fills = paint(fill);
  outline(n, stroke, dashed, width);
};

for (const item of D.items) {
  const kind = item[0];
  if (kind === 'g') {
    // A stencil path is written in the numbers of the stencil's own box: scale and move each into the section.
    const [, key, x, y, sx, sy, fill, stroke, width] = item;
    let isX = true;
    const data = D.stencils[key].split(' ').map((token) => {
      if (Number.isNaN(Number(token))) { isX = true; return token; }
      const v = isX ? x + token * sx : y + token * sy;
      isX = !isX;
      return Math.round(v * 100) / 100;
    }).join(' ');
    vector(data, fill, stroke, 0, width);
  } else if (kind === 'r' || kind === 'e') {
    const [, x, y, w, h, fill, stroke, radius, dashed, width] = item;
    const n = add(kind === 'r' ? figma.createRectangle() : figma.createEllipse());
    n.x = x;
    n.y = y;
    n.resize(Math.max(w, 0.01), Math.max(h, 0.01));
    n.fills = paint(fill);
    n.strokeAlign = 'CENTER';
    outline(n, stroke, dashed, width);
    if (radius) n.cornerRadius = radius;
  } else if (kind === 'p') {
    const [, data, fill, stroke, dashed, width] = item;
    vector(data, fill, stroke, dashed, width);
  } else {
    const [, x, y, w, h, chars, o] = item;
    // The background of a label is created first so that it lies under the text.
    const back = o.g ? add(figma.createRectangle()) : null;
    const t = add(figma.createText());
    t.fontName = { family: FONT, style: fonts[(o.b ? 'b' : '') + (o.i ? 'i' : '')] };
    t.fontSize = o.f || 12;
    t.characters = chars;
    // A part of the label that is bold or italic on its own.
    for (const [from, to, key] of o.s || []) t.setRangeFontName(from, to, { family: FONT, style: fonts[key] });
    t.fills = paint(o.c || '000000');
    t.textAlignHorizontal = o.a === 'l' ? 'LEFT' : o.a === 'r' ? 'RIGHT' : 'CENTER';
    // A text wider than its box was wrapped in draw.io and is wrapped here, at the same width.
    const room = o.r ? h : w;
    if (room > 0 && t.width > room) { t.textAutoResize = 'HEIGHT'; t.resize(room, t.height); }
    if (o.r) {
      // Turned a quarter, the text reads upwards and its box grows up and to the right of (x, y).
      t.rotation = 90;
      t.x = x + (w - t.height) / 2;
      t.y = y + (h + t.width) / 2;
    } else {
      t.x = o.a === 'l' ? x : o.a === 'r' ? x + w - t.width : x + (w - t.width) / 2;
      t.y = o.v === 't' ? y : o.v === 'b' ? y + h - t.height : y + (h - t.height) / 2;
    }
    if (back) {
      back.x = t.x - 2;
      back.y = t.y;
      back.resize(t.width + 4, t.height);
      back.fills = paint(o.g);
      back.strokes = [];
    }
  }
}
return { section: S.id, name: S.name, part: D.part, parts: D.parts, created, replaced };
`;
