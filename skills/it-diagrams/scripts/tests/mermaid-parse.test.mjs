import { describe, it, expect, beforeAll } from 'vitest';
import { emit } from '../src/pipeline.mjs';
import { validFixtures, loadMermaid } from './helpers.mjs';

const EXPECTED_TYPE = {
  flowchart: 'flowchart-v2',
  sequence: 'sequence',
  state: 'stateDiagram',
  er: 'er',
  class: 'classDiagram',
  architecture: 'architecture',
  activity: 'swimlane',
};

describe('mermaid.parse on every emitted diagram', () => {
  let mermaid;
  beforeAll(async () => {
    mermaid = await loadMermaid();
  }, 30_000);

  for (const { kind, name, ir } of validFixtures()) {
    it(`parses ${kind}/${name}`, async () => {
      const r = await emit(ir, 'mermaid');
      expect(r.ok).toBe(true);
      const parsed = await mermaid.parse(r.output);
      // An architecture the grid planner cannot place is emitted as a flowchart on purpose.
      const expected = ir.kind === 'architecture' && r.output.includes('flowchart ') ? 'flowchart-v2' : EXPECTED_TYPE[ir.kind];
      expect(parsed.diagramType).toBe(expected);
    });
  }

  it('rejects a deliberately broken diagram, proving the parser is active', async () => {
    await expect(mermaid.parse('flowchart TB\n  a --> \n  --> b\n')).rejects.toThrow();
  });
});
