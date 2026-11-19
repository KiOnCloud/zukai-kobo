/**
 * End to end, through the committed bundle and from another working directory, as an agent
 * or a CI job runs it: a small project with a scouted run, whose source files are recorded
 * and then edited, deleted, converted or restored.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scriptsDir } from './helpers.mjs';

const cliPath = join(scriptsDir, 'bin', 'cli.mjs');
// The real path: a child process's working directory is reported resolved (/private/var on macOS).
const elsewhere = realpathSync(mkdtempSync(join(tmpdir(), 'zukai-sources-cwd-')));
const cli = (args, cwd = elsewhere) => {
  const r = spawnSync(process.execPath, [cliPath, ...args], { cwd, encoding: 'utf8' });
  const parse = (text) => text.trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return l; } });
  const err = parse(r.stderr);
  return { code: r.status, out: parse(r.stdout).at(-1), err: err.at(-1), warnings: err.flatMap((e) => e?.warnings ?? []), errors: err.flatMap((e) => e?.errors ?? []) };
};
const write = (file, value) => { mkdirSync(join(file, '..'), { recursive: true }); writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n'); return file; };

const FILES = {
  'src/auth/login-handler.js': 'export function login(req) {\n  return verify(req.body);\n}\n',
  'src/auth/password.js': 'export const verify = (body) => body.password.length > 0;\n',
  'src/auth/session.js': 'export const open = (user) => ({ user });\n',
};
const login = (meta) => ({
  schemaVersion: 1, kind: 'flowchart', title: 'Login',
  nodes: [{ id: 'start', label: 'Start', shape: 'terminal' }, { id: 'verify', label: 'Verify the password' }, { id: 'done', label: 'Session opened', shape: 'terminal' }],
  edges: [{ id: 'e1', from: 'start', to: 'verify' }, { id: 'e2', from: 'verify', to: 'done' }],
  meta,
});
const SOURCES = ['src/auth/login-handler.js', 'src/auth/password.js'];

/**
 * A project folder with the login sources and one run `diagrams/20261117_<slug>`.
 * `marker` makes it a git work tree root the way a clone ('dir') or a linked work tree ('file') is one.
 */
function project({ slug = 'login', irs, marker = 'dir' } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'zukai-sources-project-')));
  for (const [path, text] of Object.entries(FILES)) write(join(root, path), text);
  if (marker === 'dir') mkdirSync(join(root, '.git'));
  if (marker === 'file') writeFileSync(join(root, '.git'), 'gitdir: /somewhere/else\n');
  const run = join(root, 'diagrams', `20261117_${slug}`);
  const all = irs ?? { [slug]: login({ source: 'scout', sources: SOURCES }), [`${slug}-business`]: login({ source: 'scout', audience: 'business', sources: SOURCES }) };
  for (const [id, ir] of Object.entries(all)) write(join(run, 'source', `${id}.ir.json`), ir);
  return { root, run, record: join(run, 'source', `${slug}.sources.json`) };
}
const tree = (dir) => readdirSync(dir, { recursive: true }).map(String).sort();

