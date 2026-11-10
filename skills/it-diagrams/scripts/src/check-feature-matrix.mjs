import matrix from './feature-matrix.json' with { type: 'json' };

export const TARGETS = matrix.targets;
export { matrix };

const list = (ir, name) => (Array.isArray(ir[name]) ? ir[name] : []);

/**
 * Walk an IR document and list every feature it uses, with the element and path that
 * uses it. The feature names are the keys of feature-matrix.json.
 * @returns {Array<{ feature: string, path: string, elementId?: string }>}
 */
export function enumerateFeatures(ir) {
  const out = [];
  const use = (feature, path, elementId) => out.push(elementId === undefined ? { feature, path } : { feature, path, elementId });
  switch (ir.kind) {
    case 'flowchart': {
      list(ir, 'nodes').forEach((n, i) => { use(`node.shape.${n.shape ?? 'process'}`, `/nodes/${i}`, n.id); if (n.ref) use('node.ref', `/nodes/${i}`, n.id); });
      list(ir, 'edges').forEach((e, i) => use(`edge.kind.${e.kind ?? 'flow'}`, `/edges/${i}`, e.id));
      const groups = list(ir, 'groups');
      const groupIds = new Set(groups.map((g) => g.id));
      groups.forEach((g, i) => {
        use('group', `/groups/${i}`, g.id);
        if ((g.children ?? []).some((c) => groupIds.has(c))) use('group.nested', `/groups/${i}`, g.id);
      });
      break;
    }
    case 'sequence': {
      list(ir, 'participants').forEach((p, i) => use(`participant.kind.${p.kind ?? 'participant'}`, `/participants/${i}`, p.id));
      list(ir, 'messages').forEach((m, i) => { use(`message.kind.${m.kind ?? 'sync'}`, `/messages/${i}`, m.id); if (m.ref) use('message.ref', `/messages/${i}`, m.id); });
      list(ir, 'blocks').forEach((b, i) => use(`block.kind.${b.kind}`, `/blocks/${i}`, b.id));
      list(ir, 'notes').forEach((n, i) => use('note', `/notes/${i}`, n.id));
      break;
    }
    case 'state': {
      const states = list(ir, 'states');
      const parentOf = new Map();
      states.forEach((s) => (s.children ?? []).forEach((c) => parentOf.set(c, s.id)));
      const depth = (id) => {
        let d = 0;
        let cur = parentOf.get(id);
        const seen = new Set();
        while (cur !== undefined && !seen.has(cur)) { seen.add(cur); d++; cur = parentOf.get(cur); }
        return d;
      };
      states.forEach((s, i) => {
        use(`state.kind.${s.kind ?? 'simple'}`, `/states/${i}`, s.id);
        if ((s.kind ?? 'simple') === 'composite' && depth(s.id) >= 2) use('composite.depth.gt2', `/states/${i}`, s.id);
        if (s.ref) use('state.ref', `/states/${i}`, s.id);
      });
      list(ir, 'transitions').forEach((t, i) => {
        if (t.guard) use('transition.guard', `/transitions/${i}`, t.id);
        if (t.action) use('transition.action', `/transitions/${i}`, t.id);
      });
      break;
    }
    case 'er': {
      list(ir, 'entities').forEach((e, i) => {
        if (e.ref) use('entity.ref', `/entities/${i}`, e.id);
        (e.attributes ?? []).forEach((a, j) => {
          if (a.key === 'pk' || a.key === 'fk') use(`attribute.key.${a.key}`, `/entities/${i}/attributes/${j}`, e.id);
          if (a.comment) use('attribute.comment', `/entities/${i}/attributes/${j}`, e.id);
        });
      });
      list(ir, 'relations').forEach((r, i) => {
        use(`relation.cardinality.${r.fromCardinality}`, `/relations/${i}`, r.id);
        use(`relation.cardinality.${r.toCardinality}`, `/relations/${i}`, r.id);
        if (r.identifying === false) use('relation.nonIdentifying', `/relations/${i}`, r.id);
      });
      break;
    }
    case 'class': {
      list(ir, 'classes').forEach((c, i) => {
        if (c.stereotype) use('stereotype', `/classes/${i}`, c.id);
        if (c.ref) use('class.ref', `/classes/${i}`, c.id);
        if ((c.attributes ?? []).some((a) => a.visibility) || (c.methods ?? []).some((m) => m.visibility)) use('member.visibility', `/classes/${i}`, c.id);
        if ((c.methods ?? []).some((m) => m.params)) use('method.params', `/classes/${i}`, c.id);
      });
      list(ir, 'relations').forEach((r, i) => {
        use(`relation.kind.${r.kind}`, `/relations/${i}`, r.id);
        if (r.fromCardinality || r.toCardinality) use('relation.cardinality', `/relations/${i}`, r.id);
      });
      break;
    }
    case 'architecture': {
      list(ir, 'components').forEach((c, i) => { use(`component.kind.${c.kind ?? 'service'}`, `/components/${i}`, c.id); if (c.ref) use('component.ref', `/components/${i}`, c.id); });
      const boundaries = list(ir, 'boundaries');
      const boundaryIds = new Set(boundaries.map((b) => b.id));
      boundaries.forEach((b, i) => {
        use('boundary', `/boundaries/${i}`, b.id);
        if ((b.children ?? []).some((c) => boundaryIds.has(c))) use('boundary.nested', `/boundaries/${i}`, b.id);
      });
      list(ir, 'connections').forEach((c, i) => {
        if (c.label) use('connection.label', `/connections/${i}`, c.id);
        if (c.bidirectional) use('connection.bidirectional', `/connections/${i}`, c.id);
      });
      break;
    }
    case 'activity': {
      list(ir, 'lanes').forEach((l, i) => use('lane', `/lanes/${i}`, l.id));
      list(ir, 'actions').forEach((a, i) => { if (a.ref) use('action.ref', `/actions/${i}`, a.id); });
      list(ir, 'controls').forEach((c, i) => use(`control.kind.${c.kind}`, `/controls/${i}`, c.id));
      list(ir, 'flows').forEach((f, i) => { if (f.guard) use('flow.guard', `/flows/${i}`, f.id); });
      break;
    }
    default:
      break;
  }
  return out;
}

