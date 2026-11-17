# Closing contract

Every mode of the draw skill ends here, with no shortcut, and so does every change made by
the revise skill. `<skill-dir>` is the draw skill's directory, as `SKILL.md` locates it.

Every run writes into one folder of the user's project, `diagrams/<yyyymmdd>_<run-slug>/`,
where the date is today and `<run-slug>` is a short English kebab-case name of the feature
(`login-by-staff`). A re-emit later in the same conversation reuses the folder. Inside:

| Path | Content |
|---|---|
| `source/<slug>.ir.json` | one IR per diagram (the main diagram first, then its parts); with audience `both`, `<slug>-business.ir.json` next to each technical IR. A recook of a source whose pages are unrelated is the one run without a main diagram: its files are `<run-slug>-NN-<name>.ir.json` in the order of the source (the recook skill, "Pages that have nothing to do with each other") |
| `<run-slug>.drawio` | the whole run as one draw.io file, one named page per diagram (target `drawio`) |
| `<run-slug>.md` | the whole run as one Markdown file, one heading and block per diagram (target `mermaid`) |
| `drawio/<slug>.drawio` | each diagram on its own, for reuse (target `drawio`) |
| `mermaid/<slug>.mmd` | each diagram on its own (target `mermaid`) |
| `svg/<slug>.drawio.svg` | a picture of each diagram that GitHub, a browser or a wiki shows and draw.io still opens for editing; written only when asked for (step 5; target `drawio`) |
| `figjam/<slug>.mmd` | the text sent to FigJam, kept so it can be previewed and reviewed before the board is made (target `figjam`) |
| `figjam/<slug>.overlay.js` | for a sequence diagram: the script that draws on the board what `generate_diagram` leaves out (target `figjam`, `target-figjam.md` section 5) |
| `figjam/<slug>.native.js` | the script that draws the whole board at the draw.io layout (`emit --native`, `target-figjam.md` section 7); `<slug>.native.2.js` and so on when the drawing needs more than one. A class, activity or use case diagram has this file only, since it has no text for `generate_diagram` |
| `<run-slug>.<lang>.drawio`, `source/labels.<lang>.json` | a language variant of the combined file and its label map (`variants.md`) |
| `<run-slug>.doc.md` | the description tables of the whole run as one Markdown document, one section per diagram; only when the user asked for them (section "Description tables" below) |
| `<run-slug>.doc.<lang>.md` | the description tables in a second language: headings in that language, labels as the IRs have them (section "Description tables") |
| `source/<lang>/<slug>.ir.json` | the translated IRs of a language variant (`variants.md`). They lie one folder below `source/`, so no command that takes the run folder counts them as further diagrams and `sources` and `stale` never see them |
| `drafts/` | the drafts of an open consult and the pictures of applied changes; never delivered (section "The drafts folder" below) |
| `source/<run-slug>.facts.json` | a recooked run only: what `extract` read from the source, with credentials and personal data replaced by placeholders (the source itself is never copied here) |
| `source/<run-slug>.sources.json` | a scouted run only: a hash of every file in the `meta.sources` of its diagrams, written by `sources` and read by `stale` and the sync skill |
| `history/` | revisions written by the revise skill; only the CLI writes here |

Only the folders of the targets actually emitted exist; `source/` always does.

1. Write every IR of the run into `source/`. Say where you wrote them.
2. Run `validate` on each. On exit code 2, show the errors verbatim, fix the IR (only the
   listed paths), and validate again. Do not emit until every IR passes. A valid IR can
   still print warnings on stderr, the same ones every emit repeats: `model:` (a decision
   with one way out, a step connected to nothing, a state never reached, a reply before its
   call, a foreign key without a relation, a use case no actor reaches, an actor without a
   use case), `size:` (far more elements than a reader
   follows), `detail:` and the secret scan. Fix the IR for each `model:` warning before
   emitting, or record the reason in `meta.omitted` when the gap is on purpose (the warning
   then stays, and the report quotes it beside that entry). On a `size:` warning, say the
   count to the user and offer the scope `detailed`, which moves each sub-flow into a part;
   draw it as it is only when the user wants one picture. `detail:` and the secret scan are
   handled as the rules below say.
