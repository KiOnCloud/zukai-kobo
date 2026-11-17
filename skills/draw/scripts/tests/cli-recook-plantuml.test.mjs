import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scriptsDir } from './helpers.mjs';

const cli = join(scriptsDir, 'bin', 'cli.mjs');
const sources = join(scriptsDir, 'tests', 'recook-sources', 'plantuml');
const cwd = mkdtempSync(join(tmpdir(), 'zukai-cli-plantuml-'));

function run(args) {
  const r = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });
  const last = (text) => (text.trim() ? JSON.parse(text.trim().split('\n').pop()) : undefined);
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, json: r.status === 0 ? last(r.stdout) : undefined, error: r.status !== 0 ? last(r.stderr) : undefined };
}

/** A run folder holding the IRs the mapping gives for one source, and its facts. */
function makeRun(source, slug) {
  const dir = join(cwd, 'diagrams', `20261117_${slug}`);
  mkdirSync(join(dir, 'source'), { recursive: true });
  const facts = join(dir, 'source', `${slug}.facts.json`);
  const r = run(['extract', join(sources, `${source}.puml`), '--out', facts]);
  expect(r.code).toBe(0);
  for (const f of readdirSync(join(sources, 'ir')).filter((x) => x === `${source}.ir.json` || x.startsWith(`${source}-0`))) copyFileSync(join(sources, 'ir', f), join(dir, 'source', f));
  return { dir, facts, summary: r.json };
}

