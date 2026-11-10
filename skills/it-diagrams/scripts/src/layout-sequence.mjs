/**
 * Deterministic grid layout for sequence diagrams.
 *
 * Columns: participants left to right. A header is as wide as the widest word of its label
 * needs, and the gap between two neighbours grows so that every message label fits between
 * the lifelines it spans. Rows: every message, note, block header,
 * section separator and block end gets a row of its own, so frame labels never sit on top of
 * message labels, and a block that opens right after another has closed starts below a gap,
 * so each frame keeps its own border. Notes take the gap next to their lifeline instead of
 * overlapping the next one, and are as tall as their wrapped text needs, so the rows below a
 * long note move down. A final pass reports any text boxes that still overlap, so the agent
 * can tell the user.
 */

import { longestLine } from './text-metrics.mjs';
import { wrapText, LABEL_PAD } from './layout-graph.mjs';

export const SEQUENCE_METRICS = {
  participantWidth: 120,
  minGap: 60,
  headerHeight: 40,
  topMargin: 100,
  leftMargin: 80,
  bottomMargin: 40,
  rowPitch: 40,
  blockOpenHeight: 34,
  sectionHeight: 30,
  blockCloseHeight: 16,
  blockGap: 12,
  noteHeight: 36,
  noteRowGap: 12,
  activationWidth: 10,
  frameInset: 16,
  charWidth: 7,
  labelHeight: 16,
};

/** The folded corner of a note: how far it cuts into the top and the right side of the box. */
export const NOTE_FOLD = 14;
/**
 * Clear space between a note's border and its text. On the left it is the padding every node
 * label keeps. On the right it is the fold plus 4 px, so a first line that fills the note
 * stops short of the folded corner. The height below counts it and the emitter draws it as
 * label spacing, so draw.io wraps the text at the width the height was measured for.
 */
export const NOTE_PAD = { left: LABEL_PAD, right: NOTE_FOLD + 4 };

const textWidth = (text, m) => Math.ceil(longestLine(text) * m.charWidth) + 12;
const lineCount = (text) => String(text).split(/\r\n?|\n/).length;

/**
 * Width of a participant's header: `participantWidth`, or more when the label has a word
 * that needs it. The header wraps its label at spaces, but a word cannot break (a class or
 * method name is one word however long), so the box grows until that word fits with the
 * usual room on each side. Even, so the lifeline stands on a whole pixel.
 */
const headerWidth = (label, m) => Math.max(m.participantWidth, 2 * Math.ceil((wrapText(label, 1).widest + 2 * LABEL_PAD) / 2));

/**
 * @param {object} ir validated sequence IR
 * @returns {{
 *   participants: Map<string,{x:number,y:number,width:number,height:number,centerX:number,index:number}>,
 *   rows: Array<{type:string,id?:string,block?:string,section?:number,y:number,height:number}>,
 *   messageY: (id: string) => number,
 *   activations: Array<{id:string,participant:string,startY:number,endY:number}>,
 *   frames: Array<{id:string,x:number,y:number,width:number,height:number,tabWidth:number,sections:Array<{label:string,y:number,width:number}>,depth:number}>,
 *   notes: Map<string,{x:number,y:number,width:number,height:number}>,
 *   totalHeight: number,
 *   warnings: Array<{path:string,message:string}>,
 *   metrics: object
 * }}
 */
