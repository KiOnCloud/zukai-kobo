/**
 * One run: its header and actions, the source files that changed since it was drawn, the list
 * of its diagrams, and the tabs Picture, Model, Tables, History, Files and Glossary. Every
 * action queues a job; nothing here changes a file.
 */
import { S } from '../sienna.mjs';
import { h, replace, when, ago, size, day, copyText } from '../dom.mjs';
import { api, path } from '../api.mjs';
import { ORIGIN, DOC_LANGS, kindLabel, targetLabel, KIND_LABEL } from '../words.mjs';
import { badge, textBlock } from './badge.mjs';
import { glyph } from './glyphs.mjs';
import { fileView } from './file-view.mjs';
import { confirmDialog } from './job-panel.mjs';
import { findingsTable } from './glossary.mjs';
import { openButton } from './open-drawio.mjs';

export const RUN_TABS = [
  { value: 'picture', label: 'Picture' },
  { value: 'tables', label: 'Tables' },
  { value: 'history', label: 'History' },
  { value: 'files', label: 'Files' },
  { value: 'glossary', label: 'Glossary' },
];
const WITH_LIST = new Set(['picture', 'model']);

export function runDetail({ store, run, tab = 'picture', diagram: startDiagram, extraTabs = {}, setCrumbs }) {
  const element = h('div', { class: 'zl-page' });
  const extra = Object.values(extraTabs).filter((t) => t.tab).map((t) => t.tab);
  const tabs = [RUN_TABS[0], ...extra, ...RUN_TABS.slice(1)];
  let detail = null;
  let current = tabs.some((t) => t.value === tab) ? tab : 'picture';
  let diagram = startDiagram ?? null;
  let fit = true;
  const panel = h('div', { class: 'zl-panel', role: 'tabpanel' });
  const notice = h('div', { role: 'status' });
  const listHolder = h('div', {});

  const say = (tone, body, title) => replace(notice, S().Alert({ tone, title, body, dismissible: true }));
  const queue = async (kind, params, done) => {
    const r = await api.post('/api/jobs', { kind, params: { run, ...params } });
    if (!r.ok) say('danger', `${r.error.message}. ${(r.error.errors ?? []).map((e) => e.message).join(' ')} Try again once the form is right.`, 'The job was not queued');
    else { say('info', `${KIND_LABEL[kind] ?? kind} is queued. The agent panel shows its steps.`); done?.(); }
  };
  const remember = () => window.history.replaceState(null, '', `#/diagrams/${encodeURIComponent(run)}/${current}${diagram && WITH_LIST.has(current) ? `/${encodeURIComponent(diagram)}` : ''}`);

  // ---------------------------------------------------------------- diagrams of the run
  function diagramList() {
    if (detail.diagrams.length < 2) return null;
    return h('nav', { class: 'zl-diagram-list', 'aria-label': 'Diagrams of this run' },
      h('h2', { class: 'eyebrow' }, `Diagrams (${detail.diagrams.length})`),
      h('ul', { class: 'zl-list' }, detail.diagrams.map((d) => h('li', {},
        h('button', { type: 'button', class: 'zl-diagram-item', 'aria-current': d.id === diagram ? 'true' : undefined, onClick: () => { diagram = d.id; remember(); drawList(); showTab(); } },
          glyph(d.kind, { size: 'sm' }),
          h('span', { class: 'zl-diagram-item-text' },
            h('span', { class: 'label' }, d.title ?? d.id),
            h('span', { class: 'caption zl-muted' }, [kindLabel(d.kind), d.audience === 'business' ? 'Business view' : null].filter(Boolean).join(' · '))))))));
  }
  const drawList = () => replace(listHolder, WITH_LIST.has(current) ? diagramList() : null);

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
  const exportPictures = () => queue('export', { svg: true });
  async function picture() {
    const d = detail.diagrams.find((x) => x.id === diagram);
    const frame = h('div', {});
    const svg = fresh(diagram);
    const bar = h('div', { class: 'zl-picture-bar' },
      h('div', { class: 'zl-row' }, glyph(d?.kind, { size: 'sm' }), h('span', { class: 'label' }, d?.title ?? diagram), h('span', { class: 'caption zl-muted' }, kindLabel(d?.kind))),
      h('div', { class: 'zl-row' },
        svg ? S().Tabs({ variant: 'segment', panel: false, label: 'Size of the picture', value: fit ? 'fit' : 'full', items: [{ value: 'fit', label: 'Fit' }, { value: 'full', label: 'Actual size' }], onChange: (v) => { fit = v === 'fit'; frame.firstChild?.classList.toggle('zl-picture-full', !fit); } }) : null,
        h('span', { class: 'caption zl-muted' }, svg ? `From svg/ · ${ago(svg.modified)}` : 'Drawn live from the model'),
        hasFile(`drawio/${diagram}.drawio`) ? openIn(`drawio/${diagram}.drawio`) : null));
    replace(panel, bar, frame);
    if (!svg) {
      if (extraTabs.livePicture) { replace(frame, extraTabs.livePicture.render({ run, diagram, onExport: exportPictures, onTables: () => switchTo('tables') })); return; }
      replace(frame, h('div', { class: 'zl-empty' }, h('p', { class: 'display-sm' }, 'No picture yet'), S().Button({ label: 'Export pictures', variant: 'secondary', onClick: exportPictures })));
      return;
    }
    const r = await api.blob(path`/api/runs/${run}/files/${svg.name}`);
    if (!r.ok) { replace(frame, S().Alert({ tone: 'danger', body: 'The picture could not be read. Export the pictures again.' })); return; }
    const img = h('img', { class: 'zl-picture-img', alt: `Picture of ${d?.title ?? diagram}` });
    img.src = URL.createObjectURL(new Blob([r.data], { type: 'image/svg+xml' }));
    replace(frame, h('figure', { class: ['zl-picture', fit ? null : 'zl-picture-full'] }, img));
  }

  // ---------------------------------------------------------------- tables
  let tableLang = 'en';
  async function tables() {
    const out = h('div', {}, h('p', { class: 'body-sm zl-muted' }, 'Building the tables'));
    const langs = S().Tabs({ variant: 'segment', panel: false, label: 'Language of the headings', value: tableLang, items: DOC_LANGS.map((l) => ({ value: l.value, label: l.label })), onChange: (v) => { tableLang = v; tables(); } });
    let markdown = '';
    const copy = S().Button({ label: 'Copy Markdown', variant: 'ghost', size: 'sm', onClick: () => copyText(markdown, () => say('warning', 'The browser did not allow copying. Select the text and copy it by hand.')).then((ok) => { if (ok) say('success', 'The tables are copied as Markdown.'); }) });
    replace(panel, h('div', { class: 'zl-picture-bar' }, h('p', { class: 'body-sm zl-muted' }, 'Every element of every diagram, generated from the models. Labels stay as the models have them.'), h('div', { class: 'zl-row' }, langs, copy)), out);
    const r = await api.get(path`/api/runs/${run}/doc?lang=${tableLang}`);
    if (r.ok) markdown = r.data.markdown;
    replace(out, r.ok ? textBlock(r.data.markdown, 'zl-block-tall') : S().Alert({ tone: 'danger', body: `The tables could not be built: ${r.error.message}` }));
  }

  // ---------------------------------------------------------------- history
  async function changesOf(rev, holder, button) {
    if (holder.dataset.open === 'true') { holder.dataset.open = 'false'; replace(holder); button.lastChild.textContent = 'Show changes since'; return; }
    holder.dataset.open = 'true';
    button.lastChild.textContent = 'Hide changes';
    replace(holder, h('p', { class: 'body-sm zl-muted' }, 'Comparing'));
    const r = await api.get(path`/api/runs/${run}/revisions/${rev}/changes`);
    if (!r.ok) { replace(holder, S().Alert({ tone: 'danger', body: r.error.message })); return; }
    const lines = [];
    const line = (mark, tone, text, place) => lines.push(h('li', { class: ['zl-change', `zl-change-${tone}`] }, h('span', { class: 'zl-change-mark code', 'aria-hidden': 'true' }, mark), h('span', { class: 'body-sm' }, text), place ? h('span', { class: 'caption zl-muted' }, place) : null));
    for (const id of r.data.diagramsAdded ?? []) line('+', 'add', `Diagram added: ${id}`);
    for (const id of r.data.diagramsRemoved ?? []) line('−', 'remove', `Diagram removed: ${id}`);
    for (const d of r.data.diagrams ?? []) {
      for (const a of d.added) line('+', 'add', `Added ${a.collection.replace(/s$/, '')} "${a.label}"`, d.id);
      for (const x of d.removed) line('−', 'remove', `Removed ${x.collection.replace(/s$/, '')} "${x.label}"`, d.id);
      for (const c of d.changed) line('~', 'change', `Changed ${c.collection.replace(/s$/, '')} "${c.label}" (${c.fields.join(', ')})`, d.id);
      for (const f of d.fields ?? []) line('~', 'change', `${f.field} changed`, d.id);
    }
    replace(holder, lines.length ? h('ul', { class: 'zl-changes' }, lines) : h('p', { class: 'body-sm zl-muted' }, 'Nothing changed since this revision.'));
  }
  function history() {
    if (detail.revisions.length === 0) { replace(panel, h('div', { class: 'zl-empty' }, h('p', { class: 'display-sm' }, 'No revisions yet'), h('p', { class: 'body zl-muted' }, 'A revision is written each time the run is revised, synced or restored, so every change can be undone.'))); return; }
    replace(panel, h('ol', { class: 'zl-timeline' }, detail.revisions.map((r, i) => {
      const holder = h('div', {});
      const show = S().Button({ label: 'Show changes since', variant: 'ghost', size: 'sm', onClick: (e) => changesOf(r.rev, holder, e.currentTarget) });
      return h('li', { class: ['zl-timeline-item', i === 0 ? 'zl-timeline-now' : null] },
        h('span', { class: 'zl-timeline-dot', 'aria-hidden': 'true' }),
        h('div', { class: 'zl-timeline-body' },
          h('div', { class: 'zl-row zl-spread' },
            h('div', { class: 'zl-row' }, h('span', { class: 'code label' }, r.rev), i === 0 ? badge({ label: 'Latest', tone: 'neutral', outline: true }) : null, h('span', { class: 'caption zl-muted' }, when(r.createdAt))),
            h('div', { class: 'zl-row' }, show, S().Button({ label: `Restore ${r.rev}`, variant: 'ghost', size: 'sm', onClick: () => confirmDialog({
              title: `Restore ${r.rev}?`, body: `The run goes back to revision ${r.rev}. Its current state is saved first, so this can be undone.`, action: `Restore ${r.rev}`, keep: 'Keep the run as it is', tone: 'neutral', run: () => queue('restore', { target: r.rev }),
            }) }))),
          h('p', { class: 'body' }, r.request || (r.undoOf ? `Before the restore of ${r.undoOf}` : 'No request recorded')),
          holder));
    })));
  }

  // ---------------------------------------------------------------- files
  async function download(name) {
    const r = await api.blob(path`/api/runs/${run}/files/${name}`);
    if (!r.ok) { say('danger', `${name} could not be downloaded: ${r.error.message}`); return; }
    const url = URL.createObjectURL(r.data);
    const a = h('a', { href: url, download: name.split('/').pop() });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
  function files() {
    const preview = h('div', { class: 'zl-preview' });
    const groups = new Map();
    for (const f of detail.files) {
      const folder = f.name.includes('/') ? `${f.name.split('/')[0]}/` : 'Run folder';
      if (!groups.has(folder)) groups.set(folder, []);
      groups.get(folder).push(f);
    }
    const order = ['Run folder', 'source/', 'svg/', 'mermaid/', 'figjam/', 'drafts/'];
    const keys = [...groups.keys()].sort((a, b) => ((order.indexOf(a) + 1) || 99) - ((order.indexOf(b) + 1) || 99) || a.localeCompare(b));
    const columns = [
      { key: 'name', label: 'File', render: (f) => h('span', { class: 'code' }, f.name) },
      { key: 'size', label: 'Size', numeric: true, render: (f) => size(f.size) },
      { key: 'modified', label: 'Changed', muted: true, render: (f) => ago(f.modified) },
      { key: 'actions', label: 'Actions', render: (f) => h('div', { class: 'zl-row zl-row-tight' },
        S().Button({ label: `Preview ${f.name}`, variant: 'ghost', size: 'sm', iconOnly: true, icon: 'search', onClick: () => { replace(preview, h('div', { class: 'zl-row zl-spread' }, h('h3', { class: 'heading-sm' }, h('span', { class: 'code' }, f.name)), S().Button({ label: 'Close the preview', variant: 'ghost', size: 'sm', onClick: () => replace(preview) })), fileView({ run, name: f.name })); preview.scrollIntoView?.({ block: 'nearest' }); } }),
        S().Button({ label: 'Copy path', variant: 'ghost', size: 'sm', onClick: () => copyText(`diagrams/${run}/${f.name}`, (t) => say('warning', `The browser did not allow copying. The path is ${t}.`)).then((ok) => { if (ok) say('success', `Copied diagrams/${run}/${f.name}`); }) }),
        S().Button({ label: `Download ${f.name}`, variant: 'ghost', size: 'sm', iconOnly: true, icon: 'download', onClick: () => download(f.name) }),
        f.name.endsWith('.drawio') ? openIn(f.name, true) : null) },
    ];
    if (detail.files.length === 0) { replace(panel, h('p', { class: 'body zl-muted' }, 'This run has no files yet.')); return; }
    replace(panel, keys.map((k) => h('section', { class: 'zl-stack' }, h('h3', { class: 'eyebrow' }, `${k} · ${groups.get(k).length}`), S().Table({ columns, rows: groups.get(k), caption: `Files of diagrams/${run}${k === 'Run folder' ? '' : `/${k}`}`, dense: true }))), preview);
  }

  // ---------------------------------------------------------------- glossary
  async function glossaryCheck() {
    replace(panel, h('p', { class: 'body-sm zl-muted' }, 'Checking the labels against the confirmed terms'));
    const r = await api.get(`/api/glossary/check?run=${encodeURIComponent(run)}`);
    if (!r.ok) { replace(panel, S().Alert({ tone: 'danger', body: r.error.message })); return; }
    if (!r.data.ok) { replace(panel, S().Alert({ tone: 'neutral', title: 'Not checked', body: r.data.errors?.[0]?.message ?? 'The run could not be checked.', actions: [S().Button({ label: 'Open the glossary', variant: 'secondary', size: 'sm', href: '#/glossary' })] })); return; }
    replace(panel, findingsTable(r.data.report.findings), h('p', { class: 'caption zl-muted' }, 'Only confirmed entries are checked. A blocking finding is fixed like a validation error; a warning is listed in the report.'));
  }

  // ---------------------------------------------------------------- frame
  function showTab() {
    element.dataset.tab = current;
    if (current === 'picture') picture();
    else if (current === 'tables') tables();
    else if (current === 'history') history();
    else if (current === 'files') files();
    else if (current === 'glossary') glossaryCheck();
    else extraTabs[current]?.render({ panel, run, detail, queue, notice, diagram, onDiagram: (id) => { diagram = id; remember(); drawList(); } });
  }

  let composerElement = null;
  function reviseComposer() {
    const state = { request: '', preview: false };
    const send = S().Button({ label: 'Revise', variant: 'accent', round: true, iconOnly: true, icon: 'arrow-up', type: 'submit' });
    return h('form', { class: 'zl-composer', onSubmit: (e) => {
      e.preventDefault();
      if (!state.request.trim()) { say('warning', 'Write what should change, then revise.'); return; }
      queue('revise', { request: state.request.trim(), ...(state.preview ? { preview: true } : {}) }, () => { e.target.reset(); state.request = ''; });
    } },
    S().Input({ label: 'Revise this run', multiline: true, rows: 2, placeholder: 'Add a stock check after login', onInput: (e) => { state.request = e.target.value; } }),
    h('div', { class: 'zl-row zl-spread' }, S().Checkbox({ label: 'Show me drafts first', description: 'The agent asks you to pick a draft before it changes the run', onChange: (e) => { state.preview = e.target.checked; } }), send));
  }

  function staleBanner() {
    if (!detail.stale?.stale) return null;
    const changed = [...new Set(detail.stale.diagrams.flatMap((d) => d.changed))];
    const deleted = [...new Set(detail.stale.diagrams.flatMap((d) => d.deleted))];
    const since = detail.stale.diagrams.map((d) => d.recordedAt).filter(Boolean).sort()[0];
    const parts = [changed.length ? `Changed: ${changed.join(', ')}` : null, deleted.length ? `Deleted: ${deleted.join(', ')}` : null].filter(Boolean);
    return S().Alert({ tone: 'warning', title: 'Behind the code', body: `${parts.join('. ')}${since ? `. Drawn ${ago(since)}.` : '.'} Sync changes the diagrams by what the code changed.`, actions: [S().Button({ label: 'Sync with the code', variant: 'secondary', size: 'sm', onClick: () => queue('sync', {}) })] });
  }

  function header() {
    composerElement ??= reviseComposer();
    const composer = store.get().asking ? null : composerElement;
    const { undo, redo } = detail;
    const langs = (detail.variants ?? []).map((v) => v.lang);
    return h('header', { class: 'zl-page-header' },
      h('div', { class: 'eyebrow' }, [day(detail.date), ORIGIN[detail.origin]].filter(Boolean).join(' · ')),
      h('div', { class: 'zl-title-row' },
        h('h1', { class: 'display-md' }, detail.title),
        h('div', { class: 'zl-row' },
          S().Button({ label: undo ? `Undo to ${undo}` : 'Undo', variant: 'secondary', size: 'sm', disabled: !undo, onClick: () => queue('restore', { target: 'undo' }) }),
          S().Button({ label: redo ? `Redo ${redo}` : 'Redo', variant: 'secondary', size: 'sm', disabled: !redo, onClick: () => queue('restore', { target: 'redo' }) }),
          detail.scouted && !detail.stale?.stale ? S().Button({ label: 'Sync with the code', variant: 'secondary', size: 'sm', onClick: () => queue('sync', {}) }) : null,
          S().Button({ label: 'Export pictures', variant: 'secondary', size: 'sm', icon: 'download', onClick: exportPictures }),
          hasFile(combinedName()) ? openIn(combinedName()) : null)),
      h('div', { class: 'zl-row zl-meta' },
        h('span', { class: 'code zl-muted' }, `diagrams/${run}`),
        S().Button({ label: 'Copy path', variant: 'ghost', size: 'sm', onClick: () => copyText(`diagrams/${run}`, (t) => say('warning', `The browser did not allow copying. The path is ${t}.`)).then((ok) => { if (ok) say('success', `Copied diagrams/${run}`); }) }),
        h('span', { class: 'caption zl-muted' }, `${detail.diagrams.length} diagram${detail.diagrams.length === 1 ? '' : 's'} · ${detail.revisions.length} revision${detail.revisions.length === 1 ? '' : 's'}`),
        detail.targets.map((t) => badge({ label: targetLabel(t), outline: true })),
        langs.length ? badge({ label: `Also in ${langs.join(', ')}`, outline: true }) : null,
        detail.stale?.stale ? badge({ label: 'Behind the code', tone: 'warning' }) : null),
      composer, notice);
  }

  function switchTo(value) {
    current = value;
    remember();
    render();
  }

  function render() {
    if (!detail) { replace(element, h('div', { class: 'zl-page-header' }, h('div', { class: 'sn-skeleton zl-skeleton-title', 'aria-hidden': 'true' })), h('p', { class: 'body zl-muted' }, 'Reading the run')); return; }
    const ids = detail.diagrams.map((d) => d.id);
    if (!ids.includes(diagram)) diagram = ids[0];
    const tabList = S().Tabs({ items: tabs, value: current, panel: false, label: 'Views of this run', onChange: (v) => { current = v; remember(); drawList(); showTab(); } });
    element.dataset.asking = String(Boolean(store.get().asking));
    drawList();
    replace(element, header(), staleBanner(), h('div', { class: 'zl-run-body' }, listHolder, h('div', { class: 'zl-run-main' }, tabList, panel)));
    showTab();
  }

  async function load() {
    const r = await api.get(path`/api/runs/${run}`);
    if (!r.ok) {
      replace(element, h('div', { class: 'zl-empty zl-empty-hero' },
        h('p', { class: 'display-sm' }, r.status === 404 ? 'No such run' : 'This run could not be read'),
        h('p', { class: 'body zl-muted' }, r.status === 404 ? `Nothing named ${run} is under diagrams/. It may have been renamed or removed.` : r.error.message),
        S().Button({ label: 'All runs', variant: 'secondary', href: '#/diagrams' })));
      return;
    }
    detail = r.data;
    setCrumbs?.([{ label: detail.title }]);
    render();
  }

  render();
  load();
  // The request composer is hidden while a question card is open: one clay element in view.
  const unsubscribe = store.subscribe((s) => { if (detail && String(Boolean(s.asking)) !== element.dataset.asking) render(); });
  return {
    element,
    reload: load,
    title: run,
    dispose: unsubscribe,
    route: (parts) => { const t = parts[1]; if (detail && t && tabs.some((x) => x.value === t) && t !== current) { if (parts[2]) diagram = parts[2]; switchTo(t); } },
  };
}

