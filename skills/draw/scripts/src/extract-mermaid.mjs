/**
 * Mermaid extractor for recook: reads a Mermaid diagram written anywhere (Zukai's own output,
 * a hand-written .mmd, a Markdown file with ```mermaid fences) and turns it into neutral facts
 * the agent maps to IR. It is deterministic and dependency-free (the CLI bundle ships without
 * the mermaid package), so it is a tolerant line reader rather than a full parser: a statement
 * it cannot read becomes a warning naming the line, and the rest of the diagram is still read.
 *
 * Every visible text lands in exactly one of a node `label`, a node `texts` entry, an edge
 * `label` or the page `name`, because the cover check compares only those fields with the IR.
 * Those fields therefore carry the decoded text alone, never a decoration; structure the
 * agent needs besides the text (participant type, note position, block spans) goes to
 * `detail`, which the cover check ignores.
 */

const KIND_HEADERS = [
  [/^(?:flowchart-elk|flowchart|graph)\b/i, 'flowchart'],
  [/^swimlane(?:-beta)?\b/i, 'activity'],
  [/^architecture(?:-beta)?\b/i, 'architecture'],
  [/^stateDiagram(?:-v2)?\b/i, 'state'],
  [/^erDiagram\b/i, 'er'],
  [/^classDiagram(?:-v2)?\b/i, 'class'],
  [/^sequenceDiagram\b/i, 'sequence'],
];

/**
 * @param {string} text a .mmd file, or Markdown holding ```mermaid fenced blocks (one page per block)
 * @returns {{ facts: 1, format: 'mermaid', pages: object[] }}
 */
export function extractMermaid(text) {
  const blocks = splitBlocks(String(text ?? ''));
  return { facts: 1, format: 'mermaid', pages: blocks.map((b, i) => extractPage(b, i + 1)) };
}

// ---------------------------------------------------------------------------------------------
// Blocks and pages

/**
 * A file with ```mermaid fences is Markdown: each fence is a page, named by the nearest
 * heading above it. Anything else is one diagram. Headings inside other code fences are code,
 * not headings, so every fence is tracked. Line numbers stay those of the whole file, so a
 * warning points at the line the user sees in their editor.
 */
