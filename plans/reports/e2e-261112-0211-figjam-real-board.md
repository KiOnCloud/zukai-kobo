# End-to-end test of the FigJam target on real boards

Date: 2026-11-12. Branch: `claude/elegant-feynman-lkgx0p`. Base: 2.0.5 after the preview fix.

The earlier end-to-end rounds treated Figma as not connected. This round called the Figma MCP
server for real: `generate_diagram` for every diagram kind the FigJam target accepts, then
`get_figjam` and `use_figma` to read each board back and compare it with the IR and with the
draw.io file of the same IR. Labels sent were those of the repository fixtures.

## Outcome

Eight differences from the draw.io output were found. All eight are fixed and were verified
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

## What was not known before and is now recorded

- Participant aliases (`participant n2 as Web app`) are shown correctly, although the Figma
  skill text says they are dropped.
- An ER attribute comment is shown, in a fourth table column.
- A transition from outside a composite to one of its children is drawn.
- The first `generate_diagram` call of a session asks for a team (`planKey`); the user picks it.

## Final comparison with draw.io

| Fixture | Labels in the draw.io file | Not found on the board |
|---|---|---|
| `flowchart/valid` | 14 | 0 |
| `sequence/valid` (after the overlay script) | 21 | 0 |
| `state/valid-self-loop` | 11 | 0 |
| `er/valid` | 21 | 0 |
| `architecture/valid-aws` | 24 | 0 |

An ER attribute is one cell in draw.io (`PK id: uuid`) and three or four table cells on the
board, so it was compared part by part. The comparison script reported one attribute,
`email: string (unique, lower-cased)`, because of how it splits the bracket; its three parts
are on the board as the cells `string`, `email` and `unique, lower-cased`.

## Differences that remain

- Shapes and layout are Figma's own: a flowchart note is a chevron, an architecture
  component has the shape of its kind and no AWS icon (the matrix says so), and Figma places
  the elements, sometimes with overlapping transition labels.
- Class and activity diagrams stay unsupported for FigJam, as the matrix says.
- In a sequence diagram the label of a block nested three deep or deeper sits close to its
  first message, and a note longer than three lines is cut.

## Unresolved questions

1. The overlay script depends on how Figma lays a sequence diagram out today (rows 80 apart,
   lifelines as connectors between two boxes). It refuses to run when that changes, so the
   failure is visible, but only a new run against Figma can tell. Should a scheduled check
   against a real board be added, and with which Figma account?
2. How FigJam's own "paste Mermaid" dialog treats a self-message was not tested (no tool
   reaches it). The fallback text says so.
3. The version is still 2.0.5; the changes add a CLI option and a matrix feature. Release as
   2.0.6 or 2.1.0?
