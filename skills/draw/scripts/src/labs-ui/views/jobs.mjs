/**
 * The Jobs section: every job the server keeps, with filters by state, and one job on a page of
 * its own: what was asked for, the agent's question (answered here, full width), the questions
 * already answered, every step, the report, and for a failed job why and the undo.
 */
import { S } from '../sienna.mjs';
import { h, replace, when, ago, duration } from '../dom.mjs';
import { api, path } from '../api.mjs';
import { KIND_LABEL, STATE_BADGE, DIAGRAM_KINDS, TARGETS, MODES } from '../words.mjs';
import { badge, textBlock } from './badge.mjs';
import { questionCard, answeredList } from './question-card.mjs';
import { failedLines, confirmDialog } from './job-panel.mjs';

const FILTERS = [
  { value: 'all', label: 'All', states: null },
  { value: 'open', label: 'Open', states: ['running', 'needs-input'] },
  { value: 'queued', label: 'Queued', states: ['queued'] },
  { value: 'done', label: 'Done', states: ['done'] },
  { value: 'failed', label: 'Failed or cancelled', states: ['failed', 'cancelled'] },
];

function jobsList({ store }) {
  const element = h('div', { class: 'zl-page' });
  let jobs = null;
  let failure = null;
  let filter = 'all';

  function render() {
    const header = h('header', { class: 'zl-page-header' },
      h('div', { class: 'eyebrow' }, 'Jobs'),
      h('h1', { class: 'display-md' }, 'What the agent was asked to do'),
      h('p', { class: 'body zl-muted' }, 'Every change made from the console is a job: queued here, carried out by the attached agent with the Zukai skills, one at a time. The server keeps the last 50 closed jobs.'));
    if (failure) { replace(element, header, S().Alert({ tone: 'danger', title: 'The jobs could not be read', body: failure })); return; }
    if (!jobs) { replace(element, header, h('p', { class: 'body zl-muted' }, 'Reading the jobs')); return; }
    const count = (f) => (f.states ? jobs.filter((j) => f.states.includes(j.state)).length : jobs.length);
    const tabs = S().Tabs({ variant: 'segment', panel: false, label: 'Show jobs that are', value: filter, items: FILTERS.map((f) => ({ value: f.value, label: f.label, count: count(f) })), onChange: (v) => { filter = v; render(); } });
    const f = FILTERS.find((x) => x.value === filter);
    const rows = jobs.filter((j) => !f.states || f.states.includes(j.state));
    const columns = [
      { key: 'kind', label: 'Job', render: (j) => h('div', { class: 'zl-stack-tight' }, h('a', { class: 'label', href: `#/jobs/${encodeURIComponent(j.id)}` }, KIND_LABEL[j.kind] ?? j.kind), j.request ? h('span', { class: 'body-sm zl-muted zl-clamp' }, j.request) : null) },
      { key: 'run', label: 'Run', render: (j) => (j.run ? h('a', { class: 'code body-sm', href: `#/diagrams/${encodeURIComponent(j.run)}` }, j.run) : h('span', { class: 'zl-muted' }, '—')) },
      { key: 'state', label: 'State', render: (j) => badge(STATE_BADGE[j.state] ?? STATE_BADGE.queued) },
      { key: 'created', label: 'Queued', muted: true, render: (j) => ago(j.createdAt) },
      { key: 'took', label: 'Took', numeric: true, render: (j) => (j.startedAt ? duration(j.startedAt, j.finishedAt) : '') },
    ];
    const body = jobs.length === 0
      ? h('div', { class: 'zl-empty zl-empty-hero' }, h('p', { class: 'display-sm' }, 'No jobs yet'), h('p', { class: 'body zl-muted' }, 'Queue a new diagram, revise a run or ask for glossary suggestions; each becomes a job here.'), S().Button({ label: 'New diagram', variant: 'primary', icon: 'plus', href: '#/diagrams/new' }))
      : rows.length === 0 ? h('p', { class: 'body zl-muted' }, 'No job is in this state.') : S().Table({ columns, rows, caption: 'Jobs, newest first' });
    replace(element, header, jobs.length ? h('div', { class: 'zl-toolbar' }, tabs) : null, body);
  }

  async function load() {
    const r = await api.get('/api/jobs');
    if (!r.ok) failure = r.error.message; else { failure = null; jobs = r.data.jobs; }
    render();
  }
  render();
  load();
  return { element, title: 'Jobs', reload: load, stateChanged: load, store };
}

