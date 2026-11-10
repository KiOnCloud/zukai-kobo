# IR reference (schema version 1)

The intermediate representation (IR) is one JSON object per diagram. You write it; the CLI
validates it and emits every target from it. Never hand-write Mermaid or draw.io XML.

Validate with the CLI and fix the full error list before emitting (`<skill-dir>` is the
directory that contains the `SKILL.md` you loaded; the working directory is the user's
project, so always pass the absolute path):

```bash
node "<skill-dir>/scripts/bin/cli.mjs" validate ./diagrams/order-checkout.ir.json
```

Errors come back as JSON on stderr with a JSON-pointer `path`, a `message` and usually a
`hint`. Exit code 2 means validation errors, 1 means the file could not be read.

## Envelope (every kind)

```json
{
  "schemaVersion": 1,
  "kind": "flowchart",
  "title": "Order checkout",
  "direction": "TB",
  "meta": { "source": "clarify", "notes": ["Happy path plus the out-of-stock branch"] }
}
```

| Field | Required | Values |
|---|---|---|
| `schemaVersion` | yes | `1` |
| `kind` | yes | `flowchart`, `sequence`, `state`, `er`, `class`, `architecture`, `activity` |
| `title` | yes | 1 to 500 characters; becomes the diagram name |
| `direction` | no | `TB` (default), `BT`, `LR`, `RL`; ignored by sequence and architecture |
| `meta.source` | no | `clarify`, `scout`, `brainstorm`, `manual` |
| `meta.notes` | no | free text, for example the file paths a scout derived the diagram from |
| `meta.audience` | no | `technical` (default) or `business`; the review applies the audience items of the checklist (see `variants.md`) |
| `meta.lang` | no | BCP 47 tag (`vi`, `ja`, `en-GB`) of the label language, set on a translated variant |
| `meta.omitted` | no | what the diagram leaves out on purpose, one string each with a short reason; the review never asks for these back, and the report and Markdown bundle list them as "not shown on purpose" |

Rules that apply everywhere:

- Every element has an `id` matching `^[a-zA-Z0-9_-]{1,64}$`, unique across the whole
  document (nodes, edges, groups, everything). Ids are never shown; labels are.
- Unknown or misspelled fields are errors. Enum values are exact.
- Containers (`groups`, `boundaries`, composite `states`) reference their children by id.
  Never nest element objects. A child belongs to at most one container; containment never
  loops.
- Every `from`, `to`, child and block reference must name an existing element.
- `ref` ties an element of a main diagram to the sub-diagram that details it (scope
  `detailed`). Every kind has one element that carries it: a flowchart node, an activity
  action, a sequence message, a state, an architecture component, a class, an ER entity. The
  value is the diagram id of the part: its IR file name without `.ir.json`. The element
  shows `↳ <title of the part>` as a second label line in a bundle (the id alone in a single
  emit), and in draw.io it links to the part's page. No other element takes `ref`; never
  write a part's id into a label instead.
- Do not put credentials, connection strings or tokens in labels or notes. The emitter scans
  for them and warns; the FigJam target refuses to send them.

## flowchart

Collections: `nodes` (at least one), `edges`, `groups` (optional).

| Element | Fields |
|---|---|
| node | `id`, `label`, `shape`: `process` (default), `decision`, `terminal`, `io`, `subroutine`, `note`; `ref`: diagram id of the sub-diagram that details this step (its IR file name without `.ir.json`); drawn as a subroutine whose second line is the target's title in a bundle, or the id alone |
| edge | `id`, `from`, `to`, `kind`: `flow` (default) or `conditional`; `label` (required for `conditional`) |
| group | `id`, `label`, `children`: node or group ids |

