#!/usr/bin/env node
/**
 * Zukai CLI. Exit codes: 0 success, 1 usage or I/O error, 2 validation errors.
 * Errors and warnings are printed as JSON on stderr so an agent can parse them.
 * `help`, `--help` or `-h` prints the usage on stdout.
 *
 *   node cli.mjs validate <ir.json>
 *   node cli.mjs emit --to <target> <ir.json> [--out <file>] [--overlay <file.js>] [--native <file.js>] [--allow-sensitive] [--mermaid-stable]
 *     (--overlay, with --to figjam: the script for use_figma that draws what generate_diagram leaves out of a sequence diagram;
 *      --native, with --to figjam: the script(s) for use_figma that draw the whole board at the draw.io coordinates, for every kind)
 *   node cli.mjs bundle --to <drawio|mermaid> --out <file> [--title <text>] [--canvas all|<id,id,...> [--gap <px>]] <run-dir|ir.json>...
 *     (one file holding every diagram; a run folder stands for its IRs with the main diagram first;
 *      --canvas adds a first draw.io page with those diagrams side by side)
 *   node cli.mjs relabel <file.drawio> --map <labels.json> --out <file.drawio>   (new labels by IR id, layout kept)
 *   node cli.mjs preview <file.drawio|file.mmd|run.md> [--out <file.png>] [--max-px <n>]   (optional; needs draw.io desktop or Playwright)
 *   node cli.mjs diff <old.ir.json|old-dir> <new.ir.json|new-dir>   (elements added, removed, changed; a dir is a run's source/ folder)
 *   node cli.mjs drift <file.drawio|run.md> <ir.json|run-dir>...   (cells that differ from a fresh emit: hand edits made in draw.io)
 *   node cli.mjs snapshot <run-dir> [--keep <n>] [--request <text>] [--extra <file>]... [--bundle <json>|@<file>]   (save every IR of a run as a revision)
 *   node cli.mjs revisions <run-dir>   (the revisions of a run, newest first)
 *   node cli.mjs restore <run-dir> <rNNN|undo|redo> [--keep <n>] [--request <text>] [--extra <file>]... [--bundle <json>|@<file>]   (snapshot the current state, then put a revision back)
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { validateIr } from './validate-ir.mjs';
import { emit, bundle, inspect, TARGETS } from './pipeline.mjs';
import { preview } from './preview.mjs';
import { relabelDrawio } from './relabel.mjs';
import { diffIr, diffRun } from './ir-diff.mjs';
import { driftDrawio, driftMarkdown } from './drift.mjs';
import { orderIrFiles, runSlugOf } from './run-order.mjs';
import { snapshotRun, listRevisions, restoreRun } from './revisions.mjs';
import { extractFacts, extractBoards } from './extract.mjs';
import { figjamReaderScript } from './extract-figjam.mjs';
import { cover } from './cover.mjs';

const USAGE = `usage:
  cli.mjs validate <ir.json>
  cli.mjs emit --to <${TARGETS.join('|')}> <ir.json> [--out <file>] [--overlay <file.js>] [--native <file.js>] [--allow-sensitive] [--mermaid-stable]
  cli.mjs bundle --to <drawio|mermaid> --out <file> [--title <text>] [--canvas all|<id,id,...> [--gap <px>]] [--allow-sensitive] <run-dir|ir.json>...
  cli.mjs relabel <file.drawio> --map <labels.json> --out <file.drawio>
  cli.mjs preview <file.drawio|file.mmd|run.md> [--out <file.png>] [--max-px <n>]
  cli.mjs diff <old.ir.json|old-dir> <new.ir.json|new-dir>
  cli.mjs drift <file.drawio|run.md> <ir.json|run-dir>...
  cli.mjs snapshot <run-dir> [--keep <n>] [--request <text>] [--extra <file>]... [--bundle <json>|@<file>]
  cli.mjs revisions <run-dir>
  cli.mjs restore <run-dir> <rNNN|undo|redo> [--keep <n>] [--request <text>] [--extra <file>]... [--bundle <json>|@<file>]
  cli.mjs extract <file.drawio|file.drawio.svg|file.drawio.png|file.mmd|file.md|board.json...> [--out <facts.json>]
  cli.mjs extract --figjam-script <file.js> [--section <name>] [--from <n>]
  cli.mjs cover <facts.json> <ir.json|run-dir>...
  cli.mjs help

A run folder (diagrams/<yyyymmdd>_<run-slug>) stands for the IR files in its source/ folder,
main diagram first. An option takes its value as the next argument or as --option=value.
--allow-sensitive says that what the secret scan found is not a secret.
--overlay goes with --to figjam: it writes the script that completes a sequence diagram on the
board (block frames, self-messages, notes); no file is written when the board needs none.
--native goes with --to figjam too: it writes the script for use_figma that draws the whole
board at the coordinates of the draw.io layout (<file>.js, then <file>.2.js, ... when one
script would be too long; run them in order). It works for every kind, class and activity
included; for those two no Mermaid text is written.
extract reads a diagram made elsewhere into facts (pages, nodes, edges, kind hints) for the
recook skill; --figjam-script writes the read-only use_figma script whose JSON result extract
then reads (a large board comes back in parts: run the script again with --from <next> and
pass every part to extract). cover exits 2 when a text of the facts is in none of the IRs.
Exit codes: 0 success, 1 usage or I/O error, 2 validation errors.`;

function fail(code, payload) {
  process.stderr.write(JSON.stringify(payload) + '\n');
  return code;
}

/** Options that take a value, and the field each one fills. */
const VALUE_OPTIONS = { '--to': 'to', '--out': 'out', '--title': 'title', '--canvas': 'canvas', '--gap': 'gap', '--map': 'map', '--max-px': 'maxPx', '--keep': 'keep', '--request': 'request', '--bundle': 'bundleJson', '--extra': 'extras', '--overlay': 'overlay', '--native': 'native', '--figjam-script': 'figjamScript', '--section': 'section', '--from': 'from' };
const FLAGS = { '--allow-sensitive': 'allowSensitive', '--mermaid-stable': 'mermaidStable' };

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const opts = { command, positional: [], to: undefined, out: undefined, title: undefined, canvas: undefined, gap: undefined, map: undefined, maxPx: undefined, keep: undefined, overlay: undefined, native: undefined, figjamScript: undefined, section: undefined, from: undefined, request: undefined, extras: [], bundleJson: undefined, allowSensitive: false, mermaidStable: false, help: false };
  if (command === 'help' || command === '--help' || command === '-h') return { ...opts, help: true };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--help' || a === '-h') { opts.help = true; continue; }
    if (!a.startsWith('--')) { opts.positional.push(a); continue; }
    const eq = a.indexOf('=');
    const name = eq < 0 ? a : a.slice(0, eq);
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
    if (!TARGETS.includes(opts.to)) return fail(1, { ok: false, errors: [{ path: '/', message: `unknown target "${opts.to}"`, hint: `--to takes one of: ${TARGETS.join(', ')}` }], usage: USAGE });
    const { ir, error } = readIr(opts.positional[0]);
    if (error) return fail(1, { ok: false, errors: [error] });
    if (opts.overlay && opts.to !== 'figjam') return fail(1, { ok: false, errors: [{ path: '/', message: `--overlay goes with --to figjam, not "${opts.to}"` }], usage: USAGE });
    if (opts.native && opts.to !== 'figjam') return fail(1, { ok: false, errors: [{ path: '/', message: `--native goes with --to figjam, not "${opts.to}"` }], usage: USAGE });
    const diagramId = opts.out ? basename(opts.out, extname(opts.out)).replace(/\.ir$/, '') : undefined;
    const result = await emit(ir, opts.to, { allowSensitive: opts.allowSensitive, mermaidStable: opts.mermaidStable, diagramId, native: opts.native !== undefined });
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
      process.stdout.write(JSON.stringify({ ok: true, out: null, text: `not written: ${result.textSkipped}`, overlay: null, native: nativePaths, warnings: result.warnings.length }) + '\n');
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
      process.stdout.write(JSON.stringify({ ok: true, out: outPath, ...(opts.to === 'figjam' ? { overlay: overlayPath ?? null } : {}), ...(nativePaths ? { native: nativePaths } : {}), warnings: result.warnings.length }) + '\n');
      return 0;
    }
    // With --native and no --out the scripts are the result; the Mermaid text is not printed between them.
    if (nativePaths) {
      process.stdout.write(JSON.stringify({ ok: true, out: null, text: 'not written: no --out given', overlay: overlayPath ?? null, native: nativePaths, warnings: result.warnings.length }) + '\n');
      return 0;
    }
    process.stdout.write(result.output);
    return 0;
  }
  if (opts.command === 'bundle') {
    if (opts.positional.length === 0 || !opts.to || !opts.out) return fail(1, { ok: false, errors: [{ path: '/', message: 'bundle needs --to <target>, --out <file> and at least one IR file' }], usage: USAGE });
    if (opts.to !== 'drawio' && opts.to !== 'mermaid') return fail(1, { ok: false, errors: [{ path: '/', message: `bundle supports drawio and mermaid, not "${opts.to}"`, hint: 'FigJam has no combined file: emit each diagram with --to figjam' }], usage: USAGE });
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
      entries.push({ ir, id: n === 1 ? base : `${base}-${n}` });
    }
    const canvas = opts.canvas === undefined ? undefined : opts.canvas === 'all' ? 'all' : opts.canvas.split(',').map((s) => s.trim()).filter(Boolean);
    const gap = opts.gap === undefined ? undefined : Number(opts.gap);
    if (opts.gap !== undefined && (opts.canvas === undefined || !Number.isFinite(gap) || gap < 0)) {
      return fail(1, { ok: false, errors: [{ path: '/', message: '--gap takes a number of pixels (0 or more) and needs --canvas' }], usage: USAGE });
    }
    const result = await bundle(entries, opts.to, { allowSensitive: opts.allowSensitive, mermaidStable: opts.mermaidStable, title: opts.title, canvas, gap });
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
    const result = await preview(opts.positional[0], { out: opts.out, maxPx });
    if (!result.ok) return fail(1, { ok: false, errors: result.errors });
    process.stdout.write(JSON.stringify({ ok: true, preview: result.out, files: result.files, tiled: result.tiled === true, ...(result.tiled ? { overlap: result.overlap } : {}), scale: result.scale, renderer: result.renderer, ...(result.blocks ? { blocks: result.blocks } : {}) }) + '\n');
    return 0;
  }
  if (opts.command === 'diff') {
    if (opts.positional.length !== 2) return fail(1, { ok: false, errors: [{ path: '/', message: 'diff takes two IR files or two directories' }], usage: USAGE });
    const a = readIrSet(opts.positional[0]);
    if (a.error) return fail(a.error.code, a.error.payload);
    const b = readIrSet(opts.positional[1]);
    if (b.error) return fail(b.error.code, b.error.payload);
    if (!a.directory && !b.directory) {
      const d = diffIr(a.entries[0].ir, b.entries[0].ir);
      const differs = d.replaced || d.fields.length + d.added.length + d.removed.length + d.changed.length + d.reordered.length > 0;
      process.stdout.write(JSON.stringify({ ok: true, differs, ...d }) + '\n');
      return 0;
    }
    process.stdout.write(JSON.stringify({ ok: true, ...diffRun(a.entries, b.entries) }) + '\n');
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
      process.stdout.write(JSON.stringify({ ok: true, script: opts.figjamScript, section: opts.section ?? null, from, next: 'run the script unchanged with use_figma on the board and save the JSON it returns to a file; when that JSON has "next" set, write the script again with --from <next> and read the next part; then run extract on every part' }) + '\n');
      return 0;
    }
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
    const facts = { ...result.facts, file };
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
      process.stderr.write(JSON.stringify({ ok: false, units: result.units, covered: result.covered, missing: result.missing, hint: 'put each missing text into the IR, or name it in a meta.omitted entry with the reason (merged into another element, moved to a part, left out on purpose)' }) + '\n');
      return 2;
    }
    process.stdout.write(JSON.stringify(result) + '\n');
    return 0;
  }
  return fail(1, { ok: false, errors: [{ path: '/', message: `unknown command "${opts.command ?? ''}"` }], usage: USAGE });
}

process.exitCode = await main(process.argv.slice(2));