export function layoutSequence(ir, m = SEQUENCE_METRICS) {
  const index = new Map(ir.participants.map((p, i) => [p.id, i]));
  const n = ir.participants.length;

  // Column gaps, from one lifeline to the next: at least minGap of clear space between the
  // two headers, widened until every label fits its span.
  const widths = ir.participants.map((p) => headerWidth(p.label, m));
  const gaps = Array.from({ length: Math.max(n - 1, 0) }, (_, i) => (widths[i] + widths[i + 1]) / 2 + m.minGap);
  const spanning = ir.messages
    .filter((msg) => msg.from !== msg.to)
    .map((msg) => ({ lo: Math.min(index.get(msg.from), index.get(msg.to)), hi: Math.max(index.get(msg.from), index.get(msg.to)), need: textWidth(msg.label, m) + 24 }))
    .sort((a, b) => (a.hi - a.lo) - (b.hi - b.lo));
  for (const s of spanning) {
    const span = gaps.slice(s.lo, s.hi).reduce((sum, g) => sum + g, 0);
    if (span < s.need) {
      const extra = (s.need - span) / (s.hi - s.lo);
      for (let k = s.lo; k < s.hi; k++) gaps[k] += extra;
    }
  }
  const participants = new Map();
  let centerX = m.leftMargin + (widths[0] ?? 0) / 2;
  ir.participants.forEach((p, i) => {
    participants.set(p.id, { x: centerX - widths[i] / 2, y: m.topMargin, width: widths[i], height: 0, centerX, index: i });
    if (i < n - 1) centerX += gaps[i];
  });
  const gapRight = (i) => (i < n - 1 ? gaps[i] : m.participantWidth + 160);
  const gapLeft = (i) => (i > 0 ? gaps[i - 1] : m.participantWidth + 160);

  // Blocks: ranges over message indexes, outer blocks first.
  const order = new Map(ir.messages.map((msg, i) => [msg.id, i]));
  const blocks = (ir.blocks ?? []).map((b, i) => {
    const sections = [{ label: `${b.kind} ${b.label}`, ids: b.messages }, ...(b.branches ?? []).map((br) => ({ label: b.kind === 'alt' ? `else ${br.label}` : `and ${br.label}`, ids: br.messages }))]
      .map((s) => {
        const idx = s.ids.map((id) => order.get(id));
        return { label: s.label, start: Math.min(...idx), end: Math.max(...idx) };
      });
    return { id: b.id, index: i, sections, start: sections[0].start, end: sections[sections.length - 1].end, all: [...b.messages, ...(b.branches ?? []).flatMap((br) => br.messages)] };
  });
  const span = (b) => b.end - b.start;
  const outerFirst = (a, b) => span(b) - span(a) || a.index - b.index;
  const innerFirst = (a, b) => outerFirst(b, a);
  for (const b of blocks) b.depth = blocks.filter((o) => o !== b && o.start <= b.start && b.end <= o.end).length;
  const maxDepth = blocks.reduce((d, b) => Math.max(d, b.depth), 0);

  // Notes sit in the gap beside their lifeline; a two-participant note spans both. A note is
  // `noteHeight` tall for one line and grows by a line height for every line its text wraps
  // to at the padded width, so the text stays inside the top and bottom borders. Its y
  // follows from its row.
  const notes = ir.notes ?? [];
  const noteBoxes = new Map();
  for (const note of notes) {
    const first = participants.get(note.participants[0]);
    let left;
    let width;
    if (note.participants.length === 2) {
      const second = participants.get(note.participants[1]);
      left = Math.min(first.centerX, second.centerX) - 20;
      width = Math.abs(second.centerX - first.centerX) + 40;
    } else if ((note.position ?? 'right') === 'left') {
      width = Math.min(gapLeft(first.index) - 24, 220);
      left = first.centerX - 12 - width;
    } else if (note.position === 'over') {
      width = Math.min(gapRight(first.index) - 24, 220);
      left = first.centerX - width / 2;
    } else {
      width = Math.min(gapRight(first.index) - 24, 220);
      left = first.centerX + 12;
    }
    const lines = wrapText(note.label, width - NOTE_PAD.left - NOTE_PAD.right).lines;
    noteBoxes.set(note.id, { x: left, y: 0, width, height: m.noteHeight + m.labelHeight * (lines - 1) });
  }
  const noteRow = (note) => ({ type: 'note', id: note.id, height: noteBoxes.get(note.id).height + m.noteRowGap });

  // Rows.
  const rows = [];
  for (const note of notes) if (note.after === undefined) rows.push(noteRow(note));
  ir.messages.forEach((msg, i) => {
    for (const b of [...blocks].sort(outerFirst)) {
      const k = b.sections.findIndex((s, si) => si > 0 && s.start === i);
      if (k > 0) rows.push({ type: 'section', block: b.id, section: k, height: m.sectionHeight });
    }
    // A block that opens right where another has closed would draw its top edge on that
    // block's bottom edge, and the two frames would read as one; a gap row keeps both lines.
    const opening = blocks.filter((b) => b.start === i).sort(outerFirst);
    if (opening.length > 0 && rows.at(-1)?.type === 'block-close') rows.push({ type: 'gap', height: m.blockGap });
    for (const b of opening) rows.push({ type: 'block-open', block: b.id, height: m.blockOpenHeight });
    // A label of several lines (a `ref` adds one) stands above its arrow, so its row grows.
    rows.push({ type: 'message', id: msg.id, height: m.rowPitch + m.labelHeight * (lineCount(msg.label) - 1) });
    for (const note of notes) if (note.after === msg.id) rows.push(noteRow(note));
    for (const b of blocks.filter((b) => b.end === i).sort(innerFirst)) rows.push({ type: 'block-close', block: b.id, height: m.blockCloseHeight });
  });
  let y = m.topMargin + m.headerHeight + m.rowPitch / 2;
  for (const row of rows) {
    // The arrow of a message keeps half a row pitch below it; extra label lines go above.
    row.y = row.type === 'message' ? y + row.height - m.rowPitch / 2 : y + row.height / 2;
    y += row.height;
  }
  const totalHeight = y + m.bottomMargin;
  for (const p of participants.values()) p.height = totalHeight - m.topMargin;
  const rowOf = (type, key) => rows.find((r) => r.type === type && (type === 'message' || type === 'note' ? r.id === key : r.block === key));
  const messageY = (id) => rowOf('message', id).y;
  for (const [id, box] of noteBoxes) box.y = rowOf('note', id).y - box.height / 2;

  // Activations: a sync call activates the target until a return from it to the caller. A
  // return inside one branch of an alt or par does not end the call for the other branches:
  // the activation runs on to the last message the participant sends or receives in that
  // block, so a reply in an else branch still leaves an active lifeline.
  const activations = [];
  const open = [];
  ir.messages.forEach((msg, i) => {
    const kind = msg.kind ?? 'sync';
    if (kind === 'return') {
      const k = open.findLastIndex((a) => a.participant === msg.from && a.caller === msg.to);
      if (k >= 0) {
        const a = open.splice(k, 1)[0];
        let end = i;
        for (const b of blocks) {
          const section = b.sections.findIndex((s) => s.start <= i && i <= s.end);
          if (section < 0 || section === b.sections.length - 1) continue;
          for (let j = i + 1; j <= b.end; j++) {
            const later = ir.messages[j];
            if (later.from === a.participant || later.to === a.participant) end = Math.max(end, j);
          }
        }
        activations.push({ id: a.id, participant: a.participant, startY: a.startY, endY: messageY(ir.messages[end].id) });
      }
    } else if (kind === 'sync' && msg.from !== msg.to) {
      open.push({ id: `act-${msg.id}`, participant: msg.to, caller: msg.from, startY: messageY(msg.id) });
    }
  });
  for (const a of open) activations.push({ id: a.id, participant: a.participant, startY: a.startY, endY: a.startY + m.rowPitch });

  // Frames span the participants their messages touch, the notes attached to those
  // messages, and the rows from header to close.
  const byId = new Map(ir.messages.map((msg) => [msg.id, msg]));
  const frames = blocks.map((b) => {
    const xs = b.all.flatMap((id) => [participants.get(byId.get(id).from).centerX, participants.get(byId.get(id).to).centerX]);
    const inset = m.frameInset * (maxDepth - b.depth + 1);
    let left = Math.min(...xs) - m.participantWidth / 2 - inset;
    let right = Math.max(...xs) + m.participantWidth / 2 + inset;
    for (const note of notes) {
      if (note.after === undefined || !b.all.includes(note.after)) continue;
      const nb = noteBoxes.get(note.id);
      left = Math.min(left, nb.x - inset);
      right = Math.max(right, nb.x + nb.width + inset);
    }
    const openRow = rowOf('block-open', b.id);
    const closeRow = rows.find((r) => r.type === 'block-close' && r.block === b.id);
    const top = openRow.y - openRow.height / 2;
    const bottom = closeRow.y + closeRow.height / 2;
    const sections = b.sections.map((s, k) => {
      const rowY = k === 0 ? top : rows.find((r) => r.type === 'section' && r.block === b.id && r.section === k).y;
      return { label: s.label, y: rowY, width: textWidth(s.label, m) + 8 };
    });
    return { id: b.id, x: left, y: top, width: right - left, height: bottom - top, tabWidth: sections[0].width, sections, depth: b.depth };
  });

  // Self-check: text boxes that still overlap become warnings.
  const boxes = [];
  for (const f of frames) {
    boxes.push({ what: `label of block "${f.id}"`, x: f.x, y: f.y, width: f.tabWidth + 12, height: 20 });
    f.sections.slice(1).forEach((s, k) => boxes.push({ what: `section ${k + 1} label of block "${f.id}"`, x: f.x, y: s.y - 10, width: s.width + 12, height: 20 }));
  }
  for (const [id, b] of noteBoxes) boxes.push({ what: `note "${id}"`, ...b });
  for (const msg of ir.messages) {
    const from = participants.get(msg.from);
    const to = participants.get(msg.to);
    const w = textWidth(msg.label, m);
    const mid = msg.from === msg.to ? from.centerX + 60 + w / 2 : (from.centerX + to.centerX) / 2;
    const h = m.labelHeight * lineCount(msg.label);
    boxes.push({ what: `label of message "${msg.id}"`, x: mid - w / 2, y: messageY(msg.id) - h - 2, width: w, height: h });
  }
  const warnings = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      if (a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height) {
        warnings.push({ path: '/', message: `layout: ${a.what} overlaps ${b.what}; shorten one of the labels or move the note` });
      }
    }
  }

  return { participants, rows, messageY, activations, frames, notes: noteBoxes, totalHeight, warnings, metrics: m };
}
