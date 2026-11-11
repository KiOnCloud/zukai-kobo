# Zukai end-to-end test B: scout + revise (consult, direct, new diagram, error paths)

Date 2026-11-11 (UTC), Node v22.23.4, CLI `/home/user/zukai-kobo/skills/draw/scripts/bin/cli.mjs`.
Nothing under `/home/user/zukai-kobo` was modified (`git status --short` empty at the end).

Abbreviations used below:

- `S` = `/tmp/claude-0/-home-user-zukai-kobo/d341e1af-4dbd-40ea-aeb1-5a8be443704e/scratchpad`
- `P` = `S/proj-scout` (the "user's project")
- `T` = `S/tmp-b` (repro inputs, copies of intermediate states)
- `PNG` = `S/reports/b-png`
- `RUN1` = `P/diagrams/20261111_cli-emit-drawio` (mermaid run, steps 1, 3, 4, 5, 6)
- `RUN2` = `P/diagrams/20261111_ir-data-model` (drawio run, step 2)
- `draw/` = `/home/user/zukai-kobo/skills/draw`, `revise/` = `/home/user/zukai-kobo/skills/revise`

Conditions of the test: no `AskUserQuestion`, no subagents (scout and review done in-session by
the "other runtimes" path), `preview` worked (renderer `mermaid-web` / `drawio-web`, it reached
the network by itself through Playwright). Every PNG listed in section 4 was opened and looked at.

---

## 1. Per step

### Step 1: `/zukai:draw scout --to mermaid --kind sequence --scope overview --audience technical ...` : PASS (with findings)

Expected: no opening question (all flags given), scout protocol, IR in `source/`, validate,
emit `.mmd`, bundle `<run-slug>.md`, preview, review, report.

Happened:

- No question asked (kind, scope, audience by flag; entry point named in the request).
- IR written to `RUN1/source/cli-emit-drawio.ir.json`; `validate` exit 0; `emit --to mermaid`
  exit 0, 0 warnings; `bundle --to mermaid` exit 0; `preview` exit 0.
- Bundle shape matches `target-mermaid.md` 77-79: `# <title>`, `## <diagram title>`,
  ``Source: `source/<id>.ir.json` ``, one fenced `mermaid` block, then
  `Not shown on purpose:` with the `meta.omitted` entries.
- Mermaid renders (PNG `s1-r1-...`, `s1-r2-...`). At the prescribed `--max-px 1600` the scale
  was 0.62 and the labels were too small; rerun at 2400 as the contract says.
- Review round 1: FAIL (my own IR: `checkFeatureMatrix` drawn as unconditional although
  `pipeline.mjs:21` returns before it). Round 2 (nested `alt`): PASS, polish/emitter findings only
  (F6).

Faithfulness to code, as delivered in round 2 (state kept in `RUN1/history/r001/source/`):

| Message | Evidence |
|---|---|
| `emit --to drawio <ir.json> --out <file>` | `src/cli.mjs:121-122` |
| `readIr: read and parse the IR file` | `src/cli.mjs:123`, `69-81` |
| `emit(ir, target, options)` | `src/cli.mjs:126` |
| `validateIr(ir)` | `src/pipeline.mjs:20`, `src/validate-ir.mjs:90` |
| `{ ok: false, errors }` (schema or reference errors) | `src/pipeline.mjs:21` |
| `checkFeatureMatrix(ir, target)` | `src/pipeline.mjs:23`, `src/check-feature-matrix.mjs:125` |
| `{ ok: false, errors, warnings }` (unsupported) | `src/pipeline.mjs:25` |
| `scanSecrets(ir)` | `src/pipeline.mjs:29`, `src/scan-secrets.mjs:74` |
| `emitDrawio(ir, { diagramId, refs })` | `src/pipeline.mjs:46`, `src/emit-drawio.mjs:19` |
| `{ output, warnings }` | `src/emit-drawio.mjs:21` |
| `{ ok: true, output, warnings }` | `src/pipeline.mjs:60` |
| `writeFileSync(outPath, output)` | `src/cli.mjs:133` |
| `exit 0: { ok, out, warnings } on stdout` | `src/cli.mjs:137-138` |
| `exit 2: errors as JSON on stderr` | `src/cli.mjs:127` |
| note "Warnings of every stage accumulate" | `src/pipeline.mjs:24,27,30,59`, `src/cli.mjs:128` |

