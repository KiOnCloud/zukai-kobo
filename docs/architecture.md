# Architecture

One page on how the skill is put together and the rule that keeps it honest.

## Pipeline

```text
clarify (interview)   ─┐
scout (read code)     ─┼─> IR file (JSON) ─> validate ─> feature matrix ─> secret scan ─> emit ─> mermaid | drawio | figjam
brainstorm (idea) ─> clarify ┘                                                                        └─ figjam falls back to mermaid
```

- **Input flows** are instructions, not code: `skills/it-diagrams/SKILL.md` routes on the
  mode argument and the three protocols in `skills/it-diagrams/references/` do the work.
  They are runtime-neutral so a single-agent runtime (Codex) gets the full behaviour. The
  Claude-only agents in `agents/` are thin accelerators that read the same protocol files
  and return their result inline; they hold no logic of their own and cannot write files.
- **The IR** (`skills/it-diagrams/scripts/src/schema/ir-v1.schema.json`, explained in
  `skills/it-diagrams/references/ir-reference.md`) is the only thing the model writes. It is a
  JSON object discriminated on `kind` with flat collections; containers reference children by
  id. Every element has a document-unique id and a label.
- **Validation** runs two passes and returns every error with a JSON-pointer path and a hint:
  the JSON Schema pass (Ajv, discriminator on `kind`, unknown properties rejected) and the
  referential pass (`check-references.mjs`: unique ids, endpoints exist, containment has no
  cycles, sequence blocks are contiguous and properly nested, state semantics).
- **The feature matrix** (`feature-matrix.json`, rendered to `docs/feature-matrix.md`) is
  data consulted before every emit. For each kind, target and feature it says `supported`,
  `degraded` or `unsupported`. `check-feature-matrix.mjs` enumerates the features an IR uses
  and turns `degraded` cells into warnings that name the element and what is lost, and
  `unsupported` cells into errors. Tests assert the matrix covers every feature the enumerator
  can produce for every target, so a new enum value cannot ship without a decision per target.
- **The secret scan** (`scan-secrets.mjs`) runs on every emit over every string in the IR:
  URI credentials, known token prefixes, key=value secrets and high-entropy strings produce
  warnings; the FigJam target refuses to emit on them unless `--allow-sensitive` is passed,
  because its labels leave the machine.
- **Emitters** are deterministic functions from IR to text: `emit-mermaid.mjs` (safe ids,
  entity-encoded labels, own-line id comments) and `emit-drawio.mjs` (uncompressed mxGraph
  XML; ELK layout through `layout-graph.mjs` for graph-shaped kinds, the fixed grid in
  `layout-sequence.mjs` for sequence diagrams). FigJam reuses the Mermaid emitter with a
  stricter profile and the agent makes the MCP call.
- **The CLI** (`cli.mjs`, bundled by esbuild into the committed `bin/cli.mjs`) exposes
  `validate` and `emit`, exits 2 on validation errors with the errors as JSON on stderr, and
  is invoked with the absolute skill directory because the working directory is always the
  user's project.

## Visual check

`cli.mjs preview` renders a `.drawio` or `.mmd` file to a PNG in the system temp directory so
the agent can look at the result and fix layout problems from the IR (label length, element
order, direction, note placement). The image is the agent's working copy, not a deliverable. It is the one command that may touch the network, and only to fetch the renderer
(draw.io's viewer page or the Mermaid library) into a local Chromium through Playwright; the
diagram itself is rendered locally. draw.io desktop, when installed, renders offline. The
renderers are not bundled and not required; the step reports why it was skipped. All size
heuristics share `text-metrics.mjs`, which measures a line by its glyphs in draw.io's
default font (the advance widths of Helvetica and Helvetica Bold at 12 px, CJK and
full-width characters at full width, a letter with diacritics as its base letter), and
`wrapText` in `layout-graph.mjs`, which breaks a text into lines where a browser does. Tests
check both against Chromium when Playwright is present: the widths within a pixel short and
3 % over, the line count of every node label of every fixture against the box it was sized
for. A decision's rhombus is sized
against its inscribed rectangle rather than its box, wrapping a long question into balanced
lines and adding label spacing so draw.io wraps inside the diamond (see the draw.io target
reference).

## Distribution

One source folder, `skills/it-diagrams/`, follows the Agent Skills standard (only `name` and
`description` in the frontmatter). The repository root is both the Claude Code marketplace
and its single plugin (`.claude-plugin/`, `source: "./"`). Codex users copy the folder with
`install.sh --target codex`, which writes a version marker and upgrades in place. The
`version` in `.claude-plugin/plugin.json` is the single release number for both channels.

## Activity lanes in draw.io

The first implementation laid lanes out as ELK compound nodes (chosen over ELK partitions,
which sent edges through unrelated actions). Users compared it with hand-drawn swimlane
diagrams and asked for the classic cross-functional form, so `layout-activity.mjs` now does
its own grid: one full-height coloured column per lane in IR order, one row per step from a
longest-path layering of the flows (back edges ignored), nodes of a lane centred in its
column and side by side when they share a row, and every edge routed explicitly through the
gap between rows and a gutter at the right edge of the source lane, so no segment crosses a
node. Within a lane, each node wants to sit under the average x of the flows that reach it
straight from that lane; a long flow that arrives down a gutter counts at the lane's edge
when nothing arrives straight or when every straight arrival is a decision's branch, and
otherwise only decides which side of its row-mates the node takes, so a merge fed by side
trunks sits on their side of the sibling branch and the trunks reach it without crossing.
A flow that leaves straight for another lane decides the same way, so a decision's branch
that hands off to the lane on the left sits left of its sibling and its run cuts no sibling
column; a long flow says nothing, since it takes its own column when that is free.
Nodes sharing a row are packed and slid together so one of them sits exactly where it
wants, and the lane is then sized from its content, so chains run straight, a fan-out stays
centred on its decision and an early exit keeps its own column. Each row gap and each gutter
is divided into tracks: every flow with a distinct target gets its own track, so two flows
never run along the same line unless they end at the same node (a merged trunk) or start at
the same node (a fan-out). Tracks in a gap are ordered by constraints between their runs:
a vertical going up at x belongs to a track above every run spanning x, one going down to a
track below, which puts the farthest branch of a fan-out nearest the decision on both sides.
A long edge goes straight down its source's own column when that column is free (no node
of any lane in the rows it passes, no horizontal run of another flow in the gaps it crosses
whole) and joins the track of the gap above its target, where flows into the same node
merge; otherwise it uses the left or right gutter of its source lane or of its target lane,
the side scored by the cross-lane runs that would cut it, so a bypass in an outer lane hugs
the free edge. Which columns are free is only known once nodes have positions, so the
arrangement runs to a fixed point (at most three passes). The layout checks its own result and reports any two flows that still share a
segment or cross as a `layout:` warning; a crossing between flows of different lanes is
reported as one the lanes may force, a crossing whose four nodes share one lane as a column
order the layout did not find. Guard labels are placed greedily over candidate anchors (above the
horizontal run just before the turn toward the target, beside the target corner, the source,
or the gutter run, on either side) avoiding nodes, other labels, the lines of other flows
and the trunk its own flow shares with sibling branches; a gap that holds a guarded fan-out
keeps extra room below its last track so the straight branch has a private stretch for its
guard, and any label that still overlaps is reported as a `layout:` warning. Left-to-right diagrams are
the same layout transposed. ELK is still used for the other graph kinds.