function splitBlocks(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').map((t, i) => ({ text: t, line: i + 1 }));
  const MERMAID_FENCE = /^\s{0,3}(`{3,}|~{3,})\s*mermaid\b/i;
  if (!lines.some((l) => MERMAID_FENCE.test(l.text))) return [{ lines, heading: '' }];
  const blocks = [];
  let heading = '';
  for (let i = 0; i < lines.length; i++) {
    const open = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(lines[i].text);
    if (open) {
      const fence = open[1];
      const close = new RegExp(`^\\s{0,3}${fence[0] === '`' ? '`' : '~'}{${fence.length},}\\s*$`);
      let j = i + 1;
      while (j < lines.length && !close.test(lines[j].text)) j++;
      if (MERMAID_FENCE.test(lines[i].text)) blocks.push({ lines: lines.slice(i + 1, j), heading });
      i = j;
      continue;
    }
    const h = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(lines[i].text);
    if (h) heading = h[1].trim();
  }
  return blocks;
}

function extractPage(block, index) {
  const page = { id: `mermaid-${index}`, name: block.heading, kindHints: [], nodes: [], edges: [], warnings: [] };
  const { title, lines } = prepareLines(block.lines, page);
  if (title !== undefined) page.name = title;
  const g = createGraph(page);
  if (lines.length === 0) {
    page.warnings.push('no Mermaid diagram found');
    return page;
  }
  // The header may carry statements after a semicolon ("graph TD; A-->B").
  const [headerText, ...rest] = splitStatements(lines[0].text);
  const header = (headerText ?? '').trim();
  const kind = KIND_HEADERS.find(([re]) => re.test(header))?.[1];
  if (!kind) {
    page.warnings.push(`line ${lines[0].line}: unknown diagram type "${header.slice(0, 40)}"; nothing extracted`);
    return page;
  }
  page.kindHints.push({ kind, score: 100, evidence: [`line ${lines[0].line}: header "${header}"`] });
  const body = [...(rest.length ? [{ text: rest.join(';'), line: lines[0].line }] : []), ...lines.slice(1)];
  const parse = { flowchart: parseFlowchart, activity: parseFlowchart, architecture: parseArchitecture, state: parseState, er: parseEr, class: parseClass, sequence: parseSequence }[kind];
  parse(body, g, kind);
  return page;
}

/**
 * Drop what is never drawn: YAML front matter (its `title` names the page), %% comments,
 * multi-line %%{init}%% directives, accessibility titles and descriptions, blank lines.
 */
function prepareLines(lines, page) {
  let i = 0;
  let title;
  while (i < lines.length && lines[i].text.trim() === '') i++;
  if (i < lines.length && lines[i].text.trim() === '---') {
    let j = i + 1;
    while (j < lines.length && lines[j].text.trim() !== '---') {
      const m = /^title\s*:\s*(.*)$/.exec(lines[j].text);
      if (m) title = yamlScalar(m[1]);
      j++;
    }
    if (j >= lines.length) page.warnings.push(`line ${lines[i].line}: front matter is not closed with ---`);
    i = j + 1;
  }
  const out = [];
  for (; i < lines.length; i++) {
    const t = lines[i].text.trim();
    if (t === '') continue;
    if (t.startsWith('%%{') && !t.includes('}%%')) {
      while (i < lines.length && !lines[i].text.includes('}%%')) i++;
      continue;
    }
    if (t.startsWith('%%')) continue;
    if (/^accTitle\s*:/.test(t) || /^accDescr\s*:/.test(t)) continue;
    if (/^accDescr\s*\{/.test(t)) {
      while (i < lines.length && !lines[i].text.includes('}')) i++;
      continue;
    }
    out.push(lines[i]);
  }
  return { title, lines: out };
}

/** A YAML scalar as written on one line: double-quoted (JSON escapes), single-quoted or plain. */
function yamlScalar(raw) {
  const s = raw.trim();
  if (s.startsWith('"')) {
    try {
      return JSON.parse(s);
    } catch {
      return s.replace(/^"|"$/g, '');
    }
  }
  if (s.startsWith("'")) return s.replace(/^'|'$/g, '').replace(/''/g, "'");
  return s.replace(/\s+#.*$/, '');
}

/**
 * Mermaid separates statements by newlines and semicolons. A semicolon inside a quoted label,
 * or one that ends an entity code (#59;, #quot;, &amp;), is text and does not split.
 */
function splitStatements(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    if (ch === ';' && !quoted && !/(?:#|&#?)\w+$/.test(cur)) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.filter((s) => s.trim() !== '');
}

/** Calls `fn(statement, line)` for every statement; `raw()` true hands over the whole line unsplit. */
function eachStatement(lines, fn, raw = () => false) {
  for (const { text, line } of lines) {
    if (raw()) fn(text.trim(), line);
    else for (const s of splitStatements(text)) fn(s.trim(), line);
  }
}

/**
 * Node and edge registry of one page. A node met only as a reference shows its id, so that is
 * its label until a definition gives it another. Generated ids (notes, frames, [*]) never
 * collide with an id written in the source.
 */
function createGraph(page) {
  const byId = new Map();
  const counters = new Map();
  const node = (id, shape, parent) => {
    let n = byId.get(id);
    if (!n) {
      n = { id, label: id, shape };
      if (parent !== undefined && parent !== id) n.parent = parent;
      byId.set(id, n);
      page.nodes.push(n);
    } else if (parent !== undefined && n.parent === undefined && parent !== id) n.parent = parent;
    return n;
  };
  return {
    page,
    get: (id) => byId.get(id),
    node,
    fresh(prefix) {
      let k = counters.get(prefix) ?? 0;
      let id;
      do id = `${prefix}-${++k}`; while (byId.has(id));
      counters.set(prefix, k);
      return id;
    },
    text(n, value) {
      if (value === '') return;
      (n.texts ??= []).push(value);
    },
    edge(fields) {
      const e = { id: `e${page.edges.length + 1}`, label: '', ...fields };
      page.edges.push(e);
      return e;
    },
    warn(line, message) {
      page.warnings.push(`line ${line}: ${message}`);
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Text decoding

const NAMED_ENTITIES = {
  quot: '"', amp: '&', lt: '<', gt: '>', apos: "'", nbsp: ' ', ensp: ' ', emsp: ' ', thinsp: ' ',
  ndash: '–', mdash: '—', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  laquo: '«', raquo: '»', middot: '·', bull: '•', deg: '°', times: '×', divide: '÷',
  plusmn: '±', larr: '←', rarr: '→', uarr: '↑', darr: '↓', harr: '↔', lArr: '⇐',
  rArr: '⇒', hArr: '⇔', copy: '©', reg: '®', trade: '™', euro: '€', pound: '£',
  yen: '¥', cent: '¢', sect: '§', para: '¶', le: '≤', ge: '≥', ne: '≠', check: '✓',
};

/**
 * Mermaid entity codes (#59;, #quot;) and HTML entities (&lt;, &#35;, &#x23;) in one pass, so
 * a decoded "&" never starts a second decoding. An unknown name is left as written.
 */
function decodeEntities(s) {
  return s.replace(/(?:#|&#?)(x[0-9a-f]+|\d+|[a-z][a-z0-9]*);/gi, (m, body) => {
    if (/^\d+$/.test(body) || /^x[0-9a-f]+$/i.test(body)) {
      const code = /^x/i.test(body) ? parseInt(body.slice(1), 16) : Number(body);
      if (m.startsWith('&') && !m.startsWith('&#')) return NAMED_ENTITIES[body] ?? m;
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return NAMED_ENTITIES[body] ?? m;
  });
}

/** Formatting tags Mermaid renders as markup, not text; anything else stays visible. */
const FORMAT_TAG = /<\/?(?:b|i|u|s|em|strong|small|big|sub|sup|span|div|p|code|font|mark|del|ins|tt)(?:\s[^<>]*)?>/gi;

/** Markdown-string emphasis: **bold**, *italic*, and _italic_ only at word boundaries. */
function stripMarkdown(s) {
  return s
    .replace(/(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g, '$2')
    .replace(/\*(?=\S)(.+?)(?<=\S)\*/g, '$1')
    .replace(/(^|[^\p{L}\p{N}_])_(?=\S)(.+?)(?<=\S)_(?![\p{L}\p{N}_])/gu, '$1$2');
}

/** The visible text of a label: quotes and markdown-string backticks removed, <br> as a line break, entities decoded. */
function decodeLabel(raw) {
  let s = String(raw).trim();
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1);
  if (s.length >= 2 && s.startsWith('`') && s.endsWith('`')) s = stripMarkdown(s.slice(1, -1));
  s = s.replace(/<br\s*\/?>/gi, '\n').replace(FORMAT_TAG, '');
  s = decodeEntities(s);
  return s
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
    .trim();
}

/**
 * classDiagram writes generics with tildes: List~int~, Task~IReadOnlyList~Order~~. A tilde
 * between two word characters opens a generic, any other closes the innermost open one; a
 * leading tilde (package visibility) stays. Text whose tildes do not pair is left as written.
 */
function decodeGenerics(s) {
  let depth = 0;
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch !== '~') {
      out += ch;
      continue;
    }
    const prev = s[i - 1] ?? '';
    const next = s[i + 1] ?? '';
    if (/[\p{L}\p{N}_]/u.test(prev) && /[\p{L}\p{N}_]/u.test(next)) {
      depth++;
      out += '<';
    } else if (depth > 0) {
      depth--;
      out += '>';
    } else out += ch;
  }
  return depth === 0 ? out : s;
}

/** A class member line or ER attribute line as written, with entity codes (and generics) decoded. */
const decodeMember = (s) => decodeEntities(decodeGenerics(s.trim()));

// ---------------------------------------------------------------------------------------------
// flowchart and swimlane-beta

/** Bracket shapes, longest opener first; an opener may close in several ways (trapezoids). */
const FLOW_SHAPES = [
  ['(((', [')))'], 'terminal'],
  ['([', ['])'], 'terminal'],
  ['[[', [']]'], 'subroutine'],
  ['[(', [')]'], 'store'],
  ['((', ['))'], 'terminal'],
  ['{{', ['}}'], 'box'],
  ['[/', ['/]', '\\]'], 'io'],
  ['[\\', ['\\]', '/]'], 'io'],
  ['[', [']'], 'process'],
  ['(', [')'], 'rounded'],
  ['{', ['}'], 'decision'],
  ['>', [']'], 'box'],
];

/** Shapes of the `id@{ shape: ... }` syntax, by Mermaid's names and aliases. */
const AT_SHAPES = {
  rect: 'process', process: 'process', proc: 'process', rectangle: 'process',
  rounded: 'rounded', event: 'rounded',
  stadium: 'terminal', terminal: 'terminal', pill: 'terminal', circle: 'terminal', circ: 'terminal', 'dbl-circ': 'terminal', 'double-circle': 'terminal',
  diamond: 'decision', decision: 'decision', question: 'decision', diam: 'decision',
  'lean-r': 'io', 'lean-l': 'io', 'lean-right': 'io', 'lean-left': 'io', 'in-out': 'io', 'out-in': 'io', 'trap-b': 'io', 'trap-t': 'io', priority: 'io', 'manual-input': 'io', 'sl-rect': 'io',
  subproc: 'subroutine', subprocess: 'subroutine', subroutine: 'subroutine', 'fr-rect': 'subroutine', 'framed-rectangle': 'subroutine',
  cyl: 'store', cylinder: 'store', database: 'store', db: 'store', 'lin-cyl': 'store', disk: 'store', 'h-cyl': 'store', das: 'store', 'horizontal-cylinder': 'store', 'lined-cylinder': 'store',
  'sm-circ': 'initial', 'small-circle': 'initial', start: 'initial',
  'fr-circ': 'final', 'framed-circle': 'final', stop: 'final', 'f-circ': 'bar', 'filled-circle': 'bar', junction: 'bar',
  fork: 'bar', join: 'bar',
  doc: 'document', document: 'document', docs: 'document', documents: 'document', 'lin-doc': 'document', 'st-doc': 'document', 'tag-doc': 'document',
  cloud: 'cloud', text: 'text', brace: 'note', 'brace-r': 'note', braces: 'note', comment: 'note',
  icon: 'icon', image: 'icon',
};
/** Shapes drawn without any text: the id is not shown when no label is given. */
const SILENT_SHAPES = new Set(['initial', 'final', 'bar', 'icon']);

const FLOW_ID = /[\p{L}\p{N}_$](?:[\p{L}\p{N}_$]|[.\-](?=[\p{L}\p{N}_$]))*/uy;

/**
 * flowchart / graph statements, also used for swimlane-beta (whose top-level subgraphs are
 * lanes) and for architecture written as a flowchart. A statement is a subgraph line, `end`,
 * a styling line, or a chain of node groups joined by links: `A & B --> C -- text --> D`.
 */
function parseFlowchart(lines, g, kind) {
  const stack = [];
  eachStatement(lines, (s, line) => {
    if (s === 'end') {
      if (stack.length === 0) g.warn(line, '"end" without an open subgraph');
      stack.pop();
      return;
    }
    if (/^subgraph(\s|$)/.test(s)) {
      const sub = parseSubgraphHead(s.slice(8).trim(), g);
      const shape = kind === 'activity' && stack.length === 0 ? 'lane' : 'container';
      const n = g.node(sub.id, shape, stack.at(-1));
      n.shape = shape;
      n.label = sub.label;
      stack.push(sub.id);
      return;
    }
    if (/^(?:direction|classDef|class|style|linkStyle|interpolate)\s/.test(s)) return;
    if (/^click\s/.test(s)) {
      // `click A href "url"` and `click A "url"` link the node; a callback is not a link.
      const m = /^click\s+(\S+)\s+(?:href\s+)?"([^"]+)"/.exec(s);
      if (m) g.node(m[1], 'process', stack.at(-1)).link = m[2];
      return;
    }
    parseChain(s, line, g, stack.at(-1));
  });
  if (stack.length) g.warn(lines.at(-1)?.line ?? 0, `subgraph "${stack.at(-1)}" is not closed with "end"`);
}

function parseSubgraphHead(rest, g) {
  if (rest === '') return { id: g.fresh('subgraph'), label: '' };
  const withLabel = /^([^\s["]+)\s*\[(.*)\]\s*$/.exec(rest);
  if (withLabel) return { id: withLabel[1], label: decodeLabel(withLabel[2]) };
  if (rest.startsWith('"') || rest.startsWith('`')) return { id: g.fresh('subgraph'), label: decodeLabel(rest) };
  return { id: rest, label: decodeLabel(rest) };
}

function parseChain(s, line, g, parent) {
  let pos = 0;
  const skip = () => {
    while (pos < s.length && /\s/.test(s[pos])) pos++;
  };
  const readGroup = () => {
    const ids = [];
    for (;;) {
      skip();
      const r = parseFlowNode(s, pos, g, parent);
      if (!r) return ids.length ? ids : null;
      ids.push(r.id);
      pos = r.end;
      skip();
      if (s[pos] !== '&') return ids;
      pos++;
    }
  };
  let from = readGroup();
  if (!from) {
    g.warn(line, `unreadable statement "${s.slice(0, 60)}"`);
    return;
  }
  for (;;) {
    skip();
    if (pos >= s.length) return;
    const link = parseFlowLink(s, pos);
    if (!link) {
      g.warn(line, `unreadable text "${s.slice(pos, pos + 40)}"`);
      return;
    }
    pos = link.end;
    const to = readGroup();
    if (!to) {
      g.warn(line, `link without a target in "${s.slice(0, 60)}"`);
      return;
    }
    // ~~~ is a layout hint drawn as nothing; the nodes it names are still nodes.
    if (!link.invisible) {
      for (const a of from) {
        for (const b of to) {
          const e = g.edge({ label: link.label, from: a, to: b });
          if (link.dashed) e.dashed = true;
          if (link.startArrow) e.startArrow = link.startArrow;
          e.endArrow = link.endArrow;
        }
      }
    }
    from = to;
  }
}

/** A node reference at `pos`: an id, then optionally a bracket shape or `@{ ... }`, and `:::class`. */
function parseFlowNode(s, pos, g, parent) {
  FLOW_ID.lastIndex = pos;
  const m = FLOW_ID.exec(s);
  if (!m) return null;
  const id = m[0];
  let end = pos + id.length;
  end = skipClassSuffix(s, end);
  let def;
  if (s.startsWith('@{', end)) {
    const close = findClosingBrace(s, end + 1);
    if (close < 0) return null;
    const props = parseProps(s.slice(end + 2, close));
    const shape = AT_SHAPES[String(props.shape ?? 'rect').toLowerCase()] ?? 'box';
    def = { shape, label: props.label !== undefined ? decodeLabel(props.label) : SILENT_SHAPES.has(shape) ? '' : id };
    if (props.icon) def.icon = props.icon;
    end = close + 1;
  } else {
    for (const [open, closers, shape] of FLOW_SHAPES) {
      if (!s.startsWith(open, end)) continue;
      const r = readBracketText(s, end + open.length, closers);
      if (!r) continue;
      def = { shape, label: decodeLabel(r.text) };
      end = r.end;
      break;
    }
  }
  end = skipClassSuffix(s, end);
  const n = g.node(id, def?.shape ?? 'process', parent);
  if (def) {
    n.label = def.label;
    n.shape = def.shape;
    if (def.icon) n.icon = def.icon;
  }
  return { id, end };
}

const skipClassSuffix = (s, pos) => {
  const m = /^:::[\w-]+/.exec(s.slice(pos));
  return m ? pos + m[0].length : pos;
};

/** Text up to one of `closers`; a quoted text may hold a closer, an unquoted one cannot. */
function readBracketText(s, start, closers) {
  let from = start;
  while (from < s.length && s[from] === ' ') from++;
  if (s[from] === '"') {
    const q = s.indexOf('"', from + 1);
    if (q < 0) return null;
    let after = q + 1;
    while (after < s.length && s[after] === ' ') after++;
    const closer = closers.find((c) => s.startsWith(c, after));
    return closer ? { text: s.slice(from, q + 1), end: after + closer.length } : null;
  }
  let best = -1;
  let closer = '';
  for (const c of closers) {
    const k = s.indexOf(c, start);
    if (k >= 0 && (best < 0 || k < best)) {
      best = k;
      closer = c;
    }
  }
  return best < 0 ? null : { text: s.slice(start, best), end: best + closer.length };
}

/** Index of the `}` matching the `{` at `open`, skipping quoted strings; -1 when unbalanced. */
function findClosingBrace(s, open) {
  let depth = 0;
  let quoted = false;
  for (let i = open; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"') quoted = !quoted;
    if (quoted) continue;
    if (ch === '{') depth++;
    if (ch === '}' && --depth === 0) return i;
  }
  return -1;
}

/** `key: value, key: "value"` (keys may be quoted, as in sequence participant metadata). */
function parseProps(body) {
  const props = {};
  let cur = '';
  let quoted = false;
  const parts = [];
  for (const ch of body) {
    if (ch === '"') quoted = !quoted;
    if (ch === ',' && !quoted) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  parts.push(cur);
  for (const part of parts) {
    const m = /^\s*"?([\w-]+)"?\s*:\s*(.*?)\s*$/s.exec(part);
    if (!m) continue;
    const v = m[2];
    props[m[1]] = m[1] === 'label' ? v : v.replace(/^"(.*)"$/s, '$1');
  }
  return props;
}

const ARROW_HEAD = { '>': 'block', x: 'cross', o: 'circle' };
const ARROW_TAIL = { '<': 'block', x: 'cross', o: 'circle' };

/**
 * A link at `pos`: `-->`, `---`, `==>`, `-.->`, `~~~`, `<-->`, `--x`, `--o`, each optionally
 * with `|text|`, or the text form `-- text -->` / `== text ==>` / `-. text .->`. An edge id
 * (`e1@-->`) is skipped. The text form needs whitespace after its opener, as in Mermaid.
 */
function parseFlowLink(s, pos) {
  let rest = s.slice(pos);
  let offset = pos;
  const edgeId = /^[\w-]+@(?=[<xo]?[-=.~])/.exec(rest);
  if (edgeId) {
    rest = rest.slice(edgeId[0].length);
    offset += edgeId[0].length;
  }
  const textOpen = /^([<xo])?(--|==|-\.)\s+/.exec(rest);
  if (textOpen) {
    const closeRe = { '--': /\s*(-{2,})([>xo])?/y, '==': /\s*(={2,})([>xo])?/y, '-.': /\s*(\.+-)([>xo])?/y }[textOpen[2]];
    let k = textOpen[0].length;
    if (rest[k] === '"') {
      const q = rest.indexOf('"', k + 1);
      if (q > 0) {
        closeRe.lastIndex = q + 1;
        const c = closeRe.exec(rest);
        if (c) return linkResult(textOpen[1], textOpen[2], c[2], rest.slice(k, q + 1), offset + q + 1 + c[0].length);
      }
    }
    for (; k < rest.length; k++) {
      closeRe.lastIndex = k;
      const c = closeRe.exec(rest);
      if (c) {
        return linkResult(textOpen[1], textOpen[2], c[2], rest.slice(textOpen[0].length, k), offset + k + c[0].length);
      }
    }
    return null;
  }
  const plain = /^([<xo])?(-{2,}|={2,}|-\.+-|~{3,})([>xo])?/.exec(rest);
  if (!plain) return null;
  let end = offset + plain[0].length;
  let label = '';
  const pipe = /^\s*\|([^|]*)\|/.exec(s.slice(end));
  if (pipe) {
    label = pipe[1];
    end += pipe[0].length;
  }
  return linkResult(plain[1], plain[2], plain[3], label, end);
}

function linkResult(tail, line, head, label, end) {
  const r = { label: decodeLabel(label), end, endArrow: head ? ARROW_HEAD[head] : 'none' };
  if (line.startsWith('~')) r.invisible = true;
  if (line.includes('.')) r.dashed = true;
  if (tail) r.startArrow = ARROW_TAIL[tail];
  return r;
}

// ---------------------------------------------------------------------------------------------
// architecture-beta

const ARCH_ITEM = /^(group|service|junction)\s+([\w-]+)\s*(?:\(([^)]*)\))?\s*(?:"([^"]*)")?\s*(?:\[(.*)\])?\s*(?:in\s+([\w-]+))?\s*$/;
const ARCH_EDGE = /^([\w-]+)(?:\{group\})?\s*:\s*([TBLR])\s*(<)?-(?:\[(.*?)\])?-(>)?\s*([TBLR])\s*:\s*([\w-]+)(?:\{group\})?\s*$/i;

