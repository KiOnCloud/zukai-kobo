# Round 4: closing verification of the final state (Zukai 2.0.4)

Run on 2026-11-11 (UTC) with Node and the Playwright/Chromium renderer (`drawio-web`,
`mermaid-web`). Every item was checked again from scratch, by running the CLI or by reading the
shipped text; skill behaviour was read as a runtime without `AskUserQuestion` and without
subagents. Figma was treated as not connected, no external tool was called and git was not used.

All scratch files are under
`/tmp/claude-0/-home-user-zukai-kobo/d18c1f21-fd55-4bdd-a991-536a40188c82/scratchpad/r4/`
(written `r4/` below); the user's project is `r4/proj`. `CLI` stands for
`node /home/user/zukai-kobo/skills/draw/scripts/bin/cli.mjs`. The input IRs of round 3 were
copied into `r4/` (JSON inputs only); every output, run history and image was produced again.

## Result

All 37 items pass, and so do the extra checks. Five low findings remain; none of them is one of
the 37 defects coming back. Item 37 now passes in both cases: nothing is drawn across a frame
line and every name that wraps is named in a `layout:` warning.

## Items 1 to 37

| # | Verdict | Evidence |
|---|---|---|
| 1 | PASS | `CLI bundle --to drawio --canvas all --out <run>/refund-approval.drawio <run>` on `r4/proj/diagrams/20261111_refund-approval` (five IRs, ids of 45 and 54 characters) wrote six `<diagram>` elements: `canvas` and the five full names, all different, with no repeated cell id on any page. `CLI drift <run>/refund-approval.drawio <run>` answered `"drifted":false` with `changes: []` on all six pages. |
| 2 | PASS | The same call printed `"order":["refund-approval","refund-approval-business","refund-approval-01-check-eligibility","refund-approval-02-gateway-refund-via-payment","refund-approval-02-gateway-refund-via-payment-business"]`. `closing-contract.md:35-42` prescribes `bundle … <run-folder>` and explains why `source/*.ir.json` gives the wrong order. |
| 3 | PASS | `CLI emit --to mermaid r4/i3/hub.ir.json` (one hub, 60 others): exit 0, `flowchart` text with 60 connections, two warnings (`size: 61 components…` and `layout: architecture-beta cannot place this diagram…`), no stack trace. |
| 4 | PASS | `CLI diff r4/i4/a.ir.json r4/i4/b.ir.json` (m1 and m2 swapped): `"differs":true … "reordered":[{"collection":"messages","moved":[{"id":"m1","label":"Đặt hàng","after":"m2"}]}]`. |
| 5 | PASS | Run `r4/proj/diagrams/20261111_undo` at S3 (r001 = S1, r002 = S2). `restore <run> undo`, `undo`, `redo`, `redo`, `undo` left the IR label at S2, S1, S2, S3, S2. A further `undo` gave S1 and the next failed with `nothing earlier to go back to`, exit 1. `skills/revise/SKILL.md:199-200`: "Never work the target out from the list yourself: pass the word." |
| 6 | PASS | `skills/draw/SKILL.md:220` ("hand the user the `figjam` text to paste, as section 5 of the reference says (never the `mermaid` text)"), `target-figjam.md:78-91` ("the output of `emit --to figjam`, never of `emit --to mermaid`") and `README.md:148` ("you get the FigJam text to paste into the board yourself") agree. |
| 7 | PASS | `skills/revise/SKILL.md:147-148`: Consult takes a change of structure that has to be carried into a `ref` part or a `-business` view; "A change of wording only (a label, a title, a guard) is always direct, in however many parts and views the same wording appears". |
| 8 | PASS | `skills/draw/SKILL.md:26-28` says one command, `preview`, reaches the network and every other command works offline. The only other "never touch the network" sentences are correct as limited: `README.md:213` (validating and emitting) and `docs/install.md:135` (the installer). |
| 9 | PASS | `install.sh --target codex --dest r4/inst1`: fresh install created only `.agents/skills/zukai` and `zukai-revise`; the second run printed `zukai 2.0.4 already up to date` and created nothing. In `r4/inst2` (version marker set to 1.0.0, `SKILL.md` changed, plus `skills/zukai.bak-20260101000000`) the run moved both to `.agents/zukai-backups/zukai-20260101000000` and `zukai-20261111150007`; `skills/` then held only `zukai` and `zukai-revise`, and only one `SKILL.md` under `skills/` has `name: zukai`. |
| 10 | PASS | `variants.md:35-46`: a table with a rule each for `architecture`, `er` and `class`, and the rule for `both` in a run of several kinds ("technical only", with the reason). |
| 11 | PASS | "Which view?" stands in `SKILL.md:116`, `brainstorm-protocol.md:12`, `variants.md:64` and `agents/diagram-brainstorm.md:19`. "who will read" is left only as an explanation of the word audience (`brainstorm-protocol.md:10`), not as a question. |
| 12 | PASS | `SKILL.md:36-52`: a mode misspelt by a letter or two is named in one line and used (36-38); no arguments asks first what the diagram should show (39-42); `--kind gantt` and `--to pdf` fix nothing, the existing values are named and the question is asked, with "Which target?" for an unknown `--to` (43-49); such a value is never passed to the CLI (51-52). The text path lists the target question too (`SKILL.md:144-145`). |
| 13 | PASS | `CLI drift <run>/mm.md <run>` on `r4/proj/diagrams/20261111_mm`: `"drifted":false,"target":"mermaid" … "bundle":{"title":"Thanh toán \"nhanh\""}`. After one label was changed by hand in `mm.md`: `"drifted":true` and `{"diagram":"mm-01-pay","changes":[{"cell":"(text)","change":"edited"}]}`. `skills/revise/SKILL.md:136-139` tells the agent to use it. |
| 14 | PASS | `skills/revise/SKILL.md:69-76`: a path that is not a run is an error naming the path and what is missing, the runs are listed, no fallback; with several runs in the conversation the request has to point at one, otherwise the user is asked, "the most recent one is not a default". |
| 15 | PASS | `skills/draw/SKILL.md:3` ("activity with swimlanes") and `.claude-plugin/plugin.json:4,7` (description, keywords `activity`, `swimlane`). |
| 16 | PASS | `SKILL.md:205-212`: the kind question is still asked and offers `class` first, `flowchart` second, `architecture` third, each with its consequence. `SKILL.md:146-148`: the text path lists all seven kinds, those three first and in that order. |
| 17 | PASS | Six IRs in `r4/i17` (`password=`, `mật khẩu=`, `パスワード=` and the same with `: `, value [redacted]): `emit --to drawio`, `mermaid`, `figjam` and `bundle --to drawio`, `mermaid` all exit 2 with `refusing to emit for <target>`, write no file, and a search for the value in every output found 0 hits (the message shows `pass…(21 chars)`). `Gọi 0912345678` and an address at `congty.vn` or `gmail.com`: exit 0 with one `personal-data` warning for drawio, mermaid and both bundles; exit 2 and no file for figjam. |
| 18 | PASS | `CLI validate` in `r4/i18`, each exit 0: `model: decision "d" has one way out`, `model: "orphan" is connected to nothing`, `model: no initial state`, `model: return "m1" from "s" to "u" comes before any call`, `model: entity "order" has a foreign key ("customer_id") but takes part in no relation`; with an initial state added, `state "c" is never reached from the initial state`. |
| 19 | PASS | `CLI relabel orders.drawio --map map.json --out orders.en.drawio` (one key): stderr holds one line, `7 labels kept their text: "Khách gửi giỏ hàng", … and 2 more`. |
| 20 | PASS | `r4/i20/hand.drawio`: box `orders:backorder` moved by hand (x 182 to 259), then `orders:pay` relabelled in place and the IR changed to match: `drift` lists only `{"cell":"orders:backorder","change":"moved"}` with `relabelled:1`. The second case as specified: `CLI drift orders.en.drawio orders-en.ir.json` answers `"drifted":false,"relabelled":1`, `changes: []`. |
| 21 | PASS | Run `r4/proj/diagrams/20261111_orders`: r001 taken with `--extra drawio/orders.drawio`; the sixth snapshot printed `"removed":["r001"],"keptExtras":["history/extras/r001/drawio/orders.drawio"]`, and that file exists. |
| 22 | PASS | `closing-contract.md:46-50` has `preview` run on each file and on the combined file. `CLI preview <run>/mm.md` rendered two blocks (`mm-d1.png`, `mm-d2.png`). A seven-diagram canvas (`r4/i22/wide.drawio`, `--max-px 1600`) came back as seven tiles of 1538 px width and heights 1264, 1353, 1353, 1048, 502, 462, 898; the two opened tiles end at the drawing. |
| 23 | PASS | `CLI preview r4/i23/x.drawio` wrote `/tmp/zukai-preview/x-drawio-ef676c0e.png`, `preview r4/i23/x.mmd` wrote `/tmp/zukai-preview/x-mmd-90a3037a.png`, and a second call on `x.drawio` gave the first path again. These three calls wrote to the system temp folder. |
| 24 | PASS | `--out --allow-sensitive`: `option --out needs a value, but "--allow-sensitive" follows it`, exit 1, no file written. `--out` last: `option --out needs a value`, exit 1. `--to pdf`: `unknown target "pdf"`, exit 1. `--help` and `emit --help` print the usage, exit 0. |
| 25 | PASS | `r4/i25/a.ir.json`: two `detail:` warnings (three stores of one kind; `"c0" ("POST /redeem") reads as an endpoint path`). `b.ir.json` with two `detail accepted:` notes quoting `"orders"`, `"payments"`, `"audit"` and `"c0"`: 0 warnings. `c.ir.json` with a fourth store never accepted: the stores warning returns. |
| 26 | PASS | `CLI snapshot` on a run with an empty `source/`: `no IR files in …/source; nothing to snapshot`, exit 1, no `history/` created. |
| 27 | PASS | A 200-node flowchart: `size: 200 nodes in one diagram; a reader follows about 15 to 20…` on `validate` and on `emit`. |
| 28 | PASS | `SKILL.md:124-130`: `both` "doubles the run: with `detailed` and two parts that is six diagrams", the option's description says so, the number is stated before the IRs are written, and `business` alone is suggested when the request holds no technical names. |
| 29 | PASS | The installed copy is 2,397,266 bytes in 19 files (both `SKILL.md`, the references, `scripts/bin/cli.mjs`, `scripts/package.json`, `scripts/src/feature-matrix.json`, two version files); no tests, fixtures or sources. `docs/install.md:141` says "about 2.3 MB". The installed CLI validated a fixture, emitted the AWS architecture to draw.io with 7 AWS shapes, rendered it, emitted Mermaid and refused a class diagram for figjam with the proper message. |
| 30 | PASS | `r4/i30/arch.ir.json` (two nested boundaries, a 60-character label, two `ref`s) is emitted as a flowchart with `layout: architecture-beta cannot place this diagram without overlaps ("queue" would be drawn inside boundary "vpc")`. In `arch.png` the VPC frame lies inside the account frame, each holds only its members, and the long label and the slugs wrap at spaces and hyphens. See findings 1 and 2. |
| 31 | PASS | `r4/i31/fc-LR.png` and `fc-TB.png` (two decisions, "Yêu cầu sửa mã đơn" leading back to "Nhập mã đơn hàng"), 0 warnings: the start node is on the line of the main flow, and each "có" and "không" stands on a stretch that belongs to one branch only. |
| 32 | PASS | `r4/i32/er-LR.png`: the two relations into the row `party_id` end in two crow's feet one above the other. `er-TB.png`: the two relations into "Đơn hàng" from above arrive about 100 px apart. |
| 33 | PASS | `r4/i33/merge.png` (one lane; "Từ chối, nêu lý do" goes to a merge two rows below that two others share): a straight line down and into the merge, no detour, 0 warnings on emit. `guard.png`: the guard "đủ" stands on the branch's own horizontal stretch, before the unguarded flow from "Sửa thông tin" joins. |
| 34 | PASS | In the bundle of item 1 the step whose part has the same title, and the business step whose part is titled "Hoàn tiền qua cổng (nghiệp vụ)", carry `label="Hoàn tiền qua cổng"` (four cells: two pages and their canvas copies), which `bundle.png` shows as one line; the Mermaid bundle writes `n2[["Hoàn tiền qua cổng"]]`. A part with another title still gives two lines. In the single emit (`single.png`) the slug wraps inside the subroutine, clear of both side bars. |
| 35 | PASS | `r4/i35/nb.png` (TB, "Brand" in the same row) and `cls.png` (LR): the self-relation label stands clear of every other class. See finding 3 for the cardinality. |
| 36 | PASS | `after: "b1"` (an `alt` block): the Mermaid text has `Note right of n2: …` after `end`, and both `seq-mmd.png` and `seq.png` (draw.io) show the note below the frame. |
| 37 | PASS | (a) Without frames: `flat2.ir.json` relabelled to names about twice as wide (label widths 85 to 149, 69 to 121, 65 to 113, 69 to 117, 47 to 123 px) and `flat.ir.json` with the long names of round 3 (up to 200 px): `relabel` prints `"warnings":0`, and in `flat2.ja.png` and `flat.ja.png` every name is on one line and none lies on a connection. (b) Inside VPC and AWS Cloud (`aws.ir.json`, `labels.ja.json`): `relabel` prints four `layout:` warnings, `the new label wraps to 2 lines below its shape, where the layout left room for 1`, for `aws:alb`, `aws:api`, `aws:db` and `aws:worker`. In `aws.ja.png` and the enlarged crops exactly those four names take two lines, the other two take one, and no name crosses a frame line. See finding 5. |

