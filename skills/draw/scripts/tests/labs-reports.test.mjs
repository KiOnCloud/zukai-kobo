/**
 * The Reports part of the labs server and jobs on a real listener: the report and template
 * routes, the quick edit with its rev conflict and its refusals while a report job or a draft
 * holds the report, a restore, query values looked up in listings, the import dry run and its
 * refusals, a bad reportsDir that stops the report routes only, the sealed report frame's
 * headers, the change stamp, and the four report job kinds with `reportName` beside `report`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { request as httpRequest } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createLabsServer, reportFrameCsp, viewerScriptHash } from '../src/labs-server.mjs';
import { createJobs, jobErrors } from '../src/labs-jobs.mjs';
import { newReport, newDraft, textRev, snapshotReport, renderReport } from '../src/reports.mjs';
import { addEntries } from '../src/glossary.mjs';
import { resolveTemplate, exportTemplate } from '../src/report-templates.mjs';
import { labsProject } from './labs-project.mjs';

const TOKEN = 'test-token-0123456789abcdefghijklmnopqrstuv';
const FRAME_PAGE = '<!doctype html><title>r</title><script>window.parent.postMessage({ type: "ready" }, "*");</script>';

function raw({ method = 'GET', path, body, token = TOKEN, port }) {
  return new Promise((done, failed) => {
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const req = httpRequest({ host: '127.0.0.1', port, method, path, agent: false, headers: {
      Host: `127.0.0.1:${port}`, ...(token ? { 'X-Zukai-Token': token } : {}), ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
    } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json;
        try { json = JSON.parse(text); } catch { /* not JSON */ }
        done({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('error', failed);
    if (payload) req.write(payload);
    req.end();
  });
}

/** A labs project with one rendered issue report, a translation and a revision. */
function reportsProject() {
  const p = labsProject();
  expect(addEntries(p.root, [{ terms: { en: 'connection pool', ja: '接続プール' }, avoid: { en: ['conn pool'], ja: ['コネクションプール'] } }], { status: 'confirmed' }).ok).toBe(true);
  const template = resolveTemplate(p.root, 'issue-investigation').template;
  const made = newReport({ root: p.root, template, title: 'Checkout fails', lang: 'en', runs: [p.runs.checkout] });
  const skeleton = readFileSync(join(made.dir, 'report.md'), 'utf8');
  const marker = '<!-- zukai:section id="summary" -->';
  writeFileSync(join(made.dir, 'report.md'), skeleton.replace(marker, `${marker}\nThe conn pool ran out.`));
  mkdirSync(join(made.dir, 'ja'));
  writeFileSync(join(made.dir, 'ja', 'report.md'), skeleton.replace(marker, `${marker}\nコネクションプールが枯渇した。`));
  snapshotReport(made.dir, { request: 'first' });
  renderReport(made.dir, { root: p.root, template });
  return { p, name: made.name, dir: made.dir };
}

