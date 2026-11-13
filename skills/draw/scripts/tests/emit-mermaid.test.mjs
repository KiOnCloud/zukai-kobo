import { describe, it, expect } from 'vitest';
import { emit } from '../src/pipeline.mjs';
import { emitMermaid } from '../src/emit-mermaid.mjs';
import { encodeLabel } from '../src/mermaid-text.mjs';
import { loadFixture, validFixtures } from './helpers.mjs';

describe('emitMermaid', () => {
  for (const { kind, name, ir } of validFixtures()) {
    it(`matches the snapshot for ${kind}/${name}`, async () => {
      // The adversarial fixture holds a connection string on purpose; the override stands for the user's word.
      const r = await emit(ir, 'mermaid', { allowSensitive: true });
      expect(r.errors).toEqual([]);
      expect(r.ok).toBe(true);
      expect(r.output.endsWith('\n')).toBe(true);
      expect(r.output).not.toMatch(/\r/);
      await expect(r.output).toMatchFileSnapshot(`snapshots/mermaid/${kind}-${name}.mmd`);
    });
  }

  it('is deterministic', async () => {
    const ir = loadFixture('sequence', 'valid');
    expect(emitMermaid(ir).output).toBe(emitMermaid(structuredClone(ir)).output);
  });

  it('never writes an IR id as a Mermaid identifier', async () => {
    const r = await emit(loadFixture('adversarial', 'labels'), 'mermaid', { allowSensitive: true });
    const body = r.output.split('\n').filter((l) => !l.trim().startsWith('%%') && !l.startsWith('title:'));
    for (const id of ['end', 'graph', 'a--b', 'subgraph', 'click', 'style', 'direction']) {
      const escaped = id.replace(/-/g, '\\-');
      const asNode = new RegExp(`^\\s*${escaped}(\\[|\\{|\\(|>)`);
      const asSubgraph = new RegExp(`^\\s*subgraph ${escaped}\\b`);
      const asEdgeEnd = new RegExp(`(^\\s*${escaped}\\s-->|-->\\s*(\\|[^|]*\\|\\s*)?${escaped}\\s*$)`);
      expect(body.some((l) => asNode.test(l) || asSubgraph.test(l) || asEdgeEnd.test(l)), `${id} leaked`).toBe(false);
    }
  });

  it('keeps no raw quote, angle bracket, newline or directive inside a label', async () => {
    const r = await emit(loadFixture('adversarial', 'labels'), 'mermaid', { allowSensitive: true });
    const body = r.output.replace(/^---\n[\s\S]*?\n---\n/, '');
    const labels = [...body.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
    expect(labels.length).toBeGreaterThan(10);
    for (const l of labels) {
      expect(l.replace(/<br\/>/g, '')).not.toMatch(/[<>]/);
      expect(l).not.toMatch(/%%/);
    }
    expect(r.output).not.toMatch(/%%\{/);
    expect(r.output).toContain('#quot;end#quot;');
    expect(r.output).toContain('line one<br/>line two');
  });

  it('encodes every special character through entity codes', async () => {
    expect(encodeLabel('a"b<c>d&e%f#g;h{i}j[k]l|m`n\\o\r\np')).toBe('a#quot;b#lt;c#gt;d#amp;e#37;f#35;g#59;h#123;i#125;j#91;k#93;l#124;m#96;n#92;o<br/>p');
  });

  it('flattens composites deeper than two levels with a warning', async () => {
    const ir = loadFixture('state', 'valid');
    ir.states.push({ id: 'deep', label: 'Deep', kind: 'composite', children: ['deeper'] }, { id: 'deeper', label: 'Deeper', kind: 'composite', children: ['leaf'] }, { id: 'leaf', label: 'Leaf' });
    ir.states[3].children.push('deep');
    const r = await emit(ir, 'mermaid');
    expect(r.ok).toBe(true);
    expect(r.warnings.filter((w) => w.stage === 'feature-matrix').map((w) => w.feature)).toEqual(['composite.depth.gt2']);
    expect(r.warnings.filter((w) => w.stage === 'emit')[0].message).toContain('"deeper"');
    const lines = r.output.split('\n');
    const deeperLine = lines.find((l) => l.includes('"Deeper"'));
    expect(deeperLine).not.toContain('{');
    expect(lines.find((l) => l.includes('"Leaf"')).startsWith('      ')).toBe(true);
  });

  it('drops architecture connection labels through the matrix, not silently', async () => {
    const chain = { schemaVersion: 1, kind: 'architecture', title: 'Chain', direction: 'LR', components: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], boundaries: [], connections: [{ id: 'c1', from: 'a', to: 'b', label: 'HTTPS' }] };
    const r = await emit(chain, 'mermaid');
    expect(r.output).toContain('architecture-beta');
    expect(r.warnings.filter((w) => w.feature === 'connection.label')).toHaveLength(1);
    expect(r.output).not.toContain('HTTPS');
    // The shop platform falls back to a flowchart, which keeps its labels, so no label warning.
    const shop = await emit(loadFixture('architecture', 'valid'), 'mermaid');
    expect(shop.output).toContain('flowchart');
    expect(shop.warnings.filter((w) => w.feature === 'connection.label')).toEqual([]);
  });

  it('writes the direction of an ER diagram, as it does for state and class', async () => {
    const ir = loadFixture('er', 'valid-fk-anchors');
    expect(ir.direction).toBe('LR');
    const r = await emit(ir, 'mermaid');
    expect(r.output.split('\n').slice(3, 5)).toEqual(['erDiagram', '  direction LR']);
    expect(r.warnings).toEqual([]);
    const plain = await emit({ ...ir, direction: undefined }, 'mermaid');
    expect(plain.output).not.toContain('direction');
  });

  it('drops the ER direction line for the stable Mermaid form, with a warning unless it is the default', async () => {
    const ir = loadFixture('er', 'valid-fk-anchors');
    const r = await emit(ir, 'mermaid', { mermaidStable: true });
    expect(r.ok).toBe(true);
    expect(r.output).not.toContain('direction');
    const w = r.warnings.filter((x) => x.path === '/direction');
    expect(w).toHaveLength(1);
    expect(w[0].message).toContain('direction "LR" is not written for the stable Mermaid form');
    expect(w[0].message).toContain('top to bottom');
    const tb = await emit({ ...ir, direction: 'TB' }, 'mermaid', { mermaidStable: true });
    expect(tb.output).not.toContain('direction');
    expect(tb.warnings.filter((x) => x.path === '/direction')).toEqual([]);
  });

  it('returns validation errors instead of output for an invalid document', async () => {
    const r = await emit(loadFixture('flowchart', 'invalid-missing-edge-target'), 'mermaid');
    expect(r.ok).toBe(false);
    expect(r.output).toBeUndefined();
    expect(r.errors).toHaveLength(2);
  });
});
