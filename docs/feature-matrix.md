# Feature matrix

Generated from `skills/draw/scripts/src/feature-matrix.json` by `npm run docs:matrix`
in `skills/draw/scripts`. A test fails when this page drifts from the JSON.

For each diagram kind, target and feature the value is one of:

- `supported`: emitted natively.
- `degraded`: emitted with an explicit warning that names the element and what was lost.
- `unsupported`: validation fails for that target with the full error list.

## flowchart

| Feature | mermaid | drawio | figjam |
|---|---|---|---|
| kind | supported | supported | supported |
| `node.shape.process` | supported | supported | supported |
| `node.shape.decision` | supported | supported | supported |
| `node.shape.terminal` | supported | supported | supported |
| `node.shape.io` | supported | supported | supported |
| `node.shape.subroutine` | supported | supported | supported |
| `node.shape.note` | supported | supported | supported |
| `edge.kind.flow` | supported | supported | supported |
| `edge.kind.conditional` | supported | supported | supported |
| `group` | supported | supported | supported |
| `group.nested` | supported | supported | supported |
| `node.ref` | supported | supported | supported |

## sequence

| Feature | mermaid | drawio | figjam |
|---|---|---|---|
| kind | supported | supported | supported |
| `participant.kind.actor` | supported | supported | degraded (generate_diagram draws every participant as the same box; the overlay script (emit --overlay) adds the figure above the actor) |
| `participant.kind.participant` | supported | supported | supported |
| `participant.kind.database` | supported | supported | degraded (generate_diagram draws every participant as the same box; the overlay script (emit --overlay) adds the kind as a stereotype line, as the draw.io file shows it) |
| `participant.kind.boundary` | supported | supported | degraded (generate_diagram draws every participant as the same box; the overlay script (emit --overlay) adds the kind as a stereotype line, as the draw.io file shows it) |
| `participant.kind.control` | supported | supported | degraded (generate_diagram draws every participant as the same box; the overlay script (emit --overlay) adds the kind as a stereotype line, as the draw.io file shows it) |
| `participant.kind.entity` | supported | supported | degraded (generate_diagram draws every participant as the same box; the overlay script (emit --overlay) adds the kind as a stereotype line, as the draw.io file shows it) |
| `message.kind.sync` | supported | supported | supported |
| `message.kind.async` | supported | supported | supported |
| `message.kind.return` | supported | supported | supported |
| `message.self` | supported | supported | degraded (generate_diagram leaves the row of a message to the same participant empty and a stray arrow beside the diagram; the overlay script (emit --overlay) draws the message) |
| `block.kind.alt` | supported | supported | degraded (generate_diagram keeps the messages and drops the frame; the overlay script (emit --overlay) draws the frame and its conditions on the board) |
| `block.kind.opt` | supported | supported | degraded (generate_diagram keeps the messages and drops the frame; the overlay script (emit --overlay) draws the frame and its conditions on the board) |
| `block.kind.loop` | supported | supported | degraded (generate_diagram keeps the messages and drops the frame; the overlay script (emit --overlay) draws the frame and its conditions on the board) |
| `block.kind.par` | supported | supported | degraded (generate_diagram keeps the messages and drops the frame; the overlay script (emit --overlay) draws the frame and its conditions on the board) |
| `note` | supported | supported | degraded (generate_diagram drops Note statements; the note keeps a row and the overlay script (emit --overlay) draws it there) |
| `message.ref` | supported | supported | supported |

## state

| Feature | mermaid | drawio | figjam |
|---|---|---|---|
| kind | supported | supported | supported |
| `state.kind.initial` | supported | supported | supported |
| `state.kind.final` | supported | supported | supported |
| `state.kind.simple` | supported | supported | supported |
| `state.kind.composite` | supported | supported | supported |
| `composite.depth.gt2` | degraded (composite states nested deeper than two levels are flattened into their level-2 ancestor) | supported | degraded (composite states nested deeper than two levels are flattened into their level-2 ancestor) |
| `transition.guard` | supported | supported | supported |
| `transition.action` | supported | supported | supported |
| `state.ref` | supported | supported | supported |

## er

