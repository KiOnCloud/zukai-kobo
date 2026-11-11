import { awsIcon, awsGroup, nearestAwsNames } from './aws-icons.mjs';
/**
 * Referential-integrity checks that JSON Schema cannot express: unique ids across the
 * document, every endpoint and child exists, containment has no cycles, and the
 * per-kind structural rules. Tolerates a document that failed schema validation: every
 * collection is read defensively so the schema errors and these errors can be merged.
 */

const COLLECTIONS = {
  flowchart: ['nodes', 'edges', 'groups'],
  sequence: ['participants', 'messages', 'blocks', 'notes'],
  state: ['states', 'transitions'],
  er: ['entities', 'relations'],
  class: ['classes', 'relations'],
  architecture: ['components', 'boundaries', 'connections'],
  activity: ['lanes', 'actions', 'controls', 'flows'],
};

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const list = (ir, name) => (Array.isArray(ir[name]) ? ir[name].filter(isObj) : []);
const idSet = (items) => new Set(items.map((x) => x.id).filter((id) => typeof id === 'string'));

export function checkReferences(ir) {
  const errors = [];
  const err = (path, message, hint) => errors.push(hint ? { path, message, hint } : { path, message });
  const names = COLLECTIONS[ir.kind];
  if (!names) return { ok: true, errors };

  // Unique ids across every collection of the document.
  const seen = new Map();
  for (const name of names) {
    (Array.isArray(ir[name]) ? ir[name] : []).forEach((el, i) => {
      if (!isObj(el) || typeof el.id !== 'string') return;
      const path = `/${name}/${i}`;
      if (seen.has(el.id)) err(`${path}/id`, `duplicate id "${el.id}", first used at ${seen.get(el.id)}`, 'every id must be unique across the whole document');
      else seen.set(el.id, path);
    });
  }

  switch (ir.kind) {
    case 'flowchart': checkFlowchart(ir, err); break;
    case 'sequence': checkSequence(ir, err); break;
    case 'state': checkState(ir, err); break;
    case 'er': checkEr(ir, err); break;
    case 'class': checkClass(ir, err); break;
    case 'architecture': checkArchitecture(ir, err); break;
    case 'activity': checkActivity(ir, err); break;
    default: break;
  }
  return { ok: errors.length === 0, errors };
}

function checkEndpoints(ir, collection, targets, targetName, err) {
  (Array.isArray(ir[collection]) ? ir[collection] : []).forEach((el, i) => {
    if (!isObj(el)) return;
    for (const field of ['from', 'to']) {
      const v = el[field];
      if (typeof v === 'string' && !targets.has(v)) {
        err(`/${collection}/${i}/${field}`, `unknown ${targetName} "${v}"`, `every ${field} must be the id of an existing ${targetName}`);
      }
    }
  });
}

/**
 * Containers reference children by id. Checks: child exists, child has at most one
 * parent, and the parent chain has no cycle (a container cannot contain itself).
 */
function checkContainment(ir, collection, allowed, allowedName, err) {
  const containers = list(ir, collection);
  const parentOf = new Map();
  containers.forEach((c, i) => {
    if (!Array.isArray(c.children)) return;
    c.children.forEach((child, j) => {
      const path = `/${collection}/${i}/children/${j}`;
      if (typeof child !== 'string') return;
      if (!allowed.has(child)) {
        err(path, `unknown child "${child}"`, `children must be ids of ${allowedName}`);
        return;
      }
      if (child === c.id) {
        err(path, `"${c.id}" cannot contain itself`);
        return;
      }
      if (parentOf.has(child)) {
        err(path, `"${child}" is already a child of "${parentOf.get(child)}"`, 'an element belongs to at most one container');
        return;
      }
      parentOf.set(child, c.id);
    });
  });
  // Cycle detection over container -> parent container links.
  const containerIds = idSet(containers);
  containers.forEach((c, i) => {
    if (typeof c.id !== 'string') return;
    const visited = new Set([c.id]);
    let cur = parentOf.get(c.id);
    while (cur !== undefined && containerIds.has(cur)) {
      if (visited.has(cur)) {
        err(`/${collection}/${i}`, `containment cycle through "${c.id}"`, 'containers may nest but never form a loop');
        break;
      }
      visited.add(cur);
      cur = parentOf.get(cur);
    }
  });
  return parentOf;
}

function checkFlowchart(ir, err) {
  const nodes = idSet(list(ir, 'nodes'));
  const groups = idSet(list(ir, 'groups'));
  checkEndpoints(ir, 'edges', nodes, 'node', err);
  list(ir, 'edges').forEach((e, i) => {
    if (e.kind === 'conditional' && (typeof e.label !== 'string' || e.label.length === 0)) {
      err(`/edges/${i}`, 'conditional edge needs a label', 'set label to the condition text, for example "yes" or "amount > 100"');
    }
  });
  checkContainment(ir, 'groups', new Set([...nodes, ...groups]), 'nodes or groups', err);
}

