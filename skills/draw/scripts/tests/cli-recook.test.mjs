import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scriptsDir } from './helpers.mjs';

const cli = join(scriptsDir, 'bin', 'cli.mjs');
const sources = join(scriptsDir, 'tests', 'recook-sources');
const cwd = mkdtempSync(join(tmpdir(), 'zukai-cli-recook-'));

function run(args) {
  const r = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });
  const last = (text) => (text.trim() ? JSON.parse(text.trim().split('\n').pop()) : undefined);
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, json: r.status === 0 ? last(r.stdout) : undefined, error: r.status !== 0 ? last(r.stderr) : undefined };
}

const orderIr = (withNotify = true) => ({
  schemaVersion: 1, kind: 'flowchart', title: 'Đặt hàng',
  nodes: [
    { id: 'start', label: 'Bắt đầu', shape: 'terminal' },
    { id: 'enter', label: 'Nhập giỏ hàng và địa chỉ', shape: 'process' },
    { id: 'check', label: 'Còn hàng?', shape: 'decision' },
    { id: 'pay', label: 'Thanh toán thẻ', shape: 'process' },
    ...(withNotify ? [{ id: 'notify', label: 'Báo hết hàng', shape: 'io' }] : []),
    { id: 'end', label: 'Kết thúc', shape: 'terminal' },
  ],
  edges: [
    { id: 'e1', from: 'start', to: 'enter' },
    { id: 'e2', from: 'enter', to: 'check' },
    { id: 'e3', from: 'check', to: 'pay', label: 'Có', kind: 'conditional' },
    ...(withNotify ? [{ id: 'e4', from: 'check', to: 'notify', label: 'Không', kind: 'conditional' }] : []),
    { id: 'e5', from: 'pay', to: 'end' },
  ],
  meta: { source: 'recook', notes: ['recooked from source/original/hand-flowchart.drawio, page "Đặt hàng"'], omitted: ['"Ghi chú: giờ cao điểm 18h–21h": a free note beside the flow, not a step'] },
});

