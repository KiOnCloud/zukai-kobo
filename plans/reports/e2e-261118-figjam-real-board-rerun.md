# Rerun of the FigJam real-board test (Zukai 2.3.0, round 3)

Date: 2026-11-18 (UTC). Tester: delegated agent. Nothing in the repository was changed except
this file.

## Board

https://www.figma.com/board/eogYZmhMNnhYdRxA95Wdpx is "Zukai e2e 2.3.0 (3)", in the plan
"ai_ccj_dev_admin's team" (`team::1578638650992269373`, Full seat, Pro).

How the board came to exist:

- The plan the user named, "ccj admin", is not among the account's five plans. The first pass of
  this run stopped there.
- The user then confirmed "ai_ccj_dev_admin's team". My own `create_new_file` call was refused
  by Claude Code's local permission check ("[Unsanctioned Communication]"), so it never reached
  Figma.
- The main session created the file on the user's direct confirmation. This run then worked
  only on that board.

No other file of the account was opened, read or changed, and nothing was deleted. The earlier
boards "Zukai e2e 2.3.0" and "(2)" were not touched.

What the board holds now:

| Section | Made by | Content |
|---|---|---|
| `1:2` Clinic booking use cases | `emit --native`, then redrawn after the revision | use case diagram, shows "Send an SMS reminder" |
| `3:2` Invoicing on Google Cloud | `bundle --to figjam --native` (one script) | GCP architecture |
| `3:115` Invoicing on Google Cloud and AWS | the same script | multi-cloud architecture |
| `7:2` Cancel an appointment | `generate_diagram` + overlay | sequence diagram |

## Setup

- Installed commit `3744741bd9a93697f5d0516d73e07b4413d850ae` (branch
  `claude/blissful-noether-5terit`, plugin 2.3.0). It came from `git archive HEAD` into
  `<scratchpad>/e2e-figjam3/src`.
- `clinic` and `invoicing` were copied from `e2e-figjam2`, their skill folders and `diagrams/`
  removed, then installed with `install.sh --target claude-project`. Only the installed copies
  were used. Node 22.23.4.
- `<scratchpad>` = `/tmp/claude-0/-home-user-zukai-kobo/dfd23dcb-7283-57de-90e1-1d422710abbb/scratchpad`.
- Screenshots and draw.io previews are in `<scratchpad>/e2e-figjam3/shots/`. Board reads and
  facts are in `<scratchpad>/e2e-figjam3/tmp/`.
- The run folders were rebuilt from the IRs of the earlier round so that the results compare:
  - the use case IR is the state before the earlier revision ("Send a reminder");
  - the sequence IR has the self-message m4 lengthened to 121 characters.

  Each run went through the closing contract: validate (0 warnings), draw.io emit, bundle,
  preview, and a review by eye (PASS). The architecture runs also had `sources` recorded.
- Figma steps, in order:
  1. `whoami`;
  2. the `figma-create-new-file` skill (before the refused `create_new_file`);
  3. `create_session` with the board key (one session for the whole run);
  4. the skills `figma-use`, `figma-use-figjam` and `figma-generate-design` before the first
     `use_figma`. `figma-use` asks for `figma-generate-design` before any visible change, and
     section 8 of `target-figjam.md` names that case;
  5. `figma-generate-diagram` before `generate_diagram`.

  `skillNames` was passed on every `use_figma` call.
- Call count stated before the first Figma call, as section 8 asks: about 22 (see scenario 5).

## Scenario 1: use case board and recook: PASS

- `emit --to figjam` exits 2. The hint now names the way to a board: "emit --to figjam --native
  <file.js> draws this kind on a FigJam board with use_figma; or choose another target with --to".
- `emit --native`: `calls: 1`, `created: [56]`, 11 221 bytes. `use_figma` with the script
  unchanged returned `{"section":"1:2","created":56,"replaced":0}`, which matches the CLI.
- Screenshot (`s1-uc-board.png`) beside draw.io (`s1-uc-drawio.png`): the same picture. It has:
  - four stick figures with names, and the hollow generalization triangle at "Patient";
  - eight ellipses in the titled boundary;
  - three dashed «include» lines and the dashed «extend» line, with open arrowheads and their
    labels on white (the extend on two lines with its condition);
  - the «system» SMS gateway box.
