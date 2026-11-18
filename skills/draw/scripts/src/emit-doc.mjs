import { DOC_STRINGS, DOC_LANGS } from './doc-strings.mjs';
import { cloudIcon } from './aws-icons.mjs';

export { DOC_LANGS };

/**
 * Description tables: the elements of an IR as Markdown tables, for a specification or a
 * design document. Nothing is drawn, so nothing is lost: every element of every collection
 * is a row, a column or a heading, and the tests hold each kind to that.
 */

const DASH = '—';

/**
 * A text of the IR as it may stand in a table cell, a heading or a list item: no character
 * of it is read as Markdown or HTML, a pipe does not end the cell and a line break stays one.
 */
export function escapeCell(text) {
  return String(text)
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ')
    .trim()
    .replace(/\\/g, '\\\\')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[|`*_[\]~$#]/g, '\\$&')
    .replace(/[ ]*\n[ ]*/g, '<br>');
}

/** The same for a heading or a link text, which hold one line. */
const escapeLine = (text) => escapeCell(String(text).replace(/\s*[\r\n]+\s*/g, ' '));

const filled = (text) => typeof text === 'string' && text.trim() !== '';

/**
 * A table from column definitions. A column whose `when` is false is left out, so an
 * optional field nobody uses does not add an empty column. An empty cell shows a dash.
 * @param {Array<{ head: string, cell: (row: any, index: number) => string, when?: boolean }>} columns
 */
function table(columns, rows) {
  const shown = columns.filter((c) => c.when !== false);
  const line = (cells) => `| ${cells.map((c) => (c === '' || c === undefined ? DASH : c)).join(' | ')} |`;
  return [line(shown.map((c) => c.head)), `|${shown.map(() => ' --- ').join('|')}|`, ...rows.map((row, i) => line(shown.map((c) => c.cell(row, i)))), ''];
}

const list = (ir, name) => (Array.isArray(ir[name]) ? ir[name] : []);
const numbered = (t) => ({ head: t.column.no, cell: (_, i) => String(i + 1) });
const joinLines = (parts) => parts.filter((p) => p !== '').join('<br>');

/** child id -> the container that lists it among its `children`. */
function parents(containers) {
  const parentOf = new Map();
  for (const c of containers) for (const child of c.children ?? []) parentOf.set(child, c);
  return parentOf;
}

function sequenceTables(ir, c) {
  const { t } = c;
  const participants = list(ir, 'participants');
  const messages = list(ir, 'messages');
  const blocks = list(ir, 'blocks');
  const name = new Map(participants.map((p) => [p.id, escapeCell(p.label)]));
  const stepNo = new Map(messages.map((m, i) => [m.id, i + 1]));
  // The sections a message stands in, outermost block first: a block that holds another one
  // lists every message of it, so it is the longer of the two.
  const sizeOf = (b) => b.messages.length + (b.branches ?? []).reduce((n, br) => n + br.messages.length, 0);
  const outerFirst = blocks.map((b, i) => ({ b, i })).sort((x, y) => sizeOf(y.b) - sizeOf(x.b) || x.i - y.i).map((x) => x.b);
  // In the reader's words, not in the operators of the notation: a further section of `alt`
  // is "otherwise", one of `par` runs at the same time as the first.
  const said = (key, label) => t.value.block[key].replace('{label}', escapeCell(label));
  const condition = (m) => joinLines(outerFirst.map((b) => {
    if (b.messages.includes(m.id)) return said(b.kind, b.label);
    const branch = (b.branches ?? []).find((br) => br.messages.includes(m.id));
    return branch ? said(b.kind === 'alt' ? 'else' : b.kind, branch.label) : '';
  }));
  const out = [
    c.heading(t.heading.participants),
    ...table([numbered(t), { head: t.column.participant, cell: (p) => name.get(p.id) }, { head: t.column.kind, cell: (p) => t.value.participant[p.kind ?? 'participant'] }], participants),
  ];
  if (messages.length > 0) {
    out.push(c.heading(t.heading.steps), ...table([
      numbered(t),
      { head: t.column.from, cell: (m) => name.get(m.from) },
      { head: t.column.to, cell: (m) => name.get(m.to) },
      { head: t.column.message, cell: (m) => escapeCell(m.label) },
      { head: t.column.kind, cell: (m) => t.value.message[m.kind ?? 'sync'] },
      { head: t.column.condition, cell: condition, when: blocks.length > 0 },
      { head: t.column.details, cell: (m, i) => c.ref(m.ref, `/messages/${i}/ref`), when: messages.some((m) => m.ref) },
    ], messages));
  }
  const notes = list(ir, 'notes');
  if (notes.length > 0) {
    const blockById = new Map(blocks.map((b) => [b.id, b]));
    const after = (n) => {
      if (n.after === undefined) return t.value.atStart;
      if (stepNo.has(n.after)) return `${stepNo.get(n.after)}. ${escapeCell(messages[stepNo.get(n.after) - 1].label)}`;
      const b = blockById.get(n.after);
      return b ? `${b.kind}: ${escapeCell(b.label)}` : '';
    };
    out.push(c.heading(t.heading.notes), ...table([
      numbered(t),
      { head: t.column.note, cell: (n) => escapeCell(n.label) },
      { head: t.column.participant, cell: (n) => n.participants.map((p) => name.get(p)).join(', ') },
      // Two participants are always covered by the note, whatever `position` says.
      { head: t.column.position, cell: (n) => t.value.position[n.participants.length > 1 ? 'over' : n.position ?? 'right'] },
      { head: t.column.placedAfter, cell: after },
    ], notes));
  }
  return out;
}

function stateTables(ir, c) {
  const { t } = c;
  const states = list(ir, 'states');
  const transitions = list(ir, 'transitions');
  const kindOf = (s) => s.kind ?? 'simple';
  const parentOf = parents(states);
  // An initial or final state needs no label; it is named by what it is, and by the
  // composite it stands in, which has a start and an end of its own.
  const nameOf = (s) => {
    if (filled(s.label)) return escapeCell(s.label);
    if (kindOf(s) !== 'initial' && kindOf(s) !== 'final') return `\`${s.id}\``;
    const parent = parentOf.get(s.id);
    return `${parent && filled(parent.label) ? `${escapeCell(parent.label)} › ` : ''}(${t.value.state[kindOf(s)]})`;
  };
  const name = new Map(states.map((s) => [s.id, nameOf(s)]));
  const out = [
    c.heading(t.heading.states),
    ...table([
      numbered(t),
      { head: t.column.state, cell: (s) => name.get(s.id) },
      { head: t.column.kind, cell: (s) => t.value.state[kindOf(s)] },
      { head: t.column.parentState, cell: (s) => (parentOf.has(s.id) ? name.get(parentOf.get(s.id).id) : ''), when: parentOf.size > 0 },
      { head: t.column.details, cell: (s, i) => c.ref(s.ref, `/states/${i}/ref`), when: states.some((s) => s.ref) },
    ], states),
  ];
  if (transitions.length > 0) {
    // One column per event in the order the events first occur; transitions without an
    // event share a last column.
    const events = [...new Set(transitions.filter((x) => filled(x.event)).map((x) => x.event))];
    const columns = [...events.map((e) => ({ event: e, head: escapeCell(e) })), ...(transitions.some((x) => !filled(x.event)) ? [{ event: undefined, head: t.value.noEvent }] : [])];
    const cell = (s, event) => joinLines(transitions.filter((x) => x.from === s.id && (filled(x.event) ? x.event : undefined) === event)
      .map((x) => `→ ${name.get(x.to)}${filled(x.guard) ? ` [${escapeCell(x.guard)}]` : ''}${filled(x.action) ? ` / ${escapeCell(x.action)}` : ''}`));
    out.push(c.heading(t.heading.transitions), ...table([
      { head: t.column.stateByEvent, cell: (s) => name.get(s.id) },
      ...columns.map((col) => ({ head: col.head, cell: (s) => cell(s, col.event) })),
    ], states));
  }
  return out;
}