describe('sources: recording what a run was drawn from', () => {
  it('writes one hash per source file of every diagram, with the root as seen from the run folder', () => {
    const p = project();
    const r = cli(['sources', p.run]);
    expect(r.code).toBe(0);
    expect(r.out).toMatchObject({ ok: true, record: p.record, fallback: [], missing: [], untracked: [], warnings: 0 });
    expect(r.out.diagrams).toEqual([{ id: 'login', from: 'meta.sources', files: 2, missing: 0 }, { id: 'login-business', from: 'meta.sources', files: 2, missing: 0 }]);
    const record = JSON.parse(readFileSync(p.record, 'utf8'));
    expect(record).toMatchObject({ sources: 1, root: '../..', lineEndings: 'lf' });
    expect(record.diagrams.map((d) => d.id)).toEqual(['login', 'login-business']);
    expect(record.diagrams[0].files.map((f) => f.path)).toEqual(SOURCES);
    for (const f of record.diagrams[0].files) expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(Date.parse(record.diagrams[0].recordedAt)).not.toBeNaN();
    // The record lives beside the IRs without being taken for one.
    expect(cli(['diff', p.run, p.run]).out).toMatchObject({ ok: true, differs: false });
  });

  it('takes the nearest git work tree above the run as the root, a linked work tree included, wherever it is called from', () => {
    for (const marker of ['dir', 'file']) {
      const p = project({ marker });
      expect(cli(['sources', p.run]).out).toMatchObject({ ok: true, root: p.root, missing: [] });
    }
  });

  it('falls back to the working directory outside a git work tree, and --root names the project', () => {
    const p = project({ marker: 'none' });
    const wrong = cli(['sources', p.run]);
    expect(wrong.code).toBe(0);
    expect(wrong.out.root).toBe(elsewhere);
    expect(wrong.out.missing.map((m) => m.path)).toEqual([...SOURCES, ...SOURCES]);
    expect(wrong.warnings[0]).toMatchObject({ stage: 'sources', path: 'login:src/auth/login-handler.js' });
    expect(wrong.warnings[0].hint).toMatch(/--root/);

    expect(cli(['sources', p.run], p.root).out).toMatchObject({ root: p.root, missing: [] });
    const r = cli(['sources', p.run, '--root', p.root]);
    expect(r.out).toMatchObject({ ok: true, root: p.root, missing: [], warnings: 0 });
    // stale needs no --root afterwards: the record names the root relative to the run folder.
    expect(cli(['stale', p.run]).code).toBe(0);
    expect(cli(['sources', p.run, '--root', join(p.root, 'nowhere')]).code).toBe(1);
  });

  it('reports a source that does not exist instead of hashing it, and sees it when it appears', () => {
    const p = project({ irs: { login: login({ source: 'scout', sources: [...SOURCES, 'src/auth/mfa.js', 'src/auth'] }) } });
    const r = cli(['sources', p.run]);
    expect(r.code).toBe(0);
    expect(r.out.missing).toEqual([{ diagram: 'login', path: 'src/auth/mfa.js', reason: 'no such file' }, { diagram: 'login', path: 'src/auth', reason: 'not a file' }]);
    expect(JSON.parse(readFileSync(p.record, 'utf8')).diagrams[0].files.slice(2)).toEqual([{ path: 'src/auth/mfa.js', missing: true }, { path: 'src/auth', missing: true }]);
    // Still missing is no change.
    expect(cli(['stale', p.run]).code).toBe(0);
    write(join(p.root, 'src/auth/mfa.js'), 'export const mfa = true;\n');
    const s = cli(['stale', p.run]);
    expect(s.code).toBe(2);
    expect(s.out.runs[0].diagrams).toMatchObject([{ id: 'login', changed: ['src/auth/mfa.js'], deleted: [] }]);
  });

  it('records a scouted run without meta.sources from the paths in its notes that exist, and says so', () => {
    const notes = ['Entry point: src/auth/login-handler.js:12, then `src/auth/password.js`.', 'Not read: src/auth/gone.js, e.g. the mailer (README.md)'];
    const p = project({ irs: { login: login({ source: 'scout', notes }) } });
    const r = cli(['sources', p.run]);
    expect(r.code).toBe(0);
    expect(r.out).toMatchObject({ fallback: ['login'], diagrams: [{ id: 'login', from: 'meta.notes', files: 2, missing: 0 }], warnings: 1 });
    expect(r.warnings[0].message).toMatch(/no meta\.sources in login: the files named in meta\.notes/);
    expect(JSON.parse(readFileSync(p.record, 'utf8')).diagrams[0]).toMatchObject({ from: 'meta.notes', files: [{ path: 'src/auth/login-handler.js' }, { path: 'src/auth/password.js' }] });
    writeFileSync(join(p.root, 'src/auth/password.js'), 'export const verify = () => false;\n');
    expect(cli(['stale', p.run]).out.runs[0].changed).toEqual(['src/auth/password.js']);
  });

  it('refuses a run that names no source, and reads the notes of a scouted diagram only', () => {
    const p = project({ irs: { login: login({ source: 'clarify', notes: ['See src/auth/password.js'] }) } });
    const r = cli(['sources', p.run]);
    expect(r.code).toBe(1);
    expect(r.errors[0].message).toMatch(/no diagram of this run names its source files/);
    expect(existsSync(p.record)).toBe(false);
    expect(cli(['sources', join(p.root, 'diagrams')]).code).toBe(1);
    expect(cli(['sources']).code).toBe(1);
    expect(cli(['sources', p.run, p.run]).code).toBe(1);
  });

  it('records only the diagrams named with --only and keeps the other hashes', () => {
    const p = project();
    expect(cli(['sources', p.run]).code).toBe(0);
    const before = JSON.parse(readFileSync(p.record, 'utf8'));
    writeFileSync(join(p.root, SOURCES[1]), 'export const verify = () => true;\n');
    write(join(p.run, 'source', 'login-01-session.ir.json'), login({ source: 'scout', sources: ['src/auth/session.js'] }));
    // A diagram that names sources the record does not hold cannot be vouched for.
    const gap = cli(['stale', p.run]);
    expect(gap.code).toBe(2);
    expect(gap.out.runs[0].unrecorded).toEqual(['login-01-session']);
    const r = cli(['sources', p.run, '--only', 'login-01-session']);
    expect(r.code).toBe(0);
    expect(r.out.diagrams).toEqual([{ id: 'login-01-session', from: 'meta.sources', files: 1, missing: 0 }]);
    const after = JSON.parse(readFileSync(p.record, 'utf8'));
    expect(after.diagrams.map((d) => d.id)).toEqual(['login', 'login-business', 'login-01-session']);
    expect(after.diagrams.slice(0, 2)).toEqual(before.diagrams);
    // The edit made before --only is still seen: the old hashes were not refreshed.
    const s = cli(['stale', p.run]);
    expect(s.out.runs[0]).toMatchObject({ unrecorded: [], changed: [SOURCES[1]] });
    expect(s.out.runs[0].diagrams.map((d) => d.id)).toEqual(['login', 'login-business']);
    expect(cli(['sources', p.run, '--only', 'nope']).code).toBe(1);
    expect(cli(['stale', p.run, '--only', 'login']).code).toBe(1);
  });
});

