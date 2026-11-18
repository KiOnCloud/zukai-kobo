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

## Confirmation of the section marker

Date: 2026-11-18 (UTC). Tester: delegated agent, on the same board,
https://www.figma.com/board/eogYZmhMNnhYdRxA95Wdpx ("Zukai e2e 2.3.0 (3)"). No other file was
opened, nothing was created as a file and nothing was deleted. Nothing in the repository was
changed except this section.

What is being checked: the fix for N1. Native scripts now name every shape
`zukai-native <yyyymmdd>_<run-slug>`. A script draws over a section only when that section holds
shapes of its own run, and otherwise draws into `<title> (2)`, `(3)` and so on.
`bundle --to figjam --native` prints `created` per drawing.

### Setup

- Installed commit `e0282fe43b49f0e43da78f936b02bd7c446c1572` (HEAD of
  `claude/blissful-noether-5terit`, plugin 2.3.0). It came from `git archive HEAD` into
  `<scratchpad>/e2e-figjam4/src`.
- `clinic` and `invoicing` were copied from `e2e-figjam3`, with their installed skills removed.
  They were then installed with `install.sh --target claude-project`. Only the installed CLI was
  used (Node 22.23.4). The installed `cli.mjs` is identical to the repository's.
- `<scratchpad>` = `/tmp/claude-0/-home-user-zukai-kobo/dfd23dcb-7283-57de-90e1-1d422710abbb/scratchpad`.
  - Board reads: `<scratchpad>/e2e-figjam4/tmp/read0.json` and `read-final.json`. The read script
    is `tmp/read-sections.js`.
  - Screenshot: `<scratchpad>/e2e-figjam4/shots/c-page.png`, with crops `c-overview.png`,
    `c-sec-1-2.png`, `c-sec-14-62.png` and `c-sec-16-62.png`.
- The emit results:
  - `emit --to figjam .../20261118_clinic-booking-usecases/source/clinic-booking-usecases.ir.json --native ...`
    gave `calls: 1`, `created: [56]`, 11 887 bytes. Every shape is tagged
    `zukai-native 20261118_clinic-booking-usecases`.
  - Second run folder `20261118_clinic-usecases-recook`: a copy of the first, files renamed to
    the new slug, IR byte-identical (`cmp`). It gave `created: [56]`, 11 886 bytes. Diffed with
    the first script, only `"run"` differs.
  - `bundle --to figjam --native <file> 20261118_invoicing-gcp 20261118_invoicing-multicloud`
    gave `calls: 1`, **`created: [[88,108]]`**, `drawings: [2]`, 41 730 bytes. The runs in
    the script are `20261118_invoicing-gcp` and `20261118_invoicing-multicloud`.
- The call count was stated before the first Figma call: 12, at most 13. Each `use_figma` call
  passed `skillNames`. The drawing calls passed the three skills; the reads passed `figma-use`
  and `figma-use-figjam`.

### What the board held before

The board still held the sections of the earlier round, drawn by a build without run markers.
Their shapes are named plain `zukai-native`.

| Section | Descendants | Shapes tagged | first / last id | Digest |
|---|---|---|---|---|
| `1:2` Clinic booking use cases | 81 | `zukai-native` 56 | 9:88 / 9:141 | `ed09666d` |
| `3:2` Invoicing on Google Cloud | 112 | `zukai-native` 88 | 3:49 / 3:113 | `1873b434` |
| `3:115` Invoicing on Google Cloud and AWS | 138 | `zukai-native` 108 | 3:162 / 3:252 | `577a61af` |
| `7:2` Cancel an appointment | 38 | none | 7:3 / 8:90 | `8a162b18` |

The digest is a hash over id, type, name, x, y, width and height of every descendant, in tree
order.

### Steps

| Step | What ran | Result | Verdict |
|---|---|---|---|
| (a) | the use case script, unchanged | `{"section":"14:62","name":"Clinic booking use cases (2)","created":56,"replaced":0}`. `created` matches the CLI's 56. Placed to the right of everything, at x 8015 | PASS |
| (b) | the same script again, unchanged | `{"section":"14:62","name":"Clinic booking use cases (2)","created":56,"replaced":56}`. Same section id, `replaced` = `created`. The section still has 81 descendants (no empty groups left behind); its shapes now have ids 15:88–15:141 | PASS |
| (c) | the script of the second run folder, unchanged | `{"section":"16:62","name":"Clinic booking use cases (3)","created":56,"replaced":0}`. All 56 shapes are tagged `zukai-native 20261118_clinic-usecases-recook` | PASS |
| (d) | the bundle script, unchanged | `[{"section":"17:62","name":"Invoicing on Google Cloud (2)","created":88,"replaced":0},{"section":"17:175","name":"Invoicing on Google Cloud and AWS (2)","created":108,"replaced":0}]`. Each `created` equals the number at the same place in the CLI's `[[88,108]]`. The old `3:2` and `3:115` were not reused | PASS |

The reads after (c) and after (d) show the same four old sections, unchanged.
`1:2`, `3:2`, `3:115` and `7:2` have the same descendant counts, first and last ids and digests
as before (a). Section `14:62` was not touched by (c) or (d): it keeps 81 descendants, ids
15:88–15:141 and digest `5139ae90`. The new sections have the same structure as the old ones
of the same diagram:

- `16:62`: 81 descendants;
- `17:62`: 112 descendants, 88 tagged `zukai-native 20261118_invoicing-gcp`;
- `17:175`: 138 descendants, 108 tagged `zukai-native 20261118_invoicing-multicloud`.

