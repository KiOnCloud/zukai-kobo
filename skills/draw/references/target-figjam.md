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

`generate_diagram` also lays the diagram out itself and rejects class and activity diagrams.
When the user wants the board to look like the draw.io file, or the diagram is a class or
activity diagram, skip sections 2, 4 and 5 and draw the board with `use_figma` from the
draw.io layout instead (section 7).

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
- Exit 2 with `kind "class" is unsupported on target "figjam"` (or `"activity"`):
  `generate_diagram` cannot draw this kind. Draw the board as section 7 says when `use_figma`
  is available; otherwise offer `--to mermaid` or `--to drawio`. Do not try to disguise a
  class diagram as a flowchart.

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

Before the call say, in one line, that the diagram labels and title will be sent to Figma
and a board will be created in their drafts (or updated, if they gave a file key).

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
AWS icons and group frames (`icon`, `group`) are not drawn: components keep the shape of
their `kind`, frames are plain subgraphs, and one warning per field says so.

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
4. If it throws `zukai overlay: ...`, nothing was changed. The message says what on the
   board differs from the model (another title, a message edited by hand, a layout Figma
   has changed since). Relay it, deliver the board as `generate_diagram` left it, and list
   the warnings that name the overlay script as what the board lacks.
5. Look at the result (`get_screenshot` of the section) before reporting the board.

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
deleted (how FigJam's own paste dialog treats them was not verified). When `emit --to figjam` itself refuses (a class or activity diagram, or a finding of
the secret scan), there is nothing to paste: say why, and offer `--to drawio` or
`--to mermaid` as a file of its own.

## 7. Draw the board at the draw.io coordinates

Use this instead of sections 2, 4 and 5 when the user wants the layout of the draw.io file on
the board (same positions, same routes, the shapes of draw.io), and always for a class or an
activity diagram, which `generate_diagram` rejects. It needs a Figma tool named `use_figma`
in the session; `generate_diagram` is not called. Sections 1 and 3 still apply: the labels
leave the machine, and the secret scan gates this emit like the other.

1. Emit the script: `node "<skill-dir>/scripts/bin/cli.mjs" emit --to figjam <ir.json> --native <file.js>`.
   The stdout JSON lists the files under `native`: `<file>.js`, and `<file>.2.js`,
   `<file>.3.js`, ... when the drawing is longer than one `use_figma` call takes (50 000
   characters). The script is made from the same layout as `emit --to drawio`, so emit the
   draw.io file from the same IR when the user wants both. For a class or activity diagram
   `out` is `null` and `text` says that no Mermaid text was written.
2. Load the Figma skills `figma-use` and `figma-use-figjam` (fallback resources:
   `skill://figma/figma-use/SKILL.md`, `skill://figma/figma-use-figjam/SKILL.md`).
3. Call `use_figma` with the file key of the board and, as `code`, the content of the file,
   unchanged. Do not edit the script and do not write one by hand. With several parts, run
   them in order, one call each, and not in parallel: part 1 makes the section, the others
   draw into it.
4. The script makes a section named like the IR `title`, to the right of everything on the
   page, as large as the drawing, and draws every cell of the draw.io file into it as plain
   shapes, vector lines and text. Each node it creates is named `zukai-native`. Running part
   1 again removes those nodes from that section and draws anew, where the section now
   stands; what the user added to the section stays. A section of the same name that
   `generate_diagram` made is not touched.
5. Look at the result (`get_screenshot` of the section id the script returns) before
   reporting the board.

What still differs from the draw.io file:

- The board is a drawing, not a model. A line is a vector, not a FigJam connector, so it
  does not follow a shape the user moves. The parts of one diagram are not grouped.
- The typeface is Inter, a little wider than the one draw.io uses. A label that no longer
  fits its box on one line is set slightly smaller; a label draw.io wrapped is wrapped again
  and may break at another word.
- A label is plain text in one weight: a bold or italic part of a label (the `«kind»` line of
  a participant) is not set apart. A whole label that is bold or italic stays so.
- AWS icons have no pictogram: a service is the square of its colour with its name under
  it, a group frame has a square of its colour in the corner, and any other icon (a monitor,
  a server) is a rounded outline.
- A line that crosses another has no jump arc, and draw.io's page links (`ref`) are not
  links; the `↳ <slug>` line of the label stays.