describe('stale: comparing the record with the files now', () => {
  it('exits 0 on an untouched project and writes nothing', () => {
    const p = project();
    cli(['sources', p.run]);
    const before = tree(p.root);
    const bytes = readFileSync(p.record);
    const mtime = statSync(p.record).mtimeMs;
    const r = cli(['stale', p.run]);
    expect(r.code).toBe(0);
    expect(r.out).toEqual({ ok: true, stale: false, runs: [{ run: p.run, record: p.record, root: p.root, stale: false, diagrams: [], changed: [], deleted: [], unrecorded: [], untracked: [] }] });
    expect(tree(p.root)).toEqual(before);
    expect(readFileSync(p.record).equals(bytes)).toBe(true);
    expect(statSync(p.record).mtimeMs).toBe(mtime);
  });

  it('exits 2 and names the edited file under every diagram drawn from it', () => {
    const p = project();
    cli(['sources', p.run]);
    writeFileSync(join(p.root, SOURCES[0]), FILES[SOURCES[0]].replace('verify(req.body)', 'verify(req.body) && audit(req)'));
    const r = cli(['stale', p.run]);
    expect(r.code).toBe(2);
    expect(r.out).toMatchObject({ ok: true, stale: true });
    expect(r.out.runs[0]).toMatchObject({ stale: true, changed: [SOURCES[0]], deleted: [] });
    expect(r.out.runs[0].diagrams.map((d) => [d.id, d.changed, d.deleted])).toEqual([['login', [SOURCES[0]], []], ['login-business', [SOURCES[0]], []]]);
    // Same input, same answer.
    expect(cli(['stale', p.run]).out).toEqual(r.out);
    // Putting the text back makes the run current again: the content counts, not the date.
    writeFileSync(join(p.root, SOURCES[0]), FILES[SOURCES[0]]);
    expect(cli(['stale', p.run]).code).toBe(0);
  });

  it('lists a deleted file apart from a changed one', () => {
    const p = project();
    cli(['sources', p.run]);
    rmSync(join(p.root, SOURCES[1]));
    writeFileSync(join(p.root, SOURCES[0]), '// rewritten\n');
    const r = cli(['stale', p.run]);
    expect(r.code).toBe(2);
    expect(r.out.runs[0]).toMatchObject({ changed: [SOURCES[0]], deleted: [SOURCES[1]] });
    expect(r.out.runs[0].diagrams[0]).toMatchObject({ id: 'login', changed: [SOURCES[0]], deleted: [SOURCES[1]] });
  });

  it('exits 1 for a run without a record, with the way to make one', () => {
    const p = project();
    const r = cli(['stale', p.run]);
    expect(r.code).toBe(1);
    expect(r.errors[0]).toMatchObject({ path: p.run });
    expect(r.errors[0].message).toMatch(/no sources record/);
    expect(r.errors[0].hint).toMatch(/sources <run-dir>/);
    expect(cli(['stale']).code).toBe(1);
    expect(cli(['stale', join(p.root, 'missing')]).code).toBe(1);
    writeFileSync(p.record, '{ not json');
    expect(cli(['stale', p.run]).code).toBe(1);
    writeFileSync(p.record, '{"facts":1}');
    expect(cli(['stale', p.run]).errors[0].message).toMatch(/not a sources record/);
  });

  it('checks several runs in one call and still reports the others when one has no record', () => {
    const a = project({ slug: 'login' });
    const b = project({ slug: 'signup' });
    const c = project({ slug: 'reset' });
    cli(['sources', a.run]);
    cli(['sources', b.run]);
    expect(cli(['stale', a.run, b.run]).out).toMatchObject({ ok: true, stale: false, runs: [{ run: a.run }, { run: b.run }] });
    writeFileSync(join(b.root, SOURCES[1]), '// changed\n');
    const r = cli(['stale', a.run, b.run]);
    expect(r.code).toBe(2);
    expect(r.out.runs.map((x) => x.stale)).toEqual([false, true]);
    expect(r.out.runs[1].changed).toEqual([SOURCES[1]]);
    const mixed = cli(['stale', a.run, c.run, b.run]);
    expect(mixed.code).toBe(1);
    expect(mixed.errors.map((e) => e.path)).toEqual([c.run]);
    expect(mixed.out).toMatchObject({ ok: false, stale: true, runs: [{ run: a.run }, { run: b.run, changed: [SOURCES[1]] }] });
  });

  it('follows the project to another checkout by the recorded root, or by --root', () => {
    const p = project();
    cli(['sources', p.run]);
    const copy = mkdtempSync(join(tmpdir(), 'zukai-sources-copy-'));
    cpSync(p.root, copy, { recursive: true });
    const run = join(copy, 'diagrams', '20261117_login');
    expect(cli(['stale', run]).out.runs[0]).toMatchObject({ root: copy, stale: false });
    writeFileSync(join(copy, SOURCES[0]), '// edited in the copy\n');
    expect(cli(['stale', run]).code).toBe(2);
    // The first checkout is untouched, and --root compares the copied run with it.
    expect(cli(['stale', run, '--root', p.root]).code).toBe(0);
    expect(cli(['stale', run, `--root=${copy}`]).out.runs[0].changed).toEqual([SOURCES[0]]);
    expect(cli(['stale', run, '--root', join(copy, 'nowhere')]).code).toBe(1);
  });

  it('reads CRLF as LF, so a checkout that converts line endings is not a change', () => {
    const p = project();
    cli(['sources', p.run]);
    for (const path of SOURCES) writeFileSync(join(p.root, path), FILES[path].replace(/\n/g, '\r\n'));
    expect(cli(['stale', p.run]).code).toBe(0);
    // Recording from the CRLF checkout gives the same hashes.
    const lf = readFileSync(p.record, 'utf8');
    cli(['sources', p.run]);
    const strip = (text) => text.replace(/"recordedAt": "[^"]+"/g, '');
    expect(strip(readFileSync(p.record, 'utf8'))).toBe(strip(lf));
    // A real edit in a CRLF file is still seen, and so is a lone CR.
    writeFileSync(join(p.root, SOURCES[0]), FILES[SOURCES[0]].replace('verify', 'check').replace(/\n/g, '\r\n'));
    writeFileSync(join(p.root, SOURCES[1]), FILES[SOURCES[1]].replace(/\n/g, '\r'));
    expect(cli(['stale', p.run]).out.runs[0].changed).toEqual(SOURCES);
  });

  it('calls a diagram unrecorded when its meta.sources changed after the record, and lists what the record cannot follow', () => {
    const p = project({ irs: { login: login({ source: 'scout', sources: SOURCES }), 'login-01-idea': login({ source: 'manual' }) } });
    cli(['sources', p.run]);
    expect(cli(['stale', p.run]).out.runs[0]).toMatchObject({ stale: false, untracked: ['login-01-idea'] });
    write(join(p.run, 'source', 'login.ir.json'), login({ source: 'scout', sources: [...SOURCES, 'src/auth/session.js'] }));
    const r = cli(['stale', p.run]);
    expect(r.code).toBe(2);
    expect(r.out.runs[0]).toMatchObject({ stale: true, diagrams: [], unrecorded: ['login'] });
    cli(['sources', p.run]);
    expect(cli(['stale', p.run]).code).toBe(0);
    rmSync(join(p.run, 'source', 'login.ir.json'));
    expect(cli(['stale', p.run]).out.runs[0]).toMatchObject({ stale: false, notInRun: ['login'] });
  });
});

