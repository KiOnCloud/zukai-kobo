# E2E 2026-11-17: use case kind, change pictures, PlantUML recook (Codex install)

Tester: single-agent runtime, no subagents, no `AskUserQuestion`; the agent followed the installed
skill text literally and also played the user. Nothing in the repository was edited except this file.

## Setup

- Sample project: `/tmp/claude-0/-home-user-zukai-kobo/dfd23dcb-7283-57de-90e1-1d422710abbb/scratchpad/e2e-b/clinic` (git).
  The folder `e2e-b` did not exist when the round was resumed, so the project was created from scratch.
- `docs/legacy/`: `checkout-sequence.puml`, `clinic-usecases.puml`, `deployment.puml`,
  `mindmap-and-classes.puml`, `common-style.iuml` (the `!include`), `notes.md` (one `plantuml` and one `mermaid` fence).
- Install: `bash /home/user/zukai-kobo/install.sh --target codex --dest <project>` -> exit 0,
  `zukai`, `zukai-revise`, `zukai-recook`, `zukai-sync` 2.2.2 under `.agents/skills/`.
- Only the installed copies were read. Node v22.23.4. Renderer: `drawio-web` / `mermaid-web` (Playwright), worked every time.
- `Z` below = `node <project>/.agents/skills/zukai/scripts/bin/cli.mjs`.

## Scenario A: `$zukai clarify use cases of a clinic appointment booking system` - PASS (with findings)

Opening message (text form, no `AskUserQuestion`):

- Kind: not asked. `SKILL.md:103-105` skips the kind question when the request names a kind verbatim and
  lists "use cases of" as such a name; the agent said "kind: use case (usecase), named in the request".
  So the opening question does not *propose* the use case kind, it fixes it (finding F1).
- Q1 "Level of detail? 1a overview (suggested) / 1b detailed" -> user: `1b`.
- Q2 "Which view? 2a technical (suggested) / 2b business / 2c both" -> user: `2a`.
- Clarify round 1 (actors, goals, boundary, supporting actors, shared, optional, kinds of actor, which goal gets a part):
  user: Patient, Registered patient (a kind of Patient), Receptionist, Doctor; SMS gateway and Payment provider outside;
  goals Search available slots, Register an account, Book / Cancel / Reschedule an appointment, Manage doctor schedules,
  Check in a patient, View today's appointments; Sign in shared by book, cancel, reschedule; Pay a deposit only on a
  first visit; part for "Book an appointment" with its steps.
- Closing question "Emit this to drawio, or change something?" -> user: "emit".

Commands: `validate` x2 (0 warnings), `emit --to drawio` x2, `bundle --to drawio --canvas all`, `preview` x3 (all exit 0).
Files: `diagrams/20261117_clinic-booking/` with `source/clinic-booking.ir.json`,
`source/clinic-booking-01-book-appointment.ir.json` (activity part, linked by `ref`), `drawio/*.drawio`, `clinic-booking.drawio`.
Pictures looked at: use case diagram correct (primary actors left, systems right, labels beside the lines, no line
through a foreign ellipse); activity part correct. Review verdict PASS, 1 round, images opened.

Other targets:

- `emit --to mermaid`: exit 0, flowchart, 6 warnings (1 for the kind, 4 persons, 1 generalization), exactly what
  `target-mermaid.md:60-67` announces. Part: `swimlane-beta` with 2 warnings. `bundle --to mermaid`: 7 warnings.
- `emit --to figjam ... --out ... --overlay ...`: exit 2,
  `kind "usecase" is unsupported on target "figjam": FigJam generate_diagram has no use case diagram; use --to drawio, or emit --native to draw the board with use_figma`
  (same for the activity part). `emit --to figjam --native <file.js>`: exit 0, `out: null`, script written.
  Both as `SKILL.md:234-237`, `clarify-protocol.md:161-164` and `target-figjam.md:14-18, 43-47, 164-177` say. No board was drawn.

## Scenario B: `$zukai-revise what if receptionists could also book on behalf of a patient?` - PASS (with findings)