3. Emit each diagram on its own into `drawio/` or `mermaid/` with `emit --to <target> --out`,
   then write the combined file with
   `bundle --to <target> --out <run-folder>/<run-slug>.<drawio|md> --title "<feature>" <run-folder>`.
   Give the run folder, not the files: the CLI then takes every IR of `source/` in run
   order (the main diagram, its business view, then each part followed by its business
   view) and prints that order as `order`. A shell pattern such as `source/*.ir.json` puts
   the parts and the business views before the main diagram, because `-` sorts before `.`;
   list files one by one only to bundle a subset, in the order you want. For draw.io with
   more than one diagram add `--canvas all`, so the file opens on a page that shows every
   diagram side by side before the one-per-page copies. For `figjam` follow the target
   reference; it has no bundle. A run with description tables gets them written here too,
   after the combined file (section "Description tables").
4. Review gate. Run `node "<skill-dir>/scripts/bin/cli.mjs" preview <file> --max-px 1600`
   on each individual output file and on the combined file, which is what the user opens
   first: `<run-slug>.drawio` renders its first page (the canvas, or the main diagram; `--page
   <id|name>` renders another page, and a name the file does not have exits 1 with the
   list of its pages), and `<run-slug>.md` renders every block to its own image. Only the combined file shows a
   `ref` step with the part's title instead of its slug, so the review has to see it. The
   command renders a PNG into the system temp directory when
   draw.io desktop or Playwright is available, exit 1 with a hint otherwise. The cap keeps
   the longest side at 1600 px so the reviewer can open the image; a very tall or wide
   diagram comes back as tiles, all listed under `files` in the JSON output, and the
   reviewer gets every file. When the labels in the PNG are too small to read (a long
   left-to-right diagram scaled down to the cap), run `preview` again with a larger
   `--max-px` and review that image; `preview` without `--out` writes each file to a path of
   its own (made from its name, its type and its full path) and to the same one each time,
   so the earlier image of that file is replaced and no other file's image is. Always take
   the paths from `files` in the output, never from memory. The PNG is the reviewer's working copy, never an
   output for the user. Then
   have the diagrams reviewed against `references/review-checklist.md`: where the
   `diagram-reviewer` agent is available, spawn it with the IR paths, the PNG paths and the
   CLI warnings; anywhere else read the checklist and review as a separate, explicit step
   in the reviewer's voice (section "Agents that may not be there" below). On `FAIL`, apply every `wrong` and `missing-rule` finding by editing
   the IR (never the output file), apply `polish` findings that are plain IR edits, emit,
   bundle and preview again, and review again. Repeat until `PASS` or three rounds; after
   three rounds deliver anyway and list the remaining findings verbatim. On `PASS`, apply
   the `polish` findings that are plain IR edits (a label wording), validate, emit and
   bundle again without a new review round, and list the ones not applied. In a recooked
   run (`meta.source: "recook"`) a polish finding that only rewords a label copied from the
   source is not applied: list it with the offer of a `revise`. A finding that asks
   for something the user chose to leave out is not applied: record the omission in
   `meta.omitted` (with its reason) so the next round does not raise it again. If no
   preview could be rendered, the review runs on the IR and warnings only and says so.
   A scouted run ends this step by recording its sources, once, when the last review round
   is over: before the pictures of step 5 and before the report (section "Sources of a
   scouted run" below has the command).
5. Pictures, only when asked for: the invocation carried `--svg`, or the user wants an
   image of the diagrams for a wiki, a README or a design document. For target `drawio`,
   once the review is over and the files are final, run
   `node "<skill-dir>/scripts/bin/cli.mjs" export <run-folder>`. It writes
   `svg/<slug>.drawio.svg` for every page of `<run-slug>.drawio` (each diagram, and
   `svg/canvas.drawio.svg` for the page that shows them side by side) and lists them under
   `files`. Such a file is an SVG picture with the diagram inside: Markdown shows it with
   `![<title>](svg/<slug>.drawio.svg)`, and draw.io opens the same file for editing. To
   look at one, run `preview svg/<slug>.drawio.svg`: it renders the diagram the picture
   carries, which is the page the review already saw, so the pictures need no review of
   their own. `export <run-folder> --page <id|name>` writes the picture of one page only. Each
   picture holds its own page only, so a step that refers to a part keeps its label and the
   part's title but has no link to it. The command needs the renderer `preview` uses and
   writes nothing without one: on exit 1 quote its hint, which names where it looked, say
   that no picture was written and that the `.drawio` file is complete without it, and
   never make an SVG any other way. Show its warnings verbatim (`text: "html"` in the
   output means draw.io desktop drew the pictures without Playwright beside it, so the
   labels are HTML that only a browser shows). A Mermaid or FigJam run has no draw.io file
   to export: say so and offer the `drawio` target. Not asked for, the step is skipped and
   step 7 offers it.
6. Show the user: the run folder, the combined file, the list of diagrams in it, the
   pictures of step 5 when they were written, every
   warning verbatim, the review verdict with the number of rounds and any remaining
   findings, the reviewer's own `Images:` line per diagram (opened or not opened; never
   assume it opened them, and when `preview` failed quote its hint, which names where it
   looked for a renderer), the `meta.omitted`
   entries of each diagram as "not shown on purpose", the audience used and why when it was
   not asked (flag or reader named in the request), and a one-line summary per diagram;
   with `both`, list the technical and the business IR of each subject together as two
   views of it. For Mermaid also print each text in a fenced `mermaid` block. In `scout` mode the report describes what the code does and where; it never adds
   open questions, spec doubts, bug suspicions or suggestions about the business logic.
   A scouted run has one line about the sources record that step 4 ended with.
