# Target: draw.io

Emits an uncompressed `.drawio` file (mxGraph XML) in which every node, container, edge and
edge label is an individually selectable, movable shape. No draw.io binary is needed: graph
shaped kinds are laid out by the bundled ELK engine, sequence diagrams by a fixed grid.

## Run

`<skill-dir>` is the directory that contains the `SKILL.md` you loaded. The working
directory is the user's project, so pass absolute paths.

```bash
node "<skill-dir>/scripts/bin/cli.mjs" emit --to drawio ./diagrams/order-checkout.ir.json --out ./diagrams/order-checkout.drawio
```

- Exit 0: the file was written. stdout holds `{"ok":true,"out":"<path>","warnings":N}`.
- Exit 2: validation or feature-matrix errors as JSON on stderr. Fix the IR, run again.
- Exit 1: the input could not be read or the output could not be written.

Warnings arrive as one JSON object on stderr (`{"warnings":[...]}`). Show every warning to
the user verbatim; never drop one. For draw.io every v1 feature is `supported`, so the
usual warnings come from the secret scan.

## Combined file for a run

```bash
node "<skill-dir>/scripts/bin/cli.mjs" bundle --to drawio --out ./diagrams/<yyyymmdd>_<run-slug>/<run-slug>.drawio --title "<feature>" ./diagrams/<yyyymmdd>_<run-slug>
```

Writes every diagram of the run into one file (one named page per diagram, each page headed by its title). Given the run folder, the CLI takes the IRs of its `source/` in run
order: the main diagram (the one named after the run), its business view, then each part
followed by its business view; the result lists that order. IR files given one by one are
taken in the order given, which is how a subset is bundled; a shell pattern such as
`source/*.ir.json` is not that order (it puts the parts first). Every IR is validated before anything is written; errors and warnings carry the
`diagram` id they belong to. Individual files in `drawio/` stay the reusable copies.

Inside the bundle an element with `ref` (a flowchart node, an activity action, a sequence
message, a state, an architecture component, a class or an ER entity) shows the referenced
diagram's title (`↳ <title>`) and is a draw.io page link: clicking it opens that page. The diagram id a `ref` names is the IR
file name without `.ir.json`, so `ref: "login-01-mfa"` resolves when
`source/login-01-mfa.ir.json` is in the bundle. A `ref` the bundle does not hold keeps the
slug text, gets no link, and the CLI warns (`ref "<slug>" is not in this bundle`). A single
`emit` has no bundle to resolve against, so it always shows the slug, without a warning.

### Canvas page

```bash
node "<skill-dir>/scripts/bin/cli.mjs" bundle --to drawio --out <run-folder>/<run-slug>.drawio --title "<feature>" --canvas all --gap 120 <run-folder>
node "<skill-dir>/scripts/bin/cli.mjs" bundle --to drawio --out <run-folder>/<run-slug>.drawio --title "<feature>" --canvas login,login-01-mfa <run-folder>
```

`--canvas` adds a first page, named after `--title` (or `Canvas`), that holds the listed
diagrams side by side: left to right in the given order, top-aligned, `--gap` pixels apart
(default 120), each under its own title. `all` takes every diagram in bundle order; a
comma-separated list of diagram ids (IR file names without `.ir.json`) takes a subset, and an
unknown id is an error. The diagrams still get their own pages after the canvas, so page
links from `ref` steps keep working from both. Edges and lane children move with their
diagram; the output is deterministic, so re-running `bundle` reproduces the file. The option
is draw.io only: the Markdown bundle already shows every diagram in one document.

## Language variant with the layout kept

```bash
node "<skill-dir>/scripts/bin/cli.mjs" relabel <file.drawio> --map <labels.json> --out <file.<lang>.drawio>
```

Applies a JSON map of IR id (or `<diagram id>:<ir id>` for one page of a bundle, `title`
for the page title, `canvas:title` for the canvas page; a label on a line is keyed by the id
of its edge, message or flow) to new label text. Ids and geometry are untouched, so manual edits and
the layout survive; a leading `«stereotype»` line and a bold title are kept, and the
`↳ <sub-diagram>` line of a `ref` step follows the target page's new title when the map
has `<target id>:title`. Hand-copied cells (generated ids) get the translation of a replaced
cell with the same source text; every labelled text still untouched is listed once with
the places it occurs (`untouched` on stdout, one summary line among the warnings), except
labels without letters and texts named in the map's `$keep` list. Each changed page records
the labels it was laid out for, so `drift` does not take the kept layout for hand edits. Boxes are not resized: a label that wraps to more lines than its box holds, has an
unbreakable word wider than its box, overflows a non-wrapping box, no longer fits inside
a decision's rhombus (measured at the wrap width its label spacing leaves), or, for a name
drawn below a client's screen figure, takes more lines at its wrap width than the old name did (by
the text widths and word wrap of the layout rules below) is one `layout:` warning per cell across pages, and keys
that matched nothing are listed. Compressed
input is accepted; the output is always uncompressed. The whole protocol, including the
business-audience variant, is in `variants.md`.

