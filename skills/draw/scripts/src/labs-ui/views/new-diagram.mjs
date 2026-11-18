/**
 * The forms that queue a new diagram (draw) and a recook. Each choice is shown as what it is:
 * the inputs and the kinds as tiles with a glyph and a sentence, the level of detail and the
 * view as segments, the outputs as tiles and chips. "Ask me later" is a choice of its own,
 * drawn apart: the agent asks it in a question card while the job runs. A summary beside the
 * form says what is set, what the agent will ask, and whether an agent is there to take it.
 */
import { S } from '../sienna.mjs';
import { h, replace } from '../dom.mjs';
import { api } from '../api.mjs';
import { DIAGRAM_KINDS, TARGETS, MODES, SCOPES, AUDIENCES, DOC_LANGS, EXAMPLES, compatNote, kindLabel, runsDirOf } from '../words.mjs';
import { choiceTiles, segmented, toggleChips } from './choice.mjs';
import { glyph } from './glyphs.mjs';

const MAX_REQUEST = 4000;
const LATER = { value: '', label: 'Ask me later', auto: true };
const SOURCES = ['docs/flow.drawio', 'design/login.puml', 'notes/order.mmd', 'https://www.figma.com/board/…'];

const step = (n, title, hint, ...body) => h('section', { class: 'zl-step-card' },
  h('header', { class: 'zl-step-head' }, h('span', { class: 'zl-step-num caption', 'aria-hidden': 'true' }, String(n)), h('div', {}, h('h2', { class: 'heading-sm' }, title), hint ? h('p', { class: 'body-sm zl-muted' }, hint) : null)),
  h('div', { class: 'zl-step-body' }, body));

