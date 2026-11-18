#!/usr/bin/env node
/**
 * Zukai CLI. Exit codes: 0 success, 1 usage or I/O error, 2 validation errors.
 * Errors and warnings are printed as JSON on stderr so an agent can parse them.
 * `help`, `--help` or `-h` prints the usage on stdout.
 *
 *   node cli.mjs validate <ir.json>
 *   node cli.mjs emit --to <target> <ir.json> [--out <file>] [--overlay <file.js>] [--native <file.js>] [--lang <en|ja|vi>] [--allow-sensitive] [--mermaid-stable]
 *     (--to doc: the description tables of the diagram as Markdown, with headings and column headers in the language of --lang;
 *      --overlay, with --to figjam: the script for use_figma that draws what generate_diagram leaves out of a sequence diagram;
 *      --native, with --to figjam: the script(s) for use_figma that draw the whole board at the draw.io coordinates, for every kind)
 *   node cli.mjs bundle --to <drawio|mermaid|doc> --out <file> [--title <text>] [--lang <en|ja|vi>] [--canvas all|<id,id,...> [--gap <px>]] [--allow-sensitive] [--mermaid-stable] <run-dir|ir.json>...
 *   node cli.mjs bundle --to figjam --native <file.js> [--allow-sensitive] <run-dir|ir.json>...   (the native boards of several diagrams in as few use_figma scripts as fit)
 *     (one file holding every diagram; a run folder stands for its IRs with the main diagram first;
 *      --canvas adds a first draw.io page with those diagrams side by side;
 *      --to doc writes the description tables of every diagram into one Markdown document)
 *   node cli.mjs relabel <file.drawio> --map <labels.json> --out <file.drawio>   (new labels by IR id, layout kept)
 *   node cli.mjs preview <file.drawio|file.drawio.svg|file.mmd|run.md> [--page <id|name>] [--out <file.png>] [--max-px <n>]   (optional; needs draw.io desktop or Playwright;
 *      a draw.io file of several pages shows its first page, or the one --page names)
 *   node cli.mjs export <file.drawio|file.drawio.svg|run-dir> [--out <dir|file.svg>] [--page <id|name>[,...]]   (one editable <name>.drawio.svg per page, or only the pages named; needs draw.io desktop or Playwright)
 *   node cli.mjs diff <old.ir.json|old-dir> <new.ir.json|new-dir> [--drawio <out.drawio>] [--allow-sensitive]   (elements added, removed, changed; a dir is a run's source/ folder;
 *      --drawio also draws the change: the new version with what was added in green, changed in amber, removed in red)
 *   node cli.mjs drift <file.drawio|run.md> <ir.json|run-dir>...   (cells that differ from a fresh emit: hand edits made in draw.io)
 *   node cli.mjs snapshot <run-dir> [--keep <n>] [--request <text>] [--extra <file>]... [--bundle <json>|@<file>]   (save every IR of a run as a revision)
 *   node cli.mjs revisions <run-dir>   (the revisions of a run, newest first)
 *   node cli.mjs restore <run-dir> <rNNN|undo|redo> [--keep <n>] [--request <text>] [--extra <file>]... [--bundle <json>|@<file>]   (snapshot the current state, then put a revision back)
 *   node cli.mjs sources <run-dir> [--root <project>] [--only <id,id,...>]   (record a hash of every source file the diagrams of a run were drawn from)
 *   node cli.mjs stale <run-dir>... [--root <project>]   (the recorded source files that changed or are gone; exit 2 when there are any)
 *   node cli.mjs glossary list|add|set|pairs|check ...   (the project glossary in .zukai/glossary.json; check exits 2 on a blocking finding)
 *   node cli.mjs labs start|status|stop ...   (the labs console of a project on 127.0.0.1)
 *   node cli.mjs labs wait|progress|ask|done|holds ...   (the agent's side of the console's jobs; holds exits 2 when a job holds the run)
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { validateIr } from './validate-ir.mjs';
import { emit, bundle, inspect, EMIT_TARGETS, DOC_TARGET, DOC_LANGS } from './pipeline.mjs';
import { combineNative } from './figjam-native.mjs';
import { preview } from './preview.mjs';
import { exportSvg } from './export-svg.mjs';
import { relabelDrawio } from './relabel.mjs';
import { diffIr, diffRun } from './ir-diff.mjs';
import { visualDiff, isVisualDiff } from './visual-diff.mjs';
import { driftDrawio, driftMarkdown } from './drift.mjs';
import { orderIrFiles, runFolderOf, runSlugOf } from './run-order.mjs';
import { snapshotRun, listRevisions, restoreRun } from './revisions.mjs';
import { extractFacts, extractBoards } from './extract.mjs';
import { figjamReaderScript } from './extract-figjam.mjs';
import { cover } from './cover.mjs';
import { recordSources, staleRun } from './sources.mjs';
import { startServer, serverStatus, stopServer, serve, readServerFile } from './labs-lifecycle.mjs';
import { agentCall } from './labs-client.mjs';
import { projectRoot } from './glossary.mjs';
import { STATUSES, readGlossary, addEntries, setStatus, readRun, pairsOf, redactedPairs, checkRuns } from './glossary.mjs';

const USAGE = `usage:
  cli.mjs validate <ir.json>
  cli.mjs emit --to <${EMIT_TARGETS.join('|')}> <ir.json> [--out <file>] [--overlay <file.js>] [--native <file.js>] [--lang <${DOC_LANGS.join('|')}>] [--allow-sensitive] [--mermaid-stable]
  cli.mjs bundle --to <drawio|mermaid|doc> --out <file> [--title <text>] [--lang <${DOC_LANGS.join('|')}>] [--canvas all|<id,id,...> [--gap <px>]] [--allow-sensitive] [--mermaid-stable] <run-dir|ir.json>...
  cli.mjs bundle --to figjam --native <file.js> [--allow-sensitive] <run-dir|ir.json>...
  cli.mjs relabel <file.drawio> --map <labels.json> --out <file.drawio>
  cli.mjs preview <file.drawio|file.drawio.svg|file.mmd|run.md> [--page <id|name>] [--out <file.png>] [--max-px <n>]
  cli.mjs export <file.drawio|file.drawio.svg|run-dir> [--out <dir|file.svg>] [--page <id|name>[,...]]
  cli.mjs diff <old.ir.json|old-dir> <new.ir.json|new-dir> [--drawio <out.drawio>] [--allow-sensitive]
  cli.mjs drift <file.drawio|run.md> <ir.json|run-dir>...
  cli.mjs snapshot <run-dir> [--keep <n>] [--request <text>] [--extra <file>]... [--bundle <json>|@<file>]
  cli.mjs revisions <run-dir>
  cli.mjs restore <run-dir> <rNNN|undo|redo> [--keep <n>] [--request <text>] [--extra <file>]... [--bundle <json>|@<file>]
  cli.mjs extract <file.drawio|file.drawio.svg|file.drawio.png|file.mmd|file.puml|file.md|board.json...> [--page <id|name>[,...]] [--out <facts.json>]
  cli.mjs extract --figjam-script <file.js> [--section <name|node-id>] [--from <n>]
  cli.mjs cover <facts.json> <ir.json|run-dir>...
  cli.mjs sources <run-dir> [--root <project>] [--only <id,id,...>]
  cli.mjs stale <run-dir>... [--root <project>]
  cli.mjs glossary list [--root <project>] [--status <${STATUSES.join('|')}>]
  cli.mjs glossary add --entries <file.json> [--status <suggested|confirmed>] [--root <project>]
  cli.mjs glossary set <id> --status <${STATUSES.join('|')}> [--root <project>]
  cli.mjs glossary pairs <run-dir>... [--root <project>]
  cli.mjs glossary check <run-dir>... [--root <project>]
  cli.mjs labs start [--root <project>] [--port <n>] [--idle-minutes <n>] [--skip-cloud-check]
  cli.mjs labs status [--root <project>]
  cli.mjs labs stop [--root <project>] [--force]
  cli.mjs labs serve [--root <project>] [--port <n>] [--idle-minutes <n>]   (what start runs as a child; not for users)
  cli.mjs labs wait --session <id> [--timeout <s>] [--root <project>]
  cli.mjs labs progress <job> --session <id> --message <text> [--root <project>]
  cli.mjs labs ask <job> --session <id> --question @<file.json> [--timeout <s>] [--root <project>]
  cli.mjs labs done <job> --session <id> --result <done|failed> [--report @<file>] [--root <project>]
  cli.mjs labs holds <run> [--root <project>]
  cli.mjs help

A run folder (diagrams/<yyyymmdd>_<run-slug>) stands for the IR files in its source/ folder,
main diagram first. An option takes its value as the next argument or as --option=value.
A command takes the options its line above shows: any other option is refused, not ignored.
--allow-sensitive says that what the secret scan found is not a secret.
--mermaid-stable (emit and bundle, Mermaid text) writes the forms an older Mermaid renderer
reads: plain participants, a flowchart in place of swimlane-beta, no erDiagram direction line.
preview draws a .drawio file, an editable picture (.drawio.svg, drawn from the diagram it
holds), a .mmd file or every block of a combined .md. A draw.io file of several pages shows
its first page; --page <id|name> picks another, and a name no page has exits 1 with the list
of pages. export takes --page the same way and then writes only the pictures of those pages.
--overlay goes with --to figjam: it writes the script that completes a sequence diagram on the
board (block frames, self-messages, notes); no file is written when the board needs none.
--native goes with --to figjam too: it writes the script for use_figma that draws the whole
board at the coordinates of the draw.io layout (<file>.js, then <file>.2.js, ... when one
script would be too long; run them in order). It works for every kind, class and activity
included; for those two no Mermaid text is written. Each script is one use_figma call: the
result line says how many (calls), and for each script the number of shapes, lines and texts
its call must report as created (created) and its size in bytes (bytes). bundle --to figjam
--native writes the native boards of several diagrams into as few scripts as the size of one
call allows, each diagram into its own section, to save calls on a plan that limits them; its
created holds, for each script, the number each of its diagrams must report, in the order the
script returns them. A native script draws over a section only when it drew that section for
the same run folder; beside a section of the same title it makes "<title> (2)".
export writes each page of a draw.io file as a picture that still opens in draw.io; given
such a picture (.drawio.svg), it draws the diagram the picture holds again.
diff --drawio writes a picture of the change beside the list: a draw.io file of the new version
with one page per diagram that changed, where what was added is green, what changed or moved
is amber and what was removed is drawn again in red with a dashed outline, and a legend under
each. It is a review aid (write it under drafts/), never the output of a run; nothing is
written when the two versions do not differ.
--to doc writes the description tables of a diagram as Markdown (every element as a row, for
a specification or a design document); bundle --to doc writes those of a whole run into one
document, where an element that has a part links to it. --lang goes with --to doc: the language
of the headings and column headers (${DOC_LANGS.join(', ')}; default en). Labels stay as the IR has them.
extract reads a diagram made elsewhere into facts (pages, nodes, edges, kind hints) for the
recook skill; --figjam-script writes the read-only use_figma script whose JSON result extract
then reads (a large board comes back in parts: run the script again with --from <next> and
pass every part to extract; each part is one more use_figma call). --page keeps only the pages named, by id or name. cover exits 2 when a text of the facts is in none of the IRs,
or when an edge of the facts joins two texts that no relation of the IRs joins (lostEdges).
The result line keeps units, covered and missing for the texts and adds edges (how many were
checked) and lostEdges (each by its two ends and its label).
sources writes source/<run-slug>.sources.json: for every diagram of the run, the files its
meta.sources names (paths from the project root) with a SHA-256 of each. CRLF is hashed as
LF, so a checkout that converts line endings changes nothing. --root is the project root;
without it, the nearest folder at or above the run folder that holds .git, or else the
working directory. A scouted diagram without meta.sources is recorded from the paths in its
meta.notes that exist under the root, and the output says so. --only records the diagrams
named and leaves the rest of the record as it is.
stale reads the record and the files, and writes nothing. The result is one JSON object on
stdout; exit 0 when no recorded file changed, exit 2 when one changed or is gone (listed per
run and per diagram) or a diagram names sources the record does not hold, exit 1 when a run
has no record. Without --root it uses the root the record was taken with, which is stored
relative to the run folder. It needs no network and no git, so it can run in CI.
glossary works on .zukai/glossary.json under the project root (--root, else the working
directory): preferred terms per language, each entry suggested, confirmed or rejected. Only a
confirmed entry is applied. list prints the entries; add takes {"entries": [{terms, avoid?,
note?}]} from a file, as suggestions unless --status confirmed, skips an entry that is already
there (a rejected one included) and reports one that contradicts a confirmed entry under
conflicts without writing it; set changes the status of one entry. A term or an avoided term
is one line of at most 80 characters, a note at most 280, and nothing the secret scan finds is
taken. pairs prints the label of each original IR beside its translation, from the translated
IRs under source/<lang>/ and from the keys of a label map that name one label (the rest are
counted under unpaired), with secret values redacted. check holds the labels of the runs to the
confirmed entries and prints the findings; exit 2 when one is blocking (a label that equals an
avoided term, or a translated IR that does not carry the confirmed term of a label), exit 1
when the project has no glossary or it does not match its schema.
labs start serves the console of the project (--root, else the working directory) on
127.0.0.1, on a port that is the same for the project every time (--port or ZUKAI_LABS_PORT
replace it; a busy port is reported, never replaced by the next one). A second start reuses
the running server. The server reads the runs under diagrams/ and never writes there; it
writes .zukai/labs/ and, from the console's Glossary section, .zukai/glossary.json, and
ends itself after --idle-minutes (default 30) with nothing to
do, or on labs stop (--force when a job is open). start and status print the console URL with
its token; in a cloud session start refuses, unless --skip-cloud-check is given for a browser
on the same machine. Each prints one JSON object; an error is {"ok": false, "error": {code,
message}} on stderr with exit 1. start prints a fresh session id each time.
labs wait, progress, ask and done are the agent's side of the console's jobs. wait takes the
next job ({"session", "job"}), or prints "job": null when the time is up (nine minutes at most;
--timeout shortens it): call it again. ask shows the questions of a file (id, body, one to four
questions as AskUserQuestion takes them, attachments) in the console and prints the answers,
or "answers": null when the time is up: call it again with the same file, since that is never
an answer. done closes the job with done or failed and the report. Error codes: no-server,
not-this-project, session-refused, session-replaced, transport, bad-request. labs holds <run>
prints whether a console job is working on a run: exit 2 when one is, exit 0 when none is or
no console runs. Before changing a run, a session outside the console asks holds.
Exit codes: 0 success, 1 usage or I/O error, 2 validation errors.`;

function fail(code, payload) {
  process.stderr.write(JSON.stringify(payload) + '\n');
  return code;
}

/** Options that take a value, and the field each one fills. */
const VALUE_OPTIONS = { '--to': 'to', '--out': 'out', '--title': 'title', '--canvas': 'canvas', '--gap': 'gap', '--map': 'map', '--max-px': 'maxPx', '--keep': 'keep', '--request': 'request', '--bundle': 'bundleJson', '--extra': 'extras', '--overlay': 'overlay', '--native': 'native', '--figjam-script': 'figjamScript', '--section': 'section', '--from': 'from', '--page': 'page', '--root': 'root', '--only': 'only', '--drawio': 'drawio', '--lang': 'lang', '--entries': 'entries', '--status': 'status', '--port': 'port', '--idle-minutes': 'idleMinutes', '--session': 'session', '--message': 'message', '--question': 'question', '--result': 'result', '--report': 'report', '--timeout': 'timeout' };
const FLAGS = { '--allow-sensitive': 'allowSensitive', '--mermaid-stable': 'mermaidStable', '--skip-cloud-check': 'skipCloudCheck', '--force': 'force' };

