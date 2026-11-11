import { describe, it, expect } from 'vitest';
import { wrapText } from '../src/layout-graph.mjs';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { emit, bundle } from '../src/pipeline.mjs';
import { relabelDrawio } from '../src/relabel.mjs';
import { loadPlaywright } from '../src/preview.mjs';
import { textWidth } from '../src/text-metrics.mjs';
import { checkDrawioStructure } from './drawio-structure.mjs';
import { loadFixture, scriptsDir } from './helpers.mjs';

const pw = loadPlaywright(scriptsDir);

const geometries = (xml) => xml.match(/<mxGeometry[^>]*>|<mxPoint[^>]*>/g);
const ids = (xml) => [...xml.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);

describe('relabel (issue 4: language variants keep the layout)', () => {
  it('replaces node, guard and page labels by IR id and keeps every id and geometry', async () => {
    const r = await emit(loadFixture('activity', 'valid-two-lanes'), 'drawio', { diagramId: 'returns' });
    const out = relabelDrawio(r.output, { approve: 'Duyệt và gửi nhãn', f4: 'có', title: 'Yêu cầu trả hàng', support: 'Hỗ trợ' });
    expect(out.replaced).toBe(4);
    expect(out.unmatched).toEqual([]);
    expect(out.warnings).toEqual([]);
    expect(geometries(out.output)).toEqual(geometries(r.output));
    expect(ids(out.output)).toEqual(ids(r.output));
    expect(checkDrawioStructure(out.output).problems).toEqual([]);
    const cells = checkDrawioStructure(out.output).cells;
    expect(cells.find((c) => c.id === 'returns:approve').value).toBe('Duyệt và gửi nhãn<br>↳ return-request-label');
    expect(cells.find((c) => c.id === 'returns:f4:label').value).toBe('có');
    expect(cells.find((c) => c.id === 'returns:support').value).toBe('Hỗ trợ');
    expect(out.output).toContain('<diagram id="returns" name="Yêu cầu trả hàng">');
  });

  it('reports labels that no longer fit and keys that match nothing', async () => {
    const r = await emit(loadFixture('activity', 'valid-two-lanes'), 'drawio', { diagramId: 'returns' });
    const out = relabelDrawio(r.output, { approve: 'Phê duyệt yêu cầu trả hàng, in nhãn vận chuyển, gửi nhãn cho khách hàng qua email và tin nhắn ngay trong ngày làm việc', nope: 'x' });
    expect(out.unmatched).toEqual(['nope']);
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings[0].path).toBe('returns:approve');
    expect(out.warnings[0].message).toMatch(/^layout: .*wraps to/);
  });

  it('measures a subroutine between its side bars, as the emitter sizes it', async () => {
    const r = await emit(loadFixture('activity', 'valid-two-lanes'), 'drawio', { diagramId: 'returns' });
    const box = checkDrawioStructure(r.output).cells.find((c) => c.id === 'returns:approve');
    expect(box.style).toMatch(/^shape=process;/);
    const width = Number(box.mxGeometry.width);
    // Three lines in the whole width of the box, four between the bars (a fifth of the width, and 4 px of label spacing a side): the box holds three.
    const label = 'Approve the request, print the return shipping label and email it to them';
    expect(wrapText(label, width - 8).lines).toBe(3);
    expect(wrapText(label, 0.8 * width - 4 - 8).lines).toBe(4);
    const out = relabelDrawio(r.output, { approve: label });
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings[0].message).toMatch(/wraps to 4 lines/);
  });

  it('issue 39: measures a decision with label spacing at its wrap width, so a question that no longer fits the diamond is reported', async () => {
    const r = await emit(loadFixture('activity', 'valid-long-decision'), 'drawio', { diagramId: 'upload' });
    // Two lines of up to 164 px fit the 264 x 80 diamond; a third does not, nor does one line wider than the diamond at its height.
    const same = relabelDrawio(r.output, { ok: 'Type is PDF or PNG and size is under the limit?' });
    expect(same.warnings).toEqual([]);
    const third = relabelDrawio(r.output, { ok: 'Type is PDF or PNG and the size is under the configured limit?' });
    expect(third.warnings).toHaveLength(1);
    expect(third.warnings[0].message).toMatch(/wraps to 3 lines in a 264x80 diamond that holds 2/);
    const plain = await emit(loadFixture('activity', 'valid-two-lanes'), 'drawio', { diagramId: 'returns' });
    // 97 px fit the 113 px the diamond has at the height of one line; 117 px do not.
    expect(relabelDrawio(plain.output, { eligible: 'All items stocked?' }).warnings).toEqual([]);
    const oneLine = relabelDrawio(plain.output, { eligible: 'Are all items in stock?' });
    expect(oneLine.warnings).toHaveLength(1);
    expect(oneLine.warnings[0].message).toMatch(/needs about 117 px in a 140x80 diamond that holds 113 px on one line/);
    const twoLines = relabelDrawio(plain.output, { eligible: 'Are all the items in stock?' });
    expect(twoLines.warnings[0].message).toMatch(/wraps to 2 lines in a 140x80 diamond that holds 0 at that width/);
    const longer = relabelDrawio(r.output, { ok: 'Is the file a PDF or a PNG, and is its size under the limit configured for the tenant and the folder?' });
    expect(longer.warnings).toHaveLength(1);
    expect(longer.warnings[0].path).toBe('upload:ok');
    expect(longer.warnings[0].message).toMatch(/wraps to \d+ lines/);
  });

  describe('issue 54: a decision with label spacing is wrapped at the width that spacing leaves', () => {
    const reminder = () => ({ schemaVersion: 1, kind: 'activity', title: 'Invoice reminder', direction: 'TB', lanes: [{ id: 'billing', label: 'Billing' }], actions: [{ id: 'send', label: 'Send a reminder', lane: 'billing' }, { id: 'wait', label: 'Wait', lane: 'billing' }], controls: [{ id: 'start', kind: 'initial', lane: 'billing' }, { id: 'check', kind: 'decision', label: 'Never reminded or\nover 30 days ago?', lane: 'billing' }, { id: 'end', kind: 'final', lane: 'billing' }], flows: [{ id: 'f1', from: 'start', to: 'check' }, { id: 'f2', from: 'check', to: 'send', guard: 'yes' }, { id: 'f3', from: 'check', to: 'wait', guard: 'no' }, { id: 'f4', from: 'send', to: 'end' }, { id: 'f5', from: 'wait', to: 'end' }] });
    // Lines of 102.7 and 100.1 px: wider than the old ones, and still inside the 108 px the spacing leaves with the room of `roomFor`.
    const fits = 'Never reminded, or\nover a month ago?';
    // A second line of 113.4 px, which draw.io breaks.
    const third = 'Never reminded, or\nover one month ago?';
    const emitted = async () => {
      const r = await emit(reminder(), 'drawio', { diagramId: 'dec' });
      const cell = checkDrawioStructure(r.output).cells.find((c) => c.id === 'dec:check');
      return { xml: r.output, cell, width: Number(cell.mxGeometry.width), height: Number(cell.mxGeometry.height) };
    };

    it('gives no warning for a label whose lines fit, and one for a line that wraps to a third', async () => {
      const { xml, cell, width, height } = await emitted();
      expect(cell.style).toBe('rhombus;whiteSpace=wrap;html=1;spacingLeft=30;spacingRight=30;');
      expect({ width, height }).toEqual({ width: 168, height: 80 });
      expect(relabelDrawio(xml, { check: fits }).warnings).toEqual([]);
      // The same words without the break wrap at the same place.
      expect(relabelDrawio(xml, { check: fits.replace('\n', ' ') }).warnings).toEqual([]);
      const out = relabelDrawio(xml, { check: third });
      expect(out.warnings).toHaveLength(1);
      expect(out.warnings[0].message).toMatch(/wraps to 3 lines in a 168x80 diamond that holds 2 at that width/);
      // 106.7 px is under the 108 px but not with the room on top: draw.io, whose text frame is 106 px wide here, breaks it.
      const near = 'Never reminded, orr\nover a month ago?';
      expect(textWidth(near.split('\n')[0])).toBeLessThan(width - 60);
      expect(relabelDrawio(xml, { check: near }).warnings[0].message).toMatch(/wraps to 3 lines/);
    });

    it.skipIf(!pw)('counts the lines Chromium draws in the frame draw.io gives the label', async () => {
      const { xml, width } = await emitted();
      // draw.io's frame: the width less the label spacing and its own 2 px on each side, plus the 2 px its SVG text frame adds.
      const frame = width - 60 - 4 + 2;
      const labels = [fits, third];
      const browser = await pw.chromium.launch();
      try {
        const page = await browser.newPage();
        await page.setContent(`<body style="font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.2">${labels.map((l, i) => `<div style="width:${frame}px;white-space:normal"><span id="d${i}">${l.replace('\n', '<br>')}</span></div>`).join('')}</body>`);
        const lines = await page.evaluate((count) => Array.from({ length: count }, (_, i) => new Set([...document.getElementById(`d${i}`).getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top))).size), labels.length);
        expect(lines).toEqual([2, 3]);
        expect(labels.map((l) => relabelDrawio(xml, { check: l }).warnings.length)).toEqual([0, 1]);
      } finally {
        await browser.close();
      }
    });
  });

  it('keeps stereotypes on sequence heads and bold titles in a bundle, and addresses one page with a prefix', async () => {
    const r = await bundle([{ id: 'login', ir: loadFixture('sequence', 'valid') }, { id: 'returns', ir: loadFixture('activity', 'valid-two-lanes') }], 'drawio', { title: 'Feature' });
    const out = relabelDrawio(r.output, { 'login:title': 'Đăng nhập', 'auth': 'Dịch vụ xác thực', 'returns:approve': 'Duyệt' });
    const cells = checkDrawioStructure(out.output).cells;
    expect(cells.find((c) => c.id === 'login:title').value).toBe('<b>Đăng nhập</b>');
    expect(cells.find((c) => c.id === 'returns:title').value).toBe('<b>Return request</b>');
    expect(out.output).toContain('<diagram id="login" name="Đăng nhập">');
    expect(out.output).toContain('<diagram id="returns" name="Return request">');
    const head = cells.find((c) => c.id === 'login:auth');
    expect(head.value).toBe('<i>«control»</i><br>Dịch vụ xác thực');
    expect(out.unmatched).toEqual([]);
  });

  it('accepts a compressed file and writes it uncompressed', async () => {
    const r = await emit(loadFixture('flowchart', 'valid'), 'drawio', { diagramId: 'checkout' });
    const compressed = r.output.replace(/<mxfile[^>]*>/, '<mxfile host="app.diagrams.net" type="device">').replace(/(<diagram[^>]*>)([\s\S]*?)(<\/diagram>)/, (_, open, body, close) => `${open}${deflateRawSync(Buffer.from(encodeURIComponent(body.trim()), 'utf8')).toString('base64')}${close}`);
    const out = relabelDrawio(compressed, { start: 'Khách gửi giỏ hàng' });
    expect(out.replaced).toBe(1);
    expect(out.output).toMatch(/<mxfile[^>]*compressed="false"/);
    expect(checkDrawioStructure(out.output).problems).toEqual([]);
    expect(checkDrawioStructure(out.output).cells.find((c) => c.id === 'checkout:start').value).toBe('Khách gửi giỏ hàng');
  });

  describe('issues 7, 8 and 9', () => {
    const order = () => ({ schemaVersion: 1, kind: 'activity', title: 'Order flow', direction: 'TB', lanes: [{ id: 'svc', label: 'Order service' }], actions: [{ id: 'a-pay', label: 'Take payment', lane: 'svc', ref: 'order-01-payment' }, { id: 'a-ship', label: 'Create shipment', lane: 'svc' }], controls: [{ id: 'start', kind: 'initial', lane: 'svc' }, { id: 'end', kind: 'final', lane: 'svc' }], flows: [{ id: 'f1', from: 'start', to: 'a-pay' }, { id: 'f2', from: 'a-pay', to: 'a-ship' }, { id: 'f3', from: 'a-ship', to: 'end' }] });
    const payment = () => ({ schemaVersion: 1, kind: 'activity', title: 'Payment', direction: 'TB', lanes: [{ id: 'svc', label: 'Order service' }], actions: [{ id: 'a-charge', label: 'Charge the card', lane: 'svc' }], controls: [{ id: 'start', kind: 'initial', lane: 'svc' }, { id: 'end', kind: 'final', lane: 'svc' }], flows: [{ id: 'f1', from: 'start', to: 'a-charge' }, { id: 'f2', from: 'a-charge', to: 'end' }] });
    const ja = { 'order:title': '注文フロー', 'order:svc': '注文サービス', 'order:a-pay': '支払い処理', 'order:a-ship': '出荷を作成', 'order-01-payment:title': '決済', 'order-01-payment:svc': '注文サービス', 'order-01-payment:a-charge': 'カードに請求' };
    const bundled = () => bundle([{ id: 'order', ir: order() }, { id: 'order-01-payment', ir: payment() }], 'drawio', { title: 'Order', canvas: 'all' });

    it('7: the ref line follows the new title of its target page, on every page, and the link stays', async () => {
      const r = await bundled();
      const out = relabelDrawio(r.output, ja);
      const cells = checkDrawioStructure(out.output).cells.filter((c) => c.id === 'order:a-pay');
      expect(cells).toHaveLength(2);
      for (const c of cells) {
        expect(c.value).toBe('支払い処理<br>↳ 決済');
        expect(c.link).toBe('data:page/id,order-01-payment');
      }
      expect(out.output).not.toContain('↳ Payment');
      const kept = relabelDrawio(r.output, { 'order:a-pay': '支払い処理' });
      expect(checkDrawioStructure(kept.output).cells.find((c) => c.id === 'order:a-pay').value).toBe('支払い処理<br>↳ Payment');
    });

    it('8: no warning for a fitting title or an unchanged ref line, a warning for CJK text that overflows, and no false warning for a full map', async () => {
      const r = await bundled();
      const out = relabelDrawio(r.output, ja);
      expect(out.warnings).toEqual([]);
      expect(out.untouched).toEqual([]);
      const fit = { ...order(), title: 'Fit', actions: [{ id: 'a1', label: 'Create shipment\nfor the order\nand tell the carrier', lane: 'svc' }], flows: [{ id: 'f1', from: 'start', to: 'a1' }, { id: 'f2', from: 'a1', to: 'end' }] };
      const e = await emit(fit, 'drawio', { diagramId: 'fit' });
      const ja3 = relabelDrawio(e.output, { a1: '倉庫の在庫を確認して出荷を作成する\n配送業者へ連絡して集荷を依頼する\n在庫がない場合は注文を保留にする' });
      expect(ja3.warnings.map((w) => w.path)).toEqual(['fit:a1']);
      expect(ja3.warnings[0].message).toMatch(/^layout: .*wraps to/);
    });

    it('9: hand-copied cells get the same text by source label, and every labelled cell left alone is listed', async () => {
      const r = await bundled();
      const copy = r.output.replace(/(<mxCell id=")order-01-payment:a-charge(" value="Charge the card"[^>]*>\s*<mxGeometry[^>]*\/>\s*<\/mxCell>)/, (whole, a, b) => `${whole}${a}xk9Q2_pasted-7${b}`);
      expect(copy).not.toBe(r.output);
      const out = relabelDrawio(copy, ja);
      expect(out.byText).toBe(1);
      expect(out.untouched).toEqual([]);
      expect(checkDrawioStructure(out.output).cells.find((c) => c.id === 'xk9Q2_pasted-7').value).toBe('カードに請求');
      const partial = relabelDrawio(r.output, { 'order:a-pay': '支払い処理', 'order:a-ship': 'Create shipment' });
      const places = partial.untouched.flatMap((u) => u.places);
      expect(places).toEqual(expect.arrayContaining(['order/order:title', 'order/order:svc', 'order-01-payment/order-01-payment:a-charge', 'canvas/order:svc']));
      expect(places.some((p) => p.endsWith('order:a-ship'))).toBe(false);
      expect(partial.untouched.every((u) => typeof u.text === 'string' && u.text.length > 0)).toBe(true);
    });
  });

  describe('issues 14 and 15', () => {
    const fit2 = () => ({ schemaVersion: 1, kind: 'activity', title: 'Fit after relabel', direction: 'TB', lanes: [{ id: 'api', label: 'API' }], actions: [{ id: 'a-keep', label: 'Keep all added items', lane: 'api' }, { id: 'a-none', label: 'Return empty result', lane: 'api' }], controls: [{ id: 'start', kind: 'initial', lane: 'api' }, { id: 'd-test', kind: 'decision', label: 'Test request?', lane: 'api' }, { id: 'd-stock', kind: 'decision', label: 'In stock?', lane: 'api' }, { id: 'end', kind: 'final', lane: 'api' }, { id: 'end2', kind: 'final', lane: 'api' }], flows: [{ id: 'f1', from: 'start', to: 'd-test' }, { id: 'f2', from: 'd-test', to: 'd-stock', guard: 'no' }, { id: 'f3', from: 'd-test', to: 'end2', guard: 'yes' }, { id: 'f4', from: 'd-stock', to: 'a-keep', guard: 'yes' }, { id: 'f5', from: 'd-stock', to: 'a-none', guard: 'no' }, { id: 'f6', from: 'a-keep', to: 'end' }, { id: 'f7', from: 'a-none', to: 'end' }] });
    const ja = { 'fit2:d-test': 'テストリクエスト？', 'fit2:a-keep': '追加した項目をすべて残す', 'fit2:d-stock': '在庫は\nありますか？', 'fit2:a-none': '空の結果を返す', 'fit2:f2': 'いいえ', 'fit2:f3': 'はい', 'fit2:f4': 'はい', 'fit2:f5': 'いいえ', 'fit2:title': 'リラベル後の収まり' };

    it('14: CJK labels that fit their boxes give no warning, including a line break from the map', async () => {
      const r = await emit(fit2(), 'drawio', { diagramId: 'fit2' });
      const out = relabelDrawio(r.output, ja);
      expect(out.warnings).toEqual([]);
      expect(out.replaced).toBe(9);
    });

    it('14: a cell and its canvas copy give one warning that names both pages', async () => {
      const long = { ...fit2(), actions: [{ id: 'a1', label: 'Create shipment\nfor the order\nand tell the carrier', lane: 'api' }], flows: [{ id: 'f1', from: 'start', to: 'a1' }, { id: 'f2', from: 'a1', to: 'end' }], controls: [{ id: 'start', kind: 'initial', lane: 'api' }, { id: 'end', kind: 'final', lane: 'api' }] };
      const r = await bundle([{ id: 'fit', ir: long }, { id: 'other', ir: fit2() }], 'drawio', { title: 'B', canvas: 'all' });
      const out = relabelDrawio(r.output, { 'fit:a1': '倉庫の在庫を確認して出荷を作成する\n配送業者へ連絡して集荷を依頼する\n在庫がない場合は注文を保留にする' });
      expect(out.warnings).toHaveLength(1);
      expect(out.warnings[0].path).toBe('fit:a1');
      expect(out.warnings[0].message).toMatch(/wraps to 9 lines .* on pages canvas, fit$/);
    });

    it('15: untouched is grouped by text, skips labels without letters and texts in $keep', async () => {
      const r = await bundle([{ id: 'fit2', ir: fit2() }, { id: 'fit2-01-part', ir: { ...fit2(), title: 'Second page' } }], 'drawio', { title: 'B', canvas: 'all' });
      const out = relabelDrawio(r.output, ja);
      expect(out.untouched.map((u) => u.text)).toEqual(['API', 'Second page']);
      expect(out.untouched[0].places).toEqual(['canvas/fit2:api', 'canvas/fit2-01-part:api', 'fit2/fit2:api', 'fit2-01-part/fit2-01-part:api']);
      const kept = relabelDrawio(r.output, { ...ja, 'fit2-01-part:title': '2ページ目', $keep: ['API'] });
      expect(kept.untouched).toEqual([]);
      expect(kept.unmatched).toEqual([]);
      const numeric = { ...fit2(), flows: fit2().flows.map((f) => (f.id === 'f2' ? { ...f, guard: '2' } : f.id === 'f3' ? { ...f, guard: '0, 1, 3' } : f)) };
      const e = await emit(numeric, 'drawio', { diagramId: 'n' });
      const n = relabelDrawio(e.output, { 'n:api': 'API' });
      expect(n.untouched.map((u) => u.text)).not.toContain('2');
      expect(n.untouched.map((u) => u.text)).not.toContain('0, 1, 3');
    });
  });

  it('works through the CLI', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zukai-relabel-'));
    const r = await emit(loadFixture('activity', 'valid-two-lanes'), 'drawio', { diagramId: 'returns' });
    writeFileSync(join(dir, 'returns.drawio'), r.output);
    writeFileSync(join(dir, 'vi.json'), JSON.stringify({ approve: 'Duyệt', ghost: 'x' }));
    const run = spawnSync(process.execPath, [join(scriptsDir, 'bin', 'cli.mjs'), 'relabel', 'returns.drawio', '--map', 'vi.json', '--out', 'returns.vi.drawio'], { cwd: dir, encoding: 'utf8' });
    expect(run.status).toBe(0);
    expect(JSON.parse(run.stdout)).toMatchObject({ ok: true, out: join(dir, 'returns.vi.drawio'), replaced: 1, byText: 0, unmatched: ['ghost'] });
    expect(JSON.parse(run.stdout).untouched.length).toBeGreaterThan(3);
    // One warning for the unmatched key and one for all the labels the map left alone.
    expect(JSON.parse(run.stdout).warnings).toBe(2);
    expect(JSON.parse(run.stderr).warnings[0].message).toContain('ghost');
    expect(readFileSync(join(dir, 'returns.vi.drawio'), 'utf8')).toContain('value="Duyệt&lt;br&gt;↳ return-request-label"');
    const bad = spawnSync(process.execPath, [join(scriptsDir, 'bin', 'cli.mjs'), 'relabel', 'vi.json', '--map', 'vi.json', '--out', 'x.drawio'], { cwd: dir, encoding: 'utf8' });
    expect(bad.status).toBe(1);
    expect(JSON.parse(bad.stderr).errors[0].message).toContain('not a .drawio file');
  });
});
