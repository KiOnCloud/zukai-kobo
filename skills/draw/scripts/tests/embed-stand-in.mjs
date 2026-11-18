/**
 * A stand-in for draw.io's embed host, served on 127.0.0.1: a page that speaks the embed
 * protocol as embed.diagrams.net does (trial of 2026-11-18). It posts `{"event":"init"}` to
 * its parent or opener, takes `{"action":"load"}` and shows one tab per page of the file,
 * posts `{"event":"load"}`, posts `{"event":"save","xml"}` when its Save button is pressed,
 * and records `{"action":"status"}`. The real host refuses headless browsers, so the tests
 * point ZUKAI_DRAWIO_EMBED at this one.
 *
 * `refuseFrame` makes the page stay silent inside a frame, as a host that cannot be framed
 * would look to the opener page; opened as a popup it answers.
 */
import { createServer } from 'node:http';

const PAGE = (refuseFrame) => `<!doctype html>
<html><head><meta charset="utf-8"><title>draw.io stand-in</title></head>
<body>
<div id="title"></div>
<div id="tabs"></div>
<button id="save" type="button">Save</button>
<script>
const peer = window.opener || (window.parent !== window ? window.parent : null);
const framed = !window.opener && window.parent !== window;
window.received = [];
let xml = null;
window.addEventListener('message', (event) => {
  if (event.source !== peer) return;
  let message;
  try { message = JSON.parse(event.data); } catch { return; }
  window.received.push({ action: message.action, origin: event.origin });
  if (message.action === 'load') {
    xml = message.xml;
    document.getElementById('title').textContent = message.title;
    const names = [...xml.matchAll(/<diagram\\b[^>]*?\\bname="([^"]*)"/g)].map((m) => m[1]);
    const tabs = document.getElementById('tabs');
    for (const name of names) { const tab = document.createElement('span'); tab.className = 'tab'; tab.textContent = name; tabs.appendChild(tab); }
    document.body.dataset.modified = 'true';
    peer.postMessage(JSON.stringify({ event: 'load' }), '*');
  } else if (message.action === 'status') {
    document.body.dataset.modified = String(message.modified);
  }
});
document.getElementById('save').addEventListener('click', () => peer.postMessage(JSON.stringify({ event: 'save', xml }), '*'));
if (peer && !(${refuseFrame} && framed)) peer.postMessage(JSON.stringify({ event: 'init' }), '*');
</script>
</body></html>
`;

/**
 * Start the stand-in. Resolves to `{ host, close }`, `host` being its origin.
 * @param {{ refuseFrame?: boolean }} [options]
 */
export function embedStandIn({ refuseFrame = false } = {}) {
  const server = createServer((req, res) => {
    if (req.method !== 'GET' || !req.url.startsWith('/?embed=1')) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(PAGE(refuseFrame));
  });
  return new Promise((done) => server.listen(0, '127.0.0.1', () => done({ host: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((closed) => server.close(closed)) })));
}
