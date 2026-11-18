/**
 * The console's side of the report frame: a fresh sandboxed frame of `report-frame.html` for
 * each document shown (a report, a translation, a template preview). The HTML is posted only
 * to that frame's window, after its own `ready`; replies of any other window are ignored. The
 * frame has an opaque origin and holds no token; `allow-modals` lets it print.
 */
import { h } from '../dom.mjs';

let seq = 0;

/**
 * @param {{ html: string, title?: string }} options
 * @returns {{ element: HTMLElement, print: () => boolean }}
 */
export function reportFrame({ html, title = 'Report' }) {
  const holder = h('figure', { class: 'zl-report-frame' });
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-scripts allow-modals');
  frame.setAttribute('title', title);
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.className = 'zl-frame zl-frame-report';
  frame.src = 'report-frame.html';
  const mine = ++seq;
  let ready = false;
  function onMessage(event) {
    // Only the frame this view made may answer; any other window is ignored.
    if (event.source !== frame.contentWindow) return;
    const data = event.data ?? {};
    if (data.type === 'ready') { ready = true; frame.contentWindow.postMessage({ type: 'show', html, seq: mine }, '*'); return; }
    if (data.type === 'shown' && data.seq === mine) frame.style.height = `${Math.max(240, Math.min(20000, Number(data.height) || 0) + 16)}px`;
  }
  window.addEventListener('message', onMessage);
  holder.appendChild(frame);
  return {
    element: holder,
    /** Ask the frame to print the report; false while the frame is not ready. */
    print() {
      if (!ready || !frame.contentWindow) return false;
      frame.contentWindow.postMessage({ type: 'print' }, '*');
      return true;
    },
    dispose() { window.removeEventListener('message', onMessage); },
  };
}
