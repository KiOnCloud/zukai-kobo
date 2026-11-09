import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const scriptsDir = join(dirname(fileURLToPath(import.meta.url)), '..');
export const fixturesDir = join(scriptsDir, 'fixtures');
export const repoRoot = join(scriptsDir, '..', '..', '..');

export function loadFixture(kind, name) {
  return JSON.parse(readFileSync(join(fixturesDir, kind, `${name}.json`), 'utf8'));
}

/** Every fixture as { kind, name, ir }, deterministic order. */
export function allFixtures() {
  const out = [];
  for (const kind of readdirSync(fixturesDir).sort()) {
    for (const file of readdirSync(join(fixturesDir, kind)).sort()) {
      if (!file.endsWith('.json')) continue;
      out.push({ kind, name: file.replace(/\.json$/, ''), ir: loadFixture(kind, file.replace(/\.json$/, '')) });
    }
  }
  return out;
}

export const validFixtures = () => allFixtures().filter((f) => !f.name.startsWith('invalid'));
export const invalidFixtures = () => allFixtures().filter((f) => f.name.startsWith('invalid'));

/** Mermaid needs browser globals before import; import once per process. */
let mermaidPromise;
export function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = (async () => {
      const { JSDOM } = await import('jsdom');
      const dom = new JSDOM('<!DOCTYPE html><body></body>');
      globalThis.window = dom.window;
      globalThis.document = dom.window.document;
      globalThis.DOMParser = dom.window.DOMParser;
      return (await import('mermaid')).default;
    })();
  }
  return mermaidPromise;
}