## Extra checks

| Check | Verdict | Evidence |
|---|---|---|
| Version 2.0.4 | PASS | `.claude-plugin/plugin.json:3` and `skills/draw/scripts/package.json:3` say `2.0.4`. |
| Existing features | PASS | `emit --to drawio` and `--to mermaid` exit 0 for `sequence`, `flowchart`, `state`, `er`, `class`, `architecture` (`valid.json`) and for `activity/valid-two-lanes.json`; Mermaid prints one degradation warning each for class, architecture and activity. `preview` rendered `fx/sequence.drawio` and `fx/state.mmd` (exit 0, one file each). |

## Findings

1. **Low. `architecture-beta` still breaks a `ref` slug inside a word when the diagram has no
   boundary.** `skills/draw/scripts/src/emit-mermaid.mjs:412` (`ARCH_LABEL_MAX`; the check
   behind the fallback at line 60 covers labels in a boundary only). Repro:
   `CLI emit --to mermaid skills/draw/scripts/fixtures/architecture/valid-ref-parts.json`
   stays `architecture-beta`; `r4/i30/fx.png` shows "order-sync-02-st / ore" and
   "order-sync-01-lo / ad". The only warnings are the two dropped connection labels.
2. **Low. In the flowchart fallback one connection is drawn through a node.** In
   `r4/i30/arch.png` the connection from the API to "SQS orders" enters "Worker giao hàng" on
   the left and leaves it on the right, so it reads as API to worker to queue. This is
   Mermaid's own routing of `r4/i30/arch.mmd`; the CLI prints no warning for it
   (`emit-mermaid.mjs:60` is the fallback).
