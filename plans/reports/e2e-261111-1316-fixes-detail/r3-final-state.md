# Round 3: final state of the repository (Zukai 2.0.4)

Run on 2026-11-11 (UTC), Node 22.23.4, Playwright/Chromium renderer (`drawio-web`, `mermaid-web`).
Every item was checked by running the CLI or by reading the shipped text; skill behaviour was
read as a runtime without `AskUserQuestion` and without subagents. Figma was treated as not
connected and no external tool was called. Git was not used.

All scratch files are under
`/tmp/claude-0/-home-user-zukai-kobo/d18c1f21-fd55-4bdd-a991-536a40188c82/scratchpad/r3/`
(written `r3/` below); the user's project is `r3/proj`. `CLI` stands for
`node /home/user/zukai-kobo/skills/draw/scripts/bin/cli.mjs`.

## Result

36 of the 37 items pass. Item 37 passes on the three symptoms it names, but the relabelled
AWS page shows a new visible defect that the CLI does not report, so it is marked FAIL
(partial). All extra checks pass, with one note: the fixture `activity/valid.json` named in
the task does not exist, so `activity/valid-two-lanes.json` was used.

## Items 1 to 37

| # | Verdict | Evidence |
|---|---|---|
| 1 | PASS | Run `r3/proj/diagrams/20261111_refund-approval` with five IRs, two of them `refund-approval-02-gateway-refund-via-payment` (45 characters) and its `-business` twin (54). `CLI bundle --to drawio --canvas all --out … <run>` wrote six `<diagram>` elements whose ids are the full names, all different; no cell id repeats within a page. `CLI drift <run>/refund-approval.drawio <run>` answered `"drifted":false` with empty `changes` on every page. |
| 2 | PASS | The same `bundle` call, given the run folder, printed `"order":["refund-approval","refund-approval-business","refund-approval-01-check-eligibility","refund-approval-02-gateway-refund-via-payment","refund-approval-02-gateway-refund-via-payment-business"]`. `closing-contract.md:35-42` prescribes `bundle … <run-folder>` and warns against `source/*.ir.json`. |
| 3 | PASS | `r3/i3/hub.ir.json` (one component connected to 60 others): `emit --to mermaid` exits 0, writes a `flowchart TB`, and prints a `size:` warning and the `layout: architecture-beta cannot place this diagram…` fallback warning. No stack trace. |
| 4 | PASS | `CLI diff r3/i4/a.ir.json r3/i4/b.ir.json` (messages m1 and m2 swapped, nothing else): `"differs":true … "reordered":[{"collection":"messages","moved":[{"id":"m1","label":"Đặt hàng","after":"m2"}]}]`. |
| 5 | PASS | Run `r3/proj/diagrams/20261111_undo` at S3 with r001 = S1, r002 = S2. `restore <run> undo`, `undo`, `redo`, `redo`, `undo` left the IR at S2, S1, S2, S3, S2. One more `undo` gave S1, and the next one failed with `nothing earlier to go back to`, exit 1. `skills/revise/SKILL.md:199-200`: "Never work the target out from the list yourself: pass the word." |
| 6 | PASS | `skills/draw/SKILL.md:220` ("hand the user the `figjam` text to paste, as section 5 of the reference says (never the `mermaid` text)"), `target-figjam.md:78-91` ("the output of `emit --to figjam`, never of `emit --to mermaid`") and `README.md:148` ("you get the FigJam text to paste into the board yourself") say the same thing. |
| 7 | PASS | `skills/revise/SKILL.md:147-148`: Consult takes only a change of structure that has to be carried into a `ref` part or a `-business` view; "A change of wording only (a label, a title, a guard) is always direct, in however many parts and views the same wording appears". |
| 8 | PASS | `skills/draw/SKILL.md:26-28` now says that one command, `preview`, reaches the network to fetch its renderer and every other command works offline. `README.md:213` limits its sentence to validating and emitting. |
| 9 | PASS | `install.sh --target codex --dest r3/inst1`: fresh install wrote only `.agents/skills/zukai` and `zukai-revise`; the second run printed `zukai 2.0.4 already up to date` and created nothing. In `r3/inst2` (a 1.0.0 copy plus `skills/zukai.bak-20260101000000`) the run moved both out: `.agents/zukai-backups/zukai-20260101000000` and `.agents/zukai-backups/zukai-20261111144459`; `skills/` then held only `zukai` and `zukai-revise`, and only one `SKILL.md` under `skills/` has `name: zukai`. |
| 10 | PASS | `variants.md:35-46`: a table with a rule for `architecture` (keep systems and icons, drop operator detail), `er` (a glossary of business objects) and `class` (the `er` glossary, or "technical only" with the reason), and the `both` rule for a run of several kinds. |
| 11 | PASS | "Which view?" stands in `SKILL.md:116`, `brainstorm-protocol.md:12`, `variants.md:64` and `agents/diagram-brainstorm.md:19`; no file asks "Who will read it?" as a question any more. "Candidates must differ in kind or subject" stands in `brainstorm-protocol.md:20` and `agents/diagram-brainstorm.md:22-23`. |
| 12 | PASS | `SKILL.md:36-52`: a misspelt mode is read as the mode and said in one line (36-38); no arguments asks first what the diagram should show (39-42); an unknown flag value fixes nothing, the existing values are named and the question is asked, with "Which target?" for an unknown `--to`, asked first and alone when it would be a fifth question (43-49); a flag with no request is the no-request case (49-51). The text path lists the target question too (144-145). |
| 13 | PASS | Run `r3/proj/diagrams/20261111_mm`: `CLI drift <run>/mm.md <run>` returned `"target":"mermaid" … "bundle":{"title":"Thanh toán \"nhanh\""}` with `drifted:false`. After one label was changed by hand in `mm.md` the same call returned `drifted:true` and `{"diagram":"mm-01-pay","changes":[{"cell":"(text)","change":"edited"}]}`. In a run that holds an activity diagram the object also carries `"mermaidStable":true`. |
| 14 | PASS | `skills/revise/SKILL.md:69-76`: a path that is not a run is an error that names the path, what is missing and the runs, and never falls back; with several runs in the conversation the request has to point at one, else the user is asked, "the most recent one is not a default". |
| 15 | PASS | `skills/draw/SKILL.md:3` ("sequence, flowchart, activity with swimlanes, state, ER, class, architecture") and `.claude-plugin/plugin.json:4,7` (description and the keywords `activity`, `swimlane`). |
| 16 | PASS | `SKILL.md:205-212`: the kind question is still asked and offers `class` first, `flowchart` second, `architecture` third, each with its consequence. `SKILL.md:146-148`: the text path lists all seven kinds, those three first and in that order. |
| 17 | PASS | Six IRs in `r3/i17` (`password=`, `mật khẩu=`, `パスワード=` and the same three with `: `, value [redacted]): `emit --to drawio`, `mermaid`, `figjam` and `bundle --to drawio`, `mermaid` all exit 2 with `refusing to emit for <target>`, write no file, and the value appears in no output (the message shows four characters of the key and a length). `Gọi 0912345678` and a mail address at a real-looking domain: exit 0 with a `personal-data` warning for drawio, mermaid and both bundles, exit 2 and no file for figjam. `token: required` warns locally and is refused for figjam. `ir-reference.md:57-60`, `target-figjam.md:23-27,80-84` and `closing-contract.md:91-105` agree: a credential by its form on no target, a guess as a warning locally and a refusal for FigJam. See finding 4 for addresses at `example.com`. |
| 18 | PASS | `validate` in `r3/i18`: `model: decision "d" has one way out`, `model: "orphan" is connected to nothing`, `model: no initial state`, `model: return "m1" from "s" to "u" comes before any call`, `model: entity "order" has a foreign key ("customer_id") but takes part in no relation`; all exit 0. With an initial state added, `state "c" is never reached from the initial state`. |
| 19 | PASS | `relabel orders.drawio --map map.json` (one key) printed one stderr line: `7 labels kept their text: "Khách gửi giỏ hàng", … and 2 more`. |
| 20 | PASS | `r3/i20/hand.drawio`: box `orders:backorder` moved by hand, then `orders:pay` relabelled in place and the IR label changed to match: `drift` lists only `{"cell":"orders:backorder","change":"moved"}` with `relabelled:1`. The second case as specified: `drift orders.en.drawio orders-en.ir.json` answers `"drifted":false,"relabelled":1`, `changes: []`. |
| 21 | PASS | Run `r3/proj/diagrams/20261111_orders`: r001 taken with `--extra drawio/orders.drawio`; the sixth snapshot printed `"removed":["r001"],"keptExtras":["history/extras/r001/drawio/orders.drawio"]` and the file is there. |
| 22 | PASS | `closing-contract.md:46-50` has the preview run on each file and on the combined file. `preview <run>/mm.md` rendered two blocks (`i22-mm-d1.png`, `i22-mm-d2.png`). A seven-diagram canvas (`r3/i22/wide.drawio`, `--max-px 1600`) came back as six tiles of 1559 px width and heights 1591, 1591, 1282, 993, 640, 851; the opened tiles end at the drawing. |
| 23 | PASS | `preview r3/i22/x.drawio` wrote `/tmp/zukai-preview/x-drawio-d83f452c.png` and `preview r3/i22/x.mmd` wrote `/tmp/zukai-preview/x-mmd-1fa8cb35.png`; a second call on `x.drawio` gave the same path. (Three calls wrote to the system temp folder for this item, not one.) |
| 24 | PASS | `--out --allow-sensitive`: `option --out needs a value, but "--allow-sensitive" follows it`, exit 1, no file. `--out` last: `option --out needs a value`, exit 1. `--to pdf`: `unknown target "pdf"`, exit 1. `--help` and `emit --help` print the usage, exit 0. |
| 25 | PASS | `r3/i25`: without a note, two `detail:` warnings (three stores of one kind; `"c0" ("POST /redeem") reads as an endpoint path`). With two `detail accepted:` notes quoting `"orders"`, `"payments"`, `"audit"` and `"c0"`: 0 warnings. With a fourth store that was never accepted the stores warning comes back. |
| 26 | PASS | `snapshot` on a run with an empty `source/`: `no IR files in …/source; nothing to snapshot`, exit 1, no `history/` created. |
| 27 | PASS | 200-node flowchart: `size: 200 nodes in one diagram; a reader follows about 15 to 20…` on `validate` and on `emit`. |
| 28 | PASS | `SKILL.md:124-130`: `both` "doubles the run: with `detailed` and two parts that is six diagrams", the option's description says so, the number is stated before the IRs are written, and `business` alone is suggested when the request holds no technical names. |
| 29 | PASS | The installed copy is 2,396,033 bytes (19 files: both `SKILL.md`, the references, `scripts/bin/cli.mjs`, `scripts/package.json`, `scripts/src/feature-matrix.json`, two version files); no tests, fixtures or sources. The installed CLI validated a fixture, emitted an AWS architecture to draw.io, rendered it and refused a class diagram for figjam with the proper message. |
| 30 | PASS | A Mermaid architecture with two nested boundaries and a 60-character label (`r3/i30/arch.ir.json`) is emitted as a flowchart with the warning `layout: architecture-beta cannot place this diagram without overlaps (…)`; in the PNG the VPC frame lies inside the account frame, each holds only its members, and the label wraps between words. With short labels and no `ref` the form stays `architecture-beta` and the frames nest cleanly (`b3.png`). See finding 2 for the one case left. |
| 31 | PASS | `r3/i31/fc-LR.png` and `fc-TB.png` (two decisions, "Yêu cầu sửa mã đơn" leading back to "Nhập mã đơn hàng"), 0 warnings: the start node is on the line of the main flow, and each "có" and "không" stands on a stretch that belongs to one branch only, after the lines have parted. |
| 32 | PASS | `r3/i32/er-LR.png`: two relations anchored to the row `party_id` end in two crow's feet one above the other, not on each other. `er-TB.png`: two relations into "Đơn hàng" from above arrive about 100 px apart. |
| 33 | PASS | `r3/i33/merge.png` (one lane; "Từ chối, nêu lý do" goes to a merge two rows below that two other flows share): a straight line down and into the merge, no detour, 0 warnings. `guard.png`: the guard "đủ" stands on the branch's own horizontal stretch, before the unguarded flow from "Sửa thông tin" joins. |
| 34 | PASS | In the bundle of item 1 the step "Hoàn tiền qua cổng" whose part has the same title, and the business step whose part is titled "Hoàn tiền qua cổng (nghiệp vụ)", carry the one-line label `label="Hoàn tiền qua cổng"` (four cells: two pages and their canvas copies); the Mermaid bundle writes `n2[["Hoàn tiền qua cổng"]]`. A part with another title still gives two lines (`↳ Gọi API hoàn tiền của ngân hàng`). `target-drawio.md:39` and `target-mermaid.md:83-88` state the rule. In the single emit the slug wraps inside the subroutine, clear of both side bars (`r3/i34/single.png`). |
| 35 | PASS | `r3/i35/cls.png` (LR), `cls-tb.png` and `nb.png` (TB, a neighbouring class in the same row): the self-relation label stands clear of every other class; in `nb.png` the neighbour is placed beyond the end of the label. See finding 3 for the cardinality. |
| 36 | PASS | `after: "b1"` (an `alt` block): the Mermaid text has `Note right of n2: …` after `end`; in `r3/i36/seq.png` the note stands below the frame. |
| 37 | FAIL (partial) | `r3/i37`: five AWS icons relabelled to Japanese, `"replaced":10 … "untouched":[],"warnings":0`. In the PNG every icon name is on one line and no name lies on a connection, and there is no false warning. But three names are drawn across a frame line and nothing reports it: see finding 1. |

