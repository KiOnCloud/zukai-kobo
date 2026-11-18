/**
 * The description tables end to end: through the committed bundle and from another working
 * directory, as an agent runs it. Every kind on its own, a run folder with parts and business
 * views in one document, each language, and the ways it has to fail.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scriptsDir, fixturesDir, loadFixture, validFixtures } from './helpers.mjs';

/** A made-up value, put together at run time so that no line of this file reads as a credential. */
const FAKE = `${['Sup3r', 'S3cret'].join('')}!`;
const cliPath = join(scriptsDir, 'bin', 'cli.mjs');
const cwd = mkdtempSync(join(tmpdir(), 'zukai-doc-cwd-'));
const cli = (...args) => {
  const r = spawnSync(process.execPath, [cliPath, ...args], { cwd, encoding: 'utf8' });
  const parse = (text) => text.trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return l; } });
  const out = parse(r.stdout);
  const err = parse(r.stderr);
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, out: out.at(-1), warnings: err.flatMap((e) => e?.warnings ?? []), errors: err.flatMap((e) => e?.errors ?? []) };
};
const write = (file, value) => { mkdirSync(join(file, '..'), { recursive: true }); writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2)); return file; };
/** A run folder `diagrams/<date>_<slug>` holding the given IRs by diagram id. */
const makeRun = (slug, irs) => {
  const run = join(mkdtempSync(join(tmpdir(), `zukai-doc-${slug}-`)), 'diagrams', `20261117_${slug}`);
  for (const [id, ir] of Object.entries(irs)) write(join(run, 'source', `${id}.ir.json`), ir);
  return run;
};
const fixture = (kind, name) => join(fixturesDir, kind, `${name}.json`);
const MARK = (lang) => `<!-- zukai doc, lang=${lang}: generated from the IR, regenerate instead of editing -->`;