- Recook, as `/zukai-recook <board link>?node-id=1-2`:
  - `extract --figjam-script ... --section "1:2"`, one `use_figma` call (81 nodes,
    `next: null`), saved, then `extract`.
  - Facts: 14 nodes and 11 edges. The kind hints are **`usecase` 76 first** ("8 ovals, 4 actor
    figures, 4 lines marked «include» or «extend»"), then flowchart 9 and class 5.
  - The four figures read as **`actor`**; the system box reads as `box` with "«system»\nSMS
    gateway".
  - The four dashed lines are edges: `dashed: true`, `endArrow: open`, with their labels. The
    extend line goes Pay a deposit to Book an appointment, the includes from the including use
    case.
  - The generalization is `block-open` from Registered patient to Patient.
  - The single facts warning says all 11 edges were joined by position (inferred).
- Playing the user: kind `usecase` (suggested), overview, technical, `--to drawio`. The IR was
  written from the facts: 5 actors (the gateway as `system`), 8 use cases, 1 boundary, and 11
  relations (1 generalization, 6 associations, 3 include, 1 extend with the condition "first
  visit of the patient").
- `validate`: 0 warnings. `cover`: `{"units":20,"covered":20,"missing":[],"edges":11,"lostEdges":[]}`,
  exit 0.
- Negative check, with each relation dropped from a copy of the IR:
  - without the include Cancel to Log in, `cover` exits 2 with `lostEdges` naming "Cancel an
    appointment" to "Log in", label "«include»";
  - without the association Doctor to View today's appointments, `cover` exits 2 with that edge,
    label "".
- The recooked draw.io (`s1-recook-drawio.png`) matches the original drawing.

## Scenario 2: GCP and multi-cloud boards and recook: PASS

- `bundle --to figjam --native <file> <gcp-run> <multicloud-run>`: one script of 41 047 bytes,
  `calls: 1`, `created: [196]`, `drawings: [2]`. Drawn one diagram at a time, the same two take
  2 calls (88 + 108).
- `use_figma` with the script unchanged returned
  `[{"section":"3:2","created":88},{"section":"3:115","created":108}]`. The sum 196 equals the
  CLI's number.
- One screenshot of the page (`0:1`, 6547×821, `s2-page.png`, cropped locally into
  `s2-gcp-*.png` and `s2-multi-*.png`) showed both sections as in draw.io:
  - the Google Cloud frame with its mark, and the tinted region and VPC frames;
  - the blue hexagons, the grey scheduler disc and the grey payment provider;
  - the monitor of the customer app;
  - all lines with arrowheads, jump arcs and labels;
  - in the multi-cloud section, the AWS frame and the dashed region with S3 and SQS, reached by
    "PutObject (IAM user key)" and "SendMessage (IAM user key)".
- Recook, one reader call per section (`3:2`: 112 nodes; `3:115`: 138 nodes; one part each):

  | Section | Hint | Nodes | Edges | Reads |
  |---|---|---|---|---|
  | GCP | `architecture` 57 | 12 | **11 of 11**, each with its label and a `block` end | every service as `gcp:<name>` (`cloud_run` ×2, `cloud_pubsub`, `cloud_sql`, `cloud_storage`, `scheduled_tasks`, `application`); the three frames as `group` `gcp:google_cloud` / `gcp:region` / `gcp:vpc_network`; **"Customer app" as `client`**; **the Google Cloud mark not a node** (no unlabelled note); Secret Manager as `rounded` |
  | Multi-cloud | `architecture` 77 | 16 | **13 of 13** (the 11 above plus the two AWS lines) | the same, plus `aws:aws_cloud`, `aws:region`, `aws:s3`, `aws:sqs` |

- The IRs were written from the facts. Secret Manager keeps no icon, since `gcp-icons.md` says
  draw.io has no stencil for it.
- `cover` on both:
  - GCP: `{"units":23,"covered":23,"edges":11,"lostEdges":[]}`;
  - multi-cloud: `{"units":29,"covered":29,"edges":13,"lostEdges":[]}`.
- Negative check: without invoice-worker to Cloud SQL "SQL (private IP)", whose label another
  connection also carries, `cover` exits 2 with that edge in `lostEdges`. In round 2 this case
  went unnoticed.
- The recooked draw.io (`s2-recook-invoicing-multicloud-board.png`) matches the original drawing.

## Scenario 3: sequence through `generate_diagram` + overlay, 121-character self-message: PASS

- `emit --to figjam --out --overlay` printed six warnings, each naming the overlay script.
  - The `.mmd` now carries a filler row `n1->>n1: …` right after the long self-message, inside
    the `alt`.
  - The overlay data marks the self-message `"rows":2` and the next row `{"pad":"self"}`.
  - `preview` of the `.mmd` was looked at before sending.
- `generate_diagram` (`fileKey` of the board, `name` = IR title) was accepted.
- Overlay with `use_figma`: 19 created nodes. It removed `["7:47","7:59","7:63"]`, the stray
  arrows of the note row, the self-message row and the filler row. There was no `zukai overlay:`
  error.
- `get_figjam` of `7:2`: 4 participants (head, foot, lifeline), 7 messages between
  participants with the right ends and labels, and the overlay nodes. As section 5 now says,
  the overlay texts appear without characters.
  - Geometry from it: the self-message label is 200×95 at y 544–639. The next message, "Mark
    cancelled", is at y 697.5 (row pitch 80). So the label ends about 58 px above the next
    row's line, inside the row kept free.
- Screenshot (`s3-seq-board.png`):
  - the figure above Patient, «control» and «database» above the names (top and bottom);
  - the three activation bars and the yellow note over Patient and Booking API;
  - the alt frame labelled "alt [visit more than 24 h away]", with the dashed "else [visit within
    24 h]" divider;
  - the self-message loop with its label wrapped into 5 lines, all clear of "Mark cancelled".

## Scenario 4: `/zukai-revise` rename, then the board brought up to date: PASS

- Request: "Rename the use case 'Send a reminder' to 'Send an SMS reminder'". The run was found
  by its label.
- `drift` on the combined and single file: not drifted, `bundle: {}`.
- Route: direct (wording only). `snapshot` → `r001`.
- IR label changed; `validate` 0 warnings.
- `diff`: one `changed` entry with `from`/`to`. `--drawio drafts/changes-r001.diff.drawio` was
  previewed (`s4-change.png`): the use case amber, legend `label was "Send a reminder"`.
  Review: PASS.
- Closing contract step 3 rebuilt `drawio/`, the combined file (`--title "Clinic booking"`,
  since the `bundle` object was empty) and `figjam/clinic-booking-usecases.native.js`
  (`created: [56]`, 11 232 bytes; the ellipse, boundary and section are 36 px wider).
- The contract says a board already drawn keeps the old run. Playing the user, I answered "yes"
  to the redraw offer. One `use_figma` call with the new script unchanged returned
  `{"section":"1:2","created":56,"replaced":56}`: the earlier drawing was replaced in place, in
  the same section.
- Screenshot (`s4-uc-board.png`): "Send an SMS reminder" in the widened ellipse, with the
  boundary and the gateway moved right. Everything else is unchanged.

## Scenario 5: Figma calls compared with the CLI: PASS

20 calls reached the Figma server. The refused `create_new_file` was stopped locally and never
reached it.

| # | Call | Purpose |
|---|---|---|
| 1 | `whoami` | plans |
| 2 | `get_figma_skill` figma-create-new-file | before `create_new_file` (refused locally) |
| 3 | `create_session` | board key |
| 4–6 | `get_figma_skill` figma-use, figma-use-figjam, figma-generate-design | before `use_figma` |
| 7 | `use_figma` | use case native script |
| 8 | `get_screenshot` 1:2 | look |
| 9 | `use_figma` | reader 1:2 |
| 10 | `use_figma` | bundled native script (2 diagrams) |
| 11 | `get_screenshot` 0:1 | one look at both sections |
| 12–13 | `use_figma` | readers 3:2, 3:115 |
| 14 | `get_figma_skill` figma-generate-diagram | before `generate_diagram` |
| 15 | `generate_diagram` | sequence |
| 16 | `use_figma` | overlay |
| 17 | `get_figjam` 7:2 | read-back |
| 18 | `get_screenshot` 7:2 | look |
| 19 | `use_figma` | revised use case native script |
| 20 | `get_screenshot` 1:2 | look |

- What the CLI printed as `calls`:
  - drawing: 1 (use case), 1 (bundle), 1 (revised use case);
  - reading: 1 per `extract --figjam-script` × 3.

  That is 6 `use_figma` calls, plus the overlay script, which `emit` gives no `calls` for: 7.
  This run made exactly 7 `use_figma` calls.
- Every `created` matched (56, 88 + 108, 56), and every reader returned `next: null` with
  `total` equal to the saved node count (81, 112, 138).
- The stated estimate was about 22. The difference is that the board was not made by this run
  (`create_new_file`), plus one page screenshot in place of two, minus nothing: the extra
  `figma-generate-design` read was included.
- Drawn without `bundle`, scenario 2 would have cost one more call.

## Findings of this round

| Id | Grade | Where | What happened | What was expected |
|---|---|---|---|---|
| N1 | Medium (found by reading the code, not run on the board) | recook skill (`--to` defaults to `figjam` for a board) together with the native script's section lookup | A recook keeps the source's title. The native script picks up any section of that name that holds `zukai-native` nodes and replaces its drawing in place (`isOurs` matches by name; scenario 4 showed `replaced: 56` in the same section). So recooking a Zukai-drawn board back to its default target `figjam` would draw over the source section, while the recook skill says the source is never edited. This run avoided it by answering `--to drawio` as the user | The recooked board goes into a section of its own (another name, or a check that the section was not drawn from another run), or the recook skill warns before drawing back onto the board it read |
| N2 | Low | `bundle --to figjam --native` output vs `target-figjam.md` section 7 step 3 | The CLI prints `created: [196]`, one sum per script. The script returns a list with one result per diagram (88, 108). Comparing works by adding up, but the text says to compare "a list of results" with "the number the CLI printed", which leaves the summing to the agent | `created` per diagram for a bundle script (e.g. `[[88,108]]`), or one sentence saying to compare the sum |
| N3 | Low | Figma server skill `figma-use` vs the Zukai scripts | `figma-use` makes `figma-generate-design` mandatory before any mutating call. That skill is a design-system workflow (search libraries, componentize) that does not apply to a script that must run unchanged. Reading it costs one call (12 KB of text), and section 8 already names it as an example. Nothing failed | Section 8 might say that loading such a skill satisfies the server and that its workflow does not apply to the Zukai scripts |

None of the earlier blocking or reading defects came back.

## Status of the earlier findings

| Id | Status | Evidence |
|---|---|---|
| F1 | FIXED | Real board `1:2`: figures read as `actor`; the 4 dashed lines as edges with labels, `dashed`, `open` end; generalization `block-open`; hint `usecase` 76 first; `cover` 20/20 with `lostEdges: []` on 11 edges |
| F2 | FIXED | Real boards `3:2` and `3:115`: 11 of 11 and 13 of 13 connections are edges with labels and ends. `cover` now checks edges, and a dropped "SQL (private IP)" whose label is shared is reported in `lostEdges` (exit 2) |
| F3 | FIXED (text; the Starter limit itself not re-checked) | `target-figjam.md` section 8 gives the call budget, asks for the count before the first call and says what to do on a refusal. Recook step 1 repeats it. The count was stated, and 20 calls ran on a Pro plan without a refusal |
| F4 | FIXED | Section 7 step 0: create the board with `create_new_file` and ask the user for the plan. Following it is what stopped this run until the user named the plan. Section 3 now names the board of section 7 |
| F5 | FIXED | Section 8 names `create_session` first, the skills before tools, `skillNames` with `resource:`, and defers to the server. All were followed without trouble |
| F6 | FIXED | Section 5 step 5 says `get_figjam` lists overlay texts without characters and points to the screenshot or the reader. The `get_figjam` output of `7:2` confirms it (`<text name="zukai-overlay" .../>`) |
| F7 | FIXED | A 121-character self-message in an `alt` gets a filler row in the `.mmd` and `rows: 2` in the overlay. On the board its 5-line label ends about 58 px above the next message |
| F8 | FIXED | The refusal hint names `emit --to figjam --native` |
| F9 | FIXED | The CLI prints `created` and `bytes` per script, and section 7 step 3 says to compare. All four drawings matched. Reader parts carry `total`, which matched the saved nodes. Results are still copied by hand (see N2 for the bundle form) |
| F10 | FIXED | Group names now carry `[client]` and `[part]`. "Customer app" reads as `client` and the Google Cloud mark is folded into its frame (no node) on both architecture sections |

## Processes

No long-running process was started: each `preview` ran and exited. `ps` shows only an MCP PDF
server that was running before this run.

## Unresolved

1. N1: should a recook drawn back to FigJam go into a new section? That is a product decision.
   It was not tried on the board, to keep the source section.
2. The Starter-plan refusal path of section 8 was not exercised: the plan used has no limit.
