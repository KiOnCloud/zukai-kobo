import { describe, it, expect, beforeAll } from 'vitest';
import { extractMermaid } from '../src/extract-mermaid.mjs';
import { emit } from '../src/pipeline.mjs';
import { encodeLabel, encodeInline, encodeMember, architectureLabel, identifierToken } from '../src/mermaid-text.mjs';
import { validFixtures, loadMermaid } from './helpers.mjs';

// ---------------------------------------------------------------------------------------------
// Completeness check used by the round trip

/** IR fields that hold text a reader sees. `title` is checked on its own (only some forms print it). */
const TEXT_KEYS = new Set(['label', 'name', 'event', 'guard', 'action', 'type', 'comment', 'stereotype', 'params', 'returns', 'fromCardinality', 'toCardinality']);

/** Every non-empty text-field string of an IR, outside `meta` (never emitted). */
function irStrings(ir) {
  const out = [];
  const walk = (v, key) => {
    if (typeof v === 'string') {
      if (TEXT_KEYS.has(key) && v.trim()) out.push(v);
    } else if (Array.isArray(v)) v.forEach((x) => walk(x, key));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (k !== 'meta') walk(x, k);
  };
  walk(ir, '');
  return out;
}

const ENTITY_TEXT = { '#35;': '#', '#59;': ';', '#quot;': '"', '#lt;': '<', '#gt;': '>', '#amp;': '&', '#37;': '%', '#123;': '{', '#125;': '}', '#91;': '[', '#93;': ']', '#124;': '|', '#96;': '`', '#92;': '\\' };
/** What a reader sees of an emitted form: Zukai's entity codes decoded, <br/> as a break. */
const visible = (form) => form.replace(/#(?:\d+|quot|lt|gt|amp);/g, (m) => ENTITY_TEXT[m] ?? m).replace(/<br\/>/g, ' ');
const norm = (s) => String(s).replace(/\s+/g, ' ').trim().toLowerCase();

/** Every text field of a page, where a visible text must land. */
function factTexts(page) {
  return [page.name, ...page.nodes.flatMap((n) => [n.label, ...(n.texts ?? []), n.detail ?? '']), ...page.edges.map((e) => e.label)].map(norm);
}

/**
 * IR strings the emitter printed (in any of the forms Zukai writes text in) that the facts do
 * not hold. A string whose every form is absent from the text was not printed (a FigJam-only
 * field, an attribute name the emitter had to rewrite) and is not asked for.
 */
function missingTexts(ir, output, page) {
  const text = output
    .split('\n')
    .filter((l) => !l.trim().startsWith('%%'))
    .join('\n');
  const haystack = factTexts(page);
  const found = (candidates) => candidates.some((c) => norm(c) !== '' && haystack.some((h) => h.includes(norm(c))));
  const missing = [];
  let checked = 0;
  for (const s of irStrings(ir)) {
    const forms = [encodeLabel(s), encodeInline(s), encodeMember(s), architectureLabel(s).label, identifierToken(s).token, identifierToken(s, '()\\[\\],~').token, identifierToken(s, '-').token];
    const printed = forms.filter((f) => text.includes(f));
    if (printed.length === 0) continue;
    checked++;
    if (!found([s, ...printed.map(visible)])) missing.push(s);
  }
  const title = JSON.stringify(String(ir.title).replace(/\r\n?|\n/g, ' ').replace(/%%\{/g, '%% {')).slice(1, -1);
  if (output.startsWith('---\n') && output.includes(`title: "${title}"`)) {
    checked++;
    if (norm(page.name) !== norm(ir.title.replace(/%%\{/g, '%% {'))) missing.push(`title: ${ir.title}`);
  }
  return { missing, checked };
}

// ---------------------------------------------------------------------------------------------
// Round trip on Zukai's own output

describe('extractMermaid on every emitted fixture', () => {
  for (const { kind, name, ir } of validFixtures()) {
    it(`reads ${kind}/${name} back completely`, async () => {
      const r = await emit(ir, 'mermaid', { allowSensitive: true });
      expect(r.ok).toBe(true);
      const facts = extractMermaid(r.output);
      expect(facts.facts).toBe(1);
      expect(facts.format).toBe('mermaid');
      expect(facts.pages).toHaveLength(1);
      const page = facts.pages[0];
      expect(page.id).toBe('mermaid-1');
      expect(page.warnings).toEqual([]);

      // An architecture the grid planner cannot place is emitted as a flowchart on purpose.
      const expected = ir.kind === 'architecture' && /^flowchart /m.test(r.output) ? 'flowchart' : ir.kind;
      expect(page.kindHints).toHaveLength(1);
      expect(page.kindHints[0]).toMatchObject({ kind: expected, score: 100 });

      const { missing, checked } = missingTexts(ir, r.output, page);
      expect(checked).toBeGreaterThan(0);
      expect(missing).toEqual([]);

      const ids = new Set(page.nodes.map((n) => n.id));
      expect(ids.size).toBe(page.nodes.length);
      for (const e of page.edges) {
        expect(ids.has(e.from), `${e.id} from ${e.from}`).toBe(true);
        expect(ids.has(e.to), `${e.id} to ${e.to}`).toBe(true);
      }
      for (const n of page.nodes) if (n.parent !== undefined) expect(ids.has(n.parent), `${n.id} parent ${n.parent}`).toBe(true);
      expect(page.edges.map((e) => e.id)).toEqual(page.edges.map((_, i) => `e${i + 1}`));
    });
  }

  it('the completeness check catches a dropped label', async () => {
    const ir = validFixtures().find((f) => f.kind === 'flowchart' && f.name === 'valid').ir;
    const r = await emit(ir, 'mermaid', { allowSensitive: true });
    const page = extractMermaid(r.output).pages[0];
    expect(missingTexts(ir, r.output, page).missing).toEqual([]);
    // A text found nowhere else on the page, so taking it away must be reported.
    const unique = (text) => factTexts(page).filter((h) => h.includes(norm(text))).length === 1;
    const edge = page.edges.find((e) => e.label !== '' && unique(e.label));
    const node = page.nodes.find((n) => n.label !== '' && unique(n.label));
    const [edgeLabel, nodeLabel] = [edge.label, node.label];
    edge.label = '';
    node.label = '';
    const { missing } = missingTexts(ir, r.output, page);
    expect(missing).toContain(ir.edges.find((e) => e.label === edgeLabel).label);
    expect(missing).toContain(ir.nodes.find((n) => n.label === nodeLabel).label);
  });
});

// ---------------------------------------------------------------------------------------------
// Hand-written Mermaid

const FLOWCHART = `flowchart LR
  %% a comment is not text
  classDef hot fill:#f96
  start([Start]) --> check{Is it valid?}
  check -- yes --> save[(Orders DB)]
  check -->|no| fix[/Fix input/]
  subgraph worker [Background worker]
    direction TB
    job[[Run job]] -.-> done((Done))
    hex{{Prepare}} --- memo>Remember this]
  end
  fix ==> start
  A & B --> C
  C -- "with #quot;quotes#quot;" --> r(Rounded text)
  md["\`**Bold** text\`"] --> ent["A #amp; B<br/>second line"]
  click save href "https://example.com/db"
  style done fill:#0f0
`;

const SEQUENCE = `sequenceDiagram
  title Checkout
  actor U as Customer
  participant W as Web shop<br/>frontend
  participant P as Payment provider
  autonumber
  U->>W: Place order
  W->>+P: Authorize
  alt card ok
    P-->>-W: authorized
    Note over W,P: Token stored
  else card declined
    P--)W: declined
  end
  W-xU: Done
  W->U: plain
`;

const STATE = `stateDiagram-v2
  [*] --> Idle
  state "Waiting for payment" as Waiting
  Idle --> Waiting : checkout
  state Processing {
    [*] --> Picking
    Picking --> Packing : picked
    Packing --> [*]
  }
  Waiting --> Processing : paid [amount ok] / reserve
  state check <<choice>>
  Processing --> check
  check --> Done : ok
  check --> Failed : error
  Done : Order complete
  note right of Failed : Customer is notified
  Failed --> [*]
`;

const ER = `erDiagram
  CUSTOMER ||--o{ ORDER : places
  CUSTOMER {
    string id PK "unique id"
    string email "login and contact"
  }
  ORDER {
    int id PK
    string customer_id FK
  }
  ORDER ||--|{ LINE-ITEM : "contains"
  p[Person] {
    string name
  }
  p |o..o| CUSTOMER : "is"
`;

const CLASS = `classDiagram
  class Animal {
    <<abstract>>
    +String name
    +List~String~ tags
    +makeSound() void
  }
  class Dog
  Animal <|-- Dog
  class Repository~T~ {
    +findAll() List~T~
  }
  Repository "1" o-- "*" Animal : stores
  Dog : +bark() void
  <<interface>> Repository
  note for Dog "Good boy"
`;

const ARCHITECTURE = `architecture-beta
  group cloud(cloud)[Cloud]
  group net(server)[Private net] in cloud
  service api(server)[API] in net
  service db(database)[Orders DB] in net
  junction hub in cloud
  service web[Web]
  web:R --> L:api
  api:B -- T:db
  api:R <--> L:hub
`;

const MARKDOWN = `# Design notes

Intro text.

## Login flow

\`\`\`mermaid
flowchart TD
  a[Open page] --> b[Sign in]
\`\`\`

\`\`\`js
# not a heading, this is code
\`\`\`

## Order states

Some text.

\`\`\`mermaid
stateDiagram-v2
  [*] --> New
\`\`\`
`;

const byId = (page, id) => page.nodes.find((n) => n.id === id);
const only = (text) => {
  const { pages } = extractMermaid(text);
  expect(pages).toHaveLength(1);
  return pages[0];
};

describe('hand-written samples are valid Mermaid', () => {
  let mermaid;
  beforeAll(async () => {
    mermaid = await loadMermaid();
  }, 30_000);

  const blocks = (md) => [...md.matchAll(/```mermaid\n([\s\S]*?)```/g)].map((m) => m[1]);
  for (const [name, text] of Object.entries({ FLOWCHART, SEQUENCE, STATE, ER, CLASS, ARCHITECTURE })) {
    it(`parses ${name}`, async () => {
      await expect(mermaid.parse(text)).resolves.toBeTruthy();
    });
  }
  it('parses both blocks of MARKDOWN', async () => {
    const found = blocks(MARKDOWN);
    expect(found).toHaveLength(2);
    for (const b of found) await expect(mermaid.parse(b)).resolves.toBeTruthy();
  });
});

describe('extractMermaid on hand-written Mermaid', () => {
  it('flowchart: shapes, subgraph membership, both edge label forms, links', () => {
    const p = only(FLOWCHART);
    expect(p.kindHints).toEqual([{ kind: 'flowchart', score: 100, evidence: ['line 1: header "flowchart LR"'] }]);
    expect(p.warnings).toEqual([]);
    expect(byId(p, 'start')).toMatchObject({ label: 'Start', shape: 'terminal' });
    expect(byId(p, 'check')).toMatchObject({ label: 'Is it valid?', shape: 'decision' });
    expect(byId(p, 'save')).toMatchObject({ label: 'Orders DB', shape: 'store', link: 'https://example.com/db' });
    expect(byId(p, 'fix')).toMatchObject({ label: 'Fix input', shape: 'io' });
    expect(byId(p, 'worker')).toMatchObject({ label: 'Background worker', shape: 'container' });
    expect(byId(p, 'job')).toMatchObject({ label: 'Run job', shape: 'subroutine', parent: 'worker' });
    expect(byId(p, 'done')).toMatchObject({ label: 'Done', shape: 'terminal', parent: 'worker' });
    expect(byId(p, 'hex')).toMatchObject({ label: 'Prepare', shape: 'box', parent: 'worker' });
    expect(byId(p, 'memo')).toMatchObject({ label: 'Remember this', shape: 'box', parent: 'worker' });
    expect(byId(p, 'r')).toMatchObject({ label: 'Rounded text', shape: 'rounded' });
    expect(byId(p, 'md').label).toBe('Bold text');
    expect(byId(p, 'ent').label).toBe('A & B\nsecond line');
    for (const id of ['A', 'B', 'C']) expect(byId(p, id)).toMatchObject({ label: id, shape: 'process' });
    expect(byId(p, 'start').parent).toBeUndefined();
    expect(p.edges.map((e) => [e.from, e.to, e.label])).toEqual([
      ['start', 'check', ''],
      ['check', 'save', 'yes'],
      ['check', 'fix', 'no'],
      ['job', 'done', ''],
      ['hex', 'memo', ''],
      ['fix', 'start', ''],
      ['A', 'C', ''],
      ['B', 'C', ''],
      ['C', 'r', 'with "quotes"'],
      ['md', 'ent', ''],
    ]);
    expect(p.edges[3]).toMatchObject({ dashed: true, endArrow: 'block' });
    expect(p.edges[4].endArrow).toBe('none');
    expect(p.edges[0].dashed).toBeUndefined();
  });

  it('sequence: actors, aliases, alt/else frame, note over two participants, arrow kinds and order', () => {
    const p = only(SEQUENCE);
    expect(p.name).toBe('Checkout');
    expect(p.kindHints[0].kind).toBe('sequence');
    expect(p.warnings).toEqual([]);
    expect(byId(p, 'U')).toMatchObject({ label: 'Customer', shape: 'lifeline', detail: 'actor' });
    expect(byId(p, 'W')).toMatchObject({ label: 'Web shop\nfrontend', shape: 'lifeline', detail: 'participant' });
    expect(byId(p, 'P')).toMatchObject({ label: 'Payment provider', shape: 'lifeline' });
    const frame = p.nodes.find((n) => n.shape === 'frame');
    expect(frame).toMatchObject({ label: 'card ok', texts: ['card declined'], detail: 'alt e3 | else e4' });
    const note = p.nodes.find((n) => n.shape === 'note');
    expect(note).toMatchObject({ label: 'Token stored', parent: frame.id, detail: 'over W,P; after e3' });
    expect(p.edges.map((e) => [e.from, e.to, e.label, e.y])).toEqual([
      ['U', 'W', 'Place order', 0],
      ['W', 'P', 'Authorize', 1],
      ['P', 'W', 'authorized', 2],
      ['P', 'W', 'declined', 3],
      ['W', 'U', 'Done', 4],
      ['W', 'U', 'plain', 5],
    ]);
    expect(p.edges.map((e) => [e.endArrow, e.dashed === true])).toEqual([
      ['block', false],
      ['block', false],
      ['block', true],
      ['open', true],
      ['cross', false],
      ['none', false],
    ]);
  });

  it('state: composite with children, [*] start and end, choice, description and note', () => {
    const p = only(STATE);
    expect(p.kindHints[0].kind).toBe('state');
    expect(p.warnings).toEqual([]);
    expect(byId(p, 'Idle')).toMatchObject({ label: 'Idle', shape: 'rounded' });
    expect(byId(p, 'Waiting')).toMatchObject({ label: 'Waiting for payment', shape: 'rounded' });
    expect(byId(p, 'Processing')).toMatchObject({ label: 'Processing', shape: 'container' });
    expect(byId(p, 'Picking')).toMatchObject({ parent: 'Processing' });
    expect(byId(p, 'Packing')).toMatchObject({ parent: 'Processing' });
    expect(byId(p, 'check')).toMatchObject({ label: '', shape: 'decision' });
    expect(byId(p, 'Done')).toMatchObject({ label: 'Order complete' });
    expect(p.nodes.filter((n) => n.shape === 'initial').map((n) => n.parent)).toEqual([undefined, 'Processing']);
    expect(p.nodes.filter((n) => n.shape === 'final').map((n) => n.parent)).toEqual(['Processing', undefined]);
    expect(p.nodes.find((n) => n.shape === 'note')).toMatchObject({ label: 'Customer is notified', detail: 'right of Failed' });
    const labels = p.edges.map((e) => e.label).filter(Boolean);
    expect(labels).toEqual(['checkout', 'picked', 'paid [amount ok] / reserve', 'ok', 'error']);
    const ids = new Set(p.nodes.map((n) => n.id));
    for (const e of p.edges) expect(ids.has(e.from) && ids.has(e.to)).toBe(true);
  });

  it('er: entities with attribute lines and comments, relations with symbols, aliases', () => {
    const p = only(ER);
    expect(p.kindHints[0].kind).toBe('er');
    expect(p.warnings).toEqual([]);
    expect(byId(p, 'CUSTOMER')).toMatchObject({ label: 'CUSTOMER', shape: 'table', texts: ['string id PK "unique id"', 'string email "login and contact"'] });
    expect(byId(p, 'ORDER').texts).toEqual(['int id PK', 'string customer_id FK']);
    expect(byId(p, 'LINE-ITEM')).toMatchObject({ label: 'LINE-ITEM', shape: 'table' });
    expect(byId(p, 'p')).toMatchObject({ label: 'Person', shape: 'table', texts: ['string name'] });
    expect(p.edges).toEqual([
      { id: 'e1', label: 'places', from: 'CUSTOMER', to: 'ORDER', startArrow: '||', endArrow: 'o{' },
      { id: 'e2', label: 'contains', from: 'ORDER', to: 'LINE-ITEM', startArrow: '||', endArrow: '|{' },
      { id: 'e3', label: 'is', from: 'p', to: 'CUSTOMER', dashed: true, startArrow: '|o', endArrow: 'o|' },
    ]);
  });

  it('class: members, generics, stereotypes, inheritance, cardinalities, note', () => {
    const p = only(CLASS);
    expect(p.kindHints[0].kind).toBe('class');
    expect(p.warnings).toEqual([]);
    expect(byId(p, 'Animal')).toMatchObject({ label: 'Animal', shape: 'table', detail: 'abstract', texts: ['+String name', '+List<String> tags', '+makeSound() void'] });
    expect(byId(p, 'Dog')).toMatchObject({ label: 'Dog', texts: ['+bark() void'] });
    expect(byId(p, 'Repository')).toMatchObject({ label: 'Repository<T>', detail: 'interface', texts: ['+findAll() List<T>'] });
    expect(p.edges).toEqual([
      { id: 'e1', label: '', from: 'Animal', to: 'Dog', startArrow: '<|' },
      { id: 'e2', label: '1\nstores\n*', from: 'Repository', to: 'Animal', startArrow: 'o' },
    ]);
    expect(p.nodes.find((n) => n.shape === 'note')).toMatchObject({ label: 'Good boy', detail: 'for Dog' });
  });

  it('architecture-beta: nested groups, services with icons, junction, edges', () => {
    const p = only(ARCHITECTURE);
    expect(p.kindHints[0].kind).toBe('architecture');
    expect(p.warnings).toEqual([]);
    expect(byId(p, 'cloud')).toMatchObject({ label: 'Cloud', shape: 'group', icon: 'cloud' });
    expect(byId(p, 'net')).toMatchObject({ label: 'Private net', shape: 'group', parent: 'cloud' });
    expect(byId(p, 'api')).toMatchObject({ label: 'API', shape: 'icon', icon: 'server', parent: 'net' });
    expect(byId(p, 'web')).toMatchObject({ label: 'Web', shape: 'box' });
    expect(byId(p, 'hub')).toMatchObject({ label: '', shape: 'bar', parent: 'cloud' });
    expect(p.edges.map((e) => [e.from, e.to, e.startArrow, e.endArrow])).toEqual([
      ['web', 'api', undefined, 'block'],
      ['api', 'db', undefined, 'none'],
      ['api', 'hub', 'block', 'block'],
    ]);
  });

  it('markdown: one page per mermaid fence, named by the heading above it', () => {
    const { pages } = extractMermaid(MARKDOWN);
    expect(pages.map((p) => [p.id, p.name, p.kindHints[0].kind])).toEqual([
      ['mermaid-1', 'Login flow', 'flowchart'],
      ['mermaid-2', 'Order states', 'state'],
    ]);
    expect(pages[0].nodes.map((n) => n.label)).toEqual(['Open page', 'Sign in']);
    // Line numbers in evidence are those of the Markdown file.
    expect(pages[1].kindHints[0].evidence).toEqual(['line 21: header "stateDiagram-v2"']);
  });

  it('a front-matter title names the page before the heading does', () => {
    const md = '## Heading\n\n```mermaid\n---\ntitle: \'It\'\'s the title\'\n---\nflowchart TD\n  a --> b\n```\n';
    expect(extractMermaid(md).pages[0].name).toBe("It's the title");
    expect(extractMermaid('---\ntitle: Plain title\nconfig:\n  theme: dark\n---\nflowchart TD\n  a\n').pages[0].name).toBe('Plain title');
  });
});

describe('extractMermaid on odd input', () => {
  it('an unknown diagram type gives no kind hint and a warning', () => {
    const p = only('pie title Pets\n  "Dogs" : 386\n');
    expect(p.kindHints).toEqual([]);
    expect(p.nodes).toEqual([]);
    expect(p.warnings).toEqual(['line 1: unknown diagram type "pie title Pets"; nothing extracted']);
  });

  it('an unreadable line is a warning naming its line, and the rest is still read', () => {
    const p = only('flowchart TD\n  a --> b\n  ??? nonsense\n  b --> c\n');
    expect(p.warnings).toHaveLength(1);
    expect(p.warnings[0]).toMatch(/^line 3: /);
    expect(p.edges.map((e) => [e.from, e.to])).toEqual([['a', 'b'], ['b', 'c']]);
  });

  it('never throws, whatever it is given', () => {
    for (const text of ['', '   \n\n', 'sequenceDiagram\n  end\n  else x\n', 'stateDiagram-v2\n  }\n  note left of A\n', 'classDiagram\n  class A {\n', 'erDiagram\n  A {\n', 'flowchart LR\n  a["unclosed\n  end\n', '```mermaid\n```\n', undefined, null]) {
      expect(() => extractMermaid(text)).not.toThrow();
    }
    expect(extractMermaid('').pages[0].warnings).toEqual(['no Mermaid diagram found']);
  });

  it('a statement after the header on the same line is read', () => {
    const p = only('graph TD; A-->B; B-->C\n');
    expect(p.edges.map((e) => [e.from, e.to])).toEqual([['A', 'B'], ['B', 'C']]);
  });
});
