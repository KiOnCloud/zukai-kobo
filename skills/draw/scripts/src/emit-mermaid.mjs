import { sameText } from './text-metrics.mjs';
import { noteRows, labelRowsBefore } from './figjam-overlay.mjs';
import { encodeLabel, encodeInline, encodeMember, identifierToken, architectureLabel, figjamLabel, safeIds, frontMatter } from './mermaid-text.mjs';

/**
 * Emit Mermaid text from a validated IR. Deterministic: input order is preserved, nothing is
 * sorted, output lines end with "\n" only. Degradations that the feature matrix declares are
 * applied here; the matrix checker owns their warnings. This emitter only warns about label
 * text it had to alter for a syntax that accepts no encoding.
 *
 * Profiles: `mermaid` (default) writes standard Mermaid 12 text with a front matter title
 * (swimlane-beta takes none: the renderer draws it over the lane headers). `figjam` writes
 * the subset Figma's generate_diagram accepts: no front matter, labels with no entity codes,
 * HTML or line breaks, a sequence note written as a message of its participant to itself (the
 * row the overlay script of figjam-overlay.mjs draws the note into), architecture rendered as
 * a flowchart with boundaries as subgraphs.
 * @param {object} ir validated IR
 * @param {{ profile?: 'mermaid' | 'figjam', stable?: boolean, refs?: Map<string, { title: string }> }} [options] `stable` renders activity
 *   diagrams as a plain flowchart instead of swimlane-beta, and leaves out the syntax that
 *   needs Mermaid 11 (typed sequence participants, the erDiagram direction line); `refs` is
 *   the ref table of a bundle, set only when the text goes into a combined file
 * @returns {{ output: string, warnings: Array<{ path: string, message: string }> }}
 */
export function emitMermaid(ir, options = {}) {
  const profile = options.profile ?? 'mermaid';
  const warnings = [];
  const lines = [];
  const emit = (line) => lines.push(line);
  const t = textHelpers(profile, warnings);
  // Inside a bundle a `ref` shows the target diagram's title; alone it shows the slug.
  t.refText = (ref, path) => {
    const target = options.refs?.get(ref);
    if (target) return `↳ ${target.title}`;
    if (options.refs) warnings.push({ path, message: `ref "${ref}" is not in this bundle: the step shows the slug`, hint: 'bundle the referenced diagram too, or fix the ref' });
    return `↳ ${ref}`;
  };
  // An element that a sub-diagram details shows that diagram on a second label line (FigJam
  // labels have no line break, so there it follows on the same line).
  // A part titled exactly like the element it details adds nothing: the element keeps its one line.
  t.repeats = (ref, own) => ref !== undefined && own !== undefined && options.refs?.get(ref) !== undefined && sameText(options.refs.get(ref).title, own);
  t.withRef = (text, ref, path, own) => (ref && !t.repeats(ref, own) ? `${text}${profile === 'figjam' ? ' ' : '<br/>'}${t.label(t.refText(ref, path))}` : text);
  switch (ir.kind) {
    case 'flowchart': emitFlowchart(ir, emit, t); break;
    case 'sequence': emitSequence(ir, emit, t, options.stable === true); break;
    case 'state': emitState(ir, emit, t); break;
    case 'er': emitEr(ir, emit, t, options.stable === true); break;
    case 'class': emitClass(ir, emit, t); break;
    case 'architecture': {
      // architecture-beta places services by the sides its edges name; a graph the grid planner
      // cannot place consistently is emitted as a flowchart instead of a broken picture.
      const plan = profile === 'figjam' ? null : planArchitectureGrid(ir);
      // architecture-beta sizes a group frame by the unwrapped label of each member, so a
      // long name (a `ref` adds the part's title to it) stretches the frame over its
      // neighbours. Past the length that still fits its grid cell the flowchart form is used.
      if (plan && !plan.fallback && (ir.boundaries ?? []).length > 0) {
        const shown = (c) => (c.ref && !t.repeats(c.ref, c.label) ? `${c.label} ${options.refs?.get(c.ref) ? `↳ ${options.refs.get(c.ref).title}` : `↳ ${c.ref}`}` : c.label);
        const units = (text) => [...text].reduce((n, ch) => n + (/[\u1100-\uffdc]/.test(ch) ? 2 : 1), 0);
        const long = ir.components.find((c) => units(shown(c)) > ARCH_LABEL_MAX);
        if (long) plan.fallback = `the label of "${long.id}"${shown(long) === long.label ? '' : ', with the line its ref adds,'} is longer than ${ARCH_LABEL_MAX} characters, which stretches the frame of its boundary over its neighbours`;
      }
      // Without a boundary a long label only wraps, but architecture-beta wraps by width alone:
      // a word longer than a line (the slug a `ref` shows outside a bundle) is cut inside. That
      // cannot be steered from the text, so it is reported.
      if (plan && !plan.fallback) {
        const units = (text) => [...text].reduce((n, ch) => n + (/[\u1100-\uffdc]/.test(ch) ? 2 : 1), 0);
        // The form stays (a bundle shows the part's title there, which wraps at its words); the
        // reader is told, once for every slug it happens to.
        ir.components.forEach((c, k) => {
          if (!c.ref || options.refs?.get(c.ref) || units(c.ref) <= ARCH_LABEL_MAX) return;
          // Reported at the component: it is about how its label is drawn, not about the ref, which is sound.
          warnings.push({ path: `/components/${k}`, message: `layout: architecture-beta breaks a label by width, so the slug "${c.ref}" on "${c.id}" is cut inside a word`, hint: 'a combined file that holds the part shows its title instead of the slug; for a single file use --to drawio, or a shorter slug' });
        });
      }
      if (profile === 'figjam' || plan.fallback) {
        if (plan?.fallback) warnings.push({ path: '/connections', fallback: 'flowchart', message: `layout: architecture-beta cannot place this diagram without overlaps (${plan.fallback}); emitted as a flowchart with boundaries as subgraphs, or use --to drawio` });
        emitArchitectureAsFlowchart(ir, emit, t);
      } else {
        emitArchitecture(ir, emit, t, plan);
      }
      break;
    }
    case 'activity': emitActivity(ir, emit, t, options.stable === true, options.refs !== undefined); break;
    default: throw new Error(`unknown kind "${ir.kind}"`);
  }
  // swimlane-beta puts its lane header row where Mermaid draws a front-matter title, so the
  // two overlap; that form goes out without a title (emitActivity reports it).
  const swimlane = ir.kind === 'activity' && options.stable !== true;
  const head = profile === 'figjam' || swimlane ? '' : frontMatter(ir.title);
  return { output: head + lines.join('\n') + '\n', warnings };
}