function parseArchitecture(lines, g) {
  eachStatement(lines, (s, line) => {
    const title = /^title(?:\s*:\s*|\s+)(.*)$/.exec(s);
    if (title) {
      g.page.name = decodeLabel(title[1]);
      return;
    }
    const item = ARCH_ITEM.exec(s);
    if (item) {
      const [, keyword, id, icon, , label, parent] = item;
      if (parent !== undefined && !g.get(parent)) g.warn(line, `"${id}" is placed in "${parent}", which is not declared before it`);
      const shape = keyword === 'group' ? 'group' : keyword === 'junction' ? 'bar' : icon ? 'icon' : 'box';
      const n = g.node(id, shape, parent);
      n.shape = shape;
      n.label = keyword === 'junction' ? '' : decodeLabel(label ?? '');
      if (icon) n.icon = icon.trim();
      return;
    }
    const edge = ARCH_EDGE.exec(s);
    if (edge) {
      // The sides (L, R, T, B) are layout, not text.
      const [, from, , tail, label, head, , to] = edge;
      for (const id of [from, to]) if (!g.get(id)) g.node(id, 'box');
      const e = g.edge({ label: decodeLabel(label ?? ''), from, to });
      if (tail) e.startArrow = 'block';
      e.endArrow = head ? 'block' : 'none';
      return;
    }
    g.warn(line, `unreadable statement "${s.slice(0, 60)}"`);
  });
}

