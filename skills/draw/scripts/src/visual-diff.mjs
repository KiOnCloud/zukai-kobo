import { diffIr, diffRun, collections, labelOf } from './ir-diff.mjs';
import { validateIr } from './validate-ir.mjs';
import { bundle } from './pipeline.mjs';
import { scanSecrets, DEFINITE_KINDS } from './scan-secrets.mjs';
import { pageIdOf } from './emit-drawio.mjs';
import { vertex, htmlLabel, xmlAttr, cellsBounds } from './drawio-xml.mjs';
import { parseAttrs } from './relabel.mjs';
import { wrapText } from './layout-graph.mjs';
import { roomFor } from './text-metrics.mjs';

/**
 * The picture of a diff: a draw.io file of the new version of a run (or of one diagram) in
 * which what was added is green, what changed or moved is amber, and what was removed is
 * drawn again in red with a dashed outline, with a legend under every diagram.
 *
 * A removed element is not in the new model, so each page is drawn from a merged model: the
 * new IR with the removed elements put back where they were (a message at its old place in
 * the order, a node with its old edges, a container with its members, a member row of a
 * class or an entity at its old row). The merged model is a valid IR and goes through the
 * same pipeline as every emit (checks, secret scan, the draw.io emitter); the cells are then
 * restyled by their ids, which the emitter derives from the IR ids. Nothing of the layout
 * code is repeated here.
 *
 * The merge walks the collections `diffIr` walks (the top-level arrays of elements with an
 * id) and the lists of ids inside them, whatever they are called, so a kind needs no code of
 * its own here. Two things are named: the member arrays that the emitters draw as the rows
 * of a table (`MEMBER_KEYS`), and the sections of a sequence block (`SECTION_CELLS`).
 *
 * The file is a review aid, not a deliverable. Every page carries a legend whose cells have
 * ids no IR id can have (`<page id>:$diff:...`), which is how `isVisualDiff` tells such a file
 * from the output of a run.
 */

/** What each state of an element looks like. Dark enough to read on a lane tint or inside an AWS frame. */
export const DIFF_COLOURS = {
  added: { stroke: '#1B7F3B', fill: '#D9F2DF', font: '#0B4F22' },
  changed: { stroke: '#B26A00', fill: '#FFE9B8', font: '#6B3F00' },
  removed: { stroke: '#C62828', fill: '#FBDCDC', font: '#8E1B1B' },
};

/** Nested arrays the emitters draw as the rows of a table, in the order of the rows; members are told apart by `name`. */
const MEMBER_KEYS = ['attributes', 'methods'];
/** Nested arrays that are sections of their element, and the cells the emitter draws for section `i` (0-based). */
const SECTION_CELLS = { branches: (i) => [`sep-${i + 1}`, `sep-label-${i + 1}`] };
/** Cells of an element that stand for one of its parts: in a changed element they take the state of the part, not of the element. */
const PART_CELL = /^(row|sep|sep-label)-\d+$/;

const MARKER = ':$diff:';
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const strings = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');
const objects = (v) => Array.isArray(v) && v.length > 0 && v.every((x) => x && typeof x === 'object' && !Array.isArray(x));

/** Whether a .drawio file is the picture of a diff (it carries the legend of one). */
export const isVisualDiff = (xml) => xml.includes(`${MARKER}legend"`);

/**
 * `now` with the keys of `gone` put back where they stood in `was`: each right after the key
 * that preceded it there, or first when nothing preceded it.
 */
function putBackInOrder(was, now, gone) {
  const out = [...now];
  was.forEach((key, i) => {
    if (!gone.has(key)) return;
    out.splice(i === 0 ? 0 : out.indexOf(was[i - 1]) + 1, 0, key);
  });
  return out;
}

/** Members of a table by a key that survives a reorder: the name, and which of that name it is. */
function memberKeys(list) {
  const seen = new Map();
  return list.map((m) => {
    const n = (seen.get(m.name) ?? 0) + 1;
    seen.set(m.name, n);
    return `${m.name}#${n}`;
  });
}

const memberText = (m) => Object.entries(m).map(([k, v]) => `${k} ${v}`).join(', ');

