/**
 * The CLI's side of the labs server: plain `node:http` requests to 127.0.0.1 with no timeout
 * of the client's own, so a held call of the agent is never cut by a default of the HTTP
 * client, and the proof that a server on a port is this project's before any token is sent.
 */
import { request as httpRequest } from 'node:http';
import { connect } from 'node:net';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { proofOf } from './labs-server.mjs';

/**
 * One request. Resolves `{ status, body }` (JSON parsed when it is JSON) or rejects with an
 * error whose `code` is the socket's (`ECONNREFUSED`, ...) or `ETIMEDOUT` when `timeout` ms passed.
 */
export function request(port, { method = 'GET', path, token, body, timeout } = {}) {
  return new Promise((resolveRequest, rejectRequest) => {
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const req = httpRequest({
      host: '127.0.0.1', port, method, path,
      headers: { Host: `127.0.0.1:${port}`, ...(token ? { 'X-Zukai-Token': token } : {}), ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}) },
      agent: false,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed = text;
        try { parsed = JSON.parse(text); } catch { /* not JSON */ }
        resolveRequest({ status: res.statusCode, body: parsed });
      });
      res.on('error', rejectRequest);
    });
    let timer;
    if (timeout) timer = setTimeout(() => { const e = new Error('timed out'); e.code = 'ETIMEDOUT'; req.destroy(e); }, timeout);
    req.on('error', (e) => { clearTimeout(timer); rejectRequest(e); });
    req.on('close', () => clearTimeout(timer));
    if (payload) req.write(payload);
    req.end();
  });
}

/** Whether anything listens on the port: `refused`, or `open` (a connection was taken or did not answer in time). */
export function probePort(port, timeout = 1000) {
  return new Promise((done) => {
    const socket = connect({ host: '127.0.0.1', port });
    const end = (state) => { socket.destroy(); done(state); };
    socket.setTimeout(timeout, () => end('open'));
    socket.on('connect', () => end('open'));
    socket.on('error', (e) => end(e.code === 'ECONNREFUSED' ? 'refused' : 'open'));
  });
}

const sameHex = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Ask the server on a port to prove it holds the token, without sending the token: a nonce
 * goes out and `HMAC-SHA256(token, nonce)` must come back. Retried for `within` ms, since a
 * large run can hold the server's event loop for a second.
 * @returns {Promise<{ state: 'proved', health: object } | { state: 'refused' } | { state: 'mismatch' } | { state: 'timeout' }>}
 */
export async function proveServer(port, token, { within = 5000 } = {}) {
  const until = Date.now() + within;
  let last = 'timeout';
  while (Date.now() < until) {
    const nonce = randomBytes(16).toString('hex');
    try {
      const r = await request(port, { path: `/health?nonce=${nonce}`, timeout: Math.max(200, Math.min(2000, until - Date.now())) });
      if (r.status === 200 && r.body && typeof r.body === 'object' && sameHex(r.body.proof, proofOf(token, nonce))) return { state: 'proved', health: r.body };
      last = 'mismatch';
      break;
    } catch (e) {
      if (e.code === 'ECONNREFUSED') return { state: 'refused' };
      last = 'timeout';
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return { state: last };
}

/** Wait until nothing listens on the port, up to `within` ms. */
export async function waitPortClosed(port, within = 5000) {
  const until = Date.now() + within;
  while (Date.now() < until) {
    if ((await probePort(port, 300)) === 'refused') return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

/**
 * A call of the agent to the project's server: read `server.json`, prove the server, then
 * send the request with the token. Errors come back with the codes of the bridge:
 * `no-server`, `not-this-project`, `session-refused`, `session-replaced`, `transport`,
 * `bad-request`.
 * @returns {Promise<{ ok: true, body: object } | { ok: false, error: { code: string, message: string, hint?: string } }>}
 */
export async function agentCall(file, { method = 'POST', path, body }) {
  if (!file) return { ok: false, error: { code: 'no-server', message: 'no labs server runs for this project', hint: 'run labs start' } };
  const proof = await proveServer(file.port, file.token);
  if (proof.state === 'refused') return { ok: false, error: { code: 'no-server', message: 'the labs server of this project stopped', hint: 'run labs start once' } };
  if (proof.state !== 'proved') return { ok: false, error: { code: 'not-this-project', message: `the program on port ${file.port} did not prove it is this project's console` } };
  let r;
  try {
    r = await request(file.port, { method, path, token: file.token, body });
  } catch (e) {
    return { ok: false, error: { code: e.code === 'ECONNREFUSED' ? 'no-server' : 'transport', message: `the call did not reach an answer (${e.code ?? 'error'})` } };
  }
  if (r.status >= 200 && r.status < 300) return { ok: true, body: r.body };
  const err = r.body?.error ?? {};
  const known = ['session-refused', 'session-replaced', 'no-server'];
  const code = known.includes(err.code) ? err.code : r.status >= 500 ? 'transport' : 'bad-request';
  return { ok: false, error: { code, message: err.message ?? `the server answered ${r.status}`, ...(err.errors ? { errors: err.errors } : {}), ...(err.lastContact ? { lastContact: err.lastContact } : {}) } };
}