```json
{
  "schemaVersion": 1, "kind": "flowchart", "title": "Order checkout", "direction": "TB",
  "nodes": [
    { "id": "start", "label": "Customer submits cart", "shape": "terminal" },
    { "id": "in-stock", "label": "All items in stock?", "shape": "decision" },
    { "id": "reserve", "label": "Reserve stock", "shape": "subroutine" },
    { "id": "backorder", "label": "Offer backorder" },
    { "id": "done", "label": "Order placed", "shape": "terminal" }
  ],
  "edges": [
    { "id": "e1", "from": "start", "to": "in-stock" },
    { "id": "e2", "from": "in-stock", "to": "reserve", "kind": "conditional", "label": "yes" },
    { "id": "e3", "from": "in-stock", "to": "backorder", "kind": "conditional", "label": "no" },
    { "id": "e4", "from": "reserve", "to": "done" },
    { "id": "e5", "from": "backorder", "to": "done" }
  ],
  "groups": [{ "id": "fulfilment", "label": "Fulfilment", "children": ["reserve"] }]
}
```

## sequence

Collections: `participants` (at least one), `messages` (in time order), `blocks` (optional),
`notes` (optional).

| Element | Fields |
|---|---|
| participant | `id`, `label`, `kind`: `participant` (default), `actor`, `database`, `boundary`, `control`, `entity` |
| message | `id`, `from`, `to`, `label`, `kind`: `sync` (default), `async`, `return`; `ref`: diagram id of the sub-diagram that details what this call does (its IR file name without `.ir.json`); the label gets the part's title as a second line above the arrow |
| block | `id`, `kind`: `alt`, `opt`, `loop`, `par`; `label`; `messages`: ids of every message inside the first section; `branches` (only `alt` and `par`): `[{ "label", "messages" }]` for each `else` or `and` section |
| note | `id`, `label`, `participants`: one id (`position`: `left`, `right` (default), `over`) or two ids (always over both); `after`: the message id it follows, omit to place it first |

Block rules: a section lists every message between its first and its last one, including
messages that belong to nested blocks. Sections of one block are adjacent. Two blocks are
either disjoint or one sits entirely inside one section of the other.

```json
{
  "schemaVersion": 1, "kind": "sequence", "title": "Login with password",
  "participants": [
    { "id": "user", "label": "User", "kind": "actor" },
    { "id": "web", "label": "Web app" },
    { "id": "auth", "label": "Auth service", "kind": "control" }
  ],
  "messages": [
    { "id": "m1", "from": "user", "to": "web", "label": "Submit credentials" },
    { "id": "m2", "from": "web", "to": "auth", "label": "POST /login" },
    { "id": "m3", "from": "auth", "to": "web", "label": "200 session token", "kind": "return" },
    { "id": "m4", "from": "auth", "to": "web", "label": "401 invalid credentials", "kind": "return" },
    { "id": "m5", "from": "web", "to": "auth", "label": "Audit attempt", "kind": "async" }
  ],
  "blocks": [
    { "id": "b1", "kind": "alt", "label": "password matches", "messages": ["m3"], "branches": [{ "label": "password wrong", "messages": ["m4"] }] },
    { "id": "b2", "kind": "loop", "label": "until 3 attempts", "messages": ["m1", "m2", "m3", "m4"] }
  ],
  "notes": [{ "id": "n1", "label": "Rate limited per IP", "participants": ["web"], "after": "m1" }]
}
```

## state

Collections: `states` (at least one), `transitions`.

| Element | Fields |
|---|---|
| state | `id`, `label` (required unless kind is `initial` or `final`), `kind`: `simple` (default), `initial`, `final`, `composite`; `children` (composite only): state ids; `ref` (not on `initial` or `final`): diagram id of the sub-diagram that details this state (its IR file name without `.ir.json`), shown as a second label line |
| transition | `id`, `from`, `to`, `event`, `guard`, `action` (all three optional; rendered as `event [guard] / action`) |

Put an `initial` and a `final` state inside a composite when its inner flow has a start and
an end. Nothing leaves a `final` state and nothing enters an `initial` one.

```json
{
  "schemaVersion": 1, "kind": "state", "title": "Order lifecycle",
  "states": [
    { "id": "start", "kind": "initial" },
    { "id": "placed", "label": "Placed" },
    { "id": "processing", "label": "Processing", "kind": "composite", "children": ["p-start", "picking", "packing"] },
    { "id": "p-start", "kind": "initial" },
    { "id": "picking", "label": "Picking" },
    { "id": "packing", "label": "Packing" },
    { "id": "shipped", "label": "Shipped" },
    { "id": "end", "kind": "final" }
  ],
  "transitions": [
    { "id": "t1", "from": "start", "to": "placed" },
    { "id": "t2", "from": "placed", "to": "processing", "event": "payment captured", "action": "reserve stock" },
    { "id": "t3", "from": "p-start", "to": "picking" },
    { "id": "t4", "from": "picking", "to": "packing", "event": "all items picked" },
    { "id": "t5", "from": "processing", "to": "shipped", "event": "carrier pickup", "guard": "label printed" },
    { "id": "t6", "from": "shipped", "to": "end" }
  ]
}
```

