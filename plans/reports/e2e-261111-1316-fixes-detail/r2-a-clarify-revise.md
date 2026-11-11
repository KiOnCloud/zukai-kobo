# E2E round 2, A: draw clarify (activity, detailed, both) and revise

Runtime played: no `AskUserQuestion`, no subagents. Every CLI call ran with the working
directory `/tmp/claude-0/-home-user-zukai-kobo/d18c1f21-fd55-4bdd-a991-536a40188c82/scratchpad/r2-a/proj`.
Below, `CLI` is `node /home/user/zukai-kobo/skills/draw/scripts/bin/cli.mjs`, `R` is the run
folder `diagrams/20261111_refund-approval`, and `PNG` is
`/tmp/claude-0/-home-user-zukai-kobo/d18c1f21-fd55-4bdd-a991-536a40188c82/scratchpad/r2-a/png`.

Overall: all seven steps could be done and every check passes. There are seven findings, all
of low severity: five are gaps or contradictions in the skill texts, two are layout
observations. The guard that sat on a shared stretch in the previous round ("Duyệt") now
stands on its own flow.

Deviations of the tester, stated plainly:

- The full review gate (a preview of every file and of the combined file, then a review in
  the reviewer's voice) ran once, after step 1. After step 4 the main diagram and the
  combined file were previewed and only the main PNG was opened. Steps 2, 3, 5 and 6 ran
  validate, emit or relabel, bundle and `drift`, with no preview and no review round.
- Of the seven canvas tiles of step 1 I opened tiles 1, 2 and 7; tiles 3 to 6 were only
  measured (size, white share, ink bounding box).
- One shell line contained `git -C /dev/null --version` by mistake. It touched no
  repository and changed nothing, but the brief said not to use git at all.
- Nothing outside `r2-a/` and this report was written.

## Step 1: `/zukai:draw clarify --kind activity quy trình duyệt yêu cầu hoàn tiền`

Mode and kind were given, so the opening text message asked scope and view only; the
answers were `detailed` and `both`. As `skills/draw/SKILL.md:123-127` requires, the count
(six diagrams) was stated and `business` alone was suggested because the request holds no
technical names; the user kept `both`. Every required activity slot was in the request, the
rest went into `meta.notes` as `assumed:`. Six IRs: `refund-approval` (activity, five
lanes), `refund-approval-01-check-eligibility` (activity),
`refund-approval-02-gateway-refund` (sequence), each with a `-business` twin. All six
validated with 0 warnings. Emit printed one warning for the main diagram and one for its
business view: `layout: flows "f-cs-approve" and "f-lead-no" cross; no route around it was
found, so the crossing is drawn with a line jump`. Review, one round, in the reviewer's
voice: PASS, with the warning accepted (finding 2).

| Check | Result | Evidence |
|---|---|---|
| (a) bundle order | PASS | `CLI bundle --to drawio --out R/refund-approval.drawio --title "Duyệt yêu cầu hoàn tiền" --canvas all R` (the command of `closing-contract.md:36-37` plus the `--canvas all` of line 43) printed `"order":["refund-approval","refund-approval-business","refund-approval-01-check-eligibility","refund-approval-01-check-eligibility-business","refund-approval-02-gateway-refund","refund-approval-02-gateway-refund-business"]`. `grep -o '<diagram [^>]*>'` on the file gives `canvas` and then the same six pages in that order. |
| (b) page ids | PASS | The seven ids are unique and at full length, for example `refund-approval-01-check-eligibility-business` (45 characters) beside `refund-approval-01-check-eligibility`. |
| (c) drift on the fresh file | PASS | `CLI drift R/refund-approval.drawio R` printed `"drifted":false`, `"changes":[]` on all seven pages and `"bundle":{"title":"Duyệt yêu cầu hoàn tiền","canvas":"all","gap":120}`. |
| (d) preview of the combined file | PASS | `CLI preview R/refund-approval.drawio --max-px 1600 --out PNG/s1-combined.png` printed `"tiled":true,"overlap":800,"scale":1` and seven files `s1-combined-1.png` to `-7.png`. The tiles are cut to the drawing: tiles 1 to 5 are 1559x1513, tile 6 is 1559x1178 and tile 7 is 1559x1078, and in each the ink reaches to about 20 px from every edge. White share is 11, 16, 16, 24, 43, 54 and 86 %. Tile 7 holds the two sequence diagrams, which are line drawings on white (their single-file PNG is 96 % white), so its figure is not empty space around the drawing. |
| (e) step titled like its part | PASS | Both pages show one label line. Combined file: `<UserObject label="Kiểm tra điều kiện hoàn tiền" link="data:page/id,refund-approval-01-check-eligibility" id="refund-approval:check">` and `<UserObject label="Kiểm tra điều kiện hoàn tiền" link="data:page/id,refund-approval-01-check-eligibility-business" id="refund-approval-business:check">`, although the business part is titled "Kiểm tra điều kiện hoàn tiền (nghiệp vụ)". Seen in tiles 1 and 2. The texts for draw.io do not describe this (finding 1). |
| (f) guards and detours, main diagram and business view | PASS | Both PNGs were opened; the two layouts are identical. From the waypoints in `R/drawio/refund-approval.drawio`: "Quá hạn" stands on the horizontal stretch at y=542 that `f-window-no` has alone, past the split at (623,542). "Có" (twice) stands below its split on the straight line into the next node. "Lớn hơn" stands on the stretch at y=742 that `f-amount-large` has alone. "Duyệt" stands at y≈1031 on the vertical stretch of `f-lead-yes`, below the point (916,998) where `f-lead-no` leaves and above (916,1062) where the unguarded `f-cs-approve` joins. "Từ chối" stands at x≈529 on the stretch at y=998 that `f-lead-no` has alone; `f-window-no` joins at x=463, about 47 px further on. No flow runs round the far side of a lane. Two things a reader may still notice are in finding 3. |
| (g) slug inside the subroutine bars | PASS | In `PNG/s1-refund-approval.png` and `PNG/s1-refund-approval-business.png` the box of `check` spans x 463 to 719 with the bars at about 489 and 693; the lines "↳ refund-approval-01-check-" and "eligibility-business" span about 513 to 667, so at least 20 px of room stay on each side. The `refund` box (bars at about 1065 and 1270, text 1085 to 1250) is the same. |

## Step 2: rename a step

PASS. Route by `skills/revise/SKILL.md:140`: a change of wording only "is always direct, in
however many parts and views the same wording appears". `drift` was clean on the combined
file and on all six single files; `snapshot` wrote `r001`; the label was changed in
`refund-approval` and `refund-approval-business`; `CLI diff R/history/r001/source R/source`
printed one `changed` action per diagram (`"id":"submit"`, `"fields":["label"]`) and
`"hints":[]`. Emit, bundle with the recovered options, `drift` clean again.

## Step 3: hand edit, then a label-only revision

PASS. The box `refund-approval:lead-review` was moved from x=41 to x=81 in
`R/drawio/refund-approval.drawio` and on the page `refund-approval` of the combined file.
`drift` named that one cell (`"change":"moved"`) in both files and nothing on the canvas
page. After `snapshot` (`r002`) and the IR edit, `relabel` ran on the two drifted files with
one map each, keyed `<page id>:<ir id>`; the four other single files were emitted as usual.

- One warning line for the untouched labels, per call: `19 labels kept their text: "Khách
  hàng", "CSKH", "Trưởng nhóm", "Kế toán", "Hệ thống" and 14 more` for the single file and
  `41 labels kept their text: "Duyệt yêu cầu hoàn tiền", "Khách hàng", "CSKH", "Trưởng
  nhóm", "Kế toán" and 36 more` for the combined file. `replaced` was 1 and 4, `byText` 0,
  `unmatched` empty.
- `drift` afterwards on the combined file: `"drifted":true,"bundled":true,"relabelled":2`
  with the pages `{"diagram":"canvas","relabelled":2,"changes":[]}`,
  `{"diagram":"refund-approval","relabelled":1,"changes":[{"cell":"refund-approval:lead-review","change":"moved"}]}`
  and `{"diagram":"refund-approval-business","relabelled":1,"changes":[]}`. There is no
  `unresolved` key anywhere in the result. The single file reports the same one cell with
  `"relabelled":1`.
- `relabel` also printed `layout: the new label wraps to 3 lines in a 120x40 box that holds
  2` for `reject-email` on the pages canvas, `refund-approval` and
  `refund-approval-business` (finding 5).

## Step 4: add a step, consult route, draft A

PASS. Step 3 of the skill reported the moved box and asked "redraw and lose these edits" or
"stop" (answer: redraw). Route: consult, because a step is added to a diagram that has a
`-business` view (`SKILL.md:139`). Two drafts were built: A adds the step between "Số tiền ≤
2.000.000đ?" and "CSKH tự duyệt"; B adds a decision "Hàng đã về kho?" whose "Chưa" branch
goes to the rejection.

- `R/drafts/consult.json` was written before the first draft was emitted and held
  `{ "request": "thêm bước \"Kiểm tra hàng đã trả về kho\" trước khi CSKH tự duyệt", "axis": "bước mới có nhánh thất bại hay không", "drafts": [{ "id": "a", "name": "A: …" }, { "id": "b", "name": "B: …" }] }`,
  the shape of `consult-protocol.md:15`.
- `CLI bundle --to drawio --out R/drafts/a/refund-approval.drawio --title "…" --canvas all --gap 120 R/drafts/a`
  printed the run order, main diagram first:
  `"order":["refund-approval","refund-approval-business","refund-approval-01-check-eligibility", …]`.
  Draft B gave the same order.
- `CLI diff R/source R/drafts/a/source` listed `check-returned` and `f-check-returned` as
  added and `f-amount-small` as changed (`to`) in both views, with `"hints":[]`. Nothing in
  `source/` changed before the confirmation (0 occurrences of `check-returned`).
- Confirmation: `snapshot … (draft a) --extra R/refund-approval.drawio --extra R/drawio/refund-approval.drawio`
  printed `"rev":"r003","extras":["refund-approval.drawio","drawio/refund-approval.drawio"]`.
  The hand-edited files are kept as `R/history/r003/extras/refund-approval.drawio` and
  `R/history/r003/extras/drawio/refund-approval.drawio`. `drafts/` was deleted, everything
  was emitted and bundled again, and `drift` was clean. `PNG/s4-refund-approval.png` shows
  the new step in the CSKH lane and every guard on its own stretch.

## Step 5: undo, undo, redo, redo, undo

PASS. Each call was `CLI restore R <undo|redo> --bundle @<file>` with the word passed as
`SKILL.md:191-192` says, followed by emit and bundle. S(n) is the state after step 4.

| Call | `revisions` before (`undo`, `redo`) | `restore` result | State after | Expected |
|---|---|---|---|---|
| undo | `r003`, `null` | `"restored":"r003","snapshot":"r004"`, `extras` lists the two files under `history/r003/extras/` | new step gone, rejection label reworded | S(n-1) |
| undo | `r002`, `r004` | `"restored":"r002","snapshot":"r005"` | rejection label "Gửi email từ chối" again | S(n-2) |
| redo | `r001`, `r005` | `"restored":"r005","snapshot":"r006","removedRevisions":["r001"]` | as after the first undo (same checksum of `source/`) | S(n-1) |
| redo | `r006`, `r004` | `"restored":"r004","snapshot":"r007","removedRevisions":["r002"]` | as S(n) (same checksum) | S(n) |
| undo | `r007`, `null` | `"restored":"r007","snapshot":"r008","removedRevisions":["r003"],"keptExtras":["history/extras/r003/drawio/refund-approval.drawio","history/extras/r003/refund-approval.drawio"]` | as after the first undo (same checksum) | S(n-1) |

## Step 6: six more label revisions

PASS. Six direct revisions wrote `r009` to `r014` and rotated `r004` to `r009` out. The
hand-edited files are still on disk as `R/history/extras/r003/refund-approval.drawio` and
`R/history/extras/r003/drawio/refund-approval.drawio` (the second still has the box at
`x="81"`). The CLI says where: `CLI revisions R` prints
`"keptExtras":["history/extras/r003/drawio/refund-approval.drawio","history/extras/r003/refund-approval.drawio"]`
beside `undo` and `redo`, and the `restore` that rotated `r003` out printed the same list.
`CLI restore R r003` now fails with `no revision r003 in …` and the hint `existing
revisions: r010, r011, r012, r013, r014`.

## Step 7: wrong arguments

PASS, both by the text alone.

- `/zukai:revise diagrams/20261111_refund-aproval thêm bước X`: the first argument contains
  a `/`, so it is a path (`SKILL.md:50-52`); it does not exist, so rule 1 of "Find the run"
  (`SKILL.md:61-63`) applies: name the path, say that `source/` is missing, list the runs
  under `diagrams/` (one: `20261111_refund-approval`) and stop. The CLI agrees when asked:
  `CLI revisions diagrams/20261111_refund-aproval` exits 1 with `no such folder: …` and the
  hint `pass the run folder, diagrams/<yyyymmdd>_<run-slug>`; a folder without IRs gives `no
  source/ folder in …`.
- `/zukai:revise --preview --apply …`: `SKILL.md:53-54` says "Both together is an error: say
  so and stop." Nothing was run.

## Findings

1. Low, documentation. The draw.io texts say that a `ref` step always shows the part's
   title as a second line: `skills/draw/SKILL.md:104-105`,
   `skills/draw/references/ir-reference.md:54-55`,
   `skills/draw/references/target-drawio.md:37-39` and `:146`, and
   `skills/draw/references/closing-contract.md:49-50` tells the reviewer to look for it. The
   CLI drops the line when the title reads like the label, a closing remark in brackets
   aside (`sameText` in `skills/draw/scripts/src/text-metrics.mjs:109-115`). Only
   `target-mermaid.md:87-88` states the rule, and it says "the very title", which does not
   cover "X (nghiệp vụ)". Repro: step 1, check (e). A reviewer who follows the draw.io texts
   would report the missing second line as a defect.
2. Low, contradiction. `closing-contract.md:124-126` says of every `layout:` warning "show
   them, then offer to shorten the label or move the note and emit again". The crossing
   warning of step 1 has neither remedy; its own hint says it "can be accepted" or that
   reordering nodes may move it. `review-checklist.md:27` wants each one "resolved or
   explicitly accepted" without saying who accepts or where that is recorded, so the same
   warning came back on every emit and bundle of steps 2 to 6 (unlike a `detail:` warning,
   which `detail accepted:` silences).
3. Low, layout. In the main diagram `f-window-no` leaves the decision at x=623, runs out to
   x=351 at the left edge of the CSKH lane and comes back to its merge at x=463, although
   nothing stands in the column x=463 between y=542 and y=998; `f-expired` of part 01 does
   the same round "Ghi nhận: CSKH tự duyệt". `target-drawio.md:143` describes the rule ("else
   along the lane edge"), so this is as designed. The guard "Từ chối" stands about 390 px
   from its decision, in the neighbouring lane, past the line jump and 47 px before the
   junction with the "Quá hạn" flow: on its own stretch, but far from where a reader looks
   for it. Seen in `PNG/s1-refund-approval.png`.
4. Low, documentation. `target-drawio.md:52` says the canvas page is "named after `--title`
   (or `Canvas`)". With the title the closing contract prescribes, which is usually the main
   diagram's title, the page is named `Duyệt yêu cầu hoàn tiền (canvas)`
   (`emit-drawio.mjs:74`). Repro: the page list of step 1, check (a).
5. Low, gap in revise. A label-only revision of a run with one hand-moved box relabels the
   whole combined file in place (`skills/revise/SKILL.md:108-121`), including the canvas and
   the business page nobody edited, while `drawio/refund-approval-business.drawio` is emitted
   again with a box that fits. The two copies of the business view then differ, and
   `relabel` warns that the label wraps to 3 lines in a box that holds 2. The revise text
   does not say what to do with that warning: `closing-contract.md:124-126` offers a shorter
   label, `variants.md:124-125` a re-emit, which would lose the hand edit the route exists
   to keep. Repro: step 3.
6. Low, ambiguity. Step 3 of revise asks "redraw and lose these edits" or "stop"
   (`SKILL.md:122`) before step 4 chooses the route. On the consult route nothing is redrawn
   until a draft is confirmed, and the user may drop every draft, so the question comes
   before there is anything to decide on. `consult-protocol.md:78-79` only says to add
   `--extra` at confirmation. I asked at step 3 and carried the answer to the confirmation.
7. Low, ambiguity. `SKILL.md:198-202` says `restore` lists kept hand-edited files as
   `extras` "when that revision kept" them. That holds for the revision that was written
   with `--extra` (`r003`), not for a later snapshot of the same state: the last undo of
   step 5 restored `r007`, which is the state those files match, and printed no `extras`,
   only `keptExtras` because that same command happened to rotate `r003` out. Had the
   rotation happened one command earlier, the undo itself would have pointed nowhere;
   `revisions` is then the only place that names the files. Also noted while reading the
   argument rule (`SKILL.md:50-52`): a mistyped run folder given without a `/` is read as
   the first word of the request, and a request whose first word contains a `/` is read as a
   path.

## PNG files actually opened

- `/tmp/claude-0/-home-user-zukai-kobo/d18c1f21-fd55-4bdd-a991-536a40188c82/scratchpad/r2-a/png/s1-refund-approval.png`
- `/tmp/claude-0/-home-user-zukai-kobo/d18c1f21-fd55-4bdd-a991-536a40188c82/scratchpad/r2-a/png/s1-refund-approval-business.png`
- `/tmp/claude-0/-home-user-zukai-kobo/d18c1f21-fd55-4bdd-a991-536a40188c82/scratchpad/r2-a/png/s1-refund-approval-01-check-eligibility.png`
- `/tmp/claude-0/-home-user-zukai-kobo/d18c1f21-fd55-4bdd-a991-536a40188c82/scratchpad/r2-a/png/s1-combined-1.png`
- `/tmp/claude-0/-home-user-zukai-kobo/d18c1f21-fd55-4bdd-a991-536a40188c82/scratchpad/r2-a/png/s1-combined-2.png`
- `/tmp/claude-0/-home-user-zukai-kobo/d18c1f21-fd55-4bdd-a991-536a40188c82/scratchpad/r2-a/png/s1-combined-7.png`
- `/tmp/claude-0/-home-user-zukai-kobo/d18c1f21-fd55-4bdd-a991-536a40188c82/scratchpad/r2-a/png/s4-refund-approval.png`

Rendered but not opened: the business view of part 01 and the two sequence diagrams as
single files (all three are visible in tile 7), canvas tiles 3 to 6 of step 1, and the
seven canvas tiles of step 4.