3. **Low. Class self-relation: the far cardinality touches the label.** In `r4/i35/nb.png`
   the text `0..*` stands on the corner of the loop and runs into the first letter of the
   label ("0..*danh mục cha…"). No `layout:` warning. Repro: `emit --to drawio r4/i35/nb.ir.json`.
4. **Low. Secret scan wording.** A mail address at a documentation domain
   (`an.nguyen@example.com`) passes every target, figjam included, with 0 warnings
   (`skills/draw/scripts/src/scan-secrets.mjs:58`), and `closing-contract.md:99-101` does not
   mention the exemption. The refusal of a personal-data finding for figjam suggests "a
   placeholder such as <db password>" (`src/pipeline.mjs:40`). The message of a
   personal-data guess quotes the first four characters of the value (`0912…(10 chars)`,
   `scan-secrets.mjs:95`); a password value is not quoted at all.
5. **Info. Reported wrap next to a connection.** In `r4/i37/aws.ja.png` the second line of
   the API's name ("Fargate）") ends where the SQL connection leaves the icon downwards and
   touches its start. The wrap is reported and `variants.md:129-132` describes this outcome.

## PNG files opened

All under `/tmp/claude-0/-home-user-zukai-kobo/d18c1f21-fd55-4bdd-a991-536a40188c82/scratchpad/r4/`:

- `i22/wide-1.png`, `i22/wide-6.png`, `i22/mm-d1.png`
- `i30/arch.png`, `i30/fx.png`
- `i31/fc-LR.png`, `i31/fc-TB.png`
- `i32/er-LR.png`, `i32/er-TB.png`
- `i33/merge.png`, `i33/guard.png`
- `i34/single.png`, `i34/bundle.png`
- `i35/nb.png`, `i35/cls.png`
- `i36/seq.png`, `i36/seq-mmd.png`
- `i37/flat2.ja.png`, `i37/flat.ja.png`, `i37/aws.ja.png`, `i37/aws.png`,
  `i37/crop-vpc.png` and `i37/crop-right.png` (crops of `aws.ja.big.png`, rendered at
  `--max-px 4000`)

Rendered but not opened: `i30/b3.png`, `i35/cls-tb.png`, `i37/flat.png`, `i37/flat2.png`,
`i22/wide-2.png` to `wide-5.png` and `wide-7.png`, `i22/mm-d2.png`, `fx/sequence.drawio.png`,
`fx/state.mmd.png`, `fx/inst-aws.png` and the three files under `/tmp/zukai-preview/`. For
these only the exit code, the file list and (for the tiles) the pixel size were checked.
