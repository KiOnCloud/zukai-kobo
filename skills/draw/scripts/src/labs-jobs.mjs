/**
 * The job queue of the labs console and its bridge to the attached agent session.
 *
 * The console asks for a change by queueing a job; the server owns the job state alone. The
 * agent that runs `/zukai:labs` takes one job at a time (`wait`), carries it out with the
 * existing skills, asks the user through the console (`ask`) and closes it (`done`). The
 * server cannot call the agent: the agent's calls are held open until there is something
 * for them, at most nine minutes, and "nothing yet" is never an answer.
 *
 *   queued ──wait──▶ running ◀──answer── needs-input
 *      │                │  └──ask──────────▲
 *      │                └──done──▶ done | failed
 *      └──cancel──▶ cancelled
 *   running | needs-input ──▶ failed: server-stopped, session-lost, not-closed, marked
 *
 * A job that died is never taken up again: a snapshot is taken before an IR is edited, so a
 * revision proves nothing about how far a change got. The console shows the revisions
 * written while it ran and offers an undo as a job of its own.
 *
 * One agent session is attached at a time. Contact of a session is any call it makes, and
 * all the time one of its held calls is open. Another session takes over only when the
 * attached one has been out of contact for 60 seconds while it holds no job, or 15 minutes
 * while it holds one.
 */
import { mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync, lstatSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join, relative, resolve, sep, isAbsolute } from 'node:path';
import { KINDS, validateIr } from './validate-ir.mjs';
import { DOC_LANGS, TARGETS } from './pipeline.mjs';
import { listRevisions } from './revisions.mjs';
import { projectRoot } from './glossary.mjs';
import { runNames, runPath, diagramIds, revisionNames, listFiles } from './labs-runs.mjs';

export const STATES = ['queued', 'running', 'needs-input', 'done', 'failed', 'cancelled'];
export const OPEN_STATES = new Set(['running', 'needs-input']);
export const FINISHED_STATES = new Set(['done', 'failed', 'cancelled']);
export const FAIL_REASONS = ['server-stopped', 'session-lost', 'not-closed', 'marked', 'agent'];

/** Every allowed arrow of the state diagram, by the event that takes it. */
export const TRANSITIONS = {
  queued: { running: 'wait', cancelled: 'cancel' },
  running: { 'needs-input': 'ask', done: 'done', failed: 'done' },
  'needs-input': { running: 'answer', failed: 'fail' },
};
export const canMove = (from, to) => Object.hasOwn(TRANSITIONS[from] ?? {}, to);

export const MAX_QUEUED = 20;
export const MAX_REQUEST = 4000;
export const KEEP_FINISHED = 50;
const MODES = ['clarify', 'scout', 'brainstorm'];
const SCOPES = ['overview', 'detailed'];
const AUDIENCES = ['technical', 'business', 'both'];
const DRAW_TARGETS = TARGETS;
const REV_RE = /^r\d{3,}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const BOARD_LINK = /^https:\/\/(www\.)?figma\.com\/board\/[A-Za-z0-9]{10,}(\/[^\s]*)?$/;
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F؜‎‏‪-‮⁦-⁩]/;

