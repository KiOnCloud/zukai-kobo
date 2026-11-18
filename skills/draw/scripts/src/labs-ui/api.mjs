/**
 * The console's calls to its server, with the token in `X-Zukai-Token`. The token is read
 * once from the URL fragment (`#t=<token>`), kept for the tab in memory and in session
 * storage, and removed from the address bar. Every result is a value: `{ ok, status, data }`
 * or `{ ok: false, status, error }`; nothing throws.
 */

const KEY = 'zukai-labs-token';
let token = null;

const storage = () => { try { return window.sessionStorage; } catch { return null; } };

/** Take the token from the fragment, or from the tab's storage; returns it or null. */
export function readToken(win = window) {
  const m = /(?:^#|&)t=([A-Za-z0-9_-]{20,128})(?:&|$)/.exec(win.location.hash);
  if (m) {
    token = m[1];
    try { storage()?.setItem(KEY, token); } catch { /* storage refused */ }
    win.history.replaceState(null, '', `${win.location.pathname}#/overview`);
    return token;
  }
  try { token = storage()?.getItem(KEY) ?? null; } catch { token = null; }
  return token;
}

export const hasToken = () => token !== null;
export const setTokenForTests = (value) => { token = value; };

/** Listeners for a 403: the server was started again and the token is no longer valid. */
const forbidden = new Set();
export const onForbidden = (fn) => { forbidden.add(fn); return () => forbidden.delete(fn); };

async function call(method, path, body, as = 'json') {
  if (!token) return { ok: false, status: 0, error: { code: 'no-token', message: 'The console has no token.' } };
  let res;
  try {
    res = await fetch(path, { method, headers: { 'X-Zukai-Token': token, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined, cache: 'no-store', credentials: 'omit' });
  } catch {
    return { ok: false, status: 0, error: { code: 'offline', message: 'The console server did not answer.' } };
  }
  if (res.status === 403) for (const fn of [...forbidden]) fn();
  if (as === 'blob' && res.ok) return { ok: true, status: res.status, data: await res.blob() };
  let data = null;
  try { data = await res.json(); } catch { /* no JSON */ }
  if (res.ok) return { ok: true, status: res.status, data };
  return { ok: false, status: res.status, error: data?.error ?? { code: 'error', message: `The server answered ${res.status}.` } };
}

export const api = {
  get: (path) => call('GET', path),
  post: (path, body) => call('POST', path, body ?? {}),
  patch: (path, body) => call('PATCH', path, body),
  put: (path, body) => call('PUT', path, body),
  del: (path) => call('DELETE', path),
  blob: (path) => call('GET', path, undefined, 'blob'),
};

/** A path with each part encoded, so a name never changes the route. */
export const path = (strings, ...parts) => strings.reduce((out, s, i) => out + s + (i < parts.length ? encodeURIComponent(parts[i]) : ''), '');
