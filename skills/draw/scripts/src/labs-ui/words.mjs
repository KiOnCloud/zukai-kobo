/** The console's own words: what each job kind, state, reason and option is called. */

export const KIND_LABEL = {
  draw: 'New diagram', revise: 'Revise', restore: 'Restore', 'apply-edit': 'Save model edit', sync: 'Sync', recook: 'Recook', export: 'Export pictures', 'glossary-suggest': 'Suggest glossary terms',
};

export const STATE_BADGE = {
  queued: { label: 'Queued', tone: 'neutral' },
  running: { label: 'Running', tone: 'info', dot: true },
  'needs-input': { label: 'Waiting for your answer', tone: 'warning' },
  done: { label: 'Done', tone: 'success', icon: 'check' },
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

/** The diagram kinds, in the order the README lists them, with what each one shows. */
export const DIAGRAM_KINDS = [
  { value: 'sequence', label: 'Sequence', description: 'Who calls whom, in what order, with replies and failure branches' },
  { value: 'flowchart', label: 'Flowchart', description: 'Steps and decisions of one process from start to end' },
  { value: 'activity', label: 'Activity', description: 'Swimlanes per actor or system, with hand-offs, fork and join' },
  { value: 'state', label: 'State', description: 'The statuses one thing can be in and the events that move it' },
  { value: 'er', label: 'Entity relation', description: 'Data entities, their key attributes and relations' },
  { value: 'class', label: 'Class', description: 'Types, interfaces, their members, inheritance and composition' },
  { value: 'architecture', label: 'Architecture', description: 'Components, data stores, queues and outside systems' },
  { value: 'usecase', label: 'Use case', description: 'Actors, their goals and the system boundary' },
];
export const kindLabel = (kind) => DIAGRAM_KINDS.find((k) => k.value === kind)?.label ?? kind ?? 'Unknown kind';

export const TARGETS = [
  { value: 'drawio', label: 'draw.io file', description: 'Laid out automatically; every shape stays editable' },
  { value: 'mermaid', label: 'Mermaid text', description: 'Paste into Markdown or a wiki' },
  { value: 'figjam', label: 'FigJam board', description: 'Needs the Figma MCP server in the agent session' },
];
export const targetLabel = (t) => ({ drawio: 'draw.io', svg: 'SVG pictures', mermaid: 'Mermaid', figjam: 'FigJam', doc: 'Tables' })[t] ?? t;

export const MODES = [
  { value: 'clarify', label: 'Requirements', description: 'A flow or feature described in words; the agent asks what is unclear' },
  { value: 'scout', label: 'Code of this project', description: 'The agent reads the source; the diagram can be synced later' },
  { value: 'brainstorm', label: 'An idea', description: 'Not yet sure which diagrams would help; the agent proposes sets' },
];

export const SCOPES = [
  { value: 'overview', label: 'Overview' },
  { value: 'detailed', label: 'Detailed' },
];
export const AUDIENCES = [
  { value: 'technical', label: 'Technical' },
  { value: 'business', label: 'Business' },
  { value: 'both', label: 'Both' },
];
export const DOC_LANGS = [
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語', lang: 'ja' },
  { value: 'vi', label: 'Tiếng Việt', lang: 'vi' },
];

/** What a target does with a kind, where the README says it is not the whole picture. */
export function compatNote(kind, target) {
  if (kind === 'usecase' && target === 'mermaid') return 'Mermaid has no use case diagram: you get a flowchart form, with a warning that says what was lost.';
  if (kind === 'usecase' && target === 'figjam') return 'The FigJam text refuses use case diagrams; the agent draws the native board instead.';
  if (kind === 'activity' && target === 'mermaid') return 'Mermaid draws activity diagrams with its beta swimlane syntax.';
  if (kind === 'activity' && target === 'figjam') return 'FigJam takes activity diagrams only as the native board.';
  return undefined;
}

/** Example requests, by input, that fill the request box when picked. */
export const EXAMPLES = {
  clarify: ['A customer resets a forgotten password by email', 'Orders move from placed to paid, shipped and returned'],
  scout: ['The login flow, from the form to the session cookie', 'How a payment is captured and the receipt is sent'],
  brainstorm: ['A booking system for meeting rooms', 'Diagrams for the onboarding page of a new teammate'],
  '': ['The checkout flow of the shop', 'The tables behind invoices and payments'],
};

/** The agent's state as a badge: words always, a colour never alone. */
export function agentBadge(state, now = Date.now()) {
  const open = state?.jobs?.open;
  const agent = state?.agent ?? {};
  if (open?.silent) {
    const minutes = agent.lastContact ? Math.max(1, Math.round((now - Date.parse(agent.lastContact)) / 60_000)) : null;
    return { label: minutes ? `No word from the agent for ${minutes} min` : 'No word from the agent', tone: 'warning', icon: 'alert' };
  }
  if (!agent.attached) return { label: 'No agent attached', tone: 'neutral', dot: true };
  if (open?.state === 'needs-input') return { label: 'The agent asks you', tone: 'clay', dot: true };
  if (open) return { label: `Agent working on ${KIND_LABEL[open.kind] ?? open.kind}`, tone: 'info', dot: true };
  if (agent.waiting) return { label: 'Agent ready', tone: 'success', icon: 'check' };
  return { label: 'Agent attached', tone: 'neutral', dot: true };
}

export const ATTACH_COMMAND = '/zukai:labs';
export const ATTACH_HINT = 'Run /zukai:labs (or /zukai-labs, $zukai-labs in a copied install) in an agent session on this machine to attach one. Queued jobs wait until then.';