const CARDINALITY = { one: '1', 'zero-one': '0..1', many: '0..*', 'one-many': '1..*' };

function erTables(ir, c) {
  const { t } = c;
  const entities = list(ir, 'entities');
  const relations = list(ir, 'relations');
  const name = new Map(entities.map((e) => [e.id, escapeCell(e.label)]));
  const out = [c.heading(t.heading.entities)];
  entities.forEach((e, i) => {
    out.push(c.heading(escapeLine(e.label), 1));
    if (e.ref) out.push(`${t.column.details}: ${c.ref(e.ref, `/entities/${i}/ref`)}`, '');
    const attributes = e.attributes ?? [];
    if (attributes.length === 0) { out.push(t.value.noAttributes, ''); return; }
    out.push(...table([
      numbered(t),
      { head: t.column.attribute, cell: (a) => escapeCell(a.name) },
      { head: t.column.type, cell: (a) => escapeCell(a.type) },
      { head: t.column.key, cell: (a) => (a.key === 'pk' || a.key === 'fk' ? a.key.toUpperCase() : '') },
      { head: t.column.comment, cell: (a) => (filled(a.comment) ? escapeCell(a.comment) : ''), when: attributes.some((a) => filled(a.comment)) },
    ], attributes));
  });
  if (relations.length > 0) {
    out.push(c.heading(t.heading.relations), ...table([
      numbered(t),
      { head: t.column.from, cell: (r) => name.get(r.from) },
      { head: t.column.fromCardinality, cell: (r) => CARDINALITY[r.fromCardinality] },
      { head: t.column.to, cell: (r) => name.get(r.to) },
      { head: t.column.toCardinality, cell: (r) => CARDINALITY[r.toCardinality] },
      { head: t.column.relation, cell: (r) => (r.label ? escapeCell(r.label) : '') },
      { head: t.column.identifying, cell: (r) => (r.identifying === false ? t.value.no : t.value.yes) },
      { head: t.column.fromAttribute, cell: (r) => (filled(r.fromAttribute) ? escapeCell(r.fromAttribute) : ''), when: relations.some((r) => filled(r.fromAttribute)) },
      { head: t.column.toAttribute, cell: (r) => (filled(r.toAttribute) ? escapeCell(r.toAttribute) : ''), when: relations.some((r) => filled(r.toAttribute)) },
    ], relations));
  }
  return out;
}

