import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { bundleText, uiFiles, uiOut } from '../build.mjs';
import { scriptsDir } from './helpers.mjs';

const bundlePath = join(scriptsDir, 'bin', 'cli.mjs');

describe('committed bundle', () => {
  it('matches a fresh build of src byte for byte (run `npm run build` when this fails)', async () => {
    const committed = readFileSync(bundlePath, 'utf8');
    expect(committed).toBe(await bundleText());
  }, 60_000);

  it('stays under the size budget and uses LF line endings', () => {
    expect(statSync(bundlePath).size).toBeLessThan(3 * 1024 * 1024);
    expect(readFileSync(bundlePath, 'utf8')).not.toMatch(/\r/);
  });
});

/** Every file under a folder, as paths relative to it with `/` between parts. */
const filesUnder = (dir) => readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => relative(dir, join(e.parentPath ?? e.path, e.name)).split('\\').join('/')).sort();

describe('committed console pages', () => {
  it('match a fresh build of src/labs-ui byte for byte, with no file more or less (run `npm run build` when this fails)', async () => {
    const fresh = await uiFiles();
    expect(filesUnder(uiOut)).toEqual([...fresh.keys()].sort());
    for (const [name, bytes] of fresh) expect(readFileSync(join(uiOut, name)).equals(bytes), name).toBe(true);
  }, 60_000);

  it('stay under their size budgets: 300 KB for the pages, 400 KB for the fonts; text in LF', () => {
    const pages = ['index.html', 'app.js', 'app.css'].map((n) => statSync(join(uiOut, n)).size).reduce((a, b) => a + b, 0);
    const fonts = filesUnder(join(uiOut, 'fonts')).filter((n) => n.endsWith('.woff2')).map((n) => statSync(join(uiOut, 'fonts', n)).size).reduce((a, b) => a + b, 0);
    expect(pages).toBeLessThan(300 * 1024);
    expect(fonts).toBeLessThan(400 * 1024);
    for (const n of ['index.html', 'app.js', 'app.css']) expect(readFileSync(join(uiOut, n), 'utf8')).not.toMatch(/\r/);
  });
});