describe('revisions carry the record with the IRs', () => {
  it('puts the record of the restored revision back, so an undone sync is out of date again', () => {
    const p = project();
    cli(['sources', p.run]);
    const first = readFileSync(p.record, 'utf8');
    // The code changes, the run is synced: snapshot, new IR, new record.
    writeFileSync(join(p.root, SOURCES[1]), 'export const verify = (body) => body.password.length >= 12;\n');
    expect(cli(['stale', p.run]).code).toBe(2);
    const snap = cli(['snapshot', p.run, '--request', 'sync with the code']);
    expect(snap.out).toMatchObject({ ok: true, rev: 'r001', files: ['login.ir.json', 'login-business.ir.json'] });
    expect(readFileSync(join(p.run, 'history', 'r001', 'source', 'login.sources.json'), 'utf8')).toBe(first);
    const synced = login({ source: 'scout', sources: SOURCES });
    synced.nodes[1].label = 'Verify the password (12 characters or more)';
    write(join(p.run, 'source', 'login.ir.json'), synced);
    cli(['sources', p.run]);
    expect(cli(['stale', p.run]).code).toBe(0);

    const undo = cli(['restore', p.run, 'undo']);
    expect(undo.out).toMatchObject({ ok: true, restored: 'r001', sourcesRecord: 'restored' });
    expect(readFileSync(p.record, 'utf8')).toBe(first);
    expect(JSON.parse(readFileSync(join(p.run, 'source', 'login.ir.json'), 'utf8')).nodes[1].label).toBe('Verify the password');
    const stale = cli(['stale', p.run]);
    expect(stale.code).toBe(2);
    expect(stale.out.runs[0].changed).toEqual([SOURCES[1]]);
    // Redo brings the synced IRs back with the record taken for them.
    expect(cli(['restore', p.run, 'redo']).out).toMatchObject({ sourcesRecord: 'restored' });
    expect(cli(['stale', p.run]).code).toBe(0);
  });

  it('removes the record when the restored revision was made before there was one', () => {
    const p = project();
    expect(cli(['snapshot', p.run, '--request', 'before any record']).out.rev).toBe('r001');
    cli(['sources', p.run]);
    const r = cli(['restore', p.run, 'r001']);
    expect(r.out).toMatchObject({ ok: true, restored: 'r001', sourcesRecord: 'removed' });
    expect(existsSync(p.record)).toBe(false);
    expect(cli(['stale', p.run]).code).toBe(1);
    // The state that was left holds its record, and comes back with it.
    expect(cli(['restore', p.run, 'redo']).out).toMatchObject({ sourcesRecord: 'restored' });
    expect(cli(['stale', p.run]).code).toBe(0);
  });
});

