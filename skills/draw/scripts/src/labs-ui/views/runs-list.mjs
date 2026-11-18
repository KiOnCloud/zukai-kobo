/**
 * The runs under the project's runs folder: cards or a table, a search, filters by kind and by state, and the
 * doors to a new diagram and a recook. The chosen layout is kept for the tab.
 */
import { S } from '../sienna.mjs';
import { h, replace, day } from '../dom.mjs';
import { api } from '../api.mjs';
import { ORIGIN, kindLabel, targetLabel, runsDirOf } from '../words.mjs';
import { badge } from './badge.mjs';
import { runCard } from './overview.mjs';

const PAGE = 48;
const LAYOUT_KEY = 'zukai-labs-runs-layout';
const session = {
  get() { try { return window.sessionStorage.getItem(LAYOUT_KEY); } catch { return null; } },
  set(v) { try { window.sessionStorage.setItem(LAYOUT_KEY, v); } catch { /* storage refused */ } },
};

export function runsList({ store }) {
  const element = h('div', { class: 'zl-page' });
  let query = '';
  let page = 0;
  let runs = null;
  let failure = null;
  let layout = session.get() === 'table' ? 'table' : 'cards';
  const kinds = new Set();
  let only = 'all'; // all | stale | scouted

  const header = () => h('header', { class: 'zl-page-header zl-page-header-row' },
    h('div', { class: 'zl-stack-tight' },
      h('div', { class: 'eyebrow' }, 'Diagrams'),
      h('h1', { class: 'display-md' }, 'Runs of this project'),
      runs ? h('p', { class: 'body zl-muted' }, `${runs.length} run${runs.length === 1 ? '' : 's'} under ${runsDirOf(store)}/, newest first.`) : null),
    h('div', { class: 'zl-row' },
      S().Button({ label: 'Recook a diagram', variant: 'secondary', href: '#/diagrams/recook' }),
      S().Button({ label: 'New diagram', variant: 'primary', icon: 'plus', href: '#/diagrams/new' })));

  function matches(r) {
    const q = query.trim().toLowerCase();
    if (q && ![r.run, r.title, ...r.diagrams.map((d) => `${d.title ?? ''} ${d.kind ?? ''} ${kindLabel(d.kind)}`)].join(' ').toLowerCase().includes(q)) return false;
    if (kinds.size && !r.diagrams.some((d) => kinds.has(d.kind))) return false;
    if (only === 'stale' && !r.stale) return false;
    if (only === 'scouted' && !r.scouted) return false;
    return true;
  }

  function table(rows) {
    const columns = [
      { key: 'title', label: 'Run', render: (r) => h('div', {}, h('a', { href: `#/diagrams/${encodeURIComponent(r.run)}` }, r.title), h('div', { class: 'code caption zl-muted' }, r.run)) },
      { key: 'date', label: 'Date', muted: true, render: (r) => day(r.date) },
      { key: 'kinds', label: 'Kinds', render: (r) => [...new Set(r.diagrams.map((d) => d.kind).filter(Boolean))].map(kindLabel).join(', ') },
      { key: 'targets', label: 'Files', muted: true, render: (r) => r.targets.map(targetLabel).join(', ') || 'Model only' },
      { key: 'origin', label: 'Origin', muted: true, render: (r) => ORIGIN[r.origin] ?? '' },
      { key: 'state', label: 'State', render: (r) => (r.stale ? badge({ label: 'Behind the code', tone: 'warning' }) : '') },
      { key: 'revisions', label: 'Revisions', numeric: true, render: (r) => String(r.revisions) },
    ];
    return S().Table({ columns, rows, caption: `Runs under ${runsDirOf(store)}/` });
  }

  function results() {
    const shown = runs.filter(matches);
    if (shown.length === 0) return h('div', { class: 'zl-empty' }, h('p', { class: 'body zl-muted' }, 'No run matches this search and these filters.'), S().Button({ label: 'Clear the filters', variant: 'ghost', size: 'sm', onClick: () => { query = ''; kinds.clear(); only = 'all'; page = 0; render(); } }));
    const rows = shown.slice(page * PAGE, page * PAGE + PAGE);
    const pager = shown.length > PAGE ? h('div', { class: 'zl-row zl-pager' },
      S().Button({ label: 'Previous', variant: 'ghost', size: 'sm', disabled: page === 0, onClick: () => { page -= 1; render(); } }),
      h('span', { class: 'body-sm zl-muted' }, `${page * PAGE + 1} to ${Math.min(shown.length, (page + 1) * PAGE)} of ${shown.length}`),
      S().Button({ label: 'Next', variant: 'ghost', size: 'sm', disabled: (page + 1) * PAGE >= shown.length, onClick: () => { page += 1; render(); } })) : null;
    return h('div', { class: 'zl-stack' }, layout === 'cards' ? h('div', { class: 'zl-run-grid' }, rows.map(runCard)) : table(rows), pager);
  }

  function toolbar() {
    const present = [...new Set(runs.flatMap((r) => r.diagrams.map((d) => d.kind)).filter(Boolean))];
    const out = h('div', {});
    const redraw = () => { page = 0; replace(out, results()); };
    const search = S().Input({ label: 'Search runs', type: 'search', value: query, placeholder: 'Title, kind or folder', onInput: (e) => { query = e.target.value; redraw(); } });
    const kindChips = present.length > 1 ? h('div', { class: 'zl-row', role: 'group', 'aria-label': 'Show runs with diagrams of kind' }, present.map((k) => S().Chip({ label: kindLabel(k), selectable: true, selected: kinds.has(k), onClick: () => { if (kinds.has(k)) kinds.delete(k); else kinds.add(k); redraw(); } }))) : null;
    const stateTabs = S().Tabs({ variant: 'segment', panel: false, label: 'Which runs', value: only, items: [{ value: 'all', label: 'All' }, { value: 'stale', label: 'Behind the code', count: runs.filter((r) => r.stale).length }, { value: 'scouted', label: 'From code' }], onChange: (v) => { only = v; redraw(); } });
    const layoutTabs = S().Tabs({ variant: 'segment', panel: false, label: 'Layout', value: layout, items: [{ value: 'cards', label: 'Cards' }, { value: 'table', label: 'Table' }], onChange: (v) => { layout = v; session.set(v); redraw(); } });
    replace(out, results());
    return [h('div', { class: 'zl-toolbar' }, h('div', { class: 'zl-toolbar-search' }, search), h('div', { class: 'zl-row' }, stateTabs, layoutTabs)), kindChips, out];
  }

  function render() {
    if (failure) { replace(element, header(), S().Alert({ tone: 'danger', title: 'The runs could not be read', body: `${failure} Reload the page; if it stays, run labs status in the agent session.` })); return; }
    if (runs === null) { replace(element, header(), h('div', { class: 'zl-run-grid' }, [1, 2, 3].map(() => h('div', { class: 'zl-run-card sn-skeleton', 'aria-hidden': 'true' })))); return; }
    if (runs.length === 0) {
      replace(element, header(), h('div', { class: 'zl-empty zl-empty-hero' },
        h('p', { class: 'display-sm' }, 'No runs yet'),
        h('p', { class: 'body zl-muted' }, `A run is a folder under ${runsDirOf(store)}/ with the models, the files and the history of one subject. Queue a new diagram and the agent writes the first one.`),
        S().Button({ label: 'New diagram', variant: 'primary', icon: 'plus', href: '#/diagrams/new' })));
      return;
    }
    replace(element, header(), ...toolbar());
  }

  async function load() {
    const r = await api.get('/api/runs');
    if (!r.ok) { failure = r.error.message; render(); return; }
    failure = null;
    // The stale mark needs the record of a scouted run: read it for those only.
    const scouted = r.data.runs.filter((x) => x.scouted);
    const stale = await Promise.all(scouted.map((x) => api.get(`/api/runs/${encodeURIComponent(x.run)}`)));
    runs = r.data.runs.map((x) => ({ ...x, stale: stale[scouted.indexOf(x)]?.data?.stale?.stale === true }));
    render();
  }

  render();
  load();
  return { element, reload: load, title: 'Runs', store };
}
