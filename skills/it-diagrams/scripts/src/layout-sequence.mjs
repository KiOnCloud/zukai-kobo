/**
 * Deterministic grid layout for sequence diagrams.
 *
 * Columns: participants left to right. The gap between two neighbours grows so that every
 * message label fits between the lifelines it spans. Rows: every message, note, block header,
 * section separator and block end gets a row of its own, so frame labels never sit on top of
 * message labels. Notes take the gap next to their lifeline instead of overlapping the next
 * one. A final pass reports any text boxes that still overlap, so the agent can tell the user.
 */

import { longestLine } from './text-metrics.mjs';

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
  noteHeight: 36,
  noteRowHeight: 48,
  activationWidth: 10,
  frameInset: 16,
  charWidth: 7,
  labelHeight: 16,
};

const textWidth = (text, m) => Math.ceil(longestLine(text) * m.charWidth) + 12;
const lineCount = (text) => String(text).split(/\r\n?|\n/).length;

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

  // Column gaps: at least minGap of clear space, widened until every label fits its span.
  const gaps = Array.from({ length: Math.max(n - 1, 0) }, () => m.participantWidth + m.minGap);
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
  let x = m.leftMargin;
  ir.participants.forEach((p, i) => {
    participants.set(p.id, { x, y: m.topMargin, width: m.participantWidth, height: 0, centerX: x + m.participantWidth / 2, index: i });
    if (i < n - 1) x += gaps[i];
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

  // Rows.
  const notes = ir.notes ?? [];
  const rows = [];
  for (const note of notes) if (note.after === undefined) rows.push({ type: 'note', id: note.id, height: m.noteRowHeight });
  ir.messages.forEach((msg, i) => {
    for (const b of [...blocks].sort(outerFirst)) {
      const k = b.sections.findIndex((s, si) => si > 0 && s.start === i);
      if (k > 0) rows.push({ type: 'section', block: b.id, section: k, height: m.sectionHeight });
    }
    for (const b of blocks.filter((b) => b.start === i).sort(outerFirst)) rows.push({ type: 'block-open', block: b.id, height: m.blockOpenHeight });
    // A label of several lines (a `ref` adds one) stands above its arrow, so its row grows.
    rows.push({ type: 'message', id: msg.id, height: m.rowPitch + m.labelHeight * (lineCount(msg.label) - 1) });
    for (const note of notes) if (note.after === msg.id) rows.push({ type: 'note', id: note.id, height: m.noteRowHeight });
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

  // Notes sit in the gap beside their lifeline; a two-participant note spans both.
  const noteBoxes = new Map();
  for (const note of notes) {
    const row = rowOf('note', note.id);
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
    noteBoxes.set(note.id, { x: left, y: row.y - m.noteHeight / 2, width, height: m.noteHeight });
  }

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
