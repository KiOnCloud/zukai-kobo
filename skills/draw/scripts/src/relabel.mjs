import { inflateRawSync } from 'node:zlib';
import { htmlLabel } from './drawio-xml.mjs';
import { widestLine, safeWidth } from './text-metrics.mjs';
import { wrapText } from './layout-graph.mjs';

/**
 * Replace labels in an emitted .drawio file while keeping every id and every geometry, so a
 * translated or reworded copy keeps the layout (and any manual edits) of the original.
 *
 * Keys of the map are IR ids (`approve`, `f4`, `title` for the page title) or, in a bundle,
 * `<diagram id>:<ir id>` to address one page. A key matches the cell `<diagram>:<key>` when
 * that cell carries the label, else the edge label cell `<diagram>:<key>:label`. Around the
 * text the emitters derived is kept: a leading `«stereotype»` line, a bold wrapper, and the
 * trailing `↳ <sub-diagram>` line of a step with `ref`, which follows the target page's new
 * title when the map renames it (`<target diagram id>:title`).
 *
 * Cells that draw.io gave a new id (hand-copied shapes) cannot be found by key, so a second
 * pass applies the same replacement to every cell whose text equals the source text of a
 * replaced one (`byText`). Every labelled cell that is still untouched is then listed,
 * grouped by text with the places it occurs, so nothing stays in the source language
 * unnoticed. Labels without a letter (numbers, punctuation) and texts named in the map's
 * `$keep` list are the same in every language and are left out of that list.
 *
 * Boxes are not resized. A new label is reported as a `layout:` warning when, by the same
 * text widths and word wrap the emitters use (the glyph widths of draw.io's 12 px font,
 * CJK characters at full width), it wraps to more lines than the box's height
 * holds and than the old label took, has an unbreakable word wider than the box, or exceeds
 * a non-wrapping box; a label drawn below its shape (an actor's name) is measured at its own
 * wrap width against the lines the old label took. A cell and its copies (the canvas page) give one warning naming the
 * pages. Compressed input (draw.io's default for older files) is inflated; output is
 * uncompressed.
 *
 * The file then no longer is what a fresh emit of its IR draws: the boxes keep the sizes and
 * places they had for the old labels. So that `drift` can still tell a hand edit from that,
 * every page records the label each relabelled cell was laid out for (the first one, however
 * often it is relabelled) in a `zukaiLabels` property of its root cell, which draw.io keeps
 * on save like any property set with Edit Data.
 * @param {string} xml the .drawio file
 * @param {Record<string, string | string[]>} map new labels by key, plus optional `$keep`
 * @returns {{ output: string, replaced: number, byText: number, unmatched: string[],
 *   untouched: Array<{ text: string, places: string[] }>, warnings: Array<{ path: string, message: string }> }}
 */
