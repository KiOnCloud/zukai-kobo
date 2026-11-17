# Architecture

One page on how the skill is put together and the rule that keeps it honest.

## Pipeline

```text
clarify (interview)   ─┐
scout (read code)     ─┼─> IR file (JSON) ─> validate ─> feature matrix ─> model ─> detail ─> secret scan ─> emit ─> mermaid | drawio | figjam
brainstorm (idea) ─> clarify ┘                                                                                  └─ figjam text is pasted by hand when no Figma tool is connected
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
  The description tables (`emit-doc.mjs`) stand beside the matrix, not in it: `--to doc`
  writes every element of an IR as a row, a column or a heading of a Markdown table, so
  there is no cell that could say `degraded`, and the pipeline does not ask the matrix for
  it. That is why `doc` is no fourth target: it is written beside the files of the target
  the user chose. The secret scan still runs, as for every local file. Every word the tables
  write themselves is in `doc-strings.mjs`, once per language (`en`, `ja`, `vi`); labels are
  never translated. The first line of a document records its language, so a later change
  writes it again the same way, and in a bundle an element with `ref` links to the section
  of its part.
- **The model check** (`check-model.mjs`) reports what a valid IR can still get wrong, on
  `validate` and on every emit: a decision with fewer than two ways out, a step connected to
  nothing, a repeated edge, a state diagram without an initial state or with a state it never
  reaches, a reply before its call, an entity with a foreign key and no relation, a use case
  that no actor reaches (directly or through include, extend or generalization), an actor
  without a use case, and (as `size:`) more than 40 elements in one diagram. They are warnings: each has an honest
  exception, which the author records in `meta.omitted`.
- **The level of detail** (`check-detail.mjs`) is checked on every emit of an architecture
  diagram: several stores of one kind used by one component alone (a database drawn table
  by table; a store is known by its `kind` or by a database or storage icon), a plain
  boundary that holds only components of one icon, connection labels that start with step
  numbers, and a connection label that reads as an endpoint path, a job or data path or a
  field name are reported as `detail:` warnings. They are warnings because the IR cannot show
  whether three buckets are one resource or three; the closing contract lets only the user
  keep one, recorded as a `detail accepted:` entry in `meta.notes` that quotes the ids the
  warning named. A warning whose ids are all quoted there is not repeated.
- **The secret scan** (`scan-secrets.mjs`) runs on `validate` and on every emit over every
  string in the IR. Each finding has a kind, and the pipeline decides what a kind stops. A
  credential by its form (a URI with a password, a known token prefix, a private key, a
  `password=<value>` assignment whose word may be English, Vietnamese or Japanese) is written
  by no target: `emit` and `bundle` refuse. A guess (a high-entropy string, an assignment of
  a plain word, a mail address or telephone number) is a warning for a local file and a
  refusal for FigJam, whose labels leave the machine. `--allow-sensitive` is the user's word
  that a finding is not a secret; `drift`, which writes nothing, always compares with it.
- **Emitters** are deterministic functions from IR to text: `emit-mermaid.mjs` (safe ids,
  entity-encoded labels, own-line id comments) and `emit-drawio.mjs` (uncompressed mxGraph
  XML; ELK layout through `layout-graph.mjs` for graph-shaped kinds, the fixed grid in
  `layout-sequence.mjs` for sequence diagrams). FigJam reuses the Mermaid emitter with a
  stricter profile and the agent makes the MCP call. What Figma's `generate_diagram` leaves
  out of a sequence diagram (block frames, notes, self-messages, participant kinds,
  activation bars) is drawn afterwards by a
  script that `figjam-overlay.mjs` writes for the Figma tool `use_figma`; it checks the board
  against the model and changes nothing when they differ.
  `figjam-native.mjs` is the other way onto a board: it reads the draw.io XML and writes
  `use_figma` scripts that draw every cell as plain shapes, vector lines and text at the
  draw.io coordinates, so the layout is not computed twice and class and activity diagrams,
  which `generate_diagram` rejects, reach FigJam too. The pictograms of draw.io's stencils
  (AWS and GCP services and groups, product logos, the client screen) are data as well:
  `src/stencil-paths.json`, which `tools/generate-stencil-paths.mjs` makes from draw.io's
  `stencils.min.js` at the tag of the icon catalog
  (`node tools/generate-stencil-paths.mjs <path to the downloaded file> [tag]`). It holds, for
  every stencil name the emitters can write, the paths of the stencil in its own box, arcs
  already turned into curves. With the GCP library the table would have taken the bundle
  over its size budget, so `stencil-pack.mjs` writes every number of a path as the
  difference to the number before it on its axis: the points of an outline lie close
  together, the differences are short and repeat, and the Brotli-packed table comes to
  under two thirds of what the plain numbers take. The table that is unpacked is the one
  that went in, number for number, and a script carries only the paths its diagram shows.
  On the native board the title of a frame without a header strip (a GCP group, an
  Availability Zone) stands at the top of the frame, as draw.io draws it.
- **The CLI** (`cli.mjs`, bundled by esbuild into the committed `bin/cli.mjs`) exposes
  `validate`, `emit`, `bundle` (both also with `--to doc`), `relabel`, `preview` and
  `export`, plus `diff` (with `--drawio` for the picture of a change), `drift`, `snapshot`,
  `revisions` and `restore` for the revise skill, `extract` and `cover` for the recook
  skill, `sources` and `stale` for the sync skill, and `help`; it exits 2 on validation errors
  and 1 on a usage error (an unknown target, an option without its value) with the errors as
  JSON on stderr, and is invoked with the absolute skill directory because the working
  directory is always the user's project. A run folder given to `bundle`, `diff` or `drift`
  stands for the IRs of its `source/` in run order (`run-order.mjs`): the diagram named
  after the run, its business view, then each part with its business view. A file-name sort
  would put the parts first, since `-` sorts before `.`.
- **The closing contract** (`skills/draw/references/closing-contract.md`) is the one place
  that says how every run ends: write, validate, emit, bundle, review, pictures when asked
  for, report. All four skills read it; none copies it.

## Visual check

A tiled preview has the white beside the drawing cut off each tile, across the direction
the tiles follow each other in, so a canvas of diagrams of different heights does not come
back as mostly empty images. `cli.mjs preview` renders a `.drawio` or `.mmd` file, or every block of the combined `.md` of
a Mermaid run, to a PNG in the system temp directory (one path per input file, made from its
name, type and a hash of its full path, so two files or two projects never share one) so
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

`cli.mjs export` (`export-svg.mjs`) is the same rendering kept as a deliverable: each page of
a draw.io file becomes `<name>.drawio.svg`, a picture that GitHub, a browser or a wiki shows
and that draw.io opens for editing. A run folder stands for its combined file, since only
there a step with `ref` shows the title of its part, and its pictures go to `svg/`. The
page is drawn by one of the two renderers of `preview`, draw.io desktop first, and what
comes back is made a file that stands on its own by one piece of code for both. draw.io
writes a label as HTML in a `foreignObject`, which only a browser draws; a PDF converter or
a wiki's own renderer shows "Text is not SVG" in its place. So each label is turned into
SVG `<text>`, one element per line, at the place the browser laid that line out. That step
needs a browser: with draw.io desktop and no Playwright the labels keep the HTML form and
the output says `text: "html"` with a warning, and a label that holds more than text (a
table, a list, an image) keeps it in any case and is named. The file gets a white
background and loses every colour that follows the viewer's dark mode, because a picture
in a document must look the same for every reader. The page's own mxfile goes into the
`content` attribute of the root `<svg>`, where draw.io and `extract` read it. Each picture
holds one page, so a link to another page is taken off the drawing (the label and its "↳"
line stay) while the embedded diagram keeps the cell as the source has it. Before anything
is written, every picture is read back with the reader `extract` uses and must return the
page it was made from; nothing is written unless every page has a picture, and without a
renderer the command exits 1 and writes nothing, since a picture made any other way would
not be the diagram. `export` is the second command that may reach the network, for the
same reason as `preview`: the viewer script is fetched when draw.io desktop is not
installed, and the diagram is rendered locally.

## Distribution

One source folder, `skills/draw/`, follows the Agent Skills standard (only `name` and
`description` in the frontmatter). The repository root is both the Claude Code marketplace
and its single plugin (`.claude-plugin/`, `source: "./"`). Inside the plugin the skill is
named `draw` and invoked as `/zukai:draw`. Codex users copy the folder with
`install.sh --target codex`, which installs it as `zukai` (folder and `name`, since a copy
has no plugin namespace), writes a version marker and upgrades in place. The other three
skills, `skills/revise/`, `skills/recook/` and `skills/sync/`, are instructions only and
are distributed with it: four skills in the plugin (`/zukai:draw`, `/zukai:revise`,
`/zukai:recook`, `/zukai:sync`) and four folders in a copied install (`zukai`,
`zukai-revise`, `zukai-recook`, `zukai-sync`), each of the three finding the CLI in the
sibling folder of the draw skill. The
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
extra first page. A page id is the diagram id in lower case with other characters as
hyphens, at its full length (`pageIdOf`); up to 2.0.3 it was cut at 40 characters, which gave
two diagrams with a long common start one page, and `drift` still reads such a file by the
old rule. Elements with `ref` resolve against the bundle's diagram ids to the target's
title and a draw.io page link (`data:page/id,<page id>`, which needs a `UserObject` wrapper
around the cell); outside a bundle they keep the slug. A part whose title is the label of
the element that links to it adds no second line. Every kind has one element that takes
`ref` (flowchart node, activity action, sequence message, state, architecture component,
class, ER entity, use case), so the `detailed` scope links a main diagram to its parts
whatever the kind; the schema shares one `$defs/ref` and the matrix has one `<element>.ref`
feature per kind. A use case with `ref` is the natural case: the diagram names the goal and
the part shows its steps.

The picture of a change (`diff --drawio`, see Revising a run) is built with the same
`bundle`, one page per diagram that changed, and then restyled. It is no output of a run:
its legend cells carry ids that no IR id can have, which is how the CLI recognises such a
file, refuses to write it over any other draw.io file and refuses to read it in `drift`.

## Graph kinds in draw.io

ELK lays out flowchart, state, ER, class, architecture and use case diagrams with orthogonal routing,
20 px between parallel edges and ports, and label-aware spacing; the emitter converts ELK's
label boxes into draw.io's relative label geometry, so a label stays where the engine put
it. Every edge is written with ELK's waypoints and with exit and entry anchors taken from
ELK's end points, so draw.io follows the computed route instead of re-routing a straight
edge next to its neighbours. An edge of a flowchart that leads back to an
earlier step arrives there on a side across the flow (a port with a fixed side on the loop
head), so the side along the flow stays with the edge that goes on and the main line of the
chart runs straight. A self-loop goes on a side that is across the flow, where no
other edge of its node ends. In a top-down or bottom-up layout the emitter draws it on a
band of the right or left side, after the node asked ELK for the room on both sides. In a
left-to-right or right-to-left layout it is the loop ELK itself routes over the top of the
node, 30 px deep, with ELK's label box above it. ER diagrams
run ELK twice: the first pass decides sides and row anchors, the second gets them as fixed
ports (`FIXED_POS`), repeated until the order of anchors sharing a header band is stable.
Table rows grow with wrapped text.

An architecture component drawn as a figure with its name below (a `client`, or a component
with a cloud `icon`) has a layout box that holds the figure and the name; the figure is drawn
at the top centre of that box, and a second layout pass gives its connections fixed ports
within the figure's extent. In a diagram with cloud icons or frames, `attachStores` enlarges the layout box of an icon
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
to the engine and the layout runs again. After the layout, the title of each cloud group frame is placed on a
stretch of the frame's top that no connection crosses, and a frame without one is widened
and the layout repeated.

The cloud icons of both providers are draw.io's own stencils: `mxgraph.aws4` for
`aws:<name>` and `mxgraph.gcp2` for `gcp:<name>`, as `icon` on a component and as `group`
on a boundary (`gcp:project`, `gcp:region`, `gcp:zone`, `gcp:vpc_network`, `gcp:subnet`,
`gcp:google_cloud`, `gcp:kubernetes_cluster` and the rest of the library). Their names,
titles and colours are data: `src/aws-icons.json`, generated by
`tools/generate-aws-icons.mjs` from draw.io's `Sidebar-AWS4.js`, `Sidebar-GCP2.js` and
`shapes/mxGCP2.js` at one pinned tag
(`npm run gen:icons -- <path to Sidebar-AWS4.js> [tag] [path to Sidebar-GCP2.js] [path to mxGCP2.js]`,
of which `gen:aws-icons` is the older name; it also rewrites `references/aws-icons.md` and
`references/gcp-icons.md`). The second file holds the GCP group frames, the grey resource
figures and the product logos, the third names the GCP service icons. The catalog also
holds the general resources of the AWS library (shapes with a size of their own); these,
the GCP resource figures and the product logos are what a system outside the clouds is
drawn with. Google Cloud was added without a second emitter. What differs between the
providers is a table, `PROVIDERS` in `aws-icons.mjs` (the stencil library, the icons and
groups, whether an icon is a figure of its own or a picture in a square, which categories
draw a store, the reference page), and `FRAME_STYLE` in the emitter, which adapts the
palette's frame style per provider so that a title can step aside by one key. The
placement code above (`attachStores`, `placeBeside`, `placeRow`, the frame titles) is
shared, which is why both clouds can stand in one diagram, each in its own outer frame.
The validator looks every `aws:<name>` and `gcp:<name>` up in the catalog and answers an
unknown one with the nearest names of that provider and the page that lists them, because
draw.io draws an unknown stencil as an empty box without an error. Mermaid and the FigJam
text have no such icons: the matrix marks them `degraded`, and the warning comes once per
provider, not once per element. To follow a newer draw.io release, download the files for
its tag, run the generator and review the diff.

A use case diagram (`emitUsecase`) reads from the actors to the system and on to what the
system calls, left to right unless the IR gives another direction. The primary actors are
pinned to the first layer and the supporting actors and outside systems to the last one
(ELK's layer constraints), with the boundaries and their use cases between them. The
layers follow the reading order, not the direction of the arrows: an included use case
follows its base, an extending one follows the use case it extends and a special use case
follows the general one (those two are handed to the engine reversed), which leaves the
use cases an actor starts nearest to it. Every association of an actor uses one port on the side that faces the
system, so its lines leave as one line that parts where the use cases are; a generalization
that crosses the system gets a port of its own, clear of them. A generalization between two
actors of one side is not the engine's, because the two share a layer:
`placeActorGeneralizations` draws it straight between neighbours and round the outside of
the column when another actor stands between them, and the layout keeps room for that run.
An ellipse is narrower than its layout box everywhere but the middle of a side, so
`usecaseAnchor` carries the last stretch of each line on to the outline and fixes the
anchor there; draw.io would otherwise turn the line towards the centre. A person is
draw.io's `umlActor` figure with the name below it, an outside system a box marked
«system» so that nobody reads it as a person, and a boundary a plain rectangle with its
title at the top: the title steps aside when a line enters from above, as an AWS frame
title does, and a title that wraps makes the header taller and the layout run again.

For Mermaid, `planArchitectureGrid` places components on
a grid and falls back to the flowchart form when `architecture-beta`'s side constraints
cannot express the graph. Mermaid has no use case diagram, so that kind is written as a
flowchart and the matrix marks it `degraded`: an actor is a box whose first line says
«actor» or «system», a use case a stadium node, a boundary a subgraph, `include` and
`extend` dotted arrows labelled with the stereotype, and a generalization a solid arrow
labelled «generalization», since a flowchart has no hollow triangle. FigJam's
`generate_diagram` has no such form at all, so the cell is `unsupported` and the board is
drawn by `emit --native`, which needs nothing per kind because it reads the draw.io XML.

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
  on the canvas page (`"all"` when they are every diagram in file order), the gap that leaves
  the most titles in place, the title from the page name. Page ids are slugs of the diagram
  ids, so every match goes through `slugify`; cells draw.io wraps in `UserObject` or `object`
  and numeric character references are read like the emitted ones. An upgrade of the
  emitters shows up as drift too; the skill says so instead of hiding it. A file that
  `relabel` rewrote in place keeps its old boxes, so `relabel` records in each page the
  labels it was laid out for (a `zukaiLabels` property on the root cell, which draw.io keeps
  on save) and `drift` compares positions with an emit of the IR that carries those labels
  again, texts with a fresh emit. The combined `.md` of a Mermaid run is compared block by
  block (`driftMarkdown`), which also returns the title it was written with.
- **Revisions cover the whole run.** `revisions.mjs` copies every IR of the run into
  `history/rNNN/` together, never one file, because a main diagram, its `ref` parts and its
  business views must be restored as one consistent set. A revision is written into a
  temporary sibling and renamed into place, the newest five are kept, and a restore
  snapshots the current state first (marked `undoOf`, with the current bundle options and
  any hand-edited outputs) so an undo can be undone. Each record carries two stacks, `undo`
  and `redo`: a change pushes its snapshot on `undo` and clears `redo`, a restore moves
  revisions between the two, and `restore <run> undo|redo` takes one step, so undo and redo
  walk one line of states instead of each redo undoing the last restore. A revision with no
  IR is never written or restored. Hand-edited files kept with a revision (`extras/`) are
  the only copy of the user's work: rotation moves them to `history/extras/<rev>/` and
  reports them, and nothing in the CLI deletes them (the one store that grows without a
  bound; it holds a few files per hand-edited redraw).
- **Drafts never touch `source/`.** A what-if is built as complete copies of the run under
  `drafts/<a|b|c>/` and compared with `diff` (`ir-diff.mjs`: elements added, removed, changed
  and reordered per top-level collection, plus hints for a `ref` part or a business view that did
  not follow, for references left on a removed element, and for an added diagram that no
  element links to or that is a second architecture diagram of the run). The run is written
  only after the user confirms one draft, so dropping all drafts needs no undo.
- **The change is drawn, not only listed.** A list of ids says what changed; a reviewer
  wants to see where. `diff --drawio` (`visual-diff.mjs`) writes a draw.io file of the new
  version with one page per diagram that changed: added elements green, changed or moved
  ones amber, removed ones drawn again in red with a dashed outline, and under each page a
  legend with the old value of everything amber. A removed element is not in the new model,
  so each page is drawn from a merged model: the new IR with the removed elements put back
  where they stood (a message at its old place in the order, a node with its old edges, a
  container with its members, a row of a class or an entity at its old row). The merged
  model is a valid IR and goes through the pipeline of every emit, and the cells are then
  restyled by their ids, which the emitter derives from the IR ids; no layout code is
  repeated and a kind needs no code of its own. When the merge is not a valid IR, it is
  tried again with removed containers that leave the members another container now holds;
  when that fails too, the new model is drawn alone and every removed element is named
  under `notDrawn` with the reason. A diagram whose kind changed makes no one model: it is
  two pages, the new one marked as added and the old one as removed, like a diagram that is
  in one version only. The old labels are written on the page, so the secret scan runs on
  the old version as well. The legend cells have ids of the form `<page id>:$diff:...`,
  which no IR id can be; they are the marker by which the CLI tells such a file from the
  output of a run. Revise writes the picture under `drafts/`
  (`drafts/<x>/changes.diff.drawio` for a draft, `drafts/changes-<rNNN>.diff.drawio` for an
  applied change), which is why a `drafts/` folder counts as an open consult only when it
  holds `consult.json`.
- **A new diagram is drawn by the draw skill's rules.** A request to add a diagram to a run
  has its own route: revise reads `skills/draw/SKILL.md` and runs its opening call, mode
  protocol and IR rules before it writes anything, then places the diagram as a `ref` part,
  a business view or a diagram of its own. A second diagram of the kind and subject of a
  delivered one is never written; the detail becomes parts of the kind that shows it.

## Recooking a diagram

`skills/recook/SKILL.md` rebuilds a diagram drawn in another tool. Like revise it has no CLI
of its own; it adds two commands to the draw skill's.

- **The source is read by code, not by the model.** `extract.mjs` picks the reader by
  content. `extract-drawio.mjs` inflates compressed pages (also from the `content` attribute
  of an editable SVG and the `mxfile` text chunk of a PNG), turns each style into a shape
  class, folds the parts of one thing into it (table rows, class members, activation bars,
  edge label cells, a text box laid over a shape), joins an edge that ends near a shape but is
  not connected to it (flagged as inferred), and tells lanes from frames by geometry (touching
  siblings of one size, or a single frame that holds nearly every step). `extract-mermaid.mjs`
  reads every diagram type the emitter writes, plus hand-written variants, without the
  Mermaid package. `extract-figjam.mjs` writes a `use_figma` script that only reads a board
  and returns it as JSON in parts of at most 45 000 bytes (a `use_figma` result holds 48 000),
  and turns the joined parts into facts: connectors keep their ends, a sequence diagram that
  `generate_diagram` drew (two boxes and a line per participant, the overlay's frames as
  shapes) is read back as lifelines and frames, a board drawn by `emit --native` is read back
  from its groups, and a whole page splits into one facts page per diagram on it.
  `extract-plantuml.mjs` reads PlantUML text (a file of one or several
  `@startuml ... @enduml` blocks, or Markdown fences) with a tolerant line reader, not with
  PlantUML itself, so nothing is installed and nothing is executed. PlantUML has no header
  that names the diagram type, so the statements decide between four families: sequence,
  state, activity in the new syntax, and the description family that class, ER, component,
  deployment and use case diagrams share, whose kind hints are scored from what the page
  holds. A page adds three fields to the facts: `unsupported` (`{ type, reason }`) for a
  diagram type that is not read (a mind map, a Gantt chart, the legacy activity syntax),
  which holds no nodes so that nothing is guessed from it; `direction` for
  `left to right direction`, the one layout choice of the author that is kept; and
  `autonumber`, which says that message numbers are not content. A statement the reader
  cannot read is a warning that names its line, and the preprocessor is not run: an
  `!include` is reported as not followed, since what another file declares cannot be
  claimed as read. All four write the same
  facts, with kind hints scored from the shapes so the skill can suggest a kind with its
  evidence; the model maps facts to IR by `skills/recook/references/mapping.md`.
- **Coverage instead of trust.** `cover.mjs` lists every text of the facts that is in no
  element of the IRs and in no `meta.omitted` or `meta.notes` entry. The match is per
  element (all words of the text in one element, or its letters in order for labels without
  spaces), so a dropped step is not found through words that happen to occur elsewhere; UML
  operators (`else`) and multiplicities stored as relation ends are not asked for, and
  `meta.notes` does not count, since a note is not shown. Facts are redacted on the way out
  of `extract` with the secret scan's own patterns (`redactText`), so a value never reaches
  the run folder, and `cover` asks only for the words around a `<redacted ...>` placeholder.
  Each IR names its source page in a `meta.notes` entry (`page "<name>"`), and a page's
  texts are looked for only in the IRs of that page, so a word of one diagram cannot stand in
  for the same word dropped from another; an omission counts only as `"<text>": <reason>`. The skill
  loops until the check passes, then runs the closing contract unchanged.
- **Zukai's rules over the source's structure.** A page that mixes kinds or draws the inside
  of resources is split into a main diagram and `ref` parts, as the user chose for this
  skill, rather than redrawn as it was; the change list in the report says what moved.

## Syncing a run

`skills/sync/SKILL.md` brings a run that `scout` drew up to date with the code. It has no
CLI of its own either: it adds `sources` and `stale` to the draw skill's and borrows the
drafts, the snapshot and the hand-edit check from revise.

- **A diagram names its files.** The scout protocol writes `meta.sources` into every IR it
  derives: the files the diagram was read from, as paths from the project root with forward
  slashes. The validator refuses an absolute path, a backslash and a `..`, so the list
  means the same on every machine.
- **The record is a statement, not a cache.** `sources` (`sources.mjs`) writes
  `source/<run-slug>.sources.json`: per diagram, each file with a SHA-256 of its content.
  It is taken only when the diagrams were just read from the code, at the end of a scout
  run and of a sync, because it says "the diagrams match these files"; a revision by revise
  does not read the code and leaves it alone, and `--only` records a single scouted diagram
  added to a run without touching the other entries. A hash was chosen over git because it
  needs no repository, no history and no network, so `stale` runs in CI as it is. CRLF is hashed as LF, so a checkout that converts line endings does
  not make every diagram look out of date. The project root is stored relative to the run
  folder, so the record still finds the files in another checkout. A scouted diagram of an
  older run, without `meta.sources`, is recorded from the paths in its `meta.notes` that
  exist under the root, and the output says so.
- **`stale` only reads.** It hashes the recorded files again and lists, per run and per
  diagram, those that changed and those that are gone, plus the diagrams whose
  `meta.sources` the record does not hold. The exit code carries the answer: 0 when the run
  is current, 2 when it is out of date, 1 when a run has no record, which is a different
  fact from "current" and must not pass a CI check as one.
- **Only what the code changed changes.** The skill edits a copy of the delivered IR while
  reading the changed files, and keeps every id, label and order the code still supports.
  The user reads the change list to learn what happened in the code, so a label reworded
  for no reason would be a false entry in it; every difference must be traced to a file,
  and one without a cause is put back.
- **A sync is a draft until confirmed.** The new IRs go to `drafts/a/` with a
  `consult.json`, are compared with `diff`, and reach `source/` only on "apply", after a
  `snapshot`. The snapshot keeps the sources record of the state it saves and `restore`
  puts it back (or removes it when that revision had none), so undoing a sync leaves the
  run honestly behind the code again. A change below the level of the diagram writes no
  revision and emits nothing: only the record is renewed.

## Extension rule

Adding a target means one new `emit-<target>.mjs`, one column in `feature-matrix.json`, one
`references/target-<target>.md`, and fixtures. Nothing in the input flows changes. Adding a
diagram kind means a schema branch, a kind entry in the matrix for every target, an emitter
function per target, a function in `emit-doc.mjs` with its words in `doc-strings.mjs` for
every language (the tests compare the keys of the languages and hold each kind to listing
every element), a question bank section, and fixtures. The picture of a change, the native
FigJam board and the SVG pictures need nothing: they work on the IR collections or on the
draw.io XML, whatever the kind. The use case kind was added this way and is the eighth.
There is no plugin loader or registry: three emitters are a switch statement in
`pipeline.mjs`.

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
`revisions.test.mjs` covers rotation, multi-file restore, undoing an undo, the undo and redo
line, kept extras and an interrupted snapshot. `fixes-e2e.test.mjs` runs the committed bundle
as a user would, one scenario per fixed defect of the 2.0.3 end-to-end report. `install.test.mjs` checks that the four skills are installed side by side. For recook,
`extract-drawio.test.mjs` extracts every fixture emitted to draw.io and asserts its kind hint
and full coverage against its own IR, and reads hand-drawn files (compressed, SVG, PNG,
several pages, loose edges, lanes); `extract-mermaid.test.mjs` does the same for Mermaid;
`extract-figjam.test.mjs` runs the reader script against a stand-in for the Figma API that
throws on any change. `extract-plantuml.test.mjs` reads a source of each diagram type the
reader knows, with the spellings PlantUML allows for one thing, and
`cli-recook-plantuml.test.mjs` takes PlantUML sources through `extract` and `cover` in the
committed bundle, the unsupported types reported per page included. For sync,
`sources.test.mjs` covers the hash with its line-ending rule, the path rule and the name of
the record, and `sources-e2e.test.mjs` runs `sources` and `stale` through the bundle: the
project root, the fallback to `meta.notes`, every exit code of `stale`, another checkout,
and the record that goes back with a restored revision. `visual-diff.test.mjs` draws the cases of `visual-diff-cases.mjs`, at least one
per kind, and checks the colour of every cell, the legend and the fallbacks;
`visual-diff-e2e.test.mjs` does it through the CLI, with the refusals of `diff --drawio`
and `drift`. `emit-doc.test.mjs` holds every kind to listing each element of each fixture
in every language and to escaping whatever Markdown would read as markup, and
`doc-e2e.test.mjs` writes the tables of a run with the bundle. `export-svg.test.mjs` checks
what needs no renderer (the pages of a file, the file names, the standalone SVG and the
read-back of the embedded diagram) and `export-e2e.test.mjs` exports with whichever
renderer is installed and is skipped without one. `usecase.test.mjs` covers the schema, the
reference and model checks and the geometry of the layout, and `usecase-e2e.test.mjs` takes
the kind through the bundle: validate, emit, a run with a linked part, the revise commands
and a recook of its own file. `gcp-icons.test.mjs` runs the catalog generator on palette
excerpts, checks the committed catalog against the reference page name for name, and holds
a GCP diagram and one on both clouds to the geometry rules of the AWS ones (titles clear
of connections, members inside their frames, stores beside their users);
`gcp-e2e.test.mjs` takes such a diagram through the bundle on every target and checks that
an AWS diagram comes out exactly as before.
