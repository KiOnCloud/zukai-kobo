/**
 * The Glossary section: the project's preferred terms per language. Add, edit, delete,
 * confirm or reject suggestions (one or a selection), ask the agent for suggestions from the
 * diagrams, and check a run. Every write carries the `rev` the page read; a write that gets
 * 409 reloads the file and says it changed on disk. The limits of the file are checked here
 * before a write is sent, and again by the server.
 */
import { S } from '../sienna.mjs';
import { h, replace } from '../dom.mjs';
import { api, path } from '../api.mjs';
import { badge } from './badge.mjs';

const STATUS_BADGE = {
  suggested: { label: 'Suggested', tone: 'warning' },
  confirmed: { label: 'Confirmed', tone: 'neutral', icon: 'check' },
  rejected: { label: 'Rejected', tone: 'neutral', outline: true },
};
const LANG_RE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const BAD_TEXT = /[\u0000-\u001F\u007F-\u009F\u061C\u200E\u200F\u2028\u2029\u202A-\u202E\u2066-\u2069]/;

/** What the form refuses before a write is sent; the server checks the same and more. */
export function termProblem(value, max = 80) {
  if ([...value].length > max) return `At most ${max} characters.`;
  if (BAD_TEXT.test(value)) return 'One line of text, with no control or direction character.';
  return undefined;
}

