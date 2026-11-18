/**
 * The console's hold on the Sienna design system: the copied files stay as they were copied,
 * the compiled tokens define every variable the stylesheets use in both themes, and the
 * console's own stylesheet writes out no colour or length that is not a token.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { compileTokens, definedVariables, usedVariables } from '../src/sienna-tokens.mjs';
import { uiFiles } from '../build.mjs';
import { scriptsDir } from './helpers.mjs';

const ui = join(scriptsDir, 'src', 'labs-ui');
const sienna = (name) => readFileSync(join(ui, 'sienna', name), 'utf8');
const tokens = JSON.parse(sienna('tokens.json'));
const compiled = compileTokens(tokens);

describe('Sienna in the console', () => {
  it('keeps the four copied files as the lock records them', () => {
    const lock = JSON.parse(sienna('sienna.lock.json'));
    expect(lock.version).toBe('1794980790-4acd');
    expect(Object.keys(lock.files).sort()).toEqual(['bundle.css', 'bundle.js', 'index.d.ts', 'tokens.json']);
    for (const [name, { sha256 }] of Object.entries(lock.files)) {
      expect(createHash('sha256').update(readFileSync(join(ui, 'sienna', name))).digest('hex'), name).toBe(sha256);
    }
  });

  it('compiles the tokens in the documented shape, both themes', () => {
    expect(compiled).toContain(':root, [data-theme="light"] {');
    expect(compiled).toContain('[data-theme="dark"] {');
    expect(compiled).toMatch(/\n:root \{\n {2}--space-1: 4px;/);
    expect(compiled).toContain('--font-sans: "Instrument Sans"');
    expect(compiled).toContain('--link: var(--info);');
    expect(compiled).toContain('.display-md {');
    const defined = definedVariables(compiled);
    for (const t of tokens.color.tokens.filter((x) => typeof x.value === 'object')) {
      expect(defined.light.has(`--${t.name}`), t.name).toBe(true);
      expect(defined.dark.has(`--${t.name}`), t.name).toBe(true);
    }
  });

  it('defines every variable that Sienna\'s stylesheet and the console\'s use', () => {
    const defined = definedVariables(compiled).all;
    for (const css of [sienna('bundle.css'), readFileSync(join(ui, 'app.css'), 'utf8')]) {
      const missing = [...usedVariables(css)].filter((v) => !defined.has(v));
      expect(missing).toEqual([]);
    }
  });

  it('writes out no colour or length in the console\'s own stylesheet beyond the named exceptions', () => {
    const css = readFileSync(join(ui, 'app.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    // Declarations outside the conditions of a media query, which cannot read a custom property.
    const declarations = [...css.matchAll(/([^{};]+)\{([^{}]*)\}/g)].flatMap((m) => m[2].split(';').map((d) => ({ selector: m[1].trim(), decl: d.trim() })).filter((d) => d.decl));
    const literal = /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|-?\d*\.?\d+(px|rem|em|pt|vw)\b/i;
    // 1px is the hairline width Sienna's own stylesheet writes (it has no token for a border
    // width); 100vh is the height of the window; the white ground of a picture is the one
    // colour that must not follow the theme, since a diagram is drawn for a white page.
    const allowed = (d) => /^border(-(left|right|top|bottom))?: 1px solid var\(--border\)$/.test(d.decl) || d.decl === 'min-height: 100vh' || (d.selector === '.zl-picture' && d.decl === 'background: #ffffff');
    const offenders = declarations.filter((d) => literal.test(d.decl.replace(/var\([^)]*\)/g, '')) && !allowed(d));
    expect(offenders).toEqual([]);
  });

  it('builds a stylesheet without the import from Google Fonts and a script that starts with Sienna', async () => {
    const files = await uiFiles();
    const css = files.get('app.css').toString('utf8');
    // The SVG namespace inside Sienna's data: pictures of checkboxes and selects fetches nothing.
    expect(css.replaceAll('http://www.w3.org/2000/svg', '')).not.toMatch(/@import|fonts\.googleapis|fonts\.gstatic|https?:\/\//);
    expect(css).toContain('font-family:"Newsreader"');
    expect(files.get('app.js').toString('utf8')).toContain('window.Sienna = window.Sienna || {};');
    for (const name of ['newsreader-latin-normal.woff2', 'instrument-sans-latin.woff2', 'jetbrains-mono-vietnamese.woff2', 'OFL-Newsreader.txt']) expect(files.has(`fonts/${name}`), name).toBe(true);
  });
});
