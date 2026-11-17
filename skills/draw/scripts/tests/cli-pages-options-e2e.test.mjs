/**
 * End to end, through the committed bundle and from another working directory: the options a
 * command takes, the page of a draw.io file that `preview` and `export` work on, the pages a
 * source and a bundle name, the language variant of the description tables, and the messages
 * that go with them.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scriptsDir, loadFixture } from './helpers.mjs';
import { loadPlaywright, findDrawioBinary, pngSize } from '../src/preview.mjs';

const cliPath = join(scriptsDir, 'bin', 'cli.mjs');
const cwd = mkdtempSync(join(tmpdir(), 'zukai-pages-cwd-'));
const cli = (...args) => {
  const r = spawnSync(process.execPath, [cliPath, ...args], { cwd, encoding: 'utf8' });
  const parse = (text) => text.trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return l; } });
  const out = parse(r.stdout);
  const err = parse(r.stderr);
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, out: out.at(-1), err: err.at(-1), warnings: err.flatMap((e) => e?.warnings ?? []), errors: err.flatMap((e) => e?.errors ?? []) };
};
const write = (file, value) => { mkdirSync(join(file, '..'), { recursive: true }); writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2)); return file; };
const tmp = (name) => mkdtempSync(join(tmpdir(), `zukai-pages-${name}-`));
const makeRun = (slug, irs) => {
  const run = join(tmp(slug), 'diagrams', `20261117_${slug}`);
  for (const [id, ir] of Object.entries(irs)) write(join(run, 'source', `${id}.ir.json`), ir);
  return run;
};
const flow = (title, extra = {}) => ({
  schemaVersion: 1, kind: 'flowchart', title,
  nodes: [{ id: 'start', label: 'Start', shape: 'terminal' }, { id: 'check', label: 'Check the request' }, { id: 'done', label: 'Done', shape: 'terminal' }],
  edges: [{ id: 'e1', from: 'start', to: 'check' }, { id: 'e2', from: 'check', to: 'done' }],
  ...extra,
});
const renderer = loadPlaywright(scriptsDir) !== null || findDrawioBinary().bin !== null;
const SLOW = 180_000;

describe('an option a command does not take', () => {
  let file;
  beforeAll(() => { file = write(join(tmp('opts'), 'f.ir.json'), flow('F')); });

  it('is refused with exit 1 and the options the command does take, instead of being read and dropped', () => {
    const cases = [
      [['validate', file, '--out', 'x.json'], 'validate does not take --out', 'validate takes no option'],
      [['drift', 'a.drawio', file, '--page', 'x'], 'drift does not take --page', 'drift takes no option'],
      [['diff', file, file, '--page', 'x'], 'diff does not take --page', 'diff takes --drawio, --allow-sensitive'],
      [['emit', '--to', 'drawio', file, '--page', 'x'], 'emit does not take --page', '--page goes with preview, export, extract'],
      [['bundle', '--to', 'drawio', '--out', 'x.drawio', file, '--max-px', '900'], 'bundle does not take --max-px', '--max-px goes with preview'],
      [['export', 'x.drawio', '--max-px', '900'], 'export does not take --max-px', 'export takes --page, --out'],
      [['preview', 'x.drawio', '--allow-sensitive'], 'preview does not take --allow-sensitive', 'preview takes --page, --out, --max-px'],
      [['snapshot', 'run', '--canvas', 'all'], 'snapshot does not take --canvas', '--canvas goes with bundle'],
      [['revisions', 'run', '--keep', '3'], 'revisions does not take --keep', '--keep goes with snapshot, restore'],
      [['cover', 'facts.json', file, '--out', 'x'], 'cover does not take --out', 'cover takes no option'],
    ];
    for (const [args, message, hint] of cases) {
      const r = cli(...args);
      expect(r.code, args.join(' ')).toBe(1);
      expect(r.errors[0].message, args.join(' ')).toBe(message);
      expect(r.errors[0].hint, args.join(' ')).toContain(hint);
      expect(r.err.usage, args.join(' ')).toContain('cli.mjs preview');
    }
    expect(existsSync(join(cwd, 'x.drawio'))).toBe(false);
    expect(existsSync(join(cwd, 'x.json'))).toBe(false);
  });

  it('still names an option no command has, and keeps the messages that say where an option belongs', () => {
    expect(cli('preview', 'x.drawio', '--frobnicate').errors[0].message).toBe('unknown option --frobnicate');
    expect(cli('stale', 'run', '--only', 'a').errors[0].message).toBe('--only goes with sources');
    expect(cli('emit', '--to', 'mermaid', file, '--overlay', 'o.js').errors[0].message).toContain('--overlay goes with --to figjam');
    expect(cli('emit', '--to', 'drawio', file, '--lang', 'ja').errors[0].message).toContain('--lang goes with --to doc');
  });

  it('takes every option its line of the help shows', () => {
    const help = cli('help').stdout;
    expect(help).toContain('A command takes the options its line above shows: any other option is refused, not ignored.');
    const lines = help.split('\n').filter((l) => /^ {2}cli\.mjs \w+ /.test(l));
    for (const line of lines) {
      const command = /cli\.mjs (\w+)/.exec(line)[1];
      for (const option of new Set(line.match(/--[a-z-]+/g) ?? [])) {
        const r = cli(command, option === '--allow-sensitive' || option === '--mermaid-stable' ? option : `${option}=1`);
        expect(r.errors[0]?.message ?? '', `${command} ${option}`).not.toMatch(/does not take|unknown option/);
      }
    }
    // The option the closing contract passes to bundle is in the help of bundle, as it is in that of emit.
    expect(lines.find((l) => l.includes('cli.mjs bundle'))).toContain('[--mermaid-stable]');
    expect(lines.find((l) => l.includes('cli.mjs preview'))).toContain('[--page <id|name>]');
    expect(lines.find((l) => l.includes('cli.mjs export'))).toContain('[--page <id|name>[,...]]');
    expect(lines.find((l) => l.includes('cli.mjs preview'))).toContain('file.drawio.svg');
  });

  it('writes a Mermaid bundle in the stable form when asked', () => {
    const run = makeRun('stable', { stable: loadFixture('activity', 'valid-business-fulfilment') });
    const out = join(run, 'stable.md');
    expect(cli('bundle', '--to', 'mermaid', '--mermaid-stable', '--out', out, run).code).toBe(0);
    expect(readFileSync(out, 'utf8')).not.toContain('swimlane-beta');
  });
});

describe('the page of a draw.io file that preview and export work on', () => {
  let run;
  let combined;
  beforeAll(() => {
    run = makeRun('shop', { shop: flow('Shop'), 'shop-01-pay': flow('Pay in detail'), 'shop-02-ship': flow('Ship in detail') });
    combined = join(run, 'shop.drawio');
    expect(cli('bundle', '--to', 'drawio', '--canvas', 'all', '--title', 'Shop', '--out', combined, run).code).toBe(0);
  });

  it('exits 1 with the list of pages when --page names none of them, for preview and for export, before any renderer is asked', () => {
    for (const command of ['preview', 'export']) {
      const r = cli(command, command === 'export' ? run : combined, '--page', 'shop-03-none');
      expect(r.code, command).toBe(1);
      expect(r.errors[0], command).toEqual({ path: '--page', message: 'no page "shop-03-none" in this file', hint: 'pages: canvas ("Shop (canvas)"), shop ("Shop"), shop-01-pay ("Pay in detail"), shop-02-ship ("Ship in detail")' });
    }
    expect(existsSync(join(run, 'svg'))).toBe(false);
  });

  it('refuses --page for a Mermaid file, which has no pages', () => {
    const mmd = write(join(tmp('mmd'), 'a.mmd'), 'flowchart TD\n  a --> b\n');
    const r = cli('preview', mmd, '--page', 'a');
    expect(r.code).toBe(1);
    expect(r.errors[0].message).toBe('--page names a page of a draw.io file');
  });

  it('refuses a plain SVG, which holds no diagram', () => {
    const svg = write(join(tmp('svg'), 'plain.drawio.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');
    const r = cli('preview', svg);
    expect(r.code).toBe(1);
    expect(r.errors[0].message).toContain('this SVG holds no draw.io diagram');
    const other = write(join(tmp('svg'), 'picture.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    expect(cli('preview', other).errors[0].message).toBe('preview takes a .drawio or .mmd file, an editable picture (.drawio.svg), or the combined .md file of a Mermaid run');
  });

  it.skipIf(!renderer)('renders the first page by default and the page asked for by id or by name, each to an image of its own', () => {
    const first = cli('preview', combined, '--max-px', '900');
    expect(first.code).toBe(0);
    expect(first.out.page).toEqual({ id: 'canvas', name: 'Shop (canvas)' });
    expect(first.out.pages).toBe(4);
    const byId = cli('preview', combined, '--page', 'shop-01-pay', '--max-px', '900');
    const byName = cli('preview', combined, '--page', 'Pay in detail', '--max-px', '900');
    expect(byId.code).toBe(0);
    expect(byId.out.page).toEqual({ id: 'shop-01-pay', name: 'Pay in detail' });
    expect(byName.out.page).toEqual(byId.out.page);
    expect(byName.out.preview).toBe(byId.out.preview);
    expect(byId.out.preview).not.toBe(first.out.preview);
    expect(byId.out.preview).toMatch(/shop-shop-01-pay-drawio-[0-9a-f]{8}\.png$/);
    // The canvas shows three diagrams side by side; one page shows one, so its picture is narrower for its height.
    const whole = pngSize(first.out.files[0]);
    const part = pngSize(byId.out.files[0]);
    expect(part.width / part.height).toBeLessThan(whole.width / whole.height);
  }, SLOW);

  it.skipIf(!renderer)('exports only the pages named, under the names they have in a full export, and previews such a picture', () => {
    const one = cli('export', run, '--page', 'shop-01-pay');
    expect(one.code).toBe(0);
    expect(one.out.files.map((f) => f.page)).toEqual(['shop-01-pay']);
    expect(readdirSync(join(run, 'svg'))).toEqual(['shop-01-pay.drawio.svg']);
    const two = cli('export', combined, '--page', 'Shop,shop-02-ship', '--out', join(run, 'svg'));
    expect(two.out.files.map((f) => f.page)).toEqual(['shop', 'shop-02-ship']);
    expect(readdirSync(join(run, 'svg')).sort()).toEqual(['shop-01-pay.drawio.svg', 'shop-02-ship.drawio.svg', 'shop.drawio.svg']);
    // The picture is previewed from the diagram it carries.
    const picture = cli('preview', join(run, 'svg', 'shop-01-pay.drawio.svg'), '--max-px', '900');
    expect(picture.code).toBe(0);
    expect(picture.out.page).toEqual({ id: 'shop-01-pay', name: 'Pay in detail' });
    expect(picture.out.pages).toBe(1);
    const size = pngSize(picture.out.files[0]);
    expect(size.width).toBeGreaterThan(100);
    expect(size.height).toBeGreaterThan(100);
  }, SLOW);

  it.skipIf(!renderer)('shows a part\'s page of the picture of a change', () => {
    const next = join(tmp('next'), 'source');
    for (const f of readdirSync(join(run, 'source'))) write(join(next, f), readFileSync(join(run, 'source', f), 'utf8'));
    const part = flow('Pay in detail');
    part.nodes[1].label = 'Check the card';
    write(join(next, 'shop-01-pay.ir.json'), part);
    const main = flow('Shop');
    main.nodes.push({ id: 'audit', label: 'Write the audit log' });
    main.edges.push({ id: 'e3', from: 'check', to: 'audit' });
    write(join(next, 'shop.ir.json'), main);
    const picture = join(run, 'drafts', 'changes.diff.drawio');
    expect(cli('diff', join(run, 'source'), next, '--drawio', picture).out.drawio.pages.map((p) => p.page)).toEqual(['shop', 'shop-01-pay']);
    const first = cli('preview', picture, '--max-px', '900');
    const second = cli('preview', picture, '--page', 'shop-01-pay', '--max-px', '900');
    expect(first.out.page.id).toBe('shop');
    expect(second.out.page).toEqual({ id: 'shop-01-pay', name: 'Pay in detail' });
    expect(second.out.preview).not.toBe(first.out.preview);
  }, SLOW);
});

describe('pages of one name', () => {
  it('get a number in a bundle, with a warning that names both diagrams, for draw.io and for Mermaid', () => {
    const run = makeRun('notes', { 'notes-01-state': flow('Booking notes'), 'notes-02-calls': flow('Booking notes'), 'notes-03-rest': flow('Booking notes') });
    const drawio = cli('bundle', '--to', 'drawio', '--out', join(run, 'notes.drawio'), run);
    expect(drawio.code).toBe(0);
    expect([...readFileSync(join(run, 'notes.drawio'), 'utf8').matchAll(/<diagram id="[^"]+" name="([^"]+)"/g)].map((m) => m[1])).toEqual(['Booking notes', 'Booking notes (2)', 'Booking notes (3)']);
    const said = drawio.warnings.filter((w) => w.stage === 'bundle');
    expect(said.map((w) => w.message)).toEqual([
      'diagrams "notes-01-state" and "notes-02-calls" have the same title "Booking notes": the page of "notes-02-calls" is named "Booking notes (2)"',
      'diagrams "notes-01-state" and "notes-03-rest" have the same title "Booking notes": the page of "notes-03-rest" is named "Booking notes (3)"',
    ]);
    expect(said[0].hint).toBe('give each diagram a title of its own in its IR and bundle again');
    expect(drawio.out.warnings).toBe(2);
    const md = cli('bundle', '--to', 'mermaid', '--out', join(run, 'notes.md'), run);
    expect(readFileSync(join(run, 'notes.md'), 'utf8').match(/^## .*$/gm)).toEqual(['## Booking notes', '## Booking notes (2)', '## Booking notes (3)']);
    expect(md.warnings.filter((w) => w.stage === 'bundle')[0].message).toContain('the heading of "notes-02-calls" is named "Booking notes (2)"');
    // The file is what a fresh bundle gives, so the hand-edit check finds nothing in it.
    expect(cli('drift', join(run, 'notes.drawio'), run).out.drifted).toBe(false);
  });

  it('are told apart by extract, in the order of the source, and picked by their own name', () => {
    const dir = tmp('fences');
    const md = write(join(dir, 'notes.md'), '# Booking notes\n\n```plantuml\nA -> B : hi\n```\n\n```mermaid\nstateDiagram-v2\n  [*] --> Open\n  Open --> Closed : close\n```\n');
    const all = cli('extract', md, '--out', join(dir, 'facts.json'));
    expect(all.out.pages.map((p) => [p.id, p.name])).toEqual([['plantuml-1', 'Booking notes (1)'], ['mermaid-1', 'Booking notes (2)']]);
    const one = cli('extract', md, '--page', 'Booking notes (2)', '--out', join(dir, 'one.json'));
    expect(one.out.pages.map((p) => p.id)).toEqual(['mermaid-1']);
    const none = cli('extract', md, '--page', 'Booking notes');
    expect(none.code).toBe(1);
    expect(none.errors[0].hint).toBe('pages: plantuml-1 ("Booking notes (1)"), mermaid-1 ("Booking notes (2)")');
  });
});

describe('the description tables of a language variant', () => {
  it('are written from the translated IRs of source/<lang>/, which the run folder, stale and sources never count', () => {
    const technical = { ...flow('Order status'), meta: { source: 'scout', sources: ['src/order-status.js'] } };
    const run = makeRun('order-status', { 'order-status': technical });
    const project = join(run, '..', '..');
    write(join(project, 'src', 'order-status.js'), 'export const STATUS = ["NEW"];\n');
    mkdirSync(join(project, '.git'));
    const ja = { ...technical, title: '注文ステータス', meta: { ...technical.meta, lang: 'ja' }, nodes: technical.nodes.map((n) => (n.id === 'check' ? { ...n, label: '依頼を確認する' } : n)) };
    write(join(run, 'source', 'ja', 'order-status.ir.json'), ja);

    const doc = cli('bundle', '--to', 'doc', '--lang', 'ja', '--out', join(run, 'order-status.doc.ja.md'), '--title', '注文ステータス', join(run, 'source', 'ja'));
    expect(doc.code).toBe(0);
    expect(doc.out.order).toEqual(['order-status']);
    const text = readFileSync(join(run, 'order-status.doc.ja.md'), 'utf8');
    expect(text.split('\n')[0]).toContain('lang=ja');
    expect(text).toContain('依頼を確認する');
    // The line that names the source points at the file that is there.
    expect(text).toContain('`source/ja/order-status.ir.json`');
    expect(existsSync(join(run, 'source', 'ja', 'order-status.ir.json'))).toBe(true);

    // The run itself is one diagram, in the language it was drawn in.
    const main = cli('bundle', '--to', 'doc', '--lang', 'en', '--out', join(run, 'order-status.doc.md'), run);
    expect(main.out.order).toEqual(['order-status']);
    expect(readFileSync(join(run, 'order-status.doc.md'), 'utf8')).toContain('`source/order-status.ir.json`');
    expect(cli('bundle', '--to', 'drawio', '--out', join(run, 'order-status.drawio'), run).out.diagrams).toBe(1);
    const recorded = cli('sources', run);
    expect(recorded.code).toBe(0);
    const stale = cli('stale', run);
    expect(stale.code).toBe(0);
    expect(stale.out.runs[0].unrecorded ?? []).toEqual([]);
    expect(JSON.stringify(stale.out)).not.toContain('order-status.ja');
  });
});

describe('messages that say what is true', () => {
  it('gives the old value beside the new one in the list of a diff, and keeps every key it had', () => {
    const before = makeRun('login', { login: flow('Login') });
    const after = makeRun('login', { login: flow('Login', { nodes: flow('x').nodes.map((n) => (n.id === 'check' ? { ...n, label: 'Check the password' } : n)) }) });
    const r = cli('diff', before, after);
    expect(r.code).toBe(0);
    expect(Object.keys(r.out)).toEqual(['ok', 'differs', 'diagramsAdded', 'diagramsRemoved', 'diagrams', 'hints']);
    expect(r.out.diagrams[0].changed).toEqual([{ collection: 'nodes', id: 'check', label: 'Check the password', fields: ['label'], values: { label: { from: 'Check the request', to: 'Check the password' } } }]);
    const single = cli('diff', join(before, 'source', 'login.ir.json'), join(after, 'source', 'login.ir.json'));
    expect(single.out.changed[0].values.label).toEqual({ from: 'Check the request', to: 'Check the password' });
  });

  it('writes no picture and says why when two versions differ in meta fields alone', () => {
    const noted = (file) => ({ ...flow('Login'), meta: { source: 'scout', sources: [file] } });
    const before = makeRun('meta', { meta: noted('src/a.js') });
    const after = makeRun('meta', { meta: noted('src/b.js') });
    const picture = join(after, 'drafts', 'changes.diff.drawio');
    const r = cli('diff', before, after, '--drawio', picture);
    expect(r.code).toBe(0);
    expect(r.out.differs).toBe(true);
    expect(r.out.drawio).toEqual({ out: null, written: false, reason: 'the two versions differ only in meta fields, which no diagram shows: there is nothing to draw', unchanged: ['meta'] });
    expect(existsSync(picture)).toBe(false);
    const same = cli('diff', before, before, '--drawio', picture);
    expect(same.out.drawio.reason).toBe('the two versions do not differ: there is nothing to draw');
  });

  it('warns on validate and on emit about a final state whose label no target draws', () => {
    const ir = { schemaVersion: 1, kind: 'state', title: 'Order status', states: [{ id: 's', kind: 'initial' }, { id: 'paid', label: 'PAID' }, { id: 'cancelled', label: 'CANCELLED', kind: 'final' }], transitions: [{ id: 't1', from: 's', to: 'paid' }, { id: 't2', from: 'paid', to: 'cancelled', event: 'cancel' }] };
    const file = write(join(tmp('final'), 'order.ir.json'), ir);
    const validated = cli('validate', file);
    expect(validated.code).toBe(0);
    expect(validated.out.warnings).toBe(1);
    expect(validated.warnings[0].message).toBe('model: final state "cancelled" has the label "CANCELLED", which no target draws; a final state is a circle without a name');
    const emitted = cli('emit', '--to', 'drawio', file, '--out', join(tmp('final'), 'order.drawio'));
    expect(emitted.warnings.map((w) => w.message)).toEqual([validated.warnings[0].message]);
    expect(readFileSync(emitted.out.out, 'utf8')).not.toContain('CANCELLED');
  });

  it('warns about a boundary that holds nothing', () => {
    const file = write(join(tmp('empty'), 'a.ir.json'), { schemaVersion: 1, kind: 'architecture', title: 'A', components: [{ id: 'api', label: 'API' }], boundaries: [{ id: 'subnet', label: 'Private subnet', children: [] }], connections: [] });
    expect(cli('validate', file).warnings.map((w) => w.message)).toEqual(['model: boundary "subnet" has no member; it is drawn as an empty frame']);
  });

  it('says about the native FigJam board what is true of it: the icons and frames are drawn', () => {
    const dir = tmp('native');
    const ir = write(join(dir, 'gcp.ir.json'), loadFixture('architecture', 'valid-multi-cloud'));
    const text = cli('emit', '--to', 'figjam', ir, '--out', join(dir, 'gcp.mmd'), '--allow-sensitive');
    const lost = text.warnings.filter((w) => /has no (AWS|GCP) icons|rendered as a flowchart/.test(w.message));
    expect(lost.length).toBeGreaterThanOrEqual(3);

    const board = cli('emit', '--to', 'figjam', ir, '--native', join(dir, 'gcp.native.js'), '--allow-sensitive');
    expect(board.code).toBe(0);
    expect(board.out.native).toHaveLength(1);
    expect(board.warnings.filter((w) => /has no (AWS|GCP) icons|rendered as a flowchart|group frame/.test(w.message))).toEqual([]);
    expect(board.warnings.every((w) => w.appliesTo !== 'figjam-text')).toBe(true);
    expect(readFileSync(board.out.native[0], 'utf8')).toContain('gcp');

    // Both asked for: the warnings of the text are still said, and marked as the text's.
    const both = cli('emit', '--to', 'figjam', ir, '--out', join(dir, 'both.mmd'), '--native', join(dir, 'both.native.js'), '--allow-sensitive');
    const ofText = both.warnings.filter((w) => w.appliesTo === 'figjam-text');
    expect(ofText.length).toBe(text.warnings.filter((w) => w.stage === 'feature-matrix' || w.stage === 'emit').length);
    expect(ofText.length).toBeGreaterThanOrEqual(lost.length);
    for (const w of ofText) expect(w.message).toContain('(this is about the FigJam text for generate_diagram; the native script draws the board from the draw.io layout)');
  });

  it('does not offer --native as the way out when --native wrote the board of a kind that has no FigJam text', () => {
    const dir = tmp('usecase');
    const r = cli('emit', '--to', 'figjam', write(join(dir, 'u.ir.json'), loadFixture('usecase', 'valid')), '--native', join(dir, 'u.native.js'));
    expect(r.code).toBe(0);
    expect(r.out.text).toBe('not written: there is no Mermaid text for a usecase diagram on FigJam (generate_diagram does not draw this kind); the native script draws the board');
    expect(r.warnings.filter((w) => w.appliesTo === 'figjam-text')).toEqual([]);
  });

  it('quotes the form of a meta.omitted entry so that it can be read', () => {
    const dir = tmp('cover');
    const facts = write(join(dir, 'facts.json'), { facts: 1, format: 'mermaid', pages: [{ id: 'p', name: 'P', kindHints: [], nodes: [{ id: 'n', label: 'Dropped step', shape: 'process' }], edges: [], warnings: [] }] });
    const r = cli('cover', facts, write(join(dir, 'f.ir.json'), flow('F')));
    expect(r.code).toBe(2);
    expect(r.err.hint).toContain('add a meta.omitted entry that quotes the text and gives the reason, in the form «"<text>": <reason>»');
    expect(r.err.hint).not.toContain('""');
  });
});
