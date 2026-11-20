/**
 * End to end, through the committed bundle: fan-in diagrams are emitted to draw.io, drawn by
 * the draw.io viewer (`export`), and the arrows are measured on the SVG it wrote. The other
 * tests check the anchors the emitter writes; this one checks what draw.io makes of them,
 * which is where an end left to draw.io's perimeter got a jog and a turned arrowhead.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scriptsDir } from './helpers.mjs';
import { loadPlaywright } from '../src/preview.mjs';
import { distanceTo, fanIn, queueFanIn } from './fan-in-shapes.mjs';

const cliPath = join(scriptsDir, 'bin', 'cli.mjs');
const dir = mkdtempSync(join(tmpdir(), 'zukai-fan-in-render-'));
const cli = (...args) => spawnSync(process.execPath, [cliPath, ...args], { cwd: dir, encoding: 'utf8' });
const hasPlaywright = loadPlaywright() !== null;

/** The points of an SVG path of straight stretches. */
const pointsOf = (d) => [...d.matchAll(/[ML] (-?[\d.]+) (-?[\d.]+)/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));

/** Emit an IR, let the viewer draw it, and read each edge's line, its arrowhead and the outline of node `t` from the picture. */
function render(name, ir) {
  const file = join(dir, `${name}.ir.json`);
  writeFileSync(file, JSON.stringify(ir));
  expect(cli('emit', '--to', 'drawio', file, '--out', join(dir, `${name}.drawio`)).status).toBe(0);
  const r = cli('export', join(dir, `${name}.drawio`), '--out', `${dir}/`);
  expect(r.status, r.stderr).toBe(0);
  const svg = readFileSync(join(dir, `${name}.drawio.svg`), 'utf8').replace(/content="[^"]*"/, '');
  const cells = new Map([...svg.matchAll(/<g data-cell-id="([^"]+)">([\s\S]*?)(?=<g data-cell-id=|$)/g)].map((m) => [m[1].replace(`${name}:`, ''), m[2]]));
  const target = cells.get('t');
  const closed = /<path d="([^"]+Z)"/.exec(target)?.[1];
  const box = /<rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.]+)" height="([\d.]+)"/.exec(target)?.slice(1).map(Number);
  const outline = closed ? pointsOf(closed) : [{ x: box[0], y: box[1] }, { x: box[0] + box[2], y: box[1] }, { x: box[0] + box[2], y: box[1] + box[3] }, { x: box[0], y: box[1] + box[3] }];
  const edges = new Map();
  for (const [id, body] of cells) {
    const paths = [...body.matchAll(/<path d="([^"]+)" fill="(none|#[0-9a-fA-F]+)"/g)];
    const line = paths.find((p) => p[2] === 'none');
    const head = paths.find((p) => p[2] !== 'none' && p[1].endsWith('Z'));
    if (/^e\d+$/.test(id) && line && head) edges.set(id, { line: pointsOf(line[1]), head: head[1], tip: pointsOf(head[1])[0] });
  }
  return { outline, edges, dots: [...cells.keys()].filter((id) => id.includes(':junction:')).length };
}

/** Every arrow runs level into its end and its tip is on the outline; draw.io stops the tip about 1.1 px short. */
function expectCleanEnds(r, k, vertical = false) {
  expect(r.edges.size).toBe(k);
  for (const [id, e] of r.edges) {
    const [a, b] = e.line.slice(-2);
    expect(Math.abs(vertical ? b.x - a.x : b.y - a.y), `${id} last stretch`).toBeLessThan(0.5);
    expect(distanceTo(r.outline, e.tip), `${id} tip`).toBeLessThan(1.5);
  }
}
const tipGaps = (r, vertical = false) => { const at = [...new Set([...r.edges.values()].map((e) => Math.round((vertical ? e.tip.x : e.tip.y) * 10) / 10))].sort((p, q) => p - q); return at.slice(1).map((v, i) => v - at[i]); };

describe.skipIf(!hasPlaywright)('fan-in as the draw.io viewer draws it', () => {
  it('three arrows into a parallelogram: none bends before its end, each tip on the slanted edge', () => {
    const r = render('io3', fanIn(3, { shape: 'io' }));
    expectCleanEnds(r, 3);
    expect(tipGaps(r)).toEqual([10, 10]);
  }, 60_000);

  it('three connections into a hexagon end the same way', () => {
    expectCleanEnds(render('queue3', queueFanIn(3)), 3);
  }, 60_000);

  it('four arrows into a parallelogram and into a rectangle keep 10 px between their tips', () => {
    for (const shape of ['io', 'process']) {
      const r = render(`gap-${shape}`, fanIn(4, { shape }));
      expectCleanEnds(r, 4);
      expect(tipGaps(r)).toEqual([10, 10, 10]);
    }
  }, 60_000);

  it('nine arrows from above into a parallelogram draw one arrowhead and one dot', () => {
    const r = render('merged', fanIn(9, { shape: 'io', direction: 'TB' }));
    expectCleanEnds(r, 9, true);
    expect(new Set([...r.edges.values()].map((e) => e.head)).size).toBe(1);
    expect(r.dots).toBe(1);
  }, 60_000);

  it('seven arrows, two with a label: one arrowhead for the five, the two beside it 10 px apart', () => {
    const r = render('mixed', fanIn(7, { shape: 'io', labelled: [2, 6] }));
    expectCleanEnds(r, 7);
    expect(new Set([...r.edges.values()].map((e) => e.head)).size).toBe(3);
    expect(tipGaps(r)).toEqual([10, 10]);
    expect(r.dots).toBe(1);
  }, 60_000);
});