describe('meta.sources in the IR', () => {
  const check = (sources) => cli(['validate', write(join(mkdtempSync(join(tmpdir(), 'zukai-sources-ir-')), 'x.ir.json'), login({ source: 'scout', sources }))]);

  it('accepts project-relative paths and stays at schema version 1', () => {
    expect(check(['src/auth/login-handler.js', 'infra/main.tf', 'Dockerfile', 'src/[id]/page.tsx']).code).toBe(0);
    expect(check([]).code).toBe(0);
  });

  it('rejects an absolute path, a path that leaves the project and a backslash, each with a hint', () => {
    const r = check(['/home/dev/app/src/a.js', 'C:/work/app/src/a.js', '../shared/lib.js', 'src/../../x.js', 'src\\auth\\a.js']);
    expect(r.code).toBe(2);
    expect(r.errors.map((e) => [e.path, e.message])).toEqual([
      ['/meta/sources/0', 'absolute path "/home/dev/app/src/a.js"'],
      ['/meta/sources/1', 'absolute path "C:/work/app/src/a.js"'],
      ['/meta/sources/2', 'path "../shared/lib.js" leaves the project'],
      ['/meta/sources/3', 'path "src/../../x.js" leaves the project'],
      ['/meta/sources/4', 'backslash in path "src\\auth\\a.js"'],
    ]);
    for (const e of r.errors) expect(e.hint).toMatch(/project root|forward slashes/);
    expect(check(['src/a.js', 'src/a.js']).code).toBe(2);
    expect(check('src/a.js').code).toBe(2);
    // The same list never reaches a record.
    const p = project({ irs: { login: login({ source: 'scout', sources: ['../outside.js'] }) } });
    expect(cli(['sources', p.run]).code).toBe(2);
    expect(existsSync(p.record)).toBe(false);
  });

  it('shows a changed source list in the change list without calling the diagram changed for the reader', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zukai-sources-diff-'));
    const a = write(join(dir, 'a.ir.json'), login({ source: 'scout', sources: SOURCES }));
    const b = write(join(dir, 'b.ir.json'), login({ source: 'scout', sources: [...SOURCES, 'src/auth/session.js'] }));
    const d = cli(['diff', a, b]).out;
    expect(d.fields).toEqual([{ field: 'meta.sources', from: SOURCES, to: [...SOURCES, 'src/auth/session.js'] }]);
    expect(d).toMatchObject({ added: [], removed: [], changed: [] });
  });
});

