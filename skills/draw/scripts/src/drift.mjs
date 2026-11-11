import { emit, bundle } from './pipeline.mjs';
import { inflatePages, parseAttrs } from './relabel.mjs';
import { slugify } from './emit-drawio.mjs';

/**
 * Tell whether a delivered .drawio file still is what the CLI emits from its IRs, or carries
 * edits made by hand in draw.io (a moved or resized shape, a reworded label, a copied shape,
 * a deleted connection). Emitting is deterministic, so the file is re-emitted in memory from
 * the same IRs and compared cell by cell on every page.
 *
 * Page ids and cell-id prefixes are the slug of the diagram id (`slugify`), so every
 * comparison goes through that slug. A single-diagram file is re-emitted with its page id as
 * the diagram id; a page the user added to it is reported as unmatched. A bundle (its pages
 * carry a `<page id>:title` cell) is rebuilt with the bundle options recovered from the file
 * itself: the canvas members from the order of the title cells on the canvas page, the gap
 * that leaves the most of those titles in place (so one title moved by hand does not shift
 * the others), and the title from the canvas page's name. Those options come back as
 * `bundle` (`canvas: "all"` when the canvas shows every diagram in file order), so a revise
 * can rebuild the same file.
 *
 * Values are compared decoded, numbers numerically and a missing coordinate as 0, so a file
 * that draw.io saved again without edits (other attribute escaping, compressed pages) is not
 * reported. Page-level settings that draw.io rewrites on every save (`dx`, `dy`) are ignored.
 */

/** Cells of every page: id -> { value, style, parent, source, target, geometry, points }. */
export function parseDrawioPages(xml) {
  const text = inflatePages(xml);
  const pages = [];
  for (const m of text.matchAll(/<diagram\b([^>]*)>([\s\S]*?)<\/diagram>/g)) {
    const attrs = parseAttrs(m[1]);
    const body = m[2];
    const cells = new Map();
    const covered = [];
    // `UserObject` wraps a cell with a link (the emitters' page links); `object` is what
    // draw.io's Edit Data dialog wraps a cell in. Both carry the id and label outside.
    for (const u of body.matchAll(/<(UserObject|object)\b([^>]*)>([\s\S]*?)<\/\1>/g)) {
      const outer = parseAttrs(u[2]);
      const inner = /<mxCell\b([^>]*?)(\/?)>([\s\S]*?)(?:<\/mxCell>|$)/.exec(u[3]);
      const innerAttrs = inner ? parseAttrs(inner[1]) : {};
      cells.set(outer.id, cellOf({ ...innerAttrs, ...outer, value: outer.label ?? '' }, inner && inner[2] !== '/' ? inner[3] : ''));
      covered.push([u.index, u.index + u[0].length]);
    }
    for (const c of body.matchAll(/<mxCell\b([^>]*?)(\/?)>/g)) {
      if (covered.some(([a, b]) => c.index >= a && c.index < b)) continue;
      const a = parseAttrs(c[1]);
      if (a.id === undefined || a.id === '0' || a.id === '1') continue;
      let inside = '';
      if (c[2] !== '/') {
        const end = body.indexOf('</mxCell>', c.index);
        inside = end < 0 ? '' : body.slice(c.index + c[0].length, end);
      }
      cells.set(a.id, cellOf(a, inside));
    }
    pages.push({ id: attrs.id ?? '', name: attrs.name ?? '', cells });
  }
  return pages;
}

const num = (v) => (v === undefined || v === '' ? 0 : Number(v));

