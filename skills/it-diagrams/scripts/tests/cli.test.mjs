import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scriptsDir, fixturesDir } from './helpers.mjs';

const cli = join(scriptsDir, 'bin', 'cli.mjs');
const otherCwd = mkdtempSync(join(tmpdir(), 'it-diagrams-cli-'));

function run(args, cwd = otherCwd) {
  const r = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

const parseStderr = (s) => JSON.parse(s.trim().split('\n').pop());

describe('cli (committed bundle, run from a different working directory)', () => {
  it('validate exits 0 and prints kind and title for a valid file', () => {
    const r = run(['validate', join(fixturesDir, 'flowchart', 'valid.json')]);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ ok: true, kind: 'flowchart', title: 'Order checkout' });
  });

  it('validate exits 2 and prints every error as JSON on stderr', () => {
    const r = run(['validate', join(fixturesDir, 'flowchart', 'invalid-missing-edge-target.json')]);
    expect(r.code).toBe(2);
    expect(r.stdout).toBe('');
    const payload = parseStderr(r.stderr);
    expect(payload.ok).toBe(false);
    expect(payload.errors).toHaveLength(2);
    expect(payload.errors.map((e) => e.path)).toEqual(['/nodes/0/shape', '/edges/0/to']);
  });

  it('emit --to mermaid writes the diagram to stdout and warnings to stderr', () => {
    const r = run(['emit', '--to', 'mermaid', join(fixturesDir, 'sequence', 'valid.json')]);
    expect(r.code).toBe(0);
    expect(r.stdout.startsWith('---\ntitle: "Login with password"\n---\nsequenceDiagram\n')).toBe(true);
    expect(r.stderr).toBe('');
    // The figjam profile degrades the database and control participants, so it warns.
    const fig = run(['emit', '--to', 'figjam', join(fixturesDir, 'sequence', 'valid.json')]);
    expect(fig.code).toBe(0);
    expect(parseStderr(fig.stderr).warnings.filter((w) => w.path.startsWith('/participants'))).toHaveLength(2);
  });

  it('emit --out writes the file relative to the working directory', () => {
    const out = join(otherCwd, 'nested', 'login.mmd');
    const r = run(['emit', '--to', 'mermaid', join(fixturesDir, 'sequence', 'valid.json'), '--out', 'nested/login.mmd']);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ ok: true, out, warnings: 0 });
    expect(existsSync(out)).toBe(true);
    expect(readFileSync(out, 'utf8')).toContain('sequenceDiagram');
  });

  it('emit exits 2 on an invalid document and 1 on a missing file, bad JSON or bad usage', () => {
    expect(run(['emit', '--to', 'mermaid', join(fixturesDir, 'er', 'invalid-unknown-entity.json')]).code).toBe(2);
    expect(run(['emit', '--to', 'mermaid', join(otherCwd, 'missing.json')]).code).toBe(1);
    expect(run(['emit', '--to', 'visio', join(fixturesDir, 'er', 'valid.json')]).code).toBe(2);
    expect(run(['emit', join(fixturesDir, 'er', 'valid.json')]).code).toBe(1);
    expect(run(['frobnicate']).code).toBe(1);
    expect(run(['validate', join(scriptsDir, 'package.json')]).code).toBe(2);
    expect(run(['validate', join(scriptsDir, 'build.mjs')]).code).toBe(1);
  });
});
