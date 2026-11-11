/**
 * What a change does to the model: elements added, removed and changed between two IRs, and
 * between two sets of IRs (a run's `source/` folder before and after a revision), with hints
 * for the places a change usually has to follow (a `ref` part, a business view, a reference
 * to a removed element) and for a diagram a revision adds (not linked by any `ref`, or a second
 * architecture diagram).
 *
 * Elements are the objects with an `id` in the top-level arrays of a kind (`nodes`, `edges`,
 * `messages`, `states`, ...). Nested arrays (`attributes`, `methods`, `branches`) belong to
 * their element and are compared as one value of it. Output is ordered by collection, then
 * id, so the same pair of models always gives the same list.
 *
 * The order of a collection is part of the model: it is the order of the messages of a
 * sequence diagram and of its lifelines, and the order every layout starts from. Elements
 * both models have that no longer stand in the same order are reported as `reordered`, with
 * the fewest elements whose move explains the new order and what each now follows.
 */

/** Top-level scalar fields worth reporting; `meta` is compared field by field. */
const TOP_FIELDS = ['title', 'kind', 'direction'];
const META_FIELDS = ['source', 'audience', 'lang', 'omitted', 'notes'];
/** Keys whose values name an element (or, for `ref`, a diagram) by id, from the IR schema. */
const REF_KEYS = new Set(['from', 'to', 'children', 'participants', 'after', 'ref', 'lane']);

const labelOf = (item) => item.label ?? item.name ?? item.title ?? item.guard ?? item.event ?? '';
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Arrays of id-carrying objects at the top level of an IR, by collection name. */
function collections(ir) {
  const out = new Map();
  for (const [key, value] of Object.entries(ir ?? {})) {
    if (!Array.isArray(value)) continue;
    if (!value.every((v) => v && typeof v === 'object' && typeof v.id === 'string')) continue;
    out.set(key, new Map(value.map((v) => [v.id, v])));
  }
  return out;
}

/** The longest run of ids that keeps its order in both lists (both hold the same ids). */
function keptOrder(before, after) {
  const pos = new Map(before.map((id, i) => [id, i]));
  const seq = after.map((id) => pos.get(id));
  // Longest increasing subsequence, O(n^2): collections are a few dozen elements.
  const len = seq.map(() => 1);
  const prev = seq.map(() => -1);
  let best = -1;
  for (let i = 0; i < seq.length; i++) {
    for (let j = 0; j < i; j++) if (seq[j] < seq[i] && len[j] + 1 > len[i]) { len[i] = len[j] + 1; prev[i] = j; }
    if (best < 0 || len[i] > len[best]) best = i;
  }
  const kept = new Set();
  for (let i = best; i >= 0; i = prev[i]) kept.add(after[i]);
  return kept;
}

/**
 * @param {object} oldIr
 * @param {object} newIr
 * @returns {{ replaced: boolean,
 *   reordered: Array<{ collection: string, moved: Array<{ id: string, label: string, after: string | null }> }>, fields: Array<{ field: string, from: unknown, to: unknown }>,
 *   added: Array<{ collection: string, id: string, label: string }>,
 *   removed: Array<{ collection: string, id: string, label: string }>,
 *   changed: Array<{ collection: string, id: string, label: string, fields: string[] }> }}
 */
export function diffIr(oldIr, newIr) {
  const fields = [];
  for (const f of TOP_FIELDS) {
    if (!same(oldIr?.[f], newIr?.[f])) fields.push({ field: f, from: oldIr?.[f], to: newIr?.[f] });
  }
  for (const f of META_FIELDS) {
    if (!same(oldIr?.meta?.[f], newIr?.meta?.[f])) fields.push({ field: `meta.${f}`, from: oldIr?.meta?.[f], to: newIr?.meta?.[f] });
  }
  const replaced = oldIr?.kind !== newIr?.kind;
  const added = [];
  const removed = [];
  const changed = [];
  const reordered = [];
  const before = collections(oldIr);
  const after = collections(newIr);
  const names = [...new Set([...before.keys(), ...after.keys()])].sort();
  for (const name of names) {
    const a = before.get(name) ?? new Map();
    const b = after.get(name) ?? new Map();
    const ids = [...new Set([...a.keys(), ...b.keys()])].sort();
    for (const id of ids) {
      const x = a.get(id);
      const y = b.get(id);
      if (!x) added.push({ collection: name, id, label: labelOf(y) });
      else if (!y) removed.push({ collection: name, id, label: labelOf(x) });
      else {
        const keys = [...new Set([...Object.keys(x), ...Object.keys(y)])].sort().filter((k) => !same(x[k], y[k]));
        if (keys.length > 0) changed.push({ collection: name, id, label: labelOf(y), fields: keys });
      }
    }
    const was = [...a.keys()].filter((id) => b.has(id));
    const now = [...b.keys()].filter((id) => a.has(id));
    if (was.some((id, i) => id !== now[i])) {
      const kept = keptOrder(was, now);
      const order = [...b.keys()];
      const moved = now.filter((id) => !kept.has(id)).map((id) => ({ id, label: labelOf(b.get(id)), after: order[order.indexOf(id) - 1] ?? null }));
      reordered.push({ collection: name, moved });
    }
  }
  return { replaced, fields, added, removed, changed, reordered };
}

const isEmpty = (d) => !d.replaced && d.fields.length === 0 && d.added.length === 0 && d.removed.length === 0 && d.changed.length === 0 && d.reordered.length === 0;

