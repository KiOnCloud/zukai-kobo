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
    editor: await import('../src/labs-ui/views/model-editor.mjs'),
    glossary: await import('../src/labs-ui/views/glossary.mjs'),
    frame: await import('../src/labs-ui/viewer/frame.mjs'),
    nav: await import('../src/labs-ui/nav.mjs'),
    open: await import('../src/labs-ui/views/open-drawio.mjs'),
    create: await import('../src/labs-ui/views/new-diagram.mjs'),
    jobs: await import('../src/labs-ui/views/jobs.mjs'),
    overview: await import('../src/labs-ui/views/overview.mjs'),
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
    expect(w.location.hash).toBe('#/overview');
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

describe('Open in draw.io', () => {
  const EMBED = 'http://127.0.0.1:4100';
  const XML = '<mxfile><diagram id="checkout" name="Checkout"></diagram></mxfile>';
  const file = (name) => ({ name, size: 10, modified: '2026-11-18T00:00:00Z' });
  const row = { run: '20261110_checkout', date: '2026-11-10', slug: 'checkout', title: 'Checkout', origin: 'scout', diagrams: [{ id: 'checkout', kind: 'flowchart', title: 'Checkout' }], targets: ['drawio'], variants: [], scouted: false, revisions: [], undo: null, redo: null, stale: null };
  const withFiles = (files) => [['GET', /\/api\/runs\/20261110_checkout$/, () => respond(200, { ...row, files })], ['GET', /\/api\/runs\/20261110_checkout\/files\//, () => new Response(XML, { status: 200 })]];
  const buttons = (el, name) => [...el.querySelectorAll('button')].filter((b) => (b.getAttribute('aria-label') ?? b.textContent).trim() === name);
  const header = (el) => el.querySelector('header');
  let opened;
  let popup;
  beforeEach(() => {
    opened = [];
    popup = { posted: [], closed: false, postMessage(data, origin) { this.posted.push({ data: JSON.parse(data), origin }); }, close() { this.closed = true; } };
    window.open = (url, target) => { opened.push({ url, target }); return popup; };
  });

  it('is offered where a draw.io file is, and nowhere else', async () => {
    routes = withFiles([file('checkout.drawio'), file('drawio/checkout.drawio'), file('svg/old.drawio.svg'), file('source/checkout.ir.json'), file('drafts/a/changes.diff.drawio')]);
    const store = mods.store.createStore({ state: { drawio: { embed: EMBED } }, asking: false });
    const view = mods.detail.runDetail({ store, run: '20261110_checkout' });
    await flush();
    // One button per name: the header opens the run's combined file, Picture the diagram's own.
    expect(buttons(header(view.element), 'Open in draw.io')).toHaveLength(1);
    expect(buttons(view.element, 'Open in draw.io')).toHaveLength(1);
    const own = buttons(view.element.querySelector('[role="tabpanel"]'), 'Open this diagram in draw.io');
    expect(own).toHaveLength(1);
    expect(own[0].classList.contains('sn-btn-ghost')).toBe(true);
    // Secondary is Sienna's default variant: no class of its own, and not ghost.
    expect(buttons(header(view.element), 'Open in draw.io')[0].classList.contains('sn-btn-ghost')).toBe(false);
    const files = mods.detail.runDetail({ store, run: '20261110_checkout', tab: 'files' });
    await flush();
    expect(buttons(files.element, 'Open checkout.drawio in draw.io')).toHaveLength(2);
    expect(buttons(files.element, 'Open changes.diff.drawio in draw.io')).toHaveLength(1);
    expect(buttons(files.element, 'Open old.drawio.svg in draw.io')).toHaveLength(0);

    routes = withFiles([file('source/checkout.ir.json'), file('figjam/checkout.mmd')]);
    const none = mods.detail.runDetail({ store, run: '20261110_checkout' });
    await flush();
    expect(buttons(none.element, 'Open in draw.io')).toHaveLength(0);
    expect(buttons(none.element, 'Open this diagram in draw.io')).toHaveLength(0);
  });

  it('opens the embed page from the click, loads the file only for that window and origin, and downloads a save', async () => {
    routes = withFiles([file('checkout.drawio')]);
    const store = mods.store.createStore({ state: { drawio: { embed: EMBED } }, asking: false });
    const view = mods.detail.runDetail({ store, run: '20261110_checkout' });
    await flush();
    buttons(header(view.element), 'Open in draw.io')[0].click();
    expect(opened).toEqual([{ url: `${EMBED}/?embed=1&proto=json&spin=1&noExitBtn=1&saveAndExit=0`, target: '_blank' }]);
    const deliver = (data, { source = popup, origin = EMBED } = {}) => window.dispatchEvent(new window.MessageEvent('message', { data: JSON.stringify(data), origin, source }));
    deliver({ event: 'init' }, { source: window });
    deliver({ event: 'init' }, { origin: 'https://evil.example' });
    await flush();
    expect(popup.posted).toEqual([]);
    deliver({ event: 'init' });
    await flush();
    expect(popup.posted).toEqual([{ data: { action: 'load', xml: XML, title: 'checkout.drawio', autosave: 0 }, origin: EMBED }]);
    expect(calls.some((c) => c.path === '/api/runs/20261110_checkout/files/checkout.drawio')).toBe(true);
    deliver({ event: 'save', xml: '<mxfile id="edited"/>' }, { origin: 'https://evil.example' });
    expect(popup.posted).toHaveLength(1);
    deliver({ event: 'save', xml: '<mxfile id="edited"/>' });
    expect(popup.posted.at(-1)).toEqual({ data: { action: 'status', modified: false }, origin: EMBED });
    expect(header(view.element).textContent).toContain('checkout.drawio was downloaded');
    expect(header(view.element).textContent).toContain('diagrams/20261110_checkout/checkout.drawio');
  });

  it('says how to allow a blocked window, and that draw.io did not answer', async () => {
    const notice = document.createElement('div');
    window.open = () => null;
    expect(mods.open.openInDrawio({ run: '20261110_checkout', name: 'checkout.drawio', embed: EMBED, notice })).toBeNull();
    expect(notice.textContent).toContain('blocked the draw.io window');
    window.open = () => popup;
    routes = withFiles([file('checkout.drawio')]);
    mods.open.openInDrawio({ run: '20261110_checkout', name: 'checkout.drawio', embed: EMBED, notice, wait: 50 });
    await new Promise((r) => setTimeout(r, 120));
    expect(notice.textContent).toContain('draw.io did not answer');
  });

  it('falls back to embed.diagrams.net before the state has come', () => {
    expect(mods.open.embedOf(mods.store.createStore({ state: null }))).toBe('https://embed.diagrams.net');
    expect(mods.open.embedOf(mods.store.createStore({ state: { drawio: { embed: EMBED } } }))).toBe(EMBED);
  });
});

describe('the second half of the console', () => {
  const stateIr = { schemaVersion: 1, kind: 'state', title: 'Order', states: [{ id: 'a', label: 'Open' }, { id: 'b', label: 'Paid' }], transitions: [{ id: 't1', from: 'a', to: 'b', event: 'pay', guard: 'card valid' }] };
  const labels = [
    { path: '/title', collection: null, id: null, field: 'title', text: 'Order' },
    { path: '/states/0/label', collection: 'states', id: 'a', field: 'label', text: 'Open' },
    { path: '/states/1/label', collection: 'states', id: 'b', field: 'label', text: 'Paid' },
    { path: '/transitions/0/event', collection: 'transitions', id: 't1', field: 'event', text: 'pay' },
    { path: '/transitions/0/guard', collection: 'transitions', id: 't1', field: 'guard', text: 'card valid' },
  ];

  it('shows every label in the form, a guard included, and keeps Save disabled until a changed IR passed validation', async () => {
    let valid = false;
    routes = [
      ['GET', /\/diagrams\/order$/, () => respond(200, { id: 'order', rev: 'a'.repeat(64), ir: stateIr, labels, errors: [], warnings: [] })],
      ['POST', /\/api\/validate$/, () => respond(200, valid ? { ok: true, errors: [], warnings: [], labels, glossary: [] } : { ok: false, errors: [{ path: '/transitions/0/guard', message: 'must not be empty' }], warnings: [], labels: [], glossary: [] })],
    ];
    const panel = document.createElement('div');
    const queued = [];
    mods.editor.modelEditor({ panel, run: 'r', detail: { diagrams: [{ id: 'order', title: 'Order' }] }, queue: (kind, params) => queued.push({ kind, params }) });
    await flush();
    const inputs = [...panel.querySelectorAll('input.sn-input')];
    expect(inputs.map((i) => i.value)).toEqual(['Order', 'Open', 'Paid', 'pay', 'card valid']);
    const save = [...panel.querySelectorAll('button')].find((b) => b.textContent === 'Save changes');
    expect(save.disabled).toBe(true);
    inputs[4].value = '';
    inputs[4].dispatchEvent(new window.Event('input', { bubbles: true }));
    [...panel.querySelectorAll('button')].find((b) => b.textContent === 'Validate').click();
    await flush();
    expect(panel.textContent).toContain('must not be empty');
    expect([...panel.querySelectorAll('button')].find((b) => b.textContent === 'Save changes').disabled).toBe(true);
    valid = true;
    const field = [...panel.querySelectorAll('input.sn-input')][4];
    field.value = 'card checked';
    field.dispatchEvent(new window.Event('input', { bubbles: true }));
    [...panel.querySelectorAll('button')].find((b) => b.textContent === 'Validate').click();
    await flush();
    const enabled = [...panel.querySelectorAll('button')].find((b) => b.textContent === 'Save changes');
    expect(enabled.disabled).toBe(false);
    enabled.click();
    expect(queued).toEqual([{ kind: 'apply-edit', params: { diagram: 'order', baseRev: 'a'.repeat(64), ir: { ...stateIr, transitions: [{ ...stateIr.transitions[0], guard: 'card checked' }] } } }]);
  });

  it('refuses a term of 81 characters or with a line break in the form', () => {
    expect(mods.glossary.termProblem('x'.repeat(80))).toBeUndefined();
    expect(mods.glossary.termProblem('x'.repeat(81))).toBe('At most 80 characters.');
    expect(mods.glossary.termProblem('a\nb')).toMatch(/One line/);
    expect(mods.glossary.termProblem('n'.repeat(281), 280)).toBe('At most 280 characters.');
  });

  it('sends no write from the entry dialog for a term of 81 characters', async () => {
    routes = [['GET', /\/api\/glossary$/, () => respond(200, { exists: true, rev: 'r1', glossary: { schemaVersion: 1, entries: [] } })], ['GET', /\/api\/runs$/, () => respond(200, { runs: [] })]];
    const view = mods.glossary.glossarySection({ store: mods.store.createStore({}) });
    document.body.appendChild(view.element);
    await flush();
    [...view.element.querySelectorAll('button')].find((b) => b.textContent.includes('Add entry')).click();
    const dialog = document.querySelector('.sn-dialog');
    const term = dialog.querySelector('input.sn-input');
    term.value = 'x'.repeat(81);
    term.dispatchEvent(new window.Event('input', { bubbles: true }));
    [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Add the entry').click();
    await flush();
    expect(dialog.textContent).toContain('At most 80 characters.');
    expect(calls.filter((c) => c.method !== 'GET')).toEqual([]);
  });

  it('takes a reply only from its own frame', async () => {
    let fell = 0;
    const figure = mods.frame.viewerFrame({ kind: 'drawio', text: '<mxfile/>', fallback: () => { fell += 1; return document.createElement('p'); }, wait: 200 });
    document.body.appendChild(figure);
    const frame = figure.querySelector('iframe');
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    window.dispatchEvent(new window.MessageEvent('message', { data: { seq: 1, ok: true, width: 10, height: 10 }, source: window }));
    expect(frame.style.height).toBe('');
    await new Promise((r) => setTimeout(r, 300));
    expect(fell).toBe(1);
  });

  it('joins each section through one entry of the navigation', () => {
    expect(mods.nav.SECTIONS.map((x) => x.id)).toEqual(['overview', 'diagrams', 'jobs', 'glossary']);
  });
});

describe('the screens of the redesign', () => {
  const pick = (root, name, value) => {
    const input = root.querySelector(`input[name="${name}"][value="${value}"]`);
    input.checked = true;
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
  };

  it('starts a new diagram with every open choice as "Ask me later" and says what the agent will ask', async () => {
    const store = mods.store.createStore({ state: { agent: { attached: false } } });
    const view = mods.create.newDiagram({ store });
    document.body.appendChild(view.element);
    for (const name of ['kind', 'scope', 'audience', 'mode']) expect(view.element.querySelector(`input[name="${name}"]:checked`).value).toBe('');
    expect(view.element.querySelector('input[name="target"]:checked').value).toBe('drawio');
    const summary = view.element.querySelector('.zl-summary').textContent;
    expect(summary).toContain('The agent will ask you the input, the kind, the level of detail and the view');
    expect(summary).toContain('No agent is attached');
    pick(view.element, 'kind', 'usecase');
    pick(view.element, 'target', 'mermaid');
    expect(view.element.textContent).toContain('Mermaid has no use case diagram');
    expect(view.element.querySelector('.zl-summary').textContent).toContain('Use case');
  });

  it('queues nothing without a request, then only the choices that were made', async () => {
    routes = [['POST', /\/api\/jobs$/, () => respond(200, { job: { id: 'j20261118-000000-abcd' } })]];
    const view = mods.create.newDiagram({ store: mods.store.createStore({}), mode: 'scout' });
    document.body.appendChild(view.element);
    const form = view.element.querySelector('form');
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await flush();
    expect(calls).toEqual([]);
    expect(view.element.textContent).toContain('Write what the diagram should explain');
    const request = view.element.querySelector('textarea');
    request.value = 'The login flow';
    request.dispatchEvent(new window.Event('input', { bubbles: true }));
    pick(view.element, 'kind', 'sequence');
    pick(view.element, 'scope', 'detailed');
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await flush();
    expect(calls.map((c) => c.body)).toEqual([{ kind: 'draw', params: { mode: 'scout', request: 'The login flow', to: 'drawio', kind: 'sequence', scope: 'detailed' } }]);
    expect(view.element.querySelector('a[href="#/jobs/j20261118-000000-abcd"]')).not.toBeNull();
  });

  it('answers on the job page and leaves the panel a pointer, so one clay element is in view', async () => {
    routes = [
      ['GET', /\/api\/jobs\/j1$/, () => respond(200, { ...askJob, asked: [{ id: 'old', body: '', questions: [{ question: 'Which kind?' }], answers: [{ selected: ['flowchart'] }] }], createdAt: new Date().toISOString(), startedAt: new Date().toISOString() })],
      ['GET', /\/api\/jobs$/, () => respond(200, { jobs: [] })],
    ];
    const store = mods.store.createStore({ asking: false });
    const page = mods.jobs.jobsSection({ store, parts: ['j1'] });
    const panel = mods.panel.createJobPanel({ store });
    document.body.append(page.element, panel.element);
    await flush();
    expect(store.get().answeringHere).toBe('j1');
    await panel.render({ agent: { attached: true }, jobs: { queued: 0, queue: [], open: { id: 'j1', kind: 'revise', run: '20261110_checkout', state: 'needs-input' } } });
    expect(page.element.querySelectorAll('fieldset')).toHaveLength(3);
    expect(panel.element.querySelectorAll('fieldset')).toHaveLength(0);
    expect(document.querySelectorAll('.sn-btn-accent')).toHaveLength(1);
    expect(page.element.textContent).toContain('Answered questions (1)');
    expect(page.element.textContent).toContain('flowchart');
    expect(page.element.querySelector('img')).toBeNull();
  });

  it('lists what needs the reader on the overview, counted from the server', async () => {
    routes = [['GET', /\/api\/runs$/, () => respond(200, { runs: [] })], ['GET', /\/api\/jobs$/, () => respond(200, { jobs: [] })]];
    const store = mods.store.createStore({ state: { project: MARKUP, agent: { attached: true }, glossary: { ok: true, counts: { suggested: 2, confirmed: 1, rejected: 0 } }, jobs: { queued: 0, open: { id: 'j1', kind: 'sync', run: 'r', state: 'needs-input' } } } });
    const view = mods.overview.overviewSection({ store });
    await flush();
    const text = view.element.textContent;
    expect(text).toContain('The agent asks you a question');
    expect(text).toContain('2 glossary suggestions to review');
    expect(text).toContain(MARKUP);
    expect(view.element.querySelector('img')).toBeNull();
    expect(view.element.querySelector('a[href="#/jobs/j1"]')).not.toBeNull();
  });
});


describe('the runs folder', () => {
  const runRow = { run: '20261110_checkout', date: '2026-11-10', slug: 'checkout', title: 'Checkout', origin: 'scout', diagrams: [{ id: 'checkout', kind: 'flowchart', title: 'Checkout' }], targets: ['drawio'], revisions: 0, variants: [], scouted: false };
  const detailRoutes = () => [
    ['GET', /\/api\/runs$/, () => respond(200, { runs: [runRow] })],
    ['GET', /\/api\/jobs$/, () => respond(200, { jobs: [] })],
    ['GET', /\/api\/runs\/20261110_checkout$/, () => respond(200, { ...runRow, files: [{ name: 'checkout.drawio', size: 10, modified: '2026-11-18T00:00:00Z' }], revisions: [], undo: null, redo: null, stale: null })],
  ];

  it.each([[undefined, 'diagrams'], ['docs/diagrams', 'docs/diagrams']])('shows %s as %s in every place that names it', async (runsDir, shown) => {
    routes = detailRoutes();
    const store = mods.store.createStore({ state: { project: 'p', ...(runsDir ? { runsDir } : {}), drawio: { embed: 'https://embed.diagrams.net' } }, asking: false });
    const list = mods.runs.runsList({ store });
    const overview = mods.overview.overviewSection({ store });
    const detail = mods.detail.runDetail({ store, run: '20261110_checkout' });
    const files = mods.detail.runDetail({ store, run: '20261110_checkout', tab: 'files' });
    const recook = mods.create.newDiagram({ store, recook: true });
    await flush();
    expect(list.element.textContent).toContain(`1 run under ${shown}/, newest first.`);
    expect(overview.element.textContent).toContain(`Diagrams under ${shown}/`);
    expect(detail.element.querySelector('header').textContent).toContain(`${shown}/20261110_checkout`);
    expect(files.element.textContent).toContain(`Files of ${shown}/20261110_checkout`);
    expect(recook.element.textContent).toContain(`the run is written under ${shown}/`);
    if (runsDir) expect(`${list.element.textContent}${overview.element.textContent}${detail.element.textContent}`).not.toMatch(/(^|[^/])diagrams\/20261110/);
  });

  it('says on the overview that the project setting cannot be used', async () => {
    routes = detailRoutes();
    const store = mods.store.createStore({ state: { project: 'p', runsDir: null, configError: { message: 'config.json: runsDir "../x" has a "." or ".." part', hint: 'runsDir takes a folder inside the project' } } });
    const view = mods.overview.overviewSection({ store });
    await flush();
    expect(view.element.textContent).toContain('The project setting cannot be used');
    expect(view.element.textContent).toContain('runsDir takes a folder inside the project');
  });
});
