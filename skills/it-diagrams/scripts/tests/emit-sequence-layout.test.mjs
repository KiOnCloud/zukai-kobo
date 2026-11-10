import { describe, it, expect } from 'vitest';
import { emit } from '../src/pipeline.mjs';
import { layoutSequence, SEQUENCE_METRICS, NOTE_FOLD, NOTE_PAD } from '../src/layout-sequence.mjs';
import { LABEL_PAD, wrapText } from '../src/layout-graph.mjs';
import { textWidth } from '../src/text-metrics.mjs';
import { checkDrawioStructure, cellBounds } from './drawio-structure.mjs';
import { loadFixture, scriptsDir } from './helpers.mjs';
import { loadPlaywright } from '../src/preview.mjs';

const pw = loadPlaywright(scriptsDir);
const M = SEQUENCE_METRICS;
/** The header a one-word label needs: the word, the label padding on both sides, an even width. */
const headerFor = (word) => 2 * Math.ceil((textWidth(word) + 2 * LABEL_PAD) / 2);

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
    // InvoiceDocumentBuilderService is 170 px wide: with the padding on both sides, rounded up to an even width.
    expect(head.builder.width).toBe(196);
    expect(head.builder.width).toBe(headerFor('InvoiceDocumentBuilderService'));
    // InvoiceRepository is 95 px and fits the base width with its padding.
    expect(head.store.width).toBe(M.participantWidth);
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
    // An x is 6 px wide: 16 of them still fit the base width with the padding; 17 need more.
    expect(width('x'.repeat(16))).toBe(M.participantWidth);
    expect(width('x'.repeat(17))).toBe(126);
    expect(width('Tenant InvoiceDocumentBuilderService')).toBe(196);
    expect(width('x'.repeat(60))).toBe(60 * 6 + 2 * LABEL_PAD);
    // Capitals are wider than small letters, and the header follows: 184 px against 140 px for the same letters.
    expect(width('INVOICE_DOCUMENT_BUILDER')).toBe(headerFor('INVOICE_DOCUMENT_BUILDER'));
    expect(width('INVOICE_DOCUMENT_BUILDER')).toBeGreaterThan(width('invoice_document_builder') + 40);
  });

  it('spaces lifelines by the headers between them, and still widens a gap for a long message', () => {
    const L = layoutSequence(withParticipants(['A', 'InvoiceDocumentBuilderService', 'C']));
    const [a, b, c] = ['p0', 'p1', 'p2'].map((id) => L.participants.get(id));
    expect(b.centerX - a.centerX).toBe((120 + 196) / 2 + M.minGap);
    expect(c.centerX - b.centerX).toBe((196 + 120) / 2 + M.minGap);
    const plain = layoutSequence(withParticipants(['A', 'B']));
    expect(plain.participants.get('p1').centerX - plain.participants.get('p0').centerX).toBe(M.participantWidth + M.minGap);
    const long = withParticipants(['A', 'B']);
    long.messages[0].label = 'x'.repeat(60);
    const wide = layoutSequence(long);
    expect(wide.participants.get('p1').centerX - wide.participants.get('p0').centerX).toBeGreaterThanOrEqual(60 * 6);
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

/** draw.io keeps 2 px between a shape and its text, plus the style's `spacingLeft` / `spacingRight`. */
const notePad = (cell) => Object.fromEntries(['Left', 'Right'].map((side) => [side.toLowerCase(), 2 + Number(cell.style.match(new RegExp(`spacing${side}=(\\d+)`))?.[1] ?? 0)]));
const noteIr = (label, note = {}) => ({
  schemaVersion: 1, kind: 'sequence', title: 'Notes',
  participants: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }],
  messages: [{ id: 'm1', from: 'a', to: 'b', label: 'call' }, { id: 'm2', from: 'b', to: 'c', label: 'call' }],
  notes: [{ id: 'n1', label, participants: ['b'], after: 'm1', ...note }],
});

