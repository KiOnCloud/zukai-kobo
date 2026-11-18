# E2E confirmation round (2026-11-17)

Confirms the High and Medium findings of the three earlier rounds on a fresh install of 2.3.0:
`e2e-261117-scout-sync-doc-svg.md` (A-F..), `e2e-261117-usecase-diff-plantuml.md` (B-F..) and
`e2e-261117-gcp.md` (C-F-..). The tester played the user's agent, following the installed
skill text literally, and the user. Nothing in the repository was edited; this report is the
only file created, and it is not committed.

Result: 26 findings checked, 26 FIXED, 0 PARTLY, 0 NOT FIXED. No new High or Medium
finding; 6 new Low findings.

## Setup

- Base: `/tmp/claude-0/-home-user-zukai-kobo/dfd23dcb-7283-57de-90e1-1d422710abbb/scratchpad/e2e-confirm/`
  with `shop-api`, `clinic`, `invoicing`, each copied from the project of its earlier round
  (all three still existed). In each copy the installed skill folders and `diagrams/` were
  deleted before the install. `tmp/` beside them holds test inputs and the PNGs looked at.
- Install, each exit 0, four skills at 2.3.0:
  - `bash /home/user/zukai-kobo/install.sh --target claude-project --dest <base>/shop-api` (`.claude/skills/`)
  - `bash /home/user/zukai-kobo/install.sh --target codex --dest <base>/clinic` (`.agents/skills/`)
  - `bash /home/user/zukai-kobo/install.sh --target claude-project --dest <base>/invoicing` (`.claude/skills/`)
- Only the installed copies were read and run. `CLI` below is
  `node <project>/<skills>/zukai/scripts/bin/cli.mjs`. Renderer in every call: `drawio-web`.
- IRs: the scouted and clarified content of the earlier rounds was reused as the agent's
  reading of the same code and adapted to the installed 2.3.0 text (terminal statuses, icons
  of a recook, file names of a run without a main diagram). All files were emitted anew.
- `invoicing/infra/messaging.tf` was put back to its first commit before the scout, so the
  second subscription could be added again for the sync.
- "Text" in the evidence column means the installed text under `<project>/.claude/skills/`
  (`.agents/skills/` in `clinic`); line numbers are those of the installed files.

## Runs

| Project | Run | Delivered |
|---|---|---|
| shop-api | `/zukai scout --kind state the order status`, then "the tables in Japanese" | `diagrams/20261117_order-status/` (drawio, `order-status.doc.ja.md`, `source/ja/`) |
| shop-api | `/zukai scout --kind sequence --scope detailed --audience both --svg --doc the login flow`, Mermaid added, code change, `/zukai-sync`, undo and redo | `diagrams/20261117_login/` (6 diagrams; drawio, mermaid, svg, doc, `history/r001..r003`) |
| clinic | `$zukai clarify use cases of a clinic appointment booking system`, `$zukai-revise what if receptionists could also book on behalf of a patient?` (consult, drafts A and B, A confirmed) | `diagrams/20261117_clinic-booking/` |
| clinic | `$zukai-recook` of `clinic-usecases.puml`, `deployment.puml --scope detailed`, `notes.md` | `diagrams/20261117_clinic-booking-usecases/`, `_clinic-production/`, `_booking-notes/` |
| invoicing | `/zukai scout --kind architecture --scope overview --svg --doc`, `/zukai-sync`, `/zukai-revise add the AWS resources the invoice service writes to`, `emit --to figjam --native`, hand move and `/zukai-recook` | `diagrams/20261117_invoicing-system/`, `diagrams/20261117_invoicing-platform/` |

Every `stale` at the end of a scout, a sync and the AWS revision exits 0. Every `cover`
passes (22/22, 46/46, 12/12, 29/29).

## High and Medium findings of the earlier rounds

