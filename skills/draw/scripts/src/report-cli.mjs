/**
 * The CLI commands of reports and report templates: `reports-dir`, `report ...` and
 * `template ...`. Each prints one JSON object on stdout; an error goes to stderr as JSON with
 * exit 1, and a blocking finding of `report check` or `report render` exits 2.
 *
 * A command that takes a report folder works in the project that owns it (`--root`, else the
 * nearest project whose reports folder holds it); a bad `reportsDir` there stops it with
 * `bad-config` before anything is written. Run commands never read the reports part of the
 * setting, so they are untouched by it.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { projectRoot, readGlossary } from './glossary.mjs';
import { readProjectConfig, setReportsDir, reportsPath, projectOfReport } from './project-config.mjs';
import { registerProject } from './run-index.mjs';
import { portFor } from './labs-lifecycle.mjs';
import {
  newReport, listReports, readReport, snapshotReport, restoreReport, reportRevisions, diffReport,
  newDraft, applyDraft, discardDraft, checkReport, reportFoldersIn, REPORT_FILE, REPORT_KEEP, LANG_RE,
} from './reports.mjs';
import {
  listTemplates, resolveTemplate, showTemplate, previewTemplate, validateFolder, saveTemplateFolder, exportTemplate,
  importTemplate, renderWithTemplate, SCOPES, WRITABLE_SCOPES, MAX_EXPORT,
} from './report-templates.mjs';

const out = (value) => { process.stdout.write(`${JSON.stringify(value)}\n`); return 0; };
const err = (code, value) => { process.stderr.write(`${JSON.stringify(value)}\n`); return code; };
const bad = (message, hint) => err(1, { ok: false, error: { code: 'bad-request', message, ...(hint ? { hint } : {}) } });
const failed = (result) => err(1, { ok: false, error: { code: result.code ?? 'error', message: result.errors?.[0]?.message ?? 'failed', ...(result.errors?.[0]?.hint || result.hint ? { hint: result.errors?.[0]?.hint ?? result.hint } : {}), ...(result.rev ? { rev: result.rev } : {}) }, errors: result.errors ?? [] });

/** The reports part of a project's setting, or the exit of a `bad-config` error. */
function reportsConfig(root) {
  const config = readProjectConfig(root);
  if (!config.reports.ok) return { exit: err(1, { ok: false, error: config.reports.error.toJSON() }) };
  return { config };
}

/**
 * The report folder a command was given and its project: `{ dir, root, meta }`, or `{ exit }`.
 * Without `--root`, the project is the one whose reports folder holds the report.
 */
function reportTarget(path, opts) {
  if (typeof path !== 'string') return { exit: bad('pass a report folder, <reportsDir>/<yyyymmdd>_<slug>') };
  const dir = resolve(path);
  let root = opts.root === undefined ? undefined : projectRoot(opts.root);
  if (root === undefined) {
    try {
      root = projectOfReport(dir);
    } catch (e) {
      if (e?.code === 'bad-config') return { exit: err(1, { ok: false, error: e.toJSON() }) };
      throw e;
    }
  }
  if (root === undefined) return { exit: bad(`${dir} is in no reports folder of a project`, 'pass --root <project>, or the report folder under the project\'s reports folder (reports-dir prints it)') };
  const cfg = reportsConfig(root);
  if (cfg.exit !== undefined) return cfg;
  const read = readReport(dir);
  if (!read.ok) return { exit: failed(read) };
  return { dir, root, meta: read.meta };
}

/** Render a report through its template; the result for the output. */
const render = (dir, root, meta) => renderWithTemplate(dir, root, meta, { viewerBase: `http://127.0.0.1:${portFor(root)}/` });

