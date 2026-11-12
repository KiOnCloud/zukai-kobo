# End-to-end test of the FigJam target on real boards

Date: 2026-11-12. Branch: `claude/elegant-feynman-lkgx0p`. Base: 2.0.5 after the preview fix.

The earlier end-to-end rounds treated Figma as not connected. This round called the Figma MCP
server for real: `generate_diagram` for every diagram kind the FigJam target accepts, then
`get_figjam` and `use_figma` to read each board back and compare it with the IR and with the
draw.io file of the same IR. Labels sent were those of the repository fixtures.

## Outcome

Ten differences from the draw.io output were found. All ten are fixed and were verified
again on real boards. On the final board every label of the draw.io files of five fixtures
(flowchart, sequence, state, ER, architecture) was found again by a script that compares the
board, read back with `use_figma`, with the cell values of the `.drawio` files; every edge
read back joins the two elements the IR names. What still differs is listed at the end.

The suite passes: 32 files, 691 tests, 1 skipped (`npm test` in `skills/draw/scripts`).

## Boards

| Board | Content |
|---|---|
| https://www.figma.com/board/ye6g1TVoZZNhZN8eRwVMWx | Round 1, text of 2.0.5 unchanged: 10 diagrams |
| https://www.figma.com/board/57yIXc5rPkRWWSBSQoJFwf | Probes of which syntax Figma accepts (holds leftover probe shapes) |
| https://www.figma.com/board/i2LSJKDvR2hIGzlf66lFZ9 | Rounds 2 and 3, fixed text and first overlay script: 5 diagrams |
| https://www.figma.com/board/45AQFIpbiwRlA0biqsBxCY | Final round, committed bundle: one diagram per kind, compared label by label with draw.io |

They are test boards in the drafts of the team that was chosen for the run and can be deleted.

## Round 1: what the 2.0.5 text produced

| Fixture | Result |
|---|---|
| `flowchart/valid`, `flowchart/valid-refund-approval` | Pass. Every node, edge and edge label; nested groups as sections; shapes per kind |
| `architecture/valid`, `valid-aws`, `valid-bidi-fallback` | Pass. Boundaries nested four deep, every connection and label; a two-way connection has an arrow head at both ends |
| `er/valid-customers-orders` | Pass for content, cardinalities, dotted non-identifying lines and the self-relation. Laid out left to right although the emit said "top to bottom" (finding 4) |
| `er/valid` | **Fail.** Figma rejected the whole diagram (finding 3) |
| `state/valid`, `state/valid-self-loop` | **Fail.** Composite state mislabelled and detached (finding 2) |
| `sequence/valid` | **Fail.** Blocks, notes and the self-message missing (finding 1) |
| `sequence/valid-participant-kinds` | Pass for content; the actor is drawn as a box (finding 6) |

## Findings and fixes

1. **Sequence: blocks, notes and self-messages are not drawn.** `generate_diagram` keeps the
   messages of a `loop`, `alt`, `opt` or `par` block and drops the frame and its condition
   without a word; the matrix said `supported`. A message of a participant to itself (all
   four arrow forms were probed) leaves an empty row and a stray, unlabelled arrow outside
   the section. Notes were already known to be dropped.
   Fix: `emit --to figjam --overlay <file.js>` writes a script for the Figma tool
   `use_figma` (`src/figjam-overlay.mjs`). It checks the board against the model
   (participants, message labels, row spacing), throws before changing anything when they
   differ, then draws block frames with their conditions, `else` and `and` dividers,
   self-messages and notes, and removes the stray arrows. A second run replaces the first.
   A note is now written as a self-message of its first participant, which is what keeps a
   row free for it. The matrix marks blocks, notes and the new feature `message.self` as
   degraded, each naming the overlay script.
   Verified on the board of `sequence/valid` (loop around alt/else, one self-message, a note
   beside one participant and one over two) and of `sequence/valid-wrapped-notes` (three
   notes of up to two lines).
2. **State: a composite state is called "Label as n4" and a stray state "n4" appears.**
   Figma reads `state "Processing" as n4 {` that way; the transitions to and from the
   composite went to the stray state, so the composite stood detached.
   Fix: the figjam profile writes `state "Processing" as n4` and `state n4 {` on two lines.
   Verified: the section is named "Processing" and both transitions end at it.
3. **ER: a type with a comma makes Figma reject the diagram.** `decimal(10,2)` fails with
   `Expecting 'ATTRIBUTE_WORD', got ','`; the local Mermaid 12 parser accepts it, which is
   why no test saw it.
   Fix: the figjam profile writes the type name alone and puts the full type in the comment
   column, with a warning. Verified: row `decimal | total | | decimal(10,2)`.