Screenshot after (c), page `0:1` at 8192 px wide, looked at:

- the old `1:2` is still at the left, and the invoicing and sequence sections follow it;
- `14:62` and `16:62` are side by side at the right;
- both new sections show the whole use case drawing: four actors with the hollow
  generalization triangle at Patient, eight ellipses in the "Clinic booking system" boundary,
  the three dashed «include» lines and the dashed «extend» line with open arrowheads and labels,
  and the «system» SMS gateway box;
- the two new drawings look the same, and the same as the old one.

### Figma calls: 12, as stated

| # | Call | Purpose |
|---|---|---|
| 1 | `create_session` | board key |
| 2–4 | `get_figma_skill` figma-use, figma-use-figjam, figma-generate-design | before `use_figma` |
| 5 | `use_figma` | read before (a) |
| 6 | `use_figma` | (a) use case script |
| 7 | `use_figma` | (b) same script again |
| 8 | `use_figma` | (c) script of the second run folder |
| 9 | `use_figma` | read after (c) |
| 10 | `get_screenshot` 0:1 | look after (c) |
| 11 | `use_figma` | (d) bundle script |
| 12 | `use_figma` | read after (d) |

No call was refused.

### Findings

| Id | Grade | What | Evidence |
|---|---|---|---|
| N1 | FIXED | A script no longer draws over a section of the same title from another run or from an older build. It draws into `<title> (2)`, `(3)` and so on, and it replaces in place only its own run | Steps (a) to (d) above. Old sections unchanged by digest |
| N2 | FIXED | `bundle` prints `created` per drawing (`[[88,108]]`), in the order the script returns its results | Step (d) |
| N4 | Low | The bundle script's data is one line of 33 785 characters. When an agent prints the script to pass it on, the harness cuts the output ("Output too large"). It then has to read the line in slices and join them by hand; here one join fell on a space inside a label (`"SQL (private IP)"`). The per-drawing `created` check would catch a bad join that drops or changes items. It would not catch a changed label text or coordinate. Here the counts matched and the drawings look right | Wrapping the `D` data over several lines (for example one item per line) would let the script be read and passed on without slicing. The per-script `bytes` the CLI prints could also be stated as a check of the text before the call |
| N5 | Low (found by reading the code, not run on the board) | When two sections hold shapes of the same run, the script redraws only the last one in page order (`page.children.filter(isOurs).pop()`). This can happen when a user duplicates a Zukai section in FigJam, since copies keep their names. The other copy keeps the old drawing without a warning | `isOurs` and `.pop()` in every native script. This is probably acceptable; the result's `section` id names the one that was redrawn |

No High or Medium finding.

### Processes

No long-running process was started. `ps` shows only the MCP PDF server that was running
before.

## Confirmation of the script self-check

Date: 2026-11-18 (UTC). Tester: delegated agent, on the same board,
https://www.figma.com/board/eogYZmhMNnhYdRxA95Wdpx ("Zukai e2e 2.3.0 (3)"). No other file was
opened, nothing was created as a file and nothing was deleted. Nothing in the repository was
changed except this section.

What is being checked: every script the CLI writes for `use_figma` now starts with `const D = …`
(written over lines of at most 200 characters) and `const CHECK = [length, hash]`. Before it
touches the board, it turns `D` back into JSON and recomputes the length and an FNV-1a hash
(`figma-script-data.mjs`). The risk was that Figma's JavaScript engine might serialise JSON
differently from Node. If so, every script would throw on a real board.

### Setup

- Installed commit `0c9c5167b7e361e13021f6c82e19f39145aae6a7` (HEAD of
  `claude/blissful-noether-5terit`, plugin 2.3.0). It came from `git archive HEAD` into
  `<scratchpad>/e2e-figjam5/src`.
- `clinic` and `invoicing` were copied from `e2e-figjam4`, with their installed skills removed.
  They were then installed with `install.sh --target claude-project`. The installed `cli.mjs` is
  identical to the repository's (`cmp`). Node 22.23.4.
- `<scratchpad>` = `/tmp/claude-0/-home-user-zukai-kobo/dfd23dcb-7283-57de-90e1-1d422710abbb/scratchpad`.
  - Scripts and reads: `<scratchpad>/e2e-figjam5/tmp/`.
  - Screenshot: `<scratchpad>/e2e-figjam5/shots/page.png`, with crops `sec-14-62.png`,
    `sec-19-312.png`, `sec-21-62.png` and `zoom-extend-label.png`.
- Non-ASCII labels. None of the clinic or invoicing runs has Japanese or Vietnamese text; they
  have only `«»`. The repository fixture `skills/draw/scripts/fixtures/usecase/valid-long-labels.json`
  has both: the title "経費精算", the actor "従業員", "Phê duyệt viên cấp phòng ban và cấp công ty", and
  an «extend» with the condition "承認済みの申請がある". It was copied unchanged into a new run folder,
  `clinic/diagrams/20261118_expense-usecases-ja-vi`. Results:
  - `validate`: 0 warnings;
  - `emit --native`: `created: [32]`.
- The emit results:
  - `emit --native` of the clinic use case IR: `calls: 1`, `created: [56]`, 13 497 bytes,
    `CHECK = [3911, '72377eab']`.
  - `bundle --to figjam --native` of `invoicing-gcp`, `invoicing-multicloud` and the JA/VI run:
    `calls: 1`, `created: [[88,108,32]]`, 46 509 bytes (46 269 characters), 388 lines, the
    longest 200 characters, `CHECK = [36319, '43b87c01']`. Adding the JA/VI run to the
    invoicing bundle kept it at one call and put non-ASCII data inside a bundle.
  - `extract --figjam-script --section "経費精算"`: the section name itself is non-ASCII data,
    `CHECK = [41, '934b7efe']`.
  - `emit --to figjam --out --overlay` of `booking-cancellation`: 6 warnings, all naming the
    overlay script. Overlay `CHECK = [1018, 'd0d69d88']`; its data holds `…` from the filler row.
