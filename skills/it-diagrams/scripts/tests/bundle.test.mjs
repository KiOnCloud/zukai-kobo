import { describe, it, expect } from 'vitest';
import { textWidth, roomFor } from '../src/text-metrics.mjs';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bundle, emit } from '../src/pipeline.mjs';
import { checkDrawioStructure, cellBounds } from './drawio-structure.mjs';
import { loadFixture, scriptsDir, fixturesDir } from './helpers.mjs';

const entries = () => [
  { id: 'order-checkout', ir: loadFixture('flowchart', 'valid') },
  { id: 'login', ir: loadFixture('sequence', 'valid') },
  { id: 'returns', ir: loadFixture('activity', 'valid-two-lanes') },
];

describe('bundle', () => {
  it('writes a multi-page draw.io file with one named, titled page per diagram', async () => {
    const r = await bundle(entries(), 'drawio', { title: 'Checkout feature' });
    expect(r.ok).toBe(true);
    expect(r.output).toContain('pages="3"');
    const { problems, cells } = checkDrawioStructure(r.output);
    expect(problems).toEqual([]);
    expect([...r.output.matchAll(/<diagram id="([^"]+)" name="([^"]+)">/g)].map((m) => [m[1], m[2]])).toEqual([
      ['order-checkout', 'Order checkout'],
      ['login', 'Login with password'],
      ['returns', 'Return request'],
    ]);
    expect(cells.filter((c) => c.id.endsWith(':title')).map((c) => c.value)).toEqual(['<b>Order checkout</b>', '<b>Login with password</b>', '<b>Return request</b>']);
    expect(r.warnings.every((w) => typeof w.diagram === 'string')).toBe(true);
  });

  it('writes a Markdown file with one heading and mermaid block per diagram', async () => {
    const r = await bundle(entries(), 'mermaid', { title: 'Checkout feature' });
    expect(r.ok).toBe(true);
    expect(r.output.startsWith('# Checkout feature\n')).toBe(true);
    expect(r.output.match(/^## /gm)).toHaveLength(3);
    expect(r.output.match(/^```mermaid$/gm)).toHaveLength(3);
    expect(r.output).toContain('Source: `source/login.ir.json`');
    expect(r.output).toContain('sequenceDiagram');
    expect(r.output).toContain('swimlane-beta');
  });

  it('lists deliberate omissions under a diagram in the Markdown bundle', async () => {
    const ir = { ...loadFixture('flowchart', 'valid'), meta: { source: 'clarify', audience: 'business', omitted: ['No retry branch: the reader only needs the outcome', 'Input validation: technical'] } };
    const r = await bundle([{ id: 'order-checkout', ir }], 'mermaid', { title: 'Checkout' });
    expect(r.ok).toBe(true);
    expect(r.output).toContain('Not shown on purpose:\n\n- No retry branch: the reader only needs the outcome\n- Input validation: technical\n');
    const plain = await bundle([{ id: 'order-checkout', ir: loadFixture('flowchart', 'valid') }], 'mermaid');
    expect(plain.output).not.toContain('Not shown on purpose');
  });

  it('refuses the whole bundle when one diagram is invalid, naming it', async () => {
    const r = await bundle([...entries(), { id: 'broken', ir: loadFixture('er', 'invalid-unknown-entity') }], 'drawio');
    expect(r.ok).toBe(false);
    expect(r.errors.every((e) => e.diagram === 'broken' && e.index === 3)).toBe(true);
  });

  describe('issue 2: ref shows the target title and links to its page', () => {
    const withTarget = () => [
      { id: 'returns', ir: loadFixture('activity', 'valid-two-lanes') },
      { id: 'return-request-label', ir: { ...loadFixture('flowchart', 'valid'), title: 'Return label' } },
    ];

    it('resolves a ref inside a draw.io bundle to the title plus a page link', async () => {
      const r = await bundle(withTarget(), 'drawio', { title: 'Returns' });
      expect(r.ok).toBe(true);
      const { problems, cells } = checkDrawioStructure(r.output);
      expect(problems).toEqual([]);
      const approve = cells.find((c) => c.id === 'returns:approve');
      expect(approve.value).toBe('Approve and send label<br>↳ Return label');
      expect(approve.link).toBe('data:page/id,return-request-label');
      expect(approve.vertex).toBe('1');
      expect(r.output).not.toContain('↳ return-request-label');
      expect(r.warnings.filter((w) => w.diagram === 'returns' && w.path.endsWith('/ref'))).toEqual([]);
      // The box is measured from the final text, so the title line fits.
      expect(Number(approve.mxGeometry.width)).toBeGreaterThanOrEqual(roomFor(textWidth('Approve and send label')) + 24);
    });

    it('keeps the slug, adds no link and warns when the target is not bundled', async () => {
      const r = await bundle(withTarget().slice(0, 1), 'drawio');
      expect(r.ok).toBe(true);
      expect(r.output).toContain('↳ return-request-label');
      expect(r.output).not.toContain('<UserObject');
      const w = r.warnings.filter((x) => x.path.endsWith('/ref'));
      expect(w).toHaveLength(1);
      expect(w[0]).toMatchObject({ diagram: 'returns', path: '/actions/2/ref' });
      expect(w[0].message).toContain('not in this bundle');
    });

    it('shows the slug without a warning for a single emit', async () => {
      const r = await emit(loadFixture('activity', 'valid-two-lanes'), 'drawio', { diagramId: 'returns' });
      expect(r.ok).toBe(true);
      expect(r.output).toContain('↳ return-request-label');
      expect(r.warnings.filter((x) => x.path.endsWith('/ref'))).toEqual([]);
    });

    it('shows the title in the Markdown bundle too', async () => {
      const r = await bundle(withTarget(), 'mermaid', { title: 'Returns' });
      expect(r.ok).toBe(true);
      expect(r.output).toContain('↳ Return label');
      expect(r.output).not.toContain('↳ return-request-label');
      const alone = await bundle(withTarget().slice(0, 1), 'mermaid');
      expect(alone.output).toContain('↳ return-request-label');
      expect(alone.warnings.some((w) => w.path === '/actions/2/ref')).toBe(true);
    });
  });

  describe('issue 3: canvas page with several diagrams side by side', () => {
    const pageXml = (output, diagramId) => {
      const m = output.match(new RegExp(`<diagram id="${diagramId}"[\\s\\S]*?</diagram>`));
      return `<mxfile compressed="false">${m[0]}</mxfile>`;
    };
    const rootBoxes = (cells, prefix) => cells.filter((c) => c.parent === '1' && c.vertex === '1' && c.id.startsWith(`${prefix}:`) && !c.id.endsWith(':title')).map(cellBounds);
    const rootPoints = (xml, prefix) => [...xml.matchAll(new RegExp(`<mxCell id="${prefix}:[^"]*"[^>]*edge="1"[^>]*parent="1"[\\s\\S]*?</mxCell>`, 'g'))]
      .flatMap((m) => [...m[0].matchAll(/<mxPoint x="(-?[\d.]+)" y="(-?[\d.]+)"/g)].map((p) => ({ x: Number(p[1]), y: Number(p[2]) })));

    it('adds a first page holding every diagram, top-aligned, left to right with the gap', async () => {
      const r = await bundle(entries(), 'drawio', { title: 'Checkout feature', canvas: 'all', gap: 100 });
      expect(r.ok).toBe(true);
      expect(r.canvas).toEqual(['order-checkout', 'login', 'returns']);
      expect(r.output).toContain('pages="4"');
      expect(r.output).toMatch(/<diagram id="canvas" name="Checkout feature">/);
      expect(checkDrawioStructure(r.output).problems).toEqual([]);
      const { cells } = checkDrawioStructure(pageXml(r.output, 'canvas'));
      expect(cells.filter((c) => c.id.endsWith(':title')).map((c) => c.value)).toEqual(['<b>Order checkout</b>', '<b>Login with password</b>', '<b>Return request</b>']);
      const spans = ['order-checkout', 'login', 'returns'].map((p) => {
        const boxes = rootBoxes(cells, p);
        const xs = boxes.flatMap((b) => [b.x, b.x + b.width]);
        const ys = boxes.map((b) => b.y);
        return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys) };
      });
      for (const s of spans) expect(s.minY).toBeGreaterThanOrEqual(50);
      expect(spans.map((s) => s.minY)).toEqual([spans[0].minY, spans[0].minY, spans[0].minY]);
      expect(spans[1].minX - spans[0].maxX).toBeGreaterThanOrEqual(100);
      expect(spans[2].minX - spans[1].maxX).toBeGreaterThanOrEqual(100);
    });

    it('moves edges and lane children with their diagram', async () => {
      const r = await bundle(entries(), 'drawio', { canvas: ['login', 'returns'] });
      const canvasXml = pageXml(r.output, 'canvas');
      const canvas = checkDrawioStructure(canvasXml).cells;
      expect(canvas.some((c) => c.id.startsWith('order-checkout:'))).toBe(false);
      for (const prefix of ['login', 'returns']) {
        const ownXml = pageXml(r.output, prefix);
        const own = checkDrawioStructure(ownXml).cells;
        const a = rootBoxes(own, prefix);
        const b = rootBoxes(canvas, prefix);
        expect(b).toHaveLength(a.length);
        const dx = b[0].x - a[0].x;
        const dy = b[0].y - a[0].y;
        a.forEach((box, i) => expect([b[i].x - box.x, b[i].y - box.y]).toEqual([dx, dy]));
        const pa = rootPoints(ownXml, prefix);
        const pb = rootPoints(canvasXml, prefix);
        expect(pb).toHaveLength(pa.length);
        pa.forEach((p, i) => expect([pb[i].x - p.x, pb[i].y - p.y]).toEqual([dx, dy]));
        // Lane children are relative to the lane and keep their coordinates.
        const childOf = (cells) => cells.filter((c) => c.parent !== '1' && c.vertex === '1' && c.id.startsWith(`${prefix}:`)).map(cellBounds);
        expect(childOf(canvas)).toEqual(childOf(own));
      }
    });

    it('is deterministic', async () => {
      const a = await bundle(entries(), 'drawio', { canvas: 'all' });
      const b = await bundle(entries(), 'drawio', { canvas: 'all' });
      expect(a.output).toBe(b.output);
    });

    it('keeps every page title above its content', async () => {
      const r = await bundle(entries(), 'drawio');
      for (const prefix of ['order-checkout', 'login', 'returns']) {
        const cells = checkDrawioStructure(pageXml(r.output, prefix)).cells;
        for (const box of rootBoxes(cells, prefix)) expect(box.y).toBeGreaterThanOrEqual(50);
      }
    });

    it('refuses unknown ids and the mermaid target', async () => {
      const unknown = await bundle(entries(), 'drawio', { canvas: ['login', 'nope'] });
      expect(unknown.ok).toBe(false);
      expect(unknown.errors[0].message).toContain('nope');
      const md = await bundle(entries(), 'mermaid', { canvas: 'all' });
      expect(md.ok).toBe(false);
      expect(md.errors[0].message).toContain('drawio only');
    });

    it('works through the CLI', () => {
      const dir = mkdtempSync(join(tmpdir(), 'it-diagrams-canvas-'));
      const out = join(dir, 'checkout.drawio');
      const r = spawnSync(process.execPath, [join(scriptsDir, 'bin', 'cli.mjs'), 'bundle', '--to', 'drawio', '--out', out, '--title', 'Checkout', '--canvas', 'all', '--gap', '80', join(fixturesDir, 'sequence', 'valid.json'), join(fixturesDir, 'state', 'valid.json')], { cwd: dir, encoding: 'utf8' });
      expect(r.status).toBe(0);
      expect(JSON.parse(r.stdout)).toEqual({ ok: true, out, diagrams: 2, warnings: 0, canvas: ['valid', 'valid-2'] });
      expect(readFileSync(out, 'utf8')).toContain('<diagram id="canvas" name="Checkout">');
      const bad = spawnSync(process.execPath, [join(scriptsDir, 'bin', 'cli.mjs'), 'bundle', '--to', 'drawio', '--out', out, '--gap', '80', join(fixturesDir, 'state', 'valid.json')], { cwd: dir, encoding: 'utf8' });
      expect(bad.status).toBe(1);
    });
  });

  it('rejects figjam as a bundle target', async () => {
    const r = await bundle(entries(), 'figjam');
    expect(r.ok).toBe(false);
    expect(r.errors[0].message).toContain('drawio and mermaid');
  });

  it('works through the CLI from another working directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'it-diagrams-bundle-'));
    const out = join(dir, '20261105_checkout', 'checkout.drawio');
    const r = spawnSync(process.execPath, [join(scriptsDir, 'bin', 'cli.mjs'), 'bundle', '--to', 'drawio', '--out', out, '--title', 'Checkout', join(fixturesDir, 'flowchart', 'valid.json'), join(fixturesDir, 'state', 'valid.json')], { cwd: dir, encoding: 'utf8' });
    expect(r.status).toBe(0);
    // The flowchart fixture refs a diagram that is not bundled, which is one warning.
    expect(JSON.parse(r.stdout)).toEqual({ ok: true, out, diagrams: 2, warnings: 1 });
    expect(existsSync(out)).toBe(true);
    expect(readFileSync(out, 'utf8')).toContain('<diagram id="valid-2"');
  });
});