/** The parameters of a job in words, beside their names. */
function paramRows(job) {
  const p = job.params ?? {};
  const rows = [];
  const add = (k, v) => { if (v !== undefined && v !== null && v !== '') rows.push([k, v]); };
  add('Input', MODES.find((m) => m.value === p.mode)?.label);
  add('Source', p.source);
  add('Kind', DIAGRAM_KINDS.find((k) => k.value === p.kind)?.label ?? p.kind);
  add('Level of detail', p.scope);
  add('View', p.audience);
  add('Target', TARGETS.find((t) => t.value === p.to)?.label ?? p.to);
  add('Diagram', p.diagram);
  add('Restore to', p.target);
  if (p.svg) add('Pictures', 'SVG under svg/');
  if (p.doc) add('Tables', p.doc.join(', '));
  if (p.preview) add('Drafts', 'Shown before the run changes');
  if (p.runs) add('Runs', p.runs === 'all' ? 'Every run' : p.runs.join(', '));
  return rows;
}

function jobPage({ store, id, setCrumbs }) {
  const element = h('div', { class: 'zl-page' });
  let job = null;
  let missing = false;
  const notice = h('div', { role: 'status' });
  const say = (tone, body) => replace(notice, S().Alert({ tone, body, dismissible: true }));

  async function queueRestore(run, target) {
    const r = await api.post('/api/jobs', { kind: 'restore', params: { run, target } });
    if (!r.ok) say('danger', `The undo was not queued: ${r.error.message}`); else say('info', 'The undo is queued as a job of its own.');
  }

  function render() {
    if (missing) {
      replace(element, h('div', { class: 'zl-empty zl-empty-hero' }, h('p', { class: 'display-sm' }, 'No such job'), h('p', { class: 'body zl-muted' }, 'The server keeps the last 50 closed jobs, and forgets them when it is started again.'), S().Button({ label: 'All jobs', variant: 'secondary', href: '#/jobs' })));
      return;
    }
    if (!job) { replace(element, h('p', { class: 'body zl-muted' }, 'Reading the job')); return; }
    const asking = job.state === 'needs-input' && job.ask;
    store.set({ answeringHere: asking ? job.id : null });
    const facts = [
      ['Job', h('span', { class: 'code' }, job.id)],
      job.run ? ['Run', h('a', { class: 'code', href: `#/diagrams/${encodeURIComponent(job.run)}` }, job.run)] : null,
      ['Queued', when(job.createdAt)],
      job.startedAt ? ['Started', when(job.startedAt)] : null,
      job.finishedAt ? ['Finished', when(job.finishedAt)] : null,
      job.startedAt ? ['Took', duration(job.startedAt, job.finishedAt)] : null,
      ...paramRows(job),
    ].filter(Boolean);
    const actions = [];
    if (job.state === 'queued') actions.push(S().Button({ label: 'Cancel the job', variant: 'secondary', size: 'sm', onClick: () => confirmDialog({ title: 'Cancel this job?', body: 'It leaves the queue; nothing was changed yet.', action: 'Cancel the job', keep: 'Keep it queued', run: async () => { const r = await api.post(path`/api/jobs/${job.id}/cancel`); if (!r.ok) say('danger', `The job was not cancelled: ${r.error.message}`); load(); } }) }));
    if (job.silent) actions.push(S().Button({ label: 'Mark as failed', variant: 'danger', size: 'sm', onClick: () => confirmDialog({ title: 'Mark this job as failed?', body: 'The agent has not been heard from for 15 minutes. The job ends as failed; the run may be half changed.', action: 'Mark as failed', run: async () => { const r = await api.post(path`/api/jobs/${job.id}/fail`); if (!r.ok) say('danger', `The job was not marked as failed: ${r.error.message}`); load(); } }) }));

    const main = [];
    if (job.params?.request) main.push(h('section', { class: 'zl-section' }, h('h2', { class: 'heading-sm' }, 'Request'), h('blockquote', { class: 'zl-quote body-lg' }, job.params.request)));
    if (asking) main.push(questionCard({ job, wide: true, onSent: () => { store.set({ asking: false, answeringHere: null }); load(); } }));
    if (job.state === 'failed') main.push(h('section', { class: 'zl-section zl-failed' }, h('h2', { class: 'heading-sm' }, 'Why it failed'), failedLines(job, { onUndo: queueRestore })));
    if (job.report && job.state !== 'failed') main.push(h('section', { class: 'zl-section' }, h('h2', { class: 'heading-sm' }, 'Report'), textBlock(job.report, 'zl-block-tall')));
    if (job.asked?.length) main.push(h('section', { class: 'zl-section' }, h('h2', { class: 'heading-sm' }, `Answered questions (${job.asked.length})`), answeredList(job.asked)));
    main.push(h('section', { class: 'zl-section' }, h('h2', { class: 'heading-sm' }, `Steps (${job.progress.length})`),
      job.progress.length
        ? h('ol', { class: 'zl-steps zl-steps-wide' }, job.progress.map((p, i) => h('li', { class: ['zl-step', i === job.progress.length - 1 && job.state === 'running' ? 'zl-step-now' : null] }, h('span', { class: 'body-sm' }, p.message), h('span', { class: 'caption zl-muted' }, when(p.at)))))
        : h('p', { class: 'body-sm zl-muted' }, job.state === 'queued' ? 'The job waits for the agent.' : 'No step was reported.')));

    replace(element,
      h('header', { class: 'zl-page-header' },
        h('div', { class: 'eyebrow' }, 'Job'),
        h('div', { class: 'zl-title-row' }, h('h1', { class: 'display-md' }, KIND_LABEL[job.kind] ?? job.kind), h('div', { class: 'zl-row' }, badge(STATE_BADGE[job.state] ?? STATE_BADGE.queued), actions)),
        notice),
      h('div', { class: 'zl-job-body' },
        h('div', { class: 'zl-job-main' }, main),
        h('aside', { class: 'zl-job-facts' }, h('dl', { class: 'zl-facts' }, facts.map(([k, v]) => h('div', { class: 'zl-fact' }, h('dt', { class: 'caption zl-muted' }, k), h('dd', { class: 'body-sm' }, v)))))));
  }

  async function load() {
    const r = await api.get(path`/api/jobs/${id}`);
    if (!r.ok) { missing = r.status === 404; if (!missing) say('danger', r.error.message); render(); return; }
    // Keep a draft being written: render again only when the job moved on.
    const moved = !job || JSON.stringify([r.data.state, r.data.ask?.id, r.data.progress.length, r.data.finishedAt, r.data.silent]) !== JSON.stringify([job.state, job.ask?.id, job.progress.length, job.finishedAt, job.silent]);
    job = r.data;
    setCrumbs?.([{ label: `${KIND_LABEL[job.kind] ?? job.kind} · ${job.id}` }]);
    if (moved) render();
  }
  render();
  load();
  return { element, title: `Job ${id}`, reload: load, stateChanged: load, dispose: () => store.set({ answeringHere: null }) };
}

export function jobsSection({ store, parts, setCrumbs }) {
  return parts[0] ? jobPage({ store, id: parts[0], setCrumbs }) : jobsList({ store });
}
