/**
 * Build the geometry of the stencils the emitters name, from draw.io's own stencil bundle, so
 * the native FigJam board can draw the pictogram of an AWS service, the corner icon of an AWS
 * group, a product logo and the client screen instead of a stand-in.
 *
 * Usage: node tools/generate-stencil-paths.mjs <path to stencils.min.js> [tag]
 *
 * The input is a local file; nothing is fetched. Download it for the pinned tag from
 *   https://raw.githubusercontent.com/jgraph/drawio/<tag>/src/main/webapp/js/stencils.min.js
 * The file is read as text and never evaluated: the stencil libraries are picked out of it as
 * string literals and decoded here (the decoder is a port of the one at the end of that file).
 *
 * Writes src/stencil-paths.json (bundled, read by figjam-native.mjs): per stencil its own box
 * `w` x `h` and what it paints, each a path in that box (numbers in tenths of a unit) with
 * only M, L, Q, C and Z, because that is all a Figma vector takes. Arcs, rectangles and
 * ellipses are converted here. The table of stencils is 0.7 MB as JSON, which would take the
 * committed bundle past its size budget, so the file holds it packed (`packStencils`); the
 * source it was made from and the number of stencils stay readable beside it.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync, brotliCompressSync, brotliDecompressSync, constants } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_TAG = 'v32.6.10';
const SOURCE_PATH = 'src/main/webapp/js/stencils.min.js';

/** Elements whose x and y attributes are coordinates, each kept as a running sum in its own stream. */
const DRAWS = new Set(['move', 'line', 'quad', 'curve', 'arc', 'rect', 'roundrect', 'ellipse', 'text', 'image', 'include-shape']);
const XS = new Set(['x', 'x1', 'x2', 'x3']);
const YS = new Set(['y', 'y1', 'y2', 'y3']);

/**
 * Decode one stencil library of the bundle into its element tree.
 * The value is base64 of a raw-deflated block: five big-endian uint32 lengths, then five
 * streams (element and attribute codes, x values, y values, other numbers, NUL-separated
 * strings). A number is a zigzag varint, the difference to the previous number of its kind,
 * in thousandths.
 * @param {string} base64
 * @returns {{ name: string, attrs: Record<string, string>, children: Array<object> }} the root element (`shapes`)
 */
export function decodeStencils(base64) {
  const data = inflateRawSync(Buffer.from(base64, 'base64'));
  const streams = [];
  for (let i = 0, offset = 20; i < 5; i++) {
    const length = data.readUInt32BE(4 * i);
    streams.push(data.subarray(offset, offset + length));
    offset += length;
  }
  const ops = streams[0];
  const strings = new TextDecoder().decode(streams[4]).split('\0');
  const at = [0, 0, 0, 0];
  let nextString = 0;
  const read = (k) => {
    let n = 0;
    let scale = 1;
    let byte;
    do {
      byte = streams[k][at[k]++];
      n += (byte & 127) * scale;
      scale *= 128;
    } while (byte & 128);
    return n % 2 === 1 ? -(n + 1) / 2 : n / 2;
  };
  const names = [];
  const attrNames = [];
  const root = { name: null, attrs: {}, children: [] };
  const stack = [root];
  let px = 0;
  let py = 0;
  let others = new Map();
  while (at[0] < ops.length) {
    const op = ops[at[0]++];
    if (op === 255) { stack.pop(); continue; }
    if (op >> 1 === names.length) names.push(strings[nextString++]);
    const name = names[op >> 1];
    const node = { name, attrs: {}, children: [] };
    stack.at(-1).children.push(node);
    const count = ops[at[0]++];
    // The running sums start anew with every shape.
    if (name === 'shape') { px = 0; py = 0; others = new Map(); }
    for (let i = 0; i < count; i++) {
      const id = ops[at[0]++];
      if (id === attrNames.length) attrNames.push(strings[nextString++]);
      const attr = attrNames[id];
      if (ops[at[0]++] === 0) node.attrs[attr] = strings[nextString++];
      else if (DRAWS.has(name) && XS.has(attr)) { px += read(1); node.attrs[attr] = String(px / 1000); }
      else if (DRAWS.has(name) && YS.has(attr)) { py += read(2); node.attrs[attr] = String(py / 1000); }
      else {
        const key = `${name} ${attr}`;
        const next = (others.get(key) ?? 0) + read(3);
        others.set(key, next);
        node.attrs[attr] = String(next / 1000);
      }
    }
    // An odd code is an element without children.
    if (!(op & 1)) stack.push(node);
  }
  return root.children[0];
}

