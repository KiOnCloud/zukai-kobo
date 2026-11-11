# Zukai end-to-end test A: clarify (activity, detailed, both) then revise

Tester acted as the runtime agent, no `AskUserQuestion`, no `diagram-reviewer` agent ("other runtimes" path).
Node v22.23.4. CLI: `/home/user/zukai-kobo/skills/draw/scripts/bin/cli.mjs` (below: `cli`). Nothing under `/home/user/zukai-kobo` was modified.

Paths (SP = `/tmp/claude-0/-home-user-zukai-kobo/d341e1af-4dbd-40ea-aeb1-5a8be443704e/scratchpad`):

- Project: `SP/proj-clarify`
- Final run folder: `SP/proj-clarify/diagrams/20261111_refund-approval/` (source/, drawio/, refund-approval.drawio, history/r006..r010)
- Repro inputs and helper scripts: `SP/tmp-a/`
- PNGs reviewed: `SP/reports/a-png/`

## 1. Per step

### Step 1 `/zukai:draw clarify --kind activity quy trình duyệt yêu cầu hoàn tiền` : PASS with findings

Expected by docs: opening call asks scope and view only (kind given), clarify rounds fill activity slots, IR draft shown, closing contract (validate, emit, bundle `--canvas all`, preview each individual file, review, report).

What happened:

- 6 IRs written (main, 2 parts, 3 `-business`): `refund-approval`, `refund-approval-01-eligibility-check` (activity), `refund-approval-02-gateway-refund` (sequence, a part of another kind; the docs do not forbid it), plus `-business` of each. All validated first try (exit 0).
- Literal bundle command from `closing-contract.md` step 3 put the main diagram LAST (finding F1). Re-bundled with explicit order.
- Emit warnings (verbatim, round 1):
  - main: `layout: flows "f-cs-approved" and "f-lead-no" cross; no route around it was found, so the crossing is drawn with a line jump`
  - part 01: `layout: flows "f-expired-end" and "f-small" cross inside lane "cs"; no column order that avoids it was found` and the same for `"f-large"`; hint: `the lanes do not force this crossing; moving one of the nodes to another lane avoids it, or report the shape so the column order can learn it` (the diagram has one lane, F12).
- Review round 1 (reviewer voice): FAIL-level layout defect in part 01 (detour around the right edge with two line jumps, `a-png/s1-round1-refund-approval-01-eligibility-check.png`), guard "duyệt" drawn on a shared trunk in main (F10). Fix as IR edits: part 01 "quá hạn" conclusion ends in its own final node; main `approved-merge` moved to lane `lead`. Reordering `actions`/`flows` (what the hint suggests) did not remove the part 01 crossing (`SP/tmp-a/p01-a.ir.json`, `p01-b.ir.json` still warn; `p01-c.ir.json` is the fix).
- Review round 2: PASS. Remaining: one accepted `layout:` warning in main (line jump), `emitter:` findings F9, F10, F11.
- `Images:` refund-approval: opened; refund-approval-business: opened; 01-eligibility-check: opened; 02-gateway-refund: opened (round 1); 01-…-business and 02-…-business: not opened in round 2 except 02-business rendered, layouts identical to the technical ones by construction.
- The combined file was also previewed (not required by the contract, F8): 7 tiles, tile 1 opened.

### Step 2 `/zukai:revise thêm bước kiểm tra hàng đã trả về kho …` : PASS with findings

- Drift: nothing drifted (combined and 6 single files).
- Route: by the table in revise step 4 the change "reaches a `ref` part or a `-business` view", so the literal route is Consult, not Direct (F6). Built drafts A (CSKH checks) and B (new lane "Kho" checks) under `drafts/`, each validated, emitted, bundled, diffed (`hints: []`). Answer sheet has no pick; took A (matches "CSKH" in the request). Confirm: `snapshot` gave `r001`, drafts copied, `drafts/` deleted, closing contract run.
- Review round 1: same detour defect appeared for the new "chờ hàng về kho" conclusion in part 01 (`a-png/s2-round1-…-01-eligibility-check.png`); fixed with its own final node; round 2 PASS (`a-png/s2-round2-…png`). Main keeps two accepted `layout:` warnings (`"f-expired" and "f-recheck" cross inside lane "cs"`, `"f-cs-approved" and "f-lead-no" cross`).

### Step 3 hand edit + label-only revise : PASS with findings