/** A job's parameters, by kind: the name of each and the check of its value. */
function kindSpecs(ctx) {
  const run = (v) => ctx.runs().includes(v) || 'is not a run of this project';
  const request = (v) => (typeof v === 'string' && v.trim() !== '' && v.length <= MAX_REQUEST && !CONTROL.test(v)) || `is text of 1 to ${MAX_REQUEST} characters with no control character`;
  const bool = (v) => typeof v === 'boolean' || 'is true or false';
  const oneOf = (list) => (v) => list.includes(v) || `is one of ${list.join(', ')}`;
  const langs = (v) => (Array.isArray(v) && v.length > 0 && v.every((x) => DOC_LANGS.includes(x)) && new Set(v).size === v.length) || `is a list of ${DOC_LANGS.join(', ')}`;
  const drawOptions = { to: oneOf(DRAW_TARGETS), kind: oneOf(KINDS), scope: oneOf(SCOPES), audience: oneOf(AUDIENCES), svg: bool, doc: langs };
  return {
    draw: { required: { mode: oneOf(MODES), request }, optional: drawOptions },
    revise: { required: { run, request }, optional: { preview: bool, svg: bool, doc: langs } },
    restore: { required: { run, target: (v, p) => v === 'undo' || v === 'redo' || (REV_RE.test(v) && ctx.revisions(p.run).includes(v)) || 'is undo, redo or a revision of the run' } },
    'apply-edit': { required: { run, diagram: (v, p) => ctx.diagrams(p.run).includes(v) || 'is not a diagram of the run', baseRev: (v) => (typeof v === 'string' && HEX64.test(v)) || 'is the rev the IR was loaded with', ir: (v) => { const r = validateIr(v); return r.ok || { message: 'the edited IR does not pass validation', errors: r.errors }; } } },
    sync: { required: { run } },
    recook: { required: { source: (v) => ctx.source(v) || 'is a file inside the project or a FigJam board link' }, optional: drawOptions },
    export: { required: { run }, optional: { svg: bool, doc: langs } },
    'glossary-suggest': { required: { runs: (v) => v === 'all' || (Array.isArray(v) && v.length > 0 && v.every((x) => ctx.runs().includes(x))) || 'is "all" or a list of runs of this project' } },
  };
}

/** Problems of a job a console wants to queue. */
export function jobErrors(kind, params, ctx) {
  const specs = kindSpecs(ctx);
  if (!Object.hasOwn(specs, kind)) return [{ path: '/kind', message: `unknown kind "${kind}"`, hint: `one of ${Object.keys(specs).join(', ')}` }];
  if (params === null || typeof params !== 'object' || Array.isArray(params)) return [{ path: '/params', message: 'params must be an object' }];
  const { required, optional = {} } = specs[kind];
  const errors = [];
  for (const key of Object.keys(params)) if (!Object.hasOwn(required, key) && !Object.hasOwn(optional, key)) errors.push({ path: `/params/${key}`, message: `a ${kind} job takes no "${key}"` });
  for (const [key, check] of Object.entries({ ...required, ...optional })) {
    if (!Object.hasOwn(params, key)) { if (Object.hasOwn(required, key)) errors.push({ path: `/params/${key}`, message: `"${key}" is needed` }); continue; }
    const ok = check(params[key], params);
    if (ok === true) continue;
    if (typeof ok === 'object') errors.push({ path: `/params/${key}`, message: ok.message, errors: ok.errors });
    else errors.push({ path: `/params/${key}`, message: `"${key}" ${ok}` });
  }
  return errors;
}