## er

Collections: `entities` (at least one), `relations`.

| Element | Fields |
|---|---|
| entity | `id`, `label`, `attributes`: `[{ "name", "type", "key": "pk" / "fk" / "none", "comment" }]`; `ref`: diagram id of the sub-diagram that details this entity's area (its IR file name without `.ir.json`), shown as a second header line |
| relation | `id`, `from`, `to`, `label`, `fromCardinality`, `toCardinality`: `one`, `zero-one`, `many`, `one-many`; `identifying` (default `true`); `fromAttribute`, `toAttribute`: attribute names the draw.io line is anchored to (default: the one FK whose name contains the other entity, else the header) |

Attribute names are unique within an entity. Types such as `decimal(10,2)` are fine.

```json
{
  "schemaVersion": 1, "kind": "er", "title": "Order data model",
  "entities": [
    { "id": "customer", "label": "Customer", "attributes": [
      { "name": "id", "type": "uuid", "key": "pk" },
      { "name": "email", "type": "string", "comment": "unique, lower-cased" }
    ] },
    { "id": "order", "label": "Order", "attributes": [
      { "name": "id", "type": "uuid", "key": "pk" },
      { "name": "customer_id", "type": "uuid", "key": "fk" },
      { "name": "total", "type": "decimal(10,2)" }
    ] }
  ],
  "relations": [
    { "id": "r1", "from": "customer", "to": "order", "label": "places", "fromCardinality": "one", "toCardinality": "many" }
  ]
}
```

## class

Collections: `classes` (at least one), `relations`.

| Element | Fields |
|---|---|
| class | `id`, `label`, `stereotype` (for example `interface`, `abstract`, `service`), `attributes`: `[{ "name", "type", "visibility" }]`, `methods`: `[{ "name", "params", "returns", "visibility" }]`; `ref`: diagram id of the sub-diagram that details this class (its IR file name without `.ir.json`), shown as a header line under the name |
| relation | `id`, `from`, `to`, `kind`: `inheritance`, `realization`, `composition`, `aggregation`, `association`, `dependency`; `label`, `fromCardinality`, `toCardinality` (free text such as `1`, `0..*`) |

`visibility` is `public`, `private`, `protected` or `package`. `from` is the source of the
arrow: the subclass for `inheritance`, the implementation for `realization`, the whole for
`composition` and `aggregation`, the dependent for `dependency` and `association`.

```json
{
  "schemaVersion": 1, "kind": "class", "title": "Order domain",
  "classes": [
    { "id": "entity", "label": "Entity", "stereotype": "abstract", "attributes": [{ "name": "Id", "type": "Guid", "visibility": "protected" }] },
    { "id": "order", "label": "Order", "methods": [{ "name": "AddLine", "params": "Product product, int quantity", "returns": "ErrorOr<OrderLine>", "visibility": "public" }] },
    { "id": "order-line", "label": "OrderLine", "attributes": [{ "name": "Quantity", "type": "int", "visibility": "public" }] },
    { "id": "repository", "label": "IOrderRepository", "stereotype": "interface" },
    { "id": "ef-repository", "label": "EfOrderRepository" }
  ],
  "relations": [
    { "id": "r1", "from": "order", "to": "entity", "kind": "inheritance" },
    { "id": "r2", "from": "order", "to": "order-line", "kind": "composition", "fromCardinality": "1", "toCardinality": "1..*" },
    { "id": "r3", "from": "ef-repository", "to": "repository", "kind": "realization" },
    { "id": "r4", "from": "ef-repository", "to": "order", "kind": "dependency", "label": "persists" }
  ]
}
```

## architecture

