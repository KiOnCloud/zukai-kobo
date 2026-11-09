import { describe, it, expect } from 'vitest';
import { validateIr, KINDS } from '../src/validate-ir.mjs';
import { loadFixture, validFixtures, invalidFixtures } from './helpers.mjs';

describe('validateIr', () => {
  it('accepts every valid fixture', () => {
    for (const { kind, name, ir } of validFixtures()) {
      const r = validateIr(ir);
      expect(r.errors, `${kind}/${name}`).toEqual([]);
      expect(r.ok).toBe(true);
    }
  });

  it('rejects every invalid fixture with at least two errors', () => {
    for (const { kind, name, ir } of invalidFixtures()) {
      const r = validateIr(ir);
      expect(r.ok, `${kind}/${name}`).toBe(false);
      expect(r.errors.length, `${kind}/${name}`).toBeGreaterThanOrEqual(2);
      for (const e of r.errors) {
        expect(e.path).toMatch(/^\//);
        expect(typeof e.message).toBe('string');
      }
    }
  });

  it('reports the schema error and the dangling edge target together', () => {
    const r = validateIr(loadFixture('flowchart', 'invalid-missing-edge-target'));
    expect(r.errors).toEqual([
      expect.objectContaining({ path: '/nodes/0/shape', hint: expect.stringContaining('"process"') }),
      expect.objectContaining({ path: '/edges/0/to', message: 'unknown node "finish"' }),
    ]);
  });

  it('reports errors only from the branch selected by kind', () => {
    const r = validateIr({ schemaVersion: 1, kind: 'flowchart', title: 'x', nodes: [], edges: [] });
    expect(r.errors).toEqual([expect.objectContaining({ path: '/nodes', hint: 'at least 1 item required' })]);
    expect(r.errors.some((e) => /participants|states|entities/.test(e.message))).toBe(false);
  });

  it('rejects an unknown kind and names the allowed kinds once', () => {
    const r = validateIr({ schemaVersion: 1, kind: 'mindmap', title: 'x' });
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toEqual({ path: '/kind', message: expect.any(String), hint: `allowed values: ${KINDS.map((k) => `"${k}"`).join(', ')}` });
  });

  it('flags unknown and misspelled properties with a hint', () => {
    const ir = { ...loadFixture('flowchart', 'valid'), nodez: [] };
    ir.nodes = ir.nodes.map((n, i) => (i === 0 ? { ...n, lable: 'x' } : n));
    const r = validateIr(ir);
    expect(r.errors).toEqual([
      expect.objectContaining({ path: '/', message: 'unknown property "nodez"' }),
      expect.objectContaining({ path: '/nodes/0', message: 'unknown property "lable"' }),
    ]);
  });

  it('rejects ids outside the safe pattern with the id hint', () => {
    const ir = loadFixture('er', 'valid');
    ir.entities[0].id = 'cust omer';
    const r = validateIr(ir);
    expect(r.errors[0]).toEqual(expect.objectContaining({ path: '/entities/0/id', hint: expect.stringContaining('letters, digits') }));
  });

  it('rejects non-object input', () => {
    expect(validateIr(null).ok).toBe(false);
    expect(validateIr([]).ok).toBe(false);
    expect(validateIr('x').ok).toBe(false);
  });

  it('accepts meta.audience and meta.lang and rejects other values', () => {
    const ir = loadFixture('flowchart', 'valid');
    expect(validateIr({ ...ir, meta: { audience: 'business', lang: 'vi' } }).ok).toBe(true);
    expect(validateIr({ ...ir, meta: { audience: 'technical', lang: 'en-GB' } }).ok).toBe(true);
    expect(validateIr({ ...ir, meta: { audience: 'business', omitted: ['No retry branch: the reader only needs the outcome'] } }).ok).toBe(true);
    expect(validateIr({ ...ir, meta: { omitted: 'not a list' } }).ok).toBe(false);
    const bad = validateIr({ ...ir, meta: { audience: 'manager', lang: 'Vietnamese' } });
    expect(bad.ok).toBe(false);
    expect(bad.errors.map((e) => e.path).sort()).toEqual(['/meta/audience', '/meta/lang']);
  });

  it('requires schemaVersion 1 and a title', () => {
    const r = validateIr({ kind: 'er', entities: [{ id: 'a', label: 'A' }], relations: [] });
    expect(r.errors.map((e) => e.message)).toEqual(expect.arrayContaining(['missing required property "schemaVersion"', 'missing required property "title"']));
  });
});