describe('report routes', () => {
  const { p, name, dir } = reportsProject();
  let labs;
  let port;
  let jobs;
  const call = (opts) => raw({ ...opts, port });

  beforeAll(async () => {
    const pages = new Map([['/index.html', { type: 'text/html; charset=utf-8', bytes: Buffer.from('<!doctype html><title>t</title>') }], ['/report-frame.html', { type: 'text/html; charset=utf-8', bytes: Buffer.from(FRAME_PAGE) }]]);
    jobs = createJobs({ root: p.root });
    jobs.started();
    labs = createLabsServer({ root: p.root, token: TOKEN, pages, version: '0.0.0-test', instance: 'test', jobs });
    await new Promise((r) => labs.server.listen(0, '127.0.0.1', r));
    port = labs.server.address().port;
  });
  afterAll(() => new Promise((r) => labs.server.close(r)));

  it('lists reports with their findings, and one report with revisions, translations and findings', async () => {
    const list = await call({ path: '/api/reports' });
    expect(list.status).toBe(200);
    expect(list.json.reports).toEqual([expect.objectContaining({ name, title: 'Checkout fails', translations: ['ja'], rendered: true, findings: { blocking: 2, warnings: expect.any(Number) } })]);
    const detail = await call({ path: `/api/reports/${name}` });
    expect(detail.json).toMatchObject({ name, translations: ['ja'], revisions: [expect.objectContaining({ rev: 'r001' })], glossary: 'checked' });
    expect(detail.json.findings.filter((f) => f.kind === 'avoided-term').map((f) => f.file)).toEqual(['report.md', 'ja/report.md']);
    const state = await call({ path: '/api/state' });
    expect(state.json).toMatchObject({ reports: 1, reportsDir: 'reports' });
    expect(state.json).not.toHaveProperty('reportsConfigError');
  });

  it('gives the source with its rev, the HTML as data, a diff and a download', async () => {
    const source = await call({ path: `/api/reports/${name}/source` });
    expect(source.json.rev).toBe(textRev(readFileSync(join(dir, 'report.md'))));
    expect((await call({ path: `/api/reports/${name}/source?lang=ja` })).status).toBe(200);
    const html = await call({ path: `/api/reports/${name}/html` });
    expect(html.json.html).toContain('Content-Security-Policy');
    expect((await call({ path: `/api/reports/${name}/diff?from=r001&to=current` })).json).toMatchObject({ ok: true, from: 'r001', to: 'current' });
    const dl = await call({ path: `/api/reports/${name}/download?format=md` });
    expect(dl.status).toBe(200);
    expect(dl.headers['content-disposition']).toMatch(/attachment; filename=".*\.md"/);
  });

  it('looks every name and query value up in a listing', async () => {
    for (const path of [
      `/api/reports/${encodeURIComponent('../x')}`,
      `/api/reports/${name}/source?lang=${encodeURIComponent('../x')}`,
      `/api/reports/${name}/source?lang=vi`,
      `/api/reports/${name}/diff?from=${encodeURIComponent('../../x')}&to=current`,
      `/api/reports/${name}/diff?from=r999&to=current`,
      `/api/reports/${name}/download?format=json`,
      `/api/report-templates/${encodeURIComponent('../x')}/preview`,
      '/api/report-templates/feature/preview?scope=elsewhere',
      '/api/report-templates/feature/preview?scope=project',
    ]) expect((await call({ path })).status, path).toBe(404);
    expect((await call({ method: 'POST', path: `/api/reports/${name}/restore`, body: { revision: '../r001' } })).status).toBe(404);
  });

  it('saves a quick edit after a snapshot, refuses a stale rev and a credential', async () => {
    const before = await call({ path: `/api/reports/${name}/source` });
    const text = before.json.text.replace('The conn pool ran out', 'The connection pool ran out');
    const saved = await call({ method: 'PUT', path: `/api/reports/${name}/source`, body: { text, rev: before.json.rev } });
    expect(saved.status).toBe(200);
    expect(saved.json).toMatchObject({ ok: true, snapshot: 'r002', rendered: ['report.html', 'ja/report.html'] });
    expect(readFileSync(join(dir, 'report.md'), 'utf8')).toBe(text);
    const stale = await call({ method: 'PUT', path: `/api/reports/${name}/source`, body: { text: 'x', rev: before.json.rev } });
    expect(stale).toMatchObject({ status: 409, json: { error: { code: 'conflict' } } });
    const secret = await call({ method: 'PUT', path: `/api/reports/${name}/source`, body: { text: 'ghp_0123456789abcdefghijklmnopqrstuvwxyzAB', rev: saved.json.rev } });
    expect(secret).toMatchObject({ status: 422, json: { error: { code: 'secret' } } });
  });

  it('refuses the quick edit and a restore while a report job is queued, and while a draft waits', async () => {
    const rev = (await call({ path: `/api/reports/${name}/source` })).json.rev;
    const job = jobs.queue('report-polish', { reportName: name });
    expect((await call({ method: 'PUT', path: `/api/reports/${name}/source`, body: { text: 'x', rev } })).json.error.code).toBe('held');
    expect((await call({ method: 'POST', path: `/api/reports/${name}/restore`, body: { revision: 'r001', rev } })).json.error.code).toBe('held');
    jobs.cancel(job.id);
    const draft = newDraft(dir, { text: 'polished', baseRev: rev });
    expect((await call({ method: 'PUT', path: `/api/reports/${name}/source`, body: { text: 'x', rev } })).json.error.code).toBe('held');
    expect((await call({ method: 'POST', path: `/api/reports/${name}/drafts/${draft.draft}/discard` })).status).toBe(200);
    const restored = await call({ method: 'POST', path: `/api/reports/${name}/restore`, body: { revision: 'r001', rev } });
    expect(restored).toMatchObject({ status: 200, json: { restored: 'r001' } });
    expect(readFileSync(join(dir, 'report.md'), 'utf8')).toContain('The conn pool ran out');
  });

  it('lists templates, previews, exports, and imports only after a dry run that writes nothing', async () => {
    const list = await call({ path: '/api/report-templates' });
    expect(list.json.templates.filter((t) => t.scope === 'built-in').map((t) => t.id)).toEqual(['feature', 'issue-investigation', 'tech-research']);
    expect((await call({ path: '/api/report-templates/feature/preview' })).json.html).toContain('Content-Security-Policy');
    const exported = await call({ path: '/api/report-templates/feature/export' });
    expect(exported.headers['content-disposition']).toMatch(/feature\.zukai-template\.json/);
    const file = exportTemplate(p.root, 'tech-research').text.replace(/tech-research/g, 'vendor-review');
    const check = await call({ method: 'POST', path: '/api/report-templates/import?check=1', body: { file, scope: 'project' } });
    expect(check.json).toMatchObject({ ok: true, check: true, id: 'vendor-review', exists: false });
    expect((await call({ path: '/api/report-templates' })).json.templates.some((t) => t.id === 'vendor-review')).toBe(false);
    const bad = file.replace('</body>', '<script>x</script></body>');
    expect((await call({ method: 'POST', path: '/api/report-templates/import', body: { file: bad, scope: 'project' } })).status).toBe(422);
    expect((await call({ method: 'POST', path: '/api/report-templates/import', body: { file, scope: 'project' } })).json).toMatchObject({ ok: true, id: 'vendor-review' });
    expect((await call({ method: 'POST', path: '/api/report-templates/import', body: { file, scope: 'project' } })).status).toBe(409);
    expect((await call({ method: 'POST', path: '/api/report-templates/import?check=1', body: { file, scope: 'project' } })).json.exists).toBe(true);
  });

  it('serves the report frame with its own policy, framed by the console only', async () => {
    const page = await call({ path: '/report-frame.html', token: null });
    expect(page.status).toBe(200);
    expect(page.headers['content-security-policy']).toBe(reportFrameCsp(viewerScriptHash(FRAME_PAGE)));
    expect(page.headers['content-security-policy']).toMatch(/^sandbox allow-scripts allow-modals; default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src 'sha256-[^']+'; frame-ancestors 'self'$/);
    expect(page.headers['x-frame-options']).toBe('SAMEORIGIN');
    const index = await call({ path: '/index.html', token: null });
    expect(index.headers['x-frame-options']).toBe('DENY');
  });

  it('moves the change stamp when the agent writes a report', async () => {
    const before = (await call({ path: '/api/state' })).json.change.split('-')[1];
    await new Promise((r) => setTimeout(r, 20));
    writeFileSync(join(dir, 'ja', 'report.md'), `${readFileSync(join(dir, 'ja', 'report.md'), 'utf8')}\nMore.\n`);
    const after = (await call({ path: '/api/state' })).json.change.split('-')[1];
    expect(after).not.toBe(before);
  });

  it('holds a report for the agent and hands it the report folder', async () => {
    const job = jobs.queue('report-translate', { reportName: name, lang: 'vi' });
    const taken = await jobs.wait('s-reportsession01', { timeoutMs: 50 });
    expect(taken.job).toMatchObject({ id: job.id, reportName: name, reportDir: dir, report: null });
    expect((await call({ path: `/agent/holds?report=${name}` })).json).toMatchObject({ held: true, job: job.id });
    expect((await call({ path: `/agent/holds?run=${p.runs.checkout}` })).json).toMatchObject({ held: false });
    jobs.done(job.id, 's-reportsession01', 'done', 'Translated into vi.');
    const done = jobs.detail(job.id);
    expect(done).toMatchObject({ reportName: name, report: 'Translated into vi.', state: 'done' });
  });
});

