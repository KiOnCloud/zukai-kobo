import { describe, it, expect } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { driftDrawio, parseDrawioPages } from '../src/drift.mjs';
import { emit, bundle } from '../src/pipeline.mjs';
import { validFixtures, loadFixture } from './helpers.mjs';

const flow = loadFixture('flowchart', 'valid');
const state = validFixtures().find((f) => f.kind === 'state').ir;
const seq = loadFixture('sequence', 'valid');

async function single(ir, id) {
  const r = await emit(ir, 'drawio', { diagramId: id });
  expect(r.ok).toBe(true);
  return r.output;
}

/** First vertex cell of a page that has a value, as [whole tag, id]. */
function firstVertex(xml, page) {
  const m = new RegExp(`<mxCell id="(${page}:[^"]+)" value="[^"]+"[^>]*vertex="1"[^>]*>\\s*<mxGeometry x="(\\d+)"`).exec(xml);
  return { id: m[1], x: Number(m[2]), whole: m[0] };
}

describe('driftDrawio', () => {
  it('finds no drift in an emitted file, for every valid fixture', async () => {
    for (const { kind, name, ir } of validFixtures()) {
      const id = `${kind}-${name}`;
      const r = await emit(ir, 'drawio', { diagramId: id });
      if (!r.ok) continue; // targets that reject a feature are covered by the feature matrix tests
      const d = await driftDrawio(r.output, [{ id, ir }]);
      expect(d, `${kind}/${name}`).toMatchObject({ ok: true, drifted: false, bundled: false });
    }
  }, 60_000);

  it('reports a moved shape, a reworded label and a copied shape on the right cells', async () => {
    let xml = await single(flow, 'main');
    const v = firstVertex(xml, 'main');
    xml = xml.replace(v.whole, v.whole.replace(`x="${v.x}"`, `x="${v.x + 30}"`));
    xml = xml.replace(/(<mxCell id="main:[^"]+" value=")[^"]+("[^>]*vertex="1")/, '$1Reworded by hand$2');
    const copy = /<mxCell id="main:[^"]+"[^>]*vertex="1"[^>]*>[\s\S]*?<\/mxCell>/.exec(xml)[0].replace(/id="main:[^"]+"/, 'id="Xy7-1"');
    xml = xml.replace('</root>', `${copy}\n</root>`);
    const d = await driftDrawio(xml, [{ id: 'main', ir: flow }]);
    expect(d.drifted).toBe(true);
    const changes = d.pages[0].changes;
    expect(changes).toContainEqual({ cell: v.id, change: 'moved' });
    expect(changes.some((c) => c.change === 'relabelled' && c.detail.endsWith('-> "Reworded by hand"'))).toBe(true);
    expect(changes.some((c) => c.cell === 'Xy7-1' && c.change === 'added')).toBe(true);
  });

  it('reports a deleted connection as removed', async () => {
    const xml = await single(flow, 'main');
    const edge = /<mxCell id="(main:[^"]+)"[^>]*edge="1"[^>]*>[\s\S]*?<\/mxCell>/.exec(xml);
    const d = await driftDrawio(xml.replace(edge[0], ''), [{ id: 'main', ir: flow }]);
    expect(d.pages[0].changes.some((c) => c.cell === edge[1] && c.change === 'removed')).toBe(true);
  });

  it('reads a page draw.io saved compressed as the same cells', async () => {
    const xml = await single(seq, 'login');
    const compressed = xml.replace(/(<diagram\b[^>]*>)([\s\S]*?)(<\/diagram>)/, (_, open, body, close) => `${open}${deflateRawSync(Buffer.from(encodeURIComponent(body.trim()))).toString('base64')}${close}`);
    expect(compressed).not.toContain('<mxCell');
    const d = await driftDrawio(compressed, [{ id: 'login', ir: seq }]);
    expect(d.drifted).toBe(false);
  });

  it('ignores the viewport settings draw.io rewrites on every save', async () => {
    const xml = (await single(flow, 'main')).replace('dx="0" dy="0"', 'dx="1426" dy="797"');
    expect((await driftDrawio(xml, [{ id: 'main', ir: flow }])).drifted).toBe(false);
  });

  it('recovers title, canvas order and gap from a bundle and finds no drift in it', async () => {
    const entries = [{ id: 'checkout', ir: flow }, { id: 'order-state', ir: state }, { id: 'login', ir: seq }];
    const r = await bundle(entries, 'drawio', { title: 'Shop', canvas: ['login', 'checkout'], gap: 260 });
    expect(r.ok).toBe(true);
    const d = await driftDrawio(r.output, entries);
    expect(d).toMatchObject({ ok: true, drifted: false, bundled: true, bundle: { title: 'Shop', canvas: ['login', 'checkout'], gap: 260 } });
  });

  it('treats a bundle without a canvas as bundled with no options', async () => {
    const entries = [{ id: 'checkout', ir: flow }, { id: 'login', ir: seq }];
    const r = await bundle(entries, 'drawio', {});
    const d = await driftDrawio(r.output, entries);
    expect(d).toMatchObject({ drifted: false, bundled: true, bundle: {} });
  });

  it('reports a shape moved on one page of a bundle on that page only', async () => {
    const entries = [{ id: 'checkout', ir: flow }, { id: 'login', ir: seq }];
    let xml = (await bundle(entries, 'drawio', { canvas: 'all' })).output;
    const page = /<diagram id="login"[\s\S]*?<\/diagram>/.exec(xml)[0];
    const v = firstVertex(page, 'login');
    xml = xml.replace(page, page.replace(v.whole, v.whole.replace(`x="${v.x}"`, `x="${v.x + 15}"`)));
    const d = await driftDrawio(xml, entries);
    expect(d.drifted).toBe(true);
    expect(d.pages.filter((p) => p.changes.length > 0).map((p) => p.diagram)).toEqual(['login']);
  });

  it('names pages without an IR and IRs without a page', async () => {
    const xml = await single(flow, 'main');
    const d = await driftDrawio(xml.replace('<diagram id="main"', '<diagram id="other"').replaceAll('"main:', '"other:'), [{ id: 'main', ir: flow }]);
    expect(d.ok).toBe(true);
    expect(d.drifted).toBe(false); // a single file is compared with its own page id
    const b = (await bundle([{ id: 'checkout', ir: flow }, { id: 'login', ir: seq }], 'drawio', {})).output;
    const m = await driftDrawio(b, [{ id: 'checkout', ir: flow }]);
    expect(m.pages).toContainEqual({ diagram: 'login', unmatched: true, changes: [] });
  });

  it('rejects a file that is not draw.io', async () => {
    expect(await driftDrawio('flowchart TD\n a --> b', [{ id: 'x', ir: flow }])).toMatchObject({ ok: false });
  });

  it('parses a UserObject cell (a step with a page link) with its label and link', async () => {
    const entries = [
      { id: 'main', ir: { schemaVersion: 1, kind: 'flowchart', title: 'Main', nodes: [{ id: 'a', label: 'Pay', shape: 'subroutine', ref: 'part' }], edges: [] } },
      { id: 'part', ir: { schemaVersion: 1, kind: 'flowchart', title: 'Part', nodes: [{ id: 'b', label: 'Charge', shape: 'process' }], edges: [] } },
    ];
    const xml = (await bundle(entries, 'drawio', {})).output;
    const cell = parseDrawioPages(xml).find((p) => p.id === 'main').cells.get('main:a');
    expect(cell.link).toBe('data:page/id,part');
    expect(cell.value).toContain('Pay');
  });
});