Collapsed and recorded in `meta.notes` / `meta.omitted`: `checkDetail` (`pipeline.mjs:27`),
the inside of `emitDrawio`, the exit 1 paths.

### Step 2: `/zukai:draw scout the data model of an IR` (no flags) : PASS (with findings)

Expected: one opening call with kind + scope + view (mode given), then class / detailed /
technical / drawio; main diagram plus parts linked with `ref`; `bundle --canvas all`.

Happened:

- Opening question logged (section 3, Q2.1). Answers: class, detailed, technical.
- Entry point: one plausible candidate (`src/schema/ir-v1.schema.json`), picked and stated.
- Three IRs in `RUN2/source/`: `ir-data-model` (main, 9 classes), `ir-data-model-01-sequence`,
  `ir-data-model-02-architecture`; `ref` on `SequenceIr` and `ArchitectureIr`.
- All `validate` / `emit --to drawio` exit 0 with 0 warnings.
- The contract's literal bundle command put the parts before the main diagram (F1):

  ```text
  $ node cli.mjs bundle --to drawio --out RUN2/ir-data-model.drawio --title "IR data model" --canvas all RUN2/source/*.ir.json
  {"ok":true,...,"diagrams":3,"warnings":0,"canvas":["ir-data-model-01-sequence","ir-data-model-02-architecture","ir-data-model"]}
  exit 0
  ```

  Rebuilt with the files listed by hand, main first.
- Review round 1: FAIL. Two were my own typos (`Entitie[]`, `Classe[]`, `Boundarie[]`); one is
  an emitter defect (F4: self-relation label printed over the neighbouring class, no `layout:`
  warning). Round 2: PASS with the emitter finding left open. Also changed `direction` to `BT`
  so the base class sits above its subclasses (F16).
- `drift RUN2/ir-data-model.drawio RUN2` on the fresh run: `drifted:false`, bundle options
  recovered (`title`, `canvas`, `gap:120`).

### Step 3: `/zukai:revise what if validation ran after the feature-matrix check instead of before?` : PASS (with findings)

Expected: find the run, consult route, 2-3 drafts under `drafts/`, pick, adjust, confirm;
nothing outside `drafts/` changes before the confirmation; `drafts/` deleted afterwards.

Happened:

- Find the run: rule 2 (`revise/SKILL.md:60-61`) is ambiguous with two runs made in the
  conversation, and rule 3 matches neither slug nor title, so the question Q3.1 was needed (F7).
- Mermaid run, so step 3 (drift) skipped as written. Probe:

  ```text
  $ node cli.mjs drift RUN1/cli-emit-drawio.md RUN1
  {"ok":false,"errors":[{"path":"...cli-emit-drawio.md","message":"not a .drawio file (no <mxfile> root)","hint":"Mermaid output has no layout to keep; compare the IR with diff instead"}]}
  exit 1
  ```

  Consequence: a Mermaid run has no recorded `bundle` options, yet the consult protocol and
  the direct route both ask for `--bundle @<file>` (F8). I wrote `{"title":"CLI emit to draw.io"}`
  by hand to `T/s3-bundle.json`.
- Route: consult ("what if"). Two drafts built: a (nested checks swapped), b (both checks back
  to back, one error branch). All validate/emit/bundle exit 0, 0 warnings.
- `diff` on draft a does not mention that `m-matrix` now comes before `m-validate`; it lists
  only block membership and the note anchor (F2). The change list had to be written from
  the IR, not from `diff`.
- Picked b, adjustment applied in `drafts/b/source/` (participant label `IR validator`),
  step 3 of the protocol rerun, `diff` shows `participants validator [label]`.
- Checksums of everything in `RUN1` outside `drafts/` before the first draft and right before
  the confirmation: identical (`T/s3-before.sha`; output `UNCHANGED`).
- Confirm: `snapshot` wrote `r001`, draft copied over `source/`, `drafts/` deleted, closing
  contract run. After it `RUN1` held only `cli-emit-drawio.md`, `history/r001/`, `mermaid/`,
  `source/`: cleanup as documented. A copy of the drafts is in `T/s3-drafts-copy/`.
- Review: PASS, polish only.

### Step 4: abandoned consult, then a new session : PASS (with findings)

Expected: `--preview` forces consult; after the "session end" the leftover `drafts/` is
reported first with resume/drop; on drop the folder is deleted and the request proceeds
(direct route).

Happened:

- `--preview remove the secret scan step`: one viable reading only, so one draft (`drafts/a`)
  with the one-sentence reason, as the protocol allows. Checksums outside `drafts/`:
  `UNCHANGED`. Stopped there.
- New session, `add a note that preview is optional`: run question Q4.1 (two runs, no match),
  then leftover `drafts/` reported, Q4.2, answer "drop", `drafts/` deleted (copy in
  `T/s4-leftover-drafts-copy/`).
- `snapshot` ignores `drafts/` (probe: revision holds `revision.json` and `source/` only).
- Direct route. Clarify gate: the anchor is missing, and the diagram has no preview step at
  all, so Q4.3 was asked; no answer on the sheet and the skill marks no default, so I took the
  first option. `snapshot` -> `r002`, note added, `diff` shows one added note, no hints.
- Review round 1: FAIL. A note with `after` = the last message of the last branch of an `alt`
  is drawn inside the "errors" branch (PNG `s4-note-...`), so it reads as part of that branch
  (F5). Round 2: `after` removed, the note is drawn first; PASS.

### Step 5: `/zukai:revise add an architecture diagram of the modules behind this flow` : PASS for the route, FAIL for the result (findings F3, F12)

Expected: new-diagram route, draw skill's opening call (kind named in the request, so mode,
scope, view asked), placement "a diagram of its own", target mermaid, `architecture-beta`.

Happened:

- Questions Q5.1, placement stated in one line, `snapshot` -> `r003`.
- The request ("the modules") collides with the level-of-detail rule: the modules are built
  into one file, so by `ir-reference.md` 289-295 and checklist item 11 they are one component.
  Following the text literally gives three boxes (agent, CLI, run folder) that do not answer
  what was asked (F12).
- `diff` hint, as documented:
  `new diagram cli-emit-architecture is not the ref of any element: link it from the element it details, or say in the report that it stands on its own`.
- Warnings on emit (verbatim):
  - `"c-run" uses "connection.label", degraded on target "mermaid": architecture-beta edges have no labels; the label is dropped`
  - `"c-files" uses "connection.label", degraded on target "mermaid": architecture-beta edges have no labels; the label is dropped`
- `architecture-beta` parses and renders, but with the first labels
  (`Zukai CLI (Node 22.13+, one bundled file)`, `Run folder (IR and emitted files)`) the group
  frames are wrong: the "Skill directory" frame cuts through the "Agent runtime" icon, which
  is not its member, and a frame edge runs through the database icon (PNG
  `s5-cli-emit-architecture.png`). No warning from the CLI. Shortening the two labels fixed
  it (PNG `s5-r2-...`) (F3).
- Literal `source/*.ir.json` bundle puts the new diagram before the run's first one (F1,
  `T/s5-glob-order.md`).
- Side experiment, kept out of the run (`T/s5-modules-experiment.ir.json`): ten modules as
  components. Emit exit 0 with one warning and a flowchart fallback that renders cleanly
  (PNG `s5-modules-experiment.png`):
  `layout: architecture-beta cannot place this diagram without overlaps ("pipeline" and "secrets" would need a diagonal connection); emitted as a flowchart with boundaries as subgraphs, or use --to drawio`.
  No `detail:` warning for ten parts of one deployed file.

### Step 6: `/zukai:revise a detailed version of the architecture diagram` : PASS for the route, FAIL for the picture (F3, F13, F14)

Expected: new-diagram route; a second fuller architecture diagram is never written; ask once
(parts with `ref` first, or change the delivered diagram).

Happened:

- Q6.1 (opening call) and Q6.2 (the prescribed question) logged; answer: parts. One part,
  kind `er`: `cli-emit-architecture-01-run-folder`, `ref` set on component `run-folder`.
  (A `sequence` part of the CLI component would have repeated the run's existing sequence
  diagram, which checklist item 8 forbids; the skill has no rule for that case, F13.)
- `snapshot` -> `r004`; `diff`: `diagramsAdded` the part, `components run-folder [ref]`, no hints.
- ER part renders well (PNG `s6-cli-emit-architecture-01-run-folder.png`).
- The architecture diagram is now broken in both forms, because `ref` appends text to the
  label on the same line (`target-mermaid.md` 81-84) and long labels break the frames (F3):
  - single emit: label `Run folder ↳ cli-emit-architecture-01-run-folder`, wrapped mid-word as
    `cli-emit-architect / ure-01-run-folde / r`; the two group frames overlap, their titles
    print over each other ("Skill dire" under "User's project"), a frame edge runs through
    the CLI icon and through "Zukai CLI" (PNG `s6-cli-emit-architecture.png`);
  - block from the bundle: `Run folder ↳ Run folder: what a run stores`, same overlap
    (PNG `s6-bundle-arch-block.png`).