/**
 * The merged model of one diagram and what to mark in it.
 * @param {object} oldIr valid IR
 * @param {object} newIr valid IR of the same kind
 * @param {{ keepClaimed?: boolean }} [options] with `keepClaimed` false, a removed container
 *   does not take back a member that another container of the new version holds
 * @returns {{ ir: object, status: Map<string, string>, tips: Map<string, string>,
 *   parts: Map<string, Map<string, { status: string, tip: string }>>, notDrawn: Array<object> }}
 */
function mergeIr(oldIr, newIr, { keepClaimed = true } = {}) {
  const before = collections(oldIr);
  const after = collections(newIr);
  const notDrawn = [];
  const parts = new Map();
  const rowNotes = new Map(); // element id -> the old value of each member that changed
  const part = (id, suffix, status, tip) => {
    if (!parts.has(id)) parts.set(id, new Map());
    parts.get(id).set(suffix, { status, tip });
  };

  // Ids another element of the new version lists under the same key of the same collection.
  const claimed = new Map();
  const claim = (name, value) => {
    if (Array.isArray(value)) { value.forEach((v) => claim(name, v)); return; }
    if (!value || typeof value !== 'object') return;
    for (const [k, v] of Object.entries(value)) {
      if (strings(v)) v.forEach((id) => claimed.set(`${name}/${k}/${id}`, true));
      else claim(name, v);
    }
  };
  for (const [name, map] of after) claim(name, [...map.values()]);

  // A removed element as it goes back: whole, or without the members that now belong elsewhere.
  const stripped = (name, value) => {
    const out = { ...value };
    for (const [k, v] of Object.entries(value)) {
      if (strings(v) && v.length > 0) {
        out[k] = v.filter((id) => !claimed.has(`${name}/${k}/${id}`));
        if (out[k].length === 0) return null;
      } else if (objects(v)) {
        out[k] = v.map((item) => stripped(name, item)).filter(Boolean);
      }
    }
    return out;
  };
  const back = new Map(); // id -> the element put back
  for (const [name, map] of before) {
    for (const [id, el] of map) {
      if (after.get(name)?.has(id)) continue;
      const put = keepClaimed ? el : stripped(name, el);
      if (put) back.set(id, put);
      else notDrawn.push({ collection: name, id, label: labelOf(el), reason: 'every member it had belongs to another element of the new version' });
    }
  }

  // An element both versions have: its lists of ids take the removed ids back, its member
  // rows and sections take the removed ones back, and each part is marked.
  const restore = (id, x, y) => {
    const out = { ...y };
    for (const k of new Set([...Object.keys(y), ...Object.keys(x)])) {
      const o = x[k];
      const v = y[k];
      if (MEMBER_KEYS.includes(k) && (objects(o) || objects(v))) {
        const was = objects(o) ? o : [];
        const now = objects(v) ? v : [];
        const wasKeys = memberKeys(was);
        const nowKeys = memberKeys(now);
        const order = putBackInOrder(wasKeys, nowKeys, new Set(wasKeys.filter((key) => !nowKeys.includes(key))));
        out[k] = order.map((key) => (nowKeys.includes(key) ? now[nowKeys.indexOf(key)] : was[wasKeys.indexOf(key)]));
        order.forEach((key, i) => {
          const a = was[wasKeys.indexOf(key)];
          const b = now[nowKeys.indexOf(key)];
          if (!a) part(id, `${k}/${i}`, 'added', 'added');
          else if (!b) part(id, `${k}/${i}`, 'removed', 'removed: not in the new version');
          else if (!same(a, b)) {
            part(id, `${k}/${i}`, 'changed', `was: ${memberText(a)}`);
            if (!rowNotes.has(id)) rowNotes.set(id, []);
            rowNotes.get(id).push(`${b.name} was: ${memberText(a)}`);
          }
        });
      } else if (strings(o) && (v === undefined || strings(v)) && o.length > 0) {
        const now = v ?? [];
        const merged = putBackInOrder(o, now, new Set(o.filter((ref) => back.has(ref) && !now.includes(ref))));
        if (merged.length > 0 || v !== undefined) out[k] = merged;
      } else if ((objects(o) || objects(v)) && (o === undefined || Array.isArray(o)) && (v === undefined || Array.isArray(v))) {
        const now = v ?? [];
        const was = o ?? [];
        const merged = now.map((item, i) => (was[i] && item && typeof item === 'object' ? restore(null, was[i], item) : item));
        const cells = id !== null ? SECTION_CELLS[k] : undefined;
        if (cells) now.slice(was.length).forEach((_, i) => cells(was.length + i).forEach((suffix) => part(id, suffix, 'added', 'added')));
        // A section the new version dropped comes back when what it held comes back.
        for (const item of was.slice(now.length)) {
          const lists = Object.values(item).filter((x) => strings(x) && x.length > 0);
          if (lists.length === 0 || !lists.every((list) => list.every((ref) => back.has(ref)))) continue;
          if (cells) cells(merged.length).forEach((suffix) => part(id, suffix, 'removed', 'removed: not in the new version'));
          merged.push(item);
        }
        if (merged.length > 0 || v !== undefined) out[k] = merged;
      }
    }
    return out;
  };

  const ir = { ...newIr };
  for (const name of new Set([...after.keys(), ...before.keys()])) {
    const a = before.get(name) ?? new Map();
    const b = after.get(name) ?? new Map();
    const order = putBackInOrder([...a.keys()], [...b.keys()], new Set([...a.keys()].filter((id) => !b.has(id) && back.has(id))));
    ir[name] = order.map((id) => (b.has(id) ? (a.has(id) ? restore(id, a.get(id), b.get(id)) : b.get(id)) : back.get(id)));
  }

  // Row cells are numbered over the member arrays in their order, with one separator row
  // between two arrays that both have members.
  for (const [id, marks] of parts) {
    const el = [...collections(ir).values()].map((m) => m.get(id)).find(Boolean);
    let offset = 0;
    for (const k of MEMBER_KEYS) {
      const n = Array.isArray(el?.[k]) ? el[k].length : 0;
      if (n === 0) continue;
      for (let i = 0; i < n; i++) {
        const mark = marks.get(`${k}/${i}`);
        if (mark) { marks.delete(`${k}/${i}`); marks.set(`row-${offset + i}`, mark); }
      }
      offset += n + 1;
    }
  }

  const d = diffIr(oldIr, newIr);
  const status = new Map();
  const tips = new Map();
  const notes = [];
  const show = (v) => (v === undefined ? 'not set' : typeof v === 'string' ? `"${v}"` : String(v));
  const scalar = (v) => v === undefined || typeof v !== 'object';
  const name = (item, id) => (labelOf(item) === '' ? id : `"${labelOf(item)}"`);
  // The old value of a field that is a list: its members by name, or how many entries it had.
  const elementOf = (id) => [...before.values()].map((m) => m.get(id)).find(Boolean);
  const oldList = (f, o, v) => {
    if (strings(o) && (v === undefined || strings(v))) return `${f} was ${o.length === 0 ? 'empty' : o.map((id) => (elementOf(id) ? name(elementOf(id), id) : `"${id}"`)).join(', ')}`;
    // The rows of a table are listed one by one after this line.
    if (MEMBER_KEYS.includes(f)) return `${f} changed`;
    if (Array.isArray(o) && Array.isArray(v) && o.length !== v.length) return `${f}: ${o.length} before, ${v.length} now`;
    if (o === undefined) return `${f} was not set`;
    return `${f} changed`;
  };
  for (const e of d.added) { status.set(e.id, 'added'); tips.set(e.id, 'added'); }
  for (const e of d.removed) {
    if (!back.has(e.id)) continue;
    status.set(e.id, 'removed');
    tips.set(e.id, 'removed: not in the new version');
  }
  for (const e of d.changed) {
    const x = before.get(e.collection).get(e.id);
    const y = after.get(e.collection).get(e.id);
    const what = e.fields.map((f) => (scalar(x[f]) && scalar(y[f]) ? `${f} was ${show(x[f])}` : oldList(f, x[f], y[f]))).join('; ');
    status.set(e.id, 'changed');
    tips.set(e.id, what);
    notes.push(`${name(y, e.id)}: ${what}`, ...(rowNotes.get(e.id) ?? []).map((n) => `${name(y, e.id)}: ${n}`));
  }
  for (const r of d.reordered) {
    for (const m of r.moved) {
      const y = after.get(r.collection).get(m.id);
      const where = m.after === null ? 'moved to the first place' : `moved, now after ${name(after.get(r.collection).get(m.after), m.after)}`;
      status.set(m.id, 'changed');
      tips.set(m.id, tips.has(m.id) ? `${tips.get(m.id)}; ${where}` : where);
      notes.push(`${name(y, m.id)}: ${where}`);
    }
  }
  const fields = d.fields.map((f) => (scalar(f.from) && scalar(f.to) ? `${f.field} was ${show(f.from)}` : `${f.field} changed`));
  return { ir, status, tips, parts, notDrawn, notes, fields, counts: { added: d.added.length, changed: new Set([...d.changed.map((e) => e.id), ...d.reordered.flatMap((r) => r.moved.map((m) => m.id))]).size, removed: d.removed.length } };
}