function classTables(ir, c) {
  const { t } = c;
  const classes = list(ir, 'classes');
  const relations = list(ir, 'relations');
  const name = new Map(classes.map((k) => [k.id, escapeCell(k.label)]));
  const out = [c.heading(t.heading.classes)];
  classes.forEach((k, i) => {
    out.push(c.heading(escapeLine(k.label), 1));
    if (k.stereotype) out.push(`${t.column.stereotype}: «${escapeLine(k.stereotype)}»`, '');
    if (k.ref) out.push(`${t.column.details}: ${c.ref(k.ref, `/classes/${i}/ref`)}`, '');
    const members = [...(k.attributes ?? []).map((a) => ({ ...a, member: 'attribute' })), ...(k.methods ?? []).map((m) => ({ ...m, member: 'method' }))];
    if (members.length === 0) { out.push(t.value.noMembers, ''); return; }
    out.push(...table([
      numbered(t),
      { head: t.column.member, cell: (m) => (m.member === 'method' ? `${escapeCell(m.name)}(${filled(m.params) ? escapeCell(m.params) : ''})` : escapeCell(m.name)) },
      { head: t.column.kind, cell: (m) => t.value.member[m.member] },
      { head: t.column.type, cell: (m) => { const type = m.member === 'method' ? m.returns : m.type; return type ? escapeCell(type) : ''; } },
      { head: t.column.visibility, cell: (m) => m.visibility ?? '', when: members.some((m) => m.visibility) },
    ], members));
  });
  if (relations.length > 0) {
    out.push(c.heading(t.heading.relations), ...table([
      numbered(t),
      { head: t.column.from, cell: (r) => name.get(r.from) },
      { head: t.column.relation, cell: (r) => t.value.classRelation[r.kind] },
      { head: t.column.to, cell: (r) => name.get(r.to) },
      { head: t.column.label, cell: (r) => (r.label ? escapeCell(r.label) : ''), when: relations.some((r) => r.label) },
      { head: t.column.fromCardinality, cell: (r) => (r.fromCardinality ? escapeCell(r.fromCardinality) : ''), when: relations.some((r) => r.fromCardinality) },
      { head: t.column.toCardinality, cell: (r) => (r.toCardinality ? escapeCell(r.toCardinality) : ''), when: relations.some((r) => r.toCardinality) },
    ], relations));
  }
  return out;
}

