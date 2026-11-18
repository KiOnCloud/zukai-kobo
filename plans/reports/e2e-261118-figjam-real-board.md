# End-to-end test of Zukai 2.3.0 on a real FigJam board

Date: 2026-11-18 (UTC). Tester: delegated agent. Nothing in the repository was changed except
this file.

## Board

https://www.figma.com/board/x5akHNd5vZeO6jftzUoSyQ — "Zukai e2e 2.3.0 (2)", created for this
test with `create_new_file` (FigJam) in the drafts of the plan "ccv_design's team"
(`team::1578627207917969059`, Starter tier). The account has five plans; the Figma skill says to
ask the user which one, and a delegated run cannot ask, so the plan was chosen by the tester (the
user's own team, admin role, drafts private). That choice later cost the run: see finding F3.
The earlier file "Zukai e2e 2.3.0" was not opened or touched. No other file of the account was
read or changed, nothing was deleted.

What the board holds now:

| Section (node id) | Drawn by | Content |
|---|---|---|
| Clinic booking use cases (`1:2`) | `emit --native`, 56 shapes | scenario A (still the state before the revision of scenario E) |
| Invoicing on Google Cloud (`2:2`) | `emit --native`, 88 shapes | scenario B, GCP only |
| Invoicing on Google Cloud and AWS (`3:2`) | `emit --native`, 108 shapes | scenario B, multi-cloud |
| Cancel an appointment (`4:2`) | `generate_diagram` + overlay, 19 overlay nodes | scenario C |

## Setup

- Installed from a clean copy of commit `42e4508721d3a02729f0d13cb2b4c4f140aedd78` (branch
  `claude/blissful-noether-5terit`, plugin manifest 2.3.0), made with `git archive HEAD` into
  `<scratchpad>/e2e-figjam2/src`.
- Sample projects copied from `<scratchpad>/e2e-confirm/clinic` and `.../invoicing`, their skill
  folders and `diagrams/` removed, then `install.sh --target claude-project --dest <project>`
  for each: `zukai`, `zukai-revise`, `zukai-recook`, `zukai-sync` 2.3.0 under `.claude/skills/`.
  Only those installed copies were used. Node 22.23.4.
- Figma tools loaded with one `ToolSearch`; `whoami`, the skill `figma-create-new-file`, then
  `create_new_file`, `create_session` (one session for the whole run), the skills `figma-use`
  and `figma-use-figjam` before the first `use_figma`, `figma-generate-diagram` before
  `generate_diagram`.
- `<scratchpad>` = `/tmp/claude-0/-home-user-zukai-kobo/dfd23dcb-7283-57de-90e1-1d422710abbb/scratchpad`.
  Screenshots and draw.io previews of every scenario are in `<scratchpad>/e2e-figjam2/shots/`.
  The screenshots of the cut-off earlier attempt were not needed.

## Scenario A — use case diagram (clinic), target `figjam`: PASS

Run `clinic/diagrams/20261118_clinic-booking-usecases/`. Request played as "use cases of the
clinic booking system --to figjam" (kind from the words; overview, technical). IR: 5 actors (one
`system`), 8 use cases in one boundary, a generalization, 6 associations, 3 `include`, 1
`extend` with a condition. `validate`: 0 warnings.

- `emit --to figjam --out ...mmd`: exit 2, `kind "usecase" is unsupported on target "figjam":
  FigJam generate_diagram has no use case diagram; use --to drawio, or emit --native to draw the
  board with use_figma` (hint: `choose another target with --to`).
- `emit --to figjam --native figjam/clinic-booking-usecases.native.js`: exit 0, `out: null`, one
  part, 10 953 characters, 0 warnings. draw.io file, bundle and `preview` from the same IR.
- `use_figma` with the script unchanged: `{"section":"1:2","created":56,"replaced":0}`; 56 is
  what the script's items give (one shape per item plus one background per labelled text).
- Screenshot beside the draw.io preview (`a-uc-board.png`, `a-uc-drawio.png`): the same picture.
  Four stick figures (head ring, body, arms, legs) with names under them; eight ellipses with
  the labels inside, "Manage the doctor schedule" wrapped onto two lines as in draw.io; the
  boundary with its bold title at the top; the three «include» and the «extend» lines dashed,
  with open arrow heads at the included / extended use case and the stereotype labels on a white
  ground ("«extend» / [first visit of the patient]" on two lines); the hollow generalization
  triangle at "Patient"; the «system» box of the SMS gateway. No difference seen.