- In Node, the check block of each script passes. A tampered copy, with "Pay a deposit" changed
  to "Pay a depos1t" in the text item, throws with `3911` and hash `674f37b3`.
- Each script was printed in whole lines (the bundle in three line ranges) and passed to
  `use_figma` without changes. No line had to be sliced.
- The call count was stated before the first Figma call: 14, at most 16.

### Steps

| Step | What ran | Result | Verdict |
|---|---|---|---|
| 1 Native | the clinic use case script, unchanged | `{"section":"14:62","name":"Clinic booking use cases (2)","created":56,"replaced":56}`. No throw. It replaced its own section "(2)" in place, and `created` matches the CLI's 56 | PASS |
| 2 Bundle | the 3-diagram bundle, unchanged | `[{"section":"17:62",…,"created":88,"replaced":88},{"section":"17:175",…,"created":108,"replaced":108},{"section":"19:312","name":"経費精算","created":32,"replaced":0}]`. No throw. Each `created` equals the number at the same place in `[[88,108,32]]`. Both invoicing "(2)" sections were replaced in place; 経費精算 is new | PASS |
| 3 Reader | `extract --figjam-script --section "経費精算"`, unchanged | No throw: 47 nodes, `total` 47, `next: null`, all Japanese and Vietnamese texts back as written. `extract`: 10 nodes, 5 edges, hint `usecase` 37 first. `cover`: `{"units":13,"covered":13,"missing":[],"edges":5,"lostEdges":[]}`, exit 0. See finding S1: the «extend» line came back as a box | PASS (self-check). Reading defect in S1 |
| 4 Overlay | `generate_diagram` (`name` "Cancel an appointment", `.mmd` unchanged), then the overlay script, unchanged | `generate_diagram` was accepted. The overlay did not throw: `section` `21:62` (the newer of the two sections of that title), 19 nodes created, removed `["21:107","21:119","21:123"]`, `replacedNodeIds: 0`. The older `7:2` was untouched (same digest before and after) | PASS |
| 5 Tamper | the clinic script with one character of a label changed | It threw `zukai native: this copy of the script is not the one the CLI wrote: its data has 3911 characters and hash 674f37b3, the CLI wrote 3911 and 72377eab. A character was lost or changed in the copy. Nothing was changed. Pass the script to use_figma again from its file, unchanged.` The figures equal Node's for the same copy. In the reads before and after, all 10 sections have the same descendant counts, first and last ids, and digests: `14:62` is 81 / `18:88`–`18:141` / `ee7afaa` both times. No section was added | PASS |

**JSON in Figma's engine.** The read calls also ran a probe:
`JSON.stringify(["«extend» ↳ 経費精算 Phê duyệt", "  ", "\u0007\u001f\u007f", "\ud800", "😀", "\"\\/", [0.1+0.2, 1e21, 1e-7, -0, 761.88, 2**53+2]])`.
Figma's engine and Node give the same 131 characters:

- non-ASCII, U+2028/2029, DEL and the emoji stay raw;
- `\u0007` and `\u001f` are escaped, and the lone surrogate is written `\ud800`;
- the numbers read `0.30000000000000004`, `1e+21`, `1e-7`, `0`, `761.88` and `9007199254740994`.

So the length and hash the CLI computes are the ones the board computes. This held for
Latin-1, CJK, Vietnamese and `…` in steps 1 to 4.

**Screenshot** (one, page `0:1`, 18 909 × 1 308 at 12 000 px wide), looked at:

- `14:62` shows the whole clinic drawing. It reads "Pay a deposit", not the tampered "Pay a
  depos1t".
- `17:62` and `17:175` show the GCP and multi-cloud drawings as before.
- `19:312` shows the JA/VI use case drawing:
  - the boundary title "経費精算システム (Expense reimbursement system of the whole group)";
  - "出張旅費および交際費の経費精算申請を提出する" wrapped on two lines in its ellipse;
  - "Duyệt yêu cầu hoàn ứng", and "Phê duyệt viên cấp phòng ban và cấp công ty" under its figure;
  - the dashed «include», and the dashed «extend» with "[承認済みの申請がある]" under it;
  - the «system» box.

  Figma sets the CJK glyphs in its fallback face, since Arimo has none.
- `21:62` shows the whole overlay:
  - the actor figure, and «control» and «database» at the head and foot;
  - three activation bars and the yellow note;
  - the alt frame, its "else" divider, and the self-message loop with its 4-line label.

### Figma calls: 14, as stated

| # | Call | Purpose |
|---|---|---|
| 1 | `create_session` | board key |
| 2–4 | `get_figma_skill` figma-use, figma-use-figjam, figma-generate-design | before `use_figma` |
| 5 | `use_figma` | step 1 clinic native script |
| 6 | `use_figma` | step 2 bundle (3 diagrams) |
| 7 | `use_figma` | step 3 reader 経費精算 |
| 8 | `get_figma_skill` figma-generate-diagram | before `generate_diagram` |
| 9 | `generate_diagram` | step 4 sequence |
| 10 | `use_figma` | step 4 overlay |
| 11 | `use_figma` | read before tamper (+ JSON probe) |
| 12 | `use_figma` | step 5 tampered script (threw, as intended) |
| 13 | `use_figma` | read after tamper (+ JSON probe) |
| 14 | `get_screenshot` 0:1 | one look |

