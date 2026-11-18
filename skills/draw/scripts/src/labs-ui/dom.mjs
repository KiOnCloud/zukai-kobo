/**
 * Layout elements for the console: `h(tag, props, ...children)`. Text from the server goes in
 * as text nodes only; there is no way to set HTML, a style or an event from data. A link
 * address is accepted only when the console built it: a route of its own (`#/...`) or a blob
 * URL it made for a download.
 */

const SAFE_ATTR = /^(id|role|tabindex|title|for|name|type|value|placeholder|rows|hidden|disabled|download|lang|dir|aria-[a-z-]+|data-[a-z-]+)$/;

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

/** A file size in bytes or kilobytes. */
export const size = (n) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`);
