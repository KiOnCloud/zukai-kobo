import ELK from 'elkjs/lib/elk.bundled.js';
import { longestLine } from './text-metrics.mjs';

/**
 * Graph layout through elkjs (layered algorithm) for every kind except sequence. ELK never
 * measures text, so node and label sizes are estimated here, in one place, with a
 * character-width heuristic.
 */

const CHAR_WIDTH = 7;
const LINE_HEIGHT = 20;
const ROW_HEIGHT = 18;

/** Size of a node from its label and the number of extra rows (attributes, members). */
export function measureNode(label, { extraRows = 0, minWidth = 120, maxWidth = 260, baseHeight = 40 } = {}) {
  const lines = String(label).split(/\r\n?|\n/);
  const longest = longestLine(label);
  const width = Math.min(maxWidth, Math.max(minWidth, Math.ceil(CHAR_WIDTH * longest) + 24));
  const height = baseHeight + LINE_HEIGHT * (lines.length - 1) + ROW_HEIGHT * extraRows;
  return { width, height };
}

export function measureLabel(text) {
  const lines = String(text).split(/\r\n?|\n/);
  const longest = longestLine(text);
  return { width: Math.ceil(CHAR_WIDTH * longest) + 8, height: 16 * lines.length };
}

const ELK_DIRECTION = { TB: 'DOWN', BT: 'UP', LR: 'RIGHT', RL: 'LEFT' };

let elkInstance;
const elk = () => (elkInstance ??= new ELK());

/**
 * @param {object} input
 * @param {Array<{id:string,width:number,height:number,parent?:string}>} input.nodes
 * @param {Array<{id:string,parent?:string,headerHeight?:number}>} input.containers
 * @param {Array<{id:string,from:string,to:string,label?:string}>} input.edges
 * @param {string} [input.direction]
 * @returns {Promise<{ nodes: Map<string,{x,y,width,height}>, containers: Map<string,{x,y,width,height}>, edges: Map<string,{points:Array<{x,y}>}> }>}
 *   Node and container coordinates are relative to their parent (draw.io convention);
 *   edge bend points are absolute (edge cells sit on the root layer).
 */
export async function layoutGraph({ nodes, containers = [], edges, direction = 'TB', spacing = {} }) {
  const nodeSpacing = spacing.nodeNode ?? 40;
  const layerSpacing = spacing.layer ?? 60;
  const byParent = new Map();
  const add = (parent, child) => {
    if (!byParent.has(parent)) byParent.set(parent, []);
    byParent.get(parent).push(child);
  };
  for (const c of containers) add(c.parent ?? null, { ...c, isContainer: true });
  for (const n of nodes) add(n.parent ?? null, { ...n, isContainer: false });

  const build = (parent) => (byParent.get(parent) ?? []).map((el) => {
    if (!el.isContainer) {
      // Fixed ports pin where edges meet the node (ER rows); ELK routes from those points.
      if (el.ports?.length) {
        return { id: el.id, width: el.width, height: el.height, layoutOptions: { 'elk.portConstraints': 'FIXED_POS' }, ports: el.ports.map((p) => ({ id: p.id, x: p.x, y: p.y, width: 1, height: 1 })) };
      }
      return { id: el.id, width: el.width, height: el.height };
    }
    const header = el.headerHeight ?? 30;
    return {
      id: el.id,
      layoutOptions: { 'elk.padding': `[top=${header + 20},left=20,bottom=20,right=20]` },
      children: build(el.id),
    };
  });

  const graph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': ELK_DIRECTION[direction] ?? 'DOWN',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.json.edgeCoords': 'ROOT',
      'elk.spacing.nodeNode': String(nodeSpacing),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(layerSpacing),
      'elk.spacing.edgeNode': '25',
      'elk.layered.spacing.edgeNodeBetweenLayers': '25',
      'elk.spacing.edgeEdge': String(spacing.edgeEdge ?? 20),
      'elk.layered.spacing.edgeEdgeBetweenLayers': String(spacing.edgeEdge ?? 20),
      'elk.spacing.edgeLabel': '6',
      'elk.spacing.portPort': '20',
      'elk.edgeLabels.placement': 'CENTER',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
    },
    children: build(null),
    edges: edges.map((e) => ({
      id: e.id,
      sources: [e.fromPort ?? e.from],
      targets: [e.toPort ?? e.to],
      labels: e.label ? [{ text: e.label, ...measureLabel(e.label) }] : [],
    })),
  };

  const laid = await elk().layout(graph);
  const nodeOut = new Map();
  const containerOut = new Map();
  const walk = (children) => {
    for (const c of children ?? []) {
      const box = { x: c.x ?? 0, y: c.y ?? 0, width: c.width, height: c.height };
      if (c.children) {
        containerOut.set(c.id, box);
        walk(c.children);
      } else {
        nodeOut.set(c.id, box);
      }
    }
  };
  walk(laid.children);
  const edgeOut = new Map();
  for (const e of laid.edges ?? []) {
    const points = [];
    for (const s of e.sections ?? []) for (const p of s.bendPoints ?? []) points.push({ x: p.x, y: p.y });
    const first = e.sections?.[0];
    const last = e.sections?.at(-1);
    const lbl = e.labels?.[0];
    edgeOut.set(e.id, {
      points,
      start: first?.startPoint ? { x: first.startPoint.x, y: first.startPoint.y } : undefined,
      end: last?.endPoint ? { x: last.endPoint.x, y: last.endPoint.y } : undefined,
      // ELK's label box, absolute; the emitter turns it into draw.io's relative label geometry.
      label: lbl && lbl.x !== undefined ? { x: lbl.x, y: lbl.y, width: lbl.width, height: lbl.height } : undefined,
    });
  }
  return { nodes: nodeOut, containers: containerOut, edges: edgeOut };
}
