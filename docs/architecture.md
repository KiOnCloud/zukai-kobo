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
  of its part. Tables with translated labels are written from translated IRs, which live in
  `source/<lang>/`: the commands that take a run folder read `source/` and nothing below
  it, so those IRs are no further diagrams of the run and the sources record never sees
  them.
- **The model check** (`check-model.mjs`) reports what a valid IR can still get wrong, on
  `validate` and on every emit for a target (the description tables are written from IRs
  whose emit has just reported it, so `--to doc` does not say it again): a decision with fewer than two ways out, a step connected to
  nothing, a repeated edge, a state diagram without an initial state or with a state it never
  reaches, an initial or final state with a label (those are markers, and no target draws a
  name on them: the warning names the state and says how to keep the name), a boundary or
  group without a member, a reply before its call, an entity with a foreign key and no relation, a use case
  that no actor reaches (directly or through include, extend or generalization), an actor
  without a use case, and (as `size:`) more than 40 elements in one diagram. They are warnings: each has an honest
  exception, which the author records in `meta.omitted`.
- **The level of detail** (`check-detail.mjs`) is checked on every emit of an architecture
  diagram for a target, as the model is: several stores of one kind used by one component alone (a database drawn table
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
  `layout-sequence.mjs` for sequence diagrams, where the label of a self-message that is
  too wide to stand centred over its loop starts beside the activation bar, and the gap to
  the next lifeline and the frames around the message are sized for it). FigJam reuses the Mermaid emitter with a
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
  Each script is one `use_figma` call, and a Figma plan may limit calls (the Starter plan
  stops after about twenty), so the CLI prints what a board costs: `calls`, and for each
  script the number of shapes, lines and texts its call must report as `created`, and its
  size in `bytes`. Every script for `use_figma` (native, overlay, reader) takes its data
  block from `figma-script-data.mjs`: the data over lines of at most 200 characters, since
  an agent copies the script into the call and tool output cuts long lines, and the length
  and a short hash of that data, which the script computes again and compares before it
  reads or changes the board, so a copy that lost or changed a character throws instead of
  drawing.
  `combineNative` packs the drawings of several diagrams into as few scripts as one call
  takes (`bundle --to figjam --native`); each drawing still goes into its own section, and
  `created` then lists, for each script, the count of each drawing in the order the script
  returns its results. Every shape a script draws is named `zukai-native` and the run folder
  of its IR, and a script draws over a section only when it holds such shapes of the same
  run, so a section of the same title drawn otherwise (the source of a recook) is left as it
  is and the new drawing goes into `<title> (2)`. Of two such sections (a copy made on the
  board) the last is drawn over and the result names the other in a `warning`. The
  group of a cell is named so that a board read back keeps what the picture cannot tell: an
  edge by its own label (never by a text at one of its ends), a stencil picture by its
  stencil, a client screen by `[client]`, a picture that is part of its frame (the Google
  Cloud mark) by `[part]`.
- **The CLI** (`cli.mjs`, bundled by esbuild into the committed `bin/cli.mjs`) exposes
  `validate`, `emit`, `bundle` (both also with `--to doc`), `relabel`, `preview` and
  `export`, plus `diff` (with `--drawio` for the picture of a change), `drift`, `snapshot`,
  `revisions` and `restore` for the revise skill, `extract` and `cover` for the recook
  skill, `sources` and `stale` for the sync skill, `glossary` for the project glossary,
  `labs` for the console and the labs skill, and `help`; it exits 2 on validation errors
  and 1 on a usage error (an unknown target, an option without its value, an option the
  command does not take: `COMMAND_OPTIONS` lists them per command, so none is read and
  dropped; a command of two words such as `glossary add` or `labs start` has its own entry)
  with the errors as JSON on stderr, and is invoked with the absolute skill directory because the working
  directory is always the user's project. A run folder given to `bundle`, `diff` or `drift`
  stands for the IRs of its `source/` in run order (`run-order.mjs`): the diagram named
  after the run, its business view, then each part with its business view. A file-name sort
  would put the parts first, since `-` sorts before `.`.
- **The closing contract** (`skills/draw/references/closing-contract.md`) is the one place
  that says how every run ends: write, validate, emit, bundle, review, pictures when asked
  for, report. The five skills that work on runs read it; none copies it. A report ends with
  the report skill's own closing contract (`skills/report/references/closing-contract.md`).

## Visual check

