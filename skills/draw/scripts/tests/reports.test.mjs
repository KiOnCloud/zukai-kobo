import { describe, it, expect } from 'vitest';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  newReport, readReport, reportNames, reportPath, reportFoldersIn, snapshotReport, restoreReport, reportRevisions, writeSource,
  newDraft, applyDraft, discardDraft, draftNames, diffReport, lineDiff, renderReport, secretFindings, blocksOf, proseOf, textRev,
  translationLangs, skeletonOf, REPORT_CSP, LANG_RE,
} from '../src/reports.mjs';
import { resolveTemplate } from '../src/report-templates.mjs';
import { fixturesDir } from './helpers.mjs';

const project = () => mkdtempSync(join(tmpdir(), 'zukai-reports-'));
const template = (root) => resolveTemplate(root, 'issue-investigation').template;
const make = (root, extra = {}) => {
  const r = newReport({ root, template: template(root), title: 'Checkout fails', lang: 'en', now: new Date(2026, 10, 19, 9), ...extra });
  expect(r.ok, JSON.stringify(r.errors)).toBe(true);
  return r;
};
const md = (dir) => readFileSync(join(dir, 'report.md'), 'utf8');
const put = (dir, text, lang) => writeFileSync(join(dir, ...(lang ? [lang] : []), 'report.md'), text);

