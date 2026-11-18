import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashBytes, recordPathOf, recordSources, sourcePathProblem, staleRun } from '../src/sources.mjs';
import { loadFixture } from './helpers.mjs';

const sha = (text) => createHash('sha256').update(text).digest('hex');

describe('hashBytes', () => {
  it('is the SHA-256 of the bytes with CRLF read as LF', () => {
    expect(hashBytes(Buffer.from('a\nb\n'))).toBe(sha('a\nb\n'));
    expect(hashBytes(Buffer.from('a\r\nb\r\n'))).toBe(sha('a\nb\n'));
    expect(hashBytes(Buffer.from('a\rb\r'))).toBe(sha('a\rb\r'));
    expect(hashBytes(Buffer.from('a\r\r\nb'))).toBe(sha('a\r\nb'));
    expect(hashBytes(Buffer.alloc(0))).toBe(sha(''));
  });
});

describe('sourcePathProblem', () => {
  it('names what keeps a path from being project-relative', () => {
    expect(['src/a.ts', 'a.ts', './src/a.ts', 'src/a..b/c.ts', 'src/..hidden'].map(sourcePathProblem)).toEqual([undefined, undefined, undefined, undefined, undefined]);
    expect(['/etc/passwd', 'C:\\work\\a.ts', 'D:/a.ts', '\\\\host\\share\\a.ts', 'file:///a.ts'].map(sourcePathProblem)).toEqual(['absolute', 'absolute', 'absolute', 'absolute', 'absolute']);
    expect(['..', '../a.ts', 'src/../../a.ts'].map(sourcePathProblem)).toEqual(['outside', 'outside', 'outside']);
    expect(sourcePathProblem('src\\a.ts')).toBe('backslash');
  });
});

describe('recordSources and staleRun', () => {
  const setup = (name) => {
    const root = mkdtempSync(join(tmpdir(), 'zukai-sources-unit-'));
    const run = join(root, 'out', name);
    mkdirSync(join(run, 'source'), { recursive: true });
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src', 'a.js'), 'one\n');
    const ir = { ...loadFixture('flowchart', 'valid'), meta: { source: 'scout', sources: ['./src//a.js', 'src/a.js'] } };
    writeFileSync(join(run, 'source', 'main.ir.json'), JSON.stringify(ir));
    return { root, run };
  };

  it('names the record after the run slug, or after the folder when it is not named like a run', () => {
    expect(recordPathOf('/p/diagrams/20261117_login-by-staff')).toBe(join('/p/diagrams/20261117_login-by-staff', 'source', 'login-by-staff.sources.json'));
    expect(recordPathOf('/p/out/drawings')).toBe(join('/p/out/drawings', 'source', 'drawings.sources.json'));
  });

  it('records one spelling of a path once, at the time given', () => {
    const { root, run } = setup('20261117_main');
    const r = recordSources(run, { root, now: new Date('2026-11-17T00:00:00Z') });
    expect(r).toMatchObject({ ok: true, recordedAt: '2026-11-17T00:00:00.000Z', diagrams: [{ id: 'main', files: 1 }] });
    expect(JSON.parse(readFileSync(r.record, 'utf8'))).toEqual({
      sources: 1, root: '../..', lineEndings: 'lf',
      diagrams: [{ id: 'main', from: 'meta.sources', recordedAt: '2026-11-17T00:00:00.000Z', files: [{ path: 'src/a.js', sha256: sha('one\n') }] }],
    });
    expect(staleRun(run)).toMatchObject({ ok: true, stale: false, root });
    writeFileSync(join(root, 'src', 'a.js'), 'two\n');
    expect(staleRun(run)).toMatchObject({ stale: true, diagrams: [{ id: 'main', recordedAt: '2026-11-17T00:00:00.000Z', changed: ['src/a.js'], deleted: [] }] });
  });

  it('refuses --only with a root other than the one the record was taken with', () => {
    const { root, run } = setup('20261117_main');
    expect(recordSources(run, { root }).ok).toBe(true);
    expect(recordSources(run, { root: join(root, 'src'), only: ['main'] })).toMatchObject({ ok: false, code: 1 });
    expect(recordSources(run, { only: ['main'] })).toMatchObject({ ok: true, root });
  });
});
