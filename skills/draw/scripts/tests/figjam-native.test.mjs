import { describe, it, expect } from 'vitest';
import { emit } from '../src/pipeline.mjs';
import { figjamNative, parseCells, plainLabel, richLabel, NATIVE_TAG, SCRIPT_LIMIT } from '../src/figjam-native.mjs';
import { checkDrawioStructure } from './drawio-structure.mjs';
import { loadFixture, validFixtures } from './helpers.mjs';

/**
 * A stand-in for a FigJam page: nodes keep what the script sets, a text measures itself by
 * its characters and size, and a section holds its children. Enough to run the script and
 * read back what it drew and where.
 */
function fakeBoard(existing = []) {
  let seq = 0;
  const page = { children: [] };
  const make = (type) => {
    const n = {
      id: `1:${++seq}`, type, name: type, x: 0, y: 0, width: 100, height: 100, rotation: 0,
      resize(w, h) { this.width = w; this.height = h; },
      resizeWithoutConstraints(w, h) { this.width = w; this.height = h; },
      remove() { const p = this.parent ?? page; p.children = p.children.filter((c) => c !== this); },
    };
    if (type === 'SECTION') {
      n.children = [];
      n.appendChild = (c) => { c.parent = n; n.children.push(c); };
      page.children.push(n);
    }
    if (type === 'TEXT') {
      // One line as wide as its characters, unless the script fixed the width to wrap it.
      n.fontSize = 12;
      n.characters = '';
      const lines = () => n.characters.split('\n');
      Object.defineProperty(n, 'width', { get() { return this.fixed ?? Math.max(...lines().map((l) => l.length)) * this.fontSize * 0.55; }, set() {} });
      Object.defineProperty(n, 'height', { get() { return lines().length * this.fontSize * 1.25 * (this.fixed ? Math.ceil((Math.max(...lines().map((l) => l.length)) * this.fontSize * 0.55) / this.fixed) : 1); }, set() {} });
      n.resize = function resize(w) { this.fixed = w; };
      n.ranges = [];
      n.setRangeFontName = function setRangeFontName(from, to, font) { this.ranges.push([this.characters.slice(from, to), font.family, font.style]); };
    }
    return n;
  };
  for (const e of existing) page.children.push({ type: 'SHAPE_WITH_TEXT', name: 'other', children: [], ...e });
  const figma = {
    currentPage: page,
    loaded: [],
    async loadFontAsync(font) { this.loaded.push(`${font.family} ${font.style}`); },
    createSection: () => make('SECTION'),
    createText: () => make('TEXT'),
    createRectangle: () => make('RECTANGLE'),
    createEllipse: () => make('ELLIPSE'),
    createVector: () => make('VECTOR'),
  };
  return { figma, page };
}

const AsyncFunction = (async () => {}).constructor;
const runOn = (script, figma) => new AsyncFunction('figma', script)(figma);
const runAll = async (parts, figma) => { const out = []; for (const p of parts) out.push(await runOn(p, figma)); return out; };

/** The draw.io file of a fixture; the adversarial labels need the user's word that they hold no secret. */
async function drawioOf(ir) {
  const r = await emit(ir, 'drawio', { allowSensitive: true });
  expect(r.errors).toEqual([]);
  return r.output;
}

/** Label text as a reader of the draw.io file sees it, written apart from the module under test. */
const shown = (html) => String(html ?? '').replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&').trim();
const styleOf = (c) => Object.fromEntries(String(c.style ?? '').split(';').filter(Boolean).map((p) => (p.includes('=') ? [p.slice(0, p.indexOf('=')), p.slice(p.indexOf('=') + 1)] : [p, ''])));
const n = (v) => (v === undefined ? 0 : Number(v));

/** The cells of a file with every vertex in page coordinates, read with the XML parser of the tests. */
function readFile(xml) {
  const { problems, cells } = checkDrawioStructure(xml);
  expect(problems).toEqual([]);
  const byId = new Map(cells.map((c) => [c.id, c]));
  const box = (c) => {
    const parent = byId.get(c.parent);
    const base = parent?.vertex === '1' ? box(parent) : { x: 0, y: 0 };
    return { x: base.x + n(c.mxGeometry.x), y: base.y + n(c.mxGeometry.y), w: n(c.mxGeometry.width), h: n(c.mxGeometry.height) };
  };
  return { cells: cells.filter((c) => c.id !== '0' && c.id !== '1'), byId, box };
}

const round = (v) => Math.round(v * 100) / 100;
const drawn = (section, type) => section.children.filter((c) => c.type === type);
const pathsOf = (section) => drawn(section, 'VECTOR').map((v) => v.vectorPaths[0].data);

const fixtures = validFixtures();

