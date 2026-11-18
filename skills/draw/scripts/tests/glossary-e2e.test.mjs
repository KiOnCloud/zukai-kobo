/**
 * The glossary commands end to end, through the committed bundle and from another working
 * directory, as an agent runs them: every exit code, the refusals of the option table, and
 * two writers at once.
 */
import { describe, it, expect } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scriptsDir, fixturesDir } from './helpers.mjs';

const cliPath = join(scriptsDir, 'bin', 'cli.mjs');
const elsewhere = mkdtempSync(join(tmpdir(), 'zukai-glossary-cwd-'));
const parse = (text) => text.trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return l; } }).at(-1);
const cli = (args, cwd = elsewhere) => {
  const r = spawnSync(process.execPath, [cliPath, ...args], { cwd, encoding: 'utf8' });
  return { code: r.status, out: parse(r.stdout), err: parse(r.stderr) };
};
const cliAsync = (args) => new Promise((done) => {
  const child = spawn(process.execPath, [cliPath, ...args], { cwd: elsewhere });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.on('close', (code) => done({ code, out: parse(out) }));
});
const project = () => {
  const root = mkdtempSync(join(tmpdir(), 'zukai-glossary-project-'));
  cpSync(join(fixturesDir, 'glossary', 'project'), root, { recursive: true });
  return { root, run: join(root, 'diagrams', '20261109_login-flow'), file: join(root, '.zukai', 'glossary.json') };
};
const entries = (dir, list) => {
  const file = join(dir, `entries-${Math.random().toString(16).slice(2)}.json`);
  writeFileSync(file, JSON.stringify({ entries: list }));
  return file;
};

describe('glossary commands through the bundle', () => {
  it('check exits 2 on the confirmed term a translated IR contradicts, and 0 once it is fixed', () => {
    const p = project();
    const r = cli(['glossary', 'check', p.run, '--root', p.root]);
    expect(r.code).toBe(2);
    expect(r.out).toMatchObject({ ok: false, blocking: 1, warnings: 2 });
    expect(r.out.findings[0]).toMatchObject({ kind: 'translation-mismatch', level: 'blocking', path: '/nodes/3/label', lang: 'ja', expected: '在庫確認' });
    const ja = join(p.run, 'source', 'ja', 'login-flow.ir.json');
    writeFileSync(ja, readFileSync(ja, 'utf8').replace('在庫チェック', '在庫確認'));
    const fixed = cli(['glossary', 'check', p.run, '--root', p.root]);
    expect(fixed.code).toBe(0);
    expect(fixed.out).toMatchObject({ ok: true, blocking: 0, warnings: 2 });
    expect(fixed.out.findings.every((f) => f.from === 'map')).toBe(true);
  });

  it('takes the working directory as the root', () => {
    const p = project();
    expect(cli(['glossary', 'check', join('diagrams', '20261109_login-flow')], p.root).code).toBe(2);
  });

  it('check exits 1 without a glossary or with one that does not match its schema', () => {
    const p = project();
    const empty = mkdtempSync(join(tmpdir(), 'zukai-glossary-none-'));
    expect(cli(['glossary', 'check', p.run, '--root', empty])).toMatchObject({ code: 1, err: { ok: false, errors: [{ message: 'the project has no glossary' }] } });
    writeFileSync(p.file, '{"schemaVersion": 2}');
    expect(cli(['glossary', 'check', p.run, '--root', p.root]).code).toBe(1);
    expect(cli(['glossary', 'check', join(p.root, 'diagrams'), '--root', p.root]).code).toBe(1);
  });

  it('lists, adds, sets and refuses what each subcommand does not take', () => {
    const p = project();
    expect(cli(['glossary', 'list', '--root', p.root, '--status', 'confirmed']).out).toMatchObject({ ok: true, exists: true, counts: { suggested: 1, confirmed: 2, rejected: 1 } });
    expect(cli(['glossary', 'list', '--root', p.root, '--status', 'confirmed']).out.entries).toHaveLength(2);
    const added = cli(['glossary', 'add', '--root', p.root, '--entries', entries(p.root, [{ terms: { en: 'desk', vi: 'bàn' } }, { terms: { en: 'sign in', ja: 'ログオン' } }])]);
    expect(added).toMatchObject({ code: 0, out: { ok: true, written: true, skipped: [{ id: 'g-e68e003a', status: 'rejected' }] } });
    expect(cli(['glossary', 'set', added.out.added[0], '--status', 'confirmed', '--root', p.root]).out).toMatchObject({ ok: true, status: 'confirmed' });
    expect(cli(['glossary', 'set', 'g-00000000', '--status', 'confirmed', '--root', p.root]).code).toBe(1);
    expect(cli(['glossary', 'add', '--status', 'rejected', '--root', p.root, '--entries', entries(p.root, [{ terms: { en: 'x' } }])]).code).toBe(1);
    const refused = cli(['glossary', 'pairs', '--status', 'confirmed', p.run]);
    expect(refused.code).toBe(1);
    expect(refused.err.errors[0]).toMatchObject({ message: 'glossary pairs does not take --status' });
    expect(refused.err.errors[0].hint).toContain('glossary list');
    expect(cli(['stale', '--entries', 'x', p.run]).err.errors[0].message).toBe('stale does not take --entries');
    expect(cli(['glossary']).code).toBe(1);
    expect(cli(['glossary', 'remove']).err.errors[0].message).toBe('unknown command "glossary remove"');
  });

  it('refuses a term with a token, an address, a line break or 81 characters and leaves the file as it was', () => {
    const p = project();
    const before = readFileSync(p.file, 'utf8');
    for (const terms of [{ en: 'ghp_' + 'a'.repeat(36) }, { en: 'jane.doe@acme.co.jp' }, { en: 'a\nb' }, { en: 'x'.repeat(81) }]) {
      expect(cli(['glossary', 'add', '--root', p.root, '--entries', entries(p.root, [{ terms }])]).code).toBe(1);
    }
    expect(readFileSync(p.file, 'utf8')).toBe(before);
  });

  it('pairs prints redacted label pairs and the count of keys it could not pair', () => {
    const p = project();
    const ja = join(p.run, 'source', 'ja', 'login-flow.ir.json');
    writeFileSync(ja, readFileSync(ja, 'utf8').replace('注文', '注文 jane.doe@acme.co.jp'));
    const r = cli(['glossary', 'pairs', p.run]);
    expect(r.code).toBe(0);
    expect(r.out.unpaired).toEqual({ title: 1, unknown: 1 });
    expect(r.out.pairs.find((x) => x.path === '/nodes/4/label' && x.from === 'ir').translated).toBe('注文 <redacted e-mail>');
  });

  it('keeps both of two adds started together, also when both find a stale lock', async () => {
    for (const stale of [false, true]) {
      const p = project();
      if (stale) {
        const lock = join(p.root, '.zukai', 'glossary.lock');
        writeFileSync(lock, 'gone\n');
        const old = new Date(Date.now() - 120_000);
        utimesSync(lock, old, old);
      }
      const words = ['chair', 'table', 'lamp', 'shelf'];
      const results = await Promise.all(words.map((w) => cliAsync(['glossary', 'add', '--root', p.root, '--entries', entries(p.root, [{ terms: { en: w } }])])));
      expect(results.map((r) => r.code)).toEqual([0, 0, 0, 0]);
      const list = cli(['glossary', 'list', '--root', p.root]).out.entries.map((e) => e.terms.en);
      expect(list).toEqual(expect.arrayContaining(words));
    }
  }, 30_000);
});