describe('notes of a sequence diagram in draw.io', () => {
  it('keeps the text of a note off its side borders and short of the folded corner', async () => {
    const ir = loadFixture('sequence', 'valid-wrapped-notes');
    const { r, cells } = await sequenceCells(ir);
    expect(r.warnings).toEqual([]);
    expect(NOTE_PAD).toEqual({ left: LABEL_PAD, right: NOTE_FOLD + 4 });
    for (const n of ir.notes) {
      const cell = cells.find((c) => c.id === `sq:${n.id}`);
      expect(cell.style, n.id).toContain(`size=${NOTE_FOLD};`);
      expect(notePad(cell), n.id).toEqual(NOTE_PAD);
    }
  });

  it('makes a note as tall as its wrapped text, and moves the rows below it down', async () => {
    const ir = loadFixture('sequence', 'valid-wrapped-notes');
    const { box } = await sequenceCells(ir);
    const L = layoutSequence(ir);
    const lines = {};
    for (const n of ir.notes) {
      const b = box(n.id);
      expect(b.width, n.id).toBe(220);
      lines[n.id] = wrapText(n.label, b.width - NOTE_PAD.left - NOTE_PAD.right).lines;
      expect(b.height, n.id).toBe(M.noteHeight + M.labelHeight * (lines[n.id] - 1));
      // The note stands in the middle of a row of its own, which is taller by the same amount.
      const row = L.rows.find((x) => x.type === 'note' && x.id === n.id);
      expect(row.height, n.id).toBe(b.height + M.noteRowGap);
      expect(b.y + b.height / 2, n.id).toBe(row.y);
    }
    expect(lines).toEqual({ n1: 2, n2: 3, n3: 4 });
    // The next arrow is a note row and a message row below the arrow the note follows.
    expect(L.messageY('m2') - L.messageY('m1')).toBe(box('n1').height + M.noteRowGap + M.rowPitch);
    expect(L.messageY('m4') - L.messageY('m3')).toBe(box('n2').height + M.noteRowGap + M.rowPitch);
    const lifeline = box('web');
    expect(lifeline.y + lifeline.height).toBeGreaterThan(box('n3').y + box('n3').height);
  });

  it('keeps a one-line note at the base height, and measures a one-lifeline note at its own width', () => {
    const short = layoutSequence(noteIr('Timeout 10 s'));
    expect(short.notes.get('n1').height).toBe(M.noteHeight);
    expect(short.rows.find((row) => row.type === 'note').height).toBe(M.noteHeight + M.noteRowGap);
    const label = 'Retried three times with a growing delay before the order is marked as failed';
    for (const position of ['left', 'right', 'over']) {
      const L = layoutSequence(noteIr(label, { position }));
      const b = L.notes.get('n1');
      // Beside one lifeline a note is narrower than between two, so the same text takes more lines.
      expect(b.width, position).toBe(156);
      const lines = wrapText(label, b.width - NOTE_PAD.left - NOTE_PAD.right).lines;
      expect(lines, position).toBeGreaterThan(wrapText(label, 220 - NOTE_PAD.left - NOTE_PAD.right).lines);
      expect(b.height, position).toBe(M.noteHeight + M.labelHeight * (lines - 1));
    }
    // A note placed before the first message has a row of its own height too.
    const first = noteIr(label);
    delete first.notes[0].after;
    const L = layoutSequence(first);
    expect(L.rows[0]).toMatchObject({ type: 'note', height: L.notes.get('n1').height + M.noteRowGap });
    expect(L.warnings).toEqual([]);
  });

  it.skipIf(!pw)('renders each note in Chromium inside the box it was sized for', async () => {
    const fixture = loadFixture('sequence', 'valid-wrapped-notes');
    // Capitals and digits are the widest text a note is likely to hold.
    const wide = noteIr('RETRY POLICY: MAX 3 ATTEMPTS, THEN MOVE THE MESSAGE TO THE DEAD LETTER QUEUE AND RAISE ALERT 4021');
    const notes = [fixture, wide].flatMap((ir) => {
      const L = layoutSequence(ir);
      return ir.notes.map((n) => ({ label: n.label, ...L.notes.get(n.id) }));
    });
    const browser = await pw.chromium.launch();
    try {
      const page = await browser.newPage();
      await page.setContent(`<body style="font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.2">${notes.map((n, i) => `<div id="n${i}" style="width:${n.width - NOTE_PAD.left - NOTE_PAD.right}px;white-space:normal;overflow-wrap:normal">${n.label}</div>`).join('')}</body>`);
      const rendered = await page.evaluate((count) => Array.from({ length: count }, (_, i) => {
        const el = document.getElementById(`n${i}`);
        return { height: el.getBoundingClientRect().height, overflow: el.scrollWidth - el.clientWidth };
      }), notes.length);
      rendered.forEach((got, i) => {
        // draw.io centres the text, so half of what the box has left stands above and below it.
        expect((notes[i].height - got.height) / 2, notes[i].label).toBeGreaterThanOrEqual(8);
        expect(got.overflow, notes[i].label).toBeLessThanOrEqual(0);
      });
    } finally {
      await browser.close();
    }
  });
});

/** A sequence IR from `[from, to, kind]` rows; the messages are m1, m2, ... in order. */
const calls = (rows, blocks = []) => ({
  schemaVersion: 1, kind: 'sequence', title: 'Calls',
  participants: ['a', 'b', 'x'].map((id) => ({ id, label: id.toUpperCase() })),
  messages: rows.map(([from, to, kind], i) => ({ id: `m${i + 1}`, from, to, label: `m${i + 1}`, ...(kind ? { kind } : {}) })),
  blocks,
});
const opt = (id, ...messages) => ({ id, kind: 'opt', label: id, messages });
const alt = (id, first, second) => ({ id, kind: 'alt', label: id, messages: first, branches: [{ label: 'else', messages: second }] });

/** Each activation as the message it starts at and the message it ends at (null: a call that never returns). */
async function spans(ir) {
  const r = await emit(ir, 'drawio', { diagramId: 'sq' });
  expect(r.ok, JSON.stringify(r.errors)).toBe(true);
  const L = layoutSequence(ir);
  const at = (y) => ir.messages.find((msg) => L.messageY(msg.id) === y)?.id ?? null;
  return Object.fromEntries(L.activations.map((a) => [a.id.replace('act-', ''), `${a.participant} ${at(a.startY)}..${at(a.endY)}`]));
}

