/**
 * What the labs console reads about the reports of a project and its report templates: the
 * report folders under its reports folder (`reports/` unless `.zukai/config.json` names
 * another), one report with its revisions, translations, drafts and glossary findings, its
 * Markdown with its rev, its rendered HTML, a diff, and the templates of every scope. It
 * writes only the two report contents the server may write (the quick edit and a restore) and
 * a template import; every other change of a report is a job for the agent.
 *
 * Every name a caller passes (a report, a language, a revision, a draft, a scope, a template
 * id) is looked up in a listing built from the real folders, never joined into a path. A bad
 * `reportsDir` throws its `ConfigError` here, which the server answers with 409 on the report
 * routes, while the run routes keep working.
 */
import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readGlossary } from './glossary.mjs';
import {
  reportNames, reportPath, readReport, reportSummary, reportRevisions, reportDrafts, translationLangs, sourceFile, textRev, checkReport,
  diffReport, writeSource, restoreReport, discardDraft, draftNames, REPORT_FILE, REPORT_HTML,
} from './reports.mjs';
import { revisionDirs } from './revisions.mjs';
import { listTemplates, renderWithTemplate, SCOPES } from './report-templates.mjs';
import { reportsPath } from './project-config.mjs';

const isRealFile = (path) => { try { return lstatSync(path).isFile(); } catch { return false; } };
/** A plain file read, never through a link; undefined otherwise. */
const readReal = (path, encoding) => (isRealFile(path) ? readFileSync(path, encoding) : undefined);

/** The confirmed glossary of a project, or undefined when it has none or cannot be read. */
function glossaryOf(root) {
  const read = readGlossary(root);
  return read.ok && read.exists ? read.glossary : undefined;
}

/** The counts of a report's findings: `{ blocking, warnings }`. */
function counts(findings) {
  const blocking = findings.filter((f) => f.level === 'blocking').length;
  return { blocking, warnings: findings.length - blocking };
}

/** The reports of a project, newest first, each with its findings counted. */
export function consoleReports(root) {
  const glossary = glossaryOf(root);
  const base = reportsPath(root);
  return reportNames(root).map((name) => {
    const dir = join(base, name);
    const check = checkReport(dir, glossary);
    // A report folder without its report.md is listed as broken, never a reason to fail the list.
    return { ...reportSummary(dir), findings: check.ok ? counts(check.findings) : { blocking: 0, warnings: 0 }, ...(check.ok ? {} : { broken: check.errors?.[0]?.message ?? 'cannot be read' }) };
  });
}

/** The folder of a report named in the listing, or undefined. */
export const reportDirOf = (root, name) => reportPath(root, name);

/** One report: its record, revisions, translations, drafts and findings. */
export function consoleReport(root, name) {
  const dir = reportPath(root, name);
  if (!dir) return undefined;
  const read = readReport(dir);
  const glossary = glossaryOf(root);
  const check = checkReport(dir, glossary);
  return {
    name,
    meta: read.meta,
    translations: translationLangs(dir),
    revisions: reportRevisions(dir),
    drafts: reportDrafts(dir),
    rendered: { html: existsHtml(dir) },
    rev: check.ok ? check.rev : null,
    glossary: glossary ? 'checked' : 'missing',
    findings: check.ok ? check.findings : [],
    counts: check.ok ? counts(check.findings) : { blocking: 0, warnings: 0 },
    ...(check.ok ? {} : { broken: check.errors?.[0]?.message ?? 'cannot be read' }),
  };
}

const existsHtml = (dir) => isRealFile(join(dir, REPORT_HTML));

/** A language of the query, looked up in the report's translations; null for the original. */
export function langOf(dir, lang) {
  if (lang === null || lang === undefined || lang === '') return { ok: true, lang: null };
  return translationLangs(dir).includes(lang) ? { ok: true, lang } : { ok: false };
}

/** The Markdown of a report or of a translation, and its rev. */
export function consoleSource(dir, lang) {
  const bytes = readReal(sourceFile(dir, lang));
  if (bytes === undefined) return undefined;
  return { lang: lang ?? null, text: bytes.toString('utf8'), rev: textRev(bytes) };
}

/** The rendered HTML of a report or of a translation, as data for the sealed frame; undefined when not rendered. */
export function consoleHtml(dir, lang) {
  const html = readReal(lang ? join(dir, lang, REPORT_HTML) : join(dir, REPORT_HTML), 'utf8');
  return html === undefined ? undefined : { lang: lang ?? null, html };
}

/** The sides a diff may name: `current`, the revisions and the drafts of the listings. */
export function diffSides(dir) {
  return ['current', ...revisionDirs(dir).map((r) => r.rev), ...draftNames(dir)];
}

/** A diff of two sides named in the listings. */
export const consoleDiff = (dir, from, to, lang) => diffReport(dir, from, to, { lang: lang ?? undefined });

/** A file of a report to download: `report.md` or `report.html`, of the original or a translation. */
export function downloadOf(dir, format, lang) {
  const name = format === 'md' ? REPORT_FILE : format === 'html' ? REPORT_HTML : undefined;
  if (!name) return undefined;
  const raw = readReal(lang ? join(dir, lang, name) : join(dir, name));
  return raw === undefined ? undefined : { raw, name: `${dir.split(/[\\/]/).pop()}${lang ? `.${lang}` : ''}.${format}` };
}

/** The quick edit: write, then render again through the template. */
export function quickEdit(root, dir, { lang, text, rev }, viewerBase) {
  const result = writeSource(dir, { lang: lang ?? undefined, text, rev });
  if (!result.ok) return result;
  const rendered = renderWithTemplate(dir, root, readReport(dir).meta, { viewerBase });
  return { ...result, rendered: rendered.ok ? rendered.written : [], ...(rendered.ok ? {} : { renderErrors: rendered.errors }) };
}

/** A restore from the console: snapshot, put the revision back, render again. */
export function consoleRestore(root, dir, revision, viewerBase) {
  const result = restoreReport(dir, revision, { request: `restore ${revision} from the console` });
  if (!result.ok) return result;
  const rendered = renderWithTemplate(dir, root, readReport(dir).meta, { viewerBase });
  return { ...result, rendered: rendered.ok ? rendered.written : [] };
}

export { discardDraft };

/** The templates of every scope as the console lists them. */
export function consoleTemplates(root) {
  return listTemplates(root);
}

/** A scope of the query, looked up in the three names. */
export const scopeOf = (scope) => (scope === null || scope === undefined || scope === '' ? { ok: true, scope: undefined } : SCOPES.includes(scope) ? { ok: true, scope } : { ok: false });
