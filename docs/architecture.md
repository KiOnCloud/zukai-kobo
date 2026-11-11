# Architecture

One page on how the skill is put together and the rule that keeps it honest.

## Pipeline

```text
clarify (interview)   ─┐
scout (read code)     ─┼─> IR file (JSON) ─> validate ─> feature matrix ─> detail ─> secret scan ─> emit ─> mermaid | drawio | figjam
brainstorm (idea) ─> clarify ┘                                                                        └─ figjam falls back to mermaid
```

- **Input flows** are instructions, not code: `skills/draw/SKILL.md` routes on the
  mode argument and the three protocols in `skills/draw/references/` do the work.
  They are runtime-neutral so a single-agent runtime (Codex) gets the full behaviour. The
  Claude-only agents in `agents/` are thin accelerators that read the same protocol files
  and return their result inline; they hold no logic of their own and cannot write files.
- **The IR** (`skills/draw/scripts/src/schema/ir-v1.schema.json`, explained in
  `skills/draw/references/ir-reference.md`) is the only thing the model writes. It is a
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
- **The level of detail** (`check-detail.mjs`) is checked on every emit of an architecture
  diagram: several stores of one kind used by one component alone (a database drawn table
  by table) and a connection label that reads as an endpoint path, a job or data path or a
  field name are reported as `detail:` warnings. They are warnings because the IR cannot show
  whether three buckets are one resource or three.
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
  `validate`, `emit`, `bundle`, `relabel` and `preview`, plus `diff`, `drift`, `snapshot`,
  `revisions` and `restore` for the revise skill; it exits 2 on validation errors with the
  errors as JSON on stderr, and is invoked with the absolute skill directory because the
  working directory is always the user's project.
- **The closing contract** (`skills/draw/references/closing-contract.md`) is the one place
  that says how every run ends: write, validate, emit, bundle, review, report. Both skills
  read it; neither copies it.

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

One source folder, `skills/draw/`, follows the Agent Skills standard (only `name` and
`description` in the frontmatter). The repository root is both the Claude Code marketplace
and its single plugin (`.claude-plugin/`, `source: "./"`). Inside the plugin the skill is
named `draw` and invoked as `/zukai:draw`. Codex users copy the folder with
`install.sh --target codex`, which installs it as `zukai` (folder and `name`, since a copy
has no plugin namespace), writes a version marker and upgrades in place. The
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
guard, and any label that still overlaps is reported as a `layout:` warning. The stretch a
flow shares with flows from other sources on their way into the same node is not its own
either: a horizontal run counts only up to the point where such a flow joins it, and beside
the segment that leaves the source the guard takes the middle of the part between the
sibling trunk and that point, so a branch that goes straight down and then turns into a
shared run is labelled on its own vertical. Left-to-right diagrams are
the same layout transposed: lanes become bands one under the other and rows become columns.
Only positions are transposed, because draw.io draws a shape and writes a guard the same way
whatever the direction. `layoutActivity` takes sizes as drawn (a fork or join bar already
upright) and turns each node and each guard's box on the way in, so the transpose gives every
node back the width and height it was measured at. A guard then lies along the flow instead
of across it, which changes four things in such a diagram: its gap to the line follows the
drawn direction (6 px beside a line, 2 px above or below one); a gap that holds a guarded
fan-out grows with the widest guard of that fan-out, whose text lies along the branch; the
places above the stretches that run along the flow (the side of a segment that ends up above
it) are tried before the ones beside a run across the lanes; and the lane borders are
obstacles, so a guard beside a gutter run takes the side towards the lane's content. ELK is
still used for the other graph kinds.

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
Table rows grow with wrapped text.