describe('a run folder under another name', () => {
  it('keeps its record: stale, sources and restore find it by what source/ holds', () => {
    const p = project();
    expect(cli(['sources', p.run]).code).toBe(0);
    expect(cli(['snapshot', p.run, '--request', 'before the change']).code).toBe(0);
    const renamed = join(p.root, 'diagrams', '20261117_sign-in');
    cpSync(p.run, renamed, { recursive: true });
    const record = join(renamed, 'source', 'login.sources.json');

    const current = cli(['stale', renamed]);
    expect(current.code).toBe(0);
    expect(current.out.runs[0]).toMatchObject({ record, stale: false });

    writeFileSync(join(p.root, 'src/auth/password.js'), 'export const verify = () => true;\n');
    const behind = cli(['stale', renamed]);
    expect(behind.code).toBe(2);
    expect(behind.out.runs[0].changed).toEqual(['src/auth/password.js']);

    // Recording again renews that record; no second one appears under the new name.
    expect(cli(['sources', renamed]).out.record).toBe(record);
    expect(readdirSync(join(renamed, 'source')).filter((f) => f.endsWith('.sources.json'))).toEqual(['login.sources.json']);
    expect(cli(['stale', renamed]).code).toBe(0);

    // The revision holds the record of its state, and the run is behind the code again after it.
    const back = cli(['restore', renamed, 'r001']);
    expect(back.out).toMatchObject({ ok: true, sourcesRecord: 'restored' });
    const after = cli(['stale', renamed]);
    expect(after.code).toBe(2);
    expect(after.out.runs[0]).toMatchObject({ record, changed: ['src/auth/password.js'] });
  });

  it('refuses to pick between several records when none is named after the run', () => {
    const p = project();
    expect(cli(['sources', p.run]).code).toBe(0);
    const renamed = join(p.root, 'diagrams', '20261117_sign-in');
    cpSync(p.run, renamed, { recursive: true });
    cpSync(join(renamed, 'source', 'login.sources.json'), join(renamed, 'source', 'other.sources.json'));
    for (const command of ['stale', 'sources']) {
      const r = cli([command, renamed]);
      expect(r.code).toBe(1);
      expect(r.errors[0].message).toMatch(/^2 sources records in .* and none is named after the run: login\.sources\.json, other\.sources\.json$/);
      expect(r.errors[0].hint).toContain('sign-in.sources.json');
    }
    expect(readdirSync(join(renamed, 'source')).filter((f) => f.endsWith('.sources.json'))).toEqual(['login.sources.json', 'other.sources.json']);
  });
});