4. **ER: the direction was not what the emit said.** The profile left the `direction` line
   out and warned that the diagram is laid out top to bottom; Figma lays an erDiagram out
   left to right by default and does read the line.
   Fix: the figjam profile always writes `direction` (default `TB`). Verified for `TB` and `LR`.
5. **Architecture: a two-way connection was reported as degraded.** The warning said the
   label gains "(both ways)"; the text has used `<-->` for some time and Figma draws both
   arrow heads. The matrix cell is now `supported`.
6. **Sequence: every participant is the same box.** The matrix said `supported` for an
   actor. draw.io shows a figure above an actor and a `«kind»` line for a boundary, control,
   entity or database participant. Fix: the overlay script draws both; the matrix says
   `degraded` and names the script. Verified on the final board.
7. **Sequence: no activation bars.** draw.io draws them, Mermaid text cannot ask for them in
   the form Figma reads. Fix: the overlay script takes the bars from the same layout code the
   draw.io emitter uses and draws them under the message arrows. Verified on the final board.
8. **ER: a relation without a label read "unnamed".** Figma accepts an empty label and draws
   none, as draw.io does. Fix: the figjam profile writes the empty label. Verified.
9. **Sequence: the label of a nested block lay under the next frame.** Found on the board of
   the stress fixture. Fix: a block inside another block gets a row of its own for its label.
10. **Sequence: a long note ran out of its box.** Fix: a note gets as many rows as its text
   needs.

## What was not known before and is now recorded

- Participant aliases (`participant n2 as Web app`) are shown correctly, although the Figma
  skill text says they are dropped.
- An ER attribute comment is shown, in a fourth table column.
- A transition from outside a composite to one of its children is drawn.
- The first `generate_diagram` call of a session asks for a team (`planKey`); the user picks it.

## Final comparison with draw.io

Two scripts compared the final board, read back with `use_figma`, with the sources; both
exit 0.

| Fixture | Labels in the draw.io file | Not found on the board |
|---|---|---|
| `flowchart/valid` | 14 | 0 |
| `sequence/valid` (after the overlay script) | 21 | 0 |
| `state/valid-self-loop` | 11 | 0 |
| `er/valid` | 21 | 0 |
| `architecture/valid-aws` | 24 | 0 |

An ER attribute is one cell in draw.io (`PK id: uuid`) and three or four table cells on the
board, so it is compared part by part.

Edges: the five IRs hold 39 edges (messages between two participants, transitions,
relations, flowchart edges, connections). The board holds 39 connectors with an arrow head,
each between the same two elements and with the same label; none is missing and none is
extra.

A sixth fixture, `sequence/valid-deep-blocks-long-note` (four blocks nested in each other,
a note of eight lines, three participant kinds), was added for the two cases the first
overlay script drew badly: the label of a nested block lay under the frame of the next one,
and a long note ran out of its box. Each nested block now has a row for its label and a
note has as many rows as its text needs; both were checked on the board by screenshot.

## Differences that remain

These cannot be closed from this side, because Figma decides them:

- Placement. `generate_diagram` lays the diagram out itself and takes no coordinates, so a
  board never has the geometry of the draw.io file. Figma sometimes lets two transition
  labels overlap, or a message label cross a lifeline.
- Shapes. A flowchart note is a chevron and an architecture component has the shape of its
  kind; Figma has no AWS icons (the matrix says so).
- Class and activity diagrams: `generate_diagram` rejects both, so the target stays
  unsupported for them, as the matrix says. Drawing them, or drawing any kind at the
  draw.io coordinates, would need an emitter that builds the whole board with `use_figma`.

## Unresolved questions

1. The overlay script depends on how Figma lays a sequence diagram out today (rows 80 apart,
   lifelines as connectors between two boxes). It refuses to run when that changes, so the
   failure is visible, but only a new run against Figma can tell. Should a scheduled check
   against a real board be added, and with which Figma account?
2. How FigJam's own "paste Mermaid" dialog treats a self-message was not tested (no tool
   reaches it). The fallback text says so.
3. The version is still 2.0.5; the changes add a CLI option and a matrix feature. Release as
   2.0.6 or 2.1.0?

## Native board at the draw.io coordinates

Added after the rounds above: `emit --to figjam <ir.json> --native <file.js>` writes scripts
for `use_figma` that draw the whole board from the draw.io XML (`src/figjam-native.mjs`).
`generate_diagram` is not called, so the two differences named above as Figma's own
(placement, and class and activity diagrams) no longer hold for this path. Every cell becomes
rectangles, ellipses, vector paths and text at the draw.io position; an edge is a vector along
the draw.io route with its ends drawn as small vectors.