/** Problems of a question file, the fields `AskUserQuestion` takes. */
export function questionErrors(q) {
  const errors = [];
  const text = (v, max) => typeof v === 'string' && v.trim() !== '' && v.length <= max;
  if (q === null || typeof q !== 'object' || Array.isArray(q)) return [{ path: '/', message: 'a question file is a JSON object with id, questions and optionally body and attachments' }];
  for (const key of Object.keys(q)) if (!['id', 'body', 'questions', 'attachments'].includes(key)) errors.push({ path: `/${key}`, message: `unknown field "${key}"` });
  if (typeof q.id !== 'string' || !/^[A-Za-z0-9_.-]{1,64}$/.test(q.id)) errors.push({ path: '/id', message: 'id names this ask: letters, digits, dot, underscore and hyphen, 1 to 64' });
  if (q.body !== undefined && !(typeof q.body === 'string' && q.body.length <= 20_000)) errors.push({ path: '/body', message: 'body is text of at most 20000 characters' });
  if (!Array.isArray(q.questions) || q.questions.length < 1 || q.questions.length > 4) errors.push({ path: '/questions', message: 'one to four questions' });
  else q.questions.forEach((x, i) => {
    const at = `/questions/${i}`;
    if (x === null || typeof x !== 'object') { errors.push({ path: at, message: 'a question is an object' }); return; }
    for (const key of Object.keys(x)) if (!['header', 'question', 'options', 'multiSelect'].includes(key)) errors.push({ path: `${at}/${key}`, message: `unknown field "${key}"` });
    if (!text(x.header, 30)) errors.push({ path: `${at}/header`, message: 'header is a short text of at most 30 characters' });
    if (!text(x.question, 1000)) errors.push({ path: `${at}/question`, message: 'question is text of at most 1000 characters' });
    if (x.multiSelect !== undefined && typeof x.multiSelect !== 'boolean') errors.push({ path: `${at}/multiSelect`, message: 'multiSelect is true or false' });
    if (!Array.isArray(x.options) || x.options.length < 2 || x.options.length > 4) errors.push({ path: `${at}/options`, message: 'two to four options' });
    else {
      x.options.forEach((o, j) => {
        if (o === null || typeof o !== 'object' || !text(o.label, 120) || (o.description !== undefined && !(typeof o.description === 'string' && o.description.length <= 1000))) errors.push({ path: `${at}/options/${j}`, message: 'an option has a label of at most 120 characters and a description' });
      });
      if (new Set(x.options.map((o) => o?.label)).size !== x.options.length) errors.push({ path: `${at}/options`, message: 'option labels are different from each other' });
    }
  });
  if (q.attachments !== undefined && !(Array.isArray(q.attachments) && q.attachments.length <= 8 && q.attachments.every((a) => typeof a === 'string' && a !== ''))) errors.push({ path: '/attachments', message: 'attachments is a list of at most eight file names' });
  return errors;
}

/** Problems of the answers to an ask: one per question, labels of its options or another text. */
export function answerErrors(ask, answers) {
  if (!Array.isArray(answers) || answers.length !== ask.questions.length) return [{ path: '/answers', message: `one answer per question (${ask.questions.length})` }];
  const errors = [];
  answers.forEach((a, i) => {
    const q = ask.questions[i];
    const at = `/answers/${i}`;
    if (a === null || typeof a !== 'object' || !Array.isArray(a.selected)) { errors.push({ path: at, message: 'an answer is { selected: [labels], other? }' }); return; }
    const labels = q.options.map((o) => o.label);
    if (a.selected.some((s) => !labels.includes(s))) errors.push({ path: `${at}/selected`, message: 'an answer selects labels of the question\'s options' });
    if (!q.multiSelect && a.selected.length > 1) errors.push({ path: `${at}/selected`, message: 'this question takes one option' });
    const other = a.other;
    if (other !== undefined && !(typeof other === 'string' && other.length <= MAX_REQUEST && !CONTROL.test(other))) errors.push({ path: `${at}/other`, message: `another answer is text of at most ${MAX_REQUEST} characters` });
    if (a.selected.length === 0 && !(typeof other === 'string' && other.trim() !== '')) errors.push({ path: at, message: 'select an option or write another answer' });
  });
  return errors;
}

const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

/**
 * The jobs of one project: records under `.zukai/labs/jobs/`, the attached session, and the
 * held calls. `now` and the limits are injected so the rules can be tested with a clock.
 */