- Route: consult ("what if"). Drift: nothing drifted; `bundle` = `{"title":"Clinic appointment booking","canvas":"all","gap":120}`.
- Question before the drafts: "When the receptionist books, is Sign in still part of it?" -> user: "yes, the same Sign in".
- Draft A: association Receptionist - Book an appointment, lane of the part renamed. Draft B: new use case
  "Book for a patient" (generalization to Book an appointment) with the receptionist's association.
- Per draft: `validate`, `emit`, `bundle --canvas all --gap 120 drafts/<x>`, `diff <run>/source <run>/drafts/<x>/source --drawio drafts/<x>/changes.diff.drawio`, `preview`.
  Change pictures looked at: A shows the new line green; B shows the new use case and both lines green, boundary amber.
- User chose B. `snapshot` -> `r001`; drafts copied; `diff history/r001/source source --drawio drafts/changes-r001.diff.drawio`;
  emit, bundle, preview, review PASS (1 round) with emitter findings F7, F8.
- `$zukai-revise undo`: `revisions` (undo = r001), `restore <run> undo --bundle @file` -> `{"restored":"r001","snapshot":"r002"}`,
  rebuild. `git diff` against the first delivery: empty, the run is byte-identical. `revisions` now `undo: null, redo: r002`.

## Scenario C: `$zukai-revise --doc --svg rename "Book an appointment" to "Book a visit"` - PASS

- Route: direct (wording only). `snapshot` -> `r003`; use case label and the title of its part changed;
  `diff ... --drawio drafts/changes-r003.diff.drawio`: use case amber, legend `"Book a visit": label was "Book an appointment"`.
- `bundle --to doc --lang en --out clinic-booking.doc.md`: use case tables present (Actors with kind and role,
  Use cases with boundary and a link to the part, Boundaries, Relations with the extend condition), then the activity part.
- `export <run>`: `svg/canvas.drawio.svg`, `svg/clinic-booking.drawio.svg`, `svg/clinic-booking-01-book-appointment.drawio.svg`,
  `"text":"svg"`, 0 warnings. Rasterised and looked at: correct, text is SVG text.

## Scenario D: `$zukai-recook docs/legacy/clinic-usecases.puml` - PASS (with finding F11)

- `extract`: 1 page, 16 nodes, 12 edges, hint `usecase` score 122 ("8 use cases", "5 actors", "4 include or extend arrows",
  "1 system boundary"), `direction: LR`, no warnings. Aliases, quotes, `(Pay deposit) as UC7`, skinparams and comments read correctly.
- Questions: kind `usecase` (suggested, with the evidence) -> accepted; scope -> overview; view -> technical.
- `cover`: first exit 2 (3 missing: the two lines of the note and the second note), after two `meta.omitted` entries
  `units 22, covered 22`. Run `diagrams/20261117_clinic-booking-usecases/`. Picture correct.
- Kept: 5 actors, 8 use cases, boundary, 6 associations, 3 include, 1 extend, 1 generalization.
  Omitted: `"Only for first-time patients"` and `"Reminders go out 24h before"` (a use case diagram has no note). Added: the title.

## Scenario E - PASS (with findings)

E1 `$zukai-recook --scope detailed docs/legacy/deployment.puml`:
`extract` hints `architecture` 123 and `er` 64 (mixed page), warning
`line 3: !include of common-style.iuml is not followed: what that file declares is not in these facts`.
Delivered `diagrams/20261117_clinic-production/`: architecture main diagram (AWS frames, 9 components) and
`clinic-production-01-postgresql` (`er`, 4 entities, 3 relations) linked by `ref` on the database. `cover` 46/46.
Both pictures correct in content; layout finding F14.

E2 `$zukai-recook docs/legacy/mindmap-and-classes.puml`: page `plantuml-1` reported as
`unsupported: {type: "mind map", reason: "Zukai has no mind map kind"}` with the warning
`line 1: mind map is not read (Zukai has no mind map kind); nothing extracted from this diagram`; page `plantuml-2`
hint `class` 100. Delivered `diagrams/20261117_clinic-domain-model/` (8 classes, 8 relations), `cover` 32/32, picture correct.

E3 `$zukai-recook docs/legacy/notes.md`: 2 pages (`mermaid-1` state, `plantuml-1` sequence), default target drawio.
Delivered `diagrams/20261117_booking-notes/` with a state and a sequence diagram, `cover` 12/12, pictures correct.
Findings F16, F17.

