import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateRawSync, deflateSync, crc32 } from 'node:zlib';
import { emit } from '../src/pipeline.mjs';
import { drawioXmlOf, extractDrawio } from '../src/extract-drawio.mjs';
import { cover } from '../src/cover.mjs';
import { validFixtures, scriptsDir } from './helpers.mjs';

const sources = join(scriptsDir, 'tests', 'recook-sources');
const read = (name) => readFileSync(join(sources, name));
const factsOf = (buf) => {
  const x = drawioXmlOf(buf);
  expect(x.error).toBeUndefined();
  return extractDrawio(x.xml);
};
const node = (page, id) => page.nodes.find((n) => n.id === id);
const edge = (page, id) => page.edges.find((e) => e.id === id);

/** A page body compressed the way draw.io saves it by default. */
function compress(xml) {
  return xml.replace(/(<diagram\b[^>]*>)([\s\S]*?)(<\/diagram>)/g, (_, open, body, close) => `${open}${deflateRawSync(Buffer.from(encodeURIComponent(body.trim()))).toString('base64')}${close}`);
}

/** A PNG of one white pixel carrying the diagram in a text chunk, as draw.io exports it. */
function pngWith(keyword, text, compressed = false) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]);
  const idat = deflateSync(Buffer.from([0, 255, 255, 255]));
  const textChunk = compressed
    ? chunk('zTXt', Buffer.concat([Buffer.from(`${keyword}\0\0`, 'latin1'), deflateSync(Buffer.from(text, 'latin1'))]))
    : chunk('tEXt', Buffer.from(`${keyword}\0${text}`, 'latin1'));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), textChunk, chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

describe('extract draw.io: every fixture emitted by Zukai reads back', () => {
  for (const { kind, name, ir } of validFixtures()) {
    it(`${kind}/${name}: kind hint, coverage and edge ends`, async () => {
      const r = await emit(ir, 'drawio', { allowSensitive: true });
      expect(r.ok).toBe(true);
      const facts = extractDrawio(r.output);
      expect(facts.pages).toHaveLength(1);
      const page = facts.pages[0];
      expect(page.kindHints[0]?.kind).toBe(ir.kind);
      const c = cover(facts, [{ name, ir }]);
      expect(c.missing).toEqual([]);
      expect(c.units).toBeGreaterThan(0);
      const ids = new Set(page.nodes.map((n) => n.id));
      for (const e of page.edges) {
        expect(ids.has(e.from), `${e.id} from ${e.from}`).toBe(true);
        expect(ids.has(e.to), `${e.id} to ${e.to}`).toBe(true);
      }
    });
  }
});

