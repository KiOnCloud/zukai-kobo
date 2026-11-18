/**
 * The job bridge end to end, through the committed bundle: the console queues over HTTP, the
 * agent's commands take, ask, answer and close, and the limits hold (the cap of a held call,
 * one ask per id, a second session, a restart, the queue bound, holds).
 */
import { describe, it, expect, afterAll } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { createServer as createNetServer } from 'node:net';
import { request } from '../src/labs-client.mjs';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scriptsDir } from './helpers.mjs';
import { labsProject } from './labs-project.mjs';

const cliPath = join(scriptsDir, 'bin', 'cli.mjs');
const elsewhere = mkdtempSync(join(tmpdir(), 'zukai-bridge-cwd-'));
const LIMITS = { ZUKAI_LABS_HOLD_MS: '1500', ZUKAI_LABS_JOB_CONTACT_MS: '3000', ZUKAI_LABS_IDLE_CONTACT_MS: '1000' };
const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'CLAUDE_CODE_REMOTE' && !k.startsWith('ZUKAI_LABS_'))), ...LIMITS };
const parse = (text) => text.trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return l; } }).at(-1);
const run = (args) => new Promise((done) => {
  const child = spawn(process.execPath, [cliPath, ...args], { cwd: elsewhere, env });
  let out = '';
  let err = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });
  child.on('close', (code) => done({ code, out: parse(out), err: parse(err) }));
});
const runSync = (args) => { const r = spawnSync(process.execPath, [cliPath, ...args], { cwd: elsewhere, env, encoding: 'utf8' }); return { code: r.status, out: parse(r.stdout), err: parse(r.stderr) }; };
const freePort = () => new Promise((done) => { const s = createNetServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => done(port)); }); });
const roots = [];
afterAll(() => { for (const root of roots) runSync(['labs', 'stop', '--root', root, '--force']); });

async function console_() {
  const p = labsProject();
  const port = await freePort();
  const started = runSync(['labs', 'start', '--root', p.root, '--port', String(port)]);
  expect(started.code).toBe(0);
  roots.push(p.root);
  const { token } = JSON.parse(readFileSync(join(p.root, '.zukai', 'labs', 'server.json'), 'utf8'));
  // No pooled connection: a socket to a server that stopped is never reused.
  const api = (method, path, body) => request(port, { method, path, token, body });
  const file = (name, value) => { const f = join(p.root, name); writeFileSync(f, JSON.stringify(value)); return `@${f}`; };
  return { p, port, session: started.out.session, api, file, root: p.root };
}
const Q = (id, n) => ({ id, body: 'Draft A moves approval before payment (3 changes).', questions: Array.from({ length: n }, (_, i) => ({ header: `Q${i + 1}`, question: `Question ${i + 1}?`, options: [{ label: 'A', description: 'first' }, { label: 'B', description: 'second' }], multiSelect: false })) });

