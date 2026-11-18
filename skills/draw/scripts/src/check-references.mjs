import { PROVIDERS, cloudIcon, cloudGroup, cloudAlias, cloudNameElsewhere, suggestCloudNames, providerOf } from './aws-icons.mjs';
import { sourcePathProblem } from './sources.mjs';
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
  usecase: ['actors', 'useCases', 'boundaries', 'relations'],
};

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const list = (ir, name) => (Array.isArray(ir[name]) ? ir[name].filter(isObj) : []);
const idSet = (items) => new Set(items.map((x) => x.id).filter((id) => typeof id === 'string'));

export function checkReferences(ir) {
  const errors = [];
  const err = (path, message, hint) => errors.push(hint ? { path, message, hint } : { path, message });
  const names = COLLECTIONS[ir.kind];
  if (!names) return { ok: true, errors };

  // Source paths are followed from the project root on any machine, so each one has to be
  // relative to it and stay inside it.
  (Array.isArray(ir.meta?.sources) ? ir.meta.sources : []).forEach((p, i) => {
    const problem = sourcePathProblem(p);
    if (problem === 'absolute') err(`/meta/sources/${i}`, `absolute path "${p}"`, 'write the path from the project root, such as "src/auth/login.ts"');
    else if (problem === 'backslash') err(`/meta/sources/${i}`, `backslash in path "${p}"`, 'write the path with forward slashes, such as "src/auth/login.ts"');
    else if (problem === 'outside') err(`/meta/sources/${i}`, `path "${p}" leaves the project`, 'a source lies inside the project: remove the ".." segment and write the path from the project root');
  });

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
    case 'usecase': checkUsecase(ir, err); break;
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
    // A note follows a message, or a whole block: after the block's id it stands below the frame.
    const blockIds = idSet(list(ir, 'blocks'));
    if (typeof n.after === 'string' && !order.has(n.after) && !blockIds.has(n.after)) err(`/notes/${i}/after`, `unknown message or block "${n.after}"`, 'after must be the id of a message or of a block (the note then stands below the block), or omitted to place the note first');
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
  checkCloudNames(ir, 'components', 'icon', 'icons', cloudIcon, err);
  checkCloudNames(ir, 'boundaries', 'group', 'groups', cloudGroup, err);
}