## Scenario B — GCP architecture (invoicing), `emit --to figjam --native`: PASS

Runs `invoicing/diagrams/20261118_invoicing-gcp/` (scouted from `infra/*.tf` and the worker)
and `.../20261118_invoicing-multicloud/` (the same plus `infra-aws/main.tf`: S3 archive and SQS
audit queue the worker writes to, in an `aws:aws_cloud` / `aws:region` frame).

- `emit --native` alone: 0 warnings. With `--native` and `--out` the three warnings about the
  FigJam text (flowchart form, GCP icons, GCP frames) each say "this is about the FigJam text for
  generate_diagram; the native script draws the board", as section 7 of the reference describes.
- Script sizes: GCP 19 842 characters, multi-cloud 27 998; one part each (limit 50 000).
- `use_figma`: GCP `{"section":"2:2","created":88}`, multi-cloud `{"section":"3:2","created":108}`,
  both equal to the item count of the script. Each new section was placed 200 px right of the
  previous one.
- Screenshots (`b-gcp-board*.png`, `b-multi-board*.png`) beside the previews: the Google Cloud
  frame (light grey) with the four-colour Google Cloud mark and "Google Cloud" at its top left;
  the region frame "europe-west1" and the VPC frame "invoicing-vpc" as tinted areas with their
  titles at the top; the blue hexagons of Cloud Run (twice), Pub/Sub, Cloud SQL and Cloud
  Storage with their shadow and white pictograms; the grey Cloud Scheduler disc; the grey
  "application" figure of the payment provider; the monitor of the customer app; the names
  under every icon; all eleven connections on the draw.io routes with their arrow heads, the
  jump arcs where the payment line crosses two lines, and the labels on a ground of the frame
  colour. Multi-cloud: the AWS Cloud frame with its logo, the dashed teal region frame with its
  flag, the green S3 square and pink SQS square with their pictograms, and the two lines from
  the worker across the GCP frames into the AWS frame with "PutObject (IAM user key)" and
  "SendMessage (IAM user key)". No difference from the draw.io pictures seen.

## Scenario C — sequence diagram through `generate_diagram` + overlay: PASS

