/**
 * Write each page of a draw.io file as an editable SVG picture (`<name>.drawio.svg`): an image
 * that GitHub, a browser or a wiki shows, with the page's own mxfile in the `content`
 * attribute of the root `<svg>`, so draw.io opens it for editing and `extract` reads it back.
 *
 * The picture is drawn by one of the renderers of `preview`: the draw.io desktop CLI
 * (offline), or Playwright with draw.io's viewer script on a local page (the diagram never
 * leaves the machine; only the viewer is fetched). What the renderer returns is then made a
 * file that stands on its own, by the same code for both:
 *
 *   - labels become SVG `<text>`, one element per line, at the place the browser laid the
 *     line out. draw.io writes labels as HTML in a `foreignObject`, which only a browser
 *     draws; anything else (a PDF converter, a wiki's own renderer) shows "Text is not SVG"
 *     in its place. A label that holds more than text (a table, a list, an image) keeps its
 *     HTML form and is named in a warning. The step needs a browser, so with draw.io desktop
 *     and no Playwright every label keeps the HTML form, also with a warning.
 *   - a white background, no colours that follow the viewer's dark mode, and a font list
 *     that ends in a generic family;
 *   - each page gets a file of its own that holds only that page. A link to another page of
 *     the file cannot work there: the picture has no such link (the label and its "↳" line
 *     stay), while the embedded diagram keeps the cell as it is in the source file.
 */
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { findDrawioBinary, drawioMissing, drawioHint, runDrawio, drawioFailure, loadPlaywright, playwrightMissing, DRAWIO_VIEWER_SCRIPT } from './preview.mjs';
import { inflatePages, parseAttrs } from './relabel.mjs';
import { drawioXmlOf } from './extract-drawio.mjs';
import { xmlAttr } from './drawio-xml.mjs';
import { runSlugOf } from './run-order.mjs';

/** White space kept around the drawing, in diagram units. */
const BORDER = 20;
const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

/**
 * The pages of a draw.io file, each as an mxfile of its own. A file of one page is kept as it
 * is; a page of a larger file gets the file's `<mxfile>` tag without its page count.
 * @param {string} xml
 * @returns {{ pages: Array<{ id: string, name: string, cells: number, xml: string }>, zukai: boolean } | { error: string }}
 */
export function drawioPages(xml) {
  const text = inflatePages(xml);
  const open = /<mxfile\b[^>]*>/.exec(text);
  if (!open) return { error: 'not a .drawio file (no <mxfile> root)' };
  const blocks = [...text.matchAll(/<diagram\b([^>]*?)(?<!\/)>([\s\S]*?)<\/diagram>/g)];
  if (blocks.length === 0) return { error: 'this draw.io file has no page' };
  const head = open[0].replace(/\s+pages="[^"]*"/, '');
  const pages = blocks.map((m, i) => {
    const attrs = parseAttrs(m[1]);
    return {
      id: attrs.id ?? `page-${i + 1}`,
      name: attrs.name ?? `Page-${i + 1}`,
      // Cells "0" and "1" are the page itself; anything past them is drawn.
      cells: Math.max(0, (m[2].match(/<mxCell\b/g) ?? []).length - 2),
      xml: blocks.length === 1 ? text : `${head}\n  ${m[0]}\n</mxfile>\n`,
    };
  });
  return { pages, zukai: /\bhost="zukai"/.test(open[0]) };
}

/**
 * The pages of a file that `--page` names, by id or by name; without a name, every page.
 * A name that no page has is an error that lists the pages there are.
 * @param {Array<{ id: string, name: string }>} pages
 * @param {string[] | undefined} wanted
 * @returns {{ pages: object[] } | { error: { message: string, hint: string } }}
 */
export function selectPages(pages, wanted) {
  if (wanted === undefined || wanted.length === 0) return { pages };
  const unknown = wanted.filter((w) => !pages.some((p) => p.id === w || p.name === w));
  if (unknown.length > 0) {
    return { error: { message: `no page ${unknown.map((u) => `"${u}"`).join(', ')} in this file`, hint: `pages: ${pages.map((p) => `${p.id} ("${p.name}")`).join(', ')}` } };
  }
  return { pages: pages.filter((p) => wanted.includes(p.id) || wanted.includes(p.name)) };
}