/** Label encoders for the active profile; the figjam profile records altered labels. */
function textHelpers(profile, warnings) {
  if (profile !== 'figjam') return { profile, label: encodeLabel, inline: encodeInline, member: encodeMember, warnings };
  const plain = (text, path) => {
    const r = figjamLabel(text);
    if (r.altered && path) warnings.push({ path, message: `label "${String(text).slice(0, 40)}" contains characters FigJam cannot show (quotes, markup, line breaks); written as "${r.label}"` });
    return r.label;
  };
  return { profile, label: plain, inline: plain, member: plain, warnings };
}

const idComment = (indent, id) => `${indent}%% id: ${id}`;

function emitFlowchart(ir, emit, t) {
  const ids = safeIds();
  const direction = ir.direction ?? 'TB';
  emit(`flowchart ${direction}`);
  for (const n of ir.nodes) ids.add(n.id);
  const groups = ir.groups ?? [];
  for (const g of groups) ids.add(g.id);
  const parent = new Map();
  for (const g of groups) for (const c of g.children) parent.set(c, g.id);
  const nodeById = new Map(ir.nodes.map((n) => [n.id, n]));
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const pathOf = new Map(ir.nodes.map((n, i) => [n.id, `/nodes/${i}/label`]));
  const refPathOf = new Map(ir.nodes.map((n, i) => [n.id, `/nodes/${i}/ref`]));

  const nodeLine = (n) => {
    const id = ids.get(n.id);
    const text = t.withRef(t.label(n.label, pathOf.get(n.id)), n.ref, refPathOf.get(n.id), n.label);
    const label = `"${text}"`;
    if (n.ref) return `${id}[[${label}]]`;
    switch (n.shape ?? 'process') {
      case 'decision': return `${id}{${label}}`;
      case 'terminal': return `${id}([${label}])`;
      case 'io': return `${id}[/${label}/]`;
      case 'subroutine': return `${id}[[${label}]]`;
      case 'note': return `${id}>${label}]`;
      default: return `${id}[${label}]`;
    }
  };

  const emitGroup = (g, indent) => {
    emit(idComment(indent, g.id));
    emit(`${indent}subgraph ${ids.get(g.id)}["${t.label(g.label, `/groups/${groups.indexOf(g)}/label`)}"]`);
    for (const c of g.children) {
      if (groupById.has(c)) emitGroup(groupById.get(c), indent + '  ');
      else {
        emit(idComment(indent + '  ', c));
        emit(`${indent}  ${nodeLine(nodeById.get(c))}`);
      }
    }
    emit(`${indent}end`);
  };

  for (const n of ir.nodes) {
    if (parent.has(n.id)) continue;
    emit(idComment('  ', n.id));
    emit(`  ${nodeLine(n)}`);
  }
  for (const g of groups) {
    if (parent.has(g.id)) continue;
    emitGroup(g, '  ');
  }
  ir.edges.forEach((e, i) => {
    emit(idComment('  ', e.id));
    const arrow = e.label ? `-->|"${t.label(e.label, `/edges/${i}/label`)}"|` : '-->';
    emit(`  ${ids.get(e.from)} ${arrow} ${ids.get(e.to)}`);
  });
}

const MESSAGE_ARROW = { sync: '->>', async: '-)', return: '-->>' };

const PARTICIPANT_TYPES = new Set(['boundary', 'control', 'entity', 'database']);