/** An icon or group frame must be a name of the catalog: draw.io draws an unknown one as an empty box. */
function checkCloudNames(ir, collection, field, table, lookup, err) {
  (Array.isArray(ir[collection]) ? ir[collection] : []).forEach((el, i) => {
    // A value of the wrong shape is the schema's error; only a well-formed name is looked up.
    const provider = isObj(el) && typeof el[field] === 'string' && /^[a-z]+:[a-z0-9_]{1,64}$/.test(el[field]) ? PROVIDERS[providerOf(el[field])] : undefined;
    if (!provider || lookup(el[field])) return;
    const what = `${provider.title} ${field === 'icon' ? 'icon' : 'group frame'}`;
    const listed = `the names are listed in ${provider.reference}; leave "${field}" out when none fits`;
    // What the name is known as comes before what it merely looks like: a near name that is
    // valid and wrong (`gcp:gke_on_prem` for `gcp:gke`) would be drawn without a complaint.
    const alias = cloudAlias(table, el[field]);
    const elsewhere = alias ? undefined : cloudNameElsewhere(table, el[field]);
    let hint;
    if (alias && alias.name === null) {
      hint = `draw.io has no stencil for this service: leave "${field}" out, and the ${field === 'icon' ? 'component keeps its generic shape' : 'boundary is a plain frame'}; ${listed}`;
    } else if (alias) {
      hint = `did you mean ${alias.name}? That is draw.io's name for it; ${listed}`;
    } else if (elsewhere && elsewhere.provider === providerOf(el[field])) {
      hint = elsewhere.table === 'groups'
        ? `${el[field]} is a group frame, not an icon: write it as "group" of the boundary that holds the components; ${listed}`
        : `${el[field]} is an icon, not a group frame: write it as "icon" of a component; ${listed}`;
    } else if (elsewhere) {
      const near = suggestCloudNames(table, el[field]);
      hint = `this name is ${PROVIDERS[elsewhere.provider].title}'s: write ${elsewhere.value} when the ${field === 'icon' ? 'component runs' : 'frame is'} on ${PROVIDERS[elsewhere.provider].title}${near.length ? `; the nearest ${provider.title} names are ${near.join(', ')}` : ''}; ${listed}`;
    } else {
      const near = suggestCloudNames(table, el[field]);
      hint = `${near.length ? `did you mean ${near.join(', ')}? ` : ''}${listed}`;
    }
    err(`/${collection}/${i}/${field}`, `unknown ${what} "${el[field]}"`, hint);
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

/** What each relation of a use case diagram may join, and how the error says it. */
const USECASE_ENDS = {
  include: { hint: 'from is the use case that always runs the other one, to is the one it includes' },
  extend: { hint: 'from is the use case that adds optional behaviour, to is the use case it extends' },
};

function checkUsecase(ir, err) {
  const actors = idSet(list(ir, 'actors'));
  const useCases = idSet(list(ir, 'useCases'));
  // A boundary is the system: it holds use cases, and the actors stand outside it.
  const parentOf = new Map();
  list(ir, 'boundaries').forEach((b, i) => {
    (Array.isArray(b.children) ? b.children : []).forEach((child, j) => {
      const path = `/boundaries/${i}/children/${j}`;
      if (typeof child !== 'string') return;
      if (actors.has(child)) { err(path, `actor "${child}" cannot be inside boundary "${b.id}"`, 'a boundary is the system and holds use cases only; an actor is outside the system by definition'); return; }
      if (!useCases.has(child)) { err(path, `unknown use case "${child}"`, 'children must be ids of use cases'); return; }
      if (parentOf.has(child)) { err(path, `use case "${child}" is already in boundary "${parentOf.get(child)}"`, 'a use case belongs to at most one boundary'); return; }
      parentOf.set(child, b.id);
    });
  });
  checkEndpoints(ir, 'relations', new Set([...actors, ...useCases]), 'actor or use case', err);
  const generalizes = [];
  list(ir, 'relations').forEach((r, i) => {
    const path = `/relations/${i}`;
    if (r.condition !== undefined && r.kind !== 'extend') err(`${path}/condition`, `relation "${r.id}" is ${/^[aei]/.test(r.kind) ? 'an' : 'a'} ${r.kind} and cannot carry a condition`, 'only an extend relation has a condition; remove the field or change the kind');
    const known = (id) => actors.has(id) || useCases.has(id);
    if (typeof r.from !== 'string' || typeof r.to !== 'string' || !known(r.from) || !known(r.to)) return;
    if (r.from === r.to) { err(path, `relation "${r.id}" joins "${r.from}" to itself`, 'a relation joins two different elements'); return; }
    const what = (id) => (actors.has(id) ? 'actor' : 'use case');
    switch (r.kind) {
      case 'association':
        if (actors.has(r.from) === actors.has(r.to)) err(path, `association "${r.id}" joins two ${what(r.from)}s ("${r.from}" and "${r.to}")`, actors.has(r.from) ? 'an association joins an actor and a use case; one actor that is a kind of another is a generalization' : 'an association joins an actor and a use case; between two use cases use include, extend or generalization');
        break;
      case 'include':
      case 'extend':
        for (const field of ['from', 'to']) if (actors.has(r[field])) err(`${path}/${field}`, `${r.kind} "${r.id}" ${field === 'from' ? 'starts at' : 'ends at'} actor "${r[field]}"`, `${r.kind} joins two use cases: ${USECASE_ENDS[r.kind].hint}`);
        break;
      case 'generalization':
        if (actors.has(r.from) !== actors.has(r.to)) err(path, `generalization "${r.id}" joins ${what(r.from)} "${r.from}" and ${what(r.to)} "${r.to}"`, 'a generalization joins two actors or two use cases: from is the special one, to the general one');
        else generalizes.push({ r, path });
        break;
      default: break;
    }
  });
  // Nothing is a kind of itself: the generalizations form no loop.
  const general = new Map();
  for (const { r } of generalizes) (general.get(r.from) ?? general.set(r.from, []).get(r.from)).push(r.to);
  const reaches = (from, target) => {
    const seen = new Set();
    const stack = [...(general.get(from) ?? [])];
    while (stack.length > 0) {
      const id = stack.pop();
      if (id === target) return true;
      if (seen.has(id)) continue;
      seen.add(id);
      stack.push(...(general.get(id) ?? []));
    }
    return false;
  };
  for (const { r, path } of generalizes) {
    if (reaches(r.to, r.from)) err(path, `generalization cycle through "${r.from}" and "${r.to}"`, 'from is the special element and to the general one; nothing is a kind of itself');
  }
}

export { COLLECTIONS };
