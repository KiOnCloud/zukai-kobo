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
      expect(d.changed).toEqual([{ collection: first, id: reworded.id, label: 'New wording', fields: ['label'], values: { label: { from: reworded.label, to: 'New wording' } } }]);
    });
  }

  it('compares nested lists as one value of their element', () => {
    const ir = loadFixture('class', firstPerKind.get('class').name);
    const next = clone(ir);
    const cls = next.classes.find((c) => Array.isArray(c.attributes) && c.attributes.length > 0) ?? next.classes[0];
    cls.attributes = [...(cls.attributes ?? []), { name: 'createdAt', type: 'Date', visibility: 'private' }];
    const d = diffIr(ir, next);
    const was = ir.classes.find((c) => c.id === cls.id).attributes;
    expect(d.changed).toEqual([{ collection: 'classes', id: cls.id, label: cls.label, fields: ['attributes'], values: { attributes: { from: was, to: cls.attributes } } }]);
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

describe('a message put into or taken out of nested blocks', () => {
  // Three blocks around one another, as a sequence diagram of a login draws them.
  const login = {
    schemaVersion: 1, kind: 'sequence', title: 'Login',
    participants: [{ id: 'web', label: 'Web' }, { id: 'auth', label: 'Auth' }],
    messages: [
      { id: 'm1', from: 'web', to: 'auth', label: 'login' },
      { id: 'm2', from: 'auth', to: 'auth', label: 'verify password' },
      { id: 'm3', from: 'auth', to: 'web', label: 'session', kind: 'return' },
      { id: 'm4', from: 'auth', to: 'web', label: 'locked', kind: 'return' },
    ],
    blocks: [
      { id: 'outer', kind: 'alt', label: 'user found', messages: ['m2', 'm3'], branches: [{ label: 'user locked', messages: ['m4'] }] },
      { id: 'middle', kind: 'opt', label: 'not locked', messages: ['m2', 'm3'] },
      { id: 'inner', kind: 'opt', label: 'password matches', messages: ['m3'] },
    ],
  };
  const withAudit = () => {
    const next = clone(login);
    next.messages.splice(3, 0, { id: 'audit', from: 'auth', to: 'auth', label: 'record the login' });
    for (const b of next.blocks) b.messages.push('audit');
    return next;
  };

  it('reports the message, not the blocks whose lists grew by it', () => {
    const d = diffIr(login, withAudit());
    expect(d.added).toEqual([{ collection: 'messages', id: 'audit', label: 'record the login' }]);
    expect(d.changed).toEqual([]);
    expect(d.reordered).toEqual([]);
  });

  it('reports a removed message the same way, in a first section and in a branch', () => {
    const d = diffIr(withAudit(), login);
    expect(d.removed.map((e) => e.id)).toEqual(['audit']);
    expect(d.changed).toEqual([]);
    const branch = clone(login);
    branch.messages.push({ id: 'm5', from: 'auth', to: 'web', label: 'try later', kind: 'return' });
    branch.blocks[0].branches[0].messages.push('m5');
    expect(diffIr(login, branch).changed).toEqual([]);
    expect(diffIr(branch, login).changed).toEqual([]);
  });

  it('still reports a block that took in a message both versions have, a new section and a new condition', () => {
    const moved = clone(login);
    moved.blocks[2].messages = ['m2', 'm3'];
    expect(diffIr(login, moved).changed.map((e) => [e.id, e.fields])).toEqual([['inner', ['messages']]]);

    const section = withAudit();
    section.messages.push({ id: 'm5', from: 'auth', to: 'web', label: 'try later', kind: 'return' });
    section.blocks[0].branches.push({ label: 'too many attempts', messages: ['m5'] });
    expect(diffIr(login, section).changed.map((e) => [e.id, e.fields])).toEqual([['outer', ['branches']]]);

    const reworded = withAudit();
    reworded.blocks[1].label = 'account active';
    expect(diffIr(login, reworded).changed.map((e) => [e.id, e.fields])).toEqual([['middle', ['label']]]);
  });

  it('reads a container the same way: a member that came or went is the change, not the frame around it', () => {
    const flowchart = { schemaVersion: 1, kind: 'flowchart', title: 'F', nodes: [{ id: 'a', label: 'A' }, { id: 'c', label: 'C' }], edges: [], groups: [{ id: 'g', label: 'G', children: ['a'] }] };
    const gained = clone(flowchart);
    gained.nodes.push({ id: 'b', label: 'B' });
    gained.groups[0].children.push('b');
    expect(diffIr(flowchart, gained)).toMatchObject({ added: [{ collection: 'nodes', id: 'b' }], changed: [] });
    // The other way round the node is gone, and again the group is not in the list.
    expect(diffIr(gained, flowchart)).toMatchObject({ removed: [{ collection: 'nodes', id: 'b' }], changed: [] });
    // A node both versions have that is put into the group is a change of the group: nothing else says it.
    const moved = clone(flowchart);
    moved.groups[0].children.push('c');
    expect(diffIr(flowchart, moved).changed).toEqual([{ collection: 'groups', id: 'g', label: 'G', fields: ['children'], values: { children: { from: ['a'], to: ['a', 'c'] } } }]);
    // The same for a boundary of a use case diagram and for a composite state.
    const usecase = { schemaVersion: 1, kind: 'usecase', title: 'U', actors: [{ id: 'user', label: 'User' }], useCases: [{ id: 'book', label: 'Book' }], boundaries: [{ id: 'sys', label: 'System', children: ['book'] }], relations: [{ id: 'r1', from: 'user', to: 'book', kind: 'association' }] };
    const more = clone(usecase);
    more.useCases.push({ id: 'cancel', label: 'Cancel' });
    more.boundaries[0].children.push('cancel');
    expect(diffIr(usecase, more).changed).toEqual([]);
    const state = { schemaVersion: 1, kind: 'state', title: 'S', states: [{ id: 'run', label: 'Running', children: ['warm'] }, { id: 'warm', label: 'Warming up' }], transitions: [] };
    const deeper = clone(state);
    deeper.states.push({ id: 'steady', label: 'Steady' });
    deeper.states[0].children.push('steady');
    expect(diffIr(state, deeper).changed).toEqual([]);
    // A container that also changed something of its own is still listed, with that field alone.
    deeper.states[0].label = 'In operation';
    expect(diffIr(state, deeper).changed.map((e) => [e.id, e.fields])).toEqual([['run', ['label']]]);
  });

});

describe('the old value of a changed field', () => {
  const er = {
    schemaVersion: 1, kind: 'state', title: 'S',
    states: [{ id: 's0', kind: 'initial' }, { id: 'open', label: 'Open' }, { id: 'closed', label: 'Closed' }],
    transitions: [{ id: 't1', from: 's0', to: 'open' }, { id: 't2', from: 'open', to: 'closed', event: 'close', guard: 'at most 5 failed attempts' }],
  };

  it('stands beside the new one for every field, with a side left out where the field was not set', () => {
    const next = clone(er);
    next.transitions[1].guard = 'at most 3 failed attempts';
    next.transitions[1].action = 'notify the owner';
    delete next.transitions[1].event;
    next.states[1].label = 'Active';
    const d = diffIr(er, next);
    expect(d.changed).toEqual([
      { collection: 'states', id: 'open', label: 'Active', fields: ['label'], values: { label: { from: 'Open', to: 'Active' } } },
      { collection: 'transitions', id: 't2', label: 'at most 3 failed attempts', fields: ['action', 'event', 'guard'], values: {
        action: { to: 'notify the owner' },
        event: { from: 'close' },
        guard: { from: 'at most 5 failed attempts', to: 'at most 3 failed attempts' },
      } },
    ]);
    // The keys a reader of 2.3.0 knows are all still there.
    for (const e of d.changed) expect(Object.keys(e)).toEqual(['collection', 'id', 'label', 'fields', 'values']);
  });

  it('goes through diffRun to the list of a run unchanged', () => {
    const next = clone(er);
    next.states[2].label = 'Archived';
    const d = diffRun([{ id: 'ticket', ir: er }], [{ id: 'ticket', ir: next }]);
    expect(d.diagrams[0].changed[0].values).toEqual({ label: { from: 'Closed', to: 'Archived' } });
  });
});
