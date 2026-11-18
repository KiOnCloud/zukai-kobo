/** The forms that queue a new diagram (draw) and a recook. One column, labels above, the action last. */
import { S } from '../sienna.mjs';
import { h, replace } from '../dom.mjs';
import { api } from '../api.mjs';

const KINDS = ['sequence', 'flowchart', 'activity', 'state', 'er', 'class', 'architecture', 'usecase'];
const DOC_LANGS = ['en', 'ja', 'vi'];

function options(state, notice, { recook }) {
  const fields = [];
  fields.push(S().Select({ label: 'Target', value: state.to, options: [{ value: 'drawio', label: 'draw.io file (editable)' }, { value: 'mermaid', label: 'Mermaid text' }, { value: 'figjam', label: 'FigJam board' }], onChange: (e) => { state.to = e.target.value; } }));
  fields.push(S().Select({ label: 'Kind', optional: true, value: state.kind ?? '', options: [{ value: '', label: 'Let the agent ask' }, ...KINDS.map((k) => ({ value: k, label: k }))], onChange: (e) => { state.kind = e.target.value || undefined; } }));
  fields.push(S().Select({ label: 'Level of detail', optional: true, value: state.scope ?? '', options: [{ value: '', label: 'Let the agent ask' }, { value: 'overview', label: 'Overview' }, { value: 'detailed', label: 'Detailed' }], onChange: (e) => { state.scope = e.target.value || undefined; } }));
  fields.push(S().Select({ label: 'View', optional: true, value: state.audience ?? '', options: [{ value: '', label: 'Let the agent ask' }, { value: 'technical', label: 'Technical' }, { value: 'business', label: 'Business' }, { value: 'both', label: 'Both' }], onChange: (e) => { state.audience = e.target.value || undefined; } }));
  fields.push(S().Switch({ label: 'Also write pictures (svg/)', checked: Boolean(state.svg), onChange: (e) => { state.svg = e.target.checked; } }));
  fields.push(h('fieldset', { class: 'zl-question' }, h('legend', { class: 'label' }, 'Description tables'), h('div', { class: 'zl-row' }, DOC_LANGS.map((lang) => S().Checkbox({ label: lang, checked: state.doc.includes(lang), onChange: (e) => { state.doc = e.target.checked ? [...state.doc, lang] : state.doc.filter((x) => x !== lang); } })))));
  return fields;
}

const paramsOf = (state, base) => ({ ...base, to: state.to, ...(state.kind ? { kind: state.kind } : {}), ...(state.scope ? { scope: state.scope } : {}), ...(state.audience ? { audience: state.audience } : {}), ...(state.svg ? { svg: true } : {}), ...(state.doc.length ? { doc: state.doc } : {}) });

export function newDiagram({ recook = false } = {}) {
  const element = h('div', { class: 'zl-page' });
  const state = { mode: '', request: '', source: '', to: 'drawio', doc: [], svg: false };
  const notice = h('div', { role: 'status' });

  async function submit() {
    const kind = recook ? 'recook' : 'draw';
    const params = recook ? paramsOf(state, { source: state.source.trim() }) : paramsOf(state, { ...(state.mode ? { mode: state.mode } : {}), request: state.request.trim() });
    const r = await api.post('/api/jobs', { kind, params });
    if (!r.ok) {
      const lines = (r.error.errors ?? []).map((e) => e.message).join(' ');
      replace(notice, S().Alert({ tone: 'danger', title: 'The job was not queued', body: `${r.error.message}. ${lines} Correct the form and queue it again.` }));
      return;
    }
    replace(notice, S().Alert({ tone: 'info', title: 'Queued', body: 'The job waits in the queue on the right. The agent picks it up when it is free.' }));
  }

  const intro = recook
    ? [h('div', { class: 'eyebrow' }, 'Diagrams'), h('h1', { class: 'display-md' }, 'Recook a diagram'), h('p', { class: 'body zl-muted' }, 'Turn a diagram drawn elsewhere into a Zukai run. Labels are copied as the source writes them.')]
    : [h('div', { class: 'eyebrow' }, 'Diagrams'), h('h1', { class: 'display-md' }, 'New diagram'), h('p', { class: 'body zl-muted' }, 'Describe what to draw. The agent asks what this form leaves open.')];

  const fields = recook
    ? [S().Input({ label: 'Source', helper: 'A file inside the project (docs/flow.drawio, design.puml) or a FigJam board link', value: state.source, onInput: (e) => { state.source = e.target.value; } })]
    : [
      S().Radio({ label: 'Input', name: 'mode', value: state.mode, options: [{ value: '', label: 'Let the agent ask', description: 'The agent asks which input you have' }, { value: 'clarify', label: 'Requirements to clarify', description: 'A flow or feature described in words' }, { value: 'scout', label: 'Code to scout', description: 'The diagram follows the source code of this project' }, { value: 'brainstorm', label: 'An idea to brainstorm', description: 'Not yet sure which diagrams would help' }], onChange: (e) => { state.mode = e.target.value; } }),
      S().Input({ label: 'Request', multiline: true, rows: 5, helper: 'At most 4000 characters', value: state.request, onInput: (e) => { state.request = e.target.value; } }),
    ];

  replace(element,
    h('header', { class: 'zl-page-header' }, intro),
    h('form', { class: 'zl-form', onSubmit: (e) => { e.preventDefault(); submit(); } },
      fields, options(state, notice, { recook }), notice,
      h('div', { class: 'zl-actions' }, S().Button({ label: recook ? 'Queue the recook' : 'Queue the diagram', variant: 'primary', type: 'submit' }))));
  return { element, reload: () => {}, title: recook ? 'Recook' : 'New diagram' };
}
