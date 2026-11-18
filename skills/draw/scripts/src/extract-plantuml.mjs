/**
 * PlantUML extractor for recook: reads PlantUML text (a `.puml` file with one or several
 * `@startuml ... @enduml` diagrams, or Markdown with ```plantuml fences) and turns each diagram
 * into the neutral facts the agent maps to IR. Like the Mermaid reader it is deterministic and
 * dependency-free: a tolerant line reader, not PlantUML itself. A statement it cannot read is a
 * warning naming the line, a diagram type it does not read is a page that says so, and the
 * preprocessor is not run (an `!include` is reported as not followed).
 *
 * PlantUML has no header that names the diagram type: the statements decide. A diagram is read
 * as one of four families (sequence, state, activity in the new syntax, and the description
 * family that class, ER, component, deployment and use case diagrams share), and the kind
 * hints of a description page are scored from what it holds.
 *
 * Every visible text lands in exactly one of a node `label`, a node `texts` entry, an edge
 * `label` / `startLabel` / `endLabel` or the page `name`, because the cover check compares only
 * those fields with the IR. Structure the agent needs besides the text (the keyword an element
 * was declared with, where a note stands, the messages a block spans) goes to `detail`.
 */

import { createGraph, NAMED_ENTITIES } from './extract-mermaid.mjs';

/** Diagram types PlantUML draws from another start tag, and why each is not read. */
const OTHER_STARTS = {
  mindmap: ['mind map', 'Zukai has no mind map kind'],
  wbs: ['work breakdown structure', 'Zukai has no work breakdown kind'],
  gantt: ['Gantt chart', 'Zukai has no Gantt kind'],
  salt: ['Salt wireframe', 'a wireframe is a screen mock-up, not a diagram kind of Zukai'],
  json: ['JSON data', 'a data tree is not a diagram kind of Zukai'],
  yaml: ['YAML data', 'a data tree is not a diagram kind of Zukai'],
  ditaa: ['ditaa drawing', 'ASCII art cannot be read as shapes and lines'],
  dot: ['Graphviz DOT graph', 'DOT is not PlantUML\'s own syntax'],
  nwdiag: ['network diagram (nwdiag)', 'its own syntax is not read'],
  chen: ['Chen ER diagram', 'only the entity syntax of @startuml is read as ER'],
  ebnf: ['EBNF grammar', 'Zukai has no grammar kind'],
  regex: ['regular expression', 'Zukai has no such kind'],
  math: ['formula', 'a formula is not a diagram'],
  latex: ['formula', 'a formula is not a diagram'],
  creole: ['Creole text', 'formatted text is not a diagram'],
  board: ['board', 'Zukai has no such kind'],
  bpm: ['BPM diagram', 'its own syntax is not read'],
  chronology: ['chronology', 'Zukai has no timeline kind'],
  files: ['file tree', 'Zukai has no file tree kind'],
  git: ['git log', 'Zukai has no git graph kind'],
  wire: ['wire diagram', 'its own syntax is not read'],
  timing: ['timing diagram', 'Zukai has no timing kind'],
};

/** Other diagram types written inside `@startuml`, told by their first statements. */
const INLINE_OTHERS = [
  [/^(?:robust|concise|clock|binary|analog)\s+\S/i, 'timing diagram', 'Zukai has no timing kind'],
  [/^salt\b/i, 'Salt wireframe', 'a wireframe is a screen mock-up, not a diagram kind of Zukai'],
  [/^(?:project\s+starts\b|\[[^\]]+\]\s+(?:lasts|starts|ends|requires|happens)\b)/i, 'Gantt chart', 'Zukai has no Gantt kind'],
  [/^nwdiag\s*\{/i, 'network diagram (nwdiag)', 'its own syntax is not read'],
  [/^(?:digraph|graph)\s+\w*\s*\{/i, 'Graphviz DOT graph', 'DOT is not PlantUML\'s own syntax'],
  [/^ditaa\b/i, 'ditaa drawing', 'ASCII art cannot be read as shapes and lines'],
];

const PLANTUML_FENCE = /^\s{0,3}(`{3,}|~{3,})\s*\{?\.?(?:plantuml|puml)\b/i;

/** True when a Markdown text holds a ```plantuml or ```puml fence. */
export const hasPlantumlFence = (text) => String(text).split(/\r\n?|\n/).some((l) => PLANTUML_FENCE.test(l));

/**
 * @param {string} text a PlantUML file, or Markdown holding ```plantuml / ```puml fenced blocks
 * @returns {{ facts: 1, format: 'plantuml', pages: object[] }}
 */
export function extractPlantuml(text, { withLines = false } = {}) {
  const blocks = splitBlocks(String(text ?? ''));
  // `withLines` adds the line each page starts at, for a caller that orders pages of several readers.
  return { facts: 1, format: 'plantuml', pages: blocks.map((b, i) => ({ ...offerConditions(extractPage(b, i + 1)), ...(withLines ? { line: b.line } : {}) })) };
}

const EXTEND = /^\s*(?:«|<<)\s*extends?\s*(?:»|>>)\s*$/i;

/**
 * PlantUML has no field for the condition of an «extend», so authors write it as a note: on
 * the link itself, or beside the use case that extends. Such a note is offered as the
 * `condition` of that edge. It stays a note with its text as well, because whether it is the
 * condition is the reader's call: a note beside a use case with two «extend» lines, or with
 * none, is offered to no edge.
 */
function offerConditions(page) {
  const extend = page.edges.filter((e) => EXTEND.test(e.label ?? ''));
  if (extend.length === 0) return page;
  for (const note of page.nodes) {
    if (note.shape !== 'note' || typeof note.detail !== 'string' || !note.label) continue;
    let edge;
    const onLink = /^on link (\S+)$/.exec(note.detail);
    const beside = /^(?:left|right|top|bottom) of (\S+)$/.exec(note.detail);
    if (onLink) edge = extend.find((e) => e.id === onLink[1]);
    else if (beside) {
      const from = extend.filter((e) => e.from === beside[1]);
      if (from.length === 1) [edge] = from;
    }
    if (edge && edge.condition === undefined) edge.condition = note.label.split('\n').map((l) => l.trim()).filter(Boolean).join(' ');
  }
  return page;
}

// ---------------------------------------------------------------------------------------------
// Blocks and pages

/**
 * Each `@startuml ... @enduml` is a page; so is each `@start<other>` block, which is reported
 * as not read. In Markdown each ```plantuml fence is searched the same way, and a fence without
 * a start tag is one diagram, named by the nearest heading above it. Line numbers stay those of
 * the whole file.
 */
function splitBlocks(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').map((t, i) => ({ text: t, line: i + 1 }));
  if (!lines.some((l) => PLANTUML_FENCE.test(l.text))) return startBlocks(lines, '');
  const blocks = [];
  let heading = '';
  for (let i = 0; i < lines.length; i++) {
    const open = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(lines[i].text);
    if (open) {
      const fence = open[1];
      const close = new RegExp(`^\\s{0,3}${fence[0] === '`' ? '`' : '~'}{${fence.length},}\\s*$`);
      let j = i + 1;
      while (j < lines.length && !close.test(lines[j].text)) j++;
      if (PLANTUML_FENCE.test(lines[i].text)) blocks.push(...startBlocks(lines.slice(i + 1, j), heading, lines[i].line));
      i = j;
      continue;
    }
    const h = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(lines[i].text);
    if (h) heading = h[1].trim();
  }
  return blocks;
}

function startBlocks(lines, heading, at = 1) {
  const out = [];
  let open = null;
  for (const l of lines) {
    const start = /^\s*@start([a-z]+)\b\s*(.*)$/i.exec(l.text);
    if (start) {
      if (open) out.push({ ...open, unclosed: true });
      open = { type: start[1].toLowerCase(), name: start[2].trim().replace(/^"(.*)"$/, '$1'), heading, lines: [], line: l.line };
      continue;
    }
    if (/^\s*@end[a-z]+\b/i.test(l.text)) {
      if (open) out.push(open);
      open = null;
      continue;
    }
    if (open) open.lines.push(l);
  }
  if (open) out.push({ ...open, unclosed: true });
  // Text without any start tag (a fence, or a file some tools accept) is one diagram.
  if (out.length === 0) return [{ type: 'uml', name: '', heading, lines, line: lines[0]?.line ?? at }];
  return out;
}

function extractPage(block, index) {
  const page = { id: `plantuml-${index}`, name: block.name || block.heading || '', kindHints: [], nodes: [], edges: [], warnings: [] };
  const g = createGraph(page);
  if (block.unclosed) g.warn(block.line, `@start${block.type} is not closed with @end${block.type}`);
  if (block.type !== 'uml') {
    const [type, reason] = OTHER_STARTS[block.type] ?? [`@start${block.type} diagram`, 'this diagram type is not read'];
    return unsupported(page, block.line, type, reason);
  }
  const statements = prepare(block.lines, g);
  const first = statements[0];
  if (!first) {
    page.warnings.push('no PlantUML diagram found');
    return page;
  }
  for (const [re, type, reason] of INLINE_OTHERS) if (statements.slice(0, 3).some((s) => re.test(s.text))) return unsupported(page, first.line, type, reason, true);
  const family = detectFamily(statements);
  if (family.name === 'legacy-activity') {
    return unsupported(page, first.line, 'activity diagram in the legacy syntax', 'only the new activity syntax (start, :action;, if ... endif) is read; "(*) --> ..." is not', true);
  }
  if (family.name === 'unknown') {
    g.warn(first.line, 'no statement of a diagram type this reader knows (sequence, class, state, activity, component, deployment, use case, ER); nothing extracted');
    return page;
  }
  if (family.name === 'sequence') parseSequence(statements, g);
  else if (family.name === 'state') parseState(statements, g);
  else if (family.name === 'activity') parseActivity(statements, g);
  else parseStructure(statements, g);
  page.kindHints = kindHints(family.name, page);
  return page;
}

/** A page of a type that is not read: it names the type and the reason, and holds nothing else. */
function unsupported(page, line, type, reason, clear = false) {
  if (clear) {
    page.nodes.length = 0;
    page.edges.length = 0;
  }
  page.unsupported = { type, reason };
  page.warnings.push(`line ${line}: ${type} is not read (${reason}); nothing extracted from this diagram`);
  return page;
}

// ---------------------------------------------------------------------------------------------
// Text decoding

/** Creole and HTML-like tags PlantUML renders as formatting, not as text. */
const FORMAT_TAG = /<\/?(?:b|i|u|s|w|plain|strike|del|sub|sup|code|size|color|back|font|text)(?:[:\s=][^<>]*)?>/gi;

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, body) => {
    if (body[0] !== '#') return NAMED_ENTITIES[body] ?? m;
    const code = /^#x/i.test(body) ? parseInt(body.slice(2), 16) : Number(body.slice(1));
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
  });
}

