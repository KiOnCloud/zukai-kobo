import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { extractPlantuml } from '../src/extract-plantuml.mjs';
import { extractFacts } from '../src/extract.mjs';
import { cover } from '../src/cover.mjs';
import { validateIr } from '../src/validate-ir.mjs';
import { scriptsDir } from './helpers.mjs';

const sources = join(scriptsDir, 'tests', 'recook-sources', 'plantuml');
const read = (name) => readFileSync(join(sources, name));
const factsOf = (name) => {
  const r = extractFacts(read(name), name);
  expect(r.ok).toBe(true);
  return r.facts;
};
const pageOf = (name) => factsOf(name).pages[0];
const one = (text) => extractPlantuml(text).pages[0];
const node = (page, id) => page.nodes.find((n) => n.id === id);
const byLabel = (page, label) => page.nodes.find((n) => n.label === label);
const edge = (page, label) => page.edges.find((e) => e.label === label);
/** The IRs written from a source by the mapping reference, as { name, ir }. */
const irsOf = (source) =>
  readdirSync(join(sources, 'ir'))
    .filter((f) => f === `${source}.ir.json` || f.startsWith(`${source}-0`))
    .map((f) => ({ name: f.replace('.ir.json', ''), ir: JSON.parse(readFileSync(join(sources, 'ir', f), 'utf8')) }));

describe('PlantUML sources: sequence', () => {
  const page = pageOf('checkout-sequence.puml');

  it('names the page by its title and hints the kind with evidence', () => {
    expect(page).toMatchObject({ id: 'plantuml-1', name: 'Checkout: place an order', autonumber: true });
    expect(page.kindHints).toEqual([{ kind: 'sequence', score: 100, evidence: ['7 participants', '14 messages', '3 blocks'] }]);
  });

  it('reads participants of every declared kind, in order, with alias, quoted name and stereotype', () => {
    const lifelines = page.nodes.filter((n) => n.shape === 'lifeline');
    expect(lifelines.map((n) => [n.id, n.label, n.detail])).toEqual([
      ['C', 'Customer', 'actor'],
      ['Web', 'Web shop', 'participant'],
      ['GW', 'API gateway', 'boundary'],
      ['OrderService', 'OrderService', 'control'],
      ['DB', 'Orders DB', 'database'],
      ['Q', 'order-events', 'queue'],
      ['Workers', 'Workers', 'collections'],
    ]);
    expect(node(page, 'Web').texts).toEqual(['«React»']);
  });

  it('reads messages in order from their sender, with line style and head', () => {
    expect(page.edges).toHaveLength(14);
    expect(page.edges.map((e) => e.y)).toEqual([...Array(14).keys()]);
    expect(edge(page, 'Press "Place order"')).toMatchObject({ from: 'C', to: 'Web', endArrow: 'block' });
    expect(edge(page, 'checkStock()')).toMatchObject({ from: 'OrderService', to: 'OrderService' });
    expect(edge(page, 'order id')).toMatchObject({ from: 'DB', to: 'OrderService', dashed: true });
    expect(edge(page, 'OrderPlaced')).toMatchObject({ from: 'OrderService', to: 'Q', endArrow: 'open' });
    expect(edge(page, 'OrderPlaced').dashed).toBeUndefined();
    // "Web <- GW" is a message from GW; "\n" in a label is a line break.
    expect(edge(page, 'order status')).toMatchObject({ from: 'GW', to: 'Web' });
    expect(edge(page, 'reserve\nstock')).toMatchObject({ from: 'Q', to: 'Workers' });
  });

  it('turns return into the dashed reply of the activated call', () => {
    expect(edge(page, '201 Created')).toMatchObject({ from: 'OrderService', to: 'GW', dashed: true });
  });

  it('reads blocks with their sections, notes, dividers and delays', () => {
    const alt = byLabel(page, 'all items in stock');
    expect(alt).toMatchObject({ shape: 'frame', texts: ['an item is missing'], detail: 'alt e5..e8 | else e9' });
    expect(byLabel(page, 'for each line')).toMatchObject({ shape: 'frame', detail: 'loop e11' });
    expect(byLabel(page, 'customer opted in')).toMatchObject({ shape: 'frame', detail: 'opt e12' });
    expect(byLabel(page, 'Validates the cart\nand locks the prices')).toMatchObject({ shape: 'note', detail: 'right of OrderService; after e3' });
    expect(byLabel(page, 'Polling every 10 s')).toMatchObject({ shape: 'note', detail: 'over Web,GW; after e12' });
    expect(byLabel(page, 'Submit')).toMatchObject({ shape: 'text', detail: 'divider' });
    expect(byLabel(page, 'Fulfil')).toMatchObject({ shape: 'text', detail: 'divider; after e10' });
    expect(byLabel(page, 'up to 5 minutes later')).toMatchObject({ shape: 'text', detail: 'delay; after e12' });
  });

  it('skips comments and skinparams, and reports the include it does not follow', () => {
    expect(page.warnings).toEqual(['line 3: !include of ./theme.iuml is not followed: what that file declares is not in these facts']);
    expect(JSON.stringify(page)).not.toMatch(/ArrowColor|browser shows|kept next to/);
  });

  it('reads the odd arrows, open ends, boxes, refs, groups and creation', () => {
    const p = one(
      [
        '@startuml',
        'box "Internal" #LightBlue',
        'participant A',
        'participant "B service" as B',
        'end box',
        '[-> A : request',
        'A ->x B : lost',
        'A -\\ B : half',
        'A <-> B : both',
        'A -[#blue]-> B : coloured reply',
        'A->B: tight',
        '"New one" -> A : hi',
        'group Retry [3 times]',
        '  A -> B : again',
        'end',
        'par',
        '  A -> B : first',
        'else',
        '  A -> B : second',
        'end',
        'ref over A, B : see login',
        'activate B',
        'return orphan',
        'return nobody',
        'some garbage',
        '@enduml',
      ].join('\n'),
    );
    expect(byLabel(p, 'Internal')).toMatchObject({ shape: 'group' });
    expect(node(p, 'B')).toMatchObject({ label: 'B service', parent: byLabel(p, 'Internal').id });
    expect(edge(p, 'request')).toMatchObject({ from: null, to: 'A' });
    expect(edge(p, 'lost')).toMatchObject({ endArrow: 'cross' });
    expect(edge(p, 'half')).toMatchObject({ endArrow: 'open' });
    expect(edge(p, 'both')).toMatchObject({ startArrow: 'block', endArrow: 'block' });
    expect(edge(p, 'coloured reply')).toMatchObject({ dashed: true });
    expect(edge(p, 'tight')).toMatchObject({ from: 'A', to: 'B' });
    expect(edge(p, 'hi')).toMatchObject({ from: 'New one', to: 'A' });
    expect(byLabel(p, 'Retry')).toMatchObject({ shape: 'frame', texts: ['3 times'], detail: 'group e8' });
    expect(p.nodes.find((n) => n.detail === 'par e9 | and e10')).toBeTruthy();
    expect(byLabel(p, 'see login')).toMatchObject({ shape: 'frame', detail: 'ref over A,B; after e10' });
    // "activate B" after a call to B opens that call: the first return answers it.
    expect(edge(p, 'orphan')).toMatchObject({ from: 'B', to: 'A', dashed: true });
    expect(p.warnings).toEqual([
      'line 6: message e1 comes from outside the diagram: that end is open',
      'line 24: "return nobody" answers no activated call (activate or ++ before it); not read',
      'line 25: unreadable statement "some garbage"',
    ]);
  });
});