7. Offer the other targets in one line, in the same line the description tables when the
   run has none, and for a `drawio` run without pictures the SVG pictures for a wiki or a
   README. Do not emit or export them unless asked.

Rules that hold in every mode:

- Never hand-write Mermaid, draw.io XML or FigJam content. If the CLI cannot express
  something, say what the feature matrix reports and offer another target or a smaller
  diagram.
- Never put credentials, connection strings, tokens or personal data in labels or notes.
  Replace anything that looks like one with a placeholder such as `<db password>` or
  `<customer e-mail>`. The CLI scans every string of the IR on `validate` and on every emit
  (it knows the words for a secret in English, Vietnamese and Japanese) and acts by what it
  found:
  - a credential by its form (a URI with a password, a known token prefix, a private key,
    `password=<value>`): no target writes it, unless the user's `--allow-sensitive` says it
    is not one. `emit` and `bundle` exit 2 with `refusing to
    emit for <target>`. Fix the IR.
  - a guess (`high-entropy`, `assignment` such as "token: required", `personal-data` for a
    mail address or a telephone number): a warning for `drawio` and `mermaid`, a refusal
    for `figjam`, whose labels leave the machine. A run folder is usually committed or sent
    to a client, so fix the IR for these too before delivering; leave one in only when the
    user says it is not a secret, and say so in the report.
  - An address that stands for "an address" is not reported: one at `example.com`,
    `example.org`, `example.net` or under `.example`, `.test`, `.invalid`, `.localhost`, and
    one that begins `user@`, `name@`, `email@`, `someone@` or `xxx@`. Every address of a
    label is looked at, so a real one beside a placeholder is still reported. Use such a form, or a placeholder in
    angle brackets, wherever a label needs to show that an address goes there.
  - `--allow-sensitive` is the user's word that a finding is not a secret. Pass it only
    after the user said so for that value, never on your own.
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
  "keep", add one `meta.notes` entry per kept warning that starts with `detail accepted:`,
  quotes every id the warning named and says what was kept (`detail accepted: "orders",
  "payments" and "audit" stay separate components, the user's choice`), so the reviewer and
  a later revision know the choice was the user's; the report lists these entries. The CLI
  reads them: a warning whose ids are all quoted in such an entry is not repeated, and it
  comes back when an element is added that was never accepted. The question is due when
  the request itself asked for what the warning names (the tables one by one, the numbered
  calls); a breach nobody asked for is fixed without a question.
- For draw.io, the CLI reports `layout:` warnings when two labels or a note would still
  overlap after automatic placement. Treat them like any other warning: show them, then offer
  to shorten the label or move the note and emit again.