A tiled preview has the white beside the drawing cut off each tile, across the direction
the tiles follow each other in, so a canvas of diagrams of different heights does not come
back as mostly empty images. `cli.mjs preview` renders a `.drawio` or `.mmd` file, or every block of the combined `.md` of
a Mermaid run, to a PNG. A draw.io file of several pages shows its first page, or the one
`--page <id|name>` names (cut out as a file of its own by the code `export` uses for its
pages, so both mean the same page by the same name); an editable picture (`.drawio.svg`) is
rendered from the diagram in its `content` attribute. The image goes into the system temp directory (one path per input file and per page asked for, made from its
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
a draw.io file, or each page `--page` names, becomes `<name>.drawio.svg`, a picture that GitHub, a browser or a wiki shows
and that draw.io opens for editing. A run folder stands for its combined file, since only
there a step with `ref` shows the title of its part, and its pictures go to `svg/`. Such a
picture given back to `export` stands for the diagram in its `content` attribute, as it
does for `preview` and `extract`, and is drawn again from it. The
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
has no plugin namespace), writes a version marker and upgrades in place. The skills
`skills/revise/`, `skills/recook/`, `skills/sync/` and `skills/labs/` are instructions only
and are distributed with it, with `skills/report/` and its built-in templates: six skills
in the plugin (`/zukai:draw`, `/zukai:revise`, `/zukai:recook`, `/zukai:sync`,
`/zukai:labs`, `/zukai:report`) and six folders in a copied install (`zukai`,
`zukai-revise`, `zukai-recook`, `zukai-sync`, `zukai-labs`, `zukai-report`), each of them
finding the CLI in the sibling folder of the draw skill; the labs skill also carries out
its jobs by following the draw, revise, sync, recook and report skills. The console's pages are no skill of their own:
they are built into `skills/draw/scripts/bin/labs-ui/` beside the CLI bundle and travel
with it. The
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

A parallelogram and a hexagon are narrower than their box, and ELK ends every line on the
box. `graphCells`, which every ELK-laid kind shares, moves such an end along the line's own
direction onto the slanted edge (`outlinePoint`) and writes it as a pixel offset with
`perimeter=0`, so draw.io keeps the height the line was routed at instead of pulling the end
towards the centre of the shape. Flowchart and state diagrams run a second pass after the
first layout (`sidePorts`): a node whose ends on one side are closer than 10 px grows along
that side and gets a fixed port for every end, the line back to a loop head included, since
a node with fixed ports gets no port from `layoutGraph` for it; five or more lines into one
side that can share a line get one port, which ELK routes as one line. `fanInJunctions`
then finds, on the routes of the last layout, the point where the merged lines have all
joined, and the emitter draws a dot there as a vertex tagged `zukaiJunction=1`, which
`extract` and the FigJam reader leave out. `fanIn` in the IR sets how many lines merge.

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
without the model order, and with both. A connection that closes a circle is laid out
against the flow before any of this (`closingEdges` in `layout-graph.mjs`): in the order of
the connections, the one whose target already leads to its source. Left to the engine, a
circle was broken at an edge of its choosing, which could turn the main flow against the
direction of the diagram and send a system outside the frames to the caller's side. The one that brings the hubs nearest the middle is
kept when it is clearly better. Across a left-to-right flow the frames are not alike
above and below, since their headers are at the top: when the main flow of the kept
arrangement (the longest chain of connections) runs outside the middle half of a frame it
passes (`flowOffMiddle`), the same arrangement is laid out again turned over (`mirror` in
`layoutGraph`: ELK gets each container's header room at the bottom, fixed ports and the back
side turned and labels above their lines, and every coordinate is turned back), so what stood
above the flow stands below it and the flow runs under the headers. The turned layout is
kept when its flow runs clearly nearer the middle of the frames, it has no more crossings
(`lineCrossings`) and no more warnings, and its hubs stand no further off the middle or
within the bounds that start the other arrangements; a diagram with a self-loop is not
turned, since its loops belong above the components. In the turned layout a label with no
free place on the longest segment of its line tries its other segments before it goes back
to the engine, because a further layout can undo the turn. `placeLineLabels` writes each connection label beside a free stretch of its own line, so
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
draw.io draws an unknown stencil as an empty box without an error. A name people write
for a service that draw.io names otherwise, or has no stencil for, is answered from a small
table kept by hand (`src/cloud-aliases.json`, printed at the end of each reference page)
before the nearest names are, since a near name can be valid and wrong. Mermaid and the FigJam
text have no such icons: the matrix marks them `degraded`, and the warning comes once per
provider, not once per element. To follow a newer draw.io release, download the files for
its tag, run the generator and review the diff.

