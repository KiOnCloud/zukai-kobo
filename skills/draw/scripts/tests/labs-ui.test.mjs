/**
 * The console's modules in jsdom, against a stand-in API: text from the server never becomes
 * markup, the token is read once and sent as a header, the job panel shows a question card
 * and sends its answers in one request, a failed job says why and offers the undo, and the
 * page without a token makes no call.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scriptsDir } from './helpers.mjs';

const ui = join(scriptsDir, 'src', 'labs-ui');
const MARKUP = '<img src=x onerror="window.pwned=1">';
let dom;
let calls;
let routes;
let mods;

const respond = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const flush = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };

beforeAll(async () => {
  dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'http://127.0.0.1:4999/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  for (const key of ['window', 'document', 'Node', 'HTMLElement', 'Event', 'history', 'location', 'navigator']) {
    Object.defineProperty(globalThis, key, { value: key === 'window' ? w : w[key], configurable: true, writable: true });
  }
  w.eval(readFileSync(join(ui, 'sienna', 'bundle.js'), 'utf8'));
  globalThis.fetch = async (path, init = {}) => {
    calls.push({ path, method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body ? JSON.parse(init.body) : undefined });
    const route = routes.find(([method, re]) => method === (init.method ?? 'GET') && re.test(path));
    return route ? route[2](path, init) : respond(404, { error: { code: 'not-found', message: 'no such resource' } });
  };
  mods = {
    dom: await import('../src/labs-ui/dom.mjs'),
    store: await import('../src/labs-ui/store.mjs'),
    api: await import('../src/labs-ui/api.mjs'),
    panel: await import('../src/labs-ui/views/job-panel.mjs'),
    runs: await import('../src/labs-ui/views/runs-list.mjs'),
    detail: await import('../src/labs-ui/views/run-detail.mjs'),
    main: await import('../src/labs-ui/main.mjs'),
    words: await import('../src/labs-ui/words.mjs'),
  };
});

beforeEach(() => {
  calls = [];
  routes = [];
  mods.api.setTokenForTests('t'.repeat(43));
  document.body.innerHTML = '<div id="app"></div>';
  delete window.pwned;
});

describe('dom', () => {
  it('puts text in as text and drops what would run or style', () => {
    const { h } = mods.dom;
    const node = h('div', { class: 'x', style: 'color: red', onclick: 'alert(1)', href: 'javascript:alert(1)', 'aria-label': MARKUP }, MARKUP, h('a', { href: 'https://evil.example' }, 'x'), h('a', { href: '#/diagrams' }, 'y'));
    expect(node.querySelector('img')).toBeNull();
    expect(node.textContent).toContain(MARKUP);
    expect(node.getAttribute('style')).toBeNull();
    expect(node.getAttribute('onclick')).toBeNull();
    expect(node.getAttribute('href')).toBeNull();
    expect(node.querySelectorAll('a')[0].getAttribute('href')).toBeNull();
    expect(node.querySelectorAll('a')[1].getAttribute('href')).toBe('#/diagrams');
  });

  it('keeps markup as text through every Sienna helper the console uses', () => {
    const S = window.Sienna;
    const nodes = [S.Badge({ label: MARKUP }), S.Button({ label: MARKUP }), S.Alert({ title: MARKUP, body: MARKUP }), S.Card({ title: MARKUP, body: MARKUP, eyebrow: MARKUP }), S.Input({ label: MARKUP, helper: MARKUP, value: MARKUP }),
      S.Select({ label: MARKUP, options: [{ value: MARKUP, label: MARKUP }] }), S.Radio({ label: MARKUP, options: [{ value: 'a', label: MARKUP, description: MARKUP }] }), S.Checkbox({ label: MARKUP, description: MARKUP }),
      S.Table({ caption: MARKUP, columns: [{ key: 'a', label: MARKUP }], rows: [{ a: MARKUP }] }), S.Tabs({ items: [{ value: 'a', label: MARKUP }], panel: false }), S.Menu({ items: [{ label: MARKUP }] })];
    for (const n of nodes) {
      expect(n.querySelector('img')).toBeNull();
      expect(n.textContent).toContain(MARKUP);
    }
    const d = S.Dialog({ title: MARKUP, body: MARKUP });
    expect(d.element.querySelector('img')).toBeNull();
    d.element.remove();
  });
});

describe('store and api', () => {
  it('tells every subscriber of a change', () => {
    const s = mods.store.createStore({ a: 1 });
    const seen = [];
    const off = s.subscribe((x) => seen.push(x.a));
    s.set({ a: 2 });
    off();
    s.set({ a: 3 });
    expect(seen).toEqual([2]);
    expect(s.get().a).toBe(3);
  });

  it('reads the token from the fragment once, keeps it for the tab and removes it from the address bar', () => {
    const w = new JSDOM('', { url: `http://127.0.0.1:4999/#t=${'a'.repeat(43)}` }).window;
    expect(mods.api.readToken(w)).toBe('a'.repeat(43));
    expect(w.location.hash).toBe('#/diagrams');
    expect(w.sessionStorage.getItem('zukai-labs-token') ?? window.sessionStorage.getItem('zukai-labs-token')).toBe('a'.repeat(43));
  });

  it('sends the token as a header, gives errors as values and tells a 403', async () => {
    routes = [['GET', /\/api\/state/, () => respond(403, { error: { code: 'forbidden', message: 'no' } })]];
    let told = 0;
    const off = mods.api.onForbidden(() => { told += 1; });
    const r = await mods.api.api.get('/api/state');
    off();
    expect(r).toMatchObject({ ok: false, status: 403, error: { code: 'forbidden' } });
    expect(calls[0].headers['X-Zukai-Token']).toBe('t'.repeat(43));
    expect(told).toBe(1);
    expect(mods.api.path`/api/runs/${'a/../b'}`).toBe('/api/runs/a%2F..%2Fb');
  });
});

const askJob = {
  id: 'j1', kind: 'revise', run: '20261110_checkout', state: 'needs-input', params: { request: MARKUP }, progress: [{ message: MARKUP }], silent: false, revisionsSince: [],
  ask: { id: 'pick-1', body: `Draft A ${MARKUP}`, attachments: [{ kind: 'run', name: 'drafts/a/changes.diff.drawio' }], questions: [1, 2, 3].map((n) => ({ header: `Q${n}`, question: `Question ${n} ${MARKUP}`, options: [{ label: 'A', description: MARKUP }, { label: 'B', description: 'b' }], multiSelect: false })) },
};

describe('the job panel', () => {
  it('shows a question card with its body and three questions as text, and sends three answers in one request', async () => {
    routes = [
      ['GET', /\/api\/jobs\/j1$/, () => respond(200, askJob)],
      ['GET', /\/api\/jobs$/, () => respond(200, { jobs: [] })],
      ['POST', /\/api\/jobs\/j1\/answer$/, () => respond(200, { ok: true })],
    ];
    const store = mods.store.createStore({ asking: false });
    const panel = mods.panel.createJobPanel({ store });
    document.body.appendChild(panel.element);
    await panel.render({ agent: { attached: true, waiting: false, lastContact: new Date().toISOString() }, jobs: { queued: 0, queue: [], open: { id: 'j1', kind: 'revise', run: '20261110_checkout', state: 'needs-input', silent: false } } });
    expect(store.get().asking).toBe(true);
    expect(panel.element.querySelector('img')).toBeNull();
    expect(panel.element.textContent).toContain(`Draft A ${MARKUP}`);
    expect(panel.element.querySelectorAll('fieldset')).toHaveLength(3);
    expect(panel.element.querySelectorAll('.sn-btn-accent')).toHaveLength(1);
    const radios = [...panel.element.querySelectorAll('fieldset')].map((f) => f.querySelectorAll('input[type=radio]'));
    radios[0][1].click(); radios[0][1].dispatchEvent(new window.Event('change', { bubbles: true }));
    radios[1][0].click(); radios[1][0].dispatchEvent(new window.Event('change', { bubbles: true }));
    const other = panel.element.querySelectorAll('fieldset')[2].querySelector('input.sn-input');
    other.value = 'neither';
    other.dispatchEvent(new window.Event('input', { bubbles: true }));
    panel.element.querySelector('.sn-btn-accent').click();
    await flush();
    const sent = calls.filter((c) => c.method === 'POST');
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toEqual({ id: 'pick-1', answers: [{ selected: ['B'] }, { selected: ['A'] }, { selected: [], other: 'neither' }] });
    expect(window.pwned).toBeUndefined();
  });

  it('says why a job failed and offers the undo to the first revision it wrote', async () => {
    const failed = { id: 'j2', kind: 'revise', run: '20261110_checkout', state: 'failed', reason: 'server-stopped', report: null, finishedAt: new Date().toISOString(), revisionsSince: ['r003', 'r004'], params: {} };
    routes = [['GET', /\/api\/jobs$/, () => respond(200, { jobs: [failed] })], ['GET', /\/api\/jobs\/j2$/, () => respond(200, failed)]];
    const panel = mods.panel.createJobPanel({ store: mods.store.createStore({}) });
    await panel.render({ agent: { attached: false }, jobs: { queued: 0, queue: [], open: null } });
    const text = panel.element.textContent;
    expect(text).toContain(mods.words.REASON['server-stopped']);
    expect(text).toContain('Revisions written while this job ran: r003, r004');
    expect([...panel.element.querySelectorAll('button')].some((b) => b.textContent === 'Undo to r003')).toBe(true);
  });

  it('shows a queued job under "No agent attached", with words and no bare spinner', async () => {
    routes = [['GET', /\/api\/jobs$/, () => respond(200, { jobs: [] })]];
    const panel = mods.panel.createJobPanel({ store: mods.store.createStore({}) });
    await panel.render({ agent: { attached: false, waiting: false, lastContact: null }, jobs: { queued: 1, queue: [{ id: 'j3', kind: 'sync', run: 'r' }], open: null } });
    expect(panel.element.textContent).toContain('No agent attached');
    expect(panel.element.textContent).toContain(mods.words.ATTACH_HINT);
    expect(panel.element.textContent).toContain('Queue (1)');
    expect(panel.element.querySelector('.sn-spinner')).toBeNull();
  });
});

describe('views', () => {
  const runRow = { run: '20261110_checkout', date: '2026-11-10', slug: 'checkout', title: MARKUP, origin: 'scout', diagrams: [{ id: 'checkout', kind: 'flowchart', title: MARKUP }], targets: ['drawio'], revisions: 2, variants: [], scouted: false };
  it('lists runs with their titles as text', async () => {
    routes = [['GET', /\/api\/runs$/, () => respond(200, { runs: [runRow] })]];
    const view = mods.runs.runsList({ store: mods.store.createStore({}) });
    await flush();
    expect(view.element.querySelector('img')).toBeNull();
    expect(view.element.textContent).toContain(MARKUP);
    expect(view.element.querySelector('a[href="#/diagrams/20261110_checkout"]')).not.toBeNull();
  });

  it('hides the request composer while a question card is open, so one clay element is in view', async () => {
    routes = [['GET', /\/api\/runs\/20261110_checkout$/, () => respond(200, { ...runRow, files: [], revisions: [], undo: null, redo: null, stale: null })]];
    const store = mods.store.createStore({ asking: false });
    const view = mods.detail.runDetail({ store, run: '20261110_checkout' });
    await flush();
    expect(view.element.querySelectorAll('.sn-btn-accent')).toHaveLength(1);
    expect([...view.element.querySelectorAll('button')].find((b) => b.textContent === 'Undo').disabled).toBe(true);
    store.set({ asking: true });
    await flush();
    expect(view.element.querySelectorAll('.sn-btn-accent')).toHaveLength(0);
    expect(view.element.querySelectorAll('.sn-btn-primary').length).toBeLessThanOrEqual(1);
  });

  it('asks for the URL and calls nothing when the page has no token', () => {
    const page = mods.main.noTokenPage();
    expect(page.textContent).toContain('Open the console with its URL');
    expect(calls).toHaveLength(0);
  });
});