function emitSequence(ir, emit, t, stable) {
  const ids = safeIds();
  emit('sequenceDiagram');
  ir.participants.forEach((p, i) => {
    ids.add(p.id);
    emit(idComment('  ', p.id));
    const keyword = p.kind === 'actor' ? 'actor' : 'participant';
    // Mermaid 11.x draws UML boundary, control, entity and database participants through the
    // `@{ "type": ... }` form; older renderers (and the figjam profile) get the plain form.
    const typed = !stable && t.profile !== 'figjam' && PARTICIPANT_TYPES.has(p.kind);
    const head = typed ? `${ids.get(p.id)}@{ "type" : "${p.kind}" }` : ids.get(p.id);
    emit(`  ${keyword} ${head} as ${t.label(p.label, `/participants/${i}/label`)}`);
  });
  const order = new Map(ir.messages.map((m, i) => [m.id, i]));
  const notes = ir.notes ?? [];
  // An empty row of the figjam text: a message of the first participant to itself, which Figma leaves blank.
  const padLine = (indent) => `${indent}${ids.get(ir.participants[0].id)}->>${ids.get(ir.participants[0].id)}: …`;
  const labelRows = t.profile === 'figjam' ? labelRowsBefore(ir) : [];
  const noteLine = (indent, n, i) => {
    // Figma drops Note statements and gives them no room. A message of the first participant
    // to itself keeps a row free, into which the overlay script draws the note
    // (figjam-overlay.mjs); a long note keeps as many rows as its text needs.
    if (t.profile === 'figjam') {
      const who = ids.get(n.participants[0]);
      return [`${indent}${who}->>${who}: ${t.label(n.label, `/notes/${i}/label`)}`, ...Array.from({ length: noteRows(ir, n) - 1 }, () => padLine(indent))].join('\n');
    }
    const who = n.participants.map((p) => ids.get(p)).join(',');
    const position = n.participants.length === 2 ? 'over' : (n.position ?? 'right');
    const where = position === 'over' ? `over ${who}` : `${position} of ${who}`;
    return `${indent}Note ${where}: ${t.label(n.label, `/notes/${i}/label`)}`;
  };
  notes.forEach((n, i) => {
    if (n.after === undefined) {
      emit(idComment('  ', n.id));
      emit(noteLine('  ', n, i));
    }
  });

  // Block ranges from message ids; validation guarantees contiguity and proper nesting.
  const blocks = (ir.blocks ?? []).map((b, i) => {
    const sections = [{ label: b.label, ids: b.messages, path: `/blocks/${i}/label` }, ...(b.branches ?? []).map((br, j) => ({ label: br.label, ids: br.messages, path: `/blocks/${i}/branches/${j}/label` }))]
      .map((s) => {
        const idx = s.ids.map((id) => order.get(id));
        return { label: s.label, path: s.path, start: Math.min(...idx), end: Math.max(...idx) };
      });
    return { ...b, index: i, sections, start: sections[0].start, end: sections[sections.length - 1].end };
  });
  const span = (b) => b.end - b.start;
  const outerFirst = (a, b) => span(b) - span(a) || a.index - b.index;
  const keyword = { alt: 'alt', opt: 'opt', loop: 'loop', par: 'par' };
  const separator = { alt: 'else', par: 'and' };

  let depth = 0;
  const indent = () => '  '.repeat(depth + 1);
  ir.messages.forEach((m, i) => {
    for (const b of [...blocks].sort(outerFirst)) {
      const k = b.sections.findIndex((s, si) => si > 0 && s.start === i);
      if (k > 0) emit(`${'  '.repeat(depth)}${separator[b.kind]} ${t.label(b.sections[k].label, b.sections[k].path)}`);
    }
    for (const b of blocks.filter((x) => x.start === i).sort(outerFirst)) {
      emit(idComment(indent(), b.id));
      emit(`${indent()}${keyword[b.kind]} ${t.label(b.sections[0].label, b.sections[0].path)}`);
      depth++;
    }
    // The label of a block inside another block has no room above its first message.
    for (let k = 0; k < (labelRows[i] ?? 0); k++) emit(padLine(indent()));
    emit(idComment(indent(), m.id));
    emit(`${indent()}${ids.get(m.from)}${MESSAGE_ARROW[m.kind ?? 'sync']}${ids.get(m.to)}: ${t.withRef(t.label(m.label, `/messages/${i}/label`), m.ref, `/messages/${i}/ref`, m.label)}`);
    notes.forEach((n, ni) => {
      if (n.after === m.id) {
        emit(idComment(indent(), n.id));
        emit(noteLine(indent(), n, ni));
      }
    });
    // Innermost block first; a note that follows a block is written after its `end`, so it
    // stands below the frame instead of inside its last branch.
    for (const b of blocks.filter((x) => x.end === i).sort((a, c) => outerFirst(c, a))) {
      depth--;
      emit(`${indent()}end`);
      notes.forEach((n, ni) => {
        if (n.after === b.id) {
          emit(idComment(indent(), n.id));
          emit(noteLine(indent(), n, ni));
        }
      });
    }
  });
}