| Feature | mermaid | drawio | figjam |
|---|---|---|---|
| kind | supported | supported | supported |
| `attribute.key.pk` | supported | supported | supported |
| `attribute.key.fk` | supported | supported | supported |
| `attribute.comment` | supported | supported | supported |
| `relation.cardinality.one` | supported | supported | supported |
| `relation.cardinality.zero-one` | supported | supported | supported |
| `relation.cardinality.many` | supported | supported | supported |
| `relation.cardinality.one-many` | supported | supported | supported |
| `relation.nonIdentifying` | supported | supported | supported |
| `entity.ref` | supported | supported | supported |

## class

| Feature | mermaid | drawio | figjam |
|---|---|---|---|
| kind | supported | supported | unsupported (FigJam generate_diagram does not accept classDiagram; use --to mermaid or --to drawio) |
| `stereotype` | supported | supported | supported |
| `member.visibility` | supported | supported | supported |
| `method.params` | supported | supported | supported |
| `relation.kind.inheritance` | supported | supported | supported |
| `relation.kind.realization` | supported | supported | supported |
| `relation.kind.composition` | supported | supported | supported |
| `relation.kind.aggregation` | supported | supported | supported |
| `relation.kind.association` | supported | supported | supported |
| `relation.kind.dependency` | supported | supported | supported |
| `relation.cardinality` | supported | supported | supported |
| `class.ref` | supported | supported | supported |

## architecture

| Feature | mermaid | drawio | figjam |
|---|---|---|---|
| kind | supported | supported | degraded (rendered as a flowchart: boundaries become subgraphs and component kinds become node shapes instead of icons) |
| `component.kind.service` | supported | supported | supported |
| `component.kind.database` | supported | supported | supported |
| `component.kind.queue` | degraded (architecture-beta has no queue icon; rendered with the server icon) | supported | supported |
| `component.kind.cache` | degraded (architecture-beta has no cache icon; rendered with the server icon) | supported | supported |
| `component.kind.client` | supported | supported | supported |
| `component.kind.external` | supported | supported | supported |
| `boundary` | supported | supported | supported |
| `boundary.nested` | supported | supported | supported |
| `connection.label` | degraded (architecture-beta edges have no labels; the label is dropped) | supported | supported |
| `connection.bidirectional` | supported | supported | supported |
| `component.ref` | supported | supported | supported |
| `component.icon.aws` | degraded (Mermaid has no AWS icons; each component is drawn with the generic icon or shape of its kind) | supported | degraded (FigJam has no AWS icons; each component is drawn with the shape of its kind) |
| `boundary.group.aws` | degraded (the AWS group frames are drawn as plain groups) | supported | degraded (the AWS group frames are drawn as plain subgraphs) |

## activity

| Feature | mermaid | drawio | figjam |
|---|---|---|---|
| kind | degraded (Mermaid has no activity diagram; emitted as swimlane-beta (beta syntax, Mermaid 11.16 or newer, rendering of fork and join bars unverified) or, with --mermaid-stable, as a flowchart with subgraphs as lanes) | supported | unsupported (FigJam generate_diagram does not accept swimlane-beta; use --to drawio) |
| `lane` | supported | supported | supported |
| `control.kind.initial` | supported | supported | supported |
| `control.kind.final` | supported | supported | supported |
| `control.kind.decision` | supported | supported | supported |
| `control.kind.merge` | supported | supported | supported |
| `control.kind.fork` | supported | supported | supported |
| `control.kind.join` | supported | supported | supported |
| `flow.guard` | supported | supported | supported |
| `action.ref` | supported | supported | supported |

## bundle

Options of `bundle`, the combined file of a run (`figjam` has no bundle).

| Feature | mermaid | drawio | figjam |
|---|---|---|---|
| `pages` | degraded (one Markdown document with a heading and fenced block per diagram; no pages) | supported | unsupported (figjam has no bundle; boards are created one diagram at a time) |
| `ref.title` | supported | supported | unsupported (figjam has no bundle; boards are created one diagram at a time) |
| `ref.link` | degraded (no link; click directives are stripped by most Markdown renderers, the target is the next heading) | supported | unsupported (figjam has no bundle; boards are created one diagram at a time) |
| `canvas` | unsupported (--canvas is refused; the document already shows every diagram in order) | supported | unsupported (figjam has no bundle; boards are created one diagram at a time) |