// ---------------------------------------------------------------------------------------------
// sequenceDiagram

const SEQ_ARROW = /^(.+?)\s*(<<-->>|<<->>|-->>|->>|--x|-x|--\)|-\)|-->|->)\s*([+-])?\s*([^:]+?)\s*(?::(.*))?$/;
const SEQ_HEAD = { '>>': 'block', '>': 'none', x: 'cross', ')': 'open' };
const SEQ_TYPES = new Set(['participant', 'actor', 'boundary', 'control', 'entity', 'database', 'collections', 'queue']);
const CSS_COLORS = new Set(('aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen transparent').split(' '));

/** `box Aqua Team` -> "Team": a leading colour (a CSS name, #hex, rgb()/hsl()) is not shown. */
function boxTitle(rest) {
  const fn = /^(?:rgba?|hsla?)\s*\([^)]*\)\s*/i.exec(rest);
  if (fn) return rest.slice(fn[0].length);
  const word = /^(\S+)\s*(.*)$/.exec(rest);
  if (!word) return '';
  if (/^#[0-9a-f]{3,8}$/i.test(word[1]) || CSS_COLORS.has(word[1].toLowerCase())) return word[2];
  return rest;
}

/**
 * Participants are lifelines; messages are edges with `y` = their order; notes are nodes;
 * loop/alt/opt/par/critical/break/rect blocks are frames whose `label` is the condition and
 * whose `texts` hold the else/and/option conditions. A frame's `detail` names its sections
 * and the messages each spans, so the agent can rebuild the block's message lists.
 */