function emitState(ir, emit, t) {
  const ids = safeIds();
  emit('stateDiagram-v2');
  if (ir.direction) emit(`  direction ${ir.direction}`);
  const states = ir.states;
  const byId = new Map(states.map((s) => [s.id, s]));
  const pathOf = new Map(states.map((s, i) => [s.id, `/states/${i}/label`]));
  const text = (s) => t.withRef(t.label(s.label, pathOf.get(s.id)), s.ref, pathOf.get(s.id).replace(/label$/, 'ref'), s.label);
  for (const s of states) ids.add(s.id);
  const kindOf = (id) => byId.get(id)?.kind ?? 'simple';
  const parentOf = new Map();
  for (const s of states) if (kindOf(s.id) === 'composite') for (const c of s.children ?? []) parentOf.set(c, s.id);
  const depthOf = (id) => {
    let d = 0;
    let cur = parentOf.get(id);
    while (cur !== undefined) { d++; cur = parentOf.get(cur); }
    return d;
  };
  // Degradation declared in the matrix: composites nested deeper than two levels are flattened.
  // A composite at depth >= 2 becomes a simple state and its children move up to its parent.
  const flattened = new Set();
  for (const s of states) if (kindOf(s.id) === 'composite' && depthOf(s.id) >= 2) flattened.add(s.id);
  const effectiveParent = new Map();
  for (const s of states) {
    let p = parentOf.get(s.id);
    while (p !== undefined && flattened.has(p)) p = parentOf.get(p);
    if (p !== undefined) effectiveParent.set(s.id, p);
  }
  for (const id of flattened) {
    t.warnings.push({ path: `/states/${states.findIndex((s) => s.id === id)}`, message: `composite state "${id}" is nested deeper than two levels; emitted as a simple state and its children moved to "${effectiveParent.get(id) ?? 'top level'}"` });
  }
  const childrenOf = (pid) => states.filter((s) => effectiveParent.get(s.id) === pid).map((s) => s.id);
  const isComposite = (id) => kindOf(id) === 'composite' && !flattened.has(id);
  const scopeOf = (id) => effectiveParent.get(id);
  const ancestors = (id) => {
    const out = [];
    let cur = scopeOf(id);
    while (cur !== undefined) { out.push(cur); cur = scopeOf(cur); }
    return out;
  };
  const transitionScope = (tr) => {
    const fk = kindOf(tr.from);
    const tk = kindOf(tr.to);
    if (fk === 'initial' || fk === 'final') return scopeOf(tr.from);
    if (tk === 'initial' || tk === 'final') return scopeOf(tr.to);
    const sa = scopeOf(tr.from);
    const sb = scopeOf(tr.to);
    if (sa === sb) return sa;
    if (sa === undefined || sb === undefined) return undefined;
    if (ancestors(tr.from).includes(sb)) return sb;
    if (ancestors(tr.to).includes(sa)) return sa;
    const ancB = new Set(ancestors(tr.to));
    return ancestors(tr.from).find((x) => ancB.has(x));
  };
  const ref = (id) => (kindOf(id) === 'initial' || kindOf(id) === 'final' ? '[*]' : ids.get(id));
  const transitionLabel = (tr, i) => {
    const parts = [];
    if (tr.event) parts.push(t.inline(tr.event, `/transitions/${i}/event`));
    if (tr.guard) parts.push(`[${t.inline(tr.guard, `/transitions/${i}/guard`)}]`);
    const head = parts.join(' ');
    const action = tr.action ? ` / ${t.inline(tr.action, `/transitions/${i}/action`)}` : '';
    const text = `${head}${action}`.trim();
    return text ? ` : ${text}` : '';
  };

  const emitScope = (scope, indent) => {
    const members = scope === undefined ? states.filter((s) => scopeOf(s.id) === undefined).map((s) => s.id) : childrenOf(scope);
    for (const id of members) {
      const s = byId.get(id);
      const kind = kindOf(id);
      if (kind === 'initial' || kind === 'final') continue; // rendered as [*] by their transitions
      emit(idComment(indent, id));
      if (isComposite(id)) {
        // Figma reads `state "Label" as id {` as a composite named "Label as id" and draws a
        // second, plain state called by the id; the label and the body go on two lines there.
        if (t.profile === 'figjam') {
          emit(`${indent}state "${text(s)}" as ${ids.get(id)}`);
          emit(`${indent}state ${ids.get(id)} {`);
        } else emit(`${indent}state "${text(s)}" as ${ids.get(id)} {`);
        emitScope(id, indent + '  ');
        emit(`${indent}}`);
      } else {
        emit(`${indent}state "${text(s)}" as ${ids.get(id)}`);
      }
    }
    ir.transitions.forEach((tr, i) => {
      if (transitionScope(tr) !== scope) return;
      emit(idComment(indent, tr.id));
      emit(`${indent}${ref(tr.from)} --> ${ref(tr.to)}${transitionLabel(tr, i)}`);
    });
  };
  emitScope(undefined, '  ');
}

const ER_LEFT = { one: '||', 'zero-one': '|o', many: '}o', 'one-many': '}|' };
const ER_RIGHT = { one: '||', 'zero-one': 'o|', many: 'o{', 'one-many': '|{' };

