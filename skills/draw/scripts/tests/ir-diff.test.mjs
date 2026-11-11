import { describe, it, expect } from 'vitest';
import { diffIr, diffRun } from '../src/ir-diff.mjs';
import { validFixtures, loadFixture } from './helpers.mjs';

const clone = (x) => JSON.parse(JSON.stringify(x));

/** The id-carrying top-level arrays of an IR, by name. */
const collectionsOf = (ir) => Object.keys(ir).filter((k) => Array.isArray(ir[k]) && ir[k].length > 0 && ir[k].every((v) => v && typeof v.id === 'string'));

describe('diffIr', () => {
  it('reports nothing for two identical models', () => {
    for (const { ir } of validFixtures()) {
      expect(diffIr(ir, clone(ir))).toEqual({ replaced: false, fields: [], added: [], removed: [], changed: [], reordered: [] });
    }
  });

  // One model per kind: add a copy of an element, drop another, reword a third.
  const firstPerKind = new Map();
  for (const f of validFixtures()) if (!firstPerKind.has(f.kind)) firstPerKind.set(f.kind, f);
  for (const [kind, { ir }] of firstPerKind) {
    it(`lists an added, a removed and a changed element of a ${kind} model by id`, () => {
      const next = clone(ir);
      const [first] = collectionsOf(next);
      const items = next[first];
      const extra = { ...clone(items[0]), id: 'zz-added', label: 'Added element' };
      const dropped = items[items.length - 1];
      const reworded = items[0];
      next[first] = [...items.slice(0, -1), extra];
      next[first][0] = { ...reworded, label: 'New wording' };
      const d = diffIr(ir, next);
      expect(d.replaced).toBe(false);
      expect(d.added).toEqual([{ collection: first, id: 'zz-added', label: 'Added element' }]);
      expect(items.length).toBeGreaterThan(1);
      expect(d.removed).toEqual([{ collection: first, id: dropped.id, label: dropped.label ?? dropped.name ?? dropped.title ?? '' }]);
      expect(d.changed).toEqual([{ collection: first, id: reworded.id, label: 'New wording', fields: ['label'] }]);
    });
  }

  it('compares nested lists as one value of their element', () => {
    const ir = loadFixture('class', firstPerKind.get('class').name);
    const next = clone(ir);
    const cls = next.classes.find((c) => Array.isArray(c.attributes) && c.attributes.length > 0) ?? next.classes[0];
    cls.attributes = [...(cls.attributes ?? []), { name: 'createdAt', type: 'Date', visibility: 'private' }];
    const d = diffIr(ir, next);
    expect(d.changed).toEqual([{ collection: 'classes', id: cls.id, label: cls.label, fields: ['attributes'] }]);
  });

  it('reports a new title and a changed kind as a replacement', () => {
    const a = firstPerKind.get('flowchart').ir;
    const b = firstPerKind.get('state').ir;
    const d = diffIr(a, b);
    expect(d.replaced).toBe(true);
    expect(d.fields.map((f) => f.field)).toContain('kind');
  });

  it('orders the lists by collection and id, whatever the order in the files', () => {
    const ir = firstPerKind.get('flowchart').ir;
    const next = clone(ir);
    next.nodes = [...next.nodes, { id: 'b-new', label: 'B', shape: 'process' }, { id: 'a-new', label: 'A', shape: 'process' }];
    expect(diffIr(ir, next).added.map((e) => e.id)).toEqual(['a-new', 'b-new']);
  });
});