const STORE_KINDS = new Set(['database', 'cache']);
/**
 * The word for what a component is. A bucket carries the kind `database`, which is what the
 * targets without icons draw it as; its icon says it is object storage, and the table says that.
 */
const kindWord = (x) => (x.kind === 'database' && cloudIcon(x.icon)?.category === 'Storage' ? 'storage' : x.kind ?? 'service');

function architectureTables(ir, c) {
  const { t } = c;
  const components = list(ir, 'components');
  const boundaries = list(ir, 'boundaries');
  const connections = list(ir, 'connections');
  const name = new Map([...components, ...boundaries].map((x) => [x.id, escapeCell(x.label)]));
  const parentOf = parents(boundaries);
  // Where an element stands, outermost boundary first.
  const pathOf = (id) => {
    const path = [];
    const seen = new Set();
    for (let at = parentOf.get(id); at !== undefined && !seen.has(at.id); at = parentOf.get(at.id)) { seen.add(at.id); path.unshift(name.get(at.id)); }
    return path.join(' › ');
  };
  const indexOf = new Map(components.map((x, i) => [x.id, i]));
  const componentTable = (head, rows) => table([
    numbered(t),
    { head, cell: (x) => name.get(x.id) },
    { head: t.column.kind, cell: (x) => t.value.component[kindWord(x)] },
    { head: t.column.boundary, cell: (x) => pathOf(x.id), when: boundaries.length > 0 },
    { head: t.column.icon, cell: (x) => (x.icon ? `\`${x.icon}\`` : ''), when: components.some((x) => x.icon) },
    { head: t.column.details, cell: (x) => c.ref(x.ref, `/components/${indexOf.get(x.id)}/ref`), when: rows.some((x) => x.ref) },
  ], rows);
  // A queue holds messages on their way, not data: it has a table of its own, so a reader
  // of the document does not find a topic under the data stores.
  const stores = components.filter((x) => STORE_KINDS.has(x.kind));
  const queues = components.filter((x) => x.kind === 'queue');
  const others = components.filter((x) => !STORE_KINDS.has(x.kind) && x.kind !== 'queue');
  const out = [];
  if (others.length > 0) out.push(c.heading(t.heading.components), ...componentTable(t.column.component, others));
  if (stores.length > 0) out.push(c.heading(t.heading.stores), ...componentTable(t.column.store, stores));
  if (queues.length > 0) out.push(c.heading(t.heading.queues), ...componentTable(t.column.queue, queues));
  if (boundaries.length > 0) {
    out.push(c.heading(t.heading.boundaries), ...table([
      numbered(t),
      { head: t.column.boundary, cell: (b) => name.get(b.id) },
      { head: t.column.frame, cell: (b) => (b.group ? `\`${b.group}\`` : ''), when: boundaries.some((b) => b.group) },
      { head: t.column.inside, cell: (b) => pathOf(b.id), when: boundaries.some((b) => parentOf.has(b.id)) },
    ], boundaries));
  }
  if (connections.length > 0) {
    out.push(c.heading(t.heading.connections), ...table([
      numbered(t),
      { head: t.column.from, cell: (x) => name.get(x.from) },
      { head: t.column.to, cell: (x) => name.get(x.to) },
      { head: t.column.label, cell: (x) => (x.label ? escapeCell(x.label) : ''), when: connections.some((x) => x.label) },
      { head: t.column.direction, cell: (x) => (x.bidirectional ? t.value.bothWays : t.value.oneWay) },
    ], connections));
  }
  return out;
}