- Hand edit script `SP/tmp-a/hand-edit.js`: `refund-approval:reject` x 96 -> 216 in `drawio/refund-approval.drawio` and on the main page of the combined file. Copies: `SP/tmp-a/hand-edited/`.
- `drift` reported exactly `{"cell":"refund-approval:reject","change":"moved"}` for both files, nothing else. Correct.
- Route: step 3 says label-only keeps hand edits via `relabel`; step 4 would send it to Consult (it reaches a `ref` part and the business view). Contradiction, F6. Took the relabel path as the task says.
- `snapshot` -> r002, IR labels changed (main + business action label, both part 02 titles), validated, `relabel` on the two drifted files, plain `emit` on the others, no re-bundle.
- Verified: moved x=216 kept in both files; old label count 0 in every `.drawio` and IR; new label present in main page, business page, canvas copies, part 02 page names and title cells, and the `↳` ref lines. `byText: 0`.
- Problems on the way: a map keyed by the diagram id (as `variants.md` says) silently misses the business part title (F2); `relabel` printed 46 unrelated warnings (F4); after `relabel`, `drift` reports 95 changes the user never made (F5).

### Step 4 undo, undo, redo : PASS for the scripted sequence, FAIL for the rule in general

State names: S1 = delivered, S2 = with the warehouse step, S3 = S2 + renamed step.

| Request | Rule picked | Command | `source/` after | Expected by a user |
|---|---|---|---|---|
| undo | newest (r002) | `restore … r002 --extra <2 drifted files>` -> snapshot r003 | S2 | S2, ok |
| undo | newest is r003 `undoOf r002` -> newest older than r002 without undoOf = r001 | `restore … r001` -> r004 | S1 | S1, ok |
| redo | newest r004 carries undoOf | `restore … r004` -> r005 | S2 (byte-identical to the state after step 2, checked with `diff -rq`) | S2, ok |

Extra checks on copies of the run (`SP/tmp-a/undo-exp/run`, `run-e2`), continuing from the state above:

- second "redo": rule gives newest (r005, `undoOf r004`); `restore run r005` -> `{"ok":true,"restored":"r005","snapshot":"r006","removedRevisions":["r001"]…}`; source goes back to S1. A user expects S3. F3a.
- "undo" after the redo: rule gives "newest revision older than r004 without undoOf" = r002; `restore run-e2 r002` -> source stays S2 (no-op), yet a revision slot is used and r001 is rotated away. A user expects S1. F3b.

The first undo needed an answer the sheet does not have ("redraw and lose these edits" or "stop"; neither is marked as default). Took "redraw", hand-edited files went to `history/r003/extras/`.

### Step 5 `/zukai:revise --preview --apply đổi màu` : PASS

revise SKILL.md "Arguments": "Both together is an error: say so and stop." Done as instructed: said "`--preview` và `--apply` không dùng chung được; chọn một trong hai" and stopped; no CLI call, no file touched. Note: no wording for the message is given and nothing in the CLI enforces it (instruction-only).

### Step 6 five quick direct revisions : PASS with findings

Each: drift (clean), `snapshot --request … --bundle @file`, edit `submit` label in main and business, validate, emit, bundle. Review rounds skipped for these five (label tweaks), stated here on purpose. Simulated user passed `--apply`, since without it the route table sends even a label tweak to Consult in this run (F6).

Snapshot outputs: `r006 removed ["r001"]`, `r007 removed ["r002"]`, `r008 removed ["r003"]`, `r009 removed ["r004"]`, `r010 removed ["r005"]`. `history/` always holds exactly five folders: rotation works as documented.

