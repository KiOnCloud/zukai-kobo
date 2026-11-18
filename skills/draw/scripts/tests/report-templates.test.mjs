import { describe, it, expect } from 'vitest';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, symlinkSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  validateTemplate, listTemplates, resolveTemplate, saveTemplate, exportTemplate, importTemplate, previewTemplate, builtInRoot,
  scopeRoot, htmlErrors, parseFrontMatter, showTemplate,
} from '../src/report-templates.mjs';
import { repoRoot } from './helpers.mjs';

const builtIn = join(repoRoot, 'skills', 'report', 'templates');
const filesOf = (id) => Object.fromEntries(['template.md', 'template.html', 'sample.json'].map((f) => [f, readFileSync(join(builtIn, id, f), 'utf8')]));
const project = () => mkdtempSync(join(tmpdir(), 'zukai-templates-'));
const home = () => ({ ZUKAI_HOME: mkdtempSync(join(tmpdir(), 'zukai-templates-home-')) });
/** A template like the built-in one with another id (and its html changed when given). */
const variant = (id, change = {}) => {
  const f = filesOf('tech-research');
  return { ...f, 'template.md': f['template.md'].replace('id: tech-research', `id: ${id}`), ...change };
};

describe('built-in templates', () => {
  it('each validates and previews its sample through its own layout', () => {
    const root = project();
    for (const id of ['issue-investigation', 'tech-research', 'feature']) {
      expect(validateTemplate(filesOf(id), { id }), id).toMatchObject({ ok: true });
      const p = previewTemplate(root, id);
      expect(p.ok, id).toBe(true);
      expect(p.html.startsWith('<!doctype html>\n<meta http-equiv="Content-Security-Policy"')).toBe(true);
      expect(p.html).toContain('@media print');
      expect(p.html).toContain('break-before: page');
    }
    expect(resolveTemplate(root, 'feature').template.sections.filter((s) => s.embed).map((s) => [s.id, s.embed])).toEqual([['design', 'diagram'], ['data-and-tables', 'tables']]);
  });

  it('are found in the plugin layout and in a copied install only with its version marker', () => {
    expect(builtInRoot()).toBe(builtIn);
    const top = mkdtempSync(join(tmpdir(), 'zukai-copied-'));
    mkdirSync(join(top, 'zukai'));
    cpSync(builtIn, join(top, 'zukai-report', 'templates'), { recursive: true });
    expect(builtInRoot({ draw: join(top, 'zukai'), version: '9.9.9' })).toBeUndefined();
    writeFileSync(join(top, 'zukai-report', '.zukai-report-version'), '9.9.9\n');
    expect(builtInRoot({ draw: join(top, 'zukai'), version: '9.9.9' })).toBe(join(top, 'zukai-report', 'templates'));
    expect(builtInRoot({ draw: join(top, 'zukai'), version: '9.9.8' })).toBeUndefined();
    const stray = mkdtempSync(join(tmpdir(), 'zukai-stray-'));
    mkdirSync(join(stray, 'draw'));
    cpSync(builtIn, join(stray, 'report', 'templates'), { recursive: true });
    writeFileSync(join(stray, 'report', 'SKILL.md'), '---\nname: report\n---\n');
    expect(builtInRoot({ draw: join(stray, 'draw'), version: '9.9.9' })).toBeUndefined();
  });
});

