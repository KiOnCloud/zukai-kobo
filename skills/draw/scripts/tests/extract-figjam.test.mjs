import { describe, it, expect } from 'vitest';
import { figjamReaderScript, extractFigjamBoard, joinBoardParts, READ_LIMIT } from '../src/extract-figjam.mjs';
import { extractFacts, extractBoards } from '../src/extract.mjs';
import { cover } from '../src/cover.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scriptsDir, loadFixture } from './helpers.mjs';

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

/**
 * Just enough of the Figma plugin API for the reader script. Every node is frozen and every
 * method that changes a board throws, so a test passes only if the script reads alone.
 */
function fakeFigma(pageName, children) {
  const build = (spec) => {
    const node = { ...spec, absoluteBoundingBox: spec.box && { x: spec.box[0], y: spec.box[1], width: spec.box[2], height: spec.box[3] } };
    delete node.box;
    if (spec.children) node.children = spec.children.map(build);
    if (spec.type === 'TABLE') node.cellAt = (i, j) => ({ text: { characters: spec.cells[i][j] } });
    for (const method of ['remove', 'appendChild', 'resize', 'setPluginData']) node[method] = () => { throw new Error(`the reader changed the board: ${method}`); };
    return Object.freeze(node);
  };
  const kids = children.map(build);
  const all = [];
  const collect = (n) => { all.push(n); (n.children ?? []).forEach(collect); };
  kids.forEach(collect);
  const page = Object.freeze({ name: pageName, type: 'PAGE', children: kids, findOne: (p) => all.find(p) ?? null, findAll: (p) => all.filter(p) });
  const deny = () => { throw new Error('the reader created something on the board'); };
  return { currentPage: page, createRectangle: deny, createText: deny, createSection: deny, createConnector: deny, createShapeWithText: deny, group: deny };
}

const run = async (figma, options) => new AsyncFunction('figma', figjamReaderScript(options))(figma);

const board = () => [
  { id: '1:1', type: 'SECTION', name: 'Checkout', box: [0, 0, 800, 600], children: [
    { id: '1:2', type: 'SHAPE_WITH_TEXT', name: 'a', shapeType: 'ROUNDED_RECTANGLE', text: { characters: 'Enter card' }, box: [40, 40, 160, 60] },
    { id: '1:3', type: 'SHAPE_WITH_TEXT', name: 'b', shapeType: 'DIAMOND', text: { characters: 'Card valid?' }, box: [40, 160, 160, 100] },
    { id: '1:4', type: 'SHAPE_WITH_TEXT', name: 'c', shapeType: 'ENG_DATABASE', text: { characters: 'Payments DB' }, box: [300, 160, 120, 100] },
    { id: '1:5', type: 'STICKY', name: 'sticky', text: { characters: 'Ask PM about 3DS' }, box: [500, 40, 200, 200] },
    { id: '1:6', type: 'CONNECTOR', name: 'c1', text: { characters: '' }, connectorStart: { endpointNodeId: '1:2', magnet: 'AUTO' }, connectorEnd: { endpointNodeId: '1:3', magnet: 'AUTO' }, connectorStartStrokeCap: 'NONE', connectorEndStrokeCap: 'ARROW_LINES', box: [100, 100, 10, 60] },
    { id: '1:7', type: 'CONNECTOR', name: 'c2', text: { characters: 'yes' }, connectorStart: { endpointNodeId: '1:3' }, connectorEnd: { position: { x: 305, y: 200 } }, connectorStartStrokeCap: 'NONE', connectorEndStrokeCap: 'ARROW_EQUILATERAL', dashPattern: [4, 4], box: [200, 200, 100, 10] },
    { id: '1:8', type: 'TABLE', name: 'table', numRows: 2, numColumns: 2, cells: [['id', 'uuid'], ['amount', 'decimal']], box: [40, 400, 200, 80] },
    { id: '1:9', type: 'TEXT', name: 'note', characters: 'Draft', box: [60, 60, 40, 20] },
  ] },
  { id: '2:1', type: 'SHAPE_WITH_TEXT', name: 'outside', shapeType: 'SQUARE', text: { characters: 'Not in the section' }, box: [1000, 0, 100, 50] },
];

