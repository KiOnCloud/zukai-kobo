import { describe, it, expect } from 'vitest';
import { checkReferences } from '../src/check-references.mjs';
import { loadFixture } from './helpers.mjs';

const messages = (r) => r.errors.map((e) => `${e.path}: ${e.message}`);

describe('checkReferences', () => {
  it('finds duplicate ids across collections', () => {
    const ir = loadFixture('flowchart', 'valid');
    ir.groups[0].id = 'start';
    expect(messages(checkReferences(ir))).toEqual(['/groups/0/id: duplicate id "start", first used at /nodes/0']);
  });

  it('requires conditional edges to carry a label', () => {
    const ir = loadFixture('flowchart', 'valid');
    delete ir.edges[2].label;
    expect(messages(checkReferences(ir))).toEqual(['/edges/2: conditional edge needs a label']);
  });

  it('detects group cycles, double parents and unknown children', () => {
    const ir = loadFixture('flowchart', 'valid');
    ir.groups.push({ id: 'g2', label: 'G2', children: ['fulfilment', 'reserve', 'ghost'] });
    ir.groups[0].children.push('g2');
    const m = messages(checkReferences(ir));
    expect(m).toContain('/groups/1/children/1: "reserve" is already a child of "fulfilment"');
    expect(m).toContain('/groups/1/children/2: unknown child "ghost"');
    expect(m.filter((x) => x.includes('containment cycle'))).toHaveLength(2);
  });

  describe('sequence blocks', () => {
    const base = () => loadFixture('sequence', 'valid');

    it('accepts the nested alt inside loop of the fixture', () => {
      expect(checkReferences(base()).errors).toEqual([]);
    });

    it('rejects a non-contiguous section', () => {
      const ir = base();
      ir.blocks[0].messages = ['m6', 'm8'];
      expect(messages(checkReferences(ir))).toEqual(expect.arrayContaining([expect.stringContaining('/blocks/0/messages: messages in a block section must be a contiguous run')]));
    });

    it('rejects a branch that does not follow the previous section', () => {
      const ir = base();
      ir.blocks[0].branches[0].messages = ['m9'];
      expect(messages(checkReferences(ir))).toEqual(['/blocks/0/branches/0/messages: this section must start right after the previous section of the same block']);
    });

    it('rejects a nested block that spans two sections of its parent', () => {
      const ir = base();
      ir.blocks.push({ id: 'b3', kind: 'opt', label: 'x', messages: ['m7', 'm8'] });
      expect(messages(checkReferences(ir))).toEqual(['/blocks/2: block "b3" spans more than one section of block "b1"']);
    });

    it('rejects branches on opt and loop', () => {
      const ir = base();
      ir.blocks[1].branches = [{ label: 'x', messages: ['m10'] }];
      expect(messages(checkReferences(ir))).toEqual(expect.arrayContaining(['/blocks/1/branches: block kind "loop" cannot have branches']));
    });

    it('checks note participants and the after anchor', () => {
      const ir = base();
      ir.notes[0].participants = ['nobody'];
      ir.notes[1].after = 'm99';
      expect(messages(checkReferences(ir))).toEqual(['/notes/0/participants/0: unknown participant "nobody"', '/notes/1/after: unknown message or block "m99"']);
      // A note may follow a whole block: it then stands below the frame.
      const after = base();
      after.notes[1].after = after.blocks[0].id;
      expect(messages(checkReferences(after))).toEqual([]);
    });
  });

  describe('state', () => {
    it('rejects children on non-composite states', () => {
      const ir = loadFixture('state', 'valid');
      ir.states[1].children = ['shipped'];
      expect(messages(checkReferences(ir))).toEqual(expect.arrayContaining(['/states/1/children: state "draft" has children but its kind is "simple"']));
    });

    it('rejects a state in two composites', () => {
      const ir = loadFixture('state', 'valid');
      ir.states.push({ id: 'other', label: 'Other', kind: 'composite', children: ['picking'] });
      expect(messages(checkReferences(ir))).toEqual(['/states/11/children/0: "picking" is already a child of "processing"']);
    });
  });

  it('tolerates a document that failed schema validation', () => {
    const r = checkReferences({ kind: 'er', entities: 'nope', relations: [{ id: 'r', from: 'a', to: 'b' }, 5] });
    expect(messages(r)).toEqual(['/relations/0/from: unknown entity "a"', '/relations/0/to: unknown entity "b"']);
  });

  it('returns ok for an unknown kind', () => {
    expect(checkReferences({ kind: 'mystery' })).toEqual({ ok: true, errors: [] });
  });
});
