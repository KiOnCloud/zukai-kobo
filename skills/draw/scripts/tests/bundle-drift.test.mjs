import { describe, it, expect } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { bundleText } from '../build.mjs';
import { scriptsDir } from './helpers.mjs';

const bundlePath = join(scriptsDir, 'bin', 'cli.mjs');

describe('committed bundle', () => {
  it('matches a fresh build of src byte for byte (run `npm run build` when this fails)', async () => {
    const committed = readFileSync(bundlePath, 'utf8');
    expect(committed).toBe(await bundleText());
  }, 60_000);

  it('stays under the size budget and uses LF line endings', () => {
    expect(statSync(bundlePath).size).toBeLessThan(2.5 * 1024 * 1024);
    expect(readFileSync(bundlePath, 'utf8')).not.toMatch(/\r/);
  });
});
