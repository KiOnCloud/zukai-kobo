/**
 * Reports end to end, through the committed bundle and from another working directory, as an
 * agent runs them: the reports folder setting and its isolation from every run command, a
 * report written, rendered, snapshotted, restored, polished through a draft and diffed, two
 * writers snapshotting at once, and a project that holds only reports in the run index.
 */
import { describe, it, expect } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scriptsDir, fixturesDir } from './helpers.mjs';

const cliPath = join(scriptsDir, 'bin', 'cli.mjs');
const elsewhere = mkdtempSync(join(tmpdir(), 'zukai-reports-cwd-'));
const parse = (text) => text.trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return l; } }).at(-1);
const cli = (args, env = {}) => {
  const r = spawnSync(process.execPath, [cliPath, ...args], { cwd: elsewhere, encoding: 'utf8', env: { ...process.env, ...env } });
  return { code: r.status, out: parse(r.stdout), err: parse(r.stderr) };
};
const cliAsync = (args) => new Promise((done) => {
  const child = spawn(process.execPath, [cliPath, ...args], { cwd: elsewhere });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.on('close', (code) => done({ code, out: parse(out) }));
});
/** A project with the glossary sample's run under `runsDir` (default diagrams) and a setting when given. */
const project = (config) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'zukai-reports-project-')));
  if (config) {
    mkdirSync(join(root, '.zukai'), { recursive: true });
    writeFileSync(join(root, '.zukai', 'config.json'), JSON.stringify({ config: 1, ...config }));
  }
  const runs = join(root, ...(config?.runsDir ?? 'diagrams').split('/'));
  cpSync(join(fixturesDir, 'glossary', 'project', 'diagrams', '20261109_login-flow'), join(runs, '20261109_login-flow'), { recursive: true });
  return { root, run: join(runs, '20261109_login-flow') };
};
const newReport = (root, extra = []) => {
  const r = cli(['report', 'new', '--template', 'issue-investigation', '--title', 'Checkout fails', '--root', root, ...extra]);
  expect(r.code, JSON.stringify(r.err)).toBe(0);
  return r.out;
};

describe('reports folder setting', () => {
  it('prints and sets reports-dir, refusing an overlap with the runs folder both ways', { timeout: 120_000 }, () => {
    const { root } = project();
    expect(cli(['reports-dir', '--root', root])).toMatchObject({ code: 0, out: { ok: true, reportsDir: 'reports', from: 'default' } });
    expect(cli(['runs-dir', 'set', 'reports/diagrams', '--root', root])).toMatchObject({ code: 1, err: { ok: false, error: { code: 'bad-config' } } });
    expect(cli(['reports-dir', 'set', 'diagrams/reports', '--root', root])).toMatchObject({ code: 1, err: { error: { code: 'bad-config' } } });
    expect(cli(['reports-dir', 'set', 'docs/reports', '--root', root])).toMatchObject({ code: 0, out: { ok: true, reportsDir: 'docs/reports', previous: 'reports' } });
    expect(cli(['reports-dir', '--root', root]).out).toMatchObject({ reportsDir: 'docs/reports', from: 'config' });
  });

  it('a bad reportsDir stops the report commands with bad-config and writes nothing, while every run command works', { timeout: 120_000 }, () => {
    const { root, run } = project({ reportsDir: '../outside' });
    const r = cli(['report', 'new', '--template', 'feature', '--title', 'x', '--root', root]);
    expect(r).toMatchObject({ code: 1, err: { ok: false, error: { code: 'bad-config' } } });
    expect(existsSync(join(root, 'reports'))).toBe(false);
    expect(cli(['report', 'list', '--root', root])).toMatchObject({ code: 1, err: { error: { code: 'bad-config' } } });
    expect(cli(['reports-dir', '--root', root]).code).toBe(1);
    expect(cli(['runs-dir', '--root', root])).toMatchObject({ code: 0, out: { runsDir: 'diagrams' } });
    expect(cli(['bundle', '--to', 'mermaid', '--out', join(root, 'out.md'), run]).code).toBe(0);
    expect(cli(['snapshot', run]).code).toBe(0);
    expect(cli(['index', 'list'])).toMatchObject({ code: 0 });
  });

  it('keeps every run command of a 2.6.0 project whose runs folder is reports/, and asks for another reports folder', { timeout: 120_000 }, () => {
    const { root, run } = project({ runsDir: 'reports' });
    expect(cli(['runs-dir', '--root', root])).toMatchObject({ code: 0, out: { runsDir: 'reports' } });
    expect(cli(['bundle', '--to', 'drawio', '--out', join(run, 'login-flow.drawio'), run]).code).toBe(0);
    expect(cli(['snapshot', run]).code).toBe(0);
    const r = cli(['report', 'new', '--template', 'feature', '--title', 'x', '--root', root]);
    expect(r).toMatchObject({ code: 1, err: { error: { code: 'bad-config', hint: expect.stringMatching(/reports-dir set/) } } });
    expect(cli(['reports-dir', 'set', 'docs/reports', '--root', root]).code).toBe(0);
    expect(newReport(root).path).toContain(join('docs', 'reports'));
  });
});

