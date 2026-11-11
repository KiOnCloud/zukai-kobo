/**
 * What a valid IR can still get wrong as a model. The schema and the reference check make
 * sure every field has the right shape and every id exists; they cannot tell that a decision
 * has one way out, that a state is never reached or that a reply comes before its call. Those
 * are reported here as `model:` warnings on `validate` and on every emit, and as `size:`
 * warnings when a diagram holds far more than a reader takes in. They are warnings because
 * each has an honest exception (a decision whose other branch is left out on purpose), which
 * the author records in `meta.omitted`.
 */

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const list = (ir, key) => (Array.isArray(ir[key]) ? ir[key].filter(isObj) : []);
const q = (id) => `"${id}"`;

/** Above this many elements a diagram no longer reads as one picture (the skill aims at 15 to 20). */
const SIZE_LIMIT = 40;
const SIZE_OF = {
  flowchart: (ir) => ({ n: list(ir, 'nodes').length, what: 'nodes' }),
  activity: (ir) => ({ n: list(ir, 'actions').length + list(ir, 'controls').length, what: 'actions and controls' }),
  sequence: (ir) => ({ n: list(ir, 'messages').length, what: 'messages' }),
  state: (ir) => ({ n: list(ir, 'states').length, what: 'states' }),
  er: (ir) => ({ n: list(ir, 'entities').length, what: 'entities' }),
  class: (ir) => ({ n: list(ir, 'classes').length, what: 'classes' }),
  architecture: (ir) => ({ n: list(ir, 'components').length, what: 'components' }),
};

function degrees(nodes, edges) {
  const out = new Map(nodes.map((n) => [n.id, 0]));
  const inn = new Map(nodes.map((n) => [n.id, 0]));
  for (const e of edges) {
    if (out.has(e.from)) out.set(e.from, out.get(e.from) + 1);
    if (inn.has(e.to)) inn.set(e.to, inn.get(e.to) + 1);
  }
  return { out, inn };
}

function checkDecisions(decisions, out, collection, indexOf, warn, edgeWord) {
  for (const d of decisions) {
    const n = out.get(d.id) ?? 0;
    if (n >= 2) continue;
    warn(`/${collection}/${indexOf(d)}`, `model: decision ${q(d.id)} has ${n === 0 ? 'no way out' : 'one way out'}; a decision is a question with at least two answers`, `add the missing ${edgeWord} with its condition, or draw a plain step when nothing is decided here; a branch left out on purpose goes into meta.omitted`);
  }
}

function checkOrphans(nodes, out, inn, collection, indexOf, warn, edgeWord) {
  if (nodes.length < 2) return;
  for (const n of nodes) {
    if ((out.get(n.id) ?? 0) + (inn.get(n.id) ?? 0) > 0) continue;
    warn(`/${collection}/${indexOf(n)}`, `model: ${q(n.id)} is connected to nothing`, `add the ${edgeWord} that reaches it, or remove it`);
  }
}

function checkFlowchart(ir, warn) {
  const nodes = list(ir, 'nodes');
  const edges = list(ir, 'edges');
  const index = new Map(nodes.map((n, i) => [n.id, i]));
  const { out, inn } = degrees(nodes, edges);
  checkDecisions(nodes.filter((n) => n.shape === 'decision'), out, 'nodes', (n) => index.get(n.id), warn, 'edge');
  // A note explains its neighbours and may stand alone.
  checkOrphans(nodes.filter((n) => n.shape !== 'note'), out, inn, 'nodes', (n) => index.get(n.id), warn, 'edge');
  const seen = new Map();
  edges.forEach((e, i) => {
    const key = JSON.stringify([e.from, e.to, e.label ?? '']);
    if (seen.has(key)) warn(`/edges/${i}`, `model: edge ${q(e.id)} repeats edge ${q(seen.get(key))} (same ends, same label)`, 'remove one of the two');
    else seen.set(key, e.id);
  });
}

function checkActivity(ir, warn) {
  const actions = list(ir, 'actions');
  const controls = list(ir, 'controls');
  const flows = list(ir, 'flows');
  const nodes = [...actions, ...controls];
  const { out, inn } = degrees(nodes, flows);
  const controlIndex = new Map(controls.map((c, i) => [c.id, i]));
  const actionIndex = new Map(actions.map((a, i) => [a.id, i]));
  checkDecisions(controls.filter((c) => c.kind === 'decision'), out, 'controls', (c) => controlIndex.get(c.id), warn, 'flow');
  checkOrphans(actions, out, inn, 'actions', (a) => actionIndex.get(a.id), warn, 'flow');
  checkOrphans(nodes.length > 1 ? controls : [], out, inn, 'controls', (c) => controlIndex.get(c.id), warn, 'flow');
}

