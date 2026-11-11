---
name: revise
description: Change diagrams Zukai already delivered. Replace, add, remove or reword steps, participants, states or connections in an existing run, or explore a what-if by proposing two or three draft variants to compare before anything is overwritten. Edits the IR only, keeps the last five revisions for rollback, warns before overwriting hand edits made in draw.io, then re-emits through the draw skill's closing contract. A request to add a whole diagram to a run goes through the draw skill's opening questions and diagram rules first. Use for "add a validation step to the login flow", "replace Redis with SQS in the architecture", "what if approval came before payment?", "add an architecture diagram to that run", "undo the last change". Not for a first diagram, which the draw skill makes.
---

# Zukai revise

Change a run that the draw skill delivered, through one of four routes: apply a clear change
directly, consult on a what-if with drafts the user compares and confirms, add a diagram the
run does not have yet, or undo to an earlier revision. The model edits IR only. Everything else (diff, hand-edit check, history,
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
node "<draw-dir>/scripts/bin/cli.mjs" drift <file.drawio|run-slug.md> <ir.json|run-dir>...
node "<draw-dir>/scripts/bin/cli.mjs" snapshot <run-dir> --request "<text>" [--extra <file>]... [--bundle @<file>]
node "<draw-dir>/scripts/bin/cli.mjs" revisions <run-dir>
node "<draw-dir>/scripts/bin/cli.mjs" restore <run-dir> <rNNN|undo|redo> [--extra <file>]... [--bundle @<file>]
```

`--extra` paths are read from the working directory like every other path. `--bundle` takes
the `bundle` object that `drift` printed; write it to a temporary file outside the run
folder and pass `@<file>`, so a quote in a title never meets the shell.

Shared references: `<draw-dir>/references/ir-reference.md` (IR fields per kind),
`variants.md` (business views and language variants), `closing-contract.md` (how every
change ends), `review-checklist.md` and the `target-*.md` files.

## Asking the user

Every question of this skill and of the consult protocol is written for `AskUserQuestion`.
A runtime without that tool (Codex) asks the same question as one text message: the
question, its options as a lettered list with the suggested one first and marked, and "reply
with a letter or your own words". Where the text names no suggestion, none is marked and
the user's answer is awaited; never pick for them.

## Arguments

Claude Code appends them as `ARGUMENTS: <text>`; in other runtimes read them from the request.

```text
[<run-folder|ir-path>] [--preview|--apply] <request>
```

- A path first selects the run (an IR path means the run folder that holds it). The first
  argument is a path when it names something that exists on disk, or ends in `.ir.json`, or
  contains a `/`; anything else is the first word of the request.
- `--preview` forces the consult route, `--apply` the direct route. Both together is an
  error: say so and stop. They choose between those two routes only: neither turns a request
  for a new diagram into an edit.

## 1. Find the run

A run is a folder `diagrams/<yyyymmdd>_<run-slug>/` with a `source/` folder of IR files.

1. A path argument wins. A path that does not exist, or that is neither a run folder nor an
   IR inside one, is an error: say which path it was and what is missing (`source/`), list
   the runs under `diagrams/`, and stop. Never fall back to another run in its place.
2. Otherwise the runs made or revised earlier in this conversation. One run: use it, unless
   the request names another. Several: the one the request points at, by its slug, a
   diagram title or the labels of its elements (a request about "the validation step"
   belongs to the run that has one). When that singles out no run, ask as in rule 3; the
   most recent one is not a default.
3. Otherwise list the runs under `diagrams/` in the working directory and read their IRs.
   One run whose slug, diagram titles or element labels match the request: use it and say
   which. None or several: ask once with `AskUserQuestion`, up to four runs, newest first,
   labelled by date and slug, each with its diagram titles as the description.
4. No run at all: stop and say that nothing was delivered yet, so the draw skill is the one
   to use (`/zukai:draw` in the plugin, `/zukai` or `$zukai` in a copied install).

Once the run is found, a `drafts/` folder left in it by an earlier session is reported
first: offer to resume that consult (go to the consult protocol, step 4, with the request and
the draft names from `drafts/consult.json`) or drop it (delete `drafts/`). On "resume" the
new request waits until that consult is confirmed or dropped; on "drop" it goes on from
step 2.

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
up the same way; say that once. Two marks in the result need a sentence each:

- `relabelled: <n>` on a page: an earlier label-only revision rewrote that page in place.
  Its boxes are compared with the layout they were drawn for, so the changes listed are
  hand edits only. With `unresolved` in the result the CLI could not put an old label back
  and compares positions with a fresh drawing instead: then say that the moves it lists may
  come from the rewording, not from the user.
- `legacyIds: true`: the file was delivered by version 2.0.3 or older, whose page ids were
  cut at 40 characters. It is compared as it was written; a redraw gives it full ids.

Then:

- A label-only request keeps the hand edits: after the snapshot, change the labels in the IR
  (validate it), write a map to a temporary file outside the run folder, and run
  `relabel <file> --map <map> --out <file>` on each drifted draw.io file instead of emitting
  it again. Key the map by `<page id>:<ir id>` (`"checkout:pay": "Pay by card"`; the page id
  is the `diagram` that `drift` printed for that page, which is the diagram id in lower
  case): in the combined file a bare id would also rename the same id on every other page,
  the business view first of all. Write one map per file, with the keys of that file only:
  a key for a page the file does not have comes back as `unmatched`. `relabel`
  reports how many cells it changed by matching text (`byText`); name them in the report,
  since a hand-copied shape is renamed that way too, and so is the same text on another
  page. The labels the map left alone come back as one warning line; that is expected for
  a rewording and needs no `$keep` list. These files stay out of the closing
  contract's emit and bundle steps (its revise section says how). Files that did not drift
  are emitted as usual.
- Any other request redraws the files and loses the hand edits. Ask once: "redraw and lose
  these edits" or "stop". On redraw, pass every drifted file to `snapshot` with `--extra`, so
  it is kept under `history/rNNN/extras/`, and say where. The CLI never deletes these
  copies: when their revision is rotated out, they move to `history/extras/rNNN/` and the
  command that did it lists them as `keptExtras`; pass that on to the user.

Mermaid runs have no layout to lose, but the same command reads their combined file:
`drift <run>/<run-slug>.md <run>` returns the `bundle` object (the title the file was
written with) and names a diagram whose text was edited by hand. Treat such an edit like a
hand edit in draw.io: ask before redrawing, and keep the file with `--extra`.

## 4. Choose the route

| Route | When | Next |
|---|---|---|
| Undo | "undo", "revert", "go back", "quay lại", "hoàn tác", or a revision named (`r003`) | step 7 |
| New diagram | the request asks for a diagram the run does not have: another kind, another view, a part that details one element, a second version of a delivered diagram at another level of detail ("add an architecture diagram", "also draw the sequence", "a detailed version of it", "thêm sơ đồ kiến trúc", "vẽ thêm", "bổ sung diagram") | step 8 |
| Consult | what-if or question phrasing ("what if", "should we", "try", "nếu … thì sao", "có nên", "thử"); or a change that removes elements; or a change of structure (a step, branch, participant or connection added, moved or reconnected) that has to be carried into a `ref` part or a `-business` view; or `--preview` | step 6 |
| Direct | everything else, or `--apply`. A change of wording only (a label, a title, a guard) is always direct, in however many parts and views the same wording appears: it is carried into each of them in step 5 | step 5 |

The table is read top to bottom and the first row that fits wins, so a request for a new
diagram never reaches the direct route, whatever its wording. Say which route was taken and
why, in one line, in the user's language.

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
   about a part or a business view is either applied now or answered in the report. The
   list has four parts: `added`, `removed`, `changed` (with the fields that differ) and
   `reordered` (the elements that moved and what each now follows), since the order of
   messages, participants and lanes is part of what the reader sees.
5. Run `<draw-dir>/references/closing-contract.md` in full (its section "When revise calls
   this contract" says what changes for a revision).

## 6. Consult route

Read `<revise-dir>/references/consult-protocol.md` and follow it. It builds two or three
drafts under `drafts/`, has the user pick, adjust and confirm one, and only then writes the
run. Nothing in `source/` or in the delivered files changes before that confirmation.

## 7. Undo route

1. `revisions <run>`. Show them newest first as `rNNN · date · request`. The result also
   says where one step leads from the state the run is in now: `undo` is the revision a
   plain undo restores, `redo` the one a redo restores, `null` when there is none. The CLI
   keeps both along one line of states, so "undo, undo, redo, redo" ends where it started.
2. Pick the target:
   - a named revision is used as given;
   - a plain "undo" or "the last change": `undo`. When it is `null`, say there is nothing
     earlier to go back to;
   - "undo the undo", "redo": `redo`. When it is `null`, say there is nothing to redo (a
     change made after an undo starts a new line, and what was undone can then only be
     restored by naming its revision);
   - anything else: ask which, with `AskUserQuestion` (the four newest as options).

   Never work the target out from the list yourself: pass the word. `restore <run> undo`
   and `restore <run> redo` take the step and fail with a plain message when there is none.
3. `restore <run> <rNNN|undo|redo> --bundle @<file> [--extra <file>]...`, with the current `bundle`
   options from step 3 and, when the user agreed to redraw drifted files, those files as
   `--extra`. Never run a separate `snapshot` first: it would rotate the oldest revision
   away, which may be the target. `restore` snapshots the current state itself, so the undo
   can be undone; say which revision holds the state you just left.
4. Rebuild the outputs: run the closing contract with the `bundle` options that `restore`
   printed (those of the restored revision). When that revision kept hand-edited files,
   `restore` lists them as `extras` (under `history/rNNN/extras/`, or `history/extras/rNNN/`
   once the revision was rotated out); say so: they match the restored IRs and can be copied
   back over the emitted files if the user wants their old layout.

## 8. New diagram route

A new diagram is the draw skill's work, done inside this run. Revise keeps what it owns (the
run, the hand-edit check, the snapshot, the change list, the report) and takes every rule
about the diagram itself from the draw skill, which it never copies.

1. Read `<draw-dir>/SKILL.md` and follow it from "Arguments and modes" to the point where it
   hands over to the closing contract, as if the request had been given to the draw skill:
   its opening call (mode, kind, scope, view; a question is skipped only where that file
   allows it), the protocol of the mode, `ir-reference.md` for the kind, and for an
   `architecture` diagram its "AWS icons" and "Level of detail" paragraphs. The delivered
   run answers none of these questions in the user's place, except the target, which is the
   run's.
2. Place the diagram in the run before writing it, and say in one line which of these it is:
   - a part: it details one step, message, state, component, class or entity of a delivered
     diagram. Its slug is `<main-slug>-NN-<part>`, its title names the element, and that
     element gets `ref`. Detail asked of an `architecture` diagram is always a part of the
     kind that shows it (the order of calls as `sequence` or `activity`, the tables as
     `er`), because the architecture diagram itself stays at the level of deployed
     resources.
   - a view: a `-business` IR beside a technical one, by `variants.md`.
   - a diagram of its own: another kind for the same feature that details no single element
     (a state diagram beside a sequence). It gets its own slug, and the report says that
     nothing links to it.

   A second diagram of the kind and subject of a delivered one, differing only in how much
   it shows, is none of these and is never written. Ask once with `AskUserQuestion` which
   the user wants: the detail as parts linked with `ref` (first option, with the kinds
   named), or a change to the delivered diagram itself (then go to the consult route).
3. Snapshot as in the direct route: `snapshot <run> --request "<the request>" --bundle
   @<file>`, plus `--extra` from step 3.
4. Write the new IR into `source/` and make the edit the placement needs (the `ref` on the
   element a part details). Old ids never change.
5. `diff <run>/history/<rNNN>/source <run>/source` and read every hint. "is not the ref of
   any element" and "is a second architecture diagram" name exactly the placements step 2
   rules out: fix the run, or, for a diagram of its own, say so in the report.
6. Run `<draw-dir>/references/closing-contract.md` in full. The canvas of the combined file
   gains the new diagram, as the contract's revise section says.

## 9. Report

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