No call was refused. One call I made under a wrong tool name was rejected locally and never
reached Figma.

### Findings

| Id | Grade | What | Evidence |
|---|---|---|---|
| — | — | The self-check works in Figma's engine. Native, bundle, reader and overlay scripts with Latin-1, CJK and Vietnamese data pass it on a real board. A one-character change in a label stops the script before anything is read or changed, with the CLI's message and the same hash Node computes | Steps 1–5, JSON probe |
| N4 | FIXED | The 46 KB bundle has no line over 200 characters. It was printed in three whole-line ranges and passed on first try, and the check passing on the board proves the copy was exact | Step 2 |
| S1 | Medium (not the self-check; found on the board) | On a native board, a label of a line that holds CJK text gets a white back narrower than the text itself. «extend» [承認済みの申請がある]: text 117 px wide, back 93 px = the text width measured at creation (89) + 4. The text grows after the script measures it, presumably when Figma sets the CJK glyphs in its fallback face; that cause is a guess. The reader then fails `isBack` (text not inside the back, `extract-figjam.mjs` `drawnKind`), so `extract` reads the whole group as a `box` node "«extend»\n[承認済みの申請がある]" and loses the extend relation (5 of 6 relations come back). `cover` still passes, since it checks only that each text and edge of the facts is in the IR, not that each relation of the IR is in the facts. A recook of such a board would turn the relation into a box without a warning. On the board itself nothing looks wrong (the label sits below the line) | `tmp/read-ja-vi.part0.json` nodes `19:353` and `19:354`; `tmp/facts-ja-vi.json`; `zoom-extend-label.png` |
| S2 | Low | `cover` has no check of IR relations missing from the facts. That is why S1 passes `cover`, and it would also hide any other edge the reader misses | `cover` output in step 3: `edges: 5` checked out of 6 relations |

No High finding.

### Processes

No long-running process was started. `ps` shows only the MCP PDF server that was running
before.

## Confirmation of the label background

Date: 2026-11-18 (UTC). Tester: delegated agent, on the same board,
https://www.figma.com/board/eogYZmhMNnhYdRxA95Wdpx ("Zukai e2e 2.3.0 (3)"). No other file was
opened, nothing was created as a file and nothing was deleted. The only change on the board is
the redraw of the 経費精算 section `19:312` in place.

What is being checked: the fix of the narrow label back (S1 above).

- The native and overlay scripts now record every text they draw with a function that places it,
  and what lies behind it, from the text's current size. After the last drawing, `settle` runs
  when a text holds a character outside Latin. It waits 100 ms at a time and places again each
  text whose size changed. It stops after three quiet rounds, and after 3 s at most. The code is
  shared from `figma-script-data.mjs` as `SETTLE_TEXTS`.
- The reader (`drawnKind`) accepts a second kind of back. It shares a text's row (same top and
  height within 2 px), lies within the text's width, and stands on the line or beside it, no
  farther than its own height. So a board drawn before the fix reads back too.

### Setup

- Installed commit `a663fd25c5ee73f9375897c7a310a593b87e4a7b` (HEAD of
  `claude/blissful-noether-5terit`). It came from `git archive HEAD` into
  `<scratchpad>/e2e-figjam6/src`, and was installed with `install.sh --target claude-project`
  into a copy of `e2e-figjam5/clinic`, whose installed skills had been removed. The installed
  `cli.mjs` is identical to the repository's (`cmp`). Node 22.23.4.
- `<scratchpad>` = `/tmp/claude-0/-home-user-zukai-kobo/dfd23dcb-7283-57de-90e1-1d422710abbb/scratchpad`.
  - Scripts and reads: `<scratchpad>/e2e-figjam6/tmp/`.
  - Screenshot: `<scratchpad>/e2e-figjam6/shots/sec-19-312.png`, with the crop
    `zoom-extend-label.png`.
- Run `clinic/diagrams/20261118_expense-usecases-ja-vi` (the fixture `valid-long-labels.json`):
  - `validate`: 0 warnings;
  - `emit --to figjam --native`: `calls: 1`, `created: [32]`, 13 198 bytes,
    `CHECK = [2476, '51e6f065']`;
  - `extract --figjam-script --section "経費精算"`: `calls: 1`.
- The call count was stated before the first Figma call: 7, at most 9.

### Steps

| Step | What ran | Result | Verdict |
|---|---|---|---|
| 1 Redraw | the native script, unchanged | `{"section":"19:312","name":"経費精算","part":1,"parts":1,"created":32,"replaced":32}`. It replaced its own section in place, and `created` equals the CLI's 32 | PASS |
| 2 Read | the reader script, unchanged | 47 nodes, `total` 47, `next: null` | PASS |
| 3 Widths | the read of step 2 | «extend» [承認済みの申請がある]: text `25:163` box `[16686,238,117,26]`, back `25:162` box `[16684,238,121,26]`. The back is the text plus 2 px on each side and as high as the text. Before the fix the back was 93 px under a 117 px text (`19:353`/`19:354`). «include»: text 48, back 52 (`25:156`/`25:155`) | PASS |
| 4 extract | `extract tmp/read-ja-vi.part0.json` | 9 nodes, **6 edges**, hint `usecase` 42 first ("5 ovals, 2 actor figures, 2 lines marked «include» or «extend»"). The only box is the «system» actor. The extend line: `ExportApprovedExpenseClaimsToAccountsPayable(batch)` → `Duyệt yêu cầu hoàn ứng`, label `«extend»\n[承認済みの申請がある]`, open arrow, dashed. The one warning: every end was taken from where the line stops, as on any native board | PASS |
| 5 cover | `cover tmp/facts-ja-vi.json <run>` | `{"ok":true,"units":13,"covered":13,"missing":[],"edges":6,"lostEdges":[]}`, exit 0. The IR has 6 relations, the facts 6 edges | PASS |
| 6 Old board | the new `extract` on the stored narrow-back read of the previous round (`e2e-figjam5/tmp/read-ja-vi.part0.json`) | 6 edges; `cover`: `edges: 6`, `lostEdges: []`, exit 0 (it was 5 before) | PASS |

