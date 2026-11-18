# Target: FigJam

FigJam is reached through the Figma MCP server's `generate_diagram` tool, which takes Mermaid
text. The CLI produces that text in a `figjam` profile (the subset Figma accepts) and the
agent makes the tool call. Scripts never call Figma; they have no network access.

`generate_diagram` draws less of a sequence diagram than draw.io does: it drops the frames
of `loop`, `alt`, `opt` and `par` blocks, the notes, and a message a participant sends to
itself, draws every participant as the same box, and has no activation bars. For a sequence
diagram that has any of these (nearly every one) the CLI also writes an overlay script,
which the agent runs on the board with the Figma tool `use_figma` (section 5). Flowchart,
state, ER and architecture boards are complete after `generate_diagram`.

`generate_diagram` also lays the diagram out itself and rejects class and activity diagrams;
it has no use case diagram, and the CLI writes no text for one.
When the user wants the board to look like the draw.io file, or the diagram is a class,
activity or use case diagram, skip sections 2, 4 and 5 and draw the board with `use_figma` from the
draw.io layout instead (section 7).

Before any Figma call, read section 8: what the Figma server asks for first, and how many
calls a board costs on a plan that limits them.

## 1. Check availability

Look for a tool named `generate_diagram` from the Figma MCP server in the current session
(in Claude Code it appears as `mcp__Figma__generate_diagram` or `mcp__figma__generate_diagram`;
it may be deferred and need loading first). If it is absent, use the fallback in section 6
and tell the user in one line that no Figma MCP server is connected.

## 2. Emit the Mermaid text

`<skill-dir>` is the directory that contains the `SKILL.md` you loaded.

```bash
node "<skill-dir>/scripts/bin/cli.mjs" emit --to figjam <run-folder>/source/<slug>.ir.json --out <run-folder>/figjam/<slug>.mmd --overlay <run-folder>/figjam/<slug>.overlay.js
```

- Exit 0: the Mermaid text is in the `--out` file (on stdout without `--out`); warnings are
  one JSON object on stderr. The line on stdout names the overlay script as `overlay`, or
  says `"overlay": null` when the board needs none; no file is written then.
- Exit 2 with errors starting `refusing to emit for figjam`: the secret scan found something
  that looks like a credential, a token or personal data. Diagram labels are sent to Figma,
  so replace the value in the IR with a placeholder. Only if the user confirms it is not a
  secret, run again with `--allow-sensitive`. The scan reads `meta` too, so a secret in a
  note stops the emit although notes are not sent: fix it there as well.
- Exit 2 with `kind "class" is unsupported on target "figjam"` (or `"activity"`, or
  `"usecase"`): `generate_diagram` cannot draw this kind. Draw the board as section 7 says when `use_figma`
  is available; otherwise offer `--to mermaid` or `--to drawio`. Do not try to disguise a
  class diagram as a flowchart, and do not send the flowchart that `--to mermaid` writes for
  a use case diagram: it was not checked on a board.

The `figjam` profile differs from plain Mermaid: no front matter (the title goes in the tool
call), labels lose quotes, brackets and line breaks (a comparison keeps
its sense: `<=`, `>=`, `!=` are written as ≤, ≥, ≠, and `<`, `>`, `%`, `&` in their full-width
forms ＜, ＞, ％, ＆), and
architecture diagrams become flowcharts with boundaries as subgraphs. Three more differences
follow from what Figma's parser was seen to do on real boards:

- A sequence note is written as a message of its first participant to itself. Figma draws
  nothing for it but keeps the row free, and the overlay script draws the note there. A
  long note is followed by further such rows, labelled `…`, so that its whole text has
  room, and a block inside another block has one before its first message, for its label.
  The local preview of the `.mmd` file shows each of these rows as a self-message.
- A composite state is written on two lines, `state "Label" as n4` and `state n4 {`. Figma
  reads the one-line form as a composite called "Label as n4" and adds a stray state "n4".
- An ER diagram always carries its `direction` line (Figma lays one out left to right unless
  told), and an attribute type with a comma, such as `decimal(10,2)`, keeps only its name as
  the type, with the full type in the comment column: Figma rejects the whole diagram at a
  comma inside a type.

