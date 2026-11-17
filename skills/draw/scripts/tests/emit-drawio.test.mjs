import { describe, it, expect } from 'vitest';
import { emit } from '../src/pipeline.mjs';
import { emitDrawio, slugify, rowHeight } from '../src/emit-drawio.mjs';
import { xmlAttr, htmlLabel, vertex } from '../src/drawio-xml.mjs';
import { measureNode, measureDecision, wrapText, widestWord, wrappedLines, LABEL_PAD } from '../src/layout-graph.mjs';
import { textWidth, roomFor } from '../src/text-metrics.mjs';
import { checkDrawioStructure, cellBounds } from './drawio-structure.mjs';
import { loadFixture, validFixtures, scriptsDir } from './helpers.mjs';
import { loadPlaywright } from '../src/preview.mjs';

const pw = loadPlaywright(scriptsDir);

/** A call without a space up to its first comma: one word of 287.5 px, wider than the 236 px a 260 px box leaves its text. */
const CALL_WORD = 'ngComponentOutlet(ComponentMap[cell.component],';
const CALL = `${CALL_WORD} inputs: data, config)`;
const CALL_FLOW = { schemaVersion: 1, kind: 'flowchart', title: 'Cell', nodes: [{ id: 'a', label: CALL }, { id: 'b', label: CALL, shape: 'subroutine' }, { id: 'c', label: CALL, shape: 'io' }], edges: [{ id: 'e1', from: 'a', to: 'b' }, { id: 'e2', from: 'b', to: 'c' }] };
const CALL_CLASS = { schemaVersion: 1, kind: 'class', title: 'Host', classes: [{ id: 'host', label: 'DynamicCellHostComponentWithAVeryLongGeneratedName', attributes: [{ name: 'outlet', type: CALL_WORD.repeat(2) }] }], relations: [] };

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
    const HYPHENATED = 'lint-staged-prettier-eslint-typecheck-and-vitest-related-unit-tests-then-build-docker-image-and-push';
    const URL_ER = { schemaVersion: 1, kind: 'er', title: 'Hooks', entities: [{ id: 'hook', label: 'Webhook', attributes: [{ name: 'id', type: 'uuid', key: 'pk' }, { name: 'callback_url', type: 'varchar(2048)', comment: 'https://hooks.example.com/v1/tenants/acme-corp/integrations/billing-events' }] }], relations: [] };
    const HYPHEN_FLOW = { schemaVersion: 1, kind: 'flowchart', title: 'CI', nodes: [{ id: 'a', label: HYPHENATED }, { id: 'b', label: 'Prix\u00a0: 5\u00a0000\u00a0EUR hors taxes par an et par utilisateur\u00a0actif' }, { id: 'c', label: 'Roll back to the last known-good release — then page the on-call engineer?' }], edges: [{ id: 'e1', from: 'a', to: 'b' }, { id: 'e2', from: 'b', to: 'c' }] };
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
      // draw.io wraps the label of a subroutine at 80 % of its width, less 2 px and the 4 px of label spacing a side.
      const label = 'Approve and send label\n↳ return-request-label';
      const plain = measureNode(label);
      const sub = measureNode(label, { pad: 6, share: 0.1 });
      expect(sub.width).toBeGreaterThan(plain.width);
      expect(wrapText(label, 0.8 * sub.width - 12).lines).toBe(2);
      expect(sub.height).toBe(60);
      const r = await emit(loadFixture('activity', 'valid-two-lanes'), 'drawio', { diagramId: 'g' });
      const approve = checkDrawioStructure(r.output).cells.find((c) => c.id === 'g:approve');
      expect(approve.style).toContain('shape=process');
      expect(cellBounds(approve)).toMatchObject(sub);
    });

    it('breaks a long line at its words, as draw.io does, and never inside one', () => {
      const para = 'Collect orders created from 00:00 to 23:59 of the previous day, excluding test accounts and cancelled orders';
      expect(wrappedLines(para, 260)).toBe(3);
      // One unbreakable word stays on its line and adds no height: the box grows to hold it (600 px, its room and the padding).
      expect(measureNode('x'.repeat(100))).toEqual({ width: 648, height: 40 });
      // A name joined by hyphens is spread over the lines its parts fill: draw.io breaks after each hyphen.
      expect(measureNode(HYPHENATED)).toEqual({ width: 260, height: 80 });
    });

    it('breaks inside a word where a browser does, and nowhere else', () => {
      const lines = (text) => wrapText(text, 1).lines;
      expect(lines('acme-corp')).toBe(2);
      expect(lines('0-5')).toBe(2);
      expect(lines('/find?id=1')).toBe(2);
      expect(lines('2019–2024')).toBe(2);
      expect(lines('before—after')).toBe(3);
      expect(lines('wait…done')).toBe(2);
      expect(lines('zero\u200bwidth')).toBe(2);
      expect(lines('--force')).toBe(3);
      expect(lines('a-?b')).toBe(2);
      // No break at a slash, a dot, an underscore, a colon or a no-break space, after a sign, or between a hyphen and the punctuation after it.
      for (const whole of ['docs/api/v1', 'hooks.example.com', 'customer_id', 'std::vector', '5\u00a0000\u00a0EUR', '10\u202f%', '-5', 'a-)', 'a-,b', 'a?)b', 'a??', 'ends-']) expect(lines(whole), whole).toBe(1);
      expect(lines('retry -5 times')).toBe(3);
    });

    it('gives a table row the lines a long hyphenated value is spread over, so nothing is clipped', async () => {
      const r = await emit(URL_ER, 'drawio', { diagramId: 'g' });
      const { cells } = checkDrawioStructure(r.output);
      const row = cellBounds(cells.find((c) => c.id === 'g:hook:row-1'));
      // The 300 px table leaves the row 288 px of text; the comment breaks after "acme-" and "billing-".
      expect(row.width).toBe(300);
      expect(row.height).toBe(26 + 14 * 2);
      expect(rowHeight('PK id: uuid', 300)).toBe(26);
    });

    it.skipIf(!pw)('renders every node label and table row of every fixture in Chromium on the lines it was sized for', async () => {
      // The labelled node shapes that are 40 px tall for one line and 20 px taller for each further one,
      // and the subroutine, whose label draw.io wraps between its side bars.
      const plain = /^(rounded=1;)?whiteSpace=wrap;html=1;(arcSize=30;)?(dashed=1;)?spacingLeft=10;spacingRight=10;$/;
      const subroutine = /^shape=process;whiteSpace=wrap;html=1;backgroundOutline=1;spacingLeft=4;spacingRight=4;$/;
      const boxes = [];
      const hard = [{ kind: 'er', name: 'long-url', ir: URL_ER }, { kind: 'flowchart', name: 'hyphens', ir: HYPHEN_FLOW }, { kind: 'flowchart', name: 'long-call', ir: CALL_FLOW }, { kind: 'class', name: 'long-call', ir: CALL_CLASS }];
      for (const f of [...validFixtures(), ...hard]) {
        const r = await emit(f.ir, 'drawio', { diagramId: 'g', allowSensitive: true });
        for (const c of checkDrawioStructure(r.output).cells) {
          if (c.vertex !== '1' || !c.value) continue;
          const b = cellBounds(c);
          const at = `${f.kind}/${f.name} ${c.id}`;
          // A table row is 26 px for one line and 14 px taller for each further one, with 4 + 2 px of spacing a side; it clips what does not fit.
          if (/^text;.*overflow=hidden/.test(c.style ?? '')) boxes.push({ at, html: c.value, ...b, wrap: b.width - 12 + 2, base: 26, line: 14, row: true });
          else if (plain.test(c.style ?? '') || subroutine.test(c.style ?? '')) boxes.push({ at, html: c.value, ...b, wrap: subroutine.test(c.style) ? Math.round(0.8 * b.width - 4 - 8 + 2) : b.width - 24 + 2, base: 40, line: 20 });
        }
      }
      expect(boxes.filter((b) => !b.row).length).toBeGreaterThan(100);
      expect(boxes.filter((b) => b.row).length).toBeGreaterThan(50);
      const browser = await pw.chromium.launch();
      try {
        const page = await browser.newPage();
        // draw.io wraps a label at the box less its spacing (10 + 2 px a side), plus 2 px.
        await page.setContent(`<body style="font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.2">${boxes.map((b, i) => `<div id="b${i}" style="width:${b.wrap}px;white-space:normal;overflow-wrap:normal">${b.html}</div>`).join('')}</body>`);
        const drawn = await page.evaluate((count) => Array.from({ length: count }, (_, i) => {
          const el = document.getElementById(`b${i}`);
          return { lines: Math.round(el.getBoundingClientRect().height / 14.4), overflow: el.scrollWidth - el.clientWidth };
        }), boxes.length);
        const rendered = drawn.map((d) => d.lines);
        boxes.forEach((b, i) => {
          // No word is wider than the text area: a box would let it run over its borders, a row would clip it.
          expect(drawn[i].overflow, b.at).toBeLessThanOrEqual(0);
          const counted = (b.height - b.base) / b.line + 1;
          expect(Number.isInteger(counted), b.at).toBe(true);
          // Never fewer lines than drawn: a row would clip its last line, a box would run short of room.
          expect(counted, b.at).toBeGreaterThanOrEqual(rendered[i]);
          // A node counts exactly the lines drawn. A row counts them at a width less the 4 % margin, so at most one more.
          expect(counted, b.at).toBeLessThanOrEqual(rendered[i] + (b.row ? 1 : 0));
        });
        // The cases that a wrap at spaces alone gets wrong are among them, and take several lines.
        const lines = (at) => rendered[boxes.findIndex((b) => b.at === at)];
        expect(lines('flowchart/hyphens g:a')).toBe(3);
        expect(lines('er/long-url g:hook:row-1')).toBe(3);
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

  describe('issue 65: a word that cannot break is never wider than its box', () => {
    const word = textWidth(CALL_WORD);
    /** The width draw.io leaves the text of a cell: the box less 2 px and the label spacing on each side, between the side bars of a subroutine. */
    const textArea = (cell) => {
      const spacing = (side) => Number(cell.style.match(new RegExp(`spacing${side}=(\\d+)`))?.[1] ?? 0);
      const across = cell.style.startsWith('shape=process') ? 0.8 : 1;
      return cellBounds(cell).width * across - 4 - spacing('Left') - spacing('Right');
    };
    const withCall = (ir, list) => ({ ...ir, [list]: ir[list].map((el) => ({ ...el, label: `${CALL_WORD} ${el.label}` })) });

    it('grows the box to its widest word and still wraps the rest at the words', () => {
      expect(word).toBeCloseTo(287.5, 1);
      expect(widestWord(CALL)).toBe(word);
      // The word, the 4 % of room and the padding; the rest of the call takes the second line.
      expect(measureNode(CALL)).toEqual({ width: roomFor(word) + 2 * LABEL_PAD, height: 60 });
      // A shape that takes more of the width from its text grows by that much more.
      const sub = measureNode(CALL, { pad: 6, share: 0.1 });
      expect(0.8 * sub.width - 12).toBeGreaterThanOrEqual(roomFor(word));
      expect(measureNode(CALL, { pad: 22 }).width).toBe(roomFor(word) + 44);
      // The cap is where text that can wrap does wrap: a long sentence keeps the 260 px box.
      expect(measureNode('Collect orders created from 00:00 to 23:59 of the previous day, excluding test accounts and cancelled orders')).toEqual({ width: 260, height: 80 });
      // A browser breaks between East Asian characters, so a long run of them is no long word.
      expect(measureNode('請求書ドキュメントビルダーサービスの設定を確認する').width).toBe(260);
    });

    it('holds the word in every node shape of every graph kind, without a warning', async () => {
      const shapes = { schemaVersion: 1, kind: 'flowchart', title: 'Shapes', nodes: ['process', 'terminal', 'io', 'subroutine', 'note'].map((shape) => ({ id: shape, label: 'step', shape })), edges: [] };
      const cases = [
        ['flowchart', withCall(shapes, 'nodes'), 5],
        ['state', withCall(loadFixture('state', 'valid'), 'states'), 1],
        ['architecture', withCall(loadFixture('architecture', 'valid'), 'components'), 1],
        ['activity', withCall(loadFixture('activity', 'valid-two-lanes'), 'actions'), 1],
      ];
      for (const [kind, ir, least] of cases) {
        const r = await emit(ir, 'drawio', { diagramId: 'g' });
        expect(r.ok, kind).toBe(true);
        expect(r.warnings.filter((w) => w.message.startsWith('layout:')), kind).toEqual([]);
        const boxes = checkDrawioStructure(r.output).cells.filter((c) => c.vertex === '1' && String(c.value ?? '').includes('ngComponentOutlet') && /whiteSpace=wrap/.test(c.style) && !/^(rhombus|swimlane)/.test(c.style) && !/verticalLabelPosition=bottom/.test(c.style));
        expect(boxes.length, kind).toBeGreaterThanOrEqual(least);
        for (const c of boxes) expect(textArea(c), `${kind} ${c.id}`).toBeGreaterThanOrEqual(roomFor(word));
      }
    });

    it('widens a table for a word in its header or in a row, so the header does not spill and the row does not clip', async () => {
      const r = await emit(CALL_CLASS, 'drawio', { diagramId: 'g' });
      const { cells } = checkDrawioStructure(r.output);
      const table = cellBounds(cells.find((c) => c.id === 'g:host'));
      const row = cells.find((c) => c.id === 'g:host:row-0');
      // The type is the call twice over without a space: far wider than the 300 px a table wraps at.
      const type = textWidth(CALL_WORD.repeat(2));
      expect(type).toBeGreaterThan(500);
      expect(table.width).toBe(roomFor(type) + 24);
      // A row keeps 6 px on each side of its text; "+ outlet:" stands on a line of its own above the type.
      expect(cellBounds(row).width - 12).toBeGreaterThanOrEqual(roomFor(type));
      expect(cellBounds(row).height).toBe(26 + 14);
      // The bold class name alone, 310 px, sets the width when no row is wider.
      const named = await emit({ ...CALL_CLASS, classes: [{ id: 'host', label: CALL_CLASS.classes[0].label }] }, 'drawio', { diagramId: 'g' });
      const name = textWidth(CALL_CLASS.classes[0].label, { bold: true });
      expect(name).toBeGreaterThan(300);
      expect(cellBounds(checkDrawioStructure(named.output).cells.find((c) => c.id === 'g:host')).width).toBe(roomFor(name) + 24);
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
      // The adversarial fixture holds a connection string on purpose; the override stands for the user's word.
      const r = await emit(ir, 'drawio', { allowSensitive: true });
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
    const r = await emit(loadFixture('adversarial', 'labels'), 'drawio', { allowSensitive: true });
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