What this does not show: the result of the script does not say whether `settle` saw the text grow
during its wait, or whether Figma had the fallback face in this session already and measured
117 px at once. Either way the back on the board is now sized from the text as Figma finally sets
it. The stand-in test simulates the late growth: it fails without the fix.

**Screenshot** (one, section `19:312`, 1 612 × 486), looked at:

- the whole JA/VI drawing, as in the previous round;
- the dashed «extend» with "[承認済みの申請がある]" under the line, whole and readable, with
  nothing cut off;
- «include» over its dashed line, and the boundary title, the wrapped Japanese use case, the
  Vietnamese actor name and the «system» box.

The white back cannot be seen against the white section; its size is in step 3.

### Figma calls: 7, as stated

| # | Call | Purpose |
|---|---|---|
| 1 | `create_session` | board key |
| 2–4 | `get_figma_skill` figma-use, figma-use-figjam, figma-generate-design | before `use_figma` |
| 5 | `use_figma` | step 1 native script |
| 6 | `use_figma` | step 2 reader |
| 7 | `get_screenshot` 19:312 | one look |

No call was refused.

### Findings

| Id | Grade | What | Evidence |
|---|---|---|---|
| S1 | FIXED | On the redrawn board the back is 121 px under a 117 px text. All 6 relations come back, and `cover` checks 6 edges. A board drawn before the fix, with its 93 px back, also reads back with 6 relations | Steps 3–6 |
| S2 | Decided: no check | `cover` does not report IR relations the facts lack. A recook adds some on purpose (`added:` notes are free text, so they cannot be matched to relations reliably). And a relation the reader misses is missing from the facts and from the IR written from them alike, so a reverse check would not have caught this case in a real recook. `skills/recook/SKILL.md` section 4 now has the agent compare the number of edges of each facts page with the relations of its IRs, and account for every difference | `cover` code, recook section 4 |

No new finding.

### Processes

No long-running process was started. `ps` shows only the MCP PDF server that was running
before.

## Exercise of the Starter-plan call limit

Date: 2026-11-18 (UTC). Tester: delegated agent. Board: https://www.figma.com/board/x5akHNd5vZeO6jftzUoSyQ
("Zukai e2e 2.3.0 (2)"), in the Starter plan "ccv_design's team". The user approved using up
the plan's MCP call quota on this board. No file was created, no other file was opened, and
nothing was deleted. Nothing on the board changed in this round.

What is being checked: what section 8 of `target-figjam.md` tells the agent to do when Figma
refuses a call for the Starter-plan limit, followed to the letter on a real board.

### Setup

- Installed release 2.3.1: `git archive origin/main` (`a1ca672`, the same tree as the checkout)
  into `<scratchpad>/e2e-figjam7/src`. It was installed with `install.sh --target claude-project`
  into copies of `e2e-figjam5/clinic` and `e2e-figjam5/invoicing`. Their installed skills and
  `diagrams/` were removed first. Only the installed copies were used. Node 22.23.4.
- `<scratchpad>` = `/tmp/claude-0/-home-user-zukai-kobo/dfd23dcb-7283-57de-90e1-1d422710abbb/scratchpad`.
  The count statement, the call order and the bundle trial are in `<scratchpad>/e2e-figjam7/tmp/`.
- Nine runs, using the IRs of the earlier rounds (`e2e-figjam5`). Each run passed `validate`
  with 0 warnings and got its draw.io file. The drawings were emitted one diagram per script with
  `emit --native`, not bundled. The draw.io and `.mmd` previews were looked at.

  | Run | Route | CLI printed |
  |---|---|---|
  | `clinic-booking-usecases` | native | `calls: 1`, `created: [56]`, 14 420 bytes |
  | `expense-usecases-ja-vi` | native | `calls: 1`, `created: [32]`, 13 206 bytes |
  | `invoicing-gcp` | native | `calls: 1`, `created: [88]`, 23 408 bytes |
  | `invoicing-multicloud` | native | `calls: 1`, `created: [108]`, 31 714 bytes |
  | `clinic-usecases-board` | native | `calls: 1`, `created: [56]`, 14 503 bytes |
  | `clinic-usecases-recook` | native | `calls: 1`, `created: [56]`, 14 419 bytes |
  | `invoicing-gcp-board` | native | `calls: 1`, `created: [88]`, 23 419 bytes |
  | `invoicing-multicloud-board` | native | `calls: 1`, `created: [108]`, 31 720 bytes |
  | `booking-cancellation` (sequence) | `generate_diagram` + overlay | `.mmd` + `.overlay.js`, six warnings, each naming the overlay script |

