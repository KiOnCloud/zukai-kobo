/**
 * Report templates: what a report holds (its sections, each with a guide for the writer and
 * an optional embed) and how it looks (an HTML layout with placeholders), with sample content
 * for a preview.
 *
 *   <id>/
 *     template.md    front matter (id, name, kind, lang, description, version), then one
 *                    "## <Section>" per section followed by
 *                    <!-- zukai:section id="<section-id>" guide="..." [embed="diagram|tables"] -->
 *     template.html  markup and CSS only, with {{title}}, {{lang}}, {{meta}}, {{toc}},
 *                    {{section:<section-id>}} and {{sections}}
 *     sample.json    { "title", "meta"?, "sections": { "<section-id>": "<markdown>" } }
 *
 * Three scopes, nearest first: the project (`.zukai/report-templates/`, committed), the user
 * (`report-templates/` beside the run index) and the built-in templates of the report skill.
 * A template is untrusted input wherever it comes from (a clone brings `.zukai/` along, an
 * import brings a file from anyone), so it is validated every time it is read or written:
 * an id pattern, the front matter and the sample against `report-template-v1`, placeholders
 * that name the template's own sections, an HTML layout without any construct that runs code
 * or fetches from elsewhere, size caps and the secret scan. An invalid template is listed with
 * its reasons and is never used. Built-in templates are found only through the plugin layout,
 * or through a copied install whose version marker names this CLI's version, so a folder that
 * happens to be called `report/templates` is never read as built-in.
 */
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020.js';
import schema from './schema/report-template-v1.schema.json' with { type: 'json' };
import pkg from '../package.json' with { type: 'json' };
import { scanSecrets, DEFINITE_KINDS } from './scan-secrets.mjs';
import { ensureZukaiDir, zukaiDir, takeLock, releaseLock } from './glossary.mjs';
import { indexHome } from './run-index.mjs';
import { splitSections, SECTION_ID_RE } from './report-markdown.mjs';
import { pourReport, renderReport, PLACEHOLDER_RE } from './reports.mjs';

export const SCOPES = ['project', 'user', 'built-in'];
export const WRITABLE_SCOPES = ['user', 'project'];
export const TEMPLATE_FILES = ['template.md', 'template.html', 'sample.json'];
export const EXPORT_SUFFIX = '.zukai-template.json';
export const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const EMBEDS = ['diagram', 'tables'];
const LOCK_NAME = 'report-templates.lock';
const MAX_HTML = 256 * 1024;
const MAX_DATA_URI = 128 * 1024;
export const MAX_EXPORT = 1024 * 1024;
const MAX_GUIDE = 500;
const MAX_SECTIONS = 40;
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;
// eslint-disable-next-line no-control-regex
const BAD_TEXT = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f؜‎‏‪-‮⁦-⁩]/;

const fail = (code, message, hint, extra = {}) => ({ ok: false, code, errors: [{ path: '/', message, ...(hint ? { hint } : {}) }], ...extra });
const isRealDir = (path) => { try { return lstatSync(path).isDirectory(); } catch { return false; } };
const isRealFile = (path) => { try { return lstatSync(path).isFile(); } catch { return false; } };

let validators;
function validatorsOf() {
  if (!validators) {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    ajv.addSchema(schema);
    validators = Object.fromEntries(['frontMatter', 'sample', 'exportFile'].map((d) => [d, ajv.getSchema(`${schema.$id}#/$defs/${d}`)]));
  }
  return validators;
}
const schemaErrors = (which, value, base) => {
  const v = validatorsOf()[which];
  return v(value) ? [] : (v.errors ?? []).map((e) => ({ path: `${base}${e.instancePath}`, message: e.message ?? 'invalid' }));
};

// ---------------------------------------------------------------- scopes

/** The folder of the draw skill this code runs from: `<draw>/scripts/bin` (bundle) or `<draw>/scripts/src`. */
export const drawDir = () => resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The first line of a file, trimmed; undefined when it cannot be read. */
const firstLine = (path) => { try { return readFileSync(path, 'utf8').split(/\r?\n/)[0].trim(); } catch { return undefined; } };

/**
 * The built-in templates folder, or undefined: `<draw>/../report/templates` when the draw
 * folder sits in the plugin (named `draw`, beside `report/SKILL.md`, with the plugin manifest
 * of this version two levels up), else `<draw>/../zukai-report/templates` when that copy
 * carries `.zukai-report-version` with this CLI's version. Nothing else is ever read as built-in.
 */
