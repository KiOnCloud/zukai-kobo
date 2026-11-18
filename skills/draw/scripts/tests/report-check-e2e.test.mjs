/**
 * `report check` end to end through the bundle: a report held to the project glossary (an
 * avoided word found and cleared), a translation that keeps a term the same across languages
 * and one that changes it, a dropped section, a credential, and a project without a glossary.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scriptsDir } from './helpers.mjs';

const cliPath = join(scriptsDir, 'bin', 'cli.mjs');
const elsewhere = mkdtempSync(join(tmpdir(), 'zukai-check-cwd-'));
const parse = (text) => text.trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return l; } }).at(-1);
const cli = (args) => {
  const r = spawnSync(process.execPath, [cliPath, ...args], { cwd: elsewhere, encoding: 'utf8' });
  return { code: r.status, out: parse(r.stdout), err: parse(r.stderr) };
};

/** A project with a confirmed glossary and one report whose summary is `text`. */
function setup(text, entries) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'zukai-check-project-')));
  if (entries) {
    const file = join(root, 'entries.json');
    writeFileSync(file, JSON.stringify({ entries }));
    expect(cli(['glossary', 'add', '--entries', file, '--status', 'confirmed', '--root', root]).code).toBe(0);
  }
  const made = cli(['report', 'new', '--template', 'tech-research', '--title', 'Office queues', '--root', root]).out;
  const md = readFileSync(join(made.path, 'report.md'), 'utf8').replace('<!-- zukai:section id="question" -->', `<!-- zukai:section id="question" -->\n${text}`);
  writeFileSync(join(made.path, 'report.md'), md);
  return { root, dir: made.path, md };
}

describe('report check', () => {
  it('blocks an avoided word with its line and section, and passes once the sentence uses the confirmed term', { timeout: 120_000 }, () => {
    const { dir, md } = setup('Which queue should the bureau use?', [{ terms: { en: 'office', ja: 'office' }, avoid: { en: ['bureau'] } }]);
    const r = cli(['report', 'check', dir]);
    expect(r.code).toBe(2);
    expect(r.out).toMatchObject({ ok: false, blocking: 1, glossary: 'checked' });
    expect(r.out.findings[0]).toMatchObject({ kind: 'avoided-term', level: 'blocking', file: 'report.md', section: 'question', avoided: 'bureau', expected: 'office', line: md.split('\n').findIndex((l) => l.includes('bureau')) + 1 });
    writeFileSync(join(dir, 'report.md'), md.replace('the bureau', 'the office'));
    expect(cli(['report', 'check', dir])).toMatchObject({ code: 0, out: { ok: true, blocking: 0 } });
  });

  it('keeps a term the same across languages in a translation and flags a changed one', { timeout: 120_000 }, () => {
    const { dir, md } = setup('Which queue should the office use?', [{ terms: { en: 'office', ja: 'office' } }]);
    mkdirSync(join(dir, 'ja'));
    writeFileSync(join(dir, 'ja', 'report.md'), md.replace('Which queue should the office use?', 'office ではどのキューを使うべきか?'));
    expect(cli(['report', 'check', dir])).toMatchObject({ code: 0, out: { reports: [{ translations: ['ja'] }] } });
    writeFileSync(join(dir, 'ja', 'report.md'), md.replace('Which queue should the office use?', 'オフィスではどのキューを使うべきか?'));
    const r = cli(['report', 'check', dir]);
    expect(r.code).toBe(2);
    expect(r.out.findings).toEqual([expect.objectContaining({ kind: 'kept-term-changed', file: 'ja/report.md', section: 'question', expected: 'office' })]);
  });

  it('reports a translation that dropped a section once', { timeout: 120_000 }, () => {
    const { dir, md } = setup('A question.', [{ terms: { en: 'office', ja: 'office' } }]);
    mkdirSync(join(dir, 'ja'));
    writeFileSync(join(dir, 'ja', 'report.md'), md.replace(/## Context\n<!-- zukai:section id="context" -->\n/, ''));
    const r = cli(['report', 'check', dir]);
    expect(r.code).toBe(2);
    expect(r.out.findings).toEqual([expect.objectContaining({ kind: 'sections-differ', missing: ['context'] })]);
  });

  it('finds a credential without a glossary, and refuses to render it', { timeout: 120_000 }, () => {
    const { dir } = setup('The deploy key is ghp_0123456789abcdefghijklmnopqrstuvwxyzAB.');
    const r = cli(['report', 'check', dir]);
    expect(r.code).toBe(2);
    expect(r.out).toMatchObject({ glossary: 'missing', blocking: 1, findings: [expect.objectContaining({ kind: 'secret', level: 'blocking', file: 'report.md' })] });
    expect(cli(['report', 'render', dir]).code).toBe(2);
  });

  it('exits 1 for an invalid glossary', { timeout: 120_000 }, () => {
    const { root, dir } = setup('A question.');
    mkdirSync(join(root, '.zukai'), { recursive: true });
    writeFileSync(join(root, '.zukai', 'glossary.json'), '{ broken');
    expect(cli(['report', 'check', dir]).code).toBe(1);
  });
});