const r2 = (v) => Math.round(v * 100) / 100;
/**
 * Path numbers are written as whole tenths of a stencil unit (`431` for 43.1): a tenth is under
 * a tenth of a pixel at the sizes the emitters draw an icon in, and a number without a point
 * is a character shorter, in the data file and in every script that carries the path.
 */
export const PATH_UNIT = 0.1;
const tenths = (v) => Math.round(v / PATH_UNIT);

/**
 * An elliptical arc of SVG and mxStencil (`rx ry rotation large-arc sweep x y`) from (x0, y0),
 * as cubic curves: one for each quarter turn or less.
 * @returns {number[][]} per curve [x1, y1, x2, y2, x, y]
 */
export function arcToCubics(x0, y0, rx, ry, rotation, largeArc, sweep, x, y) {
  if ((x0 === x && y0 === y) || rx === 0 || ry === 0) return [[x0, y0, x, y, x, y]];
  const phi = (rotation * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x0 - x) / 2;
  const dy = (y0 - y) / 2;
  const x1 = cos * dx + sin * dy;
  const y1 = -sin * dx + cos * dy;
  let a = Math.abs(rx);
  let b = Math.abs(ry);
  // Radii too small to reach the end point are scaled up until they do.
  const lambda = (x1 * x1) / (a * a) + (y1 * y1) / (b * b);
  if (lambda > 1) { a *= Math.sqrt(lambda); b *= Math.sqrt(lambda); }
  const num = a * a * b * b - a * a * y1 * y1 - b * b * x1 * x1;
  const den = a * a * y1 * y1 + b * b * x1 * x1;
  const k = (largeArc === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cx1 = (k * a * y1) / b;
  const cy1 = (-k * b * x1) / a;
  const cx = cos * cx1 - sin * cy1 + (x0 + x) / 2;
  const cy = sin * cx1 + cos * cy1 + (y0 + y) / 2;
  const angle = (ux, uy) => Math.atan2(uy, ux);
  const start = angle((x1 - cx1) / a, (y1 - cy1) / b);
  let sweepAngle = angle((-x1 - cx1) / a, (-y1 - cy1) / b) - start;
  if (sweep && sweepAngle < 0) sweepAngle += 2 * Math.PI;
  if (!sweep && sweepAngle > 0) sweepAngle -= 2 * Math.PI;
  const pieces = Math.max(1, Math.ceil(Math.abs(sweepAngle) / (Math.PI / 2) - 1e-9));
  const step = sweepAngle / pieces;
  const t = (4 / 3) * Math.tan(step / 4);
  const point = (theta, ox, oy) => {
    const ex = a * (Math.cos(theta) + ox);
    const ey = b * (Math.sin(theta) + oy);
    return [cx + cos * ex - sin * ey, cy + sin * ex + cos * ey];
  };
  const curves = [];
  for (let i = 0; i < pieces; i++) {
    const t0 = start + i * step;
    const t1 = t0 + step;
    const c1 = point(t0, -t * Math.sin(t0), t * Math.cos(t0));
    const c2 = point(t1, t * Math.sin(t1), -t * Math.cos(t1));
    // The last curve ends on the point the stencil names, not on a rounded neighbour of it.
    const end = i === pieces - 1 ? [x, y] : point(t1, 0, 0);
    curves.push([...c1, ...c2, ...end]);
  }
  return curves;
}

const n = (attrs, key) => Number(attrs[key] ?? 0);

/** A rectangle with corners of radius r (0 for none) as path commands. */
function roundRect(x, y, w, h, r) {
  if (r <= 0) return ['M', x, y, 'L', x + w, y, 'L', x + w, y + h, 'L', x, y + h, 'Z'];
  const k = r * 0.5523;
  return ['M', x + r, y, 'L', x + w - r, y, 'C', x + w - r + k, y, x + w, y + r - k, x + w, y + r, 'L', x + w, y + h - r, 'C', x + w, y + h - r + k, x + w - r + k, y + h, x + w - r, y + h,
    'L', x + r, y + h, 'C', x + r - k, y + h, x, y + h - r + k, x, y + h - r, 'L', x, y + r, 'C', x, y + r - k, x + r - k, y, x + r, y, 'Z'];
}

function ellipse(x, y, w, h) {
  const rx = w / 2;
  const ry = h / 2;
  const cx = x + rx;
  const cy = y + ry;
  const kx = rx * 0.5523;
  const ky = ry * 0.5523;
  return ['M', cx - rx, cy, 'C', cx - rx, cy - ky, cx - kx, cy - ry, cx, cy - ry, 'C', cx + kx, cy - ry, cx + rx, cy - ky, cx + rx, cy, 'C', cx + rx, cy + ky, cx + kx, cy + ry, cx, cy + ry, 'C', cx - kx, cy + ry, cx - rx, cy + ky, cx - rx, cy, 'Z'];
}

/** The commands of a `path` element, arcs as curves. */
function pathCommands(node) {
  const out = [];
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  for (const c of node.children) {
    const a = c.attrs;
    if (c.name === 'move') { cx = n(a, 'x'); cy = n(a, 'y'); sx = cx; sy = cy; out.push('M', cx, cy); }
    else if (c.name === 'line') { cx = n(a, 'x'); cy = n(a, 'y'); out.push('L', cx, cy); }
    else if (c.name === 'quad') { out.push('Q', n(a, 'x1'), n(a, 'y1'), n(a, 'x2'), n(a, 'y2')); cx = n(a, 'x2'); cy = n(a, 'y2'); }
    else if (c.name === 'curve') { out.push('C', n(a, 'x1'), n(a, 'y1'), n(a, 'x2'), n(a, 'y2'), n(a, 'x3'), n(a, 'y3')); cx = n(a, 'x3'); cy = n(a, 'y3'); }
    else if (c.name === 'arc') {
      for (const curve of arcToCubics(cx, cy, n(a, 'rx'), n(a, 'ry'), n(a, 'x-axis-rotation'), n(a, 'large-arc-flag') !== 0, n(a, 'sweep-flag') !== 0, n(a, 'x'), n(a, 'y'))) out.push('C', ...curve);
      cx = n(a, 'x');
      cy = n(a, 'y');
    } else if (c.name === 'close') { out.push('Z'); cx = sx; cy = sy; }
  }
  return out;
}

const hex = (value) => (/^#[0-9a-fA-F]{6}$/.test(value ?? '') ? value.slice(1).toLowerCase() : value === 'none' ? 'none' : undefined);

/**
 * What a `shape` element paints, in the order it paints it. Each entry is `[mode, path]`,
 * `[mode, path, fill, stroke]` or, for a fill that is not opaque, `[mode, path, fill, stroke,
 * alpha]`: mode `f` fills, `s` strokes, `b` does both;
 * a colour is given only where the stencil sets one itself (six hex digits or `none`),
 * otherwise the colours of the cell apply. Paths painted alike, one after the other, are
 * joined into one.
 * `a: 1` marks a stencil that keeps its proportions when its cell has others; `s` is the
 * stroke width of a stencil that sets its own.
 * @returns {{ w: number, h: number, a?: 1, s?: number, paint: Array<Array<string>> }}
 */
export function shapeGeometry(shape) {
  const paint = [];
  let current = null;
  let state = { fill: undefined, stroke: undefined, alpha: 1 };
  const saved = [];
  /**
   * The same commands with every part closed. A fill closes an open part by itself in draw.io;
   * a Figma vector does not count an open part as an area, so a hole left open would be filled.
   */
  const closed = (commands) => {
    const out = [];
    commands.forEach((c, i) => {
      if (c === 'M' && i > 0 && out.at(-1) !== 'Z') out.push('Z');
      out.push(c);
    });
    if (out.at(-1) !== 'Z') out.push('Z');
    return out;
  };
  const emit = (mode) => {
    if (!current || current.length === 0) return;
    const data = (mode === 'f' ? closed(current) : current).map((v) => (typeof v === 'number' ? tenths(v) : v)).join(' ');
    const last = paint.at(-1);
    const alpha = mode === 's' ? 1 : state.alpha;
    const colours = alpha !== 1 || state.fill !== undefined || state.stroke !== undefined ? [state.fill ?? '', state.stroke ?? ''] : [];
    // Two fills that overlap would cancel nothing under the non-zero rule, so they may share one path.
    if (last && last[0] === mode && mode === 'f' && alpha === 1 && last.length < 5 && (last[2] ?? '') === (colours[0] ?? '') && (last[3] ?? '') === (colours[1] ?? '')) last[1] += ` ${data}`;
    else paint.push([mode, data, ...colours, ...(alpha !== 1 ? [alpha] : [])]);
  };
  const walk = (nodes) => {
    for (const c of nodes) {
      const a = c.attrs;
      switch (c.name) {
        case 'path': current = pathCommands(c); break;
        case 'rect': current = roundRect(n(a, 'x'), n(a, 'y'), n(a, 'w'), n(a, 'h'), 0); break;
        case 'roundrect': current = roundRect(n(a, 'x'), n(a, 'y'), n(a, 'w'), n(a, 'h'), (Math.min(n(a, 'w'), n(a, 'h')) * n(a, 'arcsize')) / 100); break;
        case 'ellipse': current = ellipse(n(a, 'x'), n(a, 'y'), n(a, 'w'), n(a, 'h')); break;
        case 'fill': emit('f'); break;
        case 'stroke': emit('s'); break;
        case 'fillstroke': emit('b'); break;
        // A colour may name a key of the cell style (`fillColor2`) with a default; no emitter sets such a key, so the default holds.
        case 'fillcolor': state.fill = hex(a.color) ?? hex(a.default); break;
        case 'strokecolor': state.stroke = hex(a.color) ?? hex(a.default); break;
        case 'alpha':
        case 'fillalpha': state.alpha = Number(a.alpha); break;
        case 'save': saved.push({ ...state }); break;
        case 'restore': state = saved.pop() ?? state; break;
        default: break;
      }
    }
  };
  for (const part of ['background', 'foreground']) walk(shape.children.find((c) => c.name === part)?.children ?? []);
  const width = Number(shape.attrs.strokewidth);
  return { w: r2(n(shape.attrs, 'w')), h: r2(n(shape.attrs, 'h')), ...(shape.attrs.aspect === 'fixed' ? { a: 1 } : {}), ...(Number.isFinite(width) && width !== 1 ? { s: width } : {}), paint };
}

/** The table of stencils as the data file holds it: its JSON, Brotli-compressed, as base64. */
export const packStencils = (stencils) => brotliCompressSync(Buffer.from(JSON.stringify(stencils)), { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_LGWIN]: 24 } }).toString('base64');
/** The table of stencils back from the data file. */
export const unpackStencils = (packed) => JSON.parse(brotliDecompressSync(Buffer.from(packed, 'base64')).toString('utf8'));