## Preview

```bash
node "<skill-dir>/scripts/bin/cli.mjs" preview ./diagrams/order-checkout.drawio --max-px 1600
```

Renders a PNG into the system temp directory and prints `{"ok":true,"preview":<path>,
"files":[...],"tiled":false,"scale":2,"renderer":...}`. `--max-px <n>` caps the longest side
of every PNG at `n` pixels, border included, with both renderers (draw.io desktop re-exports
at the fitting scale). A diagram at least twice as tall as it is wide (or the reverse) that
would shrink below scale 0.6 is instead cut into tiles `<name>-1.png`, `<name>-2.png`, ... at
scale 1 (draw.io desktop exports once at scale 1 and the PNG is cut), all the same length and
overlapping by the largest node (`overlap`, px) so every node is whole in at least one tile;
all are listed in `files`, so the reviewer opens each. The image is for your own inspection, not for the user; do not mention or
offer it. The renderer is draw.io desktop when its CLI is on `PATH` (offline), else
Playwright with Chromium loading draw.io's viewer page in a local browser (the XML is rendered
locally; only the page itself is fetched). Exit 1 with a hint when neither is installed; the
step is optional and `docs/install.md` says how to set a renderer up. Look at the PNG as
described in `SKILL.md` before reporting.

## Where the output goes and how to open it

Write next to the IR file with the `.drawio` extension unless the user names a path. The
file opens in draw.io desktop, in the VS Code draw.io extension, and at
https://app.diagrams.net (File > Open from > Device). Shapes stay editable after opening:
labels, styles and positions can be changed, and because the file is uncompressed the XML
is diffable in git.

Layout is automatic and deterministic: the same IR gives byte-identical output. If a wide
graph reads badly, flip `direction` in the IR (`TB` to `LR`) and emit again rather than
moving shapes by hand, so the IR stays the source of truth.

## What the emitter produces

