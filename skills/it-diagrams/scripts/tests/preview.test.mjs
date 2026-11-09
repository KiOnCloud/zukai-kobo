import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { preview, loadPlaywright, drawioInstallPaths, findDrawioBinary } from '../src/preview.mjs';
import { scriptsDir } from './helpers.mjs';

const dir = mkdtempSync(join(tmpdir(), 'it-diagrams-preview-'));
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const hasPlaywright = loadPlaywright(scriptsDir) !== null;

describe('preview', () => {
  it('knows the default install paths of draw.io desktop per platform', () => {
    expect(drawioInstallPaths('darwin', {}, '/Users/me')).toEqual(['/Applications/draw.io.app/Contents/MacOS/draw.io', '/Users/me/Applications/draw.io.app/Contents/MacOS/draw.io']);
    expect(drawioInstallPaths('win32', { ProgramFiles: 'C:\\PF', LOCALAPPDATA: 'C:\\U\\me\\AppData\\Local' }, 'C:\\U\\me')).toEqual([join('C:\\PF', 'draw.io', 'draw.io.exe'), join('C:\\U\\me\\AppData\\Local', 'Programs', 'draw.io', 'draw.io.exe')]);
    expect(drawioInstallPaths('linux', {}, '/home/me')).toContain('/opt/drawio/drawio');
    const found = findDrawioBinary();
    expect(found.tried[0]).toBe('drawio on PATH');
    expect(found.tried.length).toBeGreaterThan(2);
  });

  it.skipIf(hasPlaywright)('names every place it looked for draw.io when no renderer renders a .drawio file', async () => {
    const file = join(dir, 'x.drawio');
    writeFileSync(file, '<mxfile compressed="false"><diagram id="d" name="d"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>');
    const r = await preview(file, { out: join(dir, 'x.png') });
    if (!r.ok) {
      expect(r.errors[0].message).toContain('draw.io desktop');
      if (r.errors[0].message.includes('not found')) expect(r.errors[0].message).toMatch(/looked for drawio on PATH, draw\.io on PATH, \//);
    }
  });

  it('rejects files that are not .drawio or .mmd', async () => {
    const r = await preview(join(scriptsDir, 'package.json'));
    expect(r.ok).toBe(false);
    expect(r.errors[0].message).toContain('.drawio or .mmd');
  });

  it('reports a missing file', async () => {
    const r = await preview(join(dir, 'missing.mmd'));
    expect(r.ok).toBe(false);
    expect(r.errors[0].message).toContain('cannot read');
  });

  it.skipIf(!hasPlaywright)('renders a .drawio file to PNG through the draw.io viewer page', async () => {
    const src = join(scriptsDir, 'tests', 'snapshots', 'drawio', 'sequence-valid.drawio');
    const file = join(dir, 'sequence.drawio');
    writeFileSync(file, readFileSync(src));
    const r = await preview(file);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.out).toBe(join(tmpdir(), 'it-diagrams-preview', 'sequence.png'));
    expect(existsSync(r.out)).toBe(true);
    expect(readFileSync(r.out).subarray(0, 4).equals(PNG_MAGIC)).toBe(true);
  }, 120_000);

  it.skipIf(!hasPlaywright)('renders a .mmd file to PNG with Mermaid', async () => {
    const src = join(scriptsDir, 'tests', 'snapshots', 'mermaid', 'flowchart-valid.mmd');
    const file = join(dir, 'flow.mmd');
    writeFileSync(file, readFileSync(src));
    const r = await preview(file, { out: join(dir, 'custom.png') });
    expect(r.errors).toEqual([]);
    expect(r.renderer).toBe('mermaid-web');
    expect(readFileSync(join(dir, 'custom.png')).subarray(0, 4).equals(PNG_MAGIC)).toBe(true);
  }, 120_000);

  it.skipIf(!hasPlaywright)('reports a Mermaid syntax error instead of a blank image', async () => {
    const file = join(dir, 'broken.mmd');
    writeFileSync(file, 'flowchart TB\n  a --> \n  --> b\n');
    const r = await preview(file);
    expect(r.ok).toBe(false);
    expect(r.errors[0].message).toContain('Mermaid could not render');
  }, 120_000);
});
