import { emit, bundle } from './pipeline.mjs';
import { inflatePages, parseAttrs, readLabelBasis } from './relabel.mjs';
import { pageIdOf, slugify as legacySlug } from './emit-drawio.mjs';

/**
 * Tell whether a delivered .drawio file still is what the CLI emits from its IRs, or carries
 * edits made by hand in draw.io (a moved or resized shape, a reworded label, a copied shape,
 * a deleted connection). Emitting is deterministic, so the file is re-emitted in memory from
 * the same IRs and compared cell by cell on every page.
 *
 * Page ids and cell-id prefixes are derived from the diagram id (`pageIdOf`; the 40-character
 * `slugify` in files of 2.0.3 and older), so every comparison goes through that id. A single-diagram file is re-emitted with its page id as
 * the diagram id; a page the user added to it is reported as unmatched. A bundle (its pages
 * carry a `<page id>:title` cell) is rebuilt with the bundle options recovered from the file
 * itself: the canvas members from the order of the title cells on the canvas page, the gap
 * that leaves the most of those titles in place (so one title moved by hand does not shift
 * the others), and the title from the canvas page's name. Those options come back as
 * `bundle` (`canvas: "all"` when the canvas shows every diagram in file order), so a revise
 * can rebuild the same file.
 *
 * A file that `relabel` rewrote in place keeps the boxes it had for the old labels, which a
 * fresh emit of the reworded IR would size and place differently. `relabel` records the
 * label each cell was laid out for, so such a page is compared twice: its texts and styles
 * with a fresh emit of the IR as it is, its positions and sizes with an emit of the IR that
 * carries the recorded labels again. What is left is what the user did by hand. The page
 * says `relabelled: <cells>`; a recorded label that cannot be put back into the IR (a label
 * the emitter composes from several fields) is counted under `unresolved`, and the positions
 * of that page are then compared with the fresh emit as before.
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
      covered.push([u.index, u.index + u[0].length]);
      // The root cell carries page properties (and the labels a relabel recorded), no shape.
      if (outer.id === undefined || outer.id === '0' || outer.id === '1') continue;
      cells.set(outer.id, cellOf({ ...innerAttrs, ...outer, value: outer.label ?? '' }, inner && inner[2] !== '/' ? inner[3] : ''));
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
    pages.push({ id: attrs.id ?? '', name: attrs.name ?? '', cells, basis: readLabelBasis(body) });
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

/**
 * Differences between two pages' cells, ordered by cell id. `layout` is the page whose
 * positions and sizes the file is expected to have: the fresh emit, or for a relabelled page
 * the emit with the labels it was laid out for.
 */