Whatever is lost or changed shows up as a warning. Print all warnings to the user before
calling Figma; for a sequence diagram say which of them the overlay script makes good
(the warnings that name it).

Keep the text and review it before anything is sent: write it into the run folder with
`--out <run-folder>/figjam/<slug>.mmd`, run `preview` on that file, and run the review gate
of the closing contract on the image. The board is made only after the review passed,
because that is the moment the labels leave the machine.

## 3. Tell the user what leaves the machine

Before the call say, in one line, that the diagram labels and title will be sent to Figma,
and where the diagram goes: with `generate_diagram` and no file key, into a new board in
their drafts; with a file key, onto that board; on the route of section 7, onto the board
the user gave or the one created for this run there (`use_figma` creates no file itself).
On a plan that limits calls, say in the same message how many calls the board takes
(section 8).

## 4. Call the tool

Load the Figma skill `figma-generate-diagram` first; the Figma server requires it before
every `generate_diagram` call (fallback resource: `skill://figma/figma-generate-diagram/SKILL.md`).
Then call `generate_diagram` with:

- `name`: the IR `title`.
- `mermaidSyntax`: the CLI output, unchanged. Do not edit the text; if Figma rejects it,
  report the error and fall back to section 6.
- `fileKey` (optional): to add to an existing board, the key from the board URL
  `figma.com/board/<fileKey>/...`. Without it every call creates a new FigJam file.

Report the board link the tool returns. To replace a diagram on an existing board, the Figma
skill explains how to delete the old nodes with `use_figma` before regenerating.

After the call, read the board back with `get_figjam` (file key from the returned link, node
`0:1`) and compare it with the IR: every node, participant, state or entity is there under
its label, and every edge, message, transition or relation joins the right two. Report a
difference instead of delivering the board as it is.

If the tool answers "Plan key is missing", relay its message to the user verbatim: they pick
the team or organization in the widget the tool shows, and the tool then creates the board.
Do not ask which plan to use and do not guess a `planKey`.

Architecture diagrams: the CLI's `figjam` profile renders an architecture IR as a plain
flowchart whose subgraphs are the IR boundaries, so nothing is lost but the icons. Figma also
offers a bespoke architecture layout (`useArchitectureLayoutCode`, see the Figma skill's
`references/architecture.md`) that needs fixed subgraph ids (`client`, `gateway`, `service`,
`datastore`, `external`, `async`) instead of the user's boundaries. The CLI does not emit
that form; if the user asks for it, say that it drops their boundaries and would have to be
written by hand, which this skill does not do.
AWS and GCP icons and group frames (`icon`, `group`) are not drawn: components keep the shape
of their `kind`, frames are plain subgraphs, and one warning per field and provider says so.

## 5. Complete a sequence diagram with the overlay script

Only when the emit of section 2 wrote an overlay script. Without this step the board shows
the participants and the messages between them, and nothing else: no block frames, no
notes, no participant kinds, no activation bars, an empty row for each self-message, and a
stray arrow beside the diagram for each of those rows.

1. Load the Figma skills `figma-use` and `figma-use-figjam`; the Figma server requires them
   before every `use_figma` call (fallback resources: `skill://figma/figma-use/SKILL.md`,
   `skill://figma/figma-use-figjam/SKILL.md`).
2. Call `use_figma` with the file key of the board and, as `code`, the content of the
   `.overlay.js` file, unchanged. Do not edit the script and do not write one by hand.
3. The script finds the section named like the diagram title (so `name` in section 4 must
   be the IR `title`), checks participants, messages and row spacing against the model, and
   only then draws: a frame per block with its kind and condition, a dashed divider per
   `else` or `and` branch, each self-message as a small loop with its label, each note as a
   yellow box, the figure above an actor, the `«kind»` line of a boundary, control, entity
   or database participant, and the activation bars the draw.io file has. It removes the
   stray arrows. Running it again replaces what it drew.
4. If it throws `zukai overlay: ...`, nothing was changed. When the message says that this
   copy of the script is not the one the CLI wrote, the copy lost or changed a character on
   its way into the call: pass the script again from its file, unchanged. Otherwise the
   message says what on the
   board differs from the model (another title, a message edited by hand, a layout Figma
   has changed since). Relay it, deliver the board as `generate_diagram` left it, and list
   the warnings that name the overlay script as what the board lacks.
