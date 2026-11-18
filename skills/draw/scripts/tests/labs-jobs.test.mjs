import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createJobs, STATES, TRANSITIONS, canMove, jobErrors, questionErrors, MAX_QUEUED } from '../src/labs-jobs.mjs';
import { snapshotRun } from '../src/revisions.mjs';
import { labsProject } from './labs-project.mjs';

const S1 = 's-firstsession01';
const S2 = 's-secondsession2';
const setup = (limits = {}) => {
  const p = labsProject();
  const clock = { t: Date.parse('2026-11-18T06:00:00Z') };
  const jobs = createJobs({ root: p.root, now: () => clock.t, holdMs: 80, ...limits });
  jobs.started();
  return { p, clock, jobs };
};
const QUESTION = (id = 'q1', n = 1) => ({ id, body: 'Draft A moves approval before payment.', questions: Array.from({ length: n }, (_, i) => ({ header: `Q${i}`, question: `Question ${i}?`, options: [{ label: 'A', description: 'a' }, { label: 'B', description: 'b' }], multiSelect: false })) });
const err = async (fn) => { try { await fn(); return undefined; } catch (e) { return { status: e.status, code: e.code, extra: e.extra }; } };

describe('the state machine', () => {
  it('allows exactly the arrows of the diagram', () => {
    const arrows = [];
    for (const from of STATES) for (const to of STATES) if (canMove(from, to)) arrows.push(`${from}>${to}`);
    expect(arrows.sort()).toEqual(['needs-input>failed', 'needs-input>running', 'queued>cancelled', 'queued>running', 'running>done', 'running>failed', 'running>needs-input']);
    expect(Object.keys(TRANSITIONS)).toEqual(['queued', 'running', 'needs-input']);
  });
});

describe('checks when a job is queued', () => {
  const { p, jobs } = setup();
  const ctx = { runs: () => [p.runs.checkout, p.runs.login], diagrams: () => ['checkout'], revisions: () => ['r001'], source: (v) => v === 'docs/flow.drawio' };
  const ir = JSON.parse(readFileSync(join(p.root, 'diagrams', p.runs.checkout, 'source', 'checkout.ir.json'), 'utf8'));
  it.each([
    ['draw', { mode: 'clarify', request: 'a login flow', to: 'drawio', kind: 'sequence', scope: 'overview', audience: 'both', svg: true, doc: ['en', 'ja'] }],
    ['revise', { run: '20261110_checkout', request: 'add a stock check', preview: true }],
    ['restore', { run: '20261110_checkout', target: 'undo' }],
    ['restore', { run: '20261110_checkout', target: 'r001' }],
    ['apply-edit', { run: '20261110_checkout', diagram: 'checkout', baseRev: 'a'.repeat(64), ir }],
    ['sync', { run: '20261110_checkout' }],
    ['recook', { source: 'docs/flow.drawio', to: 'mermaid' }],
    ['export', { run: '20261110_checkout', svg: true, doc: ['vi'] }],
    ['glossary-suggest', { runs: 'all' }],
  ])('takes a valid %s job', (kind, params) => {
    expect(jobErrors(kind, params, ctx)).toEqual([]);
  });
  it.each([
    ['unknown kind', 'shell', {}],
    ['unknown parameter', 'sync', { run: '20261110_checkout', command: 'rm -rf' }],
    ['a run not listed', 'sync', { run: '../outside' }],
    ['a request of 4001 characters', 'revise', { run: '20261110_checkout', request: 'x'.repeat(4001) }],
    ['a control character', 'revise', { run: '20261110_checkout', request: 'a\u0007b' }],
    ['a revision the run lacks', 'restore', { run: '20261110_checkout', target: 'r009' }],
    ['an IR that fails validation', 'apply-edit', { run: '20261110_checkout', diagram: 'checkout', baseRev: 'a'.repeat(64), ir: { kind: 'flowchart' } }],
    ['a target not in the list', 'draw', { mode: 'scout', request: 'x', to: 'pdf' }],
    ['a source outside the project', 'recook', { source: '/etc/passwd' }],
  ])('refuses %s', (_, kind, params) => {
    expect(jobErrors(kind, params, ctx).length).toBeGreaterThan(0);
  });
  it('checks a source file on disk: inside the project, a file, or a board link', () => {
    const real = { runs: () => [], diagrams: () => [], revisions: () => [] };
    const errorsFor = (source) => { try { jobs.queue('recook', { source }); return []; } catch (e) { return e.extra.errors; } };
    expect(errorsFor('src/pay.js')).toEqual([]);
    expect(errorsFor('https://www.figma.com/board/AbCdEf0123456789/Team')).toEqual([]);
    for (const bad of ['../etc/passwd', '/etc/passwd', 'src', 'nope.drawio', 'http://evil.example/x']) expect(errorsFor(bad).length).toBeGreaterThan(0);
    expect(real).toBeDefined();
  });
  it('refuses a question file outside its schema', () => {
    expect(questionErrors(QUESTION('q', 4))).toEqual([]);
    expect(questionErrors(QUESTION('q', 5)).length).toBeGreaterThan(0);
    expect(questionErrors({ ...QUESTION(), id: 'a b' }).length).toBeGreaterThan(0);
    expect(questionErrors({ ...QUESTION(), extra: 1 }).length).toBeGreaterThan(0);
  });
});

