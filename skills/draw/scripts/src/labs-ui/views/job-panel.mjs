/**
 * The agent panel: the agent's state (and how to attach one), the agent's question, the open
 * job with its steps, the queue, and the jobs closed last. A question card is the one clay
 * element while it is open (the store's `asking` flag hides the request composer); while the
 * job page shows the same question (`answeringHere`), the panel points to it instead.
 */
import { S } from '../sienna.mjs';
import { h, replace, ago, duration, copyText } from '../dom.mjs';
import { api, path } from '../api.mjs';
import { KIND_LABEL, STATE_BADGE, REASON, agentBadge, ATTACH_HINT, ATTACH_COMMAND } from '../words.mjs';
import { badge, textBlock } from './badge.mjs';
import { questionCard } from './question-card.mjs';

const RECENT = 4;
const STEPS = 5;

/** A confirmation with a safe way out; the action runs only on the second button. */
export function confirmDialog({ title, body, action, keep = 'Keep it', tone = 'danger', run }) {
  let dialog;
  const cancel = S().Button({ label: keep, variant: 'secondary', onClick: () => dialog.close() });
  const go = S().Button({ label: action, variant: tone === 'danger' ? 'danger' : 'primary', onClick: async () => { dialog.close(); await run(); } });
  dialog = S().Dialog({ title, body, actions: [cancel, go], onClose: () => dialog.element.remove() });
  dialog.open();
}

/** A report folded to its first line; the whole text opens on demand. */
export const reportBlock = (report) => h('details', { class: 'zl-report' }, h('summary', { class: 'body-sm' }, report.split('\n').find((l) => l.trim()) ?? 'Report'), textBlock(report));

/** Why a job failed, its report, and the undo to the state before it changed the run. */
export function failedLines(job, { onUndo }) {
  const lines = [h('p', { class: 'body-sm' }, REASON[job.reason] ?? 'This job failed.')];
  if (job.report) lines.push(reportBlock(job.report));
  if (job.run && job.revisionsSince?.length) {
    const first = job.revisionsSince[0];
    lines.push(h('p', { class: 'body-sm' }, `Revisions written while this job ran: ${job.revisionsSince.join(', ')}`));
    lines.push(h('div', {}, S().Button({ label: `Undo to ${first}`, variant: 'secondary', size: 'sm', onClick: () => confirmDialog({
      title: `Undo to ${first}?`, body: `The run goes back to revision ${first}, the state before this job changed it. The undo is a job of its own.`, action: `Undo to ${first}`, run: () => onUndo(job.run, first),
    }) })));
  }
  return lines;
}

/** The way to attach an agent: the command with a copy button, and what happens meanwhile. */
export function attachBlock({ onCopyFail }) {
  const copy = S().Button({ label: 'Copy', variant: 'ghost', size: 'sm', onClick: async () => {
    if (await copyText(ATTACH_COMMAND, onCopyFail)) { copy.lastChild.textContent = 'Copied'; setTimeout(() => { copy.lastChild.textContent = 'Copy'; }, 1500); }
  } });
  return h('div', { class: 'zl-attach' },
    h('div', { class: 'zl-command' }, h('code', { class: 'code' }, ATTACH_COMMAND), copy),
    h('p', { class: 'body-sm zl-muted' }, ATTACH_HINT));
}

