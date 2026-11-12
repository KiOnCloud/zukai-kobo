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
| `flowchart/valid` | Order checkout (native) (`14:444`) | 48 | Every node, the group frame, the note with its fold, subroutine bars, parallelogram, decision; all nine routes with their bends and heads; labels `yes`, `no`, `captured` at the draw.io places. Run before two fixes (bold group title, grey note fold) that the later boards have |
| `class/valid` | Order domain (native) (`15:444`) | 52 | Six class boxes with header, rows and separator; inheritance and realization triangles (hollow, the second on a dashed line), filled and hollow diamond, open arrow, dashed dependency; role names and multiplicities. Run before the wrap rule was fixed: the long method is one small line there, where draw.io has two lines |
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
later part refuses to run without the first, and the secret scan refuses the emit. The last
four were checked there only, not on the real board (except the replacement, see above).

### Differences from draw.io that remain

- Lines are vectors, not FigJam connectors: they do not follow a shape the user moves, and
  the nodes of a diagram are not grouped.
- Typeface: Inter instead of Helvetica, so text is slightly wider; some labels are set a
  little smaller and a wrapped label can break at another word.
- Part of a label in italics (the `«control»` line of a participant) is upright, because a
  label is one text in one weight.
- AWS pictograms are missing: a service is the square of its colour, a group has a square of
  its colour in the corner, other icons (the browser monitor) are a rounded outline.
- No jump arcs where lines cross; page links of `ref` are not links.
- Sizes of line ends follow draw.io's markers by formula, not pixel for pixel; an orthogonal
  route whose two ends differ by less than a pixel is drawn as one line with that slant
  where draw.io draws a tiny step.
- Stroke width is 1 px as in draw.io, which is thin beside FigJam's own shapes at the same
  zoom.

### Unresolved questions (native board)

1. Should the section name carry a mark such as " (native)" by default, so that a board
   that holds both the `generate_diagram` section and the native one shows which is which?
   Today both carry the IR title and the script tells its own section by the name of the
   nodes inside.
2. The first three test sections (`14:444`, `15:444`, `16:444`) were drawn before the fixes
   listed above and were not redrawn; `18:444` and later have them. Redraw them or remove
   the test sections from the board?

