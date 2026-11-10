import { describe, it, expect } from 'vitest';
import { emit } from '../src/pipeline.mjs';
import { emitDrawio, slugify } from '../src/emit-drawio.mjs';
import { xmlAttr, htmlLabel, vertex } from '../src/drawio-xml.mjs';
import { measureNode, measureDecision, wrapText, wrappedLines, LABEL_PAD } from '../src/layout-graph.mjs';
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
    // "nnnn" is 26.7 px and a space 3.3 px: seven words are 207 px and fit one 236 px text
    // line at the 260 px cap, an eighth (237 px) does not.
    const words = (n) => Array(n).fill('nnnn').join(' ');
    const heights = [1, 2, 3, 4, 5].map((n) => measureNode(words(7 * n)).height);
    for (let i = 1; i < heights.length; i++) expect(heights[i] - heights[i - 1]).toBe(20);
    expect(heights[0]).toBe(40);
    expect(measureNode(words(8))).toEqual({ width: 260, height: 60 });
    expect(wrappedLines('a\nb', 260)).toBe(2);
    expect(measureNode('short').height).toBe(40);
  });

  describe('issue 52: a box is as tall as the lines draw.io renders', () => {
    const ir = loadFixture('flowchart', 'valid-hand-broken-lines');
    const sizes = async () => {
      const r = await emit(ir, 'drawio', { diagramId: 'g' });
      expect(r.ok).toBe(true);
      expect(r.warnings).toEqual([]);
      const { cells } = checkDrawioStructure(r.output);
      return Object.fromEntries(ir.nodes.map((n) => [n.id, cellBounds(cells.find((c) => c.id === `g:${n.id}`))]));
    };

    it('counts a hand-broken line once when it fits the text area of the box', async () => {
      const box = await sizes();
      // Three lines of 225, 233 and 111 px in the 236 px text area of a 260 px box: 40 + 2 x 20.
      expect(box.collect).toMatchObject({ width: 260, height: 80 });
      // Two lines of 213 and 193 px: the box is as wide as the wider one needs, and one line taller than a single line.
      expect(box.render.height).toBe(60);
      expect(box.render.width).toBeGreaterThanOrEqual(Math.ceil(213.4) + 2 * LABEL_PAD);
      expect(box.render.width).toBeLessThanOrEqual(260);
      expect(box.short).toMatchObject({ width: 120, height: 40 });
    });

    it('measures a line by its glyphs: narrow letters take less room than capitals', () => {
      // 30 characters each; at a flat 7 px both were 210 px.
      expect(measureNode('illicit little filter utility').width).toBeLessThan(measureNode('MAXIMUM WARNING DOWNLOAD COUNT').width - 80);
      // A line of capitals that a flat 7 px called 182 px is 189 px wide and gets the room for it.
      expect(measureNode('AVAILABLE TO PROMISE CHECK').width).toBeGreaterThanOrEqual(189 + 2 * LABEL_PAD);
    });

    it('sizes a subroutine for the text area between its side bars', async () => {
      // draw.io wraps the label of a subroutine at 80 % of its width, less 2 px a side.
      const label = 'Approve and send label\n↳ return-request-label';
      const plain = measureNode(label);
      const sub = measureNode(label, { pad: 2, share: 0.1 });
      expect(sub.width).toBeGreaterThan(plain.width);
      expect(wrapText(label, 0.8 * sub.width - 4).lines).toBe(2);
      expect(sub.height).toBe(60);
      const r = await emit(loadFixture('activity', 'valid-two-lanes'), 'drawio', { diagramId: 'g' });
      const approve = checkDrawioStructure(r.output).cells.find((c) => c.id === 'g:approve');
      expect(approve.style).toContain('shape=process');
      expect(cellBounds(approve)).toMatchObject(sub);
    });

    it('breaks a long line at its words, as draw.io does, and never inside one', () => {
      const para = 'Collect orders created from 00:00 to 23:59 of the previous day, excluding test accounts and cancelled orders';
      expect(wrappedLines(para, 260)).toBe(3);
      // One unbreakable word overflows on its line instead of wrapping, so it adds no height.
      expect(measureNode('x'.repeat(100))).toEqual({ width: 260, height: 40 });
    });

    it.skipIf(!pw)('renders every node label of every fixture in Chromium on the lines its box was sized for, or one fewer', async () => {
      // The labelled node shapes that are 40 px tall for one line and 20 px taller for each further one,
      // and the subroutine, whose label draw.io wraps between its side bars.
      const plain = /^(rounded=1;)?whiteSpace=wrap;html=1;(arcSize=30;)?(dashed=1;)?spacingLeft=10;spacingRight=10;$/;
      const subroutine = /^shape=process;whiteSpace=wrap;html=1;backgroundOutline=1;$/;
      const boxes = [];
      for (const f of validFixtures()) {
        const r = await emit(f.ir, 'drawio', { diagramId: 'g' });
        for (const c of checkDrawioStructure(r.output).cells) {
          if (c.vertex !== '1' || !c.value || !(plain.test(c.style ?? '') || subroutine.test(c.style ?? ''))) continue;
          const b = cellBounds(c);
          boxes.push({ at: `${f.kind}/${f.name} ${c.id}`, html: c.value, ...b, wrap: subroutine.test(c.style) ? Math.round(0.8 * b.width - 4 + 2) : b.width - 24 + 2 });
        }
      }
      expect(boxes.length).toBeGreaterThan(100);
      const browser = await pw.chromium.launch();
      try {
        const page = await browser.newPage();
        // draw.io wraps a label at the box less its spacing (10 + 2 px a side), plus 2 px.
        await page.setContent(`<body style="font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.2">${boxes.map((b, i) => `<div id="b${i}" style="width:${b.wrap}px;white-space:normal;overflow-wrap:normal">${b.html}</div>`).join('')}</body>`);
        const rendered = await page.evaluate((count) => Array.from({ length: count }, (_, i) => Math.round(document.getElementById(`b${i}`).getBoundingClientRect().height / 14.4)), boxes.length);
        let exact = 0;
        boxes.forEach((b, i) => {
          const counted = (b.height - 40) / 20 + 1;
          expect(Number.isInteger(counted), b.at).toBe(true);
          expect(counted, b.at).toBeGreaterThanOrEqual(rendered[i]);
          expect(counted, b.at).toBeLessThanOrEqual(rendered[i] + 1);
          if (counted === rendered[i]) exact++;
        });
        // The count is one too many only where the browser breaks a line at a hyphen or a slash, which the wrap here does not.
        expect(exact / boxes.length).toBeGreaterThan(0.95);
        const tall = boxes.filter((b) => b.at.startsWith('flowchart/valid-hand-broken-lines'));
        expect(tall.map((b) => (b.height - 40) / 20 + 1)).toEqual(tall.map((b) => rendered[boxes.indexOf(b)]));
      } finally {
        await browser.close();
      }
    });
  });

  describe('issue 39: a decision label stays inside the rhombus', () => {
    // A text block a x b fits a w x h rhombus when a/w + b/h <= 1; a line is 15 px.
    const fits = (label, { width, height, spacing }) => {
      const { lines, widest } = wrapText(label, width - 4 - 2 * spacing);
      return widest / width + (lines * 15) / height <= 1 + 1e-9;
    };

    it('wraps words like a browser: at spaces, between CJK characters, never inside a word', () => {
      // 314 px on one line; the first 30 characters are 157 px, the rest 153 px.
      const type = wrapText('Type is PDF or PNG and size is under the configured limit?', 160);
      expect(type.lines).toBe(2);
      expect(type.widest).toBeCloseTo(157.4, 1);
      expect(wrapText('Type is PDF or PNG and size is under the configured limit?', 157).lines).toBe(3);
      expect(wrapText('a\nb', 300).lines).toBe(2);
      expect(wrapText('a\nb', 300).widest).toBeCloseTo(6.7, 1);
      const word = wrapText('Supercalifragilistic?', 50);
      expect(word.lines).toBe(1);
      expect(word.widest).toBeCloseTo(103.4, 1);
      expect(wrapText('在庫はありますか？', 60).lines).toBe(3);
    });

    it('keeps the plain size for a short question and grows only as far as the inscribed rectangle needs', () => {
      expect(measureDecision('File found?')).toEqual({ width: 140, height: 80, spacing: 0 });
      expect(measureDecision('Sync or async?')).toEqual({ width: 140, height: 80, spacing: 0 });
      // 127 px, and the room for it: too wide for the 114 px the 140 x 80 rhombus has at the line's height.
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
    // draw.io wraps the label at width - 4 - 2 * spacing. It breaks a line at more places than
    // the wrap here: on a line that is nearly full it breaks at the last chance it finds, a
    // hyphen inside "0-5", and "5?" stands alone.
    const wrapWidth = ({ width, spacing }) => width - 4 - 2 * spacing;
    const ranged = ['Are all conditions present and is the office type in the range 0-5?', 'Are all the conditions present and is the priority level 0-5?'];

    it('keeps the question of the report on one line, inside the rhombus', () => {
      // 209 px: it fits the plain box on one line, so it is not wrapped and nothing can be stranded.
      const label = 'Conditions present and office type 0-5?';
      const d = measureDecision(label);
      expect(d).toEqual({ width: 270, height: 80, spacing: 0 });
      const block = wrapText(label, wrapWidth(d));
      expect(block.lines).toBe(1);
      expect(block.widest / d.width + 15 / d.height).toBeLessThanOrEqual(1);
    });

    it('wraps a longer question with a range into two lines of about half the text each', () => {
      for (const label of ranged) {
        const d = measureDecision(label);
        expect(d.spacing, label).toBeGreaterThan(0);
        const block = wrapText(label, wrapWidth(d));
        expect(block.lines, label).toBe(2);
        const whole = wrapText(label, 10_000).widest;
        expect(block.widest, label).toBeLessThan(0.56 * whole);
        // No narrower wrap keeps two lines, so neither line is a nearly full one with a remainder after it.
        expect(wrapText(label, block.widest - 1).lines, label).toBe(3);
        // The wrap width leaves the widest line the room of a renderer that draws it a little wider.
        expect(wrapWidth(d), label).toBeGreaterThanOrEqual(block.widest * 1.03);
        expect(wrapText(label, wrapWidth(d) * 1.03).lines, label).toBe(2);
      }
    });

    it('wraps every multi-line question at the narrowest width that keeps its line count', () => {
      for (const q of [...ranged, 'Type is PDF or PNG and size is under the configured limit?', 'Is the configured retention period of the tenant exceeded for this document?', '在庫はありますか？それとも入荷待ちですか？']) {
        const d = measureDecision(q);
        const block = wrapText(q, wrapWidth(d));
        expect(block.lines, q).toBeGreaterThan(1);
        // The narrowest width at which the question still takes that many lines, by bisection.
        let least = 1;
        for (let hi = 2000; least < hi;) { const mid = Math.floor((least + hi) / 2); if (wrapText(q, mid).lines <= block.lines) hi = mid; else least = mid + 1; }
        // draw.io wraps at that width plus the room a wider rendering needs and no more, so the lines are as balanced as the line count allows.
        expect(wrapWidth(d), q).toBeGreaterThanOrEqual(least);
        expect(wrapWidth(d), q).toBeLessThanOrEqual(Math.ceil(least * 1.04) + 2);
        expect(block.widest / d.width + (block.lines * 15) / d.height, q).toBeLessThanOrEqual(1 + 1e-9);
      }
    });

    it('emits the activity fixture of the report with that rhombus', async () => {
      const r = await emit(loadFixture('activity', 'valid-decision-range'), 'drawio');
      expect(r.ok).toBe(true);
      expect(r.warnings).toEqual([]);
      const d = checkDrawioStructure(r.output).cells.find((c) => c.id === 'ticket-triage:d');
      expect(d.style).toBe('rhombus;whiteSpace=wrap;html=1;');
      expect(cellBounds(d)).toMatchObject({ width: 270, height: 80 });
    });

    it.skipIf(!pw)('renders in Chromium on the lines counted, with the value range on one line', async () => {
      const labels = ['Conditions present and office type 0-5?', ...ranged];
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
        rendered.forEach((lines, i) => {
          expect(lines, labels[i]).toHaveLength(i === 0 ? 1 : 2);
          expect(lines.at(-1), labels[i]).toMatch(/0-5\?$/);
          expect(lines[0].endsWith('-'), labels[i]).toBe(false);
        });
      } finally {
        await browser.close();
      }
    });
  });

  it('measures nodes with the clamp rule', () => {
    expect(measureNode('ab')).toEqual({ width: 120, height: 40 });
    // Twenty words of 30 px a word with its space wrap to three lines at the 260 px cap, so the box grows by two line heights.
    expect(measureNode(Array(20).fill('nnnn').join(' '))).toEqual({ width: 260, height: 80 });
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
