import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { emit } from '../src/pipeline.mjs';
import { figjamReaderScript, joinBoardParts, extractFigjamBoard } from '../src/extract-figjam.mjs';
import { extractFacts } from '../src/extract.mjs';
import { cover } from '../src/cover.mjs';
import { standInFigma } from './figma-stand-in.mjs';
import { validFixtures, scriptsDir, loadFixture } from './helpers.mjs';

/**
 * The round trip emit --native -> board -> extract, for every valid fixture of every kind: the
 * scripts are run on the stand-in of the Plugin API, the board is read back with the reader
 * script, and the facts must give back the model: its kind first among the hints, every text,
 * and every relation of the IR as an edge between the right two elements with its label.
 */

/** Draw the scripts of an IR on a fresh stand-in page and read the section back, part by part. */
export async function drawAndRead(ir) {
  const r = await emit(ir, 'figjam', { native: true, nativeOnly: true, allowSensitive: true });
  expect(r.ok, JSON.stringify(r.errors)).toBe(true);
  const board = standInFigma();
  let section;
  for (const part of r.native) section = (await board.run(part)).section;
  const parts = [];
  let from = 0;
  do {
    const part = await board.run(figjamReaderScript({ section, from }));
    parts.push(part);
    from = part.next;
  } while (from !== null);
  const joined = joinBoardParts(parts);
  expect(joined.error).toBeUndefined();
  return extractFigjamBoard(joined.board);
}

const tokens = (s) => String(s ?? '').normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
const has = (haystack, needle) => {
  const h = new Set(tokens(haystack));
  const n = tokens(needle);
  return n.length > 0 && (n.every((t) => h.has(t)) || tokens(haystack).join('').includes(n.join('')));
};

/** Every element of an IR with an id, and the ones that join two of them. */
function relationsOf(ir) {
  const byId = new Map();
  const joins = [];
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      if (typeof v.id === 'string') byId.set(v.id, v);
      if (typeof v.from === 'string' && typeof v.to === 'string') joins.push(v);
      for (const [k, x] of Object.entries(v)) if (k !== 'meta') walk(x);
    }
  };
  walk(ir);
  return { byId, joins: joins.filter((j) => byId.has(j.from) && byId.has(j.to)) };
}

const textOf = (el) => el.label ?? el.name ?? '';

describe('emit --native, the board, then extract: the round trip holds for every kind', () => {
  for (const { kind, name, ir } of validFixtures()) {
    it(`${kind}/${name}`, async () => {
      const facts = await drawAndRead(ir);
      expect(facts.pages).toHaveLength(1);
      const [page] = facts.pages;
      expect(page.kindHints[0]?.kind, JSON.stringify(page.kindHints)).toBe(ir.kind);
      // Every text of the board is in the model, and every edge with two known ends joins two elements of it.
      const c = cover(facts, [{ name, ir }]);
      expect(c.missing.filter((m) => m.text !== ir.title)).toEqual([]);
      expect(c.lostEdges).toEqual([]);
      // Every relation of the model is an edge of the board, between the elements that carry the
      // texts of its ends, with its label.
      const nodes = new Map(page.nodes.map((n) => [n.id, n]));
      const nodeText = (id) => { const n = nodes.get(id); return n ? [n.label, ...(n.texts ?? [])].join('\n') : undefined; };
      const ends = (el) => (textOf(el) ? (t) => t !== undefined && has(t, textOf(el)) : (t) => t !== undefined);
      const { byId, joins } = relationsOf(ir);
      for (const j of joins) {
        const a = ends(byId.get(j.from));
        const b = ends(byId.get(j.to));
        const label = j.label ?? j.event ?? '';
        const found = page.edges.find((e) => ((a(nodeText(e.from)) && b(nodeText(e.to))) || (b(nodeText(e.from)) && a(nodeText(e.to))))
          && (label === '' || has([e.label, e.startLabel, e.endLabel].join('\n'), label)));
        expect(found, `${kind}/${name}: ${j.id ?? ''} ${textOf(byId.get(j.from))} -> ${textOf(byId.get(j.to))} "${label}"`).toBeDefined();
      }
    }, 30_000);
  }
});