describe('a bad reportsDir', () => {
  it('stops the report routes with 409 while the run routes keep working', async () => {
    const p = labsProject();
    mkdirSync(join(p.root, '.zukai'), { recursive: true });
    writeFileSync(join(p.root, '.zukai', 'config.json'), JSON.stringify({ config: 1, reportsDir: 'diagrams/reports' }));
    const labs = createLabsServer({ root: p.root, token: TOKEN, pages: new Map(), version: '0', instance: 't' });
    await new Promise((r) => labs.server.listen(0, '127.0.0.1', r));
    const port = labs.server.address().port;
    try {
      expect((await raw({ path: '/api/reports', port })).json).toMatchObject({ error: { code: 'bad-config' } });
      expect((await raw({ path: '/api/reports', port })).status).toBe(409);
      expect((await raw({ path: '/api/runs', port })).status).toBe(200);
      const state = await raw({ path: '/api/state', port });
      expect(state.json).toMatchObject({ runsDir: 'diagrams', reports: 0, reportsDir: null, reportsConfigError: { message: expect.stringMatching(/overlaps/) } });
      expect(state.json).not.toHaveProperty('configError');
    } finally {
      await new Promise((r) => labs.server.close(r));
    }
  });
});

describe('report job kinds', () => {
  const { p, name, dir } = reportsProject();
  const jobs = createJobs({ root: p.root });
  jobs.started();
  const ctx = {
    runs: () => [p.runs.checkout], diagrams: () => [], revisions: () => [], source: () => false,
    reports: () => [name], reportLang: () => 'en', drafts: () => ['polish-1'], templates: () => ['feature', 'issue-investigation'], templateIds: () => ['feature', 'issue-investigation'],
  };
  const HEX = 'a'.repeat(64);

  it('validates each kind', () => {
    expect(jobErrors('report-write', { template: 'feature', title: 'Login', lang: 'ja', runs: [p.runs.checkout], notes: 'from the issue' }, ctx)).toEqual([]);
    expect(jobErrors('report-write', { template: 'nope', title: 'x', lang: 'ja' }, ctx).map((e) => e.path)).toEqual(['/params/template']);
    expect(jobErrors('report-write', { template: 'feature', title: 'x', lang: '../x' }, ctx).map((e) => e.path)).toEqual(['/params/lang']);
    expect(jobErrors('report-polish', { reportName: name }, ctx)).toEqual([]);
    expect(jobErrors('report-polish', { reportName: name, apply: { draft: 'polish-1', baseRev: HEX, draftRev: HEX } }, ctx)).toEqual([]);
    expect(jobErrors('report-polish', { reportName: name, apply: { draft: 'polish-9', baseRev: HEX, draftRev: HEX } }, ctx)).toHaveLength(1);
    expect(jobErrors('report-polish', { reportName: '../x' }, ctx)).toHaveLength(1);
    expect(jobErrors('report-translate', { reportName: name, lang: 'en' }, ctx)).toHaveLength(1);
    expect(jobErrors('report-translate', { reportName: name, lang: 'ja' }, ctx)).toEqual([]);
    expect(jobErrors('report-template', { mode: 'new', scope: 'user', description: 'A post-incident review' }, ctx)).toEqual([]);
    expect(jobErrors('report-template', { mode: 'customise', scope: 'project' }, ctx).map((e) => e.path)).toEqual(['/params/from']);
    expect(jobErrors('report-template', { mode: 'new', scope: 'built-in', description: 'x' }, ctx)).toHaveLength(1);
  });

  it('queues a polish apply only against a pending draft of the report, and gives the agent its folders', async () => {
    const draft = newDraft(dir, { text: 'polished', baseRev: textRev(readFileSync(join(dir, 'report.md'))) });
    const job = jobs.queue('report-polish', { reportName: name, apply: { draft: draft.draft, baseRev: draft.baseRev, draftRev: draft.draftRev } });
    expect(job).toMatchObject({ reportName: name, run: null, report: null });
    expect(jobs.reportBusy(name)).toMatchObject({ id: job.id, state: 'queued' });
    const taken = await jobs.wait('s-polishsession01', { timeoutMs: 50 });
    expect(taken.job).toMatchObject({ reportDir: dir, params: { apply: { draft: draft.draft } } });
    jobs.done(job.id, 's-polishsession01', 'done', 'Applied.');
    const t = jobs.queue('report-template', { mode: 'new', scope: 'user', description: 'A review' });
    const takenT = await jobs.wait('s-polishsession01', { timeoutMs: 50 });
    expect(takenT.job.scopeDir).toMatch(/report-templates$/);
    jobs.done(t.id, 's-polishsession01', 'done', 'Saved.');
  });
});

describe('a report folder without its report.md', () => {
  it('is listed as broken instead of failing the list', async () => {
    const { p, dir } = reportsProject();
    const { consoleReports, consoleSource } = await import('../src/labs-reports.mjs');
    const { rmSync } = await import('node:fs');
    rmSync(join(dir, 'report.md'));
    const rows = consoleReports(p.root);
    expect(rows).toEqual([expect.objectContaining({ broken: expect.stringMatching(/report\.md/) })]);
    expect(consoleSource(dir, null)).toBeUndefined();
  });
});
