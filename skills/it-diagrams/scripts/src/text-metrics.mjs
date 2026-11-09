/**
 * Display width of label text for the size heuristics, in units of one Latin letter
 * (7 px at draw.io's default 12 px font, a figure that leaves room for capitals and bold).
 * Characters that East Asian fonts draw at full width (CJK ideographs, kana, Hangul,
 * full-width forms) render at about 12.2 px, so they count 1.75 units.
 */
export const WIDE_UNITS = 1.75;
const WIDE = /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]|[\u{20000}-\u{3FFFF}]/u;

/** Number of Latin-letter widths one line of text needs. */
export function displayLength(line) {
  let n = 0;
  for (const ch of String(line)) n += WIDE.test(ch) ? WIDE_UNITS : 1;
  return n;
}

/** The longest line of a (possibly multi-line) text in Latin-letter widths, at least 1. */
export function longestLine(text) {
  return Math.max(...String(text).split(/\r\n?|\n/).map(displayLength), 1);
}
