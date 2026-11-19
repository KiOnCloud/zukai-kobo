/**
 * The Templates tab of Reports: every template of every scope with the one used for each id,
 * what it overrides, a mark for a project template over a built-in one (it may have come with a
 * clone), its validity and reasons; a preview of its sample in the sealed report frame; New and
 * Customise as `report-template` jobs; Export as a download; Import from a file with a dry run
 * that shows the validation and the preview before anything is saved.
 */
import { S } from '../sienna.mjs';
import { h, replace } from '../dom.mjs';
import { api, path } from '../api.mjs';
import { SCOPE_LABEL } from '../words.mjs';
import { badge } from './badge.mjs';
import { segmented } from './choice.mjs';
import { reportFrame } from '../report-frame/frame.mjs';

const MAX_FILE = 1024 * 1024;

export function reportTemplates({ store, selected }) {
  const element = h('div', { class: 'zl-page' });
  const notice = h('div', { role: 'status' });
  const previewHolder = h('div', {});
  let rows = null;
  let failure = null;
  let frame = null;
  let importFrame = null;
  let importSection = null;

  const say = (tone, body, title) => replace(notice, S().Alert({ tone, title, body, dismissible: true }));

  async function queue(params, done) {
    const r = await api.post('/api/jobs', { kind: 'report-template', params });
    if (!r.ok) { say('danger', `The job was not queued: ${r.error.message}. ${(r.error.errors ?? []).map((e) => e.message).join('; ')}`); return; }
    say('info', done, 'Queued');
    window.location.hash = `#/jobs/${encodeURIComponent(r.data.job.id)}`;
  }

  async function preview(t) {
    frame?.dispose?.();
    replace(previewHolder, h('p', { class: 'body-sm zl-muted' }, `Loading the preview of ${t.id}`));
    const r = await api.get(`${path`/api/report-templates/${t.id}/preview`}?scope=${encodeURIComponent(t.scope)}`);
    if (!r.ok) { replace(previewHolder, S().Alert({ tone: 'warning', body: `No preview: ${r.error.message}` })); return; }
    frame = reportFrame({ html: r.data.html, title: `Preview of ${t.id}` });
    replace(previewHolder, h('p', { class: 'label' }, `${t.name ?? t.id} (${SCOPE_LABEL[t.scope]}) with its sample`), frame.element);
  }

  async function exportOne(t) {
    const r = await api.blob(`${path`/api/report-templates/${t.id}/export`}?scope=${encodeURIComponent(t.scope)}`);
    if (!r.ok) { say('danger', `${t.id} could not be exported: ${r.error.message}`); return; }
    const url = URL.createObjectURL(r.data);
    const a = h('a', { href: url, download: `${t.id}.zukai-template.json` });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  function jobDialog({ title, from }) {
    let scope = 'user';
    let description = '';
    const error = h('div', { role: 'alert' });
    const scopes = segmented({ legend: 'Save it in', value: scope, options: [{ value: 'user', label: SCOPE_LABEL.user }, { value: 'project', label: 'Project (committed, shared)' }], onChange: (v) => { scope = v; } });
    const text = S().Input({ label: from ? 'What to change' : 'What the template is for', multiline: true, rows: 5, optional: Boolean(from), placeholder: from ? 'Add a Security section after Design; a blue cover' : 'A post-incident review: summary, timeline, root cause, actions with owners', onInput: (e) => { description = e.target.value; } });
    let dialog;
    const go = S().Button({ label: 'Queue', variant: 'primary', onClick: () => {
      if (!from && !description.trim()) { replace(error, S().Alert({ tone: 'warning', body: 'Say what the template is for.' })); return; }
      dialog.close();
      queue({ mode: from ? 'customise' : 'new', scope, ...(from ? { from } : {}), ...(description.trim() ? { description: description.trim() } : {}) }, from ? `The agent drafts a customised copy of ${from}, shows its preview and saves it where you chose.` : 'The agent drafts the template, shows its preview and saves it where you chose.');
    } });
    dialog = S().Dialog({ title, body: h('div', { class: 'zl-stack' }, scopes, text, error), actions: [S().Button({ label: 'Not now', onClick: () => dialog.close() }), go], onClose: () => dialog.element.remove(), className: 'zl-dialog-wide' });
    dialog.open();
  }

  function importBlock() {
    const holder = h('div', { class: 'zl-stack' });
    const input = document.createElement('input');
    input.type = 'file';
    input.setAttribute('accept', '.json,application/json');
    input.className = 'zl-file-input';
    input.setAttribute('aria-label', 'Template file to import');
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > MAX_FILE) { replace(holder, S().Alert({ tone: 'warning', body: 'The file is larger than 1 MB; an export file is smaller.' })); return; }
      const text = await file.text();
      const check = await api.post('/api/report-templates/import?check=1', { file: text, scope: 'user' });
      if (!check.ok) {
        replace(holder, S().Alert({ tone: 'danger', title: 'This file is refused', body: (check.error.errors ?? [{ message: check.error.message }]).map((e) => `${e.path ? `${e.path}: ` : ''}${e.message}`).join(' · ') }));
        return;
      }
      let scope = 'user';
      let replaceIt = false;
      importFrame?.dispose?.();
      const pv = reportFrame({ html: check.data.preview, title: `Preview of ${check.data.id}` });
      importFrame = pv;
      const existsNote = h('p', { class: 'body-sm' });
      const sayExists = (exists, where) => replace(existsNote, exists ? `A template ${check.data.id} exists in the ${SCOPE_LABEL[where]} scope; tick "Replace it" to replace it.` : `No template ${check.data.id} exists in the ${SCOPE_LABEL[where]} scope yet.`);
      sayExists(check.data.exists, 'user');
      const save = S().Button({ label: `Import ${check.data.id}`, variant: 'primary', onClick: async () => {
        const r = await api.post('/api/report-templates/import', { file: text, scope, replace: replaceIt });
        if (r.ok) { say('success', `${check.data.id} was imported into the ${SCOPE_LABEL[scope]} scope.`); replace(holder); load(); return; }
        say(r.error.code === 'exists' ? 'warning' : 'danger', r.error.code === 'exists' ? `${check.data.id} exists in that scope; tick "Replace it" to replace it.` : `Not imported: ${r.error.message}`);
      } });
      replace(holder,
        S().Alert({ tone: 'success', title: `${check.data.name} (${check.data.id}) passed validation`, body: `Sections: ${check.data.sections.map((s) => s.name).join(', ')}.` }),
        pv.element,
        segmented({ legend: 'Import into', value: scope, options: [{ value: 'user', label: SCOPE_LABEL.user }, { value: 'project', label: 'Project (committed, shared)' }], onChange: async (v) => {
          scope = v;
          const again = await api.post('/api/report-templates/import?check=1', { file: text, scope: v });
          if (again.ok) sayExists(again.data.exists, v);
        } }),
        existsNote,
        S().Checkbox({ label: 'Replace it when the id exists', onChange: (e) => { replaceIt = e.target.checked; } }),
        h('div', { class: 'zl-row' }, save));
    });
    return h('section', { class: 'zl-card-plain zl-stack' },
      h('h2', { class: 'heading-sm' }, 'Import a template'),
      h('p', { class: 'body-sm zl-muted' }, 'An export file (<id>.zukai-template.json). It is checked in full, and its preview shown, before anything is saved; HTML that could run code or fetch from elsewhere is refused.'),
      input, holder);
  }

  function render() {
    const head = h('header', { class: 'zl-page-header zl-page-header-row' },
      h('div', { class: 'zl-stack-tight' },
        h('div', { class: 'eyebrow' }, 'Reports'),
        h('h1', { class: 'display-md' }, 'Templates'),
        h('p', { class: 'body zl-muted' }, 'What a report holds and how it looks. Project templates are committed with the project, yours stay on this machine, built-in ones come with Zukai.')),
      h('div', { class: 'zl-row' }, S().Button({ label: 'New template', variant: 'primary', icon: 'plus', onClick: () => jobDialog({ title: 'New template' }) })));
    if (failure) { replace(element, head, S().Alert({ tone: 'danger', body: failure })); return; }
    if (!rows) { replace(element, head, h('p', { class: 'body zl-muted' }, 'Reading the templates')); return; }
    const table = S().Table({
      caption: 'Templates of every scope',
      rows,
      columns: [
        { key: 'id', label: 'Template', render: (t) => h('div', {}, h('div', { class: 'label' }, t.name ?? t.id), h('div', { class: 'code caption zl-muted' }, t.id)) },
        { key: 'scope', label: 'Scope', render: (t) => badge({ label: SCOPE_LABEL[t.scope] ?? t.scope, outline: t.scope === 'built-in' }) },
        { key: 'state', label: 'State', render: (t) => h('div', { class: 'zl-stack-tight' },
          h('div', { class: 'zl-row' },
            !t.valid ? badge({ label: 'Invalid', tone: 'danger', icon: 'alert' }) : t.used ? badge({ label: 'Used', tone: 'success', icon: 'check' }) : badge({ label: `Overridden by ${SCOPE_LABEL[t.overriddenBy] ?? t.overriddenBy}`, outline: true }),
            t.overridesBuiltIn ? badge({ label: 'Overrides a built-in template', tone: 'warning' }) : null),
          !t.valid ? h('p', { class: 'caption zl-muted' }, t.errors.slice(0, 3).map((e) => `${e.path}: ${e.message}`).join(' · ')) : null) },
        { key: 'actions', label: 'Actions', render: (t) => h('div', { class: 'zl-row' },
          S().Button({ label: 'Preview', variant: 'ghost', size: 'sm', disabled: !t.valid, onClick: () => preview(t) }),
          S().Button({ label: 'Customise', variant: 'ghost', size: 'sm', disabled: !t.valid, onClick: () => jobDialog({ title: `Customise ${t.id}`, from: t.id }) }),
          S().Button({ label: `Export ${t.id}`, variant: 'ghost', size: 'sm', iconOnly: true, icon: 'download', disabled: !t.valid, onClick: () => exportOne(t) }),
          t.valid && t.used ? S().Button({ label: 'Use', variant: 'ghost', size: 'sm', href: `#/reports/new/${encodeURIComponent(t.id)}` }) : null) },
      ],
    });
    // Built once: a reload after the agent wrote, or a route, keeps a checked file and its Import button.
    importSection ??= importBlock();
    replace(element, head, notice, table, previewHolder, importSection);
    const pick = selected && rows.find((t) => t.id === selected && t.valid);
    if (pick) preview(pick);
  }

  async function load() {
    const r = await api.get('/api/report-templates');
    if (r.ok) { failure = null; rows = r.data.templates; } else failure = `The templates could not be read: ${r.error.message}`;
    render();
  }
  render();
  load();
  return { element, title: 'Templates', reload: load, route: (parts) => { selected = parts[1]; render(); }, dispose: () => { frame?.dispose?.(); importFrame?.dispose?.(); } };
}