`history/r003/extras/` (the only copy of the user's hand-edited files) was deleted with r003 at the third tweak; the snapshot output only says `"removed":["r003"]` (F7). Backup of that revision: `SP/tmp-a/extras-backup/r003`.

## 2. Findings

F1. doc-contradiction / bug. `skills/draw/references/closing-contract.md:25` (and `target-drawio.md:27,45`): the bundle command ends with `source/*.ir.json` "(main diagram first)". The shell sorts `-` before `.`, so the main diagram comes last and every `-business` view before its technical one.
Repro: in the run folder, `cli bundle --to drawio --out x.drawio --title T --canvas all source/*.ir.json` -> `"canvas":["refund-approval-01-eligibility-check-business","refund-approval-01-eligibility-check","refund-approval-02-gateway-refund-business","refund-approval-02-gateway-refund","refund-approval-business","refund-approval"]`. Output kept: `SP/tmp-a/bundle-glob-order.drawio`.

F2. bug. `skills/draw/scripts/src/emit-drawio.mjs:120` cuts page ids to 40 characters. `target-drawio.md:145` says "Page ids in a bundle are the diagram ids"; `variants.md:66-67` and `target-drawio.md:64` say to key a relabel map by `<diagram id>:…`. The skill's own naming (`<slug>-NN-<part>-business`) passes 40 characters easily.
- (a) Two diagrams whose first 40 characters match get the same page id and the same cell ids, and a fresh bundle is reported as drifted. Repro: `SP/tmp-a/repro-longid/` -> `cli bundle --to drawio --out long.drawio --title T --canvas all refund-approval-01-eligibility-check-rules.ir.json refund-approval-01-eligibility-check-rules-business.ir.json` exits 0 with 0 warnings; the file has two `<diagram id="refund-approval-01-eligibility-check-rul" …>`; `cli drift long.drawio <both IRs>` -> `"drifted":true` with 6 "moved" cells on the canvas.
- (b) A relabel key with the real diagram id is unmatched. Repro: `cli relabel SP/tmp-a/hand-edited/combined.drawio --map SP/tmp-a/map-full-ids.json --out /tmp/x.drawio` -> exit 0, `"unmatched":["refund-approval-02-gateway-refund-business:title"]`; the business page keeps the old name and the ref line reads `Hoàn tiền về thẻ/ví của khách<br>↳ Hoàn tiền qua cổng thanh toán` (output: `SP/tmp-a/trial-full.drawio`). The truncated key (`…-busine:title`, `map-page-ids.json`) works. revise SKILL.md:91-92 ("the page id is the `diagram` that `drift` printed") is the only text that leads to the right key.
- (c) `drift` prints truncated ids in `pages[].diagram` and full ids in `bundle.canvas` of the same object.

F3. bug in the documented rule. `skills/revise/SKILL.md:148-155` (step 7.2).
- (a) "redo" = "the newest revision, when it carries `undoOf`". After any restore the newest revision always carries `undoOf`, so a second "redo" undoes the first one instead of going forward (S2 -> S1, expected S3).
- (b) plain "undo" after a redo: "the newest revision older than rX without undoOf" picks the revision that holds the current state (no-op S2 -> S2) and still rotates the oldest revision away.
Repro: `SP/tmp-a/undo-exp/run` and `run-e2` (results in step 4). Clean pre-experiment copy was not kept separately; the sequence in step 4 rebuilds it.

F4. UX-unreasonable. `skills/revise/SKILL.md:88-97` sends a label-only revision through `relabel` and the closing contract says to show every warning verbatim. `relabel` warns for every label not in the map: 46 warnings, 23 KB of stderr, for a one-label change (`SP/tmp-a/relabel-page.stderr`). First one: `label not relabelled: "Quy trình duyệt yêu cầu hoàn tiền" (canvas/refund-approval:title, refund-approval/refund-approval:title)`. The only way to silence them is a `$keep` list of every other text. In the single-diagram file the same map also gives `keys that matched no label: refund-approval-business:gateway-refund, …`, so one map per file is needed, which the skill does not say.

F5. UX-unreasonable / bug. After the label-only revision, `drift` on the combined file reports 68 changes on the canvas, 11 on the main page and 16 on the business page (which was never hand-edited), because a fresh emit would resize the box and shift everything. Step 3 of the next revision must then tell the user "the box X was moved" 95 times. Repro: `cli drift SP/tmp-a/hand-edited/combined-after-relabel.drawio <run>` at the IR state of r003 (output saved: `SP/tmp-a/drift-after-relabel.json`; the matching IRs are gone from history, see F7, so this repro is the saved output only).

F6. doc-contradiction / UX. `skills/revise/SKILL.md:110` (route table): Consult wins for any change that "reaches a `ref` part or a `-business` view". In a `both` run every element exists in a business view, so the Direct route is unreachable without `--apply`, even for a one-word label tweak. It also contradicts step 3 (lines 88-97), which describes a label-only request as a direct snapshot + relabel with no drafts. Consult drafts are fresh emits, so they could not show the hand edits anyway.

F7. UX-unreasonable. `skills/revise/SKILL.md:98-100` tells the user their hand-edited files are "kept under `history/rNNN/extras/`". They are deleted with the revision after five more snapshots, and every undo and redo counts as one. In this test the extras lived for 5 operations; the delivered state S1 and both real change revisions were pushed out by three undo/redo calls plus two tweaks. The CLI prints only `"removed":["r003"]`, with no sign that extras went with it (`scripts/src/revisions.mjs`, rotation at the end of `snapshotRun`).

F8. ambiguity / bug. `closing-contract.md` step 4 previews "each individual output file" only. The combined file (the main deliverable: canvas page, `↳ title` lines, page links) is never looked at. Also `preview` without `--out` writes to `<tmp>/zukai-preview/<basename>.png` (`scripts/src/preview.mjs:369`): the main diagram `drawio/<slug>.drawio` and the combined `<run-slug>.drawio` share a basename whenever the run slug equals the main slug (the documented pattern), and any two projects or sessions with the same slug overwrite each other (the folder already held PNGs of other sessions during this test).

F9. visual-defect (emitter). In the combined file a `ref` step shows the part's title as second line; the skill requires "Each sub-diagram's title names the element it details" (`SKILL.md:90`), so the box reads the same text twice: `Kiểm tra điều kiện hoàn tiền / ↳ Kiểm tra điều kiện hoàn tiền` (`a-png/s1-combined-tile1.png`).

F10. visual-defect (emitter). Main diagram: the guard "duyệt" of `f-lead-yes` is placed below the point where `f-cs-approved` joins the same trunk, 60 to 400 px from its decision depending on the lane of the merge, so it reads as a guard on the merged flow (`a-png/s1-round1-refund-approval.png`, still in `s6-final-refund-approval.png`). "từ chối" sits about 400 px away from its decision.

F11. visual-defect (emitter). Activity layout: an action in the leftmost column whose flow goes to a merge below is routed round the far right of the lane with two line jumps, although a straight path exists (`a-png/s1-round1-…-01-eligibility-check.png`, `a-png/s2-round1-…-01-eligibility-check.png`). Repro IR: `SP/tmp-a/p01-a.ir.json` (`cli emit --to drawio`). Workaround was a structural change (separate final node), not a layout hint.

F12. UX-unreasonable. The hint of that warning says "moving one of the nodes to another lane avoids it" for a diagram with a single lane; reordering `actions` or `flows` changes nothing (`SP/tmp-a/p01-a.ir.json`, `p01-b.ir.json`).

F13. visual-defect (minor). Single-file emit of a `ref` step shows the slug; a long slug wraps and touches the subroutine's side bars: `↳ refund-approval-01-eligibility-check-` / `business` (`a-png/s1-round2-refund-approval-business.png`).

F14. ambiguity. `variants.md` and `SKILL.md` do not say what a `-business` main diagram's `ref` points to (the technical part or the `-business` part), nor whether parts get business views at all ("one `<slug>-business.ir.json` per diagram"), nor how to title them (technical and business part pages end up with the same tab name). I pointed business refs at the business parts. `ir-diff.mjs:147` skips `-business` diagrams in the "not the ref of any element" hint, so neither choice is checked.

F15. doc-contradiction. `variants.md:51` quotes the opening question as "Who will read it?"; `SKILL.md:95-98` says the question must ask for the view, not the reader ("Which view?" / "Góc nhìn của diagram?").

F16. UX-unreasonable. Audience `both` on a request with no technical names gives three business IRs that are near copies of the technical ones (6 diagrams, 7 pages, canvas of 7 preview tiles). Nothing in the skill tells the agent to say so or to offer one view.

F17. ambiguity. Without `AskUserQuestion`, `SKILL.md:118-120` says to send "the full numbered list below" of kinds; it does not say to drop the list when `--kind` is given. Read as: only scope and view are asked.

F18. bug (minor). `cli diff` shows flows with `"label":""` (`ir-diff.mjs:20` ignores `guard`) and changed elements list field names without old and new values, so the "change list in plain words" required by revise step 9 cannot be written from the diff alone.

F19. ambiguity. `clarify-protocol.md` scope section vs `SKILL.md:79-82`: lifting a decisive rule of a sub-flow into the main diagram is stated for `overview` only. Under `detailed` it is unclear whether the main diagram repeats the part's decisions; I used one three-way decision "Kết quả kiểm tra?" after the `ref` step.

F20. UX (minor). `bundle --canvas all` is recorded and recovered by `drift` as an explicit id list, not `"all"`, so the "`canvas: "all"` becomes `--canvas all`" branch of the revise section never applies and the list must be maintained by hand on every added diagram. Every undo/redo is listed as `undo to rNNN`, so after a few of them the revision list no longer tells the user which entry is which state.

## 3. Questions "asked" (verbatim) and answers used

Step 1, opening message (text, no tool):

> 1. Mức chi tiết?
>    1. Tổng quan (overview) – gợi ý: chỉ một diagram chính, khoảng 15 phần tử, mỗi luồng con gộp thành một bước; quy tắc quyết định được đưa lên diagram chính.
>    2. Chi tiết (detailed): diagram chính và mỗi luồng con đáng vẽ riêng một diagram phụ, liên kết từ bước tương ứng.
> 2. Góc nhìn của diagram?
>    1. Kỹ thuật (technical) – gợi ý: developer, reviewer; giữ tên component, endpoint, bảng dữ liệu.
>    2. Nghiệp vụ (business): PM, khách hàng, vận hành; chỉ luồng và quy tắc nghiệp vụ.
>    3. Cả hai (both): một bản mỗi loại trong cùng thư mục.
>
> Trả lời bằng số, tên hoặc "mặc định".

Answers: detailed; both.

Step 1, clarify round 1:

> 1. Ai tham gia quy trình? Liệt kê từng vai trò/hệ thống, mỗi bên một làn, theo thứ tự muốn hiển thị. (bắt buộc)
> 2. Điều gì bắt đầu quy trình, ở làn nào? [làn đầu tiên]
> 3. Các bước theo thứ tự, mỗi bước do làn nào thực hiện? (bắt buộc)
> 4. Luồng rẽ nhánh ở đâu? Nêu câu hỏi và điều kiện của từng nhánh. [không có]
> 5. Có việc nào làm song song không? Bước nào chạy cùng lúc và gộp lại ở đâu? [không có]
> 6. Khi nào coi là xong? Có nhiều điểm kết thúc không (hoàn tất, bị từ chối)? [một điểm kết thúc]
> 7. Luồng con nào đáng có diagram riêng? [không có]

Answers: the process facts of the sheet; sub-flows "kiểm tra điều kiện hoàn tiền" and "hoàn tiền qua cổng thanh toán" (sequence); the rest "bạn tự quyết, theo mặc định" (recorded as `assumed:` notes).

Step 1, closing question after the IR draft: "Xuất bản nháp này ra drawio, hay bạn muốn đổi gì?" Answer: none on the sheet, treated as yes (silence rule).

Step 2, consult question before drafts:

> 1. Hàng chưa về kho thì sao? a) Chờ, kiểm tra lại sau (quay lại bước kiểm tra) b) Từ chối yêu cầu c) Chuyển Trưởng nhóm quyết định
> 2. Thay đổi áp dụng cho diagram nào? a) Diagram chính, phần "Kiểm tra điều kiện hoàn tiền" và các bản nghiệp vụ b) Chỉ phần "Kiểm tra điều kiện hoàn tiền"