## Scenario F: `$zukai-recook docs/legacy/checkout-sequence.puml --to mermaid` - PASS

`extract`: 6 participants, 15 messages, 2 frames, 1 note, 1 divider, `autonumber: true`, the `!include` warning.
Delivered `diagrams/20261117_checkout/` (`mermaid/checkout.mmd`, `checkout.md`), `cover` 28/28, 0 warnings.
`alt`/`else`, `loop`, async message, database participant, note and the divider (as a note) are all in the text and the picture.

## Findings

| Id | Grade | Where | What happened | Expected |
|---|---|---|---|---|
| F1 | Medium | `zukai/SKILL.md:64-65`, `:103-105`, `:228-229` | Three rules disagree for "use cases of ...": line 64 "without it the kind is always asked, never guessed"; lines 103-105 skip the question when the request names a kind verbatim and give "use cases of" as an example; lines 228-229 say "Suggest `usecase` first when the request asks ... (\"use cases of\" ...)". Read literally the kind question is skipped, so nothing is proposed. | One rule: either "use cases of" fixes the kind, or it only puts `usecase` first in a question that is asked. |
| F2 | Low | `zukai/references/review-checklist.md:120` and `:130` | Two items are numbered 16 (Audience 16 and Revision 16); Revision runs 16-18. A finding citing "item 16" is ambiguous. | Revision items 17-19. |
| F3 | Low | `zukai/references/target-drawio.md:37-38`, `closing-contract.md:200-205` | The list of elements that take `ref` in a bundle omits the use case (line 186 of the same file has it); the paragraph on description tables lists every kind but use case, although the CLI writes them. | Use case named in both. |
| F4 | Medium | `zukai-revise/SKILL.md:116-117`, `closing-contract.md:243-256` | After closing step 7 the run held draw.io, Mermaid and FigJam files. Revise speaks of "`drawio/` ... or `mermaid/`" and the revise section of the contract of one target. No rule says whether every target is rebuilt; `figjam/*.native.js` is mentioned nowhere. All were rebuilt by guess. | A rule for a run with more than one target. |
| F5 | Low | `closing-contract.md:18-19`, `target-figjam.md:172` | The run-folder table names `figjam/<slug>.mmd` and `.overlay.js` only. For a use case (native only) no file name is given; `figjam/<slug>.native.js` was a guess. | A row for the `--native` script. |
| F6 | Medium | `closing-contract.md:262-265`; CLI | `preview` renders only the first page of a change picture, so the change on a part's page (draft A: lane label) cannot be looked at. `Z preview <run>/drafts/a/changes.diff.drawio --page clinic-booking-01-book-appointment --max-px 1600` -> exit 0 and the same first-page PNG; `Z export <run> --page clinic-booking` exports all 3 pages. An unknown option is refused (`unknown option --frobnicate`), `--page` is silently ignored. | `--page` honoured by `preview`/`export` or refused; a way to see every page of the picture. |
| F7 | Medium | draw.io use case layout (draft A) | One added association (Receptionist - Book an appointment) reordered every actor and use case (Receptionist first, Patient last); the generalization then runs round the outside of the actor column. The picture colours only the new line, so it cannot be compared by eye with the delivered one. | Positions stable for a one-line change. |
| F8 | Medium | draw.io use case layout (draft B, r001) | The hollow triangle of the generalization from "Book for a patient" lands on "Book an appointment" at the same spot as the open arrowhead of «extend»; on the one-line ellipse of the bundle the two overlap, and the SMS association leaves 20 px above. | Line ends spread along the outline. |
| F9 | Low | `diff --drawio` | Adding a use case colours the whole boundary amber with the legend line `"Clinic booking system": children changed`. | Membership of a new element not shown as a change of the frame. |
| F10 | Low | `zukai-revise/SKILL.md:215-245` | After the undo, `drafts/changes-r001.diff.drawio` still shows a change the run no longer has; no rule says to remove it or whether an undo writes its own picture. | A rule for change pictures on undo. |
| F11 | Medium | `zukai-recook/references/mapping.md:146`, `:279`; `review-checklist.md:93-94` | A PlantUML note has no place in a use case diagram, so "Only for first-time patients" (the condition of the «extend») is only in `meta.omitted`. The delivered extend has no condition, which the checklist calls `wrong` when the source states one; "Nothing is invented" forbids the fix. | A rule for a note attached to an extending use case, or the checklist exception for a recook. |
| F12 | Low | CLI `cover` | A two-line note counts as two texts ("Only for first-time", "patients"), and the hint has broken quotes: `add a meta.omitted entry of the form ""<text>": <reason>"`. One joined entry does satisfy it. | One unit per note; clean hint. |
| F13 | Medium | `ir-reference.md:255-262`, `aws-icons.md:18-24`, `mapping.md:120`, `:126`, `:261`; `zukai/SKILL.md:206-210` | Recooking the deployment diagram needed three guesses: the `poll` edge drawn worker -> queue (reference: queue -> consumer, label not "consumes") against "Content stays"; SQS inside the private subnet and an "ECS cluster" frame against the icon rules; icons for plain PlantUML boxes (mapping covers only `drawio:` icons, SKILL wants a figure on every component). The source was kept. | Which rule wins in a recook. |
| F14 | Low | draw.io architecture layout | The main flow runs along the bottom edge with everything above it (checklist item 3 names this a finding), and the line to Twilio crosses the header bar of "ECS cluster" beside its title. | Flow through the middle. |
| F15 | Low | `mapping.md:217-220` | The `*` (not null) marks of the entities are dropped; nothing tells the agent to report it and `cover` does not count them. | A line in the report. |
| F16 | Medium | `zukai-recook/SKILL.md` step 1.3; CLI `extract`, `bundle` | Both fences of the Markdown file get the page name "Booking notes" (the document heading). Kept as titles, `bundle` writes two pages `name="Booking notes"` without a warning; `extract --page "Booking notes"` returns both. Titles were invented. Pages are listed Mermaid first although the PlantUML fence comes first. | Distinct page names or a warning on duplicate titles; file order. |
| F17 | Medium | `closing-contract.md:12`, `:44-46`; `zukai/SKILL.md:132`; `zukai-recook/SKILL.md` step 3 | Two unrelated pages have no main diagram. The contract knows only "the main diagram (the one named after the run)" and its parts; recook names only the linked-part case. File names were a guess and the bundle order came out alphabetical, against the source order. | Naming and order for sibling diagrams. |
| F18 | Low | `zukai-recook/SKILL.md` step 3, "Content stays" | Under `overview` "a sub-flow is what the source groups (a subgraph, a frame, a group)": the `alt` and `loop` of a sequence are frames, so read literally they collapse into one step. They were kept. | Say that blocks of a sequence are not sub-flows. |
| F19 | Low | Mermaid pictures | `swimlane-beta`: the "no" flow leaves the decision, runs over the lane header and round the left edge; the initial node is hollow. Sequence: lifelines cut labels ("insert order (status = PENDING)", "[every 5 minutes]"). Mermaid's own rendering. | Named among the expected degradations. |
| F20 | Low | `zukai/SKILL.md:256`, `ir-reference.md:507`, `target-mermaid.md:30`, `target-drawio.md:102` | The installed text points to `docs/feature-matrix.md` and `docs/install.md`, which a copied install does not have. | A path that exists, or the repository URL. |
| F21 | Low | CLI `emit --to figjam --native` | `text` reads "not written: kind \"usecase\" is unsupported ... use --to drawio, or emit --native ...": it recommends the option just used. | Plain "no Mermaid text for this kind". |
| F22 | Low | `zukai-revise/SKILL.md:175`, `clarify-protocol.md:158-159` | A rename of a use case that has a part: nothing says the part's title follows (it "is the label of its use case"). The title was changed too; the picture page of the part reports `changed: 0`. | State it in the direct route. |
| F23 | Low | draw.io class layout | Subclasses Patient and Doctor stand above the abstract Person. | General class on top. |

No High finding: no scenario was blocked and no delivered diagram was wrong in content.

## Unresolved questions

- F1: is "use cases of" meant to fix the kind or to suggest it?
- F4: should a revision rebuild every target a run holds?
- F11, F13: does the source or Zukai's rule win in a recook when they conflict?

## Clean-up

No process started by this round is left running; the browsers of `preview` and `export` exit with the command.
Nothing was committed in the repository.