/**
 * The steps of an activity in the order they are read: from the starts along the flows,
 * a step after every step that leads to it (a flow back to an earlier step does not count),
 * and within that the branch just opened first. The starts come first, then the steps no
 * flow reaches, in IR order.
 */
function readingOrder(nodes, flows) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out = new Map(nodes.map((n) => [n.id, []]));
  for (const f of flows) if (byId.has(f.from) && byId.has(f.to)) out.get(f.from).push(f.to);
  const roots = nodes.filter((n) => !flows.some((f) => f.to === n.id));
  const back = new Set();
  const state = new Map();
  const walk = (start) => {
    const stack = [[start, 0]];
    state.set(start, 'open');
    while (stack.length > 0) {
      const top = stack.at(-1);
      const next = out.get(top[0])[top[1]++];
      if (next === undefined) { state.set(top[0], 'done'); stack.pop(); continue; }
      if (state.get(next) === 'open') back.add(`${top[0]}\n${next}`);
      else if (!state.has(next)) { state.set(next, 'open'); stack.push([next, 0]); }
    }
  };
  for (const n of [...roots, ...nodes]) if (!state.has(n.id)) walk(n.id);
  const waiting = new Map(nodes.map((n) => [n.id, 0]));
  for (const [from, tos] of out) for (const to of tos) if (!back.has(`${from}\n${to}`)) waiting.set(to, waiting.get(to) + 1);
  const free = nodes.filter((n) => waiting.get(n.id) === 0);
  const ready = [...free.filter((n) => n.kind === 'initial'), ...free.filter((n) => n.kind !== 'initial')].map((n) => n.id).reverse();
  const order = [];
  while (ready.length > 0) {
    const id = ready.pop();
    order.push(byId.get(id));
    const freed = [];
    for (const to of out.get(id)) {
      if (back.has(`${id}\n${to}`)) continue;
      waiting.set(to, waiting.get(to) - 1);
      if (waiting.get(to) === 0) freed.push(to);
    }
    ready.push(...freed.reverse());
  }
  return order;
}

function activityTables(ir, c) {
  const { t } = c;
  const lanes = list(ir, 'lanes');
  const flows = list(ir, 'flows');
  const steps = [...list(ir, 'actions').map((a, i) => ({ ...a, kind: 'action', path: `/actions/${i}/ref` })), ...list(ir, 'controls')];
  const laneName = new Map(lanes.map((l) => [l.id, escapeCell(l.label)]));
  const nameOf = (s) => (filled(s.label) ? escapeCell(s.label) : `(${t.value.step[s.kind]})`);
  const byId = new Map(steps.map((s) => [s.id, s]));
  const next = (s) => joinLines(flows.filter((f) => f.from === s.id).map((f) => {
    const target = byId.get(f.to);
    const handOff = target.lane !== undefined && s.lane !== undefined && target.lane !== s.lane ? ` (${t.value.handOff.replace('{lane}', laneName.get(target.lane))})` : '';
    return `${filled(f.guard) ? `[${escapeCell(f.guard)}] ` : ''}→ ${nameOf(target)}${handOff}`;
  }));
  return [
    c.heading(t.heading.lanes),
    ...table([numbered(t), { head: t.column.lane, cell: (l) => laneName.get(l.id) }], lanes),
    c.heading(t.heading.steps),
    ...table([
      numbered(t),
      { head: t.column.lane, cell: (s) => (s.lane === undefined ? '' : laneName.get(s.lane)) },
      { head: t.column.step, cell: nameOf },
      { head: t.column.kind, cell: (s) => t.value.step[s.kind] },
      { head: t.column.next, cell: next },
      { head: t.column.details, cell: (s) => c.ref(s.ref, s.path), when: steps.some((s) => s.ref) },
    ], readingOrder(steps, flows)),
  ];
}