/**
 * The merged model that is a valid IR: with every removed element whole; else with removed
 * containers that leave the members other containers now hold; else the new model alone, and
 * every removed element is named as not drawn.
 */
function mergedModel(oldIr, newIr) {
  let reason;
  for (const keepClaimed of [true, false]) {
    const m = mergeIr(oldIr, newIr, { keepClaimed });
    const v = validateIr(m.ir);
    if (v.ok) return m;
    reason ??= `${v.errors[0].path}: ${v.errors[0].message}`;
  }
  const m = mergeIr(newIr, newIr);
  const full = mergeIr(oldIr, newIr);
  const { removed, added } = diffIr(oldIr, newIr);
  for (const id of removed.map((e) => e.id)) { full.status.delete(id); full.tips.delete(id); }
  // An id the new version uses again for another element is that element's.
  for (const e of added) { full.status.set(e.id, 'added'); full.tips.set(e.id, 'added'); }
  return { ...full, ir: m.ir, parts: new Map(), notDrawn: removed.map((e) => ({ ...e, reason: `the old and the new version do not make one valid model with it (${reason})` })) };
}

const setStyle = (style, pairs) => {
  let out = style;
  for (const [k, v] of Object.entries(pairs)) {
    out = out.replace(new RegExp(`(^|;)${k}=[^;]*;?`), '$1');
    if (v !== null) out = `${out}${out === '' || out.endsWith(';') ? '' : ';'}${k}=${v};`;
  }
  return out;
};