- The review gate cannot see the bundle form: `preview` refuses the `.md` (F14):

  ```text
  $ node cli.mjs preview RUN1/cli-emit-drawio.md
  {"ok":false,"errors":[{"path":"diagrams/20261111_cli-emit-drawio/cli-emit-drawio.md","message":"preview takes a .drawio or .mmd file"}]}
  exit 1
  ```

- Review: FAIL on layout with no IR fix that keeps the `ref`; delivered with the `emitter:`
  finding listed, as the checklist allows.

### Step 7: no `diagrams/` folder, nonexistent path : PASS for the documented case, gaps for the path case

Working directory `T/empty-proj` (no `diagrams/` at its top level).

- Skill text, no argument: rule 4 of "Find the run" applies: stop, say nothing was delivered,
  point to `/zukai:draw`. Clear.
- Skill text, path argument that does not exist: "A path argument wins" and nothing more.
  No instruction for a path that is missing or is not a run (F15).
- CLI:

  ```text
  $ node cli.mjs revisions .                         -> exit 1
  {"ok":false,"errors":[{"path":"/","message":"no source/ folder in .../empty-proj","hint":"pass the run folder, diagrams/<yyyymmdd>_<run-slug>"}]}
  $ node cli.mjs revisions diagrams/20261111_nope    -> exit 1, same message (folder does not exist at all)
  $ node cli.mjs snapshot diagrams/20261111_nope --request x   -> exit 1, same message
  $ node cli.mjs restore diagrams/20261111_nope r001 -> exit 1, same message
  $ node cli.mjs drift diagrams/20261111_nope/nope.drawio diagrams/20261111_nope -> exit 1
  {"ok":false,"errors":[{"path":"diagrams/20261111_nope/nope.drawio","message":"cannot read file: ENOENT: no such file or directory, open '...'"}]}
  $ node cli.mjs diff diagrams/a diagrams/b          -> exit 1 "cannot read: ENOENT ... stat '...'"
  ```

  Nothing was created by the failing calls. "no source/ folder" is also the answer for a
  folder that does not exist.
- Run folder with an empty `source/` (`T/empty-proj/hollow`):

  ```text
  $ node cli.mjs revisions hollow   -> {"ok":true,"revisions":[]}  exit 0
  $ node cli.mjs snapshot hollow --request empty  -> {"ok":true,"rev":"r001",...,"files":[],...} exit 0
  $ node cli.mjs snapshot hollow --request empty2 -> {"ok":true,"rev":"r002",...,"files":[],...} exit 0
  $ node cli.mjs restore hollow r001 -> exit 1 "revision r001 holds no IR files; refusing to empty source/"
  $ node cli.mjs diff hollow hollow  -> {"ok":true,"differs":false,...} exit 0
  ```

  `snapshot` writes empty revisions that `restore` then refuses (F15).

---

## 2. Findings

Severity is one of: bug / doc-contradiction / ambiguity / UX-unreasonable / visual-defect.

**F1 (bug + doc-contradiction). The prescribed bundle glob puts parts before the main diagram.**
`draw/references/closing-contract.md:25-26` gives `bundle ... source/*.ir.json` and says
"(main diagram first)"; `target-mermaid.md:74-78` the same. Shell order is
`<slug>-01-x.ir.json` before `<slug>.ir.json` (`-` sorts before `.`), and a diagram added later
with an earlier name (`cli-emit-architecture`) goes before the run's first one. With
`--canvas all` the canvas and the page order follow.
Repro: `cd P && node cli.mjs bundle --to drawio --out /tmp/x.drawio --title t --canvas all diagrams/20261111_ir-data-model/source/*.ir.json`
-> `"canvas":["ir-data-model-01-sequence","ir-data-model-02-architecture","ir-data-model"]`.
Kept: `T/s2-bundle-glob-order.drawio`, `T/s5-glob-order.md`. The same `.sort()` is in
`src/cli.mjs:93` and `src/revisions.mjs:25` (effect on `diff`/`drift` order unverified).