/**
 * The options each command takes. One that a command does not take is refused: an option that
 * was read and dropped would let the caller believe it had an effect.
 */
const COMMAND_OPTIONS = {
  validate: [],
  emit: ['--to', '--out', '--overlay', '--native', '--lang', '--allow-sensitive', '--mermaid-stable'],
  bundle: ['--to', '--out', '--title', '--lang', '--canvas', '--gap', '--allow-sensitive', '--mermaid-stable', '--native'],
  relabel: ['--map', '--out'],
  preview: ['--page', '--out', '--max-px'],
  export: ['--page', '--out'],
  diff: ['--drawio', '--allow-sensitive'],
  drift: [],
  snapshot: ['--keep', '--request', '--extra', '--bundle'],
  revisions: [],
  restore: ['--keep', '--request', '--extra', '--bundle'],
  extract: ['--page', '--out', '--figjam-script', '--section', '--from'],
  cover: [],
  sources: ['--root', '--only'],
  stale: ['--root'],
  'glossary list': ['--root', '--status'],
  'glossary add': ['--entries', '--status', '--root'],
  'glossary set': ['--status', '--root'],
  'glossary pairs': ['--root'],
  'glossary check': ['--root'],
  'labs start': ['--root', '--port', '--idle-minutes', '--skip-cloud-check'],
  'labs status': ['--root'],
  'labs stop': ['--root', '--force'],
  'labs serve': ['--root', '--port', '--idle-minutes'],
  'labs wait': ['--session', '--timeout', '--root'],
  'labs progress': ['--session', '--message', '--root'],
  'labs ask': ['--session', '--question', '--timeout', '--root'],
  'labs done': ['--session', '--result', '--report', '--root'],
  'labs holds': ['--root'],
};

