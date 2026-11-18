import { describe, it, expect } from 'vitest';
import { visualDiff, isVisualDiff, DIFF_COLOURS } from '../src/visual-diff.mjs';
import { validateIr } from '../src/validate-ir.mjs';
import { emit } from '../src/pipeline.mjs';
import { checkDrawioStructure } from './drawio-structure.mjs';
import { loadFixture } from './helpers.mjs';
import { CASES, versions, STATE_COLOURS, ANY_STATE_COLOUR } from './visual-diff-cases.mjs';

/** Text as it stands in the XML of an HTML label: escaped for HTML, then for the attribute. */
const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inLabel = (s) => esc(esc(s));
const pagesOf = (xml) => [...xml.matchAll(/<diagram id="([^"]+)" name="([^"]+)"/g)].map((m) => ({ id: m[1], name: m[2] }));
const draw = async (before, after, options) => visualDiff(before, after, options);
const styles = (xml) => new Map(checkDrawioStructure(xml).cells.map((c) => [c.id, c.style ?? '']));

const flow = (title, extra = {}) => ({
  schemaVersion: 1, kind: 'flowchart', title,
  nodes: [{ id: 'start', label: 'Start', shape: 'terminal' }, { id: 'check', label: 'Check the request' }, { id: 'done', label: 'Done', shape: 'terminal' }],
  edges: [{ id: 'e1', from: 'start', to: 'check' }, { id: 'e2', from: 'check', to: 'done' }],
  ...extra,
});