describe('queue, wait and close', () => {
  it('hands out one job at a time, holds a second wait and returns nothing when the time is up', async () => {
    const { p, jobs } = setup();
    const a = jobs.queue('sync', { run: p.runs.checkout });
    const b = jobs.queue('export', { run: p.runs.checkout });
    const first = await jobs.wait(S1);
    expect(first.job).toMatchObject({ id: a.id, state: 'running', session: S1 });
    expect(jobs.holds(p.runs.checkout)).toMatchObject({ held: true, job: a.id, kind: 'sync' });
    expect(jobs.done(a.id, S1, 'done', 'All diagrams match the code.')).toEqual({ ok: true });
    expect(jobs.holds(p.runs.checkout)).toEqual({ held: false });
    const second = await jobs.wait(S1);
    expect(second.job.id).toBe(b.id);
    jobs.done(b.id, S1, 'done');
    expect(await jobs.wait(S1)).toEqual({ job: null });
  });

  it('closes the open job of a session that asks for new work as not-closed', async () => {
    const { p, jobs } = setup();
    const a = jobs.queue('sync', { run: p.runs.checkout });
    await jobs.wait(S1);
    await jobs.wait(S1);
    expect(jobs.detail(a.id)).toMatchObject({ state: 'failed', reason: 'not-closed' });
  });

  it('gives a held wait the job queued while it waits', async () => {
    const { p, jobs } = setup({ holdMs: 5000 });
    const held = jobs.wait(S1);
    const job = jobs.queue('sync', { run: p.runs.checkout });
    expect((await held).job.id).toBe(job.id);
  });

  it('bounds the queue at twenty waiting jobs', () => {
    const { p, jobs } = setup();
    for (let i = 0; i < MAX_QUEUED; i++) jobs.queue('sync', { run: p.runs.checkout });
    expect(() => jobs.queue('sync', { run: p.runs.checkout })).toThrow(expect.objectContaining({ status: 429 }));
  });

  it('cancels only a waiting job and refuses every other move', async () => {
    const { p, jobs } = setup();
    const a = jobs.queue('sync', { run: p.runs.checkout });
    const b = jobs.queue('sync', { run: p.runs.checkout });
    expect(jobs.cancel(b.id)).toEqual({ ok: true });
    expect(await err(() => jobs.cancel(b.id))).toMatchObject({ status: 409 });
    await jobs.wait(S1);
    expect(await err(() => jobs.cancel(a.id))).toMatchObject({ status: 409 });
    expect(await err(() => jobs.answer(a.id, 'q1', []))).toMatchObject({ status: 409 });
    jobs.done(a.id, S1, 'failed', 'could not');
    expect(jobs.detail(a.id)).toMatchObject({ state: 'failed', reason: 'agent', report: 'could not' });
    expect(await err(() => jobs.done(a.id, S1, 'done'))).toMatchObject({ status: 409, code: 'session-replaced' });
  });
});