function parseSequence(lines, g) {
  const stack = []; // { type: 'box' | 'frame', node, sections }
  const frames = [];
  let order = 0;
  const box = () => [...stack].reverse().find((x) => x.type === 'box')?.node.id;
  const frame = () => [...stack].reverse().find((x) => x.type === 'frame');
  // A participant first met in a message or a note is a plain participant showing its id.
  const participant = (id) => {
    if (!g.get(id)) g.node(id, 'lifeline', box()).detail = 'participant';
    return g.get(id);
  };
  eachStatement(lines, (s, line) => {
    const title = /^title(?:\s*:\s*|\s+)(.*)$/.exec(s);
    if (title) {
      g.page.name = decodeLabel(title[1]);
      return;
    }
    const decl = /^(?:create\s+)?(participant|actor)\s+(.+?)(?:@(\{.*\}))?(?:\s+as\s+(.*))?$/.exec(s);
    if (decl) {
      const [, keyword, id, meta, alias] = decl;
      const type = meta ? String(parseProps(meta.slice(1, -1)).type ?? '').toLowerCase() : '';
      const n = participant(id.trim());
      n.label = decodeLabel(alias ?? id);
      n.detail = SEQ_TYPES.has(type) ? type : keyword;
      return;
    }
    const boxStart = /^box(?:\s+(.*))?$/.exec(s);
    if (boxStart) {
      const n = g.node(g.fresh('box'), 'group');
      n.label = decodeLabel(boxTitle((boxStart[1] ?? '').trim()));
      stack.push({ type: 'box', node: n });
      return;
    }
    const block = /^(loop|alt|opt|par|par_over|critical|break|rect)(?:\s+(.*))?$/.exec(s);
    if (block) {
      const n = g.node(g.fresh('frame'), 'frame', frame()?.node.id);
      // A rect block has a colour, not a condition: nothing in its line is shown.
      n.label = block[1] === 'rect' ? '' : decodeLabel(block[2] ?? '');
      const f = { type: 'frame', node: n, sections: [{ keyword: block[1], edges: [] }] };
      stack.push(f);
      frames.push(f);
      return;
    }
    const branch = /^(else|and|option)(?:\s+(.*))?$/.exec(s);
    if (branch) {
      const f = frame();
      if (!f) {
        g.warn(line, `"${branch[1]}" outside a block`);
        return;
      }
      g.text(f.node, decodeLabel(branch[2] ?? ''));
      f.sections.push({ keyword: branch[1], edges: [] });
      return;
    }
    if (s === 'end') {
      if (stack.length === 0) g.warn(line, '"end" without an open block');
      stack.pop();
      return;
    }
    const note = /^note\s+(left of|right of|over)\s+([^:]+?)\s*:(.*)$/i.exec(s);
    if (note) {
      const who = note[2].split(',').map((p) => p.trim()).filter(Boolean);
      for (const p of who) participant(p);
      const n = g.node(g.fresh('note'), 'note', frame()?.node.id);
      n.label = decodeLabel(note[3]);
      const last = g.page.edges.at(-1);
      n.detail = `${note[1].toLowerCase()} ${who.join(',')}${last ? `; after ${last.id}` : ''}`;
      return;
    }
    if (/^(?:activate|deactivate|destroy|autonumber|properties|details)\b/.test(s)) return;
    const link = /^links?\s+([^:]+?)\s*:\s*(.*)$/.exec(s);
    if (link) {
      const url = /https?:\/\/[^\s"',}]+/.exec(link[2]);
      const n = participant(link[1]);
      if (url && !n.link) n.link = url[0];
      return;
    }
    const msg = SEQ_ARROW.exec(s);
    if (msg) {
      const [, fromRaw, arrow, , toRaw, text] = msg;
      const from = participant(fromRaw.trim()).id;
      const to = participant(toRaw.trim()).id;
      const e = g.edge({ label: decodeLabel(text ?? ''), from, to, y: order++ });
      if (arrow.includes('--')) e.dashed = true;
      if (arrow.startsWith('<<')) e.startArrow = 'block';
      e.endArrow = SEQ_HEAD[arrow.endsWith('>>') ? '>>' : arrow.at(-1)];
      for (const x of stack) if (x.type === 'frame') x.sections.at(-1).edges.push(e.id);
      return;
    }
    g.warn(line, `unreadable statement "${s.slice(0, 60)}"`);
  });
  if (stack.length) g.warn(lines.at(-1)?.line ?? 0, 'a block or box is not closed with "end"');
  for (const f of frames) {
    f.node.detail = f.sections
      .map((sec) => {
        const span = sec.edges.length === 0 ? '' : sec.edges.length === 1 ? ` ${sec.edges[0]}` : ` ${sec.edges[0]}..${sec.edges.at(-1)}`;
        return `${sec.keyword}${span}`;
      })
      .join(' | ');
  }
}

// ---------------------------------------------------------------------------------------------
// stateDiagram

function parseState(lines, g) {
  const stack = [];
  let note = null; // an open multi-line note: { node, lines }
  const scope = () => stack.at(-1);
  const state = (id) => g.node(id, 'rounded', scope());
  const endpoint = (raw, asSource) => {
    if (raw === '[*]') {
      const kind = asSource ? 'initial' : 'final';
      const n = g.node(g.fresh(kind), kind, scope());
      n.label = '';
      return n.id;
    }
    return state(raw).id;
  };
  eachStatement(
    lines,
    (raw, line) => {
      if (note) {
        if (/^end\s+note$/i.test(raw)) {
          note.node.label = decodeLabel(note.lines.join('<br/>'));
          note = null;
        } else note.lines.push(raw);
        return;
      }
      const s = raw.replace(/:::[\w-]+/g, '').trim();
      if (s === '}') {
        if (stack.length === 0) g.warn(line, '"}" without an open composite state');
        stack.pop();
        return;
      }
      if (s === '--' || /^(?:direction|classDef|class|style|hide|scale)\b/.test(s)) return;
      const noteLine = /^note\s+(left of|right of)\s+([^\s:]+)\s*(?::(.*))?$/i.exec(s);
      if (noteLine) {
        state(noteLine[2]);
        const n = g.node(g.fresh('note'), 'note', scope());
        n.detail = `${noteLine[1].toLowerCase()} ${noteLine[2]}`;
        if (noteLine[3] !== undefined) n.label = decodeLabel(noteLine[3]);
        else note = { node: n, lines: [] };
        return;
      }
      const floating = /^note\s+"(.*)"\s+as\s+(\S+)$/i.exec(s);
      if (floating) {
        const n = g.node(floating[2], 'note', scope());
        n.shape = 'note';
        n.label = decodeLabel(floating[1]);
        return;
      }
      const named = /^state\s+("(?:[^"]*)")\s+as\s+([^\s{]+)\s*(\{)?\s*$/.exec(s);
      const plain = /^state\s+([^\s{:"<]+)\s*(<<(choice|fork|join)>>)?\s*(\{)?\s*$/.exec(s);
      const described = /^state\s+([^\s{:"]+)\s*:\s*(.*)$/.exec(s);
      if (named || plain) {
        const id = named ? named[2] : plain[1];
        const open = named ? named[3] : plain[4];
        const special = plain?.[3];
        const n = state(id);
        if (named) n.label = decodeLabel(named[1]);
        if (special) {
          n.shape = special === 'choice' ? 'decision' : 'bar';
          n.label = '';
        }
        if (open) {
          n.shape = 'container';
          stack.push(id);
        }
        return;
      }
      if (described) {
        describe(state(described[1]), decodeLabel(described[2]));
        return;
      }
      const tr = /^(\S+)\s*-->\s*([^\s:]+)\s*(?::(.*))?$/.exec(s);
      if (tr) {
        const from = endpoint(tr[1], true);
        const to = endpoint(tr[2], false);
        g.edge({ label: decodeLabel(tr[3] ?? ''), from, to, endArrow: 'block' });
        return;
      }
      const desc = /^([^\s:]+)\s*:\s*(.*)$/.exec(s);
      if (desc) {
        describe(state(desc[1]), decodeLabel(desc[2]));
        return;
      }
      if (/^[^\s:{}"]+$/.test(s)) {
        state(s);
        return;
      }
      g.warn(line, `unreadable statement "${s.slice(0, 60)}"`);
    },
    () => note !== null,
  );
  if (note) g.warn(lines.at(-1)?.line ?? 0, 'a note is not closed with "end note"');
  if (stack.length) g.warn(lines.at(-1)?.line ?? 0, `composite state "${stack.at(-1)}" is not closed with "}"`);

  /** `id : text` shows the text in place of the id; further descriptions add lines. */
  function describe(n, text) {
    if (n.label === n.id && !n.texts) n.label = text;
    else g.text(n, text);
  }
}

// ---------------------------------------------------------------------------------------------
// erDiagram

const ER_CARD = String.raw`\|o|o\||\|\||\}o|o\{|\}\||\|\{|one or zero|zero or one|one or more|one or many|many\(1\)|1\+|zero or more|zero or many|many\(0\)|0\+|only one|1`;
const ER_ENTITY = String.raw`"[^"]*"|[\p{L}\p{N}_\-]+`;
const ER_RELATION = new RegExp(`^(${ER_ENTITY})\\s*(${ER_CARD})\\s*(--|\\.\\.|optionally to|to)\\s*(${ER_CARD})\\s*(${ER_ENTITY})\\s*:\\s*(.*)$`, 'u');
const ER_HEAD = new RegExp(`^(${ER_ENTITY})\\s*(?:\\[(.*)\\])?\\s*(\\{.*)?$`, 'u');

function parseEr(lines, g) {
  let open = null;
  const entity = (raw) => g.node(raw.replace(/^"|"$/g, ''), 'table');
  eachStatement(lines, (raw, line) => {
    const s = raw.replace(/:::[\w-]+/g, '').trim();
    if (open) {
      if (s === '}') open = null;
      else g.text(open, decodeMember(s));
      return;
    }
    if (/^(?:direction|classDef|class|style)\b/.test(s)) return;
    const rel = ER_RELATION.exec(s);
    if (rel) {
      const [, a, left, link, right, b, label] = rel;
      const e = g.edge({ label: decodeLabel(label), from: entity(a).id, to: entity(b).id });
      if (link === '..' || link === 'optionally to') e.dashed = true;
      e.startArrow = left;
      e.endArrow = right;
      return;
    }
    const head = ER_HEAD.exec(s);
    if (head) {
      const n = entity(head[1]);
      if (head[2] !== undefined) n.label = decodeLabel(head[2]);
      else if (head[1].startsWith('"')) n.label = decodeLabel(head[1]);
      if (head[3] !== undefined) {
        // `{` opens the attribute list; text after it on the same line is one attribute line.
        const inner = head[3].slice(1).trim();
        if (inner.endsWith('}')) {
          if (inner.slice(0, -1).trim()) g.text(n, decodeMember(inner.slice(0, -1)));
        } else {
          if (inner) g.text(n, decodeMember(inner));
          open = n;
        }
      }
      return;
    }
    g.warn(line, `unreadable statement "${s.slice(0, 60)}"`);
  });
  if (open) g.warn(lines.at(-1)?.line ?? 0, `entity "${open.id}" is not closed with "}"`);
}

// ---------------------------------------------------------------------------------------------
// classDiagram

const CLASS_ID = String.raw`\x60[^\x60]+\x60|[\p{L}\p{N}_\-]+(?:~[^\s\[{]*~)?`;
const CLASS_RELATION = new RegExp(`^(${CLASS_ID})\\s*(?:"([^"]*)")?\\s*(<\\||\\*|o|<|\\(\\))?(--|\\.\\.)(\\|>|\\*|o|>|\\(\\))?\\s*(?:"([^"]*)")?\\s*(${CLASS_ID})\\s*(?::(.*))?$`, 'u');
const CLASS_HEAD = new RegExp(`^class\\s+(${CLASS_ID})\\s*(?:\\[(.*)\\])?\\s*(?::::[\\w-]+)?\\s*(\\{)?\\s*(\\})?\\s*$`, 'u');

/** `Name~T~` -> id "Name" (what relations refer to) and the shown name "Name<T>". */
function classRef(raw) {
  const s = raw.startsWith('`') ? raw.slice(1, -1) : raw;
  const k = raw.startsWith('`') ? -1 : s.indexOf('~');
  return k < 0 ? { id: s, shown: decodeEntities(s) } : { id: s.slice(0, k), shown: decodeEntities(decodeGenerics(s)) };
}

function parseClass(lines, g) {
  let body = null; // the class whose { ... } is open
  const namespaces = [];
  const cls = (raw) => {
    const r = classRef(raw);
    const fresh = !g.get(r.id);
    const n = g.node(r.id, 'table', namespaces.at(-1));
    if (fresh) n.label = r.shown;
    return n;
  };
  eachStatement(lines, (s, line) => {
    if (body) {
      if (s === '}') body = null;
      else {
        const st = /^<<(.+)>>$/.exec(s);
        if (st) body.detail = decodeEntities(st[1].trim());
        else g.text(body, decodeMember(s));
      }
      return;
    }
    if (s === '}') {
      if (namespaces.length === 0) g.warn(line, '"}" without an open class or namespace');
      namespaces.pop();
      return;
    }
    if (/^(?:direction|classDef|cssClass|style|callback)\b/.test(s)) return;
    const link = /^(?:click\s+(\S+)\s+href|link\s+(\S+))\s+"([^"]+)"/.exec(s);
    if (link) {
      cls(link[1] ?? link[2]).link = link[3];
      return;
    }
    if (/^click\s/.test(s)) return;
    const ns = /^namespace\s+(\S+)\s*\{\s*$/.exec(s);
    if (ns) {
      const n = g.node(ns[1], 'container', namespaces.at(-1));
      n.shape = 'container';
      namespaces.push(ns[1]);
      return;
    }
    const head = CLASS_HEAD.exec(s);
    if (head) {
      const n = cls(head[1]);
      if (head[2] !== undefined) n.label = decodeLabel(head[2]);
      if (head[3] && !head[4]) body = n;
      return;
    }
    const annotation = /^<<(.+)>>\s*(\S+)$/.exec(s);
    if (annotation) {
      cls(annotation[2]).detail = decodeEntities(annotation[1].trim());
      return;
    }
    const noteFor = /^note\s+(?:for\s+(\S+)\s+)?"(.*)"$/.exec(s);
    if (noteFor) {
      const n = g.node(g.fresh('note'), 'note', namespaces.at(-1));
      // Class notes write a line break as \n.
      n.label = decodeLabel(noteFor[2].replace(/\\n/g, '<br/>'));
      if (noteFor[1]) {
        cls(noteFor[1]);
        n.detail = `for ${classRef(noteFor[1]).id}`;
      }
      return;
    }
    const rel = CLASS_RELATION.exec(s);
    if (rel) {
      const [, a, leftCard, tail, link, head2, rightCard, b, text] = rel;
      // Cardinalities are drawn at the line ends: they join the label as lines of their own,
      // in the order they are drawn (left end, relation text, right end).
      const label = [leftCard, text, rightCard].filter((x) => x !== undefined).map((x) => decodeLabel(x)).filter(Boolean).join('\n');
      const e = g.edge({ label, from: cls(a).id, to: cls(b).id });
      if (link === '..') e.dashed = true;
      if (tail) e.startArrow = tail;
      if (head2) e.endArrow = head2;
      return;
    }
    const member = new RegExp(`^(${CLASS_ID})\\s*:\\s*(.*)$`, 'u').exec(s);
    if (member) {
      const n = cls(member[1]);
      const st = /^<<(.+)>>$/.exec(member[2].trim());
      if (st) n.detail = decodeEntities(st[1].trim());
      else g.text(n, decodeMember(member[2]));
      return;
    }
    g.warn(line, `unreadable statement "${s.slice(0, 60)}"`);
  });
  if (body) g.warn(lines.at(-1)?.line ?? 0, `class "${body.id}" is not closed with "}"`);
  if (namespaces.length) g.warn(lines.at(-1)?.line ?? 0, `namespace "${namespaces.at(-1)}" is not closed with "}"`);
}