function cellOf(a, inside) {
  const g = /<mxGeometry\b([^>]*?)(\/?)>([\s\S]*?)(?:<\/mxGeometry>|$)/.exec(inside);
  const geo = g ? parseAttrs(g[1]) : null;
  const inner = g && g[2] !== '/' ? g[3] : '';
  const points = [...inner.matchAll(/<mxPoint\b([^>]*?)\/?>/g)].map((p) => {
    const pa = parseAttrs(p[1]);
    return `${pa.as ?? ''}:${num(pa.x)},${num(pa.y)}`;
  });
  return {
    link: a.link ?? '',
    value: a.value ?? '',
    style: a.style ?? '',
    parent: a.parent ?? '',
    source: a.source ?? '',
    target: a.target ?? '',
    position: geo ? `${num(geo.x)},${num(geo.y)}` : '',
    size: geo ? `${num(geo.width)},${num(geo.height)}` : '',
    points: points.join(' '),
  };
}

/** Differences between two pages' cells, ordered by cell id. */
function comparePage(actual, expected) {
  const changes = [];
  const ids = [...new Set([...actual.cells.keys(), ...expected.cells.keys()])].sort();
  for (const id of ids) {
    const a = actual.cells.get(id);
    const e = expected.cells.get(id);
    if (!e) { changes.push({ cell: id, change: 'added', detail: a.value ? `"${plain(a.value)}"` : undefined }); continue; }
    if (!a) { changes.push({ cell: id, change: 'removed', detail: e.value ? `"${plain(e.value)}"` : undefined }); continue; }
    if (a.value !== e.value) changes.push({ cell: id, change: 'relabelled', detail: `"${plain(e.value)}" -> "${plain(a.value)}"` });
    if (a.position !== e.position || a.points !== e.points) changes.push({ cell: id, change: 'moved' });
    if (a.size !== e.size) changes.push({ cell: id, change: 'resized', detail: `${e.size} -> ${a.size}` });
    if (a.parent !== e.parent || a.source !== e.source || a.target !== e.target) changes.push({ cell: id, change: 'reconnected' });
    if (a.style !== e.style || a.link !== e.link) changes.push({ cell: id, change: 'restyled' });
  }
  if (actual.name !== expected.name) changes.unshift({ cell: '(page)', change: 'renamed', detail: `"${expected.name}" -> "${actual.name}"` });
  return changes.map((c) => (c.detail === undefined ? { cell: c.cell, change: c.change } : c));
}

const plain = (html) => html.replace(/<br\s*\/?>/g, ' / ').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ');

/**
 * @param {string} xml the delivered .drawio file
 * @param {Array<{ id: string, ir: object }>} entries its IRs, with the diagram id of each (file name without `.ir.json`)
 * @returns {Promise<{ ok: boolean, errors?: object[], drifted?: boolean, bundled?: boolean,
 *   pages?: Array<{ diagram: string, changes: object[], unmatched?: boolean, missing?: boolean }>,
 *   bundle?: { title?: string, canvas?: 'all' | string[], gap?: number } }>}
 */
