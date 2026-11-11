/**
 * Width of label text as draw.io draws it: Helvetica at 12 px, its default font. Every size
 * heuristic measures text here, so a box, a wrap and a label place agree on one figure.
 *
 * Latin text is summed from the advance widths of Helvetica's glyphs. A flat figure per
 * character cannot serve: `i` is 2.7 px wide and `W` 11.3 px, so 7 px a character counted a
 * mixed-case line a quarter too wide and a line of capitals too narrow. Arial and Liberation
 * Sans, which stand in for Helvetica on Windows and Linux, are drawn to the same widths.
 */
const FONT_SIZE = 12;

/** Advance widths of Helvetica for U+0020 (space) to U+007E (~), in thousandths of the font size. */
const ASCII = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, // space ! " # $ % & ' ( ) * + , - . /
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, // 0-9
  278, 278, 584, 584, 584, 556, 1015, // : ; < = > ? @
  667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, // A-Z
  278, 278, 278, 469, 556, 333, // [ \ ] ^ _ `
  556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, // a-z
  334, 260, 334, 584, // { | } ~
];

/** The same for Helvetica Bold, the face of table headers, lane and composite titles. */
const ASCII_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556,
  333, 333, 584, 584, 584, 611, 975,
  722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611,
  333, 278, 333, 584, 556, 333,
  556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500,
  389, 280, 389, 584,
];

/** Characters outside ASCII that labels often carry and that no rule below gets right; a letter stands for the one it is as wide as. */
const NAMED = {
  đ: 'd', Đ: 'D', '«': 556, '»': 556, '–': 556, '—': 1000, '…': 1000, '‘': 222, '’': 222, '“': 333, '”': 333, '↳': 1000,
  '\u00a0': ' ', '\u2007': '0', '\u202f': 200, '\u2010': '-', '\u2011': '-', // no-break and figure spaces, hyphens
};

/**
 * Characters that East Asian fonts draw at full width: CJK ideographs, kana, Hangul and the
 * full-width forms. They render at 12 to 12.3 px.
 */
const WIDE = /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]|[\u{20000}-\u{3FFFF}]/u;
const WIDE_WIDTH = 1021;
/** The horn of the Vietnamese ơ and ư, the one combining mark that makes its letter wider. */
const HORN = '̛';
const HORN_WIDTH = 110;
/** Combining marks and format characters (joiners, variation selectors) take no room of their own. */
const NO_WIDTH = /[\p{M}\p{Cf}]/u;
/** A letter of a script without a table here (Greek, Cyrillic, ...): 7 px, an average letter with some room. */
const OTHER_LETTER = 583;

const FACES = { regular: { ascii: ASCII, cache: new Map() }, bold: { ascii: ASCII_BOLD, cache: new Map() } };

/** Whether a browser may break the line before and after this character without a space. */
export const isWide = (ch) => WIDE.test(ch);

function unitsOf(ch, ascii) {
  const code = ch.codePointAt(0);
  if (code >= 0x20 && code <= 0x7e) return ascii[code - 0x20];
  if (WIDE.test(ch)) return WIDE_WIDTH;
  const named = NAMED[ch];
  if (named !== undefined) return typeof named === 'string' ? unitsOf(named, ascii) : named;
  if (ch === HORN) return HORN_WIDTH;
  if (NO_WIDTH.test(ch)) return 0;
  // A letter with diacritics is as wide as its base letter: é as e, ệ as e, ư as u plus the horn.
  const parts = ch.normalize('NFD');
  if (parts !== ch) return [...parts].reduce((n, part) => n + unitsOf(part, ascii), 0);
  if (code >= 0xff61 && code <= 0xffdc) return 500; // half-width kana and Hangul
  if (code > 0xffff) return 1250; // emoji
  if (code >= 0x2000) return 1000; // arrows, mathematical and other symbols
  return OTHER_LETTER;
}

/**
 * Width of one line of text in px.
 * @param {string} line
 * @param {{ bold?: boolean }} [options] `bold` measures the bold face
 */
export function textWidth(line, { bold = false } = {}) {
  const { ascii, cache } = bold ? FACES.bold : FACES.regular;
  let units = 0;
  for (const ch of String(line)) {
    let u = cache.get(ch);
    if (u === undefined) { u = unitsOf(ch, ascii); cache.set(ch, u); }
    units += u;
  }
  return (units * FONT_SIZE) / 1000;
}

/** Width in px of the widest line of a (possibly multi-line) text; 0 for an empty one. */
export function widestLine(text, options) {
  return Math.max(...String(text).split(/\r\n?|\n/).map((line) => textWidth(line, options)));
}

/**
 * Room for a text that has to stay on its line: its width and 4 % more, in whole px. The
 * widths above are the font's own, and renderers differ from them by a little: with every
 * glyph snapped to whole pixels a line comes out 1 to 3 % wider. A box cut to the exact
 * width would then break the last word off its line.
 */
const FIT = 1.04;
export const roomFor = (px) => Math.ceil(px * FIT);
/** The width that is sure to hold a line of `px`: the reverse of `roomFor`, for text that is clipped if it wraps. */
export const safeWidth = (px) => px / FIT;

/**
 * Whether two labels read the same: case, spacing, a «stereotype» line and a closing remark
 * in brackets aside (a business view is titled "X (nghiệp vụ)" beside the step "X").
 */
export const sameText = (a, b) => {
  const norm = (t) => String(t).replace(/^«[^»]*»\s*/, '').replace(/\s*[(（][^()（）]*[)）]\s*$/, '').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
  return norm(a) === norm(b);
};