describe('FigJam reader script', () => {
  it('reads a section without touching the board', async () => {
    const result = await run(fakeFigma('Board', board()), { section: 'Checkout' });
    expect(result).toMatchObject({ zukaiBoard: 1, page: 'Board', section: 'Checkout', root: '1:1' });
    expect(result.nodes.map((n) => n.id)).toEqual(['1:2', '1:3', '1:4', '1:5', '1:6', '1:7', '1:8', '1:9']);
    expect(result.nodes.find((n) => n.id === '1:6')).toMatchObject({ start: { node: '1:2' }, end: { node: '1:3' }, endCap: 'ARROW_LINES' });
    expect(result.nodes.find((n) => n.id === '1:7')).toMatchObject({ end: { at: [305, 200] }, dashed: 1, text: 'yes' });
    expect(result.nodes.find((n) => n.id === '1:8').rows).toEqual([['id', 'uuid'], ['amount', 'decimal']]);
  });

  it('reads the whole page without a section, and names the sections when one is not found', async () => {
    const result = await run(fakeFigma('Board', board()));
    expect(result.section).toBeNull();
    expect(result.nodes.map((n) => n.id)).toContain('2:1');
    await expect(run(fakeFigma('Board', board()), { section: 'Nope' })).rejects.toThrow(/no section named "Nope".*sections: Checkout/);
    expect((await run(fakeFigma('Board', board()), { section: '1:1' })).section).toBe('Checkout');
  });

  it('returns a board too large for one tool result in parts under the limit, which join back into one board', async () => {
    const many = Array.from({ length: 1500 }, (_, i) => ({ id: `9:${i}`, type: 'SHAPE_WITH_TEXT', name: 'n', shapeType: 'SQUARE', text: { characters: `Bước số ${i} của một bảng rất dài` }, box: [i * 10, 2000, 100, 50] }));
    const figma = fakeFigma('Board', [...board(), ...many]);
    const parts = [];
    let from = 0;
    do {
      const part = await run(figma, { from });
      expect(Buffer.byteLength(JSON.stringify(part))).toBeLessThanOrEqual(READ_LIMIT);
      parts.push(part);
      from = part.next;
    } while (from !== null);
    expect(parts.length).toBeGreaterThan(2);
    const joined = joinBoardParts([...parts].reverse());
    expect(joined.board.nodes).toHaveLength(parts[0].total);
    expect(joinBoardParts(parts.slice(1)).error).toMatch(/starts at node 0 is missing; run the reader script again with --from 0/);
    expect(joinBoardParts(parts.slice(0, -1)).error).toMatch(/run the reader script again with --from \d+/);
    const r = extractBoards(parts.map((p) => Buffer.from(JSON.stringify(p))));
    expect(r.ok).toBe(true);
  });

  it('splits a whole page into one facts page per diagram, and keeps a note with the diagram beside it', () => {
    const page = {
      zukaiBoard: 1, page: 'Board', section: null, root: null, from: 0, total: 9, next: null,
      nodes: [
        { id: 'a', type: 'SHAPE_WITH_TEXT', shapeType: 'ROUNDED_RECTANGLE', text: 'Draft', box: [0, 0, 100, 50] },
        { id: 'b', type: 'SHAPE_WITH_TEXT', shapeType: 'ROUNDED_RECTANGLE', text: 'Published', box: [0, 150, 100, 50] },
        { id: 'ab', type: 'CONNECTOR', text: 'publish', start: { node: 'a' }, end: { node: 'b' }, startCap: 'NONE', endCap: 'ARROW_LINES', box: [50, 50, 1, 100] },
        { id: 'note', type: 'STICKY', text: 'Only editors publish', box: [150, 0, 120, 120] },
        { id: 'c', type: 'SHAPE_WITH_TEXT', shapeType: 'SQUARE', text: 'Web app', box: [1500, 0, 100, 50] },
        { id: 'd', type: 'SHAPE_WITH_TEXT', shapeType: 'ENG_DATABASE', text: 'Orders DB', box: [1800, 0, 100, 80] },
        { id: 'cd', type: 'CONNECTOR', text: 'SQL', start: { node: 'c' }, end: { node: 'd' }, startCap: 'NONE', endCap: 'ARROW_LINES', box: [1600, 25, 200, 1] },
        { id: 's', type: 'SECTION', name: 'Legend', box: [0, 1200, 300, 200] },
        { id: 'st', type: 'STICKY', parent: 's', text: 'Blue means external', box: [20, 1240, 120, 120] },
      ],
    };
    const facts = extractFigjamBoard(page);
    expect(facts.pages.map((p) => [p.id, p.name, p.nodes.map((n) => n.id)])).toEqual([
      ['page:Board#1', '', ['a', 'b', 'note']],
      ['page:Board#2', '', ['c', 'd']],
      ['page:Board#3', 'Legend', ['s', 'st']],
    ]);
    expect(facts.pages[1].edges.map((e) => e.id)).toEqual(['cd']);
  });

  it('turns the board into facts: shapes, connectors with their ends, a table, a sticky and a text over a shape', async () => {
    const facts = extractFigjamBoard(await run(fakeFigma('Board', board()), { section: 'Checkout' }));
    expect(facts.format).toBe('figjam');
    const [page] = facts.pages;
    expect(page).toMatchObject({ id: 'section:Checkout', name: 'Checkout' });
    const byId = Object.fromEntries(page.nodes.map((n) => [n.id, n]));
    expect(byId['1:2']).toMatchObject({ shape: 'rounded', label: 'Enter card', texts: ['Draft'] });
    expect(byId['1:3'].shape).toBe('decision');
    expect(byId['1:4'].shape).toBe('store');
    expect(byId['1:5']).toMatchObject({ shape: 'note', label: 'Ask PM about 3DS' });
    expect(byId['1:8']).toMatchObject({ shape: 'table', texts: ['id uuid', 'amount decimal'] });
    expect(byId['1:9']).toBeUndefined();
    expect(page.edges).toEqual([
      expect.objectContaining({ id: '1:6', from: '1:2', to: '1:3', endArrow: 'open' }),
      expect.objectContaining({ id: '1:7', from: '1:3', to: '1:4', label: 'yes', toInferred: true, dashed: true, endArrow: 'block' }),
    ]);
    expect(page.kindHints[0].kind).toBe('flowchart');
  });

  it('reads a board Zukai drew with emit --native: groups of shapes are nodes, groups of lines are edges', () => {
    const native = {
      zukaiBoard: 1, page: 'Board', section: 'Login', root: 's',
      nodes: [
        { id: 'g1', type: 'GROUP', name: 'Web app', parent: 's', box: [0, 0, 120, 60] },
        { id: 'r1', type: 'RECTANGLE', name: 'zukai-native', parent: 'g1', box: [0, 0, 120, 60], rounded: 1 },
        { id: 't1', type: 'TEXT', name: 'zukai-native', parent: 'g1', text: 'Web app', box: [10, 20, 100, 20] },
        { id: 'g2', type: 'GROUP', name: 'Auth', parent: 's', box: [300, 0, 120, 60] },
        { id: 'r2', type: 'RECTANGLE', name: 'zukai-native', parent: 'g2', box: [300, 0, 120, 60] },
        { id: 't2', type: 'TEXT', name: 'zukai-native', parent: 'g2', text: 'Auth service', box: [310, 20, 100, 20] },
        { id: 'g3', type: 'GROUP', name: 'POST /login', parent: 's', box: [120, 20, 180, 20] },
        { id: 'v1', type: 'VECTOR', name: 'zukai-native', parent: 'g3', box: [120, 30, 180, 0], ends: [[120, 30], [300, 30]] },
        { id: 'v2', type: 'VECTOR', name: 'zukai-native', parent: 'g3', box: [292, 26, 8, 8], ends: [[292, 26], [300, 30]] },
        { id: 't3', type: 'TEXT', name: 'zukai-native', parent: 'g3', text: 'POST /login', box: [160, 10, 80, 14] },
      ],
    };
    const [page] = extractFigjamBoard(native).pages;
    expect(page.nodes.map((n) => [n.id, n.shape, n.label])).toEqual([['g1', 'rounded', 'Web app'], ['g2', 'box', 'Auth service']]);
    expect(page.edges).toEqual([expect.objectContaining({ id: 'g3', from: 'g1', to: 'g2', label: 'POST /login', fromInferred: true, toInferred: true, endArrow: 'classic' })]);
    expect(page.warnings.join('\n')).toMatch(/1 edge is not connected to a shape/);
  });

  it('extract finds the board inside the envelope use_figma returns, and cover checks it like any facts', async () => {
    const result = await run(fakeFigma('Board', board()), { section: 'Checkout' });
    const wrapped = Buffer.from(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(result) }] }));
    const r = extractFacts(wrapped, 'board.json');
    expect(r.ok).toBe(true);
    expect(r.facts.pages[0].nodes).toHaveLength(5);
    expect(extractFacts(Buffer.from('{"a":1}'), 'x.json')).toMatchObject({ ok: false, error: expect.stringMatching(/zukaiBoard/) });
    const ir = { schemaVersion: 1, kind: 'flowchart', title: 'Checkout', nodes: [{ id: 'a', label: 'Enter card' }, { id: 'b', label: 'Card valid?' }], edges: [], meta: { omitted: ['"Draft", "Payments DB", "yes", the table (id uuid, amount decimal) and the sticky "Ask PM about 3DS": out of the flow'] } };
    expect(cover(r.facts, [{ name: 'checkout', ir }])).toMatchObject({ ok: true });
  });

  it('reads a real board: a sequence diagram generate_diagram drew, completed by the overlay script', () => {
    // Read with the reader script from a FigJam test board made from fixtures/sequence/valid.json.
    const raw = readFileSync(join(scriptsDir, 'tests', 'recook-sources', 'figjam-login-sequence.board.json'));
    const r = extractFacts(raw, 'board.json');
    expect(r.ok).toBe(true);
    const [page] = r.facts.pages;
    expect(page.kindHints[0]).toMatchObject({ kind: 'sequence', evidence: ['4 lifelines', '2 block frames'] });
    const lifelines = page.nodes.filter((n) => n.shape === 'lifeline');
    expect(lifelines.map((n) => [n.label, n.texts ?? []])).toEqual([['User', []], ['Web app', []], ['Auth service', ['«control»']], ['User DB', ['«database»']]]);
    expect(page.nodes.filter((n) => n.shape === 'frame').map((n) => [n.label, n.texts ?? []])).toEqual([['loop  [until 3 attempts]', []], ['alt  [password matches]', ['else  [password wrong]']]]);
    const byId = Object.fromEntries(page.nodes.map((n) => [n.label, n.id]));
    const messages = page.edges.filter((e) => e.label).sort((a, b) => a.y - b.y);
    expect(messages.map((e) => e.label)).toEqual(['Submit credentials', 'POST /login', 'SELECT user by email', 'user row', '200 session token', 'Redirect to dashboard', '401 invalid credentials', 'Show error', 'Audit login attempt']);
    expect(messages[0]).toMatchObject({ from: byId.User, to: byId['Web app'], endArrow: 'block' });
    expect(messages[3]).toMatchObject({ from: byId['User DB'], to: byId['Auth service'], dashed: true });
    expect(messages[8].endArrow).toBe('open');
    // The self-message drawn as three segments joins the Auth service to itself, by position.
    expect(page.edges.filter((e) => !e.label).every((e) => e.from === byId['Auth service'] && e.to === byId['Auth service'] && e.fromInferred)).toBe(true);
    expect(cover(r.facts, [{ name: 'login', ir: loadFixture('sequence', 'valid') }])).toMatchObject({ ok: true, units: 21 });
  });

  it('reads a whole real page in three parts: 19 diagrams, each with its kind, the native ones read back from their groups', () => {
    // Read with the reader script from the FigJam test board: the diagrams generate_diagram
    // drew on the page and the sections emit --native drew from the repository fixtures.
    const dir = join(scriptsDir, 'tests', 'recook-sources', 'figjam-page');
    const r = extractBoards([1, 2, 3].map((i) => readFileSync(join(dir, `board-${i}.json`))));
    expect(r.ok).toBe(true);
    const pages = r.facts.pages;
    expect(pages).toHaveLength(19);
    const kind = (name) => pages.find((p) => p.name === name).kindHints[0].kind;
    expect(kind('Order checkout (native)')).toBe('flowchart');
    expect(kind('Order domain (native)')).toBe('class');
    expect(kind('Return request (native)')).toBe('activity');
    expect(kind('Order data model (native)')).toBe('er');
    expect(kind('Login with password (native)')).toBe('sequence');
    expect(kind('Order lifecycle (native)')).toBe('state');
    expect(kind('Order platform on AWS (native)')).toBe('architecture');
    expect(kind('Order fulfilment (native)')).toBe('activity');
    // Every text the source model holds is found again (only the section title, which says "(native)", is extra).
    for (const [name, k, fixture] of [['Order checkout (native)', 'flowchart', 'valid'], ['Order domain (native)', 'class', 'valid'], ['Login with password (native)', 'sequence', 'valid'], ['Order lifecycle (native)', 'state', 'valid'], ['Order platform on AWS (native)', 'architecture', 'valid-aws']]) {
      const page = pages.find((p) => p.name === name);
      expect(cover({ ...r.facts, pages: [page] }, [{ name: fixture, ir: loadFixture(k, fixture) }]).missing.map((m) => m.text), name).toEqual([name]);
    }
    const flow = pages.find((p) => p.name === 'Order checkout (native)');
    expect(flow.nodes.map((n) => n.shape).sort()).toEqual(['box', 'box', 'container', 'container', 'decision', 'io', 'note', 'rounded', 'rounded', 'subroutine', 'subroutine']);
    expect(flow.edges.every((e) => flow.nodes.find((n) => n.id === e.from)?.shape !== 'container' && flow.nodes.find((n) => n.id === e.to)?.shape !== 'container')).toBe(true);
    const seq = pages.find((p) => p.name === 'Login with password (native)');
    expect(seq.nodes.filter((n) => n.shape === 'frame').map((n) => [n.label, n.texts ?? []])).toEqual([['alt password matches', ['else password wrong']], ['loop until 3 attempts', []]]);
    expect(seq.nodes.find((n) => n.label === 'User')).toMatchObject({ shape: 'lifeline', detail: 'actor' });
    const cls = pages.find((p) => p.name === 'Order domain (native)');
    expect(cls.nodes.find((n) => n.label === 'OrderLine')).toMatchObject({ shape: 'table', texts: ['+Quantity: int', '+UnitPrice: Money'] });
    const aws = pages.find((p) => p.name === 'Order platform on AWS (native)');
    expect(aws.nodes.find((n) => n.label === 'Customer browser')).toMatchObject({ shape: 'icon' });
    expect(aws.edges.find((e) => e.label === 'HTTPS')).toMatchObject({ from: aws.nodes.find((n) => n.label === 'Customer browser').id, to: aws.nodes.find((n) => n.label === 'CloudFront').id });
    // The state diagram generate_diagram drew on the page: its start and end circles are read.
    const state = pages.find((p) => p.nodes.some((n) => n.label === 'Awaiting payment'));
    expect(state.kindHints[0].kind).toBe('state');
    expect(state.nodes.map((n) => n.shape)).toEqual(expect.arrayContaining(['initial', 'final']));
  });

  it('reads the ends of drawn lines on fresh reads of native sections: arrowheads, ER ends, multiplicities, branches', () => {
    const read = (name) => extractFacts(readFileSync(join(scriptsDir, 'tests', 'recook-sources', 'figjam-native', name)), 'board.json').facts;
    const seqFacts = read('sequence-18-444.json');
    const seq = seqFacts.pages[0];
    const label = (id) => seq.nodes.find((n) => n.id === id)?.label.split('\n').pop();
    const msg = (text) => seq.edges.find((e) => e.label === text);
    expect(msg('POST /login')).toMatchObject({ endArrow: 'block' });
    expect(msg('user row')).toMatchObject({ endArrow: 'open', dashed: true });
    expect(msg('Audit login attempt').endArrow).toBe('open');
    expect(msg('Audit login attempt').dashed).toBeUndefined();
    const self = msg('Verify password hash');
    expect([label(self.from), label(self.to)]).toEqual(['Auth service', 'Auth service']);
    expect(seq.nodes.find((n) => n.shape === 'frame' && n.label === 'alt password matches').detail).toBe('"else password wrong" from y 469');
    expect(cover(seqFacts, [{ name: 'login', ir: loadFixture('sequence', 'valid') }]).missing).toEqual([]);

    const erFacts = read('er-17-444.json');
    const er = erFacts.pages[0];
    const rel = (text) => er.edges.find((e) => e.label === text);
    expect(er.kindHints[0].kind).toBe('er');
    expect(rel('places')).toMatchObject({ startArrow: 'ERmandOne', endArrow: 'ERzeroToMany' });
    expect(rel('contains')).toMatchObject({ startArrow: 'ERmandOne', endArrow: 'ERoneToMany' });
    expect(rel('appears in')).toMatchObject({ startArrow: 'ERmandOne', endArrow: 'ERzeroToMany' });
    expect(cover(erFacts, [{ name: 'er', ir: loadFixture('er', 'valid') }]).missing).toEqual([]);

    // A class composition on the older page read: the diamond, and each multiplicity at its end.
    const dir = join(scriptsDir, 'tests', 'recook-sources', 'figjam-page');
    const page = extractBoards([1, 2, 3].map((i) => readFileSync(join(dir, `board-${i}.json`)))).facts.pages.find((p) => p.name === 'Order domain (native)');
    expect(page.edges.find((e) => e.label === 'lines')).toMatchObject({ startArrow: 'diamond', startLabel: '1', endLabel: '1..*' });
    expect(page.edges.filter((e) => e.endArrow === 'block-open')).toHaveLength(2);
  });
});
