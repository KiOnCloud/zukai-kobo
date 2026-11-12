import { describe, it, expect } from 'vitest';
import { emit } from '../src/pipeline.mjs';
import { figjamOverlay, sequenceRows } from '../src/figjam-overlay.mjs';
import { loadFixture, validFixtures } from './helpers.mjs';

const MESSAGE_LINE = /^(\S+?)(-->>|->>|-\))(\S+?): (.+)$/;

/**
 * A stand-in for the board Figma's generate_diagram makes of a sequence diagram, as it was
 * read back from a real board: one lifeline per participant, one connector per message row
 * 80 apart, and for a message of a participant to itself a stray connector tied to the page.
 */
function fakeBoard(text, title) {
  let seq = 0;
  const nodes = new Map();
  const make = (type, extra = {}) => {
    const n = {
      id: `1:${++seq}`, type, name: type, x: 0, y: 0, width: 10, height: 10,
      resize(w, h) { this.width = w; this.height = h; },
      resizeWithoutConstraints(w, h) { this.width = w; this.height = h; },
      remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); },
      ...extra,
    };
    if (type === 'CONNECTOR' || type === 'SHAPE_WITH_TEXT') n.text = { characters: '', fontName: null, ...(extra.text ?? {}) };
    if (type === 'TEXT') Object.defineProperty(n, 'characters', { set(v) { this.chars = v; this.width = v.length * 7; this.height = 16; }, get() { return this.chars; } });
    nodes.set(n.id, n);
    return n;
  };
  const section = make('SECTION', { name: title, x: 400, y: -50, width: 1140, height: 900, children: [], absoluteTransform: [[1, 0, 400], [0, 1, -50]] });
  section.appendChild = (c) => { c.parent = section; section.children.push(c); };
  section.insertChild = (i, c) => { c.parent = section; section.children.splice(i, 0, c); };
  const lines = text.split('\n').map((l) => l.trim());
  const lifeOf = new Map();
  for (const l of lines) {
    const m = /^(?:participant|actor) (\S+) as (.+)$/.exec(l);
    if (!m) continue;
    const head = make('SHAPE_WITH_TEXT', { x: 50 + 280 * lifeOf.size, y: 50, width: 200, height: 100, text: { characters: m[2] } });
    const foot = make('SHAPE_WITH_TEXT', { x: 50 + 280 * lifeOf.size, y: 700, width: 200, height: 100, text: { characters: m[2] } });
    const life = make('CONNECTOR', { x: 150 + 280 * lifeOf.size, y: 158, connectorStart: { endpointNodeId: head.id, magnet: 'BOTTOM' }, connectorEnd: { endpointNodeId: foot.id, magnet: 'TOP' }, connectorStartStrokeCap: 'NONE', connectorEndStrokeCap: 'NONE' });
    for (const n of [head, foot, life]) section.appendChild(n);
    lifeOf.set(m[1], life);
  }
  let row = 0;
  for (const l of lines) {
    const m = MESSAGE_LINE.exec(l);
    if (!m) continue;
    row++;
    const self = m[1] === m[3];
    const end = (id) => (self ? { endpointNodeId: '0:1', position: { x: 0, y: 0 } } : { endpointNodeId: lifeOf.get(id).id, position: { x: 0, y: 80 * row } });
    section.appendChild(make('CONNECTOR', { connectorStart: end(m[1]), connectorEnd: end(m[3]), connectorStartStrokeCap: 'NONE', connectorEndStrokeCap: 'ARROW_EQUILATERAL', text: { characters: self ? '' : m[4] } }));
  }
  const figma = {
    currentPage: { children: [section] },
    getNodeByIdAsync: async (id) => nodes.get(id) ?? null,
    loadFontAsync: async () => {},
    createText: () => make('TEXT'),
    createRectangle: () => make('RECTANGLE'),
    createLine: () => make('LINE'),
    createVector: () => make('VECTOR'),
    createConnector: () => make('CONNECTOR'),
    createShapeWithText: () => make('SHAPE_WITH_TEXT'),
  };
  return { figma, section };
}

const AsyncFunction = (async () => {}).constructor;
const runOn = (script, figma) => new AsyncFunction('figma', script)(figma);
const sequenceFixtures = () => validFixtures().filter((f) => f.ir.kind === 'sequence');

