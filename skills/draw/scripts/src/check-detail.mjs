/**
 * The level of detail of an architecture diagram. Such a diagram shows what is deployed and
 * how the parts reach each other; the parts of one resource and what travels over a
 * connection belong to the other kinds (`references/ir-reference.md`, Level of detail). Two
 * breaches can be told from the IR alone, and each is reported as a warning: the diagram is
 * still drawn, because the author may have a reason the IR does not show. A label is read
 * by its form (a path, an identifier, two data words joined by a slash), so a breach written
 * as plain prose is left to the review.
 */

const STORE_KINDS = new Set(['database', 'cache', 'queue']);
/** How many components of one kind, used by one component alone, read as the parts of one resource. */
const PARTS_MIN = 3;

/** An absolute path with two or more named parts: `/hubs/imageProcessing`, `/api/v1/orders`. */
const ENDPOINT_PATH = /(?:^|[\s(,;])\/[A-Za-z][\w.-]*\/[A-Za-z{:][\w.{}:-]*/;
/** Two names joined by a slash where one is written like an identifier: `batch-job/sync-orders`. */
const JOB_PATH = /(?:^|[\s(,;])(?:[A-Za-z]\w*[-_]\w[\w-]*\/[A-Za-z]\w+|[A-Za-z]\w+\/[A-Za-z]\w*[-_]\w[\w-]*)/;
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

/**
 * @param {object} ir a valid IR
 * @returns {{ warnings: Array<{path:string,message:string,hint:string}> }}
 */
export function checkDetail(ir) {
  const warnings = [];
  if (!isObj(ir) || ir.kind !== 'architecture') return { warnings };
  const components = list(ir, 'components');
  const connections = list(ir, 'connections');

  // Stores of one kind that one component alone uses: the tables of a database drawn one by one.
  const users = new Map(components.map((c) => [c.id, new Set()]));
  for (const c of connections) {
    if (c.from === c.to) continue;
    users.get(c.from)?.add(c.to);
    users.get(c.to)?.add(c.from);
  }
  const groups = new Map();
  components.forEach((c, i) => {
    const kind = c.kind ?? 'service';
    if (!STORE_KINDS.has(kind) || users.get(c.id)?.size !== 1) return;
    const key = `${[...users.get(c.id)][0]}|${c.icon ?? kind}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ c, i });
  });
  for (const [key, parts] of groups) {
    if (parts.length < PARTS_MIN) continue;
    const user = key.split('|')[0];
    warnings.push({
      path: `/components/${parts[0].i}`,
      message: `detail: ${parts.length} components (${parts.map((p) => `"${p.c.id}"`).join(', ')}) are stores of one kind that only "${user}" uses; an architecture diagram shows a resource once, not its tables or its parts`,
      hint: `draw one component and put the number in its label ("DynamoDB (${parts.length} tables)"); keep them apart only when they are separate resources that differ in network place, access or backup, and move the names to an er diagram or to meta.notes`,
    });
  }

  // A connection labelled with what travels over it instead of how it travels.
  connections.forEach((c, i) => {
    if (typeof c.label !== 'string') return;
    const what = ENDPOINT_PATH.test(c.label) ? 'an endpoint path' : JOB_PATH.test(c.label) ? 'a job or resource path' : CAMEL_CASE.test(c.label) ? 'a field or method name' : namesData(c.label) ? 'a resource or data path' : namesJob(c.label) ? 'the name of a job or a route' : undefined;
    if (!what) return;
    warnings.push({
      path: `/connections/${i}/label`,
      message: `detail: the label of connection "${c.id}" ("${c.label}") reads as ${what}; an architecture diagram labels a connection with its protocol, its port or what it is for in the infrastructure`,
      hint: 'write the protocol or the purpose ("HTTPS", "HTTP :8080", "read / write", "pull image"); what is sent over the connection belongs to a sequence or activity diagram',
    });
  });
  return { warnings };
}
