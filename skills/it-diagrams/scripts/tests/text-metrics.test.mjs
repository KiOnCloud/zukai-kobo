import { describe, it, expect } from 'vitest';
import { textWidth, widestLine, isWide, roomFor, safeWidth } from '../src/text-metrics.mjs';
import { wrapText } from '../src/layout-graph.mjs';
import { loadPlaywright } from '../src/preview.mjs';
import { scriptsDir } from './helpers.mjs';

const pw = loadPlaywright(scriptsDir);

describe('text metrics', () => {
  it('sums the glyph widths of the 12 px font, so narrow and wide letters differ', () => {
    expect(textWidth('')).toBe(0);
    expect(textWidth('i')).toBeCloseTo(2.664, 3);
    expect(textWidth('W')).toBeCloseTo(11.328, 3);
    expect(textWidth(' ')).toBeCloseTo(3.336, 3);
    expect(textWidth('0123456789')).toBeCloseTo(66.72, 2);
    // The lines of the report: 42 and 44 characters, which a flat 7 px a character put at 294 and 308 px.
    expect(textWidth('Collect orders created from 00:00 to 23:59')).toBeCloseTo(224.8, 1);
    expect(textWidth('of the previous day, excluding test accounts')).toBeCloseTo(232.8, 1);
    // Capitals are wider than 7 px a character.
    expect(textWidth('AVAILABLE TO PROMISE CHECK')).toBeGreaterThan(7 * 26);
  });

  it('measures a letter with diacritics as its base letter, the horn of o and u a little wider', () => {
    expect(textWidth('é')).toBe(textWidth('e'));
    expect(textWidth('ệ')).toBe(textWidth('e'));
    expect(textWidth('Ü')).toBe(textWidth('U'));
    expect(textWidth('đ')).toBe(textWidth('d'));
    expect(textWidth('ơ')).toBeGreaterThan(textWidth('o') + 1);
    expect(textWidth('ữ')).toBe(textWidth('ư'));
    // Composed and decomposed forms of one text are one width.
    expect(textWidth('Tạo đơn hàng'.normalize('NFD'))).toBeCloseTo(textWidth('Tạo đơn hàng'.normalize('NFC')), 6);
    // A joiner or a variation selector takes no room.
    expect(textWidth('a‍b️')).toBe(textWidth('ab'));
  });

  it('counts CJK and full-width characters at full width, and lets a line break between them', () => {
    expect(textWidth('追加')).toBeCloseTo(2 * 12.25, 1);
    expect(textWidth('ＡＢ')).toBe(textWidth('追加'));
    expect(textWidth('ｱｲｳ')).toBe(18);
    expect(isWide('追')).toBe(true);
    expect(isWide('ア')).toBe(true);
    expect(isWide('a')).toBe(false);
    expect(isWide('é')).toBe(false);
  });

  it('measures bold text by the bold face, and a text with line breaks by its widest line', () => {
    // Narrow letters gain most in bold: i and l a quarter, capitals next to nothing.
    expect(textWidth('ill', { bold: true })).toBeCloseTo(1.25 * textWidth('ill'), 1);
    expect(textWidth('HEW', { bold: true })).toBe(textWidth('HEW'));
    expect(textWidth('Order', { bold: true })).toBeGreaterThan(textWidth('Order'));
    expect(textWidth('đ', { bold: true })).toBe(textWidth('d', { bold: true }));
    expect(textWidth('追加', { bold: true })).toBe(textWidth('追加'));
    expect(widestLine('a\n追加した')).toBe(textWidth('追加した'));
    expect(widestLine('one\r\nthree')).toBe(textWidth('three'));
    expect(widestLine('')).toBe(0);
    expect(widestLine('Order\nline', { bold: true })).toBe(textWidth('Order', { bold: true }));
  });

  it('keeps 4 % of room for a line that must not wrap, and takes it off a width that must hold one', () => {
    expect(roomFor(100)).toBe(104);
    expect(roomFor(232.8)).toBe(243);
    expect(safeWidth(104)).toBeCloseTo(100, 6);
  });

  const samples = [
    'Collect orders created from 00:00 to 23:59', 'of the previous day, excluding test accounts', 'Render the report as PDF and CSV files',
    'Awaiting payment (attempt n)', 'card declined [n < 3]', 'illicit little filter utility', 'MAXIMUM WARNING DOWNLOAD COUNT', 'INVOICE_DOCUMENT_BUILDER',
    'PK customer_shipping_address_id: uuid', '+findByCustomer(id: string): Order[]', '«interface» PaymentGateway', '↳ Return label', 'Total: 1,234.50 EUR (VAT 19 %)',
    'Tạo đơn hàng và gửi thông báo cho khách', 'Phê duyệt yêu cầu trả hàng, in nhãn vận chuyển', 'Người dùng đăng nhập bằng thư điện tử', 'Prüfung der Größe, façade déjà vu',
    '追加した項目をすべて残す', 'テストリクエスト？', 'ありますか？', '在庫がない場合は注文を保留にする', '請求書PDFを要求する', '注文API (v2) を呼び出す',
  ];

  it.skipIf(!pw)('matches the width Chromium draws in the draw.io default font, regular and bold', async () => {
    const browser = await pw.chromium.launch();
    try {
      const page = await browser.newPage();
      const measured = await page.evaluate((list) => {
        const c = document.createElement('canvas').getContext('2d');
        return ['12px Helvetica, Arial, sans-serif', 'bold 12px Helvetica, Arial, sans-serif'].map((font) => { c.font = font; return list.map((t) => c.measureText(t).width); });
      }, samples);
      samples.forEach((t, i) => {
        const [regular, bold] = [measured[0][i], measured[1][i]];
        // Kerning draws a line a little narrower than its glyphs add up to; the estimate is never short by more than a pixel.
        expect(textWidth(t) - regular, t).toBeGreaterThan(-1);
        expect(textWidth(t) / regular, t).toBeLessThan(1.03);
        expect(textWidth(t, { bold: true }) - bold, `bold ${t}`).toBeGreaterThan(-1);
        expect(textWidth(t, { bold: true }) / bold, `bold ${t}`).toBeLessThan(1.03);
      });
    } finally {
      await browser.close();
    }
  });

  it.skipIf(!pw)('breaks a text into the lines Chromium breaks it into, at every width', async () => {
    // Texts that only break at spaces and between CJK characters, which is where the wrap here breaks.
    const texts = [
      'Collect orders created from 00:00 to 23:59 of the previous day, excluding test accounts and cancelled orders',
      'Render the report as PDF and CSV files and upload both to the shared folder',
      'Rows older than two years are read from the archive schema instead of the live one',
      'Phê duyệt yêu cầu trả hàng, in nhãn vận chuyển, gửi nhãn cho khách hàng qua email và tin nhắn ngay trong ngày làm việc',
      'RETRY POLICY: MAX 3 ATTEMPTS, THEN MOVE THE MESSAGE TO THE DEAD LETTER QUEUE AND RAISE ALERT 4021',
      '倉庫の在庫を確認して出荷を作成する',
      '注文API を呼び出して 在庫 を確認する',
    ];
    const widths = [96, 116, 136, 160, 187, 236, 276];
    // Texts with the places inside a word where a browser breaks a line, and the spaces where it does not.
    const inWord = [
      'lint-staged-prettier-eslint-typecheck-and-vitest-related-unit-tests-then-build-docker-image-and-push',
      'callback_url: varchar(2048) (https://hooks.example.com/v1/tenants/acme-corp/integrations/billing-events)',
      'GET /api/v2/orders?status=open&page=2 returns the first-page-only summary for read-only users',
      'Prix\u00a0: 5\u00a0000\u00a0EUR hors taxes par an et par utilisateur\u00a0actif, soit 10\u202f% de moins',
      'Roll back to the last known-good release — then page the on-call engineer… and wait 2019–2024',
      'retry -5 times with --force and -_db: ShopDbContext in the re-entrant, non-blocking, lock-free path',
    ];
    const browser = await pw.chromium.launch();
    try {
      const page = await browser.newPage();
      const cases = [...texts, ...inWord].flatMap((t) => widths.map((w) => ({ t, w })));
      await page.setContent(`<body style="font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.2">${cases.map((c, i) => `<div id="c${i}" style="width:${c.w}px;white-space:normal;overflow-wrap:normal">${c.t}</div>`).join('')}</body>`);
      const rendered = await page.evaluate((count) => Array.from({ length: count }, (_, i) => Math.round(document.getElementById(`c${i}`).getBoundingClientRect().height / 14.4)), cases.length);
      let same = 0;
      cases.forEach((c, i) => {
        const lines = wrapText(c.t, c.w).lines;
        // A line that fills its width to the last pixel can fall either way; the count is never further off.
        expect(Math.abs(lines - rendered[i]), `${c.w} px: ${c.t}`).toBeLessThanOrEqual(1);
        if (lines === rendered[i]) same++;
        // Where the text breaks inside its words, the count is never short of the lines drawn.
        if (inWord.includes(c.t)) expect(lines, `${c.w} px: ${c.t}`).toBeGreaterThanOrEqual(rendered[i]);
      });
      expect(same / cases.length).toBeGreaterThan(0.9);
    } finally {
      await browser.close();
    }
  });
});