- The count was stated before the first Figma call, as sections 3 and 8 ask. The statement as
  given:

  > The labels and titles of nine diagrams will be sent to Figma, onto the board you gave,
  > "Zukai e2e 2.3.0 (2)" (x5akHNd5vZeO6jftzUoSyQ). The run takes 17 Figma calls:
  > create_session 1; skill reads 4 (figma-use, figma-use-figjam, figma-generate-design,
  > figma-generate-diagram); use_figma 8 (one native script per diagram); for the sequence
  > "Cancel an appointment" generate_diagram 1, its get_figjam read-back 1 and the overlay
  > script 1; one get_screenshot of the page. The board is on a Starter plan, which allows about
  > twenty calls in a period, and this plan already reached its limit earlier today, so Figma
  > may refuse sooner. You approved using up the quota, so I go on.

### Figma calls

| # | Call | Result |
|---|---|---|
| 1 | `create_session` (board key) | accepted, session `1ee596df-4c22-42da-8866-98e96eff4a1f` |
| 2 | `get_figma_skill` figma-use | accepted |
| 3 | `get_figma_skill` figma-use-figjam | accepted |
| 4 | `get_figma_skill` figma-generate-design | accepted |
| 5 | `use_figma`, `clinic-booking-usecases.native.js` unchanged | **refused** |
| 6 | `get_figjam` 0:1, a read-only check the test asked for (the installed text says to stop) | **refused** |

The refusal, word for word, the same for both calls:

> You've reached the Figma MCP tool call limit on the Starter plan. Upgrade your plan for more
> tool calls: https://www.figma.com/files/team/1578627207917969059/all-projects?upgrade=mcp_rate_limit_paywall
> Use the whoami tool for more plan details. Learn more: https://developers.figma.com/docs/figma-mcp-server/rate-limits-access/

After call 5 no further drawing call was made. Call 6 was the tester's single check of whether
the board could still be read. It was refused as well, so the board could not be checked.

### The report given, following section 8

> Figma refused the call to draw: "You've reached the Figma MCP tool call limit on the Starter
> plan." I have stopped calling Figma.
>
> - Ran: none of the nine drawing scripts. Before the refusal Figma accepted `create_session`
>   and the three skill reads. Those change nothing on the board.
> - Did not run, in this order:
>   - `clinic-booking-usecases.native.js` (56)
>   - `expense-usecases-ja-vi.native.js` (32)
>   - `invoicing-gcp.native.js` (88)
>   - `invoicing-multicloud.native.js` (108)
>   - `clinic-usecases-board.native.js` (56)
>   - `clinic-usecases-recook.native.js` (56)
>   - `invoicing-gcp-board.native.js` (88)
>   - `invoicing-multicloud-board.native.js` (108)
>   - for "Cancel an appointment": `booking-cancellation.mmd` through `generate_diagram`, then
>     `booking-cancellation.overlay.js`
> - Nothing is half-drawn. Each native script is a single part and none of them ran. The
>   sequence was not started.
> - The refused call changed nothing on the board.
> - To go on: once the limit resets, or on a board of a plan that allows more calls, run the
>   scripts from the run folders, unchanged and in the order above.
> - The draw.io files are delivered all the same: `drawio/<slug>.drawio` in each of the nine
>   run folders.

### Board state

- No drawing call ran, so this round added nothing. A refused call returns the error before its
  script is executed.
- It could not be confirmed on the board: the one read (`get_figjam`) was refused too.
- From the first report, the board still holds what round 1 drew: `1:2`, `2:2`, `3:2` and `4:2`.
  These were not re-read.
- No section of this round exists, so none is half-drawn.

### Verdict: PASS

- **Acting without guessing.** Section 8 was enough. Stop calling Figma; report what ran and what
  did not; say that the refused call changed nothing; say how to resume. The refusal came at the
  first drawing call, not midway, and the same rules covered it.
- **Saying precisely what ran.** The CLI's per-script `calls` and `created` made it possible to
  list each script with its expected count. The `created` comparison itself was not exercised,
  since no script ran.
- **Nothing left unreported.** Nothing was written to the board.
- **Not exercised:** a refusal after some scripts ran, and a multi-part drawing left incomplete.
  None of the scripts is over 50 000 characters, and the very first `use_figma` was refused.

### Findings

| Id | Grade | What | Evidence |
|---|---|---|---|
| L1 | Low | Section 8 says that "every tool call to the Figma server counts" and that the limit is "about twenty". In this round, `create_session` and three skill reads were accepted, then `use_figma` and `get_figjam` were refused. Either those four calls are not limited, or exactly four calls were left. So the stated count (17) could not predict where the refusal lands. The refusal rule still works, because it is keyed on the refusal, not on the count. Suggested wording: the count is an upper bound, and a refusal can come at any call | Calls 1–6 |
| L2 | Low | The refusal message invites "Use the whoami tool for more plan details", while section 8 says to stop calling Figma. "Once the limit resets" gives the user no time. Not calling `whoami` was the literal reading. The text could say that `whoami` is also a call, and that the reset time is shown in the plan's settings | Refusal text |
| L3 | Low | The resume step says to run the remaining scripts unchanged. On a limited plan, `bundle --to figjam --native` over the remaining runs costs fewer calls. Measured: 3 calls instead of 8 (clinic runs `calls: 1`, `created: [[56,32,56,56]]`; invoicing runs `calls: 2`, `created: [[88,108],[88,108]]`). Section 8 already says "draw with the fewest scripts", but the resume step does not repeat it | `<scratchpad>/e2e-figjam7/tmp/*-bundle.js` |

No High or Medium finding. The repository was not changed apart from this section.

### Processes

- No long-running process was started.
- `preview` left two `chrome-headless` zombies under PID 1 for a moment. They were gone at the
  final check.
- `ps` shows only the MCP PDF server that was running before.