| Finding | Status | Evidence |
|---|---|---|
| A-F1 (High) labelled final state loses its name | FIXED | Text `scout-protocol.md:88-93`: a terminal status is an ordinary state with a transition to one unlabelled `final` state. Followed literally: `grep -c CANCELLED drawio/order-status.drawio` = 1, and the preview shows the boxes CANCELLED and REFUNDED, both with a line to one end circle. A labelled final state written on purpose: `CLI validate`, `emit --to drawio` and `emit --to mermaid` each print `model: final state "cancelled" has the label "CANCELLED", which no target draws; a final state is a circle without a name`, with the hint to make it an ordinary state. |
| A-F2 self-message labels inside frames | FIXED | Preview of `drawio/login-01-record-failure.drawio`: "lockedUntil = now + 30 min" and "lockedUntil = null" start right of the activation bar and end inside the `alt` frame, whose right border is past them. `drawio/login-business.drawio`: "Count the failed attempt" with its part line, "Clear the failed attempts" and "Open a session" all stand inside both frames, clear of the activation. No `layout:` warning needed. |
| A-F3 frames amber for an inserted message, no old values | FIXED | Sync inserted `touchLastLogin(user.id)` inside four nested `alt` blocks. `CLI diff source drafts/a/source`: `login` has `"added":[{"collection":"messages","id":"touch-last-login",...}]`, `"changed":[]`. Picture `drafts/changes-r001.diff.drawio`, page `login`: only the new message is green, every frame is black, legend "1 added, 0 changed or moved". Value change: `"values":{"label":{"from":"lockedUntil = now + 30 min","to":"lockedUntil = now + 60 min"}}`, and the legend of page `login-01-record-failure` reads `"lockedUntil = now + 60 min": label was "lockedUntil = now + 30 min"`. Text: `zukai-sync/SKILL.md:252-256`. |
| A-F4 no rule when the reviewer agent is not installed | FIXED | `closing-contract.md:267-282`, section "Agents that may not be there": "use the agent when the runtime lists it, and when it does not, do the same protocol inline in the main session. Never stop, ask the user to install something, or skip the step". Named from `SKILL.md:107-110`, `scout-protocol.md:7-8`, `review-checklist.md:3-6`, `zukai-sync/SKILL.md:221-223`. The review of every run of this round was done inline by that rule. |
| A-F5 sync asks about a `drafts/` folder of pictures | FIXED | `zukai-sync/SKILL.md:81-87`: only a `drafts/` folder with `consult.json` is an open consult; one without "holds only the pictures of earlier changes ... nothing is asked about it and nothing in it is deleted". `closing-contract.md:284-313` is the one rule set. In `invoicing` the revision after the sync started with `drafts/changes-r001.diff.drawio` present: nothing asked, and `ls drafts` afterwards shows `changes-r001.diff.drawio` and `changes-r002.diff.drawio`. |
| A-F6 tables in another language | FIXED | `SKILL.md:87-91`, `closing-contract.md:241-250`, `variants.md:158-178`. Heading-only: `CLI bundle --to doc --lang ja --out <run>/order-status.doc.ja.md ...` gives Japanese headings and English labels, said to be complete. User said yes to translated labels: IR in `source/ja/order-status.ir.json`, tables written with `<run>/source/ja` as the folder; the file prints `ソース: source/ja/order-status.ir.json` (the path exists) and the guard `配達から30日以内`. The run is not disturbed: `bundle --to drawio <run>` prints `"order":["order-status"]`, `stale` exits 0 with `"unrecorded":[]`, `snapshot` lists `["order-status.ir.json"]` only. Revise: `zukai-revise/SKILL.md:126-128`. One wording gap left, new finding N4 (Low). |
| A-F7 picture of the sync's change left open | FIXED | `zukai-sync/SKILL.md:282-284`, Apply step 4: "With a draw.io target, write the picture of the change, as revise does: `diff <run>/history/<rNNN>/source <run>/source --drawio <run>/drafts/changes-<rNNN>.diff.drawio`"; lines 271-272 say the steps are written out in full. Run: `"written":true`, three pages (`login`, `login-01-record-failure`, `login-01-record-failure-business`), each rendered with `preview --page`. |
| B-F1 three rules for "use cases of ..." | FIXED | One rule, `SKILL.md:118-134`: a kind named in words fixes it ("use cases of the clinic system" is in the list), the kind question is left out and one line says which kind was read and from which words. `SKILL.md:71-73` and `:276-278` say the same; `usecase` is suggested first only when the kind is asked. The agent said "kind: use case, from 'use cases of' in the request". |
| B-F4 run with more than one target | FIXED | `closing-contract.md:320-330` and `zukai-revise/SKILL.md:120-125`: every target the run folder holds is rebuilt, with the call per FigJam file. `zukai-sync/SKILL.md:285-288` says the same for a sync. Run: the login run held draw.io and Mermaid; after the sync `grep -c touchLastLogin login.md login.doc.md svg/login.drawio.svg` = 1, 1, 1 and `CLI drift login.md <run>` gives `"drifted":false`. After the undo all three are 0 again. |
| B-F6 `--page` ignored by `preview` and `export` | FIXED | `CLI preview <run>/drafts/changes-r001.diff.drawio --page clinic-booking-01-book-appointment` renders that page (`"page":{"id":"clinic-booking-01-book-appointment",...},"pages":2`; the PNG shows the lane "Registered patient or receptionist" in amber with its old label). `--page nope` exits 1 with `no page "nope" in this file` and the list of pages. `CLI export <run> --page clinic-booking` writes one picture; the same on the change picture writes the page of the part. `preview svg/clinic-booking.drawio.svg` renders (`"pages":1`), and with a page it does not hold exits 1 with the list. Options a command does not take, all exit 1: `preview does not take --lang`, `export does not take --max-px`, `validate does not take --page`, `--lang goes with --to doc, not "drawio"`, `--native goes with --to figjam, not "mermaid"`. |
| B-F7 one association reorders the use case layout | FIXED | Draft A adds Receptionist - Book an appointment. Before and after compared by eye (`tmp/uc-before.png`, `tmp/uc-diff-a.png`): actors stay Patient, Registered patient, Receptionist, Doctor; all use cases of the other actors, Sign in, Pay a deposit and both systems keep their places; the generalization stays a short vertical line. Only the two use cases of the Receptionist swap rows. The one green line is easy to find. |
| B-F8 line ends on an ellipse share a point | FIXED | Draft B (`tmp/uc-diff-b.png`): on "Book an appointment" the «extend» arrowhead, the hollow triangle of the generalization and the SMS association end at three separate points of the outline, about 20 px apart; the same in the recooked use case diagram for «extend» and the two «include» lines. |
| B-F11 note on an extend lost in a recook | FIXED | `CLI extract docs/legacy/clinic-usecases.puml`: edge `e10` carries `'condition': 'Only for first-time patients'`. `mapping.md:311-323` says when to take it. Delivered: `value="«extend»<br>[Only for first-time patients]"` in the draw.io file and in the picture; `cover` 22/22 with only the reminder note in `meta.omitted`. Checklist `review-checklist.md:97-98` agrees. |
| B-F13 which rule wins in a recook of a deployment diagram | FIXED | `mapping.md:130-156`: the direction of an edge is the source's (`poll` stays worker to queue), an icon only where the label names the service, a frame of the source stays; each is listed in the report (`zukai-recook/SKILL.md:287-289`). Recook without a guess: icons on "PostgreSQL 15 (RDS)" and "SQS reminders" only, "ECS cluster" a plain boundary, SQS inside the private subnet; `cover` 46/46, picture correct. |
| B-F16 two fences under one heading | FIXED | `CLI extract docs/legacy/notes.md`: pages `plantuml-1` "Booking notes (1)" then `mermaid-1` "Booking notes (2)", in file order; `--page "Booking notes (2)"` returns one page, `--page "Booking notes"` exits 1 with the list. Two IRs with one title: `bundle` warns `diagrams "..." and "..." have the same title "Booking notes": the page of "..." is named "Booking notes (2)"` with the hint to give each a title. |
| B-F17 run without a main diagram | FIXED | `closing-contract.md:12`, `zukai-recook/SKILL.md:185-196`, `SKILL.md:163-166`: files `<run-slug>-NN-<name>` in source order, no `ref`. Run: `booking-notes-01-cancellation`, `booking-notes-02-appointment-states`; `bundle --to drawio` and `bundle --to doc` both print that order. |
| C-F-01 hints for GCP names that differ | FIXED | `gcp:gke` -> `did you mean gcp:container_engine? That is draw.io's name for it`; `gcp:cloud_scheduler` -> `did you mean gcp:scheduled_tasks? ...`; `gcp:secret_manager` -> `draw.io has no stencil for this service: leave "icon" out, and the component keeps its generic shape`. Also `gcp:cloud_build` -> `gcp:container_builder`, `gcp:eventarc` -> no stencil. `gcp:gke_on_prem` is no longer offered. |
| C-F-02 empty boundary without a warning | FIXED | `CLI validate` and `emit` on a boundary with `"children": []`: `model: boundary "subnet" has no member; it is drawn as an empty frame`, hint: add members, remove it, or record it in `meta.omitted`. |
| C-F-03 a circle through the topic re-lays the picture | FIXED | Pictures before and after the sync that adds `invoice-events` -> `invoice-api` "push" (`tmp/inv-1-scout.png`, `tmp/inv-2-sync-draft.png`): every icon and frame is where it was; Cloud Scheduler, invoice-api, Pub/Sub, invoice-worker still read left to right, "publish" still runs left to right, and the new "push" is the one line drawn back; the payment API stays above invoice-worker. After the AWS revision the same order holds, with the AWS frame on the right. |
| C-F-04 `stale` after a code-backed revision | FIXED | `zukai-revise/SKILL.md:216-222` and `closing-contract.md:196-202`, `:374-381`: `meta.source` stays `scout`, the file joins `meta.sources`, then `sources <run> --only <diagram-id>`. Run: before that call `stale` shows `"unrecorded":["invoicing-system"]`; `CLI sources <run> --only invoicing-system` records 11 files; `stale` then prints `"stale":false`, exit 0. |
| C-F-05 warnings of `emit --to figjam --native` | FIXED | `CLI emit --to figjam <ir> --native <file.js>`: `"warnings":0`, `"text":"not written: no --out given"`, one script. With `--out` and `--native` together the six warnings are printed with `"appliesTo":"figjam-text"` and "(this is about the FigJam text for generate_diagram; the native script draws the board from the draw.io layout)". Text: `target-figjam.md:181-183`. |
| C-F-06 agents named but not installed | FIXED | Same as A-F4. |
| C-F-07 sync and the `drafts/` folder | FIXED | Same as A-F5. |
| C-F-08 user who does not know the region or network | FIXED | `clarify-protocol.md:113` (boundaries) and `:116` (Cloud icons): draw the provider's outermost frame and nothing inside it, a region or network frame only for what the user stated, one `assumed:` entry in `meta.notes`. `gcp-icons.md:13-17` says the same. |
| C-F-09 other targets left behind by revise and sync | FIXED | Same as B-F4. |
| C-F-10 connection label read as an end label | FIXED | Hand move: cell `invoicing-system:invoice-pdfs` from `x=1084 y=351` to `1264, 391`; `drift` reports `"change":"moved"`. `CLI extract <run>/invoicing-system.drawio`: all 12 edges have `label` set and none has `startLabel` or `endLabel` (`c-worker-secrets` -> `'label': 'read secrets'`); the same from `svg/invoicing-system.drawio.svg`. Recooked to `diagrams/20261117_invoicing-platform/`, `cover` 29/29. `mapping.md:128` also says what to do with such a text. |

