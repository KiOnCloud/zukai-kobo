/**
 * Report templates end to end, through the committed bundle and from another working
 * directory: the built-in templates found from a copied install (install.sh and install.ps1),
 * an unrelated folder named like them ignored, validate and save, preview, export into one
 * home and import into another, the refusals of an unsafe file, and a report refused when its
 * project template is invalid.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync, execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scriptsDir, repoRoot } from './helpers.mjs';

const cliPath = join(scriptsDir, 'bin', 'cli.mjs');
const elsewhere = mkdtempSync(join(tmpdir(), 'zukai-templates-cwd-'));
const parse = (text) => text.trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return l; } }).at(-1);
const run = (cli, args, env = {}) => {
  const r = spawnSync(process.execPath, [cli, ...args], { cwd: elsewhere, encoding: 'utf8', env: { ...process.env, ...env } });
  return { code: r.status, out: parse(r.stdout), err: parse(r.stderr) };
};
const cli = (args, env) => run(cliPath, args, env);
const home = () => ({ ZUKAI_HOME: mkdtempSync(join(tmpdir(), 'zukai-templates-home-')) });
const builtInIds = (out) => out.templates.filter((t) => t.scope === 'built-in' && t.valid).map((t) => t.id);
const starts = (bin, args) => { const r = spawnSync(bin, args, { timeout: 60_000 }); return !r.error && r.status === 0; };
const pwsh = process.env.ZUKAI_PWSH ?? (starts('pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', 'exit 0']) ? 'pwsh' : null);
const sh = process.platform !== 'win32';

describe('built-in templates in a copied install', () => {
  it.skipIf(!sh)('are found by the CLI of an install.sh copy', () => {
    const dest = mkdtempSync(join(tmpdir(), 'zukai-templates-sh-'));
    execFileSync('sh', [join(repoRoot, 'install.sh'), '--target', 'codex', '--dest', dest], { stdio: 'pipe' });
    const out = run(join(dest, '.agents', 'skills', 'zukai', 'scripts', 'bin', 'cli.mjs'), ['template', 'list']).out;
    expect(builtInIds(out)).toEqual(['feature', 'issue-investigation', 'tech-research']);
  }, 180_000);

  it.skipIf(!pwsh)('are found by the CLI of an install.ps1 copy', () => {
    const dest = mkdtempSync(join(tmpdir(), 'zukai-templates-ps-'));
    execFileSync(pwsh, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(repoRoot, 'install.ps1'), '-Target', 'codex', '-Dest', dest], { stdio: 'pipe', timeout: 120_000 });
    const out = run(join(dest, '.agents', 'skills', 'zukai', 'scripts', 'bin', 'cli.mjs'), ['template', 'list']).out;
    expect(builtInIds(out)).toEqual(['feature', 'issue-investigation', 'tech-research']);
  }, 180_000);

  it('ignores a folder named report/templates beside a copy of the CLI that is not the plugin', { timeout: 120_000 }, () => {
    const top = mkdtempSync(join(tmpdir(), 'zukai-templates-stray-'));
    cpSync(join(scriptsDir, 'bin', 'cli.mjs'), join(top, 'draw', 'scripts', 'bin', 'cli.mjs'));
    cpSync(join(scriptsDir, 'package.json'), join(top, 'draw', 'scripts', 'package.json'));
    cpSync(join(repoRoot, 'skills', 'report'), join(top, 'report'), { recursive: true });
    const out = run(join(top, 'draw', 'scripts', 'bin', 'cli.mjs'), ['template', 'list']).out;
    expect(builtInIds(out)).toEqual([]);
  });
});

describe('template commands through the bundle', () => {
  it('validates, saves, previews, exports and imports into another home with identical files', { timeout: 120_000 }, () => {
    const a = home();
    const b = home();
    const folder = mkdtempSync(join(tmpdir(), 'zukai-templates-folder-'));
    const src = join(repoRoot, 'skills', 'report', 'templates', 'tech-research');
    for (const f of ['template.html', 'sample.json']) cpSync(join(src, f), join(folder, f));
    writeFileSync(join(folder, 'template.md'), readFileSync(join(src, 'template.md'), 'utf8').replace('id: tech-research', 'id: vendor-review').replace('name: Tech research', 'name: Vendor review'));
    const validated = cli(['template', 'validate', folder, '--out', join(folder, 'preview.html')], a);
    expect(validated).toMatchObject({ code: 0, out: { ok: true, id: 'vendor-review', preview: join(folder, 'preview.html') } });
    expect(readFileSync(join(folder, 'preview.html'), 'utf8')).toContain('Content-Security-Policy');
    expect(cli(['template', 'save', folder, '--scope', 'user'], a)).toMatchObject({ code: 0, out: { id: 'vendor-review', scope: 'user' } });
    expect(cli(['template', 'save', folder, '--scope', 'user'], a)).toMatchObject({ code: 1, err: { error: { code: 'exists' } } });
    expect(cli(['template', 'save', folder, '--scope', 'built-in'], a).code).toBe(1);
    const preview = join(elsewhere, `preview-${Date.now()}.html`);
    expect(cli(['template', 'preview', 'vendor-review', '--out', preview], a)).toMatchObject({ code: 0, out: { scope: 'user' } });
    expect(readFileSync(preview, 'utf8')).toContain('Choosing a queue for order events');
    const exportDir = mkdtempSync(join(tmpdir(), 'zukai-templates-export-'));
    expect(cli(['template', 'export', 'vendor-review', '--out', exportDir], a)).toMatchObject({ code: 0, out: { out: join(exportDir, 'vendor-review.zukai-template.json') } });
    const file = join(exportDir, 'vendor-review.zukai-template.json');
    expect(cli(['template', 'import', file, '--check'], b)).toMatchObject({ code: 0, out: { check: true, exists: false } });
    expect(cli(['template', 'import', file, '--scope', 'user'], b)).toMatchObject({ code: 0, out: { id: 'vendor-review' } });
    expect(cli(['template', 'import', file, '--scope', 'user'], b)).toMatchObject({ code: 1, err: { error: { code: 'exists' } } });
    expect(cli(['template', 'import', file, '--scope', 'user', '--replace'], b)).toMatchObject({ code: 0, out: { replaced: true } });
    for (const f of ['template.md', 'template.html', 'sample.json']) {
      expect(readFileSync(join(b.ZUKAI_HOME, 'report-templates', 'vendor-review', f), 'utf8')).toBe(readFileSync(join(a.ZUKAI_HOME, 'report-templates', 'vendor-review', f), 'utf8'));
    }
  });

  it('refuses an unsafe export file with exit 2 and writes nothing', { timeout: 120_000 }, () => {
    const env = home();
    const exportDir = mkdtempSync(join(tmpdir(), 'zukai-templates-export-'));
    cli(['template', 'export', 'feature', '--out', exportDir], env);
    const data = JSON.parse(readFileSync(join(exportDir, 'feature.zukai-template.json'), 'utf8'));
    const bad = join(exportDir, 'bad.json');
    writeFileSync(bad, JSON.stringify({ ...data, files: { ...data.files, 'template.html': data.files['template.html'].replace('</body>', '<script>steal()</script></body>') } }));
    expect(cli(['template', 'import', bad, '--scope', 'user'], env)).toMatchObject({ code: 2, err: { code: 'invalid-template' } });
    writeFileSync(bad, JSON.stringify({ ...data, id: '../../x' }));
    expect(cli(['template', 'import', bad, '--scope', 'project', '--root', elsewhere], env).code).toBe(2);
    expect(existsSync(join(env.ZUKAI_HOME, 'report-templates'))).toBe(false);
    expect(existsSync(join(elsewhere, '.zukai', 'report-templates'))).toBe(false);
  });

  it('refuses a report whose project template is invalid, and names it in the list', { timeout: 120_000 }, () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'zukai-templates-project-')));
    const dir = join(root, '.zukai', 'report-templates', 'feature');
    mkdirSync(dir, { recursive: true });
    const src = join(repoRoot, 'skills', 'report', 'templates', 'feature');
    for (const f of ['template.md', 'sample.json']) cpSync(join(src, f), join(dir, f));
    writeFileSync(join(dir, 'template.html'), readFileSync(join(src, 'template.html'), 'utf8').replace('<body>', '<body onload="x()">'));
    const list = cli(['template', 'list', '--root', root]).out;
    expect(list.templates.find((t) => t.id === 'feature' && t.scope === 'project')).toMatchObject({ valid: false, used: false, overridesBuiltIn: true });
    expect(cli(['report', 'new', '--template', 'feature', '--title', 'x', '--root', root])).toMatchObject({ code: 1, err: { error: { code: 'invalid-template' } } });
    expect(existsSync(join(root, 'reports'))).toBe(false);
  });
});
