/**
 * Layout elements for the console: `h(tag, props, ...children)`. Text from the server goes in
 * as text nodes only; there is no way to set HTML, a style or an event from data. A link
 * address is accepted only when the console built it: a route of its own (`#/...`) or a blob
 * URL it made for a download.
 */

const SAFE_ATTR = /^(id|role|tabindex|title|for|name|type|value|placeholder|rows|hidden|disabled|checked|open|datetime|maxlength|autocomplete|download|lang|dir|aria-[a-z-]+|data-[a-z-]+)$/;

export function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = Array.isArray(value) ? value.filter(Boolean).join(' ') : value;
    else if (key === 'text') node.textContent = String(value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'href') {
      if (typeof value === 'string' && (value.startsWith('#/') || value.startsWith('blob:'))) node.setAttribute('href', value);
    } else if (SAFE_ATTR.test(key)) node.setAttribute(key, value === true ? '' : String(value));
  }
  append(node, children);
  return node;
}

/** Append children: nodes as they are, anything else as text. */
export function append(node, children) {
  for (const c of children.flat(Infinity)) {
    if (c === undefined || c === null || c === false) continue;
    node.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

/** Replace every child of a node. */
export function replace(node, ...children) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return append(node, children);
}

/** A date written out in the reader's locale. */
export function when(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** How long ago, in words: "just now", "4 min ago", "3 h ago", or the date past a day. */
export function ago(iso, now = Date.now()) {
  const t = Date.parse(iso ?? '');
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString(undefined, { dateStyle: 'medium' });
}

/** The time between two instants, in words: "42 s", "3 min 5 s", "1 h 12 min". */
export function duration(fromIso, toIso, now = Date.now()) {
  const a = Date.parse(fromIso ?? '');
  const b = toIso ? Date.parse(toIso) : now;
  if (Number.isNaN(a) || Number.isNaN(b)) return '';
  const s = Math.max(0, Math.round((b - a) / 1000));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ''}`;
  return `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`;
}

/** A date of a run folder (YYYY-MM-DD) in the reader's locale, without a time. */
export const day = (date) => (date ? when(`${date}T00:00:00`).split(',')[0] : '');

/** Copy a text; says on failure through `onFail` with the text, so the reader can copy it by hand. */
export function copyText(text, onFail) {
  const p = navigator.clipboard?.writeText(text);
  if (!p) { onFail?.(text); return Promise.resolve(false); }
  return p.then(() => true, () => { onFail?.(text); return false; });
}

/** A file size in bytes or kilobytes. */
export const size = (n) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`);
