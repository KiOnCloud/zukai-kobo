import { describe, it, expect } from 'vitest';
import { displayLength, longestLine, WIDE_UNITS } from '../src/text-metrics.mjs';
import { loadPlaywright } from '../src/preview.mjs';
import { scriptsDir } from './helpers.mjs';

const pw = loadPlaywright(scriptsDir);

describe('text metrics', () => {
  it('counts CJK and full-width characters at 1.75 Latin widths and Latin at 1', () => {
    expect(displayLength('abc')).toBe(3);
    expect(displayLength('追加')).toBe(2 * WIDE_UNITS);
    expect(displayLength('ＡＢ')).toBe(2 * WIDE_UNITS);
    expect(longestLine('a\n追加した')).toBe(4 * WIDE_UNITS);
    expect(longestLine('')).toBe(1);
  });

  it.skipIf(!pw)('matches the browser rendering of the draw.io default font within a few percent for CJK text', async () => {
    const browser = await pw.chromium.launch();
    try {
      const page = await browser.newPage();
      const texts = ['追加した項目をすべて残す', 'テストリクエスト？', 'ありますか？', '在庫がない場合は注文を保留にする'];
      const measured = await page.evaluate((list) => {
        const c = document.createElement('canvas').getContext('2d');
        c.font = '12px Helvetica, Arial, sans-serif';
        return list.map((t) => c.measureText(t).width);
      }, texts);
      texts.forEach((t, i) => {
        const estimate = displayLength(t) * 7;
        expect(Math.abs(estimate - measured[i]) / measured[i], t).toBeLessThan(0.05);
      });
    } finally {
      await browser.close();
    }
  });
});