export function createJobPanel({ store, onClose }) {
  const element = h('aside', { class: 'zl-rail', id: 'agent-panel', 'aria-label': 'Agent and jobs' });
  const message = (text, tone = 'danger') => store.set({ notice: { tone, text } });

  async function queueRestore(run, target) {
    const r = await api.post('/api/jobs', { kind: 'restore', params: { run, target } });
    if (!r.ok) message(`The undo was not queued: ${r.error.message} Check the run and try again.`);
  }

  const section = (title, ...children) => h('section', { class: 'zl-rail-section' }, h('h3', { class: 'eyebrow' }, title), ...children);

  function agentSection(state) {
    const agent = state.agent ?? {};
    const facts = [];
    if (agent.attached && agent.lastContact) facts.push(`Last heard ${ago(agent.lastContact)}`);
    if (agent.attached && agent.waiting && !state.jobs?.open) facts.push('waiting for the next job');
    return h('section', { class: 'zl-rail-section zl-agent' },
      h('div', { class: 'zl-row zl-spread' }, badge(agentBadge(state)), facts.length ? h('span', { class: 'caption zl-muted' }, facts.join(', ')) : null),
      !agent.attached ? attachBlock({ onCopyFail: (t) => message(`The browser did not allow copying. The command is ${t}.`, 'warning') }) : null);
  }

  function openSection(job) {
    const steps = job.progress ?? [];
    const parts = [
      h('div', { class: 'zl-row zl-spread' }, h('span', { class: 'heading-sm' }, KIND_LABEL[job.kind] ?? job.kind), badge(STATE_BADGE[job.state] ?? STATE_BADGE.running)),
      job.run ? h('a', { class: 'code body-sm', href: `#/diagrams/${encodeURIComponent(job.run)}` }, job.run) : null,
      job.params?.request ? h('blockquote', { class: 'zl-quote body-sm' }, job.params.request) : null,
      job.startedAt ? h('p', { class: 'caption zl-muted' }, `Started ${ago(job.startedAt)}, running for ${duration(job.startedAt)}`) : null,
    ];
    if (steps.length) {
      const shown = steps.slice(-STEPS);
      parts.push(h('ol', { class: 'zl-steps' },
        steps.length > STEPS ? h('li', { class: 'zl-step zl-step-more caption zl-muted' }, `${steps.length - STEPS} earlier step${steps.length - STEPS === 1 ? '' : 's'}`) : null,
        shown.map((p, i) => h('li', { class: ['zl-step', i === shown.length - 1 && job.state === 'running' ? 'zl-step-now' : null] }, h('span', { class: 'body-sm' }, p.message)))));
    } else if (job.state === 'running') parts.push(h('p', { class: 'body-sm zl-muted' }, 'The agent has taken the job and not reported a step yet.'));
    if (job.silent) {
      parts.push(S().Alert({ tone: 'warning', body: 'The agent has not been heard from for 15 minutes.' }));
      parts.push(h('div', {}, S().Button({ label: 'Mark as failed', variant: 'danger', size: 'sm', onClick: () => confirmDialog({
        title: 'Mark this job as failed?', body: 'The agent has not been heard from for 15 minutes. The job ends as failed; the run may be half changed. A new job can be queued afterwards.', action: 'Mark as failed',
        run: async () => { const r = await api.post(path`/api/jobs/${job.id}/fail`); if (!r.ok) message(`The job was not marked as failed: ${r.error.message}`); },
      }) })));
    }
    parts.push(h('a', { class: 'body-sm', href: `#/jobs/${encodeURIComponent(job.id)}` }, 'Open the job'));
    return section('Open job', h('div', { class: 'zl-rail-card' }, parts));
  }

  function queueSection(queue) {
    return section(`Queue (${queue.length})`, h('ol', { class: 'zl-list zl-queue' }, queue.map((j, i) => h('li', { class: 'zl-queue-item' },
      h('span', { class: 'zl-queue-pos caption', 'aria-hidden': 'true' }, String(i + 1)),
      h('div', { class: 'zl-queue-text' },
        h('a', { class: 'label', href: `#/jobs/${encodeURIComponent(j.id)}` }, KIND_LABEL[j.kind] ?? j.kind),
        j.run ? h('span', { class: 'code caption zl-muted' }, j.run) : null,
        j.request ? h('span', { class: 'caption zl-muted zl-clamp' }, j.request) : null),
      S().Button({ label: 'Cancel', variant: 'ghost', size: 'sm', onClick: async () => { const r = await api.post(path`/api/jobs/${j.id}/cancel`); if (!r.ok) message(`The job was not cancelled: ${r.error.message}`); } }),
    ))));
  }

  let renders = 0;
  async function render(state) {
    const mine = ++renders;
    const open = state.jobs?.open;
    const sections = [];
    sections.push(h('header', { class: 'zl-rail-head' },
      h('h2', { class: 'heading-md' }, 'Agent'),
      onClose ? S().Button({ label: 'Close the agent panel', variant: 'ghost', size: 'sm', iconOnly: true, icon: 'close', onClick: onClose }) : null));
    sections.push(agentSection(state));

    if (open) {
      const detail = await api.get(path`/api/jobs/${open.id}`);
      const job = detail.ok ? detail.data : open;
      const asking = job.state === 'needs-input' && job.ask;
      if (asking && store.get().answeringHere === job.id) {
        sections.push(S().Alert({ tone: 'neutral', body: 'The agent\'s question is open on this page.' }));
      } else if (asking) {
        sections.push(questionCard({ job, onSent: () => store.set({ asking: false }) }));
      }
      sections.push(openSection(job));
      if (Boolean(asking) !== Boolean(store.get().asking)) store.set({ asking: Boolean(asking) });
    } else if (store.get().asking) store.set({ asking: false });

    const queue = state.jobs?.queue ?? [];
    if (queue.length) sections.push(queueSection(queue));

    const list = await api.get('/api/jobs');
    const closed = list.ok ? list.data.jobs.filter((j) => ['done', 'failed', 'cancelled'].includes(j.state)).slice(0, RECENT) : [];
    if (closed.length) {
      const items = await Promise.all(closed.map(async (j) => {
        const d = j.state === 'cancelled' ? { ok: false } : await api.get(path`/api/jobs/${j.id}`);
        const job = d.ok ? d.data : j;
        return h('li', { class: ['zl-closed', job.state === 'failed' ? 'zl-closed-failed' : null] },
          h('div', { class: 'zl-row zl-spread' }, h('a', { class: 'label', href: `#/jobs/${encodeURIComponent(job.id)}` }, KIND_LABEL[job.kind] ?? job.kind), badge(STATE_BADGE[job.state])),
          h('p', { class: 'caption zl-muted' }, [job.run, ago(job.finishedAt)].filter(Boolean).join(' · ')),
          job.state === 'failed' ? failedLines(job, { onUndo: queueRestore }) : job.report ? reportBlock(job.report) : null);
      }));
      sections.push(section('Recent jobs', h('ul', { class: 'zl-list' }, items)));
    } else if (!open && !queue.length) {
      sections.push(h('p', { class: 'body-sm zl-muted zl-rail-empty' }, 'No jobs yet. A change you ask for in the console becomes a job the agent carries out here.'));
    }
    sections.push(h('a', { class: 'body-sm zl-rail-all', href: '#/jobs' }, 'All jobs'));
    // A slower render that started earlier never replaces a newer one.
    if (mine === renders) replace(element, sections);
  }

  return { element, render };
}