### What was run on the board

Board `45AQFIpbiwRlA0biqsBxCY`, each script passed to `use_figma` as generated, each section
then read back with `get_screenshot` and compared by eye with `preview` of the draw.io file of
the same IR. Section names are the IR title with " (native)" appended for this test (the CLI
uses the plain title).

| Fixture | Section (node id) | Nodes | Result |
|---|---|---|---|
| `flowchart/valid` | Order checkout (native) (`14:444`) | 48 | Every node, the group frame, the note with its fold, subroutine bars, parallelogram, decision; all nine routes with their bends and heads; labels `yes`, `no`, `captured` at the draw.io places. |
| `class/valid` | Order domain (native) (`15:444`) | 52 | Six class boxes with header, rows and separator; inheritance and realization triangles (hollow, the second on a dashed line), filled and hollow diamond, open arrow, dashed dependency; role names and multiplicities. The long method wraps to two lines as in draw.io |
| `activity/valid-two-lanes` | Return request (native) (`16:444`) | 42 | Two coloured lanes with headers, start and end state, actions, decision, subroutine, all eight flows on the draw.io routes across the lanes, guards `yes` and `no` |
| `er/valid` | Order data model (native) (`17:444`) | 50 | Five entities with rows; the four relations with one, zero-or-one, zero-or-many and one-or-many ends; the dashed optional relation; labels |
| `sequence/valid` | Login with password (native) (`18:444`) | 74 | Actor figure, four lifelines with heads and dashed axes, three activation bars, two notes, `loop` and `alt` frames with tab, condition and `else` divider, ten messages (filled, open, dashed, self-message loop) with labels above the lines. Run twice: the second run reported `replaced: 74` and left one drawing in the same section |
| `state/valid` | Order lifecycle (native) (`19:444`) | 53 | Start and end states, rounded states, the composite state with header and its inner states, ten transitions (the two long detours included) with labels |
| `architecture/valid-aws` | Order platform on AWS (native) (`20:444`) | 71 | Five nested group frames (solid, dashed, two filled without border) with their labels in the group colours, eight service squares in the AWS colours with the names under them, dashed external system, nine connections with labels, the label backgrounds in the colour of the frame they lie on |
| `activity/valid-guard-collision-lr` | Corporate login, left to right (native) (`21:444`) | 42 + 29 | Extra run for two things the seven do not have: lanes that run left to right (titles turned a quarter in the band on the left) and a drawing split into two scripts (made with a lowered limit of 6 600 characters). Part 2 found the section of part 1 by name and drew into it |

No script threw. No fixture of the repository needs more than one script at the real limit:
the largest, `flowchart/large-50-nodes`, is 19 000 characters.

### Found on the board and fixed

- A label only a little too wide for its box (Inter is about a tenth wider than the face
  draw.io measures with) was first shrunk even when draw.io had wrapped it. Now a text up to
  12 % too wide is set smaller, a wider one is wrapped.
- The label of a sequence message lay on its line and its white background cut the line. It
  now stands 3 px above, as in draw.io.
- A message that starts or ends an activation bar ran to the axis of the lifeline, through the
  bar. It now touches the side of the bar, as draw.io draws it.
- The title of a swimlane is bold in draw.io without the style saying so; the fold of a note
  is grey.

### What was checked without Figma

`tests/figjam-native.test.mjs` runs the scripts of every valid fixture of every kind (58
files) against a stand-in for the Plugin API: every label of the XML is drawn as text, every
edge starts at its exit point, passes its waypoints and ends at its entry point with right
angles only, known cells lie at the draw.io geometry plus the offset of the section, each
script stays under 50 000 characters, a second run replaces the first and keeps what a user
added to the section, a section of the same name made by `generate_diagram` is left alone, a
later part refuses to run without the first, and the secret scan refuses the emit. Keeping a
user's node, leaving a foreign section alone and the refusal of a later part were at this
point checked there only; the round below ran them on the real board.

### Differences from draw.io that remain

Superseded by the round below ("Pictograms, text face and italics"), which closed the three
about the typeface, the italic part of a label and the AWS pictograms.

### Pictograms, text face and italics

A further round closed three differences and ran every section again.

What changed in the emitter:

- Stencil geometry. `tools/generate-stencil-paths.mjs` reads draw.io's `stencils.min.js`
  (tag v32.6.10, sha256 recorded in the data file) as text, decodes the libraries `aws4.xml`,
  `gcp2.xml` and `networks.xml` with a port of the decoder at the end of that file, and
  writes `src/stencil-paths.json`: 456 stencils, every name the emitters can write (426 AWS
  icons, 15 group corner icons, 14 product logos, the client screen), none missing. Paths
  hold only M, L, Q, C and Z, in whole tenths of a stencil unit; arcs, rectangles and
  ellipses are converted to curves, and every part of a filled path is closed.
- Size. The table is 701 104 characters as JSON. Bundled as it is, `bin/cli.mjs` went from
  2 236 127 to 2 937 439 bytes, past the 2.5 MiB budget of `tests/bundle-drift.test.mjs`.
  The file therefore holds the table Brotli-packed as base64 (266 636 characters), opened
  once when a diagram first shows an icon. The bundle is now 2 506 818 bytes (+270 691,
  +12 %), 114 622 bytes under the budget, which was not changed.
- Scripts. A pictogram is one item that names a path of the script's `stencils` table, with
  an offset and a scale; the runtime moves the numbers into the section. An icon shown twice
  is carried once. `architecture/valid-aws` is 27 857 characters (16 paths of 13 stencils),
  `valid-aws-fan-out` 29 231 (21 paths), a diagram without icons 7 000 to 8 600, the
  fifty-node flowchart 18 500. No fixture needs a second script. Splitting counts a path
  for the part that first needs it.
- Text. The runtime loads Arimo (Regular, Bold, Italic, Bold Italic) instead of Inter.
  Measured on the board, Arimo is within 1 px of the Helvetica widths the layout computes
  with (`Customer submits cart` 121 against 120.0, `Stock is checked per warehouse` 173
  against 172.7, the long method of `Order` 323 against 322.5), so the rule that set a label
  smaller is gone: a text wider than its box is wrapped, any other is one line at the size of
  the file. By the layout's own width table, 26 of the 586 boxed labels of the 58 fixtures
  are wider than their box and so wrap.
- Ranges. `<i>` and `<b>` inside a label become ranges (`setRangeFontName`); a label that is
  bold or italic as a whole stays one text in that face.
- Also found by the comparison and fixed: the name under an icon is wrapped at the
  `labelWidth` of the draw.io style (it was one line); the disc of an end state leaves a ring
  of 4 px as in draw.io (it left 5); a product logo keeps the shades its stencil names
  (Firebase has three).

One defect showed only on the real board: the load balancer pictogram came out with its
rings filled. draw.io's stencil leaves those parts of the path open and a fill closes them
by itself; a Figma vector does not count an open part as an area. The generator now closes
every part of a filled path (40 of the 456 stencils had such parts). The local check
(an SVG of the same paths) had not shown it, because SVG closes them too.

Rerun on the board, each script as generated, then `get_screenshot` beside the `preview` PNG
of the draw.io file:

| Section | Replaced / created | Text read back | What still differs from the draw.io picture |
|---|---|---|---|
| Order checkout (native) `14:444` | 48 / 48 | Arimo Regular 12 and 11, Bold 12; no label wrapped | The `↳` of the reference line is drawn with another glyph than in draw.io; nothing else |
| Order domain (native) `15:444` | 52 / 52 | The long method wrapped at 288 px into two lines, breaking after `quantity):` as in draw.io | Nothing seen |
| Return request (native) `16:444` | 42 / 42 (twice, for the end state) | No label wrapped | The `↳` glyph; nothing else |
| Order data model (native) `17:444` | 50 / 50 | No label wrapped | Nothing seen |
| Login with password (native) `18:444` | 74 / 74 | `«control»` and `«database»` read back as Arimo Italic, the names under them Regular | Nothing seen |
| Order lifecycle (native) `19:444` | 53 / 53 (twice, for the end state) | No label wrapped | Nothing seen |
| Order platform on AWS (native) `20:444` | 71 / 82, then 82 / 82 | Arimo Regular 12 and 11 | Nothing seen: the eight service pictograms, the four kinds of group corner icon and the client screen are those of the draw.io picture. No jump arc would show here, the fixture has no crossing |

Counts by node type on the board equal those of a local run of the same scripts for all
seven sections.

The three behaviours that had been checked only against the stand-in were run on the board:

- A node of a user survives a rerun. A rectangle named `zukai-probe-user` was put into
  `14:444`; the rerun reported `replaced: 48, created: 48`, the rectangle was still there at
  its place and the section had not moved.
- A section of the same name that is not ours is left alone. A section named
  `zukai probe same name` with one child of another name was made, then a generated script
  with that title was run: it drew into a new section to the right; the first kept its one
  child unchanged.
