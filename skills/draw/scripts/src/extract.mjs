import { extname } from 'node:path';
import { drawioXmlOf, extractDrawio } from './extract-drawio.mjs';
import { extractMermaid } from './extract-mermaid.mjs';
import { extractFigjamBoard, joinBoardParts } from './extract-figjam.mjs';

/**
 * Facts of a source diagram, whatever made it: a draw.io file (`.drawio`, `.xml`,
 * `.drawio.svg`, `.drawio.png`), Mermaid text (`.mmd`, or Markdown with fenced blocks), or the
 * JSON a FigJam board returned through the reader script. The content decides, the name only
 * breaks a tie, so a draw.io file saved as `.xml` or a board saved as `.txt` still reads.
 *
 * Facts, the same shape for every source:
 *   { facts: 1, format: 'drawio'|'mermaid'|'figjam', pages: [{
 *       id, name,
 *       kindHints: [{ kind, score, evidence: string[] }],          best first; empty when nothing fits
 *       nodes: [{ id, label, shape, texts?, parent?, detail?, icon?, group?, link?, dashed?, box? }],
 *       edges: [{ id, label, from, to, startLabel?, endLabel?, fromPart?, toPart?,
 *                 fromInferred?, toInferred?, dashed?, startArrow?, endArrow?, y? }],
 *       warnings: string[] }] }
 *
 * @param {Buffer} buf
 * @param {string} [file]
 * @returns {{ ok: true, facts: object } | { ok: false, error: string }}
 */
export function extractFacts(buf, file = '') {
  const head = buf.subarray(0, 4000).toString('utf8').trimStart();
  if (head.startsWith('{')) return extractBoards([buf]);
  const ext = extname(file).toLowerCase();
  const xmlLike = /<(mxfile|mxGraphModel|svg)\b/.test(head) || buf.subarray(1, 4).toString('latin1') === 'PNG';
  const mermaidLike = ext === '.mmd' || ext === '.mermaid' || ext === '.md' || /^(```\s*mermaid|---\n|%%|(flowchart|graph|sequenceDiagram|stateDiagram|erDiagram|classDiagram|architecture-beta|swimlane)\b)/m.test(head);
  if (!xmlLike && mermaidLike) return { ok: true, facts: extractMermaid(buf.toString('utf8')) };
  const xml = drawioXmlOf(buf);
  if (xml.error) return { ok: false, error: xml.error };
  return { ok: true, facts: extractDrawio(xml.xml) };
}

/**
 * Facts of a FigJam board read in one part or several (`extract` given every part's file).
 * @param {Buffer[]} bufs
 */
export function extractBoards(bufs) {
  const parts = [];
  for (const buf of bufs) {
    let json;
    try {
      json = JSON.parse(buf.toString('utf8'));
    } catch (e) {
      return { ok: false, error: `not valid JSON: ${e.message}` };
    }
    // use_figma may hand the result back wrapped in the call's own envelope.
    const found = findBoard(json);
    if (!found) return { ok: false, error: 'this JSON is not a board read by the FigJam reader script (no "zukaiBoard" field)' };
    parts.push(found);
  }
  const joined = joinBoardParts(parts);
  if (joined.error) return { ok: false, error: joined.error };
  return { ok: true, facts: extractFigjamBoard(joined.board) };
}

function findBoard(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 4) return undefined;
  if (value.zukaiBoard === 1 && Array.isArray(value.nodes)) return value;
  for (const v of Object.values(value)) {
    if (typeof v === 'string' && v.includes('"zukaiBoard"')) {
      try { const inner = findBoard(JSON.parse(v), depth + 1); if (inner) return inner; } catch { /* not JSON */ }
    }
    const inner = findBoard(v, depth + 1);
    if (inner) return inner;
  }
  return undefined;
}