function flowchartTables(ir, c) {
  const { t } = c;
  const nodes = list(ir, 'nodes');
  const edges = list(ir, 'edges');
  const groups = list(ir, 'groups');
  const name = new Map([...nodes, ...groups].map((x) => [x.id, escapeCell(x.label)]));
  const parentOf = parents(groups);
  // The outcomes of a step: a condition in brackets, a plain label before the arrow.
  const next = (n) => joinLines(edges.filter((e) => e.from === n.id).map((e) => {
    const label = e.label ? escapeCell(e.label) : '';
    return `${label === '' ? '' : (e.kind ?? 'flow') === 'conditional' ? `[${label}] ` : `${label} `}→ ${name.get(e.to)}`;
  }));
  const out = [
    c.heading(t.heading.steps),
    ...table([
      numbered(t),
      { head: t.column.step, cell: (n) => name.get(n.id) },
      { head: t.column.kind, cell: (n) => t.value.shape[n.shape ?? 'process'] },
      { head: t.column.group, cell: (n) => (parentOf.has(n.id) ? name.get(parentOf.get(n.id).id) : ''), when: groups.length > 0 },
      { head: t.column.next, cell: next },
      { head: t.column.details, cell: (n, i) => c.ref(n.ref, `/nodes/${i}/ref`), when: nodes.some((n) => n.ref) },
    ], nodes),
  ];
  if (groups.length > 0) {
    out.push(c.heading(t.heading.groups), ...table([
      numbered(t),
      { head: t.column.group, cell: (g) => name.get(g.id) },
      { head: t.column.inside, cell: (g) => (parentOf.has(g.id) ? name.get(parentOf.get(g.id).id) : ''), when: groups.some((g) => parentOf.has(g.id)) },
    ], groups));
  }
  return out;
}

function usecaseTables(ir, c) {
  const { t } = c;
  const actors = list(ir, 'actors');
  const useCases = list(ir, 'useCases');
  const boundaries = list(ir, 'boundaries');
  const relations = list(ir, 'relations');
  const name = new Map([...actors, ...useCases, ...boundaries].map((x) => [x.id, escapeCell(x.label)]));
  const parentOf = parents(boundaries);
  const kindOf = (a) => a.kind ?? 'person';
  const out = [
    c.heading(t.heading.actors),
    ...table([
      numbered(t),
      { head: t.column.actor, cell: (a) => name.get(a.id) },
      { head: t.column.kind, cell: (a) => t.value.actorKind[kindOf(a)] },
      // A person starts the exchange and a system supports it unless the IR says otherwise.
      { head: t.column.role, cell: (a) => t.value.actorRole[a.role ?? (kindOf(a) === 'system' ? 'supporting' : 'primary')] },
    ], actors),
    c.heading(t.heading.useCases),
    ...table([
      numbered(t),
      { head: t.column.useCase, cell: (u) => name.get(u.id) },
      { head: t.column.boundary, cell: (u) => (parentOf.has(u.id) ? name.get(parentOf.get(u.id).id) : ''), when: boundaries.length > 0 },
      { head: t.column.details, cell: (u, i) => c.ref(u.ref, `/useCases/${i}/ref`), when: useCases.some((u) => u.ref) },
    ], useCases),
  ];
  if (boundaries.length > 0) {
    out.push(c.heading(t.heading.boundaries), ...table([
      numbered(t),
      { head: t.column.boundary, cell: (b) => name.get(b.id) },
    ], boundaries));
  }
  if (relations.length > 0) {
    out.push(c.heading(t.heading.relations), ...table([
      numbered(t),
      { head: t.column.from, cell: (r) => name.get(r.from) },
      { head: t.column.relation, cell: (r) => t.value.useCaseRelation[r.kind] },
      { head: t.column.to, cell: (r) => name.get(r.to) },
      { head: t.column.condition, cell: (r) => (r.condition ? escapeCell(r.condition) : ''), when: relations.some((r) => r.condition) },
    ], relations));
  }
  return out;
}

