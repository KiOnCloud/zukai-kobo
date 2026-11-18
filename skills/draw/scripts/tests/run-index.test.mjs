import { describe, it, expect } from 'vitest';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { indexHome, registerProject, listIndex, rebuildIndex, forgetProject, scanProjects } from '../src/run-index.mjs';

const home = () => ({ ZUKAI_HOME: mkdtempSync(join(tmpdir(), 'zukai-index-home-')) });
const project = ({ runsDir, runs = ['20261118_a'] } = {}) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'zukai-index-project-')));
  if (runsDir) {
    mkdirSync(join(root, '.zukai'), { recursive: true });
    writeFileSync(join(root, '.zukai', 'config.json'), JSON.stringify({ config: 1, runsDir }));
  }
  for (const run of runs) mkdirSync(join(root, ...(runsDir ?? 'diagrams').split('/'), run, 'source'), { recursive: true });
  return root;
};
const fileOf = (env) => JSON.parse(readFileSync(join(env.ZUKAI_HOME, 'index.json'), 'utf8'));

describe('run index', () => {
  it('lives in ZUKAI_HOME, else LOCALAPPDATA on Windows, else ~/.zukai', () => {
    expect(indexHome({ ZUKAI_HOME: '/tmp/zh' }, 'linux', '/home/u')).toBe('/tmp/zh');
    expect(indexHome({}, 'linux', '/home/u')).toBe(join('/home/u', '.zukai'));
    expect(indexHome({ LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' }, 'win32', 'C:\\Users\\u')).toBe(join('C:\\Users\\u\\AppData\\Local', 'zukai'));
    expect(indexHome({}, 'win32', 'C:\\Users\\u')).toBe(join('C:\\Users\\u', 'AppData', 'Local', 'zukai'));
  });

  it('keeps one entry per project, holds only roots and times, and reads the runs from disk', () => {
    const env = home();
    const a = project({ runsDir: 'docs/diagrams', runs: ['20261117_x', '20261118_y'] });
    expect(registerProject(a, { env, now: new Date('2026-11-18T00:00:00Z') })).toBe(true);
    expect(registerProject(join(a, '.'), { env, now: new Date('2026-11-18T01:00:00Z') })).toBe(true);
    expect(fileOf(env)).toEqual({ index: 1, projects: [{ root: a, lastSeen: '2026-11-18T01:00:00.000Z' }] });
    const list = listIndex({ env });
    expect(list.projects).toEqual([{ root: a, alive: true, runsDir: 'docs/diagrams', runs: ['20261118_y', '20261117_x'], lastSeen: '2026-11-18T01:00:00.000Z' }]);
    expect(list.warnings).toEqual([]);
  });

  it('makes the folder and the file private to the user', () => {
    if (process.platform === 'win32') return;
    const env = { ZUKAI_HOME: join(mkdtempSync(join(tmpdir(), 'zukai-index-parent-')), 'zukai') };
    registerProject(project(), { env });
    expect(statSync(env.ZUKAI_HOME).mode & 0o777).toBe(0o700);
    expect(statSync(join(env.ZUKAI_HOME, 'index.json')).mode & 0o777).toBe(0o600);
  });

  it('reports a deleted project as dead and drops it on the next write, never on a read', () => {
    const env = home();
    const a = project();
    const b = project();
    registerProject(a, { env });
    registerProject(b, { env });
    rmSync(a, { recursive: true, force: true });
    expect(listIndex({ env }).projects.find((p) => p.root === a)).toMatchObject({ alive: false, reason: 'missing', runsDir: null, runs: [] });
    expect(fileOf(env).projects.map((p) => p.root)).toContain(a);
    registerProject(b, { env });
    expect(fileOf(env).projects.map((p) => p.root)).toEqual([b]);
  });

  it('reads a corrupt file as empty with a warning, and the next write replaces it', () => {
    const env = home();
    writeFileSync(join(env.ZUKAI_HOME, 'index.json'), '{ not json');
    const list = listIndex({ env });
    expect(list.projects).toEqual([]);
    expect(list.warnings[0].message).toMatch(/could not be read/);
    const a = project();
    registerProject(a, { env });
    expect(fileOf(env).projects.map((p) => p.root)).toEqual([a]);
  });

  it('does nothing with ZUKAI_INDEX=off', () => {
    const env = { ...home(), ZUKAI_INDEX: 'off' };
    expect(registerProject(project(), { env })).toBe(false);
    expect(existsSync(join(env.ZUKAI_HOME, 'index.json'))).toBe(false);
  });

  it('never throws when the index cannot be written', () => {
    if (process.platform === 'win32' || process.getuid?.() === 0) return;
    const env = home();
    chmodSync(env.ZUKAI_HOME, 0o500);
    try {
      expect(registerProject(project(), { env })).toBe(false);
    } finally {
      chmodSync(env.ZUKAI_HOME, 0o700);
    }
  });

  it('keeps a project whose setting is being edited when another project writes the index', () => {
    const env = home();
    const a = project({ runsDir: 'runs' });
    const b = project();
    registerProject(a, { env });
    writeFileSync(join(a, '.zukai', 'config.json'), '{ "config": 1, "runsDir": "runs", }');
    registerProject(b, { env });
    expect(fileOf(env).projects.map((p) => p.root).sort()).toEqual([a, b].sort());
    expect(listIndex({ env }).projects.find((p) => p.root === a)).toMatchObject({ alive: false, reason: 'bad-config' });
  });

  it('never replaces an index written by a newer version', () => {
    const env = home();
    const newer = '{ "index": 2, "projects": [{ "root": "/x", "tags": ["a"] }] }\n';
    writeFileSync(join(env.ZUKAI_HOME, 'index.json'), newer);
    expect(registerProject(project(), { env })).toBe(false);
    expect(readFileSync(join(env.ZUKAI_HOME, 'index.json'), 'utf8')).toBe(newer);
    expect(listIndex({ env }).warnings[0].message).toMatch(/another version.*left as it is/);
    expect(rebuildIndex({ env })).toMatchObject({ ok: false, error: { code: 'index-write' } });
    expect(forgetProject('/x', { env })).toMatchObject({ ok: false, error: { code: 'index-write' } });
    expect(readFileSync(join(env.ZUKAI_HOME, 'index.json'), 'utf8')).toBe(newer);
  });

  it('does not take the home folder for a project because of the index folder in it', () => {
    const top = realpathSync(mkdtempSync(join(tmpdir(), 'zukai-index-home-scan-')));
    const env = { ZUKAI_HOME: join(top, '.zukai') };
    mkdirSync(env.ZUKAI_HOME);
    registerProject(project(), { env });
    expect(scanProjects(top, env)).toEqual([]);
  });

  it('does not register a project whose setting cannot be used', () => {
    const env = home();
    const a = project({ runsDir: 'runs' });
    writeFileSync(join(a, '.zukai', 'config.json'), '{ broken');
    expect(registerProject(a, { env })).toBe(false);
  });

  it('finds projects four levels down, past dependencies and hidden folders', () => {
    const top = realpathSync(mkdtempSync(join(tmpdir(), 'zukai-index-scan-')));
    const make = (...parts) => { const dir = join(top, ...parts); mkdirSync(join(dir, 'diagrams', '20261118_a'), { recursive: true }); return dir; };
    const near = make('clients', 'acme');
    const deep = make('a', 'b', 'c', 'd');
    make('a', 'b', 'c', 'd', 'e');
    make('node_modules', 'pkg');
    make('.cache', 'p');
    const withState = join(top, 'fresh');
    mkdirSync(join(withState, '.zukai'), { recursive: true });
    mkdirSync(join(top, 'empty', 'diagrams'), { recursive: true });
    // A runs folder named diagrams one level down: its parent is no project of its own.
    const custom = join(top, 'custom');
    mkdirSync(join(custom, '.zukai'), { recursive: true });
    writeFileSync(join(custom, '.zukai', 'config.json'), JSON.stringify({ config: 1, runsDir: 'docs/diagrams' }));
    mkdirSync(join(custom, 'docs', 'diagrams', '20261118_a'), { recursive: true });
    expect(scanProjects(top).sort()).toEqual([near, deep, withState, custom].sort());
  });

  it('rebuilds the same list after the file is deleted, and forgets one project', () => {
    const env = home();
    const top = realpathSync(mkdtempSync(join(tmpdir(), 'zukai-index-rebuild-')));
    const a = join(top, 'a');
    const b = join(top, 'b');
    mkdirSync(join(a, 'diagrams', '20261118_x'), { recursive: true });
    mkdirSync(join(b, '.zukai'), { recursive: true });
    writeFileSync(join(b, '.zukai', 'config.json'), JSON.stringify({ config: 1, runsDir: 'docs/d' }));
    mkdirSync(join(b, 'docs', 'd', '20261118_y'), { recursive: true });
    registerProject(a, { env });
    registerProject(b, { env });
    const strip = (list) => list.projects.map(({ lastSeen, ...p }) => p);
    const before = strip(listIndex({ env }));
    rmSync(join(env.ZUKAI_HOME, 'index.json'));
    expect(rebuildIndex({ scan: [top], env })).toMatchObject({ ok: true, added: [a, b], dropped: [], projects: 2 });
    expect(strip(listIndex({ env }))).toEqual(before);
    expect(forgetProject(a, { env })).toMatchObject({ ok: true, removed: true });
    expect(forgetProject(a, { env })).toMatchObject({ ok: true, removed: false });
    expect(strip(listIndex({ env })).map((p) => p.root)).toEqual([b]);
    expect(rebuildIndex({ scan: [join(top, 'nope')], env })).toMatchObject({ ok: false, error: { code: 'bad-request' } });
  });
});
