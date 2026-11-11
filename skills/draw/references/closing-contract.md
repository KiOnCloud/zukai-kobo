# Closing contract

Every mode of the draw skill ends here, with no shortcut, and so does every change made by
the revise skill. `<skill-dir>` is the draw skill's directory, as `SKILL.md` locates it.

Every run writes into one folder of the user's project, `diagrams/<yyyymmdd>_<run-slug>/`,
where the date is today and `<run-slug>` is a short English kebab-case name of the feature
(`login-by-staff`). A re-emit later in the same conversation reuses the folder. Inside:

| Path | Content |
|---|---|
| `source/<slug>.ir.json` | one IR per diagram (the main diagram first, then its parts); with audience `both`, `<slug>-business.ir.json` next to each technical IR |
| `<run-slug>.drawio` | the whole run as one draw.io file, one named page per diagram (target `drawio`) |
| `<run-slug>.md` | the whole run as one Markdown file, one heading and block per diagram (target `mermaid`) |
| `drawio/<slug>.drawio` | each diagram on its own, for reuse (target `drawio`) |
| `mermaid/<slug>.mmd` | each diagram on its own (target `mermaid`) |

Only the folders of the targets actually emitted exist; `source/` always does.

1. Write every IR of the run into `source/`. Say where you wrote them.
2. Run `validate` on each. On exit code 2, show the errors verbatim, fix the IR (only the
   listed paths), and validate again. Do not emit until every IR passes.
3. Emit each diagram on its own into `drawio/` or `mermaid/` with `emit --to <target> --out`,
   then build the combined file with
   `bundle --to <target> --out <run-folder>/<run-slug>.<drawio|md> --title "<feature>" source/*.ir.json`
   (main diagram first). For draw.io with more than one diagram add `--canvas all`, so the
   file opens on a page that shows every diagram side by side before the one-per-page
   copies. For `figjam` follow the target reference; it has no bundle.
4. Review gate. Run `node "<skill-dir>/scripts/bin/cli.mjs" preview <file> --max-px 1600`
   on each individual output file; it renders a PNG into the system temp directory when
   draw.io desktop or Playwright is available, exit 1 with a hint otherwise. The cap keeps
   the longest side at 1600 px so the reviewer can open the image; a very tall or wide
   diagram comes back as tiles, all listed under `files` in the JSON output, and the
   reviewer gets every file. When the labels in the PNG are too small to read (a long
   left-to-right diagram scaled down to the cap), run `preview` again with a larger
   `--max-px` and review that image; `preview` without `--out` writes to the same path each
   time, so the earlier image is replaced. The PNG is the reviewer's working copy, never an
   output for the user. Then
   have the diagrams reviewed against `references/review-checklist.md`: in Claude Code spawn
   the `diagram-reviewer` agent with the IR paths, the PNG paths and the CLI warnings; in
   other runtimes read the checklist and review as a separate, explicit step in the
   reviewer's voice. On `FAIL`, apply every `wrong` and `missing-rule` finding by editing
   the IR (never the output file), apply `polish` findings that are plain IR edits, emit,
   bundle and preview again, and review again. Repeat until `PASS` or three rounds; after
   three rounds deliver anyway and list the remaining findings verbatim. On `PASS`, apply
   the `polish` findings that are plain IR edits (a label wording), validate, emit and
   bundle again without a new review round, and list the ones not applied. A finding that asks
   for something the user chose to leave out is not applied: record the omission in
   `meta.omitted` (with its reason) so the next round does not raise it again. If no
   preview could be rendered, the review runs on the IR and warnings only and says so.
5. Show the user: the run folder, the combined file, the list of diagrams in it, every
   warning verbatim, the review verdict with the number of rounds and any remaining
   findings, the reviewer's own `Images:` line per diagram (opened or not opened; never
   assume it opened them, and when `preview` failed quote its hint, which names where it
   looked for a renderer), the `meta.omitted`
   entries of each diagram as "not shown on purpose", the audience used and why when it was
   not asked (flag or reader named in the request), and a one-line summary per diagram;
   with `both`, list the technical and the business IR of each subject together as two
   views of it. For Mermaid also print each text in a fenced `mermaid` block. In `scout` mode the report describes what the code does and where; it never adds
   open questions, spec doubts, bug suspicions or suggestions about the business logic.
6. Offer the other targets in one line. Do not emit them unless asked.

Rules that hold in every mode:

- Never hand-write Mermaid, draw.io XML or FigJam content. If the CLI cannot express
  something, say what the feature matrix reports and offer another target or a smaller
  diagram.
- Never put credentials, connection strings, tokens or personal data in labels or notes.
  Replace anything that looks like one with a placeholder such as `<db password>`. The CLI
  scans for secrets; treat its warnings as blockers for shared targets.
- Keep ids stable across re-runs so a user can diff IR files: derive them from names
  (`order-service`, `m3`), never from counters alone.
- Labels are what the reader sees. Write them in the user's language. File names, ids and
  the `meta.notes` paths are English ASCII, so the files sort, diff and reference cleanly.
- A `detail:` warning says that an architecture diagram shows the inside of a resource or
  the order of calls (`ir-reference.md`, Level of detail). Fix the IR and emit again before
  the review gate; the author never accepts one. Only the user can keep it: ask once
  (`AskUserQuestion` where the runtime has it), saying in plain words what the warning
  found, with the fix as the first option (one component per resource, the detail in a part
  of the kind that shows it, linked with `ref`) and "keep as drawn" as the second. On
  "keep", add one `meta.notes` entry per kept warning that starts with `detail accepted:`
  and names what was kept ("detail accepted: the six DynamoDB tables stay separate
  components"), so the reviewer and a later revision know the choice was the user's; the
  report lists these entries.
- For draw.io, the CLI reports `layout:` warnings when two labels or a note would still
  overlap after automatic placement. Treat them like any other warning: show them, then offer
  to shorten the label or move the note and emit again.
- One diagram per IR file; the run folder holds all of them and the combined file shows them
  together, so the user never has to open the parts to see the whole.

## When revise calls this contract

The revise skill runs this contract after it changed the IRs of a delivered run. It reuses
the run folder and its run slug, never a new folder, and changes these steps:

- Step 3 rebuilds the combined file with the `bundle` options that `drift` recovered or the
  revision recorded. `canvas: "all"` becomes `--canvas all`. A canvas list is first brought up
  to date: drop the ids the run no longer has, append the diagrams the change added (in file
  order), then pass it as `--canvas a,b,c`; `--title` and `--gap` are passed as recorded.
  Without recorded options, use the run's feature name as the title and, for more than one
  diagram, `--canvas all`. Delete `drawio/<slug>.drawio` or `mermaid/<slug>.mmd` of a
  diagram the change removed.
- Files that revise relabelled in place to keep hand edits are never emitted or bundled
  again, in step 3 or in the review loop. Review findings on them that are label wording are
  applied with `relabel` (the IR gets the same wording); any other finding is listed in the
  report and applied only if the user agrees to redraw that file, after a `snapshot` with
  the file as `--extra`.
- Step 5 adds the route taken (direct, consult, new diagram or undo), the revision written
  (`history/rNNN`), the change list from `diff` in plain words and the outcome of the drift
  check.
- Step 6 is skipped unless the user asks for another target.
