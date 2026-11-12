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

  it('draws every edge from its exit point to its entry point, through its waypoints', async () => {
    for (const f of fixtures) {
      const xml = await drawioOf(f.ir);
      const { parts, offset } = figjamNative(xml, { title: f.ir.title });
      const { figma, page } = fakeBoard();
      await runAll(parts, figma);
      const paths = pathsOf(page.children[0]);
      const file = readFile(xml);
      const at = (p) => `${round(p.x + offset.x)} ${round(p.y + offset.y)}`;
      for (const e of file.cells.filter((c) => c.edge === '1')) {
        const s = styleOf(e);
        const way = (e.mxGeometry.Array?.mxPoint ?? []).map((p) => ({ x: n(p.x), y: n(p.y) }));
        const port = (id, prefix) => {
          const b = file.box(file.byId.get(id));
          return { x: b.x + n(s[`${prefix}X`]) * b.w + n(s[`${prefix}Dx`]), y: b.y + n(s[`${prefix}Y`]) * b.h + n(s[`${prefix}Dy`]) };
        };
        const wanted = [];
        if (s.exitX !== undefined) wanted.push(`^M ${at(port(e.source, 'exit'))} L`);
        for (const p of way) wanted.push(`L ${at(p)}( |$)`);
        if (s.entryX !== undefined) wanted.push(`L ${at(port(e.target, 'entry'))}$`);
        const route = paths.find((d) => wanted.every((w) => new RegExp(w.replace(/\./g, '\\.')).test(d)));
        expect(route, `${f.kind}/${f.name} ${e.id}: ${wanted.join(' , ')}`).toBeDefined();
        // Every corner of an orthogonal route is a right angle: no point follows another on a slant.
        if (s.edgeStyle === 'orthogonalEdgeStyle') {
          const pts = route.split(/ ?[ML] /).filter(Boolean).map((t) => t.split(' ').map(Number));
          for (let i = 1; i < pts.length; i++) expect(Math.min(Math.abs(pts[i][0] - pts[i - 1][0]), Math.abs(pts[i][1] - pts[i - 1][1])), `${f.kind}/${f.name} ${e.id}: ${route}`).toBeLessThan(1);
        }
      }
    }
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
