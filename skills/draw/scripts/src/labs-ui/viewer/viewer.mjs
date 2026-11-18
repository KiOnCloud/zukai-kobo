/**
 * The page inside the viewer frame. It runs sandboxed, with an origin of its own and no way to
 * open a connection, so neither it nor the third-party renderer it loads can read the token,
 * call the console's API or send the diagram anywhere. It takes a message only from its
 * parent, draws what it is given and replies with the size of the drawing or an error.
 */

const DRAWIO = 'https://viewer.diagrams.net/js/viewer-static.min.js';
const MERMAID = 'https://cdn.jsdelivr.net/npm/mermaid@12.3.0/dist/mermaid.esm.min.mjs';
const drawing = document.getElementById('drawing');

let drawioReady;
function loadDrawio() {
  drawioReady ??= new Promise((done, failed) => {
    const script = document.createElement('script');
    script.src = DRAWIO;
    script.onload = () => (typeof globalThis.GraphViewer === 'function' ? done() : failed(new Error('the draw.io viewer did not start')));
    script.onerror = () => failed(new Error('the draw.io viewer could not be loaded'));
    document.head.appendChild(script);
  });
  return drawioReady;
}

/**
 * Drawn as `export` draws: the viewer works in a block of its own (it lays out nothing in a
 * box without width), then its SVG of the whole page is what the frame shows.
 */
async function drawDrawio(xml) {
  await loadDrawio();
  const work = document.createElement('div');
  work.className = 'work';
  work.setAttribute('data-mxgraph', JSON.stringify({ xml, nav: false, toolbar: null, lightbox: false, highlight: 'none', resize: false, 'auto-fit': false }));
  document.body.appendChild(work);
  try {
    const viewer = await new Promise((done) => { globalThis.GraphViewer.createViewerForElement(work, done); });
    // Shapes of a stencil library arrive after the first paint.
    await new Promise((done) => { setTimeout(done, 400); });
    const svg = viewer.graph.getSvg('#ffffff', 1, 20, false, null, true, true, null, null, false, null, 'light', 'diagram');
    drawing.replaceChildren(document.importNode(svg, true));
  } finally {
    work.remove();
  }
}

async function drawMermaid(text) {
  const { default: mermaid } = await import(MERMAID);
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default' });
  const { svg } = await mermaid.render(`m${Date.now()}`, text);
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  drawing.replaceChildren(document.importNode(doc.documentElement, true));
}

window.addEventListener('message', async (event) => {
  if (event.source !== window.parent) return;
  const { kind, text, seq } = event.data ?? {};
  if ((kind !== 'drawio' && kind !== 'mermaid') || typeof text !== 'string') return;
  try {
    if (kind === 'drawio') await drawDrawio(text);
    else await drawMermaid(text);
    const box = drawing.getBoundingClientRect();
    window.parent.postMessage({ seq, ok: true, width: Math.ceil(box.width), height: Math.ceil(box.height) }, '*');
  } catch (error) {
    window.parent.postMessage({ seq, ok: false, error: String(error?.message ?? error).slice(0, 300) }, '*');
  }
});
window.parent.postMessage({ ready: true }, '*');
