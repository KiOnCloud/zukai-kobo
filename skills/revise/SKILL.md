---
name: revise
description: Change diagrams Zukai already delivered. Replace, add, remove or reword steps, participants, states or connections in an existing run, or explore a what-if by proposing two or three draft variants to compare before anything is overwritten. Edits the IR only, keeps the last five revisions for rollback, warns before overwriting hand edits made in draw.io, then re-emits through the draw skill's closing contract. Use for "add a validation step to the login flow", "replace Redis with SQS in the architecture", "what if approval came before payment?", "undo the last change". Not for new diagrams, which the draw skill makes.
---

# Zukai revise

Change a run that the draw skill delivered, through one of three routes: apply a clear change
directly, consult on a what-if with drafts the user compares and confirms, or undo to an
earlier revision. The model edits IR only. Everything else (diff, hand-edit check, history,
emit, review) comes from the draw skill's CLI and closing contract, which this skill never
copies.

## Locate the draw skill

`<revise-dir>` is the directory that contains this `SKILL.md`. Claude Code substitutes it
here: `${CLAUDE_SKILL_DIR}`. If that line shows a literal variable name, use the path where
you read this file.

`<draw-dir>` is the sibling folder of the draw skill: `<revise-dir>/../draw` inside the
plugin, `<revise-dir>/../zukai` in a copied install (`.agents/skills/zukai` for Codex,
`.claude/skills/zukai` without the plugin). Use the first of the two that contains
`scripts/bin/cli.mjs`; if neither does, stop and name both paths you tried. Every CLI call
and every shared reference comes from `<draw-dir>`:

```bash
node "<draw-dir>/scripts/bin/cli.mjs" diff <old.ir.json|old-dir> <new.ir.json|new-dir>
node "<draw-dir>/scripts/bin/cli.mjs" drift <file.drawio> <ir.json|run-dir>...
node "<draw-dir>/scripts/bin/cli.mjs" snapshot <run-dir> --request "<text>" [--extra <file>]... [--bundle @<file>]
node "<draw-dir>/scripts/bin/cli.mjs" revisions <run-dir>
node "<draw-dir>/scripts/bin/cli.mjs" restore <run-dir> <rNNN> [--extra <file>]... [--bundle @<file>]
```

`--extra` paths are read from the working directory like every other path. `--bundle` takes
the `bundle` object that `drift` printed; write it to a temporary file outside the run
folder and pass `@<file>`, so a quote in a title never meets the shell.

Shared references: `<draw-dir>/references/ir-reference.md` (IR fields per kind),
`variants.md` (business views and language variants), `closing-contract.md` (how every
change ends), `review-checklist.md` and the `target-*.md` files.

## Arguments

Claude Code appends them as `ARGUMENTS: <text>`; in other runtimes read them from the request.

```text
[<run-folder|ir-path>] [--preview|--apply] <request>
```

- A path first selects the run (an IR path means the run folder that holds it).
- `--preview` forces the consult route, `--apply` the direct route. Both together is an
  error: say so and stop.

## 1. Find the run

A run is a folder `diagrams/<yyyymmdd>_<run-slug>/` with a `source/` folder of IR files.

1. A path argument wins.
2. Otherwise a run made or revised earlier in this conversation, when the request does not
   name another one.
3. Otherwise list the runs under `diagrams/` in the working directory. One run whose slug or
   diagram titles match the request: use it and say which. None or several: ask once with
   `AskUserQuestion`, up to four runs, newest first, labelled by date and slug, each with its
   diagram titles as the description.
4. No run at all: stop and say that nothing was delivered yet, so the draw skill is the one
   to use (`/zukai:draw` in the plugin, `/zukai` or `$zukai` in a copied install).

A `drafts/` folder left in the run by an earlier session is reported first: offer to resume
that consult (go to the consult protocol, step 4) or drop it (delete `drafts/`).

## 2. Read the state

Read every `source/*.ir.json`, `<draw-dir>/references/ir-reference.md`, and note the targets
the run has: `drawio/` and a `<run-slug>.drawio`, or `mermaid/` and a `<run-slug>.md`.

## 3. Check for hand edits (draw.io runs)

Run `drift` on the combined file with the run folder (`drift <run>/<run-slug>.drawio <run>`)
and on each `drawio/<slug>.drawio` with its IR. Keep the `bundle` object of the combined
file's result: it holds the `--title`, `--canvas` and `--gap` the file was built with.

When nothing drifted, continue. When something did, tell the user in plain words what
differs ("the box 'Approve' was moved", "the label 'Pay' reads 'Pay now'"). The CLI compares
with what this version of the skill would draw, so an upgrade between delivery and now shows
up the same way; say that once. Then:

- A label-only request keeps the hand edits: after the snapshot, change the labels in the IR
  (validate it), write a map to a temporary file outside the run folder, and run
  `relabel <file> --map <map> --out <file>` on each drifted draw.io file instead of emitting
  it again. Key the map by `<page id>:<ir id>` (`"checkout:pay": "Pay by card"`; the page id
  is the `diagram` that `drift` printed for that page): in the
  combined file a bare id would also rename the same id on every other page. `relabel`
  reports how many cells it changed by matching text (`byText`); name them in the report,
  since a hand-copied shape is renamed that way too. These files stay out of the closing
  contract's emit and bundle steps (its revise section says how). Files that did not drift
  are emitted as usual.
- Any other request redraws the files and loses the hand edits. Ask once: "redraw and lose
  these edits" or "stop". On redraw, pass every drifted file to `snapshot` with `--extra`, so
  it is kept under `history/rNNN/extras/`, and say where.

Mermaid runs skip this step: text output has no layout to lose.

## 4. Choose the route

| Route | When | Next |
|---|---|---|
| Undo | "undo", "revert", "go back", "quay lại", "hoàn tác", or a revision named (`r003`) | step 7 |
| Consult | what-if or question phrasing ("what if", "should we", "try", "nếu … thì sao", "có nên", "thử"); or a change that removes elements, or reaches a `ref` part or a `-business` view; or `--preview` | step 6 |
| Direct | everything else, or `--apply` | step 5 |

Say which route was taken and why, in one line, in the user's language.

## 5. Direct route

1. Clarify gate. Every change must pin three things: its anchor (the element it goes before,
   after or instead of, and on which branch), the outcome of each new branch (where a failed
   check goes), and the diagrams it touches (the main diagram, its `ref` parts, its
   `-business` view). When one is missing, ask once with `AskUserQuestion`: at most four
   questions, concrete placements as options, in the user's language, with the English
   keyword in parentheses where a value maps to the IR, as the draw skill does.
2. Snapshot: `snapshot <run> --request "<the request>" --bundle @<file>` (plus `--extra`
   from step 3). Note the revision it prints.
3. Edit the IRs. Old ids never change; new ids come from names (`validate-card`), never from
   counters alone. A change to a technical diagram that has a `-business` view is carried
   into that view by `variants.md`. A step that gains or loses a `ref` part changes the part
   too. A run whose IR says `meta.source: "scout"` and receives a change the code does not
   have: set `meta.source` to `"manual"` and add a `meta.notes` entry saying from which
   revision on it no longer reflects the code.
4. `diff <run>/history/<rNNN>/source <run>/source` and read every hint it prints. A hint
   about a part or a business view is either applied now or answered in the report.
5. Run `<draw-dir>/references/closing-contract.md` in full (its section "When revise calls
   this contract" says what changes for a revision).

## 6. Consult route

Read `<revise-dir>/references/consult-protocol.md` and follow it. It builds two or three
drafts under `drafts/`, has the user pick, adjust and confirm one, and only then writes the
run. Nothing in `source/` or in the delivered files changes before that confirmation.

## 7. Undo route

1. `revisions <run>`. Show them newest first as `rNNN · date · request`. A revision that a
   restore wrote carries `undoOf: rNNN` (the revision it went back to).
2. Pick the target:
   - a named revision is used as given;
   - "undo the undo", "redo": the newest revision, when it carries `undoOf`;
   - a plain "undo" or "the last change": the newest revision that steps back from where the
     run is now. When the newest revision carries `undoOf: rX`, that is the newest revision
     older than `rX` without `undoOf` (so a second "undo" goes further back instead of
     redoing); otherwise it is the newest revision. When there is none, say there is
     nothing earlier to go back to;
   - anything else: ask which, with `AskUserQuestion` (the four newest as options).
3. `restore <run> <rNNN> --bundle @<file> [--extra <file>]...`, with the current `bundle`
   options from step 3 and, when the user agreed to redraw drifted files, those files as
   `--extra`. Never run a separate `snapshot` first: it would rotate the oldest revision
   away, which may be the target. `restore` snapshots the current state itself, so the undo
   can be undone; say which revision holds the state you just left.
4. Rebuild the outputs: run the closing contract with the `bundle` options that `restore`
   printed (those of the restored revision). When that revision kept hand-edited files under
   `history/rNNN/extras/`, say so: they match the restored IRs and can be copied back over
   the emitted files if the user wants their old layout.

## 8. Report

The closing contract's report, plus: the route and why, the revision written and where the
previous state is (`history/rNNN`), the `diff` change list in plain words (added, removed,
changed, and every hint with what was done about it), and the outcome of the hand-edit check.

## Rules

- Never edit `.drawio` or `.mmd` files by hand, and never touch `history/` except through
  the CLI. The IR is the source; `relabel` is the only tool that writes a delivered draw.io
  file without emitting it.
- Never overwrite delivered files before the user confirmed a consult draft.
- Keep every rule of the closing contract: labels in the user's language, file names and ids
  in English ASCII, no secrets in labels, warnings shown verbatim.
