/**
 * The page inside the report frame. It runs sandboxed, with an origin of its own and no way to
 * fetch anything (its policy allows its own script, inline styles and `data:` pictures only),
 * so a report or a template cannot read the console's token, call its API or send anything
 * anywhere. It takes a message only from its parent: `show` puts a report's HTML in place of
 * its own page, with every link made inert (no navigation; the address is shown on hover and
 * an in-page link scrolls), and `print` opens the print dialog for the report alone.
 */

const DROP = 'script, iframe, frame, object, embed, base, form, link, meta[http-equiv], audio, video, source, track, portal, applet';

function show(html, seq) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const node of doc.querySelectorAll(DROP)) node.remove();
  for (const el of doc.querySelectorAll('*')) {
    for (const attr of [...el.attributes]) if (/^on/i.test(attr.name) || attr.name === 'srcdoc') el.removeAttribute(attr.name);
  }
  for (const a of doc.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href') ?? '';
    a.removeAttribute('href');
    a.setAttribute('title', href);
    a.setAttribute('data-inert-link', '');
    if (href.startsWith('#')) a.setAttribute('data-anchor', href.slice(1));
  }
  const style = doc.createElement('style');
  style.textContent = 'a[data-inert-link] { cursor: help; text-decoration: underline dotted; } @media print { a[data-inert-link] { text-decoration: none; } }';
  doc.head.appendChild(style);
  document.replaceChild(document.adoptNode(doc.documentElement), document.documentElement);
  // The height once the styles apply; a timer, since a frame out of view may get no animation frame.
  setTimeout(() => {
    const height = Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0);
    window.parent.postMessage({ type: 'shown', seq, height }, '*');
  }, 50);
}

document.addEventListener('click', (event) => {
  const a = event.target instanceof Element ? event.target.closest('a') : null;
  if (!a) return;
  event.preventDefault();
  const id = a.getAttribute('data-anchor');
  if (id) document.getElementById(id)?.scrollIntoView({ block: 'start' });
});

window.addEventListener('message', (event) => {
  if (event.source !== window.parent) return;
  const data = event.data ?? {};
  if (data.type === 'print') { window.print(); return; }
  if (data.type !== 'show' || typeof data.html !== 'string') return;
  try {
    show(data.html, data.seq);
  } catch (error) {
    window.parent.postMessage({ type: 'failed', seq: data.seq, error: String(error?.message ?? error).slice(0, 300) }, '*');
  }
});

window.parent.postMessage({ type: 'ready' }, '*');
