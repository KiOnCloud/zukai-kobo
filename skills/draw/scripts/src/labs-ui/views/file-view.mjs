/** A file of a run shown in place: draw.io pages and Mermaid in the viewer frame, text as text. */
import { S } from '../sienna.mjs';
import { h, replace } from '../dom.mjs';
import { api, path } from '../api.mjs';
import { viewerFrame } from '../viewer/frame.mjs';
import { textBlock } from './badge.mjs';

export function fileView({ run, name }) {
  const holder = h('div', { class: 'zl-stack' }, h('p', { class: 'body-sm zl-muted' }, `Opening ${name}`));
  const fallback = () => h('p', { class: 'body-sm zl-muted' }, `${name} could not be drawn here; download it from the Files tab.`);
  api.get(path`/api/runs/${run}/files/${name}/view`).then((r) => {
    if (!r.ok) { replace(holder, h('p', { class: 'body-sm zl-muted' }, `${name} can only be downloaded, from the Files tab.`)); return; }
    const v = r.data;
    if (v.kind === 'text') replace(holder, textBlock(v.text), v.cut ? h('p', { class: 'caption zl-muted' }, 'Only the beginning of the file is shown.') : null);
    else if (v.kind === 'mermaid') replace(holder, viewerFrame({ kind: 'mermaid', text: v.text, fallback }));
    else replace(holder, v.pages.map((p) => h('div', { class: 'zl-stack' }, h('p', { class: 'label' }, p.name), viewerFrame({ kind: 'drawio', text: p.text, fallback }))), v.more ? h('p', { class: 'caption zl-muted' }, `${v.more} more pages; download the file to see them.`) : null);
  });
  return holder;
}

/** A button that shows a file of a run below itself, once. */
export function showFileButton({ run, name, into }) {
  return S().Button({ label: `Show ${name}`, variant: 'ghost', size: 'sm', onClick: (e) => { e.currentTarget.disabled = true; replace(into, fileView({ run, name })); } });
}