/** The style of a cell in the given state, by what the cell is. */
function restyle(style, status, { isEdge, isRow }) {
  const c = DIFF_COLOURS[status];
  const dash = status === 'removed' ? { dashed: 1, dashPattern: '6 4' } : {};
  if (isEdge) return setStyle(style, { strokeColor: c.stroke, strokeWidth: 2, fontColor: c.font, ...dash });
  if (isRow) return setStyle(style, { fillColor: c.fill, strokeColor: c.stroke, fontColor: c.font, ...dash });
  // A label of its own (an edge label, the tab of a frame): the text takes the colour.
  if (/^(edgeLabel|text);/.test(style)) return setStyle(style, { fontColor: c.font, fontStyle: 1 });
  if (/^line;/.test(style)) return setStyle(style, { strokeColor: c.stroke, ...dash });
  // A lane, a group, a composite state, a table: the header takes the tint; the body of a
  // lane that is new or gone takes it too.
  if (/^swimlane;/.test(style)) {
    const body = /swimlaneFillColor=/.test(style) && status !== 'changed' ? { swimlaneFillColor: c.fill } : {};
    return setStyle(style, { strokeColor: c.stroke, strokeWidth: 2, fillColor: c.fill, fontColor: c.font, ...body, ...dash });
  }
  // A frame around other shapes (an AWS group, a sequence block): the outline and the title, no fill over the members.
  if (/shape=mxgraph\.aws4\.group|container=1|shape=umlFrame/.test(style) && !/shape=umlLifeline/.test(style)) {
    return setStyle(style, { strokeColor: c.stroke, strokeWidth: 3, fontColor: c.font, ...dash });
  }
  // A solid black figure (an initial or final node, a fork bar) stays solid, in the colour.
  if (/fillColor=#000000/.test(style)) {
    return setStyle(style, status === 'removed' ? { fillColor: c.fill, strokeColor: c.stroke, strokeWidth: 2, ...dash } : { fillColor: c.stroke, strokeColor: c.stroke });
  }
  return setStyle(style, { strokeColor: c.stroke, strokeWidth: 2, fillColor: c.fill, fontColor: c.font, ...dash });
}

/** A figure whose colours are the picture (a service icon, a logo, a screen): it gets a frame behind it instead. */
const isFigure = (style) => /shape=mxgraph\./.test(style) && !/shape=mxgraph\.aws4\.group/.test(style);

const CELL = /<UserObject\b[^>]*>[\s\S]*?<\/UserObject>|<mxCell\b[^>]*\/>|<mxCell\b[^>]*>[\s\S]*?<\/mxCell>/g;
const INDENT = '        ';
const lines = (cell) => cell.map((l) => `${INDENT}${l}`).join('\n');