Counts: FIXED 26, PARTLY 0, NOT FIXED 0.

## New findings of this round

No High and no Medium finding. Nothing the fixes changed gave a wrong result, a wrong exit
code or a rejected command.

| Id | Grade | Where | What happened | Expected |
|---|---|---|---|---|
| N1 | Low | draw.io use case layout, `clinic` draft A (`tmp/uc-diff-a.png`) | The new association leaves the Receptionist on the same vertical line as the trunk of the Registered patient's associations above it and the Receptionist's own below it, with a gap of about 30 px between the segments. Without the green colour the three read as one line that joins two actors. The two use cases of the Receptionist also swap rows. | The new line on a track of its own. |
| N2 | Low | draw.io architecture layout, `invoicing` after the sync (`tmp/inv-2-sync-draft.png`) | The connection drawn back ("push", topic to invoice-api) has a small step in the middle (two extra bends of a few pixels) where a straight line would do. | A straight return line. |
| N3 | Low | CLI hint | `CLI stale <run> --page x` answers `stale does not take --page`, hint `stale takes --root, --only`. But `CLI stale <run> --only login` is refused with `--only goes with sources`, and the usage line shows `stale <run-dir>... [--root <project>]`. | The hint lists `--root` only. |
| N4 | Low | `closing-contract.md:342-346` against `zukai-revise/SKILL.md:126-128` and `variants.md:158-162` | The revise section of the contract says every `<run-slug>.doc.<lang>.md` is written again "with the `--lang` its first line records", which reads as from the run folder. For a file written from `source/<lang>/` that would bring the English labels back. The revise skill and `variants.md` say the right thing, and the file's source line shows where it came from, but the contract does not name the case. | One clause: a file whose tables name `source/<lang>/` is written from that folder, after the labels were carried over. |
| N5 | Low | draw.io sequence layout (`drawio/login-business.drawio`, also the technical one) | The nested `alt` frames end about 60 to 90 px below their last message, so each frame has an empty band at the bottom. | Frame closed just below its last message. |
| N6 | Low | CLI `export` | `CLI export svg/clinic-booking.drawio.svg --page clinic-booking` exits 1 `not a .drawio file (no <mxfile> root)`, while `preview` and `extract` read the same file. The usage line is honest about it; a user who has only the picture cannot export a page of it. | Accept the editable picture, or say so in the hint. |

Earlier Low findings seen again and not in the scope of this round: A-F14 (a label that
starts on an activation: "record('login_failed', ...)" in the login diagram), B-F9 (a new use
case colours the whole boundary amber, legend "children was ..."), B-F14 (the line to Twilio
crosses the header bar of "ECS cluster").

## Clean-up

No process started by this round is left: `pgrep -af "chrom|playwright|drawio"` returns
nothing; the browsers of `preview` and `export` exit with their command. Preview PNGs are in
`/tmp/zukai-preview/` and in `e2e-confirm/tmp/`. The three sample projects stay in the
scratchpad for inspection. Nothing was committed in the repository.

## Unresolved questions

- None that block. N4 is the only place where two installed texts can still be read two ways.
