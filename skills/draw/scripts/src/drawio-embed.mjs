/**
 * draw.io on the web in embed mode, shared by the chat's opener page (`cli open`) and the labs
 * console. The diagram never travels in a URL: the embed page posts `{"event":"init"}` to the
 * window that framed or opened it, and that window answers with `{"action":"load","xml":...}`
 * by `postMessage`. On Save the page posts `{"event":"save","xml":...}`; the answer
 * `{"action":"status","modified":false}` clears its unsaved mark.
 *
 * This module is imported by the CLI and by the console's browser code, so it reads no
 * environment and imports nothing.
 */

/** The embed host draw.io asks embedders to use (app.diagrams.net warns that it will stop). */
export const EMBED_HOST = 'https://embed.diagrams.net';

/**
 * The embed host to use: the origin `ZUKAI_DRAWIO_EMBED` names (tests point it at a stand-in),
 * else `EMBED_HOST`. A value that is not an http(s) URL is ignored.
 * @param {Record<string, string | undefined>} env
 */
export function embedHostOf(env) {
  const value = env?.ZUKAI_DRAWIO_EMBED;
  if (!value) return EMBED_HOST;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : EMBED_HOST;
  } catch {
    return EMBED_HOST;
  }
}

/** The address of the embed page: JSON protocol, a spinner while it loads, Save without Exit. */
export const embedUrl = (host) => `${host}/?embed=1&proto=json&spin=1&noExitBtn=1&saveAndExit=0`;

/**
 * Bridge one embed window: answer its `init` with the diagram, report its `load`, and hand
 * each `save` on before clearing the unsaved mark. A message is taken only when it comes from
 * `win` and from the origin `host`; every other message is ignored. Returns a function that
 * stops listening.
 *
 * The opener page inlines this function's source, so it refers to nothing outside itself.
 * @param {Window} win the embed page's window (a frame's contentWindow or a popup)
 * @param {{ host: string, xml: string, title: string, onInit?: () => void, onLoad?: () => void, onSave?: (xml: string) => void, listenOn?: Window }} options
 */
export function embedBridge(win, { host, xml, title, onInit, onLoad, onSave, listenOn }) {
  const self = listenOn || window;
  const post = (message) => win.postMessage(JSON.stringify(message), host);
  const listener = (event) => {
    if (event.source !== win || event.origin !== host) return;
    let message;
    try {
      message = typeof event.data === 'string' ? JSON.parse(event.data) : null;
    } catch {
      return;
    }
    if (!message || typeof message !== 'object') return;
    if (message.event === 'init') {
      if (onInit) onInit();
      post({ action: 'load', xml, title, autosave: 0 });
    } else if (message.event === 'load') {
      if (onLoad) onLoad();
    } else if (message.event === 'save' && typeof message.xml === 'string') {
      if (onSave) onSave(message.xml);
      post({ action: 'status', modified: false });
    }
  };
  self.addEventListener('message', listener);
  return () => self.removeEventListener('message', listener);
}

/**
 * A script-safe JSON text: `<` written as `<`, so a label holding `</script>` or `<!--`
 * cannot end the block it sits in.
 */
export const scriptJson = (value) => JSON.stringify(value).replace(/[<\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

/** How long the opener page waits for the frame's `init` before it offers the popup. */
export const FRAME_WAIT_MS = 20_000;

const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * The opener page's own script: the frame first; after `wait` ms without `init`, a button
 * that opens the embed page as a popup (a click is the gesture a popup needs) beside a
 * download of the file. Save downloads the file under its title.
 */
function openerScript(bridgeSource) {
  return `(() => {
const embedBridge = (${bridgeSource});
const data = JSON.parse(document.getElementById('zukai-diagram').textContent);
const status = document.getElementById('status');
const bar = document.getElementById('bar');
const frame = document.getElementById('drawio');
const download = (xml) => {
  const url = URL.createObjectURL(new Blob([xml], { type: 'application/xml' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = data.title;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
};
const onSave = (xml) => { download(xml); status.textContent = 'Saved: ' + data.title + ' was downloaded. Put it in place of the run\\'s file to keep the change.'; };
let started = false;
const onInit = () => { started = true; bar.hidden = true; frame.hidden = false; };
const onLoad = () => { status.textContent = ''; };
embedBridge(frame.contentWindow, { host: data.host, xml: data.xml, title: data.title, onInit, onLoad, onSave });
setTimeout(() => {
  if (started) return;
  bar.hidden = false;
  frame.hidden = true;
}, data.wait);
document.getElementById('popup').addEventListener('click', () => {
  const win = window.open(data.url, 'zukai-drawio');
  if (!win) { status.textContent = 'The browser blocked the window. Allow pop-ups for this page, or download the file and open it in draw.io.'; return; }
  frame.remove();
  status.textContent = 'draw.io opens in another window.';
  embedBridge(win, { host: data.host, xml: data.xml, title: data.title, onLoad, onSave });
});
document.getElementById('download').addEventListener('click', () => download(data.xml));
})();`;
}

/**
 * The chat's opener page as one HTML string: a full-window frame of the embed page, the
 * diagram in a JSON block of its own, the bridge inlined, and a policy that allows the page's
 * one script (by its hash), frames of the embed host only and no connection.
 * @param {{ host: string, xml: string, title: string, wait?: number, sha256: (text: string) => string }} options
 *   `sha256` returns the base64 SHA-256 of a text (the CLI passes node:crypto's).
 */
export function openerPage({ host, xml, title, wait = FRAME_WAIT_MS, sha256 }) {
  const url = embedUrl(host);
  const script = openerScript(embedBridge.toString());
  const csp = [
    "default-src 'none'",
    `script-src 'sha256-${sha256(script)}'`,
    "style-src 'unsafe-inline'",
    `frame-src ${host}`,
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${escapeHtml(csp)}">
<meta name="referrer" content="no-referrer">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · draw.io</title>
<style>
html, body { margin: 0; height: 100%; font: 15px/1.5 system-ui, sans-serif; }
#drawio { position: fixed; inset: 0; width: 100%; height: 100%; border: 0; }
#bar { max-width: 40rem; margin: 15vh auto 0; padding: 0 16px; }
#bar[hidden], #drawio[hidden] { display: none; }
button { font: inherit; padding: 8px 14px; margin: 0 8px 8px 0; cursor: pointer; }
#status { position: fixed; left: 16px; bottom: 12px; margin: 0; padding: 4px 8px; background: rgba(255, 255, 255, 0.9); border-radius: 4px; }
#status:empty { display: none; }
</style>
</head>
<body>
<iframe id="drawio" title="draw.io" src="${escapeHtml(url)}" referrerpolicy="no-referrer"></iframe>
<div id="bar" hidden>
<h1>Open ${escapeHtml(title)} in draw.io</h1>
<p>draw.io did not start inside this page. Open it in its own window; the diagram is handed over to it there, never through the address.</p>
<button id="popup" type="button">Open in draw.io</button>
<button id="download" type="button">Download ${escapeHtml(title)}</button>
</div>
<p id="status" role="status"></p>
<script type="application/json" id="zukai-diagram">${scriptJson({ host, url, xml, title, wait })}</script>
<script>${script}</script>
</body>
</html>
`;
}
