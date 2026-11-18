/**
 * The agent's question, answered in the page: its body, its attachments, each question with
 * its options as tiles, an answer of one's own, and one Send for every answer. The answers being
 * written are kept by ask id, so a refresh of the panel or a move to the job page keeps them.
 * The Send button is the one clay element while the card is in view.
 */
import { S } from '../sienna.mjs';
import { h, replace } from '../dom.mjs';
import { api, path } from '../api.mjs';
import { KIND_LABEL, jobTarget } from '../words.mjs';
import { textBlock } from './badge.mjs';
import { showFileButton } from './file-view.mjs';

const drafts = new Map();

export const forgetDraft = (askId) => drafts.delete(askId);

function attachmentBlock(job, a) {
  if (a.kind === 'run') {
    const shown = h('div', {});
    return h('div', { class: 'zl-stack' },
      h('div', { class: 'zl-row' }, h('span', { class: 'body-sm zl-muted' }, 'Attached'), h('a', { href: `#/diagrams/${encodeURIComponent(job.run)}/files` }, h('span', { class: 'code' }, a.name)), showFileButton({ run: job.run, name: a.name, into: shown })),
      shown);
  }
  const holder = h('div', {}, h('p', { class: 'body-sm zl-muted' }, `Loading ${a.name}`));
  api.get(path`/api/jobs/${job.id}/files/${a.name}`).then((r) => replace(holder, h('p', { class: 'label' }, a.name), r.ok ? textBlock(r.data.text) : h('p', { class: 'body-sm zl-muted' }, 'This file could not be read.')));
  return holder;
}

function optionTile({ type, name, option, checked, onChange }) {
  return h('label', { class: 'zl-tile zl-tile-answer' },
    h('input', { type, class: 'zl-tile-input', name, value: option.label, checked, onChange }),
    h('span', { class: 'zl-tile-mark', 'aria-hidden': 'true' }),
    h('span', { class: 'zl-tile-text' },
      h('span', { class: 'label' }, option.label),
      option.description ? h('span', { class: 'caption zl-muted' }, option.description) : null));
}

/**
 * @param {{ job: object, onSent?: () => void, wide?: boolean }} props
 * @returns {HTMLElement}
 */
export function questionCard({ job, onSent, wide = false }) {
  const ask = job.ask;
  if (!drafts.has(ask.id)) drafts.set(ask.id, ask.questions.map(() => ({ selected: [], other: '' })));
  const draft = drafts.get(ask.id);
  const total = ask.questions.length;

  const questions = ask.questions.map((q, i) => {
    const name = `q-${ask.id}-${i}`;
    const options = q.options.map((o) => optionTile({
      type: q.multiSelect ? 'checkbox' : 'radio',
      name,
      option: o,
      checked: draft[i].selected.includes(o.label),
      onChange: (e) => {
        if (q.multiSelect) draft[i].selected = e.target.checked ? [...draft[i].selected, o.label] : draft[i].selected.filter((x) => x !== o.label);
        else if (e.target.checked) draft[i].selected = [o.label];
      },
    }));
    const other = S().Input({ label: 'Another answer', optional: true, value: draft[i].other, onInput: (e) => { draft[i].other = e.target.value; } });
    return h('fieldset', { class: 'zl-question' },
      h('legend', { class: 'zl-question-legend' },
        total > 1 ? h('span', { class: 'eyebrow' }, `${q.header ? `${q.header} · ` : ''}${i + 1} of ${total}`) : q.header ? h('span', { class: 'eyebrow' }, q.header) : null,
        h('span', { class: 'heading-sm' }, q.question)),
      q.multiSelect ? h('p', { class: 'caption zl-muted' }, 'Pick any that apply.') : null,
      h('div', { class: ['zl-answers', wide ? 'zl-answers-wide' : null] }, options),
      other);
  });

  const errorLine = h('div', { role: 'alert' });
  const send = S().Button({ label: 'Send answers', variant: 'accent', round: true, iconOnly: true, icon: 'arrow-up', onClick: async () => {
    const answers = draft.map((d) => ({ selected: d.selected, ...(d.other.trim() ? { other: d.other.trim() } : {}) }));
    const missing = answers.map((a, i) => (a.selected.length === 0 && !a.other ? i + 1 : null)).filter(Boolean);
    if (missing.length) {
      replace(errorLine, S().Alert({ tone: 'warning', body: `Question ${missing.join(', ')} still needs an answer. Pick an option or write another answer.` }));
      return;
    }
    send.disabled = true;
    const r = await api.post(path`/api/jobs/${job.id}/answer`, { id: ask.id, answers });
    send.disabled = false;
    if (!r.ok) replace(errorLine, S().Alert({ tone: 'danger', body: `The answers were not sent: ${r.error.message} Try again.` }));
    else { drafts.delete(ask.id); onSent?.(); }
  } });

  return h('section', { class: ['zl-ask', wide ? 'zl-ask-wide' : null], 'aria-label': 'The agent asks' },
    h('header', { class: 'zl-ask-head' },
      h('span', { class: 'eyebrow zl-ask-eyebrow' }, 'The agent asks'),
      h('span', { class: 'heading-sm' }, KIND_LABEL[job.kind] ?? job.kind),
      jobTarget(job) ? h('a', { class: 'code body-sm', href: jobTarget(job).href }, jobTarget(job).label) : null),
    ask.body ? h('p', { class: 'body zl-ask-body' }, ask.body) : null,
    ask.attachments.map((a) => attachmentBlock(job, a)),
    questions,
    errorLine,
    h('div', { class: 'zl-ask-foot' }, h('span', { class: 'caption zl-muted' }, total > 1 ? `${total} questions, sent together` : 'Your answer goes straight to the agent'), send));
}

/** The questions a job asked and what was answered, newest last. */
export function answeredList(asked) {
  return h('ol', { class: 'zl-answered' }, asked.map((a) => h('li', { class: 'zl-answered-item' },
    a.body ? h('p', { class: 'body-sm zl-muted' }, a.body.split('\n').find((l) => l.trim()) ?? '') : null,
    a.questions.map((q, i) => {
      const ans = a.answers?.[i] ?? { selected: [] };
      const words = [...(ans.selected ?? []), ...(ans.other ? [ans.other] : [])];
      return h('div', { class: 'zl-answered-pair' },
        h('p', { class: 'label' }, q.question),
        h('p', { class: 'body-sm' }, words.length ? words.join(', ') : 'No answer'));
    }))));
}