## Midway refusal with a multi-part diagram (refusal simulated)

Date: 2026-11-18 (UTC). Tester: delegated agent. Board: https://www.figma.com/board/eogYZmhMNnhYdRxA95Wdpx
("Zukai e2e 2.3.0 (3)", plan "ai_ccj_dev_admin's team", Pro, no monthly limit). No file was created,
no other file was opened, and nothing was deleted.

What is being checked: what section 8 of `target-figjam.md` tells the agent to do when Figma refuses
`use_figma` for the Starter-plan limit **after** some drawing scripts ran, with the refusal falling
between part 1 and part 2 of one diagram; then whether the resume path it gives leaves a clean board.

**The refusal was simulated.** The user's Starter plan (20 MCP calls a month) is spent until next
month, so a real midway refusal cannot happen this month. The board work is real and was done on a
Pro board. Before the first call N = 3 was fixed: the third drawing `use_figma` call was **not sent**
and was treated as having returned Figma's message word for word ("You've reached the Figma MCP tool
call limit on the Starter plan. Upgrade your plan for more tool calls: ... Use the whoami tool for
more plan details. Learn more: ..."). From there on, the installed text was followed as an agent
would follow it.

### Setup

- Installed release 2.3.2: `git archive origin/main` (`42ff413`) into `<scratchpad>/e2e-figjam8/src`,
  then `install.sh --target claude-project` into copies of `e2e-figjam7/clinic` and
  `e2e-figjam7/invoicing`. Their installed skills and `diagrams/` were removed first. Only the
  installed copies were used. Node 22.23.4.
- Four new run folders, so that no section of the earlier rounds could be drawn over (the script
  draws over a section only for the same run). Each got its draw.io file and its native script,
  one per diagram, with `emit --native`. The draw.io previews were looked at.

  | Run | IR | CLI printed |
  |---|---|---|
  | `clinic/diagrams/20261118_midway-usecases` | clinic use cases | `calls: 1`, `created: [56]`, 14 412 bytes |
  | `clinic/diagrams/20261118_midway-large-flow` | flowchart, 150 steps | `calls: 2`, `created: [560, 188]`, 49 956 + 26 514 bytes |
  | `invoicing/diagrams/20261118_midway-gcp` | GCP architecture | `calls: 1`, `created: [88]`, 23 405 bytes |
  | `invoicing/diagrams/20261118_midway-multicloud` | GCP + AWS architecture | `calls: 1`, `created: [108]`, 31 711 bytes |

- The multi-part diagram: the fixture `flowchart/large-50-nodes.json` fits one call (28 346 bytes,
  `calls: 1`), and so does a 100-step copy (46 781 bytes). Three copies of the fixture chained into
  one 150-step flowchart split into two parts. None of the 24 architecture fixtures splits either
  (largest: `valid-multi-cloud.json`, 40 132 bytes). The 150-step IR validates with 28 model warnings
  (one-way decisions and size), as the fixture does.
- Count stated before the first Figma call: 10 calls (create_session 1; skill reads 3, `figma-use`,
  `figma-use-figjam`, `figma-generate-design`; `use_figma` 5, two of them for the 150-step flowchart;
  one `get_screenshot`), with the note that the count is an upper bound.
- `<scratchpad>` = `/tmp/claude-0/-home-user-zukai-kobo/dfd23dcb-7283-57de-90e1-1d422710abbb/scratchpad`.
  Call log, count statement, report given and board reads: `<scratchpad>/e2e-figjam8/tmp/`;
  screenshot and crops: `<scratchpad>/e2e-figjam8/shots/`.

### Figma calls

