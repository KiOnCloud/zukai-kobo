# From facts to IR

How each shape of a facts file becomes an element of the IR, per kind. The facts describe
what the source drew; the IR says what it means. When a shape fits no row of the kind being
written, it belongs to another kind (a part) or to `meta.omitted`, never to a look-alike
element.

## Facts in short

`extract` writes one page per diagram of the source:

| Field | Meaning |
|---|---|
| `nodes[].shape` | `box`, `process`, `rounded`, `decision`, `terminal`, `ellipse`, `initial`, `final`, `io`, `subroutine`, `document`, `note`, `store`, `queue`, `cloud`, `client`, `actor`, `lifeline`, `frame`, `lane`, `container`, `group`, `table`, `icon`, `bar`, `text` |
| `nodes[].texts` | further lines of one node: the rows of a table or class box, a text laid over a shape, the branch conditions of a sequence block |
| `nodes[].parent` | the frame, lane, group or composite the node lies in |
| `nodes[].icon`, `group` | `aws:<name>` / `gcp:<name>` when the stencil is in Zukai's catalog (copy as is); `drawio:<stencil>` when it is not |
| `nodes[].link` | the page this node opens (a draw.io page link): a part |
| `nodes[].detail` | a finer kind: a participant's kind, a class's stereotype, `hexagon` |
| `edges[].from`, `to` | node ids; `null` when an end touches nothing (named in the warnings) |
| `edges[].fromInferred`, `toInferred` | the end was not connected in the source and was taken from the shape it stops at: keep the edge, list it in the report |
| `edges[].fromPart`, `toPart` | the row of a table the end is attached to (an ER foreign key) |
| `edges[].startArrow`, `endArrow`, `dashed` | line ends in the source tool's words: `classic`, `block`, `open`, `block-open` (hollow triangle), `diamond`, `diamond-open`, `ERmandOne`, `ERzeroToMany` ..., `none` |
| `edges[].startLabel`, `endLabel` | texts at the ends of a line (multiplicities, roles) |
| `edges[].condition` | PlantUML only, on an «extend» line: the text of a note written on that line or beside the use case that extends, offered as the condition of the extend (the usecase section says when to take it). The note is a node of the page as well |
| `edges[].y` | vertical position, or the order of a Mermaid message: the order of messages |

Facts read from Mermaid or PlantUML text have no `box`: the order of the text is the order, and a frame's or
a note's `detail` says where it stands (`"alt e3..e4 | else e5"`: the messages each section
spans; `"over W,P; after e3"`: the participants and the message a note follows).

A `text` node that stands over no shape is a title, a legend or a note: use it as the
diagram `title` when it is one, as a note element when the kind has one, or list it in
`meta.omitted`.

## sequence

