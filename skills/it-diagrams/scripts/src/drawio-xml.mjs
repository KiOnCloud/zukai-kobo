/**
 * Builders for uncompressed draw.io (mxGraph) XML. Every attribute value is XML-escaped; label
 * values are HTML-escaped first because shapes carry html=1 and draw.io renders the value as
 * HTML. Cells are emitted in the order given, so callers put parents before children.
 */

export function xmlAttr(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\r?\n/g, '&#10;');
}

/** Label text as draw.io HTML: markup is shown literally, newlines become line breaks. */
export function htmlLabel(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\r\n?|\n/g, '<br>');
}

const num = (v) => String(Math.round(v * 100) / 100);

/**
 * A vertex cell. With `link`, the cell is wrapped in a draw.io `UserObject` (which is where
 * draw.io keeps links): the id and label move to the wrapper and the mxCell carries the rest.
 * A page link is `data:page/id,<diagram id>`.
 */
export function vertex({ id, value, style, x, y, width, height, parent = '1', connectable, link }) {
  const conn = connectable === false ? ' connectable="0"' : '';
  const geometry = `  <mxGeometry x="${num(x)}" y="${num(y)}" width="${num(width)}" height="${num(height)}" as="geometry"/>`;
  if (link) {
    return [
      `<UserObject label="${xmlAttr(value ?? '')}" link="${xmlAttr(link)}" id="${xmlAttr(id)}">`,
      `  <mxCell style="${xmlAttr(style)}" vertex="1"${conn} parent="${xmlAttr(parent)}">`,
      `  ${geometry}`,
      '  </mxCell>',
      '</UserObject>',
    ];
  }
  return [
    `<mxCell id="${xmlAttr(id)}" value="${xmlAttr(value ?? '')}" style="${xmlAttr(style)}" vertex="1"${conn} parent="${xmlAttr(parent)}">`,
    geometry,
    '</mxCell>',
  ];
}

/** The draw.io link that opens the page with the given diagram id in the same file. */
export function pageLink(diagramId) {
  return `data:page/id,${diagramId}`;
}

export function edge({ id, value, style, source, target, points = [], parent = '1', sourcePoint, targetPoint }) {
  const lines = [
    `<mxCell id="${xmlAttr(id)}" value="${xmlAttr(value ?? '')}" style="${xmlAttr(style)}" edge="1" parent="${xmlAttr(parent)}" source="${xmlAttr(source)}" target="${xmlAttr(target)}">`,
    '  <mxGeometry relative="1" as="geometry">',
  ];
  if (sourcePoint) lines.push(`    <mxPoint x="${num(sourcePoint.x)}" y="${num(sourcePoint.y)}" as="sourcePoint"/>`);
  if (targetPoint) lines.push(`    <mxPoint x="${num(targetPoint.x)}" y="${num(targetPoint.y)}" as="targetPoint"/>`);
  if (points.length > 0) {
    lines.push('    <Array as="points">');
    for (const p of points) lines.push(`      <mxPoint x="${num(p.x)}" y="${num(p.y)}"/>`);
    lines.push('    </Array>');
  }
  lines.push('  </mxGeometry>', '</mxCell>');
  return lines;
}

/**
 * A label that stays attached to its edge. `position` runs from -1 (source end) to 1 (target
 * end); 0 is the midpoint. `offset` nudges the label in pixels.
 */
export function edgeLabel({ id, value, parent, position = 0, offset = { x: 0, y: 0 }, align = 'center', style = `edgeLabel;html=1;align=${align};verticalAlign=middle;resizable=0;points=[];` }) {
  return [
    `<mxCell id="${xmlAttr(id)}" value="${xmlAttr(value)}" style="${xmlAttr(style)}" vertex="1" connectable="0" parent="${xmlAttr(parent)}">`,
    `  <mxGeometry x="${num(position)}" y="0" relative="1" as="geometry">`,
    `    <mxPoint x="${num(offset.x)}" y="${num(offset.y)}" as="offset"/>`,
    '  </mxGeometry>',
    '</mxCell>',
  ];
}

const GEOMETRY = /<mxGeometry x="(-?[\d.]+)" y="(-?[\d.]+)" width="(-?[\d.]+)" height="(-?[\d.]+)"/;
const POINT = /<mxPoint x="(-?[\d.]+)" y="(-?[\d.]+)"/g;

/**
 * Whether a cell built by this module sits directly on the page (parent "1"), and what it is.
 * Children of lanes and containers, and edge labels, keep coordinates relative to their
 * parent, so moving the parent moves them.
 */
function rootCell(cell) {
  const tag = cell[0].startsWith('<UserObject') ? cell[1] : cell[0];
  if (!/\sparent="1"[\s>]/.test(tag)) return null;
  return { vertex: /\svertex="1"/.test(tag), edge: /\sedge="1"/.test(tag) };
}

/** Bounding box of the page-level content: root vertices and the points of root edges. */
export function cellsBounds(cells) {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const extend = (x, y) => { b.minX = Math.min(b.minX, x); b.minY = Math.min(b.minY, y); b.maxX = Math.max(b.maxX, x); b.maxY = Math.max(b.maxY, y); };
  for (const cell of cells) {
    const root = rootCell(cell);
    if (!root) continue;
    for (const line of cell) {
      if (root.vertex) {
        const m = GEOMETRY.exec(line);
        if (m) { extend(+m[1], +m[2]); extend(+m[1] + +m[3], +m[2] + +m[4]); }
      } else if (root.edge) {
        for (const m of line.matchAll(POINT)) extend(+m[1], +m[2]);
      }
    }
  }
  return Number.isFinite(b.minX) ? b : { minX: 0, minY: 0, maxX: 0, maxY: 0 };
}

/** The same cells moved by (dx, dy): root vertices and root edge points shift, relative children do not. */
export function shiftCells(cells, dx, dy) {
  return cells.map((cell) => {
    const root = rootCell(cell);
    if (!root || (dx === 0 && dy === 0)) return cell;
    return cell.map((line) => {
      if (root.vertex) return line.replace(GEOMETRY, (_, x, y, w, h) => `<mxGeometry x="${num(+x + dx)}" y="${num(+y + dy)}" width="${w}" height="${h}"`);
      if (root.edge) return line.replace(POINT, (_, x, y) => `<mxPoint x="${num(+x + dx)}" y="${num(+y + dy)}"`);
      return line;
    });
  });
}

/** Wrap one page's cells into a complete mxfile. */
export function envelope({ diagramId, name, cells, pageWidth = 1169, pageHeight = 827 }) {
  return envelopePages([{ diagramId, name, cells, pageWidth, pageHeight }]);
}

/** Wrap several pages (one `<diagram>` each, in order) into one mxfile. */
export function envelopePages(pages) {
  const lines = [`<mxfile host="it-diagrams" compressed="false" type="device"${pages.length > 1 ? ` pages="${pages.length}"` : ''}>`];
  for (const { diagramId, name, cells, pageWidth = 1169, pageHeight = 827 } of pages) {
    lines.push(
      `  <diagram id="${xmlAttr(diagramId)}" name="${xmlAttr(name)}">`,
      `    <mxGraphModel dx="0" dy="0" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${pageWidth}" pageHeight="${pageHeight}" math="0" shadow="0">`,
      '      <root>',
      '        <mxCell id="0"/>',
      '        <mxCell id="1" parent="0"/>',
    );
    for (const cellLines of cells) for (const l of cellLines) lines.push(`        ${l}`);
    lines.push('      </root>', '    </mxGraphModel>', '  </diagram>');
  }
  lines.push('</mxfile>');
  return lines.join('\n') + '\n';
}