5. Look at the result (`get_screenshot` of the section) before reporting the board.
   `get_figjam` lists the texts and vectors the overlay script drew without their
   characters, so it cannot show whether a frame label, a note or a self-message reads as it
   should. Check those on the screenshot, or read the section with the reader script of the
   recook skill (`extract --figjam-script <tmp>/read.js --section "<section id>"`, run
   unchanged with `use_figma`, then `extract` on the saved JSON), which returns every text.

After the overlay the board shows everything the draw.io file shows. Shapes and placement
stay Figma's own.

Without a `use_figma` tool in the session, skip this section and tell the user in one line
what the board lacks.

## 6. Fallback when Figma is not available

The text to paste is the one section 2 made: the output of `emit --to figjam`, never of
`emit --to mermaid`. The `mermaid` target writes front matter and entity codes that the
`figjam` profile leaves out because FigJam does not take them, and it only warns about a
guess of the secret scan (a mail address, a token-like string) that the `figjam` target
refuses, while this text is about to be pasted into Figma all the same.

Print the `figjam` text in a fenced `mermaid` block and tell the user: open the FigJam board,
use Insert (or the `/` quick-insert) > Mermaid (or the "Diagram from code" option), paste the
text, and insert. List the warnings of that same emit, so they know what the pasted version
lacks. For a sequence diagram with notes or self-messages also say that each of those rows
comes out empty in the pasted board, with a stray arrow beside the diagram that can be
deleted (how FigJam's own paste dialog treats them was not verified). When `emit --to figjam` itself refuses (a class, activity or use case diagram, or a finding of
the secret scan), there is nothing to paste: say why, and offer `--to drawio` or
`--to mermaid` as a file of its own.

## 7. Draw the board at the draw.io coordinates

Use this instead of sections 2, 4 and 5 when the user wants the layout of the draw.io file on
the board (same positions, same routes, the shapes of draw.io), and always for a class, an
activity or a use case diagram, which `generate_diagram` does not draw. It needs a Figma
tool named `use_figma` in the session; `generate_diagram` is not called. Sections 1 and 3 still apply: the labels
leave the machine, and the secret scan gates this emit like the other.

0. Get the board. When the user gave a board link, take its file key
   (`figma.com/board/<fileKey>/...`). When they have none, create one with the Figma tool
   `create_new_file` (a FigJam file), named after the run (the IR `title`, or the run slug
   for a run of several diagrams). It asks for the team or organization the file goes into
   (`planKey`) when the account has more than one: that is the user's choice, so ask them
   which, and never pick one yourself. Then call `create_session` with the new file key, as
   section 8 says.
1. Emit the script: `node "<skill-dir>/scripts/bin/cli.mjs" emit --to figjam <ir.json> --native <file.js>`.
   The stdout JSON lists the files under `native`: `<file>.js`, and `<file>.2.js`,
   `<file>.3.js`, ... when the drawing is longer than one `use_figma` call takes (50 000
   characters). It also says how many `use_figma` calls they take (`calls`), how many shapes,
   lines and texts each call must report as `created` (`created`, one number per script) and
   the size of each script in bytes (`bytes`). For a run of several diagrams on one board,
   `bundle --to figjam --native <file.js> <run-folder>` writes their drawings into as few
   scripts as fit into one call each (often one for the whole run), each diagram into its own
   section; its `drawings` says how many diagrams each script holds, and its `created` gives,
   for each script, a list with one number per diagram in it, in the order the script returns
   its results (`[[88, 108]]` for one script of two diagrams). Use it when the plan
   limits calls; keep the per-diagram scripts of `emit --native` in the run folder all the
   same, since a revision writes those again. The script is made from the same layout as `emit --to drawio`, so emit the
   draw.io file from the same IR when the user wants both. For a class, activity or use case diagram
   `out` is `null` and `text` says that no Mermaid text was written. Keep the script in the
   run folder as `figjam/<slug>.native.js` (further parts as `figjam/<slug>.native.2.js`),
   so a later revision finds it and writes it again.
   The warnings of this call are those of the board the script draws, which is the draw.io
   drawing: with `--native` alone the CLI does not print what is lost in the text for
   `generate_diagram` (icons, group frames, the flowchart form of an architecture diagram),
   because none of that is lost on the native board. With `--native` and `--out` both
   files are written, and each warning about the text says in brackets that it is about
   the FigJam text; show those for the text, not as something the board lacks.