describe('validation of untrusted templates', () => {
  it('refuses every construct that runs code or fetches from elsewhere', () => {
    for (const bad of ['<script>x</script>', '<SCRIPT src=x>', '<iframe>', '<object>', '<embed>', '<base href="#">', '<form>', '<link rel=stylesheet>', '<meta http-equiv="refresh" content="0">',
      '<div onclick="x()">', '<img/onerror=x>', '<a href="https://evil.example">', '<a href="javascript:alert(1)">', '<img src="//evil.example/x.png">', '<style>@import "x.css";</style>',
      '<style>body{background:url(https://evil.example/x)}</style>', '<style>body{background:\\75 rl(x)}</style>', '<video src="#">', '<a href="data:text/html,x">',
      '<meta content="0;url=https://evil.example/?a>b" http-equiv="refresh">', '<meta property="og:x" content="y">', '<style>a{background:image-set("https://evil.example/x" 1x)}</style>',
      '<style>a{background:u\\rl(https://evil.example/x)}</style>', '<p style="background:u&#114;l(https://evil.example/x)">', '<svg><style>@&#105;mport "https://evil.example/x.css";</style></svg>']) {
      expect(htmlErrors(`<html><head></head><body>${bad}{{sections}}</body></html>`).length, bad).toBeGreaterThan(0);
    }
    expect(htmlErrors('<html><body><a href="#top">x</a><img src="data:image/png;base64,AAAA"><style>a{background:url(data:image/png;base64,AAAA)}</style>{{sections}}</body></html>')).toEqual([]);
    expect(htmlErrors(`<style>a{background:url(data:image/png;base64,${'A'.repeat(140 * 1024)})}</style>`).some((e) => /data: URI/.test(e.message))).toBe(true);
  });

  it('refuses ids, placeholders, sections and samples that break the contract', () => {
    const check = (files, opts) => validateTemplate(files, opts);
    expect(check(variant('../../x'))).toMatchObject({ ok: false });
    expect(check(variant('con'))).toMatchObject({ ok: false });
    expect(check(variant('ok-id'), { id: 'other' })).toMatchObject({ ok: false });
    expect(check(variant('ok-id', { 'template.html': '<html><body>{{sections}}{{author}}</body></html>' })).errors.map((e) => e.message)).toContain('unknown placeholder {{author}}');
    expect(check(variant('ok-id', { 'template.html': '<html><body>{{section:nope}}</body></html>' })).ok).toBe(false);
    expect(check(variant('ok-id', { 'template.html': '<html><body>{{section:question}}</body></html>' })).errors.some((e) => /neither/.test(e.message))).toBe(true);
    const f = variant('ok-id');
    expect(check({ ...f, 'template.md': f['template.md'].replace('id="context"', 'id="question"') }).ok).toBe(false);
    expect(check({ ...f, 'template.md': f['template.md'].replace('guide="', 'guide="‮') }).ok).toBe(false);
    expect(check({ ...f, 'template.md': f['template.md'].replace('guide="', 'run="rm" guide="') }).ok).toBe(false);
    expect(check({ ...f, 'sample.json': JSON.stringify({ title: 'x', sections: { nope: 'y' } }) }).ok).toBe(false);
    expect(check({ ...f, 'sample.json': JSON.stringify({ title: 'x', sections: { question: 'call 090-1234-5678' } }) }).ok).toBe(false);
    expect(check({ ...f, 'sample.json': JSON.stringify({ title: 'x', sections: { question: 'key AKIAABCDEFGHIJKLMNOP' } }) }).ok).toBe(false);
    expect(check({ ...f, 'template.md': f['template.md'].replace('embed', 'x') }).ok).toBe(true);
    expect(parseFrontMatter('no front matter').error).toBeDefined();
  });
});

describe('scopes', () => {
  it('resolves nearest first, lists all three and flags a project override of a built-in one', () => {
    const root = project();
    const env = home();
    const files = filesOf('feature');
    files['template.md'] = filesOf('feature')['template.md'].replace('name: Feature', 'name: Feature (user)');
    expect(saveTemplate(root, 'user', files, { env })).toMatchObject({ ok: true, scope: 'user' });
    expect(resolveTemplate(root, 'feature', { env }).template.name).toBe('Feature (user)');
    files['template.md'] = filesOf('feature')['template.md'].replace('name: Feature', 'name: Feature (project)');
    expect(saveTemplate(root, 'project', files, { env })).toMatchObject({ ok: true, scope: 'project' });
    expect(resolveTemplate(root, 'feature', { env }).template.name).toBe('Feature (project)');
    expect(resolveTemplate(root, 'feature', { env, scope: 'built-in' }).template.name).toBe('Feature');
    const rows = listTemplates(root, { env }).templates.filter((t) => t.id === 'feature');
    expect(rows.map((r) => [r.scope, r.used, r.overriddenBy])).toEqual([['project', true, null], ['user', false, 'project'], ['built-in', false, 'project']]);
    expect(rows[0]).toMatchObject({ overrides: ['user', 'built-in'], overridesBuiltIn: true });
  });

  it('lists a hand-placed invalid project template with its reasons and never uses it', () => {
    const root = project();
    const dir = join(root, '.zukai', 'report-templates', 'feature');
    mkdirSync(dir, { recursive: true });
    const f = filesOf('feature');
    for (const [name, text] of Object.entries(f)) writeFileSync(join(dir, name), name === 'template.html' ? text.replace('</body>', '<script>steal()</script></body>') : text);
    const row = listTemplates(root).templates.find((t) => t.id === 'feature' && t.scope === 'project');
    expect(row).toMatchObject({ valid: false, used: false });
    expect(row.errors.some((e) => /<script>/.test(e.message))).toBe(true);
    expect(resolveTemplate(root, 'feature')).toMatchObject({ ok: false, code: 'invalid-template' });
  });

  it('never writes the built-in scope, keeps an existing id without replace, and refuses a link', () => {
    const root = project();
    const env = home();
    expect(saveTemplate(root, 'built-in', variant('x'), { env })).toMatchObject({ ok: false, code: 'bad-request' });
    expect(saveTemplate(root, undefined, variant('x'), { env })).toMatchObject({ ok: false });
    expect(saveTemplate(root, 'user', variant('mine'), { env }).ok).toBe(true);
    expect(saveTemplate(root, 'user', variant('mine'), { env })).toMatchObject({ ok: false, code: 'exists' });
    expect(saveTemplate(root, 'user', variant('mine'), { env, replace: true })).toMatchObject({ ok: true, replaced: true });
    expect(readdirSync(scopeRoot(root, 'user', { env })).filter((n) => n.startsWith('.'))).toEqual([]);
    const outside = mkdtempSync(join(tmpdir(), 'zukai-templates-outside-'));
    try { symlinkSync(outside, join(scopeRoot(root, 'user', { env }), 'linked'), 'junction'); } catch { return; }
    expect(saveTemplate(root, 'user', variant('linked'), { env, replace: true })).toMatchObject({ ok: false, code: 'bad-request' });
    expect(readdirSync(outside)).toEqual([]);
  });
});

