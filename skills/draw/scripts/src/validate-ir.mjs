import Ajv2020 from 'ajv/dist/2020.js';
import schema from './schema/ir-v1.schema.json' with { type: 'json' };
import { checkReferences } from './check-references.mjs';

export const KINDS = schema.properties.kind.enum;

let compiled;
function validator() {
  if (!compiled) {
    const ajv = new Ajv2020({ allErrors: true, discriminator: true, strict: true, verbose: false });
    compiled = ajv.compile(schema);
  }
  return compiled;
}

const ID_HINT = 'ids use letters, digits, underscore and hyphen only, 1 to 64 characters';

function hintFor(error) {
  const { keyword, params, instancePath } = error;
  switch (keyword) {
    case 'enum':
      return `allowed values: ${params.allowedValues.map((v) => JSON.stringify(v)).join(', ')}`;
    case 'const':
      return `expected ${JSON.stringify(params.allowedValue)}`;
    case 'additionalProperties':
      return `remove "${params.additionalProperty}" or fix its spelling; see references/ir-reference.md for the allowed fields`;
    case 'unevaluatedProperties':
      return `remove "${params.unevaluatedProperty}" or fix its spelling; see references/ir-reference.md for the allowed fields`;
    case 'required':
      return `add the "${params.missingProperty}" field`;
    case 'pattern':
      if (/^\/(components\/\d+\/icon|boundaries\/\d+\/group)$/.test(instancePath)) return 'write "aws:<name>" with a name listed in references/aws-icons.md';
      return instancePath.endsWith('/id') || /\/(from|to|after|children\/\d+|participants\/\d+|messages\/\d+)$/.test(instancePath)
        ? ID_HINT
        : `must match ${params.pattern}`;
    case 'minItems':
      return `at least ${params.limit} item${params.limit === 1 ? '' : 's'} required`;
    case 'maxItems':
      return `at most ${params.limit} item${params.limit === 1 ? '' : 's'} allowed`;
    case 'minLength':
      return 'must not be empty';
    case 'maxLength':
      return `at most ${params.limit} characters`;
    case 'uniqueItems':
      return 'duplicate entries are not allowed in this list';
    case 'type':
      return `expected ${params.type}`;
    case 'discriminator':
      return `kind must be one of: ${KINDS.join(', ')}`;
    default:
      return undefined;
  }
}

function mapAjvErrors(ajvErrors) {
  const hasKindEnumError = ajvErrors.some((e) => e.instancePath === '/kind' && e.keyword === 'enum');
  const out = [];
  for (const e of ajvErrors) {
    // The root enum already explains a bad kind; the discriminator mapping error would repeat it.
    if (hasKindEnumError && e.keyword === 'discriminator') continue;
    const path = e.instancePath === '' ? '/' : e.instancePath;
    let message = e.message ?? 'invalid';
    if (e.keyword === 'additionalProperties') message = `unknown property "${e.params.additionalProperty}"`;
    if (e.keyword === 'unevaluatedProperties') message = `unknown property "${e.params.unevaluatedProperty}"`;
    if (e.keyword === 'required') message = `missing required property "${e.params.missingProperty}"`;
    const hint = hintFor(e);
    out.push(hint ? { path, message, hint } : { path, message });
  }
  // Deterministic order: by path, then message.
  out.sort((a, b) => (a.path === b.path ? a.message.localeCompare(b.message) : a.path.localeCompare(b.path)));
  return dedupe(out);
}

function dedupe(errors) {
  const seen = new Set();
  return errors.filter((e) => {
    const key = `${e.path}|${e.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Validate an IR document. Runs the JSON Schema pass and, when the shape is sound enough to
 * walk, the referential-integrity pass; returns every error from both passes.
 * @param {unknown} ir
 * @returns {{ ok: boolean, errors: Array<{ path: string, message: string, hint?: string }> }}
 */
export function validateIr(ir) {
  if (ir === null || typeof ir !== 'object' || Array.isArray(ir)) {
    return { ok: false, errors: [{ path: '/', message: 'IR must be a JSON object', hint: 'see references/ir-reference.md' }] };
  }
  const validate = validator();
  const schemaOk = validate(ir);
  const errors = schemaOk ? [] : mapAjvErrors(validate.errors ?? []);
  // Reference checks need a known kind and array-shaped collections; they tolerate missing fields.
  if (KINDS.includes(ir.kind)) {
    errors.push(...checkReferences(ir).errors);
  }
  return { ok: errors.length === 0, errors };
}

export { schema };
