import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, existsSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scriptsDir, fixturesDir } from './helpers.mjs';

const cli = join(scriptsDir, 'bin', 'cli.mjs');
// The real path: a child process's working directory is reported resolved (/private/var on macOS).
const otherCwd = realpathSync(mkdtempSync(join(tmpdir(), 'zukai-cli-')));

function run(args, cwd = otherCwd) {
  const r = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

const parseStderr = (s) => JSON.parse(s.trim().split('\n').pop());

describe('cli (committed bundle, run from a different working directory)', () => {
  it('validate exits 0 and prints kind and title for a valid file', () => {
    const r = run(['validate', join(fixturesDir, 'flowchart', 'valid.json')]);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ ok: true, kind: 'flowchart', title: 'Order checkout', warnings: 0 });
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
    // FigJam draws every participant as the same box, so the actor, control and database warn.
    const fig = run(['emit', '--to', 'figjam', join(fixturesDir, 'sequence', 'valid.json')]);
    expect(fig.code).toBe(0);
    const warned = parseStderr(fig.stderr).warnings;
    expect(warned.filter((w) => w.path.startsWith('/participants'))).toHaveLength(3);
    // Without --overlay the reader is told that the board needs the overlay script.
    expect(warned.at(-1).hint).toContain('--overlay');
  });

  it('emit --to figjam --overlay writes the overlay script only for a diagram that needs one', () => {
    const seq = run(['emit', '--to', 'figjam', join(fixturesDir, 'sequence', 'valid.json'), '--out', 'fj/login.mmd', '--overlay', 'fj/login.overlay.js']);
    expect(seq.code).toBe(0);
    expect(JSON.parse(seq.stdout).overlay).toBe(join(otherCwd, 'fj', 'login.overlay.js'));
    expect(readFileSync(join(otherCwd, 'fj', 'login.overlay.js'), 'utf8')).toContain('"title":"Login with password"');
    expect(parseStderr(seq.stderr).warnings.some((w) => w.hint?.includes('--overlay'))).toBe(false);
    expect(readFileSync(join(otherCwd, 'fj', 'login.overlay.js'), 'utf8')).toContain('"kinds":["actor","participant","control","database"]');
    const flow = run(['emit', '--to', 'figjam', join(fixturesDir, 'flowchart', 'valid.json'), '--out', 'fj/flow.mmd', '--overlay', 'fj/flow.overlay.js']);
    expect(JSON.parse(flow.stdout).overlay).toBeNull();
    expect(existsSync(join(otherCwd, 'fj', 'flow.overlay.js'))).toBe(false);
    const wrong = run(['emit', '--to', 'mermaid', join(fixturesDir, 'sequence', 'valid.json'), '--overlay', 'x.js']);
    expect(wrong.code).toBe(1);
    expect(parseStderr(wrong.stderr).errors[0].message).toContain('--overlay goes with --to figjam');
  });

  it('emit --to figjam --native writes the script that draws the board, for a class diagram too', () => {
    const cls = run(['emit', '--to', 'figjam', join(fixturesDir, 'class', 'valid.json'), '--out', 'nat/order.mmd', '--native', 'nat/order.native.js']);
    expect(cls.code).toBe(0);
    const told = JSON.parse(cls.stdout);
    expect(told.native).toEqual([join(otherCwd, 'nat', 'order.native.js')]);
    // generate_diagram rejects a class diagram, so no Mermaid text is written, and the output says so.
    expect(told.out).toBeNull();
    expect(told.text).toContain('not written: there is no Mermaid text for a class diagram on FigJam');
    // The option that was just used is not offered as the way out.
    expect(told.text).not.toContain('emit --native');
    expect(existsSync(join(otherCwd, 'nat', 'order.mmd'))).toBe(false);
    const script = readFileSync(join(otherCwd, 'nat', 'order.native.js'), 'utf8');
    expect(script).toContain('"title":"Order domain"');
    expect(script).toContain('IOrderRepository');
    expect(script.length).toBeLessThanOrEqual(50000);
    // Without --native the kind is refused as before.
    expect(run(['emit', '--to', 'figjam', join(fixturesDir, 'class', 'valid.json')]).code).toBe(2);
    // A kind generate_diagram takes keeps its text and its overlay beside the native script.
    const seq = run(['emit', '--to', 'figjam', join(fixturesDir, 'sequence', 'valid.json'), '--out', 'nat/login.mmd', '--overlay', 'nat/login.overlay.js', '--native', 'nat/login.native.js']);
    expect(JSON.parse(seq.stdout)).toMatchObject({ out: join(otherCwd, 'nat', 'login.mmd'), overlay: join(otherCwd, 'nat', 'login.overlay.js'), native: [join(otherCwd, 'nat', 'login.native.js')] });
    expect(readFileSync(join(otherCwd, 'nat', 'login.mmd'), 'utf8')).toContain('sequenceDiagram');
    // With --native and no --out the scripts are the result: stdout stays one JSON line.
    const bare = run(['emit', '--to', 'figjam', join(fixturesDir, 'flowchart', 'valid.json'), '--native', 'nat/flow.js']);
    expect(JSON.parse(bare.stdout)).toMatchObject({ ok: true, out: null, native: [join(otherCwd, 'nat', 'flow.js')] });
    const wrong = run(['emit', '--to', 'drawio', join(fixturesDir, 'class', 'valid.json'), '--native', 'x.js']);
    expect(wrong.code).toBe(1);
    expect(parseStderr(wrong.stderr).errors[0].message).toContain('--native goes with --to figjam');
    expect(existsSync(join(otherCwd, 'x.js'))).toBe(false);
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
    // An unknown target is a usage error, like an unknown command.
    expect(run(['emit', '--to', 'visio', join(fixturesDir, 'er', 'valid.json')]).code).toBe(1);
    expect(run(['emit', join(fixturesDir, 'er', 'valid.json')]).code).toBe(1);
    expect(run(['frobnicate']).code).toBe(1);
    expect(run(['validate', join(scriptsDir, 'package.json')]).code).toBe(2);
    expect(run(['validate', join(scriptsDir, 'build.mjs')]).code).toBe(1);
  });
});