export function builtInRoot({ draw = drawDir(), version = pkg.version } = {}) {
  const skills = dirname(draw);
  const plugin = join(skills, 'report', 'templates');
  if (basename(draw) === 'draw' && isRealDir(plugin) && /^name:\s*report\s*$/m.test(readFileSafe(join(skills, 'report', 'SKILL.md')))) {
    try {
      if (JSON.parse(readFileSync(join(dirname(skills), '.claude-plugin', 'plugin.json'), 'utf8')).version === version) return plugin;
    } catch { /* not the plugin */ }
  }
  const copied = join(skills, 'zukai-report');
  if (isRealDir(join(copied, 'templates')) && firstLine(join(copied, '.zukai-report-version')) === version) return join(copied, 'templates');
  return undefined;
}
const readFileSafe = (path) => { try { return readFileSync(path, 'utf8'); } catch { return ''; } };

/** The folder of a scope: project `.zukai/report-templates/`, user `<ZUKAI_HOME>/report-templates/`, or the built-in one (maybe undefined). */
export function scopeRoot(root, scope, { env = process.env, draw } = {}) {
  if (scope === 'project') return join(zukaiDir(root), 'report-templates');
  if (scope === 'user') return join(indexHome(env), 'report-templates');
  if (scope === 'built-in') return builtInRoot(draw ? { draw } : {});
  return undefined;
}

// ---------------------------------------------------------------- parse

/** The front matter of `template.md` (`key: value` lines between `---` lines) and the body after it. */
export function parseFrontMatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { error: 'template.md starts with front matter between two --- lines' };
  const data = {};
  for (const line of m[1].split(/\r?\n/)) {
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    const kv = /^([a-z]+):\s*(.*)$/.exec(line);
    if (!kv) return { error: `front matter line "${line.slice(0, 40)}" is not key: value` };
    let value = kv[2].trim();
    if (/^".*"$/.test(value)) {
      try { value = JSON.parse(value); } catch { return { error: `front matter value of ${kv[1]} is not a valid quoted string` }; }
    } else if (/^'.*'$/.test(value)) value = value.slice(1, -1);
    data[kv[1]] = value;
  }
  return { data, body: text.slice(m[0].length) };
}

/** The sections of a template: `[{ id, name, guide, embed? }]` from its markers. */
function sectionsOf(body) {
  return splitSections(body).sections.map((s) => ({ id: s.id, name: s.heading || s.id, guide: s.attrs.guide ?? '', ...(s.attrs.embed !== undefined ? { embed: s.attrs.embed } : {}), attrs: s.attrs }));
}

// ---------------------------------------------------------------- validation

