import { describe, it, expect } from 'vitest';
import { emit, bundle, EMIT_TARGETS, TARGETS } from '../src/pipeline.mjs';
import { emitDoc, escapeCell, docLangOf, DOC_KINDS, DOC_LANGS } from '../src/emit-doc.mjs';
import { DOC_STRINGS } from '../src/doc-strings.mjs';
import { schema } from '../src/validate-ir.mjs';
import { matrix } from '../src/check-feature-matrix.mjs';
import { loadFixture, validFixtures } from './helpers.mjs';

/** The fields of an IR that hold a text the reader is shown, whatever the kind. */
const TEXT_KEYS = new Set(['title', 'label', 'name', 'type', 'event', 'guard', 'action', 'comment', 'stereotype', 'params', 'returns', 'fromAttribute', 'toAttribute']);
/** Free text in a class diagram, one of four words in an ER diagram. */
const isText = (ir, key) => TEXT_KEYS.has(key) || (ir.kind === 'class' && (key === 'fromCardinality' || key === 'toCardinality'));

/** Every text of an IR with its JSON pointer; `meta.notes` is shown by no output. */
function textsOf(ir) {
  const out = [];
  const walk = (value, path, key) => {
    if (typeof value === 'string') { if (isText(ir, key) && value.trim() !== '') out.push({ path, text: value }); return; }
    if (Array.isArray(value)) { value.forEach((v, i) => walk(v, `${path}/${i}`, key)); return; }
    if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) if (k !== 'meta') walk(v, `${path}/${k}`, k);
  };
  walk(ir, '', undefined);
  (ir.meta?.omitted ?? []).forEach((text, i) => out.push({ path: `/meta/omitted/${i}`, text }));
  return out;
}

/** A copy of the IR in which every text is a word of its own, so a count of words is a count of elements. */
function tokenized(ir) {
  const copy = structuredClone(ir);
  const tokens = [];
  const walk = (value, key, owner, at) => {
    if (typeof value === 'string') { if (isText(ir, key) && value.trim() !== '') { owner[at] = `tok${tokens.length}x`; tokens.push(owner[at]); } return; }
    if (Array.isArray(value)) { value.forEach((v, i) => walk(v, key, value, i)); return; }
    if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) if (k !== 'meta') walk(v, k, value, k);
  };
  walk(copy, undefined, undefined, undefined);
  return { ir: copy, tokens };
}