A use case diagram (`emitUsecase`) reads from the actors to the system and on to what the
system calls, left to right unless the IR gives another direction. The primary actors are
pinned to the first layer and the supporting actors and outside systems to the last one
(ELK's layer constraints), with the boundaries and their use cases between them. Within a
layer the nodes are ordered from the model (`forceNodeModelOrder`: the actors of a side
stand as `actors` lists them, the use cases as the engine derives their order from the
model and its edges), as the other kinds follow model order: left to the crossing minimisation, one added association turned a
whole column of actors round, and the picture of a change could not be compared with the
diagram before it. The price is that a crossing the engine would have avoided is now the
author's to avoid, by the order of the IR. A use case with more line ends on one side than
its outline has room for (15 px each) is drawn taller and the layout runs again
(`growCrowdedUseCases`), so two ends never lie on each other. The
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
  and reordered per top-level collection, each changed element with the old and the new
  value of every field under `values`. A block of a sequence diagram lists every message it
  spans, those of the blocks inside it included, so its lists are compared without the
  messages that came or went: the message is the change, not every frame around it. The
  `children` of a boundary, a group or a composite state are compared the same way, so a
  container that gained a new member or lost one that is gone is not listed and not drawn
  amber, while a member both versions have that moved into it still is a change of the
  container. The list also carries hints for a `ref` part or a business view that did
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
  holds `consult.json`. The closing contract holds that rule once, for revise and sync:
  confirming or dropping a consult deletes its own draft folders and `consult.json` only,
  the pictures of applied changes stay until the user deletes them, an undo removes the
  picture of the change it took back, and a sync writes the picture of its change as
  revise does. A diagram that differs in `meta` alone gets no page.
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
  from its groups, and a whole page splits into one facts page per diagram on it. On a
  native board a group of a round head, body strokes and a name under them is an actor, a
  line whose label stands below it on a back of its own is still a line, and a closed outline
  that holds every other stroke is a shape (a cylinder's lid is no line). The round trip
  `emit --native` -> board -> `extract` is tested for every valid fixture on a stand-in of the
  Plugin API (`tests/figma-stand-in.mjs`), checked against a real board, as the round trips
  through draw.io and Mermaid are.
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
  claimed as read. A note on the line of an «extend», or beside the use case that extends,
  is offered as the `condition` of that edge, since PlantUML has no other place for it. The
  pages of a Markdown file come in the order of the file, and pages one heading would name
  alike are numbered. All four write the same
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
  for the same word dropped from another; an omission counts only as `"<text>": <reason>`.
  Texts alone do not prove that a line was kept: two connections often carry one label, and
  the label of a dropped one is then found in the one that stayed. So every edge of the facts
  whose two ends are known must also be joined in the IRs, by an element with `from` and `to`
  whose ends carry the texts of the edge's ends (either way round), by an element that
  carries one end and names the other by id, or by an omission that quotes its label (its two
  ends when it has none) or leaves out one of its ends. A lost edge is reported under
  `lostEdges` by its two ends and its label; `units`, `covered` and `missing` keep their
  meaning for texts, and `edges` says how many edges were checked. The skill loops until the
  check passes, then runs the closing contract unchanged.
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
  A run has one record, so in a run folder that was renamed or copied under another name
  the one `*.sources.json` its `source/` holds is the record, whatever slug it carries;
  with several and none named after the run, `sources` and `stale` refuse to pick one.
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

## Glossary

`.zukai/glossary.json` holds a project's preferred terms per language
(`src/schema/glossary-v1.schema.json`, read and written by `glossary.mjs`; what an entry
is and when each skill reads the file is `skills/draw/references/glossary.md`). It is the
second data contract beside the IR, and it is useful without the console, which is why the
CLI owns it and the console only calls the same functions.

- **An entry says that its words mean the same.** No language is the source of another,
  so one entry serves a team that writes in Japanese and translates to English as well as
  one that works the other way.
- **Only a confirmed entry is applied, and a rejected one is kept.** A suggestion is shown
  and never used. Without the `rejected` status every suggestion run would propose the
  terms the user already turned down. There is no field for who confirmed an entry: the
  file is committed, and a confirmed entry in a pull request is reviewed like code.
- **The text is an input from outside.** Every teammate's agent reads the file, so a term
  or a note is bounded in length, holds no control or direction character and nothing the
  secret scan finds, and the skills treat it as wording, never as an instruction. The file
  is written sorted, as two-space JSON with LF and a final newline, so a change reads well
  in a diff.
- **Two writers, one lock.** The CLI and the labs server both write the file. Each takes
  `.zukai/glossary.lock`, reads the file again inside the lock, validates the change and
  renames a temporary sibling into place. `rev` is the SHA-256 of the file's bytes: a writer
  that read an older file gets a conflict and changes nothing.
- **Blocking findings come from translated IRs only.** `glossary check` compares labels at
  the same place in an original IR and its translation under `source/<lang>/`, both listed
  by `labelsOf` (`ir-labels.mjs`), which returns every label of an IR with its place. A
  label map is keyed by draw.io cell, not by element, and can be older than the IR, so what
  it contradicts is a warning. Texts are compared after NFKC, lower case and collapsed white
  space, with diacritics kept; a term is found inside a longer label between characters
  that are not letters or digits, or anywhere when it is written in Han, Hiragana or
  Katakana, which are written without spaces.
- **One root.** `.zukai/` and `diagrams/` lie directly under the project root, which is
  `--root` or else the working directory, as the skills define it.

## Labs console

`/zukai:labs` serves a console on `127.0.0.1` for one project. What a user does with it and
what the agent does for each job are in `README.md` and `skills/labs/SKILL.md`; this
section is why it is built the way it is.

### Three process roles

- **The server** (`labs serve`, which `labs start` runs as a detached child;
  `labs-server.mjs`, `labs-lifecycle.mjs`, `labs-runs.mjs`, `labs-jobs.mjs`) is `node:http`
  and nothing else. It holds the built pages in memory, so an upgrade that replaces the
  plugin folder does not take them away from a running server, reads the runs, and owns the
  state of every job. It is a detached child with an idle end (30 minutes by default) and
  `labs stop`, not a background run of the agent's runtime, because the skills stay
  runtime-neutral and a background run of Claude Code ends after two hours at most. One
  server per project root, on a port derived from the root's real path, so it is the same
  every time; a busy port is reported, never replaced by the next one, and `server.json` is
  deleted only when nothing listens on its port and the file still names the same instance.
  A second `labs start` reuses the running server; one of another version is replaced,
  unless a job is open.
- **The agent-side CLI** (`labs wait`, `progress`, `ask`, `done`; `labs-client.mjs`) is how
  the attached session works for the console. The server cannot call the agent, so the
  agent's calls are held open until there is something for them, at most nine minutes, and
  the client sets no timeout of its own that would cut them. "Nothing yet" is never an
  answer: a call that comes back empty is made again.
- **The browser** runs the console's pages: plain ES modules under `src/labs-ui/`, built by
  esbuild into the committed `bin/labs-ui/` and held to a fresh build by the drift test, as
  the CLI bundle is. No framework was added, since the project takes no new runtime
  dependency it can do without. A section of the console is one entry of `nav.mjs` and one
  view module; there is no loader and no registry. The pages follow the server's state by
  polling `/api/state`. The page layouts follow the width of the content (container
  queries), not of the window, because the agent panel takes its share beside them; the few
  controls Sienna has no helper for (choice tiles, segments, toggle chips) are native radios
  and checkboxes laid over their whole tile (`views/choice.mjs`), and the drawings of the
  diagram kinds are written in `views/glyphs.mjs`, never taken from the server.

### Why the server never writes a run

Every change to a run is a job for the attached agent, routed to the skill that already
makes that change. An undo, for one, is a hand-edit check with a question, a restore and
then the closing contract (`skills/revise/SKILL.md`); a server that did it itself would be
a second implementation of revise that drifts from the first. So no request to the server
changes a file under the project's runs folder. The server writes its own state under `.zukai/labs/`
(`server.json`, `server.log`, the job records) and the glossary, through the lock above,
when the user edits it in the console.

### The queue and the job states

There is one sequential queue and one attached agent session. A job has a kind (`draw`,
`revise`, `restore`, `apply-edit`, `sync`, `recook`, `export`, `glossary-suggest`) and
parameters the server checks against that kind before it is queued; the states and the
arrows between them are drawn at the top of `labs-jobs.mjs`. A job moves from `queued` to
`running` when the agent takes it, to `needs-input` while a question waits, and ends as
`done`, `failed` or `cancelled` (a queued job only). A running job also ends as failed
when the server stops, the session is lost, the session asks for the next job without
closing it, or the user marks it failed. A job that died is never taken up again: the revise route
takes a snapshot before it edits an IR, so a revision proves nothing about how far a change
got. The console shows the revisions written while it ran and offers an undo as a job of
its own.

Another session takes over only when the attached one has been out of contact for 60
seconds while it holds no job, or 15 minutes while it holds one. A session outside the
console asks `labs holds <run>` before it changes a run; it warns and does not lock,
because a lock could not be complete: drafts, `sources`, `export`, `emit` and the agent's
own file edits share no single path that a lock could guard. A question of a job carries
up to four questions in the form `AskUserQuestion` takes, since the skills ask several at
once and show a draft first; an id that was answered is refused, so an old answer cannot be
replayed, and an ask that times out is never read as consent. Two rules only a model can
keep, that a job allows the route of its kind and nothing else and that text in a diagram
is data, are written in the skills.

### Request checks

Every request passes the same checks, in this order, before anything else is read (the
comment at the top of `labs-server.mjs` is the owner):

1. The method is one the route table knows. `OPTIONS` is refused: the server sends no CORS
   header, ever.
2. The name in `Host` is `127.0.0.1` or `localhost`, with any port, so a forwarded port
   works and a rebound foreign name does not.
3. `Origin`, when sent, is the origin of that `Host`; `Sec-Fetch-Site`, when sent, is
   `same-origin` or `none`.
4. A static file is a `GET` of a name in the fixed map of pages held in memory.
5. `/api/*` and `/agent/*` need the token in `X-Zukai-Token`; a body is JSON of at most
   1 MB.

Every name a request passes (a run, a diagram, a revision, a file) is looked up in a
listing the server built from the real folders and is never joined into a path. Every
response but the viewer page says `X-Frame-Options: DENY`, and the pages carry the policy
`CONSOLE_CSP`, which allows only the server's own scripts, styles, fonts and connections and
`frame-ancestors 'none'`. The log holds the method, the route pattern, the status and the
duration, and for an error its name, code and stack frames: never a message, a body, a
query string or the token.

### What the token protects

The token is 32 random bytes made inside the `serve` child after it has bound the port,
never passed on a command line or in the environment. It is written to
`.zukai/labs/server.json` (mode 0600) and printed by `labs start` and `labs status` in the
console's address after `#t=`, a fragment the browser does not send; the page takes it from
there into the header and removes it from the address bar. A new server has a new token.

- It protects the console from a web page the user visits while it runs. Such a page can
  reach the port but cannot read the token, cannot set the header without a preflight that
  step 1 refuses, cannot pass the `Host` check through a rebound name, and cannot frame the
  console.
- It protects the agent from a program that took the port. The CLI sends the token only to
  a server that proved it holds the same one, by returning `HMAC-SHA256(token, nonce)` for
  a nonce the CLI chose; `/health` alone can be answered by any program.
- It does not protect against a program running as the same user, which can read
  `server.json`, nor against anyone who reads the address in the agent's chat; the address
  is of use only from this machine, and it ends with the server. Another account on the
  machine is kept out by the file mode of `server.json` and no further.

A cloud session is refused by the CLI, not by the skill's prose: `labs start` exits 1 with
`cloud-session` when `CLAUDE_CODE_REMOTE` is `true`, since a browser on the user's device
cannot reach that machine. `--skip-cloud-check` is for a browser on the same machine.

### The viewer frame

A picture comes from the run's `svg/` when it holds a fresh one, since that folder is
written only when the user asked for pictures. Otherwise the Picture tab draws the diagram
with draw.io's viewer (Mermaid for a Mermaid run) inside a frame of `viewer.html` with
`sandbox="allow-scripts"`. The sandbox gives the frame an origin of its own, so it has no
storage of the console, no token, and an `Origin` the API refuses. Its policy is
`viewerCsp` in `labs-server.mjs`:

- Scripts: the page's one inline script, allowed by its SHA-256 hash, and the scripts of
  the two renderers, from `viewer.diagrams.net` and, at one pinned version of Mermaid,
  from `cdn.jsdelivr.net`. The frame's own script is inlined because a script fetched
  from the console's host would be a cross-origin response to the sandboxed page, and the
  server sends no CORS header.
- Connections: `viewer.diagrams.net` only, which serves the stencil files of the AWS and
  other shape libraries; without it a trial drew an AWS diagram with its icons missing. The
  viewer script comes from that host too, so no further party can receive the diagram.
- Framing: by the console alone (`frame-ancestors 'self'`, `X-Frame-Options: SAMEORIGIN`).

The diagram is posted to the frame with every data link and every picture address that is
not `data:` taken out (`cleanForViewer` in `labs-runs.mjs`), and the console takes no
message from a window that is not its frame. A frame that has not drawn after 60 seconds
is replaced by a sentence with the Export job and the Tables tab. The viewer's address
carries no version, so a release checks the frame by hand.

### Sienna

The pages are built on Sienna, the project owner's design system, which is made for pages
without a framework. Four of its files are copied into `src/labs-ui/sienna/` unchanged:
`bundle.css`, `bundle.js`, `index.d.ts` and `tokens.json`. `sienna.lock.json` records the
version they were copied at, where each came from and its SHA-256, and `sienna.test.mjs`
holds each file to its hash and the console's own stylesheet to Sienna's tokens. The build
compiles the tokens for both themes and leaves out the stylesheet's import of web fonts,
which the console's policy does not allow; the three font families are served by the
console itself (`src/labs-ui/fonts/`, recorded in `fonts.json`). Instrument Sans, the sans
family, publishes no Vietnamese subset, so accented Vietnamese letters and every Japanese
letter of a sans text come from the next family of Sienna's stack on the user's system; a
family that covers both would be a change of Sienna, not of the console.

To take a newer version of Sienna, copy the four files over the old ones, write the new
version and the four hashes into `sienna.lock.json` (with the version `sienna.test.mjs`
expects), and rebuild with `npm run build`.

## Opening a diagram in draw.io

`cli.mjs open` (`open-drawio.mjs`) and the console's Open in draw.io show a run's draw.io
file in draw.io. What the user sees is in `README.md`; this section is why it works this way.

- **Routes, in order.** A cloud session is refused (`cloud-session`): a browser on the
  user's device cannot reach its machine. Linux without `DISPLAY` or `WAYLAND_DISPLAY` is
  refused (`no-display`): draw.io desktop would run under `xvfb-run`, which `drawioCommand`
  uses for exports, in a window nobody sees. Then draw.io desktop, found by
  `findDrawioBinary` and started detached with the run's own file, so a save there lands in
  the run and the next revise reads it as a hand edit (`drift`). Last, the web: an opener
  page in the default browser, started with an argument list (`/usr/bin/open`, `xdg-open`,
  `%SystemRoot%\explorer.exe`), never a shell string. `cmd /c start` was the first choice and
  was dropped: cmd reads `&`, `^` and `%` in a temp path that holds such a user name, and a
  bare `cmd` is looked up in the working directory before PATH. draw.io desktop is started
  without the `--no-sandbox` of a headless export, since this is the window the user edits in.
- **The diagram never travels in an address.** A `#R` fragment would carry it, but a run of
  five diagrams already passes the 8,191 characters of a Windows command line once it is
  handed to `cmd /c start`, and the whole diagram would sit in the browser's history.
  draw.io's embed protocol (`drawio-embed.mjs`) posts it instead: the embed page sends
  `init`, the host answers `load` with the XML, Save comes back as `save` and is answered
  with `status` to clear the unsaved mark. A file of 872 KB and 74 pages loads this way
  behind an address of 79 characters. A message is taken only from the embed window and
  only from the embed origin, the same rule as the viewer frame's.
- **The host is `embed.diagrams.net`**, which sets no `frame-ancestors`: embed mode on
  `app.diagrams.net` shows a notice that it will stop working there.
- **The chat's opener page** frames the embed page, because a page the OS opener started has
  no user gesture and a popup would be blocked. A trial on 2026-11-18 loaded the real host
  in a frame of a `file://` page and saved through it. Should the host stop answering in a
  frame, the page shows, after 20 seconds, a button that opens it as a popup (the click is
  the gesture) and a download of the file. The page holds the diagram in a JSON block of
  its own (`<` written as `\u003c`), allows its one script by hash, frames of the embed host
  only and no connection, and lives under `zukai-open/` in the temp folder (0700, the page
  0600, checked to be the user's own folder and no link) until an `open` a day later
  removes it. A browser confined by snap or flatpak (Firefox and Chromium as Ubuntu ships
  them) has a `/tmp` of its own and cannot read the page; `open` cannot see that and reports
  `opened: web`. `--desktop`, or a browser that is not confined, is the way there.
- **The console opens a popup from the click** and fetches the file meanwhile; the bridge
  waits for it before it answers `init`. Its own page and `CONSOLE_CSP` are unchanged: a
  popup is a navigation of a new window, which the policy does not govern, and the popup,
  of another origin, cannot read the console's storage. The server names the embed origin
  in `/api/state` (`drawio.embed`), so the console opens the same host as the CLI.
- **What is not done.** Save on the web downloads the file; writing it back into the run
  would be a job, left for later. Mermaid is not opened: a later resolver can map a `.mmd`
  to a page that renders it, without changing `open`, `--check` or the closing question.
  The embed page is unversioned, so a release opens one run on the web by hand.

## Runs folder and run index

A project's runs live under one folder, `diagrams/` unless `.zukai/config.json` says
`{"config": 1, "runsDir": "<folder>"}`. `project-config.mjs` holds the only resolver,
`runsPath(root)`, and every reader and writer of runs asks it: the console's listing
(`labs-runs.mjs`), `labs holds` through `projectOfRun`, which finds the project whose runs
folder holds a run folder (the nearest setting above it, else a parent named `diagrams`),
the hints that name a run folder, and the skills, which run `runs-dir` once at their start
(`references/closing-contract.md`). It is read on every call, so a changed setting reaches a
running console without a restart. When a setting above a run cannot be read,
`projectOfRun` throws instead of guessing, so `labs holds` exits with `bad-config` rather than
answering "not held" for a run a console job may hold; the console redraws a page that was
built before its first state named the folder. The setting is a project file and not a user one because
the runs are part of the project: committed, reviewed and shared with the team, and found by
every teammate's agent in the same place.

The folder must lie inside the project. The sources record stores its root relative to the
run folder (`sources.mjs`), the server looks runs up only below the project, and a runs
folder outside it would leave git and the team; a link that leads out is refused for the
same reason, as are `.zukai/` and `.git/`. A setting that cannot be used (unreadable, not
JSON, an unknown `config` number, a bad `runsDir`) is `bad-config` everywhere, never a fall
back to `diagrams/`: runs written into the wrong folder fail silently and far from their
cause, a refused command fails at once and names the file. `/api/state` carries the error
instead of failing, so the console can say what to fix. `runs-dir set` writes the file
through a temporary sibling and keeps its other keys; it never moves runs, since a move is a
change to the project the user should make and review.

The run index answers "which diagrams do I have, in which project" across projects. It is a
cache in the user's home (`ZUKAI_HOME`, else `%LOCALAPPDATA%\zukai`, else `~/.zukai`;
`run-index.mjs`) that holds the real path of each project root and when it was last seen,
nothing else: `index list` reads the runs from each project's runs folder every time, so the
index never holds data a run folder does not, and losing it loses nothing that
`index rebuild --scan` cannot find again. The commands that write runs (`bundle`,
`snapshot`, `restore`, `sources`) and `labs start`, `runs-dir set` and `runs-dir` (when the
project holds runs, so a skill that wrote with file tools is still seen) register their
project after they printed their result; registering swallows every error, so the index
never changes a command's output or exit code. A write reads the file right before it
renames a temporary sibling into place, and drops the projects whose folder is gone; a
project whose setting is being edited or whose drive is not mounted keeps its entry. A file
written by a newer version, or one that cannot be read, is never replaced: another install
channel may be newer. Two sessions writing at once lose at most one entry, which their next
command adds back. Reading never writes. `ZUKAI_INDEX=off` stops both.

Storage in the plugin's install folder was ruled out (a version bump replaces it), and so
was `CLAUDE_PLUGIN_DATA` (the Codex and folder-copy installs have none). A runs folder shared
by several projects (a docs repository) is the next likely variant: `runsPath` and the
index's project list would stay, the inside-the-project rule and the relative root of the
sources record would change.

## Reports and templates

A report is a folder under the project's reports folder: `report.md`, `report.html`,
`report.json` (validated against `report-v1`), `assets/`, `<lang>/report.md` translations,
`drafts/` and `history/`. A folder is a report only when its `report.json` is valid. One
owner module per contract, as `glossary.mjs` owns the glossary:

- `reports.mjs`: listings, `newReport`, the record, revisions, drafts, the line diff, the
  prose blocks, `checkReport` and `renderReport`.
- `report-templates.mjs`: scopes, `validateTemplate`, resolution nearest first, save, export,
  import, preview, and `renderWithTemplate`.
- `report-markdown.mjs`: the bundled `marked` with raw HTML shown as text, links kept only
  for `http`, `https` and `#`, pictures only from `data:` or the report's `assets/`, heading
  ids, and the section markers split out and stripped.
- `glossary.mjs`: `checkProse` beside `checkGlossary`; the prose boundary rule (a change of
  script at a match's edge is a word boundary) and the masking of an entry's own term apply
  to prose only, so label checks of runs are unchanged.

**Configuration.** `readProjectConfig` keeps `ok`, `error` and `runsDir` with their 2.6.0
meaning for its callers and adds `reports: { ok, dir, error }`; the two folders are checked
for overlap both ways. A bad `reportsDir` stops the report commands and the report routes
(409) and nothing else.

**Revisions with two writers.** The CLI the agent calls and the console's server both write
report revisions, so snapshot and restore run under `<report>/.revisions.lock` (the
glossary's lock), a temporary folder of another writer is removed only when older than ten
minutes, a report keeps 20 revisions, and a quick edit never rotates out the newest revision
it did not make. A polish draft records `baseRev` (the SHA-256 of the `report.md` it was
made from) and `draftRev`; `report apply` puts it in place only while both still hold.

**Secrets.** Every line of `report.md`, each translation and each draft is scanned on its
own, so one finding never hides another; a credential refuses every write the CLI or the
server makes and is a blocking finding of `report check` and `report render`, which also
scans the rendered HTML before writing it.

**Templates are untrusted input.** A project template can come with a clone and an import
from anyone, so every read and write validates it: the id pattern and no Windows device
name, the front matter and the sample against `report-template-v1`, placeholders that name
the template's own sections, an HTML layout without scripts, frames, forms, links,
`http-equiv`, `on*` attributes, foreign URLs, `@import`, `image-set`, backslashes or
character references in CSS, size caps and the secret scan. A scope folder (or `.zukai/`, or
the Zukai home) that is a link is never written. Built-in
templates are found only in the plugin layout or through a copied install's version marker.
Guides and samples are data for the agent, never instructions.

**The sealed report frame.** The console's policy (`style-src 'self'`) cannot show a
template's styles, so a report is shown in `report-frame.html`, a page with a policy of its
own: `sandbox allow-scripts allow-modals`, its one script by hash, inline styles and `data:`
pictures, nothing fetched, framed by the console only. The server keeps a policy per framed
page (the viewer and the report frame); every other page keeps the console's policy and
`X-Frame-Options: DENY`. The console makes a fresh frame per document and posts the HTML only
to that frame's window after its own `ready`; inside, links are inert and `print()` prints
the report alone. Every `report.html` also carries `default-src 'none'; style-src
'unsafe-inline'; img-src data:` in a `<meta>` written right after the doctype, before any
markup of the layout, so no comment, `<title>` or `<style>` of a template can move it out of
the head. A report folder whose `report.md` is missing or a link is listed as broken, and
no read of a report follows a link.

**The exceptions to "every change is a job".** The server writes a report's Markdown for a
quick edit and a restore only, each after a snapshot, with a `rev` check, and refused while a
report job is queued or open for that report or a polish draft waits. It also removes a draft
the user discards and imports a template after validating the whole file. Writing,
polishing, translating and template drafting are jobs: `report-write`, `report-polish`,
`report-translate` and `report-template`, routed by the labs skill to the report skill. A
report job names its report in `reportName`; `report` keeps its meaning, the agent's closing
text. The change stamp of `/api/state` hashes the reports too, so the views reload when the
agent writes.

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
`pipeline.mjs`. A section of the labs console joins through one navigation entry in
`nav.mjs`, one view module, one route group of the server and one job kind with its row in
the labs skill's job table; the Glossary section was added that way, as the second after
Diagrams. Overview and Jobs joined the same way and needed no route or job kind of their own:
they read `/api/state`, `/api/runs` and `/api/jobs`, which the server already had. Reports
joined as the third with one entry, four view modules (list, report, new report,
templates), one route group (`/api/reports`, `/api/report-templates`) and four job kinds
with their rows in the labs skill. A report kind needs no code: a template (three files)
is a new kind, in the project, user or built-in scope.

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
as a user would, one scenario per fixed defect of the 2.0.3 end-to-end report. `install.test.mjs` checks that the six skills are installed side by side, the CLI of the copy finding the built-in report templates, and `install-ps1.test.mjs` runs `install.ps1` through the same cases and more when PowerShell 7 is found (`pwsh` on PATH or `ZUKAI_PWSH`), comparing on macOS and Linux the tree it leaves with the one `install.sh` leaves, file by file. For recook,
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
renderer is installed and is skipped without one. `drawio-desktop.test.mjs` holds draw.io
desktop to how it behaves: the failure text taken from what draw.io 26 prints, stand-ins
for draw.io and `xvfb-run` for a missing display, an export that fails with exit code 0
and an image an earlier preview left; with a draw.io desktop installed it also previews
and exports a run with it. `usecase.test.mjs` covers the schema, the
reference and model checks and the geometry of the layout, and `usecase-e2e.test.mjs` takes
the kind through the bundle: validate, emit, a run with a linked part, the revise commands
and a recook of its own file. `gcp-icons.test.mjs` runs the catalog generator on palette
excerpts, checks the committed catalog against the reference page name for name, and holds
a GCP diagram and one on both clouds to the geometry rules of the AWS ones (titles clear
of connections, members inside their frames, stores beside their users);
`gcp-e2e.test.mjs` takes such a diagram through the bundle on every target and checks that
an AWS diagram comes out exactly as before.

For the glossary, `ir-labels.test.mjs` holds `labelsOf` to every label of every kind with
its place, `glossary.test.mjs` covers the schema and its limits, the written form of the
file, the lock, the comparison, the pairs and the check, and `glossary-e2e.test.mjs` runs
every `glossary` command through the bundle, with the terms the scan refuses and two adds
started together. For the console, `labs-runs.test.mjs` covers what the server
reads about runs and that it writes nothing; `labs-server.test.mjs` sends every route the
requests the checks must refuse (no token, a wrong one, a foreign `Host` or `Origin`, a
body that is not JSON, `OPTIONS`) and compares the policy headers character for character;
`labs-lifecycle-e2e.test.mjs` starts, reuses, reports and stops a server through the
bundle, with its idle end and the refusal of a cloud session, and the Windows job of CI
runs it too; `labs-jobs.test.mjs` covers the job states,
the parameters of each kind, the questions and the contact rules; `labs-bridge-e2e.test.mjs`
takes jobs through `labs wait`, `ask` and `done` in the bundle. `labs-ui.test.mjs` runs the
console's modules in jsdom, `labs-ui-e2e.test.mjs` drives the built console and the viewer
frame in Playwright's Chromium and is skipped without Playwright, and `sienna.test.mjs`
holds the copied Sienna files to their lock. For `open`, `open-drawio.test.mjs` covers the
bridge (a message from another window or origin is ignored), the opener page and its policy,
the file each run shape stands for, the route on each platform, the private folder and its
cleanup, and a `--check` that writes nothing; `open-drawio-e2e.test.mjs` runs `open` through
the bundle with stand-ins for draw.io desktop and the browser opener, and in Playwright loads
a file of every fixture through the opener page against `embed-stand-in.mjs`, a local page
that speaks the embed protocol (the real host refuses headless browsers), with Save and the
popup route; `labs-ui-e2e.test.mjs` takes the console's button through the same stand-in.
`bundle-drift.test.mjs` also holds
`bin/labs-ui/` to a fresh build, file for file, within its size budgets.

For the runs folder, `project-config.test.mjs` covers the default, the setting, every value
the rule refuses (a link out of the project and into `.git/` included), `bad-config` for each
kind of bad file, `projectOfRun` with a nested project, and `runs-dir set` keeping the other
keys and naming the runs left behind; `cli.test.mjs` runs `runs-dir` and `runs-dir set`
through the bundle with their refusals. `labs-runs.test.mjs`, `labs-server.test.mjs` and
`labs-ui-e2e.test.mjs` run once with `diagrams/` and once with a project whose setting names
`docs/diagrams` (`labs-project.mjs`, `RUNS_DIRS`), the server also with a setting that cannot
be used, and `labs-ui.test.mjs` holds every view that names the folder to the state's
`runsDir`. For the index, `run-index.test.mjs` covers its place on each system, one entry per
project, the private modes, a dead project dropped on write and never on read, a corrupt
file, the opt-out, a write that fails, and the scan; `run-index-e2e.test.mjs` takes two
projects through the bundle, deletes one, deletes the index and rebuilds it from a scan, and
checks that a failing write leaves the output of `bundle` byte for byte as it was.
`tests/setup-index-home.mjs`, loaded by `vitest.config.mjs`, gives every test file a
temporary `ZUKAI_HOME`, which the CLIs it spawns inherit, so no test writes the index of the
person running it.

For reports, `report-markdown.test.mjs` holds the renderer to its rules (raw HTML as text in
a paragraph and a table cell, `//host` and `javascript:` refused, a `../../` picture not
inlined, heading ids, markers in code left alone); `reports.test.mjs` covers the folder
contract, the listing that counts only valid records, revisions (exact bytes back, the
rotation guard after a storm of quick edits, the age rule of temporary folders), drafts and
their conflicts, the diff sides looked up in listings, render with the policy first, embeds,
and the per-line secret scan; `report-templates.test.mjs` covers the built-in templates,
their discovery in the plugin and a copied install, every refusal of an untrusted template,
the scopes, save with its link check, and export and import; `glossary.test.mjs` adds the
prose cases (Vietnamese diacritics, Japanese without spaces, `サーバー` and `サーバ`, the
keep rule, a dropped section). `reports-e2e.test.mjs`, `report-templates-e2e.test.mjs` and
`report-check-e2e.test.mjs` run the commands through the bundle: a bad `reportsDir` beside
working run commands, a 2.6.0 project with `runsDir: "reports"`, two snapshots at once, a
report-only project in the index, installs by `install.sh` and `install.ps1`, and the exit
codes of `report check`. `labs-reports.test.mjs` runs the report routes on a real listener
(rev conflicts, held writes, query values looked up, the import dry run, the frame's policy,
the change stamp, a bad `reportsDir` beside working run routes) and the four job kinds;
`labs-ui.test.mjs` and `labs-ui-e2e.test.mjs` cover the Reports views and the sealed frame.
