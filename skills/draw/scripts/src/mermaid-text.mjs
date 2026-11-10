/**
 * Text encoding for Mermaid output. IR ids are never written to Mermaid: the emitter assigns
 * safe ids (n1, n2, ...) so reserved words (end, graph) and arrow-like ids (a--b) cannot
 * break the syntax. Labels are written as quoted strings with Mermaid entity codes, so a
 * label cannot inject a directive (%%{init}%%), a click handler or an extra edge.
 */

const ENTITY = {
  '#': '#35;',
  ';': '#59;',
  '"': '#quot;',
  '<': '#lt;',
  '>': '#gt;',
  '&': '#amp;',
  '%': '#37;',
  '{': '#123;',
  '}': '#125;',
  '[': '#91;',
  ']': '#93;',
  '|': '#124;',
  '`': '#96;',
  '\\': '#92;',
};
const ENTITY_RE = /[#;"<>&%{}\[\]|`\\]/g;

/** Encode a label for the diagram kinds that accept entity codes (flowchart, sequence, state, er, class). */
export function encodeLabel(text) {
  return String(text)
    .replace(/\r\n?/g, '\n')
    .replace(ENTITY_RE, (ch) => ENTITY[ch])
    .replace(/\n/g, '<br/>');
}

/** Same as encodeLabel but newlines become spaces (where <br/> is not rendered). */
export function encodeInline(text) {
  return String(text).replace(/\r\n?|\n/g, ' ').replace(ENTITY_RE, (ch) => ENTITY[ch]);
}

/**
 * Identifier-like tokens that Mermaid reads unquoted (ER attribute names and types, class
 * stereotypes). Only letters, digits and underscore survive; everything else becomes `_`.
 * Returns the token and whether it was altered.
 */
export function identifierToken(text, extra = '') {
  const allowed = new RegExp(`[^A-Za-z0-9_${extra}]+`, 'g');
  const token = String(text).replace(allowed, '_').replace(/^_+|_+$/g, '') || 'unnamed';
  return { token, altered: token !== String(text) };
}

/**
 * Class member lines are unquoted but tolerate most characters. Generics use ~ instead of
 * angle brackets, and the characters that would start a new statement are entity-encoded.
 */
export function encodeMember(text) {
  return String(text)
    .replace(/\r\n?|\n/g, ' ')
    .replace(/</g, '~')
    .replace(/>/g, '~')
    .replace(/[#;"%{}|`\\]/g, (ch) => ENTITY[ch]);
}

/**
 * architecture-beta labels sit inside [...] and accept no entity codes. The characters that
 * cannot appear are replaced by a space; the caller warns when the label was altered.
 */
export function architectureLabel(text) {
  const label = String(text).replace(/[\[\]{}%\r\n]+/g, ' ').replace(/\s+/g, ' ').trim() || 'unnamed';
  return { label, altered: label !== String(text) };
}

/**
 * FigJam's generate_diagram accepts a stricter Mermaid subset: no entity codes, no HTML, no
 * line breaks, and quotes inside quoted labels break the parse. Characters that cannot be
 * shown are replaced; the caller warns when the label was altered.
 */
export function figjamLabel(text) {
  const label = String(text)
    .replace(/\r\n?|\n/g, ' ')
    .replace(/"/g, "'")
    .replace(/[<>{}\[\]|#%;&`\\]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'unnamed';
  return { label, altered: label !== String(text) };
}

/** Deterministic safe-id allocator: ids in first-seen order, prefix + 1-based index. */
export function safeIds(prefix = 'n') {
  const map = new Map();
  return {
    add(id) {
      if (!map.has(id)) map.set(id, `${prefix}${map.size + 1}`);
      return map.get(id);
    },
    get(id) {
      const v = map.get(id);
      if (v === undefined) throw new Error(`no safe id for "${id}"`);
      return v;
    },
  };
}

/** YAML front matter with the diagram title, quoted as a JSON string (valid YAML). */
export function frontMatter(title) {
  // Mermaid strips the front matter before it scans for %%{...}%% directives; the space is
  // defence in depth so a title can never form a directive even if that order changes.
  const text = String(title).replace(/\r\n?|\n/g, ' ').replace(/%%\{/g, '%% {');
  return `---\ntitle: ${JSON.stringify(text)}\n---\n`;
}