An architecture component drawn as a figure with its name below (a `client`, or a component
with an AWS `icon`) has a layout box that holds the figure and the name; the figure is drawn
at the top centre of that box, and a second layout pass gives its connections fixed ports
within the figure's extent. In a diagram with AWS icons or frames, `attachStores` enlarges the layout box of an icon
that passes work on to hold the one store it uses (a component with that single connection,
in the same frame), and `placeStores` puts the store beside it, across the flow, after the
layout. In the same kind of diagram, a plain component outside the frames with one
connection, from a component inside a frame, is left out of the ELK graph and placed by
`placeBeside` next to the outermost frame, level with its caller, on one straight line; it
goes back into the graph when neither side is free. `nearSide` then tries each component that stands
outside every frame on the other end of the flow (`layoutReversed` on its edges) and keeps
the arrangement whose connections are at least a fifth shorter. A system outside the frames
that is only called, by a caller outside the frames among others, or that lies on a circle
of connections through the frames (`rowCandidates`), is left out of the ELK graph too: `placeRow` stands it in a row along the frames, between its
callers, and routes its connections itself (a way out of each caller across the flow, with
a step aside when that way is taken, then one track per run along the row). `emitArchitecture`
lays the diagram out in further arrangements when the main flow is off the middle:
`fanOffCentre` measures how far each component with three or more connections on one side
stands off the middle of them and off the middle of the finished picture (the systems
beside the frames and in the row included, since they move its middle), and above a
threshold the whole layout is repeated with the containers on the page's own node placement
(`balanceContainers` in `layoutGraph`; ELK does not hand the strategy down to a container),
without the model order, and with both. The one that brings the hubs nearest the middle is
kept when it is clearly better. `placeLineLabels` writes each connection label beside a free stretch of its own line, so
the layout engine reserves no layer for labels; a label with no free place is handed back
to the engine and the layout runs again. After the layout, the title of each AWS group frame is placed on a
stretch of the frame's top that no connection crosses, and a frame without one is widened
and the layout repeated. AWS icons and group frames are draw.io's own `mxgraph.aws4`
stencils. Their names, titles and colours are data: `src/aws-icons.json`, generated by
`tools/generate-aws-icons.mjs` from draw.io's `Sidebar-AWS4.js` at a pinned tag
(`npm run gen:aws-icons -- <path to the downloaded file> [tag] [path to Sidebar-GCP2.js]`,
which also rewrites `references/aws-icons.md`). The same catalog holds the general
resources of that library (shapes with a size of their own) and, from `Sidebar-GCP2.js` at
the same tag, the product logos named `gcp:<name>`; both are what a system outside AWS is
drawn with. The validator looks every `aws:<name>` up in that catalog,
because draw.io draws an unknown stencil as an empty box without an error. To follow a newer
draw.io release, download the file for its tag, run the generator and review the diff.

For Mermaid, `planArchitectureGrid` places components on
a grid and falls back to the flowchart form when `architecture-beta`'s side constraints
cannot express the graph.

## Variants: audience and language

`meta.audience` (`technical` or `business`) travels with the IR and selects the audience
items of the review checklist; a business view is its own IR derived by the rules in
`references/variants.md`, not a filtered copy. Language variants do not touch the IR for
draw.io: `relabel.mjs` rewrites labels in an emitted file by cell id, keeping ids and
geometry so hand edits survive, and reports labels that the size heuristic says no longer
fit. Mermaid variants are translated IRs, since text has no layout to keep.

## Revising a run

`skills/revise/SKILL.md` changes a delivered run without a CLI of its own: it locates the
draw skill as its sibling folder and calls the same `bin/cli.mjs`. The design rests on three
choices.

- **Hand edits are found by re-emitting.** Emitters are deterministic, so `drift.mjs` emits
  the IRs again in memory and compares the result with the delivered file cell by cell
  (decoded values, numeric geometry, waypoints, parents and endpoints; viewport attributes
  that draw.io rewrites on save are ignored). For a bundle it recovers the options the file
  was built with from the file itself: the canvas members from the order of the title cells
  on the canvas page, the gap from the first two of them, the title from the page name. An
  upgrade of the emitters shows up as drift too; the skill says so instead of hiding it.
- **Revisions cover the whole run.** `revisions.mjs` copies every IR of the run into
  `history/rNNN/` together, never one file, because a main diagram, its `ref` parts and its
  business views must be restored as one consistent set. A revision is written into a
  temporary sibling and renamed into place, the newest five are kept, and a restore
  snapshots the current state first so an undo can be undone.
- **Drafts never touch `source/`.** A what-if is built as complete copies of the run under
  `drafts/<a|b|c>/` and compared with `diff` (`ir-diff.mjs`: elements added, removed and
  changed per top-level collection, plus hints for a `ref` part or a business view that did
  not follow and for references left on a removed element). The run is written only after
  the user confirms one draft, so dropping all drafts needs no undo.

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
one. The CLI is tested through the bundle from a different working directory. For revise,
`ir-diff.test.mjs` checks the change list on one edited model per kind and the cascade
hints on a run, `drift.test.mjs` re-emits every fixture without drift and finds moved,
reworded, copied and deleted cells (also on compressed pages and inside a bundle), and
`revisions.test.mjs` covers rotation, multi-file restore, undoing an undo and an interrupted
snapshot. `install.test.mjs` checks that both skills are installed side by side.
