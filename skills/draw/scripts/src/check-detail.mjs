/**
 * The level of detail of an architecture diagram. Such a diagram shows what is deployed and
 * how the parts reach each other; the parts of one resource and what travels over a
 * connection belong to the other kinds (`references/ir-reference.md`, Level of detail). Four
 * breaches can be told from the IR alone, and each is reported as a warning: the diagram is
 * still drawn, because the author may have a reason the IR does not show. They are a plain
 * boundary that holds only components of one kind, stores of one kind that one component
 * alone uses, connection labels numbered as the steps of a call order, and a connection
 * label that names what travels over it. A label is read by its form (a path, an
 * identifier, two data words joined by a slash, a leading step number), so a breach written
 * as plain prose is left to the review.
 *
 * Only the user can keep a breach, and the choice is written into `meta.notes` as an entry
 * that starts with `detail accepted:` and quotes the ids the warning named. A warning whose
 * ids are all quoted in such entries is not repeated; a new element of the same kind brings
 * it back, because its id was never accepted.
 */

import { awsIcon } from './aws-icons.mjs';

const STORE_KINDS = new Set(['database', 'cache', 'queue']);
/** The AWS icon categories that draw a store, whatever the `kind` of the component. */
const STORE_ICON_CATEGORIES = new Set(['Databases', 'Storage']);
/** How many components of one kind, used by one component alone, read as the parts of one resource. */
const PARTS_MIN = 3;

