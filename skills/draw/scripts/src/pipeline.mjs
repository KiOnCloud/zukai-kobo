import { validateIr } from './validate-ir.mjs';
import { checkFeatureMatrix, TARGETS } from './check-feature-matrix.mjs';
import { scanSecrets, DEFINITE_KINDS } from './scan-secrets.mjs';
import { checkModel } from './check-model.mjs';
import { checkDetail } from './check-detail.mjs';
import { emitMermaid } from './emit-mermaid.mjs';
import { figjamOverlay } from './figjam-overlay.mjs';
import { figjamNative } from './figjam-native.mjs';
import { emitDrawio, emitDrawioBundle, bundleRefs, slugify, pageIdOf } from './emit-drawio.mjs';
import { emitDoc, docBundle, DOC_LANGS } from './emit-doc.mjs';

export { TARGETS, DOC_LANGS };

/**
 * The description tables are a target of `emit` and `bundle` that stands beside the feature
 * matrix, not in it: a table lists every element in words, so there is no feature it could
 * degrade or refuse, and a column that said `supported` in every cell would decide nothing.
 */
export const DOC_TARGET = 'doc';
export const EMIT_TARGETS = [...TARGETS, DOC_TARGET];

/**
 * Validate an IR and emit it for one target. Order: schema and references, feature matrix
 * (not for `doc`, which shows every element), model and size, level of detail (both not for
 * `doc`, whose IRs the emit for a target already reported on), secret scan, emitter. Errors stop the pipeline; warnings accumulate across every stage.
 * @param {unknown} ir
 * @param {string} target
 * @param {{ allowSensitive?: boolean, mermaidStable?: boolean, diagramId?: string, native?: boolean, nativeOnly?: boolean, lang?: string, refs?: Map<string, { pageId: string, title: string }> }} [options]
 *   `refs` is set by `bundle` so a `ref` resolves to the target's title (and page link in draw.io).
 *   `lang` (doc only) is the language of the headings and column headers.
 *   `native` (figjam only) also makes the scripts that draw the board at the draw.io coordinates;
 *   a kind generate_diagram rejects is then emitted too, without the Mermaid text. With
 *   `nativeOnly` the text is not wanted at all, so its warnings are not returned.
 * @returns {Promise<{ ok: boolean, output?: string, overlay?: string, native?: string[], nativeData?: object[], nativeCreated?: number[], textSkipped?: string, errors: Array<object>, warnings: Array<object> }>}
 *   `overlay` is set for a FigJam sequence diagram that needs the overlay script; `nativeCreated`
 *   counts what each native script creates and `nativeData` holds its drawing; `native` holds
 *   the scripts for use_figma in the order to run them; `textSkipped` says why there is no `output`
 */