describe('a use case board read back', () => {
  it('reads the board of the real FigJam round: figures as actors, include and extend lines as edges, the use case hint first', () => {
    // Read with the reader script from a FigJam board that emit --native drew from a use case IR.
    const facts = extractFacts(readFileSync(join(scriptsDir, 'tests', 'recook-sources', 'figjam-native', 'usecase-1-2.json')), 'board.json').facts;
    const [page] = facts.pages;
    expect(page.kindHints[0]).toMatchObject({ kind: 'usecase', evidence: ['8 ovals, 4 actor figures, 4 lines marked «include» or «extend»'] });
    const label = (id) => page.nodes.find((n) => n.id === id)?.label;
    expect(page.nodes.filter((n) => n.shape === 'actor').map((n) => n.label)).toEqual(['Patient', 'Registered patient', 'Receptionist', 'Doctor']);
    const lines = page.edges.map((e) => [label(e.from), label(e.to), e.label, e.endArrow, e.dashed === true]);
    expect(lines).toEqual(expect.arrayContaining([
      ['Registered patient', 'Patient', '', 'block-open', false],
      ['Book an appointment', 'Log in', '«include»', 'open', true],
      ['Cancel an appointment', 'Log in', '«include»', 'open', true],
      ['Book an appointment', 'Send a reminder', '«include»', 'open', true],
      ['Pay a deposit', 'Book an appointment', '«extend»\n[first visit of the patient]', 'open', true],
    ]));
    expect(page.edges).toHaveLength(11);
    expect(page.nodes.some((n) => n.shape === 'box' && /«include»|«extend»/.test(n.label))).toBe(false);

    // The IR the mapping writes from these facts covers them, and one that drops an include line is caught.
    const ir = {
      schemaVersion: 1, kind: 'usecase', title: 'Clinic booking use cases',
      actors: [{ id: 'patient', label: 'Patient' }, { id: 'registered', label: 'Registered patient' }, { id: 'receptionist', label: 'Receptionist' }, { id: 'doctor', label: 'Doctor' }, { id: 'sms', label: 'SMS gateway', kind: 'system' }],
      useCases: [['search', 'Search available slots'], ['book', 'Book an appointment'], ['cancel', 'Cancel an appointment'], ['login', 'Log in'], ['remind', 'Send a reminder'], ['schedule', 'Manage the doctor schedule'], ['deposit', 'Pay a deposit'], ['today', "View today's appointments"]].map(([id, l]) => ({ id, label: l })),
      boundaries: [{ id: 'system', label: 'Clinic booking system', children: ['search', 'book', 'cancel', 'login', 'remind', 'schedule', 'deposit', 'today'] }],
      relations: [
        { id: 'g', from: 'registered', to: 'patient', kind: 'generalization' },
        ...[['patient', 'search'], ['registered', 'book'], ['registered', 'cancel'], ['receptionist', 'schedule'], ['doctor', 'today'], ['sms', 'remind']].map(([from, to], i) => ({ id: `a${i}`, from, to, kind: 'association' })),
        { id: 'i1', from: 'book', to: 'login', kind: 'include' },
        { id: 'i2', from: 'cancel', to: 'login', kind: 'include' },
        { id: 'i3', from: 'book', to: 'remind', kind: 'include' },
        { id: 'x1', from: 'deposit', to: 'book', kind: 'extend', condition: 'first visit of the patient' },
      ],
      meta: { source: 'recook', notes: ['page "Clinic booking use cases"'] },
    };
    // «include» and «extend» are the kinds of the relations; the frame words of the board are the IR's kinds.
    const kept = cover(facts, [{ name: 'uc', ir: { ...ir, relations: ir.relations.map((r) => (r.kind === 'include' || r.kind === 'extend' ? { ...r, label: `«${r.kind}»` } : r)) } }]);
    expect(kept).toMatchObject({ ok: true, missing: [], lostEdges: [], edges: 11 });
    const dropped = { ...ir, relations: ir.relations.filter((r) => r.id !== 'i2').map((r) => (r.kind === 'include' || r.kind === 'extend' ? { ...r, label: `«${r.kind}»` } : r)) };
    const c = cover(facts, [{ name: 'uc', ir: dropped }]);
    expect(c.ok).toBe(false);
    expect(c.missing).toEqual([]);
    expect(c.lostEdges).toEqual([expect.objectContaining({ from: 'Cancel an appointment', to: 'Log in', label: '«include»' })]);
  });
});