describe('asking through the console', () => {
  it('shows up to four questions with a body and returns the answers in order', async () => {
    const { p, jobs } = setup({ holdMs: 5000 });
    const job = jobs.queue('revise', { run: p.runs.checkout, request: 'what if approval came first?' });
    await jobs.wait(S1);
    const asking = jobs.ask(job.id, S1, { ...QUESTION('pick-1', 3), attachments: ['drafts/a/changes.diff.drawio'] });
    const shown = jobs.detail(job.id);
    expect(shown).toMatchObject({ state: 'needs-input', ask: { id: 'pick-1', body: 'Draft A moves approval before payment.' } });
    expect(shown.ask.questions).toHaveLength(3);
    expect(shown.ask.attachments).toEqual([{ kind: 'run', name: 'drafts/a/changes.diff.drawio' }]);
    const answers = [{ selected: ['A'] }, { selected: ['B'] }, { selected: [], other: 'neither' }];
    expect(await err(() => jobs.answer(job.id, 'pick-1', answers.slice(0, 2)))).toMatchObject({ status: 422 });
    jobs.answer(job.id, 'pick-1', answers);
    expect(await asking).toEqual({ answers });
    expect(jobs.detail(job.id).state).toBe('running');
    expect(await err(() => jobs.ask(job.id, S1, QUESTION('pick-1')))).toMatchObject({ status: 400, code: 'bad-request' });
  });

  it('returns nothing when the time is up and the later answer when asked again, with one ask shown', async () => {
    const { p, jobs } = setup();
    const job = jobs.queue('revise', { run: p.runs.checkout, request: 'x' });
    await jobs.wait(S1);
    expect(await jobs.ask(job.id, S1, QUESTION('r1'))).toEqual({ answers: null });
    expect(jobs.detail(job.id).ask.id).toBe('r1');
    jobs.answer(job.id, 'r1', [{ selected: ['B'] }]);
    expect(await jobs.ask(job.id, S1, QUESTION('r1'))).toEqual({ answers: [{ selected: ['B'] }] });
    expect(jobs.detail(job.id).asked).toHaveLength(1);
    expect(await err(() => jobs.ask(job.id, S1, QUESTION('r1')))).toMatchObject({ code: 'bad-request' });
  });

  it('refuses an attachment that is not a file of the run or of the job folder', async () => {
    const { p, jobs } = setup();
    const job = jobs.queue('revise', { run: p.runs.checkout, request: 'x' });
    await jobs.wait(S1);
    for (const a of ['../20261109_login-flow/source/login-flow.ir.json', 'source/leak.txt', '@job/../../server.json', '@job/nothing.txt']) {
      expect(await err(() => jobs.ask(job.id, S1, { ...QUESTION('a'), attachments: [a] }))).toMatchObject({ status: 400 });
    }
  });
});

describe('sessions and contact', () => {
  it('refuses a second session while the first holds a job and was heard from, then lets it take over', async () => {
    const { p, clock, jobs } = setup();
    const job = jobs.queue('sync', { run: p.runs.checkout });
    await jobs.wait(S1);
    clock.t += 14 * 60_000;
    expect(await err(() => jobs.wait(S2))).toMatchObject({ status: 409, code: 'session-refused' });
    clock.t += 2 * 60_000;
    expect(await jobs.wait(S2)).toEqual({ job: null });
    expect(jobs.detail(job.id)).toMatchObject({ state: 'failed', reason: 'session-lost' });
    expect(await err(() => jobs.progress(job.id, S1, 'still here'))).toMatchObject({ code: 'session-replaced' });
    expect(await err(() => jobs.wait(S1))).toMatchObject({ code: 'session-replaced' });
  });

  it('takes over a session without a job after 60 seconds', async () => {
    const { clock, jobs } = setup();
    await jobs.wait(S1);
    clock.t += 30_000;
    expect(await err(() => jobs.wait(S2))).toMatchObject({ code: 'session-refused' });
    clock.t += 31_000;
    expect(await jobs.wait(S2)).toEqual({ job: null });
  });

  it('never takes over a session whose wait is open, however long it waits', async () => {
    const { clock, jobs } = setup({ holdMs: 5000 });
    const held = jobs.wait(S1);
    clock.t += 60 * 60_000;
    expect(await err(() => jobs.wait(S2))).toMatchObject({ code: 'session-refused' });
    jobs.release();
    await held;
  });

  it('tells a silent job, which the console may then mark as failed', async () => {
    const { p, clock, jobs } = setup();
    const job = jobs.queue('sync', { run: p.runs.checkout });
    await jobs.wait(S1);
    expect(jobs.state().jobs.open).toMatchObject({ id: job.id, silent: false });
    expect(await err(() => jobs.markFailed(job.id))).toMatchObject({ status: 409 });
    clock.t += 16 * 60_000;
    expect(jobs.state().jobs.open.silent).toBe(true);
    expect(jobs.markFailed(job.id)).toEqual({ ok: true });
    expect(jobs.detail(job.id)).toMatchObject({ state: 'failed', reason: 'marked' });
    expect(await err(() => jobs.done(job.id, S1, 'done'))).toMatchObject({ status: 409, code: 'session-replaced' });
  });

  it('reports the agent as absent, waiting or working', async () => {
    const { p, jobs } = setup({ holdMs: 5000 });
    expect(jobs.state().agent).toMatchObject({ attached: false, waiting: false });
    const held = jobs.wait(S1);
    expect(jobs.state().agent).toMatchObject({ attached: true, waiting: true });
    jobs.queue('sync', { run: p.runs.checkout });
    await held;
    expect(jobs.state().agent.waiting).toBe(false);
    expect(jobs.busy()).toBe(true);
  });
});