/** The page as the renderer gets it: links to other pages and draw.io actions taken off. */
export const withoutDataLinks = (xml) => xml.replace(/(<UserObject\b[^>]*?)\s+link="data:[^"]*"/g, '$1');

const fileSafe = (text) => String(text).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^[-.]+|[-.]+$/g, '');

/**
 * File names (without `.drawio.svg`) for the pages of one file. A file of one page keeps the
 * file's name. In a file Zukai wrote, a page id is the diagram's slug and names the file; in
 * any other file the page's name does, since draw.io's own page ids are random. A name that
 * comes twice gets a number.
 */
export function pageFileNames(pages, stem, zukai) {
  if (pages.length === 1) return [stem];
  const taken = new Set();
  return pages.map((p, i) => {
    const base = (zukai && /^[\w.-]+$/.test(p.id) ? p.id : fileSafe(p.name)) || `page-${i + 1}`;
    let name = base;
    for (let n = 2; taken.has(name); n++) name = `${base}-${n}`;
    taken.add(name);
    return name;
  });
}

// A style declaration ends at a ";" that is not the end of a character reference (&quot;).
const DECLARATIONS = /(?<!&#?\w{1,8});/;
const ADAPTIVE = /light-dark\(|var\(--ge-/;

/** A `style` value without the declarations that follow the viewer's colour scheme. */
function staticStyle(value, drop = () => false) {
  return value.split(DECLARATIONS).map((d) => d.trim()).filter((d) => d !== '' && !ADAPTIVE.test(d) && !drop(d)).join('; ');
}

/**
 * Make the SVG a renderer returned a file that stands on its own and carries the diagram:
 * the mxfile in `content` (first attribute, where `extract` and draw.io read it), both
 * namespaces, a size and a `viewBox`, a white background, and no colour that depends on the
 * viewer's light or dark mode. Works on the text, so it needs no browser.
 * @param {string} svg
 * @param {string} mxfile
 * @returns {{ svg: string, width: number, height: number, htmlLabels: number, externalImages: number } | { error: string }}
 */
export function standaloneSvg(svg, mxfile) {
  const text = String(svg).replace(/^\uFEFF/, '');
  const root = /<svg\b([^>]*)>/.exec(text);
  if (!root) return { error: 'the renderer returned no SVG' };
  const close = text.lastIndexOf('</svg>');
  if (close < 0) return { error: 'the renderer returned an SVG that is cut off' };
  const attrs = new Map([...root[1].matchAll(/([\w:-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
  const px = (v) => (v !== undefined && /^[\d.]+(px)?$/.test(v) ? Number.parseFloat(v) : undefined);
  let width = px(attrs.get('width'));
  let height = px(attrs.get('height'));
  const box = attrs.get('viewBox')?.trim().split(/[\s,]+/).map(Number);
  if (box?.length === 4 && box.every(Number.isFinite)) {
    width ??= box[2];
    height ??= box[3];
  } else if (width !== undefined && height !== undefined) {
    attrs.set('viewBox', `0 0 ${width} ${height}`);
  }
  if (!(width > 0 && height > 0)) return { error: 'the renderer returned an SVG without a size' };

  let body = text.slice(root.index + root[0].length, close)
    .replace(/<style\b[^>]*>(?:(?!<\/style>)[\s\S])*--ge-(?:(?!<\/style>)[\s\S])*<\/style>/g, '')
    .replace(/\sstyle="([^"]*)"/g, (whole, value) => {
      if (!ADAPTIVE.test(value)) return whole;
      const kept = staticStyle(value);
      return kept === '' ? '' : ` style="${kept};"`;
    });
  // draw.io ends its SVG with a notice for viewers that cannot draw HTML labels ("Text is not
  // SVG - cannot display"). With every label written as text there is nothing to warn about,
  // and a viewer without HTML would show the notice over a complete picture.
  if (!/<foreignObject\b/.test(body)) body = body.replace(/<switch>\s*<g requiredFeatures="[^"]*"\s*\/>(?:(?!<\/switch>)[\s\S])*<\/switch>/g, '');
  const drawn = (body.match(/<(path|ellipse|circle|polygon|polyline|line|text|image|foreignObject)\b/g) ?? []).length + Math.max(0, (body.match(/<rect\b/g) ?? []).length - 1);
  if (drawn === 0) return { error: 'the renderer drew nothing' };
  if (!/^\s*(?:<defs\b[^>]*(?:\/>|>[\s\S]*?<\/defs>)\s*)?<rect\b(?=[^>]*\swidth="100%")(?=[^>]*\sheight="100%")(?=[^>]*\sfill="#(?:fff|ffffff)")[^>]*>/i.test(body)) {
    body = `<rect fill="#ffffff" width="100%" height="100%" x="0" y="0"/>${body}`;
  }

  const style = staticStyle(attrs.get('style') ?? '', (d) => /^(background|color-scheme)\b/i.test(d));
  const out = [`content="${xmlAttr(mxfile)}"`, `xmlns="${SVG_NS}"`, `xmlns:xlink="${XLINK_NS}"`, `version="${attrs.get('version') ?? '1.1'}"`, `width="${width}px"`, `height="${height}px"`, `viewBox="${attrs.get('viewBox')}"`];
  for (const [name, value] of attrs) {
    // The id draw.io gives the root is random and only served the style block taken out above.
    if (['content', 'xmlns', 'xmlns:xlink', 'version', 'width', 'height', 'viewBox', 'style', 'id'].includes(name)) continue;
    out.push(`${name}="${value}"`);
  }
  out.push(`style="background: #ffffff;${style ? ` ${style};` : ''}"`);
  return {
    svg: `<svg ${out.join(' ')}>${body}</svg>\n`,
    width,
    height,
    htmlLabels: (body.match(/<foreignObject\b/g) ?? []).length,
    externalImages: (body.match(/<image\b[^>]*\s(?:xlink:)?href="(?!data:)[^"]*"/g) ?? []).length,
  };
}

/**
 * Runs in the browser. Draws one page with draw.io's viewer and hands back the SVG draw.io
 * itself exports for it (light colours, white background, `border` units of margin).
 */
async function drawPageInBrowser({ xml, border }) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  try {
    el.setAttribute('data-mxgraph', JSON.stringify({ xml, nav: false, toolbar: null, lightbox: false, highlight: 'none', resize: false, 'auto-fit': false }));
    const viewer = await new Promise((done, failed) => { setTimeout(() => failed(new Error('the viewer did not draw the page in 60 s')), 60_000); GraphViewer.createViewerForElement(el, done); });
    // Shapes of a stencil library and images arrive after the first paint.
    await new Promise((done) => { setTimeout(done, 400); });
    const svg = viewer.graph.getSvg('#ffffff', 1, border, false, null, true, true, null, null, false, null, 'light', 'diagram');
    return new XMLSerializer().serializeToString(svg);
  } finally {
    el.remove();
  }
}

/**
 * Runs in the browser, on an empty page and with no network. Replaces every HTML label of the
 * SVG (a `foreignObject`, with draw.io's one-line fallback beside it) by SVG text: the browser
 * lays the label out, and each line it made becomes a `<text>` at that place, with the font,
 * weight, colour and alignment it had, over a rectangle where the label had a background.
 * A label that holds more than text with inline formatting is left as it is and counted.
 */
function textifyInBrowser(svgText) {
  const SVG = 'http://www.w3.org/2000/svg';
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  if (doc.querySelector('parsererror')) return { error: 'the SVG of the renderer is not well-formed XML' };
  document.body.replaceChildren();
  const svg = document.importNode(doc.documentElement, true);
  document.body.appendChild(svg);

  const INLINE = new Set(['div', 'span', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'br', 'wbr', 'font', 'p', 'sub', 'sup', 'code', 'small']);
  const RTL = /[֐-ࣿיִ-﷿ﹰ-﻿]/;
  const round = (v) => Math.round(v * 100) / 100;
  const set = (el, attrs) => { for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== '') el.setAttribute(k, String(v)); return el; };
  const colour = (value) => {
    const m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(value);
    if (!m) return { value, alpha: 1 };
    const alpha = m[4] === undefined ? 1 : m[4].endsWith('%') ? Number.parseFloat(m[4]) / 100 : Number(m[4]);
    return { value: `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`, alpha };
  };
  const GENERIC = /(^|,\s*)(serif|sans-serif|monospace|cursive|fantasy|system-ui)\s*$/;
  const family = (value) => (GENERIC.test(value) ? value : /helvetica/i.test(value) && !/arial/i.test(value) ? `${value}, Arial, sans-serif` : `${value}, ${/mono|courier|consolas/i.test(value) ? 'monospace' : 'sans-serif'}`);
  const canvas = document.createElement('canvas').getContext('2d');
  const ascents = new Map();
  const ascentOf = (cs) => {
    const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    if (!ascents.has(font)) {
      canvas.font = font;
      const m = canvas.measureText('Hg');
      ascents.set(font, { ascent: m.fontBoundingBoxAscent, descent: m.fontBoundingBoxDescent });
    }
    return ascents.get(font);
  };
  const decorationOf = (el, stop) => {
    const lines = new Set();
    for (let at = el; at && at !== stop; at = at.parentElement) for (const l of getComputedStyle(at).textDecorationLine.split(' ')) if (l === 'underline' || l === 'line-through') lines.add(l);
    return [...lines].join(' ');
  };
  const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const range = document.createRange();
  let converted = 0;
  const kept = [];

  for (const fo of [...svg.querySelectorAll('foreignObject')]) {
    const holder = fo.parentNode.localName === 'switch' ? fo.parentNode : fo;
    const complex = [...fo.querySelectorAll('*')].some((el) => !INLINE.has(el.localName)) || RTL.test(fo.textContent);
    if (complex) {
      kept.push(holder.closest('[data-cell-id]')?.getAttribute('data-cell-id') ?? fo.textContent.trim().slice(0, 40));
      continue;
    }
    // Measured without the transforms above the label (a rotated lane title), in the
    // coordinates the new text is then written in, under those same transforms.
    const lifted = [];
    for (let at = holder.parentNode; at && at !== svg; at = at.parentNode) {
      if (at.hasAttribute('transform')) { lifted.push([at, at.getAttribute('transform')]); at.removeAttribute('transform'); }
    }
    const toUser = svg.getScreenCTM().inverse();
    const at = (x, y) => new DOMPoint(x, y).matrixTransform(toUser);
    const group = document.createElementNS(SVG, 'g');

    for (const el of fo.querySelectorAll('*')) {
      const cs = getComputedStyle(el);
      const fill = colour(cs.backgroundColor);
      const border = cs.borderTopStyle !== 'none' && Number.parseFloat(cs.borderTopWidth) > 0 ? colour(cs.borderTopColor) : null;
      if (fill.alpha === 0 && !border) continue;
      for (const r of el.getClientRects()) {
        if (r.width === 0 || r.height === 0) continue;
        const a = at(r.left, r.top); const b = at(r.right, r.bottom);
        group.appendChild(set(document.createElementNS(SVG, 'rect'), {
          x: round(a.x), y: round(a.y), width: round(b.x - a.x), height: round(b.y - a.y),
          fill: fill.alpha === 0 ? 'none' : fill.value, 'fill-opacity': fill.alpha > 0 && fill.alpha < 1 ? fill.alpha : undefined,
          stroke: border ? border.value : undefined, 'stroke-width': border ? Number.parseFloat(cs.borderTopWidth) : undefined,
        }));
      }
    }

    // Runs of text that sit on one line and come from one text node.
    const runs = [];
    const walker = document.createTreeWalker(fo, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const el = node.parentElement;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden') continue;
      const pre = cs.whiteSpace.startsWith('pre');
      let run = null;
      for (const { segment, index } of graphemes.segment(node.data)) {
        range.setStart(node, index);
        range.setEnd(node, index + segment.length);
        // White space that the layout collapsed or hung at the end of a line has no width.
        const r = [...range.getClientRects()].find((q) => q.width > 0);
        if (!r) continue;
        const ch = pre ? segment : segment.replace(/[\t\n\r]/g, ' ');
        if (run && Math.abs(r.top - run.top) < 1 && r.left >= run.right - 1) { run.text += ch; run.right = r.right; }
        else { run = { text: ch, left: r.left, right: r.right, top: r.top, bottom: r.bottom, el, cs }; runs.push(run); }
      }
    }
    const lines = [];
    for (const run of runs) {
      const middle = (run.top + run.bottom) / 2;
      const last = lines.at(-1);
      if (last && middle > last.top && middle < last.bottom && run.left >= last.right - 1) { last.runs.push(run); last.right = run.right; last.top = Math.min(last.top, run.top); last.bottom = Math.max(last.bottom, run.bottom); }
      else lines.push({ runs: [run], left: run.left, right: run.right, top: run.top, bottom: run.bottom });
    }
    for (const line of lines) {
      const first = line.runs[0];
      const align = first.cs.textAlign;
      const anchor = /center/.test(align) ? 'middle' : align === 'right' || align === 'end' ? 'end' : 'start';
      // The baseline of the tallest run: the box of a run is its font's ascent over its descent.
      const baseline = Math.max(...line.runs.map((r) => { const m = ascentOf(r.cs); return r.top + (r.bottom - r.top - m.ascent - m.descent) / 2 + m.ascent; }));
      const p = at(anchor === 'middle' ? (line.left + line.right) / 2 : anchor === 'end' ? line.right : line.left, baseline);
      const text = set(document.createElementNS(SVG, 'text'), { x: round(p.x), y: round(p.y), 'text-anchor': anchor === 'start' ? undefined : anchor, 'font-family': family(first.cs.fontFamily) });
      text.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
      const look = (r) => {
        const fill = colour(r.cs.color);
        return {
          'font-size': `${round(Number.parseFloat(r.cs.fontSize))}px`, fill: fill.value, 'fill-opacity': fill.alpha < 1 ? fill.alpha : undefined,
          'font-weight': Number(r.cs.fontWeight) >= 600 ? 'bold' : undefined, 'font-style': r.cs.fontStyle === 'italic' || r.cs.fontStyle.startsWith('oblique') ? 'italic' : undefined,
          'text-decoration': decorationOf(r.el, fo) || undefined,
          'font-family': r.cs.fontFamily === first.cs.fontFamily ? undefined : family(r.cs.fontFamily),
        };
      };
      if (line.runs.length === 1) {
        set(text, look(first)).textContent = first.text;
      } else {
        for (const r of line.runs) text.appendChild(set(document.createElementNS(SVG, 'tspan'), look(r))).textContent = r.text;
      }
      group.appendChild(text);
    }

    if (group.childNodes.length > 0) holder.replaceWith(group);
    else holder.remove();
    for (const [el, transform] of lifted) el.setAttribute('transform', transform);
    converted += 1;
  }
  return { svg: new XMLSerializer().serializeToString(svg), converted, kept };
}

/**
 * Labels as SVG text for each SVG given, in one browser that loads nothing from the network.
 * @returns {Promise<Array<{ svg: string, converted: number, kept: string[] }>>}
 */
async function textify(browser, svgs) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: 1 });
  try {
    await page.setContent('<!doctype html><html><body style="margin:0;background:#fff"></body></html>');
    const out = [];
    for (const svg of svgs) {
      const r = await page.evaluate(textifyInBrowser, svg);
      if (r.error) throw new Error(r.error);
      out.push(r);
    }
    return out;
  } finally {
    await page.close();
  }
}

/** Every page drawn by draw.io's viewer in a local browser, labels already as SVG text. */
async function renderWeb(pw, pages) {
  const browser = await pw.chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: 1 });
    await page.setContent('<!doctype html><html><body style="margin:0;background:#fff"></body></html>');
    await page.addScriptTag({ url: DRAWIO_VIEWER_SCRIPT });
    await page.waitForFunction(() => typeof globalThis.GraphViewer === 'function', null, { timeout: 90_000 });
    const drawn = [];
    for (const p of pages) drawn.push(await page.evaluate(drawPageInBrowser, { xml: withoutDataLinks(p.xml), border: BORDER }));
    await page.close();
    return await textify(browser, drawn);
  } finally {
    await browser.close();
  }
}