const unquote = (s) => (s.length >= 2 && s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s);

/** What stays of markup that is common to every text: links, icons, line breaks, tags, entities. */
function decodeMarkup(raw) {
  return decodeEntities(
    String(raw)
      // [[url]] shows the address, [[url text]] the text.
      .replace(/\[\[(\S+?)(?:\s*\{[^}]*\})?(?:\s+([^\]]+))?\]\]/g, (m, url, text) => text ?? url)
      .replace(/<U\+([0-9a-f]{4,6})>/gi, (m, hex) => String.fromCodePoint(parseInt(hex, 16)))
      .replace(/<(?:&|\$)[\w-]+(?:[*,{][^<>]*)?>|<:[\w+-]+:>|<#\w+:[\w+-]+:>|<img\b[^<>]*>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/\\[nlr]|%newline\(\)|%n\(\)/g, '\n')
      .replace(/\\t/g, ' ')
      .replace(FORMAT_TAG, ''),
  );
}

const trimLines = (s) => s.split('\n').map((l) => l.trim()).filter((l) => l !== '').join('\n');

/**
 * The visible text of a label or a note: quotes removed, `\n` and <br> as line breaks, Creole
 * emphasis (**bold**, //italic//, ""mono"", --struck--, __underlined__, ~~waved~~), HTML-like
 * tags, icons and sprites dropped, `<<x>>` shown as «x». Lines that only rule off a section
 * (----, ====) are not text.
 */
function decodeLabel(raw) {
  let s = decodeMarkup(unquote(String(raw ?? '').trim()));
  s = s
    .replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, '$1')
    .replace(/(?<![:\w/])\/\/(?=[^\s/])(.+?)(?<=[^\s/])\/\/(?![\w/])/g, '$1')
    .replace(/""(?=\S)(.+?)(?<=\S)""/g, '$1')
    .replace(/(?<![\w-])--(?=[^\s-])(.+?)(?<=[^\s-])--(?![\w-])/g, '$1')
    .replace(/(?<![\w_])__(?=[^\s_])(.+?)(?<=[^\s_])__(?![\w_])/g, '$1')
    .replace(/~~(?=\S)(.+?)(?<=\S)~~/g, '$1')
    .replace(/<<\s*(?:\([^)]*\)\s*)?([^<>]*?)\s*>>/g, (m, name) => (name ? `«${name}»` : ''));
  return s
    .split('\n')
    .map((l) => l.trim().replace(/^(?:\*+|=+)\s+/, '').replace(/[ \t]{2,}/g, ' '))
    .filter((l) => l !== '' && !/^[-=._~]{2,}$/.test(l))
    .join('\n');
}

/** A member row as written: modifiers that are drawn as a style ({static}) are not text. */
function decodeMember(raw) {
  const s = decodeMarkup(String(raw).trim().replace(/\{(?:static|classifier|abstract|field|method)\}\s*/gi, ''));
  return trimLines(s.replace(/<<\s*([^<>]*?)\s*>>/g, '«$1»'));
}

/** `<<a>> <<b>>` of a declaration: the names, and the text without them. A spot `(S,#red)` is a picture. */
function takeStereotypes(text) {
  const names = [];
  const rest = text.replace(/<<\s*(?:\([^)]*\)\s*)?([^<>]*?)\s*>>/g, (m, name) => {
    if (name.trim()) names.push(name.trim());
    return ' ';
  });
  return { names, rest };
}

// ---------------------------------------------------------------------------------------------
// Statements

const NOTE_START = /^(?:\/\s*)?(?:floating\s+)?[hr]?note\b/i;

/**
 * The statements of one diagram, with what is never part of it taken out: comments (' and
 * /' '/), preprocessor lines, skinparam and <style> blocks, hide/show and the like. Texts that
 * span lines come back as one statement with a `body`: a note, a ref, a legend, a bracketed
 * description, and a multi-line activity action (joined with line breaks). The title names the
 * page; header, footer, caption and legend are free texts; the direction is a page fact.
 */