/** `reports-dir` and `reports-dir set <folder>`: the project's reports folder. */
export function reportsDirCommand(opts, usage) {
  const root = projectRoot(opts.root);
  if (opts.positional.length === 0) {
    const config = readProjectConfig(root);
    if (!config.reports.ok) return err(1, { ok: false, error: config.reports.error.toJSON() });
    const path = reportsPath(root);
    out({ ok: true, root, reportsDir: config.reports.dir, path, from: config.reports.from });
    if (reportFoldersIn(path).length > 0) registerProject(root);
    return 0;
  }
  if (opts.positional[0] !== 'set') return err(1, { ok: false, error: { code: 'bad-request', message: `unknown command "reports-dir ${opts.positional[0]}"; reports-dir takes set <folder>, or nothing to print the folder` }, usage });
  if (opts.positional.length !== 2) return bad('reports-dir set takes one folder, relative to the project root');
  if (!existsSync(root) || !statSync(root).isDirectory()) return bad(`no such project folder: ${root}`);
  const result = setReportsDir(root, opts.positional[1]);
  if (!result.ok) return err(1, { ok: false, error: result.error.toJSON() });
  out({ ok: true, root, reportsDir: result.reportsDir, previous: result.previous, file: result.file, ...(result.foldersLeftIn ? { foldersLeftIn: result.foldersLeftIn } : {}) });
  registerProject(root);
  return 0;
}