export function createJobs({ root: rootOption, now = Date.now, holdMs = 9 * 60_000, idleContactMs = 60_000, jobContactMs = 15 * 60_000, log = () => {} } = {}) {
  const root = projectRoot(rootOption);
  const dir = join(root, '.zukai', 'labs', 'jobs');
  const jobs = new Map();
  const replaced = new Set();
  let session = null; // { id, lastContact, held }
  const waiters = []; // held waits: { session, resolve, timer }
  const askers = new Map(); // job id -> { session, resolve, timer }
  let onChange = () => {};

  const iso = () => new Date(now()).toISOString();
  const folderOf = (id) => join(dir, id);
  const save = (job) => {
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${job.id}.json`);
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(job, null, 2)}\n`);
    renameSync(tmp, file);
    onChange();
  };
  const fail = (status, code, message, extra) => { const e = new Error(message); e.status = status; e.code = code; e.extra = extra; e.isJobError = true; throw e; };
  const openJob = () => [...jobs.values()].find((j) => OPEN_STATES.has(j.state));
  // Jobs are handed out in the order they were queued: `seq` counts up, whatever the clock says.
  let seq = 0;
  const queued = () => [...jobs.values()].filter((j) => j.state === 'queued').sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));

  const move = (job, to, extra = {}) => {
    if (!canMove(job.state, to)) fail(409, 'conflict', `a job that is ${job.state} cannot become ${to}`);
    Object.assign(job, extra, { state: to });
    if (FINISHED_STATES.has(to)) job.finishedAt = iso();
    save(job);
  };

  const ctx = {
    runs: () => runNames(root),
    diagrams: (run) => diagramIds(root, run),
    revisions: (run) => revisionNames(root, run),
    source: (v) => {
      if (typeof v !== 'string' || v === '' || v.length > 1000) return false;
      if (BOARD_LINK.test(v)) return true;
      if (isAbsolute(v) || v.includes('\0')) return false;
      try {
        const real = realpathSync(resolve(root, v));
        const rel = relative(realpathSync(root), real);
        return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel) && !rel.split(sep).includes('..') && lstatSync(real).isFile();
      } catch {
        return false;
      }
    },
  };

  /** Read the records; close a job that was open when the server stopped; prune. */
  function started() {
    let names = [];
    try { names = readdirSync(dir).filter((n) => n.endsWith('.json')); } catch { /* no jobs yet */ }
    for (const n of names) {
      try {
        const job = JSON.parse(readFileSync(join(dir, n), 'utf8'));
        if (job && typeof job.id === 'string' && STATES.includes(job.state)) jobs.set(job.id, job);
      } catch { /* a broken record is left out */ }
    }
    seq = Math.max(0, ...[...jobs.values()].map((j) => j.seq ?? 0));
    for (const job of jobs.values()) {
      if (OPEN_STATES.has(job.state)) {
        Object.assign(job, { state: 'failed', reason: 'server-stopped', finishedAt: iso(), ask: null });
        save(job);
        log({ event: 'job-closed', reason: 'server-stopped' });
      }
    }
    prune();
  }

  function prune() {
    const finished = [...jobs.values()].filter((j) => FINISHED_STATES.has(j.state)).sort((a, b) => (a.finishedAt < b.finishedAt ? 1 : -1));
    for (const job of finished.slice(KEEP_FINISHED)) {
      jobs.delete(job.id);
      rmSync(join(dir, `${job.id}.json`), { force: true });
      rmSync(folderOf(job.id), { recursive: true, force: true });
    }
  }

  /** Queue a job from the console. */
  function queue(kind, params) {
    const errors = jobErrors(kind, params, ctx);
    if (errors.length > 0) fail(422, 'invalid', 'the job was not queued', { errors });
    if (queued().length >= MAX_QUEUED) fail(429, 'queue-full', `at most ${MAX_QUEUED} jobs wait at a time`);
    const at = new Date(now());
    let id;
    do id = `j${stamp(at)}-${randomBytes(2).toString('hex')}`; while (jobs.has(id));
    const { ir, ...rest } = params;
    seq += 1;
    const job = { id, seq, kind, run: params.run ?? null, params: rest, state: 'queued', createdAt: at.toISOString(), startedAt: null, finishedAt: null, session: null, progress: [], ask: null, asked: [], report: null, reason: null };
    if (kind === 'apply-edit') {
      mkdirSync(folderOf(id), { recursive: true });
      writeFileSync(join(folderOf(id), 'ir.json'), `${JSON.stringify(ir, null, 2)}\n`);
    }
    jobs.set(id, job);
    save(job);
    handOut();
    return job;
  }

  const inContact = (s) => s.held > 0 || now() - s.lastContact < (openJob()?.session === s.id ? jobContactMs : idleContactMs);
  const touch = (id) => { if (session?.id === id) session.lastContact = now(); };

  /** Attach a session, refuse it, or let it take over a session that is out of contact. */
  function attach(id) {
    if (typeof id !== 'string' || !/^s-[A-Za-z0-9_-]{8,64}$/.test(id)) fail(400, 'bad-request', 'a session id is s- and letters or digits, as labs start prints it');
    if (replaced.has(id)) fail(409, 'session-replaced', 'another session took over, or the job of this session was closed');
    if (session && session.id !== id) {
      if (inContact(session)) fail(409, 'session-refused', 'another agent session is attached to this console', { lastContact: new Date(session.lastContact).toISOString() });
      takeOver(id);
    }
    if (!session) session = { id, lastContact: now(), held: 0 };
    session.lastContact = now();
    return session;
  }

  function takeOver(id) {
    const old = session;
    replaced.add(old.id);
    const job = openJob();
    if (job && job.session === old.id) closeOpen(job, 'session-lost');
    for (const w of waiters.filter((x) => x.session === old.id)) w.settle({ error: { status: 409, code: 'session-replaced', message: 'another session took over' } });
    log({ event: 'takeover' });
    session = { id, lastContact: now(), held: 0 };
  }

  function closeOpen(job, reason) {
    const asker = askers.get(job.id);
    Object.assign(job, { state: 'failed', reason, finishedAt: iso(), ask: null });
    save(job);
    if (asker) asker.settle({ error: { status: 409, code: 'session-replaced', message: `the job was closed: ${reason}` } });
  }

  /** Give the next queued job to a waiting session, when no job is open. */
  function handOut() {
    if (openJob()) return;
    const next = queued()[0];
    const waiter = waiters.find((w) => w.session === session?.id);
    if (!next || !waiter) return;
    move(next, 'running', { startedAt: iso(), session: waiter.session });
    waiter.settle({ job: forAgent(next) });
  }

  const forAgent = (job) => ({ ...job, folder: folderOf(job.id), ...(job.kind === 'apply-edit' ? { irFile: join(folderOf(job.id), 'ir.json') } : {}) });

  /** Hold a call until `settle` is called, the cap or the client's timeout passes, or the client goes. */
  function hold(id, { timeoutMs, signal }, onTimeout, register) {
    return new Promise((resolveHold) => {
      const s = attach(id);
      s.held += 1;
      let settled = false;
      const entry = { session: id };
      const settle = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(entry.timer);
        if (session?.id === id) { session.held = Math.max(0, session.held - 1); session.lastContact = now(); }
        register(entry, false);
        resolveHold(value);
      };
      entry.settle = settle;
      const ms = Math.min(holdMs, timeoutMs && timeoutMs > 0 ? timeoutMs : holdMs);
      entry.timer = setTimeout(() => settle(onTimeout()), ms);
      signal?.addEventListener('abort', () => settle({ aborted: true }), { once: true });
      register(entry, true);
    });
  }

  /** `labs wait`: the next job, or none when the time is up. */
  async function wait(id, opts = {}) {
    attach(id);
    const open = openJob();
    if (open && open.session === id) closeOpen(open, 'not-closed');
    const ready = !openJob() && queued()[0];
    if (ready) {
      move(ready, 'running', { startedAt: iso(), session: id });
      return { job: forAgent(ready) };
    }
    return hold(id, opts, () => ({ job: null }), (entry, add) => {
      if (add) waiters.push(entry);
      else { const i = waiters.indexOf(entry); if (i >= 0) waiters.splice(i, 1); }
    });
  }

  const ownJob = (jobId, id) => {
    attach(id);
    const job = jobs.get(jobId);
    if (!job) fail(404, 'not-found', 'no such job');
    if (job.session !== id) fail(409, 'session-replaced', 'this job is not held by this session');
    if (!OPEN_STATES.has(job.state)) fail(409, 'session-replaced', `the job was closed: ${job.reason ?? job.state}`);
    return job;
  };

  function progress(jobId, id, message) {
    const job = ownJob(jobId, id);
    if (typeof message !== 'string' || message.trim() === '' || message.length > 500 || CONTROL.test(message)) fail(400, 'bad-request', 'a progress message is one line of at most 500 characters');
    job.progress = [...job.progress, { at: iso(), message }].slice(-100);
    save(job);
    return { ok: true };
  }

  /** The attachments of an ask, checked like every file parameter: a file of the run, or `@job/<name>` in the job's folder. */
  function attachmentsOf(job, list = []) {
    return list.map((a) => {
      if (a.startsWith('@job/')) {
        const name = a.slice(5);
        const path = jobFile(job.id, name);
        if (!path) fail(400, 'bad-request', `no file "${name}" in the job's folder`);
        return { kind: 'job', name };
      }
      if (!job.run || !listFiles(runPath(root, job.run)).some((f) => f.name === a)) fail(400, 'bad-request', `"${a}" is not a file of the job's run`);
      return { kind: 'run', name: a };
    });
  }

  /** `labs ask`: show questions in the console and hold until they are answered. */
  async function ask(jobId, id, question, opts = {}) {
    const job = ownJob(jobId, id);
    const errors = questionErrors(question);
    if (errors.length > 0) fail(400, 'bad-request', 'the question file does not match its schema', { errors });
    if (job.asked.some((a) => a.id === question.id && a.delivered)) fail(400, 'bad-request', `the ask "${question.id}" was answered already; a new round needs an id of its own`);
    const answered = job.asked.find((a) => a.id === question.id && !a.delivered);
    if (answered) {
      answered.delivered = true;
      save(job);
      return { answers: answered.answers };
    }
    if (job.ask && job.ask.id !== question.id) fail(409, 'conflict', `the ask "${job.ask.id}" is still open`);
    if (!job.ask) move(job, 'needs-input', { ask: { id: question.id, body: question.body ?? '', questions: question.questions, attachments: attachmentsOf(job, question.attachments), askedAt: iso() } });
    return hold(id, opts, () => ({ answers: null }), (entry, add) => {
      if (add) {
        // A second call for the same open ask replaces the first, which ends as "nothing yet".
        const previous = askers.get(jobId);
        askers.set(jobId, entry);
        previous?.settle({ answers: null });
      }
      else if (askers.get(jobId) === entry) askers.delete(jobId);
    });
  }

  /** The console answers the open ask of a job. */
  function answer(jobId, askId, answers) {
    const job = jobs.get(jobId);
    if (!job) fail(404, 'not-found', 'no such job');
    if (job.state !== 'needs-input' || !job.ask || job.ask.id !== askId) fail(409, 'conflict', 'this job is not waiting for that answer');
    const errors = answerErrors(job.ask, answers);
    if (errors.length > 0) fail(422, 'invalid', 'the answers do not fit the questions', { errors });
    const asker = askers.get(jobId);
    const record = { ...job.ask, answers, answeredAt: iso(), delivered: Boolean(asker) };
    move(job, 'running', { ask: null, asked: [...job.asked, record] });
    asker?.settle({ answers });
    return { ok: true };
  }

  /** `labs done`. */
  function done(jobId, id, result, report) {
    const job = ownJob(jobId, id);
    if (result !== 'done' && result !== 'failed') fail(400, 'bad-request', 'the result is done or failed');
    if (report !== undefined && report !== null && !(typeof report === 'string' && report.length <= 200_000)) fail(400, 'bad-request', 'a report is text of at most 200000 characters');
    if (job.state === 'needs-input') fail(409, 'conflict', 'the job waits for an answer; close it after the answer, or close it as failed from the console');
    move(job, result, { report: report ?? null, reason: result === 'failed' ? 'agent' : null });
    prune();
    return { ok: true };
  }

  /** An open job whose session has not been heard from for 15 minutes, or is no longer attached. */
  const silent = (job) => {
    if (!OPEN_STATES.has(job.state)) return false;
    if (!session || session.id !== job.session) return true;
    return !(session.held > 0 || now() - session.lastContact < jobContactMs);
  };

  function cancel(jobId) {
    const job = jobs.get(jobId);
    if (!job) fail(404, 'not-found', 'no such job');
    if (job.state !== 'queued') fail(409, 'conflict', 'only a waiting job can be cancelled; stop the agent in its session, or mark a silent job as failed');
    move(job, 'cancelled');
    prune();
    return { ok: true };
  }

  function markFailed(jobId) {
    const job = jobs.get(jobId);
    if (!job) fail(404, 'not-found', 'no such job');
    if (!OPEN_STATES.has(job.state)) fail(409, 'conflict', `a job that is ${job.state} cannot be marked as failed`);
    if (!silent(job)) fail(409, 'conflict', 'the agent was heard from in the last 15 minutes; a job is marked as failed only when its agent is silent');
    closeOpen(job, 'marked');
    // The silent session is detached: its next call learns that the job was closed.
    if (session?.id === job.session) {
      replaced.add(job.session);
      session = null;
    }
    prune();
    return { ok: true };
  }

  /** The open job on a run, for `labs holds`. */
  function holds(run) {
    const job = openJob();
    return job && job.run === run ? { held: true, job: job.id, kind: job.kind, since: job.startedAt } : { held: false };
  }

  const summary = (job) => ({ id: job.id, kind: job.kind, run: job.run, state: job.state, createdAt: job.createdAt, startedAt: job.startedAt, finishedAt: job.finishedAt, reason: job.reason, request: job.params.request ?? null });

  /** A job as the console reads it, with the revisions its run got while it ran. */
  function detail(jobId) {
    const job = jobs.get(jobId);
    if (!job) return undefined;
    let revisionsSince = [];
    if (job.run && job.startedAt && runPath(root, job.run)) {
      const r = listRevisions(runPath(root, job.run));
      if (r.ok) revisionsSince = r.revisions.filter((x) => x.createdAt && x.createdAt >= job.startedAt && (!job.finishedAt || x.createdAt <= job.finishedAt || OPEN_STATES.has(job.state))).map((x) => x.rev).reverse();
    }
    return { ...job, silent: silent(job), revisionsSince };
  }

  /** A file of the job's folder: a plain name of the folder whose real path lies inside it. */
  function jobFile(jobId, name) {
    if (!jobs.has(jobId) || typeof name !== 'string' || !/^[A-Za-z0-9_.-][A-Za-z0-9_./-]*$/.test(name) || name.split('/').includes('..')) return undefined;
    const folder = folderOf(jobId);
    try {
      const real = realpathSync(join(folder, ...name.split('/')));
      const rel = relative(realpathSync(folder), real);
      return rel && !rel.startsWith('..') && lstatSync(real).isFile() ? real : undefined;
    } catch {
      return undefined;
    }
  }

  function state() {
    const open = openJob();
    return {
      agent: { attached: Boolean(session), waiting: Boolean(session && waiters.some((w) => w.session === session.id)), lastContact: session ? new Date(session.lastContact).toISOString() : null },
      jobs: { queued: queued().length, queue: queued().map(summary), open: open ? { ...summary(open), silent: silent(open), ask: open.ask ? { id: open.ask.id } : null } : null },
    };
  }

  /** Release every held call: the server is ending. */
  function release() {
    for (const w of [...waiters]) w.settle({ error: { status: 503, code: 'no-server', message: 'the console stopped' } });
    for (const a of [...askers.values()]) a.settle({ error: { status: 503, code: 'no-server', message: 'the console stopped' } });
  }

  /** The server must not end: a held call, an open job, or a queued one with an agent heard from in the last 15 minutes. */
  const busy = () => waiters.length > 0 || askers.size > 0 || Boolean(openJob()) || (queued().length > 0 && session !== null && now() - session.lastContact < jobContactMs);

  const api = {
    started, queue, wait, progress, ask, answer, done, cancel, markFailed, holds, detail, state, release, busy, jobFile,
    list: () => [...jobs.values()].sort((a, b) => (b.seq ?? 0) - (a.seq ?? 0)).map(summary),
    open: () => Boolean(openJob()),
    touch,
    setOnChange: (fn) => { onChange = fn; },
    get session() { return session; },
  };
  api.routes = (c) => jobRoutes(api, c);
  return api;
}