/** The tables of each kind. A new kind is one more function here and its words in doc-strings.mjs. */
const TABLES = {
  flowchart: flowchartTables,
  sequence: sequenceTables,
  state: stateTables,
  er: erTables,
  class: classTables,
  architecture: architectureTables,
  activity: activityTables,
  usecase: usecaseTables,
};

export const DOC_KINDS = Object.keys(TABLES);

/** The first line of every document: it tells a later run which language to write again. */
export const docMarker = (lang) => `<!-- zukai doc, lang=${lang}: generated from the IR, regenerate instead of editing -->`;

/** The language a document was written in, read from its first line; undefined when it has none. */
export function docLangOf(text) {
  return /^<!-- zukai doc, lang=([a-z]+):/.exec(text)?.[1];
}

/**
 * The description tables of one diagram.
 * @param {object} ir a valid IR
 * @param {{ lang?: string, refs?: Map<string, { pageId: string, title: string }>, part?: { id: string, anchor: string } }} [options]
 *   `refs` is set inside a bundle: a `ref` then links to the heading of the part it names.
 *   `part` makes the section of a bundle: one heading level down, under an anchor of its own,
 *   with the IR file it came from, and without the first line of a document.
 * @returns {{ output?: string, errors?: Array<object>, warnings: Array<object> }}
 */
export function emitDoc(ir, options = {}) {
  const lang = options.lang ?? 'en';
  const t = DOC_STRINGS[lang];
  if (!t) return { errors: [{ path: '/', message: `no description tables in language "${lang}"`, hint: `--lang takes one of: ${DOC_LANGS.join(', ')}` }], warnings: [] };
  const tables = TABLES[ir.kind];
  if (!tables) return { errors: [{ path: '/kind', message: `kind "${ir.kind}" has no description tables`, hint: `kinds with tables: ${DOC_KINDS.join(', ')}` }], warnings: [] };
  const warnings = [];
  const top = options.part ? 2 : 1;
  const c = {
    t,
    heading: (text, deeper = 0) => `${'#'.repeat(top + 1 + deeper)} ${text}\n`,
    // The part's title as a link to its heading in a bundle; the slug outside one, and for
    // a ref the bundle does not hold, which is reported as the other targets report it.
    ref: (ref, path) => {
      if (!ref) return '';
      const target = options.refs?.get(ref);
      if (target) return `[${escapeLine(target.title)}](#${target.pageId})`;
      if (options.refs) warnings.push({ path, message: `ref "${ref}" is not in this bundle: the table shows the slug without a link`, hint: 'bundle the referenced diagram too, or fix the ref' });
      return `\`${ref}\``;
    },
  };
  const lines = [];
  if (options.part) lines.push(`<a id="${options.part.anchor}"></a>`, '');
  else lines.push(docMarker(lang));
  lines.push(`${'#'.repeat(top)} ${escapeLine(ir.title)}`, '');
  lines.push(`${t.diagramKind}: ${t.diagram[ir.kind]}${options.part ? ` · ${t.source}: \`${options.part.source ?? `source/${options.part.id}.ir.json`}\`` : ''}`, '');
  lines.push(...tables(ir, c));
  const omitted = ir.meta?.omitted ?? [];
  if (omitted.length > 0) lines.push(`${t.omitted}:`, '', ...omitted.map((o) => `- ${escapeLine(o)}`), '');
  return { output: lines.join('\n').replace(/\n{3,}/g, '\n\n'), warnings };
}

/**
 * One document for several diagrams: a title, then the section of each diagram in the order given.
 * @param {string[]} sections the `output` of `emitDoc` with `part` set
 * @param {{ lang?: string, title?: string }} [options]
 */
export function docBundle(sections, options = {}) {
  const lang = options.lang ?? 'en';
  return [docMarker(lang), `# ${escapeLine(options.title ?? DOC_STRINGS[lang].bundleTitle)}`, '', ...sections.map((s) => s.trimEnd() + '\n')].join('\n');
}
