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
import { textWidth } from '../src/text-metrics.mjs';
import { distanceTo, fanIn, queueFanIn, throughCircles } from './fan-in-shapes.mjs';

const cliPath = join(scriptsDir, 'bin', 'cli.mjs');
const dir = mkdtempSync(join(tmpdir(), 'zukai-fan-in-render-'));
const cli = (...args) => spawnSync(process.execPath, [cliPath, ...args], { cwd: dir, encoding: 'utf8' });
const hasPlaywright = loadPlaywright() !== null;

/** The points of an SVG path of straight stretches. */
const pointsOf = (d) => [...d.matchAll(/[ML] (-?[\d.]+) (-?[\d.]+)/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));

/** Emit an IR and let the viewer draw it: what the picture holds for each cell, by the id the IR gave it. */
function draw(name, ir) {
  const file = join(dir, `${name}.ir.json`);
  writeFileSync(file, JSON.stringify(ir));
  expect(cli('emit', '--to', 'drawio', file, '--out', join(dir, `${name}.drawio`)).status).toBe(0);
  const r = cli('export', join(dir, `${name}.drawio`), '--out', `${dir}/`);
  expect(r.status, r.stderr).toBe(0);
  const svg = readFileSync(join(dir, `${name}.drawio.svg`), 'utf8').replace(/content="[^"]*"/, '');
  return new Map([...svg.matchAll(/<g data-cell-id="([^"]+)">([\s\S]*?)(?=<g data-cell-id=|$)/g)].map((m) => [m[1].replace(`${name}:`, ''), m[2]]));
}

/** The line of an edge as drawn and the tip of its arrowhead: the first corner of a filled head, the middle one of an open head. */
function arrowOf(body) {
  const paths = [...body.matchAll(/<path d="([^"]+)" fill="(none|#[0-9a-fA-F]+)"/g)];
  const [line, open] = paths.filter((p) => p[2] === 'none');
  const filled = paths.find((p) => p[2] !== 'none' && p[1].endsWith('Z'));
  return { line: pointsOf(line[1]), tip: filled ? pointsOf(filled[1])[0] : open ? pointsOf(open[1])[1] : undefined };
}

/** Emit an IR, let the viewer draw it, and read each edge's line, its arrowhead and the outline of node `t` from the picture. */
function render(name, ir) {
  const cells = draw(name, ir);
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

describe.skipIf(!hasPlaywright)('titles and line ends as the draw.io viewer draws them', () => {
  it('three transitions into a composite state: its title stands 12 px or more from each line', () => {
    const cells = draw('composite3', {
      schemaVersion: 1, kind: 'state', title: 'Review',
      states: [...[1, 2, 3].map((i) => ({ id: `a${i}`, label: `Stage ${i}` })), { id: 'comp', label: 'Under review', kind: 'composite', children: ['c1', 'c2', 'c3'] }, ...[1, 2, 3].map((i) => ({ id: `c${i}`, label: `Check ${i}` }))],
      transitions: [1, 2, 3].map((i) => ({ id: `e${i}`, from: `a${i}`, to: `c${i}` })),
    });
    const frame = cells.get('comp');
    // The header of the composite: its first path runs round the 30 px strip at the top.
    const top = Math.min(...[...frame.matchAll(/[MLQ] (?:-?[\d.]+ -?[\d.]+ )?-?[\d.]+ (-?[\d.]+)/g)].map((m) => Number(m[1])));
    const title = /<text x="([\d.]+)" y="[\d.]+"(?: text-anchor="(\w+)")?[^>]*>Under review<\/text>/.exec(frame);
    const width = textWidth('Under review', { bold: true });
    const left = Number(title[1]) - (title[2] === 'middle' ? width / 2 : 0);
    let crossing = 0;
    for (const id of ['e1', 'e2', 'e3']) {
      const { line } = arrowOf(cells.get(id));
      for (let i = 1; i < line.length; i++) {
        if (Math.max(line[i - 1].y, line[i].y) <= top + 0.5 || Math.min(line[i - 1].y, line[i].y) >= top + 30) continue;
        crossing++;
        const [lo, hi] = [Math.min(line[i - 1].x, line[i].x), Math.max(line[i - 1].x, line[i].x)];
        expect(hi < left ? left - hi : lo - (left + width), `${id} beside the title`).toBeGreaterThanOrEqual(12);
      }
    }
    expect(crossing).toBeGreaterThanOrEqual(3);
  }, 60_000);

  it('four relations into a class with a relation to itself: every arrowhead on the top of the table', () => {
    const cells = draw('class4', {
      schemaVersion: 1, kind: 'class', title: 'Invoice parts', direction: 'TB',
      classes: [{ id: 'hub', label: 'Invoice', attributes: [{ name: 'number', type: 'string' }] }, ...[1, 2, 3, 4].map((i) => ({ id: `c${i}`, label: `Part${i}` }))],
      relations: [{ id: 'self', from: 'hub', to: 'hub', kind: 'association', label: 'credits' }, ...[1, 2, 3, 4].map((i) => ({ id: `e${i}`, from: `c${i}`, to: 'hub', kind: 'association' }))],
    });
    const corners = [...cells.get('hub').matchAll(/<path d="([^"]+)"/g)].flatMap((m) => pointsOf(m[1]));
    const table = { left: Math.min(...corners.map((p) => p.x)), right: Math.max(...corners.map((p) => p.x)), top: Math.min(...corners.map((p) => p.y)) };
    for (const id of ['e1', 'e2', 'e3', 'e4']) {
      const { line, tip } = arrowOf(cells.get(id));
      const [a, b] = line.slice(-2);
      expect(Math.abs(b.x - a.x), `${id} runs down into its end`).toBeLessThan(0.5);
      expect(Math.abs(tip.y - table.top), `${id} tip on the top side`).toBeLessThan(1.5);
      expect(tip.x, id).toBeGreaterThan(table.left + 1);
      expect(tip.x, id).toBeLessThan(table.right - 1);
    }
  }, 60_000);

  it('three lines out of an initial state and into a final one: none runs across the flow at the circle', () => {
    const cells = draw('circles3', throughCircles(3, 'TB'));
    const centre = (id) => { const m = /<ellipse cx="([\d.]+)" cy="([\d.]+)"/.exec(cells.get(id)); return { x: Number(m[1]), y: Number(m[2]) }; };
    for (const i of [1, 2, 3]) {
      const out = arrowOf(cells.get(`o${i}`)).line;
      expect(Math.abs(out[1].x - out[0].x), `o${i} leaves the circle straight down`).toBeLessThan(0.5);
      expect(Math.hypot(out[0].x - centre('s0').x, out[0].y - centre('s0').y), `o${i} starts on the circle`).toBeCloseTo(15, 0);
      const into = arrowOf(cells.get(`i${i}`));
      const [a, b] = into.line.slice(-2);
      expect(Math.abs(b.x - a.x), `i${i} arrives straight down`).toBeLessThan(0.5);
      // draw.io stops the tip about 1.1 px short of the outline.
      expect(Math.abs(Math.hypot(into.tip.x - centre('end').x, into.tip.y - centre('end').y) - 15), `i${i} tip on the circle`).toBeLessThan(1.5);
    }
  }, 60_000);
});
