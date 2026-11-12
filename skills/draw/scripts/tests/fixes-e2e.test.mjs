/**
 * End to end, through the committed bundle and from another working directory, as an agent
 * runs it: one scenario per defect that the end-to-end test of 2.0.3 found. Each scenario
 * states the behaviour that was wrong and checks the one that replaced it.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scriptsDir, loadFixture } from './helpers.mjs';
import { checkDrawioStructure } from './drawio-structure.mjs';
import { defaultPreviewPath, mermaidBlocks, loadPlaywright } from '../src/preview.mjs';

/**
 * A made-up value for the secret-scan scenarios, put together at run time so that no line of
 * this file reads as a credential to a scanner of the repository.
 */
const FAKE_WORD = ['Sup3r', 'S3cret'].join('');
const FAKE = `${FAKE_WORD}!`;
const cliPath = join(scriptsDir, 'bin', 'cli.mjs');
const cwd = mkdtempSync(join(tmpdir(), 'zukai-e2e-cwd-'));
const cli = (...args) => {
  const r = spawnSync(process.execPath, [cliPath, ...args], { cwd, encoding: 'utf8' });
  const parse = (text) => text.trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return l; } });
  const out = parse(r.stdout);
  const err = parse(r.stderr);
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, out: out.at(-1), err: err.at(-1), warnings: err.flatMap((e) => e?.warnings ?? []), errors: err.flatMap((e) => e?.errors ?? []) };
};
const write = (file, value) => { mkdirSync(join(file, '..'), { recursive: true }); writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2)); return file; };
const tmp = (name) => mkdtempSync(join(tmpdir(), `zukai-e2e-${name}-`));
/** A run folder `diagrams/<date>_<slug>` holding the given IRs by diagram id. */
const makeRun = (slug, irs) => {
  const run = join(tmp(slug), 'diagrams', `20261111_${slug}`);
  for (const [id, ir] of Object.entries(irs)) write(join(run, 'source', `${id}.ir.json`), ir);
  return run;
};
const flow = (title, extra = {}) => ({
  schemaVersion: 1, kind: 'flowchart', title,
  nodes: [{ id: 'start', label: 'Start', shape: 'terminal' }, { id: 'check', label: 'Check the request' }, { id: 'done', label: 'Done', shape: 'terminal' }],
  edges: [{ id: 'e1', from: 'start', to: 'check' }, { id: 'e2', from: 'check', to: 'done' }],
  ...extra,
});
const pageIds = (file) => [...readFileSync(file, 'utf8').matchAll(/<diagram id="([^"]+)"/g)].map((m) => m[1]);

describe('page ids of a bundle (report item 1)', () => {
  const long = 'refund-approval-02-gateway-refund-via-payment';
  let run;
  beforeAll(() => { run = makeRun('refund-approval', { 'refund-approval': flow('Refund'), [long]: flow('Gateway refund'), [`${long}-business`]: flow('Gateway refund (business)') }); });

  it('keeps a diagram id of more than 40 characters whole, so a diagram and its business view get two pages', () => {
    const out = join(run, 'refund-approval.drawio');
    expect(cli('bundle', '--to', 'drawio', '--canvas', 'all', '--title', 'Refund', '--out', out, run).code).toBe(0);
    const ids = pageIds(out);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(['canvas', 'refund-approval', long, `${long}-business`]);
    const { problems, cells } = checkDrawioStructure(readFileSync(out, 'utf8'));
    expect(problems).toEqual([]);
    expect(cells.some((c) => c.id === `${long}-business:check`)).toBe(true);
  });

  it('reports no drift on the file it has just written, and names pages by their full id', () => {
    const r = cli('drift', join(run, 'refund-approval.drawio'), run);
    expect(r.out).toMatchObject({ ok: true, drifted: false, bundle: { canvas: 'all' } });
    expect(r.out.pages.map((p) => p.diagram)).toContain(`${long}-business`);
  });

  it('relabels by the real diagram id', () => {
    const map = write(join(run, 'map.json'), { [`${long}-business:title`]: 'Hoàn tiền (nghiệp vụ)' });
    const r = cli('relabel', join(run, 'refund-approval.drawio'), '--map', map, '--out', join(run, 'out.drawio'));
    expect(r.out.unmatched).toEqual([]);
    expect(readFileSync(join(run, 'out.drawio'), 'utf8')).toContain('name="Hoàn tiền (nghiệp vụ)"');
  });

  it('still reads a file delivered with ids cut at 40 characters as not drifted', async () => {
    const { bundle } = await import('../src/pipeline.mjs');
    const entries = [{ id: 'refund-approval', ir: flow('Refund') }, { id: long, ir: flow('Gateway refund') }];
    const old = await bundle(entries, 'drawio', { canvas: ['refund-approval', long], title: 'Refund', legacyIds: true });
    const file = write(join(tmp('legacy'), 'old.drawio'), old.output);
    expect(pageIds(file)).toContain(long.slice(0, 40));
    const src = makeRun('refund-approval', { 'refund-approval': flow('Refund'), [long]: flow('Gateway refund') });
    expect(cli('drift', file, src).out).toMatchObject({ ok: true, drifted: false, legacyIds: true });
  });

  it('refuses two files whose names give one page id', () => {
    const dir = tmp('clash');
    const a = write(join(dir, 'Pay_Now.ir.json'), flow('A'));
    const b = write(join(dir, 'pay-now.ir.json'), flow('B'));
    const r = cli('bundle', '--to', 'drawio', '--out', join(dir, 'x.drawio'), a, b);
    expect(r.code).toBe(2);
    expect(r.errors[0].message).toContain('would share the page id "pay-now"');
  });
});

describe('order of a run (report item 2)', () => {
  it('bundles a run folder main diagram first, each view beside its subject, whatever the file names sort to', () => {
    const run = makeRun('checkout', {
      'checkout-01-login': flow('Login'), 'checkout-01-login-business': flow('Login (business)'),
      'checkout-business': flow('Checkout (business)'), checkout: flow('Checkout'), 'audit-trail': flow('Audit'),
    });
    // The shell order of source/*.ir.json, which the contract used to prescribe.
    expect(readdirSync(join(run, 'source'))[0]).not.toBe('checkout.ir.json');
    const order = ['checkout', 'checkout-business', 'checkout-01-login', 'checkout-01-login-business', 'audit-trail'];
    const drawio = cli('bundle', '--to', 'drawio', '--canvas', 'all', '--out', join(run, 'checkout.drawio'), run);
    expect(drawio.out).toMatchObject({ ok: true, order, canvas: order });
    expect(pageIds(join(run, 'checkout.drawio'))).toEqual(['canvas', ...order]);
    const md = cli('bundle', '--to', 'mermaid', '--title', 'Checkout', '--out', join(run, 'checkout.md'), run);
    expect(md.out.order).toEqual(order);
    expect([...readFileSync(join(run, 'checkout.md'), 'utf8').matchAll(/^Source: `source\/(.+)\.ir\.json`$/gm)].map((m) => m[1])).toEqual(order);
    // Files given one by one keep the order given.
    const picked = cli('bundle', '--to', 'drawio', '--out', join(run, 'two.drawio'), join(run, 'source', 'audit-trail.ir.json'), join(run, 'source', 'checkout.ir.json'));
    expect(picked.out.order).toEqual(['audit-trail', 'checkout']);
  });
});

