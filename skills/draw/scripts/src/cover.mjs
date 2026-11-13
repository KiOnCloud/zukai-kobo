/**
 * Did a recook keep everything the source showed? Every text of the source facts (the label
 * and the extra texts of each node, the labels of each edge) must be found in the IRs written
 * from it: in one element of one IR, in a diagram title, or in a `meta.omitted` entry that
 * quotes it and says why it is left out (`"text": reason`). A `meta.notes` entry does not
 * count: a note is not shown, so a text put there would be dropped without saying so. A
 * source text found nowhere is reported, so a step, a member or a branch cannot drop out of a
 * recooked diagram unseen.
 *
 * Each IR of a recook names the page it was made from (`page "<name>"` in a `meta.notes`
 * entry, as the skill writes it). A text of a page is then looked for only in the IRs of that
 * page, so a word of one diagram cannot stand in for the same word dropped from another. An
 * IR that names no page is searched for the texts of every page.
 *
 * A text is found in an element when every word of it is a word of that element (its own
 * strings and those of what it holds, such as the attributes of an entity), or when its
 * letters and digits appear in that order in the element's: the second test keeps a label
 * written without spaces (Japanese, Chinese) or broken over two lines in the source. The test
 * runs element by element, never against the IR as a whole, so a dropped "Approve order" is
 * not found merely because "approve" and "order" occur somewhere else. A short, common word
 * (an edge "yes") can still be found in another element; the check catches what was dropped,
 * not where a kept text was attached.
 *
 * Ids and references (`id`, `from`, `to`, `children`, `after`, `lane`) are not looked at:
 * they are made from names, and a name that survives only as an id is not shown to anyone.
 */

const REF_KEYS = new Set(['id', 'from', 'to', 'children', 'after', 'lane', 'schemaVersion']);

/**
 * Words a diagram tool writes around a text rather than words of the text: the operators of a
 * UML block (`else` before the condition of a branch). They are dropped from a source text
 * that has other words, since the IR stores the operator as the block's kind.
 */
const FRAME_WORDS = new Set(['else', 'and', 'loop', 'alt', 'opt', 'par', 'critical', 'break', 'ref', 'sd']);

const MULTIPLICITY = /^\s*[0-9*nNmM]+(\s*\.\.\s*[0-9*nNmM]+)?\s*$/;

const normal = (text) => String(text).normalize('NFKC').toLowerCase();
const tokensOf = (text) => normal(text).match(/[\p{L}\p{N}]+/gu) ?? [];

/** Every string an element holds, nested objects and arrays included, references left out. */
function stringsOf(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) stringsOf(v, out);
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) if (!REF_KEYS.has(k)) stringsOf(v, out);
  return out;
}

/** The places a source text may be found in: each element of each IR, each title and each meta entry. */
export function holdersOf(irs) {
  const holders = [];
  for (const { name, ir } of irs) {
    // The pages this IR says it was made from; none named means any page.
    const pages = (ir.meta?.notes ?? []).flatMap((n) => (typeof n === 'string' ? [...n.matchAll(/\bpages?\s+((?:"[^"]+"(?:\s*(?:,|and)\s*)?)+)/g)].flatMap((m) => [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1])) : []));
    const hold = (where, strings) => {
      const tokens = new Set(strings.flatMap(tokensOf));
      if (tokens.size > 0) holders.push({ where, tokens, compact: [...strings.flatMap(tokensOf)].join(''), pages });
    };
    if (typeof ir.title === 'string') hold(`${name}:title`, [ir.title]);
    // An omission counts when it starts with the quoted text and gives its reason after it:
    // `"text": reason`.
    for (const entry of ir.meta?.omitted ?? []) if (typeof entry === 'string' && /^\s*["“«「『][\s\S]*["”»』」]\s*:\s*\S/.test(entry)) hold(`${name}:meta.omitted`, [entry]);
    const walk = (value, path) => {
      if (Array.isArray(value)) value.forEach((v, i) => {
        if (v && typeof v === 'object' && !Array.isArray(v)) hold(`${name}:${path}/${i}${v.id ? ` (${v.id})` : ''}`, stringsOf(v));
        walk(v, `${path}/${i}`);
      });
      else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) if (k !== 'meta') walk(v, `${path}/${k}`);
    };
    walk(ir, '');
  }
  return holders;
}

/** The texts a facts file asks to find: one per line of every label. */
export function unitsOf(facts) {
  const units = [];
  let pageName = '';
  const push = (page, element, text) => {
    for (const line of String(text ?? '').split('\n')) if (tokensOf(line).length > 0) units.push({ page, element, text: line.trim(), pageName });
  };
  for (const page of facts.pages ?? []) {
    pageName = page.name ?? '';
    for (const node of page.nodes ?? []) {
      push(page.id, node.id, node.label);
      for (const t of node.texts ?? []) push(page.id, node.id, t);
    }
    for (const edge of page.edges ?? []) {
      push(page.id, edge.id, edge.label);
      push(page.id, edge.id, edge.startLabel);
      push(page.id, edge.id, edge.endLabel);
    }
  }
  return units;
}

/**
 * @param {object} facts output of `extract`
 * @param {Array<{ name: string, ir: object }>} irs
 */
export function cover(facts, irs) {
  const holders = holdersOf(irs);
  const units = unitsOf(facts);
  // A multiplicity drawn as text ("0..*") is stored as an end of a relation, in words for an
  // ER diagram ("many"): it is kept when the IRs give their relations cardinalities.
  const cardinalities = irs.some(({ ir }) => (ir.relations ?? []).some((r) => r.fromCardinality !== undefined || r.toCardinality !== undefined));
  // A page an IR names that the facts do not have (a typing slip) does not narrow that IR.
  const known = new Set((facts.pages ?? []).flatMap((p) => [p.id, p.name]));
  for (const h of holders) h.pages = h.pages.filter((p) => known.has(p));
  const missing = [];
  for (const unit of units) {
    if (cardinalities && MULTIPLICITY.test(unit.text)) continue;
    // A value extract redacted (`<redacted credential>`) must not be copied into the IR, which
    // carries its own placeholder: the words around it are what must be found.
    const all = tokensOf(unit.text.replace(/<redacted[^<>]*>/g, ' '));
    if (all.length === 0) continue;
    const words = all.filter((t) => !FRAME_WORDS.has(t));
    const tokens = words.length > 0 ? words : all;
    const compact = tokens.join('');
    const found = holders.some((h) => (h.pages.length === 0 || h.pages.includes(unit.page) || h.pages.includes(unit.pageName)) && (tokens.every((t) => h.tokens.has(t)) || h.compact.includes(compact)));
    if (!found) missing.push({ page: unit.page, element: unit.element, text: unit.text });
  }
  return { ok: missing.length === 0, units: units.length, covered: units.length - missing.length, missing };
}
