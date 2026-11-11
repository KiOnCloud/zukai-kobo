# E2E B: scout, consult, new diagram, architecture to Mermaid, CLI edge cases

Tester played the runtime agent without `AskUserQuestion` and without subagents (scout and review done in-session).
All commands ran with the working directory `S/proj`, where
`S = /tmp/claude-0/-home-user-zukai-kobo/d18c1f21-fd55-4bdd-a991-536a40188c82/scratchpad/e2e-b`
and `CLI = node /home/user/zukai-kobo/skills/draw/scripts/bin/cli.mjs`. Nothing under the repository was changed except this report.

Overall: every check asked for passes except two partial ones (step 4 and step 5, where the text leaves a choice open) and one confirmed bug outside the listed checks (draft bundles are not in run order, F1).

## Step 1: `/zukai:draw scout --to mermaid --kind sequence --scope overview --audience technical ...`

Result: PASS (all four checks).

All four opening questions were fixed by flags, so nothing was asked. Run folder: `S/proj/diagrams/20261111_emit-ir-to-drawio/` (8 participants, 15 messages, one `opt`, one `alt`, one note).

- (a) PASS. The contract's command, used literally, works: `CLI bundle --to mermaid --out <run>/emit-ir-to-drawio.md --title "emit: IR to draw.io" <run>` printed `{"ok":true,...,"diagrams":1,"order":["emit-ir-to-drawio"],"warnings":0}`, exit 0.
- (b) PASS. `closing-contract.md:43-46` has the combined file previewed. `CLI preview <run>/emit-ir-to-drawio.md --max-px 1600` exited 0 with `"blocks":1` and one file; after step 5 the same command gave `"blocks":2` and two files (`...-d1.png`, `...-d2.png`). Both render.
- (c) PASS. The note has `"after": "secret-gate"` (the alt block's id). In the `.mmd` the `Note over n2,n4: ...` line comes after the block's `end`; in the PNG the yellow note stands below the alt frame, not inside the `else` branch.
- (d) PASS. `validate` prints warnings as one JSON object on stderr and a summary on stdout, exit 0. Example (a return placed before its call): stderr `{"warnings":[{"stage":"model","path":"/messages/0","message":"model: return \"early\" from \"cli\" to \"user\" comes before any call ...","hint":"..."}]}`, stdout `{"ok":true,"kind":"sequence","title":"...","warnings":1}`. The delivered IR printed `"warnings":0`. See F6 for one wrinkle.

In-session review: PASS, image opened. Polish only: lifelines cross some message labels, and the participant label "Model, detail and secret checks" touches its box edges (Mermaid's own rendering).

## Step 2: `/zukai:draw scout the data model of an IR`

Result: PASS.

The opening text message asked kind (all seven), scope and view; the target was not asked and defaulted to `drawio` (`SKILL.md:48`), which matches the user's choice. Run folder: `S/proj/diagrams/20261111_ir-data-model/` (13 classes, 16 relations, two labelled self-relations: `Boundary` "holds boundaries" and `State` "composite holds states"). `validate`, `emit --to drawio` and `bundle` all returned 0 warnings.

In the PNG both self-relation loops sit on the right side of their class, with the label to the right of the loop. "holds boundaries" ends well short of `Connection`, and "composite holds states" ends well short of `Diagram`. Nothing overlaps.

## Step 3: `/zukai:revise what if validation ran after the feature-matrix check instead of before?`

Result: PASS (run found, checks a, b, c, and the hand-edit check).

- Finding the run: rule 2 of `revise/SKILL.md:64-68` applies (two runs made in this conversation). The request names "validation" and "feature-matrix check"; only the Mermaid run has those labels ("IR validator", "Feature matrix check"), so it is singled out correctly. The class run has neither.
- (a) PASS. The texts say where the options come from: `revise/SKILL.md:128-131`, `consult-protocol.md:45` and `closing-contract.md:132-134`. `CLI drift <run>/emit-ir-to-drawio.md <run>` printed `{"ok":true,"drifted":false,"bundled":true,"target":"mermaid","pages":[...],"bundle":{"title":"emit: IR to draw.io"}}`, exit 0.
- (b) PASS. Draft A only moves `check-matrix` before `validate`. `CLI diff <run>/source <run>/drafts/a/source` reported `"reordered":[{"collection":"messages","moved":[{"id":"check-matrix","label":"checkFeatureMatrix(ir, \"drawio\")","after":"call-emit"}]}]` with `added`, `removed` and `changed` empty. The `meta.source` and `meta.notes` changes appear under `fields`.
- (c) PASS. `drafts/consult.json` was written as `consult-protocol.md:15-19` describes (`request`, `axis`, `drafts: [{id, name}]`). The protocol leaves writing it to the agent; no CLI command creates or checks it.
- Confirm of draft A: `snapshot ... --bundle @<file>` wrote `r001` with the bundle title in `revision.json`; the note's `rNNN` became `r001`; `drafts/` was deleted; emit, bundle, preview and a clean `drift` followed. Review PASS, image opened.
- Hand-edit check: PASS. After changing one line inside the fenced block of the combined `.md`, `CLI drift <run>/emit-ir-to-drawio.md <run>` printed `"drifted":true` with `"changes":[{"cell":"(text)","change":"edited"}]`. Three variants behaved differently, see F4.

## Step 4: abandoned consult, then a new session

Result: PASS for the text and for what is on disk; one gap (F3).

A second consult ("what if the CLI did not write the file itself?") built drafts A and B plus `consult.json` and stopped before confirmation. In the "new session", rule 3 (`revise/SKILL.md:69-72`) found the run by the label "IR validator".

- What the text says: `revise/SKILL.md:76-80`. The leftover `drafts/` is reported first, with an offer to resume (consult protocol step 4, using the request and draft names from `consult.json`) or drop (delete `drafts/`). On resume the new request waits; on drop it continues from step 2.
- Enough on disk to resume: yes. `consult.json` holds the request, the axis and the draft names; each draft has `source/`, `mermaid/` and the combined `.md`; the change list is recomputed with `diff <run>/source <run>/drafts/<x>/source` (exit 0); the bundle options come back from `drift` and are also in `history/r001/revision.json`.
- Gap: the simulated user's answer "default" cannot be resolved, because neither option is marked as suggested. I took "drop" in order to exercise the rename and record that as my choice, not the text's.
- The rename then ran on the direct route: `r002`, `diff` reported `changed: participants/validator [label]`, and the combined file shows `participant n5 as Validator`.

## Step 5: `/zukai:revise add an architecture diagram of the modules behind this flow`

Result: PASS for the modules rule; the follow-up request could not be run (no architecture diagram exists).

- Route: new diagram (`revise/SKILL.md:138`). Step 8.1 sends the agent through the draw skill's opening call.
- What is asked: `draw/SKILL.md:198-205` says the kind question is still asked although the request says "architecture", offering `class` first (one class per module, stereotype `module`, `dependency` relations), `flowchart` second and `architecture` third, each with its consequence. Mode, scope and view are asked too, because `revise/SKILL.md:214-216` says the delivered run answers none of them; only the target is the run's.
- Two wrinkles when following it literally: F2 (text-message path lists all seven kinds) and F3 (the mode question has no suggested option, so "default" is undefined; I used `scout` because the modules are in the code).
- User picked the first option, `class`. Placement: a diagram of its own, slug `emit-modules` (15 modules, 17 dependencies). `r003` was written; `diff` reported `diagramsAdded: ["emit-modules"]` and the hint "new diagram emit-modules is not the ref of any element ... or say in the report that it stands on its own". `bundle` gave `order: ["emit-ir-to-drawio","emit-modules"]`. Review PASS, image opened.
- `/zukai:revise a detailed version of the architecture diagram`: not run, because the run has no architecture diagram (the user chose `class`). The text has no rule for a request that names a diagram the run does not have (F7). As a substitute I checked the guard on a scratch run: `diff` of a run with a second architecture IR prints the hint "order-detailed is a second architecture diagram beside order: ... the detail of order belongs in a part of another kind (sequence, activity, er) linked with ref", which matches `revise/SKILL.md:229-232`.

## Step 6: architecture with boundaries to Mermaid, twice

Result: PASS for warnings, form and frames; one visual defect in the `architecture-beta` picture (F5).

IR: the `ir-reference.md` example (boundary `aws` holding boundary `vpc` and `queue`; `vpc` holding `api` and `db`).

| Variant | Form written | Warnings |
|---|---|---|
| short labels (all 16 characters or fewer) | `architecture-beta` | 5 `feature-matrix` warnings: queue drawn with the server icon; four connection labels dropped |
| long label on `api` ("Order API (.NET 8 on ECS Fargate)") | `flowchart LR` | 1 `layout:` warning: "the label of \"api\" is longer than 16 characters, which stretches the frame of its boundary over its neighbours"; no matrix warnings |
| `ref` on `db` (label "PostgreSQL", 10 characters) | `flowchart LR` | the same `layout:` warning, naming `db` |

- Frames: in all three PNGs each frame encloses exactly its members and no frame overlaps another. In the `architecture-beta` picture "AWS account" holds VPC and "SQS orders", "VPC" holds the API and PostgreSQL, and the browser and the payment provider are outside. The flowchart form nests the same way.
- Defect: in the `architecture-beta` picture the two vertical connections run through the names "Payment provider" and "Order API (.NET)" (F5).
- Wording: for the `ref` variant the warning says the label of `db` is longer than 16 characters, although the IR label has 10; the `ref` line is what makes it longer (F8).

## Step 7: CLI edge cases

Result: PASS for all eight (each behaves sensibly with a clear message).

| Case | Exit | Output |
|---|---|---|
| `emit --to mermaid` on one component connected to 60 others | 0 | Written in 0.26 s as `flowchart TB` (246 lines, renders). Two warnings: `size: 61 components in one diagram ...` and `layout: architecture-beta cannot place this diagram without overlaps ("hub" and "s5" would need a diagonal connection) ...` |
| `diff` of two IRs differing only in message order | 0 | `"differs":true`, `"reordered":[{"collection":"messages","moved":[{"id":"read-ir",...,"after":"call-emit"}]}]`, everything else empty |
| `snapshot` on a run whose `source/` is empty | 1 | `no IR files in .../20261111_empty/source; nothing to snapshot`, with a hint; no `history/` created |
| `revisions` on a missing path | 1 | `no such folder: .../edge/nope`, hint names the run-folder form |
| `emit --to drawio <ir> --out --allow-sensitive` | 1 | `option --out needs a value, but "--allow-sensitive" follows it`, hint `write --out=<value> ...`; no file written |
| `emit --to pdf <ir>` | 1 | `unknown target "pdf"`, hint `--to takes one of: mermaid, drawio, figjam` |
| `--help` (also `emit --help`) | 0 | usage on stdout. With no arguments at all: exit 1, `unknown command ""` plus usage on stderr |
| `bundle --to drawio --canvas all`, folder versus `source/*.ir.json` | 0 / 0 | folder: `order: ["login","login-business","login-01-mfa"]` (main, business view, part). Glob: `["login-01-mfa","login-business","login"]`, as `closing-contract.md:35-38` warns. The canvas follows the same order in each case |

## Findings

**F1. bug: a draft's combined file is not in run order when an added diagram sorts before the main slug.**
`skills/revise/references/consult-protocol.md:47-48` says "Give `bundle` the folder `drafts/<x>`, so the draft is written in run order". The CLI takes the run slug from the folder name (`skills/draw/scripts/src/run-order.mjs:18-22`, used at `cli.mjs:112`); `drafts/a` has no `<yyyymmdd>_` prefix, so the main diagram loses its first place.
Repro: `CLI bundle --to drawio --canvas all --out <run>/drafts/a/login.drawio --title Login <run>/drafts/a` with `audit.ir.json` added to the draft gives `order: ["audit","login","login-business","login-01-mfa"]`; the same four IRs in the run folder give `["login","login-business","login-01-mfa","audit"]`. The draft the user compares therefore opens on a different page (and canvas order) than the confirmed result.

**F2. doc-contradiction: which kinds the "modules" question offers on the text-message path.**
`skills/draw/SKILL.md:198-205` says to offer `class` first, `flowchart` second and `architecture` third. `skills/draw/SKILL.md:139-143` says that without `AskUserQuestion` the kind question "lists all seven kinds". The text does not say whether the three lead a list of seven or replace it. Repro: follow `/zukai:revise add an architecture diagram of the modules behind this flow` in a runtime without the tool.

**F3. ambiguity: three questions have no suggested option, and revise has no path for runtimes without `AskUserQuestion`.**
- The mode question (`skills/draw/SKILL.md:60-63`) marks no suggestion, while `SKILL.md:143` accepts "default" as an answer. On the new-diagram route this question is always open.
- The leftover-drafts offer (`skills/revise/SKILL.md:76-80`) marks neither "resume" nor "drop" and does not say how to ask.
- `skills/revise/SKILL.md:71, 151, 189, 230` and `consult-protocol.md:28, 67` name `AskUserQuestion` with no text fallback; only the draw skill has one (`draw/SKILL.md:139`).
Repro: answer "default" to the mode question, or to the drafts offer in step 4.

**F4. UX: the Mermaid hand-edit check finds an edit but cannot say what changed, and three nearby edits behave differently.**
`skills/revise/SKILL.md:93-94` asks to tell the user in plain words what differs; for Mermaid the result is only `{"cell":"(text)","change":"edited"}` (`skills/draw/scripts/src/drift.mjs:328`).
- Editing the `Source:` line reports the diagram as `"missing":true` with `drifted:true` (`drift.mjs:330`), although the block is untouched.
- Editing the `#` heading is not drift; the new heading silently becomes the recovered `bundle.title` (`"bundle":{"title":"My title"}`).
- A hand edit of `mermaid/<slug>.mmd` is never seen: `drift <run>.md <run>` stays `drifted:false`, and `drift` on the `.mmd` exits 1 ("for a Mermaid run pass its combined <run-slug>.md"). The redraw overwrites it without a question; `revise/SKILL.md:128-131` covers the combined file only.
Repro: `sed -i 's/^Source: /Source file: /' <run>/<run-slug>.md && CLI drift <run>/<run-slug>.md <run>`.

**F5. visual-defect: `architecture-beta` draws vertical connections through component names, and the title is not drawn.**
In `S/edge/arch/short.png` the arrow from the API up to the payment provider crosses the text "Payment provider", and the line down to "SQS orders" crosses "Order API (.NET)". `review-checklist.md:13` ("No connection runs through a component name") makes this a finding the author cannot fix from the IR. The front-matter title "Order platform" is also absent from that picture, while the flowchart form shows it. `target-mermaid.md:117-120` promises `architecture-beta` only "while it can be drawn well".
Repro: `CLI emit --to mermaid S/edge/arch/short.ir.json --out short.mmd && CLI preview short.mmd`.

**F6. UX: `validate` reports a definite credential as a plain warning with `ok:true`.**
An IR with `password=<value>` in a note validates with exit 0 and the message "remove it before sharing the diagram"; the following `emit --to mermaid` exits 2 with "refusing to emit". `closing-contract.md:24-30` says to validate first and emit only when every IR passes, so the refusal arrives one step later than it could. Repro: `CLI validate S/edge/warn1.ir.json; CLI emit --to mermaid S/edge/warn1.ir.json`.

**F7. ambiguity: a request for another version of a diagram the run does not have.**
`skills/revise/SKILL.md:138` routes "a detailed version of it" to the new-diagram route and `:229-232` handles a second diagram "of the kind and subject of a delivered one". Neither says what to do when the named diagram (here: the architecture diagram) was never delivered because the user chose `class` for the modules. Repro: step 5, second request.

**F8. UX: the fallback warning's wording and path.**
`skills/draw/scripts/src/emit-mermaid.mjs:60` always uses `path: "/connections"`, also when the reason is one component's label. For a short label with `ref` the message says the label "is longer than 16 characters" without saying the `ref` line is counted (`target-mermaid.md:118-119` does say so). Repro: `CLI emit --to mermaid S/edge/arch/ref.ir.json`.

## PNGs actually opened

- `/tmp/zukai-preview/emit-ir-to-drawio-md-a544efed-d1.png` (step 1, combined file; written before I pointed `TMPDIR` at the scratchpad)
- `S/tmp/zukai-preview/ir-data-model-drawio-b82fa061.png` (step 2, combined file)
- `S/tmp/zukai-preview/emit-ir-to-drawio-md-a544efed-d1.png` (step 3, after confirming draft A)
- `S/tmp/zukai-preview/emit-ir-to-drawio-md-a544efed-d2.png` (step 5, modules class diagram in the combined file)
- `S/edge/arch/short.png`, `S/edge/arch/long.png`, `S/edge/arch/ref.png` (step 6)

Rendered but not opened: the single-file previews of steps 1, 2 and 5, the combined preview after the rename in step 4, `S/edge/arch/flat.png` and the hub tiles `S/edge/hub-*.png`. The first `preview` calls of step 1 wrote two PNGs to `/tmp/zukai-preview/`, outside the scratchpad, because that is the CLI's default location.

## Unresolved questions

1. Should a draft bundle take its run slug from the enclosing run folder (CLI fix), or should the protocol pass the files one by one (text fix)? (F1)
2. Which option is the default for the mode question and for the leftover-drafts offer? (F3)
3. Is a hand edit of `mermaid/<slug>.mmd` meant to be protected like the combined file? (F4)
