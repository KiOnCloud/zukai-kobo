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

### Differences from draw.io that remain (after that round)

- Lines are vectors, not FigJam connectors: they do not follow a shape the user moves, and
  the nodes of a diagram are not grouped. This is the design of the emitter.
- No jump arcs where lines cross; page links of `ref` are not links.
- Sizes of line ends follow draw.io's markers by formula, not pixel for pixel; an orthogonal
  route whose two ends differ by less than a pixel is drawn as one line with that slant
  where draw.io draws a tiny step.
- The `↳` of a reference line is drawn with another glyph than in draw.io.
- The one icon of the catalog whose square has a gradient is drawn in one colour.
- Not looked at on the board in this round: the pictograms of the other 443 stencils. They
  come from the same decoder and are checked by test for form and for lying inside their
  box, and the fan-out fixture (Firebase, a server, an application figure, eight more
  services) was compared with draw.io in a local rendering only.

### Unresolved questions (native board)

1. Should the section name carry a mark such as " (native)" by default, so that a board
   that holds both the `generate_diagram` section and the native one shows which is which?
   Today both carry the IR title and the script tells its own section by the name of the
   nodes inside.
2. The repository and the bundle now hold the geometry of draw.io's AWS icons and of
   fourteen product logos (Firebase, Kubernetes, TensorFlow and others), taken from
   jgraph/drawio (Apache-2.0). `THIRD_PARTY_NOTICES.md` still says "No icon artwork is copied
   or embedded"; that sentence is no longer true and the file was left as it is, because how
   to state the terms of AWS and of the logo owners is the user's decision. Until it is
   decided the commit should not be released.
3. Arimo was found on this board. Whether every FigJam board offers it was not established;
   the script fails with Figma's font error when it does not.
4. The stencil table is packed to keep the bundle under its 2.5 MiB budget, which makes the
   data file unreadable in a diff. Raise the budget and store the table as plain JSON
   (bundle 2.94 MB), or keep it packed?