describe('a report through the bundle', () => {
  it('writes, renders, checks, snapshots, restores the exact bytes and lists', { timeout: 120_000 }, () => {
    const { root } = project();
    const made = newReport(root, ['--runs', '20261109_login-flow']);
    expect(made).toMatchObject({ ok: true, template: { id: 'issue-investigation', scope: 'built-in' }, lang: 'en' });
    expect(made.sections.map((s) => s.id)).toContain('root-cause');
    expect(made.sections[0].guide).toMatch(/Three to five sentences/);
    const dir = made.path;
    const text = readFileSync(join(dir, 'report.md'), 'utf8').replace('<!-- zukai:section id="summary" -->', '<!-- zukai:section id="summary" -->\nThe pool ran out.');
    writeFileSync(join(dir, 'report.md'), text);
    expect(cli(['report', 'render', dir])).toMatchObject({ code: 0, out: { ok: true, html: join(dir, 'report.html') } });
    expect(readFileSync(join(dir, 'report.html'), 'utf8')).toContain('The pool ran out.');
    expect(cli(['report', 'snapshot', dir, '--request', 'first'])).toMatchObject({ code: 0, out: { rev: 'r001' } });
    writeFileSync(join(dir, 'report.md'), 'changed\n');
    expect(cli(['report', 'diff', dir, 'r001', 'current']).out).toMatchObject({ ok: true, added: 1 });
    const restored = cli(['report', 'restore', dir, 'r001']);
    expect(restored).toMatchObject({ code: 0, out: { restored: 'r001', snapshot: 'r002', rendered: ['report.html'] } });
    expect(readFileSync(join(dir, 'report.md'), 'utf8')).toBe(text);
    expect(cli(['report', 'revisions', dir]).out.revisions.map((r) => r.rev)).toEqual(['r002', 'r001']);
    expect(cli(['report', 'list', '--root', root]).out.reports.map((r) => r.name)).toEqual([made.name]);
    expect(cli(['report', 'restore', dir, '../r001']).code).toBe(1);
  });

  it('polishes through a draft made from the rev check printed, and refuses a stale one', { timeout: 120_000 }, () => {
    const { root } = project();
    const dir = newReport(root).path;
    const rev = cli(['report', 'check', dir]).out.reports[0].rev;
    const draft = join(elsewhere, `draft-${Date.now()}.md`);
    writeFileSync(draft, '# Checkout fails\n\npolished\n');
    const d = cli(['report', 'draft', dir, '--file', draft, '--base-rev', rev]);
    expect(d).toMatchObject({ code: 0, out: { draft: 'polish-1' } });
    expect(cli(['report', 'diff', dir, 'current', 'polish-1']).out.added).toBeGreaterThan(0);
    expect(cli(['report', 'apply', dir, 'polish-1', '--base-rev', rev, '--draft-rev', d.out.draftRev])).toMatchObject({ code: 0, out: { applied: 'polish-1', rendered: ['report.html'] } });
    expect(cli(['report', 'draft', dir, '--file', draft, '--base-rev', rev])).toMatchObject({ code: 1, err: { error: { code: 'conflict' } } });
  });

  it('takes two snapshots made at once, numbered in order', { timeout: 120_000 }, async () => {
    const { root } = project();
    const dir = newReport(root).path;
    const [a, b] = await Promise.all([cliAsync(['report', 'snapshot', dir]), cliAsync(['report', 'snapshot', dir])]);
    expect([a.code, b.code]).toEqual([0, 0]);
    expect([a.out.rev, b.out.rev].sort()).toEqual(['r001', 'r002']);
    expect(readdirSync(join(dir, 'history')).sort()).toEqual(['r001', 'r002']);
  });

  it('refuses unknown options, a missing template and a folder that is no report', { timeout: 120_000 }, () => {
    const { root } = project();
    expect(cli(['report', 'new', '--template', 'feature', '--title', 'x', '--root', root, '--keep', '3']).code).toBe(1);
    expect(cli(['report', 'new', '--template', 'nope', '--title', 'x', '--root', root])).toMatchObject({ code: 1, err: { error: { code: 'not-found' } } });
    expect(cli(['report', 'render', join(root, 'diagrams')]).code).toBe(1);
    expect(cli(['report', 'nope']).code).toBe(1);
  });

  it('registers a project that holds only reports in the run index', { timeout: 120_000 }, () => {
    const home = mkdtempSync(join(tmpdir(), 'zukai-reports-home-'));
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'zukai-reports-only-')));
    expect(cli(['report', 'new', '--template', 'tech-research', '--title', 'Queues', '--root', root], { ZUKAI_HOME: home }).code).toBe(0);
    expect(cli(['index', 'list'], { ZUKAI_HOME: home }).out.projects.map((p) => p.root)).toEqual([root]);
  });
});
