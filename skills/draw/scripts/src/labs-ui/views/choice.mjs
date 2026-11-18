/**
 * Choice controls the console needs beyond Sienna's: tiles (a radio group of large options
 * with a glyph and a sentence), a segmented radio group, and toggle chips over checkboxes.
 * Each is native inputs in a fieldset, so the keyboard and a screen reader work as for any
 * radio or checkbox; the input lies over its whole tile, transparent, and takes the click.
 */
import { h } from '../dom.mjs';
import { glyph } from './glyphs.mjs';

let uid = 0;

/**
 * @param {{ legend: string, hint?: string, name?: string, value?: string, columns?: 'two' | 'three' | 'four',
 *   options: Array<{ value: string, label: string, description?: string, glyph?: string, auto?: boolean }>,
 *   onChange: (value: string) => void }} props
 */
export function choiceTiles({ legend, hint, name = `tiles-${++uid}`, value = '', options, columns = 'three', onChange }) {
  return h('fieldset', { class: 'zl-choice' },
    h('legend', { class: 'label zl-choice-legend' }, legend),
    hint ? h('p', { class: 'body-sm zl-muted' }, hint) : null,
    h('div', { class: ['zl-tiles', `zl-tiles-${columns}`] }, options.map((o) => {
      const input = h('input', { type: 'radio', class: 'zl-tile-input', name, value: o.value, checked: o.value === value, onChange: (e) => { if (e.target.checked) onChange(o.value); } });
      return h('label', { class: ['zl-tile', o.auto ? 'zl-tile-auto' : null] },
        input,
        o.glyph ? h('span', { class: 'zl-tile-glyph' }, glyph(o.glyph)) : null,
        h('span', { class: 'zl-tile-text' },
          h('span', { class: 'label' }, o.label),
          o.description ? h('span', { class: 'caption zl-muted' }, o.description) : null));
    })));
}

/**
 * @param {{ legend: string, name?: string, value?: string, options: Array<{ value: string, label: string, auto?: boolean }>, onChange: (value: string) => void }} props
 */
export function segmented({ legend, name = `segment-${++uid}`, value = '', options, onChange }) {
  return h('fieldset', { class: 'zl-choice' },
    h('legend', { class: 'label zl-choice-legend' }, legend),
    h('div', { class: 'zl-segment' }, options.map((o) => h('label', { class: ['zl-segment-item', o.auto ? 'zl-segment-auto' : null] },
      h('input', { type: 'radio', class: 'zl-tile-input', name, value: o.value, checked: o.value === value, onChange: (e) => { if (e.target.checked) onChange(o.value); } }),
      h('span', { class: 'label' }, o.label)))));
}

/**
 * @param {{ legend: string, hint?: string, values: string[], options: Array<{ value: string, label: string, lang?: string }>, onChange: (values: string[]) => void }} props
 */
export function toggleChips({ legend, hint, values, options, onChange }) {
  let picked = [...values];
  return h('fieldset', { class: 'zl-choice' },
    h('legend', { class: 'label zl-choice-legend' }, legend),
    hint ? h('p', { class: 'body-sm zl-muted' }, hint) : null,
    h('div', { class: 'zl-row' }, options.map((o) => h('label', { class: 'zl-toggle' },
      h('input', { type: 'checkbox', class: 'zl-tile-input', value: o.value, checked: picked.includes(o.value), onChange: (e) => {
        picked = e.target.checked ? [...picked, o.value] : picked.filter((x) => x !== o.value);
        onChange(options.map((x) => x.value).filter((v) => picked.includes(v)));
      } }),
      h('span', { class: 'zl-toggle-mark', 'aria-hidden': 'true' }),
      h('span', { class: 'label', lang: o.lang }, o.label)))));
}
