/**
 * Open in draw.io: draw.io on the web opens in a window of its own, from the click (the
 * gesture a popup needs), and the file comes to it by `postMessage` through the same bridge as
 * the chat's opener page. The console's own page and policy stay as they are: the popup is a
 * navigation of a new window, and the console takes a message only from that window and only
 * from the embed host's origin. Save downloads the file; changing the run stays a job.
 */
import { S } from '../sienna.mjs';
import { h, replace } from '../dom.mjs';
import { api, path } from '../api.mjs';
import { EMBED_HOST, embedUrl, embedBridge } from '../../drawio-embed.mjs';

const WAIT_MS = 60_000;

/** The origin of the embed page, as the server names it in its state. */
export const embedOf = (store) => store?.get().state?.drawio?.embed ?? EMBED_HOST;

function downloadText(text, name) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/xml' }));
  const a = h('a', { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Open one file of a run in draw.io on the web. Every outcome but a quiet success is said in
 * `notice`. Returns the function that stops listening, or null when nothing was opened.
 * @param {{ run: string, name: string, embed: string, notice: HTMLElement, wait?: number, win?: Window }} options
 */
export function openInDrawio({ run, name, embed, notice, wait = WAIT_MS, win = window }) {
  const title = name.split('/').pop();
  const popup = win.open(embedUrl(embed), '_blank');
  if (!popup) {
    replace(notice, S().Alert({ tone: 'warning', title: 'The browser blocked the draw.io window', body: 'Allow pop-ups for this console (the address bar shows the blocked window), then choose Open in draw.io again.' }));
    return null;
  }
  replace(notice);
  const file = api.blob(path`/api/runs/${run}/files/${name}`).then((r) => (r.ok ? r.data.text() : Promise.reject(r.error)));
  let started = false;
  let stop = () => {};
  const timer = setTimeout(() => {
    if (started) return;
    stop();
    replace(notice, S().Alert({ tone: 'warning', title: 'draw.io did not answer', body: `The draw.io window did not start within a minute. Check the network, or download ${title} from Files and open it in draw.io.` }));
  }, wait);
  file.catch((error) => {
    clearTimeout(timer);
    stop();
    popup.close();
    replace(notice, S().Alert({ tone: 'danger', body: `${title} could not be read: ${error?.message ?? 'the server did not send it'}.` }));
  });
  stop = embedBridge(popup, {
    host: embed,
    xml: file,
    title,
    listenOn: win,
    onInit: () => { started = true; clearTimeout(timer); },
    onSave: (xml) => {
      downloadText(xml, title);
      replace(notice, S().Alert({ tone: 'info', title: `${title} was downloaded`, body: `To change the run with it, put it in place of diagrams/${run}/${name}; the next revise reads the difference as a hand edit.` }));
    },
  });
  return stop;
}

/** The button: secondary by default, a ghost icon button inside a table row. */
export function openButton({ run, name, store, notice, compact = false }) {
  const title = name.split('/').pop();
  const onClick = () => openInDrawio({ run, name, embed: embedOf(store), notice });
  return compact
    ? S().Button({ label: `Open ${title} in draw.io`, variant: 'ghost', size: 'sm', iconOnly: true, icon: 'external', onClick })
    : S().Button({ label: 'Open in draw.io', variant: 'secondary', icon: 'external', onClick });
}
