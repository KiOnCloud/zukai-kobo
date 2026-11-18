/**
 * The Glossary section: the project's preferred terms per language, in three tabs. Entries:
 * search, filter, add, edit, delete, and confirm or reject a selection. Review: the suggestions
 * one by one. Check a run: the labels of a run against the confirmed entries. Every write
 * carries the `rev` the page read; a write that gets 409 reloads the file and says it changed on
 * disk. The limits of the file are checked here before a write is sent, and again by the server.
 */
import { S } from '../sienna.mjs';
import { h, replace } from '../dom.mjs';
import { api, path } from '../api.mjs';
import { badge } from './badge.mjs';
import { confirmDialog } from './job-panel.mjs';

const STATUS_BADGE = {
  suggested: { label: 'Suggested', tone: 'warning' },
  confirmed: { label: 'Confirmed', tone: 'success', icon: 'check' },
  rejected: { label: 'Rejected', tone: 'neutral', outline: true },
};
const LANG_NAME = { en: 'English', ja: 'Japanese', vi: 'Vietnamese' };
const LANG_RE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const BAD_TEXT = /[\u0000-\u001F\u007F-\u009F\u061C\u200E\u200F\u2028\u2029\u202A-\u202E\u2066-\u2069]/;
const TABS = [{ value: 'entries', label: 'Entries' }, { value: 'review', label: 'Review suggestions' }, { value: 'check', label: 'Check a run' }];

/** What the form refuses before a write is sent; the server checks the same and more. */
export function termProblem(value, max = 80) {
  if ([...value].length > max) return `At most ${max} characters.`;
  if (BAD_TEXT.test(value)) return 'One line of text, with no control or direction character.';
  return undefined;
}

/** The findings of a glossary check as a table, blocking first; a clean run says so. */
export function findingsTable(findings) {
  if (findings.length === 0) return S().Alert({ tone: 'success', title: 'No findings', body: 'Every label of this run follows the confirmed entries.' });
  const blocking = findings.filter((f) => f.level === 'blocking');
  const rows = [...blocking, ...findings.filter((f) => f.level !== 'blocking')];
  const columns = [
    { key: 'level', label: 'Level', render: (f) => badge(f.level === 'blocking' ? { label: 'Blocking', tone: 'danger', icon: 'alert' } : { label: 'Warning', tone: 'warning' }) },
    { key: 'where', label: 'Where', render: (f) => h('div', {}, h('div', { class: 'body-sm' }, f.diagram), h('div', { class: 'code caption zl-muted' }, `${f.path} · ${f.lang}`)) },
    { key: 'text', label: 'Label', render: (f) => h('span', { lang: f.lang }, f.text) },
    { key: 'problem', label: 'Problem', render: (f) => h('span', { class: 'body-sm' }, f.kind === 'avoided-term' ? `Uses the avoided word "${f.avoided}"` : `Should carry "${f.expected}"`, f.from === 'map' ? h('span', { class: 'caption zl-muted' }, ' (found through a label map)') : null) },
  ];
  return h('div', { class: 'zl-stack' },
    h('p', { class: 'body' }, `${blocking.length} blocking, ${findings.length - blocking.length} warning${findings.length - blocking.length === 1 ? '' : 's'}.`),
    S().Table({ columns, rows, caption: 'Findings of the glossary check', dense: true }));
}