**F2 (bug). `diff` does not see a change of order.**
`src/ir-diff.mjs:60-70` compares elements by id only. Reordered messages and participants
change the emitted diagram but give `differs:false`.
Repro: `node cli.mjs diff T/reorder-old.ir.json T/reorder-new.ir.json` ->
`{"ok":true,"differs":false,"replaced":false,"fields":[],"added":[],"removed":[],"changed":[]}`, exit 0,
while `emit --to mermaid` of the two files differs in message and participant order.
In step 3 the request was exactly a reorder, and the consult protocol (step 3.3, step 4) and
the report (`revise/SKILL.md:208-210`) take their change list from `diff`.

**F3 (visual-defect, no warning; hits the path the skill prescribes). Long component labels break `architecture-beta` group frames, and `ref` makes labels long.**
Frames enclose non-members, overlap each other, and titles print over each other. Triggered
by a plain long label (step 5) and by every `ref` on a component (step 6), since
`target-mermaid.md:81-84` appends `↳ <title>` (bundle) or `↳ <slug>` (single emit, broken
mid-word) on the same line. `revise/SKILL.md:183-186` and `draw/SKILL.md:167-171` make "parts
linked with `ref`" the only allowed answer to a detailed architecture request, so on the
Mermaid target that answer always carries this risk.
Repro: `node cli.mjs emit --to mermaid T/s5-arch-frames-broken.ir.json --out /tmp/a.mmd && node cli.mjs preview /tmp/a.mmd`;
also `RUN1/mermaid/cli-emit-architecture.mmd` and `T/s6-bundle-arch-block.mmd`.
PNGs: `s5-cli-emit-architecture.png`, `s6-cli-emit-architecture.png`, `s6-bundle-arch-block.png`;
good case `s5-r2-cli-emit-architecture.png`. Whether the fault is Mermaid 12.3 itself or the
preview page is unverified; a user's own renderer was not tried.

**F4 (visual-defect, no `layout:` warning). draw.io class diagram: the label of a self-relation is printed over the neighbouring class.**
`Boundary -> Boundary` aggregation labelled "children" lands on the `+from: id` / `+to: id`
rows of `Connection`. `closing-contract.md:85-87` says the CLI reports label overlaps; it
reported 0 warnings.
Repro: `node cli.mjs emit --to drawio T/s2-selfloop-label-overlap.ir.json --out /tmp/c.drawio && node cli.mjs preview /tmp/c.drawio`.
PNG: `s2-r1-ir-data-model-02-architecture.png`. Still present in `RUN2`.

**F5 (visual-defect / IR gap). A sequence note cannot be placed after a block.**
`ir-reference.md:109`: `after` is a message id. After the last message of a block's last
section the Mermaid emitter writes the note before `end`, so it sits inside the `else` branch.
Repro: `node cli.mjs emit --to mermaid T/s4-note-after-last-message.ir.json` (tail shows
`Note over n1,n2: ...` before `end`). PNG `s4-note-cli-emit-drawio.png`.

**F6 (visual-defect, polish). Mermaid sequence previews.**
Message labels are struck through by the lifelines they cross (`emit(ir, target, options)`
by "File system", `{ ok: true, output, warnings }`, `emitDrawio(...)`, branch labels such as
`[unsupported kind or feature]`); the `checkFeatureMatrix` participant text touches its box
edges; the title is far smaller than every label; a wide note beside a participant pushes
its neighbour far away (round 1). At `--max-px 1600` an 8-participant diagram comes out at
scale 0.62, too small to read, so the default of the review gate always needs a second run
here. PNGs `s1-r1-...`, `s1-r2-...`, `s3-confirmed-...`.

**F7 (ambiguity). Finding the run when the conversation made two.**
`revise/SKILL.md:60-61` (rule 2) says "a run made or revised earlier in this conversation";
with two it does not say which (most recent would have been the wrong one in step 3).
Rule 3 (`:62-65`) matches "slug or diagram titles" only: a request that names messages of one
run ("validation", "feature-matrix check") matches nothing, so the user is asked although the
IRs make the answer obvious.

**F8 (doc-contradiction). Mermaid runs have no recorded bundle options, but the texts require them.**
`revise/SKILL.md:102` skips drift for Mermaid runs and `drift` refuses a `.md` (exit 1). Yet
`revise/SKILL.md:125`, `:196-197`, `consult-protocol.md:39-41` and `:68` say
`--bundle @<file>` / "the run's `bundle` options" without a Mermaid case, and
`closing-contract.md:100` falls back to "the run's feature name", which exists only as the H1
of `<run-slug>.md`. The agent has to invent the object.