/** Every string an IR uses as a reference (endpoints, lanes, `ref`, `after`, ...), with its path. */
function references(value, path = '') {
  const out = [];
  if (Array.isArray(value)) value.forEach((v, i) => out.push(...references(v, `${path}/${i}`)));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (k === 'meta' && path === '') continue;
      if (REF_KEYS.has(k) && typeof v === 'string') out.push({ path: `${path}/${k}`, key: k, value: v });
      else if (REF_KEYS.has(k) && Array.isArray(v) && v.every((x) => typeof x === 'string')) v.forEach((x, i) => out.push({ path: `${path}/${k}/${i}`, key: k, value: x }));
      else if (typeof v === 'object') out.push(...references(v, `${path}/${k}`));
    }
  }
  return out;
}

/**
 * Compare two sets of IRs paired by diagram id (the file name without `.ir.json`). Hints cover
 * changed diagrams, then added diagrams (only when the old set is not empty: a first delivery
 * is not a revision), then removed diagrams.
 * @param {Array<{ id: string, ir: object }>} oldEntries
 * @param {Array<{ id: string, ir: object }>} newEntries
 * @returns {{ differs: boolean, diagramsAdded: string[], diagramsRemoved: string[],
 *   diagrams: Array<{ id: string } & ReturnType<typeof diffIr>>, hints: Array<{ diagram: string, message: string }> }}
 */
export function diffRun(oldEntries, newEntries) {
  const before = new Map(oldEntries.map((e) => [e.id, e.ir]));
  const after = new Map(newEntries.map((e) => [e.id, e.ir]));
  const diagramsAdded = [...after.keys()].filter((id) => !before.has(id)).sort();
  const diagramsRemoved = [...before.keys()].filter((id) => !after.has(id)).sort();
  const diagrams = [];
  for (const id of [...after.keys()].filter((k) => before.has(k)).sort()) {
    const d = diffIr(before.get(id), after.get(id));
    if (!isEmpty(d)) diagrams.push({ id, ...d });
  }
  const touched = new Set([...diagramsAdded, ...diagramsRemoved, ...diagrams.map((d) => d.id)]);
  const hints = [];
  const hint = (diagram, message) => {
    if (!hints.some((h) => h.diagram === diagram && h.message === message)) hints.push({ diagram, message });
  };

  for (const d of diagrams) {
    const oldCols = collections(before.get(d.id));
    const newCols = collections(after.get(d.id));
    const refsOf = (item) => [item?.ref].filter((r) => typeof r === 'string');
    for (const e of [...d.added, ...d.removed, ...d.changed, ...d.reordered.flatMap((r) => r.moved.map((m) => ({ collection: r.collection, id: m.id })))]) {
      const parts = new Set([...refsOf(oldCols.get(e.collection)?.get(e.id)), ...refsOf(newCols.get(e.collection)?.get(e.id))]);
      for (const part of parts) {
        if (after.has(part) && !touched.has(part)) hint(d.id, `part ${part} may need the same change (${e.collection} ${e.id} carries ref "${part}")`);
      }
    }
    const business = `${d.id}-business`;
    // Only a change the reader of the business view could see: elements, title or kind, not
    // bookkeeping in `meta`.
    const visible = d.replaced || d.added.length + d.removed.length + d.changed.length + d.reordered.length > 0 || d.fields.some((f) => !f.field.startsWith('meta.'));
    if (visible && !d.id.endsWith('-business') && before.has(business) && after.has(business) && !touched.has(business)) {
      hint(d.id, `business view not updated: ${business} is unchanged`);
    }
    // A removed element that something in the new model still names.
    const removedIds = new Set(d.removed.map((e) => e.id));
    if (removedIds.size > 0) {
      for (const r of references(after.get(d.id))) {
        if (removedIds.has(r.value)) hint(d.id, `removed ${r.value} is still referenced at ${r.path}`);
      }
    }
  }
  // An added technical diagram that no element links with `ref`, or that sits beside another
  // architecture diagram.
  if (before.size > 0) {
    const architectures = [...after.keys()].filter((id) => after.get(id)?.kind === 'architecture' && !id.endsWith('-business')).sort();
    for (const added of diagramsAdded) {
      if (added.endsWith('-business')) continue;
      const linked = [...after].some(([id, ir]) => id !== added && references(ir).some((r) => r.key === 'ref' && r.value === added));
      if (!linked) hint(added, `new diagram ${added} is not the ref of any element: link it from the element it details, or say in the report that it stands on its own`);
      const other = after.get(added)?.kind === 'architecture' && architectures.find((id) => id !== added);
      if (other) hint(added, `${added} is a second architecture diagram beside ${other}: an architecture diagram shows each resource once, so the detail of ${other} belongs in a part of another kind (sequence, activity, er) linked with ref`);
    }
  }
  // A removed diagram that another diagram's `ref` still points at, or whose business view stays.
  for (const gone of diagramsRemoved) {
    if (!gone.endsWith('-business') && after.has(`${gone}-business`)) hint(`${gone}-business`, `${gone} was removed but its business view ${gone}-business stays`);
    for (const [id, ir] of after) {
      for (const r of references(ir)) {
        if (r.key === 'ref' && r.value === gone) hint(id, `removed diagram ${gone} is still the ref of ${r.path}`);
      }
    }
  }
  const differs = diagramsAdded.length > 0 || diagramsRemoved.length > 0 || diagrams.length > 0;
  return { differs, diagramsAdded, diagramsRemoved, diagrams, hints };
}