describe('export and import', () => {
  it('round-trips a template into another home with identical files', () => {
    const root = project();
    const a = home();
    const b = home();
    saveTemplate(root, 'user', variant('mine'), { env: a });
    const exported = exportTemplate(root, 'mine', { env: a });
    expect(exported).toMatchObject({ ok: true, fileName: 'mine.zukai-template.json' });
    const check = importTemplate(root, exported.text, { scope: 'user', check: true, env: b });
    expect(check).toMatchObject({ ok: true, check: true, id: 'mine', exists: false });
    expect(check.preview).toContain('Content-Security-Policy');
    expect(existsSync(join(scopeRoot(root, 'user', { env: b }), 'mine'))).toBe(false);
    expect(importTemplate(root, exported.text, { scope: 'user', env: b })).toMatchObject({ ok: true, id: 'mine' });
    for (const f of ['template.md', 'template.html', 'sample.json']) {
      expect(readFileSync(join(scopeRoot(root, 'user', { env: b }), 'mine', f), 'utf8')).toBe(variant('mine')[f]);
    }
    expect(importTemplate(root, exported.text, { scope: 'user', env: b })).toMatchObject({ ok: false, code: 'exists' });
    expect(importTemplate(root, exported.text, { scope: 'user', env: b, replace: true })).toMatchObject({ ok: true, replaced: true });
  });

  it('refuses an unsafe or inconsistent file before writing anything', () => {
    const root = project();
    const env = home();
    const base = JSON.parse(exportTemplate(root, 'tech-research', { env }).text);
    const variants = [
      { ...base, id: '../../x' },
      { ...base, id: 'CON' },
      { ...base, id: 'other' },
      { ...base, files: { ...base.files, 'template.html': base.files['template.html'].replace('</body>', '<script>x</script></body>') } },
      { ...base, files: { ...base.files, 'template.html': base.files['template.html'].replace('<body>', '<body onload="x()">') } },
      { ...base, files: { ...base.files, 'template.html': base.files['template.html'].replace('</body>', '<a href="https://evil.example">x</a></body>') } },
      { ...base, files: { ...base.files, 'template.html': base.files['template.html'].replace('<style>', '<style>@import "x.css";') } },
      { ...base, files: { ...base.files, 'template.html': base.files['template.html'].replace('</style>', `a{background:url(data:image/png;base64,${'A'.repeat(140 * 1024)})}</style>`) } },
      { ...base, extra: 1 },
    ];
    for (const v of variants) expect(importTemplate(root, JSON.stringify(v), { scope: 'user', env }).ok, JSON.stringify(v).slice(0, 80)).toBe(false);
    expect(importTemplate(root, 'x'.repeat(1024 * 1024 + 1), { scope: 'user', env }).ok).toBe(false);
    expect(existsSync(scopeRoot(root, 'user', { env }))).toBe(false);
  });

  it('shows a template with its files', () => {
    expect(showTemplate(project(), 'feature')).toMatchObject({ ok: true, scope: 'built-in', valid: true, files: { 'template.md': expect.stringContaining('id: feature') } });
  });
});

describe('a scope folder that is a link', () => {
  it('is never written, and the folder it points at keeps what it holds', () => {
    const root = project();
    const victim = mkdtempSync(join(tmpdir(), 'zukai-templates-victim-'));
    mkdirSync(join(victim, 'projects'));
    writeFileSync(join(victim, 'projects', 'precious.txt'), 'keep me');
    mkdirSync(join(root, '.zukai'), { recursive: true });
    try { symlinkSync(victim, join(root, '.zukai', 'report-templates'), 'junction'); } catch { return; }
    expect(saveTemplate(root, 'project', variant('projects'), { replace: true })).toMatchObject({ ok: false, code: 'bad-request' });
    expect(readFileSync(join(victim, 'projects', 'precious.txt'), 'utf8')).toBe('keep me');
    expect(readdirSync(join(victim, 'projects'))).toEqual(['precious.txt']);
  });
});
