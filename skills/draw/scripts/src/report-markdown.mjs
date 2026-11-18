/**
 * The Markdown of a report as HTML: `marked` (bundled into the CLI) with every rule that
 * makes the output safe to show from a file the agent, a teammate or a clone wrote.
 *
 * - Raw HTML in the Markdown is shown as text, never as markup.
 * - A link keeps its target only for `http:`, `https:` or an in-page `#...`; a protocol-
 *   relative `//host`, `javascript:` and every other target leave the link text alone.
 * - An image is shown only from a `data:` URI of a picture type, or from a file of the
 *   report's own `assets/` listing (inlined as a `data:` URI, size-capped); any other source,
 *   `../../secret` included, shows its alternative text.
 * - Headings get ids (`h-<slug>`) for the table of contents.
 * - The section markers of a template (`<!-- zukai:section id="..." ... -->`) are recognised
 *   by `splitSections` and never reach the output.
 */
import { Marked } from 'marked';

export const SECTION_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** A section marker line: an id, and in a template a guide and an embed. */
export const MARKER_RE = /^\s*<!--\s*zukai:section\s+id="([^"]*)"((?:\s+[a-z]+="[^"]*")*)\s*-->\s*$/;
/** The largest picture inlined into a report, as file bytes. */
export const MAX_ASSET_BYTES = 2 * 1024 * 1024;
const IMAGE_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml', webp: 'image/webp', gif: 'image/gif' };
const DATA_IMAGE = /^data:image\/(?:png|jpeg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=\s]+$/;

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => ESC[c]);
/** Text for an element's content: as `escapeHtml`, but a character reference (`&copy;`, `&#169;`) stays one. */
const escapeText = (text) => String(text).replace(/&(?!(?:#\d{1,7}|#x[0-9a-f]{1,6}|[a-z][a-z0-9]{1,31});)|[<>"']/gi, (c) => ESC[c]);

/** The attributes of a marker after its id: `{ guide, embed }`. */
export function markerAttributes(rest) {
  const out = {};
  for (const m of String(rest ?? '').matchAll(/([a-z]+)="([^"]*)"/g)) out[m[1]] = m[2];
  return out;
}

/** The fence state of Markdown lines: whether each line lies inside a fenced code block. */
function fencedLines(lines) {
  let fence = null;
  return lines.map((line) => {
    const m = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      const close = /^\s{0,3}(`{3,}|~{3,})\s*$/.exec(line);
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length) fence = null;
      return true;
    }
    if (m) { fence = m[1]; return true; }
    return false;
  });
}

/**
 * The sections of a report or template Markdown, by its markers (outside code fences): `{
 * preamble, sections: [{ id, attrs, heading, line, markdown }] }`. A section starts at the
 * `## ` heading right above its marker (or at the marker when there is none) and runs to the
 * start of the next section; its `markdown` has the marker line taken out. `line` is the
 * 1-based line of the marker.
 */
export function splitSections(markdown) {
  const lines = String(markdown).replace(/\r\n?/g, '\n').split('\n');
  const fenced = fencedLines(lines);
  const marks = [];
  lines.forEach((line, i) => {
    if (fenced[i]) return;
    const m = MARKER_RE.exec(line);
    if (m) marks.push({ i, id: m[1], attrs: markerAttributes(m[2]) });
  });
  const starts = marks.map((mark, k) => {
    const floor = k === 0 ? 0 : marks[k - 1].i + 1;
    for (let j = mark.i - 1; j >= floor; j--) {
      if (lines[j].trim() === '') continue;
      return /^##\s+/.test(lines[j]) && !fenced[j] ? j : mark.i;
    }
    return mark.i;
  });
  const sections = marks.map((mark, k) => {
    const end = k + 1 < marks.length ? starts[k + 1] : lines.length;
    const body = lines.slice(starts[k], end).filter((_, n) => starts[k] + n !== mark.i);
    const headingLine = starts[k] < mark.i ? lines[starts[k]] : '';
    return { id: mark.id, attrs: mark.attrs, heading: headingLine.replace(/^##\s+/, '').trim(), line: mark.i + 1, markdown: body.join('\n') };
  });
  return { preamble: lines.slice(0, marks.length ? starts[0] : lines.length).join('\n'), sections };
}

/** Markdown with every section marker line (outside code fences) taken out. */
export function stripMarkers(markdown) {
  const lines = String(markdown).replace(/\r\n?/g, '\n').split('\n');
  const fenced = fencedLines(lines);
  return lines.filter((line, i) => fenced[i] || !MARKER_RE.test(line)).join('\n');
}

/** The id of a heading: `h-` and its text in lower case, letters and digits joined by `-`. */
function slugOf(text) {
  const s = String(text).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}\p{M}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return `h-${s || 'section'}`;
}

/** Whether a link target may be kept: `http:`, `https:` or an in-page `#`. */
export function safeHref(href) {
  const h = String(href ?? '').trim();
  // eslint-disable-next-line no-control-regex
  if (h === '' || /[\u0000-\u001f\u007f\s]/.test(h)) return false;
  if (h.startsWith('#')) return true;
  return /^https?:\/\/[^/]/i.test(h);
}

const plainOf = (html) => html.replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

/**
 * Render Markdown to HTML under the rules above.
 * @param {string} markdown
 * @param {{ assets?: Map<string, { bytes: Buffer, mime: string }>, ids?: Set<string> }} [options]
 *   `assets`: the files of the report's `assets/` listing, by name; `ids`: heading ids already
 *   taken in the document (shared across sections so each id is unique), filled in place
 * @returns {{ html: string, headings: Array<{ depth: number, text: string, id: string }> }}
 */
export function renderMarkdown(markdown, { assets = new Map(), ids = new Set() } = {}) {
  const headings = [];
  const marked = new Marked({ gfm: true, breaks: false, async: false });
  marked.use({
    renderer: {
      html({ text, block }) {
        const shown = escapeHtml(block ? text.replace(/\n+$/, '') : text);
        return block ? `<p class="zukai-raw">${shown}</p>\n` : shown;
      },
      text(token) {
        return token.tokens ? this.parser.parseInline(token.tokens) : escapeText(token.text);
      },
      link({ href, title, tokens }) {
        const inner = this.parser.parseInline(tokens);
        if (!safeHref(href)) return `<span class="zukai-link">${inner}</span>`;
        return `<a href="${escapeHtml(href.trim())}"${title ? ` title="${escapeHtml(title)}"` : ''}>${inner}</a>`;
      },
      image({ href, title, text }) {
        const alt = escapeHtml(text ?? '');
        const src = imageSource(href, assets);
        if (!src) return `<span class="zukai-missing-image">[${alt || 'image'}]</span>`;
        return `<img src="${src}" alt="${alt}"${title ? ` title="${escapeHtml(title)}"` : ''}>`;
      },
      heading({ tokens, depth }) {
        const inner = this.parser.parseInline(tokens);
        const text = plainOf(inner).trim();
        let id = slugOf(text);
        for (let n = 2; ids.has(id); n++) id = `${slugOf(text)}-${n}`;
        ids.add(id);
        headings.push({ depth, text, id });
        return `<h${depth} id="${id}">${inner}</h${depth}>\n`;
      },
    },
  });
  const html = marked.parse(stripMarkers(markdown));
  return { html, headings };
}

/** The `src` of an image: a `data:` picture URI, or a file of the report's assets inlined; else undefined. */
function imageSource(href, assets) {
  const h = String(href ?? '').trim();
  if (h.startsWith('data:')) return DATA_IMAGE.test(h) && h.length <= MAX_ASSET_BYTES * 1.4 ? h.replace(/\s+/g, '') : undefined;
  const m = /^(?:\.\/)?assets\/([^/\\]+)$/.exec(h);
  if (!m) return undefined;
  let name;
  try { name = decodeURIComponent(m[1]); } catch { return undefined; }
  const asset = assets.get(name);
  return asset ? `data:${asset.mime};base64,${asset.bytes.toString('base64')}` : undefined;
}

/** The picture type of an asset file name, or undefined when it is no picture a report inlines. */
export const assetMime = (name) => IMAGE_MIME[String(name).split('.').pop().toLowerCase()];
