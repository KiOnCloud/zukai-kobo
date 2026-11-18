/**
 * One run: its header and actions, and the tabs Picture, Tables, History and Files. Every
 * action queues a job; nothing here changes a file.
 */
import { S } from '../sienna.mjs';
import { h, replace, when, size } from '../dom.mjs';
import { api, path } from '../api.mjs';
import { ORIGIN } from '../words.mjs';
import { badge, textBlock } from './badge.mjs';
import { openButton } from './open-drawio.mjs';

export const RUN_TABS = [
  { value: 'picture', label: 'Picture' },
  { value: 'tables', label: 'Tables' },
  { value: 'history', label: 'History' },
  { value: 'files', label: 'Files' },
];

export function runDetail({ store, run, tab = 'picture', extraTabs = {} }) {
  const element = h('div', { class: 'zl-page' });
  const tabs = [...RUN_TABS, ...Object.values(extraTabs).filter((t) => t.tab).map((t) => t.tab)];
  let detail = null;
  let current = tabs.some((t) => t.value === tab) ? tab : 'picture';
  let diagram = null;
  const panel = h('div', { class: 'zl-panel', role: 'tabpanel' });
  const notice = h('div', { role: 'status' });

  const queue = async (kind, params, done) => {
    const r = await api.post('/api/jobs', { kind, params: { run, ...params } });
    if (!r.ok) replace(notice, S().Alert({ tone: 'danger', title: 'The job was not queued', body: `${r.error.message}. ${(r.error.errors ?? []).map((e) => e.message).join(' ')} Try again once the form is right.` }));
    else { replace(notice); done?.(); }
  };

  const confirm = (title, body, label, onYes) => {
    let dialog;
    dialog = S().Dialog({ title, body, actions: [S().Button({ label: 'Keep the run as it is', onClick: () => dialog.close() }), S().Button({ label, variant: 'primary', onClick: () => { dialog.close(); onYes(); } })], onClose: () => dialog.element.remove() });
    dialog.open();
  };

  // A run's draw.io files: the combined <run-slug>.drawio, and drawio/<id>.drawio per diagram.
  const hasFile = (name) => detail.files.some((f) => f.name === name);
  const combinedName = () => `${run.replace(/^\d{8}_/, '')}.drawio`;
  const openIn = (name, compact) => openButton({ run, name, store, notice, compact });

  // ---------------------------------------------------------------- picture
  const fresh = (id) => {
    const svg = detail.files.find((f) => f.name === `svg/${id}.drawio.svg`);
    const ir = detail.files.find((f) => f.name === `source/${id}.ir.json`);
    return svg && ir && svg.modified >= ir.modified ? svg : undefined;
  };
  async function picture() {
    const ids = detail.diagrams.map((d) => d.id);
    diagram = ids.includes(diagram) ? diagram : ids[0];
    const pages = ids.length > 1 ? S().Select({ label: 'Diagram', value: diagram, options: detail.diagrams.map((d) => ({ value: d.id, label: d.title ?? d.id })), onChange: (e) => { diagram = e.target.value; show(); } }) : null;
    const frame = h('div', {});
    const opener = h('div', { class: 'zl-row' });
    const show = async () => {
      replace(opener, hasFile(`drawio/${diagram}.drawio`) ? openIn(`drawio/${diagram}.drawio`) : null);
      const svg = fresh(diagram);
      if (!svg) {
        if (extraTabs.livePicture) { replace(frame, extraTabs.livePicture.render({ run, diagram, onExport: exportPictures, onTables: () => switchTo('tables') })); return; }
        replace(frame, h('div', { class: 'zl-empty' }, h('p', { class: 'display-sm' }, 'No picture yet'), S().Button({ label: 'Export pictures', variant: 'secondary', onClick: exportPictures })));
        return;
      }
      const r = await api.blob(path`/api/runs/${run}/files/${svg.name}`);
      if (!r.ok) { replace(frame, S().Alert({ tone: 'danger', body: 'The picture could not be read. Export the pictures again.' })); return; }
      const img = h('img', { class: 'zl-picture-img', alt: `Picture of ${detail.diagrams.find((d) => d.id === diagram)?.title ?? diagram}` });
      img.src = URL.createObjectURL(new Blob([r.data], { type: 'image/svg+xml' }));
      replace(frame, h('figure', { class: 'zl-picture' }, img));
    };
    replace(panel, pages, opener, frame);
    show();
  }
  const exportPictures = () => queue('export', { svg: true });

  // ---------------------------------------------------------------- tables
  async function tables(lang = 'en') {
    const select = S().Select({ label: 'Language of the headings', value: lang, options: [{ value: 'en', label: 'English' }, { value: 'ja', label: 'Japanese' }, { value: 'vi', label: 'Vietnamese' }], onChange: (e) => tables(e.target.value) });
    replace(panel, select, h('p', { class: 'body-sm zl-muted' }, 'Building the tables'));
    const r = await api.get(path`/api/runs/${run}/doc?lang=${lang}`);
    replace(panel, select, r.ok ? textBlock(r.data.markdown) : S().Alert({ tone: 'danger', body: `The tables could not be built: ${r.error.message}` }));
  }

  // ---------------------------------------------------------------- history
  async function changesOf(rev, holder) {
    replace(holder, h('p', { class: 'body-sm zl-muted' }, 'Comparing'));
    const r = await api.get(path`/api/runs/${run}/revisions/${rev}/changes`);
    if (!r.ok) { replace(holder, S().Alert({ tone: 'danger', body: r.error.message })); return; }
    const lines = [];
    for (const d of r.data.diagrams ?? []) {
      for (const a of d.added) lines.push(`${d.id}: added ${a.collection} "${a.label}"`);
      for (const x of d.removed) lines.push(`${d.id}: removed ${x.collection} "${x.label}"`);
      for (const c of d.changed) lines.push(`${d.id}: changed ${c.collection} "${c.label}" (${c.fields.join(', ')})`);
      for (const f of d.fields ?? []) lines.push(`${d.id}: ${f.field} changed`);
    }
    for (const id of r.data.diagramsAdded ?? []) lines.push(`diagram added: ${id}`);
    for (const id of r.data.diagramsRemoved ?? []) lines.push(`diagram removed: ${id}`);
    replace(holder, h('h3', { class: 'heading-sm' }, `Changes since ${rev}`), lines.length ? h('ul', { class: 'zl-list body-sm' }, lines.map((l) => h('li', {}, l))) : h('p', { class: 'body-sm zl-muted' }, 'Nothing changed since this revision.'));
  }
  function history() {
    if (detail.revisions.length === 0) { replace(panel, h('div', { class: 'zl-empty' }, h('p', { class: 'display-sm' }, 'No revisions yet'), h('p', { class: 'body zl-muted' }, 'A revision is written each time the run is revised.'))); return; }
    const changes = h('div', { class: 'zl-stack' });
    const columns = [
      { key: 'rev', label: 'Revision', render: (r) => h('span', { class: 'code' }, r.rev) },
      { key: 'createdAt', label: 'Date', muted: true, render: (r) => when(r.createdAt) },
      { key: 'request', label: 'Request', render: (r) => r.request || (r.undoOf ? `Before the restore of ${r.undoOf}` : '') },
      { key: 'actions', label: 'Actions', render: (r) => h('div', { class: 'zl-row' },
        S().Button({ label: `Changes since ${r.rev}`, variant: 'ghost', size: 'sm', onClick: () => changesOf(r.rev, changes) }),
        S().Button({ label: `Restore ${r.rev}`, variant: 'ghost', size: 'sm', onClick: () => confirm(`Restore ${r.rev}?`, `The run goes back to revision ${r.rev}. Its current state is saved first, so this can be undone.`, `Restore ${r.rev}`, () => queue('restore', { target: r.rev })) })) },
    ];
    replace(panel, S().Table({ columns, rows: detail.revisions, caption: 'Revisions, newest first' }), changes);
  }

  // ---------------------------------------------------------------- files
  async function download(name) {
    const r = await api.blob(path`/api/runs/${run}/files/${name}`);
    if (!r.ok) { replace(notice, S().Alert({ tone: 'danger', body: `${name} could not be downloaded: ${r.error.message}` })); return; }
    const url = URL.createObjectURL(r.data);
    const a = h('a', { href: url, download: name.split('/').pop() });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
  function files() {
    const columns = [
      { key: 'name', label: 'File', render: (f) => h('span', { class: 'code' }, f.name) },
      { key: 'size', label: 'Size', numeric: true, render: (f) => size(f.size) },
      { key: 'modified', label: 'Changed', muted: true, render: (f) => when(f.modified) },
      { key: 'actions', label: 'Actions', render: (f) => h('div', { class: 'zl-row' },
        S().Button({ label: `Copy the path of ${f.name}`, variant: 'ghost', size: 'sm', iconOnly: true, icon: 'edit', onClick: () => navigator.clipboard?.writeText(`diagrams/${run}/${f.name}`).catch(() => replace(notice, S().Alert({ tone: 'warning', body: `The browser did not allow copying. The path is diagrams/${run}/${f.name}.` }))) }),
        S().Button({ label: `Download ${f.name}`, variant: 'ghost', size: 'sm', iconOnly: true, icon: 'download', onClick: () => download(f.name) }),
        f.name.endsWith('.drawio') ? openIn(f.name, true) : null) },
    ];
    replace(panel, S().Table({ columns, rows: detail.files, caption: `Files of diagrams/${run}` }));
  }

  // ---------------------------------------------------------------- frame
  function showTab() {
    if (current === 'picture') picture();
    else if (current === 'tables') tables();
    else if (current === 'history') history();
    else if (current === 'files') files();
    else extraTabs[current]?.render({ panel, run, detail, queue, notice });
  }

  let composerElement = null;
  function header() {
    composerElement ??= reviseComposer();
    const composer = store.get().asking ? null : composerElement;
    const undo = detail.undo;
    const redo = detail.redo;
    return h('header', { class: 'zl-page-header' },
      h('div', { class: 'eyebrow' }, [when(`${detail.date}T00:00:00`).split(',')[0], ORIGIN[detail.origin]].filter(Boolean).join(' · ')),
      h('h1', { class: 'display-md' }, detail.title),
      h('div', { class: 'zl-row' }, h('span', { class: 'code zl-muted' }, `diagrams/${run}`), detail.stale?.stale ? badge({ label: 'Behind the code', tone: 'warning' }) : null),
      h('div', { class: 'zl-row' },
        S().Button({ label: undo ? `Undo to ${undo}` : 'Undo', variant: 'secondary', disabled: !undo, onClick: () => queue('restore', { target: 'undo' }) }),
        S().Button({ label: redo ? `Redo ${redo}` : 'Redo', variant: 'secondary', disabled: !redo, onClick: () => queue('restore', { target: 'redo' }) }),
        detail.scouted ? S().Button({ label: 'Sync with the code', variant: 'secondary', onClick: () => queue('sync', {}) }) : null,
        S().Button({ label: 'Export pictures', variant: 'secondary', onClick: exportPictures }),
        hasFile(combinedName()) ? openIn(combinedName()) : null),
      composer, notice);
  }

  function reviseComposer() {
    const state = { request: '', preview: false };
    const send = S().Button({ label: 'Revise', variant: 'accent', round: true, iconOnly: true, icon: 'arrow-up', type: 'submit' });
    return h('form', { class: 'zl-composer', onSubmit: (e) => {
      e.preventDefault();
      if (!state.request.trim()) { replace(notice, S().Alert({ tone: 'warning', body: 'Write what should change, then revise.' })); return; }
      queue('revise', { request: state.request.trim(), ...(state.preview ? { preview: true } : {}) }, () => { e.target.reset(); state.request = ''; });
    } },
    S().Input({ label: 'Revise this run', multiline: true, rows: 2, placeholder: 'Add a stock check after login', onInput: (e) => { state.request = e.target.value; } }),
    h('div', { class: 'zl-row' }, S().Checkbox({ label: 'Show me drafts first', onChange: (e) => { state.preview = e.target.checked; } }), send));
  }

  let tabList = null;
  function switchTo(value) {
    current = value;
    window.history.replaceState(null, '', `#/diagrams/${encodeURIComponent(run)}/${value}`);
    render();
  }

  function render() {
    if (!detail) { replace(element, h('p', { class: 'body zl-muted' }, 'Reading the run')); return; }
    tabList = S().Tabs({ items: tabs, value: current, panel: false, label: 'Views of this run', onChange: (v) => { current = v; window.history.replaceState(null, '', `#/diagrams/${encodeURIComponent(run)}/${v}`); showTab(); } });
    element.dataset.asking = String(Boolean(store.get().asking));
    replace(element, header(), tabList, panel);
    showTab();
  }

  async function load() {
    const r = await api.get(path`/api/runs/${run}`);
    if (!r.ok) { replace(element, S().Alert({ tone: 'danger', title: 'This run could not be read', body: r.status === 404 ? 'No run of that name is under diagrams/. Go back to the list of runs.' : r.error.message })); return; }
    detail = r.data;
    render();
  }

  render();
  load();
  // The request composer is hidden while a question card is open: one clay element in view.
  const unsubscribe = store.subscribe((s) => { if (detail && String(Boolean(s.asking)) !== element.dataset.asking) render(); });
  return { element, reload: load, title: run, dispose: unsubscribe };
}
