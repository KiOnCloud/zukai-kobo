import catalog from './aws-icons.json' with { type: 'json' };
import aliases from './cloud-aliases.json' with { type: 'json' };

/**
 * The icons and group frames of draw.io's cloud libraries (see tools/generate-aws-icons.mjs).
 * An IR names one as `<provider>:<name>` (`aws:lambda`, `gcp:cloud_run`); the name is checked
 * here before anything is drawn, because draw.io shows an unknown stencil as an empty box
 * without reporting it.
 *
 * What differs between the providers is data, in the catalog and in this table; the lookups
 * and everything the emitter and the checks do with their results are the same for both.
 * - `library` is the stencil package of the provider's shapes;
 * - a `figure` icon is a stencil of its own with a `width` and a `height`, drawn in one colour;
 *   an icon that is none (an AWS service) is a picture in a coloured square, always the same size;
 * - `storeCategories` are the icon categories that draw a store whatever the `kind` of the
 *   component (the level-of-detail check counts them);
 * - `reference` is the page of `references/` that lists the names.
 */
export const PROVIDERS = {
  aws: { title: 'AWS', library: 'mxgraph.aws4', icons: catalog.icons, groups: catalog.groups, figure: (icon) => icon.width !== undefined, storeCategories: ['Databases', 'Storage'], reference: 'references/aws-icons.md' },
  gcp: { title: 'GCP', library: 'mxgraph.gcp2', icons: catalog.gcp?.icons ?? {}, groups: catalog.gcp?.groups ?? {}, figure: () => true, storeCategories: ['Databases', 'Storage'], reference: 'references/gcp-icons.md' },
};
export const AWS_SOURCE = catalog.source;
/**
 * The product logos (Firebase and the like) come from draw.io's GCP library and are named
 * `gcp:<name>`. A logo stands for a product a system of any provider talks to.
 */
const LOGO_PROVIDER = 'gcp';
const LOGOS = catalog.logos ?? {};

/** `aws:lambda` as `{ provider: 'aws', name: 'lambda' }`; undefined for any other value. */
function parse(value) {
  if (typeof value !== 'string') return undefined;
  const at = value.indexOf(':');
  const provider = value.slice(0, at);
  return at > 0 && Object.hasOwn(PROVIDERS, provider) ? { provider, name: value.slice(at + 1) } : undefined;
}
const own = (table, key) => (Object.hasOwn(table, key) ? table[key] : undefined);

/** The provider a value names (`aws`, `gcp`), whether or not the name is in the catalog. */
export const providerOf = (value) => parse(value)?.provider;
/** Whether a value is a product logo: an icon of a product, not of a service of the provider it is named under. */
export const isProductLogo = (value) => { const p = parse(value); return p !== undefined && p.provider === LOGO_PROVIDER && own(LOGOS, p.name) !== undefined; };

/**
 * The icon a component names. A service icon of AWS is a picture in a coloured square, always
 * the same size. Every other icon is a stencil of its own, `stencil` with a `width` and a
 * `height`: a GCP service (a hexagon), a general resource of either library (a server, an
 * application, a bucket) and a product logo.
 * @returns {{provider:string,name:string,title:string,category:string,fill:string,gradient?:string,stencil?:string,width?:number,height?:number}|undefined}
 */
export function cloudIcon(value) {
  const p = parse(value);
  if (!p) return undefined;
  const { library, icons, figure } = PROVIDERS[p.provider];
  const logo = p.provider === LOGO_PROVIDER ? own(LOGOS, p.name) : undefined;
  if (logo) return { provider: p.provider, name: p.name, category: 'Product logos', ...logo, stencil: `${library}.${p.name}` };
  const icon = own(icons, p.name);
  return icon && { provider: p.provider, name: p.name, ...icon, ...(figure(icon) ? { stencil: `${library}.${p.name}` } : {}) };
}

/**
 * The group frame a boundary names. `mark` is a small figure a frame carries in its corner as
 * a cell of its own (the Google Cloud mark); an AWS frame has its corner icon in its style.
 * @returns {{provider:string,name:string,title:string,style:string,mark?:{style:string,x:number,y:number,width:number,height:number}}|undefined}
 */
export function cloudGroup(value) {
  const p = parse(value);
  const group = p && own(PROVIDERS[p.provider].groups, p.name);
  return group && { provider: p.provider, name: p.name, ...group };
}

/** Whether an icon draws a store, whatever the `kind` of its component. */
export const isStoreIcon = (value) => { const icon = cloudIcon(value); return icon !== undefined && PROVIDERS[icon.provider].storeCategories.includes(icon.category); };