- One diagram per IR file; the run folder holds all of them and the combined file shows them
  together, so the user never has to open the parts to see the whole.

## Sources of a scouted run

A run with a diagram whose `meta.source` is `scout` ends step 4 with one more command, after
the last review round and before the pictures and the report, run from the project root:

```bash
node "<skill-dir>/scripts/bin/cli.mjs" sources <run-folder>
```

It writes `source/<run-slug>.sources.json`: for every diagram, each file of its
`meta.sources` with a SHA-256 of its content (CRLF is hashed as LF). `stale <run-folder>`
compares that record with the files later, and the sync skill starts from its answer. The
paths are read from the project root: the nearest folder at or above the run folder that
holds `.git`, else the working directory; pass `--root <project>` when the paths of
`meta.sources` start from another folder.

- Record only when the diagrams were just read from the code as it is now: at the end of a
  scout run and at the end of a sync (the sync skill says when). The record is a statement
  that the diagrams match these files, so it is never refreshed for any other reason.
- One diagram is recorded alone, with `sources <run-folder> --only <diagram-id>`, when a
  revision drew into it what a file of the project already has (the revise skill, direct
  route): the file was read for that change, it joins `meta.sources`, and the record of
  that diagram is taken again so that `stale` stays current. Run `stale <run-folder>`
  first. When it lists a changed or deleted file for that diagram, the diagram is already
  behind the code in a place the revision did not look at: do not record it, leave the
  `unrecorded` entry `stale` will show, and say that the sync skill brings it up to date.
- `missing` in the output lists the entries that are not files under the root. Fix the path
  in the IR (validate, then `sources` again) until the list is empty; an entry that stays
  missing is never checked.
- `fallback` lists the diagrams that had no `meta.sources` and were recorded from the paths
  in their `meta.notes`. That only happens to a run drawn by an older version; a diagram
  written now always has the field.
- The report says in one line that the sources were recorded, how many files, and that
  `stale <run-folder>` (or the sync skill) tells when the code has moved on. The run folder
  is committed with the record in it.

## Description tables

A run can carry its diagrams as text beside the picture: `<run-slug>.doc.md`, Markdown
tables that list every element of every diagram, for a specification or a design document.
A sequence diagram becomes its numbered steps (from, to, message, kind, the condition of the
block it stands in), a state diagram a list of states and a state by event table, an ER
diagram one table of attributes per entity and the relations, an activity diagram the steps
with their lane, their hand-offs and guards, a flowchart the steps and each decision with
its outcomes, a class diagram the members of each type and the relations, an architecture
diagram the components, the data stores, the queues, the boundaries and the connections, a
use case diagram the actors with their kind and role, the use cases with their boundary, the
boundaries and the relations with the condition of each extend.

Write them when the user asks for a description, a specification table or text for a design
document ("a table of the steps", "bảng mô tả", "設計書に貼る表"), or passed `--doc`. Without
that, step 7 offers them and nothing is written. They are no target: a run has them beside
its draw.io or Mermaid files, never in their place.

```bash
node "<skill-dir>/scripts/bin/cli.mjs" bundle --to doc --lang <en|ja|vi> --out <run-folder>/<run-slug>.doc.md --title "<feature>" <run-folder>
```

- Run it in step 3, after the combined file, and again whenever step 4 changed an IR, so the
  tables always say what the delivered diagrams show. Give the run folder, as for every
  bundle.
- `--lang` is the language of the headings, the column headers and the fixed words (a
  message kind, "Yes"): the user's language when it is English, Japanese or Vietnamese,
  `en` otherwise. Labels are never translated: they are the labels of the IR.
- Tables asked for in a language the run was not drawn in ("the tables in Japanese" for a
  run with English labels) are a second file, `<run-slug>.doc.<lang>.md`, written with
  `--lang <lang>` from the run folder: its headings, column headers and fixed words are in
  that language, and every label, title, guard and omitted entry stays as the IR has it.
  Say that plainly when you name the file: the document is in two languages, and it is
  complete. `<run-slug>.doc.md` stays in the language of the run.
- Translated labels need a language variant of the run, which is more than a flag: the
  translated IRs of `variants.md` ("Language variants"), kept in `source/<lang>/`, and the
  tables written from that folder. Offer it in one line when the user asks for the tables
  in another language, and make it only when they say yes.