Collections: `components` (at least one), `boundaries` (optional), `connections`.

| Element | Fields |
|---|---|
| component | `id`, `label`, `kind`: `service` (default), `database`, `queue`, `cache`, `client`, `external`; `ref`: diagram id of the sub-diagram that details this component (its IR file name without `.ir.json`), shown as a second label line |
| boundary | `id`, `label`, `children`: component or boundary ids (a deployment unit, network or team boundary) |
| connection | `id`, `from`, `to`, `label` (protocol or purpose), `bidirectional` (default `false`) |

```json
{
  "schemaVersion": 1, "kind": "architecture", "title": "Order platform", "direction": "LR",
  "components": [
    { "id": "browser", "label": "Customer browser", "kind": "client" },
    { "id": "api", "label": "Order API (.NET)" },
    { "id": "db", "label": "PostgreSQL", "kind": "database" },
    { "id": "queue", "label": "SQS orders", "kind": "queue" },
    { "id": "psp", "label": "Payment provider", "kind": "external" }
  ],
  "boundaries": [
    { "id": "aws", "label": "AWS account", "children": ["vpc", "queue"] },
    { "id": "vpc", "label": "VPC", "children": ["api", "db"] }
  ],
  "connections": [
    { "id": "c1", "from": "browser", "to": "api", "label": "HTTPS" },
    { "id": "c2", "from": "api", "to": "db", "label": "SQL" },
    { "id": "c3", "from": "api", "to": "queue", "label": "publish order placed" },
    { "id": "c4", "from": "api", "to": "psp", "label": "capture payment" }
  ]
}
```

## activity

Collections: `lanes` (at least one), `actions` (at least one), `controls` (optional), `flows`.

| Element | Fields |
|---|---|
| lane | `id`, `label` (the actor, team or system that performs the actions) |
| action | `id`, `label`, `lane` (required: every action belongs to exactly one lane); `ref`: diagram id of the sub-diagram that details this step (its IR file name without `.ir.json`); drawn as a subroutine whose second line is the target's title in a bundle, or the id alone |
| control | `id`, `kind`: `initial`, `final`, `decision`, `merge`, `fork`, `join`; `label` (decisions); `lane` (optional) |
| flow | `id`, `from`, `to` (action or control ids), `guard` (condition text on flows leaving a decision) |

A `fork` splits one flow into parallel branches; the matching `join` waits for all of them. A
`decision` picks one branch by its guards; a `merge` brings alternatives back together. Use a
`merge` only where two or more flows actually rejoin: a merge with one incoming flow, or a
decision with one outgoing flow, is reported as a warning and should be removed. Nothing
leaves a `final` node and nothing enters an `initial` one.

```json
{
  "schemaVersion": 1, "kind": "activity", "title": "Return request",
  "lanes": [{ "id": "customer", "label": "Customer" }, { "id": "support", "label": "Support" }],
  "actions": [
    { "id": "request", "label": "Request return", "lane": "customer" },
    { "id": "review", "label": "Review request", "lane": "support" },
    { "id": "approve", "label": "Approve and send label", "lane": "support" },
    { "id": "ship", "label": "Ship item back", "lane": "customer" }
  ],
  "controls": [
    { "id": "start", "kind": "initial", "lane": "customer" },
    { "id": "eligible", "kind": "decision", "label": "Eligible?", "lane": "support" },
    { "id": "done", "kind": "final", "lane": "customer" }
  ],
  "flows": [
    { "id": "f1", "from": "start", "to": "request" },
    { "id": "f2", "from": "request", "to": "review" },
    { "id": "f3", "from": "review", "to": "eligible" },
    { "id": "f4", "from": "eligible", "to": "approve", "guard": "yes" },
    { "id": "f5", "from": "eligible", "to": "done", "guard": "no" },
    { "id": "f6", "from": "approve", "to": "ship" },
    { "id": "f7", "from": "ship", "to": "done" }
  ]
}
```

## What each target cannot show

The feature matrix (`docs/feature-matrix.md` in the repository) lists, per kind and target,
what is `supported`, `degraded` (emitted with a warning that names the element and what was
lost) or `unsupported` (the emit fails for that target). Print every warning to the user.