/** The name draw.io registers a shape under: package and shape name, lower case, blanks as underscores. */
const registryName = (pack, shape) => `${pack}.${shape}`.replace(/ /g, '_').toLowerCase();

/**
 * Every stencil of one library of the bundle, by registered name.
 * @param {string} source text of stencils.min.js
 * @param {string} file e.g. `aws4.xml`
 */
export function libraryStencils(source, file) {
  const start = source.indexOf(`f['${file}'] = '`);
  if (start < 0) throw new Error(`no stencil library "${file}" in the bundle`);
  const from = start + `f['${file}'] = '`.length;
  const root = decodeStencils(source.slice(from, source.indexOf("'", from)));
  const out = new Map();
  for (const shape of root.children) if (shape.name === 'shape') out.set(registryName(root.attrs.name, shape.attrs.name), shape);
  return out;
}

/** The stencil names the emitters can write: service and resource icons, group corner icons, product logos, the client screen. */
export function wantedStencils(catalog) {
  const names = new Set(['mxgraph.networks.monitor']);
  for (const name of Object.keys(catalog.icons)) names.add(`mxgraph.aws4.${name}`);
  for (const group of Object.values(catalog.groups)) {
    const icon = /grIcon=([\w.]+)/.exec(group.style)?.[1];
    if (icon) names.add(icon);
  }
  for (const name of Object.keys(catalog.logos ?? {})) names.add(`mxgraph.gcp2.${name}`);
  return [...names].sort();
}