export async function emit(ir, target, options = {}) {
  const validation = validateIr(ir);
  if (!validation.ok) return { ok: false, errors: validation.errors, warnings: [] };

  const matrix = target === DOC_TARGET ? { ok: true, errors: [], warnings: [] } : checkFeatureMatrix(ir, target);
  const warnings = [...matrix.warnings.map((w) => ({ stage: 'feature-matrix', ...w }))];
  // The matrix speaks for generate_diagram. The native board is drawn from the draw.io layout,
  // so what generate_diagram rejects stops only the Mermaid text, not the emit.
  const native = target === 'figjam' && options.native === true;
  const textSkipped = native && !matrix.ok ? matrix.errors.map((e) => e.message).join('; ') : undefined;
  if (!matrix.ok && !native) return { ok: false, errors: matrix.errors, warnings };

  // The description tables are written beside the files of a target, from IRs whose emit for
  // that target has just said what the model and the level of detail still get wrong. Said
  // again by the tables, one warning would stand in the output of a run once per command.
  if (target !== DOC_TARGET) {
    warnings.push(...checkModel(ir).warnings.map((w) => ({ stage: 'model', ...w })));
    warnings.push(...checkDetail(ir).warnings.map((w) => ({ stage: 'detail', ...w })));
  }

  const secrets = scanSecrets(ir);
  warnings.push(...secrets.warnings.map((w) => ({ stage: 'secret-scan', ...w })));
  // FigJam labels leave the machine, so anything the scan finds blocks that emit. A local
  // file is the user's, so a guess is written with its warning; a credential by its form
  // is written nowhere. `allowSensitive` is the user's word that a finding is not a secret.
  const blocking = options.allowSensitive ? [] : secrets.warnings.filter((w) => target === 'figjam' || DEFINITE_KINDS.has(w.kind));
  if (blocking.length > 0) {
    return {
      ok: false,
      errors: blocking.map((w) => ({ path: w.path, message: `refusing to emit for ${target}: ${w.message}`, hint: w.kind === 'personal-data' ? `replace the value in the IR with a placeholder that names the role (${/telephone/.test(w.message) ? '<customer phone>' : '<customer e-mail>'}), or pass --allow-sensitive if it is not personal data` : 'replace the value in the IR with a placeholder such as <db password>, or pass --allow-sensitive if it is not a secret' })),
      warnings,
    };
  }

  let result;
  switch (target) {
    case 'mermaid':
      result = emitMermaid(ir, { stable: options.mermaidStable === true, refs: options.refs });
      break;
    case 'drawio':
      result = await emitDrawio(ir, { diagramId: options.diagramId, refs: options.refs });
      break;
    case 'figjam':
      if (textSkipped === undefined) {
        result = emitMermaid(ir, { profile: 'figjam' });
        // What generate_diagram cannot draw of a sequence diagram, as a script for use_figma.
        result.overlay = figjamOverlay(ir);
      } else result = { warnings: [] };
      if (native) {
        const drawn = await emitDrawio(ir, { diagramId: options.diagramId });
        const board = figjamNative(drawn.output, { title: ir.title });
        result.native = board.parts;
        result.nativeData = board.data;
        result.nativeCreated = board.created;
        result.nativeWarnings = drawn.warnings;
      }
      break;
    case DOC_TARGET:
      // Inside a bundle (`refs` set) the diagram is one section of the document.
      result = emitDoc(ir, { lang: options.lang, refs: options.refs, part: options.refs && options.diagramId ? { id: options.diagramId, source: options.sourcePath, anchor: options.refs.get(options.diagramId)?.pageId ?? pageIdOf(options.diagramId) } : undefined });
      if (result.errors) return { ok: false, errors: result.errors, warnings };
      break;
    default:
      return { ok: false, errors: [{ path: '/', message: `no emitter for target "${target}"` }], warnings };
  }
  // The flowchart form keeps labels, icons as shapes and nested boundaries, so the matrix
  // warnings that describe architecture-beta do not apply to it. Cloud icons and group frames
  // are lost in either form, so those two stay.
  const fellBack = result.warnings.some((w) => w.fallback === 'flowchart');
  const kept = fellBack ? warnings.filter((w) => w.stage !== 'feature-matrix' || /\.(aws|gcp)$/.test(w.feature)) : warnings;
  kept.push(...result.warnings.map((w) => ({ stage: 'emit', ...w })));
  if (native) {
    // The native board is the draw.io drawing: what the matrix and the Mermaid emitter say
    // about the FigJam text (icons and frames lost, another diagram form) is not true of it.
    // Those warnings are dropped when only the scripts are asked for, and marked as the
    // text's when both are written; the board gets the warnings of the draw.io emit.
    const ofText = (w) => w.stage === 'feature-matrix' || w.stage === 'emit';
    const text = options.nativeOnly === true || textSkipped !== undefined ? [] : kept.filter(ofText).map((w) => ({ ...w, appliesTo: 'figjam-text', message: `${w.message} (this is about the FigJam text for generate_diagram; the native script draws the board from the draw.io layout)` }));
    const board = [
      ...checkFeatureMatrix(ir, 'drawio').warnings.map((w) => ({ stage: 'feature-matrix', appliesTo: 'native-board', ...w })),
      ...result.nativeWarnings.map((w) => ({ stage: 'emit', appliesTo: 'native-board', ...w })),
    ];
    const rest = kept.filter((w) => !ofText(w));
    kept.length = 0;
    kept.push(...rest, ...text, ...board);
  }
  return { ok: true, output: result.output, ...(result.overlay ? { overlay: result.overlay } : {}), ...(result.native ? { native: result.native, nativeData: result.nativeData, nativeCreated: result.nativeCreated } : {}), ...(textSkipped === undefined ? {} : { textSkipped }), errors: [], warnings: kept };
}

/**
 * Validate several IRs and emit them into one file: a multi-page .drawio (one named page per
 * diagram), a Markdown document (one heading and fenced mermaid block per diagram) or the
 * description tables of every diagram as one Markdown document.
 * Errors carry the index and id of the diagram they belong to; all diagrams are checked
 * before anything is emitted.
 * @param {Array<{ ir: unknown, id: string, sourcePath?: string }>} entries `sourcePath` names the IR file in its run when it is not `source/<id>.ir.json`
 * @param {'drawio' | 'mermaid' | 'doc'} target
 * @param {{ allowSensitive?: boolean, mermaidStable?: boolean, title?: string, lang?: string, canvas?: 'all' | string[], gap?: number }} [options]
 *   `canvas` (draw.io only) adds a first page with the named diagrams side by side, `gap` px apart (default 120)
 */