describe('cli recook commands (committed bundle)', () => {
  it('extract writes the facts and prints a summary of each page', () => {
    const run1 = join(cwd, 'diagrams', '20261113_order');
    mkdirSync(join(run1, 'source', 'original'), { recursive: true });
    copyFileSync(join(sources, 'hand-flowchart.drawio'), join(run1, 'source', 'original', 'hand-flowchart.drawio'));
    const r = run(['extract', join(run1, 'source', 'original', 'hand-flowchart.drawio'), '--out', join(run1, 'source', 'order.facts.json')]);
    expect(r.code).toBe(0);
    expect(r.json).toMatchObject({ ok: true, format: 'drawio', pages: [{ id: 'flow1', name: 'Đặt hàng', nodes: 7, edges: 5 }] });
    expect(r.json.pages[0].kindHints[0].kind).toBe('flowchart');
    const facts = JSON.parse(readFileSync(join(run1, 'source', 'order.facts.json'), 'utf8'));
    expect(facts).toMatchObject({ facts: 1, format: 'drawio' });
    expect(facts.pages[0].nodes.find((n) => n.id === 'pay').label).toBe('Thanh toán thẻ');
  });

  it('extract without --out prints the facts, and refuses what is no diagram', () => {
    const r = spawnSync(process.execPath, [cli, 'extract', join(sources, 'hand-two-pages.drawio')], { cwd, encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).pages.map((p) => p.id)).toEqual(['arch', 'erd']);
    writeFileSync(join(cwd, 'notes.txt'), 'just some text\n');
    const bad = run(['extract', 'notes.txt']);
    expect(bad.code).toBe(1);
    expect(bad.error.errors[0].message).toMatch(/not a diagram this skill can read/);
    expect(run(['extract', 'missing.drawio']).code).toBe(1);
    expect(run(['extract']).code).toBe(1);
  });

  it('extract reads Mermaid text', () => {
    writeFileSync(join(cwd, 'flow.mmd'), 'flowchart TD\n  a[Start] --> b{Paid?}\n  b -->|yes| c[Ship]\n');
    const r = run(['extract', 'flow.mmd', '--out', 'flow.facts.json']);
    expect(r.code).toBe(0);
    expect(r.json).toMatchObject({ ok: true, format: 'mermaid' });
    expect(r.json.pages[0].kindHints[0].kind).toBe('flowchart');
  });

  it('extract --figjam-script writes the reader script and nothing else', () => {
    const r = run(['extract', '--figjam-script', 'tmp/read-board.js', '--section', 'Checkout']);
    expect(r.code).toBe(0);
    expect(r.json).toMatchObject({ ok: true, script: 'tmp/read-board.js', section: 'Checkout' });
    const script = readFileSync(join(cwd, 'tmp', 'read-board.js'), 'utf8');
    expect(script).toMatch(/Changes nothing on the board/);
    expect(script).toContain('const SECTION = "Checkout";');
    expect(script).not.toMatch(/figma\.create|\.remove\(|appendChild/);
    expect(run(['extract', 'x.drawio', '--figjam-script', 'tmp/a.js']).code).toBe(1);
    expect(run(['extract', join(sources, 'hand-flowchart.drawio'), '--section', 'A']).code).toBe(1);
  });

  it('cover passes when every text is kept or left out with a reason, and lists what was dropped', () => {
    const run1 = join(cwd, 'diagrams', '20261113_order');
    writeFileSync(join(run1, 'source', 'order.ir.json'), JSON.stringify(orderIr()));
    expect(run(['validate', join(run1, 'source', 'order.ir.json')]).code).toBe(0);
    const ok = run(['cover', join(run1, 'source', 'order.facts.json'), run1]);
    expect(ok.code).toBe(0);
    expect(ok.json).toMatchObject({ ok: true, missing: [] });
    expect(ok.json.covered).toBe(ok.json.units);

    writeFileSync(join(run1, 'source', 'order.ir.json'), JSON.stringify(orderIr(false)));
    const dropped = run(['cover', join(run1, 'source', 'order.facts.json'), run1]);
    expect(dropped.code).toBe(2);
    expect(dropped.error.missing.map((m) => m.text).sort()).toEqual(['Báo hết hàng', 'Không']);
    expect(dropped.error.hint).toMatch(/meta\.omitted/);
  });

  it('cover refuses a file that is not facts, and a folder without IRs', () => {
    writeFileSync(join(cwd, 'plain.json'), '{"a":1}');
    expect(run(['cover', 'plain.json', 'plain.json']).error.errors[0].message).toMatch(/not a facts file/);
    mkdirSync(join(cwd, 'empty'), { recursive: true });
    expect(run(['cover', 'flow.facts.json', 'empty']).code).toBe(1);
    expect(run(['cover', 'flow.facts.json']).code).toBe(1);
  });

  it('extract --page keeps the pages named, records the source hash, and names the pages when one is unknown', () => {
    const r = spawnSync(process.execPath, [cli, 'extract', join(sources, 'hand-two-pages.drawio'), '--page', 'Orders ERD'], { cwd, encoding: 'utf8' });
    expect(r.status).toBe(0);
    const facts = JSON.parse(r.stdout);
    expect(facts.pages.map((p) => p.id)).toEqual(['erd']);
    expect(facts.sha256).toMatch(/^[0-9a-f]{64}$/);
    const bad = run(['extract', join(sources, 'hand-two-pages.drawio'), '--page', 'nope']);
    expect(bad.code).toBe(1);
    expect(bad.error.errors[0].hint).toMatch(/arch \("Architecture"\), erd \("Orders ERD"\)/);
  });

  it('cover does not count a text hidden in meta.notes', () => {
    const run1 = join(cwd, 'diagrams', '20261113_order');
    const ir = orderIr(false);
    ir.meta.notes.push('Báo hết hàng, Không');
    writeFileSync(join(run1, 'source', 'order.ir.json'), JSON.stringify(ir));
    expect(run(['cover', join(run1, 'source', 'order.facts.json'), run1]).code).toBe(2);
  });
});