describe('PlantUML sources: class', () => {
  const page = pageOf('billing-classes.puml');

  it('hints class and reads classes, interfaces, enums and abstract classes with their members', () => {
    expect(page.name).toBe('Billing domain');
    expect(page.kindHints[0]).toMatchObject({ kind: 'class' });
    expect(page.kindHints[0].evidence).toEqual(['10 class boxes', '6 inheritance, composition or aggregation ends']);
    expect(node(page, 'Document')).toMatchObject({ shape: 'table', detail: 'abstract', parent: 'billing.domain', texts: ['# id : UUID', '# issuedAt : Instant', '+ total() : Money'] });
    expect(node(page, 'Invoice').texts).toEqual(['- lines : List<InvoiceLine>', '+ addLine(product : Product, qty : int) : void', '+ total() : Money', '+ draft(customer : Customer) : Invoice']);
    expect(node(page, 'InvoiceStatus')).toMatchObject({ detail: 'enum', texts: ['DRAFT', 'ISSUED', 'PAID'] });
    expect(node(page, 'Taxable')).toMatchObject({ shape: 'table', detail: 'interface', texts: ['«domain»', '+ taxRate() : Decimal'] });
    expect(node(page, 'JpaRepo')).toMatchObject({ label: 'JPA invoice repository', parent: 'billing.infra' });
    expect(node(page, 'Customer').texts).toEqual(['+ name : String', '+ vatId : String']);
    expect(node(page, 'CreditNote')).toMatchObject({ shape: 'table' });
  });

  it('reads packages and namespaces as containers', () => {
    expect(node(page, 'billing.domain')).toMatchObject({ shape: 'container', detail: 'package' });
    expect(node(page, 'billing.infra')).toMatchObject({ shape: 'container', detail: 'namespace' });
  });

  it('reads every relation arrow with label and multiplicities', () => {
    const rel = (from, to) => page.edges.find((e) => e.from === from && e.to === to);
    expect(rel('Invoice', 'Document')).toMatchObject({ endArrow: 'block-open' });
    expect(rel('Invoice', 'InvoiceLine')).toMatchObject({ label: 'contains', startLabel: '1', endLabel: '1..*', startArrow: 'diamond', endArrow: 'none' });
    expect(rel('Invoice', 'InvoiceStatus')).toMatchObject({ endArrow: 'open' });
    expect(rel('Invoice', 'Taxable')).toMatchObject({ dashed: true, endArrow: 'block-open' });
    expect(rel('Customer', 'Invoice')).toMatchObject({ label: 'is billed by', startLabel: '1', endLabel: '0..*', startArrow: 'diamond-open' });
    expect(rel('JpaRepo', 'Invoice')).toMatchObject({ label: 'persists', dashed: true, endArrow: 'open' });
    expect(rel('CreditNote', 'Document')).toMatchObject({ endArrow: 'block-open' });
    expect(rel('InvoiceLine', 'Product')).toMatchObject({ endArrow: 'open' });
    expect(rel('N1', 'InvoiceLine')).toMatchObject({ dashed: true, endArrow: 'none' });
  });

  it('reads notes and strips markup from their text', () => {
    expect(byLabel(page, 'Immutable once ISSUED')).toMatchObject({ shape: 'note', detail: 'right of Invoice' });
    expect(node(page, 'N1')).toMatchObject({ shape: 'note', label: 'Money is always in minor units' });
  });

  it('reads generics, implements, member ends, section titles and hidden lines', () => {
    const p = one(
      [
        'class Box<T extends Item> {',
        '  -- private --',
        '  - T item',
        '  + {static} of(item : T) : Box<T>',
        '  __init__(self)',
        '}',
        'class Order implements Auditable, Serializable',
        'Order::customerId --> Customer::id : refers to',
        'Order -[hidden]- Box',
        'Order +-- Line',
        'object snapshot',
      ].join('\n'),
    );
    expect(node(p, 'Box')).toMatchObject({ label: 'Box<T extends Item>', texts: ['private', '- T item', '+ of(item : T) : Box<T>', '__init__(self)'] });
    expect(p.edges.filter((e) => e.from === 'Order' && e.dashed && e.endArrow === 'block-open').map((e) => e.to)).toEqual(['Auditable', 'Serializable']);
    expect(edge(p, 'refers to')).toMatchObject({ from: 'Order', to: 'Customer', fromPart: 'customerId', toPart: 'id' });
    expect(p.edges.some((e) => e.from === 'Order' && e.to === 'Box')).toBe(false);
    expect(p.edges.find((e) => e.to === 'Line')).toMatchObject({ startArrow: 'plus' });
    expect(node(p, 'Auditable').shape).toBe('table');
    expect(p.warnings).toEqual(['line 11: object "snapshot" is not read: object diagrams and data blocks have no Zukai kind']);
  });
});

