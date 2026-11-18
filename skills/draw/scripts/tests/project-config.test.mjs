import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkRunsDir, readProjectConfig, runsPath, runsDirOf, projectOfRun, setRunsDir, runFolderPattern, runDirAt, ConfigError } from '../src/project-config.mjs';
import { ensureZukaiDir } from '../src/glossary.mjs';

const project = (config) => {
  const root = mkdtempSync(join(tmpdir(), 'zukai-config-'));
  if (config !== undefined) {
    mkdirSync(join(root, '.zukai'), { recursive: true });
    writeFileSync(join(root, '.zukai', 'config.json'), typeof config === 'string' ? config : JSON.stringify(config));
  }
  return root;
};
const link = (target, path) => { try { symlinkSync(target, path, 'junction'); return true; } catch { return false; } };

describe('project config', () => {
  it('defaults to diagrams/ without a file or without runsDir', () => {
    const root = project();
    expect(readProjectConfig(root)).toMatchObject({ ok: true, runsDir: 'diagrams', from: 'default' });
    expect(runsPath(root)).toBe(join(root, 'diagrams'));
    const other = project({ config: 1, theme: 'x' });
    expect(readProjectConfig(other)).toMatchObject({ ok: true, runsDir: 'diagrams', from: 'default' });
  });

  it('reads runsDir from .zukai/config.json', () => {
    const root = project({ config: 1, runsDir: 'docs/diagrams' });
    expect(readProjectConfig(root)).toMatchObject({ ok: true, runsDir: 'docs/diagrams', from: 'config' });
    expect(runsPath(root)).toBe(join(root, 'docs', 'diagrams'));
    expect(runsDirOf(root)).toBe('docs/diagrams');
    expect(runFolderPattern(root)).toBe('docs/diagrams/<yyyymmdd>_<run-slug>');
  });

  it('refuses every value that leaves the project or lands in its state', () => {
    const root = project();
    for (const value of ['', '/abs/path', 'C:/x', '../x', 'a/../b', './x', 'a//b', 'a\\b', '.zukai', '.zukai/runs', '.git', '.GIT/x', 'a:b', 'x\u0000', 7, null]) {
      expect(checkRunsDir(root, value), JSON.stringify(value)).toBeDefined();
    }
    for (const value of ['diagrams', 'docs/diagrams', 'docs/diagrams/', 'design docs/図解', '.github-pages/diagrams']) {
      expect(checkRunsDir(root, value), value).toBeUndefined();
    }
  });

  it('refuses a link that leads out of the project, and one into .git', () => {
    const root = project();
    const outside = mkdtempSync(join(tmpdir(), 'zukai-config-outside-'));
    if (!link(outside, join(root, 'docs'))) return;
    expect(checkRunsDir(root, 'docs')).toMatchObject({ message: expect.stringMatching(/leads out of the project/) });
    expect(checkRunsDir(root, 'docs/diagrams')).toMatchObject({ message: expect.stringMatching(/leads out of the project/) });
    mkdirSync(join(root, '.git'));
    link(join(root, '.git'), join(root, 'sneaky'));
    expect(checkRunsDir(root, 'sneaky/runs')).toMatchObject({ message: expect.stringMatching(/\.git/) });
  });

  it('gives bad-config for broken JSON, a wrong config number and a bad runsDir, and runsPath throws it', () => {
    for (const [config, pattern] of [['{ not json', /not valid JSON/], ['[]', /JSON object/], [{ config: 2, runsDir: 'x' }, /"config": 2/], [{ config: 1, runsDir: '../out' }, /\.\./]]) {
      const root = project(config);
      const read = readProjectConfig(root);
      expect(read.ok).toBe(false);
      expect(read.error).toBeInstanceOf(ConfigError);
      expect(read.error.toJSON()).toMatchObject({ code: 'bad-config', message: expect.stringMatching(pattern), hint: expect.any(String), path: join(root, '.zukai', 'config.json') });
      expect(() => runsPath(root)).toThrow(ConfigError);
      expect(runFolderPattern(root)).toBe('diagrams/<yyyymmdd>_<run-slug>');
    }
  });

  it('finds the project of a run through its setting, else through a parent named diagrams', () => {
    const root = project({ config: 1, runsDir: 'docs/diagrams' });
    expect(projectOfRun(join(root, 'docs', 'diagrams', '20261118_a'))).toBe(root);
    expect(projectOfRun(join(root, 'docs', 'other', '20261118_a'))).toBeUndefined();
    const plain = project();
    expect(projectOfRun(join(plain, 'diagrams', '20261118_a'))).toBe(plain);
    // A nested project with its own setting is the nearer one.
    const nested = join(root, 'packages', 'web');
    mkdirSync(join(nested, '.zukai'), { recursive: true });
    writeFileSync(join(nested, '.zukai', 'config.json'), JSON.stringify({ config: 1, runsDir: 'runs' }));
    expect(projectOfRun(join(nested, 'runs', '20261118_b'))).toBe(nested);
  });

  it('finds the run folder that holds a path', () => {
    expect(runDirAt('/p/diagrams/20261118_a/drawio/x.drawio')).toBe('/p/diagrams/20261118_a');
    expect(runDirAt('/p/diagrams/20261118_a')).toBe('/p/diagrams/20261118_a');
    expect(runDirAt('/p/elsewhere/x.drawio')).toBeUndefined();
  });

  it('writes runsDir, keeps the other keys, and names the old folder when it holds runs', () => {
    const root = project({ config: 1, theme: 'dark' });
    mkdirSync(join(root, 'diagrams', '20261117_old'), { recursive: true });
    const r = setRunsDir(root, 'docs/diagrams/');
    expect(r).toMatchObject({ ok: true, runsDir: 'docs/diagrams', previous: 'diagrams', runsLeftIn: { runsDir: 'diagrams', runs: 1 } });
    expect(JSON.parse(readFileSync(join(root, '.zukai', 'config.json'), 'utf8'))).toEqual({ config: 1, theme: 'dark', runsDir: 'docs/diagrams' });
    expect(existsSync(join(root, 'diagrams', '20261117_old'))).toBe(true);
    expect(setRunsDir(root, 'docs/diagrams')).not.toHaveProperty('runsLeftIn');
    expect(setRunsDir(root, '../x')).toMatchObject({ ok: false, error: { code: 'bad-config' } });
  });

  it('replaces a bad runsDir but refuses to overwrite a file it cannot parse', () => {
    const bad = project({ config: 1, runsDir: '/abs', keep: true });
    expect(setRunsDir(bad, 'runs')).toMatchObject({ ok: true, runsDir: 'runs', previous: null });
    expect(JSON.parse(readFileSync(join(bad, '.zukai', 'config.json'), 'utf8'))).toEqual({ config: 1, runsDir: 'runs', keep: true });
    const broken = project('{ broken');
    expect(setRunsDir(broken, 'runs')).toMatchObject({ ok: false, error: { code: 'bad-config' } });
    expect(readFileSync(join(broken, '.zukai', 'config.json'), 'utf8')).toBe('{ broken');
  });

  it('keeps config.json tracked: .zukai/.gitignore ignores only the console state and the lock', () => {
    const root = project();
    ensureZukaiDir(root);
    const ignored = readFileSync(join(root, '.zukai', '.gitignore'), 'utf8').split('\n').filter(Boolean);
    expect(ignored).toEqual(['labs/', 'glossary.lock']);
    expect(ignored).not.toContain('config.json');
  });
});