describe('persistence', () => {
  it('closes a job that was open when the server stopped and lists the revisions written since it started', async () => {
    const { p, clock, jobs } = setup();
    const job = jobs.queue('revise', { run: p.runs.checkout, request: 'x' });
    await new Promise((r) => setTimeout(r, 5));
    clock.t = Date.now();
    await jobs.wait(S1);
    await new Promise((r) => setTimeout(r, 5));
    snapshotRun(join(p.root, 'diagrams', p.runs.checkout), { request: 'during the job' });
    const again = createJobs({ root: p.root });
    again.started();
    const d = again.detail(job.id);
    expect(d).toMatchObject({ state: 'failed', reason: 'server-stopped' });
    expect(d.revisionsSince).toEqual(['r003']);
  });

  it('keeps the latest fifty finished jobs with their folders', async () => {
    const { p, jobs } = setup();
    const ir = JSON.parse(readFileSync(join(p.root, 'diagrams', p.runs.checkout, 'source', 'checkout.ir.json'), 'utf8'));
    const first = jobs.queue('apply-edit', { run: p.runs.checkout, diagram: 'checkout', baseRev: 'a'.repeat(64), ir });
    expect(existsSync(join(p.root, '.zukai', 'labs', 'jobs', first.id, 'ir.json'))).toBe(true);
    jobs.cancel(first.id);
    for (let i = 0; i < 55; i++) jobs.cancel(jobs.queue('sync', { run: p.runs.checkout }).id);
    const files = readdirSync(join(p.root, '.zukai', 'labs', 'jobs'));
    expect(files.filter((f) => f.endsWith('.json'))).toHaveLength(50);
    expect(existsSync(join(p.root, '.zukai', 'labs', 'jobs', first.id))).toBe(false);
  });
});

describe('records that came with a clone', () => {
  it('takes no record whose id is not its own form, and deletes or writes nothing outside the jobs folder', async () => {
    const { mkdirSync, writeFileSync, existsSync: exists } = await import('node:fs');
    const { p } = setup();
    const dir = join(p.root, '.zukai', 'labs', 'jobs');
    mkdirSync(dir, { recursive: true });
    const victim = join(p.root, 'victim');
    mkdirSync(victim);
    writeFileSync(join(victim, 'keep.txt'), 'keep');
    const base = { kind: 'sync', run: null, params: {}, progress: [], asked: [], ask: null };
    for (let i = 0; i < 52; i++) {
      const id = `j20261118-0600${String(i).padStart(2, '0')}-abcd`;
      writeFileSync(join(dir, `${id}.json`), JSON.stringify({ ...base, id, state: 'done', finishedAt: `2026-11-18T06:00:${String(i).padStart(2, '0')}Z` }));
    }
    writeFileSync(join(dir, 'forged.json'), JSON.stringify({ ...base, id: '../../../victim', state: 'done', finishedAt: '2000-01-01T00:00:00Z' }));
    writeFileSync(join(dir, 'written.json'), JSON.stringify({ ...base, id: '../../../written', state: 'running' }));
    writeFileSync(join(dir, 'j20261118-070000-abcd.json'), JSON.stringify({ id: 'j20261118-070000-abcd', state: 'done', kind: 'sync' }));
    const jobs = createJobs({ root: p.root });
    jobs.started();
    expect(exists(join(victim, 'keep.txt'))).toBe(true);
    expect(exists(join(p.root, 'written.json'))).toBe(false);
    expect(jobs.list()).toHaveLength(50);
    expect(() => jobs.state()).not.toThrow();
  });
});