describe('PlantUML sources: state', () => {
  const page = pageOf('ticket-states.puml');

  it('hints state and reads [*], states, composites and the choice', () => {
    expect(page.kindHints).toEqual([{ kind: 'state', score: 100, evidence: ['7 states', '14 transitions', '[*] start'] }]);
    expect(page.nodes.filter((n) => n.shape === 'initial').map((n) => n.parent)).toEqual([undefined, 'InProgress']);
    expect(page.nodes.filter((n) => n.shape === 'final').map((n) => n.parent)).toEqual(['InProgress', undefined]);
    expect(node(page, 'InProgress')).toMatchObject({ label: 'In progress', shape: 'container' });
    expect(node(page, 'Investigating')).toMatchObject({ shape: 'rounded', parent: 'InProgress' });
    expect(node(page, 'priority')).toMatchObject({ shape: 'decision', label: '' });
    expect(node(page, 'Review').texts).toEqual(['Second agent checks the answer']);
  });

  it('reads transitions with event, guard and action as the label', () => {
    expect(page.edges).toHaveLength(14);
    expect(edge(page, 'assign [agent available] / notify agent')).toMatchObject({ from: 'New', to: 'Triaged' });
    expect(edge(page, '[low priority]')).toMatchObject({ from: 'priority', to: 'Closed' });
    expect(edge(page, 'rejected')).toMatchObject({ from: 'Review', to: 'InProgress' });
    expect(edge(page, 'fix found').to).toBe(page.nodes.find((n) => n.shape === 'final' && n.parent === 'InProgress').id);
  });

  it('reads one-line and multi-line notes', () => {
    expect(byLabel(page, 'Only for\nenterprise plans')).toMatchObject({ shape: 'note', detail: 'right of Review' });
    expect(byLabel(page, 'Created by e-mail or form')).toMatchObject({ shape: 'note', detail: 'left of New' });
    expect(page.warnings).toEqual([]);
  });

  it('reads forks, history, reversed arrows and regions', () => {
    const p = one(['state Active {', '  [*] -> Idle', '  --', '  Idle --> Typing : key', '}', 'state f <<fork>>', '[*] --> Active', 'Active --> f', 'f --> A1', 'B1 <-- A1 : back', 'Active --> Active[H] : resume', 'state Done <<end>>'].join('\n'));
    expect(node(p, 'Active')).toMatchObject({ shape: 'container', detail: 'concurrent regions' });
    expect(node(p, 'f')).toMatchObject({ shape: 'bar', detail: 'fork' });
    expect(edge(p, 'back')).toMatchObject({ from: 'A1', to: 'B1' });
    expect(node(p, 'Active[H]')).toMatchObject({ shape: 'ellipse', detail: 'history', parent: 'Active' });
    expect(node(p, 'Done')).toMatchObject({ shape: 'final' });
  });
});