/**
 * The names people write for a service whose stencil draw.io names otherwise (`gcp:gke` for
 * `gcp:container_engine`), or that has no stencil at all (`gcp:secret_manager`). The table is
 * written by hand in `cloud-aliases.json`; it is no second set of valid names, only what the
 * validator answers an unknown name with, so the nearest valid name is never offered in the
 * place of the right one.
 * @param {'icons'|'groups'} table
 * @returns {{ name: string | null } | undefined} the catalog value (`gcp:container_engine`),
 *   `null` as the name when draw.io has no stencil, undefined when the name is no alias
 */
export function cloudAlias(table, value) {
  const p = parse(value);
  const list = p && aliases[p.provider]?.[table];
  if (!list || !Object.hasOwn(list, p.name)) return undefined;
  return { name: list[p.name] === null ? null : `${p.provider}:${list[p.name]}` };
}
/** The alias table of a provider, for the reference page: `[written, catalog name or null]`. */
export const cloudAliases = (provider, table) => Object.entries(aliases[provider]?.[table] ?? {});

/**
 * Where else a name that is unknown in one list is a name: the other list of its provider (a
 * frame written as an icon), or the same list of another provider (`aws:cloud_run`).
 * @param {'icons'|'groups'} table
 * @returns {{ value: string, table: 'icons'|'groups', provider: string } | undefined}
 */
export function cloudNameElsewhere(table, value) {
  const p = parse(value);
  if (!p) return undefined;
  const other = table === 'icons' ? 'groups' : 'icons';
  const has = (provider, t, name) => own(PROVIDERS[provider][t], name) !== undefined || (t === 'icons' && provider === LOGO_PROVIDER && own(LOGOS, name) !== undefined);
  if (has(p.provider, other, p.name)) return { value, table: other, provider: p.provider };
  for (const provider of Object.keys(PROVIDERS)) {
    if (provider !== p.provider && has(provider, table, p.name)) return { value: `${provider}:${p.name}`, table, provider };
  }
  return undefined;
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
 * in it, then the smallest edit distance. Ties keep catalog order. The names are those of the
 * provider the value is written for; an icon may also be a product logo.
 * @param {'icons'|'groups'} table
 */
export function nearestCloudNames(table, value, limit = 3) {
  const p = parse(value);
  const provider = p?.provider ?? 'aws';
  const raw = p?.name ?? String(value);
  const query = squash(raw);
  if (!query) return [];
  const words = new Set(raw.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  const entries = [
    ...Object.entries(PROVIDERS[provider][table]).map(([name, entry]) => [name, entry, provider]),
    ...(table === 'icons' ? Object.entries(LOGOS).map(([name, entry]) => [name, entry, LOGO_PROVIDER]) : []),
  ];
  const scored = entries.map(([name, entry, prefix]) => {
    const n = squash(name);
    const t = squash(entry.title);
    let score;
    if (initials(entry.title) === query) score = 0;
    else if (n.includes(query) || t.includes(query)) score = 1 + (Math.min(n.length, t.length) - query.length) / 100;
    else if (words.has(n)) score = 2;
    else if (query.includes(n) && n.length >= 3) score = 2 + (query.length - n.length) / 100;
    else score = 3 + Math.min(editDistance(query, n), editDistance(query, t)) / Math.max(query.length, 1);
    return { name: `${prefix}:${name}`, score };
  });
  return scored.filter((s) => s.score < 3.5).sort((a, b) => a.score - b.score).slice(0, limit).map((s) => s.name);
}

/**
 * What the validator offers for an unknown name: the catalog names that an alias close to the
 * written name stands for (`gcp:gke_cluster_x` leads to `gcp:container_engine`), then the
 * nearest catalog names, without repeats. An alias comes first because a catalog name that
 * merely looks alike (`gcp:gke_on_prem`) is valid and wrong.
 * @param {'icons'|'groups'} table
 */
export function suggestCloudNames(table, value, limit = 3) {
  const p = parse(value);
  if (!p) return nearestCloudNames(table, value, limit);
  const query = squash(p.name);
  const byAlias = [];
  for (const [written, target] of Object.entries(aliases[p.provider]?.[table] ?? {})) {
    if (target === null) continue;
    const a = squash(written);
    if (a.length < 3 || !(a === query || a.includes(query) || query.includes(a))) continue;
    byAlias.push({ name: `${p.provider}:${target}`, score: Math.abs(a.length - query.length) });
  }
  byAlias.sort((a, b) => a.score - b.score);
  return [...new Set([...byAlias.map((x) => x.name), ...nearestCloudNames(table, value, limit)])].slice(0, limit);
}

// The names these lookups had while AWS was the only provider; they take the names of every provider.
export { cloudIcon as awsIcon, cloudGroup as awsGroup, nearestCloudNames as nearestAwsNames };