function emitEr(ir, emit, t, stable) {
  const ids = safeIds();
  emit('erDiagram');
  // erDiagram reads a direction line in current Mermaid and in Figma; the stable form is not
  // known to, and there the default top-to-bottom layout stands in for another one. Figma
  // lays an erDiagram out left to right unless told, so the figjam text always says it.
  if (t.profile === 'figjam') emit(`  direction ${ir.direction ?? 'TB'}`);
  else if (ir.direction) {
    if (!stable) emit(`  direction ${ir.direction}`);
    else if (ir.direction !== 'TB') t.warnings.push({ path: '/direction', message: `direction "${ir.direction}" is not written for the stable Mermaid form: the erDiagram direction line needs a current Mermaid renderer, so the diagram is laid out top to bottom` });
  }
  ir.entities.forEach((e, i) => {
    ids.add(e.id);
    emit(idComment('  ', e.id));
    const head = `  ${ids.get(e.id)}["${t.withRef(t.label(e.label, `/entities/${i}/label`), e.ref, `/entities/${i}/ref`, e.label)}"]`;
    const attrs = e.attributes ?? [];
    if (attrs.length === 0) {
      emit(head);
      return;
    }
    emit(`${head} {`);
    attrs.forEach((a, j) => {
      // Figma's erDiagram parser stops at a comma inside a type ("decimal(10,2)") and rejects the
      // whole diagram. The type keeps its name there and the full type goes to the comment column.
      const split = t.profile === 'figjam' && String(a.type).includes(',');
      const type = split ? identifierToken(String(a.type).replace(/[(<\[].*$/s, '')) : identifierToken(a.type, '()\\[\\],~');
      const name = identifierToken(a.name);
      if (split) t.warnings.push({ path: `/entities/${i}/attributes/${j}/type`, message: `attribute type "${a.type}" of "${e.id}" has a comma, which FigJam cannot read in a type; written as "${type.token}" with the full type in the comment column` });
      else if (type.altered) t.warnings.push({ path: `/entities/${i}/attributes/${j}/type`, message: `attribute type "${a.type}" of "${e.id}" was rewritten as "${type.token}" for erDiagram syntax` });
      if (name.altered) t.warnings.push({ path: `/entities/${i}/attributes/${j}/name`, message: `attribute name "${a.name}" of "${e.id}" was rewritten as "${name.token}" for erDiagram syntax` });
      const key = a.key === 'pk' ? ' PK' : a.key === 'fk' ? ' FK' : '';
      const said = [split ? t.inline(a.type) : '', a.comment ? t.inline(a.comment, `/entities/${i}/attributes/${j}/comment`) : ''].filter(Boolean).join(' - ');
      const comment = said ? ` "${said}"` : '';
      emit(`    ${type.token} ${name.token}${key}${comment}`);
    });
    emit('  }');
  });
  ir.relations.forEach((r, i) => {
    emit(idComment('  ', r.id));
    const link = r.identifying === false ? '..' : '--';
    // Figma takes an empty label and draws none, as draw.io does; the label encoder would name it "unnamed".
    const label = t.profile === 'figjam' && !(r.label ?? '').trim() ? '' : t.inline(r.label ?? '', `/relations/${i}/label`);
    emit(`  ${ids.get(r.from)} ${ER_LEFT[r.fromCardinality]}${link}${ER_RIGHT[r.toCardinality]} ${ids.get(r.to)} : "${label}"`);
  });
}

const VISIBILITY = { public: '+', private: '-', protected: '#', package: '~' };

function emitClass(ir, emit, t) {
  const ids = safeIds();
  emit('classDiagram');
  if (ir.direction) emit(`  direction ${ir.direction}`);
  ir.classes.forEach((c, i) => {
    ids.add(c.id);
    emit(idComment('  ', c.id));
    const head = `  class ${ids.get(c.id)}["${t.withRef(t.label(c.label, `/classes/${i}/label`), c.ref, `/classes/${i}/ref`, c.label)}"]`;
    const members = [];
    if (c.stereotype) {
      const st = identifierToken(c.stereotype, '-');
      if (st.altered) t.warnings.push({ path: `/classes/${i}/stereotype`, message: `stereotype "${c.stereotype}" of "${c.id}" was rewritten as "${st.token}" for classDiagram syntax` });
      members.push(`<<${st.token}>>`);
    }
    (c.attributes ?? []).forEach((a, j) => {
      const vis = a.visibility ? VISIBILITY[a.visibility] : '';
      members.push(`${vis}${a.type ? `${t.member(a.type, `/classes/${i}/attributes/${j}/type`)} ` : ''}${t.member(a.name, `/classes/${i}/attributes/${j}/name`)}`);
    });
    (c.methods ?? []).forEach((m, j) => {
      const vis = m.visibility ? VISIBILITY[m.visibility] : '';
      const p = `/classes/${i}/methods/${j}`;
      members.push(`${vis}${t.member(m.name, `${p}/name`)}(${m.params ? t.member(m.params, `${p}/params`) : ''})${m.returns ? ` ${t.member(m.returns, `${p}/returns`)}` : ''}`);
    });
    if (members.length === 0) {
      emit(head);
      return;
    }
    emit(`${head} {`);
    for (const line of members) emit(`    ${line}`);
    emit('  }');
  });
  ir.relations.forEach((r, i) => {
    emit(idComment('  ', r.id));
    const card = (v, field) => (v ? ` "${t.inline(v, `/relations/${i}/${field}`)}"` : '');
    const label = r.label ? ` : ${t.inline(r.label, `/relations/${i}/label`)}` : '';
    const from = ids.get(r.from);
    const to = ids.get(r.to);
    const fc = card(r.fromCardinality, 'fromCardinality');
    const tc = card(r.toCardinality, 'toCardinality');
    switch (r.kind) {
      case 'inheritance': emit(`  ${to}${tc} <|--${fc} ${from}${label}`); break;
      case 'realization': emit(`  ${to}${tc} <|..${fc} ${from}${label}`); break;
      case 'composition': emit(`  ${from}${fc} *--${tc} ${to}${label}`); break;
      case 'aggregation': emit(`  ${from}${fc} o--${tc} ${to}${label}`); break;
      case 'dependency': emit(`  ${from}${fc} ..>${tc} ${to}${label}`); break;
      default: emit(`  ${from}${fc} -->${tc} ${to}${label}`); break;
    }
  });
}

/** The longest component label (in half-width characters) whose group frame still stays inside its grid cell. */
const ARCH_LABEL_MAX = 16;
const ARCH_ICON = { service: 'server', database: 'database', queue: 'server', cache: 'server', client: 'internet', external: 'cloud' };
/** Neighbour cells per direction, preferred first: along the flow, across it, then backwards. */
const ARCH_STEPS = {
  TB: [[0, 1], [1, 0], [-1, 0], [0, -1]],
  BT: [[0, -1], [1, 0], [-1, 0], [0, 1]],
  LR: [[1, 0], [0, 1], [0, -1], [-1, 0]],
  RL: [[-1, 0], [0, 1], [0, -1], [1, 0]],
};

/**
 * Place every component on a grid so that connected components are neighbours where they
 * can be, then derive each connection's side pair from the cells. In architecture-beta a
 * side pair is a placement constraint (`a:R --> L:b` puts b right of a, aligned), so every
 * pair must agree with the grid or the renderer stretches the picture. Two cases cannot be
 * drawn that way and make the caller fall back to a flowchart: a connection whose straight
 * line in the grid runs through another cell, and a boundary whose grid box would contain a
 * component that is not in it.
 * @returns {{ cells: Map<string,[number,number]>, sides: Map<string,[string,string]>, fallback?: string }}
 */
export function planArchitectureGrid(ir) {
  const steps = ARCH_STEPS[ir.direction ?? 'TB'];
  const cells = new Map();
  const taken = new Set();
  const key = (c) => `${c[0]},${c[1]}`;
  const place = (id, cell) => { cells.set(id, cell); taken.add(key(cell)); };
  const ring = (c, r) => {
    const out = [];
    for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) if (Math.max(Math.abs(dx), Math.abs(dy)) === r) out.push([c[0] + dx, c[1] + dy]);
    return out;
  };
  const near = (anchor, reverse) => {
    const first = steps.map(([dx, dy]) => (reverse ? [anchor[0] - dx, anchor[1] - dy] : [anchor[0] + dx, anchor[1] + dy]));
    const diagonals = [[1, 1], [-1, 1], [1, -1], [-1, -1]].map(([dx, dy]) => [anchor[0] + dx, anchor[1] + dy]);
    const candidates = [...first, ...diagonals, ...ring(anchor, 2), ...ring(anchor, 3)];
    const free = candidates.find((c) => !taken.has(key(c)));
    if (free) return free;
    // A hub with more neighbours than the 48 cells around it: keep widening the ring, which
    // always ends at a free cell. Such a graph falls back to the flowchart form anyway.
    for (let r = 4; ; r++) {
      const cell = ring(anchor, r).find((c) => !taken.has(key(c)));
      if (cell) return cell;
    }
  };
  for (const c of ir.connections) {
    if (!cells.has(c.from) && !cells.has(c.to)) place(c.from, cells.size === 0 ? [0, 0] : near([0, 0], false) ?? [cells.size, 0]);
    if (!cells.has(c.to)) place(c.to, near(cells.get(c.from), false));
    else if (!cells.has(c.from)) place(c.from, near(cells.get(c.to), true));
  }
  for (const comp of ir.components) if (!cells.has(comp.id)) place(comp.id, near([0, 0], false) ?? [cells.size, 0]);

  // Sides from the cells; a straight line through an occupied cell cannot be drawn.
  const sides = new Map();
  for (const c of ir.connections) {
    const a = cells.get(c.from);
    const b = cells.get(c.to);
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const stepX = Math.sign(dx);
    const stepY = Math.sign(dy);
    if (dx === 0 && dy === 0) return { cells, sides, fallback: `"${c.from}" connects to itself` };
    if ((dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy))) {
      for (let k = 1; k < Math.max(Math.abs(dx), Math.abs(dy)); k++) {
        if (taken.has(key([a[0] + k * stepX, a[1] + k * stepY]))) return { cells, sides, fallback: `the line from "${c.from}" to "${c.to}" would pass through another component` };
      }
    }
    // A side pair aligns the two services on a row or a column; a diagonal pair has no such
    // pair (mixed sides were tried and render unpredictably), so it cannot be drawn.
    if (dx !== 0 && dy !== 0) return { cells, sides, fallback: `"${c.from}" and "${c.to}" would need a diagonal connection` };
    sides.set(c.id, dx !== 0 ? (dx > 0 ? ['R', 'L'] : ['L', 'R']) : (dy > 0 ? ['B', 'T'] : ['T', 'B']));
  }
  // A boundary is drawn as the box around its members; nothing else may sit inside it.
  const members = (b, boundaries) => b.children.flatMap((ch) => { const inner = boundaries.find((x) => x.id === ch); return inner ? members(inner, boundaries) : [ch]; });
  for (const b of ir.boundaries ?? []) {
    const ms = members(b, ir.boundaries ?? []);
    const xs = ms.map((m) => cells.get(m)[0]);
    const ys = ms.map((m) => cells.get(m)[1]);
    const box = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
    for (const comp of ir.components) {
      if (ms.includes(comp.id)) continue;
      const [x, y] = cells.get(comp.id);
      if (x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1) return { cells, sides, fallback: `"${comp.id}" would be drawn inside boundary "${b.id}"` };
    }
  }
  return { cells, sides };
}