export function relabelDrawio(xml, map) {
  const warnings = [];
  const matched = new Set();
  let replaced = 0;
  let byText = 0;
  const untouched = [];
  let out = inflatePages(xml);
  if (!/<mxfile\b[^>]*\bcompressed="false"/.test(out)) {
    out = out.replace(/<mxfile\b([^>]*?)(\s+compressed="[^"]*")?([^>]*)>/, (_, a, _c, b) => `<mxfile${a}${b} compressed="false">`);
  }
  const keep = new Set(Array.isArray(map.$keep) ? map.$keep.map(String) : []);
  const keys = Object.keys(map).filter((k) => !k.startsWith('$'));
  const pageTitles = new Map(keys.filter((k) => k.endsWith(':title')).map((k) => [k.slice(0, -6), map[k]]));
  const fitProblems = new Map(); // cell id -> { problem, pages }

  // Parse every page's cells first: the by-text pass needs the replacements of all pages.
  const pages = [];
  for (const m of out.matchAll(/<diagram\b([^>]*)>([\s\S]*?)<\/diagram>/g)) {
    const page = parseAttrs(m[1]);
    const pageId = page.id ?? '';
    const cells = [];
    for (const c of m[2].matchAll(/<(mxCell|UserObject)\b([^>]*)>/g)) {
      const a = parseAttrs(c[2]);
      if (a.id === undefined) continue;
      const after = m[2].slice(c.index + c[0].length);
      const inner = c[1] === 'UserObject' ? /^\s*<mxCell\b([^>]*)>/.exec(after) : null;
      const geometry = /^\s*(?:<mxCell\b[^>]*>\s*)?<mxGeometry\b([^>]*)>/.exec(after);
      cells.push({
        name: c[1], attrText: c[2], attrs: a, index: c.index, length: c[0].length, selfClosing: c[0].endsWith('/>'),
        labelAttr: c[1] === 'UserObject' ? 'label' : 'value',
        style: a.style ?? (inner ? parseAttrs(inner[1]).style : '') ?? '',
        geometry: geometry ? parseAttrs(geometry[1]) : null,
      });
    }
    pages.push({ match: m, attrs: m[1], body: m[2], page, pageId, cells, basis: readLabelBasis(m[2]) });
  }

  // Pass 1: by key.
  const sourceToNew = new Map();
  for (const p of pages) {
    const { pageId } = p;
    const lookup = (key) => {
      if (Object.hasOwn(map, `${pageId}:${key}`)) { matched.add(`${pageId}:${key}`); return map[`${pageId}:${key}`]; }
      if (!key.startsWith('$') && Object.hasOwn(map, key)) { matched.add(key); return map[key]; }
      return undefined;
    };
    const valued = new Set(p.cells.filter((c) => (c.attrs[c.labelAttr] ?? '') !== '').map((c) => c.attrs.id));
    for (const c of p.cells) {
      const local = c.attrs.id.startsWith(`${pageId}:`) ? c.attrs.id.slice(pageId.length + 1) : c.attrs.id;
      const viaLabel = local.endsWith(':label');
      const key = viaLabel ? local.slice(0, -6) : local;
      const old = c.attrs[c.labelAttr] ?? '';
      c.parts = splitLabel(old);
      c.key = key;
      if (viaLabel && valued.has(c.attrs.id.slice(0, -6))) continue;
      if (old === '' && key !== 'title') continue;
      const text = lookup(key);
      if (text === undefined) continue;
      c.newText = text;
      c.how = 'key';
      replaced += 1;
      if (c.parts.main !== '') sourceToNew.set(c.parts.main, text);
    }
    const title = lookup('title');
    if (title !== undefined && p.page.name !== undefined) { p.newName = title; replaced += 1; }
  }

  // Pass 2: by source text (hand-copied cells), then the untouched list and the ref lines.
  const untouchedByText = new Map();
  for (const p of pages) {
    for (const c of p.cells) {
      if (c.newText === undefined && c.parts.main !== '' && sourceToNew.has(c.parts.main)) {
        c.newText = sourceToNew.get(c.parts.main);
        c.how = 'text';
        byText += 1;
      }
      const link = c.attrs.link ? /^data:page\/id,(.+)$/.exec(c.attrs.link) : null;
      if (link && pageTitles.has(link[1])) { c.newRef = `↳ ${pageTitles.get(link[1])}`; matched.add(`${link[1]}:title`); }
      const text = c.parts.main;
      if (c.newText === undefined && c.newRef === undefined && text !== '' && /\p{L}/u.test(text) && !keep.has(text)) {
        if (!untouchedByText.has(text)) untouchedByText.set(text, []);
        untouchedByText.get(text).push(`${p.pageId}/${c.attrs.id}`);
      }
    }
  }
  for (const [text, places] of untouchedByText) untouched.push({ text, places });

  // Serialise.
  for (const p of pages.slice().reverse()) {
    let body = '';
    let cursor = 0;
    for (const c of p.cells) {
      if (c.newText === undefined && c.newRef === undefined) continue;
      const parts = { ...c.parts, main: c.newText ?? c.parts.main, ref: c.newRef ?? c.parts.ref };
      const value = joinLabel(parts);
      if (c.newText !== undefined && c.geometry && !c.selfClosing && c.geometry.width !== undefined && c.geometry.relative !== '1') {
        const spacing = ['spacingLeft', 'spacingRight'].reduce((sum, key) => sum + Number(c.style.match(new RegExp(`${key}=(\\d+)`))?.[1] ?? 0), 0);
        const wraps = /whiteSpace=wrap/.test(c.style);
        const problem = /verticalLabelPosition=bottom/.test(c.style)
          ? checkFitBelow(c.parts.main, c.newText, Number(c.style.match(/labelWidth=(\d+)/)?.[1] ?? c.geometry.width), wraps)
          : checkFit(c.parts.main, c.newText, Number(c.geometry.width), Number(c.geometry.height), wraps, { spacing, rhombus: /^rhombus;/.test(c.style), bars: /^shape=process;/.test(c.style) });
        if (problem) {
          if (!fitProblems.has(c.attrs.id)) fitProblems.set(c.attrs.id, { problem, pages: [] });
          fitProblems.get(c.attrs.id).pages.unshift(p.pageId);
        }
      }
      const tag = `<${c.name}${c.attrText.replace(new RegExp(`\\s${c.labelAttr}="[^"]*"`), ` ${c.labelAttr}="${xmlAttr(value)}"`)}>`;
      body += p.body.slice(cursor, c.index) + tag;
      cursor = c.index + c.length;
    }
    body += p.body.slice(cursor);
    const basis = { ...p.basis };
    for (const c of p.cells) if (c.newText !== undefined && c.parts.main !== c.newText && !Object.hasOwn(basis, c.attrs.id)) basis[c.attrs.id] = c.parts.main;
    if (Object.keys(basis).length > 0) body = writeLabelBasis(body, basis);
    const attrs = p.newName !== undefined ? p.attrs.replace(/\sname="[^"]*"/, ` name="${xmlAttr(p.newName)}"`) : p.attrs;
    out = out.slice(0, p.match.index) + `<diagram${attrs}>${body}</diagram>` + out.slice(p.match.index + p.match[0].length);
  }
  for (const [id, { problem, pages: where }] of fitProblems) {
    warnings.push({ path: id, message: `layout: ${problem}; "${id}" on page${where.length > 1 ? 's' : ''} ${where.join(', ')}`, hint: 'shorten the label, or re-emit from a translated IR to resize the shapes' });
  }
  const unmatched = keys.filter((k) => !matched.has(k));
  return { output: out, replaced, byText, unmatched, untouched, warnings };
}