describe('cover on a board read back', () => {
  it('reports a connection the IR lost although another connection carries the same label', async () => {
    // The board has a second line "reads and writes", from the PDF renderer to the database.
    const drawn = loadFixture('architecture', 'valid-gcp-invoicing');
    drawn.connections.push({ id: 'renderer-db', from: 'pdf-renderer', to: 'invoice-db', label: 'reads and writes' });
    const facts = await drawAndRead(drawn);
    expect(facts.pages[0].edges.filter((e) => e.label === 'reads and writes')).toHaveLength(2);
    // A recook that wrote only one of the two finds every text, and still does not pass.
    const recooked = loadFixture('architecture', 'valid-gcp-invoicing');
    const c = cover(facts, [{ name: 'gcp', ir: recooked }]);
    expect(c.missing.filter((m) => m.text !== recooked.title)).toEqual([]);
    expect(c.ok).toBe(false);
    expect(c.lostEdges).toEqual([expect.objectContaining({ from: 'PDF renderer (Cloud Run)', to: 'Cloud SQL for PostgreSQL', label: 'reads and writes' })]);
    // Written into the IR, or left out with its reason, it passes.
    expect(cover(facts, [{ name: 'gcp', ir: drawn }]).lostEdges).toEqual([]);
    const omitted = { ...recooked, meta: { ...recooked.meta, omitted: ['"reads and writes" from "PDF renderer (Cloud Run)" to "Cloud SQL for PostgreSQL": the renderer keeps no data of its own'] } };
    expect(cover(facts, [{ name: 'gcp', ir: omitted }]).lostEdges).toEqual([]);
  });
});

describe('the pictures of an architecture board read back', () => {
  it('reads a client screen as a client, and the Google Cloud mark as part of its frame, not as a node', async () => {
    const ir = loadFixture('architecture', 'valid-gcp-invoicing');
    const [page] = (await drawAndRead(ir)).pages;
    const client = ir.components.find((c) => c.kind === 'client');
    expect(page.nodes.find((n) => n.label === client.label)).toMatchObject({ shape: 'client' });
    expect(page.nodes.find((n) => n.label === client.label).icon).toBeUndefined();
    expect(page.nodes.filter((n) => !n.label)).toEqual([]);
    expect(page.nodes.filter((n) => n.group === 'gcp:google_cloud')).toHaveLength(1);
  });

  it('skips the mark on a board drawn before the frame parts were tagged', () => {
    const facts = extractFigjamBoard({ zukaiBoard: 1, page: 'P', section: 'S', root: 's', nodes: [
      { id: 'g', type: 'GROUP', name: 'Google Cloud [gcp:google_cloud]', parent: 's', box: [0, 0, 600, 400] },
      { id: 'gr', type: 'RECTANGLE', parent: 'g', box: [0, 0, 600, 400] },
      { id: 'gt', type: 'TEXT', parent: 'g', text: 'Google Cloud', box: [50, 6, 75, 14] },
      { id: 'm', type: 'GROUP', name: 'invoicing:gcloud:mark', parent: 'g', box: [20, 10, 23, 20] },
      { id: 'm1', type: 'VECTOR', parent: 'm', box: [20, 10, 23, 20], ends: [[20, 10], [43, 30]], closed: 1, filled: 1 },
      { id: 'm2', type: 'VECTOR', parent: 'm', box: [25, 12, 10, 10], ends: [[25, 12], [35, 22]], closed: 1, filled: 1 },
    ] });
    expect(facts.pages[0].nodes.map((n) => [n.label, n.shape])).toEqual([['Google Cloud', 'group']]);
  });
});