- An element with `ref` links to the section of its part, so the document is read like the
  combined file: the main diagram first, each part below it. `emit --to doc <ir.json> --out
  <file>` writes the tables of one diagram alone when the user wants only that one; there a
  `ref` shows the id of the part.
- The file is generated. Never edit it by hand and never write such a table yourself: a
  change goes into the IR and the file is written again. Its first line records the
  language it was written in.
- The secret scan runs as for every local file: a credential by its form stops the command
  with exit code 2, a guess is a warning. The feature matrix is not asked, since a table
  leaves nothing out. The command prints the `model:` and `detail:` warnings of every
  diagram again, word for word as the emit of step 3 printed them: show each once in the
  report, not once per command.
- The tables are not previewed and not reviewed on their own: they hold what the reviewed
  IRs hold. Step 6 names the file and says in one line what it is for; do not print its
  content in the report.

## Agents that may not be there

The texts of the four skills name three agents: `source-scout` (reads the code for a scout
run or a sync), `diagram-brainstorm` (proposes diagrams for a raw idea) and
`diagram-reviewer` (the review gate of step 4). They are accelerators that read the same
protocol files and hold no rule of their own. They exist only where the plugin is installed
in Claude Code; a copied install (`install.sh`, also into a Claude Code project) holds the
skills alone, and other runtimes have no such agents.

One rule covers every place that names one: use the agent when the runtime lists it, and
when it does not, do the same protocol inline in the main session. Never stop, ask the user
to install something, or skip the step because the agent is missing. Done inline, the scout
and brainstorm protocols are simply followed by the main session; the review is a separate,
explicit step after the emit, in which you read `review-checklist.md` and judge the
diagrams as a reviewer and not as their author, ending with the verdict in the format of
that file. The report does not have to say which of the two ran.

## The drafts folder

`drafts/` in a run folder holds two different things, and every skill tells them apart the
same way:

- **The drafts of a consult** (revise, and the one draft of a sync): `drafts/consult.json`
  with the draft folders it names, `drafts/a/`, `drafts/b/`, `drafts/c/`. Only a `drafts/`
  folder that holds `consult.json` is an open consult. Revise offers to resume or drop it;
  sync offers to drop it or to stop.
- **The pictures of applied changes**: `drafts/changes-<rNNN>.diff.drawio`, written by
  `diff --drawio` after a change was applied (a direct change, a confirmed draft, a new
  diagram, an applied sync), where `rNNN` is the revision that holds the state before that
  change. They are review aids, never delivered, and they are kept until the user deletes
  them. A `drafts/` folder that holds only such pictures is no open consult: nothing is
  asked about it and nothing in it is deleted.

What follows from that:

- Confirming or dropping a consult deletes `drafts/consult.json` and the draft folders it
  names, and nothing else. Never delete `drafts/` as a whole.
- A sync writes the picture of its change exactly as revise does, after the snapshot and
  the copy: `diff <run>/history/<rNNN>/source <run>/source --drawio
  <run>/drafts/changes-<rNNN>.diff.drawio`.
- An undo makes a picture stale: after `restore <run> undo` or `restore <run> <rNNN>`, the
  picture `changes-<rNNN>.diff.drawio` of the revision that was restored, and of every
  later revision, shows a change the run no longer has. Delete those files and say in the
  report that they were removed because their change was undone. An undo writes no picture
  of its own. After a redo, write the picture of the change that came back with the same
  `diff --drawio` call, against the revision `restore` printed as `snapshot`.
- A Mermaid run has no such pictures; its `drafts/` folder exists only during a consult.

## When revise calls this contract

The revise skill runs this contract after it changed the IRs of a delivered run. It reuses
the run folder and its run slug, never a new folder, and changes these steps:

- Step 3 rebuilds every target the run folder holds, not only the one the request was read
  from, because a file that still shows the diagram as it was is wrong and the next
  hand-edit check would take it for an edit of the user. The folders tell which targets
  the run has: `drawio/` with `<run-slug>.drawio` is draw.io; `mermaid/` with
  `<run-slug>.md` is Mermaid; `figjam/` is FigJam, where each file that is there is
  written again by the call that made it (`<slug>.mmd` by `emit --to figjam --out`, with
  `--overlay` when `<slug>.overlay.js` is there, `<slug>.native.js` by `emit --to figjam
  --native`), and the files of a diagram the change removed are deleted. A board that was
  already drawn in FigJam is not changed by this: say in the report that it still shows
  the run before the change, and offer to draw it again. `svg/` and the description tables
  are covered below.
- The combined file is rebuilt with the `bundle` options that `drift` recovered or the
  revision recorded. For a draw.io file without a canvas page the object is empty: such a
  file has no place for a title, so pass the run's feature name as `--title` (it names the
  canvas page once the run has more than one diagram). For a Mermaid run the object holds the `title` (`--title`) and, when
  the file was written with it, `mermaidStable: true` (`--mermaid-stable`). `canvas: "all"`
  becomes `--canvas all`. A canvas list is first brought up
  to date: drop the ids the run no longer has, append the diagrams the change added (in file
  order), then pass it as `--canvas a,b,c`; `--title` and `--gap` are passed as recorded.
  Without recorded options, use the run's feature name as the title and, for more than one
  diagram, `--canvas all`. Delete `drawio/<slug>.drawio` or `mermaid/<slug>.mmd` of a
  diagram the change removed.
- Step 3 also writes the description tables again when the run has them: every
  `<run-slug>.doc.md` and `<run-slug>.doc.<lang>.md` in the run folder, each with the
  `--lang` its first line records (`<!-- zukai doc, lang=ja: ...`) and the title of its
  first heading as `--title`. A run without them gets none, unless the request or `--doc`
  asks for them.
- Files that revise relabelled in place to keep hand edits are never emitted or bundled
  again, in step 3 or in the review loop. Review findings on them that are label wording are
  applied with `relabel` (the IR gets the same wording); any other finding is listed in the
  report and applied only if the user agrees to redraw that file, after a `snapshot` with
  the file as `--extra`.
- Step 4 also renders the picture of the change, when one was written. The picture has one
  page per diagram that changed, and `preview` shows one page per call: the first page
  without an option, any other with `--page <diagram id>`. Take the pages from
  `drawio.pages` in the output of `diff --drawio` and render each
  (`preview <run>/drafts/changes-<rNNN>.diff.drawio --page <page> --max-px 1600`), so a
  change on the page of a part or of a business view is looked at too. The reviewer gets
  every one of those PNGs with the request in the user's words: it is where the reviewer sees whether what is coloured is what was
  asked (`review-checklist.md`, Revision). Without a renderer, or for a Mermaid run, the
  review reads the change list instead and says so. The picture is rebuilt with the same
  `diff --drawio` call after every review round that edits an IR.
- Step 5 runs again whenever the run folder has an `svg/` folder, asked for or not: a
  picture that shows the diagram as it was before the change is wrong. `export` writes
  every picture again over the earlier one; delete `svg/<slug>.drawio.svg` of a diagram the
  change removed. Without a renderer, say that the pictures in `svg/` still show the run
  before this change and name them. A run without `svg/` gets pictures only when asked,
  as in every run.
- Step 6 adds the route taken (direct, consult, new diagram or undo), the revision written
  (`history/rNNN`), the change list from `diff` in plain words, the path of the picture of
  the change as a review aid beside the delivered files, and the outcome of the drift
  check.
- Step 7 is skipped unless the user asks for another target, for the description tables or
  for the pictures.
- A revision made by the revise skill does not compare the run with the code, so it does
  not record the sources of the run again: the record keeps saying which state of the code
  the run was last compared with. Two cases record one diagram alone, with
  `sources <run-folder> --only <diagram-id>`, which leaves every other entry as it was: a
  new diagram that was scouted (the new diagram route in `scout` mode), and a diagram that
  a revision changed by reading a file of the project (the revise skill, direct route,
  says when: the file joins `meta.sources` of that diagram first). Without that call
  `stale` would report the diagram as `unrecorded` right after the delivery. An
  undo needs nothing: `restore` puts back the record of the revision it restores, or
  removes the record when that revision had none, and says so as `sourcesRecord`.