## Extra checks

| Check | Verdict | Evidence |
|---|---|---|
| Version 2.0.4 | PASS | `.claude-plugin/plugin.json:3` and `skills/draw/scripts/package.json:3` say `2.0.4`; `README.md:257` too. |
| "2.0.3 or older" page ids | PASS | `skills/revise/SKILL.md:111-112`, `target-drawio.md:153-154`, `docs/install.md:222-223` and `docs/architecture.md:171` agree. A bundle with a page id cut by hand to 40 characters is read: `drift` answers `"drifted":false,"legacyIds":true`, and `relabel` takes the cut id as key. |
| Upgrade notes for 2.0.4 | PASS | `docs/install.md:217-229`: full page ids, refusal of a credential on every target, `bundle` with the run folder, backups in `zukai-backups/` and a copy without sources; each matches items 1, 17, 2, 9 and 29. `docs/install.md:138-140` says "about 2.3 MB", which is the 2,396,033 bytes measured. See finding 5. |
| Asking without `AskUserQuestion` in revise | PASS | `skills/revise/SKILL.md:42-48`: one text message with the question, lettered options, the suggested one first and marked, "reply with a letter or your own words", and no pick in the user's place. |
| Existing features | PASS | `emit --to drawio` and `--to mermaid` exit 0 for `sequence`, `flowchart`, `state`, `er`, `class`, `architecture` (`valid.json`) and for `activity/valid-two-lanes.json`; Mermaid prints the known degradation warnings for class, architecture and activity. `fixtures/activity/valid.json` does not exist, so the call as written in the task exits 1 with `cannot read file`. `preview` rendered `sequence.drawio` and `flowchart.mmd`. |