function emitArchitecture(ir, emit, t, plan) {
  const ids = safeIds();
  emit('architecture-beta');
  const boundaries = ir.boundaries ?? [];
  const parent = new Map();
  for (const b of boundaries) for (const c of b.children) parent.set(c, b.id);
  for (const b of boundaries) ids.add(b.id);
  for (const c of ir.components) ids.add(c.id);
  // architecture-beta labels are one plain line, so a ref follows the label on that line.
  const label = (el, path) => {
    const own = architectureLabel(el.label);
    if (own.altered) t.warnings.push({ path, message: `label of "${el.id}" contains characters architecture-beta cannot show; written as "${own.label}"` });
    if (!el.ref || t.repeats(el.ref, el.label)) return own.label;
    const refPath = path.replace(/label$/, 'ref');
    const title = architectureLabel(t.refText(el.ref, refPath));
    if (title.altered) t.warnings.push({ path: refPath, message: `the title that ref "${el.ref}" shows on "${el.id}" contains characters architecture-beta cannot show; written as "${title.label}"` });
    return `${own.label} ${title.label}`;
  };
  // Groups must be declared before they are referenced with "in": parents first.
  const emitted = new Set();
  const emitBoundary = (b, i) => {
    if (emitted.has(b.id)) return;
    const p = parent.get(b.id);
    if (p !== undefined) emitBoundary(boundaries.find((x) => x.id === p), boundaries.findIndex((x) => x.id === p));
    emitted.add(b.id);
    emit(idComment('  ', b.id));
    emit(`  group ${ids.get(b.id)}(cloud)[${label(b, `/boundaries/${i}/label`)}]${p !== undefined ? ` in ${ids.get(p)}` : ''}`);
  };
  boundaries.forEach(emitBoundary);
  ir.components.forEach((c, i) => {
    emit(idComment('  ', c.id));
    const p = parent.get(c.id);
    emit(`  service ${ids.get(c.id)}(${ARCH_ICON[c.kind ?? 'service']})[${label(c, `/components/${i}/label`)}]${p !== undefined ? ` in ${ids.get(p)}` : ''}`);
  });
  // Sides come from the grid plan, so every placement constraint agrees with one picture.
  for (const c of ir.connections) {
    emit(idComment('  ', c.id));
    const arrow = c.bidirectional ? '<-->' : '-->';
    const [fromSide, toSide] = plan.sides.get(c.id);
    emit(`  ${ids.get(c.from)}:${fromSide} ${arrow} ${toSide}:${ids.get(c.to)}`);
  }
}