/** Commands of two words: the first word names a group, the second the command in it. */
const GROUPS = new Set(Object.keys(COMMAND_OPTIONS).filter((c) => c.includes(' ')).map((c) => c.split(' ')[0]));

/**
 * Options a command reads only to refuse them with a message of its own that says where they
 * belong. They are no options of the command: no hint names them as something it takes.
 */
const REFUSED_WITH_REASON = { stale: ['--only'] };

function parseArgs(argv) {
  let [command, ...rest] = argv;
  // The second word of a grouped command is read before any option, so an option of one
  // subcommand is still refused on another.
  if (GROUPS.has(command)) {
    const sub = rest[0];
    const subs = Object.keys(COMMAND_OPTIONS).filter((c) => c.startsWith(`${command} `)).map((c) => c.split(' ')[1]);
    if (sub === undefined || sub.startsWith('-')) return { error: `${command} needs a command: ${subs.join(', ')}` };
    if (!subs.includes(sub)) return { error: `unknown command "${command} ${sub}"`, hint: `${command} takes ${subs.join(', ')}` };
    command = `${command} ${sub}`;
    rest = rest.slice(1);
  }
  const opts = { command, positional: [], to: undefined, out: undefined, title: undefined, canvas: undefined, gap: undefined, map: undefined, maxPx: undefined, keep: undefined, overlay: undefined, native: undefined, figjamScript: undefined, section: undefined, from: undefined, page: undefined, root: undefined, only: undefined, request: undefined, extras: [], bundleJson: undefined, allowSensitive: false, mermaidStable: false, help: false, drawio: undefined, lang: undefined, entries: undefined, status: undefined, port: undefined, idleMinutes: undefined, skipCloudCheck: false, force: false, session: undefined, message: undefined, question: undefined, result: undefined, report: undefined, timeout: undefined };
  if (command === 'help' || command === '--help' || command === '-h') return { ...opts, help: true };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--help' || a === '-h') { opts.help = true; continue; }
    if (!a.startsWith('--')) { opts.positional.push(a); continue; }
    const eq = a.indexOf('=');
    const name = eq < 0 ? a : a.slice(0, eq);
    const known = Object.hasOwn(FLAGS, name) || Object.hasOwn(VALUE_OPTIONS, name);
    if (known && Object.hasOwn(COMMAND_OPTIONS, command) && !COMMAND_OPTIONS[command].includes(name) && !(REFUSED_WITH_REASON[command] ?? []).includes(name)) {
      const takes = COMMAND_OPTIONS[command];
      const others = Object.entries(COMMAND_OPTIONS).filter(([, list]) => list.includes(name)).map(([c]) => c);
      return { error: `${command} does not take ${name}`, hint: `${takes.length > 0 ? `${command} takes ${takes.join(', ')}` : `${command} takes no option`}; ${name} goes with ${others.join(', ')}` };
    }
    if (Object.hasOwn(FLAGS, name)) {
      if (eq >= 0) return { error: `option ${name} takes no value` };
      opts[FLAGS[name]] = true;
      continue;
    }
    if (!Object.hasOwn(VALUE_OPTIONS, name)) return { error: `unknown option ${name}` };
    let value;
    if (eq >= 0) value = a.slice(eq + 1);
    else {
      // The next argument is the value. One that is missing or is itself an option means the
      // value was forgotten: taking it would write a file named like a flag and drop the flag.
      const next = rest[i + 1];
      if (next === undefined) return { error: `option ${name} needs a value` };
      if (next.startsWith('--')) return { error: `option ${name} needs a value, but "${next}" follows it`, hint: `write ${name}=<value> when the value itself starts with "--"` };
      value = next;
      i += 1;
    }
    if (value === '') return { error: `option ${name} needs a value` };
    if (name === '--extra') opts.extras.push(value);
    else opts[VALUE_OPTIONS[name]] = value;
  }
  return opts;
}

/** `--lang` belongs to the description tables and names a language they are written in. */
function langError(opts) {
  if (opts.lang === undefined) return undefined;
  if (opts.to !== DOC_TARGET) return { path: '/', message: `--lang goes with --to ${DOC_TARGET}, not "${opts.to}"`, hint: 'the labels of a diagram are in the language of its IR; --lang only picks the headings of the description tables' };
  if (!DOC_LANGS.includes(opts.lang)) return { path: '/', message: `unknown language "${opts.lang}"`, hint: `--lang takes one of: ${DOC_LANGS.join(', ')}` };
  return undefined;
}

function readIr(file) {
  let text;
  try {
    text = readFileSync(resolve(file), 'utf8');
  } catch (e) {
    return { error: { path: file, message: `cannot read file: ${e.message}` } };
  }
  try {
    return { ir: JSON.parse(text) };
  } catch (e) {
    return { error: { path: file, message: `not valid JSON: ${e.message}`, hint: 'the IR file must contain exactly one JSON object' } };
  }
}

/** Diagram id of an IR file: its name without `.ir.json` (or `.json`). */
const diagramIdOf = (file) => basename(file, extname(file)).replace(/\.ir$/, '');

/**
 * Where an IR of a language variant lies in its run, for the line that names the source of a
 * diagram: `source/<lang>/<slug>.ir.json`. Translated IRs live in a subfolder of `source/`
 * named after the language, so a run folder never counts them as further diagrams and the
 * sources record never sees them. Any other file keeps the usual `source/<slug>.ir.json`.
 */
function sourcePathOf(file) {
  const dir = dirname(resolve(file));
  return basename(dirname(dir)) === 'source' ? { sourcePath: `source/${basename(dir)}/${basename(file)}` } : {};
}

/** The IR files of a run folder (its `source/`) or of a plain folder, in run order: main diagram first. */
function irFilesOf(path) {
  const dir = existsSync(join(path, 'source')) && statSync(join(path, 'source')).isDirectory() ? join(path, 'source') : path;
  return orderIrFiles(readdirSync(dir).filter((f) => f.endsWith('.ir.json')), runSlugOf(dir)).map((f) => join(dir, f));
}

/** Read and validate IR files; a directory stands for its `*.ir.json` files (a run folder for its `source/`). */
function readIrSet(target) {
  const path = resolve(target);
  let files;
  try {
    if (statSync(path).isDirectory()) {
      files = irFilesOf(path);
    } else files = [path];
  } catch (e) {
    return { error: { code: 1, payload: { ok: false, errors: [{ path: target, message: `cannot read: ${e.message}` }] } } };
  }
  const entries = [];
  for (const file of files) {
    const { ir, error } = readIr(file);
    if (error) return { error: { code: 1, payload: { ok: false, errors: [error] } } };
    const result = validateIr(ir);
    if (!result.ok) return { error: { code: 2, payload: { ok: false, errors: result.errors.map((e) => ({ file, ...e })) } } };
    entries.push({ id: diagramIdOf(file), ir });
  }
  return { entries, directory: files.length !== 1 || statSync(path).isDirectory() };
}

