/**
 * The form of a new report: a template (one tile per usable template, with its kind, scope and
 * a preview of its sample in the sealed report frame), a title, a language, the runs whose
 * diagrams and tables it embeds, and notes for the writer. Queues a `report-write` job.
 */
import { S } from '../sienna.mjs';
import { h, replace } from '../dom.mjs';
import { api, path } from '../api.mjs';
import { REPORT_LANGS, SCOPE_LABEL, reportsDirOf } from '../words.mjs';
import { choiceTiles, segmented, toggleChips } from './choice.mjs';
import { reportFrame } from '../report-frame/frame.mjs';

const LANG_RE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const MAX_NOTES = 4000;

export function newReport({ store, template: preselected }) {
  const element = h('div', { class: 'zl-page zl-form-page' });
  const notice = h('div', { role: 'status' });
  const previewHolder = h('div', {});
  const state = { template: preselected ?? '', title: '', lang: '', otherLang: '', runs: [], notes: '' };
  let templates = null;
  let runs = [];
  let failure = null;
  let frame = null;

  const usable = () => (templates ?? []).filter((t) => t.used);

  async function preview(id) {
    frame?.dispose?.();
    replace(previewHolder, h('p', { class: 'body-sm zl-muted' }, 'Loading the preview'));
    const r = await api.get(path`/api/report-templates/${id}/preview`);
    if (!r.ok) { replace(previewHolder, S().Alert({ tone: 'warning', body: `No preview: ${r.error.message}` })); return; }
    frame = reportFrame({ html: r.data.html, title: `Preview of ${id}` });
    replace(previewHolder, h('p', { class: 'label' }, `Preview of ${id} with its sample`), frame.element);
  }

  async function submit() {
    const lang = state.lang === 'other' ? state.otherLang.trim() : state.lang || usable().find((t) => t.id === state.template)?.lang || 'en';
    const problems = [];
    if (!state.template) problems.push('Pick a template.');
    if (!state.title.trim()) problems.push('Write a title.');
    if (state.title.length > 200) problems.push('The title has at most 200 characters.');
    if (!LANG_RE.test(lang)) problems.push('The language is a tag such as en, ja, vi or en-GB.');
    if (state.notes.length > MAX_NOTES) problems.push(`The notes have at most ${MAX_NOTES} characters.`);
    if (problems.length) { replace(notice, S().Alert({ tone: 'warning', body: problems.join(' ') })); return; }
    const t = usable().find((x) => x.id === state.template);
    const params = { template: state.template, title: state.title.trim(), lang, ...(t ? { scope: t.scope } : {}), ...(state.runs.length ? { runs: state.runs } : {}), ...(state.notes.trim() ? { notes: state.notes.trim() } : {}) };
    const r = await api.post('/api/jobs', { kind: 'report-write', params });
    if (!r.ok) { replace(notice, S().Alert({ tone: 'danger', title: 'Not queued', body: `${r.error.message}. ${(r.error.errors ?? []).map((e) => e.message).join('; ')}` })); return; }
    window.location.hash = `#/jobs/${encodeURIComponent(r.data.job.id)}`;
  }

  function render() {
    const head = h('header', { class: 'zl-page-header' },
      h('div', { class: 'eyebrow' }, 'Reports'),
      h('h1', { class: 'display-md' }, 'New report'),
      h('p', { class: 'body zl-muted' }, `The agent writes the report from the template under ${reportsDirOf(store)}/, asks what the template needs and you have not said, then renders it to HTML.`));
    if (store.get().state?.reportsConfigError) { const e = store.get().state.reportsConfigError; replace(element, head, S().Alert({ tone: 'danger', title: 'The reports folder setting cannot be used', body: `${e.message}. ${e.hint}` })); return; }
    if (failure) { replace(element, head, S().Alert({ tone: 'danger', body: failure })); return; }
    if (!templates) { replace(element, head, h('p', { class: 'body zl-muted' }, 'Reading the templates')); return; }
    const tiles = choiceTiles({
      legend: 'Template',
      hint: 'The nearest scope wins: a project template over yours, yours over a built-in one.',
      value: state.template,
      columns: 'three',
      options: usable().map((t) => ({ value: t.id, label: t.name, description: `${t.description} · ${SCOPE_LABEL[t.scope] ?? t.scope}${t.overridesBuiltIn ? ' · overrides a built-in template' : ''}` })),
      onChange: (v) => { state.template = v; preview(v); },
    });
    const title = S().Input({ label: 'Title', value: state.title, placeholder: 'Checkout fails after the payment SDK upgrade', onInput: (e) => { state.title = e.target.value; } });
    const otherLang = S().Input({ label: 'Other language tag', value: state.otherLang, placeholder: 'en-GB', onInput: (e) => { state.otherLang = e.target.value; } });
    otherLang.hidden = state.lang !== 'other';
    const lang = segmented({ legend: 'Language', value: state.lang, options: [{ value: '', label: 'The template\'s', auto: true }, ...REPORT_LANGS, { value: 'other', label: 'Other' }], onChange: (v) => { state.lang = v; otherLang.hidden = v !== 'other'; } });
    const runChips = runs.length ? toggleChips({ legend: 'Diagrams to embed', hint: 'A template section that embeds diagrams or tables shows those of these runs.', values: state.runs, options: runs.map((r) => ({ value: r.run, label: r.title })), onChange: (v) => { state.runs = v; } }) : h('p', { class: 'body-sm zl-muted' }, 'The project has no runs to embed.');
    const notes = S().Input({ label: 'Notes for the writer', optional: true, multiline: true, rows: 5, value: state.notes, placeholder: 'What happened, the sources, links to the issue, what the reader needs to decide', onInput: (e) => { state.notes = e.target.value; } });
    replace(element, head, notice,
      h('div', { class: 'zl-stack' }, tiles, previewHolder, title, lang, otherLang, runChips, notes,
        h('div', { class: 'zl-row' }, S().Button({ label: 'Queue the report', variant: 'primary', onClick: submit }), S().Button({ label: 'Templates', variant: 'ghost', href: '#/reports/templates' }))));
    if (state.template) preview(state.template);
  }

  async function load() {
    const [t, r] = await Promise.all([api.get('/api/report-templates'), api.get('/api/runs')]);
    if (!t.ok) failure = `The templates could not be read: ${t.error.message}`; else templates = t.data.templates;
    runs = r.ok ? r.data.runs : [];
    render();
  }
  render();
  load();
  return { element, title: 'New report', dispose: () => frame?.dispose?.() };
}