## Findings

1. **Medium. `relabel` widens an icon name across a frame line and does not report it.**
   `skills/draw/scripts/src/relabel.mjs:144-150` (limit `BELOW_MAX = 200`, line 279) raises
   `labelWidth` of a name below an icon until the new text fits on one line, without looking
   at the frame the icon stands in. Repro: `r3/i37/aws.ir.json` emitted to draw.io, then
   `relabel aws.drawio --map labels.ja.json --out aws.ja.drawio`. The load balancer's icon is
   at x 48 in a VPC frame and gets `labelWidth=200`, so its name starts 13 px left of the
   frame; in the PNG the names of the load balancer, the API and the database cross the VPC
   frame line and the name of the Lambda worker crosses the right line of the AWS Cloud
   frame. The command prints `"warnings":0`. `variants.md:126-130` only promises a warning
   for a name longer than the room between two icons.
2. **Low. `architecture-beta` still breaks a `ref` slug inside a word when the diagram has no
   boundary.** `emit --to mermaid skills/draw/scripts/fixtures/architecture/valid-ref-parts.json`
   stays `architecture-beta` and draws "Back office ↳ order-sync-02-st / ore" and
   "order-sync-01-lo / ad" (`r3/i30/fx.png`); the only warnings are the dropped connection
   labels. With a boundary the same label length triggers the flowchart fallback, so the
   check in `emit-mermaid.mjs` covers frames but not this case. It shows only in a single
   emit, where the slug stands in for the title.