const LEGEND = {
  added: 'Added',
  changed: 'Changed or moved',
  removed: 'Removed',
};
const NOTE_WIDTH = 760;
const NOTE_LINE = 18;

/** The legend of a page, under the drawing: what the colours mean, then the old value of what changed. */
function legendCells(slug, bounds, page) {
  const id = (name) => `${slug}${MARKER}${name}`;
  const x = bounds.minX;
  let y = bounds.maxY + 40;
  const cells = [];
  const text = (name, value, height, style = '') => {
    const cell = vertex({ id: id(name), value, style: `text;html=1;align=left;verticalAlign=top;whiteSpace=wrap;strokeColor=none;fillColor=none;${style}`, x: x + 12, y, width: NOTE_WIDTH, height, connectable: false });
    y += height;
    return cell;
  };
  const top = y;
  y += 10;
  const body = [];
  const head = page.whole === 'added' ? 'This diagram is new: it is in the new version only.'
    : page.whole === 'removed' ? 'This diagram was removed: it is in the old version only.'
      : `What changed in this diagram: ${page.counts.added} added, ${page.counts.changed} changed or moved, ${page.counts.removed} removed.`;
  body.push(text('head', `<b>${htmlLabel(head)}</b>`, 24));
  const swatch = { width: 170, height: 34, gap: 16 };
  ['added', 'changed', 'removed'].forEach((status, i) => {
    body.push(vertex({ id: id(status), value: htmlLabel(LEGEND[status]), style: restyle('rounded=1;whiteSpace=wrap;html=1;', status, {}), x: x + 12 + i * (swatch.width + swatch.gap), y, width: swatch.width, height: swatch.height, connectable: false }));
  });
  y += swatch.height + 10;
  const explain = 'Green: in the new version only. Amber: in both versions, with another label, value or place; the old value is listed below and in the tooltip of the shape. Red, dashed: in the old version only, drawn where it was.';
  body.push(text('explain', htmlLabel(explain), NOTE_LINE * wrapText(explain, NOTE_WIDTH - 8).lines + 6));
  const notes = [...page.fields.map((f) => `Diagram: ${f}`), ...page.notes];
  if (notes.length > 0) {
    const height = notes.reduce((h, n) => h + NOTE_LINE * wrapText(`• ${n}`, NOTE_WIDTH - 8).lines, 0) + 6;
    body.push(text('notes', notes.map((n) => htmlLabel(`• ${n}`)).join('<br>'), height));
  }
  if (page.notDrawn.length > 0) {
    const gone = page.notDrawn.map((e) => `Removed, not drawn: ${e.label === '' ? e.id : `"${e.label}"`} (${e.collection} ${e.id}): ${e.reason}`);
    const height = gone.reduce((h, n) => h + NOTE_LINE * wrapText(`• ${n}`, NOTE_WIDTH - 8).lines, 0) + 6;
    body.push(text('not-drawn', gone.map((n) => htmlLabel(`• ${n}`)).join('<br>'), height, `fontColor=${DIFF_COLOURS.removed.font};`));
  }
  y += 6;
  cells.push(vertex({ id: id('legend'), value: '', style: 'rounded=0;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#9E9E9E;', x, y: top, width: NOTE_WIDTH + 24, height: y - top, connectable: false }));
  cells.push(...body);
  return cells;
}

