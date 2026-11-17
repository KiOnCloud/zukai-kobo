import { loadFixture } from './helpers.mjs';

/**
 * One edited model per kind for the tests of the diff picture: the fixture is the old
 * version, `edit` makes the new one with something added, removed, changed and moved, and
 * `cells` says what each cell of the picture then looks like (ids without the page prefix).
 */
const without = (list, ...ids) => list.filter((x) => !ids.includes(x.id));
const patch = (list, id, change) => list.map((x) => (x.id === id ? JSON.parse(JSON.stringify({ ...x, ...change })) : x));
/** `list` with the element `id` moved to stand right before `before`. */
const moveBefore = (list, id, before) => {
  const rest = list.filter((x) => x.id !== id);
  rest.splice(rest.findIndex((x) => x.id === before), 0, list.find((x) => x.id === id));
  return rest;
};

export const CASES = [
  {
    kind: 'flowchart',
    fixture: 'valid-refund-approval',
    edit: (ir) => ({
      ...ir,
      nodes: moveBefore([...patch(without(ir.nodes, 'note'), 'auto', { label: 'Approve without review' }), { id: 'notify', label: 'Notify the customer' }], 'reject', 'auto'),
      edges: [...patch(without(ir.edges, 'e15'), 'e3', { label: 'not found' }), { id: 'e16', from: 'pay', to: 'notify' }],
      groups: patch(ir.groups, 'g-payout', { children: ['pay'] }),
    }),
    cells: {
      added: ['notify', 'e16'],
      removed: ['note', 'e15'],
      changed: ['auto', 'reject', 'e3', 'e3:label', 'g-payout'],
      plain: ['start', 'pay', 'e1', 'g-finance'],
    },
    notes: ['"Approve without review": label was "Approve automatically"', '"not found": label was "no"', '"Send rejection with reason": moved, now after "Amount over 500 EUR?"'],
  },
  {
    kind: 'sequence',
    fixture: 'valid-loop-note-alt',
    edit: (ir) => ({
      ...ir,
      participants: moveBefore(ir.participants, 'psp', 'db'),
      messages: [...patch(without(ir.messages, 'm5'), 'm1', { label: 'POST /v2/orders' }).slice(0, 3), { id: 'm6', from: 'api', to: 'db', label: 'INSERT order' }, ir.messages[3]],
      blocks: patch(ir.blocks, 'b2', { messages: ['m6', 'm4'], branches: undefined }),
      notes: [],
    }),
    cells: {
      added: ['m6'],
      removed: ['m5', 'n1', 'b2:sep-1', 'b2:sep-label-1'],
      changed: ['m1', 'db', 'b2', 'b2:tab'],
      plain: ['web', 'psp', 'm2', 'b1', 'b1:tab'],
    },
    notes: ['"POST /v2/orders": label was "POST /orders"', '"Order database": moved, now after "Payment provider"'],
  },
  {
    kind: 'activity',
    fixture: 'valid-two-lanes',
    edit: (ir) => ({
      ...ir,
      lanes: [...ir.lanes, { id: 'warehouse', label: 'Warehouse' }],
      actions: moveBefore([...without(ir.actions, 'reject'), { id: 'inspect', label: 'Inspect the item', lane: 'warehouse' }], 'ship', 'approve'),
      flows: [...patch(without(ir.flows, 'f5', 'f8', 'f7'), 'f4', { guard: 'eligible' }), { id: 'f9', from: 'ship', to: 'inspect' }, { id: 'f10', from: 'inspect', to: 'done' }],
      controls: patch(ir.controls, 'eligible', { kind: 'merge', label: undefined }),
    }),
    cells: {
      added: ['warehouse', 'inspect', 'f9', 'f10'],
      removed: ['reject', 'f5', 'f5:label', 'f8', 'f7'],
      changed: ['f4', 'f4:label', 'approve', 'eligible'],
      plain: ['customer', 'support', 'request', 'ship', 'f1', 'start'],
    },
    notes: ['"eligible": guard was "yes"', 'eligible: kind was "decision"; label was "Eligible?"', '"Approve and send label": moved, now after "Ship item back"'],
  },
  {
    kind: 'architecture',
    fixture: 'valid-aws',
    edit: (ir) => ({
      ...ir,
      components: moveBefore([...patch(without(ir.components, 'cache'), 'api', { label: 'Order API (ECS on EC2)' }), { id: 'table', label: 'Order events', kind: 'database', icon: 'aws:dynamodb' }, { id: 'mailer', label: 'Mail service', kind: 'external' }], 'psp', 'cdn'),
      boundaries: [...patch(patch(without(ir.boundaries, 'public'), 'vpc', { children: ['alb', 'private'] }), 'private', { children: ['api', 'db'] }), { id: 'data', label: 'Data account', group: 'aws:aws_account', children: ['table'] }],
      connections: [...patch(without(ir.connections, 'c6'), 'c4', { label: 'HTTP/2' }), { id: 'c10', from: 'worker', to: 'table', label: 'append' }, { id: 'c11', from: 'worker', to: 'mailer', label: 'send mail' }],
    }),
    cells: {
      added: ['table:$diff:frame', 'data', 'mailer', 'c10', 'c11'],
      removed: ['cache:$diff:frame', 'c6', 'c6:label'],
      changed: ['api:$diff:frame', 'psp', 'c4', 'c4:label', 'vpc', 'private'],
      plain: ['cloud', 'region', 'db', 'c1'],
    },
    notDrawn: ['public'],
    notes: ['"Order API (ECS on EC2)": label was "Order API (ECS Fargate)"', '"HTTP/2": label was "HTTP"'],
  },
  {
    kind: 'er',
    fixture: 'valid-customers-orders',
    edit: (ir) => ({
      ...ir,
      entities: [
        { ...ir.entities[2] },
        { ...ir.entities[0], attributes: [ir.entities[0].attributes[0], { name: 'email', type: 'citext' }, { name: 'phone', type: 'varchar(32)' }] },
        { id: 'invoice', label: 'Invoice', attributes: [{ name: 'id', type: 'uuid', key: 'pk' }, { name: 'order_id', type: 'uuid', key: 'fk' }] },
      ],
      relations: [patch(ir.relations, 'r1', { label: 'submits' })[0], { id: 'r6', from: 'order', to: 'invoice', label: 'billed by', fromCardinality: 'one', toCardinality: 'zero-one' }],
    }),
    cells: {
      added: ['invoice', 'invoice:row-0', 'r6', 'customer:row-3'],
      removed: ['address', 'address:row-1', 'r2', 'r3', 'r4', 'r5', 'customer:row-2'],
      changed: ['customer', 'customer:row-1', 'r1', 'r1:label'],
      plain: ['customer:row-0', 'order:row-0'],
    },
    notes: ['"Customer": attributes changed', '"submits": label was "places"'],
  },
  {
    kind: 'class',
    fixture: 'valid-order-domain',
    edit: (ir) => ({
      ...ir,
      classes: [
        ...patch(without(ir.classes, 'status'), 'order', {
          attributes: [ir.classes[2].attributes[0], { name: 'Status', type: 'string', visibility: 'public' }],
          methods: [...ir.classes[2].methods.slice(0, 2), { name: 'Refund', params: 'decimal amount', returns: 'ErrorOr<Success>', visibility: 'public' }],
        }),
        { id: 'refund', label: 'Refund', attributes: [{ name: 'Amount', type: 'decimal', visibility: 'public' }] },
      ],
      relations: [...patch(without(ir.relations, 'r5'), 'r8', { kind: 'association' }), { id: 'r12', from: 'order', to: 'refund', kind: 'composition' }],
    }),
    cells: {
      added: ['refund', 'refund:row-0', 'r12', 'order:row-6'],
      removed: ['status', 'status:row-0', 'r5', 'r5:label', 'order:row-5'],
      changed: ['order', 'order:row-1', 'r8'],
      plain: ['order:row-0', 'order:sep-2', 'order:row-3', 'order:row-4', 'entity', 'r1'],
    },
    notes: ['"Order": attributes changed; methods changed', '"persists": kind was "dependency"'],
  },
  {
    kind: 'state',
    fixture: 'valid-order-lifecycle',
    edit: (ir) => ({
      ...ir,
      states: moveBefore([...patch(without(ir.states, 'returned', 'packing'), 'fulfil', { children: ['f0', 'picking', 'f-end'] }), { id: 'hold', label: 'On hold' }], 'cancelled', 'shipped'),
      transitions: [
        ...patch(without(ir.transitions, 't13', 't16', 't6', 't7'), 't2', { event: 'order placed' }),
        { id: 't18', from: 'picking', to: 'f-end', event: 'all items picked' },
        { id: 't19', from: 'payment', to: 'hold', event: 'fraud check' },
        { id: 't20', from: 'hold', to: 'cancelled', event: 'rejected' },
      ],
    }),
    cells: {
      added: ['hold', 't18', 't19', 't20'],
      removed: ['returned', 'packing', 't13', 't13:label', 't16', 't6', 't7'],
      changed: ['t2', 't2:label', 'fulfil', 'cancelled'],
      plain: ['new', 'picking', 't1', 's0'],
    },
    notes: ['"order placed": event was "checkout"', '"Cancelled": moved, now after f-end'],
  },
  {
    kind: 'usecase',
    fixture: 'valid-generalization',
    edit: (ir) => ({
      ...ir,
      useCases: [...patch(without(ir.useCases, 'collect-points'), 'place-order', { label: 'Place an order online' }), { id: 'cancel', label: 'Cancel an order' }],
      boundaries: patch(ir.boundaries, 'shop', { children: [...ir.boundaries[0].children.filter((id) => id !== 'collect-points'), 'cancel'] }),
      relations: [...patch(without(ir.relations, 'a3'), 'x1', { condition: 'a voucher code was entered' }), { id: 'a8', from: 'customer', to: 'cancel', kind: 'association' }],
    }),
    cells: {
      added: ['cancel', 'a8'],
      removed: ['collect-points', 'a3'],
      changed: ['place-order', 'x1', 'shop'],
      plain: ['customer', 'pay', 'i1', 'g1'],
    },
    notes: ['"Place an order online": label was "Place an order"', 'condition was "the customer has a voucher code"'],
  },
];

/** The old and the new model of a case. */
export function versions(c) {
  const before = loadFixture(c.kind, c.fixture);
  return { before, after: c.edit(structuredClone(before)) };
}

/** The colours a cell style carries in each state (outline or text). */
export const STATE_COLOURS = { added: /#1B7F3B|#0B4F22/, removed: /#C62828|#8E1B1B/, changed: /#B26A00|#6B3F00/ };
export const ANY_STATE_COLOUR = /#1B7F3B|#0B4F22|#C62828|#8E1B1B|#B26A00|#6B3F00/;
