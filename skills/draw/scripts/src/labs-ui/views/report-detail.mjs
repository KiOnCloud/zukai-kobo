/**
 * One report: Preview (the rendered HTML in the sealed report frame, by language), Source (its
 * Markdown, saved by the server after a snapshot), Glossary (the findings with their lines and
 * the polish job), History (revisions, their diffs and a restore) and Files; Export HTML,
 * Export Markdown, Print to PDF and Translate in the header; a pending polish draft with its
 * diff, Apply (a polish job) and Discard. Every write carries the rev the page read.
 */
import { S } from '../sienna.mjs';
import { h, replace, when, ago } from '../dom.mjs';
import { api, path } from '../api.mjs';
import { SCOPE_LABEL, REPORT_LANGS } from '../words.mjs';
import { badge } from './badge.mjs';
import { confirmDialog } from './job-panel.mjs';
import { reportFrame } from '../report-frame/frame.mjs';

const TABS = [
  { value: 'preview', label: 'Preview' },
  { value: 'source', label: 'Source' },
  { value: 'glossary', label: 'Glossary' },
  { value: 'history', label: 'History' },
  { value: 'files', label: 'Files' },
];
const LANG_RE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const CAUSE = { snapshot: 'Snapshot', edit: 'Quick edit', polish: 'Before a polish', translate: 'Before a translation', restore: 'Before a restore' };
const PROBLEM = {
  'avoided-term': (f) => `Uses the avoided word "${f.avoided}"${f.expected ? `; the confirmed term is "${f.expected}"` : ''}`,
  'untranslated-term': (f) => `Keeps "${f.term}" (${f.termLang}); the confirmed term here is "${f.expected}"`,
  'translation-mismatch': (f) => `The original uses "${f.source}"; this section lacks "${f.expected}"`,
  'kept-term-changed': (f) => `"${f.expected}" is kept the same in both languages and was translated`,
  'sections-differ': (f) => `Sections differ from the original${f.missing?.length ? `; missing ${f.missing.join(', ')}` : ''}${f.extra?.length ? `; extra ${f.extra.join(', ')}` : ''}`,
  secret: (f) => f.message,
};

/** A line diff as a list of lines marked added, removed or kept. */
export function diffBlock(lines) {
  if (!lines.some((l) => l.op !== ' ')) return h('p', { class: 'body-sm zl-muted' }, 'No difference.');
  return h('pre', { class: 'zl-block code zl-diff' }, lines.map((l) => h('span', { class: ['zl-diff-line', l.op === '+' ? 'zl-diff-add' : l.op === '-' ? 'zl-diff-del' : null] }, `${l.op} ${l.text}\n`)));
}

/** The findings of a report as a table, blocking first. */
export function reportFindings(findings) {
  if (findings.length === 0) return S().Alert({ tone: 'success', title: 'No findings', body: 'The prose follows the confirmed glossary entries and the secret scan found nothing.' });
  const rows = [...findings.filter((f) => f.level === 'blocking'), ...findings.filter((f) => f.level !== 'blocking')];
  return S().Table({
    caption: 'Findings of the report check',
    dense: true,
    rows,
    columns: [
      { key: 'level', label: 'Level', render: (f) => badge(f.level === 'blocking' ? { label: 'Blocking', tone: 'danger', icon: 'alert' } : { label: 'Warning', tone: 'warning' }) },
      { key: 'where', label: 'Where', render: (f) => h('div', {}, h('div', { class: 'code body-sm' }, `${f.file}${f.line ? `:${f.line}` : ''}`), f.section ? h('div', { class: 'caption zl-muted' }, `section ${f.section}`) : null) },
      { key: 'text', label: 'Text', render: (f) => h('span', { lang: f.lang }, f.kind === 'secret' ? '(not shown)' : f.text ?? '') },
      { key: 'problem', label: 'Problem', render: (f) => h('span', { class: 'body-sm' }, (PROBLEM[f.kind] ?? (() => f.kind))(f)) },
    ],
  });
}

