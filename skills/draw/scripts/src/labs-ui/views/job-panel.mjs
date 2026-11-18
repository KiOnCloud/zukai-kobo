/**
 * The job panel: the agent's state, the queue, the open job with its progress and its
 * question card, and the jobs closed last with their reports. A question card is the one
 * clay element while it is open (the store's `asking` flag hides the request composer).
 */
import { S } from '../sienna.mjs';
import { h, replace, when } from '../dom.mjs';
import { api, path } from '../api.mjs';
import { KIND_LABEL, STATE_BADGE, REASON, agentBadge, ATTACH_HINT } from '../words.mjs';
import { badge, textBlock } from './badge.mjs';
import { showFileButton } from './file-view.mjs';

const RECENT = 4;

export function createJobPanel({ store }) {
  const element = h('aside', { class: 'zl-rail', 'aria-label': 'Jobs' });
  let drafts = {}; // answers being written, by ask id: survive a refresh of the panel
  let shownAsk = null;

  const confirm = (title, body, action, run) => {
    let dialog;
    const cancel = S().Button({ label: 'Keep it', variant: 'secondary', onClick: () => dialog.close() });
    const go = S().Button({ label: action, variant: 'danger', onClick: async () => { dialog.close(); await run(); } });
    dialog = S().Dialog({ title, body, actions: [cancel, go], onClose: () => dialog.element.remove() });
    dialog.open();
  };

  const message = (text, tone = 'danger') => store.set({ notice: { tone, text } });

  async function queueRestore(run, target) {
    const r = await api.post('/api/jobs', { kind: 'restore', params: { run, target } });
    if (!r.ok) message(`The undo was not queued: ${r.error.message} Check the run and try again.`);
  }

  function questionCard(job) {
    const ask = job.ask;
    const draft = drafts[ask.id] ?? (drafts[ask.id] = ask.questions.map(() => ({ selected: [], other: '' })));
    const blocks = [];
    if (ask.body) blocks.push(textBlock(ask.body));
    for (const a of ask.attachments) {
      if (a.kind === 'run') {
        const shown = h('div', {});
        blocks.push(h('div', { class: 'zl-row' }, h('span', { class: 'body-sm' }, 'Attached: '), h('a', { href: `#/diagrams/${encodeURIComponent(job.run)}/files` }, h('span', { class: 'code' }, a.name)), showFileButton({ run: job.run, name: a.name, into: shown })), shown);
      }
      else {
        const holder = h('div', {}, h('p', { class: 'body-sm zl-muted' }, `Loading ${a.name}`));
        blocks.push(holder);
        api.get(path`/api/jobs/${job.id}/files/${a.name}`).then((r) => replace(holder, h('p', { class: 'label' }, a.name), r.ok ? textBlock(r.data.text) : h('p', { class: 'body-sm zl-muted' }, 'This file could not be read.')));
      }
    }
    ask.questions.forEach((q, i) => {
      const name = `q-${ask.id}-${i}`;
      const choices = q.multiSelect
        ? h('div', { class: 'zl-stack' }, q.options.map((o) => S().Checkbox({ label: o.label, description: o.description, name, checked: draft[i].selected.includes(o.label), onChange: (e) => {
          draft[i].selected = e.target.checked ? [...draft[i].selected, o.label] : draft[i].selected.filter((x) => x !== o.label);
        } })))
        : S().Radio({ label: q.question, name, value: draft[i].selected[0], options: q.options.map((o) => ({ value: o.label, label: o.label, description: o.description })), onChange: (e) => { draft[i].selected = [e.target.value]; } });
      const other = S().Input({ label: 'Another answer', optional: true, value: draft[i].other, onInput: (e) => { draft[i].other = e.target.value; } });
      blocks.push(h('fieldset', { class: 'zl-question' }, h('legend', { class: 'heading-sm' }, q.header ? `${q.header}: ${q.question}` : q.question), choices, other));
    });
    const errorLine = h('div', { role: 'alert' });
    const send = S().Button({ label: 'Send answers', variant: 'accent', round: true, iconOnly: true, icon: 'arrow-up', onClick: async () => {
      const answers = draft.map((d) => ({ selected: d.selected, ...(d.other.trim() ? { other: d.other.trim() } : {}) }));
      if (answers.some((a) => a.selected.length === 0 && !a.other)) {
        replace(errorLine, S().Alert({ tone: 'warning', body: 'Every question needs an answer. Pick an option or write another answer.' }));
        return;
      }
      send.disabled = true;
      const r = await api.post(path`/api/jobs/${job.id}/answer`, { id: ask.id, answers });
      send.disabled = false;
      if (!r.ok) replace(errorLine, S().Alert({ tone: 'danger', body: `The answers were not sent: ${r.error.message} Try again.` }));
      else { delete drafts[ask.id]; store.set({ asking: false }); }
    } });
    return S().Card({ eyebrow: 'The agent asks', title: KIND_LABEL[job.kind] ?? job.kind, body: h('div', { class: 'zl-stack' }, blocks, errorLine), actions: [send] });
  }

  /** A report folded to its first line; the whole text opens on demand. */
  const reportBlock = (report) => h('details', {}, h('summary', { class: 'body-sm' }, report.split('\n').find((l) => l.trim()) ?? 'Report'), textBlock(report));

  function failedLines(job) {
    const lines = [h('p', { class: 'body-sm' }, REASON[job.reason] ?? 'This job failed.')];
    if (job.report) lines.push(reportBlock(job.report));
    if (job.run && job.revisionsSince?.length) {
      const first = job.revisionsSince[0];
      lines.push(h('p', { class: 'body-sm' }, `Revisions written while this job ran: ${job.revisionsSince.join(', ')}`));
      lines.push(S().Button({ label: `Undo to ${first}`, variant: 'secondary', size: 'sm', onClick: () => confirm(`Undo to ${first}?`, `The run goes back to revision ${first}, the state before this job changed it. The undo is a job of its own.`, `Undo to ${first}`, () => queueRestore(job.run, first)) }));
    }
    return lines;
  }

  let renders = 0;
  async function render(state) {
    const mine = ++renders;
    const open = state.jobs?.open;
    const sections = [];
    const agent = agentBadge(state);
    sections.push(h('section', { class: 'zl-rail-section' }, h('h2', { class: 'heading-sm' }, 'Agent'), badge(agent), !state.agent?.attached ? h('p', { class: 'body-sm zl-muted' }, ATTACH_HINT) : null));

    if (open) {
      const detail = await api.get(path`/api/jobs/${open.id}`);
      const job = detail.ok ? detail.data : open;
      const parts = [h('div', { class: 'zl-row' }, h('span', { class: 'label' }, KIND_LABEL[job.kind] ?? job.kind), badge(STATE_BADGE[job.state] ?? STATE_BADGE.running))];
      if (job.run) parts.push(h('a', { class: 'code', href: `#/diagrams/${encodeURIComponent(job.run)}` }, job.run));
      if (job.params?.request) parts.push(h('p', { class: 'body-sm' }, job.params.request));
      if (job.progress?.length) parts.push(h('ol', { class: 'zl-progress body-sm' }, job.progress.slice(-6).map((p) => h('li', {}, p.message))));
      if (job.silent) parts.push(S().Button({ label: 'Mark as failed', variant: 'danger', size: 'sm', onClick: () => confirm('Mark this job as failed?', 'The agent has not been heard from for 15 minutes. The job ends as failed; the run may be half changed. A new job can be queued afterwards.', 'Mark as failed', async () => {
        const r = await api.post(path`/api/jobs/${job.id}/fail`);
        if (!r.ok) message(`The job was not marked as failed: ${r.error.message}`);
      }) }));
      sections.push(h('section', { class: 'zl-rail-section' }, h('h2', { class: 'heading-sm' }, 'Open job'), ...parts));
      const asking = job.state === 'needs-input' && job.ask;
      if (asking) sections.push(questionCard(job));
      if (Boolean(asking) !== Boolean(store.get().asking) || (asking && shownAsk !== job.ask.id)) {
        shownAsk = asking ? job.ask.id : null;
        store.set({ asking: Boolean(asking) });
      }
    } else if (store.get().asking) store.set({ asking: false });

    const queue = state.jobs?.queue ?? [];
    if (queue.length) {
      sections.push(h('section', { class: 'zl-rail-section' }, h('h2', { class: 'heading-sm' }, `Queue (${queue.length})`), h('ul', { class: 'zl-list' }, queue.map((j) => h('li', { class: 'zl-row' },
        h('span', { class: 'body-sm' }, KIND_LABEL[j.kind] ?? j.kind, j.run ? h('span', { class: 'code zl-muted' }, ` ${j.run}`) : null),
        S().Button({ label: 'Cancel', variant: 'ghost', size: 'sm', onClick: async () => { const r = await api.post(path`/api/jobs/${j.id}/cancel`); if (!r.ok) message(`The job was not cancelled: ${r.error.message}`); } }),
      )))));
    }

    const list = await api.get('/api/jobs');
    const closed = list.ok ? list.data.jobs.filter((j) => ['done', 'failed', 'cancelled'].includes(j.state)).slice(0, RECENT) : [];
    if (closed.length) {
      const items = await Promise.all(closed.map(async (j) => {
        const d = await api.get(path`/api/jobs/${j.id}`);
        const job = d.ok ? d.data : j;
        return h('li', { class: 'zl-closed' },
          h('div', { class: 'zl-row' }, h('span', { class: 'label' }, KIND_LABEL[job.kind] ?? job.kind), badge(STATE_BADGE[job.state])),
          h('p', { class: 'caption zl-muted' }, when(job.finishedAt)),
          job.state === 'failed' ? failedLines(job) : job.report ? reportBlock(job.report) : null);
      }));
      sections.push(h('section', { class: 'zl-rail-section' }, h('h2', { class: 'heading-sm' }, 'Recent jobs'), h('ul', { class: 'zl-list' }, items)));
    }
    // A slower render that started earlier never replaces a newer one.
    if (mine === renders) replace(element, sections);
  }

  return { element, render };
}