function checkState(ir, warn) {
  const states = list(ir, 'states');
  const transitions = list(ir, 'transitions');
  const initial = states.filter((s) => s.kind === 'initial');
  if (states.length > 1 && initial.length === 0) {
    warn('/states', 'model: no initial state; the reader cannot tell where the thing starts', 'add a state with kind "initial" and a transition from it to the first status');
    return;
  }
  const parentOf = new Map();
  for (const s of states) for (const child of Array.isArray(s.children) ? s.children : []) parentOf.set(child, s.id);
  const childrenOf = new Map(states.map((s) => [s.id, Array.isArray(s.children) ? s.children : []]));
  const next = new Map(states.map((s) => [s.id, []]));
  for (const t of transitions) next.get(t.from)?.push(t.to);
  // Entering a state enters the composite around it; an initial state inside a composite is
  // entered with the composite; a transition from a composite leaves from any of its states.
  const reached = new Set();
  const queue = initial.filter((s) => !parentOf.has(s.id)).map((s) => s.id);
  const visit = (id) => { if (id !== undefined && !reached.has(id)) { reached.add(id); queue.push(id); } };
  for (const id of queue.splice(0)) visit(id);
  while (queue.length > 0) {
    const id = queue.shift();
    for (const to of next.get(id) ?? []) visit(to);
    visit(parentOf.get(id));
    for (const child of childrenOf.get(id) ?? []) if (states.find((s) => s.id === child)?.kind === 'initial') visit(child);
  }
  states.forEach((s, i) => {
    if (reached.has(s.id) || s.kind === 'initial') return;
    // A composite without an initial state of its own is entered through its children.
    if ((childrenOf.get(s.id) ?? []).some((c) => reached.has(c))) return;
    warn(`/states/${i}`, `model: state ${q(s.id)} is never reached from the initial state`, 'add the transition that leads to it, or remove it');
  });
}

function checkSequence(ir, warn) {
  const called = new Set();
  list(ir, 'messages').forEach((m, i) => {
    if (m.kind === 'return') {
      if (m.from !== m.to && !called.has(`${m.to}>${m.from}`)) {
        warn(`/messages/${i}`, `model: return ${q(m.id)} from ${q(m.from)} to ${q(m.to)} comes before any call from ${q(m.to)} to ${q(m.from)}`, 'messages are drawn in the order of the array: put the call first, or change the kind when this is not a reply');
      }
      return;
    }
    called.add(`${m.from}>${m.to}`);
  });
}

function checkEr(ir, warn) {
  const related = new Set();
  for (const r of list(ir, 'relations')) { related.add(r.from); related.add(r.to); }
  list(ir, 'entities').forEach((e, i) => {
    const fks = (Array.isArray(e.attributes) ? e.attributes : []).filter((a) => isObj(a) && a.key === 'fk');
    if (fks.length === 0 || related.has(e.id)) return;
    warn(`/entities/${i}`, `model: entity ${q(e.id)} has a foreign key (${fks.map((a) => q(a.name)).join(', ')}) but takes part in no relation`, 'add the relation the key stands for, or drop the fk mark');
  });
}

const CHECKS = { flowchart: checkFlowchart, activity: checkActivity, state: checkState, sequence: checkSequence, er: checkEr };

/**
 * @param {object} ir a valid IR
 * @returns {{ warnings: Array<{ path: string, message: string, hint: string }> }}
 */
export function checkModel(ir) {
  const warnings = [];
  if (!isObj(ir)) return { warnings };
  const warn = (path, message, hint) => warnings.push({ path, message, hint });
  CHECKS[ir.kind]?.(ir, warn);
  const size = SIZE_OF[ir.kind]?.(ir);
  if (size && size.n > SIZE_LIMIT) {
    warn('/', `size: ${size.n} ${size.what} in one diagram; a reader follows about 15 to 20, and the layout slows down with every element`, 'keep the main flow here and move each sub-flow into a part of its own, linked with `ref` on the step that stands for it (scope "detailed")');
  }
  return { warnings };
}
