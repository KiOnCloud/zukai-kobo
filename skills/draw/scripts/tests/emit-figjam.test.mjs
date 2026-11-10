import { describe, it, expect, beforeAll } from 'vitest';
import { emit } from '../src/pipeline.mjs';
import { figjamLabel } from '../src/mermaid-text.mjs';
import { loadFixture, validFixtures, loadMermaid } from './helpers.mjs';

describe('figjam target', () => {
  it('rejects the class kind with an error naming the target and the kind', async () => {
    const r = await emit(loadFixture('class', 'valid'), 'figjam');
    expect(r.ok).toBe(false);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].message).toContain('"class"');
    expect(r.errors[0].message).toContain('"figjam"');
    expect(r.errors[0].hint).toContain('--to');
  });

  it('emits the sequence fixture without front matter, notes, line breaks or entity codes', async () => {
    const r = await emit(loadFixture('sequence', 'valid'), 'figjam');
    expect(r.ok).toBe(true);
    expect(r.output.startsWith('sequenceDiagram\n')).toBe(true);
    expect(r.output).not.toContain('<br/>');
    expect(r.output).not.toMatch(/\bNote\b/);
    expect(r.output).not.toMatch(/#[a-z0-9]+;/);
    expect(r.warnings.filter((w) => w.feature === 'note')).toHaveLength(2);
    for (const line of r.output.split('\n')) expect(line).not.toMatch(/"[^"]*\n/);
  });

  it('renders architecture as a flowchart with boundaries as subgraphs and keeps connection labels', async () => {
    const r = await emit(loadFixture('architecture', 'valid'), 'figjam');
    expect(r.ok).toBe(true);
    expect(r.output.startsWith('flowchart LR\n')).toBe(true);
    expect(r.output).toMatch(/subgraph n\d+\["AWS account"\]/);
    expect(r.output).toMatch(/subgraph n\d+\["VPC"\]/);
    expect(r.output).toContain('-->|"HTTPS"|');
    expect(r.output).toContain('[("PostgreSQL")]');
    expect(r.warnings.map((w) => w.feature)).toEqual(['kind', 'connection.bidirectional']);
  });

  it('refuses the adversarial fixture unless --allow-sensitive is passed', async () => {
    const ir = loadFixture('adversarial', 'labels');
    const refused = await emit(ir, 'figjam');
    expect(refused.ok).toBe(false);
    expect(refused.errors.every((e) => e.message.startsWith('refusing to emit for figjam'))).toBe(true);
    expect(refused.errors.map((e) => e.path)).toEqual(['/meta/notes/0', '/nodes/6/label', '/nodes/7/label']);
    for (const e of refused.errors) expect(e.message).not.toContain('Sup3rS3cret');

    const allowed = await emit(ir, 'figjam', { allowSensitive: true });
    expect(allowed.ok).toBe(true);
    const labels = [...allowed.output.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
    expect(labels.length).toBeGreaterThan(10);
    for (const l of labels) expect(l).not.toMatch(/[<>{}|#%;&\n]/);
    expect(allowed.output).not.toContain('<br/>');
    expect(allowed.warnings.filter((w) => w.stage === 'emit').length).toBeGreaterThan(5);
  });

  it('sanitises labels and reports the alteration', () => {
    expect(figjamLabel('Say "hi"\nnow [b]')).toEqual({ label: "Say 'hi' now b", altered: true });
    expect(figjamLabel('Plain label')).toEqual({ label: 'Plain label', altered: false });
  });

  it('leaves the mermaid profile unchanged', async () => {
    const r = await emit(loadFixture('sequence', 'valid'), 'mermaid');
    expect(r.output).toContain('Note right of');
    expect(r.output.startsWith('---\n')).toBe(true);
  });
});

describe('mermaid.parse on every figjam profile output', () => {
  let mermaid;
  beforeAll(async () => {
    mermaid = await loadMermaid();
  }, 30_000);

  for (const { kind, name, ir } of validFixtures()) {
    if (ir.kind === 'class' || ir.kind === 'activity') continue;
    it(`parses ${kind}/${name}`, async () => {
      const r = await emit(ir, 'figjam', { allowSensitive: true });
      expect(r.ok).toBe(true);
      await expect(mermaid.parse(r.output)).resolves.toBeTruthy();
      await expect(r.output).toMatchFileSnapshot(`snapshots/figjam/${kind}-${name}.mmd`);
    });
  }
});
