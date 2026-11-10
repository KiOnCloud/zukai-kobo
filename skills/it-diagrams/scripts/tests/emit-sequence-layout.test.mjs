import { describe, it, expect } from 'vitest';
import { emit } from '../src/pipeline.mjs';
import { layoutSequence, SEQUENCE_METRICS } from '../src/layout-sequence.mjs';
import { LABEL_PAD } from '../src/layout-graph.mjs';
import { checkDrawioStructure, cellBounds } from './drawio-structure.mjs';
import { loadFixture, scriptsDir } from './helpers.mjs';
import { loadPlaywright } from '../src/preview.mjs';

const pw = loadPlaywright(scriptsDir);
const M = SEQUENCE_METRICS;

async function sequenceCells(ir) {
  const r = await emit(ir, 'drawio', { diagramId: 'sq' });
  expect(r.ok).toBe(true);
  const { problems, cells } = checkDrawioStructure(r.output);
  expect(problems).toEqual([]);
  return { r, cells, box: (id) => cellBounds(cells.find((c) => c.id === `sq:${id}`)) };
}

const withParticipants = (labels) => ({
  schemaVersion: 1, kind: 'sequence', title: 'Headers',
  participants: labels.map((label, i) => ({ id: `p${i}`, label })),
  messages: labels.slice(1).map((_, i) => ({ id: `m${i}`, from: `p${i}`, to: `p${i + 1}`, label: 'call' })),
});

describe('participant headers of a sequence diagram in draw.io', () => {
  it('grows a header to hold a label that is one long word, and moves its neighbours apart', async () => {
    const ir = loadFixture('sequence', 'valid-invoice-export');
    const { r, box } = await sequenceCells(ir);
    expect(r.warnings).toEqual([]);
    const head = Object.fromEntries(ir.participants.map((p) => [p.id, box(p.id)]));
    // 29 and 17 characters at 7 px, plus the padding on both sides, rounded up to an even width.
    expect(head.builder.width).toBe(228);
    expect(head.store.width).toBe(144);
    expect(head.job.width).toBe(M.participantWidth);
    expect(head.db.width).toBe(M.participantWidth);
    expect(head.job.x).toBe(M.leftMargin);
    const ids = ir.participants.map((p) => p.id);
    for (let i = 1; i < ids.length; i++) {
      const left = head[ids[i - 1]];
      const right = head[ids[i]];
      expect(right.x - (left.x + left.width), `${ids[i - 1]} | ${ids[i]}`).toBeGreaterThanOrEqual(M.minGap);
    }
  });

  it('keeps everything that hangs on a lifeline on the centre of the wider header', async () => {
    const ir = loadFixture('sequence', 'valid-invoice-export');
    const { cells, box } = await sequenceCells(ir);
    const centre = (id) => box(id).x + box(id).width / 2;
    // An activation is a child of its lifeline, centred on the dashed line.
    const act = cells.find((c) => c.id === 'sq:act-m1');
    expect(act.parent).toBe('sq:builder');
    expect(cellBounds(act).x + cellBounds(act).width / 2).toBe(box('builder').width / 2);
    // A message's waypoint lies midway between the two lifelines it joins.
    const m3 = cells.find((c) => c.id === 'sq:m3');
    expect(Number(m3.mxGeometry.Array.mxPoint[0].x)).toBe((centre('builder') + centre('store')) / 2);
    for (const p of ir.participants) expect(Number.isInteger(centre(p.id)), p.id).toBe(true);
  });

  it('sizes a header by its widest word only: a label that can wrap keeps the base width', () => {
    const width = (label) => layoutSequence(withParticipants([label, 'B'])).participants.get('p0').width;
    expect(width('Order service')).toBe(M.participantWidth);
    expect(width('Invoice document builder service')).toBe(M.participantWidth);
    // A browser breaks between East Asian characters, so no run of them is one long word.
    expect(width('請求書ドキュメントビルダーサービス')).toBe(M.participantWidth);
    // 13 characters still fit the base width with the padding; 14 need more.
    expect(width('x'.repeat(13))).toBe(M.participantWidth);
    expect(width('x'.repeat(14))).toBe(122);
    expect(width('Tenant InvoiceDocumentBuilderService')).toBe(228);
    expect(width('x'.repeat(60))).toBe(60 * 7 + 2 * LABEL_PAD);
  });

  it('spaces lifelines by the headers between them, and still widens a gap for a long message', () => {
    const L = layoutSequence(withParticipants(['A', 'InvoiceDocumentBuilderService', 'C']));
    const [a, b, c] = ['p0', 'p1', 'p2'].map((id) => L.participants.get(id));
    expect(b.centerX - a.centerX).toBe((120 + 228) / 2 + M.minGap);
    expect(c.centerX - b.centerX).toBe((228 + 120) / 2 + M.minGap);
    const plain = layoutSequence(withParticipants(['A', 'B']));
    expect(plain.participants.get('p1').centerX - plain.participants.get('p0').centerX).toBe(M.participantWidth + M.minGap);
    const long = withParticipants(['A', 'B']);
    long.messages[0].label = 'x'.repeat(60);
    const wide = layoutSequence(long);
    expect(wide.participants.get('p1').centerX - wide.participants.get('p0').centerX).toBeGreaterThanOrEqual(60 * 7);
  });

  it.skipIf(!pw)('renders each one-word label in Chromium inside its header, clear of both borders', async () => {
    // Class names as in the report, and an identifier in capitals, which are the widest letters.
    const labels = ['InvoiceDocumentBuilderService', 'InvoiceRepository', 'ExportJob', 'INVOICE_DOCUMENT_BUILDER', 'IHttpMessageHandlerFactory'];
    const L = layoutSequence(withParticipants(labels));
    const browser = await pw.chromium.launch();
    try {
      const page = await browser.newPage();
      await page.setContent(`<body style="font-family:Helvetica,Arial,sans-serif;font-size:12px">${labels.map((l, i) => `<span id="s${i}" style="white-space:nowrap">${l}</span><br>`).join('')}</body>`);
      const rendered = await page.evaluate((count) => Array.from({ length: count }, (_, i) => document.getElementById(`s${i}`).getBoundingClientRect().width), labels.length);
      rendered.forEach((px, i) => {
        const header = L.participants.get(`p${i}`).width;
        // draw.io keeps 2 px between the box and its text; the label must not need more than what is left.
        expect(px, labels[i]).toBeLessThanOrEqual(header - 4);
        if (!/^[A-Z_]+$/.test(labels[i])) expect(px, labels[i]).toBeLessThanOrEqual(header - 2 * LABEL_PAD);
      });
    } finally {
      await browser.close();
    }
  });
});

