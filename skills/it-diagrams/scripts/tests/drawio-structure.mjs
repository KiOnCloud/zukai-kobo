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
