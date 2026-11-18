/**
 * The labs console's server: `node:http` on 127.0.0.1, nothing else. It serves the console's
 * pages from memory and an API over the runs of one project, and it never writes under
 * `diagrams/`: every change to a run is a job for the attached agent (`labs-jobs.mjs`).
 *
 * Every request passes the same checks, in this order, before anything else is read:
 *
 *   1. the method is one the route table knows; OPTIONS is refused (no CORS, ever);
 *   2. the name in `Host` is 127.0.0.1 or localhost, with any port (a forwarded port has
 *      another number), which a rebound foreign name cannot pass;
 *   3. `Origin`, when sent, is the origin of that `Host`; `Sec-Fetch-Site`, when sent, is
 *      `same-origin` or `none`;
 *   4. a static file is a GET of a name in a fixed map of pages held in memory;
 *   5. `/api/*` and `/agent/*` need the token in `X-Zukai-Token`, which a foreign page
 *      cannot set without a preflight that step 1 refuses; a body is JSON of at most 1 MB.
 *
 * The log holds method, route pattern, status and duration, and for an error its name, code
 * and stack frames: never a message (a parser's message quotes its input), a body, a query
 * string or the token.
 */
import { createServer } from 'node:http';
import { appendFileSync, mkdirSync, readFileSync, readdirSync, statSync, truncateSync, lstatSync } from 'node:fs';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { basename, dirname, extname, join } from 'node:path';
import { validateIr } from './validate-ir.mjs';
import { inspect, DOC_LANGS } from './pipeline.mjs';
import { labelsOf } from './ir-labels.mjs';
import { readGlossary, writeGlossary, addEntries, checkRuns, STATUSES, newEntryErrors, projectRoot } from './glossary.mjs';
import { listRuns, runNames, runPath, runDetail, diagramIds, diagramDetail, runDoc, revisionNames, changesSince, filePath, diagramsDir } from './labs-runs.mjs';

export const APP = 'zukai-labs';
export const MAX_BODY = 1024 * 1024;
const LOG_CAP = 1024 * 1024;

export const CONSOLE_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; font-src 'self'; connect-src 'self'; img-src 'self' blob: data:; frame-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
const API_CSP = "default-src 'none'; frame-ancestors 'none'";

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8', '.mmd': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.drawio': 'application/xml; charset=utf-8', '.js.map': 'application/json',
};
export const typeOf = (name) => TYPES[extname(name).toLowerCase()] ?? 'application/octet-stream';

/**
 * Read the built pages into memory, so a running server does not depend on its folder staying
 * on disk (an upgrade replaces the plugin folder). A missing folder gives no pages.
 * @returns {Map<string, { type: string, bytes: Buffer }>} keyed by URL path
 */
export function loadPages(dir) {
  const pages = new Map();
  const walk = (at, prefix) => {
    let names;
    try { names = readdirSync(at); } catch { return; }
    for (const n of names.sort()) {
      const path = join(at, n);
      const st = lstatSync(path);
      if (st.isDirectory()) walk(path, `${prefix}${n}/`);
      else if (st.isFile()) pages.set(`/${prefix}${n}`, { type: typeOf(n), bytes: readFileSync(path) });
    }
  };
  walk(dir, '');
  if (pages.has('/index.html')) pages.set('/', pages.get('/index.html'));
  return pages;
}

const NO_PAGES = Buffer.from('<!doctype html><meta charset="utf-8"><title>Zukai Labs</title><p>The console pages are not built. Run npm run build in skills/draw/scripts.</p>\n');

/** What proves that a server holds a token without sending it: HMAC-SHA256 of a nonce the asker chose. */
export const proofOf = (token, nonce) => createHmac('sha256', token).update(String(nonce)).digest('hex');

/** A token compared in constant time. */
export function sameToken(given, token) {
  if (typeof given !== 'string' || typeof token !== 'string') return false;
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(token).digest();
  return timingSafeEqual(a, b) && given.length === token.length;
}

