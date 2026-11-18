/**
 * The parent side of the viewer frame: a sandboxed frame of `viewer.html`, the diagram posted
 * to it, and its reply taken only from that frame's window. A frame that has not drawn after
 * 60 seconds is replaced by a sentence and what still works.
 */
import { h, replace } from '../dom.mjs';

const WAIT_MS = 60_000;
let seq = 0;

/**
 * @param {{ kind: 'drawio' | 'mermaid', text: string, fallback: () => Node, wait?: number }} options
 * @returns {HTMLElement} the figure that holds the frame, or the fallback once it gave up
 */
export function viewerFrame({ kind, text, fallback, wait = WAIT_MS }) {
  const holder = h('figure', { class: 'zl-picture zl-picture-live' });
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.setAttribute('title', 'Diagram drawn by the draw.io viewer');
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.className = 'zl-frame';
  frame.src = 'viewer.html';
  const mine = ++seq;
  let settled = false;
  const giveUp = () => {
    if (settled) return;
    settled = true;
    window.removeEventListener('message', onMessage);
    replace(holder, fallback());
  };
  const timer = setTimeout(giveUp, wait);
  function onMessage(event) {
    // Only the frame this figure made may answer; any other window is ignored.
    if (event.source !== frame.contentWindow) return;
    const data = event.data ?? {};
    if (data.ready) { frame.contentWindow.postMessage({ kind, text, seq: mine }, '*'); return; }
    if (data.seq !== mine) return;
    clearTimeout(timer);
    if (!data.ok) { giveUp(); return; }
    settled = true;
    window.removeEventListener('message', onMessage);
    frame.style.height = `${Math.max(120, Math.min(4000, Number(data.height) || 0) + 8)}px`;
    frame.style.width = `${Math.max(200, Math.min(8000, Number(data.width) || 0) + 8)}px`;
  }
  window.addEventListener('message', onMessage);
  holder.appendChild(frame);
  return holder;
}
