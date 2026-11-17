import { extname } from 'node:path';
import { drawioXmlOf, extractDrawio } from './extract-drawio.mjs';
import { extractMermaid } from './extract-mermaid.mjs';
import { extractPlantuml, hasPlantumlFence } from './extract-plantuml.mjs';
import { extractFigjamBoard, joinBoardParts } from './extract-figjam.mjs';
import { redactText } from './scan-secrets.mjs';

/**
 * Facts of a source diagram, whatever made it: a draw.io file (`.drawio`, `.xml`,
 * `.drawio.svg`, `.drawio.png`), Mermaid text (`.mmd`, or Markdown with fenced blocks),
 * PlantUML text (`.puml`, `.plantuml`, `.pu`, `.iuml`, or Markdown with fenced blocks), or the
 * JSON a FigJam board returned through the reader script. The content decides, the name only
 * breaks a tie, so a draw.io file saved as `.xml`, a board saved as `.txt` or a PlantUML
 * diagram saved as `.txt` still reads. A Markdown file with fences of both languages gives the
 * pages of both, the Mermaid ones first, under the format `markdown`.
 *
 * Facts, the same shape for every source:
 *   { facts: 1, format: 'drawio'|'mermaid'|'plantuml'|'markdown'|'figjam', pages: [{
 *       id, name, direction?, autonumber?, unsupported?: { type, reason },
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
  if (!xmlLike) {
    const text = buf.toString('utf8');
    const plantuml = extractPlantumlLike(text, ext);
    if (plantuml) return { ok: true, facts: redactFacts(plantuml) };
    if (mermaidLike) return { ok: true, facts: redactFacts(extractMermaid(text)) };
  }
  const xml = drawioXmlOf(buf);
  if (xml.error) return { ok: false, error: xml.error };
  return { ok: true, facts: redactFacts(extractDrawio(xml.xml)) };
}

const PLANTUML_EXTENSIONS = new Set(['.puml', '.plantuml', '.pu', '.iuml']);

/**
 * PlantUML facts when the text is PlantUML: by its extension, by an `@start...` line, or by a
 * ```plantuml fence in Markdown. A Mermaid file never is, whatever a label of it says.
 */
function extractPlantumlLike(text, ext) {
  if (ext === '.mmd' || ext === '.mermaid') return undefined;
  const fenced = hasPlantumlFence(text);
  if (!PLANTUML_EXTENSIONS.has(ext) && !fenced && !/^\s*@start[a-z]+\b/im.test(text)) return undefined;
  const facts = extractPlantuml(text);
  if (!fenced || !/^\s{0,3}(`{3,}|~{3,})\s*mermaid\b/im.test(text)) return facts;
  return { facts: 1, format: 'markdown', pages: [...extractMermaid(text).pages, ...facts.pages] };
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
  return { ok: true, facts: redactFacts(extractFigjamBoard(joined.board)) };
}

/**
 * Facts never hold a credential or personal data read from the source: each such value is
 * replaced by a placeholder (`<redacted credential>`, `<redacted e-mail>`), the page lists
 * where under `sensitive`, and a warning says so. The facts are kept in the run folder, which
 * is committed or sent to a client, and the IR must carry a placeholder there anyway.
 */
export function redactFacts(facts) {
  for (const page of facts.pages) {
    const sensitive = [];
    const clean = (element, field, value) => {
      if (typeof value !== 'string' || value === '') return value;
      const r = redactText(value);
      if (r.kinds.length > 0) sensitive.push({ element, field, kinds: [...new Set(r.kinds)] });
      return r.text;
    };
    page.name = clean(page.id, 'name', page.name);
    for (const n of page.nodes) {
      n.label = clean(n.id, 'label', n.label);
      if (n.texts) n.texts = n.texts.map((t, i) => clean(n.id, `texts/${i}`, t));
    }
    for (const e of page.edges) for (const f of ['label', 'startLabel', 'endLabel']) if (e[f] !== undefined) e[f] = clean(e.id, f, e[f]);
    if (sensitive.length > 0) {
      page.sensitive = sensitive;
      page.warnings.push(`${sensitive.length} text${sensitive.length > 1 ? 's hold' : ' holds'} what looks like a credential or personal data (${[...new Set(sensitive.flatMap((x) => x.kinds))].join(', ')}): the value is replaced by a <redacted ...> placeholder in these facts; the source file itself still holds it`);
    }
  }
  return facts;
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