/** An error of a request handler that becomes an HTTP status with a code and a message of our own words. */
export class HttpError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}
const notFound = () => new HttpError(404, 'not-found', 'no such resource');

/** One line of the log: what was asked and how it ended, never what it carried. */
export function makeLogger(file) {
  return (entry) => {
    if (!file) return;
    const line = `${JSON.stringify({ t: new Date().toISOString(), ...entry })}\n`;
    try {
      mkdirSync(dirname(file), { recursive: true });
      try { if (statSync(file).size + line.length > LOG_CAP) truncateSync(file, 0); } catch { /* no file yet */ }
      appendFileSync(file, line);
    } catch {
      // a log that cannot be written must not stop the server
    }
  };
}

/** What an error may tell the log: its name, its code and where it was thrown. */
export function errorFacts(error) {
  const frames = String(error?.stack ?? '').split('\n').slice(1, 6).map((l) => (/\(?([^()\s]+):(\d+):\d+\)?\s*$/.exec(l) ?? []).slice(1, 3).join(':')).filter(Boolean).map((f) => `${basename(f.split(':')[0])}:${f.split(':')[1]}`);
  return { name: String(error?.name ?? 'Error'), ...(error?.code !== undefined ? { code: String(error.code) } : {}), frames };
}

function hostName(host) {
  if (typeof host !== 'string' || host === '') return undefined;
  if (host.startsWith('[')) return host.slice(0, host.indexOf(']') + 1).toLowerCase();
  return host.split(':')[0].toLowerCase();
}

/** Steps 2 and 3: the `Host` names this machine and the request comes from the console's own origin. */
export function originError(headers) {
  const name = hostName(headers.host);
  if (name !== '127.0.0.1' && name !== 'localhost') return 'the Host header does not name 127.0.0.1 or localhost';
  if (headers.origin !== undefined && headers.origin !== `http://${headers.host}`) return 'the Origin is not this console';
  const site = headers['sec-fetch-site'];
  if (site !== undefined && site !== 'same-origin' && site !== 'none') return 'the request comes from another site';
  return undefined;
}

function compile(pattern) {
  const names = [];
  const re = new RegExp(`^${pattern.replace(/:[a-z]+/g, (m) => { names.push(m.slice(1)); return '([^/]+)'; })}$`);
  return { re, names };
}

const decode = (s) => { try { return decodeURIComponent(s); } catch { return undefined; } };

/**
 * @param {{ root: string, token: string, pages: Map<string, {type: string, bytes: Buffer}>, version: string, instance: string,
 *   log?: (entry: object) => void, idleMs?: number, now?: () => number, jobs?: object, onShutdown?: () => void, onIdle?: () => void }} options
 */
