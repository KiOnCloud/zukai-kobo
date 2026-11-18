/**
 * The texts a reader of a diagram sees, each with the place it stands in the IR: the title,
 * the label, name or title of an element, the event, guard and action of a transition, the
 * guard of an activity flow, the condition of an `extend`, the label of a block's further
 * section, and the name and comment of each attribute or member row.
 *
 * Fields that hold code rather than words (a type, the parameters and return type of a
 * method, a stereotype, a cardinality) are not returned: they are written as the code has
 * them and never translated. A field the schema adds later is neither a text nor code until
 * it is named in one of the two lists, and `ir-labels.test.mjs` fails until it is.
 *
 * Collections are read as `collections` of `ir-diff.mjs` reads them: the top-level arrays
 * whose items all carry an id. Rows inside an element (attributes, methods, branches) are
 * walked in order, so each text has a JSON pointer that finds it again.
 */
import { collections } from './ir-diff.mjs';

/** Fields whose value is wording a reader sees. */
export const TEXT_FIELDS = ['label', 'title', 'name', 'event', 'guard', 'action', 'condition', 'comment'];
/** Fields whose value is code, shown as it is and never reworded. */
export const CODE_FIELDS = ['type', 'params', 'returns', 'stereotype', 'fromCardinality', 'toCardinality'];

const TEXT = new Set(TEXT_FIELDS);
const escape = (key) => String(key).replace(/~/g, '~0').replace(/\//g, '~1');

function walk(value, path, field, out, element) {
  if (Array.isArray(value)) {
    value.forEach((v, i) => {
      if (v && typeof v === 'object') walk(v, `${path}/${i}`, `${field}/${i}`, out, element);
    });
    return;
  }
  for (const [key, v] of Object.entries(value)) {
    const here = `${path}/${escape(key)}`;
    const rel = field ? `${field}/${escape(key)}` : escape(key);
    if (typeof v === 'string') {
      if (TEXT.has(key) && v !== '') out.push({ path: here, collection: element.collection, id: element.id, field: rel, text: v });
    } else if (Array.isArray(v) && v.some((x) => x && typeof x === 'object')) walk(v, here, rel, out, element);
  }
}

/**
 * @param {object} ir
 * @returns {Array<{ path: string, collection: string | null, id: string | null, field: string, text: string }>}
 */
export function labelsOf(ir) {
  const out = [];
  if (typeof ir?.title === 'string' && ir.title !== '') out.push({ path: '/title', collection: null, id: null, field: 'title', text: ir.title });
  for (const [name, items] of collections(ir)) {
    let i = 0;
    for (const [id, item] of items) {
      walk(item, `/${escape(name)}/${i}`, '', out, { collection: name, id });
      i += 1;
    }
  }
  return out;
}

/** The value at a JSON pointer of `labelsOf`, or undefined. */
export function textAt(ir, path) {
  let value = ir;
  for (const part of path.split('/').slice(1)) {
    if (value === null || typeof value !== 'object') return undefined;
    value = value[part.replace(/~1/g, '/').replace(/~0/g, '~')];
  }
  return typeof value === 'string' ? value : undefined;
}
