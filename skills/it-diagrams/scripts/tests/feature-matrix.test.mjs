import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { matrix, TARGETS, enumerateFeatures, checkFeatureMatrix } from '../src/check-feature-matrix.mjs';
import { renderFeatureMatrix, docsPath } from '../src/render-feature-matrix.mjs';
import { schema } from '../src/validate-ir.mjs';
import { loadFixture, validFixtures } from './helpers.mjs';

const def = (name) => schema.$defs[name].properties;
const enumOf = (s) => s.enum;

/** Every feature name the enumerator can produce, derived from the schema enums. */
function expectedFeatures() {
  const out = {
    flowchart: [
      ...enumOf(def('flowchart').nodes.items.properties.shape).map((s) => `node.shape.${s}`),
      ...enumOf(def('flowchart').edges.items.properties.kind).map((k) => `edge.kind.${k}`),
      'group', 'group.nested', 'node.ref',
    ],
    sequence: [
      ...enumOf(def('sequence').participants.items.properties.kind).map((k) => `participant.kind.${k}`),
      ...enumOf(def('sequence').messages.items.properties.kind).map((k) => `message.kind.${k}`),
      ...enumOf(def('sequence').blocks.items.properties.kind).map((k) => `block.kind.${k}`),
      'note',
    ],
    state: [
      ...enumOf(def('state').states.items.properties.kind).map((k) => `state.kind.${k}`),
      'composite.depth.gt2', 'transition.guard', 'transition.action',
    ],
    er: [
      'attribute.key.pk', 'attribute.key.fk', 'attribute.comment',
      ...enumOf(def('er').relations.items.properties.fromCardinality).map((c) => `relation.cardinality.${c}`),
      'relation.nonIdentifying',
    ],
    class: [
      'stereotype', 'member.visibility', 'method.params',
      ...enumOf(def('class').relations.items.properties.kind).map((k) => `relation.kind.${k}`),
      'relation.cardinality',
    ],
    architecture: [
      ...enumOf(def('architecture').components.items.properties.kind).map((k) => `component.kind.${k}`),
      'boundary', 'boundary.nested', 'connection.label', 'connection.bidirectional',
    ],
    activity: [
      'lane', 'action.ref',
      ...enumOf(def('activity').controls.items.properties.kind).map((k) => `control.kind.${k}`),
      'flow.guard',
    ],
  };
  return out;
}

describe('feature matrix data', () => {
  it('covers every kind of the schema and every feature the enumerator can produce, for every target', () => {
    const expected = expectedFeatures();
    expect(Object.keys(matrix.kinds).sort()).toEqual(schema.properties.kind.enum.slice().sort());
    for (const [kind, features] of Object.entries(expected)) {
      expect(Object.keys(matrix.kinds[kind].features).sort(), kind).toEqual(features.slice().sort());
      for (const target of TARGETS) {
        expect(matrix.kinds[kind].kind[target], `${kind}.kind.${target}`).toBeDefined();
        for (const f of features) expect(matrix.kinds[kind].features[f][target], `${kind}.${f}.${target}`).toBeDefined();
      }
    }
  });

  it('uses only the declared statuses and gives every degraded cell a note', () => {
    const sections = [...Object.entries(matrix.kinds).map(([kind, entry]) => [kind, { kind: entry.kind, ...entry.features }]), ['bundle', matrix.bundle]];
    for (const [kind, features] of sections) {
      for (const [feature, cells] of Object.entries(features)) {
        for (const target of TARGETS) {
          const v = cells[target];
          const status = typeof v === 'string' ? v : v.status;
          expect(matrix.statuses, `${kind}.${feature}.${target}`).toContain(status);
          if (status !== 'supported') expect(typeof v === 'object' && v.note, `${kind}.${feature}.${target} needs a note`).toBeTruthy();
        }
      }
    }
  });

  it('is rendered in docs/feature-matrix.md without drift', () => {
    expect(readFileSync(docsPath, 'utf8')).toBe(renderFeatureMatrix());
  });
});

describe('enumerateFeatures and checkFeatureMatrix', () => {
  it('only produces features that exist in the matrix, for every fixture', () => {
    for (const { kind, name, ir } of validFixtures()) {
      for (const f of enumerateFeatures(ir)) {
        expect(matrix.kinds[ir.kind].features[f.feature], `${kind}/${name} ${f.feature}`).toBeDefined();
      }
    }
  });

  it('warns for degraded features naming the element', () => {
    // FigJam still has only actor and participant; Mermaid draws every kind since issue 23.
    const r = checkFeatureMatrix(loadFixture('sequence', 'valid'), 'figjam');
    expect(r.ok).toBe(true);
    expect(r.warnings.map((w) => w.path).filter((p) => p.startsWith('/participants'))).toEqual(['/participants/2', '/participants/3']);
    expect(r.warnings[0].message).toContain('"auth"');
    expect(checkFeatureMatrix(loadFixture('sequence', 'valid'), 'mermaid').warnings).toEqual([]);
  });

  it('rejects an unknown target', () => {
    const r = checkFeatureMatrix(loadFixture('er', 'valid'), 'visio');
    expect(r.ok).toBe(false);
    expect(r.errors[0].hint).toContain('mermaid');
  });

  it('flags the deep composite only from the third level', () => {
    const ir = loadFixture('state', 'valid');
    ir.states.push({ id: 'deep', label: 'Deep', kind: 'composite', children: ['deeper'] }, { id: 'deeper', label: 'Deeper', kind: 'composite', children: ['leaf'] }, { id: 'leaf', label: 'Leaf' });
    ir.states[3].children.push('deep');
    const f = enumerateFeatures(ir).filter((x) => x.feature === 'composite.depth.gt2');
    expect(f.map((x) => x.elementId)).toEqual(['deeper']);
  });
});