/** A statement of SQL: `INSERT INTO orders`, `SELECT user by email`. */
const SQL_STATEMENT = /^\s*(?:SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|MERGE\s+INTO|UPSERT)\s+\S/;
/** An HTTP method before a path of any length: `POST /redeem`. */
const METHOD_PATH = /\b(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\/[\w{:]/;
/** An absolute path with two or more named parts: `/hubs/imageProcessing`, `/api/v1/orders`. */
const ENDPOINT_PATH = /(?:^|[\s(,;])\/[A-Za-z][\w.-]*\/[A-Za-z{:][\w.{}:-]*/;
/** Two names joined by a slash where one is written like an identifier: `batch-job/sync-orders`. */
const JOB_PATH = /(?:^|[\s(,;])(?:[A-Za-z]\w*[-_]\w[\w-]*\/[A-Za-z]\w+|[A-Za-z]\w+\/[A-Za-z]\w*[-_]\w[\w-]*)/;
/** A step number at the start of a label: `1. `, `1) `, `(1) `, `[1] `, `1: ` before text, or a circled digit ①–⑳. */
const STEP_NUMBER = /^\s*(?:(?:\d{1,2}[.):]|\(\d{1,2}\)|\[\d{1,2}\])\s+\S|[\u2460-\u2473])/;
/** Two plain words joined by a slash with no space: `organization/schema`. */
const WORD_PAIR = /(?:^|[\s(,;])([a-z]{4,})\/([a-z]{4,})(?![\w/-])/;
/**
 * The words such a pair is made of when it describes how a connection works rather than what
 * it carries: "read/write", "request/response", "publish/subscribe". A pair of these is fine.
 */
const INFRA_WORDS = new Set(['read', 'write', 'request', 'response', 'reply', 'publish', 'subscribe', 'send', 'receive', 'push', 'pull', 'input', 'output', 'upload', 'download', 'inbound', 'outbound', 'ingress', 'egress', 'sync', 'async', 'primary', 'standby', 'replica', 'active', 'passive', 'client', 'server', 'encrypt', 'decrypt', 'blue', 'green', 'http', 'https', 'grpc', 'tcp', 'udp', 'websocket', 'metrics', 'logs', 'traces', 'backup', 'restore', 'failover', 'failback', 'load', 'store', 'fetch', 'query', 'command', 'event', 'events', 'stream', 'batch']);
const namesData = (label) => { const m = WORD_PAIR.exec(label); return m !== null && !(INFRA_WORDS.has(m[1]) && INFRA_WORDS.has(m[2])); };
/** A name of three or more parts joined by hyphens, as a job or a route is named: `sync-orders-to-billing`. */
const HYPHEN_NAME = /(?:^|[\s(,;/])([a-z][a-z0-9]*(?:-[a-z0-9]+){2,})(?![\w-])/g;
/** Phrases written that way that say how a connection works, not what it is called. */
const HYPHEN_PHRASES = new Set(['point-in-time', 'end-to-end', 'pay-per-request', 'pay-per-use', 'peer-to-peer', 'site-to-site', 'machine-to-machine', 'server-to-server', 'service-to-service', 'business-to-business', 'at-least-once', 'at-most-once', 'exactly-once', 'first-in-first-out', 'man-in-the-middle', 'read-after-write', 'copy-on-write', 'write-ahead-log', 'out-of-band', 'one-to-many', 'many-to-many', 'one-to-one', 'time-to-live', 'on-premises-to-cloud', 'x-forwarded-for', 'server-side-encryption', 'client-side-encryption']);
const namesJob = (label) => [...label.matchAll(HYPHEN_NAME)].some((m) => !HYPHEN_PHRASES.has(m[1]) && !/^(?:[a-z]{2}-[a-z]+-\d|tls-\d|http-\d)/.test(m[1]));
/** A name in camel case, as a field or a method is written: `latestSyncDate`. `gRPC` and `mTLS` are not. */
const CAMEL_CASE = /(?:^|[^A-Za-z])[a-z]{2,}[A-Z][a-z]+/;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const list = (ir, key) => (Array.isArray(ir[key]) ? ir[key].filter(isObj) : []);
const quoted = (ids) => ids.map((id) => `"${id}"`).join(', ');
const iconCategory = (c) => (typeof c.icon === 'string' ? awsIcon(c.icon)?.category : undefined);
const isStore = (c) => STORE_KINDS.has(c.kind ?? 'service') || STORE_ICON_CATEGORIES.has(iconCategory(c));
const ACCEPTED = /^\s*detail accepted:/i;

/**
 * @param {object} ir a valid IR
 * @returns {{ warnings: Array<{path:string,message:string,hint:string}>, accepted: number }}
 *   `accepted` counts the breaches that a `detail accepted:` note covers
 */
export function checkDetail(ir) {
  const found = [];
  const warnings = { push: (w) => found.push(w) };
  if (!isObj(ir) || ir.kind !== 'architecture') return { warnings: [], accepted: 0 };
  const components = list(ir, 'components');
  const connections = list(ir, 'connections');
  const byId = new Map(components.map((c) => [c.id, c]));

  // A plain boundary around components of one kind: the parts of one resource framed as a group.
  // A boundary with an AWS `group` frame (a subnet, a VPC) groups by network and is left alone.
  const reported = new Set();
  list(ir, 'boundaries').forEach((b, i) => {
    if (b.group !== undefined || !Array.isArray(b.children) || b.children.length < 2) return;
    const children = b.children.map((id) => byId.get(id));
    if (children.some((c) => c === undefined)) return;
    const icons = new Set(children.map((c) => c.icon));
    const kinds = new Set(children.map((c) => c.kind ?? 'service'));
    const oneIcon = icons.size === 1 && !icons.has(undefined);
    const oneStoreKind = icons.size === 1 && icons.has(undefined) && kinds.size === 1 && STORE_KINDS.has([...kinds][0]);
    if (!oneIcon && !oneStoreKind) return;
    for (const c of children) reported.add(c.id);
    warnings.push({
      ids: [b.id, ...b.children],
      path: `/boundaries/${i}`,
      message: `detail: boundary "${b.id}" holds only ${children.length} components of one kind (${quoted(b.children)}); a boundary groups what shares a network, an account or an owner, never the parts of one resource`,
      hint: `draw one component for the resource and drop the boundary, with the number of its parts in the label where a reader needs it ("DynamoDB (${children.length} tables)"); keep the boundary only when these are separate resources of one owner or one network`,
    });
  });

  // Stores of one kind that one component alone uses: the tables of a database drawn one by one.
  const users = new Map(components.map((c) => [c.id, new Set()]));
  for (const c of connections) {
    if (c.from === c.to) continue;
    users.get(c.from)?.add(c.to);
    users.get(c.to)?.add(c.from);
  }
  const groups = new Map();
  components.forEach((c, i) => {
    if (reported.has(c.id) || !isStore(c) || users.get(c.id)?.size !== 1) return;
    const key = `${[...users.get(c.id)][0]}|${c.icon ?? c.kind}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ c, i });
  });
  for (const [key, parts] of groups) {
    if (parts.length < PARTS_MIN) continue;
    const user = key.split('|')[0];
    warnings.push({
      ids: parts.map((p) => p.c.id),
      path: `/components/${parts[0].i}`,
      message: `detail: ${parts.length} components (${quoted(parts.map((p) => p.c.id))}) are stores of one kind that only "${user}" uses; an architecture diagram shows a resource once, not its tables or its parts`,
      hint: `draw one component and put the number in its label ("DynamoDB (${parts.length} tables)"); keep them apart only when they are separate resources that differ in network place, access or backup, and move the names to an er diagram or to meta.notes`,
    });
  }

  // Connection labels numbered as steps: the order of calls, which a sequence or activity diagram shows.
  const steps = connections.map((c, i) => ({ c, i })).filter(({ c }) => typeof c.label === 'string' && STEP_NUMBER.test(c.label));
  if (steps.length >= 2) {
    warnings.push({
      ids: steps.map(({ c }) => c.id),
      path: `/connections/${steps[0].i}/label`,
      message: `detail: ${steps.length} connection labels start with a step number (${quoted(steps.map(({ c }) => c.id))}); an architecture diagram shows how the parts reach each other, not the order of calls`,
      hint: 'the order of calls is a sequence or activity diagram: give it its own diagram, link it with `ref` on the component it details, and label each connection with its protocol or purpose ("HTTPS", "read / write")',
    });
  }

  // A connection labelled with what travels over it instead of how it travels.
  connections.forEach((c, i) => {
    if (typeof c.label !== 'string') return;
    const what = METHOD_PATH.test(c.label) || ENDPOINT_PATH.test(c.label) ? 'an endpoint path' : SQL_STATEMENT.test(c.label) ? 'a database statement' : JOB_PATH.test(c.label) ? 'a job or resource path' : CAMEL_CASE.test(c.label) ? 'a field or method name' : namesData(c.label) ? 'a resource or data path' : namesJob(c.label) ? 'the name of a job or a route' : undefined;
    if (!what) return;
    warnings.push({
      ids: [c.id],
      path: `/connections/${i}/label`,
      message: `detail: the label of connection "${c.id}" ("${c.label}") reads as ${what}; an architecture diagram labels a connection with its protocol, its port or what it is for in the infrastructure`,
      hint: 'write the protocol or the purpose ("HTTPS", "HTTP :8080", "read / write", "pull image"); what is sent over the connection belongs to a sequence or activity diagram',
    });
  });
  // What the user chose to keep: every id the warning named is quoted in a `detail accepted:` note.
  const notes = (Array.isArray(ir.meta?.notes) ? ir.meta.notes : []).filter((n) => typeof n === 'string' && ACCEPTED.test(n));
  const acceptedIds = new Set(notes.flatMap((n) => [...n.matchAll(/["“`']([A-Za-z0-9_-]{1,64})["”`']/g)].map((m) => m[1])));
  const kept = found.filter((w) => !w.ids.every((id) => acceptedIds.has(id)));
  return { warnings: kept.map(({ ids, ...w }) => w), accepted: found.length - kept.length };
}