describe('diffRun', () => {
  const main = {
    schemaVersion: 1, kind: 'flowchart', title: 'Checkout',
    nodes: [
      { id: 'start', label: 'Start', shape: 'terminal' },
      { id: 'pay', label: 'Pay', shape: 'subroutine', ref: 'checkout-01-pay' },
      { id: 'done', label: 'Done', shape: 'terminal' },
    ],
    edges: [{ id: 'e1', from: 'start', to: 'pay' }, { id: 'e2', from: 'pay', to: 'done' }],
  };
  const part = { schemaVersion: 1, kind: 'flowchart', title: 'Pay', nodes: [{ id: 'card', label: 'Charge card', shape: 'process' }], edges: [] };
  const business = { ...clone(main), meta: { audience: 'business' } };
  const run = (m, p = part, b = business) => [{ id: 'checkout', ir: m }, { id: 'checkout-01-pay', ir: p }, { id: 'checkout-business', ir: b }];

  it('reports an unchanged run as not differing', () => {
    expect(diffRun(run(main), run(clone(main)))).toEqual({ differs: false, diagramsAdded: [], diagramsRemoved: [], diagrams: [], hints: [] });
  });

  it('hints at the part behind a changed ref element and at an unchanged business view', () => {
    const next = clone(main);
    next.nodes[1].label = 'Pay by card';
    const d = diffRun(run(main), run(next));
    expect(d.differs).toBe(true);
    expect(d.diagrams.map((x) => x.id)).toEqual(['checkout']);
    expect(d.hints).toEqual([
      { diagram: 'checkout', message: 'part checkout-01-pay may need the same change (nodes pay carries ref "checkout-01-pay")' },
      { diagram: 'checkout', message: 'business view not updated: checkout-business is unchanged' },
    ]);
  });

  it('drops a hint once the part or the business view changed too', () => {
    const next = clone(main);
    next.nodes[1].label = 'Pay by card';
    const nextPart = clone(part);
    nextPart.nodes[0].label = 'Charge the card';
    const nextBusiness = clone(business);
    nextBusiness.nodes[1].label = 'Pay';
    nextBusiness.title = 'Checkout (business)';
    expect(diffRun(run(main), run(next, nextPart, nextBusiness)).hints).toEqual([]);
  });

  it('names a removed element that an edge still uses', () => {
    const next = clone(main);
    next.nodes = next.nodes.filter((n) => n.id !== 'done');
    const d = diffRun([{ id: 'checkout', ir: main }], [{ id: 'checkout', ir: next }]);
    expect(d.hints).toEqual([{ diagram: 'checkout', message: 'removed done is still referenced at /edges/1/to' }]);
  });

  it('lists added and removed diagrams and a ref left pointing at a removed one', () => {
    const d = diffRun(run(main), [{ id: 'checkout', ir: main }, { id: 'checkout-02-ship', ir: part }]);
    expect(d.diagramsAdded).toEqual(['checkout-02-ship']);
    expect(d.diagramsRemoved).toEqual(['checkout-01-pay', 'checkout-business']);
    expect(d.hints).toEqual([
      { diagram: 'checkout-02-ship', message: 'new diagram checkout-02-ship is not the ref of any element: link it from the element it details, or say in the report that it stands on its own' },
      { diagram: 'checkout', message: 'removed diagram checkout-01-pay is still the ref of /nodes/1/ref' },
    ]);
  });

  it('reports a change of meta.source, and does not ask the business view to follow it', () => {
    const next = clone(main);
    next.meta = { source: 'manual', notes: ['changed by hand from r002 on'] };
    const d = diffRun(run(main), run(next));
    expect(d.diagrams[0].fields.map((f) => f.field)).toEqual(['meta.source', 'meta.notes']);
    expect(d.hints).toEqual([]);
  });

  it('hints at a business view left behind by a removed technical diagram', () => {
    const d = diffRun(run(main), [{ id: 'checkout-01-pay', ir: part }, { id: 'checkout-business', ir: business }]);
    expect(d.hints).toContainEqual({ diagram: 'checkout-business', message: 'checkout was removed but its business view checkout-business stays' });
  });

  const unlinked = (id) => ({ diagram: id, message: `new diagram ${id} is not the ref of any element: link it from the element it details, or say in the report that it stands on its own` });
  const arch = (title) => ({
    schemaVersion: 1, kind: 'architecture', title,
    nodes: [{ id: 'api', label: 'API' }, { id: 'db', label: 'DB' }],
    edges: [{ id: 'e1', from: 'api', to: 'db' }],
  });

  it('gives no hint for an added part that an element of the main diagram references', () => {
    const next = clone(main);
    next.nodes[2].ref = 'checkout-02-done';
    const d = diffRun(run(main), [...run(next), { id: 'checkout-02-done', ir: part }]);
    expect(d.diagramsAdded).toEqual(['checkout-02-done']);
    expect(d.hints.filter((h) => h.diagram === 'checkout-02-done')).toEqual([]);
  });

  it('hints at an added diagram that no element references', () => {
    const d = diffRun(run(main), [...run(main), { id: 'checkout-02-ship', ir: part }, { id: 'checkout-03-tax', ir: part }]);
    expect(d.hints).toEqual([unlinked('checkout-02-ship'), unlinked('checkout-03-tax')]);
  });

  it('hints at an added architecture diagram beside an existing one, and drops the link hint once it is referenced', () => {
    const old = [{ id: 'shop', ir: arch('Shop') }];
    const second = (id) => `${id} is a second architecture diagram beside shop: an architecture diagram shows each resource once, so the detail of shop belongs in a part of another kind (sequence, activity, er) linked with ref`;
    const d = diffRun(old, [...old, { id: 'shop-02-detail', ir: arch('Shop detail') }, { id: 'shop-business', ir: arch('Shop (business)') }]);
    expect(d.hints).toEqual([unlinked('shop-02-detail'), { diagram: 'shop-02-detail', message: second('shop-02-detail') }]);

    const linked = arch('Shop');
    linked.nodes[0].ref = 'shop-02-detail';
    const r = diffRun(old, [{ id: 'shop', ir: linked }, { id: 'shop-02-detail', ir: arch('Shop detail') }]);
    expect(r.hints).toEqual([{ diagram: 'shop-02-detail', message: second('shop-02-detail') }]);
  });

  it('gives no hint for an added business view', () => {
    const d = diffRun([{ id: 'shop', ir: arch('Shop') }], [{ id: 'shop', ir: arch('Shop') }, { id: 'shop-business', ir: arch('Shop (business)') }]);
    expect(d.diagramsAdded).toEqual(['shop-business']);
    expect(d.hints).toEqual([]);
  });

  it('gives no added-diagram hints on a first delivery', () => {
    const d = diffRun([], [{ id: 'shop', ir: arch('Shop') }, { id: 'shop-02-detail', ir: arch('Shop detail') }]);
    expect(d.diagramsAdded).toEqual(['shop', 'shop-02-detail']);
    expect(d.hints).toEqual([]);
  });
});