describe('extract draw.io: files drawn by hand', () => {
  it('reads shapes, HTML labels, edge label cells, a loose edge and a text laid over an empty shape', () => {
    const page = factsOf(read('hand-flowchart.drawio')).pages[0];
    expect(page).toMatchObject({ id: 'flow1', name: 'Đặt hàng' });
    expect(page.kindHints[0].kind).toBe('flowchart');
    expect(node(page, 'enter')).toMatchObject({ shape: 'rounded', label: 'Nhập giỏ hàng\nvà địa chỉ' });
    expect(node(page, 'check').shape).toBe('decision');
    expect(node(page, 'notify').shape).toBe('io');
    expect(node(page, 'pay')).toMatchObject({ shape: 'box', label: 'Thanh toán thẻ' });
    expect(node(page, 'pay-text')).toBeUndefined();
    expect(edge(page, 'e4')).toMatchObject({ from: 'check', to: 'notify', label: 'Không' });
    expect(edge(page, 'e5')).toMatchObject({ from: 'pay', to: 'end', fromInferred: true, toInferred: true });
    expect(node(page, 'memo').shape).toBe('text');
    expect(page.warnings.join('\n')).toMatch(/text box stands over no shape: "Ghi chú/);
    expect(page.warnings.join('\n')).toMatch(/1 edge was not connected/);
  });

  it('reads the same file compressed, as an editable SVG and as a PNG with the diagram inside', () => {
    const plain = factsOf(read('hand-flowchart.drawio'));
    const xml = read('hand-flowchart.drawio').toString('utf8');
    expect(factsOf(Buffer.from(compress(xml)))).toEqual(plain);
    const attr = xml.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    expect(factsOf(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" content="${attr}" width="10" height="10"><g/></svg>`))).toEqual(plain);
    expect(factsOf(pngWith('mxfile', encodeURIComponent(compress(xml))))).toEqual(plain);
    expect(factsOf(pngWith('mxfile', encodeURIComponent(xml), true))).toEqual(plain);
  });

  it('reads a bare mxGraphModel and refuses what holds no diagram', () => {
    const xml = read('hand-flowchart.drawio').toString('utf8');
    const model = xml.slice(xml.indexOf('<mxGraphModel'), xml.indexOf('</mxGraphModel>') + '</mxGraphModel>'.length);
    expect(factsOf(Buffer.from(model)).pages[0].nodes).toHaveLength(7);
    expect(drawioXmlOf(Buffer.from('hello')).error).toMatch(/not a diagram this skill can read/);
    expect(drawioXmlOf(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><g/></svg>')).error).toMatch(/editable SVG/);
    expect(drawioXmlOf(pngWith('Software', 'none')).error).toMatch(/no "mxfile" text chunk/);
  });

  it('reads every page, AWS icons and frames, a page link, and table rows as the texts of one entity', () => {
    const facts = factsOf(read('hand-two-pages.drawio'));
    expect(facts.pages.map((p) => [p.id, p.name, p.kindHints[0].kind])).toEqual([['arch', 'Architecture', 'architecture'], ['erd', 'Orders ERD', 'er']]);
    const [arch, erd] = facts.pages;
    expect(node(arch, 'vpc')).toMatchObject({ shape: 'group', group: 'aws:vpc', label: 'VPC' });
    expect(node(arch, 'api')).toMatchObject({ shape: 'icon', icon: 'aws:lambda', parent: 'vpc', link: 'erd', label: 'Order API' });
    expect(node(arch, 'db')).toMatchObject({ shape: 'store', parent: 'vpc' });
    expect(node(arch, 'user').shape).toBe('actor');
    expect(edge(arch, 'c2')).toMatchObject({ from: 'api', to: 'db', label: 'SQL', dashed: true });
    expect(node(erd, 't-order')).toMatchObject({ shape: 'table', label: 'order', texts: ['PK id uuid', 'FK customer_id uuid'] });
    expect(erd.nodes.map((n) => n.id)).toEqual(['t-order', 't-customer']);
    expect(edge(erd, 'rel')).toMatchObject({ from: 't-customer', to: 't-order', fromPart: 'PK id uuid', toPart: 'FK customer_id uuid', startArrow: 'ERmandOne', endArrow: 'ERzeroToMany' });
  });

  it('tells lanes of a pool from a frame and scores the page as an activity diagram', () => {
    const page = factsOf(read('hand-swimlanes.drawio')).pages[0];
    expect(page.kindHints[0].kind).toBe('activity');
    expect(node(page, 'pool').shape).toBe('container');
    expect(node(page, 'lane-c')).toMatchObject({ shape: 'lane', parent: 'pool' });
    expect(node(page, 'lane-s')).toMatchObject({ shape: 'lane', parent: 'pool' });
    expect(node(page, 'ok')).toMatchObject({ shape: 'decision', parent: 'lane-s' });
  });
});

describe('cover', () => {
  const facts = () => factsOf(read('hand-flowchart.drawio'));
  const ir = () => ({
    schemaVersion: 1, kind: 'flowchart', title: 'Đặt hàng',
    nodes: [
      { id: 'start', label: 'Bắt đầu', shape: 'terminal' },
      { id: 'enter', label: 'Nhập giỏ hàng và địa chỉ', shape: 'process' },
      { id: 'check', label: 'Còn hàng?', shape: 'decision' },
      { id: 'pay', label: 'Thanh toán thẻ', shape: 'process' },
      { id: 'notify', label: 'Báo hết hàng', shape: 'io' },
      { id: 'end', label: 'Kết thúc', shape: 'terminal' },
    ],
    edges: [
      { id: 'e3', from: 'check', to: 'pay', label: 'Có' },
      { id: 'e4', from: 'check', to: 'notify', label: 'Không' },
    ],
    meta: { source: 'recook', omitted: ['"Ghi chú: giờ cao điểm 18h–21h": a free note, not a step of the flow'] },
  });

  it('passes when every text is kept or named in meta.omitted', () => {
    expect(cover(facts(), [{ name: 'order', ir: ir() }])).toMatchObject({ ok: true, missing: [] });
  });

  it('reports a dropped node, a dropped edge label and a note left out without a reason', () => {
    const lessIr = ir();
    lessIr.nodes = lessIr.nodes.filter((n) => n.id !== 'notify');
    lessIr.edges = lessIr.edges.filter((e) => e.id !== 'e4');
    lessIr.meta.omitted = [];
    const c = cover(facts(), [{ name: 'order', ir: lessIr }]);
    expect(c.ok).toBe(false);
    expect(c.missing.map((m) => m.text).sort()).toEqual(['Báo hết hàng', 'Ghi chú: giờ cao điểm 18h–21h', 'Không'].sort());
  });

  it('looks element by element, so words scattered over other elements do not count', () => {
    const scattered = ir();
    scattered.nodes = scattered.nodes.filter((n) => n.id !== 'pay');
    scattered.nodes.push({ id: 'a', label: 'Thanh lý', shape: 'process' }, { id: 'b', label: 'toán thẻ khác', shape: 'process' });
    expect(cover(facts(), [{ name: 'order', ir: scattered }]).missing.map((m) => m.text)).toEqual(['Thanh toán thẻ']);
  });

  it('finds a text written without spaces or broken over lines, and accepts a split into parts', () => {
    const facts1 = { facts: 1, pages: [{ id: 'p', nodes: [{ id: 'n', label: '注文を\n確定する', shape: 'box' }, { id: 'm', label: 'Load stock', shape: 'box' }], edges: [] }] };
    const main = { schemaVersion: 1, kind: 'flowchart', title: 'x', nodes: [{ id: 'n', label: '注文を確定する', shape: 'process' }], edges: [] };
    const part = { schemaVersion: 1, kind: 'flowchart', title: 'Load stock', nodes: [], edges: [] };
    expect(cover(facts1, [{ name: 'main', ir: main }, { name: 'part', ir: part }]).ok).toBe(true);
    expect(cover(facts1, [{ name: 'main', ir: main }]).missing.map((m) => m.text)).toEqual(['Load stock']);
  });
});

describe('kind hints', () => {
  it('reads a column type with a size as an attribute, not a method', async () => {
    const { kindHints } = await import('../src/extract-drawio.mjs');
    const table = (texts) => ({ id: 't', label: 'orders', shape: 'table', texts });
    expect(kindHints([table(['PK id bigint', 'total decimal(12,2)'])], [])[0].kind).toBe('er');
    expect(kindHints([table(['- total: decimal', 'pay(amount): void'])], [])[0].kind).toBe('class');
  });
});

describe('facts never hold a credential or personal data', () => {
  const xml = `<mxfile><diagram id="p" name="Orders"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>
    <mxCell id="api" value="Order API" style="rounded=1;html=1;" vertex="1" parent="1"><mxGeometry x="0" y="0" width="100" height="50" as="geometry"/></mxCell>
    <mxCell id="note" value="Cấu hình: DB_PASSWORD=Xy7!qwertz (tạm thời)&lt;br&gt;hỏi lien.nguyen@congty.vn" style="shape=note;html=1;" vertex="1" parent="1"><mxGeometry x="200" y="0" width="160" height="80" as="geometry"/></mxCell>
  </root></mxGraphModel></diagram></mxfile>`;

  it('replaces the value with a placeholder, lists where, and warns', async () => {
    const { extractFacts } = await import('../src/extract.mjs');
    const { facts } = extractFacts(Buffer.from(xml), 'x.drawio');
    const [page] = facts.pages;
    expect(JSON.stringify(facts)).not.toMatch(/Xy7|lien\.nguyen/);
    expect(page.nodes.find((n) => n.id === 'note').label).toBe('Cấu hình: DB_PASSWORD=<redacted credential> (tạm thời)\nhỏi <redacted e-mail>');
    expect(page.sensitive).toEqual([{ element: 'note', field: 'label', kinds: ['token-pattern', 'personal-data'] }]);
    expect(page.warnings.join('\n')).toMatch(/1 text holds what looks like a credential or personal data.*the source file itself still holds it/);
  });

  it('cover asks for the words around a redacted value, never the value', async () => {
    const { extractFacts } = await import('../src/extract.mjs');
    const { facts } = extractFacts(Buffer.from(xml), 'x.drawio');
    const ir = (omitted) => ({ schemaVersion: 1, kind: 'flowchart', title: 'Orders', nodes: [{ id: 'api', label: 'Order API', shape: 'process' }], edges: [], meta: { omitted } });
    expect(cover(facts, [{ name: 'o', ir: ir(['"Cấu hình: DB_PASSWORD=<db password> (tạm thời), hỏi <staff e-mail>": a credential and a contact, not part of the system']) }]).ok).toBe(true);
    expect(cover(facts, [{ name: 'o', ir: ir([]) }]).missing.map((m) => m.text)).toEqual(['Cấu hình: DB_PASSWORD=<redacted credential> (tạm thời)', 'hỏi <redacted e-mail>']);
  });
});