export function glossarySection({ store }) {
  const element = h('div', { class: 'zl-page' });
  const notice = h('div', { role: 'status' });
  const checkResult = h('div', { class: 'zl-findings' });
  let file = null; // { exists, rev, glossary }
  let filter = new Set(['suggested', 'confirmed']);
  let query = '';
  const selected = new Set();

  const say = (tone, body, title) => replace(notice, S().Alert({ tone, title, body, dismissible: true }));

  async function write(promise, done) {
    const r = await promise;
    if (r.ok) { if (r.data.conflicts?.length) say('warning', `${r.data.conflicts.length} entr${r.data.conflicts.length === 1 ? 'y contradicts' : 'ies contradict'} a confirmed entry and ${r.data.conflicts.length === 1 ? 'was' : 'were'} not added.`); done?.(); await load(); return true; }
    if (r.status === 409) { say('warning', 'The glossary changed on disk since this page read it. It was read again; repeat the change.', 'Changed on disk'); await load(); return false; }
    say('danger', `${r.error.message}. ${(r.error.errors ?? []).map((e) => `${e.path} ${e.message}`).join('; ')} Correct it and try again.`, 'Not saved');
    return false;
  }

  const languages = () => [...new Set((file?.glossary.entries ?? []).flatMap((e) => Object.keys(e.terms)))].sort();

  function entryDialog(entry) {
    const langs = [...new Set([...languages(), ...(entry ? Object.keys(entry.terms) : []), 'en', 'vi', 'ja'])].sort();
    const terms = { ...(entry?.terms ?? {}) };
    const avoid = Object.fromEntries(Object.entries(entry?.avoid ?? {}).map(([k, v]) => [k, v.join(', ')]));
    let note = entry?.note ?? '';
    const error = h('div', { role: 'alert' });
    const fields = langs.map((lang) => h('div', { class: 'zl-stack' },
      S().Input({ label: `Term in ${lang}`, optional: true, value: terms[lang] ?? '', onInput: (e) => { terms[lang] = e.target.value; } }),
      S().Input({ label: `Words to avoid in ${lang}`, optional: true, helper: 'Separated by commas', value: avoid[lang] ?? '', onInput: (e) => { avoid[lang] = e.target.value; } })));
    const noteField = S().Input({ label: 'Note', optional: true, helper: 'At most 280 characters', value: note, onInput: (e) => { note = e.target.value; } });
    let dialog;
    const save = S().Button({ label: entry ? 'Save the entry' : 'Add the entry', variant: 'primary', onClick: async () => {
      const t = Object.fromEntries(Object.entries(terms).map(([k, v]) => [k, v.trim()]).filter(([k, v]) => v && LANG_RE.test(k)));
      const a = Object.fromEntries(Object.entries(avoid).map(([k, v]) => [k, v.split(',').map((x) => x.trim()).filter(Boolean)]).filter(([k, v]) => v.length && LANG_RE.test(k)));
      const problems = [];
      if (Object.keys(t).length === 0) problems.push('Write the term in at least one language.');
      for (const [k, v] of Object.entries(t)) { const p = termProblem(v); if (p) problems.push(`Term in ${k}: ${p}`); }
      for (const [k, list] of Object.entries(a)) for (const v of list) { const p = termProblem(v); if (p) problems.push(`Word to avoid in ${k}: ${p}`); }
      const n = note.trim();
      if (n) { const p = termProblem(n, 280); if (p) problems.push(`Note: ${p}`); }
      if (problems.length) { replace(error, S().Alert({ tone: 'danger', title: 'Not saved', body: problems.join(' ') })); return; }
      const body = { terms: t, ...(Object.keys(a).length ? { avoid: a } : {}), ...(n ? { note: n } : {}) };
      const ok = entry
        ? await write(api.patch(path`/api/glossary/entries/${entry.id}`, { rev: file.rev, terms: t, avoid: Object.keys(a).length ? a : null, note: n || null }))
        : await write(api.post('/api/glossary/entries', { rev: file.rev, entries: [body], status: 'confirmed' }));
      if (ok) dialog.close();
    } });
    dialog = S().Dialog({ title: entry ? 'Edit the entry' : 'Add an entry', body: h('div', { class: 'zl-stack' }, fields, noteField, error), actions: [S().Button({ label: 'Keep it as it was', onClick: () => dialog.close() }), save], onClose: () => dialog.element.remove() });
    dialog.open();
  }

  /** One write per entry, each with the rev the previous write left. */
  async function setStatus(ids, status) {
    for (const id of ids) {
      const ok = await write(api.patch(path`/api/glossary/entries/${id}`, { rev: file.rev, status }));
      if (!ok) return;
    }
    selected.clear();
  }

  function table() {
    const langs = languages();
    const q = query.trim().toLowerCase();
    const rows = file.glossary.entries.filter((e) => filter.has(e.status) && (!q || JSON.stringify([e.terms, e.avoid ?? {}, e.note ?? '']).toLowerCase().includes(q)));
    if (rows.length === 0) return h('p', { class: 'body zl-muted' }, file.glossary.entries.length ? 'No entry matches this filter.' : 'No entries yet.');
    const columns = [
      { key: 'pick', label: 'Select', render: (e) => (e.status === 'suggested' ? S().Checkbox({ label: `Select ${Object.values(e.terms)[0]}`, checked: selected.has(e.id), onChange: (ev) => { if (ev.target.checked) selected.add(e.id); else selected.delete(e.id); } }) : '') },
      ...langs.map((lang) => ({ key: lang, label: lang, render: (e) => h('div', {}, e.terms[lang] ?? '', e.avoid?.[lang] ? h('div', { class: 'caption zl-muted' }, `not: ${e.avoid[lang].join(', ')}`) : null) })),
      { key: 'status', label: 'Status', render: (e) => badge(STATUS_BADGE[e.status]) },
      { key: 'actions', label: 'Actions', render: (e) => h('div', { class: 'zl-row' },
        e.status === 'suggested' ? S().Button({ label: 'Confirm', variant: 'ghost', size: 'sm', onClick: () => setStatus([e.id], 'confirmed') }) : null,
        e.status === 'suggested' ? S().Button({ label: 'Reject', variant: 'ghost', size: 'sm', onClick: () => setStatus([e.id], 'rejected') }) : null,
        e.status === 'rejected' ? S().Button({ label: 'Reopen', variant: 'ghost', size: 'sm', onClick: () => setStatus([e.id], 'suggested') }) : null,
        S().Button({ label: `Edit ${Object.values(e.terms)[0]}`, variant: 'ghost', size: 'sm', iconOnly: true, icon: 'edit', onClick: () => entryDialog(e) }),
        S().Button({ label: `Delete ${Object.values(e.terms)[0]}`, variant: 'ghost', size: 'sm', iconOnly: true, icon: 'trash', onClick: () => write(api.del(`${path`/api/glossary/entries/${e.id}`}?rev=${encodeURIComponent(file.rev ?? '')}`)) })) },
    ];
    return S().Table({ columns, rows, caption: 'Entries of .zukai/glossary.json' });
  }

  async function checkRun(run) {
    if (!run) return;
    replace(checkResult, h('p', { class: 'body-sm zl-muted' }, 'Checking'));
    const r = await api.get(`/api/glossary/check?run=${encodeURIComponent(run)}`);
    if (!r.ok) { replace(checkResult, S().Alert({ tone: 'danger', body: r.error.message })); return; }
    if (!r.data.ok) { replace(checkResult, S().Alert({ tone: 'warning', body: r.data.errors?.[0]?.message ?? 'The run could not be checked.' })); return; }
    const { findings } = r.data.report;
    const line = (f) => h('li', { class: 'body-sm' }, `${f.diagram} ${f.path} (${f.lang}): "${f.text}"${f.kind === 'avoided-term' ? ` uses the avoided word "${f.avoided}"` : ` should carry "${f.expected}"`}${f.from === 'map' ? ', found through a label map' : ''}`);
    const blocking = findings.filter((f) => f.level === 'blocking');
    const warnings = findings.filter((f) => f.level !== 'blocking');
    replace(checkResult,
      findings.length === 0 ? S().Alert({ tone: 'success', body: 'Every label of this run follows the confirmed entries.' }) : null,
      blocking.length ? h('div', {}, h('h3', { class: 'heading-sm' }, `Blocking (${blocking.length})`), h('ul', { class: 'zl-list' }, blocking.map(line))) : null,
      warnings.length ? h('div', {}, h('h3', { class: 'heading-sm' }, `Warnings (${warnings.length})`), h('ul', { class: 'zl-list' }, warnings.map(line))) : null);
  }

  async function render() {
    const header = h('header', { class: 'zl-page-header' }, h('div', { class: 'eyebrow' }, 'Glossary'), h('h1', { class: 'heading-lg' }, 'Preferred terms of this project'),
      h('p', { class: 'body zl-muted' }, 'Only a confirmed entry is applied to labels. Suggestions wait for your decision.'),
      h('div', { class: 'zl-row' },
        S().Button({ label: 'Add entry', variant: 'primary', icon: 'plus', onClick: () => entryDialog(null) }),
        S().Button({ label: 'Suggest from diagrams', variant: 'secondary', onClick: async () => {
          const r = await api.post('/api/jobs', { kind: 'glossary-suggest', params: { runs: 'all' } });
          if (r.ok) say('info', 'The agent reads the label pairs of every run and adds suggestions. They appear here when the job is done.', 'Queued');
          else say('danger', r.error.message, 'Not queued');
        } })));
    if (!file) { replace(element, header, notice, h('p', { class: 'body zl-muted' }, 'Reading the glossary')); return; }
    const chips = h('div', { class: 'zl-row', role: 'group', 'aria-label': 'Show entries that are' }, ['suggested', 'confirmed', 'rejected'].map((s) => S().Chip({ label: STATUS_BADGE[s].label, selectable: true, selected: filter.has(s), onClick: () => { if (filter.has(s)) filter.delete(s); else filter.add(s); replace(results, table()); } })));
    const search = S().Input({ label: 'Search terms', type: 'search', value: query, onInput: (e) => { query = e.target.value; replace(results, table()); } });
    const bulk = h('div', { class: 'zl-row' },
      S().Button({ label: 'Confirm selected', variant: 'secondary', size: 'sm', onClick: () => setStatus([...selected], 'confirmed') }),
      S().Button({ label: 'Reject selected', variant: 'secondary', size: 'sm', onClick: () => setStatus([...selected], 'rejected') }));
    const results = h('div', {}, table());
    const runs = await api.get('/api/runs');
    const runSelect = S().Select({ label: 'Check a run', placeholder: 'Choose a run', options: runs.ok ? runs.data.runs.map((x) => ({ value: x.run, label: `${x.title} (${x.run})` })) : [], onChange: (e) => checkRun(e.target.value) });
    replace(element, header, notice, chips, search, bulk, results, h('section', { class: 'zl-stack' }, h('h2', { class: 'heading-md' }, 'Check a run'), runSelect, checkResult));
  }

  async function load() {
    const r = await api.get('/api/glossary');
    if (!r.ok) { replace(element, S().Alert({ tone: 'danger', title: 'The glossary could not be read', body: `${r.error.message}. ${(r.error.errors ?? []).map((e) => `${e.path} ${e.message}`).join('; ')} Fix .zukai/glossary.json or take it back from git.` })); return; }
    file = r.data;
    render();
  }

  render();
  load();
  return { element, reload: load, title: 'Glossary', store };
}