async function download(apiPath, name, say) {
  const r = await api.blob(apiPath);
  if (!r.ok) { say('danger', `${name} could not be downloaded: ${r.error.message}`); return; }
  const url = URL.createObjectURL(r.data);
  const a = h('a', { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function reportDetail({ store, name, tab = 'preview', setCrumbs }) {
  const element = h('div', { class: 'zl-page' });
  const notice = h('div', { role: 'status' });
  const panel = h('div', { class: 'zl-panel', role: 'tabpanel' });
  const drafts = h('div', {});
  let report = null;
  let failure = null;
  let current = TABS.some((t) => t.value === tab) ? tab : 'preview';
  let lang = null;
  let frame = null;
  let editor = null; // { lang, rev, text, dirty }

  const say = (tone, body, title) => replace(notice, S().Alert({ tone, title, body, dismissible: true }));
  const langs = () => [null, ...(report?.translations ?? [])];
  const langLabel = (l) => (l === null ? `${report.meta.lang} (original)` : l);
  const query = (l) => (l ? `?lang=${encodeURIComponent(l)}` : '');

  async function queue(kind, params, done) {
    const r = await api.post('/api/jobs', { kind, params });
    if (!r.ok) { say('danger', `The job was not queued: ${r.error.message}. ${(r.error.errors ?? []).map((e) => e.message).join('; ')}`); return; }
    say('info', `${done} The attached agent carries it out; follow it in the agent panel.`, 'Queued');
    window.location.hash = `#/jobs/${encodeURIComponent(r.data.job.id)}`;
  }

  function translateDialog() {
    let value = REPORT_LANGS.find((l) => l.value !== report.meta.lang && !report.translations.includes(l.value))?.value ?? '';
    const error = h('div', { role: 'alert' });
    const field = S().Input({ label: 'Language', helper: 'A language tag such as ja, vi, en-GB. Terms the glossary keeps the same in both languages stay as they are.', value, onInput: (e) => { value = e.target.value.trim(); } });
    let dialog;
    const go = S().Button({ label: 'Translate', variant: 'primary', onClick: () => {
      if (!LANG_RE.test(value) || value.toLowerCase() === report.meta.lang.toLowerCase()) { replace(error, S().Alert({ tone: 'warning', body: 'Write a language tag other than the language of the report.' })); return; }
      dialog.close();
      queue('report-translate', { reportName: name, lang: value }, `The report is translated into ${value}.`);
    } });
    dialog = S().Dialog({ title: 'Translate this report', body: h('div', { class: 'zl-stack' }, field, error), actions: [S().Button({ label: 'Not now', onClick: () => dialog.close() }), go], onClose: () => dialog.element.remove() });
    dialog.open();
  }

  function header() {
    const m = report.meta;
    return h('header', { class: 'zl-page-header zl-page-header-row' },
      h('div', { class: 'zl-stack-tight' },
        h('div', { class: 'eyebrow' }, `Report · ${m.kind}`),
        h('h1', { class: 'display-md' }, m.title),
        h('p', { class: 'code caption zl-muted' }, name),
        h('p', { class: 'body-sm zl-muted' }, `Template ${m.template.id} (${SCOPE_LABEL[m.template.scope] ?? m.template.scope}, version ${m.template.version}) · ${[m.lang, ...report.translations].join(' · ')} · updated ${ago(m.updated)}`)),
      h('div', { class: 'zl-row' },
        S().Button({ label: 'Export HTML', variant: 'secondary', size: 'sm', icon: 'download', disabled: !report.rendered.html, onClick: () => download(`${path`/api/reports/${name}/download`}?format=html${lang ? `&lang=${encodeURIComponent(lang)}` : ''}`, `${name}${lang ? `.${lang}` : ''}.html`, say) }),
        S().Button({ label: 'Export Markdown', variant: 'secondary', size: 'sm', icon: 'download', onClick: () => download(`${path`/api/reports/${name}/download`}?format=md${lang ? `&lang=${encodeURIComponent(lang)}` : ''}`, `${name}${lang ? `.${lang}` : ''}.md`, say) }),
        S().Button({ label: 'Print to PDF', variant: 'secondary', size: 'sm', disabled: !report.rendered.html, onClick: () => {
          if (current !== 'preview' || !frame) { current = 'preview'; draw(); }
          setTimeout(() => { if (!frame?.print()) say('warning', 'The preview is still loading; try Print to PDF again in a moment.'); }, frame ? 0 : 800);
        } }),
        S().Button({ label: 'Translate', variant: 'secondary', size: 'sm', onClick: translateDialog })));
  }

  async function drawDrafts() {
    if (!report.drafts.length) { replace(drafts); return; }
    const blocks = await Promise.all(report.drafts.map(async (d) => {
      const r = await api.get(`${path`/api/reports/${name}/diff`}?from=current&to=${encodeURIComponent(d.name)}`);
      return h('section', { class: 'zl-card-plain zl-stack' },
        h('div', { class: 'zl-row zl-spread' },
          h('div', {}, h('h2', { class: 'heading-sm' }, `Polish draft ${d.name}`), h('p', { class: 'caption zl-muted' }, `${d.findings.length} finding${d.findings.length === 1 ? '' : 's'} rewritten · ${ago(d.created)}`)),
          d.stale ? badge({ label: 'The report changed since', tone: 'warning', icon: 'alert' }) : null),
        r.ok ? diffBlock(r.data.lines) : h('p', { class: 'body-sm zl-muted' }, 'The diff could not be read.'),
        h('div', { class: 'zl-row' },
          S().Button({ label: 'Discard', variant: 'ghost', size: 'sm', onClick: () => confirmDialog({ title: `Discard ${d.name}?`, body: 'The draft is removed; the report stays as it is.', action: 'Discard', keep: 'Keep the draft', run: async () => {
            const x = await api.post(path`/api/reports/${name}/drafts/${d.name}/discard`);
            if (!x.ok) say('danger', `The draft was not discarded: ${x.error.message}`); else { say('success', `${d.name} was discarded.`); load(); }
          } }) }),
          S().Button({ label: 'Apply', variant: 'primary', size: 'sm', disabled: d.stale, onClick: () => queue('report-polish', { reportName: name, apply: { draft: d.name, baseRev: d.baseRev, draftRev: d.draftRev } }, `${d.name} is applied after a snapshot.`) })));
    }));
    replace(drafts, blocks);
  }

  function langSwitch(onChange) {
    if (langs().length < 2) return null;
    return S().Tabs({ variant: 'segment', panel: false, label: 'Language', value: lang ?? '', items: langs().map((l) => ({ value: l ?? '', label: langLabel(l) })), onChange: (v) => { lang = v === '' ? null : v; onChange(); } });
  }

  async function drawPreview() {
    frame?.dispose?.();
    frame = null;
    const holder = h('div', {}, h('p', { class: 'body-sm zl-muted' }, 'Loading the rendered report'));
    replace(panel, h('div', { class: 'zl-stack' }, langSwitch(drawPreview), holder));
    const r = await api.get(`${path`/api/reports/${name}/html`}${query(lang)}`);
    if (!r.ok) { replace(holder, S().Alert({ tone: 'warning', title: 'Not rendered yet', body: r.status === 404 ? 'This report has no HTML yet. Save its source once, or ask the agent to render it.' : r.error.message })); return; }
    frame = reportFrame({ html: r.data.html, title: `${report.meta.title}${lang ? ` (${lang})` : ''}` });
    replace(holder, frame.element);
  }

  async function drawSource() {
    const r = await api.get(`${path`/api/reports/${name}/source`}${query(lang)}`);
    if (!r.ok) { replace(panel, S().Alert({ tone: 'danger', body: `The source could not be read: ${r.error.message}` })); return; }
    editor = { lang, rev: r.data.rev, text: r.data.text, dirty: false };
    const status = h('div', { role: 'status' });
    const field = S().Input({ label: lang ? `${lang}/report.md` : 'report.md', multiline: true, rows: 28, value: editor.text, className: 'zl-json', onInput: (e) => { editor.text = e.target.value; editor.dirty = true; } });
    const save = S().Button({ label: 'Save', variant: 'primary', onClick: async () => {
      save.disabled = true;
      const w = await api.put(`${path`/api/reports/${name}/source`}${query(lang)}`, { text: editor.text, rev: editor.rev });
      save.disabled = false;
      if (w.ok) { say('success', `Saved after snapshot ${w.data.snapshot}, and rendered again.`); load(); return; }
      if (w.error.code === 'conflict') { replace(status, S().Alert({ tone: 'warning', title: 'Changed on disk', body: 'The report changed since this page read it (the agent or another tab wrote it). Copy your text if you need it, then reload the source.' })); return; }
      if (w.error.code === 'held') { replace(status, S().Alert({ tone: 'warning', title: 'Held', body: `${w.error.message}. Your text stays here; save again once it is done.` })); return; }
      replace(status, S().Alert({ tone: 'danger', title: 'Not saved', body: `${w.error.message}. ${(w.error.errors ?? []).map((e) => `${e.path} ${e.message}`).join('; ')}` }));
    } });
    replace(panel, h('div', { class: 'zl-stack' },
      langSwitch(drawSource),
      h('p', { class: 'body-sm zl-muted' }, 'A quick edit of the Markdown. Keep the ## headings and the <!-- zukai:section --> lines as they are. Saving takes a snapshot first, checks for credentials and renders the report again. For a change in words, a polish or a translation, ask the agent.'),
      field, status, h('div', { class: 'zl-row' }, save, S().Button({ label: 'Reload', variant: 'ghost', onClick: drawSource }))));
  }

  function drawGlossary() {
    replace(panel, h('div', { class: 'zl-stack' },
      report.glossary === 'missing' ? S().Alert({ tone: 'info', body: 'The project has no glossary: only the secret scan ran. The Glossary section adds entries.' }) : null,
      h('div', { class: 'zl-row zl-spread' },
        h('p', { class: 'body' }, `${report.counts.blocking} blocking, ${report.counts.warnings} warning${report.counts.warnings === 1 ? '' : 's'}.`),
        S().Button({ label: 'Polish with glossary', variant: 'primary', size: 'sm', disabled: report.glossary === 'missing' || !report.findings.some((f) => f.kind !== 'secret'), onClick: () => queue('report-polish', { reportName: name }, 'The agent rewrites the flagged sentences into a draft for you to review.') })),
      reportFindings(report.findings)));
  }

  function drawHistory() {
    if (!report.revisions.length) { replace(panel, h('p', { class: 'body zl-muted' }, 'No revision yet. A quick edit, a polish, a translation and a restore each take one first.')); return; }
    const shown = h('div', {});
    replace(panel, h('div', { class: 'zl-stack' },
      h('ul', { class: 'zl-job-lines' }, report.revisions.map((r) => h('li', { class: 'zl-job-line' },
        h('span', { class: 'label code' }, r.rev),
        h('span', { class: 'body-sm zl-muted zl-clamp' }, `${CAUSE[r.cause] ?? r.cause}${r.request ? ` · ${r.request}` : ''}`),
        h('span', { class: 'caption zl-muted' }, when(r.createdAt)),
        h('div', { class: 'zl-row' },
          S().Button({ label: 'Diff with now', variant: 'ghost', size: 'sm', onClick: async () => {
            const d = await api.get(`${path`/api/reports/${name}/diff`}?from=${encodeURIComponent(r.rev)}&to=current${query(lang)}`);
            replace(shown, h('p', { class: 'label' }, `${r.rev} → now`), d.ok ? diffBlock(d.data.lines) : S().Alert({ tone: 'warning', body: d.error.message }));
          } }),
          S().Button({ label: `Restore ${r.rev}`, variant: 'ghost', size: 'sm', onClick: () => confirmDialog({ title: `Restore ${r.rev}?`, body: 'The report and its translations go back to this revision. The state now is snapshotted first, so the restore can be undone the same way.', action: `Restore ${r.rev}`, tone: 'primary', run: async () => {
            const x = await api.post(path`/api/reports/${name}/restore`, { revision: r.rev, rev: report.rev });
            if (x.ok) { say('success', `${r.rev} was restored after snapshot ${x.data.snapshot}.`); load(); } else say(x.error.code === 'held' || x.error.code === 'conflict' ? 'warning' : 'danger', `${r.rev} was not restored: ${x.error.message}`);
          } }) }))))),
      shown));
  }

  function drawFiles() {
    const rows = [
      { file: 'report.md', what: 'The source', lang: null, format: 'md' },
      ...(report.rendered.html ? [{ file: 'report.html', what: 'The rendered report', lang: null, format: 'html' }] : []),
      ...report.translations.flatMap((l) => [{ file: `${l}/report.md`, what: `The ${l} translation`, lang: l, format: 'md' }, { file: `${l}/report.html`, what: `The ${l} translation, rendered`, lang: l, format: 'html' }]),
    ];
    replace(panel, S().Table({ caption: 'Files of the report', rows, columns: [
      { key: 'file', label: 'File', render: (f) => h('span', { class: 'code' }, f.file) },
      { key: 'what', label: 'What', muted: true, render: (f) => f.what },
      { key: 'get', label: 'Download', render: (f) => S().Button({ label: `Download ${f.file}`, variant: 'ghost', size: 'sm', iconOnly: true, icon: 'download', onClick: () => download(`${path`/api/reports/${name}/download`}?format=${f.format}${f.lang ? `&lang=${encodeURIComponent(f.lang)}` : ''}`, f.file.replace('/', '.'), say) }) },
    ] }));
  }

  function drawPanel() {
    if (current === 'preview') return drawPreview();
    if (current === 'source') return drawSource();
    if (current === 'glossary') return drawGlossary();
    if (current === 'history') return drawHistory();
    return drawFiles();
  }

  function draw() {
    if (failure) { replace(element, S().Alert({ tone: 'danger', title: 'The report could not be read', body: failure })); return; }
    if (!report) { replace(element, h('p', { class: 'body zl-muted' }, 'Reading the report')); return; }
    setCrumbs?.([{ label: report.meta.title }]);
    const tabs = S().Tabs({ panel: false, label: 'Report views', value: current, items: TABS.map((t) => ({ ...t, ...(t.value === 'glossary' && report.counts.blocking ? { count: report.counts.blocking } : {}), ...(t.value === 'history' ? { count: report.revisions.length } : {}) })), onChange: (v) => { current = v; window.history.replaceState(null, '', `#/reports/${encodeURIComponent(name)}/${v}`); drawPanel(); } });
    replace(element, header(), notice, drafts, tabs, panel);
    drawDrafts();
    drawPanel();
  }

  async function load() {
    const r = await api.get(path`/api/reports/${name}`);
    if (r.ok) { failure = null; report = r.data; if (lang && !report.translations.includes(lang)) lang = null; } else failure = r.status === 404 ? `There is no report ${name} in the reports folder.` : r.error.message;
    // A source being edited is never replaced by a reload; the next save says when the file changed.
    if (editor?.dirty && current === 'source') return;
    draw();
  }

  draw();
  load();
  return {
    element,
    title: name,
    reload: load,
    route: (parts) => { const t = parts[1]; if (t && TABS.some((x) => x.value === t) && t !== current) { current = t; draw(); } },
    dispose: () => frame?.dispose?.(),
  };
}