describe('order of a draft and of a business step (found by the end-to-end run of the fixes)', () => {
  it('orders a draft of a run like the run, also when it adds a diagram that sorts before the main one', () => {
    const run = makeRun('login', { login: flow('Login'), 'login-01-mfa': flow('MFA') });
    for (const [id, title] of [['login', 'Login'], ['login-01-mfa', 'MFA'], ['audit', 'Audit']]) write(join(run, 'drafts', 'a', 'source', `${id}.ir.json`), flow(title));
    const r = cli('bundle', '--to', 'mermaid', '--out', join(run, 'drafts', 'a', 'login.md'), join(run, 'drafts', 'a'));
    expect(r.out.order).toEqual(['login', 'login-01-mfa', 'audit']);
  });

  it('keeps one line on a business step whose part is titled like it, with the view in brackets', () => {
    const step = (ref) => ({ schemaVersion: 1, kind: 'flowchart', title: 'Refund', nodes: [{ id: 's', label: 'Start', shape: 'terminal' }, { id: 'check', label: 'Kiểm tra điều kiện', ref }], edges: [{ id: 'e1', from: 's', to: 'check' }] });
    const run = makeRun('refund', { 'refund-business': step('refund-01-check-business'), 'refund-01-check-business': flow('Kiểm tra điều kiện (nghiệp vụ)') });
    expect(cli('bundle', '--to', 'drawio', '--out', join(run, 'refund.drawio'), run).code).toBe(0);
    expect(readFileSync(join(run, 'refund.drawio'), 'utf8')).toContain('<UserObject label="Kiểm tra điều kiện" link="data:page/id,refund-01-check-business"');
  });

  it('says on validate that every emit will refuse a credential', () => {
    const r = cli('validate', write(join(tmp('blocks'), 's.ir.json'), flow('S', { meta: { notes: [`password=${FAKE}`] } })));
    expect(r.code).toBe(0);
    expect(r.warnings[0]).toMatchObject({ stage: 'secret-scan', blocks: 'emit' });
    expect(r.stderr).not.toContain(FAKE_WORD);
  });
});

describe('emit --to mermaid with a large hub (report item 3)', () => {
  it('emits a component with 60 neighbours instead of a stack trace', () => {
    const components = [{ id: 'hub', label: 'Hub' }];
    const connections = [];
    for (let i = 0; i < 60; i++) { components.push({ id: `c${i}`, label: `C${i}` }); connections.push({ id: `e${i}`, from: 'hub', to: `c${i}` }); }
    const file = write(join(tmp('hub'), 'hub.ir.json'), { schemaVersion: 1, kind: 'architecture', title: 'Hub', components, connections });
    const r = cli('emit', '--to', 'mermaid', file);
    expect(r.code).toBe(0);
    expect(r.stderr).not.toContain('TypeError');
    expect(r.stdout).toMatch(/^---\ntitle: "Hub"\n---\nflowchart /);
    expect(r.warnings.some((w) => w.fallback === 'flowchart')).toBe(true);
    expect(r.warnings.some((w) => w.message.startsWith('size: 61 components'))).toBe(true);
  });
});

describe('diff and order (report item 4)', () => {
  it('reports messages and participants that changed places', () => {
    const before = loadFixture('sequence', 'valid');
    const after = structuredClone(before);
    after.participants.push(after.participants.shift());
    const [first] = after.messages.splice(0, 1);
    after.messages.splice(2, 0, first);
    const dir = tmp('diff');
    const r = cli('diff', write(join(dir, 'a.ir.json'), before), write(join(dir, 'b.ir.json'), after));
    expect(r.out.differs).toBe(true);
    expect(r.out).toMatchObject({ added: [], removed: [], changed: [] });
    expect(r.out.reordered.map((x) => x.collection)).toEqual(['messages', 'participants']);
    expect(r.out.reordered[0].moved).toEqual([{ id: first.id, label: first.label, after: after.messages[1].id }]);
    expect(cli('diff', join(dir, 'a.ir.json'), join(dir, 'a.ir.json')).out).toMatchObject({ differs: false, reordered: [] });
  });
});

describe('undo and redo along one line (report item 5)', () => {
  it('walks S3, S2, S1, S2, S3 with undo, undo, redo, redo, and undoes a redo', () => {
    const run = makeRun('states', { main: flow('S1') });
    const file = join(run, 'source', 'main.ir.json');
    const state = () => JSON.parse(readFileSync(file, 'utf8')).title;
    for (const next of ['S2', 'S3']) {
      expect(cli('snapshot', run, '--request', `to ${next}`).code).toBe(0);
      write(file, flow(next));
    }
    expect(cli('revisions', run).out).toMatchObject({ undo: 'r002', redo: null });
    const seen = [];
    for (const step of ['undo', 'undo', 'redo', 'redo']) {
      const r = cli('restore', run, step);
      expect(r.code, r.stderr).toBe(0);
      seen.push(state());
    }
    expect(seen).toEqual(['S2', 'S1', 'S2', 'S3']);
    // After the two redos nothing is left to redo, and an undo steps back, not sideways.
    const nothing = cli('restore', run, 'redo');
    expect(nothing.code).toBe(1);
    expect(nothing.errors[0].message).toContain('nothing to redo');
    expect(cli('restore', run, 'undo').code).toBe(0);
    expect(state()).toBe('S2');
    expect(cli('revisions', run).out.redo).not.toBeNull();
  });

  it('says so when there is nothing earlier, and still restores a named revision', () => {
    const run = makeRun('fresh', { main: flow('S1') });
    const r = cli('restore', run, 'undo');
    expect(r.code).toBe(1);
    expect(r.errors[0].message).toContain('nothing earlier');
    cli('snapshot', run);
    write(join(run, 'source', 'main.ir.json'), flow('S2'));
    expect(cli('restore', run, 'r001').out).toMatchObject({ ok: true, restored: 'r001' });
  });
});