/** `report new|list|revisions|snapshot|restore|diff|render|check|draft|apply|discard`. */
export function reportCommand(opts) {
  const sub = opts.command.split(' ')[1];
  const p = opts.positional;
  if (sub === 'new') {
    if (p.length !== 0) return bad('report new takes no folder: --template, --title and the options name the report');
    if (!opts.template) return bad('report new needs --template <id>', 'template list prints the templates');
    if (!opts.title) return bad('report new needs --title <text>');
    if (opts.scope !== undefined && !SCOPES.includes(opts.scope)) return bad(`unknown scope "${opts.scope}"`, `--scope takes ${SCOPES.join(', ')}`);
    const root = projectRoot(opts.root);
    const cfg = reportsConfig(root);
    if (cfg.exit !== undefined) return cfg.exit;
    const t = resolveTemplate(root, opts.template, { scope: opts.scope });
    if (!t.ok) return failed(t);
    const lang = opts.lang ?? t.template.lang;
    if (!LANG_RE.test(lang)) return bad(`"${lang}" is not a language tag`, 'a language is a BCP 47 tag such as en, ja, vi, en-GB');
    const runs = opts.runs === undefined ? [] : opts.runs.split(',').map((r) => r.trim()).filter(Boolean);
    const result = newReport({ root, template: t.template, kind: opts.kind, title: opts.title, lang, runs, sources: opts.sources });
    if (!result.ok) return failed(result);
    out({ ok: true, name: result.name, path: result.dir, file: join(result.dir, REPORT_FILE), template: result.meta.template, lang, sections: t.template.sections });
    registerProject(root);
    return 0;
  }
  if (sub === 'list') {
    if (p.length !== 0) return bad('report list takes no folder');
    const root = projectRoot(opts.root);
    const cfg = reportsConfig(root);
    if (cfg.exit !== undefined) return cfg.exit;
    return out({ ok: true, root, reportsDir: cfg.config.reports.dir, reports: listReports(root) });
  }
  if (sub === 'check') {
    if (p.length === 0) return bad('report check takes at least one report folder');
    const reports = [];
    let glossary;
    let glossaryState = 'missing';
    for (const path of p) {
      const target = reportTarget(path, opts);
      if (target.exit !== undefined) return target.exit;
      if (glossary === undefined && glossaryState === 'missing') {
        const read = readGlossary(target.root);
        if (!read.ok) return err(1, { ok: false, path: read.path, errors: read.errors });
        if (read.exists) { glossary = read.glossary; glossaryState = 'checked'; }
      }
      const r = checkReport(target.dir, glossary);
      if (!r.ok) return failed(r);
      reports.push(r);
    }
    const findings = reports.flatMap((r) => r.findings);
    const blocking = findings.filter((f) => f.level === 'blocking').length;
    out({ ok: blocking === 0, blocking, warnings: findings.length - blocking, glossary: glossaryState, reports: reports.map(({ findings: _, ok, ...r }) => r), findings });
    return blocking > 0 ? 2 : 0;
  }
  const target = reportTarget(p[0], opts);
  if (target.exit !== undefined) return target.exit;
  const { dir, root, meta } = target;
  if (sub === 'revisions') {
    if (p.length !== 1) return bad('report revisions takes one report folder');
    return out({ ok: true, report: basename(dir), revisions: reportRevisions(dir) });
  }
  if (sub === 'snapshot') {
    if (p.length !== 1) return bad('report snapshot takes one report folder');
    const keep = opts.keep === undefined ? REPORT_KEEP : Number(opts.keep);
    const result = snapshotReport(dir, { request: opts.request ?? '', keep });
    if (!result.ok) return failed(result);
    return out({ ok: true, report: basename(dir), rev: result.rev, files: result.files, removed: result.removed });
  }
  if (sub === 'restore') {
    if (p.length !== 2) return bad('report restore takes a report folder and a revision (rNNN)', 'report revisions lists them');
    const result = restoreReport(dir, p[1], { request: opts.request });
    if (!result.ok) return failed(result);
    const rendered = render(dir, root, readReport(dir).meta);
    return out({ ok: true, report: basename(dir), ...result, rendered: rendered.ok ? rendered.written : [], ...(rendered.ok ? {} : { renderErrors: rendered.errors }), ...(rendered.warning ? { warning: rendered.warning } : {}) });
  }
  if (sub === 'diff') {
    if (p.length !== 3) return bad('report diff takes a report folder and two sides: current, a revision (rNNN) or a draft (polish-<n>)');
    const result = diffReport(dir, p[1], p[2], { lang: opts.lang });
    if (!result.ok) return failed(result);
    return out({ ...result, report: basename(dir) });
  }
  if (sub === 'render') {
    if (p.length !== 1) return bad('report render takes one report folder');
    const result = render(dir, root, meta);
    if (!result.ok) {
      err(2, { ok: false, code: result.code, errors: result.errors, findings: result.findings ?? [] });
      return 2;
    }
    const warnings = result.findings.filter((f) => f.level !== 'blocking');
    return out({ ok: true, report: basename(dir), written: result.written.map((f) => join(dir, ...f.split('/'))), html: join(dir, 'report.html'), warnings, ...(result.warning ? { warning: result.warning } : {}) });
  }
  if (sub === 'draft') {
    if (p.length !== 1) return bad('report draft takes one report folder and --file <draft.md> --base-rev <rev>');
    if (opts.file === undefined || opts.baseRev === undefined) return bad('report draft needs --file <draft.md> and --base-rev <rev>', 'report check prints the rev of report.md it read');
    let text;
    try { text = readFileSync(resolve(opts.file), 'utf8'); } catch (e) { return bad(`cannot read ${opts.file}: ${e.code ?? 'error'}`); }
    let findings = [];
    if (opts.findings !== undefined) {
      try { findings = JSON.parse(readFileSync(resolve(opts.findings.replace(/^@/, '')), 'utf8')); } catch { return bad('the --findings file is not valid JSON', 'pass the findings of report check, as a JSON array'); }
      if (!Array.isArray(findings)) return bad('the --findings file holds a JSON array');
    }
    const result = newDraft(dir, { text, baseRev: opts.baseRev, findings });
    if (!result.ok) return failed(result);
    return out({ ok: true, report: basename(dir), draft: result.draft, file: join(dir, 'drafts', `${result.draft}.md`), baseRev: result.baseRev, draftRev: result.draftRev });
  }
  if (sub === 'apply') {
    if (p.length !== 2) return bad('report apply takes a report folder and a draft (polish-<n>)');
    const result = applyDraft(dir, p[1], { baseRev: opts.baseRev, draftRev: opts.draftRev });
    if (!result.ok) return failed(result);
    const rendered = render(dir, root, readReport(dir).meta);
    return out({ ok: true, report: basename(dir), ...result, rendered: rendered.ok ? rendered.written : [], ...(rendered.ok ? {} : { renderErrors: rendered.errors }) });
  }
  if (sub === 'discard') {
    if (p.length !== 2) return bad('report discard takes a report folder and a draft (polish-<n>)');
    const result = discardDraft(dir, p[1]);
    if (!result.ok) return failed(result);
    return out({ ok: true, report: basename(dir), ...result });
  }
  return bad(`unknown command "report ${sub}"`);
}

