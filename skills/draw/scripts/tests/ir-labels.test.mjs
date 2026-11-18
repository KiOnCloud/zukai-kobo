import { describe, it, expect } from 'vitest';
import { labelsOf, textAt, TEXT_FIELDS, CODE_FIELDS } from '../src/ir-labels.mjs';
import { schema } from '../src/validate-ir.mjs';
import { validFixtures } from './helpers.mjs';

/** Every field of the schema whose value is a label or a text, as `<def>.<collection>[].<field>`. */
function schemaTextFields() {
  const out = [];
  const visit = (node, path) => {
    if (!node || typeof node !== 'object') return;
    if (node.$ref === '#/$defs/label' || node.$ref === '#/$defs/text') out.push(path);
    if (node.properties) for (const [k, v] of Object.entries(node.properties)) visit(v, `${path}.${k}`);
    if (node.items) visit(node.items, `${path}[]`);
    for (const key of ['allOf', 'oneOf', 'anyOf']) for (const sub of node[key] ?? []) visit(sub, path);
    if (node.then) visit(node.then, path);
    if (node.else) visit(node.else, path);
  };
  for (const [name, def] of Object.entries(schema.$defs)) visit(def, name);
  return out;
}

describe('labelsOf', () => {
  it('knows every label and text field of the schema as wording or as code', () => {
    const known = new Set([...TEXT_FIELDS, ...CODE_FIELDS]);
    const unknown = schemaTextFields().filter((p) => !known.has(p.split('.').at(-1)));
    expect(unknown).toEqual([]);
  });

  it.each(validFixtures().map((f) => [`${f.kind}/${f.name}`, f.ir]))('returns every wording field of %s with a path that finds it again', (_, ir) => {
    const labels = labelsOf(ir);
    expect(labels[0]).toMatchObject({ path: '/title', field: 'title', text: ir.title });
    for (const l of labels) {
      expect(textAt(ir, l.path)).toBe(l.text);
      expect(TEXT_FIELDS).toContain(l.path.split('/').at(-1));
    }
    // Each wording field of each element is returned once, code fields never.
    let expected = 1;
    const count = (value) => {
      if (Array.isArray(value)) value.forEach((v) => v && typeof v === 'object' && count(v));
      else for (const [k, v] of Object.entries(value)) {
        if (typeof v === 'string' && TEXT_FIELDS.includes(k) && v !== '') expected += 1;
        else if (Array.isArray(v)) count(v);
      }
    };
    for (const [key, value] of Object.entries(ir)) if (key !== 'meta' && Array.isArray(value) && value.every((v) => v && typeof v.id === 'string')) count(value);
    expect(labels.length).toBe(expected);
  });

  it('gives the guard of a transition, a row of an entity and a further section of a block their own places', () => {
    const state = labelsOf({ schemaVersion: 1, kind: 'state', title: 'T', states: [{ id: 'a', label: 'A' }], transitions: [{ id: 't1', from: 'a', to: 'a', event: 'pay', guard: 'paid', action: 'ship' }] });
    expect(state.filter((l) => l.id === 't1').map((l) => [l.field, l.text])).toEqual([['event', 'pay'], ['guard', 'paid'], ['action', 'ship']]);
    const er = labelsOf({ schemaVersion: 1, kind: 'er', title: 'T', entities: [{ id: 'c', label: 'Customer', attributes: [{ name: 'id', type: 'uuid', key: 'pk' }, { name: 'email', type: 'string', comment: 'unique' }] }], relations: [] });
    expect(er.filter((l) => l.id === 'c').map((l) => [l.path, l.text])).toEqual([['/entities/0/label', 'Customer'], ['/entities/0/attributes/0/name', 'id'], ['/entities/0/attributes/1/name', 'email'], ['/entities/0/attributes/1/comment', 'unique']]);
    const seq = labelsOf({ schemaVersion: 1, kind: 'sequence', title: 'T', participants: [], messages: [], blocks: [{ id: 'b', kind: 'alt', label: 'ok', messages: [], branches: [{ label: 'not ok', messages: [] }] }] });
    expect(seq.at(-1)).toEqual({ path: '/blocks/0/branches/0/label', collection: 'blocks', id: 'b', field: 'branches/0/label', text: 'not ok' });
  });
});