const ROOT_PLAIN = /<mxCell\s+id="0"\s*\/>/;
const ROOT_OBJECT = /<(object|UserObject)\b([^>]*\sid="0"[^>]*)>/;

/**
 * The labels the cells of a page were laid out for, as an earlier relabel recorded them:
 * cell id to the text the cell carried when the page was emitted.
 * @param {string} body the content of a `<diagram>`
 * @returns {Record<string, string>}
 */
export function readLabelBasis(body) {
  const m = ROOT_OBJECT.exec(body);
  if (!m) return {};
  try {
    const parsed = JSON.parse(parseAttrs(m[2]).zukaiLabels ?? '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? Object.fromEntries(Object.entries(parsed).filter(([, v]) => typeof v === 'string')) : {};
  } catch {
    return {};
  }
}

function writeLabelBasis(body, basis) {
  const value = xmlAttr(JSON.stringify(basis));
  const existing = ROOT_OBJECT.exec(body);
  if (existing) {
    const attrs = /\szukaiLabels="[^"]*"/.test(existing[2]) ? existing[2].replace(/\szukaiLabels="[^"]*"/, ` zukaiLabels="${value}"`) : ` zukaiLabels="${value}"${existing[2]}`;
    return body.slice(0, existing.index) + `<${existing[1]}${attrs}>` + body.slice(existing.index + existing[0].length);
  }
  return body.replace(ROOT_PLAIN, `<object label="" zukaiLabels="${value}" id="0"><mxCell/></object>`);
}

/** draw.io compresses page content as base64(deflate-raw(uriencoded(xml))); turn it back into XML. */
export function inflatePages(xml) {
  return xml.replace(/(<diagram\b[^>]*>)([^<]+)(<\/diagram>)/g, (whole, open, body, close) => {
    const text = body.trim();
    if (text === '' || text.startsWith('<')) return whole;
    try {
      const inflated = decodeURIComponent(inflateRawSync(Buffer.from(text, 'base64')).toString('utf8'));
      return `${open}${inflated}${close}`;
    } catch {
      return whole;
    }
  });
}

export function parseAttrs(text) {
  const attrs = {};
  for (const m of text.matchAll(/([\w:-]+)="([^"]*)"/g)) attrs[m[1]] = decodeAttr(m[2]);
  return attrs;
}

// Numeric references (draw.io writes `&#39;` and `&#xa;`) and `&apos;` before `&amp;`, so an
// escaped ampersand never turns into a reference.
const decodeAttr = (v) => v
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
const xmlAttr = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\r?\n/g, '&#10;');

/**
 * Take an emitted HTML label apart: bold wrapper, leading «stereotype» line, the text the
 * author wrote (plain, newline separated), and a trailing `↳ <sub-diagram>` line.
 */
function splitLabel(value) {
  const bold = /^<b>[\s\S]*<\/b>$/.test(value);
  const lines = value.replace(/^<b>|<\/b>$/g, '').split(/<br\s*\/?>/).map((l) => decodeAttr(l.replace(/<\/?[^>]+>/g, (t) => (/^<\/?i>$/.test(t) ? t : ''))));
  let stereotype = '';
  if (lines.length > 1 && /^(<i>)?«[^»]+»(<\/i>)?$/.test(lines[0])) stereotype = lines.shift();
  let ref = '';
  if (lines.length > 1 && lines.at(-1).startsWith('↳ ')) ref = lines.pop();
  return { bold, stereotype, main: lines.join('\n').trim(), ref };
}

function joinLabel({ bold, stereotype, main, ref }) {
  const body = [stereotype, htmlLabel(main), ref ? htmlLabel(ref) : ''].filter((x) => x !== '').join('<br>');
  return bold ? `<b>${body}</b>` : body;
}