describe('activations of a sequence diagram in draw.io', () => {
  it('keeps the bar open past an early return in an opt, to the last return to the caller', async () => {
    const ir = loadFixture('sequence', 'valid-invoice-export');
    const { r, cells } = await sequenceCells(ir);
    expect(r.warnings).toEqual([]);
    // The database never answers in this diagram, so its bar keeps the height of one row.
    expect(await spans(ir)).toMatchObject({ m1: 'builder m1..m8', m3: 'store m3..m5', m6: 'store m6..m7' });
    expect(cellBounds(cells.find((c) => c.id === 'sq:act-m4')).height).toBe(M.rowPitch);
    // One bar on the builder's lifeline, and every message the builder sends or gets starts or ends on it.
    const L = layoutSequence(ir);
    const bars = cells.filter((c) => c.parent === 'sq:builder' && c.id.startsWith('sq:act-'));
    expect(bars.map((c) => c.id)).toEqual(['sq:act-m1']);
    const bar = cellBounds(bars[0]);
    const top = L.participants.get('builder').y + bar.y;
    for (const msg of ir.messages.filter((x) => x.from === 'builder' || x.to === 'builder')) {
      expect(L.messageY(msg.id), msg.id).toBeGreaterThanOrEqual(top);
      expect(L.messageY(msg.id), msg.id).toBeLessThanOrEqual(top + bar.height);
    }
  });

  it('ends at the last message of the participant when no return to the caller follows the block', async () => {
    const ir = loadFixture('sequence', 'valid-invoice-export');
    ir.messages = ir.messages.filter((msg) => msg.id !== 'm8');
    ir.blocks[2] = { id: 'b3', kind: 'opt', label: 'has lines', messages: ['m6', 'm7'] };
    expect((await spans(ir)).m1).toBe('builder m1..m7');
    // Work in a later branch of the same block, and a return in the main flow after it.
    const mainFlow = calls([['a', 'b'], ['b', 'a', 'return'], ['b', 'x'], ['x', 'b', 'return'], ['b', 'a', 'return'], ['b', 'x', 'async']], [alt('k', ['m2'], ['m3', 'm4'])]);
    expect(await spans(mainFlow)).toEqual({ m1: 'b m1..m5', m3: 'x m3..m4' });
  });

  it('ends at the conditional return when nothing shows that the call is still running', async () => {
    // Nothing after the block.
    expect(await spans(calls([['a', 'b'], ['b', 'a', 'return'], ['a', 'x', 'async']], [opt('k', 'm2')]))).toEqual({ m1: 'b m1..m2' });
    // The caller calls again: a new activation, not the first one carried on.
    expect(await spans(calls([['a', 'b'], ['b', 'a', 'return'], ['a', 'b'], ['b', 'x', 'async'], ['b', 'a', 'return']], [opt('k', 'm2')]))).toEqual({ m1: 'b m1..m2', m3: 'b m3..m5' });
    // A reply in each branch of an alt, then a second call.
    expect(await spans(calls([['a', 'b'], ['b', 'a', 'return'], ['b', 'a', 'return'], ['a', 'b'], ['b', 'a', 'return']], [alt('k', ['m2'], ['m3'])]))).toEqual({ m1: 'b m1..m3', m4: 'b m4..m5' });
  });

  it('does not carry an activation past the block its call is in', async () => {
    // Each pass of the loop calls and gets a reply in one of two branches; the audit after the loop is no part of it.
    const ir = calls([['a', 'b'], ['b', 'a', 'return'], ['b', 'a', 'return'], ['b', 'x', 'async']], [{ id: 'l', kind: 'loop', label: 'retry', messages: ['m1', 'm2', 'm3'] }, alt('k', ['m2'], ['m3'])]);
    expect(await spans(ir)).toEqual({ m1: 'b m1..m3' });
    expect(await spans(loadFixture('sequence', 'valid'))).toMatchObject({ m1: 'web m1..m9', m2: 'auth m2..m8' });
  });

  it('closes at a return in the block the call is in, as before', async () => {
    // Call and return side by side, with and without a block around them.
    expect(await spans(calls([['a', 'b'], ['b', 'a', 'return'], ['b', 'x', 'async']]))).toEqual({ m1: 'b m1..m2' });
    expect(await spans(calls([['a', 'b'], ['b', 'a', 'return'], ['b', 'x', 'async']], [opt('k', 'm1', 'm2')]))).toEqual({ m1: 'b m1..m2' });
    // A nested call that returns inside an inner block of the outer call's block.
    const nested = calls([['a', 'b'], ['b', 'x'], ['x', 'b', 'return'], ['b', 'x'], ['x', 'b', 'return'], ['b', 'a', 'return']], [opt('k', 'm3')]);
    expect(await spans(nested)).toEqual({ m2: 'x m2..m3', m4: 'x m4..m5', m1: 'b m1..m6' });
  });
});