| # | Call | Result |
|---|---|---|
| 1 | `create_session` (board key) | session `48e217c8-3959-44de-b1c1-0f8dfd00bd12` |
| 2–4 | `get_figma_skill` figma-use, figma-use-figjam, figma-generate-design | accepted |
| T1 | `use_figma`, a read-only count of sections and shapes per run (tester's check) | 10 sections, none of a `midway-*` run |
| 5 | drawing call 1: `midway-usecases.native.js` | section `29:122` "Clinic booking use cases (4)", `created` 56 (CLI 56) |
| 6 | drawing call 2: `midway-large-flow.native.js`, part 1 of 2 | section `30:122` "Large process with 150 steps", `created` 560 (CLI 560) |
| 7 | drawing call 3 = N: `midway-large-flow.native.2.js`, part 2 of 2 | **not sent; treated as refused** (simulated) |

After call 7 no Figma call was made for the refused round, `whoami` included, as section 8 says.

### The report given, following section 8

> Figma refused the drawing call for "Large process with 150 steps", part 2 of 2: "You've reached
> the Figma MCP tool call limit on the Starter plan." I have stopped calling Figma (I did not call
> whoami).
>
> - Ran, in order:
>   - `midway-usecases.native.js`: section 29:122 "Clinic booking use cases (4)", created 56 (the
>     CLI said 56). Complete.
>   - `midway-large-flow.native.js` (part 1 of 2): section 30:122 "Large process with 150 steps",
>     created 560 (the CLI said 560).
> - **Incomplete on the board:** "Large process with 150 steps" (section 30:122). Part 1 ran, part 2
>   (`midway-large-flow.native.2.js`, 188 shapes, lines and texts) did not: the section holds steps
>   1–150 but only the lines up to step 87; the lines from step 87 to step 150 are missing.
> - Did not run, in this order: `midway-large-flow.native.2.js` (part 2, refused);
>   `midway-gcp.native.js` (88); `midway-multicloud.native.js` (108).
> - The refused call changed nothing on the board.
> - How to go on: once the limit resets (Figma gives no time in the message; its rate-limit page and
>   the plan's settings say when), or on a board of a plan that allows more calls, run the remaining
>   scripts from the run folders, unchanged and in order. On a limited plan, first emit the two
>   diagrams that did not run again as one script (`bundle --to figjam --native <run.js>
>   invoicing/diagrams/20261118_midway-gcp invoicing/diagrams/20261118_midway-multicloud`), and draw
>   "Large process with 150 steps" whole by running its parts again from part 1 (part 1 replaces what
>   it drew before). That is 3 calls: parts 1 and 2, then the bundle.
> - The draw.io files are delivered all the same: `drawio/<slug>.drawio` in each of the four run
>   folders.

Which content is in which part was read from the script data (all 150 steps and the lines up to
step 87 are in part 1); the CLI's `created` gave the count of what is missing (188).

### Resume on the board (the quota "came back")

The bundle of the two diagrams that did not run: `calls: 1`, `created: [[88, 108]]`, 44 621 bytes,
written to `invoicing/diagrams/midway-resume.native.js`.

| # | Call | Result |
|---|---|---|
| T2 | read-only count (tester) | 12 sections; `29:122` 56 shapes; `30:122` 560 shapes (partial) |
| 8 | part 1 again | `30:122`, `created` 560, `replaced` 560 |
| 9 | part 2 | `30:122`, `created` 188 (CLI 188), `replaced` 0 |
| 10 | the bundle | `[{section 34:122 "Invoicing on Google Cloud (3)", created 88}, {section 34:235 "Invoicing on Google Cloud and AWS (3)", created 108}]` (CLI `[[88, 108]]`) |
| T3 | read-only count (tester) | see below |
| 11 | `get_screenshot` of the page (8192 px) | `shots/board-after-resume.png` |

Board after the resume (T3), against the read before it (T2):

| Section | Before | After |
|---|---|---|
| the ten sections of the earlier rounds | counts as at T1 | unchanged |
| `29:122` Clinic booking use cases (4) | 56 | 56, untouched |
| `30:122` Large process with 150 steps | 560, lines missing from step 87 on | **748 = 560 + 188**, one section |
| `34:122` Invoicing on Google Cloud (3) | absent | 88 |
| `34:235` Invoicing on Google Cloud and AWS (3) | absent | 108 |

In `30:122`: 320 groups, which is the number of cells (150 steps, 6 lanes, 164 lines); 150 distinct
step labels, none twice; no group name twice apart from the repeated edge labels "yes" (24) and
"no" (15); no shape outside a group. So the incomplete diagram was completed exactly once, with no
leftover partial drawing and no second section. The screenshot, looked at in crops
(`shots/crop-large-flow.png`, `shots/crop-top-new.png`): the flow runs whole from step 1 to step
150 with every line, and the two bundled architectures are drawn beside it.

### Verdict: PASS, with one Medium finding

- **Acting without guessing.** Stopping and the report were fully covered: stop, no `whoami`; list
  what ran with section ids and `created`; name the incomplete diagram; say that the refused call
  changed nothing; say how to go on, with the bundle advice. The resume step left a choice (M1).
- **Saying precisely what ran.** `calls` and `created` per part matched every result (56, 560, 188,
  [88, 108]), so the report could say exactly what ran and how much of the split diagram is missing.
- **Nothing half-drawn left unreported.** The incomplete section was named with its id.
- **Clean board after the resume.** Yes (above).

### Findings

| Id | Grade | What | Evidence |
|---|---|---|---|
| M1 | Medium | For an incomplete multi-part diagram the resume step gives two readings and leaves a third open. "Run the remaining scripts ... in order" means part 2 alone, which would complete the diagram: the refused call changed nothing and part 2 draws into the section part 1 made. "Drawn whole by running its parts again from part 1" costs one more call. And "emit the diagrams that did not run again as one bundle" does not say whether a partly drawn diagram counts; `bundle` also splits it differently (`[[569], [179, 88], [108]]` with the three diagrams, against `[560, 188]` from `emit`). On a limited plan this changes the cost: part 2 alone plus the bundle of two is 2 calls; the path tested here (parts 1 and 2, then the bundle) is 3. Suggested wording: when the board was not changed since, running the parts that did not run is enough; running from part 1 is the safe choice when unsure; the bundle takes only diagrams none of whose parts ran | calls 6–10; CLI probe of `bundle` with the 150-step run |
| L1 | Low | Where to keep the resume bundle is not said. The run folders hold per-diagram scripts, and a bundle of the remaining diagrams can span run folders (here two). It was written to `invoicing/diagrams/midway-resume.native.js` | step 6 |
| L2 | Low | To say what is missing on the board, the agent has to read the script data; the CLI prints how many items each part draws, not what. Naming the diagram incomplete, which section 8 asks, needs no more; a one-line summary per part (for example "steps and lines up to step 87") would make the report concrete | report above |
| L3 | Low | Part 1 ends with an empty group marker (`["[","...:p1e37"],["]"]`) that creates nothing, and part 2 opens that group again. Harmless: no empty or duplicate group on the board | `midway-large-flow.native.js`, T3 |
| L4 | Low | The 50-node flowchart fixture does not split (28 346 bytes), nor does any architecture fixture. A test of the multi-part path needs a larger diagram (here 150 steps); a fixture that splits would make this repeatable | step 3 |

No High finding. The repository was not changed apart from this section.

### Processes

- No long-running process was started. `preview` ran four times and left no `chrome` process.
- `ps` shows only the MCP PDF server that was running before.
