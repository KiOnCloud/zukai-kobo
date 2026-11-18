/**
 * The console's start: the token, the theme, the shell (navigation, top bar, content, agent
 * panel), the router and the polling of the server's state every 1.5 seconds while the tab is
 * visible. The panel can be closed; a question of the agent is then announced in the page.
 */
import { S } from './sienna.mjs';
import { h, replace } from './dom.mjs';
import { api, readToken, onForbidden } from './api.mjs';
import { createStore } from './store.mjs';
import { SECTIONS } from './nav.mjs';
import { createJobPanel } from './views/job-panel.mjs';
import { agentBadge, KIND_LABEL, runsDirOf } from './words.mjs';
import { segmented } from './views/choice.mjs';
import { glyph } from './views/glyphs.mjs';

const POLL_MS = 1500;
const THEME_KEY = 'zukai-labs-theme';
const PANEL_KEY = 'zukai-labs-panel';
const WIDE = '(min-width: 1280px)';

const local = {
  get(key) { try { return window.localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { window.localStorage.setItem(key, value); } catch { /* storage refused */ } },
};

/** Light or dark: the reader's choice, else the system's setting, through Sienna's `data-theme`. */
export function followTheme(win = window, choice = () => local.get(THEME_KEY) ?? 'system') {
  const query = win.matchMedia?.('(prefers-color-scheme: dark)');
  const apply = () => {
    const c = choice();
    win.document.documentElement.setAttribute('data-theme', c === 'dark' || (c !== 'light' && query?.matches) ? 'dark' : 'light');
  };
  apply();
  query?.addEventListener?.('change', apply);
  return apply;
}

/** The page shown without a token: no call is made. */
export function noTokenPage() {
  return h('main', { class: 'zl-alone' },
    h('div', { class: 'zl-alone-mark' }, glyph('flowchart', { size: 'lg' })),
    h('div', { class: 'eyebrow' }, 'Zukai Labs'),
    h('h1', { class: 'display-md' }, 'Open the console with its URL'),
    h('p', { class: 'body' }, 'This page needs the URL with its token. In the agent session, run labs status and open the URL it prints, or ask the agent for it.'),
    h('ol', { class: 'zl-alone-steps body-sm' },
      h('li', {}, 'In the agent session, run ', h('code', { class: 'code' }, '/zukai:labs'), '.'),
      h('li', {}, 'Open the address it prints; it ends in ', h('code', { class: 'code' }, '#t='), ' and a token.'),
      h('li', {}, 'Keep that tab: the token stays in it until the server is started again.')));
}

export function start(root = document.getElementById('app')) {
  const applyTheme = followTheme();
  if (!readToken()) { replace(root, noTokenPage()); return undefined; }
  const wide = window.matchMedia?.(WIDE)?.matches ?? true;
  const store = createStore({ state: null, change: null, asking: false, notice: null, answeringHere: null, panelOpen: (local.get(PANEL_KEY) ?? (wide ? 'open' : 'closed')) === 'open' && wide });

  let lost = false;
  let offline = false;
  const nav = h('nav', { class: 'zl-nav', 'aria-label': 'Sections' });
  const project = h('p', { class: 'caption zl-muted zl-project' });
  const crumbs = h('nav', { class: 'zl-crumbs', 'aria-label': 'Breadcrumb' });
  const agentButton = h('button', { type: 'button', class: 'zl-agent-toggle', 'aria-controls': 'agent-panel' });
  const newButton = S().Button({ label: 'New diagram', variant: 'secondary', size: 'sm', icon: 'plus', href: '#/diagrams/new' });
  const menuButton = S().Button({ label: 'Show the sections', variant: 'ghost', size: 'sm', iconOnly: true, icon: 'menu', className: 'zl-menu-toggle' });
  const banner = h('div', { class: 'zl-banner' });
  const content = h('main', { class: 'zl-content', id: 'content', tabindex: '-1' });
  const notices = h('div', { class: 'zl-notices', role: 'status' });
  const theme = segmented({ legend: 'Theme', value: local.get(THEME_KEY) ?? 'system', options: [{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }], onChange: (v) => { local.set(THEME_KEY, v); applyTheme(); } });
  const version = h('p', { class: 'caption zl-muted' });
  const panel = createJobPanel({ store, onClose: () => setPanel(false) });
  const scrim = h('div', { class: 'zl-rail-scrim', onClick: () => setPanel(false) });

  const sidebar = h('aside', { class: 'zl-sidebar', id: 'sections' },
    h('a', { class: 'zl-brand', href: '#/overview' }, h('span', { class: 'zl-brand-mark' }, glyph('flowchart')), h('span', { class: 'heading-md' }, 'Zukai Labs')),
    project, nav,
    h('div', { class: 'zl-nav-foot' }, theme, version));
  const shell = h('div', { class: 'zl-shell' },
    sidebar,
    h('div', { class: 'zl-main' },
      h('header', { class: 'zl-topbar' }, menuButton, crumbs, h('div', { class: 'zl-topbar-actions' }, newButton, agentButton)),
      h('div', { class: 'zl-page-area' }, banner, notices, content)),
    scrim,
    panel.element);
  replace(root, shell);

  function setPanel(open) {
    store.set({ panelOpen: open });
    view?.panelChanged?.();
    local.set(PANEL_KEY, open ? 'open' : 'closed');
    if (open) panel.element.querySelector('button, a')?.focus({ preventScroll: true });
  }
  agentButton.addEventListener('click', () => setPanel(!store.get().panelOpen));
  menuButton.addEventListener('click', () => { const open = shell.dataset.nav !== 'open'; shell.dataset.nav = open ? 'open' : 'closed'; menuButton.setAttribute('aria-expanded', String(open)); });
  menuButton.setAttribute('aria-controls', 'sections');
  menuButton.setAttribute('aria-expanded', 'false');
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && store.get().panelOpen && !window.matchMedia?.(WIDE)?.matches) setPanel(false); });

  // ------------------------------------------------------------ router
  let view = null;
  let route = null;
  let section = SECTIONS[0];
  function setCrumbs(list) {
    replace(crumbs, h('ol', { class: 'label' }, list.map((c, i) => h('li', {}, c.href && i < list.length - 1 ? h('a', { href: c.href }, c.label) : h('span', { 'aria-current': i === list.length - 1 ? 'page' : undefined }, c.label)))));
  }
  function drawNav() {
    const s = store.get().state;
    const jobs = s?.jobs;
    const open = jobs?.open ? 1 : 0;
    const hints = {
      diagrams: s ? String(s.runs) : undefined,
      jobs: jobs && (open || jobs.queued) ? `${open + jobs.queued} active` : undefined,
      glossary: s?.glossary?.counts?.suggested ? `${s.glossary.counts.suggested} to review` : undefined,
    };
    replace(nav, S().Menu({ label: 'Sections', items: SECTIONS.map((x) => ({ label: x.label, icon: x.icon, href: `#/${x.id}`, checked: x.id === section.id, hint: hints[x.id] })) }));
  }
  // The runs folder a view was drawn with: a view built before the first state, or before the
  // setting changed, names the wrong folder and is drawn again.
  let viewRunsDir = null;
  function navigate() {
    const hash = window.location.hash.replace(/^#\/?/, '');
    const [sectionId = SECTIONS[0].id, ...parts] = hash.split('/').map((p) => { try { return decodeURIComponent(p); } catch { return ''; } });
    section = SECTIONS.find((s) => s.id === sectionId) ?? SECTIONS[0];
    const key = [section.id, ...parts.slice(0, section.depth ?? 1)].join('/');
    drawNav();
    shell.dataset.nav = 'closed';
    menuButton.setAttribute('aria-expanded', 'false');
    newButton.hidden = section.id === 'diagrams' && (!parts[0] || parts[0] === 'new' || parts[0] === 'recook');
    if (key === route && view) { view.route?.(parts); return; }
    route = key;
    viewRunsDir = runsDirOf(store);
    view?.dispose?.();
    store.set({ answeringHere: null });
    setCrumbs([{ label: section.label, href: `#/${section.id}` }]);
    view = section.view({ store, parts, setCrumbs: (list) => setCrumbs([{ label: section.label, href: `#/${section.id}` }, ...list]) });
    replace(content, view.element);
    document.title = `${view.title ?? section.label} · Zukai Labs`;
    content.focus({ preventScroll: true });
    window.scrollTo?.(0, 0);
  }
  window.addEventListener('hashchange', navigate);
  navigate();

  // ------------------------------------------------------------ state
  function drawChrome() {
    const { state: s, panelOpen, answeringHere } = store.get();
    shell.dataset.panel = panelOpen ? 'open' : 'closed';
    agentButton.setAttribute('aria-expanded', String(panelOpen));
    const b = agentBadge(s);
    replace(agentButton, h('span', { class: ['zl-agent-dot', `zl-agent-dot-${b.tone}`], 'aria-hidden': 'true' }), h('span', { class: 'label' }, b.label), S().icon(panelOpen ? 'chevron-right' : 'chevron-down', 'sm'));
    agentButton.title = panelOpen ? 'Close the agent panel' : 'Open the agent panel';
    agentButton.setAttribute('aria-label', `${b.label}. ${agentButton.title}`);
    if (s) {
      replace(project, s.project);
      replace(version, `Zukai ${s.version}`);
    }
    const open = s?.jobs?.open;
    const asking = open?.state === 'needs-input';
    // The overview lists the question under "Needs you" itself.
    if (asking && !panelOpen && answeringHere !== open.id && section.id !== 'overview') {
      replace(banner, S().Alert({ tone: 'clay', title: 'The agent asks you a question', body: `The ${KIND_LABEL[open.kind] ?? open.kind} job waits for your answer${open.run ? ` about ${open.run}` : ''}.`, actions: [
        S().Button({ label: 'Answer here', variant: 'secondary', size: 'sm', href: `#/jobs/${encodeURIComponent(open.id)}` }),
        S().Button({ label: 'Open the panel', variant: 'ghost', size: 'sm', onClick: () => setPanel(true) }),
      ] }));
    } else if (!offline && !lost) replace(banner);
  }
  store.subscribe((s) => {
    if (s.notice) replace(notices, S().Alert({ tone: s.notice.tone, body: s.notice.text, dismissible: true, onDismiss: () => store.set({ notice: null }) }));
    else replace(notices);
    drawChrome();
  });

  let lastSignature = null;
  onForbidden(() => {
    if (lost) return;
    lost = true;
    replace(banner, S().Alert({ tone: 'warning', title: 'The console server was started again', body: 'This page holds the token of the earlier server. Run labs status in the agent session and open the URL it prints.' }));
  });

  async function poll() {
    if (document.visibilityState !== 'hidden' && !lost) {
      const r = await api.get('/api/state');
      if (r.ok) {
        if (offline) { offline = false; replace(banner); }
        // The change counter is "<writes of the server>-<stamp of the runs on disk>": the panel
        // follows every change, a view only a change of the runs, so a form being written stays.
        const before = store.get().change;
        const stamp = r.data.change.split('-')[1];
        store.set({ state: r.data, change: r.data.change });
        drawNav();
        if (view && runsDirOf(store) !== viewRunsDir) { route = null; navigate(); }
        // Silence and the agent's coming and going change no file, so they count as a change too.
        const signature = JSON.stringify([r.data.change, r.data.agent?.attached, r.data.agent?.waiting, r.data.jobs?.open?.silent, store.get().answeringHere]);
        if (signature !== lastSignature) { lastSignature = signature; await panel.render(r.data); view?.stateChanged?.(r.data); }
        if (before !== null && stamp !== before.split('-')[1]) view?.reload?.();
      } else if (r.status === 0 && !offline) {
        offline = true;
        replace(banner, S().Alert({ tone: 'warning', title: 'The console server does not answer', body: 'It may have stopped after being idle, or the agent session ended. The page keeps trying; run /zukai:labs in the agent session to start it again.' }));
      }
    }
    setTimeout(poll, POLL_MS);
  }
  poll();
  return store;
}