describe('figjam native script', () => {
  it('fits use_figma and is plain top-level code for every fixture', async () => {
    for (const f of fixtures) {
      const { parts } = figjamNative(await drawioOf(f.ir), { title: f.ir.title });
      expect(parts.length, `${f.kind}/${f.name}`).toBeGreaterThan(0);
      for (const p of parts) {
        expect(p.length, `${f.kind}/${f.name}`).toBeLessThanOrEqual(SCRIPT_LIMIT);
        expect(p).not.toMatch(/\(async \(\) =>/);
        expect(p.trimEnd().split('\n').at(-1)).toMatch(/^return /);
      }
    }
  });

  it('draws every label of the draw.io file as text', async () => {
    for (const f of fixtures) {
      const xml = await drawioOf(f.ir);
      const { figma, page } = fakeBoard();
      await runAll(figjamNative(xml, { title: f.ir.title }).parts, figma);
      expect(page.children.length).toBe(1);
      const texts = drawn(page.children[0], 'TEXT').map((t) => t.characters);
      for (const c of readFile(xml).cells) {
        const label = shown(c.value);
        if (label !== '') expect(texts, `${f.kind}/${f.name} ${c.id}`).toContain(label);
      }
    }
  });

  it('draws every edge from its exit point to its entry point, along its waypoints', async () => {
    const pointsOf = (d) => d.replace(/C( -?[\d.]+){4}/g, 'L').split(/ ?[ML] /).filter(Boolean).map((t) => t.split(' ').map(Number));
    const offLine = ([ax, ay], [bx, by], [px, py]) => {
      const dx = bx - ax;
      const dy = by - ay;
      const t = dx === 0 && dy === 0 ? 0 : Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
      return Math.hypot(px - ax - t * dx, py - ay - t * dy);
    };
    for (const f of fixtures) {
      const xml = await drawioOf(f.ir);
      const { parts, offset } = figjamNative(xml, { title: f.ir.title });
      const { figma, page } = fakeBoard();
      await runAll(parts, figma);
      const lines = drawn(page.children[0], 'VECTOR').filter((v) => v.fills.length === 0).map((v) => pointsOf(v.vectorPaths[0].data));
      const file = readFile(xml);
      const at = (p) => [p.x + offset.x, p.y + offset.y];
      for (const e of file.cells.filter((c) => c.edge === '1')) {
        const s = styleOf(e);
        const way = (e.mxGeometry.Array?.mxPoint ?? []).map((p) => at({ x: n(p.x), y: n(p.y) }));
        const port = (id, prefix) => {
          const b = file.box(file.byId.get(id));
          return at({ x: b.x + n(s[`${prefix}X`]) * b.w + n(s[`${prefix}Dx`]), y: b.y + n(s[`${prefix}Y`]) * b.h + n(s[`${prefix}Dy`]) });
        };
        // A port lies on the box, or up to the slant of a hexagon inside it; a waypoint gives the
        // line one of its coordinates, so the line passes within a pixel of it.
        const near = (a, b, by) => Math.abs(a[0] - b[0]) <= by && Math.abs(a[1] - b[1]) <= by;
        const route = lines.find((pts) => (s.exitX === undefined || near(pts[0], port(e.source, 'exit'), 12))
          && (s.entryX === undefined || near(pts.at(-1), port(e.target, 'entry'), 12))
          && way.every((w) => pts.some((p, i) => i > 0 && offLine(pts[i - 1], p, w) <= 1)));
        expect(route, `${f.kind}/${f.name} ${e.id}`).toBeDefined();
        // An orthogonal route has no stretch that is more than a pixel off level or upright (draw.io
        // itself paints a stretch one pixel off where it drops a bend that small).
        if (s.edgeStyle === 'orthogonalEdgeStyle') {
          for (let i = 1; i < route.length; i++) expect(Math.min(Math.abs(route[i][0] - route[i - 1][0]), Math.abs(route[i][1] - route[i - 1][1])), `${f.kind}/${f.name} ${e.id}: ${route.join(" ")}`).toBeLessThan(1.1);
        }
      }
    }
  });

  it('routes an orthogonal edge as draw.io does: bends by its segment rule, ports on the outline of the shape', async () => {
    // The lines of three fixtures as the draw.io viewer (v32.6.10) draws them, read from its SVG;
    // only the last point differs there, where the viewer stops the line under the arrow head.
    const linesOf = async (kind, name) => {
      const ir = loadFixture(kind, name);
      const D = JSON.parse(/^const D = (.*);$/m.exec(figjamNative(await drawioOf(ir), { title: ir.title }).parts[0])[1]);
      return D.items.filter((i) => i[0] === 'p' && !i[2] && / L /.test(i[1])).map((i) => {
        let isX = true;
        return i[1].split(' ').map((t) => {
          if (Number.isNaN(Number(t))) { isX = true; return t; }
          const v = round(Number(t) - D.offset[isX ? 0 : 1]);
          isX = !isX;
          return v;
        }).join(' ');
      });
    };
    const flow = await linesOf('flowchart', 'valid');
    // No waypoint, ports 0.01 px apart: one line, as it is.
    expect(flow).toContain('M 134.95 52 L 134.94 112');
    // A waypoint half a pixel beside the line does not bend it: draw.io takes only its height.
    expect(flow).toContain('M 135 292 L 134.5 489');
    expect(flow).toContain('M 134.5 825 L 134.96 915');
    expect(flow).toContain('M 357 662 L 357 880 L 175 880 L 175.04 915');
    const loop = await linesOf('state', 'valid-self-loop');
    // No waypoint and ports that do not face each other: a step halfway, leaving the corner port downwards.
    expect(loop).toContain('M 584 142 L 584 240 L 524 240 L 524 338');
    expect(loop).toContain('M 707 142 L 767 142 L 767 167 L 755 167 L 755 685 L 564 685 L 564.04 720');
    const arch = await linesOf('architecture', 'valid');
    // A port on the slanted side of a hexagon lies on that side, not on the corner of its box.
    expect(arch).toContain('M 471.99 93.68 L 503 93.7 L 503 225 L 785 225');
    expect(arch).toContain('M 1261 319 L 1306 319 L 1306 371 L 1669 371 L 1669 81.7 L 471.99 81.66');
    // A port on a round end state lies on the circle.
    expect(await linesOf('state', 'valid')).toContain('M 305 1096 L 305 1121 L 289 1121 L 289 1221 L 213.7 1221 L 213.74 1256.77');
    // The lines that leave one icon a pixel apart keep their first stretch as draw.io paints it for an
    // edge with a jump style: the bend that is a pixel off the straight line is not drawn.
    const fan = await linesOf('architecture', 'valid-aws-fan-out');
    expect(fan).toContain('M 1036 690 L 1310 691 L 1310 746 L 1613 746');
    expect(fan).toContain('M 1036 680.02 L 1891.5 681');
  });

  it('puts a cell where the draw.io file has it, moved by the offset of the section', async () => {
    const check = async (kind, name, id, type) => {
      const ir = loadFixture(kind, name);
      const xml = await drawioOf(ir);
      const { parts, offset, width, height } = figjamNative(xml, { title: ir.title });
      const { figma, page } = fakeBoard();
      await runAll(parts, figma);
      const S = page.children[0];
      const file = readFile(xml);
      const b = file.box([...file.byId.values()].find((c) => String(c.id).endsWith(`:${id}`)));
      const node = drawn(S, type).find((r) => r.x === round(b.x + offset.x) && r.y === round(b.y + offset.y) && r.width === b.w && r.height === b.h);
      expect(node, `${kind}/${name} ${id}`).toBeDefined();
      // The section holds the whole drawing.
      expect(S.width).toBe(width);
      expect(S.height).toBe(height);
      for (const c of S.children.filter((x) => x.type !== 'VECTOR' && x.rotation === 0)) {
        expect(c.x).toBeGreaterThanOrEqual(0);
        expect(c.y).toBeGreaterThanOrEqual(0);
        expect(c.x + c.width).toBeLessThanOrEqual(width);
        expect(c.y + c.height).toBeLessThanOrEqual(height);
      }
      return { S, offset, b };
    };
    // A node on the page, a node inside a group, an action inside a lane, an activation bar on a lifeline, an icon inside nested frames.
    await check('flowchart', 'valid', 'start', 'RECTANGLE');
    await check('flowchart', 'valid', 'reserve', 'RECTANGLE');
    await check('activity', 'valid-two-lanes', 'review', 'RECTANGLE');
    await check('sequence', 'valid', 'act-m2', 'RECTANGLE');
    await check('architecture', 'valid-aws', 'api', 'RECTANGLE');
    await check('state', 'valid', 'p-start', 'ELLIPSE');
    const { S, offset, b } = await check('class', 'valid', 'order', 'RECTANGLE');
    // The name of a class stands in its header, bold; a member row starts at the left of its row.
    const name = drawn(S, 'TEXT').find((t) => t.characters === '«aggregate root»\nOrder');
    expect(name.fontName.style).toBe('Bold');
    expect(name.y).toBeGreaterThanOrEqual(b.y + offset.y);
    expect(name.y + name.height).toBeLessThanOrEqual(b.y + offset.y + 46);
    const member = drawn(S, 'TEXT').find((t) => t.characters === '+Id: Guid');
    expect(member.textAlignHorizontal).toBe('LEFT');
    expect(member.x).toBe(b.x + offset.x + 6);
  });

  it('draws the shapes and line ends of the draw.io file', async () => {
    const boardOf = async (kind, name) => {
      const ir = loadFixture(kind, name);
      const { figma, page } = fakeBoard();
      await runAll(figjamNative(await drawioOf(ir), { title: ir.title }).parts, figma);
      return page.children[0];
    };
    const filled = (v) => v.fills.length > 0;
    // Flowchart: a decision is a four-cornered path, a start state a black disc, an arrow a filled head.
    const flow = await boardOf('flowchart', 'valid');
    expect(drawn(flow, 'VECTOR').filter((v) => filled(v) && /^M [\d.]+ [\d.]+( L [\d.]+ [\d.]+){3} Z$/.test(v.vectorPaths[0].data)).length).toBeGreaterThanOrEqual(1 + 9);
    const state = await boardOf('state', 'valid');
    expect(drawn(state, 'ELLIPSE').filter((e) => e.fills[0]?.color.r === 0).length).toBe(2 + 2);
    expect(drawn(state, 'RECTANGLE').some((r) => r.cornerRadius === 12)).toBe(true);
    // An end state is a ring with a disc that leaves 4 px of it free.
    expect(drawn(state, 'ELLIPSE').filter((e) => e.width === 22 && e.fills[0].color.r === 0).length).toBe(2);
    // Class: realization is a dashed line with a hollow triangle, composition a filled diamond.
    const cls = await boardOf('class', 'valid');
    expect(drawn(cls, 'VECTOR').filter((v) => v.dashPattern).length).toBe(2);
    const white = (v) => v.fills[0]?.color.r === 1;
    expect(drawn(cls, 'VECTOR').filter((v) => white(v) && /^M( [\d.]+){2}( L( [\d.]+){2}){2} Z$/.test(v.vectorPaths[0].data)).length).toBe(2);
    expect(drawn(cls, 'VECTOR').filter((v) => /^M( [\d.]+){2}( L( [\d.]+){2}){3} Z$/.test(v.vectorPaths[0].data)).map((v) => v.fills[0].color.r).sort()).toEqual([0, 1]);
    // ER: a ring for "zero" at an optional end.
    const er = await boardOf('er', 'valid');
    expect(drawn(er, 'ELLIPSE').length).toBe(4);
    // Sequence: a dashed lifeline per participant plus the dashed returns and the separator of the alt block.
    const seq = await boardOf('sequence', 'valid');
    expect(drawn(seq, 'VECTOR').filter((v) => v.dashPattern && /^M (\S+) \S+ L \1 \S+$/.test(v.vectorPaths[0].data)).length).toBe(4);
    // AWS: a service is a square of its colour with the name under it; a lane header keeps its colour.
    const aws = await boardOf('architecture', 'valid-aws');
    const icon = drawn(aws, 'RECTANGLE').find((r) => r.width === 78 && Math.round(r.fills[0].color.r * 255) === 0xed);
    const label = drawn(aws, 'TEXT').find((t) => t.characters === 'Order API (ECS Fargate)');
    expect(label.y).toBeGreaterThanOrEqual(icon.y + icon.height);
    expect(Math.abs(label.x + label.width / 2 - (icon.x + 39))).toBeLessThan(0.01);
    // The pictogram of the service is drawn on the square in white, inside the middle four fifths of it.
    const extent = (v) => {
      const nums = v.vectorPaths[0].data.split(' ').filter((t) => !Number.isNaN(Number(t))).map(Number);
      const xs = nums.filter((_, i) => i % 2 === 0);
      const ys = nums.filter((_, i) => i % 2 === 1);
      return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
    };
    const within = (e, x, y, w, h) => e.x0 >= x - 0.01 && e.y0 >= y - 0.01 && e.x1 <= x + w + 0.01 && e.y1 <= y + h + 0.01;
    const pictograms = drawn(aws, 'VECTOR').filter((v) => v.fills[0]?.color.r === 1 && v.strokes.length === 0 && /C/.test(v.vectorPaths[0].data));
    expect(pictograms.length).toBe(8);
    const onIcon = pictograms.filter((v) => within(extent(v), icon.x + 7.8, icon.y + 7.8, 62.4, 62.4));
    expect(onIcon.length).toBe(1);
    // It fills that room: an icon of AWS reaches the sides of its own box.
    expect(extent(onIcon[0]).x1 - extent(onIcon[0]).x0).toBeGreaterThan(55);
    // A group has its pictogram in the corner, in the colour of the frame.
    const corner = drawn(aws, 'RECTANGLE').find((r) => r.width === 25 && r.height === 25 && Math.round(r.fills[0].color.r * 255) === 0x8c);
    expect(corner).toBeUndefined();
    const vpc = drawn(aws, 'RECTANGLE').find((r) => r.strokes[0] && Math.round(r.strokes[0].color.r * 255) === 0x8c && r.width > 500);
    const cornerIcon = drawn(aws, 'VECTOR').filter((v) => Math.round((v.fills[0]?.color.r ?? 0) * 255) === 0x8c && within(extent(v), vpc.x, vpc.y, 25, 25));
    expect(cornerIcon.length).toBe(1);
    // The client screen is the stencil of draw.io's network library: outlines, not a stand-in box.
    expect(drawn(aws, 'RECTANGLE').some((r) => r.cornerRadius === 6 && r.width === 54)).toBe(false);
    const screen = drawn(aws, 'VECTOR').filter((v) => v.fills[0]?.color.r === 1 && v.strokes[0]?.color.r === 0 && /^M( [\d.]+){2}( L( [\d.]+){2}){3} Z$/.test(v.vectorPaths[0].data));
    expect(screen.map((v) => Math.round(extent(v).x1 - extent(v).x0))).toContain(54);
    const lanes = await boardOf('activity', 'valid-two-lanes');
    expect(drawn(lanes, 'RECTANGLE').some((r) => r.height === 40 && Math.round(r.fills[0]?.color.b * 255) === 0xcc)).toBe(true);
    // A lane that runs left to right has its title turned a quarter, inside the header band on the left.
    const sideways = await boardOf('activity', 'valid-guard-collision-lr');
    const turned = drawn(sideways, 'TEXT').filter((t) => t.rotation === 90);
    expect(turned.length).toBeGreaterThan(0);
    for (const t of turned) expect(t.y - t.width).toBeGreaterThanOrEqual(0);
  });

  it('carries the picture of an icon once in a script, however often the diagram shows it', async () => {
    const ir = loadFixture('architecture', 'valid-aws-fan-out');
    const xml = await drawioOf(ir);
    const { parts } = figjamNative(xml, { title: ir.title });
    expect(parts.length).toBe(1);
    const D = JSON.parse(/^const D = (.*);$/m.exec(parts[0])[1]);
    // Two S3 buckets, one path.
    expect(D.items.filter((i) => i[0] === 'g' && i[1] === 'mxgraph.aws4.s3#0').length).toBe(2);
    expect(Object.keys(D.stencils).filter((k) => k.startsWith('mxgraph.aws4.s3#')).length).toBe(1);
    // Only what the diagram shows is carried, and a diagram without icons carries none.
    expect(Object.keys(D.stencils).sort()).toEqual([...new Set(D.items.filter((i) => i[0] === 'g').map((i) => i[1]))].sort());
    expect(Object.keys(D.stencils).length).toBeLessThan(25);
    const plain = figjamNative(await drawioOf(loadFixture('flowchart', 'valid')), { title: 'x' }).parts[0];
    expect(plain).toContain('"stencils":{}');
    // A logo keeps the shades its stencil names; a figure of one colour takes the colour of its cell.
    const { figma, page } = fakeBoard();
    await runAll(parts, figma);
    const fills = drawn(page.children[0], 'VECTOR').filter((v) => v.fills.length > 0).map((v) => v.fills[0].color).map((c) => [c.r, c.g, c.b].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join(''));
    expect(fills).toEqual(expect.arrayContaining(['ffcb2b', 'ffa40c', 'f5820b', '232f3d']));
    // Split, every part carries the paths of its own drawings and the board comes out the same.
    const split = figjamNative(xml, { title: ir.title, limit: 14000 });
    expect(split.parts.length).toBeGreaterThan(2);
    for (const p of split.parts) expect(p.length).toBeLessThanOrEqual(14000);
    const many = fakeBoard();
    await runAll(split.parts, many.figma);
    expect(pathsOf(many.page.children[0]).sort()).toEqual(pathsOf(page.children[0]).sort());
  });

  it('jumps over a line drawn before it where the two cross, and nowhere else', async () => {
    const jumpsOf = async (kind, name) => {
      const ir = loadFixture(kind, name);
      const { parts, offset } = figjamNative(await drawioOf(ir), { title: ir.title });
      const { figma, page } = fakeBoard();
      await runAll(parts, figma);
      // The line of an edge: stroked, not filled, straight stretches (a cylinder lid has curves but no stretch before them).
      const lines = drawn(page.children[0], 'VECTOR').filter((v) => v.fills.length === 0 && / L /.test(v.vectorPaths[0].data)).map((v) => v.vectorPaths[0].data);
      return { lines, jumping: lines.filter((d) => / C /.test(d)), offset };
    };
    // The flow from the join down to the carrier crosses the flow that runs level to the hold.
    const { lines, jumping, offset } = await jumpsOf('activity', 'valid-fork-join');
    expect(jumping.length).toBe(1);
    const m = /^M (\S+) (\S+) L (\S+) (\S+) C (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) L (\S+) (\S+)$/.exec(jumping[0]).slice(1).map(Number);
    const [x, top, , before, c1x, c1y, c2x, c2y, , after, , bottom] = m;
    // The stretch is upright: it stops 4 px before the crossing and goes on 4 px after it (half of jumpSize less 2, plus the line width).
    expect([m[2], m[8], m[10]]).toEqual([x, x, x]);
    expect(after - before).toBe(8);
    expect(top).toBeLessThan(before);
    expect(bottom).toBeGreaterThan(after);
    // The curve bulges to the right, as draw.io's does on an upright line.
    expect([round(c1x - x), c1y, round(c2x - x), c2y]).toEqual([5.2, before, 5.2, after]);
    // At the crossing itself runs a level stretch of a line drawn earlier.
    const y = (before + after) / 2;
    const crossed = lines.slice(0, lines.indexOf(jumping[0])).filter((d) => {
      const pts = d.split(/ ?[ML] /).filter(Boolean).map((t) => t.split(' ').map(Number));
      return pts.some((p, i) => i > 0 && p[1] === y && pts[i - 1][1] === y && Math.min(p[0], pts[i - 1][0]) < x && Math.max(p[0], pts[i - 1][0]) > x);
    });
    expect(crossed.length).toBe(1);
    expect(offset).toEqual({ x: 0, y: 0 });
    // A level line jumps upwards; the fan-out diagram has an upright one too. A diagram without a crossing has no jump.
    expect((await jumpsOf('architecture', 'valid-aws-shared-systems')).jumping.map((d) => / L (\S+) (\S+) C \1 (\S+) \S+ \3 /.test(d) && Number(/ C \S+ (\S+)/.exec(d)[1]) < Number(/ L \S+ (\S+) C/.exec(d)[1]))).toEqual([true]);
    expect((await jumpsOf('architecture', 'valid-aws-fan-out')).jumping.length).toBe(1);
    for (const [kind, name] of [['flowchart', 'valid'], ['state', 'valid'], ['activity', 'valid-two-lanes'], ['architecture', 'valid-aws'], ['flowchart', 'large-50-nodes']]) expect((await jumpsOf(kind, name)).jumping, `${kind}/${name}`).toEqual([]);
  });

  it('jumps only as draw.io does: not over a later line, not without jumpStyle, not next to a corner', () => {
    const box = (id, x, y) => `<mxCell id="${id}" value="" style="rounded=0;" vertex="1" parent="1"><mxGeometry x="${x}" y="${y}" width="20" height="20" as="geometry"/></mxCell>`;
    const line = (id, from, to, style, points = '') => `<mxCell id="${id}" value="" style="edgeStyle=orthogonalEdgeStyle;endArrow=none;${style}" edge="1" parent="1" source="${from}" target="${to}"><mxGeometry relative="1" as="geometry">${points}</mxGeometry></mxCell>`;
    const across = 'exitX=1;exitY=0.5;entryX=0;entryY=0.5;';
    const down = 'exitX=0.5;exitY=1;entryX=0.5;entryY=0;';
    const xml = (edges) => `<mxfile><diagram id="p" name="p"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${box('a', 0, 100)}${box('b', 300, 100)}${box('c', 150, 0)}${box('d', 150, 200)}${box('e', 12, 0)}${box('f', 12, 200)}${edges}</root></mxGraphModel></diagram></mxfile>`;
    const linesOf = (edges) => JSON.parse(/^const D = (.*);$/m.exec(figjamNative(xml(edges), { title: 't' }).parts[0])[1]).items.filter((i) => i[0] === 'p' && !i[2]).map((i) => i[1]);
    const jump = 'jumpStyle=arc;jumpSize=8;';
    // Level first, upright second: the upright one jumps, to the right.
    expect(linesOf(line('h', 'a', 'b', across + jump) + line('v', 'c', 'd', down + jump))).toEqual(['M 60 150 L 340 150', 'M 200 60 L 200 146 C 205.2 146 205.2 154 200 154 L 200 240']);
    // Upright first: now the level one jumps, upwards.
    expect(linesOf(line('v', 'c', 'd', down + jump) + line('h', 'a', 'b', across + jump))).toEqual(['M 200 60 L 200 240', 'M 60 150 L 196 150 C 196 144.8 204 144.8 204 150 L 340 150']);
    // A line without jumpStyle goes straight through; one marked noJump is not jumped over.
    expect(linesOf(line('h', 'a', 'b', across + jump) + line('v', 'c', 'd', down))[1]).toBe('M 200 60 L 200 240');
    expect(linesOf(line('h', 'a', 'b', `${across}noJump=1;`) + line('v', 'c', 'd', down + jump))[1]).toBe('M 200 60 L 200 240');
    // A crossing closer to the start of the stretch than the jump is long (here 2 px from the box) stays
    // straight; the crossing is a point of the line all the same, as in draw.io.
    expect(linesOf(line('v', 'e', 'f', down + jump) + line('h', 'a', 'b', across + jump))[1]).toBe('M 60 150 L 62 150 L 340 150');
    // Two crossings on one stretch: two jumps, in the order the line meets them.
    expect(linesOf(line('v', 'c', 'd', down) + line('w', 'c', 'd', 'exitX=1;exitY=1;entryX=1;entryY=0;') + line('h', 'a', 'b', across + jump))[2]).toBe('M 60 150 L 196 150 C 196 144.8 204 144.8 204 150 L 206 150 C 206 144.8 214 144.8 214 150 L 340 150');
  });

  it('fills the square of a service with the gradient of its style', async () => {
    const ir = loadFixture('architecture', 'valid-aws');
    ir.components.find((c) => c.id === 'cdn').icon = 'aws:customer_engagement';
    const xml = await drawioOf(ir);
    expect(xml).toContain('gradientColor=#4D72F3;gradientDirection=north;fillColor=#3334B9;');
    const { figma, page } = fakeBoard();
    await runAll(figjamNative(xml, { title: ir.title }).parts, figma);
    const squares = drawn(page.children[0], 'RECTANGLE').filter((r) => r.width === 78 && r.height === 78);
    const graded = squares.filter((r) => r.fills[0].type === 'GRADIENT_LINEAR');
    expect(graded.length).toBe(1);
    expect(squares.filter((r) => r.fills[0].type === 'SOLID').length).toBe(7);
    const hex = (c) => [c.r, c.g, c.b].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
    // North: the fill colour at the bottom, the gradient colour at the top; the transform turns Figma's left-to-right run downwards.
    expect(graded[0].fills[0].gradientStops.map((g) => [g.position, hex(g.color), g.color.a])).toEqual([[0, '4d72f3', 1], [1, '3334b9', 1]]);
    expect(graded[0].fills[0].gradientTransform).toEqual([[0, 1, 0], [-1, 0, 1]]);
    // The other directions of draw.io, on a plain cell style.
    const cell = (dir) => `<mxfile><diagram id="p" name="p"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="i" value="" style="shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.s3;fillColor=#112233;gradientColor=#445566;${dir}strokeColor=#ffffff;" vertex="1" parent="1"><mxGeometry x="0" y="0" width="78" height="78" as="geometry"/></mxCell></root></mxGraphModel></diagram></mxfile>`;
    const fillOf = (dir) => JSON.parse(/^const D = (.*);$/m.exec(figjamNative(cell(dir), { title: 't' }).parts[0])[1]).items[0][5];
    expect(fillOf('')).toBe('112233>445566');
    expect(fillOf('gradientDirection=south;')).toBe('112233>445566');
    expect(fillOf('gradientDirection=north;')).toBe('445566>112233');
    expect(fillOf('gradientDirection=east;')).toBe('112233|445566');
    expect(fillOf('gradientDirection=west;')).toBe('445566|112233');
    expect(fillOf('gradientColor=none;').length).toBe(6);
  });

  it('sets the text in Arimo at the size of the draw.io file and wraps where the box ends', async () => {
    const ir = loadFixture('class', 'valid');
    const { figma, page } = fakeBoard();
    await runAll(figjamNative(await drawioOf(ir), { title: ir.title }).parts, figma);
    expect(figma.loaded).toEqual(['Arimo Regular', 'Arimo Bold', 'Arimo Italic', 'Arimo Bold Italic']);
    const texts = drawn(page.children[0], 'TEXT');
    expect(texts.every((t) => t.fontName.family === 'Arimo')).toBe(true);
    // No label is set smaller to fit: a row is 12 px, a label on a line 11 px, as in the file.
    expect([...new Set(texts.map((t) => t.fontSize))].sort()).toEqual([11, 12]);
    // The method that is longer than its row is wrapped at the width of the row.
    const long = texts.find((t) => t.characters.startsWith('+AddLine('));
    expect(long.fixed).toBe(288);
    expect(long.textAutoResize).toBe('HEIGHT');
    expect(texts.find((t) => t.characters === '+Id: Guid').fixed).toBeUndefined();
    // The name under an icon is wrapped at the width the draw.io file gives its label, centred under the icon.
    const fan = fakeBoard();
    const fanIr = loadFixture('architecture', 'valid-aws-fan-out');
    const xml = await drawioOf(fanIr);
    const { parts, offset } = figjamNative(xml, { title: fanIr.title });
    await runAll(parts, fan.figma);
    const file = readFile(xml);
    const api = [...file.byId.values()].find((c) => String(c.id).endsWith(':api'));
    const wide = Number(styleOf(api).labelWidth);
    const name = drawn(fan.page.children[0], 'TEXT').find((t) => t.characters === shown(api.value));
    expect(wide).toBeGreaterThan(0);
    expect(name.fixed ?? name.width).toBeLessThanOrEqual(wide);
    const b = file.box(api);
    expect(Math.abs(name.x + name.width / 2 - (b.x + b.w / 2 + offset.x))).toBeLessThan(0.01);
  });

  it('sets the arrow of a reference line in the face draw.io falls back to, and a shadow at its opacity', async () => {
    // Arimo has no glyph for the arrow; the page of draw.io draws it from Inter where Inter is installed.
    const ir = loadFixture('flowchart', 'valid');
    const { figma, page } = fakeBoard();
    await runAll(figjamNative(await drawioOf(ir), { title: ir.title }).parts, figma);
    const label = drawn(page.children[0], 'TEXT').find((t) => t.characters === 'Capture payment\n↳ order-checkout-payment');
    expect(label.fontName).toEqual({ family: 'Arimo', style: 'Regular' });
    expect(label.ranges).toEqual([['↳', 'Inter', 'Regular']]);
    expect(figma.loaded).toContain('Inter Regular');
    // A label without the arrow loads nothing but Arimo.
    const plain = fakeBoard();
    const er = loadFixture('er', 'valid');
    await runAll(figjamNative(await drawioOf(er), { title: er.title }).parts, plain.figma);
    expect(plain.figma.loaded.every((f) => f.startsWith('Arimo '))).toBe(true);
    // In a bold label the arrow is bold too.
    const bold = `<mxfile><diagram id="p" name="p"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="a" value="Pay&lt;br&gt;↳ pay-flow" style="rounded=0;fontStyle=1;" vertex="1" parent="1"><mxGeometry x="0" y="0" width="120" height="40" as="geometry"/></mxCell></root></mxGraphModel></diagram></mxfile>`;
    expect(JSON.parse(/^const D = (.*);$/m.exec(figjamNative(bold, { title: 't' }).parts[0])[1]).items.find((i) => i[0] === 't')[6]).toEqual({ b: 1, s: [[4, 5, '~b']] });
    // The shadow of a logo that draw.io fills at a fifth of full strength is a vector of that opacity.
    const logo = `<mxfile><diagram id="p" name="p"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="g" value="" style="shape=mxgraph.gcp2.google_play_game_service;fillColor=#5184F3;strokeColor=none;" vertex="1" parent="1"><mxGeometry x="0" y="0" width="78" height="54" as="geometry"/></mxCell></root></mxGraphModel></diagram></mxfile>`;
    const board = fakeBoard();
    await runAll(figjamNative(logo, { title: 't' }).parts, board.figma);
    expect(drawn(board.page.children[0], 'VECTOR').map((v) => v.opacity)).toEqual([undefined, 0.2, undefined]);
  });

  it('sets the part of a label that is italic or bold apart', async () => {
    expect(richLabel('<i>«control»</i><br>Auth service')).toEqual({ text: '«control»\nAuth service', runs: [[0, 9, 2], [9, 22, 0]] });
    expect(richLabel('<b>Order</b>')).toEqual({ text: 'Order', runs: [[0, 5, 1]] });
    expect(richLabel('a <b>b <i>c</i></b> ').runs).toEqual([[0, 2, 0], [2, 4, 1], [4, 5, 3]]);
    const ir = loadFixture('sequence', 'valid');
    const { figma, page } = fakeBoard();
    await runAll(figjamNative(await drawioOf(ir), { title: ir.title }).parts, figma);
    const texts = drawn(page.children[0], 'TEXT');
    const auth = texts.find((t) => t.characters === '«control»\nAuth service');
    expect(auth.fontName.style).toBe('Regular');
    expect(auth.ranges).toEqual([['«control»', 'Arimo', 'Italic']]);
    expect(texts.find((t) => t.characters === '«database»\nUser DB').ranges).toEqual([['«database»', 'Arimo', 'Italic']]);
    expect(texts.find((t) => t.characters === 'User').ranges).toEqual([]);
    // A label that is bold as a whole is one text in the bold face, without a range.
    const cls = fakeBoard();
    const clsIr = loadFixture('class', 'valid');
    await runAll(figjamNative(await drawioOf(clsIr), { title: clsIr.title }).parts, cls.figma);
    const head = drawn(cls.page.children[0], 'TEXT').find((t) => t.characters === 'OrderLine');
    expect(head.fontName.style).toBe('Bold');
    expect(head.ranges).toEqual([]);
  });

  it('reads labels as text: line breaks kept, markup and entities resolved', () => {
    expect(plainLabel('<i>«control»</i><br>Auth service')).toBe('«control»\nAuth service');
    expect(plainLabel('-lines: List&lt;OrderLine&gt; &amp; more')).toBe('-lines: List<OrderLine> & more');
    expect(plainLabel('<b>Order</b><br/>↳ order-checkout-payment')).toBe('Order\n↳ order-checkout-payment');
  });

  it('reads a cell with a link, which draw.io wraps in a UserObject', async () => {
    const result = await emit(loadFixture('flowchart', 'valid'), 'drawio', { refs: new Map([['order-checkout-payment', { pageId: 'p2', title: 'Payment' }]]) });
    expect(result.output).toContain('<UserObject');
    const cells = parseCells(result.output);
    const linked = cells.find((c) => c.id.endsWith(':payment'));
    expect(linked.vertex).toBe(true);
    expect(linked.geo.w).toBe(checkDrawioStructure(result.output).cells.find((c) => c.id === linked.id).mxGeometry.width * 1);
    expect(plainLabel(linked.value)).toContain('Capture payment');
  });

  it('replaces its own drawing on a second run and leaves what others put on the board', async () => {
    const ir = loadFixture('er', 'valid');
    const { parts } = figjamNative(await drawioOf(ir), { title: ir.title });
    const { figma, page } = fakeBoard([{ x: 100, y: -50, width: 900, height: 400 }]);
    const [first] = await runAll(parts, figma);
    expect(first.replaced).toBe(0);
    const S = page.children.find((c) => c.type === 'SECTION');
    // A new section stands to the right of everything on the page.
    expect(S.x).toBe(1200);
    expect(S.y).toBe(-50);
    expect(S.children.every((c) => c.name === NATIVE_TAG)).toBe(true);
    const count = S.children.length;
    expect(first.created).toBe(count);
    const sticky = { type: 'STICKY', name: 'a remark of the user', x: 5, y: 5, width: 10, height: 10, parent: S };
    S.children.push(sticky);
    S.x = 3000;
    const [second] = await runAll(parts, figma);
    expect(second).toMatchObject({ section: first.section, replaced: count, created: count });
    expect(page.children.filter((c) => c.type === 'SECTION').length).toBe(1);
    expect(S.children.filter((c) => c.name === NATIVE_TAG).length).toBe(count);
    expect(S.children).toContain(sticky);
    // The section stays where the user moved it.
    expect(S.x).toBe(3000);
  });

  it('does not take a section of the same name that generate_diagram made for its own', async () => {
    const ir = loadFixture('flowchart', 'valid');
    const { parts } = figjamNative(await drawioOf(ir), { title: ir.title });
    const generated = { type: 'SECTION', name: ir.title, x: 0, y: 0, width: 500, height: 500, children: [{ type: 'SHAPE_WITH_TEXT', name: 'Validate cart contents' }] };
    const { figma, page } = fakeBoard();
    page.children.push(generated);
    await runAll(parts, figma);
    expect(page.children.filter((c) => c.type === 'SECTION').length).toBe(2);
    expect(generated.children.length).toBe(1);
  });

  it('splits a drawing that is too long into parts that draw into one section', async () => {
    const ir = loadFixture('flowchart', 'large-50-nodes');
    const xml = await drawioOf(ir);
    const whole = figjamNative(xml, { title: ir.title });
    expect(whole.parts.length).toBe(1);
    const split = figjamNative(xml, { title: ir.title, limit: 9000 });
    expect(split.parts.length).toBeGreaterThan(2);
    for (const p of split.parts) expect(p.length).toBeLessThanOrEqual(9000);
    const one = fakeBoard();
    await runAll(whole.parts, one.figma);
    const many = fakeBoard();
    const results = await runAll(split.parts, many.figma);
    expect(many.page.children.length).toBe(1);
    expect(many.page.children[0].children.length).toBe(one.page.children[0].children.length);
    expect(results.map((r) => r.part)).toEqual(split.parts.map((_, i) => i + 1));
    expect(new Set(results.map((r) => r.section)).size).toBe(1);
    // A later part does not start a board of its own.
    await expect(runOn(split.parts[1], fakeBoard().figma)).rejects.toThrow(/run part 1 first/);
    // Run again from the first part, the whole drawing is replaced, not doubled.
    await runAll(split.parts, many.figma);
    expect(many.page.children[0].children.length).toBe(one.page.children[0].children.length);
  });
});

describe('emit --to figjam with the native board', () => {
  it('makes the scripts for every kind, also those generate_diagram rejects', async () => {
    for (const [kind, name] of [['class', 'valid'], ['activity', 'valid-two-lanes']]) {
      const ir = loadFixture(kind, name);
      expect((await emit(ir, 'figjam')).ok).toBe(false);
      const r = await emit(ir, 'figjam', { native: true });
      expect(r.ok).toBe(true);
      expect(r.output).toBeUndefined();
      expect(r.textSkipped).toContain(`kind "${kind}" is unsupported`);
      expect(r.native[0]).toContain(`"title":${JSON.stringify(ir.title)}`);
    }
    const flow = await emit(loadFixture('flowchart', 'valid'), 'figjam', { native: true });
    expect(flow.output).toContain('flowchart');
    expect(flow.textSkipped).toBeUndefined();
    expect(flow.native.length).toBe(1);
    expect((await emit(loadFixture('flowchart', 'valid'), 'figjam')).native).toBeUndefined();
    expect((await emit(loadFixture('flowchart', 'valid'), 'drawio', { native: true })).native).toBeUndefined();
  });

  it('is refused by the secret scan like every text that leaves the machine', async () => {
    const ir = loadFixture('class', 'valid');
    ir.classes[0].attributes = [...(ir.classes[0].attributes ?? []), { name: 'password = hunter2hunter2', type: 'string' }];
    const r = await emit(ir, 'figjam', { native: true });
    expect(r.ok).toBe(false);
    expect(r.native).toBeUndefined();
    expect(r.errors[0].message).toContain('refusing to emit for figjam');
    expect((await emit(ir, 'figjam', { native: true, allowSensitive: true })).native.join('')).toContain('hunter2hunter2');
  });
});
