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

  it('writes a composite state as a label line and a body line, the form Figma names correctly', async () => {
    const r = await emit(loadFixture('state', 'valid'), 'figjam');
    expect(r.output).toContain('  state "Processing" as n4\n  state n4 {\n');
    expect(r.output).not.toMatch(/" as n\d+ \{/);
    // The mermaid profile keeps the one-line form.
    expect((await emit(loadFixture('state', 'valid'), 'mermaid')).output).toMatch(/state "Processing" as n\d+ \{/);
  });

  it('always states the ER direction and keeps a type with a comma readable for Figma', async () => {
    const r = await emit(loadFixture('er', 'valid'), 'figjam');
    expect(r.output.startsWith('erDiagram\n  direction TB\n')).toBe(true);
    expect(r.output).toContain('    decimal total "decimal(10,2)"');
    for (const line of r.output.split('\n').filter((l) => /^ {4}\S/.test(l))) expect(line.split('"')[0]).not.toContain(',');
    expect(r.warnings.filter((w) => w.path === '/entities/1/attributes/3/type')).toHaveLength(1);
    // A relation without a label gets none on the board either; nothing was changed, so nothing warns.
    expect(r.output).toContain('n2 |o..o{ n5 : ""');
    expect(r.output).not.toContain('unnamed');
    expect(r.warnings.filter((w) => w.path.startsWith('/relations'))).toEqual([]);
    const lr = await emit(loadFixture('er', 'valid-fk-anchors'), 'figjam');
    expect(lr.output).toContain('  direction LR\n');
    expect(lr.warnings.filter((w) => w.path === '/direction')).toEqual([]);
    // A comment the attribute already has follows the type.
    const ir = structuredClone(loadFixture('er', 'valid'));
    ir.entities[1].attributes[3].comment = 'gross';
    expect((await emit(ir, 'figjam')).output).toContain('    decimal total "decimal(10,2) - gross"');
  });

  it('emits the sequence fixture without front matter, Note statements, line breaks or entity codes', async () => {
    const r = await emit(loadFixture('sequence', 'valid'), 'figjam');
    expect(r.ok).toBe(true);
    expect(r.output.startsWith('sequenceDiagram\n')).toBe(true);
    expect(r.output).not.toContain('<br/>');
    expect(r.output).not.toMatch(/\bNote\b/);
    expect(r.output).not.toMatch(/#[a-z0-9]+;/);
    expect(r.warnings.filter((w) => w.feature === 'note')).toHaveLength(2);
    // A note keeps a row of its own: a message of its first participant to itself.
    expect(r.output).toContain('    n2->>n2: Rate limited per IP\n');
    expect(r.output).toContain('    n3->>n3: Hash: argon2id\n');
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
    // Figma draws `<-->` with an arrow head at both ends, so a two-way connection is not degraded.
    expect(r.output).toContain('<-->|"cache aside"|');
    expect(r.warnings.map((w) => w.feature)).toEqual(['kind']);
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