describe('secrets and personal data (report items 6 and 17)', () => {
  const withLabel = (label) => flow('Secrets', { nodes: [{ id: 'start', label: 'Start', shape: 'terminal' }, { id: 'check', label }, { id: 'done', label: 'Done', shape: 'terminal' }] });

  it('writes a credential to no target, in English, Vietnamese or Japanese, without echoing it', () => {
    const dir = tmp('secret');
    for (const label of [`password=${FAKE}`, `mật khẩu: ${FAKE}`, `パスワード：${FAKE}`, `postgres://app:${FAKE_WORD}@db:5432/x`]) {
      const file = write(join(dir, 's.ir.json'), withLabel(label));
      for (const target of ['drawio', 'mermaid', 'figjam']) {
        const out = join(dir, `s.${target}`);
        const r = cli('emit', '--to', target, file, '--out', out);
        expect(r.code, `${label} -> ${target}`).toBe(2);
        expect(r.errors[0].message).toContain(`refusing to emit for ${target}`);
        expect(r.stderr).not.toContain(FAKE_WORD);
        expect(existsSync(out)).toBe(false);
      }
      const bundled = cli('bundle', '--to', 'drawio', '--out', join(dir, 'b.drawio'), file);
      expect(bundled.code).toBe(2);
      expect(existsSync(join(dir, 'b.drawio'))).toBe(false);
      expect(cli('validate', file).warnings.some((w) => w.stage === 'secret-scan')).toBe(true);
    }
  }, 60_000);

  it('writes it when the user says it is not a secret', () => {
    const dir = tmp('allowed');
    const file = write(join(dir, 's.ir.json'), withLabel(`password=${FAKE}`));
    expect(cli('emit', '--to', 'drawio', file, '--out', join(dir, 's.drawio'), '--allow-sensitive').code).toBe(0);
    expect(cli('bundle', '--to', 'mermaid', '--out', join(dir, 's.md'), '--allow-sensitive', file).code).toBe(0);
    // drift writes nothing, so it compares such a file without the flag.
    expect(cli('drift', join(dir, 's.drawio'), file).out).toMatchObject({ ok: true, drifted: false });
  });

  it('warns about a guess and about personal data on a local file, and refuses them for FigJam', () => {
    const dir = tmp('guess');
    for (const [label, kind] of [['token: required', 'assignment'], ['Gửi mail tới an.nguyen@acme.vn', 'personal-data'], ['Gọi 090-1234-5678', 'personal-data']]) {
      const file = write(join(dir, 'g.ir.json'), withLabel(label));
      const local = cli('emit', '--to', 'mermaid', file);
      expect(local.code, label).toBe(0);
      expect(local.warnings.find((w) => w.stage === 'secret-scan')?.kind).toBe(kind);
      expect(cli('emit', '--to', 'figjam', file).code, label).toBe(2);
    }
    for (const label of ['Verify password hash', 'support@example.com', 'port 8080 on 2026-11-05, v1.2.3 at 10.0.0.1']) {
      expect(cli('emit', '--to', 'figjam', write(join(dir, 'ok.ir.json'), withLabel(label))).code, label).toBe(0);
    }
  });

  it('gives the FigJam fallback its own text: no front matter, and the refusal the mermaid target does not have', () => {
    const dir = tmp('figjam');
    const file = write(join(dir, 'f.ir.json'), withLabel('Đủ điểm (>= giá voucher)?'));
    const figjam = cli('emit', '--to', 'figjam', file, '--out', join(dir, 'figjam', 'f.mmd'));
    expect(figjam.code).toBe(0);
    const text = readFileSync(join(dir, 'figjam', 'f.mmd'), 'utf8');
    expect(text.startsWith('flowchart')).toBe(true);
    expect(text).toContain('≥');
    expect(text).not.toMatch(/#[a-z0-9]+;/);
  });
});

describe('model, size and detail warnings (report items 18, 25 and 27)', () => {
  const messagesOf = (ir) => cli('validate', write(join(tmp('model'), 'm.ir.json'), ir)).warnings.map((w) => w.message);

  it('says on validate what a valid model still gets wrong', () => {
    expect(messagesOf({ schemaVersion: 1, kind: 'flowchart', title: 'F',
      nodes: [{ id: 'a', label: 'A', shape: 'terminal' }, { id: 'q', label: 'OK?', shape: 'decision' }, { id: 'b', label: 'B' }, { id: 'lost', label: 'Lost' }],
      edges: [{ id: 'e1', from: 'a', to: 'q' }, { id: 'e2', from: 'q', to: 'b', label: 'yes' }, { id: 'e3', from: 'q', to: 'b', label: 'yes' }] }))
      .toEqual(['model: "lost" is connected to nothing', 'model: edge "e3" repeats edge "e2" (same ends, same label)']);
    expect(messagesOf({ schemaVersion: 1, kind: 'flowchart', title: 'F',
      nodes: [{ id: 'a', label: 'A', shape: 'terminal' }, { id: 'q', label: 'OK?', shape: 'decision' }, { id: 'b', label: 'B' }],
      edges: [{ id: 'e1', from: 'a', to: 'q' }, { id: 'e2', from: 'q', to: 'b', label: 'yes' }] })[0])
      .toContain('decision "q" has one way out');
    expect(messagesOf({ schemaVersion: 1, kind: 'state', title: 'S',
      states: [{ id: 'i', kind: 'initial' }, { id: 'open', label: 'Open' }, { id: 'ghost', label: 'Ghost' }],
      transitions: [{ id: 't1', from: 'i', to: 'open' }] }))
      .toEqual(['model: state "ghost" is never reached from the initial state']);
    expect(messagesOf({ schemaVersion: 1, kind: 'state', title: 'S',
      states: [{ id: 'open', label: 'Open' }, { id: 'closed', label: 'Closed' }], transitions: [{ id: 't1', from: 'open', to: 'closed' }] })[0])
      .toContain('no initial state');
    expect(messagesOf({ schemaVersion: 1, kind: 'sequence', title: 'Q',
      participants: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
      messages: [{ id: 'm1', from: 'b', to: 'a', label: 'reply', kind: 'return' }, { id: 'm2', from: 'a', to: 'b', label: 'call' }] })[0])
      .toContain('return "m1" from "b" to "a" comes before any call');
    expect(messagesOf({ schemaVersion: 1, kind: 'er', title: 'E',
      entities: [{ id: 'order', label: 'order', attributes: [{ name: 'customer_id', type: 'uuid', key: 'fk' }] }, { id: 'a', label: 'a' }, { id: 'b', label: 'b' }],
      relations: [{ id: 'r', from: 'a', to: 'b', fromCardinality: 'one', toCardinality: 'many' }] })[0])
      .toContain('entity "order" has a foreign key ("customer_id") but takes part in no relation');
  });

  it('warns about a diagram far beyond what a reader follows, on validate and on emit', () => {
    const nodes = Array.from({ length: 200 }, (_, i) => ({ id: `n${i}`, label: `Step ${i}` }));
    const edges = nodes.slice(1).map((n, i) => ({ id: `e${i}`, from: `n${i}`, to: n.id }));
    const file = write(join(tmp('size'), 'big.ir.json'), { schemaVersion: 1, kind: 'flowchart', title: 'Big', nodes, edges });
    expect(cli('validate', file).warnings.map((w) => w.message.slice(0, 20))).toEqual(['size: 200 nodes in o']);
    expect(cli('emit', '--to', 'mermaid', file).warnings.some((w) => w.stage === 'model' && w.message.startsWith('size: 200 nodes'))).toBe(true);
  });

  it('stays quiet on the valid fixtures, but for the three that hold what the checks look for', async () => {
    const { validFixtures } = await import('./helpers.mjs');
    const { checkModel } = await import('../src/check-model.mjs');
    // What each fixture is warned about, by kind of finding: a generated chain of fifty nodes
    // with one-way decisions, and two small charts that draw a decision with a single answer.
    const kinds = (ir) => [...new Set(checkModel(ir).warnings.map((w) => w.message.replace(/"[^"]*"/, '<id>').split(';')[0]))];
    const warned = validFixtures().map((f) => ({ name: `${f.kind}/${f.name}`, messages: kinds(f.ir) })).filter((f) => f.messages.length > 0);
    expect(warned).toEqual([
      { name: 'adversarial/labels', messages: ['model: decision <id> has one way out'] },
      { name: 'flowchart/large-50-nodes', messages: ['model: decision <id> has one way out', 'size: 50 nodes in one diagram'] },
      { name: 'flowchart/valid-refund-check', messages: ['model: decision <id> has one way out'] },
    ]);
  });

  const tables = {
    schemaVersion: 1, kind: 'architecture', title: 'Shop',
    components: [{ id: 'api', label: 'API' }, { id: 'orders', label: 'orders', kind: 'database' }, { id: 'payments', label: 'payments', kind: 'database' }, { id: 'audit', label: 'audit', kind: 'database' }],
    connections: [{ id: 'c1', from: 'api', to: 'orders', label: 'POST /redeem' }, { id: 'c2', from: 'api', to: 'payments' }, { id: 'c3', from: 'api', to: 'audit' }],
  };

  it('reads a method and a one-segment path as an endpoint', () => {
    const r = cli('validate', write(join(tmp('detail'), 'a.ir.json'), tables));
    expect(r.warnings.filter((w) => w.stage === 'detail').map((w) => w.path)).toEqual(['/components/1', '/connections/0/label']);
    expect(r.warnings[1].message).toContain('reads as an endpoint path');
  });

  it('stops repeating a detail warning once the user accepted it, and brings it back for a new element', () => {
    const dir = tmp('accepted');
    const accepted = { ...tables, meta: { notes: ['detail accepted: "orders", "payments" and "audit" stay separate components, the user\'s choice', 'detail accepted: "c1" keeps its endpoint'] } };
    expect(cli('emit', '--to', 'mermaid', write(join(dir, 'a.ir.json'), accepted)).warnings.filter((w) => w.stage === 'detail')).toEqual([]);
    const grown = structuredClone(accepted);
    grown.components.push({ id: 'refunds', label: 'refunds', kind: 'database' });
    grown.connections.push({ id: 'c4', from: 'api', to: 'refunds' });
    const again = cli('emit', '--to', 'mermaid', write(join(dir, 'b.ir.json'), grown)).warnings.filter((w) => w.stage === 'detail');
    expect(again).toHaveLength(1);
    expect(again[0].message).toContain('"refunds"');
  });
});

describe('relabel and the hand-edit check (report items 19 and 20)', () => {
  it('prints one line for the labels a map leaves alone, and drift then reports hand edits only', () => {
    const run = makeRun('returns', { returns: loadFixture('activity', 'valid-two-lanes'), 'returns-01-checkout': loadFixture('flowchart', 'valid') });
    const file = join(run, 'returns.drawio');
    expect(cli('bundle', '--to', 'drawio', '--canvas', 'all', '--title', 'Returns', '--out', file, run).code).toBe(0);
    // A hand edit: one box moved on its own page.
    let moved = 0;
    write(file, readFileSync(file, 'utf8').replace(/(<mxCell id="returns:reject"[^>]*>\s*<mxGeometry x=")([\d.]+)/, (m, a, x) => { moved += 1; return `${a}${Number(x) + 120}`; }));
    expect(moved).toBe(1);
    const before = cli('drift', file, run).out;
    expect(before.pages.flatMap((p) => p.changes)).toEqual([{ cell: 'returns:reject', change: 'moved' }]);

    // A label-only revision: the IR is reworded and the file relabelled in place.
    const label = 'Approve the return request after checking the photos and the order history';
    const ir = JSON.parse(readFileSync(join(run, 'source', 'returns.ir.json'), 'utf8'));
    ir.actions.find((a) => a.id === 'approve').label = label;
    write(join(run, 'source', 'returns.ir.json'), ir);
    const r = cli('relabel', file, '--map', write(join(run, '..', 'map.json'), { 'returns:approve': label }), '--out', file);
    expect(r.code).toBe(0);
    expect(r.out.untouched.length).toBeGreaterThan(10);
    const kept = r.warnings.filter((w) => /kept (its|their) text/.test(w.message));
    expect(kept).toHaveLength(1);
    expect(r.warnings.filter((w) => !w.message.startsWith('layout:'))).toHaveLength(1);
    expect(checkDrawioStructure(readFileSync(file, 'utf8')).problems).toEqual([]);

    const after = cli('drift', file, run).out;
    // One cell was reworded (its copy on the canvas carries the same id).
    expect(after).toMatchObject({ ok: true, drifted: true, relabelled: 1 });
    expect(after.unresolved).toBeUndefined();
    expect(after.pages.flatMap((p) => p.changes)).toEqual([{ cell: 'returns:reject', change: 'moved' }]);
    expect(after.bundle).toEqual(before.bundle);
  });

  it('reports a relabelled file that nobody touched as not drifted', () => {
    const run = makeRun('plain', { plain: loadFixture('flowchart', 'valid') });
    const file = join(run, 'drawio', 'plain.drawio');
    cli('emit', '--to', 'drawio', join(run, 'source', 'plain.ir.json'), '--out', file);
    const ir = JSON.parse(readFileSync(join(run, 'source', 'plain.ir.json'), 'utf8'));
    ir.nodes.find((n) => n.id === 'validate').label = 'Validate the contents of the cart against the price list of today';
    ir.title = 'Order checkout, reworded';
    write(join(run, 'source', 'plain.ir.json'), ir);
    cli('relabel', file, '--map', write(join(run, '..', 'm.json'), { validate: ir.nodes.find((n) => n.id === 'validate').label, title: ir.title }), '--out', file);
    expect(cli('drift', file, join(run, 'source', 'plain.ir.json')).out).toMatchObject({ ok: true, drifted: false, relabelled: 1 });
  });

  it('reads a relabelled single file by its own page id, whatever its IR file is called', () => {
    const dir = tmp('names');
    const ir = loadFixture('flowchart', 'valid');
    cli('emit', '--to', 'drawio', write(join(dir, 'orders.ir.json'), ir), '--out', join(dir, 'orders.drawio'));
    const label = 'Validate the contents of the cart against the price list of today';
    ir.nodes.find((n) => n.id === 'validate').label = label;
    cli('relabel', join(dir, 'orders.drawio'), '--map', write(join(dir, 'm.json'), { validate: label }), '--out', join(dir, 'orders.en.drawio'));
    expect(cli('drift', join(dir, 'orders.en.drawio'), write(join(dir, 'orders-en.ir.json'), ir)).out).toMatchObject({ ok: true, drifted: false, relabelled: 1 });
  });

  it('does not warn about a label below a shape that still fits its line', async () => {
    const { relabelDrawio } = await import('../src/relabel.mjs');
    const cell = (value) => `<mxfile compressed="false"><diagram id="d" name="D"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="d:pay" value="${value}" style="verticalLabelPosition=bottom;verticalAlign=top;html=1;whiteSpace=wrap;labelWidth=97;" vertex="1" parent="1"><mxGeometry x="0" y="0" width="78" height="78" as="geometry"/></mxCell></root></mxGraphModel></diagram></mxfile>`;
    // Eight full-width characters take 96 px, which draw.io fits into the 97 px of the old name.
    expect(relabelDrawio(cell('Cổng thanh toán'), { pay: '決済ゲートウェイ' }).warnings).toEqual([]);
    // A longer name gets the width it needs for one line, up to 200 px; beyond that it is reported.
    const wider = relabelDrawio(cell('Cổng thanh toán'), { pay: '決済ゲートウェイサービス' });
    expect(wider.warnings).toEqual([]);
    expect(Number(/labelWidth=(\d+)/.exec(wider.output)[1])).toBeGreaterThan(97);
    expect(relabelDrawio(cell('Cổng thanh toán'), { pay: '決済ゲートウェイサービスと会員ポイント管理システム' }).warnings).toHaveLength(1);
  });
});

describe('what the second end-to-end run still found', () => {
  it('lets the name below an icon take the width its translation needs, and drift does not call that a restyle', async () => {
    const { relabelDrawio } = await import('../src/relabel.mjs');
    const { emit } = await import('../src/pipeline.mjs');
    const { driftDrawio } = await import('../src/drift.mjs');
    const ir = { schemaVersion: 1, kind: 'architecture', title: 'Shop', components: [{ id: 'app', label: 'App', kind: 'client' }, { id: 'fn', label: 'Lambda', icon: 'aws:lambda' }], connections: [{ id: 'c', from: 'app', to: 'fn', label: 'HTTPS' }] };
    const xml = (await emit(ir, 'drawio', { diagramId: 'shop' })).output;
    const before = Number(/id="shop:fn"[^>]*labelWidth=(\d+)/.exec(xml)[1]);
    const out = relabelDrawio(xml, { fn: 'ポイント付与 Lambda 関数' });
    expect(out.warnings).toEqual([]);
    expect(Number(/id="shop:fn"[^>]*labelWidth=(\d+)/.exec(out.output)[1])).toBeGreaterThan(before);
    ir.components[1].label = 'ポイント付与 Lambda 関数';
    const drift = await driftDrawio(out.output, [{ id: 'shop', ir }]);
    expect(drift.pages[0].changes.filter((c) => c.change === 'restyled')).toEqual([]);
  });

  it('never widens the name below an icon across the line of the frame the icon stands in', async () => {
    const { relabelDrawio } = await import('../src/relabel.mjs');
    const { emit } = await import('../src/pipeline.mjs');
    const ir = { schemaVersion: 1, kind: 'architecture', title: 'Shop', direction: 'LR',
      components: [{ id: 'app', label: 'App', kind: 'client' }, { id: 'alb', label: 'ALB', icon: 'aws:elastic_load_balancing' }, { id: 'api', label: 'API', icon: 'aws:fargate' }],
      boundaries: [{ id: 'vpc', label: 'VPC', group: 'aws:vpc', children: ['alb', 'api'] }],
      connections: [{ id: 'c1', from: 'app', to: 'alb', label: 'HTTPS' }, { id: 'c2', from: 'alb', to: 'api', label: 'HTTP' }] };
    const out = relabelDrawio((await emit(ir, 'drawio', { diagramId: 'shop' })).output, { alb: 'アプリケーションロードバランサーの入口', api: 'ロイヤルティAPIサービス（ECS Fargate）' });
    const cells = checkDrawioStructure(out.output).cells;
    const frame = Number(cells.find((c) => c.id === 'shop:vpc').mxGeometry.width);
    for (const id of ['shop:alb', 'shop:api']) {
      const c = cells.find((x) => x.id === id);
      const centre = Number(c.mxGeometry.x) + Number(c.mxGeometry.width) / 2;
      const half = Number(/labelWidth=(\d+)/.exec(c.style)[1]) / 2;
      expect(centre - half, id).toBeGreaterThanOrEqual(0);
      expect(centre + half, id).toBeLessThanOrEqual(frame);
    }
    // What does not fit that room is reported, not drawn across the frame.
    expect(out.warnings.length).toBeGreaterThanOrEqual(1);
  });

  it('relabels an attribute row of an entity by its row key', async () => {
    const run = makeRun('data', { data: loadFixture('er', 'valid') });
    const file = join(run, 'data.drawio');
    cli('emit', '--to', 'drawio', join(run, 'source', 'data.ir.json'), '--out', file);
    const r = cli('relabel', file, '--map', write(join(run, '..', 'rows.json'), { 'data:customer:row-0': 'PK mã: uuid' }), '--out', file);
    expect(r.out).toMatchObject({ replaced: 1, unmatched: [] });
    expect(readFileSync(file, 'utf8')).toContain('value="PK mã: uuid"');
  });

  it('reads ten digits from a leading 0 as a telephone number, and leaves a date or a long id alone', async () => {
    const { scanSecrets } = await import('../src/scan-secrets.mjs');
    expect(scanSecrets({ a: 'Gọi 0912345678' }).warnings.map((w) => w.kind)).toEqual(['personal-data']);
    for (const text of ['order 20261105', 'id 0012345678901234', 'v0.123456789']) expect(scanSecrets({ a: text }).warnings, text).toEqual([]);
  });

  it('draws the main line of a flow straight when a branch leads back to an earlier step', async () => {
    const { emit } = await import('../src/pipeline.mjs');
    for (const direction of ['LR', 'TB']) {
      const ir = { schemaVersion: 1, kind: 'flowchart', title: 'Loop', direction,
        nodes: [{ id: 'start', label: 'Start', shape: 'terminal' }, { id: 'enter', label: 'Enter the points' }, { id: 'ok', label: 'Enough?', shape: 'decision' }, { id: 'done', label: 'Done', shape: 'terminal' }, { id: 'retry', label: 'Say what is missing' }],
        edges: [{ id: 'e1', from: 'start', to: 'enter' }, { id: 'e2', from: 'enter', to: 'ok' }, { id: 'e3', from: 'ok', to: 'done', label: 'yes' }, { id: 'e4', from: 'ok', to: 'retry', label: 'no' }, { id: 'e5', from: 'retry', to: 'enter' }] };
      const cells = checkDrawioStructure((await emit(ir, 'drawio', { diagramId: 'd' })).output).cells;
      const centre = (id) => { const g = cells.find((c) => c.id === id).mxGeometry; return direction === 'LR' ? Number(g.y) + Number(g.height) / 2 : Number(g.x) + Number(g.width) / 2; };
      expect(Math.abs(centre('d:start') - centre('d:enter')), direction).toBeLessThan(1);
      expect(Math.abs(centre('d:enter') - centre('d:ok')), direction).toBeLessThan(1);
    }
  });
});

describe('the low findings of the closing round', () => {
  it('keeps the cardinalities of a class self-relation off its own label', async () => {
    const { emit } = await import('../src/pipeline.mjs');
    const ir = { schemaVersion: 1, kind: 'class', title: 'Catalogue',
      classes: [{ id: 'Category', label: 'Category', attributes: [{ name: 'name', type: 'string' }] }, { id: 'Product', label: 'Product', attributes: [{ name: 'sku', type: 'string' }] }],
      relations: [{ id: 'has', from: 'Category', to: 'Product', kind: 'aggregation' }, { id: 'self', from: 'Category', to: 'Category', kind: 'association', label: 'danh mục cha của danh mục con', fromCardinality: '0..1', toCardinality: '0..*' }] };
    const r = await emit(ir, 'drawio', { diagramId: 'd' });
    expect(r.warnings.filter((w) => w.message.startsWith('layout:'))).toEqual([]);
    const xml = r.output;
    // The loop, its label right of it, and the two cardinalities: neither stands at the height of the label.
    const loop = /id="d:self"[^>]*>\s*<mxGeometry[^>]*>\s*<Array as="points">\s*<mxPoint x="([\d.]+)" y="([\d.]+)"\/>\s*<mxPoint x="[\d.]+" y="([\d.]+)"/.exec(xml);
    const mid = (Number(loop[2]) + Number(loop[3])) / 2;
    for (const end of ['from-card', 'to-card']) {
      const g = new RegExp(`id="d:self:${end}"[^>]*>\\s*<mxGeometry[^>]*>\\s*<mxPoint x="(-?[\\d.]+)" y="(-?[\\d.]+)"`).exec(xml);
      const right = Number(g[1]) > 0;
      const level = Math.abs((end === 'from-card' ? Number(loop[2]) : Number(loop[3])) + Number(g[2]) - mid) < 10;
      expect(right && level, end).toBe(false);
    }
  });

  it('reports a label on a line that became much longer than the one it replaces', async () => {
    const { relabelDrawio } = await import('../src/relabel.mjs');
    const { emit } = await import('../src/pipeline.mjs');
    const xml = (await emit(loadFixture('flowchart', 'valid'), 'drawio', { diagramId: 'd' })).output;
    expect(relabelDrawio(xml, { e3: 'có' }).warnings).toEqual([]);
    const long = relabelDrawio(xml, { e3: 'có, tất cả mặt hàng trong giỏ đều còn trong kho' }).warnings;
    expect(long).toHaveLength(1);
    expect(long[0].message).toMatch(/^layout: the new label on this line is about \d+ px longer/);
  });

  it('starts the branch label of a sequence block inside the border of its frame', async () => {
    const { emit } = await import('../src/pipeline.mjs');
    const cells = checkDrawioStructure((await emit(loadFixture('sequence', 'valid'), 'drawio', { diagramId: 'd' })).output).cells;
    const label = cells.find((c) => /:sep-label-1$/.test(c.id));
    const frame = cells.find((c) => c.id === label.id.replace(/:sep-label-1$/, ''));
    expect(Number(label.mxGeometry.x)).toBeGreaterThan(Number(frame.mxGeometry.x));
  });

  it('says so when architecture-beta will cut the slug of a ref inside a word, and keeps the form', async () => {
    const { emit } = await import('../src/pipeline.mjs');
    const r = await emit(loadFixture('architecture', 'valid-ref-parts'), 'mermaid');
    expect(r.output).toContain('architecture-beta');
    // One warning for each slug that is longer than a label line.
    const long = loadFixture('architecture', 'valid-ref-parts').components.filter((c) => c.ref && c.ref.length > 16).map((c) => c.ref);
    expect(long.length).toBeGreaterThanOrEqual(2);
    const cut = r.warnings.filter((w) => /is cut inside a word/.test(w.message));
    expect(cut.map((w) => /slug "([^"]+)"/.exec(w.message)[1])).toEqual(long);
  });

  it('quotes nothing of a mail address or a telephone number, and names a fitting placeholder', async () => {
    const { scanSecrets } = await import('../src/scan-secrets.mjs');
    const mail = scanSecrets({ a: 'Gửi tới an.nguyen@acme.vn' }).warnings[0].message;
    expect(mail).not.toMatch(/an\.n|acme/);
    expect(mail).toContain('<customer e-mail>');
    expect(scanSecrets({ a: 'Gọi 0912345678' }).warnings[0].message).toContain('<customer phone>');
    const dir = tmp('pii');
    const r = cli('emit', '--to', 'figjam', write(join(dir, 'p.ir.json'), flow('P', { nodes: [{ id: 'start', label: 'Start', shape: 'terminal' }, { id: 'check', label: 'Gửi tới an.nguyen@acme.vn' }, { id: 'done', label: 'Done', shape: 'terminal' }] })));
    expect(r.code).toBe(2);
    expect(r.errors[0].hint).toContain('<customer e-mail>');
    expect(r.stderr).not.toContain('an.n');
    const phone = cli('emit', '--to', 'figjam', write(join(dir, 'q.ir.json'), flow('P', { nodes: [{ id: 'start', label: 'Start', shape: 'terminal' }, { id: 'check', label: 'Gọi 0912345678' }, { id: 'done', label: 'Done', shape: 'terminal' }] })));
    expect(phone.errors[0].hint).toContain('<customer phone>');
    // A placeholder address in front does not hide a real one behind it.
    const two = scanSecrets({ a: 'user@example.org và an.nguyen@acme.vn' }).warnings;
    expect(two.map((w) => w.kind)).toEqual(['personal-data']);
    expect(scanSecrets({ a: 'user@example.org, name@shop.test' }).warnings).toEqual([]);
  });
});

describe('history (report items 21 and 26)', () => {
  it('keeps the hand-edited files of a revision that is rotated out, and says where', () => {
    const run = makeRun('extras', { main: flow('Main') });
    write(join(run, 'drawio', 'main.drawio'), '<mxfile>edited by hand</mxfile>');
    expect(cli('snapshot', run, '--extra', join(run, 'drawio', 'main.drawio')).out).toMatchObject({ rev: 'r001', extras: ['drawio/main.drawio'] });
    let last;
    for (let i = 0; i < 5; i++) last = cli('snapshot', run).out;
    expect(last).toMatchObject({ rev: 'r006', removed: ['r001'], keptExtras: ['history/extras/r001/drawio/main.drawio'] });
    expect(readFileSync(join(run, 'history', 'extras', 'r001', 'drawio', 'main.drawio'), 'utf8')).toBe('<mxfile>edited by hand</mxfile>');
    expect(readdirSync(join(run, 'history')).sort()).toEqual(['extras', 'r002', 'r003', 'r004', 'r005', 'r006']);
    expect(cli('revisions', run).out.keptExtras).toEqual(['history/extras/r001/drawio/main.drawio']);
  });

  it('writes no revision for a run without an IR, and tells a missing folder from one without source/', () => {
    const hollow = join(tmp('hollow'), 'diagrams', '20261111_hollow');
    mkdirSync(join(hollow, 'source'), { recursive: true });
    const r = cli('snapshot', hollow);
    expect(r.code).toBe(1);
    expect(r.errors[0].message).toContain('nothing to snapshot');
    expect(existsSync(join(hollow, 'history', 'r001'))).toBe(false);
    expect(cli('revisions', join(hollow, 'nowhere')).errors[0].message).toContain('no such folder');
    expect(cli('revisions', join(hollow, 'source')).errors[0].message).toContain('no source/ folder');
  });
});

describe('the combined Mermaid file (report items 13 and 22)', () => {
  let run;
  beforeAll(() => {
    run = makeRun('login', { login: loadFixture('sequence', 'valid'), 'login-01-flow': loadFixture('flowchart', 'valid') });
    expect(cli('bundle', '--to', 'mermaid', '--title', 'Đăng nhập "nhanh"', '--out', join(run, 'login.md'), run).code).toBe(0);
  });

  it('drift returns the options the file was written with, and names a block edited by hand', () => {
    const file = join(run, 'login.md');
    expect(cli('drift', file, run).out).toEqual({ ok: true, drifted: false, bundled: true, target: 'mermaid', pages: [{ diagram: 'login', changes: [] }, { diagram: 'login-01-flow', changes: [] }], bundle: { title: 'Đăng nhập "nhanh"' } });
    write(file, readFileSync(file, 'utf8').replace('flowchart TB', 'flowchart LR'));
    const edited = cli('drift', file, run).out;
    expect(edited.drifted).toBe(true);
    expect(edited.pages.filter((p) => p.changes.length > 0).map((p) => p.diagram)).toEqual(['login-01-flow']);
    // The recovered object is what snapshot records.
    const opts = write(join(run, '..', 'bundle.json'), edited.bundle);
    expect(cli('snapshot', run, '--bundle', `@${opts}`).code).toBe(0);
    expect(cli('revisions', run).out.revisions[0].bundle).toEqual({ title: 'Đăng nhập "nhanh"' });
  });

  it('finds every block of the combined file for the review image', () => {
    expect(mermaidBlocks(readFileSync(join(run, 'login.md'), 'utf8')).map((b) => b.split('\n')[0])).toEqual(['---', '---']);
    expect(cli('preview', write(join(run, 'empty.md'), '# Nothing\n')).errors[0].message).toMatch(/no fenced mermaid block|no renderer/);
  });

  it.skipIf(!loadPlaywright())('renders one image per block', () => {
    const r = cli('preview', join(run, 'login.md'), '--max-px', '900', '--out', join(run, '..', 'login.png'));
    expect(r.code, r.stderr).toBe(0);
    expect(r.out.blocks).toBe(2);
    expect(r.out.files.length).toBeGreaterThanOrEqual(2);
    for (const f of r.out.files) expect(existsSync(f)).toBe(true);
  }, 240_000);
});

describe('preview of a drawing whose labels reach past its shapes', () => {
  it.skipIf(!loadPlaywright())('fills the image instead of leaving empty bands above and below', async () => {
    const { preview } = await import('../src/preview.mjs');
    const { decodePng } = await import('../src/png.mjs');
    const dir = tmp('bands');
    cli('emit', '--to', 'drawio', join(scriptsDir, 'fixtures', 'state', 'valid.json'), '--out', join(dir, 'state.drawio'));
    const r = await preview(join(dir, 'state.drawio'), { out: join(dir, 'state.png'), maxPx: 900, renderer: 'drawio-web' });
    expect(r.ok, JSON.stringify(r.errors)).toBe(true);
    const png = decodePng(readFileSync(r.files[0]));
    const stride = png.width * png.bpp;
    const inked = (y) => png.pixels.subarray(y * stride, (y + 1) * stride).some((v) => v < 200);
    let top = 0;
    while (top < png.height && !inked(top)) top += 1;
    let bottom = png.height - 1;
    while (bottom > 0 && !inked(bottom)) bottom -= 1;
    // The drawing reaches to within the margin of both ends of the image.
    expect(top).toBeLessThan(png.height * 0.08);
    expect(png.height - bottom).toBeLessThan(png.height * 0.08);
  }, 180_000);
});

describe('preview path (report item 23)', () => {
  it('gives every input file a path of its own, and one file the same path each time', () => {
    const a = defaultPreviewPath('/work/a/diagrams/20261111_x/x.drawio');
    expect(defaultPreviewPath('/work/a/diagrams/20261111_x/x.drawio')).toBe(a);
    const others = ['/work/a/diagrams/20261111_x/drawio/x.drawio', '/work/a/diagrams/20261111_x/x.mmd', '/work/b/diagrams/20261111_x/x.drawio'].map(defaultPreviewPath);
    expect(new Set([a, ...others]).size).toBe(4);
    expect(a).toMatch(/zukai-preview[\\/]x-drawio-[0-9a-f]{8}\.png$/);
  });
});

describe('command line (report item 24)', () => {
  const ir = join(scriptsDir, 'fixtures', 'flowchart', 'valid.json');

  it('treats an option without its value as a usage error and writes no file named like a flag', () => {
    const r = cli('emit', '--to', 'drawio', ir, '--out', '--allow-sensitive');
    expect(r.code).toBe(1);
    expect(r.errors[0].message).toContain('option --out needs a value');
    expect(existsSync(join(cwd, '--allow-sensitive'))).toBe(false);
    const last = cli('emit', '--to', 'drawio', ir, '--out');
    expect(last.code).toBe(1);
    expect(last.stdout).toBe('');
    // The = form still passes a value that starts with two hyphens.
    expect(cli('snapshot', join(cwd, 'nowhere'), '--request=--apply this').errors[0].message).toContain('no such folder');
  });

  it('exits 1 on an unknown target or option, 2 on an invalid model', () => {
    expect(cli('emit', '--to', 'pdf', ir)).toMatchObject({ code: 1 });
    expect(cli('emit', '--to', 'pdf', ir).errors[0].hint).toContain('mermaid, drawio, figjam');
    expect(cli('bundle', '--to', 'figjam', '--out', 'x', ir).code).toBe(1);
    expect(cli('validate', ir, '--frobnicate').code).toBe(1);
    expect(cli('validate', join(scriptsDir, 'fixtures', 'flowchart', 'invalid-missing-edge-target.json')).code).toBe(2);
  });

  it('prints the usage for help, --help and -h', () => {
    for (const args of [['help'], ['--help'], ['emit', '-h']]) {
      const r = cli(...args);
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('cli.mjs restore <run-dir> <rNNN|undo|redo>');
      expect(r.stderr).toBe('');
    }
  });
});

describe('layout (report items 30 and 32 to 36)', () => {
  const emit = async (ir, target, options) => (await import('../src/pipeline.mjs')).emit(ir, target, options);
  const cellsOf = async (ir) => checkDrawioStructure((await emit(ir, 'drawio', { diagramId: 'd' })).output).cells;
  const box = (cells, id) => { const g = cells.find((c) => c.id === id).mxGeometry; return { x: Number(g.x), y: Number(g.y), width: Number(g.width), height: Number(g.height) }; };

  it('writes the flowchart form when a long label would stretch a Mermaid group frame', async () => {
    const ir = {
      schemaVersion: 1, kind: 'architecture', title: 'Where it runs', direction: 'LR',
      components: [{ id: 'agent', label: 'Agent', kind: 'client' }, { id: 'cli', label: 'Zukai CLI (Node 22.13+, one bundled file)' }, { id: 'run', label: 'Run folder', kind: 'database' }],
      boundaries: [{ id: 'skill', label: 'Skill directory', children: ['cli'] }, { id: 'project', label: 'Project', children: ['run'] }],
      connections: [{ id: 'c1', from: 'agent', to: 'cli' }, { id: 'c2', from: 'cli', to: 'run' }],
    };
    const long = await emit(ir, 'mermaid');
    expect(long.output).toContain('flowchart LR');
    expect(long.warnings.find((w) => w.fallback === 'flowchart').message).toContain('the label of "cli" is longer than 16 characters');
    ir.components[1].label = 'Zukai CLI';
    expect((await emit(ir, 'mermaid')).output).toContain('architecture-beta');
    // A ref adds the part's slug to the label, which is the same length problem.
    ir.components[1].ref = 'where-it-runs-01-emit';
    expect((await emit(ir, 'mermaid')).output).toContain('flowchart LR');
  });

  it('keeps the markers of two relations that end at one attribute row apart', async () => {
    const entity = (id) => ({ id, label: id, attributes: [{ name: 'id', type: 'uuid', key: 'pk' }, { name: 'member_id', type: 'uuid', key: 'fk' }] });
    const ir = {
      schemaVersion: 1, kind: 'er', title: 'Loyalty', direction: 'LR',
      entities: [{ id: 'member', label: 'member', attributes: [{ name: 'id', type: 'uuid', key: 'pk' }, { name: 'name', type: 'text' }] }, entity('point_txn'), entity('voucher')],
      relations: ['point_txn', 'voucher'].map((to, i) => ({ id: `r${i}`, from: 'member', to, fromCardinality: 'one', toCardinality: 'many', fromAttribute: 'id', toAttribute: 'member_id' })),
    };
    const cells = await cellsOf(ir);
    const exits = cells.filter((c) => c.edge === '1').map((c) => Number(/exitY=([\d.]+)/.exec(c.style)[1]) * box(cells, 'd:member').height);
    expect(Math.abs(exits[0] - exits[1])).toBeGreaterThanOrEqual(19.5);
    // The row grew for them; a row with one relation keeps its height.
    expect(box(cells, 'd:member:row-0').height).toBe(46);
    expect(box(cells, 'd:member:row-1').height).toBe(26);
  });

  it('spreads two relations that enter an entity from above, each naming a row of its own', async () => {
    const ir = {
      schemaVersion: 1, kind: 'er', title: 'Loyalty',
      entities: [{ id: 'member', label: 'member', attributes: [{ name: 'id', type: 'uuid', key: 'pk' }] }, { id: 'voucher', label: 'voucher', attributes: [{ name: 'id', type: 'uuid', key: 'pk' }] },
        { id: 'redemption', label: 'redemption', attributes: [{ name: 'id', type: 'uuid', key: 'pk' }, { name: 'member_id', type: 'uuid', key: 'fk' }, { name: 'voucher_id', type: 'uuid', key: 'fk' }] }],
      relations: [{ id: 'r1', from: 'member', to: 'redemption', fromCardinality: 'one', toCardinality: 'many' }, { id: 'r2', from: 'voucher', to: 'redemption', fromCardinality: 'one', toCardinality: 'many' }],
    };
    const cells = await cellsOf(ir);
    const width = box(cells, 'd:redemption').width;
    const entries = cells.filter((c) => c.edge === '1').map((c) => Number(/entryX=([\d.]+)/.exec(c.style)[1]) * width);
    expect(Math.abs(entries[0] - entries[1])).toBeGreaterThanOrEqual(40);
  });

  it('routes an activity branch that ends at a shared merge without crossing its siblings', async () => {
    const ir = {
      schemaVersion: 1, kind: 'activity', title: 'Eligibility', lanes: [{ id: 'cs', label: 'CS' }],
      actions: [{ id: 'open', label: 'Open the request', lane: 'cs' }, { id: 'self', label: 'Conclude: approve', lane: 'cs' }, { id: 'lead', label: 'Conclude: send to the team lead', lane: 'cs' }, { id: 'expired', label: 'Conclude: expired, reject', lane: 'cs' }],
      controls: [{ id: 'start', kind: 'initial', lane: 'cs' }, { id: 'window', kind: 'decision', label: 'Within 30 days?', lane: 'cs' }, { id: 'amount', kind: 'decision', label: 'Up to 2,000,000?', lane: 'cs' }, { id: 'merge', kind: 'merge', lane: 'cs' }, { id: 'end', kind: 'final', lane: 'cs' }],
      flows: [{ id: 'f1', from: 'start', to: 'open' }, { id: 'f2', from: 'open', to: 'window' }, { id: 'f-expired', from: 'window', to: 'expired', guard: 'expired' }, { id: 'f-in', from: 'window', to: 'amount', guard: 'in time' },
        { id: 'f-small', from: 'amount', to: 'self', guard: 'yes' }, { id: 'f-large', from: 'amount', to: 'lead', guard: 'no' }, { id: 'f-expired-end', from: 'expired', to: 'merge' }, { id: 'f-self-end', from: 'self', to: 'merge' }, { id: 'f-lead-end', from: 'lead', to: 'merge' }, { id: 'f-end', from: 'merge', to: 'end' }],
    };
    const r = await emit(ir, 'drawio', { diagramId: 'd' });
    expect(r.warnings.filter((w) => w.message.startsWith('layout:'))).toEqual([]);
  });

  it('writes the guard of a straight branch above the point where another flow joins it', async () => {
    const ir = {
      schemaVersion: 1, kind: 'activity', title: 'Approval', lanes: [{ id: 'cs', label: 'CS' }, { id: 'lead', label: 'Lead' }],
      actions: [{ id: 'self', label: 'Approve it', lane: 'cs' }, { id: 'review', label: 'Review it', lane: 'lead' }, { id: 'pay', label: 'Pay it out', lane: 'lead' }, { id: 'reject', label: 'Reject it', lane: 'cs' }],
      controls: [{ id: 'start', kind: 'initial', lane: 'cs' }, { id: 'size', kind: 'decision', label: 'Small?', lane: 'cs' }, { id: 'ok', kind: 'decision', label: 'Approved?', lane: 'lead' }, { id: 'approved', kind: 'merge', lane: 'lead' }, { id: 'end', kind: 'final', lane: 'lead' }, { id: 'no', kind: 'final', lane: 'cs' }],
      flows: [{ id: 'f1', from: 'start', to: 'size' }, { id: 'f-small', from: 'size', to: 'self', guard: 'yes' }, { id: 'f-large', from: 'size', to: 'review', guard: 'no' }, { id: 'f3', from: 'review', to: 'ok' },
        { id: 'f-yes', from: 'ok', to: 'approved', guard: 'approved' }, { id: 'f-no', from: 'ok', to: 'reject', guard: 'rejected' }, { id: 'f-self', from: 'self', to: 'approved' }, { id: 'f5', from: 'approved', to: 'pay' }, { id: 'f6', from: 'pay', to: 'end' }, { id: 'f7', from: 'reject', to: 'no' }],
    };
    const cells = await cellsOf(ir);
    const lane = box(cells, 'd:lead');
    const decision = box(cells, 'd:ok');
    const merge = box(cells, 'd:approved');
    // The flow from the other lane joins the straight branch on a horizontal run: its y.
    const joining = cells.find((c) => c.id === 'd:f-self');
    const joinY = Math.max(...(Array.isArray(joining.mxGeometry.Array?.mxPoint) ? joining.mxGeometry.Array.mxPoint : [joining.mxGeometry.Array.mxPoint]).map((p) => Number(p.y)));
    const bottom = lane.y + decision.y + decision.height;
    const top = lane.y + merge.y;
    // The join lies just above the merge, leaving the branch a stretch of its own below the decision.
    expect(top - joinY).toBeLessThanOrEqual(14);
    expect(joinY - bottom).toBeGreaterThanOrEqual(40);
  });

  it('keeps one label line on a step whose part carries the same title, with its page link', async () => {
    const run = makeRun('refund', {
      refund: { schemaVersion: 1, kind: 'flowchart', title: 'Refund', nodes: [{ id: 's', label: 'Start', shape: 'terminal' }, { id: 'check', label: 'Check the conditions', ref: 'refund-01-check' }, { id: 'pay', label: 'Pay out', ref: 'refund-02-pay' }], edges: [{ id: 'e1', from: 's', to: 'check' }, { id: 'e2', from: 'check', to: 'pay' }] },
      'refund-01-check': flow('Check the  conditions'),
      'refund-02-pay': flow('Refund through the payment gateway'),
    });
    expect(cli('bundle', '--to', 'drawio', '--out', join(run, 'refund.drawio'), run).code).toBe(0);
    const xml = readFileSync(join(run, 'refund.drawio'), 'utf8');
    expect(xml).toContain('<UserObject label="Check the conditions" link="data:page/id,refund-01-check" id="refund:check">');
    expect(xml).toContain('<UserObject label="Pay out&lt;br&gt;↳ Refund through the payment gateway" link="data:page/id,refund-02-pay" id="refund:pay">');
    cli('bundle', '--to', 'mermaid', '--out', join(run, 'refund.md'), run);
    const md = readFileSync(join(run, 'refund.md'), 'utf8');
    expect(md).toContain('[["Check the conditions"]]');
    expect(md).toContain('[["Pay out<br/>↳ Refund through the payment gateway"]]');
  });

  it('keeps the label of a class self-relation off the neighbouring class', async () => {
    const cls = (id, attributes) => ({ id, label: id, attributes: attributes.map((name) => ({ name, type: 'id' })) });
    const ir = {
      schemaVersion: 1, kind: 'class', title: 'Model',
      classes: [cls('Root', ['kind']), cls('Boundary', ['id', 'label', 'children']), cls('Connection', ['id', 'from', 'to'])],
      relations: [{ id: 'r1', from: 'Root', to: 'Boundary', kind: 'composition' }, { id: 'r2', from: 'Root', to: 'Connection', kind: 'composition' }, { id: 'self', from: 'Boundary', to: 'Boundary', kind: 'aggregation', label: 'children' }],
    };
    const cells = await cellsOf(ir);
    const a = box(cells, 'd:Boundary');
    const b = box(cells, 'd:Connection');
    const gap = b.x > a.x ? b.x - (a.x + a.width) : a.x - (b.x + b.width);
    // The loop stands 30 px off the class and its label ("children", about 45 px) beyond it.
    expect(gap).toBeGreaterThanOrEqual(30 + 45);
  });

  it('draws a note that follows a block below the block, in both targets', async () => {
    const ir = loadFixture('sequence', 'valid');
    const block = ir.blocks[0];
    const last = [...block.messages, ...(block.branches ?? []).flatMap((b) => b.messages)].at(-1);
    ir.notes = [{ id: 'inside', label: 'Inside the last branch', participants: [ir.participants[0].id], after: last }, { id: 'below', label: 'Below the block', participants: [ir.participants[0].id], after: block.id }];
    const lines = (await emit(ir, 'mermaid')).output.split('\n');
    const end = lines.findIndex((l) => l.trim() === 'end');
    expect(lines.findIndex((l) => l.includes('Inside the last branch'))).toBeLessThan(end);
    expect(lines.findIndex((l) => l.includes('Below the block'))).toBeGreaterThan(end);
    const cells = await cellsOf(ir);
    const frame = box(cells, `d:${block.id}`);
    expect(box(cells, 'd:below').y).toBeGreaterThanOrEqual(frame.y + frame.height);
    expect(box(cells, 'd:inside').y).toBeLessThan(frame.y + frame.height);
  });
});
