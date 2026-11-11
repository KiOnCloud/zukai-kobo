# Target: FigJam

FigJam is reached through the Figma MCP server's `generate_diagram` tool, which takes Mermaid
text. The CLI produces that text in a `figjam` profile (the subset Figma accepts) and the
agent makes the tool call. Scripts never call Figma; they have no network access.

## 1. Check availability

Look for a tool named `generate_diagram` from the Figma MCP server in the current session
(in Claude Code it appears as `mcp__Figma__generate_diagram` or `mcp__figma__generate_diagram`;
it may be deferred and need loading first). If it is absent, use the fallback in section 5
and tell the user in one line that no Figma MCP server is connected.

## 2. Emit the Mermaid text

`<skill-dir>` is the directory that contains the `SKILL.md` you loaded.

```bash
node "<skill-dir>/scripts/bin/cli.mjs" emit --to figjam ./diagrams/order-checkout.ir.json
```

- Exit 0: the Mermaid text is on stdout; warnings are one JSON object on stderr.
- Exit 2 with errors starting `refusing to emit for figjam`: the secret scan found something
  that looks like a credential, a token or personal data. Diagram labels are sent to Figma,
  so replace the value in the IR with a placeholder. Only if the user confirms it is not a
  secret, run again with `--allow-sensitive`. The scan reads `meta` too, so a secret in a
  note stops the emit although notes are not sent: fix it there as well.
- Exit 2 with `kind "class" is unsupported on target "figjam"`: FigJam cannot draw class
  diagrams. Offer `--to mermaid` or `--to drawio` instead; do not try to disguise a class
  diagram as a flowchart.

The `figjam` profile differs from plain Mermaid: no front matter (the title goes in the tool
call), sequence notes are dropped, labels lose quotes, brackets and line breaks (a comparison keeps
its sense: `<=`, `>=`, `!=` are written as ≤, ≥, ≠, and `<`, `>`, `%`, `&` in their full-width
forms ＜, ＞, ％, ＆),
architecture diagrams become flowcharts with boundaries as subgraphs, and an ER diagram is
laid out top to bottom whatever its `direction`. Every one of these shows up as a warning. Print all warnings to the user before calling Figma.

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
  report the error and fall back to section 5.
- `fileKey` (optional): to add to an existing board, the key from the board URL
  `figma.com/board/<fileKey>/...`. Without it every call creates a new FigJam file.

Report the board link the tool returns. To replace a diagram on an existing board, the Figma
skill explains how to delete the old nodes with `use_figma` before regenerating.

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

## 5. Fallback when Figma is not available

The text to paste is the one section 2 made: the output of `emit --to figjam`, never of
`emit --to mermaid`. The `mermaid` target writes front matter and entity codes that the
`figjam` profile leaves out because FigJam does not take them, and it only warns about a
guess of the secret scan (a mail address, a token-like string) that the `figjam` target
refuses, while this text is about to be pasted into Figma all the same.

Print the `figjam` text in a fenced `mermaid` block and tell the user: open the FigJam board,
use Insert (or the `/` quick-insert) > Mermaid (or the "Diagram from code" option), paste the
text, and insert. List the warnings of that same emit, so they know what the pasted version
lacks. When `emit --to figjam` itself refuses (a class or activity diagram, or a finding of
the secret scan), there is nothing to paste: say why, and offer `--to drawio` or
`--to mermaid` as a file of its own.
