/** The console's own words: what each job kind, state and reason is called. */

export const KIND_LABEL = {
  draw: 'New diagram', revise: 'Revise', restore: 'Restore', 'apply-edit': 'Save model edit', sync: 'Sync', recook: 'Recook', export: 'Export pictures', 'glossary-suggest': 'Suggest glossary terms',
};

export const STATE_BADGE = {
  queued: { label: 'Queued', tone: 'neutral' },
  running: { label: 'Running', tone: 'info', dot: true },
  'needs-input': { label: 'Waiting for your answer', tone: 'warning' },
  done: { label: 'Done', tone: 'neutral', icon: 'check' },
  failed: { label: 'Failed', tone: 'danger', icon: 'alert' },
  cancelled: { label: 'Cancelled', tone: 'neutral', outline: true },
};

export const REASON = {
  'server-stopped': 'The console server stopped while this job was open. The run may be half changed.',
  'session-lost': 'Another agent session took over while this job was open. The run may be half changed.',
  'not-closed': 'The agent asked for new work without closing this job. The run may be half changed.',
  marked: 'You marked this job as failed because the agent was silent. The run may be half changed.',
  agent: 'The agent could not finish this job. Its report says why.',
};

export const ORIGIN = { scout: 'Scouted from code', recook: 'Recooked', clarify: 'Clarified', brainstorm: 'Brainstormed' };

/** The agent's state as a badge: words always, a colour never alone. */
export function agentBadge(state, now = Date.now()) {
  const open = state?.jobs?.open;
  const agent = state?.agent ?? {};
  if (open?.silent) {
    const minutes = agent.lastContact ? Math.max(1, Math.round((now - Date.parse(agent.lastContact)) / 60_000)) : null;
    return { label: minutes ? `No word from the agent for ${minutes} min` : 'No word from the agent', tone: 'warning', icon: 'alert' };
  }
  if (!agent.attached) return { label: 'No agent attached', tone: 'neutral', dot: true };
  if (open) return { label: `Agent working on ${KIND_LABEL[open.kind] ?? open.kind}`, tone: 'info', dot: true };
  if (agent.waiting) return { label: 'Agent waiting', tone: 'neutral', icon: 'check' };
  return { label: 'Agent attached', tone: 'neutral', dot: true };
}

export const ATTACH_HINT = 'Run /zukai:labs (or /zukai-labs, $zukai-labs in a copied install) in an agent session on this machine to attach one. Queued jobs wait until then.';