export async function driftDrawio(xml, entries) {
  if (!/<mxfile\b/.test(xml)) return { ok: false, errors: [{ path: '/', message: 'not a .drawio file (no <mxfile> root)' }] };
  const actual = parseDrawioPages(xml);
  // Page id (the slug of a diagram id) -> diagram id.
  const bySlug = new Map(entries.map((e) => [slugify(e.id), e.id]));
  const bundled = actual.some((p) => p.cells.has(`${p.id}:title`));
  let expectedXml;
  let options;
  if (!bundled) {
    const page = actual.find((p) => bySlug.has(p.id)) ?? (entries.length === 1 ? actual[0] : undefined);
    const entry = page && (entries.find((e) => slugify(e.id) === page.id) ?? (entries.length === 1 ? entries[0] : undefined));
    if (!page || !entry) return { ok: false, errors: [{ path: '/', message: `no IR given for the diagram on this page ("${actual[0]?.id ?? ''}")`, hint: 'pass the IR the file was emitted from' }] };
    const result = await emit(entry.ir, 'drawio', { diagramId: page.id });
    if (!result.ok) return { ok: false, errors: result.errors };
    expectedXml = result.output;
  } else {
    options = recoverBundleOptions(actual, bySlug);
    const canvas = options.canvas;
    let result = await bundle(entries, 'drawio', { title: options.title, canvas, gap: canvas ? 120 : undefined });
    if (!result.ok) return { ok: false, errors: result.errors };
    if (canvas && canvas.length > 1) {
      // The gap is the only option the file does not state. Every pair of titles proposes
      // one (title k sits k gaps right of title 0, beyond the widths a build at the default
      // already has); keep the proposal that leaves the most titles where the file has them,
      // so a single title moved by hand neither shifts the others nor hides itself. On a tie
      // the pair furthest apart wins: its measurement is the least affected by one move.
      const canvasId = canvasPageId(actual, bySlug);
      const xs = (pages) => {
        const page = pages.find((p) => p.id === canvasId);
        return canvas.map((id) => Number(page?.cells.get(`${slugify(id)}:title`)?.position.split(',')[0] ?? NaN));
      };
      const a = xs(actual);
      const e = xs(parseDrawioPages(result.output));
      const round = (v) => Math.round(v * 100) / 100;
      let gap = 120;
      let bestScore = -1;
      let bestSpan = 0;
      for (let i = 0; i < a.length; i++) {
        for (let j = i + 1; j < a.length; j++) {
          const g = round(120 + ((a[j] - a[i]) - (e[j] - e[i])) / (j - i));
          if (!Number.isFinite(g) || g < 0) continue;
          const score = a.filter((x, k) => Math.abs(x - (e[k] + (a[0] - e[0]) + k * (g - 120))) < 0.01).length;
          if (score > bestScore || (score === bestScore && j - i > bestSpan)) { gap = g; bestScore = score; bestSpan = j - i; }
        }
      }
      if (gap !== 120) {
        result = await bundle(entries, 'drawio', { title: options.title, canvas, gap });
        if (!result.ok) return { ok: false, errors: result.errors };
      }
      options.gap = gap;
    }
    if (canvas && canvas.length === entries.length && canvas.every((id, i) => id === entries[i].id)) options.canvas = 'all';
    expectedXml = result.output;
  }
  const expected = parseDrawioPages(expectedXml);
  const pages = [];
  for (const page of actual) {
    const match = expected.find((p) => p.id === page.id);
    if (!match) { pages.push({ diagram: page.id, unmatched: true, changes: [] }); continue; }
    pages.push({ diagram: page.id, changes: comparePage(page, match) });
  }
  for (const page of expected) {
    if (!actual.some((p) => p.id === page.id)) pages.push({ diagram: page.id, missing: true, changes: [] });
  }
  const drifted = pages.some((p) => p.unmatched || p.missing || p.changes.length > 0);
  return { ok: true, drifted, bundled, pages, ...(bundled ? { bundle: options } : {}) };
}

/** The canvas page: the page that is no diagram's own and holds diagram title cells. */
function canvasPageId(pages, bySlug) {
  return pages.find((p) => !bySlug.has(p.id) && [...p.cells.keys()].some((k) => k.endsWith(':title') && bySlug.has(k.slice(0, -6))))?.id;
}

/** Title, canvas members and their order, from the canvas page of a bundle (none without one). */
function recoverBundleOptions(pages, bySlug) {
  const canvasId = canvasPageId(pages, bySlug);
  if (canvasId === undefined) return {};
  const page = pages.find((p) => p.id === canvasId);
  const titles = [...page.cells.entries()]
    .filter(([k]) => k.endsWith(':title') && bySlug.has(k.slice(0, -6)))
    .map(([k, c]) => ({ id: bySlug.get(k.slice(0, -6)), x: Number(c.position.split(',')[0]) }))
    .sort((a, b) => a.x - b.x)
    .map((t) => t.id);
  const names = new Set(pages.filter((p) => p.id !== canvasId).map((p) => p.name));
  let title = page.name;
  if (title.endsWith(' (canvas)') && names.has(title.slice(0, -9))) title = title.slice(0, -9);
  return { ...(title === 'Canvas' ? {} : { title }), canvas: titles };
}