| Facts | IR |
|---|---|
| `lifeline`, `actor` | `participants[]`, left to right by `box.x`; `detail` or a `«kind»` line gives `kind` (`actor`, `database`, `boundary`, `control`, `entity`), else `participant`. The `«kind»` line is not part of the label |
| edge between two participants | `messages[]` in `y` order; a `dashed` line is `return` (Mermaid's `-->>` and `--)` included), a solid line with an `open` end `async`, any other `sync` |
| `frame` | `blocks[]`: the operator (`loop`, `alt`, `opt`, `par`) is the block's `kind`, the rest of its label its condition; each `texts` line that starts with `else` or `and` is a branch |
| `note` | `notes[]`: `over` the participants whose lifeline (the line through the middle of the head, not the head's width) its box crosses; with none crossed, `right` of the nearest lifeline on its left (at equal distance too), or `left` of the first lifeline when the note stands left of every lifeline |

A board read from FigJam draws a sequence diagram with boxes and connectors: the extractor
already turns each pair of participant boxes and their line into one `lifeline`, and the
overlay's frames into `frame` nodes. A message to itself comes as two or three unlabelled
edges from a lifeline to the same lifeline (joined by position) with a free `text` beside
them: that text is the label of one self-message.

On a board drawn by `emit --native`, a frame's `detail` gives where each further branch
starts (`"else password wrong" from y 469`): the messages whose `y` is below it belong to that
branch. A message to itself is one edge from a lifeline to the same lifeline with its label.

A `critical`, `break` or `rect` frame has no block kind: keep its messages, list the frame in
`meta.omitted`.

## flowchart

| Facts | IR `nodes[].shape` |
|---|---|
| `box`, `process`, `rounded` | `process` |
| `decision` | `decision`; edge labels leaving it become `conditional` edges with that label |
| `terminal`, `initial`, `final`, and an `ellipse` where the flow starts or ends | `terminal` |
| `io`, `document` | `io` |
| `subroutine` | `subroutine`, with `ref` when its sub-flow is drawn on another page or becomes a part |
| `note` | `note` |
| `container` | `groups[]` with the nodes inside as `children` |
| `store` | a flowchart has no store: a `process` that names the store ("Save order to Orders DB") only when the source labels it so; otherwise the stores belong to an `architecture` or `er` part |

## activity

| Facts | IR |
|---|---|
| `lane` | `lanes[]`, in reading order |
| `box`, `rounded`, `subroutine`, `io` in a lane | `actions[]` with that `lane` |
| `decision` | `controls[]` `decision` (or `merge` when several lines enter and one leaves) |
| `bar` | `controls[]` `fork` when one line enters, `join` when one leaves |
| `initial`, `final` | `controls[]` `initial`, `final` |
| edges | `flows[]`; an edge that crosses lanes is a hand-off, as drawn |

A `container` that is not a lane (a pool around the lanes) gives the diagram title when it
is the only one; otherwise list it in `meta.omitted`.

## state

| Facts | IR |
|---|---|
| `rounded`, `box`, `ellipse` with a name | `states[]` `simple` |
| `container` holding states | `composite` with its `children` |
| `initial`, `final` | `initial`, `final`, without a label. One that carries a name in the source (an end circle labelled "Cancelled") is a status: an ordinary state with that label, with a transition to an unlabelled `final` state (or from an unlabelled `initial` one), recorded as `added: final state after "Cancelled" (the source wrote the name on its end circle)` |
| edge label `event [guard] / action` | `event`, `guard`, `action` of the transition |
| `decision` | a state machine has no choice node in Zukai: one transition per way out, each with the guard written on its line |

## er

| Facts | IR |
|---|---|
| `table` | `entities[]`; its label is the entity name, each `texts` row an attribute: `PK`/`FK`/`UK` words set `key` (`pk`, `fk`, else `none`), the rest is name and type as written, a quoted or trailing remark the `comment` |
| edge between tables | `relations[]`; `fromPart` / `toPart` name the attributes (`fromAttribute`, `toAttribute`); `dashed` means not identifying |
| crow's-foot ends | `ERmandOne`, `ERone` → `one`; `ERzeroToOne` → `zero-one`; `ERoneToMany` → `one-many`; `ERzeroToMany`, `ERmany` → `many` |
| end texts `1`, `0..1`, `0..*`, `1..*` | the same four values; the texts themselves need no `meta.omitted` entry |
| ends read from a board drawn as shapes | read from the drawing (a circle is zero, a crow's foot many, a bar one); an arrowhead given as `classic` is one whose fill the read could not see (the facts warn about it): check that end against the picture |

## class

| Facts | IR |
|---|---|
| `table` with members | `classes[]`; `«interface»`, `«abstract»`, `«enum»` lines are the `stereotype`; each `texts` row is an attribute (no parentheses) or a method (parentheses): `+ - # ~` are `public`, `private`, `protected`, `package`; `name(params): returns` |
| `block-open` end | `inheritance` (a dashed line: `realization`) |
| `diamond` / `diamond-open` end | `composition` / `aggregation` |
| `open` end, dashed | `dependency`; a plain line with an `open` or a filled `block` end, or none, `association` |
| end texts | the multiplicities of that end |

## architecture

| Facts | IR |
|---|---|
| `icon` with `aws:` / `gcp:` | a component with that `icon` (copy it; never rename it from memory) and the `kind` its service is (`database` for a database or storage icon, `queue`, `cache`, else `service`) |
| `icon` with `aws:` / `gcp:` read from a board | the same: a board Zukai drew from version 2.2.0 on names each picture's stencil in its group (`Order API [aws:lambda]`) |
| `icon` with `drawio:` | a component of the kind its label says (`client` for a browser or an app, else `service`); `drawio:unknown` is a picture on a board whose stencil is not named; `drawio:image` on a source that is a GCP diagram is one of draw.io's newer GCP icons, which are pictures without a stencil name. When the diagram is a GCP one (the draw skill's "GCP icons" applies) and the label names the service ("Cloud Run", "Pub/Sub orders"), take its icon from `gcp-icons.md` by that name and record it the same way as for AWS below. When the diagram is an AWS one (the draw skill's "AWS icons" applies) and the label names the service ("SQS orders", "Aurora PostgreSQL"), take its icon from `aws-icons.md` by that name and record `added: icon aws:<name> from the label`; a label that names no service ("Fulfilment worker") keeps no icon, and the report lists it |
| `box`, `rounded`, `process` with a label and no icon | a component of `kind` `service` (the default), without an icon unless the next row gives it one |
| `store` | `database`; `queue`, `detail: hexagon` → `queue` |
| `client`, `actor` | `client` |
| `cloud`, a component outside every boundary that the system calls | `external` |
| `group` | a boundary with that `group` (`aws:vpc`, `gcp:vpc_network` ...) and its members. A GCP frame has no stencil: the extractor names it by the fill colour draw.io's GCP library gives that kind of frame, so check the name against the title (a frame titled "Region" that reads `gcp:zone` was recoloured by hand: take the group the title names from `gcp-icons.md` and record `changed:`) |
| `container` | a boundary |
| edge | `connections[]`, `from` and `to` as the source draws the arrow; arrows at both ends set `bidirectional`. An edge text read as `startLabel` or `endLabel` of a connection that has no `label` is its label: a connection has one text, and a file Zukai wrote may place it near an end of a long line |

Three cases where the source and the rules of the draw skill pull apart, and what wins:

- **The direction of an edge is the source's.** `ir-reference.md` asks an author to write a
  connection the way the request or the message moves (producer to queue, queue to
  consumer). A recook does not apply that: an edge the source draws from the worker to the
  queue, labelled `poll`, stays worker to queue with that label, because turning it round
  or rewording it would change what the source says ("Content stays"). The report lists
  each connection that runs against that convention, with the offer of a `revise`.
- **An icon needs a name.** The draw skill wants a figure on every component of a cloud
  diagram; a recook sets one only on evidence. A plain box of the source (PlantUML's
  `component`, `node` or `database`, a rectangle of a hand-drawn file) gets a cloud icon
  when its label or its stereotype names the service ("SQS orders", `«Lambda»`,
  "Cloud Run"), recorded as `added: icon <value> from the label`. A box that names no
  service ("Fulfilment worker") keeps the generic shape of its kind, and the report lists
  it; a diagram where no box names a service is drawn without icons and without group
  frames. The same holds for a general resource or a product logo on a system outside the
  cloud: only when the label names the product.
- **A frame of the source stays.** The icon rules of `aws-icons.md` and `gcp-icons.md`
  call some things supporting resources and put some services outside the network (an ECS
  cluster is not a component, a queue stands outside a subnet). They say what a new
  diagram draws; they never delete what a source drew. A frame the source has is kept as
  a boundary with its label and its members as the source has them: with its `group` when
  the facts or its label name the construct, as a plain boundary otherwise ("ECS cluster"),
  and a component the source draws inside a subnet stays inside it. The report lists each
  such frame and each such placement as "kept from the source, not what the icon rules
  would draw".

The level of detail of the draw skill holds: several tables of one database are one
component, and an edge label that is an endpoint path, a job or a field moves into a part
(`sequence` for the calls, `er` for the tables), with the connection label reduced to the
protocol or purpose.

## usecase

| Facts | IR |
|---|---|
| `actor` (a stick figure) | `actors[]` with `kind` `person`. A figure whose label names a system, a service or a job ("Core banking", "Nightly run") is `kind` `system`: record `changed: actor "<label>" drawn as a figure is an outside system` in the report |
| `box` or `rounded` outside the frame, joined to ovals by plain lines, or one whose label starts with `«system»`, `«actor»`, `<<system>>` | `actors[]` with `kind` `system`; the stereotype line is not part of the label |
| `ellipse` with a label | `useCases[]` |
| `container`, `lane` or `group` around the ovals | `boundaries[]` with the ovals inside as `children`. A frame that also holds a figure keeps the use cases only: actors stand outside the system, and the report says the figure was moved out |
| plain line between a figure (or system box) and an oval, whatever its arrowhead | `association`; an arrowhead on it says who starts the exchange and is not kept |
| `dashed` line marked `«include»`, `<<include>>`, `<<includes>>`, `<<uses>>` | `include`, `from` the oval the line starts at |
| `dashed` line marked `«extend»`, `<<extend>>`, `<<extends>>` | `extend`, `from` the oval the line starts at; a further line of the label, a `[condition]` or an "extension point" text is the `condition`. So is the edge's `condition` in the facts, when it has one: the text of a note the source wrote on that line or beside the use case that extends (see below) |
| `block-open` end between two figures or two ovals | `generalization`, `from` the end without the triangle |
| `dashed` line between ovals with no stereotype | ask nothing: an `include` when the source's legend or its other lines say so, else list it in `meta.omitted` with the reason "dashed line without a stereotype" |
| a `note` or free `text` | a use case diagram has no note element: the title when it is one, the `condition` of an extend when the row above says so, else `meta.omitted` |

Which actors are `primary` and which `supporting` follows from the side they stand on in the
source: figures and systems on the side the reader starts from (left, or top) are primary,
those on the far side supporting. Set `role` only where that differs from the default (a
person is primary, a system supporting).

The level of detail of the draw skill holds (`ir-reference.md`, usecase): the recook keeps
the source's use cases as they are worded, also where one reads as a step or a screen, and
the review lists such a label as a `polish` finding with the offer of a `revise`. Ovals
joined in a row by arrows that are not stereotyped are a flow, not use cases: the page is a
`flowchart` or `activity` diagram, or mixes kinds (the best kind as the main diagram, the
flow as a part linked with `ref` from the use case it details).

A Mermaid flowchart that stands for a use case diagram (boxes marked «actor» or «system»,
stadium nodes, dotted links marked «include» or «extend»; Zukai's own Mermaid form is one)
is read with the kind hint `usecase`: the `terminal` nodes are the use cases, the marked
boxes the actors, a subgraph the boundary, a link labelled «generalization» a
generalization.

## PlantUML sources

PlantUML text has no header that names its type: the reader tells it from the statements and
gives the kind hints. Its facts use the shapes and line ends of the tables above, so those
tables hold; this section says what `detail`, `texts` and the page fields add.

| Facts | Meaning |
|---|---|
| page `direction` | `LR` or `TB`, from `left to right direction`: the IR's `direction` |
| page `autonumber` | the source numbers its messages itself: the numbers are not content and are not written into labels |
| page `unsupported` | `{ type, reason }`: a diagram type that is not read; no diagram is made from it |
| `detail` of a node | the keyword it was declared with (`component`, `node`, `artifact`, `interface`, `abstract`, `enum`, `usecase`, `package`, `rectangle`, `database` on a container ...), or where a note, divider or delay stands (`right of OrderService; after e3`, `divider; after e10`) |
| a `texts` line `«name»` | a stereotype written `<<name>>` |
| `text` node with `detail` `legend`, `header`, `footer`, `caption` | a free text of the page: `meta.omitted`, unless it is the title |
| edge `startLabel`, `endLabel` | the quoted texts at the ends of a relation (`"1" *-- "many"`) |
| edge `fromPart`, `toPart` | the member a relation is attached to (`Order::customerId`) |

Sequence (`lifeline` nodes):

- `detail` is the participant's keyword: `actor`, `boundary`, `control`, `entity`, `database`
  are the IR `kind` of the same name; `participant`, `collections` and `queue` are
  `participant`. A `«stereotype»` line of a participant has no place in a sequence diagram:
  `meta.omitted`.
- A message is written from its sender, whichever way the arrow was typed (`A <- B` is from B).
  A `dashed` message (`-->`, and every `return`) is `return`; a solid one with an `open` end
  (`->>`, `-\`) is `async`; any other is `sync`. A `cross` end (`->x`, a lost message) is kept
  as the kind its line gives, and the report says the source drew it as lost. A message with
  `from` or `to` `null` enters or leaves the diagram (`[->`, `->]`): it has no second
  participant and cannot be a message; list it in `meta.omitted` and in the report.
- A `frame` is a block as in the table above; its `detail` names the sections and the
  messages each spans (`alt e5..e8 | else e9`), its `texts` are the conditions of the further
  sections in order. A `group` frame has no block kind, like `critical` and `break`: keep its
  messages and list its title in `meta.omitted`. A `frame` whose `detail` starts with `ref
  over` points to another diagram: when that diagram is a page of the same source and is
  recooked too, the message before it gets the `ref`; otherwise it becomes a note over those
  participants.
- A `text` node with `detail` `divider` (`== Phase ==`) or `delay` (`... later ...`) becomes a
  note over the first and the last participant, placed with `after` as its `detail` says; the
  report lists it as a divider drawn as a note.
- A note, divider or delay inside a block has that frame as its `parent`. One without a
  `parent` whose `detail` says `after eN`, where `eN` is the last message of a block, stands
  below that block: its `after` is the block's id, not the message's.
- A `group` node is a `box` around participants: a sequence diagram draws none, so its title
  goes to `meta.omitted`.

Class and ER (`table` nodes):

- `detail` `interface`, `abstract`, `enum`, `annotation`, `struct` ... is the `stereotype`
  when the class has no `«stereotype»` line of its own; a class takes one stereotype, a
  second one goes to `meta.omitted`. Rows are members as in the class table; a row that is
  the title of a section (`-- private --`) goes to `meta.omitted`.
- A `table` whose `detail` starts with `entity` is an ER entity: `key: a, b` names the rows
  above the first rule of its body, which are its primary key (`pk`); a row with `«FK»` is
  `fk`; `mandatory:` lists the rows marked `*` (not null), which the IR does not record: the
  mark is no text, so `cover` does not ask for it. Say in the report, in one line per
  entity, which attributes the source marked as mandatory and that the diagram does not
  show it. A remark such as `«generated»` is the attribute's `comment`.
- Line ends: `block-open` is inheritance (dashed: realization) and the class at the other end
  is the subclass, so that end is `from`; `diamond` is composition and `diamond-open`
  aggregation, with the whole at the diamond; a dashed line with an `open` end is a
  dependency; any other line is an association. `ER...` ends are the crow's-foot values of the
  ER table. `plus` (nesting), `box`, `cross`, `circle` and `socket` ends have no relation
  kind: an association, with the end named in the report.
- A `container` with `detail` `package` or `namespace` is not drawn in a class or ER diagram:
  it gives the title when it holds every class, otherwise `meta.omitted`. A `note` goes to
  `meta.omitted` (these kinds have no note), quoted with what it stands beside.

State:

- `rounded` and `container` are states; a `texts` line of a state is its description
  (`Review : Second agent checks`), which a Zukai state does not show: `meta.omitted`.
- A `decision` (`<<choice>>`) follows the state table: one transition per way out, from the
  state before the choice, with the choice's guard. A `bar` (`<<fork>>`, `<<join>>`) and an
  `ellipse` with `detail` `history` have no element: join the transitions through it where
  one line enters or one leaves, and name it in the report; otherwise the page is better
  drawn as an `activity` diagram, which is asked, not decided.
- A `container` with `detail` `concurrent regions` held regions side by side; the IR has one
  composite: keep the states, and say in the report that the regions are not separated.

Activity (the new syntax; the reader rebuilds the flow as nodes and edges):

- `lane` → `lanes[]`; `rounded`, `io`, `subroutine` → `actions[]`; `decision`, `bar` (`detail`
  `fork` / `join`, `split` / `split end`), `initial`, `final` → `controls[]`; edges →
  `flows[]`, an edge label (`then (yes)`, `else (no)`, `-> text;`) being the `guard`.
- A diagram without swimlanes is hinted as a `flowchart` first; when the user chooses
  `activity`, give it one lane named after who performs the flow, as an `added:` note.
- Where two or more edges enter a `bar` or a step after an `if`, the source drew a merge:
  add a `merge` control before a fork, recorded as `added:`; a step may take several flows.
- A `container` (`partition`, `group`) is not a lane: `meta.omitted`, or the title when it
  holds the whole flow. A `note` goes to `meta.omitted`. An `ellipse` with `detail`
  `connector` joins two places of the flow: draw the flow straight through it.

Component and deployment (architecture-shaped facts):

- `box` with `detail` `component`, `node`, `artifact`, `agent`, `stack`, `card`, `file`,
  `folder`, `frame`, `rectangle` → a `service` component; `store` → `database`; `queue`, or
  `detail` `hexagon` → `queue`; `cloud` → `external`; `actor` → `client`.
- `container` (a `node`, `cloud`, `frame`, `folder`, `package`, `rectangle`, or a `database`
  drawn around other elements) → a boundary. A `database` container that holds only tables is
  one `database` component, and its tables are an `er` part linked with `ref`.
- An `ellipse` with `detail` `interface` (`() "REST"`, `interface`) is the provided interface
  of the component it is joined to by a plain line: a connection that ends at it ends at that
  component, and the interface name goes to `meta.omitted` (merged), or becomes the
  connection's label when the connection has none.
- A `«stereotype»` line that names the technology (`«Next.js»`, `«PostgreSQL 15»`) joins the
  component label in parentheses: `Storefront (Next.js)`.
- A `dashed` connection is asynchronous or a dependency; the IR draws one line style, so say
  in the report which connections the source drew dashed.

Use case (the `usecase` section above holds): `ellipse` with `detail` `usecase` is a use
case, `actor` an actor (`detail` `business` for `actor/` is still a person), a `container`
with `detail` `rectangle` or `package` the system boundary with the use cases inside it. An
edge between an actor and a use case is an association; a dashed edge whose label is
`«include»` or `«extend»` is that relation, from the edge's `from` to its `to` as drawn; a
`block-open` end is a generalization, the element at the other end being the special one.

A note becomes the `condition` of an `extend` in exactly one case: the extractor offers it,
as `condition` on the edge in the facts. It does that for a note written on the line
(`note on link`) of an «extend», and for a note attached to the use case that extends
(`note right of UC7`) when that use case has one «extend» line. PlantUML has no other
place for the condition, so this is where authors put it ("Only for first-time patients").
Take it as the condition when it reads as one: a circumstance under which the extension
happens. When it is a remark about something else ("added in release 4"), leave the
condition out and say so in the report. Either way the note's text is still a text of the
facts: used as the condition it is found there by `cover`; otherwise it goes to
`meta.omitted` like any note. A note beside the extended use case, beside an actor, or
beside a use case with several «extend» lines is never offered and never guessed: it goes
to `meta.omitted`, and when the delivered extend has no condition although such a note
may state one, name the note in the report so the user can say.

## A sequence part made from another kind

The call order drawn into an architecture diagram (numbered labels, endpoints, statements on
its connections) becomes a `sequence` part. Its participants are the components those
connections join, left to right in the order a request reaches them; its messages are those
connections, ordered by the path of the request from the client along the edges, then by the
step numbers the labels carry. `y` is not an order here: on an architecture page it is only
where a line was drawn. A connection that fits no place in that order (a side read, a call to
an outside system with no step) stays in the architecture diagram only, and the report says
so. Add no reply the source does not draw. When the source draws the client, the first message
comes from it; an unnumbered call goes where the path of the request reaches its caller,
before the numbered steps that follow from there. A dashed connection of an architecture
diagram means asynchronous (as its legend usually says): it becomes an `async` message,
never a `return`.

## Mixed pages

An edge between an element of the main diagram and a shape moved into a part (a step that
writes to a table drawn beside it) is shown by the `ref` the element gets; its label goes
into the part when the part's kind has a place for it, otherwise into `meta.omitted` with
the reason "shown by the link to part <slug>".


Write the main diagram from the shapes of the page's best kind. Shapes of another kind
become a part of that kind, and the element of the main diagram they detail gets its `ref`
(a database component with `ref` to the `er` part of its tables). A shape that belongs to no
kind written goes into `meta.omitted` with its text and the reason.