- Part 2 without part 1 refuses. Part 2 of a generated two-part script whose part 1 never
  ran threw `zukai native: no section named "zukai probe no part one" drawn by part 1 on
  this board; run part 1 first. Nothing was changed.` and left no section behind.

The probe rectangle and the two probe sections were removed again; the board holds the eight
`(native)` sections as before.

### Jump arcs, gradient squares and more stencils on the board

A last round closed two more differences and drew three further sections.

- Jump arcs. Only the flow-edge style of `emit-drawio.mjs` carries `jumpStyle=arc;jumpSize=8`
  (flowchart, state, activity and architecture edges; sequence messages and ER and class
  relations do not). The rule was read from draw.io's `Graph.js` at tag v32.6.10
  (`mxGraphView.updateLineJumps` and the connector's `paintLine`), not guessed: an edge with
  `jumpStyle` jumps over every edge that comes before it in the file (unless that one says
  `noJump=1`), on level and upright stretches alike; the line leaves its stretch
  (jumpSize - 2) / 2 + stroke width = 4 px before the crossing and returns 4 px after it over
  one cubic curve whose control points stand 1.3 x 4 = 5.2 px off the line, above a level
  stretch and to the right of an upright one; a crossing within half a pixel of an end of
  the stretch is no crossing, one nearer than 4 px to the point before or after it is drawn
  straight, and two edges that run along each other do not jump. `figjam-native.mjs` does
  the same on its own routes.
- Three of the 58 fixtures have a crossing in their draw.io layout, one each:
  `activity/valid-fork-join`, `architecture/valid-aws-fan-out` and
  `architecture/valid-aws-shared-systems`. No new fixture was needed.
- Gradient. One icon of the catalog has a gradient, not seventeen: `customer_engagement`
  (`fillColor=#3334B9`, `gradientColor=#4D72F3`, `gradientDirection=north`). Its square is
  now a `GRADIENT_LINEAR` fill, the gradient colour at the top and the fill colour at the
  bottom as draw.io paints "north"; the other three directions are handled the same way.
- A single-IR draw.io emit of a fixture with `ref` (`flowchart/valid`,
  `activity/valid-two-lanes`) has no `link` attribute and no `UserObject`, so the missing
  page links are no difference from the draw.io file of the same emit.

On the board, each script as generated, then `get_screenshot` beside the `preview` PNG:

| Fixture | Section (node id) | Nodes | Compared with the draw.io picture |
|---|---|---|---|
| ad-hoc IR: `aws:customer_engagement` connected to `aws:simple_email_service` | Gradient icon (native) (`43:444`) | 10 | The first square reads back as `GRADIENT_LINEAR` with stops 4D72F3 at 0 and 3334B9 at 1, top to bottom, and looks as in draw.io (lighter at the top); the second is solid. Both pictograms match |
| `activity/valid-fork-join` | Order fulfilment (native) (`44:444`) | 67 | One arc, where the flow from "Pack parcel" down to the join crosses the "no" flow that runs level to "Put order on hold", bulging to the right: the same crossing and the same side as in draw.io. Fork and join bars, three lanes, both guards as in draw.io. Nothing else differs but the points listed below |
| `architecture/valid-aws-fan-out` | Booking API on ECS Fargate (native) (`45:444`) | 107 | One arc, where "publish version" going up crosses "access logs", to the right as in draw.io. The ten service squares with their nine different pictograms (ECR, S3 twice, Secrets Manager, DynamoDB, SES, SQS, CloudWatch, load balancer, Fargate), the Firebase logo in its three shades, the server and the application figure, the three group corner icons and the client screen match. The three names draw.io wraps onto two lines wrap here at the same width. Differs: several of the lines that leave the Booking API run with a slant of 1 px over their first stretch where draw.io draws a 1 px step (see the list below) |

The eight earlier `(native)` sections were not redrawn in this round; their scripts are
unchanged except `valid-aws`, whose script does not change either (it has no crossing and no
gradient). No probe is left on the board.

### Differences from draw.io that remain (after that round)

- Lines are vectors, not FigJam connectors: they do not follow a shape the user moves, and
  the nodes of a diagram are not grouped. This is the design of the emitter.
- Sizes of line ends follow draw.io's markers by formula, not pixel for pixel.
- An orthogonal route whose two ends differ by less than a pixel, or by one pixel over a
  long stretch, is drawn as one line with that slant where draw.io draws a tiny step.
- The `↳` of a reference line is drawn with the glyph the board's font has; draw.io shows
  the one of the viewing machine, so there is no reference shape.
- Jump styles other than `arc` (`sharp`, `line`, `gap`) and curved edges are drawn straight;
  the emitters write neither.
- Not looked at on the board: the pictograms of the stencils no drawn section uses (434 of
  456). They come from the same decoder and are checked by test for form and for lying
  inside their box.

### Unresolved questions (native board)

1. Should the section name carry a mark such as " (native)" by default, so that a board
   that holds both the `generate_diagram` section and the native one shows which is which?
   Today both carry the IR title and the script tells its own section by the name of the
   nodes inside.
2. The repository and the bundle hold the geometry of draw.io's AWS icons and of fourteen
   product logos (Firebase, Kubernetes, TensorFlow and others), taken from jgraph/drawio
   (Apache-2.0). `THIRD_PARTY_NOTICES.md` was corrected for this after the round that added
   them; whether the terms of AWS and of the logo owners ask for more than that notice is
   the user's to decide.
3. Arimo was found on this board. Whether every FigJam board offers it was not established;
   the script fails with Figma's font error when it does not.
4. The stencil table is packed to keep the bundle under its 2.5 MiB budget, which makes the
   data file unreadable in a diff. Raise the budget and store the table as plain JSON
   (bundle 2.94 MB), or keep it packed?

### Routes, the `↳` glyph and all 456 stencils measured against draw.io

This round measured the three points the list above left open. Its findings replace that
list; the list that holds now is at the end of this subsection.

**Routes.** What draw.io draws was read from its viewer (the page `preview` opens), whose
SVG paths are in the coordinates of the file, and from its source at tag v32.6.10
(`mxEdgeStyle.js`, `mxGraphView.js`, `mxPerimeter.js`, `Graph.js`).

- draw.io draws the slant itself. An orthogonal edge without waypoints whose two ports are
  less than a pixel apart is one straight line (`flowchart/valid`: `M 134.95 52 L 134.94 112`
  and `M 135 292 L 134.5 489`). An edge with `jumpStyle` is painted from points in which a
  bend less than a pixel off the line is dropped, so the lines that leave the Booking API in
  `architecture/valid-aws-fan-out` start with a slant of 1 px in draw.io too
  (`M 1036 690 L 1310 691 L 1310 746 L 1613 746`). These slants are kept; they now have
  draw.io's own points.
- What did differ and is fixed: an orthogonal edge with waypoints, or one shorter than its
  two end stubs, is routed as draw.io's segment connector does (a waypoint gives one
  coordinate only, in turn; a bend less than a pixel from the one before is dropped); a fixed
  port on an ellipse, rhombus, hexagon or parallelogram is moved onto the outline; a
  misaligned edge without waypoints gets draw.io's step in the middle; a port on a corner
  leaves along the axis on which the other end is further away.