describe('the job bridge through the bundle', () => {
  it('queues, waits, asks three questions with a body, takes the answers and closes', async () => {
    const c = await console_();
    expect(c.session).toMatch(/^s-[A-Za-z0-9_-]{16}$/);
    const queued = await c.api('POST', '/api/jobs', { kind: 'revise', params: { run: c.p.runs.checkout, request: 'what if approval came first?' } });
    expect(queued.status).toBe(200);
    const id = queued.body.job.id;
    const waited = await run(['labs', 'wait', '--session', c.session, '--root', c.root]);
    expect(waited.out).toMatchObject({ session: c.session, job: { id, kind: 'revise', state: 'running' } });
    expect(runSync(['labs', 'holds', join(c.root, 'diagrams', c.p.runs.checkout), '--root', c.root])).toMatchObject({ code: 2, out: { held: true, job: id, kind: 'revise' } });
    expect(runSync(['labs', 'progress', id, '--session', c.session, '--message', 'drafting', '--root', c.root]).code).toBe(0);
    const asking = run(['labs', 'ask', id, '--session', c.session, '--question', c.file('q.json', Q('pick-1', 3)), '--timeout', '10', '--root', c.root]);
    let shown;
    for (let i = 0; i < 50 && shown?.state !== 'needs-input'; i++) { shown = (await c.api('GET', `/api/jobs/${id}`)).body; await new Promise((r) => setTimeout(r, 50)); }
    expect(shown.ask.body).toBe('Draft A moves approval before payment (3 changes).');
    expect(shown.ask.questions.map((q) => q.question)).toEqual(['Question 1?', 'Question 2?', 'Question 3?']);
    expect(shown.progress.map((x) => x.message)).toEqual(['drafting']);
    const answers = [{ selected: ['B'] }, { selected: ['A'] }, { selected: [], other: 'keep it' }];
    expect((await c.api('POST', `/api/jobs/${id}/answer`, { id: 'pick-1', answers })).status).toBe(200);
    expect((await asking).out).toEqual({ session: c.session, answers });
    writeFileSync(join(c.root, 'report.md'), 'Draft B applied as r003.\n');
    expect(runSync(['labs', 'done', id, '--session', c.session, '--result', 'done', '--report', `@${join(c.root, 'report.md')}`, '--root', c.root]).code).toBe(0);
    expect((await c.api('GET', `/api/jobs/${id}`)).body).toMatchObject({ state: 'done', report: 'Draft B applied as r003.\n' });
    expect(runSync(['labs', 'holds', c.p.runs.checkout, '--root', c.root])).toMatchObject({ code: 0, out: { held: false } });
  }, 60_000);

  it('returns nothing from a wait whose time is up, and from an ask cut by the cap, then the later answer', async () => {
    const c = await console_();
    expect((await run(['labs', 'wait', '--session', c.session, '--timeout', '0.5', '--root', c.root])).out).toEqual({ session: c.session, job: null });
    const { body } = await c.api('POST', '/api/jobs', { kind: 'sync', params: { run: c.p.runs.checkout } });
    await run(['labs', 'wait', '--session', c.session, '--root', c.root]);
    const q = c.file('q.json', Q('r1', 1));
    const first = await run(['labs', 'ask', body.job.id, '--session', c.session, '--question', q, '--root', c.root]);
    expect(first.out).toEqual({ session: c.session, answers: null });
    await c.api('POST', `/api/jobs/${body.job.id}/answer`, { id: 'r1', answers: [{ selected: ['A'] }] });
    expect((await run(['labs', 'ask', body.job.id, '--session', c.session, '--question', q, '--root', c.root])).out.answers).toEqual([{ selected: ['A'] }]);
    expect((await c.api('GET', `/api/jobs/${body.job.id}`)).body.asked).toHaveLength(1);
    const again = await run(['labs', 'ask', body.job.id, '--session', c.session, '--question', q, '--root', c.root]);
    expect(again).toMatchObject({ code: 1, err: { error: { code: 'bad-request' } } });
  }, 60_000);

  it('refuses a second session while the first holds a job, then lets it take over', async () => {
    const c = await console_();
    const { body } = await c.api('POST', '/api/jobs', { kind: 'sync', params: { run: c.p.runs.checkout } });
    await run(['labs', 'wait', '--session', c.session, '--root', c.root]);
    const other = runSync(['labs', 'start', '--root', c.root]).out.session;
    expect((await run(['labs', 'wait', '--session', other, '--timeout', '0.3', '--root', c.root])).err.error.code).toBe('session-refused');
    await new Promise((r) => setTimeout(r, 3200));
    expect((await run(['labs', 'wait', '--session', other, '--timeout', '0.3', '--root', c.root])).out).toEqual({ session: other, job: null });
    expect((await run(['labs', 'progress', body.job.id, '--session', c.session, '--message', 'x', '--root', c.root])).err.error.code).toBe('session-replaced');
    expect((await c.api('GET', `/api/jobs/${body.job.id}`)).body).toMatchObject({ state: 'failed', reason: 'session-lost' });
  }, 60_000);

  it('closes an open job as server-stopped when the server starts again', async () => {
    const c = await console_();
    const { body } = await c.api('POST', '/api/jobs', { kind: 'sync', params: { run: c.p.runs.checkout } });
    await run(['labs', 'wait', '--session', c.session, '--root', c.root]);
    expect(runSync(['labs', 'stop', '--root', c.root]).err.error.code).toBe('job-open');
    expect(runSync(['labs', 'stop', '--root', c.root, '--force']).code).toBe(0);
    expect(runSync(['labs', 'holds', c.p.runs.checkout, '--root', c.root])).toMatchObject({ code: 0, out: { held: false } });
    const restarted = runSync(['labs', 'start', '--root', c.root, '--port', String(c.port)]);
    expect(restarted.code).toBe(0);
    const { token } = JSON.parse(readFileSync(join(c.root, '.zukai', 'labs', 'server.json'), 'utf8'));
    const job = (await request(c.port, { path: `/api/jobs/${body.job.id}`, token })).body;
    expect(job).toMatchObject({ state: 'failed', reason: 'server-stopped' });
  }, 60_000);

  it('refuses an invalid job with 422, the twenty-first with 429', async () => {
    const c = await console_();
    expect((await c.api('POST', '/api/jobs', { kind: 'apply-edit', params: { run: c.p.runs.checkout, diagram: 'checkout', baseRev: 'a'.repeat(64), ir: { kind: 'flowchart' } } })).status).toBe(422);
    expect((await c.api('POST', '/api/jobs', { kind: 'revise', params: { run: c.p.runs.checkout, request: 'x'.repeat(4001) } })).status).toBe(422);
    expect((await c.api('GET', '/api/jobs')).body.jobs).toEqual([]);
    for (let i = 0; i < 20; i++) expect((await c.api('POST', '/api/jobs', { kind: 'sync', params: { run: c.p.runs.checkout } })).status).toBe(200);
    expect((await c.api('POST', '/api/jobs', { kind: 'sync', params: { run: c.p.runs.checkout } })).status).toBe(429);
    const state = (await c.api('GET', '/api/state')).body;
    expect(state.jobs.queued).toBe(20);
    expect(state.agent.attached).toBe(false);
  }, 60_000);

  it('answers holds with no server, and keeps every exit code at 0, 1 or 2', () => {
    const root = mkdtempSync(join(tmpdir(), 'zukai-bridge-none-'));
    expect(runSync(['labs', 'holds', 'diagrams/20261110_checkout', '--root', root])).toMatchObject({ code: 0, out: { held: false } });
    expect(runSync(['labs', 'wait', '--session', 's-abcdefghijkl', '--root', root])).toMatchObject({ code: 1, err: { error: { code: 'no-server' } } });
    expect(runSync(['labs', 'done', 'j1', '--session', 's-abcdefghijkl', '--result', 'maybe', '--root', root]).code).toBe(1);
  });
});
