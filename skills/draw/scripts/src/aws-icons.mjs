import catalog from './aws-icons.json' with { type: 'json' };

/**
 * The AWS icons and group frames of draw.io's AWS library (see tools/generate-aws-icons.mjs).
 * An IR names one as `aws:<name>`; the name is checked here before anything is drawn, because
 * draw.io shows an unknown stencil as an empty box without reporting it.
 */
export const AWS_SOURCE = catalog.source;
const PREFIX = 'aws:';
const nameOf = (value) => (typeof value === 'string' && value.startsWith(PREFIX) ? value.slice(PREFIX.length) : undefined);
const own = (table, key) => (key !== undefined && Object.hasOwn(table, key) ? table[key] : undefined);

/** @returns {{name:string,title:string,category:string,fill:string,gradient?:string}|undefined} */
export function awsIcon(value) {
  const name = nameOf(value);
  const icon = own(catalog.icons, name);
  return icon && { name, ...icon };
}

/** @returns {{name:string,title:string,style:string}|undefined} */
export function awsGroup(value) {
  const name = nameOf(value);
  const group = own(catalog.groups, name);
  return group && { name, ...group };
}

function editDistance(a, b) {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length];
}

const squash = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
/** The capitals and digits of a title, as people abbreviate it: "Identity & Access Management" is "iam". */
const initials = (title) => title.split(/[^A-Za-z0-9]+/).filter(Boolean).map((w) => w[0]).join('').toLowerCase();

/**
 * Up to `limit` catalog names closest to a name that is not in the catalog, best first: the
 * name as an abbreviation of a title, then a name or title that contains it or is contained
 * in it, then the smallest edit distance. Ties keep catalog order.
 * @param {'icons'|'groups'} table
 */
export function nearestAwsNames(table, value, limit = 3) {
  const raw = nameOf(value) ?? String(value);
  const query = squash(raw);
  if (!query) return [];
  const words = new Set(raw.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  const scored = Object.entries(catalog[table]).map(([name, entry]) => {
    const n = squash(name);
    const t = squash(entry.title);
    let score;
    if (initials(entry.title) === query) score = 0;
    else if (n.includes(query) || t.includes(query)) score = 1 + (Math.min(n.length, t.length) - query.length) / 100;
    else if (words.has(n)) score = 2;
    else if (query.includes(n) && n.length >= 3) score = 2 + (query.length - n.length) / 100;
    else score = 3 + Math.min(editDistance(query, n), editDistance(query, t)) / Math.max(query.length, 1);
    return { name, score };
  });
  return scored.filter((s) => s.score < 3.5).sort((a, b) => a.score - b.score).slice(0, limit).map((s) => `${PREFIX}${s.name}`);
}