describe('report folders', () => {
  it('makes a folder with report.md, report.json and assets/, named by the local date and title', () => {
    const root = project();
    const r = make(root);
    expect(r.name).toBe('20261119_checkout-fails');
    expect(readdirSync(r.dir).sort()).toEqual(['assets', 'report.json', 'report.md']);
    expect(md(r.dir)).toMatch(/^# Checkout fails\n\n## Summary\n<!-- zukai:section id="summary" -->/);
    expect(md(r.dir)).not.toContain('guide=');
    expect(readReport(r.dir)).toMatchObject({ ok: true, meta: { report: 1, kind: 'issue-investigation', template: { id: 'issue-investigation', scope: 'built-in', version: '1' }, lang: 'en', runs: [] } });
    expect(make(root).name).toBe('20261119_checkout-fails-2');
    expect(reportNames(root)).toEqual(['20261119_checkout-fails-2', '20261119_checkout-fails']);
  });

  it('counts only folders with a valid report.json, and looks names up in the listing', () => {
    const root = project();
    const r = make(root);
    mkdirSync(join(root, 'reports', '20240101_stray'), { recursive: true });
    mkdirSync(join(root, 'reports', '20240102_broken'), { recursive: true });
    writeFileSync(join(root, 'reports', '20240102_broken', 'report.json'), '{"report": 1}');
    expect(reportFoldersIn(join(root, 'reports'))).toEqual([r.name]);
    expect(reportPath(root, r.name)).toBe(r.dir);
    expect(reportPath(root, '../reports/x')).toBeUndefined();
    expect(reportPath(root, '20240101_stray')).toBeUndefined();
  });

  it('refuses a run the project does not have and a title with a control character', () => {
    const root = project();
    expect(newReport({ root, template: template(root), title: 'x', lang: 'en', runs: ['20990101_none'] })).toMatchObject({ ok: false, code: 'bad-request' });
    expect(newReport({ root, template: template(root), title: 'bad\u0007title', lang: 'en' })).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('writes a slug for a title without Latin letters from the kind', () => {
    const root = project();
    expect(make(root, { title: '決済の障害' }).name).toBe('20261119_issue-investigation');
    expect(make(root, { title: 'Báo cáo điều tra' }).name).toBe('20261119_bao-cao-dieu-tra');
  });

  it('starts from the skeleton of the template sections', () => {
    expect(skeletonOf('T', [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }])).toBe('# T\n\n## A\n<!-- zukai:section id="a" -->\n\n\n## B\n<!-- zukai:section id="b" -->\n');
  });
});

describe('report revisions', () => {
  it('snapshots report.md and translations and restores the exact bytes', () => {
    const root = project();
    const { dir } = make(root);
    const original = Buffer.from('# Checkout fails\r\n\r\nexact bytes é\r\n');
    writeFileSync(join(dir, 'report.md'), original);
    mkdirSync(join(dir, 'ja'));
    put(dir, '# 決済\n', 'ja');
    const s = snapshotReport(dir, { request: 'before polish' });
    expect(s).toMatchObject({ ok: true, rev: 'r001', files: ['report.md', 'ja/report.md'] });
    put(dir, 'changed');
    put(dir, 'changed', 'ja');
    const r = restoreReport(dir, 'r001');
    expect(r).toMatchObject({ ok: true, restored: 'r001', snapshot: 'r002' });
    expect(readFileSync(join(dir, 'report.md')).equals(original)).toBe(true);
    expect(readFileSync(join(dir, 'ja', 'report.md'), 'utf8')).toBe('# 決済\n');
    expect(reportRevisions(dir).map((x) => [x.rev, x.cause])).toEqual([['r002', 'restore'], ['r001', 'snapshot']]);
  });

  it('removes a translation the restored revision does not hold', () => {
    const root = project();
    const { dir } = make(root);
    snapshotReport(dir);
    mkdirSync(join(dir, 'vi'));
    put(dir, '# Báo cáo\n', 'vi');
    expect(restoreReport(dir, 'r001')).toMatchObject({ ok: true, removedLangs: ['vi'] });
    expect(translationLangs(dir)).toEqual([]);
  });

  it('never rotates the newest revision a quick edit did not make out', () => {
    const root = project();
    const { dir } = make(root);
    expect(snapshotReport(dir, { cause: 'polish', request: 'before polish' }).rev).toBe('r001');
    let rev = textRev(md(dir));
    for (let i = 0; i < 25; i++) {
      const w = writeSource(dir, { text: `# Checkout fails\n\nedit ${i}\n`, rev });
      expect(w.ok, JSON.stringify(w.errors)).toBe(true);
      rev = w.rev;
    }
    const revs = reportRevisions(dir);
    expect(revs).toHaveLength(20);
    expect(revs.at(-1)).toMatchObject({ rev: 'r001', cause: 'polish' });
  });

  it('refuses a quick edit on a stale rev, a credential and an unknown language', () => {
    const root = project();
    const { dir } = make(root);
    expect(writeSource(dir, { text: 'x', rev: 'stale' })).toMatchObject({ ok: false, code: 'conflict', rev: textRev(md(dir)) });
    expect(writeSource(dir, { text: 'key ghp_0123456789abcdefghijklmnopqrstuvwxyzAB', rev: textRev(md(dir)) })).toMatchObject({ ok: false, code: 'secret' });
    expect(writeSource(dir, { text: 'x', rev: textRev(md(dir)), lang: '../x' })).toMatchObject({ ok: false, code: 'bad-request' });
    expect(reportRevisions(dir)).toEqual([]);
  });

  it('leaves a fresh temporary folder of another writer alone and removes an old one', () => {
    const root = project();
    const { dir } = make(root);
    mkdirSync(join(dir, 'history', '.r005.tmp-1-aaaa'), { recursive: true });
    mkdirSync(join(dir, 'history', '.r006.tmp-2-bbbb'), { recursive: true });
    const old = new Date(Date.now() - 11 * 60 * 1000);
    utimesSync(join(dir, 'history', '.r005.tmp-1-aaaa'), old, old);
    snapshotReport(dir);
    expect(readdirSync(join(dir, 'history')).sort()).toEqual(['.r006.tmp-2-bbbb', 'r001']);
  });
});

describe('polish drafts', () => {
  it('saves a draft against the rev read, applies it with a snapshot and closes it', () => {
    const root = project();
    const { dir } = make(root);
    const base = textRev(md(dir));
    const d = newDraft(dir, { text: '# Checkout fails\n\npolished\n', baseRev: base, findings: [{ kind: 'avoided-term' }] });
    expect(d).toMatchObject({ ok: true, draft: 'polish-1', baseRev: base });
    expect(draftNames(dir)).toEqual(['polish-1']);
    expect(diffReport(dir, 'current', 'polish-1')).toMatchObject({ ok: true, added: 1 });
    expect(applyDraft(dir, 'polish-1', { baseRev: base, draftRev: d.draftRev })).toMatchObject({ ok: true, applied: 'polish-1', snapshot: 'r001' });
    expect(md(dir)).toBe('# Checkout fails\n\npolished\n');
    expect(draftNames(dir)).toEqual([]);
    expect(reportRevisions(dir)[0]).toMatchObject({ cause: 'polish' });
    expect(newDraft(dir, { text: 'again', baseRev: textRev(md(dir)) }).draft).toBe('polish-2');
  });

  it('refuses to apply a draft over a later edit, or a draft changed since it was shown', () => {
    const root = project();
    const { dir } = make(root);
    const d = newDraft(dir, { text: 'draft', baseRev: textRev(md(dir)) });
    put(dir, 'an edit made after the polish read the report');
    expect(applyDraft(dir, d.draft)).toMatchObject({ ok: false, code: 'conflict' });
    expect(md(dir)).toBe('an edit made after the polish read the report');
    const e = newDraft(dir, { text: 'draft 2', baseRev: textRev(md(dir)) });
    writeFileSync(join(dir, 'drafts', `${e.draft}.md`), 'tampered');
    expect(applyDraft(dir, e.draft)).toMatchObject({ ok: false, code: 'conflict' });
    expect(newDraft(dir, { text: 'x', baseRev: 'old' })).toMatchObject({ ok: false, code: 'conflict' });
  });

  it('removes drafts older than the newest discarded polish when a new one starts', () => {
    const root = project();
    const { dir } = make(root);
    const base = textRev(md(dir));
    newDraft(dir, { text: 'one', baseRev: base });
    newDraft(dir, { text: 'two', baseRev: base });
    expect(draftNames(dir)).toEqual(['polish-2', 'polish-1']);
    expect(discardDraft(dir, 'polish-2')).toMatchObject({ ok: true });
    expect(newDraft(dir, { text: 'three', baseRev: base }).draft).toBe('polish-3');
    expect(draftNames(dir)).toEqual(['polish-3']);
    expect(discardDraft(dir, '../polish-3')).toMatchObject({ ok: false });
  });
});

describe('diff', () => {
  it('diffs lines', () => {
    expect(lineDiff('a\nb\nc', 'a\nx\nc').map((l) => `${l.op}${l.text}`)).toEqual([' a', '-b', '+x', ' c']);
  });

  it('takes sides from the listings only', () => {
    const root = project();
    const { dir } = make(root);
    snapshotReport(dir);
    put(dir, 'new');
    expect(diffReport(dir, 'r001', 'current')).toMatchObject({ ok: true });
    for (const side of ['../../x', 'r999', 'polish-9', 'history/r001']) expect(diffReport(dir, side, 'current'), side).toMatchObject({ ok: false });
    expect(diffReport(dir, 'r001', 'current', { lang: '../x' })).toMatchObject({ ok: false });
  });
});

describe('render', () => {
  it('puts the policy first by position, whatever the layout hides a "<head>" in', async () => {
    const { pourReport } = await import('../src/reports.mjs');
    const meta = { report: 1, title: 'T', kind: 'k', template: { id: 't', scope: 'user', version: '1' }, lang: 'en', runs: [], sources: [], created: '2026-11-19T00:00:00Z', updated: '2026-11-19T00:00:00Z' };
    for (const layout of ['<!doctype html><!-- <head> --><html><head><title>&lt;head&gt;</title></head><body>{{sections}}</body></html>', '<p>{{sections}}</p>']) {
      const html = pourReport({ markdown: '## A\n<!-- zukai:section id="a" -->\nx', meta, lang: 'en', layout });
      expect(html.startsWith(`<!doctype html>\n<meta http-equiv="Content-Security-Policy" content="${REPORT_CSP}">`)).toBe(true);
      expect(html.match(/<!doctype/gi)).toHaveLength(1);
    }
  });

  it('writes report.html with the policy first in head, the template layout and the sections', () => {
    const root = project();
    const { dir } = make(root);
    put(dir, `${md(dir).replace('<!-- zukai:section id="summary" -->', '<!-- zukai:section id="summary" -->\nIt broke. <script>alert(1)</script> {{title}}')}`);
    const r = renderReport(dir, { root, template: template(root) });
    expect(r).toMatchObject({ ok: true, written: ['report.html'] });
    const html = readFileSync(join(dir, 'report.html'), 'utf8');
    expect(html.indexOf(`<meta http-equiv="Content-Security-Policy" content="${REPORT_CSP}">`)).toBeLessThan(html.indexOf('<meta charset'));
    expect(html.startsWith('<!doctype html>\n<meta http-equiv="Content-Security-Policy"')).toBe(true);
    expect(html).toContain('It broke. &lt;script&gt;');
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain('{{title}}');
    expect(html).toContain('class="eyebrow">Issue investigation');
    expect(html).toContain('<a href="#h-summary">Summary</a>');
  });

  it('renders each translation and uses the default layout without a template', () => {
    const root = project();
    const { dir } = make(root);
    mkdirSync(join(dir, 'ja'));
    put(dir, md(dir).replace('## Summary', '## 概要'), 'ja');
    expect(renderReport(dir, { root })).toMatchObject({ ok: true, written: ['report.html', 'ja/report.html'] });
    expect(readFileSync(join(dir, 'ja', 'report.html'), 'utf8')).toContain('<html lang="ja">');
  });

  it('refuses to render a report with a credential and writes nothing', () => {
    const root = project();
    const { dir } = make(root);
    put(dir, `${md(dir)}\ntoken: required by the API\n${'\n'.repeat(38)}AKIAABCDEFGHIJKLMNOP\n`);
    const r = renderReport(dir, { root });
    expect(r).toMatchObject({ ok: false, code: 'secret' });
    expect(existsSync(join(dir, 'report.html'))).toBe(false);
  });

  it('embeds the pictures and the description tables of the runs, and points at the console without a picture', () => {
    const root = project();
    const run = join(root, 'diagrams', '20261109_login-flow');
    cpSync(join(fixturesDir, 'glossary', 'project', 'diagrams', '20261109_login-flow'), run, { recursive: true });
    const feature = resolveTemplate(root, 'feature').template;
    const r = newReport({ root, template: feature, title: 'Login', lang: 'en', runs: ['20261109_login-flow'] });
    writeFileSync(join(run, 'login-flow.doc.md'), '| Element | Role |\n|---|---|\n| Gate | checks the staff number |\n');
    expect(renderReport(r.dir, { root, template: feature, viewerBase: 'http://127.0.0.1:4000/' }).ok).toBe(true);
    let html = readFileSync(join(r.dir, 'report.html'), 'utf8');
    expect(html).toContain('href="http://127.0.0.1:4000/#/diagrams/20261109_login-flow"');
    expect(html).toContain('checks the staff number');
    mkdirSync(join(run, 'svg'));
    writeFileSync(join(run, 'svg', 'login-flow.drawio.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    renderReport(r.dir, { root, template: feature });
    html = readFileSync(join(r.dir, 'report.html'), 'utf8');
    expect(html).toContain('<img src="data:image/svg+xml;base64,');
  });
});

describe('secret scan and prose blocks', () => {
  it('finds a credential on line 40 after a harmless "token:" on line 1', () => {
    const text = `token: required\n${'plain line\n'.repeat(38)}key ghp_0123456789abcdefghijklmnopqrstuvwxyzAB\n`;
    const found = secretFindings(text, 'report.md');
    expect(found.find((f) => f.level === 'blocking')).toMatchObject({ file: 'report.md', line: 40 });
  });

  it('splits prose into blocks, skipping code and link targets', () => {
    const blocks = blocksOf('# T\n## A\n<!-- zukai:section id="a" -->\nSee [the office](https://x.example/office) and `office()`.\n\n- item one\n\n| h1 | h2 |\n|---|---|\n| c1 | c2 |\n\n```\noffice\n```\n');
    expect(blocks.map((b) => [b.section, b.line, b.text])).toEqual([
      [null, 1, 'T'], [null, 2, 'A'], ['a', 4, 'See the office and .'], ['a', 6, 'item one'], ['a', 8, 'h1'], ['a', 8, 'h2'], ['a', 10, 'c1'], ['a', 10, 'c2'],
    ]);
  });

  it('gives the prose of a report with its translations and section ids', () => {
    const root = project();
    const { dir } = make(root);
    mkdirSync(join(dir, 'ja'));
    put(dir, md(dir), 'ja');
    const p = proseOf(dir);
    expect(p.files).toEqual([{ file: 'report.md', lang: 'en' }, { file: 'ja/report.md', lang: 'ja' }]);
    expect(p.sections['report.md']).toEqual(p.sections['ja/report.md']);
    expect(p.sections['report.md'][0]).toBe('summary');
  });
});

describe('names a folder must never take', () => {
  it('refuses a device name as a language', () => {
    for (const bad of ['nul', 'CON', 'aux', 'prn-x1']) expect(LANG_RE.test(bad), bad).toBe(false);
    for (const good of ['en', 'ja', 'vi', 'en-GB', 'nl', 'cs']) expect(LANG_RE.test(good), good).toBe(true);
  });
});