describe('PlantUML sources: activity (new syntax)', () => {
  const page = pageOf('leave-request-activity.puml');
  const id = (label) => byLabel(page, label).id;
  const flow = (from, to) => page.edges.find((e) => e.from === id(from) && e.to === id(to));

  it('hints activity for swimlanes and forks, with flowchart second', () => {
    expect(page.name).toBe('Leave request');
    expect(page.kindHints.map((h) => [h.kind, h.score])).toEqual([['activity', 100], ['flowchart', 40]]);
    expect(page.kindHints[0].evidence).toEqual(['3 swimlanes', '2 fork or join bars', '12 actions', '4 decisions']);
  });

  it('reads swimlanes and puts every step in its lane', () => {
    const lanes = page.nodes.filter((n) => n.shape === 'lane');
    expect(lanes.map((n) => n.label)).toEqual(['Employee', 'Manager', 'HR system']);
    expect(byLabel(page, 'Propose new dates').parent).toBe(lanes[0].id);
    expect(byLabel(page, 'Approve changed dates').parent).toBe(lanes[1].id);
    expect(byLabel(page, 'Block the dates\nin the team calendar')).toMatchObject({ shape: 'rounded', parent: lanes[2].id });
  });

  it('rebuilds if / elseif / else as decisions with labelled branches', () => {
    expect(byLabel(page, 'Team coverage ok?').shape).toBe('decision');
    expect(flow('Team coverage ok?', 'Approve').label).toBe('yes');
    expect(flow('Team coverage ok?', 'Can dates move?').label).toBe('');
    expect(flow('Can dates move?', 'Propose new dates').label).toBe('yes');
    expect(flow('Can dates move?', 'Reject with a reason').label).toBe('no');
    expect(flow('Fill in the leave form', 'Review the request').label).toBe('submitted');
  });

  it('rebuilds fork, while and repeat loops, and ends a branch at stop', () => {
    const [fork, join] = page.nodes.filter((n) => n.shape === 'bar');
    expect([fork.detail, join.detail]).toEqual(['fork', 'join']);
    expect(page.edges.filter((e) => e.to === fork.id).map((e) => e.from)).toEqual([id('Approve'), id('Approve changed dates')]);
    expect(page.edges.filter((e) => e.from === fork.id).map((e) => e.to)).toEqual([id('Update the leave balance'), id('Block the dates\nin the team calendar')]);
    expect(flow('Payroll run open?', 'Wait for the next run').label).toBe('yes');
    expect(flow('Wait for the next run', 'Payroll run open?')).toBeTruthy();
    expect(flow('Payroll run open?', 'Recalculate salary').label).toBe('no');
    expect(flow('More months affected?', 'Recalculate salary').label).toBe('yes');
    expect(flow('More months affected?', 'Receive confirmation').label).toBe('no');
    const finals = page.nodes.filter((n) => n.shape === 'final');
    expect(finals).toHaveLength(2);
    expect(page.edges.filter((e) => e.from === id('Read the rejection')).map((e) => e.to)).toEqual([finals[0].id]);
  });

  it('reads partitions and notes', () => {
    expect(byLabel(page, 'Payroll')).toMatchObject({ shape: 'container', detail: 'partition' });
    expect(byLabel(page, 'Recalculate salary').parent).toBe(byLabel(page, 'Payroll').id);
    expect(byLabel(page, 'Within 2 working days')).toMatchObject({ shape: 'note', detail: `right of ${id('Review the request')}` });
    expect(page.warnings).toEqual([]);
  });

  it('hints flowchart first without swimlanes, and reads switch, split, break and backward', () => {
    const p = one(
      ['start', ':read input<', 'switch (kind?)', 'case (A)', '  :do A;', 'case (B)', '  :do B;', 'endswitch', 'repeat :first;', '  if (bad?) then (yes)', '    break', '  endif', '  backward :undo;', 'repeat while (again?) is (yes) not (no)', ':after;', 'stop'].join('\n'),
    );
    expect(p.kindHints.map((h) => h.kind)).toEqual(['flowchart', 'activity']);
    expect(byLabel(p, 'read input').shape).toBe('io');
    const at = (label) => byLabel(p, label).id;
    const labelOf = (from, to) => p.edges.find((e) => e.from === at(from) && e.to === at(to))?.label;
    expect(labelOf('kind?', 'do A')).toBe('A');
    expect(labelOf('kind?', 'do B')).toBe('B');
    expect(labelOf('again?', 'undo')).toBe('yes');
    expect(labelOf('undo', 'first')).toBe('');
    expect(labelOf('again?', 'after')).toBe('no');
    expect(labelOf('bad?', 'after')).toBe('yes');
    expect(p.warnings).toEqual([]);
  });
});

