/** The runs under diagrams/: a table with a search, and the doors to a new diagram and a recook. */
import { S } from '../sienna.mjs';
import { h, replace, when } from '../dom.mjs';
import { api } from '../api.mjs';
import { ORIGIN } from '../words.mjs';
import { badge } from './badge.mjs';

const PAGE = 50;

export function runsList({ store }) {
  const element = h('div', { class: 'zl-page' });
  let query = '';
  let page = 0;
  let runs = null;
  let failure = null;

  const header = () => h('header', { class: 'zl-page-header' },
    h('div', { class: 'eyebrow' }, 'Diagrams'),
    h('h1', { class: 'display-md' }, 'Runs of this project'),
    h('div', { class: 'zl-row' },
      S().Button({ label: 'New diagram', variant: 'secondary', icon: 'plus', href: '#/diagrams/new' }),
      S().Button({ label: 'Recook a diagram', variant: 'secondary', href: '#/diagrams/recook' })));

  function table() {
    const q = query.trim().toLowerCase();
    const shown = runs.filter((r) => !q || [r.run, r.title, ...r.diagrams.map((d) => `${d.title ?? ''} ${d.kind ?? ''}`)].join(' ').toLowerCase().includes(q));
    const rows = shown.slice(page * PAGE, page * PAGE + PAGE);
    const columns = [
      { key: 'title', label: 'Run', render: (r) => h('div', {}, h('a', { href: `#/diagrams/${encodeURIComponent(r.run)}` }, r.title), h('div', { class: 'code zl-muted' }, r.run)) },
      { key: 'date', label: 'Date', muted: true, render: (r) => when(`${r.date}T00:00:00`).split(',')[0] },
      { key: 'kinds', label: 'Kinds', render: (r) => [...new Set(r.diagrams.map((d) => d.kind).filter(Boolean))].join(', ') },
      { key: 'targets', label: 'Files', muted: true, render: (r) => r.targets.join(', ') || 'IR only' },
      { key: 'origin', label: 'Origin', muted: true, render: (r) => ORIGIN[r.origin] ?? '' },
      { key: 'state', label: 'State', render: (r) => (r.stale ? badge({ label: 'Behind the code', tone: 'warning' }) : '') },
      { key: 'revisions', label: 'Revisions', numeric: true, render: (r) => String(r.revisions) },
    ];
    const pager = shown.length > PAGE ? h('div', { class: 'zl-row' },
      S().Button({ label: 'Previous', variant: 'ghost', size: 'sm', disabled: page === 0, onClick: () => { page -= 1; render(); } }),
      h('span', { class: 'body-sm zl-muted' }, `${page * PAGE + 1} to ${Math.min(shown.length, (page + 1) * PAGE)} of ${shown.length}`),
      S().Button({ label: 'Next', variant: 'ghost', size: 'sm', disabled: (page + 1) * PAGE >= shown.length, onClick: () => { page += 1; render(); } })) : null;
    if (shown.length === 0) return h('p', { class: 'body zl-muted' }, 'No run matches this search.');
    return h('div', { class: 'zl-stack' }, S().Table({ columns, rows, caption: 'Runs under diagrams/' }), pager);
  }

  function render() {
    if (failure) { replace(element, header(), S().Alert({ tone: 'danger', title: 'The runs could not be read', body: `${failure} Reload the page; if it stays, run labs status in the agent session.` })); return; }
    if (runs === null) { replace(element, header(), h('p', { class: 'body zl-muted' }, 'Reading the runs')); return; }
    if (runs.length === 0) {
      replace(element, header(), h('div', { class: 'zl-empty' }, h('p', { class: 'display-sm' }, 'No runs yet'), S().Button({ label: 'New diagram', variant: 'secondary', href: '#/diagrams/new' })));
      return;
    }
    const search = S().Input({ label: 'Search runs', type: 'search', value: query, placeholder: 'Title, kind or folder', onInput: (e) => { query = e.target.value; page = 0; replace(results, table()); } });
    const results = h('div', {}, table());
    replace(element, header(), search, results);
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
