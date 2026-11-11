import { emit, bundle } from './pipeline.mjs';
import { inflatePages, parseAttrs } from './relabel.mjs';

/**
 * Tell whether a delivered .drawio file still is what the CLI emits from its IRs, or carries
 * edits made by hand in draw.io (a moved or resized shape, a reworded label, a copied shape,
 * a deleted connection). Emitting is deterministic, so the file is re-emitted in memory from
 * the same IRs and compared cell by cell on every page.
 *
 * A single-diagram file is re-emitted with its page id as the diagram id. A bundle (every
 * page carries a `<page id>:title` cell) is rebuilt with the bundle options recovered from the
 * file itself: the canvas members from the order of the title cells on the canvas page, the
 * gap from the distance between the first two of them, and the title from the canvas page's
 * name. Those options come back as `bundle`, so a revise can rebuild the same file.
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
    for (const u of body.matchAll(/<UserObject\b([^>]*)>([\s\S]*?)<\/UserObject>/g)) {
      const outer = parseAttrs(u[1]);
      const inner = /<mxCell\b([^>]*?)(\/?)>([\s\S]*?)(?:<\/mxCell>|$)/.exec(u[2]);
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
 *   bundle?: { title?: string, canvas?: string[], gap?: number } }>}
 */
export async function driftDrawio(xml, entries) {
  if (!/<mxfile\b/.test(xml)) return { ok: false, errors: [{ path: '/', message: 'not a .drawio file (no <mxfile> root)' }] };
  const actual = parseDrawioPages(xml);
  const ids = entries.map((e) => e.id);
  const bundled = actual.some((p) => p.cells.has(`${p.id}:title`)) || actual.length > 1;
  let expectedXml;
  let options;
  if (!bundled) {
    const page = actual[0];
    const entry = entries.length === 1 ? entries[0] : entries.find((e) => e.id === page?.id);
    if (!page || !entry) return { ok: false, errors: [{ path: '/', message: `no IR given for the diagram on this page ("${page?.id ?? ''}")`, hint: 'pass the IR the file was emitted from' }] };
    const result = await emit(entry.ir, 'drawio', { diagramId: page.id });
    if (!result.ok) return { ok: false, errors: result.errors };
    expectedXml = result.output;
  } else {
    options = recoverBundleOptions(actual, ids);
    let result = await bundle(entries, 'drawio', { title: options.title, canvas: options.canvas, gap: options.canvas ? 120 : undefined });
    if (!result.ok) return { ok: false, errors: result.errors };
    if (options.canvas && options.canvas.length > 1) {
      // The gap is the only option the file does not state: measure it against a build at the default.
      const canvasId = canvasPageId(actual, ids);
      const xs = (pages) => {
        const page = pages.find((p) => p.id === canvasId);
        return options.canvas.slice(0, 2).map((id) => Number(page?.cells.get(`${id}:title`)?.position.split(',')[0] ?? NaN));
      };
      const [a0, a1] = xs(actual);
      const [e0, e1] = xs(parseDrawioPages(result.output));
      const gap = 120 + (a1 - a0) - (e1 - e0);
      if (Number.isFinite(gap) && gap >= 0 && gap !== 120) {
        result = await bundle(entries, 'drawio', { title: options.title, canvas: options.canvas, gap });
        if (!result.ok) return { ok: false, errors: result.errors };
      }
      options.gap = Number.isFinite(gap) && gap >= 0 ? gap : 120;
    }
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

function canvasPageId(pages, ids) {
  return pages.find((p) => !ids.includes(p.id) && [...p.cells.keys()].some((k) => k.endsWith(':title')))?.id;
}

/** Title, canvas members and their order, from the canvas page of a bundle (none without one). */
function recoverBundleOptions(pages, ids) {
  const canvasId = canvasPageId(pages, ids);
  if (canvasId === undefined) return {};
  const page = pages.find((p) => p.id === canvasId);
  const titles = [...page.cells.entries()]
    .filter(([k]) => k.endsWith(':title') && ids.includes(k.slice(0, -6)))
    .map(([k, c]) => ({ id: k.slice(0, -6), x: Number(c.position.split(',')[0]) }))
    .sort((a, b) => a.x - b.x)
    .map((t) => t.id);
  const names = new Set(pages.filter((p) => p.id !== canvasId).map((p) => p.name));
  let title = page.name;
  if (title.endsWith(' (canvas)') && names.has(title.slice(0, -9))) title = title.slice(0, -9);
  return { ...(title === 'Canvas' ? {} : { title }), canvas: titles };
}