export async function main(argv) {
  const opts = parseArgs(argv);
  if (opts.error) return fail(1, { ok: false, errors: [{ path: '/', message: opts.error, ...(opts.hint ? { hint: opts.hint } : {}) }], usage: USAGE });
  if (opts.help) {
    process.stdout.write(USAGE + '\n');
    return 0;
  }
  if (opts.command === 'validate') {
    if (opts.positional.length !== 1) return fail(1, { ok: false, errors: [{ path: '/', message: 'validate takes exactly one file' }], usage: USAGE });
    const { ir, error } = readIr(opts.positional[0]);
    if (error) return fail(1, { ok: false, errors: [error] });
    const result = validateIr(ir);
    if (!result.ok) return fail(2, { ok: false, errors: result.errors });
    // A valid model can still be a wrong one: what can be told without a target is said here.
    const warnings = inspect(ir);
    if (warnings.length > 0) process.stderr.write(JSON.stringify({ warnings }) + '\n');
    process.stdout.write(JSON.stringify({ ok: true, kind: ir.kind, title: ir.title, warnings: warnings.length }) + '\n');
    return 0;
  }
  if (opts.command === 'emit') {
    if (opts.positional.length !== 1 || !opts.to) return fail(1, { ok: false, errors: [{ path: '/', message: 'emit needs --to <target> and exactly one file' }], usage: USAGE });
    if (!EMIT_TARGETS.includes(opts.to)) return fail(1, { ok: false, errors: [{ path: '/', message: `unknown target "${opts.to}"`, hint: `--to takes one of: ${EMIT_TARGETS.join(', ')}` }], usage: USAGE });
    if (langError(opts)) return fail(1, { ok: false, errors: [langError(opts)], usage: USAGE });
    const { ir, error } = readIr(opts.positional[0]);
    if (error) return fail(1, { ok: false, errors: [error] });
    if (opts.overlay && opts.to !== 'figjam') return fail(1, { ok: false, errors: [{ path: '/', message: `--overlay goes with --to figjam, not "${opts.to}"` }], usage: USAGE });
    if (opts.native && opts.to !== 'figjam') return fail(1, { ok: false, errors: [{ path: '/', message: `--native goes with --to figjam, not "${opts.to}"` }], usage: USAGE });
    const diagramId = opts.out ? basename(opts.out, extname(opts.out)).replace(/\.ir$/, '') : undefined;
    // A native board is tagged with the run folder of the IR, so drawing it again replaces only what was drawn for this run.
    const run = runFolderOf(dirname(resolve(opts.positional[0])));
    const result = await emit(ir, opts.to, { allowSensitive: opts.allowSensitive, mermaidStable: opts.mermaidStable, diagramId, native: opts.native !== undefined, nativeOnly: opts.native !== undefined && opts.out === undefined, run, lang: opts.lang });
    if (!result.ok) return fail(2, { ok: false, errors: result.errors, warnings: result.warnings });
    // The native scripts carry the labels too, so they are written only past the same gates:
    // <file>.js, then <file>.2.js and so on when the drawing needs more than one script.
    let nativePaths;
    if (result.native) {
      const first = resolve(opts.native);
      const stem = first.slice(0, first.length - extname(first).length);
      nativePaths = result.native.map((_, i) => (i === 0 ? first : `${stem}.${i + 1}${extname(first)}`));
      try {
        mkdirSync(dirname(first), { recursive: true });
        result.native.forEach((script, i) => writeFileSync(nativePaths[i], script, 'utf8'));
      } catch (e) {
        return fail(1, { ok: false, errors: [{ path: opts.native, message: `cannot write file: ${e.message}` }] });
      }
    }
    // What the board costs and how to check each call: one use_figma call per script, and the
    // number of shapes, lines and texts the call must report as created.
    const nativeInfo = nativePaths ? { native: nativePaths, calls: nativePaths.length, created: result.nativeCreated, bytes: result.native.map((script) => Buffer.byteLength(script)) } : undefined;
    // The overlay script carries the same labels as the text, so it is written only past the same gates.
    let overlayPath;
    if (result.overlay && opts.overlay) {
      overlayPath = resolve(opts.overlay);
      try {
        mkdirSync(dirname(overlayPath), { recursive: true });
        writeFileSync(overlayPath, result.overlay, 'utf8');
      } catch (e) {
        return fail(1, { ok: false, errors: [{ path: opts.overlay, message: `cannot write file: ${e.message}` }] });
      }
    } else if (result.overlay && !result.native) {
      result.warnings.push({ stage: 'emit', path: '/', message: 'the board of this sequence diagram is complete only after the overlay script has run on it', hint: 'emit again with --overlay <file.js> and pass that script to use_figma once generate_diagram has made the board' });
    }
    if (result.warnings.length > 0) process.stderr.write(JSON.stringify({ warnings: result.warnings }) + '\n');
    // generate_diagram rejects this kind, so there is no Mermaid text to write: only the native scripts.
    if (result.output === undefined) {
      process.stdout.write(JSON.stringify({ ok: true, out: null, text: `not written: there is no Mermaid text for a ${ir.kind} diagram on FigJam (generate_diagram does not draw this kind); the native script${nativePaths.length === 1 ? ' draws' : 's draw'} the board`, overlay: null, ...nativeInfo, warnings: result.warnings.length }) + '\n');
      return 0;
    }
    if (opts.out) {
      const outPath = resolve(opts.out);
      try {
        mkdirSync(dirname(outPath), { recursive: true });
        writeFileSync(outPath, result.output, 'utf8');
      } catch (e) {
        return fail(1, { ok: false, errors: [{ path: opts.out, message: `cannot write file: ${e.message}` }] });
      }
      process.stdout.write(JSON.stringify({ ok: true, out: outPath, ...(opts.to === 'figjam' ? { overlay: overlayPath ?? null } : {}), ...(nativeInfo ?? {}), warnings: result.warnings.length }) + '\n');
      return 0;
    }
    // With --native and no --out the scripts are the result; the Mermaid text is not printed between them.
    if (nativePaths) {
      process.stdout.write(JSON.stringify({ ok: true, out: null, text: 'not written: no --out given', overlay: overlayPath ?? null, ...nativeInfo, warnings: result.warnings.length }) + '\n');
      return 0;
    }
    process.stdout.write(result.output);
    return 0;
  }
  if (opts.command === 'bundle') {
    const nativeBundle = opts.to === 'figjam';
    if (nativeBundle && (!opts.native || opts.out || opts.title || opts.lang || opts.canvas || opts.gap || opts.mermaidStable || opts.positional.length === 0)) return fail(1, { ok: false, errors: [{ path: '/', message: 'bundle --to figjam takes --native <file.js> and the IR files or run folder, and no other option but --allow-sensitive' }], usage: USAGE });
    if (!nativeBundle && opts.native) return fail(1, { ok: false, errors: [{ path: '/', message: `--native goes with --to figjam, not "${opts.to}"` }], usage: USAGE });
    if (!nativeBundle && (opts.positional.length === 0 || !opts.to || !opts.out)) return fail(1, { ok: false, errors: [{ path: '/', message: 'bundle needs --to <target>, --out <file> and at least one IR file' }], usage: USAGE });
    if (!nativeBundle && opts.to !== 'drawio' && opts.to !== 'mermaid' && opts.to !== DOC_TARGET) return fail(1, { ok: false, errors: [{ path: '/', message: `bundle supports drawio and mermaid, and doc for the description tables, not "${opts.to}"`, hint: 'FigJam has no combined file; bundle --to figjam --native writes the native boards of several diagrams into as few scripts as fit' }], usage: USAGE });
    if (langError(opts)) return fail(1, { ok: false, errors: [langError(opts)], usage: USAGE });
    // A folder stands for its IR files in run order; files given one by one keep the order given.
    const files = [];
    for (const arg of opts.positional) {
      let isDir = false;
      try {
        isDir = statSync(resolve(arg)).isDirectory();
      } catch {
        // a missing path is reported by readIr below
      }
      if (!isDir) { files.push(arg); continue; }
      const found = irFilesOf(resolve(arg));
      if (found.length === 0) return fail(1, { ok: false, errors: [{ path: arg, message: 'no *.ir.json file in this folder', hint: 'pass the run folder, diagrams/<yyyymmdd>_<run-slug>, or its source/ folder' }] });
      files.push(...found);
    }
    const entries = [];
    const seen = new Map();
    for (const file of files) {
      const { ir, error } = readIr(file);
      if (error) return fail(1, { ok: false, errors: [error] });
      // Diagram ids come from file names; a repeated name gets a numeric suffix so pages stay unique.
      const base = basename(file, extname(file)).replace(/\.ir$/, '');
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      entries.push({ ir, id: n === 1 ? base : `${base}-${n}`, ...sourcePathOf(file) });
    }
    if (nativeBundle) {
      // Each diagram past the same gates as emit --native; then the drawings packed into as few scripts as fit.
      const data = [];
      const warnings = [];
      for (const [i, e] of entries.entries()) {
        const r = await emit(e.ir, 'figjam', { allowSensitive: opts.allowSensitive, diagramId: e.id, native: true, nativeOnly: true, run: runFolderOf(dirname(resolve(files[i]))) });
        if (!r.ok) return fail(2, { ok: false, diagram: e.id, errors: r.errors, warnings: r.warnings });
        warnings.push(...r.warnings.map((w) => ({ diagram: e.id, ...w })));
        data.push(...r.nativeData);
      }
      const packed = combineNative(data);
      const first = resolve(opts.native);
      const stem = first.slice(0, first.length - extname(first).length);
      const paths = packed.parts.map((_, i) => (i === 0 ? first : `${stem}.${i + 1}${extname(first)}`));
      try {
        mkdirSync(dirname(first), { recursive: true });
        packed.parts.forEach((script, i) => writeFileSync(paths[i], script, 'utf8'));
      } catch (e) {
        return fail(1, { ok: false, errors: [{ path: opts.native, message: `cannot write file: ${e.message}` }] });
      }
      if (warnings.length > 0) process.stderr.write(JSON.stringify({ warnings }) + '\n');
      process.stdout.write(JSON.stringify({ ok: true, native: paths, calls: paths.length, created: packed.created, bytes: packed.parts.map((script) => Buffer.byteLength(script)), drawings: packed.drawings, diagrams: entries.length, order: entries.map((e) => e.id), warnings: warnings.length }) + '\n');
      return 0;
    }
    const canvas = opts.canvas === undefined ? undefined : opts.canvas === 'all' ? 'all' : opts.canvas.split(',').map((s) => s.trim()).filter(Boolean);
    const gap = opts.gap === undefined ? undefined : Number(opts.gap);
    if (opts.gap !== undefined && (opts.canvas === undefined || !Number.isFinite(gap) || gap < 0)) {
      return fail(1, { ok: false, errors: [{ path: '/', message: '--gap takes a number of pixels (0 or more) and needs --canvas' }], usage: USAGE });
    }
    const result = await bundle(entries, opts.to, { allowSensitive: opts.allowSensitive, mermaidStable: opts.mermaidStable, title: opts.title, lang: opts.lang, canvas, gap });
    if (!result.ok) return fail(result.errors.some((e) => e.path === '/' && /canvas|gap/.test(e.message)) ? 1 : 2, { ok: false, errors: result.errors, warnings: result.warnings });
    if (result.warnings.length > 0) process.stderr.write(JSON.stringify({ warnings: result.warnings }) + '\n');
    const outPath = resolve(opts.out);
    try {
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, result.output, 'utf8');
    } catch (e) {
      return fail(1, { ok: false, errors: [{ path: opts.out, message: `cannot write file: ${e.message}` }] });
    }
    process.stdout.write(JSON.stringify({ ok: true, out: outPath, diagrams: entries.length, order: entries.map((e) => e.id), warnings: result.warnings.length, ...(result.canvas ? { canvas: result.canvas } : {}) }) + '\n');
    return 0;
  }
  if (opts.command === 'relabel') {
    if (opts.positional.length !== 1 || !opts.map || !opts.out) return fail(1, { ok: false, errors: [{ path: '/', message: 'relabel needs one .drawio file, --map <labels.json> and --out <file>' }], usage: USAGE });
    let xml;
    let map;
    try {
      xml = readFileSync(resolve(opts.positional[0]), 'utf8');
    } catch (e) {
      return fail(1, { ok: false, errors: [{ path: opts.positional[0], message: `cannot read file: ${e.message}` }] });
    }
    if (!/<mxfile\b/.test(xml)) return fail(1, { ok: false, errors: [{ path: opts.positional[0], message: 'not a .drawio file (no <mxfile> root)', hint: 'relabel keeps draw.io geometry; for Mermaid, translate a copy of the IR and emit again' }] });
    try {
      map = JSON.parse(readFileSync(resolve(opts.map), 'utf8'));
    } catch (e) {
      return fail(1, { ok: false, errors: [{ path: opts.map, message: `cannot read the label map: ${e.message}`, hint: 'a JSON object of IR id (or "<diagram id>:<ir id>", "title") to new label' }] });
    }
    if (typeof map !== 'object' || map === null || Array.isArray(map) || Object.entries(map).some(([k, v]) => (k === '$keep' ? !Array.isArray(v) || v.some((t) => typeof t !== 'string') : typeof v !== 'string'))) {
      return fail(1, { ok: false, errors: [{ path: opts.map, message: 'the label map must be a JSON object whose values are strings ("$keep" may hold a list of texts to leave as they are)' }] });
    }
    const result = relabelDrawio(xml, map);
    const warnings = result.warnings.map((w) => ({ stage: 'relabel', ...w }));
    if (result.unmatched.length > 0) warnings.push({ stage: 'relabel', path: '/', message: `keys that matched no label: ${result.unmatched.join(', ')}`, hint: 'keys are IR ids as in the cell ids of the file, or "title"' });
    // One line for all of them: a map that rewords one label would otherwise print a warning
    // for every other label of the file. The full list, with places, is `untouched` on stdout.
    if (result.untouched.length > 0) {
      const shown = result.untouched.slice(0, 5).map((u) => `"${u.text}"`).join(', ');
      const more = result.untouched.length > 5 ? ` and ${result.untouched.length - 5} more` : '';
      warnings.push({ stage: 'relabel', path: result.untouched[0].places[0], message: `${result.untouched.length} label${result.untouched.length === 1 ? '' : 's'} kept ${result.untouched.length === 1 ? 'its' : 'their'} text: ${shown}${more}`, hint: 'expected when the map rewords a few labels; for a translation, every text in "untouched" (stdout) needs a map entry for its id, or a place in "$keep"' });
    }
    if (warnings.length > 0) process.stderr.write(JSON.stringify({ warnings }) + '\n');
    const outPath = resolve(opts.out);
    try {
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, result.output, 'utf8');
    } catch (e) {
      return fail(1, { ok: false, errors: [{ path: opts.out, message: `cannot write file: ${e.message}` }] });
    }
    process.stdout.write(JSON.stringify({ ok: true, out: outPath, replaced: result.replaced, byText: result.byText, unmatched: result.unmatched, untouched: result.untouched, warnings: warnings.length }) + '\n');
    return 0;
  }
  if (opts.command === 'preview') {
    if (opts.positional.length !== 1) return fail(1, { ok: false, errors: [{ path: '/', message: 'preview takes exactly one file' }], usage: USAGE });
    const maxPx = opts.maxPx === undefined ? undefined : Number(opts.maxPx);
    if (opts.maxPx !== undefined && !(Number.isInteger(maxPx) && maxPx >= 200)) return fail(1, { ok: false, errors: [{ path: '/', message: '--max-px takes a whole number of pixels, 200 or more' }], usage: USAGE });
    const result = await preview(opts.positional[0], { out: opts.out, maxPx, page: opts.page });
    if (!result.ok) return fail(1, { ok: false, errors: result.errors });
    process.stdout.write(JSON.stringify({ ok: true, preview: result.out, files: result.files, tiled: result.tiled === true, ...(result.tiled ? { overlap: result.overlap } : {}), scale: result.scale, renderer: result.renderer, ...(result.blocks ? { blocks: result.blocks } : {}), ...(result.page ? { page: result.page, pages: result.pages } : {}) }) + '\n');
    return 0;
  }
  if (opts.command === 'export') {
    if (opts.positional.length !== 1) return fail(1, { ok: false, errors: [{ path: '/', message: 'export takes exactly one .drawio file, editable picture (.drawio.svg) or run folder' }], usage: USAGE });
    const page = opts.page === undefined ? undefined : opts.page.split(',').map((x) => x.trim()).filter(Boolean);
    const result = await exportSvg(opts.positional[0], { out: opts.out, page });
    if (result.warnings.length > 0) process.stderr.write(JSON.stringify({ warnings: result.warnings }) + '\n');
    if (!result.ok) return fail(1, { ok: false, errors: result.errors, ...(result.usage ? { usage: USAGE } : {}) });
    process.stdout.write(JSON.stringify({ ok: true, files: result.files, renderer: result.renderer, text: result.text, warnings: result.warnings.length }) + '\n');
    return 0;
  }
  if (opts.command === 'diff') {
    if (opts.positional.length !== 2) return fail(1, { ok: false, errors: [{ path: '/', message: 'diff takes two IR files or two directories' }], usage: USAGE });
    const a = readIrSet(opts.positional[0]);
    if (a.error) return fail(a.error.code, a.error.payload);
    const b = readIrSet(opts.positional[1]);
    if (b.error) return fail(b.error.code, b.error.payload);
    const single = !a.directory && !b.directory;
    let report;
    if (single) {
      const d = diffIr(a.entries[0].ir, b.entries[0].ir);
      const differs = d.replaced || d.fields.length + d.added.length + d.removed.length + d.changed.length + d.reordered.length > 0;
      report = { ok: true, differs, ...d };
    } else report = { ok: true, ...diffRun(a.entries, b.entries) };
    if (opts.drawio !== undefined) {
      const outPath = resolve(opts.drawio);
      if (extname(outPath).toLowerCase() !== '.drawio') return fail(1, { ok: false, errors: [{ path: opts.drawio, message: '--drawio takes the path of a .drawio file to write' }], usage: USAGE });
      // The picture is a review aid: it replaces an earlier picture, never another draw.io file.
      if (existsSync(outPath)) {
        let existing = '';
        try {
          existing = readFileSync(outPath, 'utf8');
        } catch {
          // unreadable: treated as a file that is not ours
        }
        if (!isVisualDiff(existing)) return fail(1, { ok: false, errors: [{ path: opts.drawio, message: 'this file exists and is not the picture of a diff: it is not overwritten', hint: 'write the picture under the drafts/ folder of the run, for example drafts/<name>.diff.drawio; the delivered <run-slug>.drawio stays as it is' }] });
      }
      // Two files are one diagram in two versions, whatever the files are called.
      const before = single ? [{ id: b.entries[0].id, ir: a.entries[0].ir }] : a.entries;
      const picture = await visualDiff(before, b.entries, { allowSensitive: opts.allowSensitive });
      if (!picture.ok) return fail(2, { ok: false, errors: picture.errors, warnings: picture.warnings });
      if (picture.warnings.length > 0) process.stderr.write(JSON.stringify({ warnings: picture.warnings }) + '\n');
      if (!picture.differs) report.drawio = { out: null, written: false, reason: picture.metaOnly ? 'the two versions differ only in meta fields, which no diagram shows: there is nothing to draw' : 'the two versions do not differ: there is nothing to draw', unchanged: picture.unchanged };
      else {
        try {
          mkdirSync(dirname(outPath), { recursive: true });
          writeFileSync(outPath, picture.output, 'utf8');
        } catch (e) {
          return fail(1, { ok: false, errors: [{ path: opts.drawio, message: `cannot write file: ${e.message}` }] });
        }
        report.drawio = { out: outPath, written: true, pages: picture.pages, unchanged: picture.unchanged, notDrawn: picture.notDrawn, warnings: picture.warnings.length };
      }
    }
    process.stdout.write(JSON.stringify(report) + '\n');
    return 0;
  }
  if (opts.command === 'drift') {
    if (opts.positional.length < 2) return fail(1, { ok: false, errors: [{ path: '/', message: 'drift takes one .drawio file (or the combined .md of a Mermaid run) and the IR files it was emitted from' }], usage: USAGE });
    const [file, ...irFiles] = opts.positional;
    let xml;
    try {
      xml = readFileSync(resolve(file), 'utf8');
    } catch (e) {
      return fail(1, { ok: false, errors: [{ path: file, message: `cannot read file: ${e.message}` }] });
    }
    const markdown = extname(file).toLowerCase() === '.md';
    if (!markdown && !/<mxfile\b/.test(xml)) return fail(1, { ok: false, errors: [{ path: file, message: 'not a .drawio file (no <mxfile> root)', hint: 'for a Mermaid run pass its combined <run-slug>.md; a single .mmd has no layout to keep, compare the IR with diff instead' }] });
    if (!markdown && isVisualDiff(xml)) return fail(1, { ok: false, errors: [{ path: file, message: 'this file is the picture of a diff (diff --drawio), not the output of a run', hint: 'pass the delivered <run-slug>.drawio of the run folder' }] });
    const entries = [];
    for (const f of irFiles) {
      const set = readIrSet(f);
      if (set.error) return fail(set.error.code, set.error.payload);
      entries.push(...set.entries);
    }
    const result = markdown ? await driftMarkdown(xml, entries) : await driftDrawio(xml, entries);
    if (!result.ok) return fail(result.errors.some((e) => e.path === '/') ? 1 : 2, { ok: false, errors: result.errors });
    process.stdout.write(JSON.stringify(result) + '\n');
    return 0;
  }
  if (opts.command === 'snapshot' || opts.command === 'restore' || opts.command === 'revisions') {
    const want = opts.command === 'restore' ? 2 : 1;
    if (opts.positional.length !== want) return fail(1, { ok: false, errors: [{ path: '/', message: opts.command === 'restore' ? 'restore takes a run folder and a revision (rNNN), or "undo" / "redo" for one step' : `${opts.command} takes exactly one run folder` }], usage: USAGE });
    const keep = opts.keep === undefined ? undefined : Number(opts.keep);
    if (opts.keep !== undefined && !(Number.isInteger(keep) && keep >= 1)) return fail(1, { ok: false, errors: [{ path: '/', message: '--keep takes a whole number, 1 or more' }], usage: USAGE });
    let bundleOptions;
    if (opts.bundleJson !== undefined) {
      try {
        // `@<file>` reads the object from a file, which keeps quotes in a title out of the shell.
        const text = opts.bundleJson.startsWith('@') ? readFileSync(resolve(opts.bundleJson.slice(1)), 'utf8') : opts.bundleJson;
        bundleOptions = JSON.parse(text);
      } catch (e) {
        return fail(1, { ok: false, errors: [{ path: '/', message: `--bundle takes a JSON object or @<file>: ${e.message}`, hint: 'pass the "bundle" object that drift printed' }] });
      }
      if (typeof bundleOptions !== 'object' || bundleOptions === null || Array.isArray(bundleOptions)) return fail(1, { ok: false, errors: [{ path: '/', message: '--bundle takes a JSON object' }] });
    }
    // An --extra path is read like every other path, from the working directory; one that does
    // not exist there is tried inside the run folder.
    const extras = opts.extras.map((f) => (existsSync(resolve(f)) ? resolve(f) : f));
    let result;
    if (opts.command === 'revisions') result = listRevisions(opts.positional[0]);
    else if (opts.command === 'restore') result = restoreRun(opts.positional[0], opts.positional[1], { keep, request: opts.request, extras, bundle: bundleOptions });
    else result = snapshotRun(opts.positional[0], { keep, request: opts.request, extras, bundle: bundleOptions });
    if (!result.ok) return fail(result.code, { ok: false, errors: result.errors });
    process.stdout.write(JSON.stringify(result) + '\n');
    return 0;
  }
  if (opts.command === 'extract') {
    if (opts.figjamScript !== undefined) {
      if (opts.positional.length !== 0) return fail(1, { ok: false, errors: [{ path: '/', message: 'extract --figjam-script takes no input file: it writes the script that reads the board' }], usage: USAGE });
      const from = opts.from === undefined ? 0 : Number(opts.from);
      if (!(Number.isInteger(from) && from >= 0)) return fail(1, { ok: false, errors: [{ path: '/', message: '--from takes a whole number, 0 or more: the "next" a part returned' }], usage: USAGE });
      try {
        mkdirSync(dirname(resolve(opts.figjamScript)), { recursive: true });
        writeFileSync(resolve(opts.figjamScript), figjamReaderScript({ section: opts.section, from }));
      } catch (e) {
        return fail(1, { ok: false, errors: [{ path: opts.figjamScript, message: `cannot write file: ${e.message}` }] });
      }
      process.stdout.write(JSON.stringify({ ok: true, script: opts.figjamScript, section: opts.section ?? null, from, calls: 1, next: 'run the script unchanged with use_figma on the board and save the JSON it returns to a file; when that JSON has "next" set, write the script again with --from <next> and read the next part; then run extract on every part' }) + '\n');
      return 0;
    }
    if (opts.page !== undefined && opts.figjamScript !== undefined) return fail(1, { ok: false, errors: [{ path: '/', message: '--page goes with reading a file, not with --figjam-script' }], usage: USAGE });
    if (opts.section !== undefined || opts.from !== undefined) return fail(1, { ok: false, errors: [{ path: '/', message: `${opts.section !== undefined ? '--section' : '--from'} goes with --figjam-script` }], usage: USAGE });
    if (opts.positional.length === 0) return fail(1, { ok: false, errors: [{ path: '/', message: 'extract takes a file (or every part of a board read in parts)' }], usage: USAGE });
    const bufs = [];
    for (const f of opts.positional) {
      try {
        bufs.push(readFileSync(resolve(f)));
      } catch (e) {
        return fail(1, { ok: false, errors: [{ path: f, message: `cannot read file: ${e.message}` }] });
      }
    }
    const file = opts.positional.length === 1 ? opts.positional[0] : opts.positional;
    const result = opts.positional.length === 1 ? extractFacts(bufs[0], file) : extractBoards(bufs);
    if (!result.ok) return fail(1, { ok: false, errors: [{ path: String(opts.positional[0]), message: result.error, ...(opts.positional.length > 1 ? { hint: 'several files are read only as the parts of one FigJam board' } : {}) }] });
    let facts = { ...result.facts, file, sha256: createHash('sha256').update(Buffer.concat(bufs)).digest('hex') };
    if (opts.page !== undefined) {
      // The pages the user wants, by id or by name; cover then asks only for their texts.
      const wanted = opts.page.split(',').map((x) => x.trim()).filter(Boolean);
      const unknown = wanted.filter((w) => !facts.pages.some((p) => p.id === w || p.name === w));
      if (unknown.length > 0) return fail(1, { ok: false, errors: [{ path: '--page', message: `no page ${unknown.map((u) => `"${u}"`).join(', ')} in this source`, hint: `pages: ${facts.pages.map((p) => `${p.id} ("${p.name}")`).join(', ')}` }] });
      facts = { ...facts, pages: facts.pages.filter((p) => wanted.includes(p.id) || wanted.includes(p.name)) };
    }
    if (!opts.out) {
      process.stdout.write(JSON.stringify(facts, null, 2) + '\n');
      return 0;
    }
    try {
      mkdirSync(dirname(resolve(opts.out)), { recursive: true });
      writeFileSync(resolve(opts.out), JSON.stringify(facts, null, 2) + '\n');
    } catch (e) {
      return fail(1, { ok: false, errors: [{ path: opts.out, message: `cannot write file: ${e.message}` }] });
    }
    const pages = facts.pages.map((p) => ({ id: p.id, name: p.name, nodes: p.nodes.length, edges: p.edges.length, kindHints: p.kindHints.slice(0, 3), warnings: p.warnings }));
    process.stdout.write(JSON.stringify({ ok: true, format: facts.format, out: opts.out, pages }) + '\n');
    return 0;
  }
  if (opts.command === 'cover') {
    if (opts.positional.length < 2) return fail(1, { ok: false, errors: [{ path: '/', message: 'cover takes the facts file that extract wrote and the IR files (or run folder) made from it' }], usage: USAGE });
    const [factsFile, ...targets] = opts.positional;
    const read = readIr(factsFile);
    if (read.error) return fail(1, { ok: false, errors: [read.error] });
    if (read.ir.facts !== 1 || !Array.isArray(read.ir.pages)) return fail(1, { ok: false, errors: [{ path: factsFile, message: 'not a facts file (no "facts": 1 and "pages")', hint: 'pass the file extract --out wrote' }] });
    const irs = [];
    for (const target of targets) {
      let files;
      try {
        files = statSync(resolve(target)).isDirectory() ? irFilesOf(resolve(target)) : [target];
      } catch (e) {
        return fail(1, { ok: false, errors: [{ path: target, message: `cannot read: ${e.message}` }] });
      }
      for (const f of files) {
        const { ir, error } = readIr(f);
        if (error) return fail(1, { ok: false, errors: [error] });
        irs.push({ name: diagramIdOf(f), ir });
      }
    }
    if (irs.length === 0) return fail(1, { ok: false, errors: [{ path: targets[0], message: 'no IR files found' }] });
    const result = cover(read.ir, irs);
    if (!result.ok) {
      process.stderr.write(JSON.stringify({ ok: false, units: result.units, covered: result.covered, missing: result.missing, edges: result.edges, lostEdges: result.lostEdges, hint: 'put each missing text into the IR, or add a meta.omitted entry that quotes the text and gives the reason, in the form «"<text>": <reason>» (merged into another element, collapsed into a step, left out on purpose); a meta.notes entry does not count. Each lost edge is a line of the source between the two texts named that no relation of the IR joins: add the relation, or a meta.omitted entry that quotes its label (or its two ends when it has none) and gives the reason' }) + '\n');
      return 2;
    }
    process.stdout.write(JSON.stringify(result) + '\n');
    return 0;
  }
  if (opts.command === 'sources') {
    if (opts.positional.length !== 1) return fail(1, { ok: false, errors: [{ path: '/', message: 'sources takes exactly one run folder' }], usage: USAGE });
    const only = opts.only === undefined ? undefined : opts.only.split(',').map((x) => x.trim()).filter(Boolean);
    const result = recordSources(opts.positional[0], { root: opts.root, only });
    if (!result.ok) return fail(result.code, { ok: false, errors: result.errors });
    const { warnings, ...rest } = result;
    if (warnings.length > 0) process.stderr.write(JSON.stringify({ warnings }) + '\n');
    process.stdout.write(JSON.stringify({ ...rest, warnings: warnings.length }) + '\n');
    return 0;
  }
  if (opts.command === 'stale') {
    if (opts.positional.length === 0) return fail(1, { ok: false, errors: [{ path: '/', message: 'stale takes at least one run folder' }], usage: USAGE });
    if (opts.only !== undefined) return fail(1, { ok: false, errors: [{ path: '/', message: '--only goes with sources' }], usage: USAGE });
    const runs = [];
    const errors = [];
    for (const dir of opts.positional) {
      const result = staleRun(dir, { root: opts.root });
      if (result.ok) {
        const { ok, ...run } = result;
        runs.push(run);
      } else errors.push(...result.errors);
    }
    const stale = runs.some((r) => r.stale);
    // What could be compared is printed even when another run could not be: one run without
    // a record must not hide a changed file in the next.
    if (runs.length > 0) process.stdout.write(JSON.stringify({ ok: errors.length === 0, stale, runs }) + '\n');
    if (errors.length > 0) return fail(1, { ok: false, errors });
    return stale ? 2 : 0;
  }
  if (opts.command.startsWith('glossary ')) return glossaryCommand(opts);
  if (opts.command.startsWith('labs ')) return labsCommand(opts);
  return fail(1, { ok: false, errors: [{ path: '/', message: `unknown command "${opts.command ?? ''}"` }], usage: USAGE });
}