function comparePage(actual, expected, layout = expected) {
  const changes = [];
  const ids = [...new Set([...actual.cells.keys(), ...expected.cells.keys()])].sort();
  for (const id of ids) {
    const a = actual.cells.get(id);
    const e = expected.cells.get(id);
    if (!e) { changes.push({ cell: id, change: 'added', detail: a.value ? `"${plain(a.value)}"` : undefined }); continue; }
    if (!a) { changes.push({ cell: id, change: 'removed', detail: e.value ? `"${plain(e.value)}"` : undefined }); continue; }
    const g = layout.cells.get(id) ?? e;
    if (a.value !== e.value) changes.push({ cell: id, change: 'relabelled', detail: `"${plain(e.value)}" -> "${plain(a.value)}"` });
    if (a.position !== g.position || a.points !== g.points) changes.push({ cell: id, change: 'moved' });
    if (a.size !== g.size) changes.push({ cell: id, change: 'resized', detail: `${g.size} -> ${a.size}` });
    if (a.parent !== e.parent || a.source !== e.source || a.target !== e.target) changes.push({ cell: id, change: 'reconnected' });
    // A style holds what the layout decided too (the anchors of a line, the spacing of a
    // diamond), so it may be that of the layout the file was drawn with.
    // The wrap width of a name below a figure follows the name when `relabel` rewords it.
    const styleOf = (c) => c.style.replace(/labelWidth=\d+;/, '');
    if ((styleOf(a) !== styleOf(e) && styleOf(a) !== styleOf(g)) || a.link !== e.link) changes.push({ cell: id, change: 'restyled' });
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
  // A file delivered by 2.0.3 or older has page ids cut at 40 characters. It is compared
  // with a rebuild that cuts them the same way, so the old ids are not reported as edits.
  const legacySlugs = new Set(entries.map((e) => legacySlug(e.id)));
  const legacyIds = legacySlugs.size === entries.length
    && actual.some((p) => legacySlugs.has(p.id) && !entries.some((e) => pageIdOf(e.id) === p.id));
  const slugify = legacyIds ? legacySlug : pageIdOf;
  // Page id (the slug of a diagram id) -> diagram id.
  const bySlug = new Map(entries.map((e) => [slugify(e.id), e.id]));
  const bundled = actual.some((p) => p.cells.has(`${p.id}:title`));
  // The labels the file was laid out for, where a relabel changed them: the IRs with those
  // labels back give the positions the file is expected to have.
  const basis = Object.assign({}, ...actual.map((p) => p.basis));
  const current = new Map(actual.flatMap((p) => [...p.cells].map(([id, c]) => [id, mainText(c.value)])));
  let unresolved = 0;
  const laidOut = entries.map((e) => {
    // A single file is laid out under its own page id, whatever its IR file is called.
    const prefix = !bundled && entries.length === 1 ? `${actual[0]?.id ?? slugify(e.id)}:` : `${slugify(e.id)}:`;
    const own = Object.entries(basis).filter(([cell]) => cell.startsWith(prefix));
    if (own.length === 0) return e;
    const ir = structuredClone(e.ir);
    for (const [cell, old] of own) {
      const local = cell.slice(prefix.length).replace(/:label$/, '');
      if (!putBack(ir, local, current.get(cell), old)) unresolved += 1;
    }
    return { ...e, ir };
  });
  const relabelled = Object.keys(basis).length;
  const useBasis = relabelled > 0 && unresolved === 0;

  let options;
  /** The file as the CLI would write it from these IRs, with the options the file itself shows. */
  const build = async (ents, known) => {
    if (!bundled) {
      const page = actual.find((p) => bySlug.has(p.id)) ?? (ents.length === 1 ? actual[0] : undefined);
      const entry = page && (ents.find((e) => slugify(e.id) === page.id) ?? (ents.length === 1 ? ents[0] : undefined));
      if (!page || !entry) return { errors: [{ path: '/', message: `no IR given for the diagram on this page ("${actual[0]?.id ?? ''}")`, hint: 'pass the IR the file was emitted from' }] };
      // Nothing is written here, so a value the user allowed at delivery does not stop the comparison.
      const result = await emit(entry.ir, 'drawio', { diagramId: page.id, allowSensitive: true });
      return result.ok ? { xml: result.output } : { errors: result.errors };
    }
    if (known) {
      const result = await bundle(ents, 'drawio', { title: known.title, canvas: known.canvas === 'all' ? ents.map((e) => e.id) : known.canvas, gap: known.gap, legacyIds, allowSensitive: true });
      return result.ok ? { xml: result.output } : { errors: result.errors };
    }
    options = recoverBundleOptions(actual, bySlug);
    const canvas = options.canvas;
    let result = await bundle(ents, 'drawio', { title: options.title, canvas, gap: canvas ? 120 : undefined, legacyIds, allowSensitive: true });
    if (!result.ok) return { errors: result.errors };
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
        result = await bundle(ents, 'drawio', { title: options.title, canvas, gap, legacyIds, allowSensitive: true });
        if (!result.ok) return { errors: result.errors };
      }
      options.gap = gap;
    }
    return { xml: result.output };
  };

  // The options are read against the layout the file was built with; the fresh emit then
  // uses the same ones.
  const layoutBuild = await build(useBasis ? laidOut : entries);
  if (layoutBuild.errors) return { ok: false, errors: layoutBuild.errors };
  const freshBuild = useBasis ? await build(entries, options ?? {}) : layoutBuild;
  if (freshBuild.errors) return { ok: false, errors: freshBuild.errors };
  if (bundled && options.canvas && options.canvas.length === entries.length && options.canvas.every((id, i) => id === entries[i].id)) options.canvas = 'all';

  const expected = parseDrawioPages(freshBuild.xml);
  const layout = parseDrawioPages(layoutBuild.xml);
  const pages = [];
  for (const page of actual) {
    const match = expected.find((p) => p.id === page.id);
    if (!match) { pages.push({ diagram: page.id, unmatched: true, changes: [] }); continue; }
    const count = Object.keys(page.basis).length;
    pages.push({ diagram: page.id, ...(count > 0 ? { relabelled: count } : {}), changes: comparePage(page, match, layout.find((p) => p.id === page.id)) });
  }
  for (const page of expected) {
    if (!actual.some((p) => p.id === page.id)) pages.push({ diagram: page.id, missing: true, changes: [] });
  }
  const drifted = pages.some((p) => p.unmatched || p.missing || p.changes.length > 0);
  return { ok: true, drifted, bundled, ...(legacyIds ? { legacyIds: true } : {}), ...(relabelled > 0 ? { relabelled, ...(unresolved > 0 ? { unresolved } : {}) } : {}), pages, ...(bundled ? { bundle: options } : {}) };
}