/** One page of the bundle with its cells restyled and its legend added. */
function markPage(body, slug, page) {
  const kept = [];
  const out = body.replace(CELL, (block) => {
    const outer = parseAttrs(/^<\w+\b([^>]*)>/.exec(block)[1]);
    const id = outer.id;
    if (id === undefined || id === '0' || id === '1') return block;
    kept.push(block.split('\n').map((l) => l.trim()));
    if (!id.startsWith(`${slug}:`)) return block;
    const local = id.slice(slug.length + 1);
    const cut = local.indexOf(':');
    const element = cut < 0 ? local : local.slice(0, cut);
    const suffix = cut < 0 ? '' : local.slice(cut + 1);
    if (local === 'title') {
      if (!page.whole) return block;
      const said = page.whole === 'added' ? 'added in the new version' : 'removed in the new version';
      return block
        .replace(/(value|label)="([^"]*)"/, (_, k, v) => `${k}="${v}${xmlAttr(htmlLabel(` (${said})`))}"`)
        .replace(/style="([^"]*)"/, (_, s) => `style="${xmlAttr(setStyle(s, { fontColor: DIFF_COLOURS[page.whole].font }))}"`);
    }
    const whole = page.whole;
    const own = page.status.get(element);
    const mark = page.parts.get(element)?.get(suffix);
    let status = whole ?? own;
    let tip = suffix === '' && !whole ? page.tips.get(element) : undefined;
    if (!whole && PART_CELL.test(suffix) && (own === 'changed' || own === undefined)) {
      status = mark?.status;
      tip = mark?.tip;
    }
    if (status === undefined) return block;
    const style = /style="([^"]*)"/.exec(block)?.[1] ?? '';
    const isEdge = /\sedge="1"/.test(block);
    let cell = block;
    let halo = '';
    if (!isEdge && isFigure(style)) {
      const g = /<mxGeometry x="(-?[\d.]+)" y="(-?[\d.]+)" width="(-?[\d.]+)" height="(-?[\d.]+)"/.exec(block);
      const parent = /\sparent="([^"]*)"/.exec(block)?.[1] ?? '1';
      const c = DIFF_COLOURS[status];
      if (g) {
        halo = `${lines(vertex({ id: `${id}${MARKER}frame`, value: '', style: setStyle('rounded=1;arcSize=12;html=1;', { fillColor: c.fill, strokeColor: c.stroke, strokeWidth: 2, ...(status === 'removed' ? { dashed: 1, dashPattern: '6 4' } : {}) }), x: +g[1] - 6, y: +g[2] - 6, width: +g[3] + 12, height: +g[4] + 12, parent, connectable: false })).trimStart()}\n${INDENT}`;
      }
      cell = cell.replace(/style="([^"]*)"/, (_, s) => `style="${setStyle(s, { fontColor: c.font, fontStyle: 1 })}"`);
    } else {
      cell = cell.replace(/style="([^"]*)"/, (_, s) => `style="${restyle(s, status, { isEdge, isRow: /^row-\d+$/.test(suffix) })}"`);
    }
    if (tip !== undefined) {
      if (cell.startsWith('<UserObject')) cell = cell.replace(/^<UserObject\b/, `<UserObject tooltip="${xmlAttr(tip)}"`);
      else {
        // draw.io keeps a tooltip on an `object` wrapper, which takes the id and the label of its cell.
        const m = /^<mxCell id="([^"]*)" value="([^"]*)"/.exec(cell);
        if (m) cell = `<object label="${m[2]}" tooltip="${xmlAttr(tip)}" id="${m[1]}">\n${INDENT}  <mxCell${cell.slice(m[0].length).replace(/\n/g, '\n  ')}\n${INDENT}</object>`;
      }
    }
    return `${halo}${cell}`;
  });
  const legend = legendCells(slug, cellsBounds(kept), page).map(lines).join('\n');
  return out.replace(/(\n\s*)<\/root>/, (_, gap) => `\n${legend}${gap}</root>`);
}

/**
 * @param {Array<{ id: string, ir: object }>} oldEntries valid IRs with their diagram ids
 * @param {Array<{ id: string, ir: object }>} newEntries
 * @param {{ allowSensitive?: boolean }} [options]
 * @returns {Promise<{ ok: boolean, differs?: boolean, metaOnly?: boolean, output?: string, pages?: object[], unchanged?: string[],
 *   notDrawn?: object[], errors: object[], warnings: object[] }>} without a difference a drawing shows there is no
 *   `output`; `metaOnly` then says that the versions do differ, in `meta` fields alone
 */