describe('emit --to doc', () => {
  // One diagram of each kind, with what its tables must say.
  const KINDS = [
    { kind: 'sequence', name: 'valid', has: ['Diagram kind: Sequence diagram', '## Participants', '## Steps', '## Notes', '| 8 | Auth service | Web app | 401 invalid credentials | Reply | Repeated: until 3 attempts<br>Otherwise, if password wrong |'] },
    { kind: 'flowchart', name: 'valid-refund-approval', has: ['Diagram kind: Flowchart', '## Steps', '## Groups', '| 5 | Amount over 500 EUR? | Decision | Approval | [no] → Approve automatically<br>[yes] → Manager review |'] },
    { kind: 'activity', name: 'valid-fork-join', has: ['Diagram kind: Activity diagram', '## Lanes', '## Steps', '| 3 | Sales | (Fork) | Fork | → Pick items (hand-off to Warehouse)<br>→ Issue invoice (hand-off to Finance) |'] },
    { kind: 'state', name: 'valid', has: ['Diagram kind: State diagram', '## States', '## Transitions', '| Draft | → Placed [cart not empty] | — | — | — | — | — | — |'] },
    { kind: 'er', name: 'valid-fk-anchors', has: ['Diagram kind: ER diagram', '## Entities', '### Order', '| 2 | customer\\_id | uuid | FK |', '## Relations', '| 1 | Customer | 1 | Order | 0..* | places | Yes |'] },
    { kind: 'class', name: 'valid', has: ['Diagram kind: Class diagram', '## Classes', '### Order', 'Stereotype: «aggregate root»', '| 3 | AddLine(Product product, int quantity) | Method | ErrorOr&lt;OrderLine&gt; | public |', '## Relations'] },
    { kind: 'usecase', name: 'valid-generalization', has: ['Diagram kind: Use case diagram', '## Actors', '## Use cases', '## Boundaries', '## Relations', '| 5 | Payment service provider | System | Supporting |', '| 8 | Apply a voucher | Extend | Place an order | the customer has a voucher code |'] },
    { kind: 'architecture', name: 'valid-aws-zones', has: ['Diagram kind: Architecture diagram', '## Components', '## Data stores', '## Boundaries', '## Connections', '| 7 | RDS primary | RDS standby (Multi-AZ) | replication | Both ways |'] },
  ];

  it('covers every kind the fixtures have', () => {
    expect(KINDS.map((k) => k.kind).sort()).toEqual([...new Set(validFixtures().map((f) => f.ir.kind))].sort());
  });

  for (const { kind, name, has } of KINDS) {
    it(`writes the tables of a ${kind} diagram to the file named, in English by default`, () => {
      const r = cli('emit', '--to', 'doc', fixture(kind, name), '--out', `doc/${kind}.md`);
      expect(r.errors).toEqual([]);
      expect(r.code).toBe(0);
      expect(r.out).toMatchObject({ ok: true, out: join(cwd, 'doc', `${kind}.md`) });
      const doc = readFileSync(join(cwd, 'doc', `${kind}.md`), 'utf8');
      expect(doc.split('\n')[0]).toBe(MARK('en'));
      expect(doc.split('\n')[1]).toBe(`# ${loadFixture(kind, name).title}`);
      for (const text of has) expect(doc, text).toContain(text);
    });
  }

  it('prints the document on stdout without --out, and nothing on stderr for a clean model', () => {
    const r = cli('emit', '--to', 'doc', fixture('sequence', 'valid'));
    expect(r.code).toBe(0);
    expect(r.stdout.startsWith(`${MARK('en')}\n# Login with password\n`)).toBe(true);
    expect(r.stderr).toBe('');
    // A kind FigJam refuses and features Mermaid degrades are plain rows here.
    expect(cli('emit', '--to', 'figjam', fixture('class', 'valid')).code).toBe(2);
    expect(cli('emit', '--to', 'doc', fixture('class', 'valid')).warnings).toEqual([]);
  });

  it('writes headings, column headers and fixed values in the language of --lang, labels as they are', () => {
    const ja = cli('emit', '--to', 'doc', '--lang', 'ja', fixture('sequence', 'valid'));
    expect(ja.code).toBe(0);
    expect(ja.stdout.split('\n')[0]).toBe(MARK('ja'));
    expect(ja.stdout).toContain('図の種類: シーケンス図');
    expect(ja.stdout).toContain('| No. | 元 | 先 | メッセージ | 種別 | 条件 |');
    expect(ja.stdout).toContain('| 1 | User | Web app | Submit credentials | 同期 | 繰り返し: until 3 attempts |');
    const vi = cli('emit', '--to', 'doc', '--lang=vi', fixture('er', 'valid-fk-anchors'));
    expect(vi.stdout).toContain('Loại sơ đồ: Sơ đồ ER');
    expect(vi.stdout).toContain('| STT | Thuộc tính | Kiểu | Khóa |');
    expect(vi.stdout).toContain('| 2 | Address | 1 | Order | 0..* | bills to | Không |');
    const en = cli('emit', '--to', 'doc', '--lang', 'en', fixture('er', 'valid-fk-anchors'));
    expect(en.stdout).toBe(cli('emit', '--to', 'doc', fixture('er', 'valid-fk-anchors')).stdout);
  });

  it('exits 1 on a language it does not have, and on --lang with another target', () => {
    const bad = cli('emit', '--to', 'doc', '--lang', 'fr', fixture('er', 'valid'), '--out', 'doc/fr.md');
    expect(bad.code).toBe(1);
    expect(bad.errors[0]).toMatchObject({ message: 'unknown language "fr"', hint: '--lang takes one of: en, ja, vi' });
    expect(bad.stdout).toBe('');
    expect(existsSync(join(cwd, 'doc', 'fr.md'))).toBe(false);
    const wrong = cli('emit', '--to', 'drawio', '--lang', 'ja', fixture('er', 'valid'));
    expect(wrong.code).toBe(1);
    expect(wrong.errors[0].message).toBe('--lang goes with --to doc, not "drawio"');
    expect(cli('emit', '--to', 'doc', '--lang', fixture('er', 'valid')).code).toBe(1);
    expect(cli('emit', '--to', 'doc', fixture('er', 'valid'), '--native', 'x.js').errors[0].message).toContain('--native goes with --to figjam');
  });

  it('exits 2 on an invalid IR with every error, and writes nothing', () => {
    const r = cli('emit', '--to', 'doc', fixture('flowchart', 'invalid-missing-edge-target'), '--out', 'doc/invalid.md');
    expect(r.code).toBe(2);
    expect(r.errors.map((e) => e.path)).toEqual(['/nodes/0/shape', '/edges/0/to']);
    expect(r.stdout).toBe('');
    expect(existsSync(join(cwd, 'doc', 'invalid.md'))).toBe(false);
    expect(cli('emit', '--to', 'doc', join(cwd, 'missing.ir.json')).code).toBe(1);
  });

  it('refuses a credential in a label, warns about a guess, and takes the word of --allow-sensitive', () => {
    const ir = loadFixture('flowchart', 'valid');
    ir.nodes[1].label = `Connect with password=${FAKE}`;
    const file = write(join(cwd, 'secret.ir.json'), ir);
    const r = cli('emit', '--to', 'doc', file, '--out', 'doc/secret.md');
    expect(r.code).toBe(2);
    expect(r.errors[0].path).toBe('/nodes/1/label');
    expect(r.errors[0].message).toContain('refusing to emit for doc');
    expect(r.stderr).not.toContain(FAKE);
    expect(existsSync(join(cwd, 'doc', 'secret.md'))).toBe(false);
    const allowed = cli('emit', '--to', 'doc', file, '--out', 'doc/secret.md', '--allow-sensitive');
    expect(allowed.code).toBe(0);
    expect(readFileSync(join(cwd, 'doc', 'secret.md'), 'utf8')).toContain(`password=${FAKE}`);
    // A mail address is a guess: the local file is written, with the warning.
    ir.nodes[1].label = 'Mail the receipt to jane.roe@corp-mail.io';
    const guess = cli('emit', '--to', 'doc', write(join(cwd, 'guess.ir.json'), ir), '--out', 'doc/guess.md');
    expect(guess.code).toBe(0);
    expect(guess.warnings.map((w) => w.kind)).toEqual(['personal-data']);
    expect(existsSync(join(cwd, 'doc', 'guess.md'))).toBe(true);
  });

  it('writes a label full of Markdown and HTML as text', () => {
    const r = cli('emit', '--to', 'doc', fixture('adversarial', 'labels'), '--allow-sensitive');
    expect(r.code).toBe(0);
    const body = r.stdout.split('\n').slice(1).join('\n');
    expect(body.replace(/<br>/g, '')).not.toMatch(/[<>]/);
    expect(body).toContain('| 10 | a \\| b \\| c \\#1 &amp; co | Process | — | — |');
    expect(body).toContain('| 2 | line one<br>line two | Process | — | [x --&gt; y] → &lt;script&gt;alert(1)&lt;/script&gt; |');
  });
});