/** The horizontal lines of a frame: its top and bottom edge. */
const frameEdges = (f) => [f.y, f.y + f.height];

describe('combined fragments of a sequence diagram in draw.io', () => {
  it('opens a frame below a gap when another frame has just closed, so each keeps its own border', async () => {
    const ir = loadFixture('sequence', 'valid-invoice-export');
    const { r, box } = await sequenceCells(ir);
    expect(r.warnings).toEqual([]);
    const [b1, b2, b3] = ['b1', 'b2', 'b3'].map(box);
    expect(b2.y - (b1.y + b1.height)).toBe(M.blockGap);
    expect(b3.y - (b2.y + b2.height)).toBe(M.blockGap);
    expect(M.blockGap).toBeGreaterThanOrEqual(10);
    // The rows between the two arrows: the close of one block, the gap, the header of the next, the message.
    const L = layoutSequence(ir);
    expect(L.messageY('m3') - L.messageY('m2')).toBe(M.blockCloseHeight + M.blockGap + M.blockOpenHeight + M.rowPitch);
    expect(L.rows.filter((row) => row.type === 'gap')).toHaveLength(2);
  });

  it('adds no gap where frames are nested or a branch separator stands between them', () => {
    const ir = {
      schemaVersion: 1, kind: 'sequence', title: 'Nested',
      participants: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
      messages: ['m1', 'm2', 'm3', 'm4', 'm5'].map((id) => ({ id, from: 'a', to: 'b', label: id })),
      blocks: [
        // The alt opens together with its first inner block and closes together with its last one.
        { id: 'outer', kind: 'alt', label: 'ok', messages: ['m1', 'm2'], branches: [{ label: 'failed', messages: ['m3', 'm4'] }] },
        { id: 'first', kind: 'opt', label: 'x', messages: ['m1'] },
        // An inner block ends the first branch and another starts the second: the separator is between them.
        { id: 'last', kind: 'opt', label: 'y', messages: ['m2'] },
        { id: 'next', kind: 'opt', label: 'z', messages: ['m3'] },
        { id: 'tail', kind: 'loop', label: 'w', messages: ['m4'] },
        { id: 'after', kind: 'opt', label: 'v', messages: ['m5'] },
      ],
    };
    const L = layoutSequence(ir);
    const types = L.rows.map((row) => (row.type === 'message' ? row.id : `${row.type}${row.block ? `:${row.block}` : ''}`));
    expect(types).toEqual([
      'block-open:outer', 'block-open:first', 'm1', 'block-close:first',
      'gap', 'block-open:last', 'm2', 'block-close:last',
      'section:outer', 'block-open:next', 'm3', 'block-close:next',
      'gap', 'block-open:tail', 'm4', 'block-close:tail', 'block-close:outer',
      'gap', 'block-open:after', 'm5', 'block-close:after',
    ]);
    expect(L.warnings).toEqual([]);
  });

  it('never draws an edge of one frame within the gap of an edge of another, in any fixture', async () => {
    const nested = {
      schemaVersion: 1, kind: 'sequence', title: 'Rows',
      participants: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }],
      messages: ['m1', 'm2', 'm3', 'm4'].map((id, i) => ({ id, from: i % 2 ? 'b' : 'a', to: i % 2 ? 'c' : 'b', label: id })),
      blocks: [{ id: 'o', kind: 'loop', label: 'all', messages: ['m1', 'm2'] }, { id: 'i1', kind: 'opt', label: 'p', messages: ['m1'] }, { id: 'i2', kind: 'opt', label: 'q', messages: ['m2'] }, { id: 's1', kind: 'opt', label: 'r', messages: ['m3'] }, { id: 's2', kind: 'par', label: 's', messages: ['m4'] }],
    };
    for (const ir of [nested, ...['valid', 'valid-loop-note-alt', 'valid-invoice-export', 'valid-ref-parts', 'valid-participant-kinds'].map((name) => loadFixture('sequence', name))]) {
      const { box } = await sequenceCells(ir);
      const frames = (ir.blocks ?? []).map((b) => ({ id: b.id, ...box(b.id) }));
      for (const f of frames) for (const g of frames) {
        if (f === g) continue;
        for (const y of frameEdges(f)) for (const other of frameEdges(g)) expect(Math.abs(y - other), `${ir.title}: ${f.id} / ${g.id}`).toBeGreaterThanOrEqual(M.blockGap);
      }
    }
  });
});