2. Load the Figma skills the server names (section 8).
3. Call `use_figma` with the file key of the board and, as `code`, the content of the file,
   unchanged. Do not edit the script and do not write one by hand. No line of the file is
   longer than 200 characters, so read it whole, not in slices joined by hand. The script
   checks itself before it touches the board: it carries the length and a short hash of its
   data, and when the copy lost or changed a character (inside a label too) it throws
   `zukai native: this copy of the script is not the one the CLI wrote ...` and changes
   nothing. Then pass it again from the file, unchanged; never mend the copy. With several
   parts, run them in order, one call each, and not in parallel: part 1 makes the section,
   the others draw into it. Compare the `created` each call returns with the number the CLI printed for
   that script. A script of `bundle` that holds several diagrams returns a list of results,
   one per diagram: compare the `created` of each result with the number at the same place
   in the CLI's list for that script (the first result with the first number, and so on); a
   script of one diagram returns one result, compared with the one number of its list. A
   different number means the script did not arrive whole; run it again from the file,
   unchanged.
4. The script makes a section named like the IR `title`, to the right of everything on the
   page, as large as the drawing, and draws every cell of the draw.io file into it as plain
   shapes, vector lines and text. Each cell is one group, named like its label (cut at 40
   characters; like its id when it has no label; an AWS or GCP icon or frame, or a product logo, adds
   its stencil in brackets, `Order API [aws:lambda]`, `Order API [gcp:cloud_run]`, so a recook of the board keeps it): a node with its text, bars and pictogram;
   an edge with its line, its line ends and its labels. A cell that lies in a container of
   the draw.io file (a frame, a lane, a composite state, an AWS or GCP group, a lifeline, a class or
   entity box) lies in the group of the container, so moving the container moves what is in
   it. Each shape, line and text the script creates is named `zukai-native` followed by the
   name of the run folder the IR lies in (`zukai-native 20261118_clinic-booking`; just
   `zukai-native` for an IR outside a run folder). That name, not the title, tells the
   script which section is its own: it draws over a section only when the section holds
   shapes it drew for the same run. Running part 1 again (after a revision of the run, say)
   removes those shapes from that section, wherever they lie, and draws anew where the
   section now stands; what the user added to the section or to a group stays. A section of
   the same title that the script did not draw for this run (drawn by hand, made by
   `generate_diagram`, or drawn for another run, such as the board a recook was read from)
   is never touched: the script makes a new section beside it, named after the diagram with
   ` (2)` added (`Clinic booking use cases (2)`), or ` (3)` and so on when that name is taken
   too. The result of a call names the section (`section`, `name`) and counts the shapes,
   lines and texts it created and replaced, not the groups; report the section by that name.
   When two sections hold shapes of the run (a user duplicated one: a copy keeps the names),
   the script draws into the last one on the page, leaves the other as it was, and its result
   carries a `warning` that names the other section ids. Report that warning to the user.
   A board drawn by a version before 2.3.0 carries no run in those names, so drawing it
   again makes a new section; delete the old one by hand when it is no longer wanted.
5. Look at the result (`get_screenshot` of the section id the script returns) before
   reporting the board. On a plan that limits calls, one screenshot of the page can show
   several sections at once.

What still differs from the draw.io file:

- The board is a drawing, not a model. A line is a vector, not a FigJam connector, so it
  does not follow a shape the user moves: a moved node leaves its lines where they were.
- Line ends of the kinds the emitters write (arrow, triangle, open arrow, diamond and the
  entity-relationship ends) are drawn by the formulas of draw.io's markers; other kinds are
  not drawn.

A line runs through the points draw.io's own router gives it: the fixed exit and entry
points moved onto the outline of an ellipse, rhombus, hexagon or parallelogram, the bends
draw.io makes of the waypoints, and the slant of a pixel or less that draw.io itself draws
where two ends are not quite in line. A line jumps over a line drawn before it with the
small arc draw.io draws there, and the square of a service with a gradient has that gradient.