function cell(entry, target) {
  const v = entry?.[target];
  if (v === undefined) return undefined;
  return typeof v === 'string' ? { status: v } : v;
}

/**
 * Check an IR against one target column of the matrix.
 * @returns {{ ok: boolean, errors: Array<{path:string,message:string,hint?:string}>, warnings: Array<{path:string,feature:string,message:string}> }}
 */
export function checkFeatureMatrix(ir, target) {
  const errors = [];
  const warnings = [];
  if (!TARGETS.includes(target)) {
    return { ok: false, errors: [{ path: '/', message: `unknown target "${target}"`, hint: `targets: ${TARGETS.join(', ')}` }], warnings };
  }
  const kindEntry = matrix.kinds[ir.kind];
  if (!kindEntry) {
    return { ok: false, errors: [{ path: '/kind', message: `kind "${ir.kind}" is not in the feature matrix` }], warnings };
  }
  const kindCell = cell(kindEntry.kind, target);
  if (!kindCell || kindCell.status === 'unsupported') {
    return {
      ok: false,
      errors: [{ path: '/kind', message: `kind "${ir.kind}" is unsupported on target "${target}"${kindCell?.note ? `: ${kindCell.note}` : ''}`, hint: 'choose another target with --to' }],
      warnings,
    };
  }
  if (kindCell.status === 'degraded') {
    warnings.push({ path: '/kind', feature: 'kind', message: `kind "${ir.kind}" is degraded on target "${target}": ${kindCell.note ?? 'see the feature matrix'}` });
  }
  for (const { feature, path, elementId } of enumerateFeatures(ir)) {
    const c = cell(kindEntry.features[feature], target);
    const who = elementId ? `"${elementId}"` : path;
    if (!c) {
      errors.push({ path, message: `feature "${feature}" used by ${who} has no entry for target "${target}" in the feature matrix`, hint: 'this is a bug in the skill; report it' });
      continue;
    }
    if (c.status === 'unsupported') {
      errors.push({ path, message: `${who} uses "${feature}", which is unsupported on target "${target}"${c.note ? `: ${c.note}` : ''}`, hint: 'change the element or choose another target with --to' });
    } else if (c.status === 'degraded') {
      warnings.push({ path, feature, message: `${who} uses "${feature}", degraded on target "${target}": ${c.note ?? 'see the feature matrix'}` });
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}
