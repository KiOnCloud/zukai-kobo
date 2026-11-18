/**
 * The labs server's request rules on a real listener: the token, the Host and Origin checks,
 * the headers of every answer, the parameters looked up in listings, a log that holds no
 * content, and a tree under diagrams/ that no request changes.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { request as httpRequest } from 'node:http';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLabsServer, makeLogger, CONSOLE_CSP, proofOf, originError, viewerScriptHash } from '../src/labs-server.mjs';
import { cleanForViewer } from '../src/labs-runs.mjs';
import { readGlossary } from '../src/glossary.mjs';
import { createJobs } from '../src/labs-jobs.mjs';
import { labsProject, hashTree } from './labs-project.mjs';

const TOKEN = 'test-token-0123456789abcdefghijklmnopqrstuv';
const VIEWER_PAGE = '<!doctype html><title>v</title><div id="drawing"></div><script>window.parent.postMessage({ ready: true }, "*");</script>';
const p = labsProject();
const logDir = mkdtempSync(join(tmpdir(), 'zukai-labs-log-'));
const logPath = join(logDir, 'server.log');
let labs;
let port;

function raw({ method = 'GET', path, headers = {}, body, token = TOKEN, host }) {
  return new Promise((done, failed) => {
    const payload = body === undefined ? undefined : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    const req = httpRequest({ host: '127.0.0.1', port, method, path, agent: false, headers: {
      Host: host ?? `127.0.0.1:${port}`,
      ...(token ? { 'X-Zukai-Token': token } : {}),
      ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
      ...headers,
    } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json;
        try { json = JSON.parse(text); } catch { /* not JSON */ }
        done({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('error', failed);
    if (payload) req.write(payload);
    req.end();
  });
}

const IR = JSON.parse(readFileSync(join(p.root, 'diagrams', p.runs.login, 'source', 'login-flow.ir.json'), 'utf8'));
/** One valid request per route of the read API and the glossary. */
const ROUTES = () => [
  { method: 'GET', path: '/api/state' },
  { method: 'GET', path: '/api/runs' },
  { method: 'GET', path: `/api/runs/${p.runs.checkout}` },
  { method: 'GET', path: `/api/runs/${p.runs.checkout}/diagrams/checkout` },
  { method: 'GET', path: `/api/runs/${p.runs.checkout}/doc?lang=ja` },
  { method: 'GET', path: `/api/runs/${p.runs.checkout}/diagrams/checkout/picture` },
  { method: 'GET', path: `/api/runs/${p.runs.checkout}/revisions/r001/changes` },
  { method: 'GET', path: `/api/runs/${p.runs.checkout}/files/${encodeURIComponent('svg/checkout.drawio.svg')}` },
  { method: 'GET', path: `/api/runs/${p.runs.checkout}/files/${encodeURIComponent('checkout.drawio')}/view` },
  { method: 'POST', path: '/api/validate', body: { ir: IR } },
  { method: 'GET', path: '/api/glossary' },
  { method: 'POST', path: '/api/glossary/entries', body: { entries: [{ terms: { en: 'desk' } }], rev: 'stale' } },
  { method: 'PATCH', path: '/api/glossary/entries/g-7e0b7e28', body: { status: 'suggested', rev: 'stale' } },
  { method: 'DELETE', path: '/api/glossary/entries/g-7e0b7e28?rev=stale' },
  { method: 'GET', path: `/api/glossary/check?run=${p.runs.login}` },
  { method: 'GET', path: '/api/jobs' },
  { method: 'POST', path: '/api/jobs', body: { kind: 'sync', params: { run: 'nope' } } },
  { method: 'GET', path: '/api/jobs/j-none' },
  { method: 'POST', path: '/api/jobs/j-none/cancel' },
  { method: 'GET', path: `/agent/holds?run=${p.runs.checkout}` },
  { method: 'POST', path: '/agent/jobs/j-none/progress', body: { session: 's-abcdefghijkl', message: 'x' } },
];