/** `labs start|status|stop|serve`: one JSON object on stdout, or an error on stderr with exit 1. */
async function labsCommand(opts) {
  const sub = opts.command.split(' ')[1];
  if (['wait', 'progress', 'ask', 'done', 'holds'].includes(sub)) return labsAgentCommand(sub, opts);
  if (opts.positional.length !== 0) return fail(1, { ok: false, errors: [{ path: '/', message: `labs ${sub} takes no file` }], usage: USAGE });
  if (sub === 'serve') return serve({ root: opts.root, port: opts.port, idleMinutes: opts.idleMinutes });
  const result = sub === 'start'
    ? await startServer({ root: opts.root, port: opts.port, idleMinutes: opts.idleMinutes, skipCloudCheck: opts.skipCloudCheck })
    : sub === 'status' ? await serverStatus({ root: opts.root }) : await stopServer({ root: opts.root, force: opts.force });
  if (result.error) return fail(result.code, { ok: false, error: result.error });
  // Each start names a fresh agent session: the agent passes it to every call of the bridge.
  const out = sub === 'start' ? { ...result.out, session: `s-${randomBytes(12).toString('base64url')}` } : result.out;
  process.stdout.write(JSON.stringify(out) + '\n');
  return result.code;
}

/** `labs wait|progress|ask|done|holds`: the agent's calls to the console of its project. */
async function labsAgentCommand(sub, opts) {
  const bad = (message, hint) => fail(1, { ok: false, error: { code: 'bad-request', message, ...(hint ? { hint } : {}) } });
  const file = readServerFile(projectRoot(opts.root));
  if (sub === 'holds') {
    if (opts.positional.length !== 1) return bad('labs holds takes one run folder');
    const run = basename(resolve(opts.positional[0]));
    if (!file) { process.stdout.write(JSON.stringify({ held: false }) + '\n'); return 0; }
    const r = await agentCall(file, { method: 'GET', path: `/agent/holds?run=${encodeURIComponent(run)}` });
    if (!r.ok) {
      if (r.error.code === 'no-server') { process.stdout.write(JSON.stringify({ held: false }) + '\n'); return 0; }
      return fail(1, { ok: false, error: r.error });
    }
    process.stdout.write(JSON.stringify(r.body) + '\n');
    return r.body.held ? 2 : 0;
  }
  if (!opts.session) return bad(`labs ${sub} needs --session <id>, the id labs start printed`);
  const timeout = opts.timeout === undefined ? undefined : Number(opts.timeout);
  if (opts.timeout !== undefined && !(Number.isFinite(timeout) && timeout > 0)) return bad('--timeout takes a number of seconds above 0');
  const readText = (value, what) => {
    try {
      return { text: readFileSync(resolve(value.startsWith('@') ? value.slice(1) : value), 'utf8') };
    } catch (e) {
      return { error: bad(`cannot read the ${what} file: ${e.code ?? 'error'}`) };
    }
  };
  let call;
  if (sub === 'wait') {
    if (opts.positional.length !== 0) return bad('labs wait takes no job');
    call = { path: '/agent/wait', body: { session: opts.session, ...(timeout ? { timeout } : {}) } };
  } else {
    if (opts.positional.length !== 1) return bad(`labs ${sub} takes one job id`);
    const job = encodeURIComponent(opts.positional[0]);
    if (sub === 'progress') {
      if (opts.message === undefined) return bad('labs progress needs --message <text>');
      call = { path: `/agent/jobs/${job}/progress`, body: { session: opts.session, message: opts.message } };
    } else if (sub === 'ask') {
      if (opts.question === undefined) return bad('labs ask needs --question @<file.json>');
      const read = readText(opts.question, 'question');
      if (read.error) return read.error;
      let question;
      try { question = JSON.parse(read.text); } catch { return bad('the question file is not valid JSON'); }
      call = { path: `/agent/jobs/${job}/ask`, body: { session: opts.session, question, ...(timeout ? { timeout } : {}) } };
    } else {
      if (opts.result !== 'done' && opts.result !== 'failed') return bad('labs done needs --result done or --result failed');
      let report;
      if (opts.report !== undefined) {
        const read = readText(opts.report, 'report');
        if (read.error) return read.error;
        report = read.text;
      }
      call = { path: `/agent/jobs/${job}/done`, body: { session: opts.session, result: opts.result, ...(report !== undefined ? { report } : {}) } };
    }
  }
  const r = await agentCall(file, call);
  if (!r.ok) return fail(1, { ok: false, error: r.error });
  process.stdout.write(JSON.stringify(r.body) + '\n');
  return 0;
}