describe('the picture of a diff, one edited model per kind', () => {
  for (const c of CASES) {
    describe(c.kind, () => {
      const { before, after } = versions(c);
      const result = draw([{ id: c.kind, ir: before }], [{ id: c.kind, ir: after }]);

      it('starts from a valid new model and gives a structurally valid file with one page', async () => {
        expect(validateIr(after).errors).toEqual([]);
        const r = await result;
        expect(r.errors).toEqual([]);
        expect(checkDrawioStructure(r.output).problems).toEqual([]);
        expect(pagesOf(r.output)).toEqual([{ id: c.kind, name: after.title }]);
        expect(r.pages).toMatchObject([{ diagram: c.kind, state: 'changed' }]);
        expect(r.unchanged).toEqual([]);
        expect(isVisualDiff(r.output)).toBe(true);
      });

      it('colours what was added, changed or moved, and removed, and nothing else', async () => {
        const style = styles((await result).output);
        for (const state of ['added', 'changed', 'removed']) {
          for (const id of c.cells[state]) expect(style.get(`${c.kind}:${id}`), `${state} ${id}`).toMatch(STATE_COLOURS[state]);
        }
        for (const id of c.cells.plain) {
          expect(style.has(`${c.kind}:${id}`), `plain ${id}`).toBe(true);
          expect(style.get(`${c.kind}:${id}`), `plain ${id}`).not.toMatch(ANY_STATE_COLOUR);
        }
      });

      it('draws what was removed with a dashed outline, and only that', async () => {
        const style = styles((await result).output);
        for (const id of c.cells.removed.filter((x) => !/:(label|sep-label-\d+)$/.test(x))) expect(style.get(`${c.kind}:${id}`), id).toMatch(/dashed=1;dashPattern=6 4;/);
        for (const id of c.cells.added) expect(style.get(`${c.kind}:${id}`), id).not.toMatch(/dashPattern=6 4/);
      });

      it('counts as the plain diff does and names what it could not draw', async () => {
        const r = await result;
        expect(r.notDrawn.map((e) => e.id)).toEqual(c.notDrawn ?? []);
        const { added, changed, removed } = r.pages[0];
        expect(added).toBeGreaterThan(0);
        expect(changed).toBeGreaterThan(0);
        expect(removed).toBeGreaterThan(0);
      });

      it('writes the old value of what changed in the legend and in a tooltip', async () => {
        const { output } = await result;
        for (const id of ['legend', 'head', 'added', 'changed', 'removed', 'explain', 'notes']) expect(output).toContain(`id="${c.kind}:$diff:${id}"`);
        for (const note of c.notes) expect(output, note).toContain(inLabel(note));
        const what = c.notes[0].slice(c.notes[0].indexOf(': ') + 2);
        expect(output).toContain(`tooltip="${esc(what)}`);
      });
    });
  }

  it('gives a figure a frame behind it and leaves its own colours alone', async () => {
    const c = CASES.find((x) => x.kind === 'architecture');
    const { before, after } = versions(c);
    const { output } = await draw([{ id: 'a', ir: before }], [{ id: 'a', ir: after }]);
    const { cells } = checkDrawioStructure(output);
    const byId = new Map(cells.map((x) => [x.id, x]));
    const plain = styles((await emit(after, 'drawio', { diagramId: 'a' })).output);
    const fill = (style) => /;fillColor=(#[0-9A-Fa-f]{6});/.exec(style)[1];
    expect(byId.get('a:table').style).toContain('shape=mxgraph.aws4.resourceIcon');
    expect(fill(byId.get('a:table').style)).toBe(fill(plain.get('a:table')));
    const frame = byId.get('a:table:$diff:frame');
    const icon = byId.get('a:table');
    expect(frame.parent).toBe(icon.parent);
    expect(Number(frame.mxGeometry.x)).toBe(Number(icon.mxGeometry.x) - 6);
    expect(Number(frame.mxGeometry.width)).toBe(Number(icon.mxGeometry.width) + 12);
    // The frame comes first in the file, so the figure is drawn over it.
    expect(output.indexOf('id="a:table:$diff:frame"')).toBeLessThan(output.indexOf('id="a:table"'));
    // An AWS group keeps its fill; the outline and the title take the colour.
    expect(byId.get('a:data').style).toMatch(/fillColor=none;.*strokeColor=#1B7F3B;strokeWidth=3;fontColor=#0B4F22;/);
  });

  it('keeps the body tint of a lane that stays and tints a lane that is new or gone', async () => {
    const before = loadFixture('activity', 'valid-two-lanes');
    const after = structuredClone(before);
    after.lanes = after.lanes.filter((l) => l.id !== 'support');
    after.actions = [after.actions[0], after.actions[4]];
    after.controls = after.controls.filter((c) => c.id !== 'eligible');
    after.flows = [after.flows[0], { id: 'f9', from: 'request', to: 'ship' }, after.flows[6]];
    expect(validateIr(after).errors).toEqual([]);
    const r = await draw([{ id: 'ret', ir: before }], [{ id: 'ret', ir: after }]);
    expect(r.notDrawn).toEqual([]);
    const style = styles(r.output);
    expect(style.get('ret:support')).toMatch(/strokeColor=#C62828;.*swimlaneFillColor=#FBDCDC;.*dashed=1;/);
    for (const id of ['review', 'approve', 'reject', 'eligible', 'f2', 'f3', 'f4', 'f5', 'f6', 'f8']) expect(style.get(`ret:${id}`), id).toMatch(STATE_COLOURS.removed);
    expect(style.get('ret:customer')).toContain('swimlaneFillColor=#fffbe6');
    expect(style.get('ret:customer')).not.toMatch(ANY_STATE_COLOUR);
    expect(style.get('ret:f9')).toMatch(STATE_COLOURS.added);
    // The removed members stand inside the lane that was removed with them.
    const cells = checkDrawioStructure(r.output).cells;
    expect(cells.find((x) => x.id === 'ret:review').parent).toBe('ret:support');
  });

  it('lists the old value of a member row that changed', async () => {
    const c = CASES.find((x) => x.kind === 'class');
    const { before, after } = versions(c);
    const { output } = await draw([{ id: 'k', ir: before }], [{ id: 'k', ir: after }]);
    expect(output).toContain(inLabel('"Order": Status was: name Status, type OrderStatus, visibility public'));
    expect(output).toContain(`tooltip="${esc('was: name Status, type OrderStatus, visibility public')}"`);
    expect(output).toContain('tooltip="removed: not in the new version"');
  });

  it('uses colours that differ from each other and from the lane and AWS tints', () => {
    const all = Object.values(DIFF_COLOURS).flatMap((c) => Object.values(c));
    expect(new Set(all).size).toBe(all.length);
    // Dark outlines and texts: every channel sum well under that of a pastel tint.
    for (const c of Object.values(DIFF_COLOURS)) {
      for (const hex of [c.stroke, c.font]) {
        const sum = [1, 3, 5].reduce((n, i) => n + parseInt(hex.slice(i, i + 2), 16), 0);
        expect(sum, hex).toBeLessThan(330);
      }
    }
  });
});

describe('the picture of a diff between two versions of a run', () => {
  const main = flow('Checkout', { nodes: [{ id: 'start', label: 'Start', shape: 'terminal' }, { id: 'check', label: 'Check the request', ref: 'shop-01-check' }, { id: 'pay', label: 'Pay', ref: 'shop-02-pay' }, { id: 'done', label: 'Done', shape: 'terminal' }], edges: [{ id: 'e1', from: 'start', to: 'check' }, { id: 'e2', from: 'check', to: 'pay' }, { id: 'e3', from: 'pay', to: 'done' }] });
  const before = [
    { id: 'shop', ir: main },
    { id: 'shop-business', ir: flow('Checkout (business)') },
    { id: 'shop-01-check', ir: flow('Check the request in detail') },
    { id: 'shop-02-pay', ir: loadFixture('sequence', 'valid') },
    { id: 'shop-03-old', ir: flow('Legacy export') },
  ];
  const after = [
    { id: 'shop', ir: { ...main, nodes: main.nodes.map((n) => (n.id === 'done' ? { ...n, label: 'Order placed' } : n)) } },
    before[1],
    { id: 'shop-01-check', ir: flow('Check the request in detail', { nodes: [...flow('x').nodes, { id: 'log', label: 'Write the audit log' }], edges: [...flow('x').edges, { id: 'e3', from: 'check', to: 'log' }] }) },
    before[3],
    { id: 'shop-04-new', ir: flow('Send the receipt') },
  ];

  it('has one page per diagram that changed, was added or was removed, and names the rest', async () => {
    const r = await draw(before, after);
    expect(r.errors).toEqual([]);
    expect(checkDrawioStructure(r.output).problems).toEqual([]);
    expect(pagesOf(r.output)).toEqual([
      { id: 'shop', name: 'Checkout' },
      { id: 'shop-01-check', name: 'Check the request in detail' },
      { id: 'shop-04-new', name: 'Send the receipt (added)' },
      { id: 'shop-03-old', name: 'Legacy export (removed)' },
    ]);
    expect(r.output).toContain('pages="4"');
    expect(r.pages.map((p) => [p.diagram, p.state])).toEqual([['shop', 'changed'], ['shop-01-check', 'changed'], ['shop-04-new', 'added'], ['shop-03-old', 'removed']]);
    expect(r.unchanged).toEqual(['shop-business', 'shop-02-pay']);
  });

  it('marks a diagram that is on one side only as a whole', async () => {
    const { output } = await draw(before, after);
    const style = styles(output);
    for (const id of ['start', 'check', 'done', 'e1', 'e2']) {
      expect(style.get(`shop-04-new:${id}`), id).toMatch(STATE_COLOURS.added);
      expect(style.get(`shop-03-old:${id}`), id).toMatch(STATE_COLOURS.removed);
    }
    expect(style.get('shop-03-old:check')).toContain('dashed=1;');
    expect(output).toContain(inLabel('This diagram is new: it is in the new version only.'));
    expect(output).toContain(inLabel('This diagram was removed: it is in the old version only.'));
    expect(output).toMatch(/id="shop-04-new:title" value="[^"]*Send the receipt[^"]*\(added in the new version\)/);
    expect(output).toMatch(/id="shop-03-old:title" value="[^"]*Legacy export[^"]*\(removed in the new version\)/);
  });

  it('keeps the title of a part that did not change on the step that names it, without a link to a page that is not there', async () => {
    const { output } = await draw(before, after);
    // The changed part is a page of the file: its step links to it.
    expect(output).toMatch(/<UserObject label="[^"]*" link="data:page\/id,shop-01-check" id="shop:check">/);
    // The unchanged part is not: the step still shows its title, and has no link.
    expect(output).toMatch(/<UserObject label="Pay[^"]*↳ [^"]*" id="shop:pay">/);
    expect(output).not.toContain('data:page/id,shop-02-pay');
  });

  it('says that nothing differs, and draws nothing, for the same run twice', async () => {
    const r = await draw(before, before);
    expect(r).toMatchObject({ ok: true, differs: false, unchanged: before.map((e) => e.id) });
    expect(r.output).toBeUndefined();
  });

  it('draws a diagram whose kind changed as two pages, the new one and the old one', async () => {
    const r = await draw([{ id: 'pay', ir: flow('Pay') }], [{ id: 'pay', ir: loadFixture('sequence', 'valid') }]);
    expect(checkDrawioStructure(r.output).problems).toEqual([]);
    expect(pagesOf(r.output).map((p) => p.id)).toEqual(['pay', 'pay-before']);
    expect(pagesOf(r.output)[1].name).toBe('Pay (removed)');
    expect(r.pages.map((p) => [p.diagram, p.page, p.state])).toEqual([['pay', 'pay', 'replaced'], ['pay', 'pay-before', 'replaced']]);
    expect(styles(r.output).get('pay-before:check')).toMatch(STATE_COLOURS.removed);
  });

  it('draws the new model alone, and says which removed elements are missing, when the two versions make no valid model', async () => {
    // The id of a removed node is the id of a group in the new version.
    const old = flow('Reuse', { nodes: [...flow('x').nodes, { id: 'box', label: 'Old step' }], edges: [...flow('x').edges, { id: 'e3', from: 'check', to: 'box' }] });
    const now = flow('Reuse', { groups: [{ id: 'box', label: 'New group', children: ['check'] }] });
    const r = await draw([{ id: 'reuse', ir: old }], [{ id: 'reuse', ir: now }]);
    expect(r.errors).toEqual([]);
    expect(checkDrawioStructure(r.output).problems).toEqual([]);
    expect(r.notDrawn.map((e) => [e.collection, e.id])).toEqual([['edges', 'e3'], ['nodes', 'box']]);
    expect(r.notDrawn[0].reason).toMatch(/do not make one valid model/);
    expect(r.output).toContain(inLabel('Removed, not drawn: "Old step" (nodes box)'));
    const style = styles(r.output);
    expect(style.get('reuse:box')).toMatch(STATE_COLOURS.added);
    expect(style.has('reuse:e3')).toBe(false);
  });

  it('puts a removed message and its removed section back in the order they had', async () => {
    const c = CASES.find((x) => x.kind === 'sequence');
    const { before: old, after: now } = versions(c);
    const { output } = await draw([{ id: 's', ir: old }], [{ id: 's', ir: now }]);
    const y = (id) => Number(new RegExp(`id="${id}"[\\s\\S]*?<mxPoint x="[-\\d.]+" y="([-\\d.]+)"`).exec(output)[1]);
    // m6 is new and stands before m4; m5 is removed and stands after m4, as it did.
    expect(y('s:m6')).toBeLessThan(y('s:m4'));
    expect(y('s:m4')).toBeLessThan(y('s:m5'));
    expect(output).toContain(inLabel('declined after 3 attempts'));
  });

  it('refuses a credential that only the old version holds, unless it is allowed', async () => {
    const secret = ['postgres://app:', 'Sup3r', 'S3cret', '@db.internal/shop'].join('');
    const old = flow('Secret', { nodes: flow('x').nodes.map((n) => (n.id === 'check' ? { ...n, label: `Connect to ${secret}` } : n)) });
    const r = await draw([{ id: 'x', ir: old }], [{ id: 'x', ir: flow('Secret') }]);
    expect(r.ok).toBe(false);
    expect(r.output).toBeUndefined();
    expect(r.errors[0]).toMatchObject({ diagram: 'x', message: expect.stringMatching(/refusing to draw the old version/) });
    expect(JSON.stringify(r)).not.toContain(secret);
    const allowed = await draw([{ id: 'x', ir: old }], [{ id: 'x', ir: flow('Secret') }], { allowSensitive: true });
    expect(allowed.ok).toBe(true);
  });

  it('refuses a credential of a removed element, which the merged model holds', async () => {
    const secret = ['postgres://app:', 'Sup3r', 'S3cret', '@db.internal/shop'].join('');
    const old = flow('Secret', { nodes: [...flow('x').nodes, { id: 'conn', label: secret }], edges: [...flow('x').edges, { id: 'e3', from: 'check', to: 'conn' }] });
    const r = await draw([{ id: 'x', ir: old }], [{ id: 'x', ir: flow('Secret') }]);
    expect(r.ok).toBe(false);
    expect(r.output).toBeUndefined();
  });

  it('is deterministic', async () => {
    const a = await draw(before, after);
    const b = await draw(before, after);
    expect(a.output).toBe(b.output);
  });

  it('leaves the blocks around an inserted message as they are, and colours the message', async () => {
    const before = {
      schemaVersion: 1, kind: 'sequence', title: 'Login',
      participants: [{ id: 'web', label: 'Web' }, { id: 'auth', label: 'Auth' }, { id: 'log', label: 'AuditLog' }],
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
    const after = structuredClone(before);
    after.messages.splice(3, 0, { id: 'audit', from: 'auth', to: 'log', label: 'record the login' });
    for (const b of after.blocks) b.messages.push('audit');
    const r = await draw([{ id: 'login', ir: before }], [{ id: 'login', ir: after }]);
    expect(r.errors).toEqual([]);
    expect(r.pages).toEqual([{ diagram: 'login', page: 'login', state: 'changed', added: 1, changed: 0, removed: 0 }]);
    const style = styles(r.output);
    expect(style.get('login:audit')).toMatch(STATE_COLOURS.added);
    for (const frame of ['outer', 'middle', 'inner']) {
      expect(style.get(`login:${frame}`), frame).not.toMatch(ANY_STATE_COLOUR);
      expect(style.get(`login:${frame}:tab`), frame).not.toMatch(ANY_STATE_COLOUR);
    }
    expect(r.output).not.toContain('messages changed');
    expect(r.output).not.toContain('branches changed');
  });

  it('colours the member a container gained or lost, and leaves the frame of the container as it was', async () => {
    const before = flow('Groups', { groups: [{ id: 'g', label: 'Checks', children: ['check'] }] });
    const after = flow('Groups', { nodes: [...before.nodes, { id: 'audit', label: 'Write the audit entry' }], edges: [...before.edges, { id: 'e3', from: 'check', to: 'audit' }], groups: [{ id: 'g', label: 'Checks', children: ['check', 'audit'] }] });
    const gained = await draw([{ id: 'f', ir: before }], [{ id: 'f', ir: after }]);
    expect(gained.pages).toEqual([{ diagram: 'f', page: 'f', state: 'changed', added: 2, changed: 0, removed: 0 }]);
    const style = styles(gained.output);
    expect(style.get('f:audit')).toMatch(STATE_COLOURS.added);
    expect(style.get('f:g')).not.toMatch(ANY_STATE_COLOUR);
    expect(gained.output).not.toContain('children was');
    const lost = await draw([{ id: 'f', ir: after }], [{ id: 'f', ir: before }]);
    expect(lost.pages).toEqual([{ diagram: 'f', page: 'f', state: 'changed', added: 0, changed: 0, removed: 2 }]);
    expect(styles(lost.output).get('f:audit')).toMatch(STATE_COLOURS.removed);
    expect(styles(lost.output).get('f:g')).not.toMatch(ANY_STATE_COLOUR);
  });

  it('writes what a list was, by name, in the legend of a container that changed', async () => {
    const before = flow('Groups', { groups: [{ id: 'g', label: 'Checks', children: ['check'] }] });
    const after = flow('Groups', { groups: [{ id: 'g', label: 'Checks', children: ['check', 'done'] }] });
    const r = await draw([{ id: 'f', ir: before }], [{ id: 'f', ir: after }]);
    expect(r.output).toContain(inLabel('"Checks": children was "Check the request"'));
  });

  it('draws no page for a diagram whose meta fields alone differ, and nothing at all when that is every difference', async () => {
    const noted = (ir, note) => ({ ...ir, meta: { source: 'scout', sources: ['src/a.js', note], notes: [note] } });
    const a = flow('Login');
    const b = flow('Login (business)');
    const both = await draw(
      [{ id: 'login', ir: noted(a, 'src/b.js') }, { id: 'login-business', ir: noted(b, 'src/b.js') }],
      [{ id: 'login', ir: { ...noted(a, 'src/c.js'), nodes: [...a.nodes, { id: 'audit', label: 'Write the audit log' }], edges: [...a.edges, { id: 'e9', from: 'check', to: 'audit' }] } }, { id: 'login-business', ir: noted(b, 'src/c.js') }],
    );
    expect(both.pages.map((p) => p.diagram)).toEqual(['login']);
    expect(both.unchanged).toEqual(['login-business']);
    expect(pagesOf(both.output).map((p) => p.id)).toEqual(['login']);

    const metaOnly = await draw([{ id: 'login', ir: noted(a, 'src/b.js') }], [{ id: 'login', ir: noted(a, 'src/c.js') }]);
    expect(metaOnly).toMatchObject({ ok: true, differs: false, metaOnly: true, unchanged: ['login'] });
    expect(metaOnly.output).toBeUndefined();
    // A new title is on the page, so it still makes one.
    const titled = await draw([{ id: 'login', ir: a }], [{ id: 'login', ir: { ...a, title: 'Sign in' } }]);
    expect(titled.pages).toHaveLength(1);
  });

  it('does not take the plain output of a run for the picture of a diff', async () => {
    expect(isVisualDiff((await emit(flow('Plain'), 'drawio', { diagramId: 'plain' })).output)).toBe(false);
  });
});
