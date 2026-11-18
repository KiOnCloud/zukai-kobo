/**
 * The Model tab: every label of a diagram as a form, and its raw JSON beside it; both edit one
 * IR. Validate asks the server; Save changes queues an `apply-edit` job with the `rev` the IR
 * was loaded with, and is enabled only for a changed IR that passed the last validation.
 */
import { S } from '../sienna.mjs';
import { h, replace } from '../dom.mjs';
import { api, path } from '../api.mjs';

/** Set the string at a JSON pointer of `labelsOf`. */
function setAt(ir, pointer, value) {
  const parts = pointer.split('/').slice(1).map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));
  let at = ir;
  for (const p of parts.slice(0, -1)) at = at[p];
  at[parts.at(-1)] = value;
}

const placeOf = (l) => (l.collection ? `${l.id} · ${l.field}` : 'Title of the diagram');

export function modelEditor({ panel, run, detail, queue, diagram: chosen }) {
  let diagram = chosen ?? detail.diagrams[0]?.id;
  let loaded = null; // { ir, rev, labels }
  let ir = null;
  let mode = 'labels';
  let validated = null; // the JSON text that passed the last validation
  let errors = [];
  let findings = [];
  let jsonError = null;
  const body = h('div', { class: 'zl-stack' });
  const status = h('div', { role: 'status' });

  const text = () => JSON.stringify(ir, null, 2);
  const changed = () => loaded && text() !== JSON.stringify(loaded.ir, null, 2);
  const canSave = () => changed() && !jsonError && validated === text() && errors.length === 0;

  function labelsForm() {
    // One group per collection, in the order of `labelsOf`, so the fields keep that order.
    const groups = [];
    for (const l of loaded.labels) {
      const key = l.collection ?? 'diagram';
      if (groups.at(-1)?.key !== key) groups.push({ key, labels: [] });
      groups.at(-1).labels.push(l);
    }
    return h('div', { class: 'zl-labels' }, groups.map((g) => h('section', { class: 'zl-label-group' },
      h('h3', { class: 'eyebrow' }, `${g.key} · ${g.labels.length}`),
      g.labels.map((l) => {
        const error = errors.find((e) => e.path === l.path);
        return S().Input({ label: placeOf(l), helper: l.path, error: error ? `${error.message}${error.hint ? `: ${error.hint}` : ''}` : undefined, value: readAt(l.path), onInput: (e) => { setAt(ir, l.path, e.target.value); validated = null; updateActions(); } });
      }))));
  }
  const readAt = (pointer) => pointer.split('/').slice(1).reduce((at, p) => at?.[p.replace(/~1/g, '/').replace(/~0/g, '~')], ir) ?? '';

  function jsonForm() {
    return S().Input({ label: 'The IR as JSON', multiline: true, rows: 24, value: text(), className: 'zl-json', error: jsonError ?? undefined, onInput: (e) => {
      try { ir = JSON.parse(e.target.value); jsonError = null; } catch { jsonError = 'This is not valid JSON yet.'; }
      validated = null;
      updateActions();
    } });
  }

  const saveButton = S().Button({ label: 'Save changes', variant: 'primary', disabled: true, onClick: save });
  const validateButton = S().Button({ label: 'Validate', variant: 'secondary', onClick: validate });
  function updateActions() { saveButton.disabled = !canSave(); }

  async function validate() {
    if (jsonError) return;
    const r = await api.post('/api/validate', { ir });
    if (!r.ok) { replace(status, S().Alert({ tone: 'danger', body: `The server did not validate the IR: ${r.error.message}` })); return; }
    errors = r.data.errors;
    findings = r.data.glossary ?? [];
    validated = r.data.ok ? text() : null;
    draw();
  }

  function save() {
    if (!canSave()) return;
    queue('apply-edit', { diagram, baseRev: loaded.rev, ir }, () => {
      replace(status, S().Alert({ tone: 'info', title: 'Queued', body: `The edit waits in the queue. The agent applies it with the revise skill; a run on FigJam gets its IR and files changed, not its board.` }));
    });
  }

  function draw() {
    const parts = [];
    if (errors.length) parts.push(S().Alert({ tone: 'danger', title: `${errors.length} problem${errors.length === 1 ? '' : 's'} in this IR`, body: errors.map((e) => `${e.path} ${e.message}${e.hint ? ` (${e.hint})` : ''}`).join('\n') }));
    else if (validated === text() && validated !== null) parts.push(S().Alert({ tone: 'success', body: changed() ? 'The IR is valid. Save the changes to queue them.' : 'The IR is valid and unchanged.' }));
    if (findings.length) parts.push(h('div', { class: 'zl-findings' }, h('h3', { class: 'heading-sm' }, 'Glossary'), findings.map((f) => h('p', { class: 'body-sm' }, `${f.level === 'blocking' ? 'Blocking' : 'Warning'}: "${f.text}" at ${f.path} uses the avoided word "${f.avoided}"${f.expected ? `; the confirmed term is "${f.expected}"` : ''}.`))));
    const tabs = S().Tabs({ variant: 'segment', panel: false, label: 'Edit the model as', value: mode, items: [{ value: 'labels', label: 'Labels' }, { value: 'json', label: 'JSON' }], onChange: (v) => { mode = v; draw(); } });
    replace(body, h('div', { class: 'zl-picture-bar' }, tabs, h('p', { class: 'caption zl-muted' }, 'Validate, then save: the edit becomes a job the agent applies with the revise skill.')), mode === 'labels' ? labelsForm() : jsonForm(), ...parts, status, h('div', { class: 'zl-actions zl-actions-sticky' }, validateButton, saveButton));
    updateActions();
  }

  async function load() {
    replace(body, h('p', { class: 'body-sm zl-muted' }, 'Reading the model'));
    const r = await api.get(path`/api/runs/${run}/diagrams/${diagram}`);
    if (!r.ok || !r.data.ir) { replace(body, S().Alert({ tone: 'danger', body: r.ok ? 'The IR file of this diagram is not valid JSON; fix it in the files of the run.' : r.error.message })); return; }
    loaded = { ir: r.data.ir, rev: r.data.rev, labels: r.data.labels };
    ir = structuredClone(r.data.ir);
    errors = r.data.errors;
    findings = [];
    validated = null;
    jsonError = null;
    draw();
  }

  const pages = !chosen && detail.diagrams.length > 1 ? S().Select({ label: 'Diagram', value: diagram, options: detail.diagrams.map((d) => ({ value: d.id, label: d.title ?? d.id })), onChange: (e) => { diagram = e.target.value; load(); } }) : null;
  replace(panel, pages, body);
  load();
}