/** architecture as a flowchart: component kinds become shapes, boundaries become subgraphs. */
function emitArchitectureAsFlowchart(ir, emit, t) {
  const shape = { service: (l) => `[${l}]`, database: (l) => `[(${l})]`, queue: (l) => `[[${l}]]`, cache: (l) => `([${l}])`, client: (l) => `((${l}))`, external: (l) => `>${l}]` };
  const boundaries = (ir.boundaries ?? []).map((b) => ({ id: b.id, label: b.label, children: b.children }));
  const flow = {
    ...ir,
    kind: 'flowchart',
    nodes: ir.components.map((c) => ({ id: c.id, label: c.label, shape: c.kind ?? 'service', ref: c.ref })),
    edges: ir.connections.map((c) => ({ id: c.id, from: c.from, to: c.to, label: c.label, bidirectional: c.bidirectional === true })),
    groups: boundaries,
  };
  const ids = safeIds();
  emit(`flowchart ${ir.direction ?? 'TB'}`);
  for (const n of flow.nodes) ids.add(n.id);
  for (const g of boundaries) ids.add(g.id);
  const parent = new Map();
  for (const g of boundaries) for (const c of g.children) parent.set(c, g.id);
  const nodeById = new Map(flow.nodes.map((n) => [n.id, n]));
  const groupById = new Map(boundaries.map((g) => [g.id, g]));
  const nodeLine = (n, i) => `${ids.get(n.id)}${shape[n.shape](`"${t.withRef(t.label(n.label, `/components/${i}/label`), n.ref, `/components/${i}/ref`, n.label)}"`)}`;
  const emitGroup = (g, indent) => {
    emit(idComment(indent, g.id));
    emit(`${indent}subgraph ${ids.get(g.id)}["${t.label(g.label, `/boundaries/${boundaries.indexOf(g)}/label`)}"]`);
    for (const c of g.children) {
      if (groupById.has(c)) emitGroup(groupById.get(c), indent + '  ');
      else {
        emit(idComment(indent + '  ', c));
        emit(`${indent}  ${nodeLine(nodeById.get(c), flow.nodes.indexOf(nodeById.get(c)))}`);
      }
    }
    emit(`${indent}end`);
  };
  flow.nodes.forEach((n, i) => {
    if (parent.has(n.id)) return;
    emit(idComment('  ', n.id));
    emit(`  ${nodeLine(n, i)}`);
  });
  for (const g of boundaries) if (!parent.has(g.id)) emitGroup(g, '  ');
  flow.edges.forEach((e, i) => {
    emit(idComment('  ', e.id));
    const head = e.bidirectional ? '<-->' : '-->';
    const arrow = e.label ? `${head}|"${t.label(e.label, `/connections/${i}/label`)}"|` : head;
    emit(`  ${ids.get(e.from)} ${arrow} ${ids.get(e.to)}`);
  });
}

