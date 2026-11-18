/**
 * Line-drawn glyphs for the diagram kinds, the targets and the inputs of a new diagram. Every
 * shape is written here; no glyph takes anything from the server but the name it is looked up
 * by, and an unknown name draws the "agent decides" glyph.
 */

const NS = 'http://www.w3.org/2000/svg';

// [tag, attributes] on a 48 × 32 grid, drawn in currentColor.
const SHAPES = {
  sequence: [
    ['rect', { x: 5, y: 2, width: 14, height: 6, rx: 1.5 }], ['rect', { x: 29, y: 2, width: 14, height: 6, rx: 1.5 }],
    ['path', { d: 'M12 8v22M36 8v22', 'stroke-dasharray': '2 2.5' }],
    ['path', { d: 'M12 14h23M32 11.5l3 2.5-3 2.5' }], ['path', { d: 'M36 23H13M16 20.5 13 23l3 2.5' }],
  ],
  flowchart: [
    ['rect', { x: 17, y: 1.5, width: 14, height: 6, rx: 3 }], ['path', { d: 'M24 7.5v3' }],
    ['path', { d: 'M24 10.5 31 16l-7 5.5-7-5.5z' }], ['path', { d: 'M24 21.5v3M31 16h6v8.5' }],
    ['rect', { x: 17, y: 24.5, width: 14, height: 6, rx: 1.5 }], ['rect', { x: 33, y: 24.5, width: 10, height: 6, rx: 1.5 }],
  ],
  activity: [
    ['circle', { cx: 24, cy: 3.5, r: 2, fill: 'currentColor' }], ['path', { d: 'M24 5.5v3' }],
    ['rect', { x: 15, y: 8.5, width: 18, height: 6, rx: 3 }], ['path', { d: 'M24 14.5v3' }],
    ['path', { d: 'M11 18h26', 'stroke-width': 2.5 }], ['path', { d: 'M15 18v4M33 18v4' }],
    ['rect', { x: 7, y: 22, width: 16, height: 6, rx: 3 }], ['rect', { x: 25, y: 22, width: 16, height: 6, rx: 3 }],
  ],
  state: [
    ['circle', { cx: 4, cy: 16, r: 2, fill: 'currentColor' }], ['path', { d: 'M6 16h3' }],
    ['rect', { x: 9, y: 10, width: 13, height: 12, rx: 4 }], ['rect', { x: 30, y: 10, width: 13, height: 12, rx: 4 }],
    ['path', { d: 'M22 13.5h8M27.5 11l2.5 2.5-2.5 2.5' }], ['path', { d: 'M30 18.5h-8M24.5 16 22 18.5l2.5 2.5' }],
  ],
  er: [
    ['rect', { x: 2, y: 6, width: 15, height: 20, rx: 1.5 }], ['path', { d: 'M2 11h15M5 15h7M5 19h9' }],
    ['rect', { x: 31, y: 6, width: 15, height: 20, rx: 1.5 }], ['path', { d: 'M31 11h15M34 15h7M34 19h9' }],
    ['path', { d: 'M17 16h14M20 13v6M27 16l4-3.5M27 16l4 3.5' }],
  ],
  class: [
    ['rect', { x: 14, y: 1.5, width: 20, height: 29, rx: 1.5 }], ['path', { d: 'M14 9h20M14 19h20' }],
    ['path', { d: 'M18 13h10M18 23h12M18 26.5h8' }], ['path', { d: 'M20 5.5h8', 'stroke-width': 2 }],
  ],
  architecture: [
    ['rect', { x: 4, y: 2, width: 40, height: 7, rx: 1.5 }], ['path', { d: 'M15 9v4M33 9v4' }],
    ['rect', { x: 4, y: 13, width: 18, height: 7, rx: 1.5 }], ['rect', { x: 26, y: 13, width: 18, height: 7, rx: 1.5 }],
    ['path', { d: 'M24 20v3M17 24.5c0-1.5 3-2.5 7-2.5s7 1 7 2.5v3.5c0 1.5-3 2.5-7 2.5s-7-1-7-2.5z' }],
  ],
  usecase: [
    ['circle', { cx: 8, cy: 6, r: 3 }], ['path', { d: 'M8 9v10M3 13h10M8 19l-4 8M8 19l4 8' }],
    ['rect', { x: 18, y: 2, width: 28, height: 28, rx: 2, 'stroke-dasharray': '2 2.5' }],
    ['ellipse', { cx: 32, cy: 11, rx: 10, ry: 4.5 }], ['ellipse', { cx: 32, cy: 22, rx: 10, ry: 4.5 }], ['path', { d: 'M13 13l9-1.5' }],
  ],
  drawio: [
    ['rect', { x: 4, y: 6, width: 16, height: 10, rx: 2 }], ['rect', { x: 28, y: 16, width: 16, height: 10, rx: 2 }],
    ['path', { d: 'M20 11h4v10h4' }], ['path', { d: 'M3 5h2M43 15h2M43 27h2M27 27h2', 'stroke-width': 2.5 }],
  ],
  mermaid: [
    ['path', { d: 'M5 6h22M9 12h18M9 18h26M9 24h14' }], ['path', { d: 'M31 9l6 3-6 3', 'stroke-width': 1.5 }],
    ['path', { d: 'M5 12v12', 'stroke-dasharray': '1.5 2' }],
  ],
  figjam: [
    ['rect', { x: 3, y: 3, width: 42, height: 26, rx: 3 }], ['rect', { x: 8, y: 8, width: 10, height: 10, rx: 1 }],
    ['rect', { x: 22, y: 12, width: 10, height: 10, rx: 1 }], ['path', { d: 'M35 22c2-3 4-6 6-6M18 13h4' }],
  ],
  clarify: [
    ['rect', { x: 10, y: 2, width: 28, height: 28, rx: 2 }], ['path', { d: 'M15 9h18M15 14h18M15 19h12M15 24h8' }],
  ],
  scout: [
    ['path', { d: 'M17 8l-9 8 9 8M31 8l9 8-9 8M27 5l-6 22' }],
  ],
  brainstorm: [
    ['path', { d: 'M24 3a9 9 0 0 1 5 16.5V23h-10v-3.5A9 9 0 0 1 24 3z' }], ['path', { d: 'M20 27h8M22 30h4' }],
    ['path', { d: 'M8 12h3M37 12h3M12 4l2 2M36 4l-2 2' }],
  ],
  auto: [
    ['rect', { x: 8, y: 3, width: 32, height: 26, rx: 3, 'stroke-dasharray': '2.5 2.5' }],
    ['path', { d: 'M20 12.5a4 4 0 1 1 6 3.4c-1.4.8-2 1.6-2 3.1' }], ['circle', { cx: 24, cy: 23, r: 0.6, fill: 'currentColor' }],
  ],
};

/**
 * @param {string} name a kind, a target, an input, or anything else for the "agent decides" glyph
 * @param {{ label?: string, size?: 'sm' | 'md' | 'lg' }} [options] a label makes it an image with that name; without one it is hidden from a screen reader
 */
export function glyph(name, { label, size = 'md' } = {}) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 48 32');
  svg.setAttribute('class', `zl-glyph zl-glyph-${size}`);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.5');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  if (label) { svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', label); } else svg.setAttribute('aria-hidden', 'true');
  for (const [tag, attrs] of SHAPES[name] ?? SHAPES.auto) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    svg.appendChild(el);
  }
  return svg;
}

export const hasGlyph = (name) => Object.hasOwn(SHAPES, name);
