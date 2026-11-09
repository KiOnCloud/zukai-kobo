import { describe, it, expect } from 'vitest';
import { emit } from '../src/pipeline.mjs';
import { emitDrawio, slugify } from '../src/emit-drawio.mjs';
import { xmlAttr, htmlLabel, vertex } from '../src/drawio-xml.mjs';
import { measureNode, measureDecision, wrapText, wrappedLines } from '../src/layout-graph.mjs';
import { checkDrawioStructure, cellBounds } from './drawio-structure.mjs';
import { loadFixture, validFixtures, scriptsDir } from './helpers.mjs';
import { loadPlaywright } from '../src/preview.mjs';

const pw = loadPlaywright(scriptsDir);

describe('drawio-xml', () => {
  it('escapes attribute values and HTML labels', () => {
    expect(xmlAttr('a<b>&"c"\nd')).toBe('a&lt;b&gt;&amp;&quot;c&quot;&#10;d');
    expect(htmlLabel('<script>alert("x")</script>\nnext')).toBe('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;<br>next');
    const lines = vertex({ id: 'a', value: htmlLabel('<b>'), style: 'x;', x: 1.004, y: 2, width: 3, height: 4 });
    expect(lines[0]).toContain('value="&amp;lt;b&amp;gt;"');
    expect(lines[1]).toContain('x="1" y="2" width="3" height="4"');
  });

  it('builds a slug for the diagram id', () => {
    expect(slugify('Order checkout: v2 (draft)')).toBe('order-checkout-v2-draft');
    expect(slugify('注文')).toBe('diagram');
  });

  it('issue 32: grows the height by one line per wrapped line at the width cap', () => {
    // 33 characters are 231 px, which fits one 236 px text line at the 260 px cap.
    const heights = [1, 2, 3, 4, 5].map((n) => measureNode('x'.repeat(33 * n)).height);
    for (let i = 1; i < heights.length; i++) expect(heights[i] - heights[i - 1]).toBe(20);
    expect(heights[0]).toBe(40);
    expect(wrappedLines('a\nb', 260)).toBe(2);
    expect(measureNode('short').height).toBe(40);
  });

  describe('issue 39: a decision label stays inside the rhombus', () => {
    // A text block a x b fits a w x h rhombus when a/w + b/h <= 1; a line is 15 px.
    const fits = (label, { width, height, spacing }) => {
      const { lines, widest } = wrapText(label, width - 4 - 2 * spacing);
      return widest / width + (lines * 15) / height <= 1 + 1e-9;
    };

    it('wraps words like a browser: at spaces, between CJK characters, never inside a word', () => {
      expect(wrapText('Type is PDF or PNG and size is under the configured limit?', 160)).toEqual({ lines: 3, widest: 154 });
      expect(wrapText('a\nb', 300)).toEqual({ lines: 2, widest: 7 });
      expect(wrapText('Supercalifragilistic?', 50)).toEqual({ lines: 1, widest: 147 });
      expect(wrapText('在庫はありますか？', 60).lines).toBe(3);
    });

    it('keeps the plain size for a short question and grows only as far as the inscribed rectangle needs', () => {
      expect(measureDecision('File found?')).toEqual({ width: 140, height: 80, spacing: 0 });
      expect(measureDecision('Sync or async?')).toEqual({ width: 140, height: 80, spacing: 0 });
      // 20 characters are 140 px: too wide for the 114 px the 140 x 80 rhombus has at the line's height.
      const wide = measureDecision('Amount over 500 EUR?');
      expect(wide.height).toBe(80);
      expect(wide.width).toBeGreaterThan(140);
      expect(wide.width).toBeLessThanOrEqual(180);
      expect(fits('Amount over 500 EUR?', wide)).toBe(true);
    });

    it('wraps a long question narrower, with spacing so draw.io wraps inside the diamond, and the block fits', () => {
      const label = 'Type is PDF or PNG and size is under the configured limit?';
      const d = measureDecision(label);
      expect(d.width).toBeLessThanOrEqual(340);
      expect(d.spacing).toBeGreaterThan(0);
      expect(fits(label, d)).toBe(true);
      // The plain box would have wrapped it at 256 px into two lines of up to 252 px, far past the slanted edges.
      expect(fits(label, { ...measureNode(label, { minWidth: 140, baseHeight: 80 }), spacing: 0 })).toBe(false);
      for (const q of ['Is the configured retention period of the tenant exceeded for this document?', 'Supercalifragilisticexpialidocious?', '在庫はありますか？それとも入荷待ちですか？']) {
        const m = measureDecision(q);
        expect(fits(q, m), q).toBe(true);
        expect(m.width, q).toBeLessThanOrEqual(420);
      }
      // An unbreakable word cannot wrap, so the diamond grows around it rather than letting it spill.
      expect(fits('x'.repeat(100), measureDecision('x'.repeat(100)))).toBe(true);
    });

    it('emits the rhombus with the spacing in its style, in activity and flowchart diagrams alike', async () => {
      const r = await emit(loadFixture('activity', 'valid-long-decision'), 'drawio');
      expect(r.ok).toBe(true);
      expect(r.warnings).toEqual([]);
      const ok = checkDrawioStructure(r.output).cells.find((c) => c.id === 'upload-check:ok');
      expect(ok.style).toMatch(/^rhombus;whiteSpace=wrap;html=1;spacingLeft=(\d+);spacingRight=\1;$/);
      const { width, height } = cellBounds(ok);
      const spacing = Number(ok.style.match(/spacingLeft=(\d+)/)[1]);
      expect({ width, height, spacing }).toEqual(measureDecision('Type is PDF or PNG and size is under the configured limit?'));
      const fc = loadFixture('flowchart', 'valid');
      const long = { ...fc, nodes: fc.nodes.map((n) => (n.shape === 'decision' ? { ...n, label: 'Is the configured retention period of the tenant exceeded for this document?' } : n)) };
      const f = await emit(long, 'drawio');
      expect(f.ok).toBe(true);
      const cell = checkDrawioStructure(f.output).cells.find((c) => (c.style ?? '').startsWith('rhombus') && c.style.includes('spacingLeft='));
      expect(cell).toBeDefined();
      expect(cellBounds(cell).width).toBe(measureDecision('Is the configured retention period of the tenant exceeded for this document?').width);
    });
  });

  describe('issue 40: a wrapped question takes balanced lines, so draw.io does not strand its last token', () => {
    // draw.io wraps the label at width - 4 - 2 * spacing. The width heuristic is generous, so a
    // line the model fills nearly to that width leaves draw.io room for one more token: it then
    // breaks at the last chance it finds, a hyphen inside "0-5", and "5?" stands alone.
    const wrapWidth = ({ width, spacing }) => width - 4 - 2 * spacing;

    it('wraps the question of the report into two lines of about half the text each', () => {
      const label = 'Conditions present and office type 0-5?';
      const d = measureDecision(label);
      expect(d).toEqual({ width: 224, height: 80, spacing: 40 });
      const block = wrapText(label, wrapWidth(d));
      expect(block).toEqual({ lines: 2, widest: 140 });
      // No narrower wrap keeps two lines, so neither line is a nearly full one with a remainder after it.
      expect(wrapText(label, block.widest - 1).lines).toBe(3);
    });

    it('wraps every multi-line question at the narrowest width that keeps its line count', () => {
      for (const q of ['Conditions present and priority level 0-5?', 'Type is PDF or PNG and size is under the configured limit?', 'Is the configured retention period of the tenant exceeded for this document?', '在庫はありますか？それとも入荷待ちですか？']) {
        const d = measureDecision(q);
        const block = wrapText(q, wrapWidth(d));
        expect(block.lines, q).toBeGreaterThan(1);
        // Any wrap narrower than the widest line takes more lines: the lines are as balanced as the line count allows.
        expect(wrapText(q, Math.ceil(block.widest) - 1).lines, q).toBeGreaterThan(block.lines);
        expect(block.widest / d.width + (block.lines * 15) / d.height, q).toBeLessThanOrEqual(1 + 1e-9);
      }
    });

    it('emits the activity fixture of the report with that rhombus', async () => {
      const r = await emit(loadFixture('activity', 'valid-decision-range'), 'drawio');
      expect(r.ok).toBe(true);
      expect(r.warnings).toEqual([]);
      const d = checkDrawioStructure(r.output).cells.find((c) => c.id === 'ticket-triage:d');
      expect(d.style).toBe('rhombus;whiteSpace=wrap;html=1;spacingLeft=40;spacingRight=40;');
      expect(cellBounds(d)).toMatchObject({ width: 224, height: 80 });
    });

    it.skipIf(!pw)('renders in Chromium as two lines at the emitted wrap width, with the value range on one line', async () => {
      const labels = ['Conditions present and office type 0-5?', 'Conditions present and priority level 0-5?'];
      const browser = await pw.chromium.launch();
      try {
        const page = await browser.newPage();
        const widths = labels.map((l) => wrapWidth(measureDecision(l)));
        await page.setContent(`<body style="font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.2">${labels.map((l, i) => `<div id="d${i}" style="width:${widths[i]}px;white-space:normal">${l}</div>`).join('')}</body>`);
        const rendered = await page.evaluate((count) => Array.from({ length: count }, (_, i) => {
          const text = document.getElementById(`d${i}`).firstChild;
          const range = document.createRange();
          const lines = [];
          let start = 0;
          let top;
          for (let end = 1; end <= text.length; end++) {
            range.setStart(text, 0);
            range.setEnd(text, end);
            const rects = range.getClientRects();
            const last = rects[rects.length - 1];
            if (top !== undefined && last.top > top + 1) { lines.push(text.data.slice(start, end - 1).trim()); start = end - 1; }
            top = last.top;
          }
          lines.push(text.data.slice(start).trim());
          return lines;
        }), labels.length);
        for (const lines of rendered) {
          expect(lines).toHaveLength(2);
          expect(lines[1]).toMatch(/0-5\?$/);
          expect(lines[0].endsWith('-')).toBe(false);
        }
      } finally {
        await browser.close();
      }
    });
  });

  it('measures nodes with the clamp rule', () => {
    expect(measureNode('ab')).toEqual({ width: 120, height: 40 });
    // 100 characters wrap to three lines at the 260 px cap, so the box grows by two line heights.
    expect(measureNode('x'.repeat(100))).toEqual({ width: 260, height: 80 });
    expect(measureNode('one\ntwo\nthree', { extraRows: 2 })).toEqual({ width: 120, height: 116 });
  });
});