/**
 * The control nodes of the stable activity form. A classic flowchart node has no shape for
 * them and takes its size from its label, so each is a plain shape with a label of blanks,
 * painted with a `style` line: nothing in it is a word, whatever the language of the diagram.
 * Initial is a filled circle. Final is a double circle filled black, whose white strokes
 * leave a ring between the dot and the rim. Fork and join are filled boxes as long as eight
 * em spaces across the flow: one line of them for a top-down diagram, three lines of one for
 * a left-to-right one. The subroutine box is the thinnest box Mermaid 10 to 12 draw.
 */
const BAR_ACROSS = '#emsp;'.repeat(8);
const BAR_UPRIGHT = ['#emsp;', '#emsp;', '#emsp;'].join('<br/>');
const FILLED = 'fill:#000,stroke:#000';
const BULLSEYE = 'fill:#000,stroke:#fff,stroke-width:3px';

/**
 * Activity diagrams. Mermaid has no UML activity diagram: the default form is swimlane-beta
 * (lanes as top-level subgraphs, fork and join bar shapes, start and end circles); the
 * stable form is a flowchart with subgraphs as lanes and painted control nodes, which loses
 * the lane semantics and the thin bars but renders on every Mermaid 10+ installation.
 */
function emitActivity(ir, emit, t, stable, bundled) {
  const ids = safeIds();
  const direction = ir.direction ?? 'TB';
  const controls = ir.controls ?? [];
  for (const l of ir.lanes) ids.add(l.id);
  for (const a of ir.actions) ids.add(a.id);
  for (const c of controls) ids.add(c.id);
  if (stable) {
    t.warnings.push({ path: '/kind', message: 'activity emitted in stable flowchart form: lanes are plain subgraphs, fork and join are filled boxes a line of text thick, initial is a filled circle and final a double circle, all without text; swimlane semantics are lost' });
    emit(`flowchart ${direction}`);
  } else {
    // Nothing is lost inside a bundle, where the heading above the block carries the title.
    if (!bundled) t.warnings.push({ path: '/title', message: 'the title is not written into the swimlane-beta text: Mermaid draws a front-matter title over the lane header row; the combined file shows it as the heading above the block, and --mermaid-stable or --to drawio draw it' });
    emit(`swimlane-beta ${direction}`);
  }
  const bar = direction === 'LR' || direction === 'RL' ? BAR_UPRIGHT : BAR_ACROSS;
  const controlLine = (c, i) => {
    const id = ids.get(c.id);
    const label = c.label ? t.label(c.label, `/controls/${i}/label`) : '';
    switch (c.kind) {
      case 'initial': return stable ? `${id}((" "))` : `${id}@{ shape: sm-circ }`;
      case 'final': return stable ? `${id}(((" ")))` : `${id}@{ shape: fr-circ }`;
      case 'fork': return stable ? `${id}[["${bar}"]]` : `${id}@{ shape: fork }`;
      case 'join': return stable ? `${id}[["${bar}"]]` : `${id}@{ shape: join }`;
      case 'merge': return `${id}{"${label || ' '}"}`;
      default: return `${id}{"${label || 'decision'}"}`;
    }
  };
  const members = (laneId) => {
    const out = [];
    ir.actions.forEach((a, i) => {
      if (a.lane !== laneId) return;
      const text = t.label(a.label, `/actions/${i}/label`);
      out.push({ id: a.id, line: a.ref ? `${ids.get(a.id)}[["${t.withRef(text, a.ref, `/actions/${i}/ref`, a.label)}"]]` : `${ids.get(a.id)}["${text}"]` });
    });
    controls.forEach((c, i) => { if ((c.lane ?? null) === laneId) out.push({ id: c.id, line: controlLine(c, i) }); });
    return out;
  };
  ir.lanes.forEach((l, i) => {
    emit(idComment('  ', l.id));
    emit(`  subgraph ${ids.get(l.id)}["${t.label(l.label, `/lanes/${i}/label`)}"]`);
    for (const m of members(l.id)) {
      emit(idComment('    ', m.id));
      emit(`    ${m.line}`);
    }
    emit('  end');
  });
  for (const m of members(null)) {
    emit(idComment('  ', m.id));
    emit(`  ${m.line}`);
  }
  ir.flows.forEach((f, i) => {
    emit(idComment('  ', f.id));
    const arrow = f.guard ? `-->|"${t.label(f.guard, `/flows/${i}/guard`)}"|` : '-->';
    emit(`  ${ids.get(f.from)} ${arrow} ${ids.get(f.to)}`);
  });
  if (stable) {
    // One statement per node: a list of ids in one `style` line is newer syntax.
    for (const c of controls) {
      if (c.kind === 'final') emit(`  style ${ids.get(c.id)} ${BULLSEYE}`);
      else if (c.kind === 'initial' || c.kind === 'fork' || c.kind === 'join') emit(`  style ${ids.get(c.id)} ${FILLED}`);
    }
  }
}
