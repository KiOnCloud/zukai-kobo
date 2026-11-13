# Quick start

Five minutes from nothing to a reviewed draw.io diagram. The full reference is
[install.md](install.md) and the skill's own `SKILL.md`.

## 1. Install (once per machine)

Requirements: Node 22.13 or newer, `git`, Claude Code. No GitHub account is needed.

```bash
claude plugin marketplace add KiOnCloud/zukai-kobo
claude plugin install zukai@zukai
```

Check: open `claude` in any project and type `/zukai:draw`; the command
should autocomplete.

## 2. Draw a diagram

Open Claude Code in the project the diagram is about and run one of:

```text
/zukai:draw scout the login flow
/zukai:draw clarify order approval process
/zukai:draw brainstorm a loyalty points feature
```

- `scout`: the diagram is derived from the code in the current folder. Nothing is invented
  and no questions about the business are asked.
- `clarify`: you describe the process; the skill asks what is missing, at most three rounds.
- `brainstorm`: you have an idea; the skill proposes which diagrams would help and you pick.

The skill then asks one question with up to four parts: which **kind** (sequence,
flowchart, activity swimlanes, state, ER, class, architecture; an architecture on AWS is
drawn with AWS service icons and VPC or subnet frames in draw.io), which **scope** (`overview`:
one diagram of about 15 steps; `detailed`: one main diagram plus a sub-diagram per sub-flow,
linked from the main one), **which view** (`technical`: for developers, keeps code and data
names; `business`: for a PM, client or operations, business rules only; `both`: one of each
in the same folder), and the mode if you left it out. Questions and options are in your
language, with the English keyword in parentheses. Answer and wait: it writes the model,
validates it, emits the files, renders them and has them reviewed before showing you.

## 3. Find the result

Everything of one run is in one folder of your project:

```text
diagrams/20261109_login-flow/
  login-flow.drawio      one file, one page per diagram; with several diagrams the first page
                         shows them all side by side, and each "↳" step links to its page
  drawio/<diagram>.drawio   each diagram on its own
  source/<diagram>.ir.json  the model the diagrams were generated from (edit this, not the XML)
```

Open the `.drawio` file in draw.io desktop or at app.diagrams.net; every shape is editable.

## 4. Useful options

Put them after the mode:

| Option | Effect |
|---|---|
| `--to mermaid` | Mermaid text in a `.md` file instead of draw.io (for wikis and Markdown) |
| `--to figjam` | A FigJam board; needs the Figma connector in the session |
| `--kind activity` | Skip the kind question |
| `--scope detailed` | Skip the scope question |
| `--audience technical\|business\|both` | Skip the reader question; `business` is a view for non-technical readers (no code names or implementation steps, every business rule kept), `both` makes one of each |

Example: `/zukai:draw scout --kind activity --scope overview the refund flow`.

## 5. Change something later

- Ask for the change, in this conversation or a later one:

  ```text
  /zukai:revise rename "Pay" to "Pay by card"
  /zukai:revise what if the stock check came before payment?
  /zukai:revise add a sequence diagram of the payment step
  /zukai:revise undo
  ```

  A clear change is applied at once, after the previous version is saved in `history/`. A
  what-if gets two or three drafts under `drafts/` to compare; nothing delivered changes
  until you confirm one. A new diagram is asked about like any `draw` request (kind, scope,
  view) and joins the run, linked from the step it details. If you moved boxes in draw.io, a label change keeps your layout
  and any other change asks before redrawing.
- By hand: edit `source/<diagram>.ir.json` and ask the skill to emit again, or run the CLI
  yourself:

  ```bash
  node ~/.claude/plugins/cache/zukai/zukai/<version>/skills/draw/scripts/bin/cli.mjs emit --to drawio source/login.ir.json --out drawio/login.drawio
  ```

- Another language, same layout: write a JSON map of element id to new text and run
  `cli.mjs relabel <file.drawio> --map labels.vi.json --out <file>.vi.drawio`. Boxes keep
  their size; the CLI lists labels that no longer fit.

## 6. Bring in a diagram drawn elsewhere

An old draw.io file, a FigJam board or a Mermaid chart can be rebuilt the Zukai way:

```text
/zukai:recook docs/legacy/order-flow.drawio
```

Zukai reads the file, tells you what it found on each page and which kind it looks like,
asks the same questions as `draw` with that kind suggested, and delivers a run folder like
the one above. Every label is kept as written; anything it leaves out is listed with the
reason. Your file is never changed or copied; a password or address in it never reaches the
diagrams.

## 7. Update the plugin

```bash
claude plugin marketplace update zukai
claude plugin update zukai@zukai
```

## If something is off

- The skill prints every warning from the CLI verbatim (`layout:` means two labels would
  touch, `degraded` means the target cannot draw a feature exactly). Ask it to shorten the
  label or pick another target.
- Preview images are the skill's own check and are never kept; the deliverables are the
  files in the run folder.
- Codex users: copy the skill with `install.sh --target codex` (see install.md) and call it
  with `$zukai` followed by the request in prose.
- Coming from `it-diagrams`: see "Upgrading from it-diagrams" in install.md.
