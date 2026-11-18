/**
 * A stand-in for the part of the FigJam Plugin API that Zukai's scripts use: enough to run a
 * script of `emit --native` (or the overlay script's drawings) and then the reader script of
 * `extract --figjam-script` on the same page, so a test can draw a board and read it back
 * without Figma. It was checked against a real board: the use case section that a native
 * script drew there reads back through this stand-in with the same node labels, shapes, edges,
 * line ends and kind hints as the real read; only the widths of texts differ.
 *
 * What it models, as Figma does:
 * - a vector takes its box from its path; its `vectorNetwork` holds the end point of every
 *   segment (no control points), relative to that box, and `absoluteTransform` moves it there;
 * - a text measures itself by its characters and size and wraps when the script fixes a width;
 * - a group has no coordinates of its own: its box is that of its children;
 * - a section holds its children, the page finds nodes at any depth.
 */

const pathBounds = (data) => {
  const nums = data.split(' ').filter((t) => t !== '' && !Number.isNaN(Number(t))).map(Number);
  const xs = nums.filter((_, i) => i % 2 === 0);
  const ys = nums.filter((_, i) => i % 2 === 1);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
};

const verticesOf = (data) => {
  const t = data.split(' ');
  const v = [];
  let i = 0;
  while (i < t.length) {
    const c = t[i];
    if (c === 'M' || c === 'L') { v.push({ x: +t[i + 1], y: +t[i + 2] }); i += 3; }
    else if (c === 'Q') { v.push({ x: +t[i + 3], y: +t[i + 4] }); i += 5; }
    else if (c === 'C') { v.push({ x: +t[i + 5], y: +t[i + 6] }); i += 7; }
    else i += 1;
  }
  return v;
};

/** A fresh page and the `figma` object a script receives. */
export function standInFigma() {
  let seq = 1;
  const page = { type: 'PAGE', name: 'Page 1', children: [] };

  class Node {
    constructor(type) {
      Object.assign(this, { type, id: `1:${++seq}`, name: type, parent: null, x: 0, y: 0, width: 0, height: 0, fills: [], strokes: [], dashPattern: [], rotation: 0 });
    }

    resize(w, h) { this.width = w; this.height = h; }

    resizeWithoutConstraints(w, h) { this.width = w; this.height = h; }

    remove() {
      const p = this.parent ?? page;
      p.children.splice(p.children.indexOf(this), 1);
      this.parent = null;
      if (p.type === 'GROUP' && p.children.length === 0) p.remove();
    }

    get absoluteBoundingBox() { return { x: this.x, y: this.y, width: this.width, height: this.height }; }

    get absoluteTransform() { return [[1, 0, this.x], [0, 1, this.y]]; }
  }
  const adopt = (holder) => (n) => {
    if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1);
    holder.children.push(n);
    n.parent = holder;
  };

  class Vector extends Node {
    constructor() { super('VECTOR'); this.paths = []; }

    set vectorPaths(p) {
      this.paths = p;
      const b = pathBounds(p.map((q) => q.data).join(' '));
      Object.assign(this, { x: b.x, y: b.y, width: b.w, height: b.h });
    }

    get vectorPaths() { return this.paths; }

    get vectorNetwork() { return { vertices: this.paths.flatMap((p) => verticesOf(p.data)).map((v) => ({ x: v.x - this.x, y: v.y - this.y })) }; }
  }

  class Text extends Node {
    constructor() { super('TEXT'); this.chars = ''; this.fontSize = 12; this.fixed = undefined; }

    set characters(s) { this.chars = s; }

    get characters() { return this.chars; }

    natural() { return Math.max(...this.chars.split('\n').map((l) => l.length)) * this.fontSize * 0.52; }

    get width() { return this.fixed ?? this.natural(); }

    set width(v) { /* measured, not set */ }

    get height() {
      const lines = this.chars.split('\n').length;
      return (this.fixed ? Math.max(lines, Math.ceil(this.natural() / this.fixed)) : lines) * this.fontSize * 1.15;
    }

    set height(v) { /* measured, not set */ }

    resize(w) { this.fixed = w; }

    setRangeFontName() {}
  }

  class Group extends Node {
    constructor() { super('GROUP'); this.children = []; this.appendChild = adopt(this); }

    get absoluteBoundingBox() {
      const bs = this.children.map((c) => c.absoluteBoundingBox);
      const x = Math.min(...bs.map((b) => b.x));
      const y = Math.min(...bs.map((b) => b.y));
      return { x, y, width: Math.max(...bs.map((b) => b.x + b.width)) - x, height: Math.max(...bs.map((b) => b.y + b.height)) - y };
    }
  }

  class Section extends Node {
    constructor() { super('SECTION'); this.children = []; this.appendChild = adopt(this); }
  }

  const findAll = (n, f, out = []) => { for (const c of n.children ?? []) { if (f(c)) out.push(c); findAll(c, f, out); } return out; };
  page.appendChild = adopt(page);
  page.findAll = (f) => findAll(page, f);
  page.findOne = (f) => findAll(page, f)[0] ?? null;

  const figma = {
    currentPage: page,
    createSection() { const s = new Section(); page.appendChild(s); return s; },
    createRectangle: () => new Node('RECTANGLE'),
    createEllipse: () => new Node('ELLIPSE'),
    createVector: () => new Vector(),
    createText: () => new Text(),
    group(nodes, parent) {
      if (nodes.length === 0) throw new Error('group: no nodes');
      const g = new Group();
      for (const n of nodes) g.appendChild(n);
      parent.appendChild(g);
      return g;
    },
    loadFontAsync: async () => {},
  };
  const AsyncFunction = (async () => {}).constructor;
  /** Run a script as use_figma does: top-level await, and its `return` is the result. */
  const run = (script) => new AsyncFunction('figma', script)(figma);
  return { figma, page, run };
}