| IR element | draw.io shape |
|---|---|
| flowchart `process` / `terminal` / `decision` / `io` / `subroutine` / `note` | rectangle / rounded rectangle / rhombus sized so the question stays inside its slanted edges / parallelogram / process (double bar) / note |
| flowchart `group`, architecture `boundary`, composite `state` | `swimlane` container; children are positioned relative to it |
| state `initial` / `final` | UML start and end state circles |
| self-transition or self-edge (`from` = `to`) | a loop 30 px out of a side that is across the flow, where no other edge of the shape ends, and back in. Top-down and bottom-up: out of the right side, with the label right of the loop. Left-to-right and right-to-left: over the top, with the label centred above the loop, so it never lies on the arrowhead of an incoming edge; several loops of one shape are nested there, each under its own label. The layout reserves the room next to or above the shape, inside composites too. An ER self-relation keeps the side its rows decide. A class relation with itself shows its cardinalities at the two ends of the loop |
| flowchart edge | the lines of a decision meet its rhombus at the tips, never on a slanted edge: every branch leaves through the tip the flow points to as one line that splits where the branches part, every line that arrives ends at the opposite tip, a branch that leads back leaves through a side tip. Each branch label (`yes`, `no`) has a place of its own in the first layer after the decision, past the split, on the line of its branch alone; when a branch leaves a group first, that layer lies beyond the group, and the label moves back to the place just past the split when no step, line, label or group border is there; the label of a branch that leads back stands beside the side tip. An edge that leads back to an earlier step of a loop (inside one cycle, from a node to one written before it in `nodes`) is laid out against the flow: the steps of the loop stand below one another in the order they were written and the return line runs up beside them |
| flowchart group, plain architecture boundary | a frame with its title centred in the header; when a line crosses the header there (a flow or connection that enters from above), the title moves along the header to the nearest free stretch, and a frame with no stretch long enough is widened, so no line runs through a frame title |
| ER entity, class | `swimlane` table with one child row per attribute or member (stack layout); a member wider than the table wraps and its row grows, so nothing is clipped |
| ER relation | laid out twice: the first pass decides for each end the side and the row (the FK named by `fromAttribute` / `toAttribute`, else the one FK whose name contains the other entity, for a self-relation the one FK that names no other entity, else the header band, which grows 20 px per extra anchor on its left or right side; anchors on the top or bottom side are spread across the width and leave the header as it is); the second pass gives ELK those anchors as fixed ports, so its routing and crossing avoidance hold in the file; a self-relation loops on the side with fewer ports |
| flow edge crossing (flowchart, state, architecture, activity) | `jumpStyle=arc`: where two lines cross, the upper one is drawn with a small arc over the other, so a crossing cannot be read as a junction; lines that share a stretch or part at a junction get no arc |
| stretch before an arrowhead (flowchart, state, ER, class, architecture) | a line turns, or joins another line into the same shape, at least 25 px before it ends, inside a group, composite state or boundary as much as outside: every container repeats the layout's spacings, which ELK does not hand down to it, so the arrowhead never sits on a bend or a junction |
| graph edge (flowchart, state, ER, class, architecture) | written with ELK's waypoints and with fixed exit and entry anchors taken from ELK's end points, so draw.io never re-routes an edge at render time; a label beside a vertical segment (self-loops included) is anchored on the line and left- or right-aligned at a 4 px gap, a label at a horizontal segment sits 4 px above or below it |
| ER relation | orthogonal edge with crow's-foot ends (`ERmandOne`, `ERzeroToOne`, `ERzeroToMany`, `ERoneToMany`); non-identifying relations are dashed |
| class relation | orthogonal edge: hollow triangle (inheritance, dashed for realization), filled or hollow diamond at the whole (composition, aggregation), open arrow (association, dashed for dependency). A cardinality is anchored at its own end of the edge with a pixel offset: it starts 6 px past the end marker (24 px diamond, 16 px triangle, 10 px open arrow) and sits 5 px beside the line, right of a vertical segment or above a horizontal one. When a class, a line, a marker or another label is in the way it takes the other side, then moves along the line in 10 px steps (round a bend when the first segment is short), up to 30 px further; when no place is free the emit reports a `layout:` warning that names the relation |
| architecture component `service` / `database` / `queue` / `cache` / `client` / `external` | rounded rectangle / cylinder / hexagon / dashed cylinder / screen figure (draw.io's `mxgraph.networks.monitor`: a client is an application, not a person) / dashed rounded rectangle; parallel connections leave 20 px apart and each label sits where the layout engine placed it on its own edge. A `client` is a 54 x 44 figure with its name below it: the name wraps at its own width (`labelWidth`, at most 160 px, balanced lines), and the layout reserves the figure plus that block, so a boundary frame contains the name and the next actor starts below it. Clients in one boundary share a centre line. The layout runs twice for a diagram with clients: the first pass shows which side of a client each connection uses, the second gives those ends fixed ports within the figure's extent, evenly spaced. A connection from the side therefore attaches to the figure, several of them apart from each other, and one that leaves downwards starts under the name on the figure's own column (a pixel offset with `exitPerimeter=0`), never through it |
| architecture component with `icon` | the AWS service icon of draw.io's built-in AWS library (`shape=mxgraph.aws4.resourceIcon`), 78 x 78, in the colour of its service category, with the name below it; laid out like a `client`: the layout reserves the icon plus the name, icons in one boundary share a centre line, and a connection attaches to the icon, never to the name. It replaces the shape of the `kind`. A general resource of the same library (`aws:generic_application`, `aws:traditional_server` and the others under "General Resources" in `aws-icons.md`) and a product logo (`gcp:firebase`, from draw.io's GCP library) are stencils of their own (`shape=mxgraph.aws4.<name>`, `shape=mxgraph.gcp2.<name>`): drawn in one colour without the coloured square, at the proportions of draw.io's palette with the longer side 78 px, and laid out like a service icon. They are what a system outside AWS is drawn with |
| architecture boundary with `group` | the AWS group frame of that library (AWS Cloud, account, region, VPC, public or private subnet, Availability Zone, security group, Auto Scaling group and the others in `aws-icons.md`) with the palette's own colours, as a container; at least as wide as its title on one line, with 12 px between the frame and its members (a plain boundary keeps 20 px; AWS diagrams nest four or five frames and the room adds up). The title stands beside the corner icon (centred on a frame without one, such as an Availability Zone); when a connection crosses the top of the frame there, the title moves along the top to the nearest free stretch, and a frame with no stretch long enough is widened, so no connection runs through a frame title. The Auto Scaling group has its icon in the corner like the other frames, not centred as in draw.io's palette. In a diagram with AWS icons or frames, a component whose one connection comes from an icon in the same frame that also passes work on (a database beside the service that writes to a queue) stands beside that icon, across the flow, on one straight line: below it in a left-to-right diagram, to its right in a top-down one, so the connection that goes on keeps its row and does not bend round the store; a second such store of the same component stays in the flow. A connection label that lies inside a tinted frame (a public or private subnet) is written on the colour of that frame instead of draw.io's white, so it hides its line without showing as a box. Every connection label of such a diagram is placed beside its own line after the layout, at the middle of a stretch of its longest segment (above or below a horizontal stretch, left or right of a vertical one), where it lies on no component, name, other label, other line or frame border; the layout therefore keeps no layer free for labels and the components stand as near each other with labelled connections as with plain ones. A label with no free place beside its line gets a place of its own from the layout, as in a plain diagram. In the same kind of diagram, a plain component outside every frame that one component inside a frame calls (a third-party API) stands beside the frames, level with its caller, joined by one straight line across the flow: to the right or left of the frames in a top-down diagram, below or above them in a left-to-right one, on the side where the line runs through no other component, name, label or unrelated frame and along no other connection. When no side is free, or the system has several connections, it stays in the flow and is placed at whichever end of the frames gives the shorter connection: the layout tries the other end and keeps it when the connections come out at least a fifth shorter, so a system called from the middle of a frame does not end up beyond the far end with its line running past everything in between. The arrow keeps the direction of the IR. A system outside every frame that is only called, and called by a component that is itself outside the frames (a browser that talks to an identity provider the API also uses), stands in a row along the frames instead, across the flow from them (below or above in a left-to-right diagram, right or left in a top-down one) and between its callers along the flow, so the client's connection no longer runs the length of the picture to a system at the far end. The same row takes a system that calls into the frames and is called from them, when those connections form a circle (a partner system that pushes data to the load balancer and that the service queries in turn), or when a component in the frames calls it and it calls another one further down the flow (a function calls a partner API, which calls the load balancer), a circle through the frames as a whole: at either end of the flow one of its connections would run back past everything, in the row it stands between the components it talks to and each arrow keeps the direction of the IR. A system and one component that call each other, written as two connections, stand level with each other and are joined by two straight lines side by side, 20 px apart, each with its own arrow and label. A system the flow merely passes through (called from outside, calling in) is on no circle and stays in the flow. Each connection leaves its caller straight across the flow, out of the frames, and turns into the row; when another component, a label or a line running the same way stands in that way, it leaves the caller sideways first and takes the nearest free column. The connections of one caller share the stretch out of the frames; every run along the row has a track of its own, the one that runs farthest nearest the frames, and its label stands on a stretch that is that line's alone (the run, or the last stretch into the system), so no label can be read as another line's. The figures of a row stand on one line, whatever the length of their names, and a system that one component alone calls, which stands beside the frames level with that component, moves out into the row when one forms on its side, its straight line growing with it: the systems outside the frames on one side are never staggered. A system whose caller has no free way out on either side, or whose label finds no place, stays in the flow as before. The main flow runs through the middle: when a component that fans out to three or more others would stand level with the first or the last of them (the default inside a frame, which keeps its members close together), or when such a component would stand in the outer quarter of the picture with everything else on one side of it, other arrangements are tried: the frames laid out with the placement of the page itself, which puts that component level with the middle of its fan, and each column ordered to cross the fewest lines instead of following the order of the IR. The arrangement whose hubs stand nearest the middle of their fans and of the picture is kept when it is clearly better; a diagram whose hubs already stand near the middle keeps the usual, compact form and the order of the IR. A system outside the frames with an icon is placed by the same rules as a plain one (a client is not: it is where the flow starts). The shapes are draw.io's own stencils, not images: nothing is embedded, each stays editable, and they need a draw.io that has the AWS library of version 32.6.10 or newer for every name (older builds show an empty box for a service added since). |
| sequence participant | `umlLifeline` with a plain head, 120 px wide or as wide as the longest word of its label needs; `actor` adds a stick figure above the head, `boundary`, `control`, `entity` and `database` show the kind as a `«stereotype»` line above the label (draw.io's robustness glyphs were tried and read as stray arrows) |
| sequence message | horizontal edge between lifelines: filled arrow (sync), open arrow (async), dashed open arrow (return); self-messages loop out to the right and back with both ends anchored on the lifeline's centre line |
| sequence block | `umlFrame` behind the messages it covers, wide enough for the notes attached to them, 12 px below a frame that ends just before it; its tab text and each `else` / `and` label are opaque cells drawn above lifelines and activations |
| sequence note | note shape on the row after the message it follows; its text keeps 12 px from the left border and 18 px from the right one, clear of the 14 px folded corner, and the note is as tall as the lines its text wraps to |
| sequence activation | starts at a sync call and ends at the return to the caller; a return inside one branch of an `alt` or `par` keeps the activation open to the last message of that participant in the block; a return in a block the call is not in (an early exit in an `opt`, a reply in one branch) leaves it open while the participant goes on working, up to its next return to the caller |
| sequence message label | white background, so a lifeline it spans does not cut the text |
| activity lane | full-height coloured `swimlane` column (lanes side by side in IR order, header and body tints from a fixed palette); rows follow the flow order, nodes of a lane sit in its column, flows are routed through the row gaps and lane gutters on separate tracks per target, ordered so branches do not cross, and flows into one node merge into a trunk; a merge fed by long flows down a lane gutter sits on that gutter's side of its row-mates, and a node whose next step is in another lane sits on that lane's side of them; a long edge runs straight down its own column when that column is free, else along the lane edge that no cross-lane flow cuts; a crossing that lanes force is reported as a `layout:` warning |
| activity control `initial` / `final` / `decision` / `merge` / `fork` / `join` | UML start and end circles / rhombus with the question, sized so it stays inside the slanted edges / small rhombus / thin filled bars (horizontal for `TB`, vertical for `LR`) |
| edge label | child cell of the edge (`edgeLabel`, not connectable), so it moves with the edge |
| node or action with `ref` | subroutine shape; in a bundle the label's second line is the target title and the cell is a `UserObject` with `link="data:page/id,<page id>"`, draw.io's page link |
| message, state, component, class or entity with `ref` | keeps its own shape; the title line and the page link are the same as for a node. A message's row grows by one label line, so the title stands above its own arrow, and the linked edge is a `UserObject` around the edge cell; a class, entity or composite state header grows by one line, and by more when a long title wraps at the width of the table or of the composite |

Cell ids are `<page id>:<ir-id>`; derived cells add a suffix such as `:label`, `:row-0`
or `:actor`. The page id is the diagram id (the IR file name without `.ir.json`) in lower
case with every character outside `a-z0-9` as a hyphen, at its full length, so links between
pages stay stable across re-runs and two long names never share a page. `bundle` refuses two
IR files whose names give the same page id. Files written by 2.0.3 or older have page ids cut
at 40 characters; `drift` and `relabel` read them as they are.

## Layout rules

- Node size: width is the widest label line plus 4 % of room and 24 px of padding, clamped
  to 120 to 260 px; height is 40 plus 20 per extra line; tables add 26 px per row. The rule
  lives in one function (`measureNode` in `scripts/src/layout-graph.mjs`). Labels wrap
  inside the shape (`whiteSpace=wrap`), and the height grows by one line height per wrapped
  line at the clamped width, so a long label gets a taller box instead of spilling onto its
  arrows.
- Text width: a line is measured by its glyphs in draw.io's default font, Helvetica at
  12 px (`scripts/src/text-metrics.mjs`): `i` is 2.7 px, `n` 6.7 px, `W` 11.3 px, a CJK or
  full-width character 12.3 px, a letter with diacritics as wide as its base letter, bold
  headers by the bold face. A text is broken into lines where draw.io breaks it (`wrapText`):
  at spaces, between CJK characters, and inside a word after a hyphen, a dash or a `?` that
  a letter or a digit follows (`acme-corp`, `0-5`, `/find?id=1`), but not at a no-break
  space, a slash, a dot or an underscore, nor after a sign (`-5`). So a line the author broke by
  hand counts once when it fits, a long hyphenated name counts every line it is spread
  over, and a box is as tall as the lines draw.io renders. A box
  cut to one line gets 4 % more than the measured width, because renderers differ from the
  font's own widths by a few percent; the lines of a box at the width cap are counted
  without that margin, since a line that wraps after all still has room in the box. A long
  word with no place to break (an identifier, a path of slashes) does not wrap in draw.io:
  it stays on its line and runs over the box, so break it by hand or shorten it.
- Label padding: the 24 px are 12 px of clear space on each side of the text (`LABEL_PAD`),
  and the node styles draw them as `spacingLeft=10;spacingRight=10;` on top of draw.io's own
  2 px. The text therefore wraps at the width its height was measured for, and a line that
  fills that width stops 12 px short of the border and of an arrowhead that ends on it. A
  parallelogram (`io`) and a hexagon (`queue`) are narrower than their box by a 20 px slant
  (`size=20`), so their text keeps 22 px on each side and their box is 20 px wider for the
  same label. A cylinder's side walls are straight, so it keeps the 12 px. A subroutine has
  no extra spacing: draw.io already bounds its label by the side bars, which take a tenth
  of the width each, so its box is a quarter wider than its text. Decisions are sized by
  the next rule.
- Decision size: a rhombus is narrower than its box everywhere but the centre line, so its
  question is measured against the inscribed rectangle (a block `a` x `b` fits a `w` x `h`
  rhombus when `a/w + b/h <= 1`). The question takes the line count draw.io gives it in the
  plain box, wrapped at the narrowest width that still holds that count, so its lines are
  balanced; when the rhombus that holds that block would be wider than 340 px, the question
  takes one more line, and so on until the rhombus fits the cap or a line would be narrower
  than 100 px. A question on several lines gets `spacingLeft` / `spacingRight` so draw.io
  wraps it at the block's width plus the 4 % of room. Balanced lines matter because draw.io
  breaks a line at more places than the wrap here: at a wrap width that leaves one line
  nearly full it breaks at the last chance it finds, which can be a hyphen inside a value
  such as `0-5`, stranding the rest on its own line. The minimum stays 140 x 80
  (`measureDecision`, same file).
- ELK options: layered algorithm, direction from the IR, orthogonal edge routing,
  `hierarchyHandling=INCLUDE_CHILDREN` for edges that cross containers, root-relative
  edge coordinates. Node spacing 40, layer spacing 60 (60 and 80 for ER and class).
- Edges sit on the root layer with absolute bend points; nodes inside a container use
  coordinates relative to the container, as draw.io requires. Container children are never
  auto-stacked by draw.io (no `childLayout` on lanes), so ELK's placement is kept.
- Sequence grid: a lifeline's head is 120 px wide, and wider when a word of its label
  needs it: the head wraps a label at spaces but cannot break a word (a class or method
  name), so it grows to the measured width of that word plus 12 px on each side. Two
  neighbouring heads keep 60 px between them, which is 180 px from lifeline to lifeline at
  the base width, and the gap widens until every message label fits between the lifelines
  it spans. Every message, note, block
  header, `else`/`and` separator and block end has a row of its own (40, 48, 34, 30 and 16 px),
  so frame labels never sit on message labels. A note is 36 px tall for one line and 16 px
  taller for every further line its text takes when wrapped at its words inside the padded width;
  its row grows with it, so everything below a long note moves down. A block that opens right after another has
  closed starts 12 px lower, so the bottom edge of one frame and the top edge of the next
  stay two lines; nested frames and a frame after a separator are already apart. Notes take
  the gap beside their lifeline. A
  sync message activates the target until the matching return. A return that lies in a
  block, or in a branch of one, which the call is not in is taken on one path only, so the
  bar stays open after it for as long as the participant sends messages or gets returns: it
  ends at the next return to the caller, or at the participant's last message when no return
  follows. It ends at that conditional return when nothing follows it or the participant is
  called again first, and never later than the end of a block the call is in. Frames inset 16 px per
  nesting level. After placement the emitter checks every label and note box for overlaps and
  reports each one as a `layout:` warning.

## Alternative: draw.io's own Mermaid import

draw.io can also turn Mermaid text into editable shapes (Arrange > Insert > Mermaid in the
app, or `.mmd` input to the desktop CLI). That needs the desktop or web app and a manual
step, and the layout is draw.io's. Use it when the user wants draw.io's Mermaid styling;
emit with `--to mermaid` and paste. The native emitter exists so the skill produces a
file headlessly and controls layout.

## Verified behaviour

The research sample XML was not opened in a real draw.io at planning time. During
implementation every fixture output was opened in app.diagrams.net headlessly: each file
loaded without a dialog, every cell was selectable and movable, and the shapes rendered as
listed above. Deviations from the research that were applied: ER edges use orthogonal
routing with ELK bend points rather than `entityRelationEdgeStyle`, because that style
ignores waypoints; the actor figure is a separate glyph because a `umlActor` lifeline head
stretches to the lifeline width and paints the label over the figure.