**F9 (ambiguity). The revision number is needed before it exists.**
`revise/SKILL.md:130-132` wants a `meta.notes` entry "saying from which revision on" the
diagram no longer reflects the code. In the consult route the edit is made in a draft
(`consult-protocol.md:27-29`) before the snapshot of step 6.1 prints the number; in the direct
route the snapshot comes first, so only consult has the problem. I guessed `r001`/`r002`.

**F10 (ambiguity). `consult-protocol.md:63-64`: "shows it again with the other drafts gone".**
Not said whether the other draft folders are deleted or only left out of the presentation.
I left them on disk until confirm.

**F11 (UX-unreasonable). A leftover `drafts/` folder carries no record of its consult.**
`revise/SKILL.md:69-70` offers "resume (consult protocol, step 4)", but `drafts/` holds only
IRs and outputs: not the request, the draft names or the axis of choice, so a new session
must rebuild the presentation from `diff`. The text also does not say what happens to the new
request on "resume", nor that it continues after "drop" (assumed), and the sentence sits
after rule 4 although it can only apply once a run is found.

**F12 (doc-contradiction / UX-unreasonable). "Architecture of the modules" has no good answer.**
`scout-protocol.md:88-99`, `ir-reference.md:284-306` and checklist item 11 define
architecture as deployed resources; a CLI's modules are parts of one resource. The only
guidance is "say so in one line and keep the one chosen" (`scout-protocol.md:13-15`), which
yields a three-box diagram for a request about modules. No question is prescribed
("class/flowchart of the modules instead?"). The CLI does not back the rule either: ten
module components give no `detail:` warning (`T/s5-modules-experiment.ir.json`), since
`check-detail.mjs` only looks at stores, boundaries and labels.

