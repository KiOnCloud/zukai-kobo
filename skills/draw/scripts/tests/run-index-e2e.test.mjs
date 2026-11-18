/**
 * The run index through the committed bundle, as a user meets it: two projects, one with a
 * runs folder of its own, registered by the commands that write runs; a deleted project
 * reported and dropped; the file deleted and rebuilt by a scan; the opt-out; and a write
 * that fails without changing the output of the command that triggered it.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scriptsDir, fixturesDir } from './helpers.mjs';

const cliPath = join(scriptsDir, 'bin', 'cli.mjs');
const elsewhere = mkdtempSync(join(tmpdir(), 'zukai-index-cwd-'));
const cli = (args, env = {}) => {
  const r = spawnSync(process.execPath, [cliPath, ...args], { cwd: elsewhere, encoding: 'utf8', env: { ...process.env, ...env } });
  const last = (text) => { try { return JSON.parse(text.trim().split('\n').at(-1)); } catch { return undefined; } };
  return { code: r.status, stdout: r.stdout, out: last(r.stdout), err: last(r.stderr) };
};

/** A project with one run copied from the glossary sample, under `runsDir` when given. */
function project(top, name, runsDir) {
  const root = join(top, name);
  mkdirSync(root, { recursive: true });
  const dir = join(root, ...(runsDir ?? 'diagrams').split('/'));
  cpSync(join(fixturesDir, 'glossary', 'project', 'diagrams', '20261109_login-flow'), join(dir, '20261109_login-flow'), { recursive: true });
  if (runsDir) expect(cli(['runs-dir', 'set', runsDir, '--root', root], { ZUKAI_INDEX: 'off' }).code).toBe(0);
  return { root, run: join(dir, '20261109_login-flow') };
}

const bundleArgs = (p) => ['bundle', '--to', 'drawio', '--out', join(p.run, 'login-flow.drawio'), p.run];
const strip = (out) => out.projects.map(({ lastSeen, ...p }) => p);

describe('run index (committed bundle)', () => {
  it('lists the projects the writing commands saw, drops a deleted one and rebuilds from a scan', () => {
    const env = { ZUKAI_HOME: mkdtempSync(join(tmpdir(), 'zukai-index-e2e-home-')) };
    const top = realpathSync(mkdtempSync(join(tmpdir(), 'zukai-index-e2e-')));
    const plain = project(top, 'plain');
    const custom = project(top, 'custom', 'docs/diagrams');
    expect(cli(bundleArgs(plain), env).code).toBe(0);
    expect(cli(bundleArgs(custom), env).code).toBe(0);
    const first = cli(['index', 'list'], env);
    expect(first.code).toBe(0);
    expect(strip(first.out)).toEqual([
      { root: custom.root, alive: true, runsDir: 'docs/diagrams', runs: ['20261109_login-flow'] },
      { root: plain.root, alive: true, runsDir: 'diagrams', runs: ['20261109_login-flow'] },
    ]);

    rmSync(plain.root, { recursive: true, force: true });
    expect(cli(['index', 'list'], env).out.projects.find((p) => p.root === plain.root)).toMatchObject({ alive: false, reason: 'missing' });
    expect(cli(['snapshot', custom.run], env).code).toBe(0);
    expect(strip(cli(['index', 'list'], env).out).map((p) => p.root)).toEqual([custom.root]);

    const again = project(top, 'plain');
    expect(cli(['snapshot', again.run], { ZUKAI_INDEX: 'off' }).code).toBe(0);
    expect(cli(['restore', again.run, 'r001'], env).code).toBe(0);
    const before = strip(cli(['index', 'list'], env).out);
    expect(before.map((p) => p.root)).toEqual([custom.root, again.root]);
    rmSync(join(env.ZUKAI_HOME, 'index.json'));
    expect(cli(['index', 'list'], env).out.projects).toEqual([]);
    expect(cli(['index', 'rebuild', '--scan', top], env).out).toMatchObject({ ok: true, projects: 2 });
    expect(strip(cli(['index', 'list'], env).out)).toEqual(before);
    expect(cli(['index', 'forget', custom.root], env).out).toMatchObject({ ok: true, removed: true });
    expect(strip(cli(['index', 'list'], env).out).map((p) => p.root)).toEqual([again.root]);
  });

  it('registers on labs-free reads of runs-dir only when the project holds runs', () => {
    const env = { ZUKAI_HOME: mkdtempSync(join(tmpdir(), 'zukai-index-e2e-home-')) };
    const top = realpathSync(mkdtempSync(join(tmpdir(), 'zukai-index-e2e-')));
    const empty = join(top, 'empty');
    mkdirSync(empty);
    cli(['runs-dir', '--root', empty], env);
    expect(existsSync(join(env.ZUKAI_HOME, 'index.json'))).toBe(false);
    const p = project(top, 'with-runs');
    cli(['runs-dir', '--root', p.root], env);
    expect(cli(['index', 'list'], env).out.projects.map((x) => x.root)).toEqual([p.root]);
  });

  it('reads and writes nothing with ZUKAI_INDEX=off', () => {
    const env = { ZUKAI_HOME: mkdtempSync(join(tmpdir(), 'zukai-index-e2e-home-')), ZUKAI_INDEX: 'off' };
    const p = project(realpathSync(mkdtempSync(join(tmpdir(), 'zukai-index-e2e-'))), 'p');
    expect(cli(bundleArgs(p), env).code).toBe(0);
    expect(existsSync(join(env.ZUKAI_HOME, 'index.json'))).toBe(false);
    for (const args of [['index', 'list'], ['index', 'rebuild'], ['index', 'forget', p.root]]) {
      const r = cli(args, env);
      expect(r.code).toBe(1);
      expect(r.err.error).toMatchObject({ code: 'index-off' });
    }
  });

  it('leaves the output of bundle byte for byte as it is when the index cannot be written', () => {
    if (process.platform === 'win32' || process.getuid?.() === 0) return;
    const p = project(realpathSync(mkdtempSync(join(tmpdir(), 'zukai-index-e2e-'))), 'p');
    const off = cli(bundleArgs(p), { ZUKAI_INDEX: 'off' });
    const home = mkdtempSync(join(tmpdir(), 'zukai-index-e2e-home-'));
    chmodSync(home, 0o500);
    try {
      const failing = cli(bundleArgs(p), { ZUKAI_HOME: home });
      expect(failing.code).toBe(off.code);
      expect(failing.stdout).toBe(off.stdout);
      expect(existsSync(join(home, 'index.json'))).toBe(false);
    } finally {
      chmodSync(home, 0o700);
    }
  });
});
