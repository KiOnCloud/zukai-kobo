import { validateIr } from './validate-ir.mjs';
import { checkFeatureMatrix, TARGETS } from './check-feature-matrix.mjs';
import { scanSecrets } from './scan-secrets.mjs';
import { emitMermaid } from './emit-mermaid.mjs';
import { emitDrawio, emitDrawioBundle, bundleRefs } from './emit-drawio.mjs';

export { TARGETS };

/**
 * Validate an IR and emit it for one target. Order: schema and references, feature matrix,
 * secret scan, emitter. Errors stop the pipeline; warnings accumulate across every stage.
 * @param {unknown} ir
 * @param {string} target
 * @param {{ allowSensitive?: boolean, mermaidStable?: boolean, diagramId?: string, refs?: Map<string, { pageId: string, title: string }> }} [options]
 *   `refs` is set by `bundle` so a `ref` resolves to the target's title (and page link in draw.io)
 * @returns {Promise<{ ok: boolean, output?: string, errors: Array<object>, warnings: Array<object> }>}
 */
export async function emit(ir, target, options = {}) {
  const validation = validateIr(ir);
  if (!validation.ok) return { ok: false, errors: validation.errors, warnings: [] };

  const matrix = checkFeatureMatrix(ir, target);
  const warnings = [...matrix.warnings.map((w) => ({ stage: 'feature-matrix', ...w }))];
  if (!matrix.ok) return { ok: false, errors: matrix.errors, warnings };

  const secrets = scanSecrets(ir);
  warnings.push(...secrets.warnings.map((w) => ({ stage: 'secret-scan', ...w })));
  // FigJam labels leave the machine, so possible secrets block the emit unless overridden.
  if (target === 'figjam' && secrets.warnings.length > 0 && !options.allowSensitive) {
    return {
      ok: false,
      errors: secrets.warnings.map((w) => ({ path: w.path, message: `refusing to emit for figjam: ${w.message}`, hint: 'remove the value from the IR, or pass --allow-sensitive if it is not a secret' })),
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
      result = emitMermaid(ir, { profile: 'figjam' });
      break;
    default:
      return { ok: false, errors: [{ path: '/', message: `no emitter for target "${target}"` }], warnings };
  }
  // The flowchart form keeps labels, icons as shapes and nested boundaries, so the matrix
  // warnings that describe architecture-beta do not apply to it.
  const fellBack = result.warnings.some((w) => w.fallback === 'flowchart');
  const kept = fellBack ? warnings.filter((w) => w.stage !== 'feature-matrix') : warnings;
  kept.push(...result.warnings.map((w) => ({ stage: 'emit', ...w })));
  return { ok: true, output: result.output, errors: [], warnings: kept };
}

/**
 * Validate several IRs and emit them into one file: a multi-page .drawio (one named page per
 * diagram) or a Markdown document (one heading and fenced mermaid block per diagram).
 * Errors carry the index and id of the diagram they belong to; all diagrams are checked
 * before anything is emitted.
 * @param {Array<{ ir: unknown, id: string }>} entries
 * @param {'drawio' | 'mermaid'} target
 * @param {{ allowSensitive?: boolean, mermaidStable?: boolean, title?: string, canvas?: 'all' | string[], gap?: number }} [options]
 *   `canvas` (draw.io only) adds a first page with the named diagrams side by side, `gap` px apart (default 120)
 */
export async function bundle(entries, target, options = {}) {
  if (target !== 'drawio' && target !== 'mermaid') {
    return { ok: false, errors: [{ path: '/', message: `bundle supports drawio and mermaid, not "${target}"` }], warnings: [] };
  }
  let canvas;
  if (options.canvas !== undefined) {
    if (target !== 'drawio') {
      return { ok: false, errors: [{ path: '/', message: 'canvas applies to drawio only', hint: 'the Markdown bundle already shows every diagram in one document' }], warnings: [] };
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
  const refs = bundleRefs(entries);
  for (const [i, entry] of entries.entries()) {
    const r = await emit(entry.ir, target, { ...options, diagramId: entry.id, refs });
    const tag = (x) => ({ diagram: entry.id, index: i, ...x });
    warnings.push(...r.warnings.map(tag));
    if (!r.ok) errors.push(...r.errors.map(tag));
    else outputs.push({ entry, output: r.output });
  }
  if (errors.length > 0) return { ok: false, errors, warnings };
  if (target === 'mermaid') {
    const title = options.title ?? 'Diagrams';
    const parts = [`# ${title}`, ''];
    for (const { entry, output } of outputs) {
      parts.push(`## ${entry.ir.title}`, '', `Source: \`source/${entry.id}.ir.json\``, '', '```mermaid', output.trimEnd(), '```', '');
      const omitted = entry.ir.meta?.omitted ?? [];
      if (omitted.length > 0) parts.push('Not shown on purpose:', '', ...omitted.map((o) => `- ${o}`), '');
    }
    return { ok: true, output: parts.join('\n'), errors: [], warnings };
  }
  const result = await emitDrawioBundle(entries.map((e) => ({ ir: e.ir, diagramId: e.id })), { canvas, gap: options.gap, title: options.title });
  return { ok: true, output: result.output, errors: [], warnings, canvas };
}