/** The HTTP routes of the jobs, for `createLabsServer`. */
export function jobRoutes(jobs, { bump, HttpError, notFound, body }) {
  jobs.setOnChange(bump);
  const call = async (fn) => {
    try {
      const out = await fn();
      if (out?.error) throw new HttpError(out.error.status, out.error.code, out.error.message);
      if (out?.aborted) return { status: 499, body: { aborted: true } };
      return { body: out };
    } catch (e) {
      if (e.isJobError) throw new HttpError(e.status, e.code, e.message, e.extra ?? {});
      throw e;
    }
  };
  const ms = (s) => (typeof s === 'number' && s > 0 ? Math.round(s * 1000) : undefined);
  return [
    ['POST', '/api/jobs', ({ req }) => call(() => { const b = body(req); const job = jobs.queue(b.kind, b.params ?? {}); return { job: jobs.detail(job.id) }; })],
    ['GET', '/api/jobs', () => ({ body: { jobs: jobs.list() } })],
    ['GET', '/api/jobs/:id', ({ params }) => { const d = jobs.detail(params.id); if (!d) throw notFound(); return { body: d }; }],
    ['GET', '/api/jobs/:id/files/:name', ({ params }) => {
      const d = jobs.detail(params.id);
      if (!d || !d.ask || !d.ask.attachments.some((a) => a.kind === 'job' && a.name === params.name)) throw notFound();
      const path = jobs.jobFile(params.id, params.name);
      if (!path) throw notFound();
      return { body: { name: params.name, text: readFileSync(path, 'utf8') } };
    }],
    ['POST', '/api/jobs/:id/answer', ({ req, params }) => call(() => { const b = body(req); return jobs.answer(params.id, b.id, b.answers); })],
    ['POST', '/api/jobs/:id/cancel', ({ params }) => call(() => jobs.cancel(params.id))],
    ['POST', '/api/jobs/:id/fail', ({ params }) => call(() => jobs.markFailed(params.id))],
    ['POST', '/agent/wait', ({ req, signal }) => call(async () => { const b = body(req); const r = await jobs.wait(b.session, { timeoutMs: ms(b.timeout), signal }); return r.error || r.aborted ? r : { session: b.session, job: r.job }; })],
    ['POST', '/agent/jobs/:id/progress', ({ req, params }) => call(() => { const b = body(req); return jobs.progress(params.id, b.session, b.message); })],
    ['POST', '/agent/jobs/:id/ask', ({ req, params, signal }) => call(async () => { const b = body(req); const r = await jobs.ask(params.id, b.session, b.question, { timeoutMs: ms(b.timeout), signal }); return r.error || r.aborted ? r : { session: b.session, answers: r.answers }; })],
    ['POST', '/agent/jobs/:id/done', ({ req, params }) => call(() => { const b = body(req); return jobs.done(params.id, b.session, b.result, b.report); })],
    ['GET', '/agent/holds', ({ query }) => ({ body: jobs.holds(query.get('run')) })],
  ];
}

