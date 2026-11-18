/**
 * The Reports section: the reports under the project's reports folder (cards or a table, with
 * their findings and drafts), the form of a new report, the templates of every scope, and one
 * report. Every change of a report's content is a job for the agent, except the quick edit and
 * a restore, which the server makes after a snapshot.
 */
import { S } from '../sienna.mjs';
import { h, replace, ago } from '../dom.mjs';
import { api } from '../api.mjs';
import { reportsDirOf, SCOPE_LABEL } from '../words.mjs';
import { badge } from './badge.mjs';
import { reportDetail } from './report-detail.mjs';
import { newReport } from './new-report.mjs';
import { reportTemplates } from './report-templates.mjs';

const LAYOUT_KEY = 'zukai-labs-reports-layout';
const session = {
  get() { try { return window.sessionStorage.getItem(LAYOUT_KEY); } catch { return null; } },
  set(v) { try { window.sessionStorage.setItem(LAYOUT_KEY, v); } catch { /* storage refused */ } },
};

/** The badges of a report: its findings and the drafts that wait. */
export function reportBadges(r) {
  return [
    r.findings?.blocking ? badge({ label: `${r.findings.blocking} to fix`, tone: 'danger', icon: 'alert' }) : null,
    r.findings?.warnings ? badge({ label: `${r.findings.warnings} warning${r.findings.warnings === 1 ? '' : 's'}`, tone: 'warning' }) : null,
    r.drafts ? badge({ label: `${r.drafts} draft${r.drafts === 1 ? '' : 's'} to review`, tone: 'clay' }) : null,
    !r.rendered ? badge({ label: 'Not rendered', outline: true }) : null,
  ];
}

/** A report as a card: title, folder, kind, template and languages. */
export function reportCard(r) {
  return h('article', { class: 'zl-run-card zl-report-card' },
    h('div', { class: 'zl-run-card-body' },
      h('h3', { class: 'heading-sm' }, h('a', { class: 'zl-run-link', href: `#/reports/${encodeURIComponent(r.name)}` }, r.title)),
      h('p', { class: 'code caption zl-muted' }, r.name),
      h('p', { class: 'body-sm zl-muted' }, [r.kind, `${r.template.id} (${SCOPE_LABEL[r.template.scope] ?? r.template.scope})`, [r.lang, ...r.translations].join(' · ')].join(' · '))),
    h('div', { class: 'zl-run-card-foot' },
      h('span', { class: 'caption zl-muted' }, ago(r.updated)),
      h('div', { class: 'zl-row' }, reportBadges(r))));
}

function reportsList({ store }) {
  const element = h('div', { class: 'zl-page' });
  let reports = null;
  let failure = null;
  let query = '';
  let layout = session.get() === 'table' ? 'table' : 'cards';

  const header = () => h('header', { class: 'zl-page-header zl-page-header-row' },
    h('div', { class: 'zl-stack-tight' },
      h('div', { class: 'eyebrow' }, 'Reports'),
      h('h1', { class: 'display-md' }, 'Reports of this project'),
      reports ? h('p', { class: 'body zl-muted' }, `${reports.length} report${reports.length === 1 ? '' : 's'} under ${reportsDirOf(store)}/, newest first.`) : null),
    h('div', { class: 'zl-row' },
      S().Button({ label: 'Templates', variant: 'secondary', href: '#/reports/templates' }),
      S().Button({ label: 'New report', variant: 'primary', icon: 'plus', href: '#/reports/new' })));

  const matches = (r) => {
    const q = query.trim().toLowerCase();
    return !q || [r.name, r.title, r.kind, r.template.id, r.lang, ...r.translations].join(' ').toLowerCase().includes(q);
  };

  function table(rows) {
    return S().Table({
      caption: `Reports under ${reportsDirOf(store)}/`,
      rows,
      columns: [
        { key: 'title', label: 'Report', render: (r) => h('div', {}, h('a', { href: `#/reports/${encodeURIComponent(r.name)}` }, r.title), h('div', { class: 'code caption zl-muted' }, r.name)) },
        { key: 'kind', label: 'Kind', muted: true, render: (r) => r.kind },
        { key: 'template', label: 'Template', muted: true, render: (r) => `${r.template.id} (${SCOPE_LABEL[r.template.scope] ?? r.template.scope})` },
        { key: 'langs', label: 'Languages', render: (r) => [r.lang, ...r.translations].join(', ') },
        { key: 'state', label: 'State', render: (r) => h('div', { class: 'zl-row' }, reportBadges(r)) },
        { key: 'updated', label: 'Updated', muted: true, render: (r) => ago(r.updated) },
      ],
    });
  }

  function render() {
    const state = store.get().state;
    if (state?.reportsConfigError) {
      replace(element, header(), S().Alert({ tone: 'danger', title: 'The reports folder setting cannot be used', body: `${state.reportsConfigError.message}. ${state.reportsConfigError.hint}` }));
      return;
    }
    if (failure) { replace(element, header(), S().Alert({ tone: 'danger', title: 'The reports could not be read', body: failure })); return; }
    if (reports === null) { replace(element, header(), h('p', { class: 'body zl-muted' }, 'Reading the reports')); return; }
    if (reports.length === 0) {
      replace(element, header(), h('div', { class: 'zl-empty zl-empty-hero' },
        h('p', { class: 'display-sm' }, 'No reports yet'),
        h('p', { class: 'body zl-muted' }, `A report is a folder under ${reportsDirOf(store)}/ with its Markdown, its HTML and its history, written by the agent from a template. Queue a new report and the agent writes it.`),
        S().Button({ label: 'New report', variant: 'primary', icon: 'plus', href: '#/reports/new' })));
      return;
    }
    const out = h('div', {});
    const draw = () => {
      const shown = reports.filter(matches);
      replace(out, shown.length === 0 ? h('p', { class: 'body zl-muted' }, 'No report matches this search.') : layout === 'cards' ? h('div', { class: 'zl-run-grid' }, shown.map(reportCard)) : table(shown));
    };
    const search = S().Input({ label: 'Search reports', type: 'search', value: query, placeholder: 'Title, kind, template or language', onInput: (e) => { query = e.target.value; draw(); } });
    const layoutTabs = S().Tabs({ variant: 'segment', panel: false, label: 'Layout', value: layout, items: [{ value: 'cards', label: 'Cards' }, { value: 'table', label: 'Table' }], onChange: (v) => { layout = v; session.set(v); draw(); } });
    draw();
    replace(element, header(), h('div', { class: 'zl-toolbar' }, h('div', { class: 'zl-toolbar-search' }, search), layoutTabs), out);
  }

  async function load() {
    const r = await api.get('/api/reports');
    if (r.ok) { failure = null; reports = r.data.reports; } else if (r.error.code !== 'bad-config') failure = r.error.message;
    render();
  }
  render();
  load();
  return { element, title: 'Reports', reload: load, stateChanged: render, store };
}

export function reportsSection({ store, parts, setCrumbs }) {
  const [first, second] = parts;
  if (!first) return reportsList({ store });
  if (first === 'new') { setCrumbs?.([{ label: 'New report' }]); return newReport({ store, template: second }); }
  if (first === 'templates') { setCrumbs?.([{ label: 'Templates', href: '#/reports/templates' }, ...(second ? [{ label: second }] : [])]); return reportTemplates({ store, selected: second }); }
  return reportDetail({ store, name: first, tab: second, setCrumbs });
}