Run `clinic/diagrams/20261118_booking-cancellation/`. Actor, control, database and plain
participant; a note over two participants; an `alt` with two branches; inside it a
self-message of 94 characters ("Check that the visit starts more than 24 hours from now and
release the slot for other patients"), an async message, two returns.

- `emit --to figjam --out ... --overlay ...`: 742 characters of text, overlay 10 308 characters,
  six warnings, each naming the overlay script (actor, control, database, self-message, alt,
  note). `preview` of the `.mmd` reviewed before the call.
- `generate_diagram` with `fileKey` of the board, `name` = IR title: accepted (no plan prompt,
  since the file exists).
- Overlay with `use_figma`: `createdNodeIds` 19, `removedNodeIds` `["4:47","4:59"]` (the two
  stray arrows of the note row and the self-message row), no `zukai overlay:` error.
- `get_figjam` of `4:2`: four participants (head and foot boxes, lifeline connectors), seven
  messages between participants, each joining the right two, labels as the IR has them.
- Screenshot (`c-seq-board.png`) beside draw.io (`c-seq-drawio.png`): figure above "Patient",
  `«control»` / `«database»` above the names (top and bottom boxes), three activation bars, the
  yellow note over Patient and Booking API, the alt frame with "alt [visit more than 24 h away]",
  the dashed divider with "else [visit within 24 h]", the self-message as a small loop with its
  label wrapped at 200 px into four lines that end just above the next row (finding F8). The
  pre-existing path works with 2.3.0.

## Scenario D — read back with `/zukai-recook`: FAIL (use case read wrong; GCP read blocked)

Use case section (`1:2`), run `clinic/diagrams/20261118_clinic-usecases-board/`, target drawio:

- `extract --figjam-script ... --section "1:2"`, the 4 577-character reader run unchanged with
  `use_figma`; it returned 81 nodes, `next: null`, about 10 KB. Saved exactly, then
  `extract board-uc-1.json`: 18 nodes, 7 edges.
- Kind hints: `flowchart` 17 ("17 boxes joined by arrows"), `class` 5 ("1 inheritance or
  composition end"). No `usecase` hint at all.
- The four stick figures came out as shape `ellipse` (the head), not `actor`.
- The three «include» lines and the «extend» line came out as four nodes of shape `box`
  labelled "«include»" / "«extend»\n[first visit of the patient]", with no edge for any of them.
  The seven unlabelled lines (generalization, six associations) are edges, all marked
  inferred.
- Following the recook rules ("facts that cannot be right: do not guess past them"), the IR
  keeps the actors (outside the frame, joined by plain lines) and drops the four relations,
  listing their texts in `meta.omitted`. `validate`: two `model:` warnings ("Log in", "Pay a
  deposit" reached by no actor). `cover`: `{"units":20,"covered":20,"missing":[]}`. The
  delivered draw.io file lacks every include and extend of the board.

GCP section (`2:2`): the reader call was refused twice by Figma: "You've reached the Figma MCP
tool call limit on the Starter plan. Upgrade your plan for more tool calls" (F3). In place of
the board, the same reader was run on a local stand-in of the Plugin API that runs the native
script and then the reader (`<scratchpad>/e2e-figjam2/figma-stand-in.mjs`). Calibrated on the
use case section, the stand-in gives facts equal to the real board's (same 18 node labels and
shapes, same 7 edges and line ends, same kind hints and warning; only text widths differ). On
the GCP script it gives:

- kind hint `architecture` 60 ("8 service icons", "3 cloud group frames"): right;
- every service icon read as `gcp:<name>` from the group name (`gcp:cloud_run`,
  `gcp:cloud_sql`, `gcp:cloud_pubsub`, `gcp:cloud_storage`, `gcp:scheduled_tasks`,
  `gcp:application`), the three frames as `gcp:google_cloud`, `gcp:region`, `gcp:vpc_network`;
- "Customer app" (draw.io's `networks.monitor`) as `drawio:unknown`; the Google Cloud mark as an
  unlabelled `note` inside the frame;
- 8 of 11 connections as edges; "publish", "push (OIDC)" and the worker's "SQL (private IP)" as
  boxes without ends. Recooked to drawio (`invoicing/diagrams/20261118_invoicing-gcp-board/`,
  facts marked as stand-in): `cover` 23/23, three connections missing from the result, one of
  them with no omission at all because another connection carries the same label.

## Scenario E — `/zukai-revise` and the board: PARTIAL (files PASS, board redraw blocked)

On run `20261118_clinic-booking-usecases`: request "Rename the use case 'Send a reminder' to
'Send an SMS reminder'". Route direct (wording only). `drift` on the combined and the single
file: not drifted, `bundle: {}`. `snapshot` → `r001`. IR label changed, `validate` 0 warnings,
`diff` lists one change with `from`/`to`, `--drawio drafts/changes-r001.diff.drawio` written and
previewed (the use case amber, legend "label was 'Send a reminder'"). Closing contract step 3
rebuilt `drawio/`, the combined file and `figjam/clinic-booking-usecases.native.js` (the run's
figjam file is the native script, so it is written again by `emit --native`; the new script
differs in the ellipse and boundary width and the gateway's place). As the contract says for a
board already drawn, the report would say the board still shows the run before the change and
offer to draw it again; playing the user, "yes". That redraw (one `use_figma` call of part 1,
expected `replaced: 56`) could not be made: the Starter-plan limit of F3. Section `1:2` still
shows "Send a reminder".

## Findings

| Id | Grade | Where | What happened | What was expected |
|---|---|---|---|---|
| F1 | High | `extract` on a board read with `--figjam-script`, board drawn by `emit --native` (use case) | Stick figures read as `ellipse`; the four dashed «include»/«extend» lines (groups of line, arrow head, label background, label) read as `box` nodes without ends; kind hints `flowchart` 17 and `class` 5, no `usecase`. The recooked run lost all four relations and has two `model:` warnings, yet `cover` passed 20/20 | Figures as `actor`, the dashed lines as edges with their labels (`dashed`, open end), a `usecase` hint first (ellipses in a titled frame, figures outside), as `mapping.md` (usecase) assumes |
| F2 | High (stand-in evidence, calibrated on the real board) | the same reader and `extract`, GCP native section | 3 of 11 labelled connections ("publish", "push (OIDC)", worker → Cloud SQL "SQL (private IP)") read as boxes without ends; the recook drops them and `cover` still passes 23/23, the third one unnoticed because another connection has the same label | Every connection of a native board read as an edge; `cover` or the facts warning when a labelled line becomes a node |
| F3 | High (blocked) | Figma MCP, file on a Starter plan; `target-figjam.md`, recook step 1 | After 20 Figma calls (1 `whoami`, 5 skill reads, `create_new_file`, `create_session`, 6 `use_figma`, 4 `get_screenshot`, `generate_diagram`, `get_figjam`), `use_figma` failed twice: "You've reached the Figma MCP tool call limit on the Starter plan." Scenario D (GCP) and the board update of E could not run. The plan was the tester's choice (F4); the skills say nothing about the call budget, while one native diagram costs a script call and a screenshot, a recook one reader call per 45 KB part | The run to fit the plan's budget, or the skill to warn before starting that a Starter-plan board allows only a few calls and that each diagram, read and redraw takes one or two |
| F4 | Medium | `target-figjam.md` sections 3 and 7 | The native route (the only one for use case, class, activity) says "call `use_figma` with the file key of the board", but not how to get a board when the user has none: `generate_diagram` creates its own file, `use_figma` cannot, and `create_new_file` needs a `planKey` that the Figma skill says to ask for when the account has several plans. Section 3 says a board "will be created in their drafts", which the native route never does. Section 4's rule "do not guess a planKey" covers `generate_diagram` only | One line in section 7: with no board, call `create_new_file` (FigJam) after asking the user which plan, or reuse a board key the user gives |
| F5 | Medium | `target-figjam.md` sections 4, 5, 7 vs the Figma server | The Figma server requires `create_session` before any file tool and its `figma-use` skill asks for `skillNames` (with `resource:` when read as a resource) and, for visible changes, the skill `figma-generate-design` too; `target-figjam.md` names only `figma-use` / `figma-use-figjam` / `figma-generate-diagram` and never `create_session` (the recook skill does). Nothing failed without them here, but an agent following the installed text alone skips server instructions | The reference to name `create_session` (once per board) and to defer to the server's own skill list instead of a fixed one |
| F6 | Low | `get_figjam` read-back, `target-figjam.md` section 4 | `get_figjam` lists overlay texts and vectors without their characters (`<text name="zukai-overlay" .../>`, the actor figure missing), so the "read back and compare" step cannot check the overlay; a `use_figma` read was needed | Say that the overlay's texts are checked by screenshot or a read-only `use_figma` call |
| F7 | Low | overlay script, self-message label | The 94-character self-message label is wrapped at 200 px into four lines, 76 px tall in an 80 px row; a label of about 120 characters would run into the next row (draw.io draws it on one line) | The row height, or the wrap width, to follow the label length as notes already do |
| F8 | Low | `emit --to figjam` refusal for `usecase` | The message names `--native`, but the hint says "choose another target with --to" | A hint that names `--native` as the way to a FigJam board |
| F9 | Low | the way scripts and results travel | Every script (10 953, 19 842, 27 998 and 10 308 characters) and the reader's 10 KB result had to be copied by the agent into the tool call / file by hand; the `created` counts (56, 88, 108) matched the scripts, so no copy was corrupted, but nothing checks it | A checksum of the data in the script's return value, compared by the skill, or a note that `created` must equal a number the emit prints |
| F10 | Low | reader / `extract`, GCP native section (stand-in) | "Customer app" (draw.io `networks.monitor`) reads as `drawio:unknown` because its group name carries no stencil; the Google Cloud mark becomes an unlabelled `note` node | The client screen named in its group like the other stencils, the mark folded into its frame |

## Status of processes and files

No long-running process was started (each `preview` ran and exited; `ps` shows none left). Run
folders, facts, board JSON, the stand-in and the screenshots are under
`<scratchpad>/e2e-figjam2/`. The board keeps the four sections listed above; no probe or
leftover node was created.

## Unresolved

1. The board update of scenario E and the real read of the GCP section remain to be run, on a
   board whose plan allows more MCP calls (or after the Starter limit resets).
2. Which plan future test boards should live on is the user's choice (F3, F4).