export function newDiagram({ store, recook = false, mode: startMode } = {}) {
  const element = h('div', { class: 'zl-page' });
  const state = { mode: MODES.some((m) => m.value === startMode) ? startMode : '', request: '', source: '', to: 'drawio', kind: '', scope: '', audience: '', svg: false, doc: [] };
  const summary = h('div', { class: 'zl-summary-body' });
  const notice = h('div', { role: 'status' });
  const compat = h('div', {});
  const requestError = h('div', { role: 'alert' });
  let queued = null;

  // ---------------------------------------------------------------- fields
  const counter = h('span', { class: 'caption zl-muted' });
  const countWords = () => replace(counter, `${state.request.length} / ${MAX_REQUEST}`);
  const requestField = S().Input({ label: 'Request', multiline: true, rows: 5, placeholder: 'What should the diagram explain? Name the flow, the feature or the part of the code.', value: state.request, onInput: (e) => { state.request = e.target.value; countWords(); replace(requestError); drawSummary(); } });
  const textarea = requestField.querySelector('textarea');
  if (textarea) textarea.setAttribute('maxlength', String(MAX_REQUEST));
  const examples = h('div', { class: 'zl-row zl-examples' });
  function drawExamples() {
    replace(examples, h('span', { class: 'caption zl-muted' }, 'Try'), (EXAMPLES[state.mode] ?? EXAMPLES['']).map((text) => S().Chip({ label: text, onClick: () => {
      state.request = text;
      if (textarea) { textarea.value = text; textarea.focus(); }
      countWords();
      drawSummary();
    } })));
  }
  const sourceField = S().Input({ label: 'Source', helper: 'A file inside this project, or a FigJam board link', placeholder: SOURCES[0], value: state.source, onInput: (e) => { state.source = e.target.value; replace(requestError); drawSummary(); } });

  const modeTiles = choiceTiles({
    legend: 'Input', name: 'mode', value: state.mode, columns: 'four',
    options: [...MODES.map((m) => ({ ...m, glyph: m.value })), { value: '', label: 'Not sure yet', description: 'The agent asks which input you have', glyph: 'auto', auto: true }],
    onChange: (v) => { state.mode = v; drawExamples(); drawSummary(); },
  });
  const kindTiles = choiceTiles({
    legend: 'Kind', name: 'kind', value: state.kind, columns: 'three',
    options: [{ value: '', label: 'Ask me later', description: recook ? 'Kept from the source when it is clear' : 'The agent proposes one from your request', glyph: 'auto', auto: true }, ...DIAGRAM_KINDS.map((k) => ({ ...k, glyph: k.value }))],
    onChange: (v) => { state.kind = v; drawCompat(); drawSummary(); },
  });
  const scopeSegment = segmented({ legend: 'Level of detail', name: 'scope', value: state.scope, options: [LATER, ...SCOPES], onChange: (v) => { state.scope = v; drawSummary(); } });
  const audienceSegment = segmented({ legend: 'View', name: 'audience', value: state.audience, options: [LATER, ...AUDIENCES], onChange: (v) => { state.audience = v; drawSummary(); } });
  const targetTiles = choiceTiles({
    legend: 'Target', name: 'target', value: state.to, columns: 'three',
    options: TARGETS.map((t) => ({ ...t, glyph: t.value })),
    onChange: (v) => { state.to = v; drawCompat(); drawSummary(); },
  });
  const svgSwitch = S().Switch({ label: 'Also write SVG pictures (svg/), for a wiki or a document', checked: state.svg, onChange: (e) => { state.svg = e.target.checked; drawSummary(); } });
  const docChips = toggleChips({ legend: 'Description tables', hint: 'Every element of every diagram as Markdown tables, with headings in these languages.', values: state.doc, options: DOC_LANGS, onChange: (v) => { state.doc = v; drawSummary(); } });

  function drawCompat() {
    const note = compatNote(state.kind, state.to);
    replace(compat, note ? S().Alert({ tone: 'info', body: note }) : null);
  }

  // ---------------------------------------------------------------- summary
  const paramsOf = () => ({
    ...(recook ? { source: state.source.trim() } : { ...(state.mode ? { mode: state.mode } : {}), request: state.request.trim() }),
    to: state.to, ...(state.kind ? { kind: state.kind } : {}), ...(state.scope ? { scope: state.scope } : {}), ...(state.audience ? { audience: state.audience } : {}), ...(state.svg ? { svg: true } : {}), ...(state.doc.length ? { doc: state.doc } : {}),
  });

  // Two ways to send one form: the summary's button beside a wide form, the bar's below a narrow
  // one. CSS shows one of them, so one primary button is in view.
  const submit = S().Button({ label: recook ? 'Queue the recook' : 'Queue the diagram', variant: 'primary', block: true, type: 'submit', className: 'zl-summary-submit' });
  const barSubmit = S().Button({ label: recook ? 'Queue the recook' : 'Queue the diagram', variant: 'primary', type: 'submit' });
  const barText = h('span', { class: 'body-sm zl-muted' });
  const bar = h('div', { class: 'zl-compose-bar' }, barText, barSubmit);

  function drawSummary() {
    if (queued) return;
    const later = [];
    const rows = [];
    const row = (k, v, isLater) => rows.push(h('div', { class: 'zl-summary-row' }, h('dt', { class: 'body-sm zl-muted' }, k), h('dd', { class: ['body-sm', isLater ? 'zl-later' : null] }, v)));
    if (recook) row('Source', state.source.trim() || 'Not given yet', !state.source.trim());
    else {
      const m = MODES.find((x) => x.value === state.mode);
      row('Input', m ? m.label : 'Ask me later', !m);
      if (!m) later.push('the input');
    }
    row('Kind', state.kind ? kindLabel(state.kind) : 'Ask me later', !state.kind);
    if (!state.kind && !recook) later.push('the kind');
    row('Detail', SCOPES.find((x) => x.value === state.scope)?.label ?? 'Ask me later', !state.scope);
    if (!state.scope) later.push('the level of detail');
    row('View', AUDIENCES.find((x) => x.value === state.audience)?.label ?? 'Ask me later', !state.audience);
    if (!state.audience) later.push('the view');
    row('Target', TARGETS.find((x) => x.value === state.to)?.label ?? state.to);
    const extras = [state.svg ? 'SVG pictures' : null, state.doc.length ? `tables in ${state.doc.join(', ')}` : null].filter(Boolean);
    row('Also', extras.length ? extras.join(', ') : 'Nothing else');
    const agent = store?.get().state?.agent;
    replace(barText, later.length ? `The agent will ask ${later.length} thing${later.length === 1 ? '' : 's'} later` : 'Everything is set');
    bar.hidden = false;
    replace(summary,
      h('dl', { class: 'zl-summary-list' }, rows),
      later.length
        ? h('p', { class: 'body-sm zl-summary-later' }, glyph('auto', { size: 'sm' }), h('span', {}, `The agent will ask you ${later.join(', ').replace(/, ([^,]*)$/, ' and $1')} in a question card.`))
        : h('p', { class: 'body-sm zl-muted' }, 'Everything is set; the agent asks only if the request leaves something open.'),
      agent && !agent.attached ? S().Alert({ tone: 'warning', body: 'No agent is attached. The job waits in the queue until one is.' }) : null);
  }

  async function onSubmit(e) {
    e.preventDefault();
    if (queued) return;
    const text = recook ? state.source.trim() : state.request.trim();
    if (!text) {
      replace(requestError, S().Alert({ tone: 'warning', body: recook ? 'Write the source to recook: a file inside the project or a FigJam board link.' : 'Write what the diagram should explain, then queue it.' }));
      (recook ? sourceField : requestField).querySelector('input, textarea')?.focus();
      return;
    }
    submit.disabled = true;
    barSubmit.disabled = true;
    const r = await api.post('/api/jobs', { kind: recook ? 'recook' : 'draw', params: paramsOf() });
    submit.disabled = false;
    barSubmit.disabled = false;
    if (!r.ok) {
      const lines = (r.error.errors ?? []).map((x) => x.message).join(' ');
      replace(notice, S().Alert({ tone: 'danger', title: 'The job was not queued', body: `${r.error.message}. ${lines} Correct the form and queue it again.` }));
      return;
    }
    queued = r.data?.job ?? { id: null };
    replace(notice);
    replace(summary,
      h('div', { class: 'zl-queued' },
        S().icon('circle-check'),
        h('p', { class: 'heading-sm' }, 'Queued'),
        h('p', { class: 'body-sm zl-muted' }, 'The agent picks the job up when it is free. Its steps and questions appear in the agent panel.')),
      h('div', { class: 'zl-stack-tight' },
        queued.id ? S().Button({ label: 'Follow the job', variant: 'secondary', block: true, href: `#/jobs/${encodeURIComponent(queued.id)}` }) : null,
        S().Button({ label: recook ? 'Recook another' : 'Queue another', variant: 'ghost', block: true, onClick: () => { queued = null; submit.hidden = false; drawSummary(); } })));
    submit.hidden = true;
    bar.hidden = true;
    summary.scrollIntoView?.({ block: 'nearest' });
  }

  const intro = recook
    ? [h('div', { class: 'eyebrow' }, 'Diagrams'), h('h1', { class: 'display-md' }, 'Recook a diagram'), h('p', { class: 'body zl-muted' }, 'Turn a diagram made elsewhere into a Zukai run: a draw.io, Mermaid or PlantUML file, or a FigJam board. Labels are copied as the source writes them, and a check makes sure none is lost.')]
    : [h('div', { class: 'eyebrow' }, 'Diagrams'), h('h1', { class: 'display-md' }, 'New diagram'), h('p', { class: 'body zl-muted' }, 'Say what to draw and set what you already know. Whatever you leave for later, the agent asks while the job runs.')];

  const steps = recook
    ? [
      step(1, 'Where is the diagram?', `The file stays as it is; the run is written under ${runsDirOf(store)}/.`, sourceField, h('p', { class: 'caption zl-muted' }, `For example ${SOURCES.join(', ')}`), requestError),
      step(2, 'What kind is it?', null, kindTiles),
      step(3, 'How much, for whom?', null, h('div', { class: 'zl-split' }, scopeSegment, audienceSegment)),
      step(4, 'What should come out?', null, targetTiles, compat, svgSwitch, docChips),
    ]
    : [
      step(1, 'What do you start from?', null, modeTiles),
      step(2, 'What should it explain?', null, requestField, h('div', { class: 'zl-row zl-spread' }, examples, counter), requestError),
      step(3, 'Which kind of diagram?', 'Pick one if you know it; several can come out of one request.', kindTiles),
      step(4, 'How much, for whom?', 'Technical keeps component and endpoint names; business keeps the flow and the rules.', h('div', { class: 'zl-split' }, scopeSegment, audienceSegment)),
      step(5, 'What should come out?', null, targetTiles, compat, svgSwitch, docChips),
    ];

  replace(element,
    h('header', { class: 'zl-page-header' }, intro),
    h('form', { class: 'zl-compose', onSubmit, novalidate: true },
      h('div', { class: 'zl-compose-steps' }, steps, bar),
      h('aside', { class: 'zl-summary', 'aria-label': 'Summary of the job' },
        h('h2', { class: 'heading-sm' }, 'The job'),
        summary, notice, submit)));
  countWords();
  drawExamples();
  drawCompat();
  drawSummary();
  return {
    element,
    reload: () => {},
    stateChanged: drawSummary,
    title: recook ? 'Recook' : 'New diagram',
  };
}
