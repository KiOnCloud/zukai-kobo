import { XMLParser } from 'fast-xml-parser';

/**
 * Structural checks for a .drawio file, derived from the rules of draw.io's mxfile.xsd:
 * mxfile > diagram > mxGraphModel > root, cells 0 and 1 present, unique ids, every other cell
 * is a vertex or an edge, and every parent, source and target resolves to a cell.
 * Returns the list of problems (empty means structurally valid) and the parsed cells.
 */
export function checkDrawioStructure(xml) {
  const problems = [];
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', allowBooleanAttributes: true, isArray: (name) => ['diagram', 'mxCell', 'mxPoint', 'UserObject'].includes(name) });
  let doc;
  try {
    doc = parser.parse(xml, true);
  } catch (e) {
    return { problems: [`not well-formed XML: ${e.message}`], cells: [] };
  }
  const mxfile = doc.mxfile;
  if (!mxfile) return { problems: ['missing <mxfile> root'], cells: [] };
  if (mxfile.compressed !== 'false') problems.push('mxfile must declare compressed="false"');
  const diagrams = mxfile.diagram ?? [];
  if (diagrams.length === 0) problems.push('no <diagram> element');
  const cells = [];
  for (const d of diagrams) {
    if (!d.id || !d.name) problems.push('diagram needs id and name');
    const root = d.mxGraphModel?.root;
    if (!root) { problems.push('diagram has no mxGraphModel/root'); continue; }
    // A UserObject wraps one mxCell and carries its id, label and link (draw.io's link form).
    const wrapped = (root.UserObject ?? []).map((u) => {
      const inner = (u.mxCell ?? [])[0] ?? {};
      if (u.mxCell?.length !== 1) problems.push(`UserObject "${u.id}" must wrap exactly one mxCell`);
      return { ...inner, id: u.id, value: u.label, link: u.link };
    });
    const pageCells = [...(root.mxCell ?? []), ...wrapped];
    const ids = new Set();
    for (const c of pageCells) {
      if (c.id === undefined) { problems.push('cell without id'); continue; }
      if (ids.has(c.id)) problems.push(`duplicate cell id "${c.id}" on page "${d.name}"`);
      ids.add(c.id);
    }
    if (!ids.has('0') || !ids.has('1')) problems.push(`cells "0" and "1" are mandatory on page "${d.name}"`);
    for (const c of pageCells) {
      if (c.id === '0' || c.id === '1') continue;
      const isVertex = c.vertex === '1';
      const isEdge = c.edge === '1';
      if (isVertex === isEdge) problems.push(`cell "${c.id}" must be exactly one of vertex or edge`);
      if (c.parent === undefined || !ids.has(c.parent)) problems.push(`cell "${c.id}" has unresolved parent "${c.parent}"`);
      if (isEdge) {
        for (const end of ['source', 'target']) {
          if (c[end] !== undefined && !ids.has(c[end])) problems.push(`edge "${c.id}" has unresolved ${end} "${c[end]}"`);
        }
      }
      if (!c.mxGeometry) problems.push(`cell "${c.id}" has no geometry`);
    }
    cells.push(...pageCells);
  }
  if (diagrams.length > 1) {
    const names = diagrams.map((d) => d.name);
    if (new Set(names).size !== names.length) problems.push('page names must be unique');
  }
  return { problems, cells };
}

/** Geometry helpers for invariant tests. */
export function cellBounds(cell) {
  const g = cell.mxGeometry ?? {};
  return { x: Number(g.x ?? 0), y: Number(g.y ?? 0), width: Number(g.width ?? 0), height: Number(g.height ?? 0) };
}

/** Absolute bounds of every vertex (children are relative to their parent chain). */
export function absoluteBounds(cells) {
  const byId = new Map(cells.map((c) => [c.id, c]));
  const abs = new Map();
  const of = (c) => {
    if (abs.has(c.id)) return abs.get(c.id);
    const b = cellBounds(c);
    const parent = byId.get(c.parent);
    abs.set(c.id, parent && parent.vertex === '1' ? { ...b, x: b.x + of(parent).x, y: b.y + of(parent).y } : b);
    return abs.get(c.id);
  };
  for (const c of cells) if (c.vertex === '1') of(c);
  return abs;
}

const styleNumber = (style, key) => Number(style.match(new RegExp(`${key}=(-?[\\d.]+)`))?.[1] ?? 0);

/**
 * Every edge as draw.io draws it: the exit anchor on the source box (with its pixel offset),
 * the waypoints, the entry anchor on the box the edge ends at. Keyed by cell id.
 */
export function edgePaths(cells, abs = absoluteBounds(cells)) {
  const paths = new Map();
  for (const c of cells) {
    if (c.edge !== '1') continue;
    const end = (box, prefix) => ({
      x: box.x + styleNumber(c.style, `${prefix}X`) * box.width + styleNumber(c.style, `${prefix}Dx`),
      y: box.y + styleNumber(c.style, `${prefix}Y`) * box.height + styleNumber(c.style, `${prefix}Dy`),
    });
    const waypoints = (c.mxGeometry?.Array?.mxPoint ?? []).map((p) => ({ x: Number(p.x), y: Number(p.y) }));
    paths.set(c.id, [end(abs.get(c.source), 'exit'), ...waypoints, end(abs.get(c.target), 'entry')]);
  }
  return paths;
}

/**
 * Box of a label anchored at one end of its edge (relative x of -1 or 1 plus an absolute
 * offset), at the width draw.io renders the text (about 5.6 px a character).
 */
export function endLabelBox(cell, path) {
  const at = Number(cell.mxGeometry.x) < 0 ? path[0] : path.at(-1);
  const offset = cell.mxGeometry.mxPoint[0];
  const width = cell.value.replace(/<[^>]+>/g, '').length * 5.6 + 4;
  const x = at.x + Number(offset.x);
  const align = cell.style.match(/align=(\w+)/)?.[1] ?? 'center';
  return { x: align === 'left' ? x : align === 'right' ? x - width : x - width / 2, y: at.y + Number(offset.y) - 8, width, height: 16 };
}