describe('PlantUML sources: component and deployment', () => {
  const page = pageOf('shop-deployment.puml');

  it('hints architecture first and the entity tables as an ER part, and keeps the direction', () => {
    expect(page).toMatchObject({ name: 'Web shop deployment', direction: 'LR' });
    expect(page.kindHints.map((h) => h.kind)).toEqual(['architecture', 'er']);
    expect(page.kindHints[0].evidence).toEqual(['11 deployed elements (component, node, store, queue, cloud)', '1 interface', '1 actor']);
    expect(page.kindHints[1].evidence).toEqual(['2 entities', "1 relation with crow's-foot ends"]);
  });

  it('reads components, nodes, databases, queues, clouds, frames and actors', () => {
    expect(node(page, 'customer')).toMatchObject({ label: 'Customer', shape: 'actor' });
    expect(node(page, 'psp')).toMatchObject({ label: 'Payment provider', shape: 'cloud' });
    expect(node(page, 'k8s')).toMatchObject({ label: 'Kubernetes cluster', shape: 'container', detail: 'node' });
    expect(node(page, 'web')).toMatchObject({ label: 'Storefront', shape: 'box', detail: 'component', parent: 'k8s', texts: ['«Next.js»'] });
    expect(node(page, 'api')).toMatchObject({ label: 'Order API', shape: 'box', detail: 'component' });
    expect(node(page, 'catalog')).toMatchObject({ label: 'Catalog API', detail: 'component', parent: 'k8s' });
    expect(node(page, 'events')).toMatchObject({ label: 'order-events', shape: 'queue', parent: 'k8s' });
    expect(node(page, 'Data tier')).toMatchObject({ shape: 'container', detail: 'frame' });
    expect(node(page, 'ordersdb')).toMatchObject({ label: 'Orders DB', shape: 'container', detail: 'database', parent: 'Data tier' });
    expect(node(page, 'catalogdb')).toMatchObject({ shape: 'store', parent: 'Data tier' });
    expect(node(page, 'bucket')).toMatchObject({ shape: 'store', detail: 'storage' });
    expect(node(page, 'rest')).toMatchObject({ label: 'REST', shape: 'ellipse', detail: 'interface' });
  });

  it('reads the entity tables drawn inside the database', () => {
    expect(node(page, 'orders')).toMatchObject({ shape: 'table', parent: 'ordersdb', detail: 'entity; key: id; mandatory: id, customer_id', texts: ['id : uuid «PK»', 'customer_id : uuid «FK»', 'total : decimal(10,2)'] });
    expect(edge(page, 'has')).toMatchObject({ from: 'orders', to: 'order_lines', startArrow: 'ERmandOne', endArrow: 'ERzeroToMany' });
  });

  it('reads arrows of mixed styles with their labels', () => {
    expect(edge(page, 'HTTPS')).toMatchObject({ from: 'customer', to: 'web', endArrow: 'open' });
    expect(edge(page, '1. POST /api/orders')).toMatchObject({ from: 'web', to: 'rest' });
    expect(edge(page, '3. publish OrderPlaced')).toMatchObject({ from: 'api', to: 'events', dashed: true });
    expect(page.edges.find((e) => e.from === 'api' && e.to === 'rest')).toMatchObject({ label: '', endArrow: 'none' });
  });

  it('redacts the credential of a note with the patterns of the secret scan', () => {
    const noteNode = page.nodes.find((n) => n.shape === 'note');
    expect(noteNode.label).toBe('jdbc:postgresql://<redacted credential>@db.internal:5432/orders');
    expect(noteNode.detail).toBe('bottom of ordersdb');
    expect(page.sensitive).toEqual([{ element: noteNode.id, field: 'label', kinds: ['uri-credential'] }]);
    expect(JSON.stringify(page)).not.toContain('S3cr3tPass99');
  });

  it('keeps the legend as a free text and reports the preprocessor lines', () => {
    expect(page.nodes.find((n) => n.detail === 'legend')).toMatchObject({ shape: 'text', label: 'Solid: synchronous call\nDotted: asynchronous' });
    expect(page.warnings.slice(0, 2)).toEqual([
      'line 3: the preprocessor is not run: a procedure, function, !define or variable is not expanded, a text that uses one is read as written and a line that calls one is reported as unreadable',
      'line 4: !includeurl of AWSPUML/AWSCommon.puml is not followed: what that file declares is not in these facts',
    ]);
  });

  it('reads long descriptions, lollipops, nested containers and reports a macro call', () => {
    const p = one(
      ['component comp1 [', 'This component', 'has a long comment', ']', '() "HTTP API" as http', '[Web] -( http', 'database "DB" {', '  folder "schemas" {', '    [core]', '  }', '}', 'together {', '  [X1]', '}', 'Internet ~~> [Web] : wavy', 'cloud Internet', 'Person(user, "A C4 user")', '[Web] --> [core] : uses\\nsometimes'].join('\n'),
    );
    expect(node(p, 'comp1')).toMatchObject({ label: 'This component\nhas a long comment', detail: 'component' });
    expect(node(p, 'http')).toMatchObject({ label: 'HTTP API', shape: 'ellipse', detail: 'interface' });
    expect(p.edges[0]).toMatchObject({ from: 'Web', to: 'http', endArrow: 'socket' });
    expect(node(p, 'core')).toMatchObject({ parent: 'schemas' });
    expect(node(p, 'schemas')).toMatchObject({ shape: 'container', parent: 'DB' });
    expect(node(p, 'X1').parent).toBeUndefined();
    expect(node(p, 'Internet').shape).toBe('cloud');
    expect(edge(p, 'wavy')).toMatchObject({ dashed: true });
    expect(edge(p, 'uses\nsometimes')).toBeTruthy();
    expect(p.warnings).toEqual(['line 17: unreadable statement "Person(user, "A C4 user")"']);
  });
});