Answers: 1a; 2a.

Step 2, draft choice: "A: CSKH kiểm tra hàng về kho" / "B: Kho xác nhận hàng đã về (thêm làn Kho)" / "Bỏ hết bản nháp". No answer on the sheet and no default in the protocol; took A.

Step 3, clarify gate: "Đổi tên ở những diagram nào? a) Diagram chính, bản nghiệp vụ và tiêu đề phần chi tiết của bước đó b) Chỉ diagram chính". Answer: a (from the task's verification list).

Step 4, first undo, hand-edit question: "File refund-approval.drawio và drawio/refund-approval.drawio có chỉnh tay (ô 'Từ chối và gửi email cho khách' bị dời; nhiều ô khác lệch do đổi nhãn không vẽ lại). Hoàn tác sẽ vẽ lại. a) Vẽ lại và mất các chỉnh tay (bản cũ lưu ở history/r003/extras/) b) Dừng". No answer and no default; took a.

## 4. Files

- Run folder: `SP/proj-clarify/diagrams/20261111_refund-approval/`. Final `source/` = S2 with `submit` = "Gửi yêu cầu hoàn tiền trên website" (the rename of step 3 was undone in step 4, as scripted).
- PNGs opened and judged: `a-png/s1-round1-refund-approval.png`, `s1-round1-refund-approval-01-eligibility-check.png`, `s1-round1-refund-approval-02-gateway-refund.png`, `s1-round2-refund-approval-business.png`, `s1-combined-tile1.png`, `s2-round1-refund-approval.png`, `s2-round1-refund-approval-01-eligibility-check.png`, `s2-round2-refund-approval-01-eligibility-check.png`, `s3-main-relabelled.png`, `s6-final-refund-approval.png`.
- Rendered but not opened: `s1-round2-refund-approval.png` (same IR as the opened `SP/tmp-a/main-a.png`), `s1-round2-refund-approval-02-gateway-refund-business.png`, `s1-combined-tile2..7.png`, `s6-final-refund-approval-02-gateway-refund.png`. `s1-combined.png` is a stale copy of the main diagram's preview, not the combined file (effect of F8).

Unverified: that draw.io desktop rejects or merges the duplicate page ids of F2a (only the file content and `drift` were checked); F5's count was measured once, on the state before the first undo.