export function glossarySection({ store, parts = [], setCrumbs }) {
  const element = h('div', { class: 'zl-page' });
  const notice = h('div', { role: 'status' });
  const panel = h('div', { class: 'zl-panel', role: 'tabpanel' });
  let file = null; // { exists, rev, glossary }
  let failure = null;
  let tab = TABS.some((t) => t.value === parts[0]) ? parts[0] : 'entries';
  const filter = new Set(['suggested', 'confirmed']);
  let query = '';
  const selected = new Set();
  let checkRunName = '';

  const say = (tone, body, title) => replace(notice, S().Alert({ tone, title, body, dismissible: true }));
  const label = (e) => Object.values(e.terms)[0] ?? e.id;

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
    const rows = h('div', { class: 'zl-term-rows' });
    const row = (lang) => h('div', { class: 'zl-term-row' },
      h('span', { class: 'zl-lang code', title: LANG_NAME[lang] ?? lang }, lang),
      S().Input({ label: `Term in ${lang}`, optional: true, value: terms[lang] ?? '', onInput: (e) => { terms[lang] = e.target.value; } }),
      S().Input({ label: `Words to avoid in ${lang}`, optional: true, helper: 'Separated by commas', value: avoid[lang] ?? '', onInput: (e) => { avoid[lang] = e.target.value; } }));
    replace(rows, langs.map(row));
    let newLang = '';
    const addLang = h('div', { class: 'zl-row zl-add-lang' },
      S().Input({ label: 'Another language', optional: true, helper: 'A BCP 47 tag, such as ko or pt-BR', size: 'sm', onInput: (e) => { newLang = e.target.value.trim(); } }),
      S().Button({ label: 'Add the language', variant: 'ghost', size: 'sm', icon: 'plus', onClick: () => {
        if (!LANG_RE.test(newLang) || langs.includes(newLang)) { replace(error, S().Alert({ tone: 'warning', body: langs.includes(newLang) ? `${newLang} is listed already.` : 'Write a language tag such as ko or pt-BR.' })); return; }
        langs.push(newLang);
        rows.appendChild(row(newLang));
        replace(error);
      } }));
    const noteField = S().Input({ label: 'Note', optional: true, multiline: true, rows: 2, helper: 'What the term means here; at most 280 characters. No names of people.', value: note, onInput: (e) => { note = e.target.value; } });
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
    dialog = S().Dialog({
      title: entry ? 'Edit the entry' : 'Add an entry',
      body: h('div', { class: 'zl-stack' }, h('p', { class: 'body-sm zl-muted' }, entry ? 'Entries are symmetric: no language is the source of another.' : 'A new entry is confirmed: every later label in these languages uses it.'), rows, addLang, noteField, error),
      actions: [S().Button({ label: 'Keep it as it was', onClick: () => dialog.close() }), save],
      onClose: () => dialog.element.remove(),
      className: 'zl-dialog-wide',
    });
    dialog.open();
  }

  /** One write per entry, each with the rev the previous write left. */
  async function setStatus(ids, status) {
    for (const id of ids) {
      const ok = await write(api.patch(path`/api/glossary/entries/${id}`, { rev: file.rev, status }));
      if (!ok) return;
    }
    selected.clear();
    if (ids.length > 1) say('success', `${ids.length} entries are ${status}.`);
  }
  const remove = (e) => confirmDialog({ title: `Delete "${label(e)}"?`, body: 'The entry leaves .zukai/glossary.json. A rejected entry is kept instead, so the same suggestion is not made again; reject it if that is what you mean.', action: 'Delete the entry', run: () => write(api.del(`${path`/api/glossary/entries/${e.id}`}?rev=${encodeURIComponent(file.rev ?? '')}`)) });

  // ---------------------------------------------------------------- entries
  function entriesTab() {
    const results = h('div', {});
    const bulk = h('div', { class: 'zl-bulk', role: 'region', 'aria-label': 'Selected entries' });
    const drawBulk = () => replace(bulk, selected.size ? [
      h('span', { class: 'label' }, `${selected.size} selected`),
      S().Button({ label: 'Confirm selected', variant: 'secondary', size: 'sm', onClick: () => setStatus([...selected], 'confirmed') }),
      S().Button({ label: 'Reject selected', variant: 'secondary', size: 'sm', onClick: () => setStatus([...selected], 'rejected') }),
      S().Button({ label: 'Clear', variant: 'ghost', size: 'sm', onClick: () => { selected.clear(); drawTable(); } }),
    ] : null);
    function drawTable() {
      const langs = languages();
      const q = query.trim().toLowerCase();
      const rows = file.glossary.entries.filter((e) => filter.has(e.status) && (!q || JSON.stringify([e.terms, e.avoid ?? {}, e.note ?? '']).toLowerCase().includes(q)));
      drawBulk();
      if (rows.length === 0) { replace(results, h('p', { class: 'body zl-muted' }, file.glossary.entries.length ? 'No entry matches this filter.' : 'No entries yet.')); return; }
      const columns = [
        { key: 'pick', label: 'Select', render: (e) => {
          if (e.status !== 'suggested') return '';
          const box = S().Checkbox({ label: `Select ${label(e)}`, checked: selected.has(e.id), className: 'zl-pick', onChange: (ev) => { if (ev.target.checked) selected.add(e.id); else selected.delete(e.id); drawBulk(); } });
          box.querySelector('input')?.setAttribute('aria-label', `Select ${label(e)}`);
          return box;
        } },
        ...langs.map((lang) => ({ key: lang, label: LANG_NAME[lang] ?? lang, render: (e) => h('div', { lang }, e.terms[lang] ?? h('span', { class: 'zl-muted' }, '—'), e.avoid?.[lang] ? h('div', { class: 'caption zl-muted' }, 'Avoid ', h('s', { class: 'zl-avoid' }, e.avoid[lang].join(', '))) : null) })),
        { key: 'note', label: 'Note', muted: true, render: (e) => h('span', { class: 'caption zl-clamp' }, e.note ?? '') },
        { key: 'status', label: 'Status', render: (e) => badge(STATUS_BADGE[e.status]) },
        { key: 'actions', label: 'Actions', render: (e) => h('div', { class: 'zl-row zl-row-tight' },
          e.status === 'suggested' ? S().Button({ label: 'Confirm', variant: 'ghost', size: 'sm', onClick: () => setStatus([e.id], 'confirmed') }) : null,
          e.status === 'rejected' ? S().Button({ label: 'Reopen', variant: 'ghost', size: 'sm', onClick: () => setStatus([e.id], 'suggested') }) : null,
          S().Button({ label: `Edit ${label(e)}`, variant: 'ghost', size: 'sm', iconOnly: true, icon: 'edit', onClick: () => entryDialog(e) }),
          S().Button({ label: `Delete ${label(e)}`, variant: 'ghost', size: 'sm', iconOnly: true, icon: 'trash', onClick: () => remove(e) })) },
      ];
      replace(results, S().Table({ columns, rows, caption: 'Entries of .zukai/glossary.json' }));
    }
    const counts = file.glossary.entries.reduce((m, e) => ({ ...m, [e.status]: (m[e.status] ?? 0) + 1 }), {});
    const chips = h('div', { class: 'zl-row', role: 'group', 'aria-label': 'Show entries that are' }, ['suggested', 'confirmed', 'rejected'].map((s) => S().Chip({ label: `${STATUS_BADGE[s].label} · ${counts[s] ?? 0}`, selectable: true, selected: filter.has(s), onClick: () => { if (filter.has(s)) filter.delete(s); else filter.add(s); drawTable(); } })));
    const search = S().Input({ label: 'Search terms', type: 'search', value: query, placeholder: 'A term, an avoided word or a note', onInput: (e) => { query = e.target.value; drawTable(); } });
    drawTable();
    replace(panel, h('div', { class: 'zl-toolbar' }, h('div', { class: 'zl-toolbar-search' }, search), chips), bulk, results);
  }

  // ---------------------------------------------------------------- review
  function reviewTab() {
    const waiting = file.glossary.entries.filter((e) => e.status === 'suggested');
    if (waiting.length === 0) {
      replace(panel, h('div', { class: 'zl-empty' }, h('p', { class: 'display-sm' }, 'No suggestions waiting'), h('p', { class: 'body zl-muted' }, 'Ask the agent to read the label pairs of every run and suggest entries. A suggestion changes no label until you confirm it.'), suggestButton()));
      return;
    }
    replace(panel,
      h('div', { class: 'zl-row zl-spread' }, h('p', { class: 'body zl-muted' }, `${waiting.length} suggestion${waiting.length === 1 ? '' : 's'}. Confirm what your team should use; a rejected one is kept, so it is not suggested again.`),
        waiting.length > 1 ? S().Button({ label: `Confirm all ${waiting.length}`, variant: 'secondary', size: 'sm', onClick: () => confirmDialog({ title: `Confirm ${waiting.length} entries?`, body: 'Every later label in these languages uses the confirmed terms. Read each one first if you are not sure.', action: `Confirm all ${waiting.length}`, keep: 'Review them one by one', tone: 'neutral', run: () => setStatus(waiting.map((e) => e.id), 'confirmed') }) }) : null),
      h('ul', { class: 'zl-review-grid' }, waiting.map((e) => h('li', { class: 'zl-review-card' },
        h('dl', { class: 'zl-term-list' }, Object.entries(e.terms).map(([lang, term]) => h('div', { class: 'zl-term-pair' }, h('dt', { class: 'zl-lang code' }, lang), h('dd', { class: 'heading-sm', lang }, term, e.avoid?.[lang] ? h('span', { class: 'caption zl-muted' }, ' · avoid ', h('s', { class: 'zl-avoid' }, e.avoid[lang].join(', '))) : null)))),
        e.note ? h('p', { class: 'body-sm zl-muted' }, e.note) : null,
        h('div', { class: 'zl-row' },
          S().Button({ label: 'Confirm', variant: 'secondary', size: 'sm', icon: 'check', onClick: () => setStatus([e.id], 'confirmed') }),
          S().Button({ label: 'Reject', variant: 'ghost', size: 'sm', onClick: () => setStatus([e.id], 'rejected') }),
          S().Button({ label: `Edit ${label(e)}`, variant: 'ghost', size: 'sm', iconOnly: true, icon: 'edit', onClick: () => entryDialog(e) }))))));
  }

  // ---------------------------------------------------------------- check
  async function checkTab() {
    const out = h('div', { class: 'zl-findings' });
    const runs = await api.get('/api/runs');
    const options = runs.ok ? runs.data.runs.map((x) => ({ value: x.run, label: `${x.title} (${x.run})` })) : [];
    const run = async (name) => {
      checkRunName = name;
      if (!name) { replace(out); return; }
      replace(out, h('p', { class: 'body-sm zl-muted' }, 'Checking'));
      const r = await api.get(`/api/glossary/check?run=${encodeURIComponent(name)}`);
      if (!r.ok) { replace(out, S().Alert({ tone: 'danger', body: r.error.message })); return; }
      if (!r.data.ok) { replace(out, S().Alert({ tone: 'warning', body: r.data.errors?.[0]?.message ?? 'The run could not be checked.' })); return; }
      replace(out, findingsTable(r.data.report.findings), h('a', { class: 'body-sm', href: `#/diagrams/${encodeURIComponent(name)}/glossary` }, 'Open the run'));
    };
    const select = S().Select({ label: 'Run', placeholder: 'Choose a run', value: checkRunName, options, onChange: (e) => run(e.target.value) });
    if (tab !== 'check') return;
    replace(panel, h('p', { class: 'body zl-muted' }, 'The labels of the run, original and translated, against the confirmed entries. Suggestions are not used.'), h('div', { class: 'zl-narrow' }, select), out);
    if (checkRunName) run(checkRunName);
  }

  function suggestButton(variant = 'secondary') {
    return S().Button({ label: 'Suggest from diagrams', variant, onClick: async () => {
      const r = await api.post('/api/jobs', { kind: 'glossary-suggest', params: { runs: 'all' } });
      if (r.ok) say('info', 'The agent reads the label pairs of every run and adds suggestions. They appear under Review suggestions when the job is done.', 'Queued');
      else say('danger', r.error.message, 'Not queued');
    } });
  }

  function showTab() {
    if (tab === 'entries') entriesTab();
    else if (tab === 'review') reviewTab();
    else checkTab();
  }

  function render() {
    const counts = file?.glossary.entries.reduce((m, e) => ({ ...m, [e.status]: (m[e.status] ?? 0) + 1 }), {}) ?? {};
    const header = h('header', { class: 'zl-page-header zl-page-header-row' },
      h('div', { class: 'zl-stack-tight' },
        h('div', { class: 'eyebrow' }, 'Glossary'),
        h('h1', { class: 'display-md' }, 'Preferred terms'),
        h('p', { class: 'body zl-muted' }, 'One term per language for each idea, kept in .zukai/glossary.json and committed with the project. Only a confirmed entry is applied to labels.')),
      h('div', { class: 'zl-row' }, suggestButton(), S().Button({ label: 'Add entry', variant: 'primary', icon: 'plus', onClick: () => entryDialog(null) })));
    if (failure) { replace(element, header, notice, S().Alert({ tone: 'danger', title: 'The glossary could not be read', body: failure })); return; }
    if (!file) { replace(element, header, notice, h('p', { class: 'body zl-muted' }, 'Reading the glossary')); return; }
    const tabs = S().Tabs({ items: TABS.map((t) => (t.value === 'review' ? { ...t, count: counts.suggested ?? 0 } : t)), value: tab, panel: false, label: 'Glossary views', onChange: (v) => { tab = v; window.history.replaceState(null, '', `#/glossary/${v}`); setCrumbs?.([{ label: TABS.find((t) => t.value === v).label }]); showTab(); } });
    replace(element, header,
      file.exists ? null : S().Alert({ tone: 'neutral', body: 'This project has no glossary yet. The first entry creates .zukai/glossary.json.' }),
      notice, tabs, panel);
    showTab();
  }

  async function load() {
    const r = await api.get('/api/glossary');
    if (!r.ok) { failure = `${r.error.message}. ${(r.error.errors ?? []).map((e) => `${e.path} ${e.message}`).join('; ')} Fix .zukai/glossary.json or take it back from git.`; render(); return; }
    failure = null;
    file = r.data;
    render();
  }

  if (tab !== 'entries') setCrumbs?.([{ label: TABS.find((t) => t.value === tab).label }]);
  render();
  load();
  return {
    element, reload: load, title: 'Glossary', store,
    route: (p) => { const t = TABS.some((x) => x.value === p[0]) ? p[0] : 'entries'; if (t !== tab) { tab = t; render(); } },
  };
}
