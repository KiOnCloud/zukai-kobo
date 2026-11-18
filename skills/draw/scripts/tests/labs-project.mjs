/**
 * A sample project for the labs tests, written into a temporary folder: runs of several
 * shapes (parts and a business view, a language variant, a Mermaid run, a FigJam run, a
 * scouted run with revisions), plus the things a listing must leave out (a link to a folder
 * outside, a file named like a run, a folder that is not a run, a link inside a run).
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixturesDir, loadFixture } from './helpers.mjs';
import { snapshotRun } from '../src/revisions.mjs';
import { recordSources } from '../src/sources.mjs';

/** The runs folders the labs tests run against: the default, and one a project setting names. */
export const RUNS_DIRS = [undefined, 'docs/diagrams'];

const write = (file, value) => {
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
  return file;
};

/**
 * With `runsDir`, the project names that folder in `.zukai/config.json` and every run lies
 * there instead of under `diagrams/`; `dir` is the runs folder either way.
 */
export function labsProject({ runsDir } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'zukai-labs-project-'));
  cpSync(join(fixturesDir, 'glossary', 'project'), root, { recursive: true });
  const diagrams = join(root, ...(runsDir ?? 'diagrams').split('/'));
  if (runsDir !== undefined) {
    mkdirSync(join(diagrams, '..'), { recursive: true });
    renameSync(join(root, 'diagrams'), diagrams);
    write(join(root, '.zukai', 'config.json'), { config: 1, runsDir });
  }

  // A scouted run with a part, a business view, pictures, drafts and two revisions.
  write(join(root, 'src', 'pay.js'), 'export const pay = () => true;\n');
  const checkout = join(diagrams, '20261110_checkout');
  const main = { ...loadFixture('flowchart', 'valid'), title: 'Checkout', meta: { source: 'scout', sources: ['src/pay.js'] } };
  write(join(checkout, 'source', 'checkout.ir.json'), main);
  write(join(checkout, 'source', 'checkout-business.ir.json'), { ...main, title: 'Checkout (business)', meta: { source: 'scout', audience: 'business', sources: ['src/pay.js'] } });
  write(join(checkout, 'source', 'checkout-01-pay.ir.json'), { ...loadFixture('sequence', 'valid'), meta: { source: 'scout', sources: ['src/pay.js'] } });
  write(join(checkout, 'checkout.drawio'), '<mxfile><diagram id="checkout" name="Checkout"></diagram></mxfile>\n');
  write(join(checkout, 'svg', 'checkout.drawio.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>\n');
  write(join(checkout, 'drafts', 'a', 'changes.diff.drawio'), '<mxfile></mxfile>\n');
  recordSources(checkout, { root });
  snapshotRun(checkout, { request: 'first state' });
  const changed = JSON.parse(readFileSync(join(checkout, 'source', 'checkout.ir.json'), 'utf8'));
  changed.nodes[0].label = 'Customer submits the cart';
  write(join(checkout, 'source', 'checkout.ir.json'), changed);
  snapshotRun(checkout, { request: 'reword the first step' });
  write(join(root, 'src', 'pay.js'), 'export const pay = () => false;\n');

  // A Mermaid run.
  const lifecycle = join(diagrams, '20261111_order-lifecycle');
  write(join(lifecycle, 'source', 'order-lifecycle.ir.json'), loadFixture('state', 'valid'));
  write(join(lifecycle, 'order-lifecycle.md'), '# Order lifecycle\n');
  write(join(lifecycle, 'mermaid', 'order-lifecycle.mmd'), 'stateDiagram-v2\n');

  // A FigJam run.
  const board = join(diagrams, '20261112_team-board');
  write(join(board, 'source', 'team-board.ir.json'), { ...loadFixture('architecture', 'valid'), meta: { source: 'recook' } });
  write(join(board, 'figjam', 'team-board.mmd'), 'flowchart LR\n');

  // What a listing leaves out.
  const outside = mkdtempSync(join(tmpdir(), 'zukai-labs-outside-'));
  write(join(outside, 'source', 'secret.ir.json'), loadFixture('flowchart', 'valid'));
  write(join(outside, 'outside.txt'), 'a file outside the project\n');
  // Windows creates a link only with the right to; without it there is no link to leave out.
  const link = (target, path, type) => { try { symlinkSync(target, path, type); } catch { /* no right to create links */ } };
  link(outside, join(diagrams, '20261113_link'), 'junction');
  write(join(diagrams, '20261114_file'), 'not a folder\n');
  write(join(diagrams, 'notes', 'source', 'x.ir.json'), loadFixture('flowchart', 'valid'));
  link(join(outside, 'outside.txt'), join(checkout, 'source', 'leak.txt'), 'file');

  return { root, dir: diagrams, outside, runs: { login: '20261109_login-flow', checkout: '20261110_checkout', lifecycle: '20261111_order-lifecycle', board: '20261112_team-board' } };
}

/** A SHA-256 per file of a tree, links included as their target text. */
export function hashTree(dir) {
  const out = {};
  const walk = (at, prefix) => {
    for (const n of readdirSync(at).sort()) {
      const path = join(at, n);
      const st = statSync(path, { throwIfNoEntry: false });
      if (!st) continue;
      const name = `${prefix}${n}`;
      if (st.isDirectory()) walk(path, `${name}/`);
      else out[name] = `${st.mtimeMs}:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
    }
  };
  walk(dir, '');
  return out;
}
