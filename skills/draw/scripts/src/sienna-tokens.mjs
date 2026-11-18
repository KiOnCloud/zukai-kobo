/**
 * The compiled `tokens.css` of the Sienna design system, made from its `tokens.json` in the
 * shape the design system documents:
 *
 *   :root, [data-theme="light"] { colours and shadows of the light theme, and every colour with one value }
 *   [data-theme="dark"]         { colours and shadows of the dark theme }
 *   :root                       { spacing, radius, size, and --font-serif, --font-sans, --font-mono }
 *   .display-xl { ... }         one class per type style
 *
 * A colour whose value is `{name}` is an alias of another token. Nothing here chooses a
 * value: every one comes from the file, so taking a newer Sienna is a copy and a rebuild.
 */

const themed = (value) => value !== null && typeof value === 'object';
const valueOf = (value) => (typeof value === 'string' && /^\{[a-z0-9-]+\}$/.test(value) ? `var(--${value.slice(1, -1)})` : value);

/** @param {object} tokens the parsed `tokens.json` @returns {string} CSS text */
export function compileTokens(tokens) {
  const light = [];
  const dark = [];
  const rest = [];
  for (const t of [...tokens.color.tokens, ...tokens.shadow.tokens]) {
    if (themed(t.value)) {
      light.push(`--${t.name}: ${valueOf(t.value.light)};`);
      dark.push(`--${t.name}: ${valueOf(t.value.dark)};`);
    } else light.push(`--${t.name}: ${valueOf(t.value)};`);
  }
  for (const group of ['spacing', 'radius', 'size']) for (const t of tokens[group].tokens) rest.push(`--${t.name}: ${t.value};`);
  for (const [key, stack] of Object.entries(tokens.type.families)) rest.push(`--font-${key}: ${stack};`);
  const block = (selector, lines) => `${selector} {\n${lines.map((l) => `  ${l}`).join('\n')}\n}\n`;
  const styles = tokens.type.groups.flatMap((g) => g.styles.map((s) => {
    const lines = [
      `font-family: var(--font-${g.family});`,
      `font-size: ${s.fontSize};`,
      `line-height: ${s.lineHeight};`,
      `font-weight: ${s.fontWeight};`,
      ...(s.letterSpacing ? [`letter-spacing: ${s.letterSpacing};`] : []),
      ...(s.fontStyle ? [`font-style: ${s.fontStyle};`] : []),
      ...(s.opticalSize ? [`font-variation-settings: "opsz" ${s.opticalSize};`] : []),
    ];
    return block(`.${s.name}`, lines);
  }));
  return [
    `/* Sienna tokens, compiled from tokens.json (${tokens.name} v${tokens.version}). */\n`,
    block(':root, [data-theme="light"]', light),
    block('[data-theme="dark"]', dark),
    block(':root', rest),
    ...styles,
  ].join('\n');
}

/** Every custom property a stylesheet defines, by theme block. */
export function definedVariables(css) {
  const out = { light: new Set(), dark: new Set(), all: new Set() };
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim();
    const names = [...m[2].matchAll(/(--[a-z0-9-]+)\s*:/g)].map((x) => x[1]);
    for (const n of names) {
      out.all.add(n);
      if (selector.includes('[data-theme="dark"]')) out.dark.add(n);
      else out.light.add(n);
    }
  }
  return out;
}

/** Every custom property a stylesheet uses. */
export const usedVariables = (css) => new Set([...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]));