Text is set in Arimo, which has the widths of the face draw.io sizes its boxes for, at the
sizes of the draw.io file, so a label fits its box and wraps at the same words; a bold or
italic part of a label (the `«kind»` line of a participant) is bold or italic on the board.
The `↳` of a reference line, which Arimo lacks, is set in Inter, the face the draw.io
preview falls back to for it. The script loads Arimo (and Inter, when a label has a `↳`)
from the board; if the call fails because a font is missing, relay the error and deliver the
draw.io file instead. AWS and GCP services, group frames, product logos and the client screen are
drawn with the pictograms of draw.io's own stencils, in the colours and the opacity the
draw.io file gives them. Only the pictograms a diagram shows are in its script: an AWS
diagram of about ten services is some 31 000 characters, a diagram without icons 10 000 to
12 000.

## 8. What the Figma server asks for, and what a board costs

The Figma MCP server states its own requirements in its instructions and its skills. Follow
them; where they differ from this section, the server's own instructions hold, since they
change faster than this text. At the time of writing they were:

- `create_session` first: once the file key is known (from the user's link, or from
  `create_new_file`), call `create_session` with that key and a short description of the
  task before any other file tool (`use_figma`, `get_figjam`, `get_screenshot`, and also
  `generate_diagram` with a file key), and pass the session id it returns to the calls that
  take one. One session serves the whole run.
- Skills before tools: load `figma-use` and `figma-use-figjam` before the first `use_figma`
  call, `figma-generate-diagram` before `generate_diagram`, and any further skill the server
  names for the step. `figma-use` makes `figma-generate-design` mandatory before the first
  `use_figma` call that changes the board, so load it too before drawing (the overlay
  script and every native script change the board; the reader script does not). It is one
  more call to count in the budget below. Its design-system workflow (searching libraries,
  building from components, assembling step by step) does not apply to Zukai's scripts:
  loading it satisfies the server, and the scripts still run unchanged, as they are. Read
  through the server as a resource, a skill is
  `skill://figma/<name>/SKILL.md`. A tool that has a `skillNames` field wants the names of
  the skills loaded for the call; fill it with those names (with the `resource:` form the
  server gives when they were read as resources).

**Calls.** Every tool call to the Figma server counts, and a plan may limit them: on Figma's
Starter plan the server refuses calls after about twenty in a period, with "You've reached
the Figma MCP tool call limit on the Starter plan". A board costs one `use_figma` call per
script (the `calls` the CLI prints: one per diagram unless a drawing is very large, or one
for several diagrams with `bundle --to figjam --native`), plus `create_session`, the skill
reads that are calls (`figma-generate-design` included), `create_new_file` when a board is made, one `get_screenshot` per look
and, for a sequence diagram on the route of sections 2 to 5, `generate_diagram`, the overlay
script and its read-back. Reading a board back with the recook skill is one call per part
the reader returns.

Before the first Figma call, add up the calls the run needs and tell the user the count.
When the plan is a Starter plan, or the user does not know, say that such a plan allows about
twenty calls and ask before going on when the count comes near that. The count is an upper bound for the
run, not a forecast of where a refusal comes: the plan's period may already be partly used
by other work, so the first drawing call can be refused although the session and the skill
reads before it were accepted. Draw with the fewest
scripts (`bundle --to figjam --native` for a run of several diagrams) and look at the board
with one screenshot where one shows everything.

When a call is refused for the limit, at the first drawing call or midway, stop calling
Figma, including the `whoami` the refusal message suggests, and report:

- which scripts ran and what each returned (the section ids and `created` counts), and which
  did not run; nothing half-drawn is left unreported: a diagram whose first part ran and
  whose later parts did not is named as incomplete on the board;
- that nothing was changed by the refused call;
- how to go on: once the limit resets (Figma gives no time in the message; its rate-limit
  page and the plan's settings say when), or on a board of a plan that allows more calls, run
  the remaining scripts from the run folder, unchanged and in order; on a limited plan, emit
  the diagrams that did not run again as one `bundle --to figjam --native` script first, which
  costs fewer calls than running them one by one. A script that did run
  can be run again: part 1 replaces what it drew before, so a diagram left incomplete is
  drawn whole by running its parts again from part 1.

Deliver the draw.io file of the run all the same; it does not depend on Figma.