/** `template list|show|preview|validate|save|export|import`. */
export function templateCommand(opts) {
  const sub = opts.command.split(' ')[1];
  const p = opts.positional;
  const root = projectRoot(opts.root);
  if (opts.scope !== undefined && !SCOPES.includes(opts.scope)) return bad(`unknown scope "${opts.scope}"`, `--scope takes ${SCOPES.join(', ')}`);
  if (sub === 'list') {
    if (p.length !== 0) return bad('template list takes no argument');
    return out(listTemplates(root));
  }
  if (sub === 'show') {
    if (p.length !== 1) return bad('template show takes one template id');
    const r = showTemplate(root, p[0], { scope: opts.scope });
    return r.ok ? out(r) : failed(r);
  }
  if (sub === 'preview') {
    if (p.length !== 1 || !opts.out) return bad('template preview takes one template id and --out <file.html>');
    const r = previewTemplate(root, p[0], { scope: opts.scope });
    if (!r.ok) return failed(r);
    const file = resolve(opts.out);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, r.html);
    return out({ ok: true, id: r.id, scope: r.scope, out: file });
  }
  if (sub === 'validate') {
    if (p.length !== 1) return bad('template validate takes one template folder');
    const r = validateFolder(p[0]);
    if (!r.ok) { err(2, { ok: false, code: r.code, errors: r.errors }); return 2; }
    const { preview, ...rest } = r;
    let previewFile;
    if (opts.out) { previewFile = resolve(opts.out); mkdirSync(dirname(previewFile), { recursive: true }); writeFileSync(previewFile, preview); }
    return out({ ...rest, ...(previewFile ? { preview: previewFile } : {}) });
  }
  if (sub === 'save') {
    if (p.length !== 1) return bad('template save takes one template folder and --scope user|project');
    if (!WRITABLE_SCOPES.includes(opts.scope)) return bad(`template save needs --scope ${WRITABLE_SCOPES.join(' or ')}`, 'built-in templates are never written; a customised one is saved as a copy');
    const r = saveTemplateFolder(root, p[0], opts.scope, { replace: opts.replace });
    if (!r.ok && r.code === 'invalid-template') { err(2, { ok: false, code: r.code, errors: r.errors }); return 2; }
    return r.ok ? out(r) : failed(r);
  }
  if (sub === 'export') {
    if (p.length !== 1) return bad('template export takes one template id');
    const r = exportTemplate(root, p[0], { scope: opts.scope });
    if (!r.ok) return failed(r);
    let file = resolve(opts.out ?? r.fileName);
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, r.fileName);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, r.text);
    return out({ ok: true, id: r.id, scope: r.scope, out: file });
  }
  if (sub === 'import') {
    if (p.length !== 1) return bad('template import takes one export file (<id>.zukai-template.json)');
    if (!opts.check && !WRITABLE_SCOPES.includes(opts.scope)) return bad(`template import needs --scope ${WRITABLE_SCOPES.join(' or ')}`);
    let text;
    try {
      if (statSync(resolve(p[0])).size > MAX_EXPORT) return bad(`the export file is larger than ${MAX_EXPORT / 1024} KB`);
      text = readFileSync(resolve(p[0]), 'utf8');
    } catch (e) {
      return bad(`cannot read ${p[0]}: ${e.code ?? 'error'}`);
    }
    const r = importTemplate(root, text, { scope: opts.scope, replace: opts.replace, check: opts.check });
    if (!r.ok && r.code === 'invalid-template') { err(2, { ok: false, code: r.code, errors: r.errors }); return 2; }
    if (!r.ok) return failed(r);
    if (r.check) {
      const { preview, ...rest } = r;
      let previewFile;
      if (opts.out) { previewFile = resolve(opts.out); mkdirSync(dirname(previewFile), { recursive: true }); writeFileSync(previewFile, preview); }
      return out({ ...rest, ...(previewFile ? { preview: previewFile } : {}) });
    }
    return out(r);
  }
  return bad(`unknown command "template ${sub}"`);
}