describe('PlantUML sources: use case', () => {
  const page = pageOf('library-usecases.puml');

  it('hints usecase with the evidence', () => {
    expect(page).toMatchObject({ name: 'Library system', direction: 'LR' });
    expect(page.kindHints).toEqual([{ kind: 'usecase', score: 94, evidence: ['7 use cases', '3 actors', '2 include or extend arrows', '1 system boundary'] }]);
  });

  it('reads actors and use cases in every spelling, inside the system boundary', () => {
    expect(page.nodes.filter((n) => n.shape === 'actor').map((n) => [n.id, n.label])).toEqual([['Member', 'Member'], ['Lib', 'Librarian'], ['Pay', 'Payment gateway']]);
    expect(node(page, 'Pay').texts).toEqual(['«system»']);
    const boundary = node(page, 'Library system');
    expect(boundary).toMatchObject({ shape: 'container', detail: 'rectangle' });
    const useCases = page.nodes.filter((n) => n.shape === 'ellipse');
    expect(useCases.map((n) => [n.id, n.label, n.parent])).toEqual([
      ['Search', 'Search the catalogue', boundary.id],
      ['Borrow', 'Borrow a book', boundary.id],
      ['Return', 'Return a book', boundary.id],
      ['Fee', 'Pay a late fee', boundary.id],
      ['Check membership', 'Check membership', boundary.id],
      ['Manage', 'Manage the catalogue', boundary.id],
      ['Reserve a book', 'Reserve a book', undefined],
    ]);
    expect(useCases.every((n) => n.detail === 'usecase')).toBe(true);
  });

  it('reads association, include, extend and generalization arrows', () => {
    const rel = (from, to) => page.edges.find((e) => e.from === from && e.to === to);
    expect(rel('Member', 'Borrow')).toMatchObject({ label: '', endArrow: 'open' });
    expect(rel('Borrow', 'Check membership')).toMatchObject({ label: '«include»', dashed: true });
    expect(rel('Fee', 'Return')).toMatchObject({ label: '«extend»', dashed: true });
    expect(rel('Lib', 'Member')).toMatchObject({ endArrow: 'block-open' });
    expect(rel('Reserve a book', 'Borrow')).toMatchObject({ endArrow: 'block-open' });
    expect(byLabel(page, 'Only when the book is overdue')).toMatchObject({ shape: 'note', detail: 'right of Fee' });
    expect(page.warnings).toEqual([]);
  });
});

describe('PlantUML sources: ER', () => {
  const page = pageOf('shop-entities.puml');

  it('hints er and reads entities with their key and mandatory rows', () => {
    expect(page.kindHints).toEqual([{ kind: 'er', score: 82, evidence: ['5 entities', "4 relations with crow's-foot ends"] }]);
    expect(node(page, 'customer')).toMatchObject({ label: 'Customer', shape: 'table', detail: 'entity; key: id; mandatory: id, email', texts: ['id : uuid «generated»', 'email : varchar(255)', 'name : varchar(120)'] });
    expect(node(page, 'order_line')).toMatchObject({ detail: 'entity; key: order_id, line_no; mandatory: order_id, line_no, product_id' });
    expect(node(page, 'Loyalty card')).toMatchObject({ shape: 'table', detail: 'entity' });
  });

  it("reads crow's-foot ends, dashed lines and labels", () => {
    expect(edge(page, 'places')).toMatchObject({ from: 'customer', to: 'order', startArrow: 'ERmandOne', endArrow: 'ERzeroToMany' });
    expect(edge(page, 'contains')).toMatchObject({ startArrow: 'ERmandOne', endArrow: 'ERoneToMany' });
    expect(page.edges[2]).toMatchObject({ from: 'Product', to: 'order_line', dashed: true, endArrow: 'ERzeroToMany' });
    expect(page.edges[3]).toMatchObject({ from: 'customer', to: 'Loyalty card', startArrow: 'ERzeroToOne', endArrow: 'ERzeroToOne' });
    expect(page.warnings).toEqual([]);
  });
});