describe('bundle --to doc', () => {
  const titled = (kind, name, title, edit = () => {}) => { const ir = { ...loadFixture(kind, name), title }; edit(ir); return ir; };
  let run;
  let out;
  beforeAll(() => {
    // A detailed run with both views: the main diagram, two parts, and a business view of each.
    run = makeRun('order-sync', {
      'order-sync': titled('sequence', 'valid-ref-parts', 'Order sync'),
      'order-sync-business': titled('sequence', 'valid-ref-parts', 'Order sync (business)', (ir) => {
        ir.messages[0].ref = 'order-sync-01-load-business';
        delete ir.messages[2].ref;
      }),
      'order-sync-01-load': titled('flowchart', 'valid-refund-approval', 'Load the orders of one shop'),
      'order-sync-01-load-business': titled('flowchart', 'valid-refund-approval', 'Load the orders (business)'),
      'order-sync-02-store': titled('er', 'valid-fk-anchors', 'Stored orders'),
    });
    out = join(run, 'order-sync.doc.md');
  });

  it('writes the tables of a whole run folder into one document, in run order', () => {
    const r = cli('bundle', '--to', 'doc', '--out', out, '--title', 'Order sync', run);
    expect(r.errors).toEqual([]);
    expect(r.code).toBe(0);
    const order = ['order-sync', 'order-sync-business', 'order-sync-01-load', 'order-sync-01-load-business', 'order-sync-02-store'];
    expect(r.out).toMatchObject({ ok: true, out, diagrams: 5, order, warnings: 0 });
    const doc = readFileSync(out, 'utf8');
    const lines = doc.split('\n');
    expect(lines.slice(0, 2)).toEqual([MARK('en'), '# Order sync']);
    expect(lines.filter((l) => l.startsWith('<a id='))).toEqual(order.map((id) => `<a id="${id}"></a>`));
    expect(lines.filter((l) => /^## /.test(l))).toEqual(['## Order sync', '## Order sync (business)', '## Load the orders of one shop', '## Load the orders (business)', '## Stored orders']);
    expect(doc).toContain('Diagram kind: ER diagram · Source: `source/order-sync-02-store.ir.json`');
    // The tables of a diagram stand one level below its title, an entity one below that.
    expect(doc).toContain('### Entities\n\n#### Customer\n');
  });

  it('links each element that has a part to the heading of that part, a business view to the business part', () => {
    const doc = readFileSync(out, 'utf8');
    const section = (title) => doc.slice(doc.indexOf(`\n## ${title}\n`), doc.indexOf('\n<a id=', doc.indexOf(`\n## ${title}\n`)));
    const technical = section('Order sync');
    expect(technical).toContain('| 1 | Sync job | Order service | loadOrders(request) | Synchronous | — | [Load the orders of one shop](#order-sync-01-load) |');
    expect(technical).toContain('| 3 | Sync job | Sync job | mergeChanges(orders) | Synchronous | Only if any orders | [Stored orders](#order-sync-02-store) |');
    const business = section('Order sync (business)');
    expect(business).toContain('| 1 | Sync job | Order service | loadOrders(request) | Synchronous | — | [Load the orders (business)](#order-sync-01-load-business) |');
    expect(business).toContain('| 3 | Sync job | Sync job | mergeChanges(orders) | Synchronous | Only if any orders | — |');
    // Every link has its anchor in the document.
    const anchors = new Set([...doc.matchAll(/<a id="([^"]+)"><\/a>/g)].map((m) => m[1]));
    const links = [...doc.matchAll(/\]\(#([^)]+)\)/g)].map((m) => m[1]);
    expect(links).toHaveLength(3);
    for (const link of links) expect(anchors.has(link), link).toBe(true);
  });

  it('writes the same run again byte for byte, and in Japanese or Vietnamese with --lang', () => {
    const first = readFileSync(out, 'utf8');
    expect(cli('bundle', '--to', 'doc', '--out', out, '--title', 'Order sync', run).code).toBe(0);
    expect(readFileSync(out, 'utf8')).toBe(first);
    const ja = join(run, 'order-sync.doc.ja.md');
    expect(cli('bundle', '--to', 'doc', '--lang', 'ja', '--out', ja, run).code).toBe(0);
    const jaDoc = readFileSync(ja, 'utf8');
    expect(jaDoc.split('\n').slice(0, 2)).toEqual([MARK('ja'), '# 図の説明']);
    expect(jaDoc).toContain('図の種類: ER図 · ソース: `source/order-sync-02-store.ir.json`');
    expect(jaDoc).toContain('### エンティティ');
    expect(jaDoc).toContain('[Stored orders](#order-sync-02-store)');
    const vi = join(run, 'order-sync.doc.vi.md');
    expect(cli('bundle', '--to', 'doc', '--lang', 'vi', '--out', vi, '--title', 'Đồng bộ đơn hàng', run).code).toBe(0);
    expect(readFileSync(vi, 'utf8').split('\n').slice(0, 2)).toEqual([MARK('vi'), '# Đồng bộ đơn hàng']);
    expect(readFileSync(vi, 'utf8')).toContain('### Các bước');
    expect(jaDoc.split('\n').length).toBe(first.split('\n').length);
  });

  it('takes IR files one by one in the order given, and reports a part that was left out', () => {
    const subset = join(run, 'subset.doc.md');
    const r = cli('bundle', '--to', 'doc', '--out', subset, join(run, 'source', 'order-sync-02-store.ir.json'), join(run, 'source', 'order-sync.ir.json'));
    expect(r.code).toBe(0);
    expect(r.out.order).toEqual(['order-sync-02-store', 'order-sync']);
    expect(r.warnings).toEqual([expect.objectContaining({ stage: 'emit', diagram: 'order-sync', path: '/messages/0/ref', message: 'ref "order-sync-01-load" is not in this bundle: the table shows the slug without a link' })]);
    const doc = readFileSync(subset, 'utf8');
    expect(doc).toContain('| `order-sync-01-load` |');
    expect(doc).toContain('[Stored orders](#order-sync-02-store)');
  });

  it('exits 1 on bad usage: an unknown language, a canvas, no --out, an empty folder', () => {
    const lang = cli('bundle', '--to', 'doc', '--lang', 'de', '--out', join(run, 'x.md'), run);
    expect(lang.code).toBe(1);
    expect(lang.errors[0].message).toBe('unknown language "de"');
    const canvas = cli('bundle', '--to', 'doc', '--canvas', 'all', '--out', join(run, 'x.md'), run);
    expect(canvas.code).toBe(1);
    expect(canvas.errors[0]).toMatchObject({ message: 'canvas applies to drawio only', hint: 'the description tables have no page to lay diagrams out on' });
    expect(cli('bundle', '--to', 'doc', run).code).toBe(1);
    expect(cli('bundle', '--to', 'mermaid', '--lang', 'ja', '--out', join(run, 'x.md'), run).errors[0].message).toBe('--lang goes with --to doc, not "mermaid"');
    const empty = mkdtempSync(join(tmpdir(), 'zukai-doc-empty-'));
    expect(cli('bundle', '--to', 'doc', '--out', join(empty, 'x.md'), empty).code).toBe(1);
    expect(existsSync(join(run, 'x.md'))).toBe(false);
  });

  it('exits 2 and writes nothing when one diagram of the run is invalid or holds a credential', () => {
    const invalid = makeRun('broken', { broken: loadFixture('flowchart', 'valid'), 'broken-01-part': loadFixture('er', 'invalid-unknown-entity') });
    const r = cli('bundle', '--to', 'doc', '--out', join(invalid, 'broken.doc.md'), invalid);
    expect(r.code).toBe(2);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.errors.every((e) => e.diagram === 'broken-01-part')).toBe(true);
    expect(existsSync(join(invalid, 'broken.doc.md'))).toBe(false);
    const leak = loadFixture('sequence', 'valid');
    leak.messages[1].label = `login with password=${FAKE}`;
    const secret = makeRun('leak', { leak: loadFixture('flowchart', 'valid'), 'leak-01-login': leak });
    const s = cli('bundle', '--to', 'doc', '--out', join(secret, 'leak.doc.md'), secret);
    expect(s.code).toBe(2);
    expect(s.errors[0]).toMatchObject({ diagram: 'leak-01-login', path: '/messages/1/label' });
    expect(s.errors[0].message).toContain('refusing to emit for doc');
    expect(existsSync(join(secret, 'leak.doc.md'))).toBe(false);
    // Two file names that give one anchor would make a link point at the wrong part.
    const dir = mkdtempSync(join(tmpdir(), 'zukai-doc-clash-'));
    const clash = cli('bundle', '--to', 'doc', '--out', join(dir, 'x.md'), write(join(dir, 'Pay_Now.ir.json'), loadFixture('flowchart', 'valid')), write(join(dir, 'pay-now.ir.json'), loadFixture('flowchart', 'valid')));
    expect(clash.code).toBe(2);
    expect(clash.errors[0].message).toContain('would share the anchor "pay-now"');
  });

  it('is named in the usage with its languages', () => {
    const r = cli('help');
    expect(r.stdout).toContain('cli.mjs emit --to <mermaid|drawio|figjam|doc> <ir.json>');
    expect(r.stdout).toContain('cli.mjs bundle --to <drawio|mermaid|doc> --out <file> [--title <text>] [--lang <en|ja|vi>]');
    expect(cli('emit', '--to', 'pdf', fixture('er', 'valid')).errors[0].hint).toBe('--to takes one of: mermaid, drawio, figjam, doc');
  });
});