/** Why the HTML layout is unsafe: every construct that could run code or fetch from elsewhere. */
export function htmlErrors(html) {
  const errors = [];
  const add = (message) => errors.push({ path: 'template.html', message });
  if (Buffer.byteLength(html) > MAX_HTML) add(`larger than ${MAX_HTML / 1024} KB`);
  const banned = [
    [/<\s*script/i, '<script>'], [/<\s*iframe/i, '<iframe>'], [/<\s*frame/i, '<frame>'], [/<\s*object/i, '<object>'], [/<\s*embed/i, '<embed>'],
    [/<\s*base/i, '<base>'], [/<\s*form/i, '<form>'], [/<\s*link/i, '<link>'], [/http-equiv/i, 'http-equiv'],
    [/<\s*(?:audio|video|source|track|portal|applet)\b/i, 'a media or applet element'],
    [/javascript\s*:/i, 'a javascript: URL'], [/vbscript\s*:/i, 'a vbscript: URL'], [/@import/i, '@import'], [/expression\s*\(/i, 'a CSS expression()'],
    [/\\/, 'a backslash (a CSS escape can spell a URL or a rule)'],
    [/image-set\s*\(/i, 'image-set(), which can name a URL'],
    [/[\s"'/]on[a-z]+\s*=/i, 'an on* event attribute'],
  ];
  for (const [re, what] of banned) if (re.test(html)) add(`holds ${what}`);
  for (const m of html.matchAll(/\b(src|href|srcset|action|formaction|xlink:href|poster|background|data|ping|cite|longdesc|manifest)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    const value = (m[3] ?? m[4] ?? m[5] ?? '').trim();
    if (!(value.startsWith('#') || /^data:image\//i.test(value))) add(`attribute ${m[1]}="${value.slice(0, 40)}" points outside the page; only data:image/ and # are allowed`);
  }
  for (const m of html.matchAll(/url\s*\(\s*(['"]?)([^'")]*)/gi)) {
    const value = m[2].trim();
    if (!(value.startsWith('#') || /^data:(image|font)\//i.test(value))) add(`url(${value.slice(0, 40)}) points outside the page; only data:image/, data:font/ and # are allowed`);
  }
  for (const m of html.matchAll(/data:[a-z+./-]+;base64,[A-Za-z0-9+/=]+/gi)) {
    if (m[0].length > MAX_DATA_URI) add(`a data: URI is larger than ${MAX_DATA_URI / 1024} KB`);
  }
  // A <meta> may name the character set or a name/content pair, nothing else.
  for (const m of html.matchAll(/<\s*meta\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi)) {
    const names = [...m[1].matchAll(/([^\s"'=/>]+)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?/g)].map((x) => x[1].toLowerCase());
    if (names.some((n) => !['charset', 'name', 'content'].includes(n))) add('holds a <meta> with an attribute other than charset, name and content');
  }
  // CSS must be plain: an entity in a stylesheet or a style attribute can spell what the
  // checks above look for.
  const entity = /&(#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);?/i;
  for (const m of html.matchAll(/<\s*style\b[^>]*>([\s\S]*?)<\s*\/\s*style\s*>/gi)) if (entity.test(m[1])) add('holds a character reference (&...) inside a <style>');
  for (const m of html.matchAll(/\bstyle\s*=\s*("([^"]*)"|'([^']*)')/gi)) if (entity.test(m[2] ?? m[3] ?? '')) add('holds a character reference (&...) inside a style attribute');
  return errors;
}

/** What the secret scan finds in the texts of a template; data: URIs (pictures and fonts) are no text. */
function secretErrors(files) {
  const texts = Object.fromEntries(Object.entries(files).map(([k, v]) => [k, String(v).replace(/data:[a-z+./-]+;base64,[A-Za-z0-9+/=]+/gi, 'data:')]));
  const errors = [];
  for (const [file, text] of Object.entries(texts)) {
    text.split(/\r?\n/).forEach((line, i) => {
      for (const w of scanSecrets(line).warnings) {
        if (DEFINITE_KINDS.has(w.kind) || w.kind === 'personal-data') errors.push({ path: `${file}:${i + 1}`, message: w.message.replace(/; .*$/, ''), hint: 'a template holds wording and layout only: no credential, address or telephone number' });
      }
    });
  }
  return errors;
}

/**
 * Validate the three files of a template. `files` maps each file name to its text; `id`, when
 * given, is the name the template is stored under (its folder or the id of its export file),
 * which must equal the front matter's id.
 * @returns {{ ok: boolean, errors: object[], template?: object }}
 */
export function validateTemplate(files, { id } = {}) {
  const errors = [];
  for (const f of TEMPLATE_FILES) if (typeof files?.[f] !== 'string') errors.push({ path: f, message: `${f} is missing` });
  if (errors.length > 0) return { ok: false, errors };
  for (const f of TEMPLATE_FILES) if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(files[f])) errors.push({ path: f, message: 'holds a control character' });
  const fm = parseFrontMatter(files['template.md']);
  if (fm.error) return { ok: false, errors: [...errors, { path: 'template.md', message: fm.error }] };
  errors.push(...schemaErrors('frontMatter', fm.data, 'template.md#'));
  if (typeof fm.data.id === 'string' && RESERVED.test(fm.data.id)) errors.push({ path: 'template.md#/id', message: `"${fm.data.id}" is a name Windows reserves for a device` });
  if (id !== undefined && id !== fm.data.id) errors.push({ path: 'template.md#/id', message: `the id "${fm.data.id}" differs from the name the template is stored under, "${id}"` });
  const sections = sectionsOf(fm.body);
  if (sections.length === 0) errors.push({ path: 'template.md', message: 'no section: each "## <Section>" is followed by <!-- zukai:section id="..." guide="..." -->' });
  if (sections.length > MAX_SECTIONS) errors.push({ path: 'template.md', message: `more than ${MAX_SECTIONS} sections` });
  const seen = new Set();
  for (const s of sections) {
    const at = `template.md#section/${s.id}`;
    if (!SECTION_ID_RE.test(s.id)) errors.push({ path: at, message: `section id "${s.id}" does not match ${SECTION_ID_RE}` });
    if (seen.has(s.id)) errors.push({ path: at, message: `section id "${s.id}" is used twice` });
    seen.add(s.id);
    const unknown = Object.keys(s.attrs).filter((k) => !['guide', 'embed'].includes(k));
    if (unknown.length) errors.push({ path: at, message: `unknown marker attribute ${unknown.join(', ')}; a marker has id, guide and embed` });
    if (s.guide.length > MAX_GUIDE || BAD_TEXT.test(s.guide)) errors.push({ path: at, message: `the guide is longer than ${MAX_GUIDE} characters or holds a control or direction character` });
    if (s.embed !== undefined && !EMBEDS.includes(s.embed)) errors.push({ path: at, message: `embed "${s.embed}" is not one of ${EMBEDS.join(', ')}` });
    if (BAD_TEXT.test(s.name) || s.name.length > 200) errors.push({ path: at, message: 'the section heading is longer than 200 characters or holds a control or direction character' });
  }
  const html = files['template.html'];
  errors.push(...htmlErrors(html));
  const placed = new Set();
  let hasAll = false;
  for (const m of html.matchAll(/\{\{([^}]*)\}\}/g)) {
    const inner = m[1].trim();
    PLACEHOLDER_RE.lastIndex = 0;
    if (!new RegExp(`^${PLACEHOLDER_RE.source}$`).test(`{{${inner}}}`)) { errors.push({ path: 'template.html', message: `unknown placeholder {{${inner}}}` }); continue; }
    if (inner === 'sections') hasAll = true;
    const sec = /^section:(.+)$/.exec(inner);
    if (sec) {
      if (!seen.has(sec[1])) errors.push({ path: 'template.html', message: `{{section:${sec[1]}}} names no section of template.md` });
      placed.add(sec[1]);
    }
  }
  if (!hasAll && sections.some((s) => !placed.has(s.id))) errors.push({ path: 'template.html', message: `the layout places neither {{sections}} nor every section (missing: ${sections.filter((s) => !placed.has(s.id)).map((s) => s.id).join(', ')})` });
  let sample;
  try {
    sample = JSON.parse(files['sample.json']);
  } catch {
    errors.push({ path: 'sample.json', message: 'not valid JSON' });
  }
  if (sample !== undefined) {
    errors.push(...schemaErrors('sample', sample, 'sample.json#'));
    for (const key of Object.keys(sample?.sections ?? {})) if (!seen.has(key)) errors.push({ path: `sample.json#/sections/${key}`, message: `"${key}" names no section of template.md` });
  }
  errors.push(...secretErrors(files));
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    errors: [],
    template: { ...fm.data, version: String(fm.data.version), sections: sections.map(({ attrs, ...s }) => s), html, sample, files: { ...files } },
  };
}

// ---------------------------------------------------------------- read

/** The three files of a template folder, read only from real files; undefined for a missing one. */
function readFolder(dir) {
  return Object.fromEntries(TEMPLATE_FILES.map((f) => [f, isRealFile(join(dir, f)) ? readFileSync(join(dir, f), 'utf8') : undefined]));
}

/** The template folders of a scope: real folders whose name matches the id pattern. */
function idsIn(dir) {
  if (!dir || !isRealDir(dir)) return [];
  return readdirSync(dir).filter((n) => ID_RE.test(n) && !RESERVED.test(n) && isRealDir(join(dir, n))).sort();
}

/** One template of one scope, read and validated: `{ id, scope, valid, errors, template? }`. */
function readTemplate(root, scope, id, opts) {
  const dir = scopeRoot(root, scope, opts);
  if (!idsIn(dir).includes(id)) return undefined;
  const v = validateTemplate(readFolder(join(dir, id)), { id });
  return { id, scope, path: join(dir, id), valid: v.ok, errors: v.errors, ...(v.ok ? { template: { ...v.template, scope } } : {}) };
}

/**
 * Every template of every scope, as the console and `template list` show it: for each id and
 * scope its validity and reasons, whether it is the one used (the nearest scope that has the
 * id, and only when it is valid), the scopes it overrides, and whether a project template
 * overrides a built-in one (such a template may have come with a clone).
 */
export function listTemplates(root, opts = {}) {
  const rows = [];
  const ids = new Set(SCOPES.flatMap((scope) => idsIn(scopeRoot(root, scope, opts))));
  for (const id of [...ids].sort()) {
    const found = SCOPES.map((scope) => readTemplate(root, scope, id, opts)).filter(Boolean);
    found.forEach((t, i) => {
      rows.push({
        id,
        scope: t.scope,
        valid: t.valid,
        errors: t.errors,
        used: i === 0 && t.valid,
        overrides: i === 0 ? found.slice(1).map((o) => o.scope) : [],
        overriddenBy: i === 0 ? null : found[0].scope,
        overridesBuiltIn: i === 0 && t.scope === 'project' && found.some((o) => o.scope === 'built-in'),
        ...(t.valid ? { name: t.template.name, kind: t.template.kind, lang: t.template.lang, description: t.template.description, version: t.template.version, sections: t.template.sections } : {}),
      });
    });
  }
  return { ok: true, templates: rows, scopes: Object.fromEntries(SCOPES.map((s) => [s, scopeRoot(root, s, opts) ?? null])) };
}

/**
 * The template a report uses: the nearest scope that has the id (or the scope named), which
 * must be valid. `{ ok: true, template }` or `{ ok: false, code, errors }`.
 */
export function resolveTemplate(root, id, { scope, ...opts } = {}) {
  if (typeof id !== 'string' || !ID_RE.test(id)) return fail('bad-request', `"${id}" is not a template id`, 'an id is lower-case letters, digits and -, as template list prints it');
  if (scope !== undefined && !SCOPES.includes(scope)) return fail('bad-request', `unknown scope "${scope}"`, `a scope is one of ${SCOPES.join(', ')}`);
  for (const s of scope ? [scope] : SCOPES) {
    const t = readTemplate(root, s, id, opts);
    if (!t) continue;
    if (!t.valid) return { ok: false, code: 'invalid-template', errors: t.errors.map((e) => ({ ...e, path: `${s}:${id}/${e.path}` })), hint: 'fix the template, or remove it so the next scope is used' };
    return { ok: true, template: t.template, path: t.path };
  }
  const known = listTemplates(root, opts).templates.filter((t) => t.used).map((t) => t.id);
  return fail('not-found', `no template ${id}${scope ? ` in the ${scope} scope` : ''}`, known.length ? `templates: ${known.join(', ')}` : 'no template is installed; the report skill carries the built-in ones');
}

// ---------------------------------------------------------------- preview

/** The Markdown of a template's sample: its sections in order with their headings. */
export function sampleMarkdown(template) {
  const parts = [`# ${template.sample.title}`, ''];
  for (const s of template.sections) parts.push(`## ${s.name}`, `<!-- zukai:section id="${s.id}" -->`, '', template.sample.sections?.[s.id] ?? '', '');
  return parts.join('\n');
}

/** The sample of a template rendered through its layout, as a report would be. */
export function previewHtml(template, { now = new Date() } = {}) {
  const meta = { report: 1, title: template.sample.title, kind: template.kind, template: { id: template.id, scope: template.scope ?? 'user', version: template.version }, lang: template.lang, runs: [], sources: [], created: now.toISOString(), updated: now.toISOString() };
  return pourReport({ markdown: sampleMarkdown(template), meta, lang: template.lang, layout: template.html, sectionsInfo: template.sections, extraMeta: Object.entries(template.sample.meta ?? {}) });
}

/** `template preview`: the sample of the template the id resolves to, rendered. */
export function previewTemplate(root, id, { scope, ...opts } = {}) {
  const r = resolveTemplate(root, id, { scope, ...opts });
  if (!r.ok) return r;
  return { ok: true, id, scope: r.template.scope, html: previewHtml(r.template) };
}

// ---------------------------------------------------------------- write

/**
 * The folder of a writable scope, or a refusal: neither the scope's base (`.zukai/` or the
 * Zukai home) nor `report-templates/` may be a link, and the real path must be the expected
 * one, so a clone that ships `.zukai/report-templates` as a link to another folder never
 * gets a template written, or a folder replaced, there.
 */
function writableScope(root, scope, opts) {
  const base = scope === 'project' ? zukaiDir(root) : indexHome(opts.env ?? process.env);
  const dir = join(base, 'report-templates');
  const link = (path) => { try { return lstatSync(path).isSymbolicLink(); } catch { return false; } };
  if (link(base) || link(dir)) return { error: fail('bad-request', `${link(base) ? base : dir} is a link; templates are written only into a real folder`, 'remove the link by hand') };
  mkdirSync(dir, { recursive: true });
  if (realpathSync(dir) !== join(realpathSync(base), 'report-templates')) return { error: fail('bad-request', `${dir} does not lead where it should`, 'remove the link by hand') };
  return { dir };
}

/** Run `fn` under the lock of a scope folder. */
function underLock(dir, fn) {
  mkdirSync(dir, { recursive: true });
  const held = takeLock(dir, LOCK_NAME);
  if (!held) return fail('locked', `the templates of ${dir} are locked by another writer`, 'try again in a few seconds');
  try {
    return fn();
  } finally {
    releaseLock(held);
  }
}

/**
 * Save a template into the user or project scope: validated, then written through a
 * temporary sibling and a rename under the scope's lock, after a real-path check that the
 * target is a direct child of the scope folder. An existing id is kept unless `replace`.
 * A built-in template is never written: customising one saves a copy here.
 */
export function saveTemplate(root, scope, files, { replace = false, ...opts } = {}) {
  if (!WRITABLE_SCOPES.includes(scope)) return fail('bad-request', scope === 'built-in' ? 'built-in templates are never written; save a copy to the user or project scope' : `--scope takes ${WRITABLE_SCOPES.join(' or ')}`);
  const v = validateTemplate(files);
  if (!v.ok) return { ok: false, code: 'invalid-template', errors: v.errors };
  const id = v.template.id;
  if (scope === 'project') ensureZukaiDir(root);
  const scoped = writableScope(root, scope, opts);
  if (scoped.error) return scoped.error;
  const { dir } = scoped;
  return underLock(dir, () => {
    const realDir = realpathSync(dir);
    const target = join(dir, id);
    if (existsSync(target) || isRealDir(target)) {
      let st;
      try { st = lstatSync(target); } catch { st = undefined; }
      if (st && !st.isDirectory()) return fail('bad-request', `${target} exists and is not a folder`, 'remove it by hand');
      if (st && dirname(realpathSync(target)) !== realDir) return fail('bad-request', `${target} leads out of ${dir}`, 'remove the link by hand');
      if (!replace) return fail('exists', `a template ${id} already exists in the ${scope} scope`, 'pass --replace to replace it');
    }
    const tmp = join(dir, `.${id}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`);
    mkdirSync(tmp);
    for (const f of TEMPLATE_FILES) writeFileSync(join(tmp, f), files[f]);
    if (dirname(realpathSync(tmp)) !== realDir) { rmSync(tmp, { recursive: true, force: true }); return fail('bad-request', `${dir} changed while the template was written`); }
    let replaced = false;
    if (isRealDir(target)) {
      const old = join(dir, `.${id}.old-${process.pid}-${randomBytes(4).toString('hex')}`);
      renameSync(target, old);
      renameSync(tmp, target);
      rmSync(old, { recursive: true, force: true });
      replaced = true;
    } else renameSync(tmp, target);
    return { ok: true, id, scope, path: target, replaced };
  });
}

/** `template save <folder>`: the files of a folder (real files only), saved into a scope. */
export function saveTemplateFolder(root, folder, scope, options = {}) {
  if (!isRealDir(folder)) return fail('bad-request', `no such folder: ${folder}`);
  return saveTemplate(root, scope, readFolder(resolve(folder)), options);
}

/** `template validate <folder>`: the validation of a folder's files and, when valid, the preview of its sample; writes nothing. */
export function validateFolder(folder) {
  if (!isRealDir(folder)) return fail('bad-request', `no such folder: ${folder}`);
  const v = validateTemplate(readFolder(resolve(folder)));
  return v.ok ? { ok: true, id: v.template.id, name: v.template.name, sections: v.template.sections, preview: previewHtml(v.template) } : { ok: false, code: 'invalid-template', errors: v.errors };
}

/** The export file of a template: `{ zukaiTemplate: 1, id, name, version, exported, files }`. */
export function exportTemplate(root, id, { scope, now = new Date(), ...opts } = {}) {
  const r = resolveTemplate(root, id, { scope, ...opts });
  if (!r.ok) return r;
  const t = r.template;
  const data = { zukaiTemplate: 1, id: t.id, name: t.name, version: t.version, exported: now.toISOString(), files: Object.fromEntries(TEMPLATE_FILES.map((f) => [f, t.files[f]])) };
  return { ok: true, id: t.id, scope: t.scope, fileName: `${t.id}${EXPORT_SUFFIX}`, text: `${JSON.stringify(data, null, 2)}\n` };
}

/**
 * Import an export file into a scope. The whole file is validated before anything is written;
 * an existing id is refused without `replace`; with `check` nothing is written and the result
 * carries the validation and the preview.
 */
export function importTemplate(root, text, { scope, replace = false, check = false, ...opts } = {}) {
  if (!check && !WRITABLE_SCOPES.includes(scope)) return fail('bad-request', `import needs --scope ${WRITABLE_SCOPES.join(' or ')}`);
  if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_EXPORT) return fail('invalid-template', `the export file is larger than ${MAX_EXPORT / 1024} KB or not text`);
  let data;
  try { data = JSON.parse(text); } catch { return fail('invalid-template', 'the export file is not valid JSON'); }
  const errors = schemaErrors('exportFile', data, '');
  if (errors.length > 0) return { ok: false, code: 'invalid-template', errors };
  if (RESERVED.test(data.id)) return fail('invalid-template', `"${data.id}" is a name Windows reserves for a device`);
  const v = validateTemplate(data.files, { id: data.id });
  if (!v.ok) return { ok: false, code: 'invalid-template', errors: v.errors };
  const existing = WRITABLE_SCOPES.includes(scope) ? readTemplate(root, scope, data.id, opts) : undefined;
  if (check) return { ok: true, check: true, id: data.id, name: v.template.name, sections: v.template.sections, exists: existing !== undefined, preview: previewHtml(v.template) };
  if (existing && !replace) return fail('exists', `a template ${data.id} already exists in the ${scope} scope`, 'pass --replace to replace it');
  const saved = saveTemplate(root, scope, data.files, { replace, ...opts });
  return saved.ok ? { ...saved, replaced: saved.replaced } : saved;
}

/** `template show`: one template's files and validity, the nearest scope or the one named. */
export function showTemplate(root, id, { scope, ...opts } = {}) {
  if (typeof id !== 'string' || !ID_RE.test(id)) return fail('bad-request', `"${id}" is not a template id`);
  for (const s of scope ? [scope] : SCOPES) {
    const t = readTemplate(root, s, id, opts);
    if (!t) continue;
    const files = readFolder(t.path);
    return { ok: true, id, scope: s, path: t.path, valid: t.valid, errors: t.errors, ...(t.valid ? { name: t.template.name, kind: t.template.kind, lang: t.template.lang, version: t.template.version, description: t.template.description, sections: t.template.sections } : {}), files };
  }
  return fail('not-found', `no template ${id}${scope ? ` in the ${scope} scope` : ''}`);
}

// ---------------------------------------------------------------- rendering a report

/**
 * The template a report was written with: its recorded scope first, else the nearest scope
 * that has the id; none (with a warning) when no valid one is found, and the report is then
 * rendered with the default layout.
 */
export function templateOfReport(root, meta, opts = {}) {
  const recorded = resolveTemplate(root, meta.template.id, { scope: meta.template.scope, ...opts });
  if (recorded.ok) return { template: recorded.template };
  const nearest = resolveTemplate(root, meta.template.id, opts);
  if (nearest.ok) return { template: nearest.template, warning: `template ${meta.template.id} is not in the ${meta.template.scope} scope any more; the ${nearest.template.scope} one was used` };
  return { warning: `template ${meta.template.id} cannot be used (${nearest.errors?.[0]?.message ?? 'not found'}); the report was rendered with the default layout` };
}

/** Render a report through its template (`renderReport`), with the template's warning when there is one. */
export function renderWithTemplate(dir, root, meta, { viewerBase, ...opts } = {}) {
  const t = templateOfReport(root, meta, opts);
  const result = renderReport(dir, { root, template: t.template, viewerBase });
  return { ...result, ...(t.warning ? { warning: t.warning } : {}) };
}