describe('emitDrawio', () => {
  for (const { kind, name, ir } of validFixtures()) {
    it(`emits a structurally valid, deterministic file for ${kind}/${name}`, async () => {
      const r = await emit(ir, 'drawio');
      expect(r.errors).toEqual([]);
      expect(r.ok).toBe(true);
      expect(r.output).not.toMatch(/\r/);
      expect(r.output.endsWith('\n')).toBe(true);
      const { problems, cells } = checkDrawioStructure(r.output);
      expect(problems).toEqual([]);

      // Every IR element with an id is an individually selectable cell.
      const collections = ['nodes', 'edges', 'groups', 'participants', 'messages', 'blocks', 'notes', 'states', 'transitions', 'entities', 'relations', 'classes', 'components', 'boundaries', 'connections', 'lanes', 'actions', 'controls', 'flows'];
      const slug = slugify(ir.title);
      const ids = new Set(cells.map((c) => c.id));
      for (const col of collections) for (const el of ir[col] ?? []) expect(ids.has(`${slug}:${el.id}`), `${col} ${el.id}`).toBe(true);

      // Geometry invariants: no negative coordinates, children inside their container.
      const byId = new Map(cells.map((c) => [c.id, c]));
      for (const c of cells) {
        if (c.vertex !== '1' || c.mxGeometry.relative === '1') continue;
        const b = cellBounds(c);
        expect(b.x, `${c.id} x`).toBeGreaterThanOrEqual(0);
        expect(b.y, `${c.id} y`).toBeGreaterThanOrEqual(0);
        const parent = byId.get(c.parent);
        if (parent && parent.vertex === '1') {
          const p = cellBounds(parent);
          expect(b.x + b.width, `${c.id} inside ${parent.id} (right)`).toBeLessThanOrEqual(p.width + 0.01);
          expect(b.y + b.height, `${c.id} inside ${parent.id} (bottom)`).toBeLessThanOrEqual(p.height + 0.01);
        }
      }
      const again = await emitDrawio(ir);
      expect(again.output).toBe(r.output);
      await expect(r.output).toMatchFileSnapshot(`snapshots/drawio/${kind}-${name}.drawio`);
    }, 20_000);
  }

  it('escapes adversarial labels so no raw markup reaches an attribute', async () => {
    const r = await emit(loadFixture('adversarial', 'labels'), 'drawio');
    expect(r.ok).toBe(true);
    for (const m of r.output.matchAll(/value="([^"]*)"/g)) {
      expect(m[1]).not.toMatch(/[<>]/);
    }
    expect(r.output).toContain('&amp;lt;script&amp;gt;');
    expect(checkDrawioStructure(r.output).problems).toEqual([]);
  });

  it('attaches edge labels as child cells of the edge', async () => {
    const r = await emit(loadFixture('flowchart', 'valid'), 'drawio');
    const { cells } = checkDrawioStructure(r.output);
    const label = cells.find((c) => c.id === 'order-checkout:e3:label');
    expect(label.parent).toBe('order-checkout:e3');
    expect(label.connectable).toBe('0');
    expect(label.value).toBe('yes');
  });

  it('lays out a 50-node flowchart in under two seconds', async () => {
    const t0 = performance.now();
    const r = await emit(loadFixture('flowchart', 'large-50-nodes'), 'drawio');
    expect(r.ok).toBe(true);
    expect(performance.now() - t0).toBeLessThan(2000);
  });

  it('places sequence frames behind lifelines and messages at increasing rows', async () => {
    const r = await emit(loadFixture('sequence', 'valid'), 'drawio');
    const { cells } = checkDrawioStructure(r.output);
    const order = cells.map((c) => c.id);
    expect(order.indexOf('login-with-password:b2')).toBeLessThan(order.indexOf('login-with-password:user'));
    const ys = ['m1', 'm2', 'm3'].map((id) => Number(cells.find((c) => c.id === `login-with-password:${id}`).mxGeometry.Array.mxPoint[0].y));
    expect(ys[0]).toBeLessThan(ys[1]);
    expect(ys[1]).toBeLessThan(ys[2]);
    const activation = cells.find((c) => c.id === 'login-with-password:act-m2');
    expect(activation.parent).toBe('login-with-password:auth');
  });
});