beforeAll(async () => {
  const pages = new Map([['/index.html', { type: 'text/html; charset=utf-8', bytes: Buffer.from('<!doctype html><title>t</title>') }], ['/viewer.html', { type: 'text/html; charset=utf-8', bytes: Buffer.from(VIEWER_PAGE) }]]);
  pages.set('/', pages.get('/index.html'));
  const jobs = createJobs({ root: p.root });
  jobs.started();
  labs = createLabsServer({ root: p.root, token: TOKEN, pages, version: '0.0.0-test', instance: 'test', log: makeLogger(logPath), jobs });
  await new Promise((r) => labs.server.listen(0, '127.0.0.1', r));
  port = labs.server.address().port;
});
afterAll(() => new Promise((r) => labs.server.close(r)));

describe('request checks', () => {
  it.each(ROUTES().map((r) => [`${r.method} ${r.path}`, r]))('%s needs the token, this host and this origin', async (_, r) => {
    expect((await raw({ ...r, token: null })).status).toBe(403);
    expect((await raw({ ...r, token: 'wrong' })).status).toBe(403);
    expect((await raw({ ...r, host: 'evil.example:80' })).status).toBe(403);
    expect((await raw({ ...r, host: `127.0.0.1.evil.example:${port}` })).status).toBe(403);
    expect((await raw({ ...r, headers: { Origin: 'http://evil.example' } })).status).toBe(403);
    expect((await raw({ ...r, headers: { 'Sec-Fetch-Site': 'cross-site' } })).status).toBe(403);
    expect((await raw({ ...r, method: 'OPTIONS' })).status).toBe(403);
    const ok = await raw(r);
    expect([200, 404, 409, 422]).toContain(ok.status);
    expect(ok.headers['access-control-allow-origin']).toBeUndefined();
    expect(ok.headers['x-frame-options']).toBe('DENY');
    expect(ok.headers['x-content-type-options']).toBe('nosniff');
    expect(ok.headers['referrer-policy']).toBe('no-referrer');
    expect(ok.headers['cache-control']).toBe('no-store');
  });

  it('takes localhost and any port in Host, and the origin of that Host', async () => {
    expect((await raw({ path: '/api/state', host: 'localhost:9999' })).status).toBe(200);
    expect((await raw({ path: '/api/state', headers: { Origin: `http://127.0.0.1:${port}`, 'Sec-Fetch-Site': 'same-origin' } })).status).toBe(200);
    expect(originError({ host: 'LOCALHOST:1' })).toBeUndefined();
    expect(originError({})).toBeDefined();
  });

  it('refuses a body that is not JSON, and one over 1 MB', async () => {
    const text = await raw({ method: 'POST', path: '/api/validate', body: '{"ir":{}}', headers: { 'Content-Type': 'text/plain' } });
    expect(text.status).toBe(415);
    const big = await raw({ method: 'POST', path: '/api/validate', body: JSON.stringify({ ir: 'x'.repeat(1024 * 1024 + 10) }) }).catch((e) => ({ status: e.code }));
    expect([413, 'ECONNRESET', 'EPIPE']).toContain(big.status);
  });

  it('serves the pages with the console policy, character for character, and refuses to be framed', async () => {
    const page = await raw({ path: '/', token: null });
    expect(page.status).toBe(200);
    expect(page.headers['content-security-policy']).toBe("default-src 'none'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; font-src 'self'; connect-src 'self'; img-src 'self' blob: data:; frame-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    expect(page.headers['content-security-policy']).toBe(CONSOLE_CSP);
    expect(page.headers['x-frame-options']).toBe('DENY');
    expect((await raw({ path: '/index.html', host: 'evil.example' })).status).toBe(403);
    expect((await raw({ path: '/nothing.js', token: null })).status).toBe(404);
    expect((await raw({ method: 'POST', path: '/', token: null })).status).toBe(405);
  });

  it('answers health with the proof of the token and nothing of the project', async () => {
    const h = await raw({ path: '/health?nonce=abc', token: null });
    expect(h.json).toEqual({ app: 'zukai-labs', version: '0.0.0-test', jobOpen: false, proof: proofOf(TOKEN, 'abc') });
  });
});

describe('parameters', () => {
  const bad = ['..', '%2E%2E', '%2Fetc%2Fhosts', '20261113_link', 'notes', '20261114_file', 'nope', '%ZZ'];
  it.each(bad)('a run named %s is 404 on every run route', async (name) => {
    for (const path of [`/api/runs/${name}`, `/api/runs/${name}/diagrams/secret`, `/api/runs/${name}/diagrams/secret/picture`, `/api/runs/${name}/doc`, `/api/runs/${name}/revisions/r001/changes`, `/api/runs/${name}/files/outside.txt`, `/api/glossary/check?run=${name}`]) {
      expect((await raw({ path })).status, path).toBe(404);
    }
  });

  it('looks up diagrams, revisions, languages, files and entries in listings', async () => {
    const run = `/api/runs/${p.runs.checkout}`;
    for (const path of [
      `${run}/diagrams/..%2Fcheckout`, `${run}/diagrams/checkout.ir.json`, `${run}/diagrams/nope`, `${run}/diagrams/nope/picture`, `${run}/diagrams/..%2Fcheckout/picture`,
      `${run}/doc?lang=fr`, `${run}/doc?lang=..`,
      `${run}/revisions/r999/changes`, `${run}/revisions/..%2Fr001/changes`,
      `${run}/files/${encodeURIComponent('../20261109_login-flow/source/login-flow.ir.json')}`,
      `${run}/files/${encodeURIComponent('/etc/hosts')}`, `${run}/files/source%2Fleak.txt`,
      `${run}/files/${encodeURIComponent('history/r001/revision.json')}`, `${run}/files/..`,
    ]) expect((await raw({ path })).status, path).toBe(404);
    for (const method of ['PATCH', 'DELETE']) expect((await raw({ method, path: '/api/glossary/entries/g-00000000', body: method === 'PATCH' ? { status: 'confirmed' } : undefined })).status).toBe(404);
  });

  it('sends a listed file as an attachment', async () => {
    const r = await raw({ path: `/api/runs/${p.runs.checkout}/files/${encodeURIComponent('svg/checkout.drawio.svg')}` });
    expect(r.status).toBe(200);
    expect(r.headers['content-disposition']).toBe('attachment; filename="checkout.drawio.svg"');
    expect(r.headers['content-type']).toBe('image/svg+xml');
  });
});

describe('the glossary routes', () => {
  it('writes through the store and answers 409 when the rev no longer matches', async () => {
    const { rev } = (await raw({ path: '/api/glossary' })).json;
    const added = await raw({ method: 'POST', path: '/api/glossary/entries', body: { entries: [{ terms: { en: 'desk', vi: 'bàn' } }], rev } });
    expect(added.status).toBe(200);
    expect(added.json.added).toHaveLength(1);
    expect((await raw({ method: 'POST', path: '/api/glossary/entries', body: { entries: [{ terms: { en: 'chair' } }], rev } })).status).toBe(409);
    const id = added.json.added[0];
    const edited = await raw({ method: 'PATCH', path: `/api/glossary/entries/${id}`, body: { rev: added.json.rev, terms: { en: 'desk', vi: 'bàn làm việc' }, status: 'confirmed' } });
    expect(edited.status).toBe(200);
    expect(readGlossary(p.root).glossary.entries.find((e) => e.id === id)).toMatchObject({ terms: { vi: 'bàn làm việc' }, status: 'confirmed' });
    expect((await raw({ method: 'PATCH', path: `/api/glossary/entries/${id}`, body: { rev: edited.json.rev, terms: { en: 'x'.repeat(81) } } })).status).toBe(422);
    expect((await raw({ method: 'DELETE', path: `/api/glossary/entries/${id}?rev=${edited.json.rev}` })).status).toBe(200);
    expect(readGlossary(p.root).glossary.entries.some((e) => e.id === id)).toBe(false);
  });

  it('checks one run', async () => {
    const r = await raw({ path: `/api/glossary/check?run=${p.runs.login}` });
    expect(r.json).toMatchObject({ ok: true, report: { ok: false, blocking: 1 } });
  });
});

describe('what the server never does', () => {
  it('changes no file under diagrams/, whatever the request', async () => {
    const before = hashTree(join(p.root, 'diagrams'));
    for (const r of ROUTES()) {
      await raw(r);
      await raw({ ...r, token: null });
      await raw({ ...r, body: '{broken', headers: { 'Content-Type': 'application/json' } });
    }
    await raw({ method: 'POST', path: '/api/validate', body: { ir: { kind: 'flowchart' } } });
    expect(hashTree(join(p.root, 'diagrams'))).toEqual(before);
  });

  it('logs no body, query string, message or token', async () => {
    const marker = 'MARKER-7f3a';
    await raw({ method: 'POST', path: '/api/validate', body: `{"ir": "${marker}`, headers: { 'Content-Type': 'application/json' } });
    await raw({ method: 'POST', path: '/api/validate', body: { ir: { kind: marker } } });
    await raw({ path: `/api/runs/${marker}?q=${marker}` });
    await raw({ path: `/api/glossary/check?run=${marker}`, token: `${marker}-token` });
    expect(existsSync(logPath)).toBe(true);
    const log = readFileSync(logPath, 'utf8');
    expect(log).not.toContain(marker);
    expect(log).not.toContain(TOKEN);
    expect(log).toMatch(/"route":"\/api\/runs\/:run","status":404/);
  });
});

describe('the viewer frame', () => {
  it('sends the viewer page sandboxed, framed by the console alone, its one script allowed by hash', async () => {
    const page = await raw({ path: '/viewer.html', token: null });
    expect(page.status).toBe(200);
    const hash = viewerScriptHash(VIEWER_PAGE);
    expect(page.headers['content-security-policy']).toBe(`sandbox allow-scripts; default-src 'none'; script-src 'sha256-${hash}' https://viewer.diagrams.net https://cdn.jsdelivr.net/npm/mermaid@12.3.0/; style-src 'unsafe-inline'; img-src data: blob:; connect-src https://viewer.diagrams.net; frame-ancestors 'self'`);
    expect(page.headers['x-frame-options']).toBe('SAMEORIGIN');
  });

  it('refuses a call from inside the frame, whose Origin is null', async () => {
    expect((await raw({ path: '/api/state', headers: { Origin: 'null' } })).status).toBe(403);
  });

  it('gives the picture of a diagram without data links or foreign picture addresses', async () => {
    const r = await raw({ path: `/api/runs/${p.runs.checkout}/diagrams/checkout/picture` });
    expect(r.json).toMatchObject({ ok: true, kind: 'drawio', from: 'source/checkout.ir.json' });
    expect(r.json.text).toContain('<mxfile');
    const cleaned = cleanForViewer('<mxCell style="shape=image;image=https://evil.example/x.png;html=1" value="&lt;img src=&quot;https://evil.example/t.gif&quot;&gt;ok"/><mxCell style="image=data:image/png,AAA;"/><UserObject label="a" link="data:page/id,x">');
    expect(cleaned).not.toContain('evil.example');
    expect(cleaned).not.toContain('link="data:');
    expect(cleaned).toContain('image=data:image/png,AAA;');
  });
});

describe('files of .zukai that came with a clone', () => {
  it('never writes, truncates or follows a log that is a link', async () => {
    const { mkdtempSync: md, writeFileSync, symlinkSync, statSync } = await import('node:fs');
    const dir = md(join(tmpdir(), 'zukai-log-link-'));
    const target = join(dir, 'user-file.txt');
    writeFileSync(target, 'x'.repeat(1024 * 1024 + 10));
    const link = join(dir, 'server.log');
    try { symlinkSync(target, link); } catch { return; }
    makeLogger(link)({ event: 'started' });
    expect(statSync(target).size).toBe(1024 * 1024 + 10);
  });
});

describe('a file of a run shown in place', () => {
  it('gives the pages of a draw.io file, the text of a small text file, and refuses anything else', async () => {
    const run = `/api/runs/${p.runs.checkout}/files`;
    const drawio = await raw({ path: `${run}/${encodeURIComponent('checkout.drawio')}/view` });
    expect(drawio.json).toMatchObject({ ok: true, kind: 'drawio', more: 0 });
    expect(drawio.json.pages[0]).toMatchObject({ name: 'Checkout' });
    const text = await raw({ path: `${run}/${encodeURIComponent('source/checkout.sources.json')}/view` });
    expect(text.json).toMatchObject({ ok: true, kind: 'text' });
    expect((await raw({ path: `${run}/${encodeURIComponent('svg/checkout.drawio.svg')}/view` })).status).toBe(415);
    expect((await raw({ path: `${run}/${encodeURIComponent('source/leak.txt')}/view` })).status).toBe(404);
    expect((await raw({ path: `${run}/${encodeURIComponent('../20261109_login-flow/source/login-flow.ir.json')}/view` })).status).toBe(404);
  });
});