describe('cli recook of PlantUML sources (committed bundle, another working directory)', { timeout: 30000 }, () => {
  it('extract reads a .puml file and prints the page with its kind hint and warnings', () => {
    const { summary, facts } = makeRun('checkout-sequence', 'checkout');
    expect(summary).toMatchObject({ ok: true, format: 'plantuml', pages: [{ id: 'plantuml-1', name: 'Checkout: place an order', nodes: 15, edges: 14 }] });
    expect(summary.pages[0].kindHints[0]).toMatchObject({ kind: 'sequence', evidence: ['7 participants', '14 messages', '3 blocks'] });
    expect(summary.pages[0].warnings).toEqual(['line 3: !include of ./theme.iuml is not followed: what that file declares is not in these facts']);
    const written = JSON.parse(readFileSync(facts, 'utf8'));
    expect(written).toMatchObject({ facts: 1, format: 'plantuml' });
    expect(written.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([
    ['checkout-sequence', 'sequence'],
    ['billing-classes', 'class'],
    ['ticket-states', 'state'],
    ['leave-request-activity', 'activity'],
    ['shop-deployment', 'architecture'],
    ['shop-entities', 'er'],
  ])('%s: the IRs of the mapping validate, cover the facts and emit draw.io', (source, kind) => {
    const { dir, facts, summary } = makeRun(source, `${kind}-run`);
    expect(summary.pages[0].kindHints[0].kind).toBe(kind);
    for (const f of readdirSync(join(dir, 'source')).filter((x) => x.endsWith('.ir.json'))) {
      const v = run(['validate', join(dir, 'source', f)]);
      expect([f, v.code, v.stderr]).toEqual([f, 0, expect.any(String)]);
    }
    const covered = run(['cover', facts, dir]);
    expect(covered.code).toBe(0);
    expect(covered.json).toMatchObject({ ok: true, missing: [] });
    expect(covered.json.covered).toBe(covered.json.units);
    const out = join(dir, `${source}.drawio`);
    const emitted = run(['emit', '--to', 'drawio', '--out', out, join(dir, 'source', `${source}.ir.json`)]);
    expect(emitted.code).toBe(0);
    expect(readFileSync(out, 'utf8')).toMatch(/<mxfile/);
  });

  it('cover exits 2 and names the label an IR dropped', () => {
    const { dir, facts } = makeRun('ticket-states', 'dropped');
    const file = join(dir, 'source', 'ticket-states.ir.json');
    const ir = JSON.parse(readFileSync(file, 'utf8'));
    ir.transitions = ir.transitions.filter((t) => t.event !== 'customer replied');
    ir.meta.omitted = ir.meta.omitted.filter((o) => !o.includes('enterprise'));
    writeFileSync(file, JSON.stringify(ir));
    const r = run(['cover', facts, dir]);
    expect(r.code).toBe(2);
    expect(r.error.ok).toBe(false);
    expect(r.error.missing.map((m) => m.text)).toEqual(['Only for', 'enterprise plans', 'customer replied']);
  });

  it('a credential in a label is redacted in the facts file and reported', () => {
    const { facts, summary } = makeRun('shop-deployment', 'redacted');
    expect(summary.pages[0].warnings.at(-1)).toMatch(/1 text holds what looks like a credential or personal data \(uri-credential\)/);
    const text = readFileSync(facts, 'utf8');
    expect(text).not.toContain('S3cr3tPass99');
    expect(text).toContain('jdbc:postgresql://<redacted credential>@db.internal:5432/orders');
    expect(JSON.parse(text).pages[0].direction).toBe('LR');
  });

  it('a use case source gives facts with the usecase hint', () => {
    const r = run(['extract', join(sources, 'library-usecases.puml'), '--out', 'usecases.facts.json']);
    expect(r.code).toBe(0);
    expect(r.json.pages[0]).toMatchObject({ name: 'Library system', nodes: 12, edges: 9, warnings: [] });
    expect(r.json.pages[0].kindHints[0]).toMatchObject({ kind: 'usecase', evidence: ['7 use cases', '3 actors', '2 include or extend arrows', '1 system boundary'] });
  });

  it('reports each unsupported diagram of a file per page, and --page keeps the ones asked for', () => {
    const all = run(['extract', join(sources, 'several-diagrams.puml'), '--out', 'several.facts.json']);
    expect(all.code).toBe(0);
    expect(all.json.pages.map((p) => [p.id, p.nodes, p.warnings.length])).toEqual([['plantuml-1', 2, 0], ['plantuml-2', 0, 1], ['plantuml-3', 3, 0], ['plantuml-4', 0, 1], ['plantuml-5', 0, 1], ['plantuml-6', 0, 1]]);
    expect(all.json.pages[1].warnings[0]).toMatch(/mind map is not read/);
    expect(all.json.pages[3].warnings[0]).toMatch(/activity diagram in the legacy syntax is not read/);
    expect(all.json.pages[4].warnings[0]).toMatch(/Gantt chart is not read/);
    expect(all.json.pages[5].warnings[0]).toMatch(/Salt wireframe is not read/);
    expect(JSON.parse(readFileSync(join(cwd, 'several.facts.json'), 'utf8')).pages[1].unsupported).toEqual({ type: 'mind map', reason: 'Zukai has no mind map kind' });
    const some = run(['extract', join(sources, 'several-diagrams.puml'), '--page', 'Door,login', '--out', 'two.facts.json']);
    expect(some.json.pages.map((p) => p.name)).toEqual(['login', 'Door']);
    const none = run(['extract', join(sources, 'several-diagrams.puml'), '--page', 'Window']);
    expect(none.code).toBe(1);
    expect(none.error.errors[0].hint).toMatch(/plantuml-3 \("Door"\)/);
  });

  it('reads the plantuml fences of a Markdown file from a relative path', () => {
    copyFileSync(join(sources, 'payment-notes.md'), join(cwd, 'payment-notes.md'));
    const r = spawnSync(process.execPath, [cli, 'extract', 'payment-notes.md'], { cwd, encoding: 'utf8' });
    expect(r.status).toBe(0);
    const facts = JSON.parse(r.stdout);
    expect(facts).toMatchObject({ format: 'plantuml', file: 'payment-notes.md' });
    expect(facts.pages.map((p) => [p.name, p.kindHints[0].kind])).toEqual([['Refund flow', 'sequence'], ['Modules', 'architecture']]);
  });

  it('reads PlantUML saved under another extension, and still refuses what is no diagram', () => {
    writeFileSync(join(cwd, 'door.txt'), '@startuml\n[*] --> Closed\nClosed --> Open : open\n@enduml\n');
    const r = run(['extract', 'door.txt', '--out', 'door.facts.json']);
    expect(r.code).toBe(0);
    expect(r.json).toMatchObject({ format: 'plantuml', pages: [{ nodes: 3, edges: 2 }] });
    writeFileSync(join(cwd, 'notes.txt'), 'just some text\n');
    const bad = run(['extract', 'notes.txt']);
    expect(bad.code).toBe(1);
    expect(bad.error.errors[0].message).toMatch(/no Mermaid and no PlantUML diagram/);
    expect(existsSync(join(cwd, 'notes.facts.json'))).toBe(false);
  });
});