describe('runs-dir (committed bundle)', () => {
  const project = () => realpathSync(mkdtempSync(join(tmpdir(), 'zukai-runs-dir-')));

  it('prints the default folder and where it came from', () => {
    const root = project();
    const r = run(['runs-dir', '--root', root]);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ ok: true, root, runsDir: 'diagrams', path: join(root, 'diagrams'), from: 'default' });
  });

  it('reads the working directory without --root', () => {
    const root = project();
    expect(JSON.parse(run(['runs-dir'], root).stdout)).toMatchObject({ root, runsDir: 'diagrams' });
  });

  it('sets the folder, warns about runs left in the old one and never moves them', () => {
    const root = project();
    mkdirSync(join(root, 'diagrams', '20261117_old', 'source'), { recursive: true });
    const set = run(['runs-dir', 'set', 'docs/diagrams', '--root', root]);
    expect(set.code).toBe(0);
    expect(JSON.parse(set.stdout)).toMatchObject({ ok: true, root, runsDir: 'docs/diagrams', previous: 'diagrams', runsLeftIn: { runsDir: 'diagrams', runs: 1 } });
    expect(existsSync(join(root, 'diagrams', '20261117_old'))).toBe(true);
    expect(JSON.parse(readFileSync(join(root, '.zukai', 'config.json'), 'utf8'))).toEqual({ config: 1, runsDir: 'docs/diagrams' });
    expect(JSON.parse(run(['runs-dir', '--root', root]).stdout)).toMatchObject({ runsDir: 'docs/diagrams', path: join(root, 'docs', 'diagrams'), from: 'config' });
  });

  it('refuses a folder outside the project with bad-config and exit 1', () => {
    const root = project();
    for (const value of ['../x', '/abs', '.zukai/runs', '.git']) {
      const r = run(['runs-dir', 'set', value, '--root', root]);
      expect(r.code, value).toBe(1);
      expect(parseStderr(r.stderr).error).toMatchObject({ code: 'bad-config' });
    }
    expect(existsSync(join(root, '.zukai', 'config.json'))).toBe(false);
  });

  it('stops on a setting it cannot use, here and in the commands that read runs', () => {
    const root = project();
    mkdirSync(join(root, '.zukai'));
    writeFileSync(join(root, '.zukai', 'config.json'), '{ broken');
    const r = run(['runs-dir', '--root', root]);
    expect(r.code).toBe(1);
    expect(parseStderr(r.stderr).error).toMatchObject({ code: 'bad-config', path: join(root, '.zukai', 'config.json') });
    const start = run(['labs', 'start', '--root', root, '--skip-cloud-check']);
    expect(start.code).toBe(1);
    expect(parseStderr(start.stderr).error).toMatchObject({ code: 'bad-config' });
    // status still answers, so a running server stays reachable, and carries the error.
    const status = run(['labs', 'status', '--root', root]);
    expect(status.code).toBe(0);
    expect(JSON.parse(status.stdout)).toMatchObject({ running: false, runsDir: null, runs: 0, configError: { code: 'bad-config' } });
  });

  it('refuses to say a run is not held when the setting of its project cannot be read', () => {
    const root = project();
    run(['runs-dir', 'set', 'docs/diagrams', '--root', root]);
    const runDir = join(root, 'docs', 'diagrams', '20261118_x');
    mkdirSync(join(runDir, 'source'), { recursive: true });
    expect(JSON.parse(run(['labs', 'holds', runDir]).stdout)).toEqual({ held: false });
    writeFileSync(join(root, '.zukai', 'config.json'), '{ "config": 2 }');
    const r = run(['labs', 'holds', runDir]);
    expect(r.code).toBe(1);
    expect(parseStderr(r.stderr).error).toMatchObject({ code: 'bad-config' });
  });

  it('refuses an unknown word and a missing folder', () => {
    expect(run(['runs-dir', 'move', 'x']).code).toBe(1);
    expect(run(['runs-dir', 'set']).code).toBe(1);
    expect(parseStderr(run(['runs-dir', '--to', 'x']).stderr).errors[0].message).toMatch(/does not take --to/);
  });

  it('names the resolved folder in the hint of a run folder that has no IR', () => {
    const root = project();
    run(['runs-dir', 'set', 'docs/diagrams', '--root', root]);
    mkdirSync(join(root, 'empty'));
    const r = run(['bundle', '--to', 'drawio', '--out', join(root, 'x.drawio'), join(root, 'empty')], root);
    expect(r.code).toBe(1);
    expect(parseStderr(r.stderr).errors[0].hint).toContain('docs/diagrams/<yyyymmdd>_<run-slug>');
  });
});