/** What a Markdown renderer shows for the text the emitter wrote: escapes and entities undone. */
const shown = (markdown) => markdown.replace(/<br>/g, ' ').replace(/\\([\\|`*_[\]~$#])/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const oneLine = (text) => text.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();

/** The pipes of a table line that end a cell: the ones no backslash escapes. */
const cellsOf = (line) => line.replace(/\\\\/g, '').split(/(?<!\\)\|/).slice(1, -1).map((c) => c.trim());
/** The tables of a document as { heading, header, rows } in document order. */
function tablesOf(markdown) {
  const tables = [];
  let heading = '';
  let current;
  for (const line of markdown.split('\n')) {
    if (/^#+ /.test(line)) { heading = line.replace(/^#+ /, ''); current = undefined; continue; }
    if (!line.startsWith('|')) { current = undefined; continue; }
    if (!current) { current = { heading, header: cellsOf(line), rows: [], separator: false }; tables.push(current); continue; }
    if (!current.separator) { current.separator = true; expect(line).toMatch(/^\|( --- \|)+$/); continue; }
    current.rows.push(cellsOf(line));
  }
  return tables;
}
const rowsUnder = (markdown, heading) => tablesOf(markdown).filter((t) => t.heading === heading).flatMap((t) => t.rows);
const count = (text, part) => text.split(part).length - 1;

describe('description tables: what they hold', () => {
  it('have a function for every kind of the schema and a name for it in every language', () => {
    expect(DOC_KINDS.slice().sort()).toEqual(schema.properties.kind.enum.slice().sort());
    for (const lang of DOC_LANGS) expect(Object.keys(DOC_STRINGS[lang].diagram).sort(), lang).toEqual(DOC_KINDS.slice().sort());
  });

  it('stand beside the feature matrix: a target of emit, not a column that could only say "supported"', () => {
    expect(EMIT_TARGETS).toEqual([...TARGETS, 'doc']);
    expect(matrix.targets).not.toContain('doc');
  });

  for (const { kind, name, ir } of validFixtures()) {
    it(`matches the snapshot for ${kind}/${name}`, async () => {
      // The adversarial fixture holds a connection string on purpose; the override stands for the user's word.
      const r = await emit(ir, 'doc', { allowSensitive: true });
      expect(r.errors).toEqual([]);
      expect(r.output.endsWith('\n')).toBe(true);
      expect(r.output).not.toMatch(/\r|\n\n\n/);
      // Nothing is degraded or refused, so the matrix has nothing to say.
      expect(r.warnings.filter((w) => w.stage === 'feature-matrix' || w.stage === 'emit')).toEqual([]);
      await expect(r.output).toMatchFileSnapshot(`snapshots/doc/${kind}-${name}.md`);
    });

    it(`shows every text of ${kind}/${name} as a reader would see it, in every language`, () => {
      for (const lang of DOC_LANGS) {
        const text = oneLine(shown(emitDoc(ir, { lang }).output));
        for (const { path, text: wanted } of textsOf(ir)) expect(text, `${lang} ${path}`).toContain(oneLine(wanted));
      }
    });

    it(`gives every element of ${kind}/${name} a row, a column or a heading of its own`, () => {
      const { ir: copy, tokens } = tokenized(ir);
      const doc = emitDoc(copy).output;
      // Each text once where it is defined; a name is repeated where another element points at it.
      for (const token of tokens) expect(count(doc, token), token).toBeGreaterThanOrEqual(1);
      const h = DOC_STRINGS.en.heading;
      const rows = (heading) => rowsUnder(doc, heading).length;
      const arrows = (heading) => count(rowsUnder(doc, heading).flat().join(' '), '→');
      const n = (collection) => (copy[collection] ?? []).length;
      switch (copy.kind) {
        case 'sequence':
          expect([rows(h.participants), rows(h.steps), rows(h.notes)]).toEqual([n('participants'), n('messages'), n('notes')]);
          for (const b of copy.blocks ?? []) for (const section of [b, ...(b.branches ?? [])]) expect(rowsUnder(doc, h.steps).filter((r) => r.join(' ').includes(section.label)).length, b.id).toBe(section.messages.length);
          break;
        case 'state':
          expect([rows(h.states), arrows(h.transitions)]).toEqual([n('states'), n('transitions')]);
          break;
        case 'er':
          for (const e of copy.entities) expect(rows(e.label), e.id).toBe((e.attributes ?? []).length);
          expect(rows(h.relations)).toBe(n('relations'));
          break;
        case 'class':
          for (const c of copy.classes) expect(rows(c.label), c.id).toBe((c.attributes ?? []).length + (c.methods ?? []).length);
          expect(rows(h.relations)).toBe(n('relations'));
          break;
        case 'architecture':
          expect([rows(h.components) + rows(h.stores) + rows(h.queues), rows(h.boundaries), rows(h.connections)]).toEqual([n('components'), n('boundaries'), n('connections')]);
          break;
        case 'activity':
          expect([rows(h.lanes), rows(h.steps), arrows(h.steps)]).toEqual([n('lanes'), n('actions') + n('controls'), n('flows')]);
          break;
        case 'flowchart':
          expect([rows(h.steps), arrows(h.steps), rows(h.groups)]).toEqual([n('nodes'), n('edges'), n('groups')]);
          break;
        case 'usecase':
          expect([rows(h.actors), rows(h.useCases), rows(h.boundaries), rows(h.relations)]).toEqual([n('actors'), n('useCases'), n('boundaries'), n('relations')]);
          break;
        default:
          throw new Error(`no row count for kind ${copy.kind}`);
      }
    });
  }

  it('is deterministic', () => {
    const ir = loadFixture('activity', 'valid-fork-join');
    expect(emitDoc(ir).output).toBe(emitDoc(structuredClone(ir)).output);
  });

  it('names the fixed values of each kind: message kinds, block conditions, keys, cardinalities, directions', () => {
    const seq = rowsUnder(emitDoc(loadFixture('sequence', 'valid')).output, 'Steps');
    expect(seq[0]).toEqual(['1', 'User', 'Web app', 'Submit credentials', 'Synchronous', 'loop: until 3 attempts']);
    // A message inside two blocks names both, the outer one first; an else section is named as one.
    expect(seq[5][5]).toBe('loop: until 3 attempts<br>alt: password matches');
    expect(seq[7][5]).toBe('loop: until 3 attempts<br>alt else: password wrong');
    expect(seq[9]).toEqual(['10', 'Web app', 'Auth service', 'Audit login attempt', 'Asynchronous', '—']);
    expect(rowsUnder(emitDoc(loadFixture('sequence', 'valid')).output, 'Notes')).toEqual([
      ['1', 'Rate limited per IP', 'Web app', 'Right', '1. Submit credentials'],
      ['2', 'Hash: argon2id', 'Auth service, User DB', 'Over', '5. Verify password hash'],
    ]);
    const er = emitDoc(loadFixture('er', 'valid-fk-anchors')).output;
    expect(rowsUnder(er, 'Order')[1]).toEqual(['2', 'customer\\_id', 'uuid', 'FK']);
    expect(rowsUnder(er, 'Relations')[2]).toEqual(['3', 'Address', '0..1', 'Order', '0..*', 'ships to', 'No']);
    const arch = emitDoc(loadFixture('architecture', 'valid-aws-zones')).output;
    expect(rowsUnder(arch, 'Data stores')[0]).toEqual(['1', 'RDS primary', 'Database', 'Production account › VPC › Database security group', '`aws:rds`']);
    expect(rowsUnder(arch, 'Connections')[6]).toEqual(['7', 'RDS primary', 'RDS standby (Multi-AZ)', 'replication', 'Both ways']);
    expect(rowsUnder(arch, 'Boundaries')[2]).toEqual(['3', 'Auto Scaling group', '`aws:auto_scaling_group`', 'Production account › VPC']);
  });

  it('writes a state by event table, with the guard and the action of each transition in its cell', () => {
    const doc = emitDoc(loadFixture('state', 'valid')).output;
    const [t] = tablesOf(doc).filter((x) => x.heading === 'Transitions');
    expect(t.header).toEqual(['State / Event', 'submit', 'payment captured', 'all items picked', 'label printed', 'carrier pickup', 'cancel', '(no event)']);
    expect(t.rows.find((r) => r[0] === 'Placed')).toEqual(['Placed', '—', '→ Processing / reserve stock', '—', '—', '—', '→ Cancelled [not yet processing]', '—']);
    // The start and the end of a composite are told from those of the diagram.
    expect(t.rows.map((r) => r[0])).toEqual(expect.arrayContaining(['(Initial)', 'Processing › (Initial)', 'Processing › (Final)', '(Final)']));
    expect(t.rows.find((r) => r[0] === 'Packing')[4]).toBe('→ Processing › (Final)');
  });

  it('lists the steps of an activity in the order they are read, with the lane of each hand-off', () => {
    const steps = rowsUnder(emitDoc(loadFixture('activity', 'valid-fork-join')).output, 'Steps');
    const at = (name) => steps.findIndex((r) => r[2] === name);
    expect(steps[0].slice(1, 4)).toEqual(['Sales', '(Start)', 'Start']);
    expect(steps.at(-1).slice(2)).toEqual(['(End)', 'End', '—']);
    // A join stands after every branch that reaches it, a step after the step that leads to it.
    for (const before of ['Pack parcel', 'Payment ok?']) expect(at(before)).toBeLessThan(at('(Join)'));
    expect(at('Pick items')).toBe(at('Pack parcel') - 1);
    expect(steps[at('(Fork)')][4]).toBe('→ Pick items (hand-off to Warehouse)<br>→ Issue invoice (hand-off to Finance)');
    expect(steps[at('Payment ok?')][4]).toBe('[yes] → (Join) (hand-off to Warehouse)<br>[no] → Put order on hold (hand-off to Sales)');
    expect(steps[at('Pick items')][4]).toBe('→ Pack parcel');
  });

  it('writes the outcomes of a flowchart decision beside it, a condition in brackets', () => {
    const steps = rowsUnder(emitDoc(loadFixture('flowchart', 'valid-refund-approval')).output, 'Steps');
    expect(steps.find((r) => r[1] === 'Order found?')).toEqual(['3', 'Order found?', 'Decision', '—', '[no] → Ask the customer to correct the order number<br>[yes] → Amount over 500 EUR?']);
    expect(steps.find((r) => r[1] === 'Pay back to the original card')[3]).toBe('Payout');
    expect(rowsUnder(emitDoc(loadFixture('flowchart', 'valid-refund-approval')).output, 'Groups')).toEqual([['1', 'Finance', '—'], ['2', 'Payout', 'Finance'], ['3', 'Approval', '—']]);
  });

  it('lists what the diagram leaves out on purpose', () => {
    const ir = { ...loadFixture('flowchart', 'valid'), meta: { omitted: ['No retry branch: the reader | only needs the outcome', '# not a heading'] } };
    expect(emitDoc(ir).output).toContain('Not shown on purpose:\n\n- No retry branch: the reader \\| only needs the outcome\n- \\# not a heading\n');
    expect(emitDoc(ir, { lang: 'ja' }).output).toContain('意図的に省略した内容:\n\n- No retry branch');
  });
});

describe('description tables: escaping', () => {
  it('lets no character of a label act as Markdown or HTML', () => {
    expect(escapeCell('a | b')).toBe('a \\| b');
    expect(escapeCell('line one\nline two\r\nline three')).toBe('line one<br>line two<br>line three');
    expect(escapeCell('<script>alert(1)</script> & co')).toBe('&lt;script&gt;alert(1)&lt;/script&gt; &amp; co');
    expect(escapeCell('*bold* _it_ `code` [x](y) ~~s~~ $m$ # h')).toBe('\\*bold\\* \\_it\\_ \\`code\\` \\[x\\](y) \\~\\~s\\~\\~ \\$m\\$ \\# h');
    expect(escapeCell('C:\\temp\\|')).toBe('C:\\\\temp\\\\\\|');
    expect(escapeCell('&lt;b&gt;')).toBe('&amp;lt;b&amp;gt;');
    expect(escapeCell('  tab\there\u0000 ')).toBe('tab here');
  });

  it('keeps every table rectangular and free of markup, for every fixture and language', () => {
    for (const { kind, name, ir } of validFixtures()) {
      for (const lang of DOC_LANGS) {
        const doc = emitDoc(ir, { lang }).output;
        for (const t of tablesOf(doc)) for (const row of t.rows) expect(row.length, `${kind}/${name} ${lang} ${t.heading}`).toBe(t.header.length);
        // The only tags are the line break of a cell; the first line is the document's own comment.
        expect(doc.split('\n').slice(1).join('\n').replace(/<br>/g, ''), `${kind}/${name}`).not.toMatch(/[<>]/);
      }
    }
  });

  it('writes the adversarial labels as text', async () => {
    const r = await emit(loadFixture('adversarial', 'labels'), 'doc', { allowSensitive: true });
    expect(r.output).toContain('| 2 | line one<br>line two | Process |');
    expect(r.output).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(r.output).toContain('a \\| b \\| c \\#1 &amp; co');
    expect(r.output).toContain('注文を確定する \\[確認済み\\] {JSON}');
    expect(r.output.split('\n')[1]).toBe('# Adversarial "labels" %%{init: {"theme":"forest"}}%%');
  });
});

describe('description tables: languages', () => {
  const keysOf = (value, prefix = '') => (value && typeof value === 'object' ? Object.entries(value).flatMap(([k, v]) => keysOf(v, `${prefix}/${k}`)) : [prefix]);

  it('have the same words in English, Japanese and Vietnamese', () => {
    expect(DOC_LANGS).toEqual(['en', 'ja', 'vi']);
    for (const lang of DOC_LANGS) {
      expect(keysOf(DOC_STRINGS[lang]).sort(), lang).toEqual(keysOf(DOC_STRINGS.en).sort());
      for (const key of keysOf(DOC_STRINGS[lang])) expect(key.split('/').slice(1).reduce((o, k) => o[k], DOC_STRINGS[lang]), `${lang}${key}`).toMatch(/\S/);
    }
  });

  it('translate headings, column headers and fixed values, never a label', () => {
    const ir = loadFixture('sequence', 'valid');
    const ja = emitDoc(ir, { lang: 'ja' }).output;
    const vi = emitDoc(ir, { lang: 'vi' }).output;
    expect(ja).toContain('図の種類: シーケンス図');
    expect(tablesOf(ja)[1].header).toEqual(['No.', '元', '先', 'メッセージ', '種別', '条件']);
    expect(tablesOf(ja)[1].rows[0]).toEqual(['1', 'User', 'Web app', 'Submit credentials', '同期', 'loop: until 3 attempts']);
    expect(vi).toContain('Loại sơ đồ: Sơ đồ trình tự');
    expect(tablesOf(vi)[1].header).toEqual(['STT', 'Từ', 'Đến', 'Thông điệp', 'Loại', 'Điều kiện']);
    expect(tablesOf(vi)[1].rows[9]).toEqual(['10', 'Web app', 'Auth service', 'Audit login attempt', 'Bất đồng bộ', '—']);
    // The same tables in every language: only words differ.
    for (const { ir: each } of validFixtures()) {
      const shape = (lang) => tablesOf(emitDoc(each, { lang }).output).map((t) => [t.header.length, t.rows.length]);
      expect(shape('ja')).toEqual(shape('en'));
      expect(shape('vi')).toEqual(shape('en'));
    }
  });

  it('records the language in the first line, and refuses one it does not have', () => {
    for (const lang of DOC_LANGS) expect(docLangOf(emitDoc(loadFixture('er', 'valid'), { lang }).output)).toBe(lang);
    expect(docLangOf('# A document of the user')).toBeUndefined();
    const r = emitDoc(loadFixture('er', 'valid'), { lang: 'fr' });
    expect(r.output).toBeUndefined();
    expect(r.errors[0]).toMatchObject({ message: 'no description tables in language "fr"', hint: '--lang takes one of: en, ja, vi' });
  });

  it('refuses a kind it has no tables for instead of writing an empty document', () => {
    const r = emitDoc({ schemaVersion: 1, kind: 'gantt', title: 'Plan' });
    expect(r.output).toBeUndefined();
    expect(r.errors[0].message).toBe('kind "gantt" has no description tables');
  });
});

/** The element that carries `ref` in a fixture of each kind, and the table its link stands in. */
const CARRIERS = [
  { kind: 'sequence', fixture: 'valid-ref-parts', heading: 'Steps', label: 'loadOrders(request)' },
  { kind: 'state', fixture: 'valid-ref-parts', heading: 'States', label: 'Paying' },
  { kind: 'architecture', fixture: 'valid-ref-parts', heading: 'Components', label: 'Order API' },
  { kind: 'class', fixture: 'valid-ref-parts', label: 'Order' },
  { kind: 'er', fixture: 'valid-ref-parts', label: 'CUSTOMER' },
  { kind: 'usecase', fixture: 'valid-ref-parts', heading: 'Use cases', label: 'Sync the orders' },
];
const PART = 'order-sync-01-load';
const part = () => ({ id: PART, ir: { ...loadFixture('flowchart', 'valid-refund-check'), title: 'Load the orders of one shop' } });

describe('description tables: a run in one document', () => {
  for (const c of CARRIERS) {
    it(`links the ${c.kind} element that has a part to the heading of that part`, async () => {
      const main = { id: 'main', ir: loadFixture(c.kind, c.fixture) };
      const r = await bundle([main, part()], 'doc', { title: 'Order sync' });
      expect(r.ok).toBe(true);
      const link = `[Load the orders of one shop](#${PART})`;
      expect(r.output).toContain(`<a id="${PART}"></a>\n\n## Load the orders of one shop\n`);
      if (c.heading) expect(rowsUnder(r.output, c.heading).find((row) => row.includes(c.label)).at(-1)).toBe(link);
      else expect(r.output).toContain(`### ${c.label}\n\nDetails: ${link}\n`);
      // Outside a bundle the slug stands there, as a code word and without a warning.
      const single = await emit(main.ir, 'doc');
      expect(single.output).toContain(`\`${PART}\``);
      expect(single.output).not.toContain('](#');
      expect(single.warnings.filter((w) => w.stage === 'emit')).toEqual([]);
    });
  }

  it('links a flowchart step and an activity action too, and reports a part the bundle does not hold', async () => {
    // Both fixtures name a part; the bundle holds the one of the flowchart only.
    const flow = { id: 'main', ir: loadFixture('flowchart', 'valid') };
    const act = { id: 'returns', ir: loadFixture('activity', 'valid-two-lanes') };
    expect([flow.ir.nodes[4].ref, act.ir.actions[2].ref]).toEqual(['order-checkout-payment', 'return-request-label']);
    const r = await bundle([flow, act, { ...part(), id: 'order-checkout-payment' }], 'doc');
    expect(rowsUnder(r.output, 'Steps').filter((row) => row.at(-1) === '[Load the orders of one shop](#order-checkout-payment)').map((row) => row[1])).toEqual([flow.ir.nodes[4].label]);
    expect(rowsUnder(r.output, 'Steps').filter((row) => row.at(-1) === '`return-request-label`').map((row) => row[2])).toEqual([act.ir.actions[2].label]);
    expect(r.warnings.filter((w) => w.stage === 'emit')).toEqual([expect.objectContaining({ diagram: 'returns', path: '/actions/2/ref', message: 'ref "return-request-label" is not in this bundle: the table shows the slug without a link' })]);
  });

  it('writes one section per diagram under one title, each with its anchor, its kind and its IR file', async () => {
    const entries = [{ id: 'checkout', ir: loadFixture('flowchart', 'valid') }, { id: 'Checkout-01 Pay', ir: loadFixture('sequence', 'valid') }];
    const r = await bundle(entries, 'doc', { title: 'Check | out', lang: 'ja' });
    const lines = r.output.split('\n');
    expect(lines.slice(0, 3)).toEqual(['<!-- zukai doc, lang=ja: generated from the IR, regenerate instead of editing -->', '# Check \\| out', '']);
    expect(lines.filter((l) => l.startsWith('<a id='))).toEqual(['<a id="checkout"></a>', '<a id="checkout-01-pay"></a>']);
    expect(lines.filter((l) => /^## /.test(l))).toEqual(['## Order checkout', '## Login with password']);
    expect(r.output).toContain('図の種類: シーケンス図 · ソース: `source/Checkout-01 Pay.ir.json`');
    // Sections of a diagram stand one level below its title.
    expect(lines.filter((l) => /^### /.test(l))).toEqual(['### ステップ', '### グループ', '### 参加者', '### ステップ', '### ノート']);
    expect(r.output).not.toMatch(/\n\n\n/);
    expect((await bundle(entries, 'doc')).output.split('\n')[1]).toBe('# Diagram descriptions');
    expect((await bundle(entries, 'doc', { lang: 'vi' })).output.split('\n')[1]).toBe('# Mô tả sơ đồ');
  });

  it('refuses two diagrams that would share an anchor, and a canvas', async () => {
    const clash = await bundle([{ id: 'Pay_Now', ir: loadFixture('flowchart', 'valid') }, { id: 'pay-now', ir: loadFixture('flowchart', 'valid') }], 'doc');
    expect(clash.ok).toBe(false);
    expect(clash.errors[0].message).toBe('diagrams "Pay_Now" and "pay-now" would share the anchor "pay-now"');
    const canvas = await bundle([{ id: 'a', ir: loadFixture('flowchart', 'valid') }], 'doc', { canvas: 'all' });
    expect(canvas.errors[0].message).toBe('canvas applies to drawio only');
  });
});

describe('description tables: the checks before them', () => {
  it('validates first and returns the errors of an invalid document', async () => {
    const r = await emit(loadFixture('flowchart', 'invalid-missing-edge-target'), 'doc');
    expect(r.ok).toBe(false);
    expect(r.output).toBeUndefined();
    expect(r.errors).toHaveLength(2);
  });

  it('repeats the model warnings and asks the feature matrix nothing', async () => {
    // A class diagram is refused for FigJam by the matrix; its tables are written like any other.
    expect((await emit(loadFixture('class', 'valid'), 'figjam')).ok).toBe(false);
    expect((await emit(loadFixture('class', 'valid'), 'doc')).ok).toBe(true);
    const ir = loadFixture('flowchart', 'valid');
    ir.nodes.push({ id: 'alone', label: 'Left alone' });
    const r = await emit(ir, 'doc');
    expect(r.ok).toBe(true);
    expect(r.warnings.map((w) => w.stage)).toEqual(['model']);
    expect(r.output).toContain('Left alone');
  });

  it('scans for secrets as for a local file: a credential is refused, a guess is a warning', async () => {
    const leak = await emit(loadFixture('adversarial', 'labels'), 'doc');
    expect(leak.ok).toBe(false);
    expect(leak.output).toBeUndefined();
    expect(leak.errors.every((e) => e.message.startsWith('refusing to emit for doc:'))).toBe(true);
    const guess = loadFixture('flowchart', 'valid');
    guess.nodes[1].label = 'Mail the receipt to jane.roe@corp-mail.io';
    const r = await emit(guess, 'doc');
    expect(r.ok).toBe(true);
    expect(r.warnings.filter((w) => w.stage === 'secret-scan').map((w) => w.kind)).toEqual(['personal-data']);
    const all = await bundle([{ id: 'a', ir: loadFixture('flowchart', 'valid') }, { id: 'b', ir: loadFixture('adversarial', 'labels') }], 'doc');
    expect(all.ok).toBe(false);
    expect(all.errors.every((e) => e.diagram === 'b')).toBe(true);
  });
});

describe('description tables: stores, queues and storage of an architecture diagram', () => {
  const ir = {
    schemaVersion: 1, kind: 'architecture', title: 'Invoicing',
    components: [
      { id: 'api', label: 'invoice-api', icon: 'gcp:cloud_run' },
      { id: 'topic', label: 'Pub/Sub invoice-events', kind: 'queue', icon: 'gcp:cloud_pubsub' },
      { id: 'audit', label: 'SQS invoice-audit', kind: 'queue', icon: 'aws:sqs' },
      { id: 'pg', label: 'Cloud SQL invoices-pg', kind: 'database', icon: 'gcp:cloud_sql' },
      { id: 'pdfs', label: 'Cloud Storage invoice-pdfs', kind: 'database', icon: 'gcp:cloud_storage' },
      { id: 'archive', label: 'S3 archive', kind: 'database', icon: 'aws:s3' },
      { id: 'cache', label: 'Sessions', kind: 'cache' },
      { id: 'files', label: 'File share', kind: 'database' },
    ],
    connections: [{ id: 'c1', from: 'api', to: 'topic', label: 'publish' }],
  };

  it('lists a queue under a heading of its own, never among the data stores', () => {
    const doc = emitDoc(ir).output;
    expect(rowsUnder(doc, 'Queues').map((r) => [r[1], r[2]])).toEqual([['Pub/Sub invoice-events', 'Queue'], ['SQS invoice-audit', 'Queue']]);
    expect(rowsUnder(doc, 'Data stores').map((r) => r[1])).toEqual(['Cloud SQL invoices-pg', 'Cloud Storage invoice-pdfs', 'S3 archive', 'Sessions', 'File share']);
    expect(rowsUnder(doc, 'Components').map((r) => r[1])).toEqual(['invoice-api']);
    // Every component is in exactly one of the three tables.
    expect(rowsUnder(doc, 'Components').length + rowsUnder(doc, 'Data stores').length + rowsUnder(doc, 'Queues').length).toBe(ir.components.length);
  });

  it('calls a bucket storage, by its icon, and a database a database', () => {
    const kinds = Object.fromEntries(rowsUnder(emitDoc(ir).output, 'Data stores').map((r) => [r[1], r[2]]));
    expect(kinds).toEqual({ 'Cloud SQL invoices-pg': 'Database', 'Cloud Storage invoice-pdfs': 'Storage', 'S3 archive': 'Storage', Sessions: 'Cache', 'File share': 'Database' });
  });

  it('has the heading and the word in every language', () => {
    expect(rowsUnder(emitDoc(ir, { lang: 'ja' }).output, 'キュー')).toHaveLength(2);
    expect(rowsUnder(emitDoc(ir, { lang: 'vi' }).output, 'Hàng đợi')).toHaveLength(2);
    expect(rowsUnder(emitDoc(ir, { lang: 'ja' }).output, 'データストア')[1][2]).toBe('ストレージ');
    expect(rowsUnder(emitDoc(ir, { lang: 'vi' }).output, 'Kho dữ liệu')[1][2]).toBe('Lưu trữ');
  });

  it('writes no queue heading for a diagram without one', () => {
    const doc = emitDoc({ ...ir, components: ir.components.filter((c) => c.kind !== 'queue'), connections: [] }).output;
    expect(doc).not.toContain('## Queues');
  });
});