const LIBRARIES = { 'mxgraph.aws4': 'aws4.xml', 'mxgraph.gcp2': 'gcp2.xml', 'mxgraph.networks': 'networks.xml' };

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [file, tag = DEFAULT_TAG] = process.argv.slice(2);
  if (!file) {
    console.error('usage: node tools/generate-stencil-paths.mjs <path to stencils.min.js> [tag]');
    process.exit(1);
  }
  const bytes = readFileSync(file);
  const source = bytes.toString('utf8');
  const catalog = JSON.parse(readFileSync(join(here, '..', 'src', 'aws-icons.json'), 'utf8'));
  const libraries = new Map();
  const stencils = {};
  const missing = [];
  for (const name of wantedStencils(catalog)) {
    const pack = name.slice(0, name.lastIndexOf('.'));
    if (!libraries.has(pack)) libraries.set(pack, libraryStencils(source, LIBRARIES[pack]));
    const shape = libraries.get(pack).get(name);
    if (shape) stencils[name] = shapeGeometry(shape);
    else missing.push(name);
  }
  const out = { source: { repo: 'jgraph/drawio', tag, path: SOURCE_PATH, sha256: createHash('sha256').update(bytes).digest('hex') }, unit: PATH_UNIT, count: Object.keys(stencils).length, packed: 'brotli+base64', stencils: packStencils(stencils) };
  const target = join(here, '..', 'src', 'stencil-paths.json');
  writeFileSync(target, `${JSON.stringify(out, null, 1)}\n`, 'utf8');
  console.log(`wrote ${target}: ${out.count} stencils, ${JSON.stringify(stencils).length} characters of JSON packed into ${out.stencils.length}`);
  if (missing.length > 0) console.log(`not in the bundle (drawn as a stand-in): ${missing.join(', ')}`);
}