const wrappedLines = (text, usable) => wrapText(text, usable).lines;
// The widest unbreakable run: browsers break between CJK characters, so a word with wide
// characters only counts its longest run of narrow ones (or one wide character).
const widestWord = (text) => wrapText(text, 1).widest;
const widest = (text) => Math.ceil(widestLine(text));

/**
 * draw.io wraps text inside the shape minus its 2 px spacing (and minus any `spacingLeft` /
 * `spacingRight`, which the caller takes off the width); a line of the 12 px font takes
 * about 15 px.
 */
const TEXT_INSET = 8;
/** How much wider than drawn the text metrics may measure a line (see text-metrics.mjs). */
const WIDTH_SLACK = 1.03;
const LINE = 15;

/**
 * Fit check for a wrapping box: the new text fits when its wrapped lines fit the height, or
 * when it needs no more lines than the old text took (the box was sized for that). A
 * non-wrapping box must be at least as wide as the longest line. A rhombus (decision) holds
 * a text block only inside its inscribed rectangle: a block a x b fits a w x h diamond when
 * a/w + b/h <= 1, so the check uses that inequality, with the same grace for a text that
 * fits no worse than the old one. Returns the problem or undefined.
 *
 * The emitter already keeps a question off the slanted sides with `spacingLeft` and
 * `spacingRight`, so the diamond's text wraps at its width minus that spacing and nothing
 * else comes off: a line fits when it is no wider than that with the room of `roomFor` on
 * top (`safeWidth`). That is a little inside the frame draw.io wraps in, 2 px less than the
 * width minus the spacing, so a line counted as fitting stays on its line there.
 */
function checkFit(oldText, newText, width, height, wraps, { spacing = 0, rhombus = false, bars = false } = {}) {
  if (wraps && rhombus) {
    const usable = Math.max(safeWidth(width - spacing), 1);
    const block = (text) => {
      const lines = wrappedLines(text, usable);
      const block = Math.min(usable, widest(text));
      return { lines, widest: block, fill: block / width + (lines * LINE) / height };
    };
    const now = block(newText);
    if (now.fill <= 1 || now.fill <= block(oldText).fill) return undefined;
    if (now.lines === 1) return `the new label needs about ${Math.ceil(now.widest)} px in a ${width}x${height} diamond that holds ${Math.floor(width * (1 - LINE / height))} px on one line`;
    const holds = Math.floor((height * (1 - usable / width)) / LINE);
    return holds >= 1
      ? `the new label wraps to ${now.lines} lines in a ${width}x${height} diamond that holds ${holds} at that width`
      : `the new label wraps to ${now.lines} lines, which reach the slanted sides of its ${width}x${height} diamond`;
  }
  // A subroutine keeps its label between its side bars, which take a tenth of the width each.
  const usable = Math.max((bars ? 0.8 * width : width) - spacing - (bars ? 4 : TEXT_INSET), 1);
  if (wraps) {
    if (widestWord(newText) > usable && widestWord(oldText) <= usable) return `a word of the new label is wider than the box (${width}x${height})`;
    const lines = wrappedLines(newText, usable);
    const capacity = Math.max(1, Math.floor((height - 4) / LINE));
    if (lines > capacity && lines > wrappedLines(oldText, usable)) return `the new label wraps to ${lines} lines in a ${width}x${height} box that holds ${capacity}`;
    return undefined;
  }
  const need = widest(newText) + TEXT_INSET;
  return need > width ? `the new label needs about ${need} px in a ${width} px box that does not wrap` : undefined;
}

/**
 * Fit check for a label drawn below its shape (an actor's name): the shape does not hold the
 * text, the layout left room under it for the lines the old label took at the label's wrap
 * width. The new label fits when it takes no more lines and has no word wider than that
 * width; a label that does not wrap must not be wider than the old one.
 */
function checkFitBelow(oldText, newText, width, wraps) {
  if (!wraps) {
    const need = widest;
    return need(newText) > Math.max(need(oldText), width) ? `the new label needs about ${need(newText)} px below its shape, where the old one took ${need(oldText)} px` : undefined;
  }
  if (widestWord(newText) > width && widestWord(oldText) <= width) return `a word of the new label is wider than the ${width} px the label below the shape wraps at`;
  // The text widths err on the wide side by up to 3 % (they size boxes, where too wide is
  // safe). A warning must not: a label that the browser still fits on its line, such as eight
  // full-width characters in 97 px, would be reported as wrapping.
  const lines = wrappedLines(newText, width * WIDTH_SLACK);
  const room = wrappedLines(oldText, width);
  return lines > room ? `the new label wraps to ${lines} lines below its shape, where the layout left room for ${room}` : undefined;
}