describe('figjam overlay script', () => {
  it('is made only for a sequence diagram, and only when the board lacks something', async () => {
    expect(figjamOverlay(loadFixture('flowchart', 'valid'))).toBeNull();
    expect((await emit(loadFixture('er', 'valid'), 'figjam')).overlay).toBeUndefined();
    // Plain participants and nothing but an asynchronous message: the board is complete as generated.
    const plain = { schemaVersion: 1, kind: 'sequence', title: 'Ping', participants: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], messages: [{ id: 'm1', from: 'a', to: 'b', label: 'ping', kind: 'async' }] };
    expect((await emit(plain, 'figjam')).ok).toBe(true);
    expect((await emit(plain, 'figjam')).overlay).toBeUndefined();
    // A participant kind or a call that activates its target is enough.
    expect(figjamOverlay({ ...plain, participants: [{ id: 'a', label: 'A', kind: 'actor' }, { id: 'b', label: 'B' }] })).toContain('"kinds":["actor","participant"]');
    expect(figjamOverlay({ ...plain, messages: [{ ...plain.messages[0], kind: 'sync' }] })).toContain('"activations":[{"at":1,"top":0,"bottom":null}]');
    expect((await emit(loadFixture('sequence', 'valid'), 'figjam')).overlay).toContain('use_figma');
    expect((await emit(loadFixture('sequence', 'valid'), 'mermaid')).overlay).toBeUndefined();
  });

  it('is not made when the secret scan refuses the diagram', async () => {
    const ir = structuredClone(loadFixture('sequence', 'valid'));
    ir.notes[0].label = 'call 0912345678';
    const r = await emit(ir, 'figjam');
    expect(r.ok).toBe(false);
    expect(r.overlay).toBeUndefined();
  });

  it('lists the rows in the order the figjam text writes them', async () => {
    for (const { name, ir } of sequenceFixtures()) {
      const r = await emit(ir, 'figjam', { allowSensitive: true });
      const written = r.output.split('\n').filter((l) => MESSAGE_LINE.test(l.trim())).length;
      expect(sequenceRows(ir), name).toHaveLength(written);
      expect(sequenceRows(ir).filter((x) => x.type === 'message').map((x) => x.index), name).toEqual(ir.messages.map((_, i) => i));
    }
  });

  it('draws frames, the self-message and the notes on the board of the login fixture, and removes the stray arrows', async () => {
    const ir = loadFixture('sequence', 'valid');
    const r = await emit(ir, 'figjam');
    const { figma, section } = fakeBoard(r.output, ir.title);
    const before = section.children.length;
    const result = await runOn(r.overlay, figma);
    // One stray per row that is a message to the same participant: the self-message and the two notes.
    expect(result.removedNodeIds).toHaveLength(3);
    const added = section.children.filter((c) => c.name === 'zukai-overlay');
    expect(section.children.length).toBe(before - 3 + added.length);
    // The kind of a participant as the draw.io file shows it: a stereotype line on the head and the foot, a figure for the actor.
    expect(added.filter((c) => c.type === 'TEXT').map((c) => c.characters)).toEqual(['«control»', '«control»', '«database»', '«database»', 'loop  [until 3 attempts]', 'alt  [password matches]', 'else  [password wrong]', 'Verify password hash']);
    expect(added.filter((c) => c.type === 'VECTOR')).toHaveLength(1);
    expect(added.filter((c) => c.type === 'SHAPE_WITH_TEXT').map((c) => c.text.characters)).toEqual(['Rate limited per IP', 'Hash: argon2id']);
    // Two frames, a white patch under each of the three tags, three activation bars, one divider, three strokes of the self-message.
    expect(added.filter((c) => c.type === 'RECTANGLE')).toHaveLength(2 + 3 + 3);
    // The bars lie under the message arrows: before the first message connector of the section.
    const firstArrow = section.children.findIndex((c) => c.type === 'CONNECTOR' && c.text.characters === 'Submit credentials');
    const bars = section.children.filter((c) => c.type === 'RECTANGLE' && c.width === 12);
    expect(bars).toHaveLength(3);
    for (const b of bars) expect(section.children.indexOf(b)).toBeLessThan(firstArrow);
    expect(added.filter((c) => c.type === 'LINE')).toHaveLength(1);
    expect(added.filter((c) => c.type === 'CONNECTOR')).toHaveLength(3);
    // The loop frame encloses the alt frame.
    const [loop, alt] = added.filter((c) => c.type === 'RECTANGLE' && c.cornerRadius === 6);
    expect(loop.x).toBeLessThan(alt.x);
    expect(loop.y).toBeLessThan(alt.y);
    expect(loop.y + loop.height).toBeGreaterThan(alt.y + alt.height);
    // A floating connector end is in page coordinates: section offset plus the third lifeline.
    expect(added.find((c) => c.type === 'CONNECTOR').connectorStart.position.x).toBe(400 + 150 + 2 * 280);

    // A second run replaces what the first one drew instead of adding to it.
    const again = await runOn(r.overlay, figma);
    expect(again.replacedNodeIds).toBe(added.length);
    expect(again.removedNodeIds).toEqual([]);
    expect(section.children.filter((c) => c.name === 'zukai-overlay')).toHaveLength(added.length);
  });

  it('changes nothing and says why when the board is not the one the text made', async () => {
    const ir = loadFixture('sequence', 'valid');
    const r = await emit(ir, 'figjam');
    const other = fakeBoard(r.output, 'Another title');
    await expect(runOn(r.overlay, other.figma)).rejects.toThrow('no section named "Login with password"');
    const edited = fakeBoard(r.output.replace('POST /login', 'POST /signin'), ir.title);
    const count = edited.section.children.length;
    await expect(runOn(r.overlay, edited.figma)).rejects.toThrow('message 2 of the board is "POST /signin"');
    expect(edited.section.children).toHaveLength(count);
    const fewer = fakeBoard(r.output.split('\n').filter((l) => !l.includes('Audit login attempt')).join('\n'), ir.title);
    await expect(runOn(r.overlay, fewer.figma)).rejects.toThrow('Nothing was changed');
  });

  it('runs on the board of every sequence fixture and stays under the size use_figma takes', async () => {
    for (const { name, ir } of sequenceFixtures()) {
      const r = await emit(ir, 'figjam', { allowSensitive: true });
      if (!r.overlay) continue;
      expect(r.overlay.length, name).toBeLessThan(50_000);
      const { figma } = fakeBoard(r.output, ir.title);
      const result = await runOn(r.overlay, figma);
      expect(result.createdNodeIds.length, name).toBeGreaterThan(0);
    }
  });
});