/** The text of a cell as the author wrote it: without the bold wrapper, a stereotype line and a `↳` line. */
function mainText(value) {
  const lines = String(value ?? '').replace(/^<b>|<\/b>$/g, '').split(/<br\s*\/?>/).map((l) => plain(l));
  if (lines.length > 1 && /^«[^»]+»$/.test(lines[0])) lines.shift();
  if (lines.length > 1 && lines.at(-1).startsWith('↳ ')) lines.pop();
  return lines.join('\n').trim();
}

/** The fields of an element that an emitter writes as its label. */
const LABEL_FIELDS = ['label', 'name', 'guard', 'event', 'title'];

/**
 * Put the label a cell was laid out for back into the IR: the element with that id gets
 * `old` in the field that now holds `now` (the text the relabelled cell shows). An IR that
 * was never reworded (a language variant keeps its IR) already holds `old`. Returns false
 * when neither is the case.
 */
function putBack(ir, id, now, old) {
  if (id === 'title') {
    if (ir.title === now) ir.title = old;
    return ir.title === old;
  }
  for (const value of Object.values(ir)) {
    if (!Array.isArray(value)) continue;
    const el = value.find((v) => v && typeof v === 'object' && v.id === id);
    if (!el) continue;
    if (LABEL_FIELDS.some((f) => el[f] === old)) return true;
    const field = LABEL_FIELDS.find((f) => typeof el[f] === 'string' && el[f] === now);
    if (field === undefined) return false;
    el[field] = old;
    return true;
  }
  return false;
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

/**
 * The same question for the combined Markdown file of a Mermaid run. Text has no layout, so
 * the file is rebuilt and compared block by block; what comes back is which diagram's text
 * was edited, and the title the file was built with, so a revise can record and reuse it
 * like the options of a draw.io bundle.
 * @param {string} markdown the delivered `<run-slug>.md`
 * @param {Array<{ id: string, ir: object }>} entries
 */
export async function driftMarkdown(markdown, entries) {
  const text = markdown.replace(/\r\n/g, '\n');
  const heading = /^# (.+)$/m.exec(text);
  if (!heading || !/^```mermaid/m.test(text)) return { ok: false, errors: [{ path: '/', message: 'not a combined Mermaid file (no "# title" heading with fenced mermaid blocks)', hint: 'pass the <run-slug>.md that bundle wrote' }] };
  const title = heading[1].trim();
  // The file lists its diagrams in the order it was built in.
  const order = [...text.matchAll(/^Source: `source\/(.+?)\.ir\.json`$/gm)].map((m) => m[1]);
  const rank = (id) => (order.includes(id) ? order.indexOf(id) : order.length);
  const sorted = entries.map((e, i) => ({ e, i })).sort((a, b) => rank(a.e.id) - rank(b.e.id) || a.i - b.i).map((x) => x.e);
  const sections = (doc) => {
    const out = new Map();
    const parts = doc.split(/^## /m).slice(1);
    for (const part of parts) {
      const id = /^Source: `source\/(.+?)\.ir\.json`$/m.exec(part)?.[1];
      if (id !== undefined) out.set(id, part.trimEnd());
    }
    return out;
  };
  const actual = sections(text);
  let best;
  for (const mermaidStable of [false, true]) {
    const result = await bundle(sorted, 'mermaid', { title, mermaidStable, allowSensitive: true });
    if (!result.ok) return { ok: false, errors: result.errors };
    const expected = sections(result.output);
    const pages = [];
    for (const [id, body] of actual) {
      if (!expected.has(id)) pages.push({ diagram: id, unmatched: true, changes: [] });
      else pages.push({ diagram: id, changes: expected.get(id) === body ? [] : [{ cell: '(text)', change: 'edited' }] });
    }
    for (const id of expected.keys()) if (!actual.has(id)) pages.push({ diagram: id, missing: true, changes: [] });
    const count = pages.filter((p) => p.unmatched || p.missing || p.changes.length > 0).length;
    if (!best || count < best.count) best = { count, pages, mermaidStable };
  }
  return { ok: true, drifted: best.count > 0, bundled: true, target: 'mermaid', pages: best.pages, bundle: { title, ...(best.mermaidStable ? { mermaidStable: true } : {}) } };
}