/**
 * Every page drawn by the draw.io desktop CLI, one single-page file at a time (so the page
 * number, which draw.io counted from 0 and later from 1, is never needed). The diagram is not
 * embedded by draw.io (`--embed-diagram`): `standaloneSvg` writes it, the same for both renderers.
 */
function renderDesktop(bin, pages) {
  const work = mkdtempSync(join(tmpdir(), 'zukai-export-'));
  try {
    const out = [];
    for (const [i, p] of pages.entries()) {
      const source = join(work, `page-${i + 1}.drawio`);
      const target = join(work, `page-${i + 1}.svg`);
      writeFileSync(source, withoutDataLinks(p.xml), 'utf8');
      // draw.io exits 0 when an export fails: the file it writes is the only sign of success.
      const r = runDrawio(bin, ['-x', '-f', 'svg', '-b', String(BORDER), '-o', target, source]);
      if (r.error || r.status !== 0 || !existsSync(target)) return { ok: false, message: `page "${p.title}": ${drawioFailure(r)}` };
      out.push(readFileSync(target, 'utf8'));
    }
    return { ok: true, svgs: out };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/**
 * The draw.io files an export target stands for, and where their pictures go by default: a
 * file gives pictures beside it; a run folder gives `svg/` inside it, from the combined
 * `<run-slug>.drawio` (the file the user opens, where a step that refers to a part shows the
 * part's title), or from the files of `drawio/` when the run has no combined file.
 */
function sourcesOf(target, cwd) {
  const path = resolve(cwd, target);
  let stat;
  try {
    stat = statSync(path);
  } catch (e) {
    return { error: { path: target, message: `cannot read: ${e.message}` } };
  }
  if (!stat.isDirectory()) return { files: [path], outDir: dirname(path) };
  const slug = runSlugOf(path);
  const combined = slug ? join(path, `${slug}.drawio`) : undefined;
  if (combined && existsSync(combined)) return { files: [combined], outDir: join(path, 'svg'), run: true };
  const single = join(path, 'drawio');
  const parts = existsSync(single) && statSync(single).isDirectory() ? readdirSync(single).filter((f) => f.endsWith('.drawio')).sort().map((f) => join(single, f)) : [];
  if (parts.length > 0) return { files: parts, outDir: join(path, 'svg'), run: true };
  return { error: { path: target, message: `no draw.io file in this folder (looked for ${combined ? `${basename(combined)} and ` : ''}drawio/*.drawio)`, hint: 'export takes a .drawio file or the folder of a run that was emitted to draw.io; emit and bundle the run with --to drawio first' } };
}

/**
 * @param {string} target a .drawio file, an editable picture (.drawio.svg), or a run folder
 * @param {{ out?: string, cwd?: string, page?: string[], renderer?: 'drawio-desktop' | 'drawio-web' }} [options]
 *   `out` is a folder, or a file name ending in `.svg` when one page is written;
 *   `page` keeps only the pages named, by id or name, and is an error when one is not there;
 *   `renderer` forces one of the two renderers instead of preferring draw.io desktop (tests).
 * @returns {Promise<{ ok: boolean, usage?: boolean, files?: Array<{ page: string, title: string, out: string, width: number, height: number }>, renderer?: string, text?: 'svg' | 'html', warnings: Array<{ stage: string, path: string, message: string, hint?: string }>, errors: Array<{ path: string, message: string, hint?: string }> }>}
 */
export async function exportSvg(target, options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const warnings = [];
  const fail = (error, usage = false) => ({ ok: false, ...(usage ? { usage: true } : {}), errors: [error], warnings });
  const sources = sourcesOf(target, cwd);
  if (sources.error) return fail(sources.error);

  const jobs = [];
  for (const file of sources.files) {
    let xml;
    try {
      xml = readFileSync(file, 'utf8');
    } catch (e) {
      return fail({ path: file, message: `cannot read file: ${e.message}` });
    }
    // An editable picture stands for the diagram it holds, as it does for `preview` and
    // `extract`: its pages are drawn again, the one page of a picture into the picture itself.
    const picture = /\.svg$/i.test(file);
    if (picture) {
      const inside = drawioXmlOf(Buffer.from(xml, 'utf8'));
      if (inside.error) return fail({ path: file, message: inside.error, hint: 'export draws the diagram a .drawio.svg holds; a plain SVG holds none and is already a picture' });
      xml = inside.xml;
    }
    const split = drawioPages(xml);
    if (split.error) return fail({ path: file, message: split.error, hint: 'export takes a .drawio file, an editable picture (.drawio.svg) or a run folder; a Mermaid or FigJam run has no draw.io file to export' });
    const names = pageFileNames(split.pages, basename(file).replace(/\.(drawio\.svg|drawio|xml|svg)$/i, ''), split.zukai);
    // A picture keeps the name it has in the whole file, so one page exported alone replaces its own picture.
    const picked = selectPages(split.pages, sources.files.length === 1 ? options.page : undefined);
    if (picked.error) return fail({ path: '--page', ...picked.error });
    for (const [i, page] of split.pages.entries()) {
      if (!picked.pages.includes(page)) continue;
      if (page.cells === 0) {
        warnings.push({ stage: 'export', path: file, message: `page "${page.name}" has nothing on it: no picture is written for it` });
        continue;
      }
      jobs.push({ id: page.id, title: page.name, xml: page.xml, file, name: names[i] });
    }
  }
  if (options.page !== undefined && options.page.length > 0 && sources.files.length > 1) {
    return fail({ path: '--page', message: '--page names a page of one draw.io file, and this run has no combined file', hint: `export the file of the diagram itself: ${sources.files.map((f) => basename(f)).join(', ')} (in drawio/)` });
  }
  if (jobs.length === 0) return fail({ path: target, message: options.page?.length ? 'nothing to export: the page named is empty' : 'nothing to export: every page is empty' });

  const single = options.out !== undefined && /\.svg$/i.test(options.out);
  if (single && jobs.length > 1) {
    return fail({ path: '/', message: `--out names one file, but ${jobs.length} pages would be written (${jobs.map((j) => j.name).join(', ')})`, hint: 'give --out a folder: each page becomes <name>.drawio.svg in it' }, true);
  }
  const outDir = options.out === undefined ? sources.outDir : resolve(cwd, options.out);
  for (const job of jobs) job.out = single ? resolve(cwd, options.out) : join(outDir, `${job.name}.drawio.svg`);
  const twice = jobs.find((j, i) => jobs.findIndex((o) => o.out === j.out) !== i);
  if (twice) return fail({ path: twice.file, message: `two pages would be written to ${twice.out}`, hint: 'rename one of the files or pages' });

  // Draw. Nothing is written before every page has a picture.
  const attempts = [];
  let renderer;
  let rendered; // per page: { svg, converted, kept }
  let pw;
  let found = { bin: null, tried: [], broken: [] };
  if (options.renderer !== 'drawio-web') {
    found = findDrawioBinary();
    const { bin } = found;
    if (bin) {
      const r = renderDesktop(bin, jobs);
      if (r.ok) {
        renderer = 'drawio-desktop';
        rendered = r.svgs.map((svg) => ({ svg, converted: 0, kept: [] }));
        pw = loadPlaywright(cwd);
        if (pw) {
          let browser;
          try {
            browser = await pw.chromium.launch();
            rendered = await textify(browser, r.svgs);
          } catch (e) {
            pw = null;
            warnings.push({ stage: 'export', path: target, message: `the labels could not be turned into SVG text (${String(e.message).split('\n')[0].slice(0, 200)})` });
          } finally {
            await browser?.close();
          }
        }
      } else {
        attempts.push(`draw.io desktop (${bin}): ${r.message}`);
      }
    } else {
      attempts.push(drawioMissing(found));
    }
    if (!rendered && options.renderer === 'drawio-desktop') return fail({ path: target, message: `draw.io desktop could not render the file (${attempts.join('; ')})` });
  }
  if (!rendered) {
    pw = loadPlaywright(cwd);
    if (!pw) {
      const missing = playwrightMissing(cwd);
      attempts.push(missing.attempt);
      return fail({ path: target, message: `no renderer available (${attempts.join('; ')})`, hint: `${drawioHint(found)}, or ${missing.install}; no picture was written, and the .drawio file itself is complete without one` });
    }
    try {
      rendered = await renderWeb(pw, jobs);
      renderer = 'drawio-web';
    } catch (e) {
      attempts.push(`browser render: ${String(e.message).split('\n')[0].slice(0, 200)}`);
      return fail({ path: target, message: `export failed (${attempts.join('; ')})`, hint: 'the browser needs network access to load the draw.io viewer; the diagram itself is rendered locally' });
    }
  }

  const done = [];
  for (const [i, job] of jobs.entries()) {
    const r = standaloneSvg(rendered[i].svg, job.xml);
    if (r.error) return fail({ path: job.file, message: `page "${job.name}": ${r.error}` });
    // The file must give back the page it was made from, or it is not an editable picture.
    const back = drawioXmlOf(Buffer.from(r.svg, 'utf8'));
    if (back.xml !== job.xml) return fail({ path: job.file, message: `page "${job.name}": the diagram could not be embedded in the picture` });
    done.push({ job, ...r, kept: rendered[i].kept });
  }
  // 'html' when no browser was there to turn the labels into SVG text.
  const text = done.some((d) => d.htmlLabels > d.kept.length) ? 'html' : 'svg';
  for (const d of done) {
    if (d.htmlLabels > d.kept.length) {
      warnings.push({ stage: 'export', path: d.job.out, message: `${d.htmlLabels} label${d.htmlLabels === 1 ? ' is' : 's are'} written as HTML, which only a browser draws: a viewer that is not a browser shows "Text is not SVG" in their place`, hint: `labels become SVG text when Playwright is installed beside draw.io desktop: ${playwrightMissing(cwd).install}` });
    } else if (d.kept.length > 0) {
      warnings.push({ stage: 'export', path: d.job.out, message: `${d.kept.length} label${d.kept.length === 1 ? ' holds' : 's hold'} more than text (a table, a list, an image or right-to-left text) and ${d.kept.length === 1 ? 'is' : 'are'} written as HTML, which only a browser draws: ${d.kept.slice(0, 5).map((k) => `"${k}"`).join(', ')}${d.kept.length > 5 ? ` and ${d.kept.length - 5} more` : ''}` });
    }
    if (d.externalImages > 0) {
      warnings.push({ stage: 'export', path: d.job.out, message: `${d.externalImages} image${d.externalImages === 1 ? '' : 's'} of the page ${d.externalImages === 1 ? 'is' : 'are'} loaded from an address: a picture shown through an <img> tag (GitHub, a wiki) loads nothing, so ${d.externalImages === 1 ? 'it stays' : 'they stay'} empty there`, hint: 'embed the image in the draw.io file (Edit Image, a data: URI) and export again' });
    }
  }
  try {
    for (const d of done) {
      mkdirSync(dirname(d.job.out), { recursive: true });
      writeFileSync(d.job.out, d.svg, 'utf8');
    }
  } catch (e) {
    return fail({ path: options.out ?? outDir, message: `cannot write file: ${e.message}` });
  }
  return { ok: true, files: done.map((d) => ({ page: d.job.id, title: d.job.title, out: d.job.out, width: d.width, height: d.height })), renderer, text, warnings, errors: [] };
}