- Measured over the draw.io emit of all fixtures: 405 of 413 edge lines have the viewer's
  points (every point but the end under an arrow head within 0.06 px). Of the other 8, 6
  differ only at a start that carries an arrow, which the viewer draws 6.37 px short and the
  emitter covers with its own marker; 2 start 0.89 px beside the viewer's point under an
  icon label (`architecture/valid-aws-outside-chain`, `valid-aws-outside-pair`), cause not
  found.

**The `↳` glyph.** The preview's Chromium was asked which font it used
(`CSS.getPlatformFontsForNode` on the label): Liberation Sans for the 23 other characters and
Inter for the `↳`, 11.86 px wide at 12 px. `figma.listAvailableFontsAsync()` on the board
lists Inter. The emitter now marks that one character as a range in Inter (Regular, Bold,
Italic or Bold Italic as the label is); the runtime loads Inter only when a label has such a
range. On the board the label of `flowchart/valid` reads back as three segments, Arimo /
Inter / Arimo, is 146 px wide in a room of 152 px and does not wrap, and at eight times the
size the arrow has the wide hook of the preview. No vector was drawn for it.

**Stencils.** One draw.io file per 120 stencils placed every one of the 456 in a grid, each
with the style the emitter writes for its kind (resource icon in its square, plain service
figure, group frame, logo, client screen). Each sheet was rendered by the viewer and from
the native items of `figjamNative` as SVG paths, filled with the non-zero rule and only
where a subpath is closed, as Figma fills; both at the viewer's scale and origin, at two
device pixels per pixel. Per stencil the share of pixels of its cell that differ strongly
(more than 96 of 255 in a channel) was taken, at the best of nine shifts of one device
pixel, since the two renderers snap edges to different half pixels.

