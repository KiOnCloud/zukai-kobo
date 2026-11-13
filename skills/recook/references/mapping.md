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
| `edges[].y` | vertical position, or the order of a Mermaid message: the order of messages |

A `text` node that stands over no shape is a title, a legend or a note: use it as the
diagram `title` when it is one, as a note element when the kind has one, or list it in
`meta.omitted`.

## sequence

| Facts | IR |
|---|---|
| `lifeline`, `actor` | `participants[]`, left to right by `box.x`; `detail` or a `«kind»` line gives `kind` (`actor`, `database`, `boundary`, `control`, `entity`), else `participant`. The `«kind»` line is not part of the label |
| edge between two participants | `messages[]` in `y` order; a `dashed` line is `return` (Mermaid's `-->>` and `--)` included), a solid line with an `open` end `async`, any other `sync` |
| `frame` | `blocks[]`: the operator (`loop`, `alt`, `opt`, `par`) is the block's `kind`, the rest of its label its condition; each `texts` line that starts with `else` or `and` is a branch |
| `note` | `notes[]` beside or over the participants its box overlaps |

A board read from FigJam draws a sequence diagram with boxes and connectors: the extractor
already turns each pair of participant boxes and their line into one `lifeline`, and the
overlay's frames into `frame` nodes. A message to itself comes as two or three unlabelled
edges from a lifeline to the same lifeline (joined by position) with a free `text` beside
them: that text is the label of one self-message.

A `critical`, `break` or `rect` frame has no block kind: keep its messages, list the frame in
`meta.omitted`.

## flowchart

| Facts | IR `nodes[].shape` |
|---|---|
| `box`, `process`, `rounded` | `process` |
| `decision` | `decision`; edge labels leaving it become `conditional` edges with that label |
| `terminal`, `ellipse`, `initial`, `final` with a start or end word | `terminal` |
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
| `initial`, `final` | `initial`, `final` |
| edge label `event [guard] / action` | `event`, `guard`, `action` of the transition |
| `decision` | a state machine has no choice node in Zukai: one transition per way out, each with the guard written on its line |

## er

| Facts | IR |
|---|---|
| `table` | `entities[]`; its label is the entity name, each `texts` row an attribute: `PK`/`FK`/`UK` words set `key` (`pk`, `fk`, else `none`), the rest is name and type as written, a quoted or trailing remark the `comment` |
| edge between tables | `relations[]`; `fromPart` / `toPart` name the attributes (`fromAttribute`, `toAttribute`); `dashed` means not identifying |
| crow's-foot ends | `ERmandOne`, `ERone` → `one`; `ERzeroToOne` → `zero-one`; `ERoneToMany` → `one-many`; `ERzeroToMany`, `ERmany` → `many` |
| end texts `1`, `0..1`, `0..*`, `1..*` | the same four values; the texts themselves need no `meta.omitted` entry |

## class

| Facts | IR |
|---|---|
| `table` with members | `classes[]`; `«interface»`, `«abstract»`, `«enum»` lines are the `stereotype`; each `texts` row is an attribute (no parentheses) or a method (parentheses): `+ - # ~` are `public`, `private`, `protected`, `package`; `name(params): returns` |
| `block-open` end | `inheritance` (a dashed line: `realization`) |
| `diamond` / `diamond-open` end | `composition` / `aggregation` |
| `open` end, dashed | `dependency`; a plain line `association` |
| end texts | the multiplicities of that end |

## architecture

| Facts | IR |
|---|---|
| `icon` with `aws:` / `gcp:` | a component with that `icon` (copy it; never rename it from memory) and the `kind` its service is (`database` for a database or storage icon, `queue`, `cache`, else `service`) |
| `icon` with `drawio:` | a component without `icon`, of the kind its label says (`client` for a browser or an app, else `service`); list the lost stencil in the report; `drawio:unknown` is a picture on a board whose stencil is not named |
| `store` | `database`; `queue`, `detail: hexagon` → `queue` |
| `client`, `actor` | `client` |
| `cloud`, a component outside every boundary that the system calls | `external` |
| `group` | a boundary with that `group` (`aws:vpc` ...) and its members |
| `container` | a boundary |
| edge | `connections[]`; arrows at both ends set `bidirectional` |

The level of detail of the draw skill holds: several tables of one database are one
component, and an edge label that is an endpoint path, a job or a field moves into a part
(`sequence` for the calls, `er` for the tables), with the connection label reduced to the
protocol or purpose.

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

Write the main diagram from the shapes of the page's best kind. Shapes of another kind
become a part of that kind, and the element of the main diagram they detail gets its `ref`
(a database component with `ref` to the `er` part of its tables). A shape that belongs to no
kind written goes into `meta.omitted` with its text and the reason.