export function createLabsServer(options) {
  const { pages, version } = options;
  // The token may be made after the port is bound: until it exists, every request that needs it is refused.
  const tokenOf = typeof options.token === 'function' ? options.token : () => options.token;
  const root = projectRoot(options.root);
  const log = options.log ?? (() => {});
  const now = options.now ?? Date.now;
  const idleMs = options.idleMs ?? 30 * 60_000;
  const jobs = options.jobs;
  let counter = 0;
  let lastActivity = now();
  let closing = false;
  const bump = () => { counter += 1; };

  const glossaryState = () => {
    const read = readGlossary(root);
    if (!read.ok) return { ok: false, rev: null, counts: null };
    return { ok: true, exists: read.exists, rev: read.rev, counts: Object.fromEntries(STATUSES.map((s) => [s, read.glossary.entries.filter((e) => e.status === s).length])) };
  };

  /** A cheap stamp of the runs on disk: names and the dates of their folders, so the console reloads after the agent wrote. */
  const runsStamp = () => {
    const h = createHash('sha256');
    for (const n of runNames(root)) {
      const dir = join(diagramsDir(root), n);
      h.update(n);
      for (const sub of ['', 'source', 'history', 'svg']) { try { h.update(String(statSync(join(dir, sub)).mtimeMs)); } catch { /* absent */ } }
    }
    try { h.update(String(statSync(join(root, '.zukai', 'glossary.json')).mtimeMs)); } catch { /* none */ }
    return h.digest('hex').slice(0, 12);
  };

  const body = (req) => {
    if (req.body === undefined) throw new HttpError(400, 'bad-request', 'a JSON body is needed');
    return req.body;
  };
  const runOf = (params) => { if (!runPath(root, params.run)) throw notFound(); return params.run; };
  const entryOf = (id) => {
    const read = readGlossary(root);
    if (!read.ok || !read.glossary.entries.some((e) => e.id === id)) throw notFound();
    return id;
  };
  const glossaryWrite = (result) => {
    if (result.ok) { if (result.written) bump(); return { status: 200, body: { ok: true, rev: result.rev, glossary: result.glossary, ...(result.added ? { added: result.added, skipped: result.skipped, conflicts: result.conflicts } : {}) } }; }
    if (result.code === 'conflict') throw new HttpError(409, 'conflict', 'the glossary changed on disk since it was read', { rev: result.rev });
    if (result.code === 'locked') throw new HttpError(503, 'locked', 'the glossary is locked by another writer; try again');
    throw new HttpError(422, 'invalid', 'the change was not taken', { errors: result.errors });
  };
  const revParam = (value) => (value === undefined ? undefined : value === '' || value === 'null' ? null : value);

  const routes = [
    ['GET', '/api/state', () => ({ body: {
      app: APP, version, project: basename(root), runs: runNames(root).length,
      glossary: glossaryState(), change: `${counter}-${runsStamp()}`, ...(jobs ? jobs.state() : { agent: { attached: false, waiting: false, lastContact: null }, jobs: { queued: 0, open: null } }),
    } })],
    ['GET', '/api/runs', () => ({ body: { runs: listRuns(root) } })],
    ['GET', '/api/runs/:run', ({ params }) => ({ body: runDetail(root, runOf(params)) })],
    ['GET', '/api/runs/:run/diagrams/:id', ({ params }) => {
      const run = runOf(params);
      if (!diagramIds(root, run).includes(params.id)) throw notFound();
      return { body: diagramDetail(root, run, params.id) };
    }],
    ['GET', '/api/runs/:run/doc', async ({ params, query }) => {
      const run = runOf(params);
      const lang = query.get('lang') ?? 'en';
      if (!DOC_LANGS.includes(lang)) throw notFound();
      const doc = await runDoc(root, run, lang);
      if (!doc.ok) throw new HttpError(422, 'invalid', 'the tables could not be built', { errors: doc.errors });
      return { body: doc };
    }],
    ['GET', '/api/runs/:run/revisions/:rev/changes', ({ params }) => {
      const run = runOf(params);
      if (!revisionNames(root, run).includes(params.rev)) throw notFound();
      return { body: changesSince(root, run, params.rev) };
    }],
    ['GET', '/api/runs/:run/files/:name', ({ params }) => {
      const run = runOf(params);
      const path = filePath(root, run, params.name);
      if (!path) throw notFound();
      return { raw: readFileSync(path), type: typeOf(params.name), name: basename(params.name) };
    }],
    ['POST', '/api/validate', ({ req }) => {
      const ir = body(req).ir;
      const result = validateIr(ir);
      return { body: { ok: result.ok, errors: result.errors, warnings: result.ok ? inspect(ir) : [], labels: result.ok ? labelsOf(ir) : [] } };
    }],
    ['GET', '/api/glossary', () => {
      const read = readGlossary(root);
      if (!read.ok) throw new HttpError(422, 'invalid', 'the glossary does not match its schema', { errors: read.errors });
      return { body: { exists: read.exists, rev: read.rev, glossary: read.glossary } };
    }],
    ['POST', '/api/glossary/entries', ({ req }) => {
      const b = body(req);
      if (!Array.isArray(b.entries) || b.entries.length === 0) throw new HttpError(400, 'bad-request', 'entries must be a list of at least one entry');
      if (b.status !== undefined && b.status !== 'suggested' && b.status !== 'confirmed') throw new HttpError(400, 'bad-request', 'status must be suggested or confirmed');
      return glossaryWrite(addEntries(root, b.entries, { status: b.status ?? 'suggested', expectedRev: b.rev ?? null }));
    }],
    ['PATCH', '/api/glossary/entries/:id', ({ req, params }) => {
      const id = entryOf(params.id);
      const b = body(req);
      const change = {};
      for (const k of ['terms', 'avoid', 'note']) if (Object.hasOwn(b, k)) change[k] = b[k];
      if (b.status !== undefined && !STATUSES.includes(b.status)) throw new HttpError(400, 'bad-request', `status must be one of ${STATUSES.join(', ')}`);
      const probe = { terms: change.terms ?? { x: 'x' }, ...(change.avoid ? { avoid: change.avoid } : {}), ...(change.note ? { note: change.note } : {}) };
      if (change.terms !== undefined || change.avoid !== undefined || change.note) {
        const errors = newEntryErrors(probe, `/entries/${id}`);
        if (errors.length > 0) throw new HttpError(422, 'invalid', 'the change was not taken', { errors });
      }
      return glossaryWrite(writeGlossary(root, (g) => {
        const entry = g.entries.find((e) => e.id === id);
        if (!entry) return {};
        if (change.terms !== undefined) entry.terms = change.terms;
        if (change.avoid !== undefined) { if (change.avoid && Object.keys(change.avoid).length > 0) entry.avoid = change.avoid; else delete entry.avoid; }
        if (Object.hasOwn(change, 'note')) { if (change.note) entry.note = change.note; else delete entry.note; }
        if (b.status !== undefined) entry.status = b.status;
        return { glossary: g };
      }, { expectedRev: b.rev ?? null }));
    }],
    ['DELETE', '/api/glossary/entries/:id', ({ params, query }) => {
      const id = entryOf(params.id);
      return glossaryWrite(writeGlossary(root, (g) => ({ glossary: { ...g, entries: g.entries.filter((e) => e.id !== id) } }), { expectedRev: revParam(query.get('rev')) ?? null }));
    }],
    ['GET', '/api/glossary/check', ({ query }) => {
      const run = query.get('run');
      if (!runPath(root, run)) throw notFound();
      const result = checkRuns(root, [runPath(root, run)]);
      if (!result.ok) return { body: { ok: false, code: result.code, errors: result.errors } };
      return { body: { ok: true, report: result.report } };
    }],
    ['POST', '/agent/shutdown', () => ({ body: { ok: true }, after: () => options.onShutdown?.() })],
    ...(jobs ? jobs.routes({ root, bump, HttpError, notFound, body }) : []),
  ].map(([method, pattern, handler]) => ({ method, pattern, handler, ...compile(pattern) }));

  const METHODS = new Set(routes.map((r) => r.method));

  const send = (res, status, payload, extraHeaders = {}) => {
    const isRaw = Buffer.isBuffer(payload);
    const bytes = isRaw ? payload : Buffer.from(JSON.stringify(payload));
    res.writeHead(status, {
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY',
      'Content-Security-Policy': API_CSP,
      ...(isRaw ? {} : { 'Content-Type': 'application/json; charset=utf-8' }),
      'Content-Length': bytes.length,
      ...extraHeaders,
    });
    res.end(bytes);
  };
  const refuse = (res, status, code, message, extra = {}) => send(res, status, { error: { code, message, ...extra } });

  const readBody = (req) => new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { rejectBody(new HttpError(413, 'too-large', `a body is at most ${MAX_BODY} bytes`)); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolveBody(Buffer.concat(chunks)));
    req.on('error', rejectBody);
  });

  async function handle(req, res) {
    const started = now();
    let pattern = 'unmatched';
    const done = (status) => log({ method: req.method, route: pattern, status, ms: now() - started });
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (req.method === 'OPTIONS') { refuse(res, 403, 'forbidden', 'cross-origin requests are not served'); return done(403); }
    if (!METHODS.has(req.method)) { refuse(res, 405, 'method', 'method not allowed'); return done(405); }
    const bad = originError(req.headers);
    if (bad) { refuse(res, 403, 'forbidden', bad); return done(403); }
    if (closing) { refuse(res, 503, 'closing', 'the server is shutting down'); return done(503); }
    const path = url.pathname;
    if (path === '/health') {
      pattern = '/health';
      if (req.method !== 'GET') { refuse(res, 405, 'method', 'method not allowed'); return done(405); }
      const nonce = url.searchParams.get('nonce') ?? '';
      send(res, 200, { app: APP, version, jobOpen: jobs ? jobs.open() : false, proof: tokenOf() ? proofOf(tokenOf(), nonce) : null });
      return done(200);
    }
    const isApi = path.startsWith('/api/') || path.startsWith('/agent/');
    if (!isApi) {
      pattern = 'static';
      if (req.method !== 'GET') { refuse(res, 405, 'method', 'method not allowed'); return done(405); }
      const page = pages.get(path) ?? (path === '/' && pages.size === 0 ? { type: TYPES['.html'], bytes: NO_PAGES } : undefined);
      if (!page) { refuse(res, 404, 'not-found', 'no such page'); return done(404); }
      send(res, 200, page.bytes, { 'Content-Type': page.type, 'Content-Security-Policy': options.pageCsp?.(path) ?? CONSOLE_CSP });
      return done(200);
    }
    if (!sameToken(req.headers['x-zukai-token'], tokenOf())) { refuse(res, 403, 'forbidden', 'the token is missing or wrong', { hint: 'open the URL that labs status prints' }); return done(403); }
    lastActivity = now();
    const route = routes.find((r) => r.method === req.method && r.re.test(path)) ?? routes.find((r) => r.re.test(path));
    if (!route) { refuse(res, 404, 'not-found', 'no such resource'); return done(404); }
    pattern = route.pattern;
    if (route.method !== req.method) { refuse(res, 405, 'method', 'method not allowed'); return done(405); }
    const match = route.re.exec(path);
    const params = {};
    for (const [i, name] of route.names.entries()) {
      const value = decode(match[i + 1]);
      if (value === undefined) { refuse(res, 404, 'not-found', 'no such resource'); return done(404); }
      params[name] = value;
    }
    try {
      const raw = await readBody(req);
      if (raw.length > 0) {
        const type = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
        if (type !== 'application/json') throw new HttpError(415, 'media-type', 'a body must be application/json');
        try { req.body = JSON.parse(raw.toString('utf8')); } catch { throw new HttpError(400, 'bad-request', 'the body is not valid JSON'); }
      }
      const out = await route.handler({ req, res, params, query: url.searchParams });
      if (out?.held) return out.held(done);
      if (out?.raw) {
        send(res, 200, out.raw, { 'Content-Type': out.type, 'Content-Disposition': `attachment; filename="${out.name.replace(/[^\w.-]/g, '_')}"` });
        done(200);
      } else {
        send(res, out?.status ?? 200, out?.body ?? { ok: true });
        done(out?.status ?? 200);
      }
      out?.after?.();
    } catch (error) {
      if (error instanceof HttpError) { refuse(res, error.status, error.code, error.message, error.extra); return done(error.status); }
      log({ method: req.method, route: pattern, error: errorFacts(error) });
      refuse(res, 500, 'internal', 'the server could not answer; see .zukai/labs/server.log');
      return done(500);
    }
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((error) => {
      log({ route: 'handler', error: errorFacts(error) });
      try { refuse(res, 500, 'internal', 'the server could not answer'); } catch { /* already sent */ }
    });
  });
  server.keepAliveTimeout = 5000;
  // A held call of the agent lasts up to nine minutes: the server must not cut it first.
  server.requestTimeout = 0;
  server.headersTimeout = 60_000;

  return {
    server,
    root,
    touch: () => { lastActivity = now(); },
    idleFor: () => now() - lastActivity,
    isIdle: () => now() - lastActivity >= idleMs && !(jobs?.busy() ?? false),
    beginClose: () => { closing = true; jobs?.release(); },
    bump,
  };
}