/** `glossary list|add|set|pairs|check`. */
function glossaryCommand(opts) {
  const sub = opts.command.split(' ')[1];
  const usage = (message, hint) => fail(1, { ok: false, errors: [{ path: '/', message, ...(hint ? { hint } : {}) }], usage: USAGE });
  if (opts.status !== undefined && !STATUSES.includes(opts.status)) return usage(`unknown status "${opts.status}"`, `--status takes one of: ${STATUSES.join(', ')}`);
  if (sub === 'list') {
    if (opts.positional.length !== 0) return usage('glossary list takes no file');
    const read = readGlossary(opts.root);
    if (!read.ok) return fail(1, { ok: false, path: read.path, errors: read.errors });
    const entries = read.glossary.entries.filter((e) => opts.status === undefined || e.status === opts.status);
    const counts = Object.fromEntries(STATUSES.map((s) => [s, read.glossary.entries.filter((e) => e.status === s).length]));
    process.stdout.write(JSON.stringify({ ok: true, path: read.path, exists: read.exists, rev: read.rev, counts, entries }) + '\n');
    return 0;
  }
  if (sub === 'add') {
    if (opts.positional.length !== 0 || opts.entries === undefined) return usage('glossary add needs --entries <file.json> and no other file');
    if (opts.status === 'rejected') return usage('glossary add writes suggested or confirmed entries', 'reject an entry with glossary set <id> --status rejected');
    let input;
    try {
      input = JSON.parse(readFileSync(resolve(opts.entries), 'utf8'));
    } catch (e) {
      return fail(1, { ok: false, errors: [{ path: opts.entries, message: `cannot read the entries: ${e instanceof SyntaxError ? 'not valid JSON' : e.code ?? 'error'}`, hint: 'a JSON object {"entries": [{"terms": {"en": "...", "vi": "..."}}]}' }] });
    }
    if (input === null || typeof input !== 'object' || !Array.isArray(input.entries) || input.entries.length === 0) return fail(1, { ok: false, errors: [{ path: opts.entries, message: 'the file must hold {"entries": [...]} with at least one entry' }] });
    const result = addEntries(opts.root, input.entries, { status: opts.status ?? 'suggested' });
    if (!result.ok) return fail(1, { ok: false, errors: result.errors });
    process.stdout.write(JSON.stringify({ ok: true, rev: result.rev, written: result.written, added: result.added, skipped: result.skipped, conflicts: result.conflicts }) + '\n');
    return 0;
  }
  if (sub === 'set') {
    if (opts.positional.length !== 1 || opts.status === undefined) return usage('glossary set takes one entry id and --status <status>');
    const read = readGlossary(opts.root);
    if (!read.ok) return fail(1, { ok: false, path: read.path, errors: read.errors });
    if (!read.exists) return fail(1, { ok: false, errors: [{ path: read.path, message: 'the project has no glossary', hint: 'write one with glossary add, or pass --root <project>' }] });
    const result = setStatus(opts.root, opts.positional[0], opts.status, { expectedRev: read.rev });
    if (!result.ok) return fail(1, { ok: false, errors: result.errors });
    if (result.missing) return fail(1, { ok: false, errors: [{ path: '/', message: `no entry ${opts.positional[0]} in the glossary`, hint: 'glossary list prints the ids' }] });
    process.stdout.write(JSON.stringify({ ok: true, rev: result.rev, written: result.written, id: result.id, status: result.status }) + '\n');
    return 0;
  }
  if (opts.positional.length === 0) return usage(`glossary ${sub} takes at least one run folder`);
  if (sub === 'pairs') {
    const pairs = [];
    const unpaired = {};
    for (const dir of opts.positional) {
      const run = readRun(dir);
      if (!run.ok) return fail(1, { ok: false, errors: run.errors });
      const found = pairsOf(run);
      pairs.push(...redactedPairs(found.pairs));
      for (const [form, n] of Object.entries(found.unpaired)) unpaired[form] = (unpaired[form] ?? 0) + n;
    }
    process.stdout.write(JSON.stringify({ ok: true, pairs, unpaired }) + '\n');
    return 0;
  }
  const result = checkRuns(opts.root, opts.positional);
  if (!result.ok) return fail(1, { ok: false, errors: result.errors });
  process.stdout.write(JSON.stringify(result.report) + '\n');
  return result.report.blocking > 0 ? 2 : 0;
}

process.exitCode = await main(process.argv.slice(2));
