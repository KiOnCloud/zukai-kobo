/**
 * The console's start: the token, the theme, the shell (navigation, content, job panel), the
 * router and the polling of the server's state every 1.5 seconds while the tab is visible.
 */
import { S } from './sienna.mjs';
import { h, replace } from './dom.mjs';
import { api, readToken, onForbidden } from './api.mjs';
import { createStore } from './store.mjs';
import { SECTIONS } from './nav.mjs';
import { createJobPanel } from './views/job-panel.mjs';
import { agentBadge } from './words.mjs';
import { badge } from './views/badge.mjs';

const POLL_MS = 1500;

/** Light or dark from the system's setting, through Sienna's `data-theme`. */
export function followTheme(win = window) {
  const query = win.matchMedia?.('(prefers-color-scheme: dark)');
  const apply = () => win.document.documentElement.setAttribute('data-theme', query?.matches ? 'dark' : 'light');
  apply();
  query?.addEventListener?.('change', apply);
}

/** The page shown without a token: no call is made. */
export function noTokenPage() {
  return h('main', { class: 'zl-alone' },
    h('div', { class: 'eyebrow' }, 'Zukai Labs'),
    h('h1', { class: 'display-md' }, 'Open the console with its URL'),
    h('p', { class: 'body' }, 'This page needs the URL with its token. In the agent session, run labs status and open the URL it prints, or ask the agent for it.'));
}

export function start(root = document.getElementById('app')) {
  followTheme();
  if (!readToken()) { replace(root, noTokenPage()); return undefined; }
  const store = createStore({ state: null, change: null, asking: false, notice: null });
  const nav = h('nav', { class: 'zl-nav', 'aria-label': 'Sections' });
  const agentFoot = h('div', { class: 'zl-nav-foot' });
  const content = h('main', { class: 'zl-content', id: 'content', tabindex: '-1' });
  const notices = h('div', { class: 'zl-notices', role: 'status' });
  const panel = createJobPanel({ store });
  replace(root, h('div', { class: 'zl-shell' },
    h('aside', { class: 'zl-sidebar' }, h('div', { class: 'heading-md zl-brand' }, 'Zukai Labs'), nav, agentFoot),
    h('div', { class: 'zl-main' }, notices, content),
    panel.element));

  let view = null;
  let route = null;
  function navigate() {
    const hash = window.location.hash.replace(/^#\/?/, '');
    const [sectionId = SECTIONS[0].id, ...parts] = hash.split('/').map((p) => { try { return decodeURIComponent(p); } catch { return ''; } });
    const section = SECTIONS.find((s) => s.id === sectionId) ?? SECTIONS[0];
    const key = [section.id, ...parts.slice(0, 1)].join('/');
    replace(nav, S().Menu({ label: 'Sections', items: SECTIONS.map((s) => ({ label: s.label, icon: s.icon, href: `#/${s.id}`, checked: s.id === section.id })) }));
    if (key === route && view) return;
    route = key;
    view?.dispose?.();
    view = section.view({ store, parts });
    replace(content, view.element);
    document.title = `${view.title ?? section.label} · Zukai Labs`;
    content.focus({ preventScroll: true });
  }
  window.addEventListener('hashchange', navigate);
  navigate();

  store.subscribe((s) => {
    if (s.notice) replace(notices, S().Alert({ tone: s.notice.tone, body: s.notice.text, dismissible: true, onDismiss: () => store.set({ notice: null }) }));
  });

  let lost = false;
  onForbidden(() => {
    if (lost) return;
    lost = true;
    replace(notices, S().Alert({ tone: 'warning', title: 'The console server was started again', body: 'This page holds the token of the earlier server. Run labs status in the agent session and open the URL it prints.' }));
  });

  async function poll() {
    if (document.visibilityState !== 'hidden' && !lost) {
      const r = await api.get('/api/state');
      if (r.ok) {
        // The change counter is "<writes of the server>-<stamp of the runs on disk>": the panel
        // follows every change, a view only a change of the runs, so a form being written stays.
        const before = store.get().change;
        const stamp = r.data.change.split('-')[1];
        store.set({ state: r.data, change: r.data.change });
        replace(agentFoot, badge(agentBadge(r.data)));
        if (r.data.change !== before) await panel.render(r.data);
        if (before !== null && stamp !== before.split('-')[1]) view?.reload?.();
      }
    }
    setTimeout(poll, POLL_MS);
  }
  poll();
  return store;
}