## Bundled draw.io files

`bundle --to drawio` emits every diagram as its own page and then places each under a title:
the page-level cells (vertices and edge waypoints with parent `1`) are shifted so the content
starts below a fixed title band, while children of lanes and containers keep their relative
coordinates. `--canvas` reuses the same placement to lay several diagrams side by side on one
extra first page. Elements with `ref` resolve against the bundle's diagram ids to the target's
title and a draw.io page link (`data:page/id,<page id>`, which needs a `UserObject` wrapper
around the cell); outside a bundle they keep the slug. Every kind has one element that takes
`ref` (flowchart node, activity action, sequence message, state, architecture component,
class, ER entity), so the `detailed` scope links a main diagram to its parts whatever the
kind; the schema shares one `$defs/ref` and the matrix has one `<element>.ref` feature per
kind.

## Graph kinds in draw.io

ELK lays out flowchart, state, ER, class and architecture diagrams with orthogonal routing,
20 px between parallel edges and ports, and label-aware spacing; the emitter converts ELK's
label boxes into draw.io's relative label geometry, so a label stays where the engine put
it. Every edge is written with ELK's waypoints and with exit and entry anchors taken from
ELK's end points, so draw.io follows the computed route instead of re-routing a straight
edge next to its neighbours. A self-loop goes on a side that is across the flow, where no
other edge of its node ends. In a top-down or bottom-up layout the emitter draws it on a
band of the right or left side, after the node asked ELK for the room on both sides. In a
left-to-right or right-to-left layout it is the loop ELK itself routes over the top of the
node, 30 px deep, with ELK's label box above it. ER diagrams
run ELK twice: the first pass decides sides and row anchors, the second gets them as fixed
ports (`FIXED_POS`), repeated until the order of anchors sharing a header band is stable.
Table rows grow with wrapped text. For Mermaid, `planArchitectureGrid` places components on
a grid and falls back to the flowchart form when `architecture-beta`'s side constraints
cannot express the graph.

## Variants: audience and language

`meta.audience` (`technical` or `business`) travels with the IR and selects the audience
items of the review checklist; a business view is its own IR derived by the rules in
`references/variants.md`, not a filtered copy. Language variants do not touch the IR for
draw.io: `relabel.mjs` rewrites labels in an emitted file by cell id, keeping ids and
geometry so hand edits survive, and reports labels that the size heuristic says no longer
fit. Mermaid variants are translated IRs, since text has no layout to keep.

## Extension rule

Adding a target means one new `emit-<target>.mjs`, one column in `feature-matrix.json`, one
`references/target-<target>.md`, and fixtures. Nothing in the input flows changes. Adding a
diagram kind means a schema branch, a kind entry in the matrix for every target, an emitter
function per target, a question bank section, and fixtures. There is no plugin loader or
registry: three emitters are a switch statement in `pipeline.mjs`.

## Testing strategy

Unit tests cover the validator, reference checker, secret scan and matrix completeness.
Emitter tests snapshot every fixture per target, assert determinism, and check invariants:
Mermaid outputs are parsed by Mermaid itself (jsdom globals, one import per process) and must
contain no raw markup in labels; draw.io outputs pass a structural check derived from
`mxfile.xsd` plus geometry invariants (no negative coordinates, children inside containers).
A drift test rebuilds the bundle in memory and compares it byte for byte with the committed
one. The CLI is tested through the bundle from a different working directory.