| | Share of strongly different pixels |
|---|---|
| median | 0.0000 |
| 90th percentile | 0.0040 |
| 99th percentile | 0.0203 |
| largest | 0.0488 |

438 of 456 are under 0.01, the threshold: the distribution is flat to there, and the cells
above it were looked at one by one. All 456 are under 0.05. The worst five are
`traditional_server` 0.0488, `servers` 0.0426, `tape_storage` 0.0243,
`corporate_data_center` 0.0215 and `office_building` 0.0203, all figures of thin dark
lines; a sheet of the worst 36 beside draw.io's shows no difference of form, and the same
figures score at most 0.0037 when drawn at another place and scale, so what remains is how
the two rasterisers place a line edge, not the data. Writing the paths ten times finer did
not lower it and was not kept.

One real error was found and fixed: the decoder dropped the `alpha` and `fillalpha` of a
stencil, so the shadow of `mxgraph.gcp2.google_play_game_service` was solid black (0.119
before, 0.000 after). The generator now keeps the opacity of a fill, the emitter passes it
on, the runtime sets it on the vector; it is the only stencil of the catalog with one. That
no filled part is open stays asserted by test.

On the board, each script as generated, then `get_screenshot` beside draw.io's rendering:

| Section (node id) | Nodes | Compared with the draw.io picture |
|---|---|---|
| Stencil sample (native) (`49:444`), new: the 30 stencils with the largest difference and the game controller | 39 | Per cell, at the board's own scale, no strongly different pixel in any of the 31 cells. The controller's shadow reads back with opacity 0.2 and looks as in draw.io |
| Booking API on ECS Fargate (native) (`45:444`), redrawn | 107 | The lines read back with the viewer's points, the 1 px slants of draw.io included (`M 1023 718 L 1297 719 L 1297 774 L 1600 774` in section coordinates) |
| Order checkout (native) (`14:444`), redrawn | 48 | The lines read back as `M 0.01 0 L 0 60` and `M 0.5 0 L 0 197`, the viewer's own points; the `↳` as described above |

The other native sections were not redrawn. No probe is left on the board.

**Every edge line, every point (follow-up).** The 413 above are the edge lines of the 42
flowchart, state, activity and architecture fixtures, compared in every point but the end
under an arrow head. The measurement now takes every point of every edge line of all 58
valid fixtures, class, ER and sequence included: 497 lines, and 497 of them have the
viewer's points within 0.06 px (413 of 413 in the four kinds above, 26 of 26 class, 13 of 13
ER, 45 of 45 sequence). What was wrong, each read from draw.io's source at v32.6.10:

- A line stops short under its marker, at the start as at the end. `mxMarker.js` moves the
  end of the line back by (size + stroke) x 3/4 + 1.118 x stroke for `classic` (6.37 px at
  size 6), size + stroke + 1.118 x stroke for `block`, 2.236 x stroke for `open`, and
  size + stroke + 0.7071 (`diamond`) or 0.9862 (`diamondThin`) x stroke; the point of the
  marker itself stands 1.118, 0.7071 or 0.9862 x stroke back from the end of the edge. The
  emitter drew the line to the end and the marker's point on the end. These were the 6
  lines with an arrow at the start.
- A stencil of fixed proportions is drawn smaller than its cell, and draw.io takes the box
  it is drawn in for ports and outline (`mxCellState.getPerimeterBounds`). `aws4.servers`
  is 440 x 430, so in a 78 x 78 cell it is 78 x 76.23 and a port on its top or bottom lies
  0.89 px inside the cell. These were the 2 lines of `valid-aws-outside-chain` and
  `valid-aws-outside-pair`; two more lines there end at the same figure and were hidden by
  the earlier measurement.
- The ring of an ER "zero" end (`mxER.js`) has the diameter of the marker size, 6 px, and is
  not filled when the end is not; the line stops at its far side, 2 x (size + stroke + 1)
  minus half the stroke back, and a short line runs from the near side to the end. The
  emitter drew a white ring of 8 px over a line that ran through.
- A sequence message runs to the axis of the lifeline (`mxPerimeter.LifelinePerimeter`: half
  the stroke left of the middle), over an activation bar that stands there; the arrow head
  lies on the bar. An earlier round of this report made the message stop at the side of the
  bar and called that draw.io's drawing; the viewer's path data
  (`M 139.5 180 L 249 180 L 349.38 180` into a bar from 353 to 363) and its picture at four
  times the size show the opposite, and the emitter now follows the viewer.
- Between two ends less than a pixel out of line an edge without a jump style keeps the
  first point of draw.io's step in the middle when the ends differ in tenths of a pixel
  (`M 118.92 64 L 118.9 170 L 119 273.76` in `class/valid-cardinality-ends`).