function checkSequence(ir, err) {
  const participants = idSet(list(ir, 'participants'));
  checkEndpoints(ir, 'messages', participants, 'participant', err);
  const messages = list(ir, 'messages');
  const order = new Map();
  messages.forEach((m, i) => { if (typeof m.id === 'string' && !order.has(m.id)) order.set(m.id, i); });

  list(ir, 'notes').forEach((n, i) => {
    (Array.isArray(n.participants) ? n.participants : []).forEach((p, j) => {
      if (typeof p === 'string' && !participants.has(p)) err(`/notes/${i}/participants/${j}`, `unknown participant "${p}"`);
    });
    if (typeof n.after === 'string' && !order.has(n.after)) err(`/notes/${i}/after`, `unknown message "${n.after}"`, 'after must be the id of a message, or omitted to place the note first');
  });

  // Blocks reference the messages they contain (all of them, including those of nested blocks).
  const ranges = [];
  list(ir, 'blocks').forEach((b, i) => {
    const path = `/blocks/${i}`;
    if (Array.isArray(b.branches) && b.branches.length > 0 && !['alt', 'par'].includes(b.kind)) {
      err(`${path}/branches`, `block kind "${b.kind}" cannot have branches`, 'only alt (else) and par (and) blocks have extra sections');
    }
    const sections = [{ path: `${path}/messages`, ids: b.messages }];
    (Array.isArray(b.branches) ? b.branches : []).forEach((br, j) => {
      if (isObj(br)) sections.push({ path: `${path}/branches/${j}/messages`, ids: br.messages });
    });
    let prevEnd = null;
    let start = null;
    let end = null;
    const sectionRanges = [];
    let valid = true;
    for (const s of sections) {
      if (!Array.isArray(s.ids)) { valid = false; continue; }
      const idx = [];
      let ok = true;
      s.ids.forEach((id, k) => {
        if (typeof id !== 'string') { ok = false; return; }
        if (!order.has(id)) { err(`${s.path}/${k}`, `unknown message "${id}"`, 'block sections list ids from the top-level messages array'); ok = false; return; }
        idx.push(order.get(id));
      });
      if (!ok || idx.length === 0) { valid = false; continue; }
      const sorted = [...idx].sort((a, c) => a - c);
      const contiguous = sorted.every((v, k) => k === 0 || v === sorted[k - 1] + 1);
      if (!contiguous) {
        err(s.path, 'messages in a block section must be a contiguous run in the top-level messages order', 'list every message between the first and the last one of the section, including messages of nested blocks');
        valid = false;
      }
      if (prevEnd !== null && sorted[0] !== prevEnd + 1) {
        err(s.path, 'this section must start right after the previous section of the same block');
        valid = false;
      }
      sectionRanges.push({ start: sorted[0], end: sorted[sorted.length - 1] });
      if (start === null) start = sorted[0];
      end = sorted[sorted.length - 1];
      prevEnd = end;
    }
    if (valid && start !== null) ranges.push({ id: b.id, path, start, end, sections: sectionRanges });
  });
  for (let a = 0; a < ranges.length; a++) {
    for (let b = a + 1; b < ranges.length; b++) {
      const x = ranges[a];
      const y = ranges[b];
      const overlap = x.start <= y.end && y.start <= x.end;
      if (!overlap) continue;
      const xInY = y.start <= x.start && x.end <= y.end;
      const yInX = x.start <= y.start && y.end <= x.end;
      if (!xInY && !yInX) {
        err(y.path, `block "${y.id}" overlaps block "${x.id}" without nesting`, 'blocks are either disjoint or one is fully inside one section of the other');
        continue;
      }
      const outer = xInY ? y : x;
      const inner = xInY ? x : y;
      const inOneSection = outer.sections.some((s) => s.start <= inner.start && inner.end <= s.end);
      if (!inOneSection) err(inner.path, `block "${inner.id}" spans more than one section of block "${outer.id}"`, 'a nested block must sit inside a single section');
    }
  }
}