**F13 (UX-unreasonable + ambiguity). New-diagram route for "a detailed version".**
`revise/SKILL.md:173-179` runs the full opening call (mode, scope, view) before step 2
(`:192-195`) tells the user the diagram will not be written as asked: two rounds of questions,
and "scope" is asked although the request says "detailed". Also not covered: the detail
already exists in the run as a diagram of its own (the sequence), where a new `sequence` part
would break checklist item 8 and the existing one cannot become a part (slug rule
`<main-slug>-NN-<part>`, `:182`); and which diagram is "main" once a run holds two diagrams
of their own (the run slug equals the first one's).

**F14 (bug / doc gap). The review gate never sees the combined Mermaid file.**
`closing-contract.md:29-30` previews "each individual output file" and `preview` rejects
`.md`. In the bundle a `ref` label differs from the single emit (title instead of slug), so
the delivered `<run-slug>.md` contains text no reviewer has seen rendered (F3 is such a case).

**F15 (bug, minor + ambiguity). Missing and empty run folders.**
`snapshot` on a run whose `source/` is empty succeeds and writes empty revisions
(`src/revisions.mjs:75-77`), which count toward the five kept and which `restore` refuses.
`revisions`/`snapshot`/`restore` answer "no source/ folder in <path>" for a path that does
not exist at all. `revise/SKILL.md:59` has no rule for a path argument that is not a run, and
`:47-50` does not say how to tell a leading path from the first word of the request.
Repro: commands in step 7; folder `T/empty-proj/hollow`.

**F16 (visual-defect, polish). draw.io class diagram puts the base class below its subclasses.**
With `direction: TB` and `inheritance` from subclass to base (`ir-reference.md:216-218`) the
seven subclasses are on top and `Envelope` below (PNG `s2-r1-ir-data-model.png`). `BT` fixes
that but then puts the composed `Meta` above its owner (PNG `s2-r2-ir-data-model.png`).

**F17 (doc-contradiction). "never touches the network".**
`draw/SKILL.md:26` says the CLI "never touches the network"; `preview` loads Mermaid from
`cdn.jsdelivr.net` and the draw.io viewer from `viewer.diagrams.net`
(`src/preview.mjs:20,24`; `target-mermaid.md:105-106` admits the first).

**F18 (doc gap). Warning stages.**
`target-mermaid.md:25` lists stages `feature-matrix`, `secret-scan`, `emit`;
`src/pipeline.mjs:27` also emits stage `detail`. `draw/SKILL.md:9-11` describes the pipeline
without the detail check.

**F19 (doc-contradiction, agents vs skill).** `agents/source-scout.md`: "Keep the diagram
readable (about 15 elements)" and "The complete IR in one fenced `json` block". For scope
`detailed` the skill wants 15 to 20 elements plus one IR per part (`draw/SKILL.md:83-91`,
`scout-protocol.md:28-35`); the agent's reply format has room for one IR only.
`agents/diagram-reviewer.md` agrees with `review-checklist.md` (verdict format, `Images:`
line, severities). Not executed: the agents were not available here.

**F20 (ambiguity). "about 15 elements" for a sequence diagram.**
`draw/SKILL.md:79` does not say whether participants, messages, blocks and notes all count.
An honest overview of the emit path needed 8 participants and 14 messages.

**F21 (ambiguity). A wording the user asked for against checklist item 14.**
The user renamed the participant to "IR validator"; item 14 (`review-checklist.md:89-90`)
says technical names "match the code or the specification exactly". Only `meta.omitted`
protects a user choice from the review; a requested label has no such record.

**F22 (UX-unreasonable, minor).** `diff` prints the whole old and new `meta.notes` arrays for
one appended entry (several kB per draft), which buries the element changes.

**F23 (ambiguity, minor).** Opening call: the kind question must offer three kinds
(`draw/SKILL.md:114-117`); for "data model" only `class` and `er` fit, the third is filler.

---

## 3. Questions "asked", verbatim, with the answer used

**Step 1:** none (all flags given, entry point named).

**Q2.1 (step 2, opening call, one call, three questions)**

1. "Which kind of diagram? Other kinds: sequence, activity, state, architecture (pick Other and type one of them)."
   - "Class (class) – suggested": types, interfaces, their members and inheritance or composition
   - "Entity-relationship (er)": data entities, their key attributes and one-to-many relations
   - "Flowchart (flowchart)": steps and decisions of one process from start to end
   - Other
2. "How much detail?"
   - "Overview (overview) – suggested": one main diagram, about 15 elements, each sub-flow collapsed into one step
   - "Detailed (detailed)": the main diagram plus one sub-diagram per part worth its own picture, linked from the element it details
3. "Which view?"
   - "Technical (technical) – suggested": for developers and reviewers; keeps component, endpoint and data names
   - "Business (business)": for a PM, a client or operations; only the flow and the business rules, no technical names
   - "Both (both)": one technical and one business diagram per subject in the same run folder

Answer (sheet): class; detailed; technical. Target default drawio.

**Q3.1 (step 3, find the run)** "Which run should I change?"
- "2026-11-11 · ir-data-model": IR data model (schema version 1); SequenceIr: participants, messages, blocks and notes; ArchitectureIr: components, boundaries and connections
- "2026-11-11 · cli-emit-drawio": CLI emit: from an IR file to a draw.io file

Answer (sheet): cli-emit-drawio. (Both runs have the same date; "newest first" was decided by creation order.)

**Q3.2 (step 3, pick a draft)** "Which draft do you want?"
- "A: feature matrix first, validation only when it passes": the two nested checks swap; no element added or removed
- "B: both checks back to back, one error branch": removes the separate 'unsupported kind or feature' reply and its block; one reply carries the errors of either check
- "Drop all drafts"

Answer (sheet): B, then the adjustment "rename the validation participant to 'IR validator'", then (after B was shown again alone) "confirm".

**Q4.1 (step 4, new session, find the run)**: same question and options as Q3.1. Answer (sheet): cli-emit-drawio.

**Q4.2 (step 4, leftover drafts)** "This run still has a `drafts/` folder from an earlier consult (one draft, a: the secret scan call and the scanSecrets participant removed). What should happen to it?"
- "Resume that consult": show the draft again and pick, adjust or confirm
- "Drop it": delete `drafts/`; the run stays as it is

Answer (sheet): drop.

**Q4.3 (step 4, clarify gate, anchor)** "The diagram has no preview step. Where should the note go?"
- "After the last reply, over 'Agent or user' and 'cli.mjs main'"
- "At the top, before the first message"

Answer: not on the sheet and the skill marks no default; first option taken. Moved to the top in review round 2 (F5).

**Q5.1 (step 5, opening call; kind named in the request)**

1. "Which input do you have: requirements to clarify, code to scout, or a raw idea to brainstorm?" options "Clarify requirements (clarify)", "Read the code (scout)", "Raw idea (brainstorm)", each with the mode table's description
2. "How much detail?" as in Q2.1, with the added sentence the skill requires for architecture: "Detailed gives the architecture diagram at resource level plus parts of other kinds, never a second, fuller architecture diagram."
3. "Which view?" as in Q2.1

Answer (sheet): scout; overview; technical. Placement stated: a diagram of its own, nothing links to it.

**Q6.1 (step 6, opening call)**: mode, scope, view as in Q5.1. Not on the sheet: mode taken as scout (no default exists; assumed from step 5), scope `detailed` from the request, view `technical` (the suggested default).

**Q6.2 (step 6, the prescribed question)** "A second, fuller architecture diagram is not drawn: an architecture diagram shows each resource once. Which do you want?"
- "The detail as parts linked with ref": the order of calls as a sequence or activity diagram, the stored data as an er diagram, each linked from the component it details
- "Change the delivered architecture diagram itself": goes through drafts you compare first

Answer (sheet): parts; one part, kind er, for the run folder component.

**Step 7:** none.

---

## 4. Run folders and reviewed PNGs

Run folders (kept):

- `P/diagrams/20261111_cli-emit-drawio/` (mermaid): `cli-emit-drawio.md`,
  `mermaid/{cli-emit-drawio,cli-emit-architecture,cli-emit-architecture-01-run-folder}.mmd`,
  `source/` (three IRs), `history/r001..r004`
- `P/diagrams/20261111_ir-data-model/` (drawio): `ir-data-model.drawio`,
  `drawio/{ir-data-model,ir-data-model-01-sequence,ir-data-model-02-architecture}.drawio`, `source/` (three IRs)

Repro inputs and intermediate copies (kept) in `T/`:
`s1-round1.ir.json`, `s2-bundle-glob-order.drawio`, `s2-selfloop-label-overlap.ir.json`,
`reorder-old.ir.json`, `reorder-new.ir.json`, `s3-before.sha`, `s3-bundle.json`,
`s3-drafts-copy/`, `s4-before.sha`, `s4-leftover-drafts-copy/`,
`s4-note-after-last-message.ir.json`, `s5-arch-frames-broken.ir.json`, `s5-glob-order.md`,
`s5-modules-experiment.ir.json`, `s5-modules-experiment.mmd`, `s6-bundle-arch-block.mmd`,
`empty-proj/`.

PNGs in `PNG/`, all opened:

| File | What | Judgement |
|---|---|---|
| `s1-r1-cli-emit-drawio.png` | step 1 round 1, 1600 px | renders; too small; wide note pushes columns apart |
| `s1-r2-cli-emit-drawio.png` | step 1 round 2, 2400 px | readable; labels crossed by lifelines (F6) |
| `s2-r1-ir-data-model.png` | step 2 main, TB | clean lines; base class at the bottom (F16); my typos |
| `s2-r2-ir-data-model.png` | step 2 main, BT, delivered | clean |
| `s2-r1-ir-data-model-01-sequence.png` | step 2 part 1 | readable, long detours but no overlap |
| `s2-r1-ir-data-model-02-architecture.png` | step 2 part 2 | "children" label over the Connection class (F4) |
| `s2-r1-bundle-canvas-1.png` | combined file, tile 1 of 3 | ref shows the part's title; canvas cut by the tile, as expected |
| `s3-confirmed-cli-emit-drawio.png` | step 3 confirmed draft b | correct; same F6 polish |
| `s4-note-cli-emit-drawio.png` | step 4 note, round 1 | note inside the "errors" branch (F5) |
| `s5-cli-emit-architecture.png` | step 5 round 1 | frames enclose non-members (F3) |
| `s5-r2-cli-emit-architecture.png` | step 5 round 2, short labels | clean |
| `s5-modules-experiment.png` | side experiment, flowchart fallback | clean |
| `s6-cli-emit-architecture.png` | step 6 single emit with `ref` | frames and titles overlap, slug broken mid-word (F3) |
| `s6-bundle-arch-block.png` | step 6 block from the `.md` | same overlap (F3) |
| `s6-cli-emit-architecture-01-run-folder.png` | step 6 ER part | clean |

Not opened: `s2-r1-bundle-canvas-2.png`, `s2-r1-bundle-canvas-3.png` (further tiles of the
combined draw.io file). The step-4 round-2 picture (note moved to the top) and the step-2
round-2 parts were re-emitted but not previewed again.
