#!/usr/bin/env node
/**
 * Zukai CLI. Exit codes: 0 success, 1 usage or I/O error, 2 validation errors.
 * Errors and warnings are printed as JSON on stderr so an agent can parse them.
 *
 *   node cli.mjs validate <ir.json>
 *   node cli.mjs emit --to <target> <ir.json> [--out <file>] [--allow-sensitive] [--mermaid-stable]
 *   node cli.mjs bundle --to <drawio|mermaid> --out <file> [--title <text>] [--canvas all|<id,id,...> [--gap <px>]] <ir.json>...
 *     (one file holding every diagram; --canvas adds a first draw.io page with those diagrams side by side)
 *   node cli.mjs relabel <file.drawio> --map <labels.json> --out <file.drawio>   (new labels by IR id, layout kept)
 *   node cli.mjs preview <file.drawio|file.mmd> [--out <file.png>] [--max-px <n>]   (optional; needs draw.io desktop or Playwright)
 *   node cli.mjs diff <old.ir.json|old-dir> <new.ir.json|new-dir>   (elements added, removed, changed; a dir is a run's source/ folder)
 *   node cli.mjs drift <file.drawio> <ir.json>...   (cells that differ from a fresh emit: hand edits made in draw.io)
 *   node cli.mjs snapshot <run-dir> [--keep <n>] [--request <text>] [--extra <file>]... [--bundle <json>]   (save every IR of a run as a revision)
 *   node cli.mjs revisions <run-dir>   (the revisions of a run, newest first)
 *   node cli.mjs restore <run-dir> <rNNN> [--keep <n>] [--request <text>]   (snapshot the current state, then put a revision back)
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { validateIr } from './validate-ir.mjs';
import { emit, bundle, TARGETS } from './pipeline.mjs';
import { preview } from './preview.mjs';
import { relabelDrawio } from './relabel.mjs';
import { diffIr, diffRun } from './ir-diff.mjs';
import { driftDrawio } from './drift.mjs';
import { snapshotRun, listRevisions, restoreRun } from './revisions.mjs';

const USAGE = `usage:
  cli.mjs validate <ir.json>
  cli.mjs emit --to <${TARGETS.join('|')}> <ir.json> [--out <file>] [--allow-sensitive] [--mermaid-stable]
  cli.mjs bundle --to <drawio|mermaid> --out <file> [--title <text>] [--canvas all|<id,id,...> [--gap <px>]] <ir.json>...
  cli.mjs relabel <file.drawio> --map <labels.json> --out <file.drawio>
  cli.mjs preview <file.drawio|file.mmd> [--out <file.png>] [--max-px <n>]
  cli.mjs diff <old.ir.json|old-dir> <new.ir.json|new-dir>
  cli.mjs drift <file.drawio> <ir.json>...
  cli.mjs snapshot <run-dir> [--keep <n>] [--request <text>] [--extra <file>]... [--bundle <json>]
  cli.mjs revisions <run-dir>
  cli.mjs restore <run-dir> <rNNN> [--keep <n>] [--request <text>]`;

function fail(code, payload) {
  process.stderr.write(JSON.stringify(payload) + '\n');
  return code;
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const opts = { command, positional: [], to: undefined, out: undefined, title: undefined, canvas: undefined, gap: undefined, map: undefined, maxPx: undefined, keep: undefined, request: undefined, extras: [], bundleJson: undefined, allowSensitive: false, mermaidStable: false };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--to') opts.to = rest[++i];
    else if (a === '--out') opts.out = rest[++i];
    else if (a === '--title') opts.title = rest[++i];
    else if (a === '--canvas') opts.canvas = rest[++i];
    else if (a === '--gap') opts.gap = rest[++i];
    else if (a === '--map') opts.map = rest[++i];
    else if (a === '--max-px') opts.maxPx = rest[++i];
    else if (a === '--keep') opts.keep = rest[++i];
    else if (a === '--request') opts.request = rest[++i];
    else if (a === '--extra') opts.extras.push(rest[++i]);
    else if (a === '--bundle') opts.bundleJson = rest[++i];
    else if (a === '--allow-sensitive') opts.allowSensitive = true;
    else if (a === '--mermaid-stable') opts.mermaidStable = true;
    else if (a.startsWith('--')) return { error: `unknown option ${a}` };
    else opts.positional.push(a);
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

/** Read and validate IR files; a directory stands for its `*.ir.json` files (a run folder for its `source/`). */
function readIrSet(target) {
  const path = resolve(target);
  let files;
  try {
    if (statSync(path).isDirectory()) {
      const dir = existsSync(join(path, 'source')) && statSync(join(path, 'source')).isDirectory() ? join(path, 'source') : path;
      files = readdirSync(dir).filter((f) => f.endsWith('.ir.json')).sort().map((f) => join(dir, f));
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
  if (opts.error) return fail(1, { ok: false, errors: [{ path: '/', message: opts.error }], usage: USAGE });
  if (opts.command === 'validate') {
    if (opts.positional.length !== 1) return fail(1, { ok: false, errors: [{ path: '/', message: 'validate takes exactly one file' }], usage: USAGE });
    const { ir, error } = readIr(opts.positional[0]);
    if (error) return fail(1, { ok: false, errors: [error] });
    const result = validateIr(ir);
    if (!result.ok) return fail(2, { ok: false, errors: result.errors });
    process.stdout.write(JSON.stringify({ ok: true, kind: ir.kind, title: ir.title }) + '\n');
    return 0;
  }
  if (opts.command === 'emit') {
    if (opts.positional.length !== 1 || !opts.to) return fail(1, { ok: false, errors: [{ path: '/', message: 'emit needs --to <target> and exactly one file' }], usage: USAGE });
    const { ir, error } = readIr(opts.positional[0]);
    if (error) return fail(1, { ok: false, errors: [error] });
    const diagramId = opts.out ? basename(opts.out, extname(opts.out)).replace(/\.ir$/, '') : undefined;
    const result = await emit(ir, opts.to, { allowSensitive: opts.allowSensitive, mermaidStable: opts.mermaidStable, diagramId });
    if (!result.ok) return fail(2, { ok: false, errors: result.errors, warnings: result.warnings });
    if (result.warnings.length > 0) process.stderr.write(JSON.stringify({ warnings: result.warnings }) + '\n');
    if (opts.out) {
      const outPath = resolve(opts.out);
      try {
        mkdirSync(dirname(outPath), { recursive: true });
        writeFileSync(outPath, result.output, 'utf8');
      } catch (e) {
        return fail(1, { ok: false, errors: [{ path: opts.out, message: `cannot write file: ${e.message}` }] });
      }
      process.stdout.write(JSON.stringify({ ok: true, out: outPath, warnings: result.warnings.length }) + '\n');
      return 0;
    }
    process.stdout.write(result.output);
    return 0;
  }
  if (opts.command === 'bundle') {
    if (opts.positional.length === 0 || !opts.to || !opts.out) return fail(1, { ok: false, errors: [{ path: '/', message: 'bundle needs --to <target>, --out <file> and at least one IR file' }], usage: USAGE });
    const entries = [];
    const seen = new Map();
    for (const file of opts.positional) {
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
    process.stdout.write(JSON.stringify({ ok: true, out: outPath, diagrams: entries.length, warnings: result.warnings.length, ...(result.canvas ? { canvas: result.canvas } : {}) }) + '\n');
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
    for (const u of result.untouched) warnings.push({ stage: 'relabel', path: u.places[0], message: `label not relabelled: "${u.text}" (${u.places.join(', ')})`, hint: 'add a map entry for its id, or list the text in "$keep" to leave it as it is everywhere' });
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
    process.stdout.write(JSON.stringify({ ok: true, preview: result.out, files: result.files, tiled: result.tiled === true, ...(result.tiled ? { overlap: result.overlap } : {}), scale: result.scale, renderer: result.renderer }) + '\n');
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
      const differs = d.replaced || d.fields.length + d.added.length + d.removed.length + d.changed.length > 0;
      process.stdout.write(JSON.stringify({ ok: true, differs, ...d }) + '\n');
      return 0;
    }
    process.stdout.write(JSON.stringify({ ok: true, ...diffRun(a.entries, b.entries) }) + '\n');
    return 0;
  }
  if (opts.command === 'drift') {
    if (opts.positional.length < 2) return fail(1, { ok: false, errors: [{ path: '/', message: 'drift takes one .drawio file and the IR files it was emitted from' }], usage: USAGE });
    const [file, ...irFiles] = opts.positional;
    let xml;
    try {
      xml = readFileSync(resolve(file), 'utf8');
    } catch (e) {
      return fail(1, { ok: false, errors: [{ path: file, message: `cannot read file: ${e.message}` }] });
    }
    if (!/<mxfile\b/.test(xml)) return fail(1, { ok: false, errors: [{ path: file, message: 'not a .drawio file (no <mxfile> root)', hint: 'Mermaid output has no layout to keep; compare the IR with diff instead' }] });
    const entries = [];
    for (const f of irFiles) {
      const set = readIrSet(f);
      if (set.error) return fail(set.error.code, set.error.payload);
      entries.push(...set.entries);
    }
    const result = await driftDrawio(xml, entries);
    if (!result.ok) return fail(result.errors.some((e) => e.path === '/') ? 1 : 2, { ok: false, errors: result.errors });
    process.stdout.write(JSON.stringify(result) + '\n');
    return 0;
  }
  if (opts.command === 'snapshot' || opts.command === 'restore' || opts.command === 'revisions') {
    const want = opts.command === 'restore' ? 2 : 1;
    if (opts.positional.length !== want) return fail(1, { ok: false, errors: [{ path: '/', message: opts.command === 'restore' ? 'restore takes a run folder and a revision (rNNN)' : `${opts.command} takes exactly one run folder` }], usage: USAGE });
    const keep = opts.keep === undefined ? undefined : Number(opts.keep);
    if (opts.keep !== undefined && !(Number.isInteger(keep) && keep >= 1)) return fail(1, { ok: false, errors: [{ path: '/', message: '--keep takes a whole number, 1 or more' }], usage: USAGE });
    let result;
    if (opts.command === 'revisions') result = listRevisions(opts.positional[0]);
    else if (opts.command === 'restore') result = restoreRun(opts.positional[0], opts.positional[1], { keep, request: opts.request });
    else {
      let bundleOptions;
      if (opts.bundleJson !== undefined) {
        try {
          bundleOptions = JSON.parse(opts.bundleJson);
        } catch (e) {
          return fail(1, { ok: false, errors: [{ path: '/', message: `--bundle takes a JSON object: ${e.message}`, hint: 'pass the "bundle" object that drift printed' }] });
        }
        if (typeof bundleOptions !== 'object' || bundleOptions === null || Array.isArray(bundleOptions)) return fail(1, { ok: false, errors: [{ path: '/', message: '--bundle takes a JSON object' }] });
      }
      result = snapshotRun(opts.positional[0], { keep, request: opts.request, extras: opts.extras, bundle: bundleOptions });
    }
    if (!result.ok) return fail(result.code, { ok: false, errors: result.errors });
    process.stdout.write(JSON.stringify(result) + '\n');
    return 0;
  }
  return fail(1, { ok: false, errors: [{ path: '/', message: `unknown command "${opts.command ?? ''}"` }], usage: USAGE });
}

process.exitCode = await main(process.argv.slice(2));
