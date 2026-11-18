/**
 * The data block of a script for the Figma MCP tool `use_figma`: `const D = ...;` and a check
 * that runs before anything else in the script.
 *
 * An agent copies the script into the call, and tool output cuts long lines, so the data is
 * written over short lines: broken after a comma, and a string too long for a line of its own
 * (a stencil path, the path of a long line) cut into pieces joined with `+`. The script then
 * writes its data as JSON again, as the CLI did, and compares the length and a short hash of
 * that text with the ones the CLI wrote beside it. A copy that lost or changed a character
 * (inside a label too) stops there, with an error that says to pass the script again from its
 * file, before the board is read or changed. A line break the copy lost or added between two
 * pieces changes nothing the script draws, and the check lets it pass.
 */

/** The most characters a line of the data block has. */
export const LINE_LIMIT = 200;

/** FNV-1a over the UTF-16 code units of `text`, 8 hex digits: written once, run by the CLI and by the script. */
const HASH_BODY = "let h = 0x811c9dc5;\nfor (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;\nreturn h.toString(16).padStart(8, '0');";
const dataHash = new Function('text', HASH_BODY);

/**
 * `value` as a JavaScript literal over lines of at most `width` characters, which reads back as
 * `JSON.stringify(value)` does. A line ends between two tokens of the JSON text or after a comma,
 * never inside a number; a string longer than a line is cut into pieces joined with `+`, never
 * inside an escape or between the two halves of a surrogate pair.
 */
export function wrapJson(value, width = LINE_LIMIT) {
  const lines = [];
  let line = '';
  const put = (s) => {
    if (line !== '' && line.length + s.length > width) { lines.push(line); line = ''; }
    line += s;
  };
  for (const token of JSON.stringify(value).match(/"(?:[^"\\]|\\.)*"|[^",]+,?|,/g)) {
    if (token[0] !== '"' || token.length <= width) { put(token); continue; }
    if (line.length + 8 > width) { lines.push(line); line = ''; }
    line += '"';
    for (const unit of token.slice(1, -1).match(/\\u[0-9a-fA-F]{4}|\\.|[\ud800-\udbff][\udc00-\udfff]|[^]/g)) {
      // Room for the `"+` that closes the piece at the end of the line.
      if (line.length + unit.length + 2 > width) { lines.push(`${line}"+`); line = '"'; }
      line += unit;
    }
    line += '"';
  }
  if (line !== '') lines.push(line);
  return lines.join('\n');
}

/**
 * The data block of a script: `const D = <data>;` over short lines, and the check that stops the
 * script when its data is not what the CLI wrote.
 * @param {unknown} data what the script draws or reads
 * @param {string} who the start of the script's error messages (`zukai native`)
 */
export function dataBlock(data, who) {
  const json = JSON.stringify(data);
  return `const D =
${wrapJson(data)};
// The length and hash of the data as the CLI wrote it. A copy that lost or changed a character
// stops here, before the board is read or changed.
const CHECK = [${json.length}, '${dataHash(json)}'];
{
  const text = JSON.stringify(D);
  const hashOf = (text) => {
${HASH_BODY.replace(/^/gm, '    ')}
  };
  const got = [text.length, hashOf(text)];
  if (got[0] !== CHECK[0] || got[1] !== CHECK[1]) {
    throw new Error('${who}: this copy of the script is not the one the CLI wrote: its data has ' + got[0]
      + ' characters and hash ' + got[1] + ', the CLI wrote ' + CHECK[0] + ' and ' + CHECK[1]
      + '. A character was lost or changed in the copy. Nothing was changed. '
      + 'Pass the script to use_figma again from its file, unchanged.');
  }
}
`;
}