describe('PlantUML sources: pages, unsupported types and detection', () => {
  it('reads every diagram of a file as a page and reports the types it does not read', () => {
    const facts = factsOf('several-diagrams.puml');
    expect(facts.format).toBe('plantuml');
    expect(facts.pages.map((p) => [p.id, p.name, p.kindHints[0]?.kind, p.unsupported?.type])).toEqual([
      ['plantuml-1', 'login', 'sequence', undefined],
      ['plantuml-2', '', undefined, 'mind map'],
      ['plantuml-3', 'Door', 'state', undefined],
      ['plantuml-4', 'old-activity', undefined, 'activity diagram in the legacy syntax'],
      ['plantuml-5', '', undefined, 'Gantt chart'],
      ['plantuml-6', '', undefined, 'Salt wireframe'],
    ]);
    for (const p of facts.pages.filter((x) => x.unsupported)) {
      expect(p.nodes).toEqual([]);
      expect(p.edges).toEqual([]);
      expect(p.warnings).toHaveLength(1);
      expect(p.warnings[0]).toMatch(/^line \d+: .* is not read \(.+\); nothing extracted from this diagram$/);
    }
    expect(facts.pages[1].warnings[0]).toBe('line 7: mind map is not read (Zukai has no mind map kind); nothing extracted from this diagram');
  });

  it('reports json, an unknown start tag and an unclosed diagram', () => {
    const facts = extractPlantuml('@startjson\n{"a": 1}\n@endjson\n@startfoo\nx\n@endfoo\n@startuml\nA -> B : hi\n');
    expect(facts.pages.map((p) => p.unsupported?.type)).toEqual(['JSON data', '@startfoo diagram', undefined]);
    expect(facts.pages[2].warnings).toEqual(['line 7: @startuml is not closed with @enduml']);
    expect(facts.pages[2].edges).toHaveLength(1);
  });

  it('reads the fences of a Markdown file, each named by its heading', () => {
    const facts = factsOf('payment-notes.md');
    expect(facts.format).toBe('plantuml');
    expect(facts.pages.map((p) => [p.id, p.name, p.kindHints[0].kind])).toEqual([['plantuml-1', 'Refund flow', 'sequence'], ['plantuml-2', 'Modules', 'architecture']]);
    expect(facts.pages[1].nodes.map((n) => n.label)).toEqual(['Refund handler', 'Ledger', 'Mail sender']);
  });

  it('reads a Markdown file with fences of both languages as pages of both', () => {
    const md = '# Doc\n\n## Flow\n\n```mermaid\nflowchart TD\n  a[Start] --> b[End]\n```\n\n## Calls\n\n```plantuml\nA -> B : hi\n```\n';
    const r = extractFacts(Buffer.from(md), 'doc.md');
    expect(r.facts.format).toBe('markdown');
    expect(r.facts.pages.map((p) => [p.id, p.name])).toEqual([['mermaid-1', 'Flow'], ['plantuml-1', 'Calls']]);
  });

  it('picks PlantUML by content or by extension, and leaves Mermaid and draw.io alone', () => {
    const format = (text, file) => extractFacts(Buffer.from(text), file).facts?.format;
    expect(format('@startuml\nA -> B\n@enduml\n', 'diagram.txt')).toBe('plantuml');
    for (const ext of ['puml', 'plantuml', 'pu', 'iuml']) expect(format('Alice -> Bob : hi\n', `x.${ext}`)).toBe('plantuml');
    expect(format('sequenceDiagram\n  A->>B: says @startuml\n', 'x.mmd')).toBe('mermaid');
    expect(format('flowchart TD\n  a --> b\n', 'x.md')).toBe('mermaid');
    expect(format('<mxfile><diagram id="p" name="P"><mxGraphModel><root><mxCell id="0"/></root></mxGraphModel></diagram></mxfile>', 'x.xml')).toBe('drawio');
    expect(extractFacts(Buffer.from('just some text\n'), 'notes.txt')).toMatchObject({ ok: false });
    expect(extractFacts(Buffer.from('just some text\n'), 'notes.txt').error).toMatch(/\.puml/);
  });

  it('says so when a diagram holds nothing it knows, and when a file is empty', () => {
    expect(one('@startuml\nhello world\n@enduml').warnings).toEqual(['line 2: no statement of a diagram type this reader knows (sequence, class, state, activity, component, deployment, use case, ER); nothing extracted']);
    expect(extractPlantuml('').pages[0].warnings).toEqual(['no PlantUML diagram found']);
  });

  it('strips creole and HTML markup, links, icons and both comment styles from texts', () => {
    const p = one(
      [
        "' a line comment",
        "A -> B : **bold** //italic// __under__ <color:red>red</color> <size:18>big</size> <&check> done /' inline '/ now",
        'A -> B : see [[https://docs.example.org/api the API docs]] at https://docs.example.org//x',
        "/' a block",
        "   comment '/",
        'note over A : first line\\nsecond <b>line</b><br>third &amp; last',
      ].join('\n'),
    );
    expect(p.edges[0].label).toBe('bold italic under red big done now');
    expect(p.edges[1].label).toBe('see the API docs at https://docs.example.org//x');
    expect(p.nodes.find((n) => n.shape === 'note').label).toBe('first line\nsecond line\nthird & last');
    expect(JSON.stringify(p)).not.toMatch(/comment/);
  });

  it('redacts a secret in a message label and a personal address in a note', () => {
    const r = extractFacts(Buffer.from('@startuml\nApp -> DB : connect password=Hunter2Hunter2\nnote right of DB : ask jane.roe@corp-mail.io\n@enduml\n'), 'x.puml');
    const page = r.facts.pages[0];
    expect(page.edges[0].label).toBe('connect password=<redacted credential>');
    expect(page.nodes.find((n) => n.shape === 'note').label).toBe('ask <redacted e-mail>');
    expect(page.sensitive.map((s) => s.kinds)).toEqual([['personal-data'], ['token-pattern']]);
    expect(page.warnings.at(-1)).toMatch(/2 texts hold what looks like a credential or personal data/);
  });
});