3. **Low. Class self-relation: the far cardinality sits on the loop.** In `r3/i35/cls-tb.png`
   and `nb.png` the text `0..*` lies on the corner of the loop line and touches the first
   letter of the relation label ("0..*danh mục cha…"). No `layout:` warning.
4. **Low. A mail address at a documentation domain is not reported, and no text says so.**
   `Gửi cho an.nguyen@example.com` passes every target, figjam included, with 0 warnings
   (`skills/draw/scripts/src/scan-secrets.mjs:58`, `PLACEHOLDER_MAIL`); the same label with
   another domain is reported. The exemption looks deliberate, but `closing-contract.md:99-101`
   says "`personal-data` for a mail address" without it. Also, the hint of a personal-data
   refusal suggests "a placeholder such as <db password>" (`pipeline.mjs:40`).
5. **Low. Order and coverage of the 2.0.4 upgrade notes.** `docs/install.md:217` puts
   "Upgrading to 2.0.4" before "Upgrading to 2.0.3" (line 231). The four bullets are correct,
   but changes a user of an existing run will also meet are not listed: `model:` and `size:`
   warnings on diagrams that emitted silently, `personal-data` warnings, exit code 1 for an
   unknown target, the new default path of `preview`, `restore <run> undo|redo`, and
   `keptExtras`.