function prepare(lines, g) {
  const page = g.page;
  const kept = [];
  let inComment = false;
  for (const { text, line } of lines) {
    let rest = text;
    let out = '';
    while (rest !== '') {
      const k = rest.indexOf(inComment ? "'/" : "/'");
      if (k < 0) {
        if (!inComment) out += rest;
        break;
      }
      if (!inComment) out += rest.slice(0, k);
      rest = rest.slice(k + 2);
      inComment = !inComment;
    }
    const t = out.trim();
    if (t === '' || t.startsWith("'")) continue;
    kept.push({ text: t, line });
  }

  const out = [];
  const once = new Set();
  const warnOnce = (key, line, message) => {
    if (once.has(key)) return;
    once.add(key);
    g.warn(line, message);
  };
  const freeText = (detail, text) => {
    const label = decodeLabel(text);
    if (label === '') return;
    const n = g.node(g.fresh(detail), 'text');
    n.label = label;
    n.detail = detail;
  };
  let title;
  for (let i = 0; i < kept.length; i++) {
    const { text: t, line } = kept[i];
    /** The lines up to the one that matches `end`, which is consumed. */
    const until = (end) => {
      const body = [];
      let j = i + 1;
      while (j < kept.length && !end.test(kept[j].text)) body.push(kept[j++].text);
      if (j >= kept.length) g.warn(line, `"${t.slice(0, 40)}" is not closed`);
      i = j;
      return body;
    };
    const skipBraces = () => {
      let depth = 0;
      for (let j = i; j < kept.length; j++) {
        depth += (kept[j].text.match(/\{/g) ?? []).length - (kept[j].text.match(/\}/g) ?? []).length;
        if (depth <= 0) {
          i = j;
          return;
        }
      }
      i = kept.length;
    };

    if (t.startsWith('!')) {
      const inc = /^!(include\w*|import)\s+(.+)$/i.exec(t);
      if (inc) g.warn(line, `!${inc[1]} of ${inc[2].trim()} is not followed: what that file declares is not in these facts`);
      else if (/^!(?:unquoted\s+)?(?:procedure|function)\b/i.test(t)) {
        if (!/!return\b/i.test(t)) until(/^!end\s*(?:procedure|function)\b/i);
        warnOnce('macro', line, 'the preprocessor is not run: a procedure, function, !define or variable is not expanded, a text that uses one is read as written and a line that calls one is reported as unreadable');
      } else if (/^!definelong\b/i.test(t)) {
        until(/^!enddefinelong\b/i);
        warnOnce('macro', line, 'the preprocessor is not run: a procedure, function, !define or variable is not expanded, a text that uses one is read as written and a line that calls one is reported as unreadable');
      } else if (/^!(?:define\b|\$\w+\s*\??=)/i.test(t)) {
        warnOnce('macro', line, 'the preprocessor is not run: a procedure, function, !define or variable is not expanded, a text that uses one is read as written and a line that calls one is reported as unreadable');
      } else if (/^!(?:if|ifdef|ifndef|elseif|else|while|foreach)\b/i.test(t)) {
        warnOnce('conditional', line, 'the preprocessor is not run: the lines of every branch of an !if are read');
      }
      continue;
    }
    if (/^skinparam\b/i.test(t) || /^sprite\b.*\{\s*$/i.test(t)) {
      if (/\{\s*$/.test(t)) skipBraces();
      continue;
    }
    if (/^<style>/i.test(t)) {
      if (!/<\/style>/i.test(t)) until(/<\/style>/i);
      continue;
    }
    const direction = /^(left\s+to\s+right|top\s+to\s+bottom)\s+direction$/i.exec(t);
    if (direction) {
      page.direction = /^left/i.test(direction[1]) ? 'LR' : 'TB';
      continue;
    }
    if (/^(?:hide|show|remove|restore|scale|rotate|skin|sprite|allow_?mixing|set)(?![\p{L}\p{N}_])(?!\s*[-<.])|^page\s+\d/iu.test(t)) continue;
    const titled = /^title(?:\s+(.*))?$/i.exec(t);
    if (titled) {
      title = decodeLabel(titled[1] !== undefined ? titled[1] : until(/^end\s*title$/i).join('\n'));
      continue;
    }
    const band = /^(?:(?:left|right|center)\s+)?(header|footer)(?:\s+(.*))?$/i.exec(t);
    if (band) {
      freeText(band[1].toLowerCase(), band[2] !== undefined ? band[2] : until(new RegExp(`^end\\s*${band[1]}$`, 'i')).join('\n'));
      continue;
    }
    const caption = /^(caption|mainframe)\s+(.*)$/i.exec(t);
    if (caption) {
      freeText(caption[1].toLowerCase(), caption[2]);
      continue;
    }
    if (/^legend(?:\s+(?:top|bottom|left|right|center))*\s*$/i.test(t)) {
      freeText('legend', until(/^end\s*legend$/i).join('\n'));
      continue;
    }
    if (NOTE_START.test(t)) {
      const oneLine = t.replace(/::/g, '').includes(':') || /^[^"]*note\s+"[^"]*"\s+as\s+\S+/i.test(t);
      out.push(oneLine ? { text: t, line } : { text: t, line, body: until(/^end\s*[hr]?note$/i) });
      continue;
    }
    if (/^ref\s+over\b/i.test(t) && !t.includes(':')) {
      out.push({ text: t, line, body: until(/^end\s*ref$/i) });
      continue;
    }
    // A multi-line activity action: ":first line" ... "last line;". An actor ":Name:" is closed on its line.
    if (/^(?:#[\w:.]+)?:/.test(t) && !/;\s*(?:<<[^<>]*>>\s*)?$/.test(t) && !/^:[^:;]+:\s*(?:$|as\b|[-.<*o#x+^=~(]|<<)/.test(t) && !/^:.*[|<>/\\\]}]$/.test(t)) {
      let j = i + 1;
      const body = [t];
      while (j < kept.length && !/;\s*(?:<<[^<>]*>>\s*)?$/.test(kept[j].text)) body.push(kept[j++].text);
      if (j < kept.length) {
        body.push(kept[j].text);
        i = j;
        out.push({ text: body.join('\n'), line });
        continue;
      }
    }
    // `component Name [` opens a description that runs to a line "]".
    if (/[^[]\[\s*$/.test(t) && ELEMENT_RE.test(t)) {
      out.push({ text: t.replace(/\[\s*$/, '').trim(), line, body: until(/^\]/) });
      continue;
    }
    out.push({ text: t, line });
  }
  if (title !== undefined && title !== '') page.name = title.replace(/\n/g, ' ');
  return out;
}

// ---------------------------------------------------------------------------------------------
// Which family a diagram belongs to

const DIRECTION = String.raw`(?:up|down|left|right|u|d|l|r|le|ri|do)`;
const ACTIVITY_SIGNAL = /^(?:start|stop|kill|detach|repeat(?:\s*while\b.*|\s*:[\s\S]*)?|backward\s*:.*|fork(?:\s+again)?|end\s*fork|end\s*merge|split(?:\s+again)?|end\s*split|endif|end\s*while\b.*|endswitch|while\s*\(.*|if\s*\(.*|else\s*if\s*\(.*|switch\s*\(.*|case\s*\(.*|\|(?!\|)[^|]+\|.*|(?:#[\w:.]+)?:[\s\S]*[;|<>/\\\]}]\s*(?:<<[^<>]*>>)?)$/i;
const SEQUENCE_SIGNAL = /^(?:participant|collections|create|activate|deactivate|destroy|autonumber|autoactivate|return|alt|opt|loop|par|par2|critical|group|box|end\s+box|ref\s+over|newpage)\b|^==|^\.\.\.|^\|\|\S*\|\|?$/i;
const SEQUENCE_ARROW = /->>|-\\|-\/|^\[[ox]?<?-|-+>[ox]?\]|<<-|-+>[ox](?:\s|$)|\s[ox]<?-+>|\?<?-|->\?|\s(?:\+\+|--|\*\*|!!)\s*(?:#\w+\s*)?$/;
const STRUCTURE_KEYWORD = /^(?:abstract|class|interface|enum|annotation|struct|exception|protocol|metaclass|dataclass|record|component|node|cloud|artifact|folder|frame|package|namespace|rectangle|usecase\/?|storage|card|agent|file|stack|hexagon|person|object|map|json|together|circle|label|portin|portout|port)\b/i;
const STRUCTURE_BODY = /^(?:entity|database|queue|actor|boundary|control|collections)\b.*\{\s*$/i;
const STRUCTURE_ARROW = new RegExp(String.raw`<\|[-.]|[-.]\|>|\*[-.]|[-.]\*(?=\s|"|$)|(?:^|[\s"])[o#+^x][-.]{2}|[-.]{2}[o#+^](?=[\s"]|$)|\}[o|]?[-.]|[-.][o|]?\{|\|[|o][-.]|[-.][o|]\||[-.]${DIRECTION}[-.]|\.>|<\.|[-.]{3,}|"\s*[-.]{2}|[-.]{2}\s*"|[-.]\(\)?|\(\)[-.]`);
const PLAIN_ARROW = /^(?:"[^"]+"|[\p{L}\p{N}_.$@]+)\s*(?:<-+|-+>|<-+>)/u;

/** The part of a statement before its label, where an arrow or an element name stands. */
const beforeLabel = (t) => (t.startsWith(':') ? t : t.replace(/::/g, '\u0000').split(':')[0].replace(/\u0000/g, '::'));

function detectFamily(statements) {
  const c = { activity: 0, legacy: 0, state: 0, structure: 0, sequence: 0, plain: 0 };
  for (const s of statements) {
    const t = s.text.split('\n')[0];
    if (NOTE_START.test(t)) {
      if (/^(?:\/\s*)?[hr]?note\s+(?:over|across)\b/i.test(t)) c.sequence++;
      continue;
    }
    const head = beforeLabel(t);
    if (/\(\*\)/.test(head) && /-+(?:\[[^\]]*\])?-*>|<-+/.test(head)) c.legacy++;
    else if (ACTIVITY_SIGNAL.test(t) && !/^:[^:;]+:\s*(?:$|as\b|[-.<*o#x+^=~(]|<<)/.test(t)) c.activity++;
    else if (/\[\*\]/.test(head) || /^state\s/i.test(t)) c.state++;
    else if (SEQUENCE_SIGNAL.test(t) || SEQUENCE_ARROW.test(head)) c.sequence++;
    else if (STRUCTURE_KEYWORD.test(t) || STRUCTURE_BODY.test(t) || /^:[^:;]+:/.test(t) || /^\(\)/.test(t) || /(?:^|\s)\[[^\]\[]+\](?=\s|$)/.test(head) || /(?:^|\s)\((?!\*\))[^()]+\)(?=\s|$)/.test(head) || STRUCTURE_ARROW.test(head)) c.structure++;
    else if (PLAIN_ARROW.test(head)) c.plain++;
  }
  if (c.legacy > 0 && c.activity === 0) return { name: 'legacy-activity' };
  // A plain "A -> B: text" is a message when nothing else says otherwise, as in PlantUML.
  const scores = [['structure', c.structure], ['state', c.state], ['sequence', c.sequence], ['activity', c.activity]].sort((a, b) => b[1] - a[1]);
  if (scores[0][1] === 0) return { name: c.plain > 0 ? 'sequence' : 'unknown' };
  return { name: scores[0][0] };
}

// ---------------------------------------------------------------------------------------------
// Names and declarations

const WORD = String.raw`[\p{L}\p{N}_$@]+(?:\.[\p{L}\p{N}_$@]+)*`;
const WORD_START = new RegExp(String.raw`^${WORD}(?:<[^<>{}]*(?:<[^<>]*>[^<>{}]*)*>)?`, 'u');

/** A name at the start of `s`: "quoted", [bracketed], (in parentheses), :actor:, or a word. */
function readName(s) {
  const close = { '"': '"', '[': ']', '(': ')', ':': ':' }[s[0]];
  if (close) {
    const k = s.indexOf(close, 1);
    if (k < 1) return null;
    return { form: s[0], text: s.slice(1, k), end: k + 1 };
  }
  const m = WORD_START.exec(s);
  return m ? { form: 'word', text: m[0], end: m[0].length } : null;
}

/**
 * `Name`, `"Shown name" as alias`, `alias as "Shown name"`, `[Shown] as alias`,
 * `(Shown) as (alias)`: the alias is the id relations use, the other name is what is shown.
 */
function parseDeclaration(rest) {
  const a = readName(rest);
  if (!a) return null;
  let tail = rest.slice(a.end).trimStart();
  let id = a.text;
  let shown = a.text;
  const as = /^as\s+/i.exec(tail);
  if (as) {
    const b = readName(tail.slice(as[0].length));
    if (b) {
      tail = tail.slice(as[0].length + b.end).trimStart();
      if (a.form === 'word' && b.form !== 'word') shown = b.text;
      else id = b.text;
    }
  }
  if (id === a.text && a.form === 'word') id = id.replace(/<.*$/, '');
  return { id: idOf(id), label: decodeLabel(shown), form: a.form, tail };
}

/** An id is the name on one line: a name written with a line break is the same element. */
const idOf = (name) => decodeLabel(name).replace(/\s+/g, ' ');

/** What follows the name of a declaration: stereotypes, a colour, a link, `extends`, an opening brace. */
function parseTail(tail) {
  const st = takeStereotypes(tail.replace(/\[\[[^\]]*\]\]/g, ' '));
  let rest = st.rest;
  const inline = /\{(.*)\}\s*$/.exec(rest);
  if (inline) rest = rest.slice(0, inline.index);
  const open = !inline && /\{\s*$/.test(rest);
  if (open) rest = rest.replace(/\{\s*$/, '');
  const list = (m) => (m ? m[1].split(',').map((x) => x.trim()).filter(Boolean) : []);
  return {
    stereotypes: st.names,
    open,
    inline: inline ? inline[1].trim() : undefined,
    parents: list(/\bextends\s+(.+?)(?=\s+implements\b|\s*$)/i.exec(rest)),
    interfaces: list(/\bimplements\s+(.+?)(?=\s+extends\b|\s*$)/i.exec(rest)),
    order: /\border\s+(-?\d+)/i.exec(rest)?.[1],
  };
}

// ---------------------------------------------------------------------------------------------
// Notes shared by the description, state and activity families

/**
 * `note left of X : text`, `note right : text` (of the element before it), `note "text" as N`,
 * `note as N` ... `end note`, `note on link : text`. The note is a node; `detail` says where
 * it stands. Returns false when the statement is no note.
 */
function readNote(s, g, ctx) {
  const t = s.text.replace(/^\/\s*/, '').replace(/^floating\s+/i, '');
  if (!/^[hr]?note\b/i.test(t)) return false;
  const text = (inline) => decodeLabel(s.body ? s.body.join('\n') : inline ?? '');
  const make = (id, label, detail) => {
    const n = g.node(id ?? g.fresh('note'), 'note', ctx.parent());
    n.shape = 'note';
    n.label = label;
    if (detail) n.detail = detail;
    return true;
  };
  let m;
  if ((m = /^[hr]?note\s+("[^"]*")\s+as\s+(\S+)/i.exec(t))) return make(m[2], decodeLabel(m[1]));
  if ((m = /^[hr]?note\s+as\s+(\S+)/i.exec(t))) return make(m[1], text());
  if ((m = /^[hr]?note\s+on\s+link\b[^:]*(?::\s*(.*))?$/i.exec(t))) {
    const e = ctx.lastEdge();
    return make(undefined, text(m[1]), e ? `on link ${e.id}` : 'on link');
  }
  if ((m = /^[hr]?note\s+(left|right|top|bottom)(?:\s+of\s+((?:"[^"]+"|\[[^\]]+\]|\([^)]+\)|[^\s:#]+(?:::[^\s:#]+)?)))?\s*(?:#\S+\s*)?(?::\s*(.*))?$/i.exec(t))) {
    const target = m[2] !== undefined ? ctx.resolve(m[2]) : ctx.lastElement();
    return make(undefined, text(m[3]), target ? `${m[1].toLowerCase()} of ${target}` : m[1].toLowerCase());
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// Class, ER, component, deployment and use case diagrams

/** The keyword an element is declared with: its shape, and the finer kind kept as `detail`. */
const ELEMENTS = {
  class: ['table'], 'abstract class': ['table', 'abstract'], abstract: ['table', 'abstract'], interface: ['table', 'interface'],
  enum: ['table', 'enum'], annotation: ['table', 'annotation'], struct: ['table', 'struct'], exception: ['table', 'exception'],
  protocol: ['table', 'protocol'], metaclass: ['table', 'metaclass'], dataclass: ['table', 'dataclass'], record: ['table', 'record'],
  entity: ['table', 'entity'],
  component: ['box', 'component'], node: ['box', 'node'], artifact: ['box', 'artifact'], file: ['box', 'file'], folder: ['box', 'folder'],
  frame: ['box', 'frame'], package: ['box', 'package'], rectangle: ['box', 'rectangle'], card: ['box', 'card'], namespace: ['box', 'namespace'],
  agent: ['box', 'agent'], stack: ['box', 'stack'], hexagon: ['box', 'hexagon'], boundary: ['box', 'boundary'], control: ['box', 'control'],
  collections: ['box', 'collections'], port: ['box', 'port'], portin: ['box', 'port'], portout: ['box', 'port'], participant: ['box'],
  database: ['store'], storage: ['store', 'storage'], queue: ['queue'], cloud: ['cloud'],
  actor: ['actor'], 'actor/': ['actor', 'business'], person: ['actor', 'person'],
  usecase: ['ellipse', 'usecase'], 'usecase/': ['ellipse', 'business usecase'], circle: ['ellipse', 'interface'], label: ['text'],
};
const CLASS_KEYWORDS = new Set(Object.entries(ELEMENTS).filter(([, v]) => v[0] === 'table').map(([k]) => k));
const ELEMENT_RE = new RegExp(`^(abstract\\s+class|${Object.keys(ELEMENTS).filter((k) => !k.includes(' ')).sort((a, b) => b.length - a.length).map((k) => k.replace('/', '\\/')).join('|')})\\s+(.*)$`, 'iu');

const END_NAME = String.raw`"[^"]+"|\[[^\]\[]+\]|\((?!\))[^()]+\)|:[^:\s][^:]*:|\(\)\s*"[^"]+"|\(\)\s*${WORD}|${WORD}(?:<[^\s>]*>)?(?:::[\p{L}\p{N}_$@]+)?`;
const HEAD_LEFT = String.raw`<\||<<|<|\*|#|\+|\^|\}o|\}\||\|\||\|o|\}|\(\)|\(|\)|(?<=[\s"])(?:o|x)`;
const HEAD_RIGHT = String.raw`\|>|>>|>|\*|#|\+|\^|o\{|\|\{|\|\||o\||\{|\(\)|\(|\)|(?:o|x)(?=[\s"]|$)`;
const SHAFT = String.raw`[-.=~]+(?:\[[^\]]*\])?(?:${DIRECTION}(?=[-.=~\[]))?(?:\[[^\]]*\])?[-.=~]*`;
const RELATION = new RegExp(String.raw`^(${END_NAME})\s*(?:"([^"]*)")?\s*(${HEAD_LEFT})?(${SHAFT})(${HEAD_RIGHT})?\s*(?:"([^"]*)"\s*)?(${END_NAME})\s*(?::\s*(.*))?$`, 'u');

/** Line ends in the words the facts use for every source. */
const HEADS = {
  '<|': 'block-open', '|>': 'block-open', '^': 'block-open', '<': 'open', '>': 'open', '<<': 'open', '>>': 'open',
  '*': 'diamond', o: 'diamond-open', '#': 'box', x: 'cross', '+': 'plus', '()': 'circle', '(': 'socket', ')': 'socket',
  '||': 'ERmandOne', '|o': 'ERzeroToOne', 'o|': 'ERzeroToOne', '}|': 'ERoneToMany', '|{': 'ERoneToMany', '}o': 'ERzeroToMany', 'o{': 'ERzeroToMany', '}': 'ERmany', '{': 'ERmany',
};

/** `contains >` and `< owned by`: the triangle only says which way to read the label. */
const stripReadingArrow = (label) => label.replace(/^\s*[<>]\s+/, '').replace(/\s+[<>]\s*$/, '');

function parseStructure(statements, g) {
  const stack = []; // { kind: 'container' | 'body' | 'skip' | 'transparent', ... }
  const implicit = new Set();
  const byLabel = new Map();
  let lastElement;
  const parent = () => stack.findLast((x) => x.kind === 'container')?.id;
  const known = (name) => (g.get(name) ? name : byLabel.get(name));

  const declare = (id, shape, detail, label, stereotypes = []) => {
    const n = g.node(id, shape, parent());
    implicit.delete(id);
    n.shape = shape;
    if (label !== undefined) n.label = label;
    if (detail) n.detail = detail;
    else delete n.detail;
    for (const name of stereotypes) g.text(n, `«${name}»`);
    byLabel.set(n.label.replace(/\s+/g, ' '), id);
    lastElement = id;
    return n;
  };
  /** The node an end of a relation names, made when it is met here first. */
  const refer = (token) => {
    let m;
    const find = (name, shape, detail) => {
      const id = known(idOf(name)) ?? idOf(name);
      if (!g.get(id)) {
        const n = g.node(id, shape ?? 'box', parent());
        n.label = decodeLabel(name);
        if (detail) n.detail = detail;
        if (!shape) implicit.add(id);
        byLabel.set(id, id);
      }
      return { id };
    };
    if ((m = /^\[(.+)\]$/.exec(token))) return find(m[1], 'box', 'component');
    if ((m = /^\((.+)\)$/.exec(token))) return find(m[1], 'ellipse', 'usecase');
    if ((m = /^:(.+):$/.exec(token))) return find(m[1], 'actor');
    if ((m = /^\(\)\s*(.+)$/.exec(token))) return find(unquote(m[1]), 'ellipse', 'interface');
    if (token.startsWith('"')) return find(unquote(token));
    m = /^(.*?)(?:::(.+))?$/.exec(token);
    const hit = find(m[1].replace(/<.*$/, ''));
    return m[2] ? { ...hit, part: m[2] } : hit;
  };
  const ctx = { parent, lastElement: () => lastElement, lastEdge: () => g.page.edges.at(-1), resolve: (token) => refer(token).id };

  const closeBody = (body) => {
    if (!body.entity) return;
    const parts = ['entity'];
    if (body.keys.length) parts.push(`key: ${body.keys.join(', ')}`);
    if (body.mandatory.length) parts.push(`mandatory: ${body.mandatory.join(', ')}`);
    body.node.detail = parts.join('; ');
  };
  const memberRow = (body, raw) => {
    const sep = /^(--+|\.\.+|==+|__+)(?:\s*(.*?)\s*\1)?$/.exec(raw);
    if (sep) {
      // In an entity the rows above the first rule are the key.
      if (body.entity && !body.ruled) body.keys = [...body.rows];
      body.ruled = true;
      if (sep[2]) g.text(body.node, decodeLabel(sep[2]));
      return;
    }
    const star = body.entity && /^\*\s*\S/.test(raw);
    const text = decodeMember(star ? raw.replace(/^\*\s*/, '') : raw);
    if (text === '') return;
    const name = /^[+\-#~]?\s*([^\s:(]+)/.exec(text)?.[1] ?? text;
    body.rows.push(name);
    if (star) body.mandatory.push(name);
    g.text(body.node, text);
  };

  for (const s of statements) {
    const t = s.text;
    const top = stack.at(-1);
    if (top?.kind === 'skip') {
      top.depth += (t.match(/\{/g) ?? []).length - (t.match(/\}/g) ?? []).length;
      if (top.depth <= 0) stack.pop();
      continue;
    }
    if (top?.kind === 'body') {
      if (t === '}') closeBody(stack.pop());
      else memberRow(top, t);
      continue;
    }
    if (t === '}') {
      if (stack.length === 0) g.warn(s.line, '"}" without an open block');
      stack.pop();
      continue;
    }
    if (readNote(s, g, ctx)) continue;
    if (/^together\s*\{$/i.test(t)) {
      stack.push({ kind: 'transparent' });
      continue;
    }
    const other = /^(object|map|json|diamond)\b\s*(.*)$/i.exec(t);
    if (other) {
      g.warn(s.line, `${other[1].toLowerCase()} "${other[2].replace(/\s*\{\s*$/, '').slice(0, 40)}" is not read: object diagrams and data blocks have no Zukai kind`);
      if (/\{\s*$/.test(t)) stack.push({ kind: 'skip', depth: 1 });
      continue;
    }

    const keyword = ELEMENT_RE.exec(t);
    const shorthand = !keyword && (/^[[(:]/.test(t) || /^\(\)/.test(t)) && !RELATION.test(t);
    if (keyword || shorthand) {
      const word = keyword ? keyword[1].toLowerCase().replace(/\s+/g, ' ') : t.startsWith('()') ? 'circle' : t[0] === '[' ? 'component' : t[0] === '(' ? 'usecase' : 'actor';
      const d = parseDeclaration(keyword ? keyword[2] : t.startsWith('()') ? t.slice(2).trim() : t);
      if (d) {
        const [shape, detail] = ELEMENTS[word];
        const tail = parseTail(d.tail);
        const isClass = CLASS_KEYWORDS.has(word);
        const label = s.body ? decodeLabel(s.body.join('\n')) : d.label;
        if (tail.open && !isClass) {
          const n = declare(d.id, 'container', word, label, tail.stereotypes);
          stack.push({ kind: 'container', id: n.id });
        } else {
          const n = declare(d.id, shape, detail, label, tail.stereotypes);
          if (isClass) {
            const body = { kind: 'body', node: n, entity: word === 'entity', rows: [], keys: [], mandatory: [], ruled: false };
            if (tail.open) stack.push(body);
            else if (tail.inline) {
              memberRow(body, tail.inline);
              closeBody(body);
            }
          }
          for (const p of tail.parents) g.edge({ from: n.id, to: refer(p).id, endArrow: 'block-open' });
          for (const p of tail.interfaces) g.edge({ from: n.id, to: refer(p).id, dashed: true, endArrow: 'block-open' });
        }
        continue;
      }
    }

    const rel = RELATION.exec(t);
    if (rel) {
      const [, a, leftText, leftHead, shaft, rightHead, rightText, b, text] = rel;
      const from = refer(a);
      const to = refer(b);
      // [hidden] only pulls two elements together: nothing is drawn.
      if (/\[[^\]]*hidden[^\]]*\]/i.test(shaft)) continue;
      const e = g.edge({ label: stripReadingArrow(decodeLabel(text ?? '')), from: from.id, to: to.id });
      if (leftText) e.startLabel = decodeLabel(leftText);
      if (rightText) e.endLabel = decodeLabel(rightText);
      if (from.part) e.fromPart = from.part;
      if (to.part) e.toPart = to.part;
      if (/[.~]/.test(shaft.replace(/\[[^\]]*\]/g, '')) || /\[[^\]]*(?:dashed|dotted)[^\]]*\]/i.test(shaft)) e.dashed = true;
      if (leftHead) e.startArrow = HEADS[leftHead];
      e.endArrow = rightHead ? HEADS[rightHead] : 'none';
      continue;
    }

    const member = new RegExp(String.raw`^("[^"]+"|${WORD})\s*:\s*(.+)$`, 'u').exec(t);
    if (member) {
      const n = g.get(refer(member[1]).id);
      const text = decodeMember(member[2]);
      if (text) g.text(n, text);
      continue;
    }
    g.warn(s.line, `unreadable statement "${t.slice(0, 60)}"`);
  }
  for (const open of stack) {
    if (open.kind === 'body') closeBody(open);
    g.warn(statements.at(-1)?.line ?? 0, open.kind === 'body' ? `"${open.node.id}" is not closed with "}"` : 'a block is not closed with "}"');
  }

  // What a name met only in a relation is depends on the diagram: a class beside classes and
  // on class or crow's-foot arrows, a plain box in a component or use case diagram.
  const nodes = g.page.nodes;
  const described = nodes.some((n) => !implicit.has(n.id) && ['box', 'store', 'queue', 'cloud', 'actor', 'ellipse', 'container'].includes(n.shape) && n.detail !== 'package' && n.detail !== 'namespace');
  const isEntity = (n) => /^entity\b/.test(n.detail ?? '');
  const declaredTables = nodes.filter((n) => n.shape === 'table' && !implicit.has(n.id));
  const allEntities = declaredTables.length > 0 && declaredTables.every(isEntity);
  for (const id of implicit) {
    if (described) continue;
    g.get(id).shape = 'table';
    if (allEntities) g.get(id).detail = 'entity';
  }
  // `interface` is a class-like box in a class diagram and a lollipop in a component diagram.
  const classes = nodes.some((n) => n.shape === 'table' && n.detail !== 'interface' && !isEntity(n));
  for (const n of nodes) {
    if (n.shape === 'table' && n.detail === 'interface' && !n.texts?.some((x) => !x.startsWith('«')) && described && !classes) n.shape = 'ellipse';
  }
}

// ---------------------------------------------------------------------------------------------
// State diagrams

const STATE_END = String.raw`\[\*\]|(?:${WORD})?\[H\*?\]|${WORD}`;
const STATE_TRANSITION = new RegExp(String.raw`^(${STATE_END})\s*(<)?(-+(?:\[[^\]]*\])?(?:${DIRECTION}(?=-))?-*)(>)?\s*(${STATE_END})\s*(?::\s*(.*))?$`, 'u');
const STATE_KINDS = { choice: 'decision', fork: 'bar', join: 'bar', start: 'initial', end: 'final' };

function parseState(statements, g) {
  const stack = [];
  const scoped = new Map(); // "<scope>/initial" -> node id
  let lastElement;
  const scope = () => stack.at(-1);
  const state = (id) => {
    lastElement = id;
    return g.node(id, 'rounded', scope());
  };
  const endpoint = (raw, asSource) => {
    if (raw === '[*]') {
      // One start and one end per composite, as drawn.
      const kind = asSource ? 'initial' : 'final';
      const key = `${scope() ?? ''}/${kind}`;
      if (!scoped.has(key)) {
        const n = g.node(g.fresh(kind), kind, scope());
        n.label = '';
        scoped.set(key, n.id);
      }
      return scoped.get(key);
    }
    const history = /^(.*)\[(H\*?)\]$/.exec(raw);
    if (history) {
      const owner = history[1] || scope();
      const id = `${owner ?? ''}[${history[2]}]`;
      if (!g.get(id)) {
        if (history[1]) state(history[1]);
        const n = g.node(id, 'ellipse', owner);
        n.label = history[2];
        n.detail = history[2] === 'H' ? 'history' : 'deep history';
      }
      return id;
    }
    return state(raw).id;
  };
  const ctx = { parent: scope, lastElement: () => lastElement, lastEdge: () => g.page.edges.at(-1), resolve: (token) => state(unquote(token)).id };

  for (const s of statements) {
    const t = s.text;
    if (t === '}') {
      if (stack.length === 0) g.warn(s.line, '"}" without an open composite state');
      stack.pop();
      continue;
    }
    if (t === '--' || t === '||') {
      const owner = scope() && g.get(scope());
      if (owner) owner.detail = 'concurrent regions';
      else g.warn(s.line, 'a region separator outside a composite state');
      continue;
    }
    if (readNote(s, g, ctx)) continue;
    const decl = /^state\s+(.*)$/i.exec(t);
    if (decl) {
      // `state Name : description` is a declaration and a description in one.
      const described = /^("[^"]+"|[^\s:{<#]+)\s*:\s*(.*)$/.exec(decl[1]);
      const d = parseDeclaration(described ? described[1] : decl[1]);
      if (d) {
        const tail = parseTail(d.tail);
        const n = state(d.id);
        if (d.label !== d.id) n.label = d.label;
        for (const name of tail.stereotypes) {
          const kind = STATE_KINDS[name.toLowerCase()];
          if (kind) {
            n.shape = kind;
            n.label = '';
            if (kind === 'bar') n.detail = name.toLowerCase();
          } else if (/^(?:entrypoint|exitpoint|inputpin|outputpin|expansioninput|expansionoutput|history|history\*)$/i.test(name)) {
            n.shape = 'ellipse';
            n.detail = name;
          } else g.text(n, `«${name}»`);
        }
        if (described) g.text(n, decodeLabel(described[2]));
        if (tail.open) {
          n.shape = 'container';
          stack.push(n.id);
        }
        continue;
      }
    }
    const tr = STATE_TRANSITION.exec(t);
    if (tr && (tr[2] || tr[4])) {
      const [, a, back, shaft, , b, text] = tr;
      // `B <-- A` is the transition from A to B.
      const [src, dst] = back && !tr[4] ? [b, a] : [a, b];
      if (/\[[^\]]*hidden[^\]]*\]/i.test(shaft)) {
        endpoint(src, true);
        endpoint(dst, false);
        continue;
      }
      const from = endpoint(src, true);
      const to = endpoint(dst, false);
      const e = g.edge({ label: decodeLabel(text ?? ''), from, to, endArrow: 'block' });
      if (/\[[^\]]*(?:dashed|dotted)[^\]]*\]/i.test(shaft)) e.dashed = true;
      continue;
    }
    const desc = new RegExp(String.raw`^(${WORD})\s*:\s*(.*)$`, 'u').exec(t);
    if (desc) {
      g.text(state(desc[1]), decodeLabel(desc[2]));
      continue;
    }
    if (new RegExp(`^${WORD}$`, 'u').test(t)) {
      state(t);
      continue;
    }
    g.warn(s.line, `unreadable statement "${t.slice(0, 60)}"`);
  }
  if (stack.length) g.warn(statements.at(-1)?.line ?? 0, `composite state "${stack.at(-1)}" is not closed with "}"`);
}

// ---------------------------------------------------------------------------------------------
// Sequence diagrams

const SEQ_KEYWORDS = 'participant|actor|boundary|control|entity|database|collections|queue';
const SEQ_NAME = String.raw`"[^"]+"|[\p{L}\p{N}_$@.]+`;
const SEQ_MESSAGE = new RegExp(
  String.raw`^(?:&\s*)?(${SEQ_NAME})?\s*(\[|\?)?((?<=^|[\s\[?])[ox])?(<<|<|\\\\|\/\/|\\|\/)?(-+)(?:\[[^\]]*\])?(-*)(>>|>|\\\\|\/\/|\\|\/)?([ox](?=[\s\]?"]|$))?(\]|\?)?\s*(${SEQ_NAME})?\s*((?:\+\+|--|\*\*|!!)(?:\s*(?:\+\+|--))?)?\s*(?:#\w+\s*)?(?::\s?(.*))?$`,
  'u',
);
const SEQ_HEADS = { '>': 'block', '<': 'block', '>>': 'open', '<<': 'open', '\\': 'open', '/': 'open', '\\\\': 'open', '//': 'open' };

/**
 * Participants are lifelines in the order they are declared or first used; messages are edges
 * with `y` = their order, `from` the sender whatever way the arrow is written; a `return` is
 * the dashed reply of the call it answers. Blocks are frames as in the Mermaid reader (`label`
 * the condition, `texts` the conditions of the else sections, `detail` the messages each
 * section spans); notes, dividers, delays and refs are nodes whose `detail` says where they
 * stand.
 */
function parseSequence(statements, g) {
  const page = g.page;
  const stack = []; // { type: 'box' | 'frame', node, sections }
  const frames = [];
  const calls = []; // open activations: { caller, callee }
  const byLabel = new Map();
  const orders = new Map();
  let order = 0;
  let autoactivate = false;
  const box = () => stack.findLast((x) => x.type === 'box')?.node.id;
  const frame = () => stack.findLast((x) => x.type === 'frame');
  const after = () => (page.edges.length ? `; after ${page.edges.at(-1).id}` : '');
  const participant = (raw) => {
    const name = idOf(unquote(raw));
    const id = g.get(name) ? name : byLabel.get(name) ?? name;
    if (!g.get(id)) g.node(id, 'lifeline', box()).detail = 'participant';
    return g.get(id);
  };
  const marker = (prefix, label, detail) => {
    const n = g.node(g.fresh(prefix), prefix === 'note' ? 'note' : prefix === 'ref' ? 'frame' : 'text', frame()?.node.id);
    n.label = label;
    n.detail = detail;
    return n;
  };
  const message = (from, to, label, fields = {}) => {
    const e = g.edge({ label, from, to, y: order++, ...fields });
    for (const x of stack) if (x.type === 'frame') x.sections.at(-1).edges.push(e.id);
    return e;
  };

  for (const s of statements) {
    const t = s.text;
    let m;
    if ((m = new RegExp(`^(?:create\\s+)?(${SEQ_KEYWORDS})\\s+(.*)$`, 'i').exec(t)) || (m = /^create\s+()(.*)$/i.exec(t))) {
      const d = parseDeclaration(m[2]);
      if (d) {
        const tail = parseTail(d.tail);
        const n = participant(d.id);
        n.label = s.body ? decodeLabel(s.body.join('\n')) : d.label;
        if (m[1]) n.detail = m[1].toLowerCase();
        for (const name of tail.stereotypes) g.text(n, `«${name}»`);
        if (tail.order !== undefined) orders.set(n.id, Number(tail.order));
        byLabel.set(n.label.replace(/\s+/g, ' '), n.id);
        continue;
      }
    }
    if ((m = /^box(?:\s+(.*))?$/i.exec(t))) {
      const n = g.node(g.fresh('box'), 'group');
      n.label = decodeLabel(unquoteFirst((m[1] ?? '').replace(/\s*#\S+\s*$/, '')));
      stack.push({ type: 'box', node: n });
      continue;
    }
    if (/^end\s*box$/i.test(t)) {
      if (stack.at(-1)?.type === 'box') stack.pop();
      else g.warn(s.line, '"end box" without an open box');
      continue;
    }
    if ((m = /^(alt|opt|loop|par|par2|break|critical|group)(?![\p{L}\p{N}_])\s*(.*)$/iu.exec(t))) {
      const n = g.node(g.fresh('frame'), 'frame', frame()?.node.id);
      let text = m[2].replace(/^#\S+\s*/, '');
      // `group Title [second title]` shows both.
      const second = m[1].toLowerCase() === 'group' ? /^(.*?)\s*\[(.*)\]\s*$/.exec(text) : null;
      if (second) text = second[1];
      n.label = decodeLabel(text);
      if (second) g.text(n, decodeLabel(second[2]));
      const f = { type: 'frame', node: n, sections: [{ keyword: m[1].toLowerCase().replace('par2', 'par'), edges: [] }] };
      stack.push(f);
      frames.push(f);
      continue;
    }
    if ((m = /^(else|also)(?![\p{L}\p{N}_])\s*(.*)$/iu.exec(t))) {
      const f = frame();
      if (!f) {
        g.warn(s.line, `"${m[1]}" outside a block`);
        continue;
      }
      g.text(f.node, decodeLabel(m[2].replace(/^#\S+\s*/, '')));
      f.sections.push({ keyword: f.sections[0].keyword === 'par' ? 'and' : 'else', edges: [] });
      continue;
    }
    if (/^end(?:\s+(?:alt|opt|loop|par|break|critical|group))?$/i.test(t)) {
      if (stack.at(-1)?.type === 'frame') stack.pop();
      else g.warn(s.line, '"end" without an open block');
      continue;
    }
    if ((m = /^(?:\/\s*)?[hr]?note\s+(left|right|over|across)(?:\s+of)?\s*([^:#]*?)\s*(?:#\S+\s*)?(?::\s*(.*))?$/i.exec(t))) {
      const who = m[2].split(',').map((p) => p.trim()).filter(Boolean).map((p) => participant(p).id);
      const where = m[1].toLowerCase();
      const place = where === 'over' || where === 'across' || who.length === 0 ? where : `${where} of`;
      marker('note', decodeLabel(s.body ? s.body.join('\n') : m[3] ?? ''), `${place}${who.length ? ` ${who.join(',')}` : ''}${after()}`);
      continue;
    }
    if ((m = /^ref\s+over\s+([^:#]*?)\s*(?:#\S+\s*)?(?::\s*(.*))?$/i.exec(t))) {
      const who = m[1].split(',').map((p) => p.trim()).filter(Boolean).map((p) => participant(p).id);
      marker('ref', decodeLabel(s.body ? s.body.join('\n') : m[2] ?? ''), `ref over ${who.join(',')}${after()}`);
      continue;
    }
    if ((m = /^==+\s*(.*?)\s*==+$/.exec(t))) {
      marker('divider', decodeLabel(m[1]), `divider${after()}`);
      continue;
    }
    if ((m = /^\.{3}\s*(.*?)\s*(?:\.{3})?$/.exec(t))) {
      if (m[1]) marker('delay', decodeLabel(m[1]), `delay${after()}`);
      continue;
    }
    if (/^\|\|\S*\|\|?$/.test(t)) continue;
    if ((m = /^newpage(?:\s+(.*))?$/i.exec(t))) {
      if (m[1]) marker('divider', decodeLabel(m[1]), `new page${after()}`);
      continue;
    }
    if ((m = /^autonumber\b\s*(.*)$/i.exec(t))) {
      if (!/^stop\b/i.test(m[1])) page.autonumber = true;
      continue;
    }
    if ((m = /^autoactivate\s+(on|off)$/i.exec(t))) {
      autoactivate = m[1].toLowerCase() === 'on';
      continue;
    }
    if ((m = /^activate\s+(.+?)\s*(?:#\S+)?$/i.exec(t))) {
      const callee = participant(m[1]).id;
      const last = page.edges.at(-1);
      calls.push({ callee, caller: last && last.to === callee ? last.from : undefined });
      continue;
    }
    if ((m = /^(?:deactivate|destroy)\s+(.+?)\s*$/i.exec(t))) {
      const callee = participant(m[1]).id;
      const k = calls.findLastIndex((c) => c.callee === callee);
      if (k >= 0) calls.splice(k, 1);
      continue;
    }
    if ((m = /^return(?![\p{L}\p{N}_])\s*(.*)$/iu.exec(t))) {
      const call = calls.pop();
      if (!call || call.caller === undefined || call.caller === null) g.warn(s.line, `"return ${m[1].slice(0, 40)}" answers no activated call (activate or ++ before it); not read`);
      else message(call.callee, call.caller, decodeLabel(m[1]), { dashed: true, endArrow: 'block' });
      continue;
    }
    if ((m = SEQ_MESSAGE.exec(t)) && (m[4] || m[7]) && (m[1] || m[2]) && (m[10] || m[9])) {
      const [, left, , leftMark, tail, dash1, dash2, head, rightMark, , right, act, text] = m;
      const a = left ? participant(left).id : null;
      const b = right ? participant(right).id : null;
      // `A <- B` is a message from B to A.
      const reversed = tail && !head;
      const [from, to] = reversed ? [b, a] : [a, b];
      const fields = {};
      if ((dash1 + dash2).length >= 2) fields.dashed = true;
      if (tail && head) fields.startArrow = SEQ_HEADS[tail];
      fields.endArrow = (reversed ? leftMark : rightMark) === 'x' ? 'cross' : SEQ_HEADS[reversed ? tail : head];
      const e = message(from, to, decodeLabel(text ?? ''), fields);
      if (from === null || to === null) g.warn(s.line, `message ${e.id} ${from === null ? 'comes from' : 'goes'} outside the diagram: that end is open`);
      const marks = act ?? '';
      if (/--/.test(marks)) {
        const k = calls.findLastIndex((c) => c.callee === from);
        if (k >= 0) calls.splice(k, 1);
      }
      if ((/\+\+/.test(marks) || (autoactivate && !fields.dashed)) && to !== null) calls.push({ callee: to, caller: from });
      continue;
    }
    g.warn(s.line, `unreadable statement "${t.slice(0, 60)}"`);
  }
  if (stack.length) g.warn(statements.at(-1)?.line ?? 0, 'a block or box is not closed with "end"');
  for (const f of frames) {
    f.node.detail = f.sections
      .map((sec) => {
        const span = sec.edges.length === 0 ? '' : sec.edges.length === 1 ? ` ${sec.edges[0]}` : ` ${sec.edges[0]}..${sec.edges.at(-1)}`;
        return `${sec.keyword}${span}`;
      })
      .join(' | ');
  }
  // `order N` places a participant: the lifelines keep the order in which they are drawn.
  if (orders.size > 0) {
    const lifelines = page.nodes.filter((n) => n.shape === 'lifeline');
    const sorted = [...lifelines].sort((x, y) => (orders.get(x.id) ?? 0) - (orders.get(y.id) ?? 0));
    let k = 0;
    page.nodes.forEach((n, i) => {
      if (n.shape === 'lifeline') page.nodes[i] = sorted[k++];
    });
  }
}

/** `"Title" rest` -> `Title rest`: the title of a box may be quoted. */
const unquoteFirst = (s) => s.trim().replace(/^"([^"]*)"/, '$1');

// ---------------------------------------------------------------------------------------------
// Activity diagrams (new syntax)

const ACTION = /^(?:#[\w:.]+)?:([\s\S]*?)([;|<>/\\\]}])\s*(?:<<\s*([^<>]*?)\s*>>)?$/;
const ACTION_SHAPES = { '<': 'io', '>': 'io', '/': 'io', '\\': 'io', '|': 'subroutine' };
const ACTION_STEREOTYPES = { input: 'io', output: 'io', load: 'io', save: 'io', procedure: 'subroutine' };
const CONDITION = String.raw`\((.*?)\)\s*(?:(?:then|is|equals?)(?![\p{L}\p{N}_])\s*(?:\((.*?)\))?)?\s*(?:then)?`;

/**
 * The flow is rebuilt as a graph: every action, decision and bar is a node, and each step is
 * joined to the one that follows it. A branch label (`then (yes)`, `else (no)`, `is (more)`)
 * and an arrow label (`-> text;`) are the labels of those edges. Swimlanes are lanes;
 * partitions are containers. Start, stop and end are `initial` and `final` nodes.
 */
function parseActivity(statements, g) {
  let cursor = []; // the open ends the next node is joined to: { id, label }
  let arrowLabel = '';
  let lane;
  let lastElement;
  const containers = [];
  const frames = [];
  const lanes = new Map();
  const connectors = new Map();
  const place = () => containers.at(-1) ?? lane;
  const join = (to) => {
    for (const p of cursor) g.edge({ label: [p.label, arrowLabel].filter(Boolean).join('\n'), from: p.id, to, endArrow: 'block' });
    arrowLabel = '';
  };
  const add = (shape, label, detail) => {
    const n = g.node(g.fresh({ rounded: 'action', io: 'action', subroutine: 'action', bar: detail?.split(' ')[0] ?? 'bar' }[shape] ?? shape), shape, place());
    n.label = label;
    if (detail) n.detail = detail;
    join(n.id);
    cursor = [{ id: n.id }];
    for (const f of frames) if (f.type === 'repeat' && f.entry === undefined) f.entry = n.id;
    lastElement = n.id;
    return n;
  };
  const action = (text, terminator, stereotype) => {
    const shape = ACTION_STEREOTYPES[String(stereotype ?? '').toLowerCase()] ?? ACTION_SHAPES[terminator] ?? 'rounded';
    const n = add(shape, decodeLabel(text));
    if (stereotype && !ACTION_STEREOTYPES[stereotype.toLowerCase()]) g.text(n, `«${stereotype}»`);
    return n;
  };
  const top = (type, line, word) => {
    const f = frames.at(-1);
    if (f?.type === type) return f;
    g.warn(line, `"${word}" without an open ${type}`);
    return null;
  };
  const loop = () => frames.findLast((f) => f.type === 'while' || f.type === 'repeat');
  const ctx = { parent: place, lastElement: () => lastElement, lastEdge: () => g.page.edges.at(-1), resolve: (token) => token };

  for (const s of statements) {
    const t = s.text;
    let m;
    let f;
    if (/^start$/i.test(t)) add('initial', '');
    else if (/^(?:stop|end)$/i.test(t)) {
      add('final', '', /^end$/i.test(t) ? 'end' : undefined);
      cursor = [];
    } else if (/^(?:kill|detach)$/i.test(t)) cursor = [];
    else if (/^break$/i.test(t)) {
      if (loop()) loop().breaks.push(...cursor);
      else g.warn(s.line, '"break" outside a loop');
      cursor = [];
    } else if ((m = /^-+(?:\[[^\]]*\])?-*>\s*([\s\S]*?);?$/.exec(t))) arrowLabel = decodeLabel(m[1]);
    else if ((m = new RegExp(`^if\\s*${CONDITION}\\s*$`, 'iu').exec(t))) {
      const d = add('decision', decodeLabel(m[1]));
      frames.push({ type: 'if', decision: d.id, ends: [], hasElse: false });
      cursor = [{ id: d.id, label: decodeLabel(m[2] ?? '') }];
    } else if ((m = new RegExp(`^(?:\\((.*?)\\)\\s*)?else\\s*if\\s*${CONDITION}\\s*$`, 'iu').exec(t))) {
      if ((f = top('if', s.line, 'elseif'))) {
        f.ends.push(...cursor);
        cursor = [{ id: f.decision, label: decodeLabel(m[1] ?? '') }];
        const d = add('decision', decodeLabel(m[2]));
        f.decision = d.id;
        cursor = [{ id: d.id, label: decodeLabel(m[3] ?? '') }];
      }
    } else if ((m = /^else(?:\s*\((.*)\))?$/i.exec(t))) {
      if ((f = top('if', s.line, 'else'))) {
        f.ends.push(...cursor);
        cursor = [{ id: f.decision, label: decodeLabel(m[1] ?? '') }];
        f.hasElse = true;
      }
    } else if (/^end\s*if$/i.test(t)) {
      if ((f = top('if', s.line, 'endif'))) {
        frames.pop();
        // Without an else the decision itself goes on to what follows.
        cursor = [...f.ends, ...cursor, ...(f.hasElse ? [] : [{ id: f.decision, label: '' }])];
      }
    } else if ((m = /^switch\s*\((.*)\)$/i.exec(t))) {
      const d = add('decision', decodeLabel(m[1]));
      frames.push({ type: 'switch', decision: d.id, ends: [] });
      cursor = [];
    } else if ((m = /^case\s*\((.*)\)$/i.exec(t))) {
      if ((f = top('switch', s.line, 'case'))) {
        f.ends.push(...cursor);
        cursor = [{ id: f.decision, label: decodeLabel(m[1]) }];
      }
    } else if (/^end\s*switch$/i.test(t)) {
      if ((f = top('switch', s.line, 'endswitch'))) {
        frames.pop();
        cursor = [...f.ends, ...cursor];
      }
    } else if ((m = /^repeat\s*while\s*\((.*?)\)\s*(?:(?:is|equals?)\s*\((.*?)\))?\s*(?:not\s*\((.*?)\))?\s*$/i.exec(t))) {
      if ((f = top('repeat', s.line, 'repeat while'))) {
        const d = add('decision', decodeLabel(m[1]));
        frames.pop();
        const entry = f.entry ?? d.id;
        if (f.backward !== undefined) {
          const b = g.node(g.fresh('action'), 'rounded', place());
          b.label = f.backward;
          g.edge({ label: decodeLabel(m[2] ?? ''), from: d.id, to: b.id, endArrow: 'block' });
          g.edge({ from: b.id, to: entry, endArrow: 'block' });
        } else g.edge({ label: decodeLabel(m[2] ?? ''), from: d.id, to: entry, endArrow: 'block' });
        cursor = [{ id: d.id, label: decodeLabel(m[3] ?? '') }, ...f.breaks];
      }
    } else if ((m = /^repeat(?:\s+(:[\s\S]*))?$/i.exec(t))) {
      frames.push({ type: 'repeat', entry: undefined, breaks: [], backward: undefined });
      const first = m[1] && ACTION.exec(m[1]);
      if (first) action(first[1], first[2], first[3]);
    } else if ((m = /^backward\s*:([\s\S]*);$/i.exec(t))) {
      const r = frames.findLast((x) => x.type === 'repeat');
      if (r) r.backward = decodeLabel(m[1]);
      else g.warn(s.line, '"backward" outside a repeat loop');
    } else if ((m = /^while\s*\((.*?)\)\s*(?:(?:is|equals?)\s*\((.*?)\))?\s*$/i.exec(t))) {
      const d = add('decision', decodeLabel(m[1]));
      frames.push({ type: 'while', decision: d.id, breaks: [] });
      cursor = [{ id: d.id, label: decodeLabel(m[2] ?? '') }];
    } else if ((m = /^end\s*while(?:\s*\((.*)\))?$/i.exec(t))) {
      if ((f = top('while', s.line, 'endwhile'))) {
        frames.pop();
        join(f.decision);
        cursor = [{ id: f.decision, label: decodeLabel(m[1] ?? '') }, ...f.breaks];
      }
    } else if ((m = /^(fork|split)$/i.exec(t))) {
      const word = m[1].toLowerCase();
      const b = add('bar', '', word);
      frames.push({ type: word, bar: b.id, ends: [] });
    } else if ((m = /^(fork|split)\s+again$/i.exec(t))) {
      if ((f = top(m[1].toLowerCase(), s.line, t))) {
        f.ends.push(...cursor);
        cursor = [{ id: f.bar }];
      }
    } else if ((m = /^end\s*(fork|split|merge)$/i.exec(t))) {
      const word = m[1].toLowerCase();
      f = frames.at(-1);
      if (f?.type === 'fork' || f?.type === 'split') {
        frames.pop();
        cursor = [...f.ends, ...cursor];
        // `end merge` brings the branches together without a bar.
        if (word !== 'merge') add('bar', '', f.type === 'fork' ? 'join' : 'split end');
      } else g.warn(s.line, `"${t}" without an open fork or split`);
    } else if ((m = /^\|(?:#\w+\|)?([^|]+)\|\s*(.*)$/.exec(t))) {
      const key = m[1].trim();
      if (!lanes.has(key)) {
        const n = g.node(g.fresh('lane'), 'lane');
        n.label = decodeLabel(m[2] || key);
        lanes.set(key, n.id);
      }
      lane = lanes.get(key);
    } else if ((m = /^(partition|group|package|rectangle|card)\s+(?:#\S+\s+)?(.+?)\s*(?:#\S+\s*)?(\{)?$/i.exec(t)) && (m[3] || /^group$/i.test(m[1]))) {
      const n = g.node(g.fresh('partition'), 'container', place());
      n.label = decodeLabel(m[2]);
      n.detail = m[1].toLowerCase();
      containers.push(n.id);
    } else if (t === '}' || /^end\s*group$/i.test(t)) {
      if (containers.length === 0) g.warn(s.line, `"${t}" without an open partition`);
      containers.pop();
    } else if ((m = ACTION.exec(t))) action(m[1], m[2], m[3]);
    else if (readNote(s, g, ctx)) continue;
    else if ((m = /^\(([^()]+)\)$/.exec(t))) {
      // A connector: the first "(A)" ends a path, the second takes it up again.
      const key = m[1].trim();
      if (connectors.has(key) && cursor.length === 0) cursor = [{ id: connectors.get(key) }];
      else if (connectors.has(key)) {
        join(connectors.get(key));
        cursor = [{ id: connectors.get(key) }];
      } else connectors.set(key, add('ellipse', decodeLabel(key), 'connector').id);
    } else g.warn(s.line, `unreadable statement "${t.slice(0, 60)}"`);
  }
  if (frames.length) g.warn(statements.at(-1)?.line ?? 0, `${frames.at(-1).type === 'if' ? 'an "if"' : `a "${frames.at(-1).type}"`} is not closed`);
  if (containers.length) g.warn(statements.at(-1)?.line ?? 0, 'a partition is not closed with "}"');
}

// ---------------------------------------------------------------------------------------------
// Kind hints

const plural = (n, word) => `${n} ${n === 1 ? word : /(x|s|ch|sh)$/.test(word) ? `${word}es` : /[^aeiou]y$/.test(word) ? `${word.slice(0, -1)}ies` : `${word}s`}`;
const DEPLOYED = new Set(['component', 'node', 'artifact', 'file', 'folder', 'frame', 'agent', 'stack', 'hexagon', 'storage', 'card', 'collections', 'boundary', 'control', 'port', 'database', 'cloud', 'queue']);

/**
 * Which kinds a page looks like, best first, with the evidence. The family is known from the
 * statements; a description page (class, ER, component, deployment, use case share one
 * syntax, and one diagram may mix them) is scored from what it holds.
 */
function kindHints(family, page) {
  const { nodes, edges } = page;
  const of = (pred) => nodes.filter(pred).length;
  const shape = (name) => of((n) => n.shape === name);
  if (family === 'sequence') {
    const evidence = [plural(shape('lifeline'), 'participant'), plural(edges.length, 'message')];
    if (shape('frame')) evidence.push(plural(shape('frame'), 'block'));
    return [{ kind: 'sequence', score: 100, evidence }];
  }
  if (family === 'state') {
    const states = of((n) => n.shape === 'rounded' || n.shape === 'container');
    return [{ kind: 'state', score: 100, evidence: [plural(states, 'state'), plural(edges.length, 'transition'), ...(shape('initial') ? ['[*] start'] : [])] }];
  }
  if (family === 'activity') {
    const actions = of((n) => ['rounded', 'io', 'subroutine'].includes(n.shape));
    const steps = [plural(actions, 'action'), ...(shape('decision') ? [plural(shape('decision'), 'decision')] : [])];
    const bars = shape('bar');
    const lanes = shape('lane');
    // Zukai's activity kind is the one with lanes and parallel bars; a plain flow of steps
    // and decisions is as much a flowchart.
    if (lanes > 0 || bars > 0) {
      return [
        { kind: 'activity', score: 100, evidence: [...(lanes ? [plural(lanes, 'swimlane')] : []), ...(bars ? [plural(bars, 'fork or join bar')] : []), ...steps] },
        { kind: 'flowchart', score: 40, evidence: steps },
      ];
    }
    return [
      { kind: 'flowchart', score: 100, evidence: [...steps, 'no swimlane, no fork'] },
      { kind: 'activity', score: 60, evidence: ['activity syntax (start, :action;, if ... endif)'] },
    ];
  }

  const scores = new Map();
  const add = (kind, points, evidence) => {
    if (points <= 0) return;
    const entry = scores.get(kind) ?? { kind, score: 0, evidence: [] };
    entry.score += points;
    entry.evidence.push(evidence);
    scores.set(kind, entry);
  };
  const head = (e, re) => re.test(e.startArrow ?? '') || re.test(e.endArrow ?? '');
  const entities = of((n) => n.shape === 'table' && /^entity\b/.test(n.detail ?? ''));
  const classes = of((n) => n.shape === 'table' && !/^entity\b/.test(n.detail ?? ''));
  const crowFeet = edges.filter((e) => head(e, /^ER/)).length;
  const umlEnds = edges.filter((e) => head(e, /^(block-open|diamond|diamond-open)$/)).length;
  const useCases = of((n) => n.shape === 'ellipse' && /usecase/.test(n.detail ?? ''));
  const actors = shape('actor');
  const includes = edges.filter((e) => /^«?(include|extend)s?»?$/i.test(e.label.trim())).length;
  const deployed = of((n) => (['box', 'store', 'queue', 'cloud'].includes(n.shape) && (n.shape !== 'box' || DEPLOYED.has(n.detail))) || (n.shape === 'container' && DEPLOYED.has(n.detail)));
  const lollipops = of((n) => n.shape === 'ellipse' && n.detail === 'interface');
  const boundaries = of((n) => n.shape === 'container' && !DEPLOYED.has(n.detail));

  if (classes > 0) add('class', 10 * classes, plural(classes, 'class box'));
  // An inheritance arrow between use cases or actors is a generalization of that diagram.
  if (umlEnds > 0 && classes + entities > 0) add('class', 5 * umlEnds, plural(umlEnds, 'inheritance, composition or aggregation end'));
  if (entities > 0) add('er', 10 * entities, plural(entities, 'entity'));
  if (crowFeet > 0) add('er', 8 * crowFeet, `${plural(crowFeet, 'relation')} with crow's-foot ends`);
  if (useCases > 0) add('usecase', 10 * useCases, plural(useCases, 'use case'));
  if (useCases > 0 && actors > 0) add('usecase', 4 * actors, plural(actors, 'actor'));
  if (useCases > 0 && includes > 0) add('usecase', 5 * includes, plural(includes, 'include or extend arrow'));
  if (useCases > 0 && boundaries > 0) add('usecase', 2 * boundaries, plural(boundaries, 'system boundary'));
  if (deployed > 0) add('architecture', 10 * deployed, plural(deployed, 'deployed element') + ' (component, node, store, queue, cloud)');
  if (lollipops > 0 && deployed > 0) add('architecture', 3 * lollipops, plural(lollipops, 'interface'));
  if (deployed > 0 && useCases === 0 && actors > 0) add('architecture', 3 * actors, plural(actors, 'actor'));
  if (deployed > 0 && boundaries > 0) add('architecture', 2 * boundaries, plural(boundaries, 'boundary'));
  return [...scores.values()].sort((a, b) => b.score - a.score);
}
