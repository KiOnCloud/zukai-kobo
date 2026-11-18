import { S } from '../sienna.mjs';
import { h } from '../dom.mjs';

/** A Sienna Badge with an optional icon before its words. */
export function badge({ label, tone, dot, outline, icon }) {
  const b = S().Badge({ label, tone, dot, outline });
  if (icon) b.insertBefore(S().icon(icon, 'sm'), b.firstChild);
  return b;
}

/** A block of plain text in the code style on a sunken ground: tables, bodies, reports. */
export const textBlock = (text, extra) => h('pre', { class: ['zl-block', 'code', extra] }, text ?? '');
