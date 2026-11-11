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
    // Two members give one measurement, which is taken as it is.
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

  it('reads a file draw.io re-saved with numeric references as unchanged', async () => {
    const ir = { schemaVersion: 1, kind: 'flowchart', title: "User's cart", nodes: [{ id: 'a', label: "User's cart", shape: 'process' }, { id: 'b', label: 'Pay', shape: 'process' }], edges: [{ id: 'e', from: 'a', to: 'b', label: "it's paid" }] };
    const entries = [{ id: 'cart', ir }, { id: 'login', ir: seq }];
    const xml = (await bundle(entries, 'drawio', { canvas: 'all', title: "Owner's run" })).output;
    // draw.io's serializer writes an apostrophe as &#39; and a line break as &#xa;.
    const resaved = xml.replaceAll("'", '&#39;').replaceAll('&#10;', '&#xa;');
    expect(resaved).toContain('&#39;');
    const d = await driftDrawio(resaved, entries);
    expect(d).toMatchObject({ drifted: false, bundle: { title: "Owner's run", canvas: 'all' } });
  });

  it('reads a cell draw.io wrapped in <object> by Edit Data as the same cell', async () => {
    const xml = await single(flow, 'main');
    const cell = /<mxCell id="(main:[^"]+)" value="([^"]+)"([^>]*vertex="1"[^>]*)>([\s\S]*?)<\/mxCell>/.exec(xml);
    const wrapped = `<object label="${cell[2]}" owner="ops" id="${cell[1]}"><mxCell${cell[3]}>${cell[4]}</mxCell></object>`;
    const d = await driftDrawio(xml.replace(cell[0], wrapped), [{ id: 'main', ir: flow }]);
    expect(d.drifted).toBe(false);
  });

  it('reports a page added to a single-diagram file as that page only', async () => {
    const xml = (await single(seq, 'login')).replace('</mxfile>', '  <diagram id="notes-1" name="Notes"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="n" value="todo" vertex="1" parent="1"><mxGeometry x="0" y="0" width="80" height="30" as="geometry"/></mxCell></root></mxGraphModel></diagram>\n</mxfile>');
    const d = await driftDrawio(xml, [{ id: 'login', ir: seq }]);
    expect(d.bundled).toBe(false);
    expect(d.pages).toEqual([{ diagram: 'login', changes: [] }, { diagram: 'notes-1', unmatched: true, changes: [] }]);
  });

  it('matches pages through the slug of long and non-kebab diagram ids', async () => {
    const entries = [
      { id: 'customer-onboarding-identity-check-flow-detailed', ir: flow },
      { id: 'Login_Flow', ir: seq },
    ];
    const xml = (await bundle(entries, 'drawio', { canvas: 'all', title: 'Onboarding' })).output;
    const d = await driftDrawio(xml, entries);
    expect(d).toMatchObject({ drifted: false, bundled: true, bundle: { title: 'Onboarding', canvas: 'all' } });
  });

  it('keeps the gap and names the title cell when one canvas title is moved by hand', async () => {
    const entries = [{ id: 'checkout', ir: flow }, { id: 'order-state', ir: state }, { id: 'login', ir: seq }];
    let xml = (await bundle(entries, 'drawio', { canvas: 'all', gap: 200 })).output;
    const canvas = /<diagram id="canvas"[\s\S]*?<\/diagram>/.exec(xml)[0];
    const moved = canvas.replace(/(<mxCell id="order-state:title"[^>]*>\s*<mxGeometry x=")([\d.]+)/, (_, a, x) => `${a}${Number(x) + 40}`);
    expect(moved).not.toBe(canvas);
    xml = xml.replace(canvas, moved);
    const d = await driftDrawio(xml, entries);
    expect(d.bundle.gap).toBe(200);
    const changes = d.pages.find((p) => p.diagram === 'canvas').changes;
    expect(changes).toEqual([{ cell: 'order-state:title', change: 'moved' }]);
  });

  it('returns the canvas as a list when it is a subset or out of file order', async () => {
    const entries = [{ id: 'checkout', ir: flow }, { id: 'login', ir: seq }];
    const r = await bundle(entries, 'drawio', { canvas: ['login', 'checkout'] });
    expect((await driftDrawio(r.output, entries)).bundle.canvas).toEqual(['login', 'checkout']);
  });
});
