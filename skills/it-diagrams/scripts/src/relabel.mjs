import { inflateRawSync } from 'node:zlib';
import { htmlLabel } from './drawio-xml.mjs';
import { displayLength } from './text-metrics.mjs';

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
 * width heuristic the emitters use (CJK characters at 1.75 Latin widths, which matches
 * draw.io's 12 px font within a few percent), it wraps to more lines than the box's height
 * holds and than the old label took, has an unbreakable word wider than the box, or exceeds
 * a non-wrapping box. A cell and its copies (the canvas page) give one warning naming the
 * pages. Compressed input (draw.io's default for older files) is inflated; output is
 * uncompressed.
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
    pages.push({ match: m, attrs: m[1], body: m[2], page, pageId, cells });
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
        const problem = checkFit(c.parts.main, c.newText, Number(c.geometry.width), Number(c.geometry.height), /whiteSpace=wrap/.test(c.style), { spacing, rhombus: /^rhombus;/.test(c.style) });
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
    const attrs = p.newName !== undefined ? p.attrs.replace(/\sname="[^"]*"/, ` name="${xmlAttr(p.newName)}"`) : p.attrs;
    out = out.slice(0, p.match.index) + `<diagram${attrs}>${body}</diagram>` + out.slice(p.match.index + p.match[0].length);
  }
  for (const [id, { problem, pages: where }] of fitProblems) {
    warnings.push({ path: id, message: `layout: ${problem}; "${id}" on page${where.length > 1 ? 's' : ''} ${where.join(', ')}`, hint: 'shorten the label, or re-emit from a translated IR to resize the shapes' });
  }
  const unmatched = keys.filter((k) => !matched.has(k));
  return { output: out, replaced, byText, unmatched, untouched, warnings };
}

/** draw.io compresses page content as base64(deflate-raw(uriencoded(xml))); turn it back into XML. */
function inflatePages(xml) {
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

function parseAttrs(text) {
  const attrs = {};
  for (const m of text.matchAll(/([\w:-]+)="([^"]*)"/g)) attrs[m[1]] = decodeAttr(m[2]);
  return attrs;
}

const decodeAttr = (v) => v.replace(/&#10;/g, '\n').replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
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

const CHAR = 7;
const wrappedLines = (text, usable) => text.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil((CHAR * displayLength(l)) / usable)), 0);
// The longest unbreakable run: browsers break between CJK characters, so a word with wide
// characters only counts its longest run of narrow ones (or one wide character).
const WIDE_CHAR = /[\u1100-\u115F\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA000-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]|[\u{20000}-\u{3FFFF}]/u;
const unbreakable = (word) => (WIDE_CHAR.test(word) ? Math.max(2, ...word.split(WIDE_CHAR).map(displayLength)) : displayLength(word));
const widestWord = (text) => Math.max(...text.split(/\s+/).map(unbreakable), 0) * CHAR;

/**
 * draw.io wraps text inside the shape minus its 2 px spacing (and minus any `spacingLeft` /
 * `spacingRight`, which the caller takes off the width); a line of the 12 px font takes
 * about 15 px.
 */
const TEXT_INSET = 8;
const LINE = 15;

/**
 * Fit check for a wrapping box: the new text fits when its wrapped lines fit the height, or
 * when it needs no more lines than the old text took (the box was sized for that). A
 * non-wrapping box must be at least as wide as the longest line. A rhombus (decision) holds
 * a text block only inside its inscribed rectangle: a block a x b fits a w x h diamond when
 * a/w + b/h <= 1, so the check uses that inequality, with the same grace for a text that
 * fits no worse than the old one. Returns the problem or undefined.
 */
function checkFit(oldText, newText, width, height, wraps, { spacing = 0, rhombus = false } = {}) {
  const usable = Math.max(width - spacing - TEXT_INSET, 1);
  if (wraps && rhombus) {
    const block = (text) => {
      const lines = wrappedLines(text, usable);
      const widest = Math.min(usable, Math.ceil(Math.max(...text.split('\n').map(displayLength), 1) * CHAR));
      return { lines, widest, fill: widest / width + (lines * LINE) / height };
    };
    const now = block(newText);
    if (now.fill <= 1 || now.fill <= block(oldText).fill) return undefined;
    if (now.lines === 1) return `the new label needs about ${now.widest} px in a ${width}x${height} diamond that holds ${Math.floor(width * (1 - LINE / height))} px on one line`;
    return `the new label wraps to ${now.lines} lines in a ${width}x${height} diamond that holds ${Math.floor((height * (1 - usable / width)) / LINE)} at that width`;
  }
  if (wraps) {
    if (widestWord(newText) > usable && widestWord(oldText) <= usable) return `a word of the new label is wider than the box (${width}x${height})`;
    const lines = wrappedLines(newText, usable);
    const capacity = Math.max(1, Math.floor((height - 4) / LINE));
    if (lines > capacity && lines > wrappedLines(oldText, usable)) return `the new label wraps to ${lines} lines in a ${width}x${height} box that holds ${capacity}`;
    return undefined;
  }
  const need = Math.ceil(Math.max(...newText.split('\n').map(displayLength), 1) * CHAR) + TEXT_INSET;
  return need > width ? `the new label needs about ${need} px in a ${width} px box that does not wrap` : undefined;
}
