/** The Picture tab for a diagram without a fresh picture under svg/: drawn in the viewer frame. */
import { S } from '../sienna.mjs';
import { h, replace } from '../dom.mjs';
import { api, path } from '../api.mjs';
import { viewerFrame } from '../viewer/frame.mjs';

export function livePicture({ run, diagram, onExport, onTables }) {
  const holder = h('div', { class: 'zl-stack' }, h('p', { class: 'body-sm zl-muted' }, 'Drawing the diagram'));
  const fallback = () => h('div', { class: 'zl-empty' },
    h('p', { class: 'display-sm' }, 'This diagram could not be drawn here'),
    h('p', { class: 'body zl-muted' }, 'The viewer needs the network, and it gives up after a minute. Export the pictures, or read the diagram as tables.'),
    h('div', { class: 'zl-row' }, S().Button({ label: 'Export pictures', variant: 'secondary', onClick: onExport }), S().Button({ label: 'Show the tables', variant: 'ghost', onClick: onTables })));
  api.get(path`/api/runs/${run}/diagrams/${diagram}/picture`).then((r) => {
    if (!r.ok) { replace(holder, fallback()); return; }
    replace(holder, viewerFrame({ kind: r.data.kind, text: r.data.text, fallback }), h('p', { class: 'caption zl-muted' }, 'Drawn in a sealed frame by the draw.io viewer or Mermaid, loaded from their sites. The frame can reach no other site; the draw.io viewer may fetch its shape files from viewer.diagrams.net.'));
  });
  return holder;
}