All eleven diagram sections were then redrawn with the final scripts, each script as
generated. After the redraw a checksum over the position and size of every line, marker,
rectangle and ellipse and the length of every text was taken on the board and from the
script run locally; the two agree for all eleven. Each screenshot was laid over draw.io's
rendering of the same file at one pixel per unit; the share of strongly different pixels is
what two renderers leave on text and line edges.

| Section (node id) | Fixture | Replaced / created | Strongly different pixels | Seen beside draw.io |
|---|---|---|---|---|
| Order checkout (`14:444`) | `flowchart/valid` | 48 / 48 | 0.0087 | no difference |
| Order domain (`15:444`) | `class/valid` | 52 / 52 | 0.0050 | diamond, open arrow and triangle as in draw.io |
| Return request (`16:444`) | `activity/valid-two-lanes` | 42 / 42 | 0.0018 | no difference |
| Order data model (`17:444`) | `er/valid` | 50 / 50 | 0.0074 | open rings of 6 px, bars and feet as in draw.io |
| Login with password (`18:444`) | `sequence/valid` | 74 / 74 | 0.0108 | arrow heads on the activation bars as in draw.io |
| Order lifecycle (`19:444`) | `state/valid` | 53 / 53 | 0.0046 | no difference |
| Order platform on AWS (`20:444`) | `architecture/valid-aws` | 82 / 82 | 0.0041 | no difference |
| Corporate login, left to right (`21:444`) | `activity/valid-guard-collision-lr`, two parts | 71 / 59 + 12 | 0.0041 | no difference |
| Gradient icon (`43:444`) | ad-hoc IR | 10 / 10 | 0.0105 | no difference |
| Order fulfilment (`44:444`) | `activity/valid-fork-join` | 67 / 67 | 0.0038 | no difference |
| Booking API on ECS Fargate (`45:444`) | `architecture/valid-aws-fan-out` | 107 / 107 | 0.0027 | no difference |

The stencil sample (`49:444`) has no edge and was not redrawn. No probe was created.

Differences from draw.io that remain:

- Lines are vectors, not FigJam connectors: they do not follow a shape the user moves, and
  the nodes of a diagram are not grouped. This is the design of the emitter.
- Markers other than those the emitters write (`oval`, `dash`, `cross`, the thin and async
  kinds) are not drawn, and their lines are not shortened.
- Jump styles other than `arc` (`sharp`, `line`, `gap`) and curved edges are drawn straight;
  the emitters write neither.
- A machine whose Chromium falls back to another face than Inter for `↳` shows another
  arrow in its preview; the board always uses Inter.
- The lifeline end of a message is taken at draw.io's pixel size of 1, as the viewer has it.
- More than 400 of the 456 pictograms were compared with draw.io locally only, not on the
  board.

## Decisions on the open questions

The user left the open questions of this report to the author of the round. They are closed
as follows.

1. Scheduled check against a real board: none is set up. It would need a Figma account that
   runs unattended, and both scripts already refuse loudly when the board is not what they
   expect. The check is a manual step before a release, written into the upgrade notes.
2. FigJam's own "paste Mermaid" dialog stays recorded as untested; no tool reaches it.
3. The release is 2.1.0: it adds CLI options and a way to draw two kinds FigJam could not
   show, which is more than a fix release.
4. The section of the native board carries the plain IR title. The script tells its own
   section by the tag on the nodes inside, so two sections of one name do not overwrite each
   other, and a suffix would only be noise on a board that holds the native section alone.
5. The stencil geometry stays in the bundle, with the source and trademark notice in
   `THIRD_PARTY_NOTICES.md`. The geometry comes from draw.io under Apache-2.0 and is used to
   draw architecture diagrams. A contract with a client that forbids bundled third-party
   artwork is the one thing this decision cannot cover; in that case the table and the
   code that draws from it have to be taken out again, which is a code change, not a switch.
6. The stencil table stays packed: the bundle keeps its 2.5 MiB budget, and the file is
   generated, so nobody reads it in a diff.
7. Arimo is required without a fallback. A board without it stops the script with Figma's
   font error before anything is drawn, which is visible; a silent fallback to another face
   would bring back wrong line breaks.

Checked again on the real board by the author after the last round, not only by the
delegate: all eleven native sections beside their draw.io previews, and the three rerun
behaviours (a node a user added survives and the section does not move; a section of the
same name that is not ours is left alone; part 2 without part 1 refuses and creates
nothing), with throwaway probe sections that were removed afterwards.
