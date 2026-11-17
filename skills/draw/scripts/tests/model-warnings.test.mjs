/**
 * What the model check says about a valid IR whose picture would lose or waste something: a
 * name written on a start or end marker, and a frame that holds nothing.
 */
import { describe, it, expect } from 'vitest';
import { checkModel } from '../src/check-model.mjs';
import { validateIr } from '../src/validate-ir.mjs';
import { emit } from '../src/pipeline.mjs';
import { validFixtures } from './helpers.mjs';

const messages = (ir) => checkModel(ir).warnings.map((w) => w.message);

describe('a label on an initial or final state', () => {
  const order = (states, transitions) => ({ schemaVersion: 1, kind: 'state', title: 'Order status', states, transitions });
  const terminal = order(
    [{ id: 'start', kind: 'initial' }, { id: 'paid', label: 'PAID' }, { id: 'cancelled', label: 'CANCELLED', kind: 'final' }],
    [{ id: 't1', from: 'start', to: 'paid' }, { id: 't2', from: 'paid', to: 'cancelled', event: 'cancel' }],
  );

  it('is valid, and is reported with the state, the label and the way to keep the name', () => {
    expect(validateIr(terminal).ok).toBe(true);
    const { warnings } = checkModel(terminal);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].path).toBe('/states/2');
    expect(warnings[0].message).toBe('model: final state "cancelled" has the label "CANCELLED", which no target draws; a final state is a circle without a name');
    expect(warnings[0].hint).toContain('make "cancelled" an ordinary state (kind "simple") and add a transition from it to a final state without a label');
  });

  it('names a labelled initial state the same way, also when the diagram has no other warning to give', () => {
    const ir = order([{ id: 'new', label: 'NEW', kind: 'initial' }, { id: 'paid', label: 'PAID' }], [{ id: 't1', from: 'new', to: 'paid' }]);
    expect(messages(ir)).toEqual(['model: initial state "new" has the label "NEW", which no target draws; an initial state is a circle without a name']);
    expect(checkModel(ir).warnings[0].hint).toContain('add an initial state without a label with a transition to it');
  });

  it('is said before the missing initial state, which ends the other state checks', () => {
    const ir = order([{ id: 'paid', label: 'PAID' }, { id: 'refunded', label: 'REFUNDED', kind: 'final' }], [{ id: 't1', from: 'paid', to: 'refunded' }]);
    expect(messages(ir)).toEqual([
      'model: final state "refunded" has the label "REFUNDED", which no target draws; a final state is a circle without a name',
      'model: no initial state; the reader cannot tell where the thing starts',
    ]);
  });

  it('really is lost by the draw.io and the Mermaid emitter, which is why it is reported on every emit', async () => {
    for (const target of ['drawio', 'mermaid']) {
      const r = await emit(terminal, target, { diagramId: 'order' });
      expect(r.ok, target).toBe(true);
      expect(r.output, target).not.toContain('CANCELLED');
      expect(r.warnings.filter((w) => w.stage === 'model').map((w) => w.path), target).toEqual(['/states/2']);
    }
  });

  it('says nothing about the ordinary terminal state with an unlabelled final marker behind it', () => {
    const ir = order(
      [{ id: 'start', kind: 'initial' }, { id: 'paid', label: 'PAID' }, { id: 'cancelled', label: 'CANCELLED' }, { id: 'end', kind: 'final' }],
      [{ id: 't1', from: 'start', to: 'paid' }, { id: 't2', from: 'paid', to: 'cancelled', event: 'cancel' }, { id: 't3', from: 'cancelled', to: 'end' }],
    );
    expect(messages(ir)).toEqual([]);
  });

  it('is in no fixture, so no fixture emits anything new', () => {
    for (const { kind, name, ir } of validFixtures().filter((f) => f.kind === 'state')) {
      expect(messages(ir).filter((m) => m.includes('which no target draws')), `${kind}/${name}`).toEqual([]);
    }
  });
});

describe('a frame without a member', () => {
  it('is reported for a boundary of an architecture diagram and of a use case diagram, and for a group of a flowchart', () => {
    const arch = {
      schemaVersion: 1, kind: 'architecture', title: 'A',
      components: [{ id: 'api', label: 'API' }, { id: 'db', label: 'DB', kind: 'database' }],
      boundaries: [{ id: 'vpc', label: 'VPC', children: ['db', 'subnet'] }, { id: 'subnet', label: 'Private subnet', children: [] }],
      connections: [{ id: 'c1', from: 'api', to: 'db' }],
    };
    expect(validateIr(arch).ok).toBe(true);
    const { warnings } = checkModel(arch);
    expect(warnings.map((w) => [w.path, w.message])).toEqual([['/boundaries/1', 'model: boundary "subnet" has no member; it is drawn as an empty frame']]);
    expect(warnings[0].hint).toContain('meta.omitted');

    const flow = {
      schemaVersion: 1, kind: 'flowchart', title: 'F',
      nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], edges: [{ id: 'e', from: 'a', to: 'b' }],
      groups: [{ id: 'g', label: 'Later', children: [] }],
    };
    expect(messages(flow)).toEqual(['model: group "g" has no member; it is drawn as an empty frame']);
  });

  it('is in no fixture', () => {
    for (const { kind, name, ir } of validFixtures()) expect(messages(ir).filter((m) => m.includes('has no member')), `${kind}/${name}`).toEqual([]);
  });
});
