/**
 * The project glossary, `.zukai/glossary.json`: preferred terms per language for the labels
 * of a project's diagrams, with the words to avoid for each. Entries are symmetric (no
 * language is the source of another) and carry a status: a `suggested` entry is shown and
 * never applied, a `confirmed` one is applied by every skill and checked by `glossary check`,
 * a `rejected` one is kept so the same suggestion is not made again.
 *
 * The file is committed and read by every teammate's agent, so its text is an input from
 * outside: a term or a note is bounded in length, holds no control or direction character
 * and nothing the secret scan finds, personal data included. It is written sorted, as
 * two-space JSON with LF and a final newline, so a change reads well in a diff.
 *
 * Two writers (the CLI and the labs server) take `.zukai/glossary.lock` before they write;
 * the file is read again inside the lock, changed, validated, written to a temporary
 * sibling and renamed. `rev` is the SHA-256 of the file's bytes: a writer that read an older
 * file gets a conflict and changes nothing.
 *
 * The project root is `--root`, else the working directory; `.zukai/` lies directly under it,
 * and so does the runs folder unless `.zukai/config.json` names another (`project-config.mjs`).
 */
import { closeSync, existsSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync, writeSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020.js';
import schema from './schema/glossary-v1.schema.json' with { type: 'json' };
import { scanSecrets, redactText } from './scan-secrets.mjs';
import { labelsOf, textAt } from './ir-labels.mjs';
import { orderIrFiles, runSlugOf } from './run-order.mjs';
import { runFolderPattern } from './project-config.mjs';

export const STATUSES = ['suggested', 'confirmed', 'rejected'];
export const GLOSSARY_FILE = 'glossary.json';
const LOCK_FILE = 'glossary.lock';
const LOCK_WAIT_MS = 5000;
const LOCK_STALE_MS = 30_000;
const LANG_RE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

/** The project root: `--root`, else the working directory. */
export const projectRoot = (root) => resolve(root ?? process.cwd());
export const zukaiDir = (root) => join(projectRoot(root), '.zukai');
export const glossaryPath = (root) => join(zukaiDir(root), GLOSSARY_FILE);

/**
 * Create `.zukai/` when it is missing, with a `.gitignore` that keeps the console's state and
 * the lock out of git; the glossary itself is committed.
 */
export function ensureZukaiDir(root) {
  const dir = zukaiDir(root);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const ignore = join(dir, '.gitignore');
  if (!existsSync(ignore)) writeFileSync(ignore, 'labs/\nglossary.lock\n');
  return dir;
}

// ---------------------------------------------------------------- comparison

/** A text as two texts are compared: NFKC, lower case, white space collapsed. Diacritics stay. */
export const normalText = (text) => String(text).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const WORD = /[\p{L}\p{N}\p{M}]/u;

/** The label and the term are the same text. */
export const sameText = (label, term) => normalText(label) === normalText(term);

/**
 * The term stands in the label: between characters that are not letters or digits, or, for
 * a term written in Han, Hiragana or Katakana, anywhere (those scripts are written without
 * spaces). `office` is contained in `Back-office system`, not in `offices`.
 */
export function containsText(label, term) {
  const l = normalText(label);
  const t = normalText(term);
  if (t === '') return false;
  if (CJK.test(t)) return l.includes(t);
  for (let at = l.indexOf(t); at >= 0; at = l.indexOf(t, at + 1)) {
    const before = at === 0 ? '' : [...l.slice(0, at)].at(-1);
    const after = [...l.slice(at + t.length)][0] ?? '';
    if (!(before && WORD.test(before)) && !(after && WORD.test(after))) return true;
  }
  return false;
}

// ---------------------------------------------------------------- prose

const isCjk = (ch) => ch !== '' && CJK.test(ch);

/**
 * Whether the character beside a match ends it as a word, in prose: it is no letter or digit,
 * or the script changes there (Latin next to Han, Hiragana or Katakana), since Japanese prose
 * writes a Latin word straight against the kana around it (`officeを使う`).
 */
const proseEdge = (neighbour, edge) => !neighbour || !WORD.test(neighbour) || isCjk(neighbour) !== isCjk(edge);

/**
 * The spans `[start, end)` of a term in a normalised prose text: anywhere for a term written in
 * Han, Hiragana or Katakana, else between prose word edges.
 */
function proseSpans(text, term) {
  const spans = [];
  if (term === '') return spans;
  const cjk = CJK.test(term);
  for (let at = text.indexOf(term); at >= 0; at = text.indexOf(term, at + 1)) {
    if (!cjk) {
      const before = at === 0 ? '' : [...text.slice(0, at)].at(-1);
      const after = [...text.slice(at + term.length)][0] ?? '';
      if (!proseEdge(before, [...term][0]) || !proseEdge(after, [...term].at(-1))) continue;
    }
    spans.push([at, at + term.length]);
  }
  return spans;
}

/** The term stands in a text of prose (see `proseEdge`), compared as `normalText` compares. */
export function containsProse(text, term) {
  return proseSpans(normalText(text), normalText(term)).length > 0;
}

/** A normalised text with the spans of some terms blanked out, so a word inside them is never matched. */
function masked(text, terms) {
  let out = text;
  for (const term of terms) {
    for (const [a, b] of proseSpans(out, normalText(term))) out = `${out.slice(0, a)}${' '.repeat(b - a)}${out.slice(b)}`;
  }
  return out;
}

const termOf = (entry, lang) => Object.entries(entry.terms).find(([k]) => k.toLowerCase() === String(lang).toLowerCase())?.[1];
const avoidOf = (entry, lang) => Object.entries(entry.avoid ?? {}).find(([k]) => k.toLowerCase() === String(lang).toLowerCase())?.[1] ?? [];

/**
 * Entries whose avoided word is part of their own term in the same language: refused for a
 * new entry, listed as a warning for one written before the rule existed.
 */
export function selfAvoided(entry) {
  const out = [];
  for (const [lang, words] of Object.entries(entry.avoid ?? {})) {
    const term = termOf(entry, lang);
    if (term === undefined) continue;
    for (const word of words) if (sameText(term, word) || containsProse(term, word)) out.push({ lang, word, term });
  }
  return out;
}

/**
 * Check the prose of a report against the confirmed entries of a glossary. `prose` is what
 * `proseOf` returns: `meta.lang` is the language of `report.md`, `files` the original and each
 * translation with its language, `blocks` every checkable block with its file, section, line,
 * language and text.
 *
 * - `avoided-term` (blocking): a block holds a confirmed entry's avoided word for its language,
 *   outside the entry's own term (`サーバー` never matches the avoided `サーバ`).
 * - `untranslated-term` (warning): a block in language L holds an entry's term of another
 *   language whose term for L is different text. A term that is the same text in both
 *   languages (the keep rule) never raises it.
 * - `translation-mismatch` (warning): a section of a translation whose original section holds
 *   an entry's term lacks the entry's term for the translation's language.
 * - `kept-term-changed` (blocking): an entry whose term is the same text in the original's
 *   and the translation's language stands in the original section and not in the
 *   translation's section: the term was translated where it had to be kept.
 * - `sections-differ` (blocking): a translation whose section ids differ from the original's;
 *   that file then gets no finding per term.
 */
export function checkProse(glossary, prose) {
  const confirmed = glossary.entries.filter((e) => e.status === 'confirmed');
  const findings = [];
  const add = (f) => findings.push({ report: prose.report ?? prose.blocks[0]?.report, ...f });
  const original = prose.files[0];
  const bySection = (file) => {
    const map = new Map();
    for (const b of prose.blocks.filter((x) => x.file === file)) map.set(b.section, [...(map.get(b.section) ?? []), b]);
    return map;
  };
  const skipped = new Set();
  const originalSections = prose.sections?.[original.file] ?? [];
  for (const t of prose.files.slice(1)) {
    const ids = prose.sections?.[t.file] ?? [];
    const missing = originalSections.filter((id) => !ids.includes(id));
    const extra = ids.filter((id) => !originalSections.includes(id));
    if (missing.length || extra.length || ids.join('\n') !== originalSections.join('\n')) {
      skipped.add(t.file);
      add({ kind: 'sections-differ', level: 'blocking', file: t.file, lang: t.lang, section: null, line: null, missing, extra, text: `sections of ${t.file} differ from ${original.file}` });
    }
  }
  for (const b of prose.blocks) {
    if (skipped.has(b.file)) continue;
    const text = normalText(b.text);
    for (const entry of confirmed) {
      const own = termOf(entry, b.lang);
      const free = masked(text, own === undefined ? [] : [own]);
      for (const word of avoidOf(entry, b.lang)) {
        if (proseSpans(free, normalText(word)).length === 0) continue;
        add({ kind: 'avoided-term', level: 'blocking', file: b.file, section: b.section, line: b.line, lang: b.lang, text: b.text, entry: entry.id, avoided: word, expected: own ?? null });
      }
      if (own === undefined) continue;
      for (const [other, term] of Object.entries(entry.terms)) {
        if (other.toLowerCase() === String(b.lang).toLowerCase() || sameText(term, own)) continue;
        if (proseSpans(free, normalText(term)).length === 0) continue;
        add({ kind: 'untranslated-term', level: 'warning', file: b.file, section: b.section, line: b.line, lang: b.lang, text: b.text, entry: entry.id, term, termLang: other, expected: own });
      }
    }
  }
  const origin = bySection(original.file);
  for (const t of prose.files.slice(1)) {
    if (skipped.has(t.file)) continue;
    const target = bySection(t.file);
    for (const [section, blocks] of origin) {
      const sourceText = blocks.map((b) => b.text).join('\n');
      const targetBlocks = target.get(section) ?? [];
      const targetText = targetBlocks.map((b) => b.text).join('\n');
      const line = targetBlocks[0]?.line ?? null;
      for (const entry of confirmed) {
        const from = termOf(entry, original.lang);
        const to = termOf(entry, t.lang);
        if (from === undefined || to === undefined || !containsProse(sourceText, from)) continue;
        if (sameText(from, to)) {
          if (!containsProse(targetText, from)) add({ kind: 'kept-term-changed', level: 'blocking', file: t.file, section, line, lang: t.lang, text: targetText.split('\n')[0] ?? '', entry: entry.id, expected: from });
        } else if (!containsProse(targetText, to)) {
          add({ kind: 'translation-mismatch', level: 'warning', file: t.file, section, line, lang: t.lang, text: targetText.split('\n')[0] ?? '', entry: entry.id, source: from, expected: to });
        }
      }
    }
  }
  const blocking = findings.filter((f) => f.level === 'blocking').length;
  return { ok: blocking === 0, blocking, warnings: findings.length - blocking, findings };
}

/** The id of an entry: `g-` and eight hex digits of the SHA-256 of its normalised terms. */
export function entryIdOf(terms) {
  const text = Object.keys(terms).sort().map((lang) => `${lang.toLowerCase()}=${normalText(terms[lang])}`).join('\n');
  return `g-${createHash('sha256').update(text).digest('hex').slice(0, 8)}`;
}

// ---------------------------------------------------------------- validation

let compiled;
function validator() {
  if (!compiled) compiled = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  return compiled;
}

function hintFor(e) {
  if (e.keyword === 'maxLength') return `at most ${e.params.limit} characters`;
  if (e.keyword === 'pattern' && /\/(terms|avoid)\//.test(e.instancePath)) return 'one line of text with no control or direction character';
  if (e.keyword === 'pattern' && e.instancePath.endsWith('/note')) return 'text with no line break, control or direction character';
  if (e.keyword === 'pattern' && e.instancePath.endsWith('/id')) return 'g- and eight hex digits; ids are made by glossary add';
  if (e.keyword === 'propertyNames' || (e.keyword === 'pattern' && e.instancePath === '')) return 'language keys are BCP 47 tags such as en, vi, ja, en-GB';
  if (e.keyword === 'enum') return `allowed values: ${e.params.allowedValues.join(', ')}`;
  if (e.keyword === 'additionalProperties') return `remove "${e.params.additionalProperty}"; an entry has id, terms, avoid, note and status`;
  if (e.keyword === 'required') return `add the "${e.params.missingProperty}" field`;
  return undefined;
}

/**
 * Every problem of a glossary: the schema, unique ids, and the secret scan of every text.
 * @returns {Array<{ path: string, message: string, hint?: string }>}
 */
export function glossaryErrors(glossary) {
  const validate = validator();
  const errors = [];
  if (!validate(glossary)) {
    for (const e of validate.errors ?? []) {
      // The pattern of a property name is reported once, by propertyNames.
      if (e.keyword === 'pattern' && e.propertyName !== undefined) continue;
      const hint = hintFor(e);
      errors.push({ path: e.instancePath || '/', message: e.message ?? 'invalid', ...(hint ? { hint } : {}) });
    }
    return dedupe(errors);
  }
  const seen = new Set();
  glossary.entries.forEach((entry, i) => {
    if (seen.has(entry.id)) errors.push({ path: `/entries/${i}/id`, message: `duplicate id ${entry.id}` });
    seen.add(entry.id);
    errors.push(...entryTextErrors(entry, `/entries/${i}`));
  });
  return errors;
}

function dedupe(errors) {
  const seen = new Set();
  return errors.filter((e) => {
    const key = `${e.path}|${e.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** What the secret scan finds in the texts of one entry; personal data counts. */
function entryTextErrors(entry, base) {
  const { warnings } = scanSecrets({ terms: entry.terms, avoid: entry.avoid ?? {}, note: entry.note ?? '' });
  return warnings.map((w) => ({ path: `${base}${w.path}`, message: w.message.replace(/; .*$/, ''), hint: 'a glossary holds wording only: no credential, address, telephone number or name of a person' }));
}

/** The file text of a glossary: entries sorted by id, keys in a fixed order, LF, final newline. */
export function serialize(glossary) {
  const sortObject = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
  const entries = [...glossary.entries]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((e) => ({
      id: e.id,
      terms: sortObject(e.terms),
      ...(e.avoid && Object.keys(e.avoid).length > 0 ? { avoid: sortObject(Object.fromEntries(Object.entries(e.avoid).map(([k, v]) => [k, [...v].sort()]))) } : {}),
      ...(e.note ? { note: e.note } : {}),
      status: e.status,
    }));
  return `${JSON.stringify({ schemaVersion: 1, entries }, null, 2)}\n`;
}

const revOf = (bytes) => createHash('sha256').update(bytes).digest('hex');

// ---------------------------------------------------------------- store

/**
 * Read the glossary of a project. A missing file is an empty glossary with `exists: false`
 * and `rev: null`; a file that does not parse or match the schema is an error.
 * @returns {{ ok: true, exists: boolean, path: string, rev: string | null, glossary: object } | { ok: false, code: 'invalid', path: string, errors: object[] }}
 */
export function readGlossary(root) {
  const path = glossaryPath(root);
  let bytes;
  try {
    bytes = readFileSync(path);
  } catch (e) {
    if (e.code === 'ENOENT') return { ok: true, exists: false, path, rev: null, glossary: { schemaVersion: 1, entries: [] } };
    return { ok: false, code: 'invalid', path, errors: [{ path: '/', message: `cannot read the glossary: ${e.code ?? 'error'}` }] };
  }
  let glossary;
  try {
    glossary = JSON.parse(bytes.toString('utf8'));
  } catch {
    return { ok: false, code: 'invalid', path, errors: [{ path: '/', message: 'the glossary is not valid JSON', hint: 'fix the file by hand or take it back from git' }] };
  }
  const errors = glossaryErrors(glossary);
  if (errors.length > 0) return { ok: false, code: 'invalid', path, errors };
  return { ok: true, exists: true, path, rev: revOf(bytes), glossary };
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * Take the lock: create it exclusively, waiting up to five seconds. A lock older than 30 s
 * is stale: the taker renames it to a name of its own first, which only one process can do,
 * and then creates the lock. When the lock it renamed turns out to be fresh (another taker
 * replaced the stale one in between), it is put back.
 */
export function takeLock(dir, name = LOCK_FILE) {
  const lock = join(dir, name);
  const mark = `${process.pid} ${randomBytes(8).toString('hex')}\n`;
  const until = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      const fd = openSync(lock, 'wx');
      writeSync(fd, mark);
      closeSync(fd);
      return { lock, mark };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
    if (Date.now() > until) return undefined;
    let st;
    try {
      st = lstatSync(lock);
    } catch {
      continue; // released in between: try again at once
    }
    // A link is never a lock this code made; it is left alone and the wait ends at the deadline.
    if (st.isFile() && Date.now() - st.mtimeMs > LOCK_STALE_MS) {
      const mine = `${lock}.${process.pid}-${randomBytes(4).toString('hex')}`;
      try {
        renameSync(lock, mine);
        if (Date.now() - lstatSync(mine).mtimeMs <= LOCK_STALE_MS) {
          try { linkSync(mine, lock); } catch { /* a third taker holds it now */ }
        }
        unlinkSync(mine);
      } catch {
        // another taker renamed it first
      }
      continue;
    }
    sleep(25 + Math.floor(Math.random() * 25));
  }
}

/** Release the lock only while it is still the one this writer made. */
export function releaseLock({ lock, mark }) {
  try {
    if (readFileSync(lock, 'utf8') === mark) unlinkSync(lock);
  } catch { /* already gone */ }
}

/**
 * Change the glossary under the lock. `mutate` gets a copy of the current glossary and
 * returns `{ glossary, ...result }`; without `glossary` nothing is written. The result is
 * validated before it is written. With `expectedRev` (null for "no file yet"), a file that
 * changed since it was read gives `{ ok: false, code: 'conflict' }` and is left as it is.
 */
export function writeGlossary(root, mutate, { expectedRev } = {}) {
  const dir = ensureZukaiDir(root);
  const held = takeLock(dir);
  if (!held) return { ok: false, code: 'locked', errors: [{ path: '/', message: 'the glossary is locked by another writer', hint: 'try again in a few seconds' }] };
  try {
    const current = readGlossary(root);
    if (!current.ok) return current;
    if (expectedRev !== undefined && expectedRev !== current.rev) return { ok: false, code: 'conflict', rev: current.rev, errors: [{ path: '/', message: 'the glossary changed on disk since it was read', hint: 'read it again and repeat the change' }] };
    const { glossary: next, ...result } = mutate(structuredClone(current.glossary)) ?? {};
    if (!next) return { ok: true, written: false, rev: current.rev, glossary: current.glossary, ...result };
    const errors = glossaryErrors(next);
    if (errors.length > 0) return { ok: false, code: 'invalid', errors };
    const text = serialize(next);
    const path = glossaryPath(root);
    const tmp = `${path}.${process.pid}-${randomBytes(4).toString('hex')}.tmp`;
    writeFileSync(tmp, text);
    renameSync(tmp, path);
    return { ok: true, written: true, rev: revOf(Buffer.from(text)), glossary: JSON.parse(text), ...result };
  } finally {
    releaseLock(held);
  }
}

// ---------------------------------------------------------------- add, set

/** Problems of one entry given to `add`, before it gets an id and a status. */
export function newEntryErrors(entry, base) {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return [{ path: base, message: 'an entry is an object with terms, and optionally avoid and note' }];
  const extra = Object.keys(entry).filter((k) => !['terms', 'avoid', 'note'].includes(k));
  if (extra.length > 0) return [{ path: `${base}/${extra[0]}`, message: `unknown property "${extra[0]}"`, hint: 'an entry given to glossary add has terms, avoid and note; id and status are set by the command' }];
  const probe = { schemaVersion: 1, entries: [{ id: 'g-00000000', ...entry, status: 'suggested' }] };
  const errors = glossaryErrors(probe).map((e) => ({ ...e, path: e.path.replace(/^\/entries\/0/, base) }));
  if (errors.length > 0) return errors;
  // An avoided word inside the entry's own term would flag every correct use of the term.
  return selfAvoided(entry).map((x) => ({ path: `${base}/avoid/${x.lang}`, message: `the avoided word "${x.word}" is part of the entry's own term "${x.term}"`, hint: 'avoid a word that differs from the term, or leave it out' }));
}

/** Languages two term maps share, and whether the terms of each shared language are the same text. */
function compareTerms(a, b) {
  const shared = Object.keys(a).filter((lang) => Object.hasOwn(b, lang));
  return { shared, equal: shared.filter((lang) => sameText(a[lang], b[lang])) };
}

/**
 * Add entries with a status (default `suggested`). An entry whose terms equal those of an
 * existing entry in every language the two share is skipped and reported with that entry's
 * status, a rejected one included. An entry that shares a term with a confirmed entry in one
 * language and differs from it in another is a conflict and is not written.
 */
export function addEntries(root, entries, { status = 'suggested', expectedRev } = {}) {
  const errors = entries.flatMap((e, i) => newEntryErrors(e, `/entries/${i}`));
  if (errors.length > 0) return { ok: false, code: 'invalid', errors };
  return writeGlossary(root, (glossary) => {
    const added = [];
    const skipped = [];
    const conflicts = [];
    for (const entry of entries) {
      const same = glossary.entries.find((g) => {
        const c = compareTerms(entry.terms, g.terms);
        return c.shared.length > 0 && c.equal.length === c.shared.length;
      });
      if (same) { skipped.push({ id: same.id, status: same.status, terms: same.terms }); continue; }
      const clash = glossary.entries.find((g) => {
        if (g.status !== 'confirmed') return false;
        const c = compareTerms(entry.terms, g.terms);
        return c.equal.length > 0 && c.equal.length < c.shared.length;
      });
      if (clash) { conflicts.push({ terms: entry.terms, with: { id: clash.id, terms: clash.terms } }); continue; }
      let id = entryIdOf(entry.terms);
      for (let n = 2; glossary.entries.some((g) => g.id === id); n++) id = entryIdOf({ ...entry.terms, '#': String(n) });
      glossary.entries.push({ id, terms: entry.terms, ...(entry.avoid ? { avoid: entry.avoid } : {}), ...(entry.note ? { note: entry.note } : {}), status });
      added.push(id);
    }
    return { glossary: added.length > 0 ? glossary : undefined, added, skipped, conflicts };
  }, { expectedRev });
}

/** Set the status of one entry. */
export function setStatus(root, id, status, { expectedRev } = {}) {
  return writeGlossary(root, (glossary) => {
    const entry = glossary.entries.find((e) => e.id === id);
    if (!entry) return { missing: true };
    if (entry.status === status) return { id, status };
    entry.status = status;
    return { glossary, id, status };
  }, { expectedRev });
}

// ---------------------------------------------------------------- runs

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const diagramIdOf = (file) => basename(file).replace(/\.ir\.json$/, '').toLowerCase();

/**
 * The IRs of a run folder: the originals in run order, and per language folder of `source/`
 * the translated IRs that have an original of the same name.
 * @returns {{ ok: true, run: string, originals: Array<{ id, file, ir }>, variants: Array<{ lang, id, file, ir }>, maps: Array<{ lang, file, map }> } | { ok: false, errors }}
 */
export function readRun(runDir) {
  const dir = resolve(runDir);
  const source = join(dir, 'source');
  let names;
  try {
    names = readdirSync(source);
  } catch {
    return { ok: false, errors: [{ path: runDir, message: 'not a run folder: it has no source/ folder', hint: `pass the run folder, ${runFolderPattern()}` }] };
  }
  const originals = [];
  const variants = [];
  const maps = [];
  // A link inside a run is never followed: what it points at is not part of the run.
  const plain = (path, kind) => { try { const st = lstatSync(path); return kind === 'dir' ? st.isDirectory() : st.isFile(); } catch { return false; } };
  try {
    for (const name of orderIrFiles(names.filter((n) => n.endsWith('.ir.json') && plain(join(source, n), 'file')), runSlugOf(source))) {
      originals.push({ id: diagramIdOf(name), file: join(source, name), ir: readJson(join(source, name)) });
    }
    for (const name of names.sort()) {
      const path = join(source, name);
      const m = /^labels\.(.+)\.json$/.exec(name);
      if (m && LANG_RE.test(m[1]) && plain(path, 'file')) { maps.push({ lang: m[1], file: path, map: readJson(path) }); continue; }
      if (!LANG_RE.test(name) || !plain(path, 'dir')) continue;
      for (const f of readdirSync(path).filter((n) => n.endsWith('.ir.json') && plain(join(path, n), 'file')).sort()) {
        if (!originals.some((o) => o.id === diagramIdOf(f))) continue;
        variants.push({ lang: name, id: diagramIdOf(f), file: join(path, f), ir: readJson(join(path, f)) });
      }
    }
  } catch (e) {
    return { ok: false, errors: [{ path: runDir, message: `cannot read the run: ${e instanceof SyntaxError ? 'a file is not valid JSON' : e.code ?? 'error'}` }] };
  }
  return { ok: true, run: basename(dir), originals, variants, maps };
}

/** The label field an element shows first: what a label map key names. */
const PRIMARY = ['label', 'name', 'title', 'condition'];

/**
 * The pairs of a source label and its translation in a run, from the translated IRs (every
 * label beside the one at the same path of the original) and from the label maps (only a key
 * that names exactly one label of one diagram). Every other key is counted by its form.
 */
export function pairsOf(run) {
  const pairs = [];
  const unpaired = {};
  const count = (form) => { unpaired[form] = (unpaired[form] ?? 0) + 1; };
  for (const v of run.variants) {
    const original = run.originals.find((o) => o.id === v.id);
    for (const l of labelsOf(v.ir)) {
      const source = textAt(original.ir, l.path);
      if (source === undefined) { count('ir-path-missing'); continue; }
      pairs.push({ run: run.run, diagram: v.id, path: l.path, lang: v.lang, source, translated: l.text, from: 'ir' });
    }
  }
  const byDiagram = new Map(run.originals.map((o) => [o.id, labelsOf(o.ir)]));
  for (const { lang, map } of run.maps) {
    if (map === null || typeof map !== 'object' || Array.isArray(map)) { count('not-a-map'); continue; }
    for (const [key, value] of Object.entries(map)) {
      if (key === '$keep') continue;
      if (typeof value !== 'string') { count('not-a-text'); continue; }
      if (key === 'canvas:title') { count('canvas'); continue; }
      if (/:row-\d+$/.test(key)) { count('row'); continue; }
      if (key === 'title' || key.endsWith(':title')) { count('title'); continue; }
      let diagram;
      let id;
      const colon = key.indexOf(':');
      if (colon > 0 && byDiagram.has(key.slice(0, colon).toLowerCase())) {
        diagram = key.slice(0, colon).toLowerCase();
        id = key.slice(colon + 1);
      } else {
        const holders = [...byDiagram].filter(([, labels]) => labels.some((l) => l.id === key));
        if (holders.length !== 1) { count(holders.length === 0 ? 'unknown' : 'bare-id-on-several-pages'); continue; }
        [diagram] = holders[0];
        id = key;
      }
      const labels = byDiagram.get(diagram).filter((l) => l.id === id);
      if (labels.length === 0) { count('unknown'); continue; }
      if (labels.some((l) => ['event', 'guard', 'action'].includes(l.field))) { count('transition'); continue; }
      const primary = PRIMARY.map((f) => labels.find((l) => l.field === f)).find(Boolean);
      if (!primary) { count('unknown'); continue; }
      const translated = primary.field === 'condition' ? value.replace(/^\s*\[(.*)\]\s*$/s, '$1') : value;
      pairs.push({ run: run.run, diagram, path: primary.path, lang, source: primary.text, translated, from: 'map' });
    }
  }
  return { pairs, unpaired };
}

/** `pairsOf` for the agent: label texts with every value the secret scan finds redacted. */
export function redactedPairs(pairs) {
  return pairs.map((p) => ({ ...p, source: redactText(p.source).text, translated: redactText(p.translated).text }));
}

/** The language of a translated IR: `meta.lang`, else the name of its folder. */
const langOf = (v) => (typeof v.ir?.meta?.lang === 'string' ? v.ir.meta.lang : v.lang);

/**
 * Check runs against the confirmed entries of the glossary.
 *
 * - `avoided-term`: a label equals an avoided term (blocking) or contains one (warning). A
 *   translated IR is held to the avoided terms of its language; an original IR names no
 *   language, so it is held to the avoided terms of every language.
 * - `translation-mismatch`: an original label equals a term of an entry, and the label at the
 *   same path of the translated IR for `lang` is not `terms[lang]` (blocking); or the
 *   original contains such a term and the translation does not contain `terms[lang]`
 *   (warning). A pair that comes from a label map is never blocking: the map is keyed by
 *   cell and no step rewrites it after a later change, so it can be older than the IR.
 */
export function checkGlossary(glossary, runs) {
  const confirmed = glossary.entries.filter((e) => e.status === 'confirmed');
  const findings = [];
  const add = (f) => findings.push(f);
  for (const run of runs) {
    const irs = [
      ...run.originals.map((o) => ({ diagram: o.id, ir: o.ir, lang: null })),
      ...run.variants.map((v) => ({ diagram: v.id, ir: v.ir, lang: langOf(v) })),
    ];
    for (const { diagram, ir, lang } of irs) {
      for (const l of labelsOf(ir)) {
        for (const entry of confirmed) {
          for (const [avoidLang, words] of Object.entries(entry.avoid ?? {})) {
            if (lang !== null && avoidLang.toLowerCase() !== lang.toLowerCase()) continue;
            for (const word of words) {
              const equal = sameText(l.text, word);
              if (!equal && !containsText(l.text, word)) continue;
              add({ kind: 'avoided-term', level: equal ? 'blocking' : 'warning', run: run.run, diagram, path: l.path, lang: avoidLang, text: l.text, entry: entry.id, avoided: word, expected: entry.terms[avoidLang] ?? null, from: lang === null ? 'original' : 'ir' });
            }
          }
        }
      }
    }
    for (const p of pairsOf(run).pairs) {
      for (const entry of confirmed) {
        const expected = Object.entries(entry.terms).find(([k]) => k.toLowerCase() === p.lang.toLowerCase())?.[1];
        if (expected === undefined) continue;
        const terms = Object.values(entry.terms);
        const equal = terms.some((t) => sameText(p.source, t));
        const contained = !equal && terms.some((t) => containsText(p.source, t));
        let level;
        if (equal && !sameText(p.translated, expected)) level = 'blocking';
        else if (contained && !containsText(p.translated, expected)) level = 'warning';
        else continue;
        if (p.from === 'map') level = 'warning';
        add({ kind: 'translation-mismatch', level, run: run.run, diagram: p.diagram, path: p.path, lang: p.lang, text: p.translated, source: p.source, entry: entry.id, expected, from: p.from });
      }
    }
  }
  const blocking = findings.filter((f) => f.level === 'blocking').length;
  return { ok: blocking === 0, blocking, warnings: findings.length - blocking, findings };
}

/**
 * Read the glossary of the project and the runs, then check them.
 * @returns {{ ok: true, report: ReturnType<typeof checkGlossary> } | { ok: false, code: string, errors: object[] }}
 */
export function checkRuns(root, runDirs) {
  const read = readGlossary(root);
  if (!read.ok) return read;
  if (!read.exists) return { ok: false, code: 'missing', errors: [{ path: read.path, message: 'the project has no glossary', hint: 'write one with glossary add, or pass --root <project>' }] };
  const runs = [];
  for (const dir of runDirs) {
    const run = readRun(dir);
    if (!run.ok) return { ok: false, code: 'run', errors: run.errors };
    runs.push(run);
  }
  return { ok: true, report: checkGlossary(read.glossary, runs) };
}