export async function visualDiff(oldEntries, newEntries, options = {}) {
  const run = diffRun(oldEntries, newEntries);
  const before = new Map(oldEntries.map((e) => [e.id, e.ir]));
  const changed = new Map(run.diagrams.map((d) => [d.id, d]));
  const isDrawn = (d) => d.replaced || d.added.length + d.removed.length + d.changed.length + d.reordered.length > 0 || d.fields.some((f) => !f.field.startsWith('meta.'));
  if (run.diagramsAdded.length + run.diagramsRemoved.length === 0 && !run.diagrams.some(isDrawn)) {
    return { ok: true, differs: false, metaOnly: run.differs, unchanged: newEntries.map((e) => e.id), errors: [], warnings: [] };
  }

  const whole = (status) => ({ whole: status, status: new Map(), tips: new Map(), parts: new Map(), notDrawn: [], notes: [], fields: [] });
  const entries = [];
  const pages = new Map(); // diagram id of the page -> what to mark on it
  const unchanged = [];
  const warnings = [];
  const errors = [];
  for (const e of newEntries) {
    if (run.diagramsAdded.includes(e.id)) { entries.push(e); pages.set(e.id, { ...whole('added'), diagram: e.id, state: 'added' }); continue; }
    const d = changed.get(e.id);
    // A difference in `meta` alone (the sources, a note) is nothing the drawing shows: no page.
    if (!d || !isDrawn(d)) { entries.push(e); unchanged.push(e.id); continue; }
    const old = before.get(e.id);
    // The labels of the old version are written on the page too (removed elements, old values).
    const secrets = scanSecrets(old);
    warnings.push(...secrets.warnings.filter((w) => !DEFINITE_KINDS.has(w.kind)).map((w) => ({ stage: 'secret-scan', diagram: e.id, version: 'old', ...w })));
    if (!options.allowSensitive) {
      errors.push(...secrets.warnings.filter((w) => DEFINITE_KINDS.has(w.kind)).map((w) => ({ diagram: e.id, path: w.path, message: `refusing to draw the old version: ${w.message}`, hint: 'replace the value in the old IR with a placeholder such as <db password>, or pass --allow-sensitive if it is not a secret' })));
    }
    if (d.replaced) {
      // Two kinds make no one model: the new diagram is a page, the old one the page after it.
      entries.push(e, { id: `${e.id}-before`, ir: old });
      pages.set(e.id, { ...whole('added'), diagram: e.id, state: 'replaced' });
      pages.set(`${e.id}-before`, { ...whole('removed'), diagram: e.id, state: 'replaced' });
      continue;
    }
    const m = mergedModel(old, e.ir);
    entries.push({ id: e.id, ir: m.ir });
    pages.set(e.id, { ...m, diagram: e.id, state: 'changed' });
  }
  for (const id of run.diagramsRemoved) {
    entries.push({ id, ir: before.get(id) });
    pages.set(id, { ...whole('removed'), diagram: id, state: 'removed' });
  }
  if (errors.length > 0) return { ok: false, errors, warnings };

  const built = await bundle(entries, 'drawio', { allowSensitive: options.allowSensitive });
  // What the model checks say belongs to `validate` of the IR itself, and a page here also
  // holds what was removed: only what concerns this file is passed on. A `ref` to a diagram
  // that is not one of the two versions is no finding of the comparison either.
  warnings.push(...built.warnings.filter((w) => pages.has(w.diagram) && (w.stage === 'emit' || w.stage === 'secret-scan') && !/^ref "[^"]*" is not in this bundle/.test(w.message)));
  if (!built.ok) return { ok: false, errors: built.errors, warnings };

  const bySlug = new Map([...pages].map(([id, page]) => [pageIdOf(id), page]));
  const shown = [];
  let xml = built.output.replace(/ {2}<diagram\b([^>]*)>([\s\S]*?)<\/diagram>\n/g, (all, attrText, body) => {
    const attrs = parseAttrs(attrText);
    const page = bySlug.get(attrs.id);
    if (!page) return '';
    const said = page.whole ? ` (${page.whole})` : '';
    shown.push({ diagram: page.diagram, page: attrs.id, state: page.state, ...(page.whole ? {} : page.counts) });
    return `  <diagram id="${xmlAttr(attrs.id)}" name="${xmlAttr(`${attrs.name}${said}`)}">${markPage(body, attrs.id, page)}</diagram>\n`;
  });
  // A page link to a diagram that did not change would lead nowhere in this file.
  xml = xml.replace(/ link="data:page\/id,([^"]*)"/g, (all, target) => (bySlug.has(target) ? all : ''));
  xml = xml.replace(/<mxfile\b([^>]*)>/, (_, a) => `<mxfile${a.replace(/\s+pages="\d+"/, '')}${shown.length > 1 ? ` pages="${shown.length}"` : ''}>`);
  const notDrawn = [...pages.values()].flatMap((p) => p.notDrawn.map((e) => ({ diagram: p.diagram, ...e })));
  return { ok: true, differs: true, output: xml, pages: shown, unchanged, notDrawn, errors: [], warnings };
}