describe('PlantUML sources: an IR written by the mapping reference', () => {
  const cases = ['checkout-sequence', 'billing-classes', 'ticket-states', 'leave-request-activity', 'shop-deployment', 'shop-entities'];

  it.each(cases)('%s: the IR is valid and covers every text of the facts', (source) => {
    const facts = factsOf(`${source}.puml`);
    const irs = irsOf(source);
    expect(irs.length).toBeGreaterThan(0);
    for (const { name, ir } of irs) expect({ name, ...validateIr(ir) }).toEqual({ name, ok: true, errors: [] });
    const result = cover(facts, irs);
    expect(result.missing).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.units).toBeGreaterThan(15);
  });

  it('a dropped label is reported by cover', () => {
    const facts = factsOf('checkout-sequence.puml');
    const [{ name, ir }] = irsOf('checkout-sequence');
    const without = { ...ir, messages: ir.messages.filter((m) => m.id !== 'e9'), blocks: ir.blocks.map((b) => (b.id === 'b1' ? { ...b, branches: [] } : b)) };
    const result = cover(facts, [{ name, ir: without }]);
    expect(result.ok).toBe(false);
    expect(result.missing.map((m) => m.text)).toEqual(['an item is missing', '409 Out of stock']);
  });

  it('a text of one page is not covered by the diagram of another', () => {
    const facts = factsOf('several-diagrams.puml');
    const door = { schemaVersion: 1, kind: 'state', title: 'Door', states: [{ id: 's', kind: 'initial' }, { id: 'closed', label: 'Closed' }, { id: 'open', label: 'Open' }], transitions: [{ id: 't1', from: 's', to: 'closed' }, { id: 't2', from: 'closed', to: 'open', event: 'open' }], meta: { source: 'recook', notes: ['recooked from several-diagrams.puml, page "Door"'] } };
    const result = cover(facts, [{ name: 'door', ir: door }]);
    expect(result.missing.map((m) => [m.page, m.text])).toEqual([['plantuml-1', 'Alice'], ['plantuml-1', 'Bob'], ['plantuml-1', 'hello'], ['plantuml-1', 'hi']]);
  });
});

describe('a note that is the condition of an «extend»', () => {
  const usecases = (notes) => one(`@startuml
actor Patient
rectangle "Clinic" {
  usecase "Book an appointment" as UC1
  usecase (Pay deposit) as UC7
  usecase "Cancel" as UC2
}
Patient --> UC1
UC7 .> UC1 : <<extend>>
${notes}
@enduml`);

  it('is offered on the edge when it stands beside the use case that extends, and stays a text of the page', () => {
    const page = usecases('note right of UC7\n  Only for first-time\n  patients\nend note');
    expect(edge(page, '«extend»')).toMatchObject({ from: 'UC7', to: 'UC1', condition: 'Only for first-time patients' });
    const note = page.nodes.find((n) => n.shape === 'note');
    expect(note).toMatchObject({ label: 'Only for first-time\npatients', detail: 'right of UC7' });
  });

  it('is offered on the edge when it is written on the link', () => {
    const page = usecases('note on link : when the patient is new');
    expect(edge(page, '«extend»').condition).toBe('when the patient is new');
  });

  it('is offered to no edge beside the extended use case, beside an actor, as a free note, or beside a use case that extends two', () => {
    for (const notes of ['note right of UC1 : busiest in January', 'note left of Patient : about 300 a day', 'note "Reminders go out 24h before" as N1']) {
      expect(usecases(notes).edges.every((e) => e.condition === undefined), notes).toBe(true);
    }
    const two = usecases('UC7 .> UC2 : <<extend>>\nnote right of UC7 : first visit');
    expect(two.edges.every((e) => e.condition === undefined)).toBe(true);
  });

  it('is not offered on an include or an association', () => {
    const page = one('@startuml\nusecase A\nusecase B\nA .> B : <<include>>\nnote on link : always\n@enduml');
    expect(page.edges[0].condition).toBeUndefined();
  });
});

describe('the pages of a Markdown file', () => {
  it('come in the order of the file, whichever language a fence is written in', () => {
    const md = '# Booking notes\n\n```plantuml\nA -> B : hi\n```\n\nText between.\n\n```mermaid\nstateDiagram-v2\n  [*] --> Open\n```\n\n## Later\n\n```plantuml\nC -> D : bye\n```\n';
    const r = extractFacts(Buffer.from(md), 'notes.md');
    expect(r.facts.format).toBe('markdown');
    expect(r.facts.pages.map((p) => p.id)).toEqual(['plantuml-1', 'mermaid-1', 'plantuml-2']);
    expect(r.facts.pages.every((p) => !('line' in p))).toBe(true);
  });

  it('get a name of their own when one heading stands above two fences', () => {
    const md = '# Booking notes\n\n```plantuml\nA -> B : hi\n```\n\n```mermaid\nstateDiagram-v2\n  [*] --> Open\n```\n\n## Later\n\n```plantuml\nC -> D : bye\n```\n';
    const names = extractFacts(Buffer.from(md), 'notes.md').facts.pages.map((p) => p.name);
    expect(names).toEqual(['Booking notes (1)', 'Booking notes (2)', 'Later']);
    // Two fences of one language under one heading, and a name the numbering would repeat.
    const same = '## Flow\n\n```plantuml\nA -> B : hi\n```\n\n```plantuml\nC -> D : bye\n```\n\n## Flow (1)\n\n```plantuml\nE -> F : x\n```\n';
    expect(extractFacts(Buffer.from(same), 'flow.md').facts.pages.map((p) => p.name)).toEqual(['Flow (2)', 'Flow (3)', 'Flow (1)']);
    const mermaid = '## Steps\n\n```mermaid\nflowchart TD\n  a --> b\n```\n\n```mermaid\nflowchart TD\n  c --> d\n```\n';
    expect(extractFacts(Buffer.from(mermaid), 'steps.md').facts.pages.map((p) => p.name)).toEqual(['Steps (1)', 'Steps (2)']);
  });
});