function checkState(ir, err) {
  const states = list(ir, 'states');
  const ids = idSet(states);
  const kindOf = new Map(states.map((s) => [s.id, s.kind ?? 'simple']));
  states.forEach((s, i) => {
    const kind = s.kind ?? 'simple';
    if (kind !== 'initial' && kind !== 'final' && (typeof s.label !== 'string' || s.label.length === 0)) {
      err(`/states/${i}`, `state "${s.id}" needs a label`, 'only initial and final states may omit the label');
    }
    if ((kind === 'initial' || kind === 'final') && s.ref !== undefined) {
      err(`/states/${i}/ref`, `state "${s.id}" is ${kind === 'initial' ? 'an initial' : 'a final'} state and cannot carry a ref`, 'initial and final states are drawn as circles without a label; put the ref on the state the sub-diagram details');
    }
    if (kind !== 'composite' && Array.isArray(s.children) && s.children.length > 0) {
      err(`/states/${i}/children`, `state "${s.id}" has children but its kind is "${kind}"`, 'set kind to "composite" or remove children');
    }
  });
  checkContainment(ir, 'states', ids, 'states', err);
  checkEndpoints(ir, 'transitions', ids, 'state', err);
  list(ir, 'transitions').forEach((t, i) => {
    if (kindOf.get(t.from) === 'final') err(`/transitions/${i}/from`, `transition "${t.id}" leaves a final state`, 'final states have no outgoing transitions');
    if (kindOf.get(t.to) === 'initial') err(`/transitions/${i}/to`, `transition "${t.id}" enters an initial state`, 'initial states have no incoming transitions');
  });
}

function checkEr(ir, err) {
  const entities = list(ir, 'entities');
  checkEndpoints(ir, 'relations', idSet(entities), 'entity', err);
  entities.forEach((e, i) => {
    const names = new Set();
    (Array.isArray(e.attributes) ? e.attributes : []).forEach((a, j) => {
      if (!isObj(a) || typeof a.name !== 'string') return;
      if (names.has(a.name)) err(`/entities/${i}/attributes/${j}/name`, `duplicate attribute "${a.name}" in entity "${e.id}"`);
      names.add(a.name);
    });
  });
}

function checkClass(ir, err) {
  checkEndpoints(ir, 'relations', idSet(list(ir, 'classes')), 'class', err);
}

function checkArchitecture(ir, err) {
  const components = idSet(list(ir, 'components'));
  const boundaries = idSet(list(ir, 'boundaries'));
  checkEndpoints(ir, 'connections', components, 'component', err);
  checkContainment(ir, 'boundaries', new Set([...components, ...boundaries]), 'components or boundaries', err);
  checkAwsNames(ir, 'components', 'icon', 'icons', awsIcon, err);
  checkAwsNames(ir, 'boundaries', 'group', 'groups', awsGroup, err);
}

/** An icon or group frame must be a name of the catalog: draw.io draws an unknown one as an empty box. */
function checkAwsNames(ir, collection, field, table, lookup, err) {
  (Array.isArray(ir[collection]) ? ir[collection] : []).forEach((el, i) => {
    // A value of the wrong shape is the schema's error; only a well-formed name is looked up.
    const shape = field === 'icon' ? /^(aws|gcp):[a-z0-9_]{1,64}$/ : /^aws:[a-z0-9_]{1,64}$/;
    if (!isObj(el) || typeof el[field] !== 'string' || !shape.test(el[field]) || lookup(el[field])) return;
    const near = nearestAwsNames(table, el[field]);
    const what = field === 'icon' ? (el[field].startsWith('gcp:') ? 'product logo' : 'AWS icon') : 'AWS group frame';
    err(`/${collection}/${i}/${field}`, `unknown ${what} "${el[field]}"`, `${near.length ? `did you mean ${near.join(', ')}? ` : ''}the names are listed in references/aws-icons.md; leave "${field}" out when none fits`);
  });
}

function checkActivity(ir, err) {
  const lanes = idSet(list(ir, 'lanes'));
  list(ir, 'actions').forEach((a, i) => {
    if (typeof a.lane === 'string' && !lanes.has(a.lane)) err(`/actions/${i}/lane`, `unknown lane "${a.lane}"`, 'every action belongs to exactly one existing lane');
  });
  const controls = list(ir, 'controls');
  controls.forEach((c, i) => {
    if (typeof c.lane === 'string' && !lanes.has(c.lane)) err(`/controls/${i}/lane`, `unknown lane "${c.lane}"`, 'controls may name an existing lane or omit it');
  });
  const nodes = new Set([...idSet(list(ir, 'actions')), ...idSet(controls)]);
  checkEndpoints(ir, 'flows', nodes, 'action or control', err);
  const kindOf = new Map(controls.map((c) => [c.id, c.kind]));
  list(ir, 'flows').forEach((f, i) => {
    if (kindOf.get(f.from) === 'final') err(`/flows/${i}/from`, `flow "${f.id}" leaves a final node`, 'final nodes have no outgoing flows');
    if (kindOf.get(f.to) === 'initial') err(`/flows/${i}/to`, `flow "${f.id}" enters an initial node`, 'initial nodes have no incoming flows');
  });
}

export { COLLECTIONS };