export async function bundle(entries, target, options = {}) {
  if (target !== 'drawio' && target !== 'mermaid' && target !== DOC_TARGET) {
    return { ok: false, errors: [{ path: '/', message: `bundle supports drawio and mermaid, and doc for the description tables, not "${target}"` }], warnings: [] };
  }
  let canvas;
  if (options.canvas !== undefined) {
    if (target !== 'drawio') {
      return { ok: false, errors: [{ path: '/', message: 'canvas applies to drawio only', hint: target === DOC_TARGET ? 'the description tables have no page to lay diagrams out on' : 'the Markdown bundle already shows every diagram in one document' }], warnings: [] };
    }
    const known = entries.map((e) => e.id);
    canvas = options.canvas === 'all' ? known : options.canvas;
    const unknown = canvas.filter((id) => !known.includes(id));
    if (unknown.length > 0) {
      return { ok: false, errors: [{ path: '/', message: `canvas names diagrams that are not in this bundle: ${unknown.join(', ')}`, hint: `known ids: ${known.join(', ')}` }], warnings: [] };
    }
    if (options.gap !== undefined && !(Number.isFinite(options.gap) && options.gap >= 0)) {
      return { ok: false, errors: [{ path: '/', message: `gap must be a number of pixels, 0 or more, not "${options.gap}"` }], warnings: [] };
    }
  }
  const errors = [];
  const warnings = [];
  const outputs = [];
  if (target === 'drawio' || target === DOC_TARGET) {
    // Page ids are slugs of the diagram ids; two diagrams with one page id would share every cell id,
    // and in the description tables the anchor a `ref` links to.
    const pageIds = new Map();
    for (const e of entries) {
      const pageId = (options.legacyIds ? slugify : pageIdOf)(e.id);
      if (pageIds.has(pageId)) {
        return { ok: false, errors: [{ path: '/', message: `diagrams "${pageIds.get(pageId)}" and "${e.id}" would share the ${target === DOC_TARGET ? 'anchor' : 'page id'} "${pageId}"`, hint: `rename one of the IR files: ${target === DOC_TARGET ? 'an anchor' : 'a page id'} is the file name in lower case with every other character as a hyphen` }], warnings: [] };
      }
      pageIds.set(pageId, e.id);
    }
  }
  const refs = bundleRefs(entries, options.legacyIds ? slugify : pageIdOf);
  // A page and a heading are named by the title of their diagram. Two diagrams of one title
  // would give two pages of one name, which nobody can tell apart in the tab bar or pick by
  // name: the later one is numbered, and the bundle says so.
  const pageNames = new Map();
  if (target !== DOC_TARGET) {
    const firstOf = new Map();
    const taken = new Set(entries.map((e) => e.ir?.title));
    for (const e of entries) {
      const title = e.ir?.title;
      if (typeof title !== 'string') continue;
      if (!firstOf.has(title)) { firstOf.set(title, { id: e.id, n: 1 }); continue; }
      const first = firstOf.get(title);
      let name;
      do { first.n += 1; name = `${title} (${first.n})`; } while (taken.has(name));
      taken.add(name);
      pageNames.set(e.id, name);
      warnings.push({ stage: 'bundle', diagram: e.id, path: '/title', message: `diagrams "${first.id}" and "${e.id}" have the same title "${title}": the ${target === 'drawio' ? 'page' : 'heading'} of "${e.id}" is named "${name}"`, hint: 'give each diagram a title of its own in its IR and bundle again' });
    }
  }
  for (const [i, entry] of entries.entries()) {
    const r = await emit(entry.ir, target, { ...options, diagramId: entry.id, refs, sourcePath: entry.sourcePath });
    const tag = (x) => ({ diagram: entry.id, index: i, ...x });
    warnings.push(...r.warnings.map(tag));
    if (!r.ok) errors.push(...r.errors.map(tag));
    else outputs.push({ entry, output: r.output });
  }
  if (errors.length > 0) return { ok: false, errors, warnings };
  if (target === DOC_TARGET) return { ok: true, output: docBundle(outputs.map((o) => o.output), { lang: options.lang, title: options.title }), errors: [], warnings };
  if (target === 'mermaid') {
    const title = options.title ?? 'Diagrams';
    const parts = [`# ${title}`, ''];
    for (const { entry, output } of outputs) {
      parts.push(`## ${pageNames.get(entry.id) ?? entry.ir.title}`, '', `Source: \`${entry.sourcePath ?? `source/${entry.id}.ir.json`}\``, '', '```mermaid', output.trimEnd(), '```', '');
      const omitted = entry.ir.meta?.omitted ?? [];
      if (omitted.length > 0) parts.push('Not shown on purpose:', '', ...omitted.map((o) => `- ${o}`), '');
    }
    return { ok: true, output: parts.join('\n'), errors: [], warnings };
  }
  const result = await emitDrawioBundle(entries.map((e) => ({ ir: e.ir, diagramId: e.id })), { canvas, gap: options.gap, title: options.title, legacyIds: options.legacyIds, pageNames });
  return { ok: true, output: result.output, errors: [], warnings, canvas };
}

/**
 * What `validate` reports beside the errors: the warnings that do not depend on a target
 * (model and size, level of detail, secret scan), so they are read before anything is drawn.
 * @param {object} ir a valid IR
 */
export function inspect(ir) {
  return [
    ...checkModel(ir).warnings.map((w) => ({ stage: 'model', ...w })),
    ...checkDetail(ir).warnings.map((w) => ({ stage: 'detail', ...w })),
    // A credential by its form stops every emit: said here, so `ok: true` is not read as "will emit".
    ...scanSecrets(ir).warnings.map((w) => ({ stage: 'secret-scan', ...w, ...(DEFINITE_KINDS.has(w.kind) ? { blocks: 'emit', hint: 'emit and bundle refuse this value on every target: replace it with a placeholder such as <db password>' } : {}) })),
  ];
}