6. **Info. The task's fixture path `fixtures/activity/valid.json` does not exist.** The
   activity fixtures are named `valid-two-lanes.json` and so on.

## PNG files opened

- `/tmp/claude-0/-home-user-zukai-kobo/d18c1f21-fd55-4bdd-a991-536a40188c82/scratchpad/r3/i22/wide-1.png`
- `/tmp/claude-0/-home-user-zukai-kobo/d18c1f21-fd55-4bdd-a991-536a40188c82/scratchpad/r3/i22/wide-5.png`
- `/tmp/claude-0/-home-user-zukai-kobo/d18c1f21-fd55-4bdd-a991-536a40188c82/scratchpad/r3/i22/refund.png`
- `/tmp/claude-0/-home-user-zukai-kobo/d18c1f21-fd55-4bdd-a991-536a40188c82/scratchpad/r3/i30/arch.png`
- `/tmp/claude-0/-home-user-zukai-kobo/d18c1f21-fd55-4bdd-a991-536a40188c82/scratchpad/r3/i30/fx.png`
- `/tmp/claude-0/-home-user-zukai-kobo/d18c1f21-fd55-4bdd-a991-536a40188c82/scratchpad/r3/i30/b3.png`
- `/tmp/claude-0/-home-user-zukai-kobo/d18c1f21-fd55-4bdd-a991-536a40188c82/scratchpad/r3/i31/fc-LR.png`
- `/tmp/claude-0/-home-user-zukai-kobo/d18c1f21-fd55-4bdd-a991-536a40188c82/scratchpad/r3/i31/fc-TB.png`
- `/tmp/claude-0/-home-user-zukai-kobo/d18c1f21-fd55-4bdd-a991-536a40188c82/scratchpad/r3/i32/er-LR.png`
- `/tmp/claude-0/-home-user-zukai-kobo/d18c1f21-fd55-4bdd-a991-536a40188c82/scratchpad/r3/i32/er-TB.png`
- `/tmp/claude-0/-home-user-zukai-kobo/d18c1f21-fd55-4bdd-a991-536a40188c82/scratchpad/r3/i33/merge.png`
- `/tmp/claude-0/-home-user-zukai-kobo/d18c1f21-fd55-4bdd-a991-536a40188c82/scratchpad/r3/i33/guard.png`
- `/tmp/claude-0/-home-user-zukai-kobo/d18c1f21-fd55-4bdd-a991-536a40188c82/scratchpad/r3/i34/single.png`
- `/tmp/claude-0/-home-user-zukai-kobo/d18c1f21-fd55-4bdd-a991-536a40188c82/scratchpad/r3/i35/cls.png`
- `/tmp/claude-0/-home-user-zukai-kobo/d18c1f21-fd55-4bdd-a991-536a40188c82/scratchpad/r3/i35/cls-tb.png`
- `/tmp/claude-0/-home-user-zukai-kobo/d18c1f21-fd55-4bdd-a991-536a40188c82/scratchpad/r3/i35/nb.png`
- `/tmp/claude-0/-home-user-zukai-kobo/d18c1f21-fd55-4bdd-a991-536a40188c82/scratchpad/r3/i36/seq.png`
- `/tmp/claude-0/-home-user-zukai-kobo/d18c1f21-fd55-4bdd-a991-536a40188c82/scratchpad/r3/i37/aws.ja.png`
- `/tmp/claude-0/-home-user-zukai-kobo/d18c1f21-fd55-4bdd-a991-536a40188c82/scratchpad/r3/i37/crop-left.png` (a crop of `aws.ja.big.png`, rendered at `--max-px 3600`)
- `/tmp/claude-0/-home-user-zukai-kobo/d18c1f21-fd55-4bdd-a991-536a40188c82/scratchpad/r3/i37/crop-right.png` (a crop of the same image)

Rendered but not opened: `fx/sequence.drawio.png`, `fx/flowchart.mmd.png`, `fx/inst-aws.png`,
`i22/wide-2.png` to `wide-4.png` and `wide-6.png`, `i22-mm-d1.png`, `i22-mm-d2.png`,
`i30/beta.png`, `i30/b2.png`, `i36/seq-mmd.png`, `i37/aws.en.png`. For these only the exit
code and the file list of `preview` were checked; item 36 in Mermaid rests on the emitted
text, not on an image.
