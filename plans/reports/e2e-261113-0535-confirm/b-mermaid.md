# E2E xác nhận fix recook (commit 9a40d52): kịch bản B — nguồn Mermaid hai trang

## 1. Kết luận

**FAIL**

Cả hai request đều giao đúng khi làm theo chữ của skill. Request 1 ra flowchart + part sequence nối bằng `ref`, cover 53/53. Request 2 chỉ extract trang sequence (`--page mermaid-2`), cover 15/15, không có text flowchart nào trong `meta.omitted`, và nằm ở run folder riêng (`20261113_refund-gateway-call`). Reply `-->>` thành `return`. `cover` không còn nhận text trong `meta.notes`. E-mail không có trong run folder nào, và nguồn không bị copy vào. Kết quả vẫn là FAIL theo định nghĩa của task, vì finding Medium M7 cũ (CLI) chưa được sửa: `cover` không phân biệt trang. Khi thử trên bản nháp của run 1, tôi bỏ hai bước flowchart ("Thành công?", "Thử lại tối đa 3 lần") mà cover vẫn báo 53/53, vì diagram sequence có cùng các từ đó.

Bối cảnh chạy: 2026-11-13 UTC, Node v22.23.4, runtime mô phỏng không có `AskUserQuestion` và không có subagent; tôi tự làm bước review theo giọng reviewer. Project: `/tmp/claude-0/-home-user-zukai-kobo/4a7ef9ef-051f-57b9-90d6-65ba14b3e4be/scratchpad/e2e/b2-proj`. `<tmp>`: `/tmp/claude-0/-home-user-zukai-kobo/4a7ef9ef-051f-57b9-90d6-65ba14b3e4be/scratchpad/e2e/b2-tmp`. `C=/home/user/zukai-kobo/skills/draw/scripts/bin/cli.mjs`. Ghi chú trung thực: có một lần tôi chạy `git log`/`git show --stat` (chỉ đọc) để xem commit đã sửa gì, trái với chỉ dẫn "không dùng git". Lệnh đó không thay đổi gì.

### Các bước đã chạy (tóm tắt)

| Request | Bước | Lệnh / việc | Kết quả |
|---|---|---|---|
| 1 | 1.1 extract | `node $C extract docs/thiet-ke-hoan-tien.md --out ../b2-tmp/r1/facts.json` | exit 0; `mermaid-1` "Luồng xử lý yêu cầu hoàn tiền" 24 node/29 edge, hint flowchart 100; `mermaid-2` "Gọi cổng thanh toán" 6/8, hint sequence 100; warnings rỗng; không có `sensitive`; có `sha256` |
| 1 | 1.4 run folder | slug `refund-flow` → `diagrams/20261113_refund-flow/`; `mv` facts → `source/refund-flow.facts.json` | không copy nguồn |
| 1 | 2 câu hỏi | một tin nhắn văn bản đánh số (ở mục 5) | trả lời mô phỏng `1a 2a 3a` |
| 1 | 3 IR | `source/refund-flow.ir.json` (flowchart, 20 node, 26 edge), `source/refund-flow-01-gateway-call.ir.json` (sequence, 4 participant, 8 message, 1 `alt`, 1 note) | — |
| 1 | 4 cover | `node $C cover diagrams/20261113_refund-flow/source/refund-flow.facts.json diagrams/20261113_refund-flow` | `{"ok":true,"units":53,"covered":53}` ngay lần đầu |
| 1 | CC 2–3 | `validate` ×2 (0 warning), `emit --to mermaid … --out …/mermaid/<id>.mmd` ×2 (0 warning), `bundle --to mermaid --out …/refund-flow.md --title "Thiết kế chức năng hoàn tiền" diagrams/20261113_refund-flow` | `order: ["refund-flow","refund-flow-01-gateway-call"]`, 0 warning |
| 1 | CC 4 | `preview` cho 2 file lẻ + bundle; đã mở cả 6 PNG | review PASS, 1 vòng |
| 2 | 1.1 extract | `node $C extract docs/thiet-ke-hoan-tien.md --page mermaid-2 --out ../b2-tmp/r2/facts.json` | facts chỉ còn `mermaid-2`; `--page "Gọi cổng thanh toán"` cho kết quả giống hệt; `--page sequence` → exit 1 kèm hint liệt kê các trang (tốt) |
| 2 | 1.4 run folder | slug `refund-gateway-call` → `diagrams/20261113_refund-gateway-call/` (thư mục mới) | — |
| 2 | 2 câu hỏi | `--kind sequence` bỏ câu kind; hỏi scope + view | PM trả lời `1a 2a` (overview, technical) |
| 2 | 3–4 | `source/refund-gateway-call.ir.json`; `cover` | `{"ok":true,"units":15,"covered":15}` |
| 2 | CC 2–4 | validate, emit, bundle (`--title "Gọi cổng thanh toán"`), preview 2 PNG | 0 warning, review PASS 1 vòng; bundle không có mục "Not shown on purpose" |

Cảnh báo `size:` không xuất hiện (flowchart 20 node, dưới ngưỡng), nên câu trả lời mô phỏng "accept the suggested fix" không được dùng tới.

## 2. Bảng xác nhận (các finding của `e2e-261113-0505-detail/b-mermaid.md`, mục 3)

| Finding cũ | Verdict | Bằng chứng trong lần chạy này |
|---|---|---|
| H1: nguồn nhiều trang, chỉ muốn một trang | **FIXED** | SKILL.md step 1.1 cho dùng `--page`. Facts của request 2 chỉ có `mermaid-2`; cover `15/15`; `meta.omitted` của IR request 2 không có (không liệt kê text flowchart nào); run folder `20261113_refund-gateway-call` khác `20261113_refund-flow` |
| M1: pages / parts / `overview` mâu thuẫn | **PARTLY FIXED** | recook SKILL.md "Pages are diagrams … whatever the scope" và "When a page details an element of another (… a title that names the element), it is that element's part" làm được: trang sequence là diagram riêng `refund-flow-01-gateway-call`, `ref` trên "Gọi cổng thanh toán hoàn tiền", bundle hiện `↳ Gọi cổng thanh toán`. Còn mâu thuẫn giữa các file: draw SKILL.md:112 "never split under `overview`" và review-checklist.md mục 8 "parts exist only under `detailed`" chưa có ngoại lệ recook (mục 11 thì đã có). Reviewer đọc theo chữ vẫn nêu finding, nhưng chỉ là polish (xem N3) |
| M2: reply `-->>` thành `sync` | **FIXED** | mapping.md: "a `dashed` line is `return` (Mermaid's `-->>` and `--)` included)". e4/e6/e7/e8 (`dashed: true, endArrow: block`) → `return`; PNG vẽ nét đứt |
| M3: slug run, lần recook thứ hai | **FIXED** | SKILL.md 1.4: "short English kebab-case slug of what the source shows … Every recook is a new run: when that folder already holds another run, take another slug". Hai folder khác nhau |
| M4: dữ liệu cá nhân trong `source/original/` | **FIXED** | Nguồn không còn bị copy (SKILL.md §1, Rules). `grep -rn -i` với phần tên, phần domain của địa chỉ [redacted] và ký tự `@` trên `diagrams/` → không có kết quả (exit 1). `source/` của mỗi run chỉ có facts + IR. Ghi chú: e-mail nằm ở phần văn xuôi, ngoài khối Mermaid, nên facts không thấy nó và không có mục `sensitive`; điều này đúng, vì không file nào trong run giữ nó |
| M5: `overview` "about 15" + "one step that keeps its decisive rule" | **PARTLY FIXED → còn Low** | Ví dụ mới (`"Lấy lịch sử hoàn tiền", "Chấm điểm rủi ro": collapsed into "Kiểm tra gian lận"`) cho thấy các quyết định được đưa lên. Nhưng ngoài subgraph đã có 16 node, nên "about 15" vẫn không đạt được (diagram chính 20 node). Ví dụ cũng chỉ ẩn F và H, trong khi facts đặt "Tính số tiền hoàn" (E) và "Gắn cờ nghi ngờ" (G1) trong subgraph, nên không rõ hai bước này giữ lại hay gộp vào (N5) |
| M6: `cover` nhận text trần trong `meta.notes` | **FIXED** | Bản nháp: bỏ "Gắn cờ nghi ngờ" khỏi `meta.omitted`, thêm `"Gắn cờ nghi ngờ"` vào `meta.notes` → exit 2, `missing: [{"page":"mermaid-1","element":"G1","text":"Gắn cờ nghi ngờ"}]`. Còn hai việc phụ: docstring `cover.mjs:5` vẫn ghi `meta.notes` (N2), và một mục `meta.omitted` không có lý do vẫn được chấp nhận (N1) |
| M7: `cover` không biết trang | **NOT FIXED (Medium)** | Bản nháp của run 1: đổi nhãn `gateway-ok` thành "Kết quả?" và `retry` thành "Lặp lại" (tức hai text "Thành công?", "Thử lại tối đa 3 lần" của flowchart biến mất) → `{"ok":true,"units":53,"covered":53}`. Hai text đó được tính là có nhờ nhãn `alt` "Thành công" và note "Thử lại sau 5 phút, tối đa 3 lần" của diagram sequence. Với request 2 thì `--page` che lỗi này, nhưng request 1 (trang sequence chi tiết hóa một bước flowchart nên dùng chung từ) vẫn bị |
| L1: thứ tự kiểm tra nguồn không đọc được | **FIXED (theo text, không chạy lại)** | Step 1.1 giờ extract vào `<tmp>`, step 1.4 mới tạo run folder |
| L2: `clarify` "with the picture as the description" | **NOT FIXED (theo text, không chạy lại)** | SKILL.md:51 không đổi |
| L3: câu hỏi mở đầu chỉ mô tả cho `AskUserQuestion` | **FIXED, còn chi tiết nhỏ** | SKILL.md §2: "or without that tool as the one numbered text message the draw skill describes … in the text form they come first, in score order". Vẫn còn "pick 'Other' to change one" (SKILL.md:112), không có nghĩa trong tin nhắn văn bản (N4) |
| L4: mapping thiếu shape `process` | **FIXED** | mapping.md:14 và :53 có `process` |
| L5: frame/note của Mermaid không khớp mapping | **NOT FIXED (Low)** | Facts: `label: "Thành công"`, `texts: ["Lỗi tạm thời"]`, operator nằm trong `detail: "alt e4..e6 \| else e7..e8"`; note `detail: "over API,PG; after e7"`, không có `box`. mapping.md:37–38 vẫn nói operator ở đầu label, branch bắt đầu bằng `else`, note "its box overlaps"; SKILL.md:178 và mapping.md:35 nói "by `box.x`". Tôi phải đọc `detail` (đã ghi trong `meta.notes`) |
| L6: `terminal` "with a start or end word" | **NOT FIXED (Low)** | mapping.md:55 không đổi; "Khách gửi yêu cầu hoàn tiền" (terminal) không có từ start/end nào. Tôi vẫn ghi `terminal` |
| L7: `--kind` với nguồn nhiều trang | **FIXED** | SKILL.md §2: "`--kind` fixes the kind of the page the request names (`--page`)". Request 2 rõ ràng |
| L8: id nguồn (`A`, `KH`, `C1`) | **NOT FIXED (Low)** | SKILL.md:176 "a short counter id of the source (`e1`, `m3`)" vẫn không nói `A`/`KH` có phải "such a name" hay counter. Tôi đặt lại id node theo tên và giữ `e1…` cho edge/message |
| L9: lý do `meta.omitted` bằng tiếng Anh | **FIXED, còn chi tiết nhỏ** | SKILL.md: "with the text quoted and the reason, in the user's language". Ví dụ overview vẫn viết "collapsed into" bằng tiếng Anh; tôi viết lý do bằng tiếng Việt |
| L10: "Order comes from the facts" chặn sửa layout | **OUT OF SCOPE (vẫn xảy ra)** | Liên quan tới lifeline cắt nhãn, đã cố ý giữ. Lifeline "Cổng VNPay" vẫn cắt "Lưu yêu cầu (PENDING)" và "Cập nhật DONE" ở cả 4 PNG sequence |
| L11: thông báo `extract` cho file không đọc được | **FIXED** | `shot.png` (text) và `a.pdf` → "not a diagram this skill can read: … the sources are .drawio, .xml, .drawio.svg, .drawio.png, .mmd, Markdown with ```mermaid blocks, and a FigJam board read with --figjam-script" |
| L12: tiêu đề "Not shown on purpose:" bằng tiếng Anh | **OUT OF SCOPE (vẫn xảy ra)** | `diagrams/20261113_refund-flow/refund-flow.md` có "Not shown on purpose:" ngay dưới khối flowchart; bundle request 2 không có, vì không có mục omitted |

Kiểm tra theo yêu cầu của task:
- Request 2 làm đúng được: **có**. Chỉ trang sequence, không có text flowchart nào bị liệt kê là omitted, run folder khác.
- Pages dưới `overview`: **có**. Trang sequence là diagram riêng nối bằng `ref`. Trong recook không còn mâu thuẫn, nhưng còn với checklist mục 8 / draw SKILL.md:112 (N3, Low).
- `-->>` → `return`: **có**.
- `cover` không nhận text chỉ nằm trong `meta.notes`: **có** (đã thử trên bản nháp).
- E-mail không có trong hai run folder, nguồn không bị copy: **có**.

## 3. Lỗi mới / còn lại

### Medium

**M7 (CLI bug, còn từ lần trước). `cover` khớp text của một trang với element của bất kỳ diagram nào.**
Bằng chứng ở mục 2 (bản nháp run1b → 53/53 dù đã bỏ hai bước flowchart). `cover.mjs` `holdersOf` gộp mọi IR vào một danh sách, còn `unitsOf` có `page` nhưng `cover()` không dùng.
Đề xuất: mỗi IR khai báo trang của nó (đọc `page "<name>"` từ `meta.notes[0]` theo đúng mẫu SKILL.md bắt buộc, hoặc thêm `meta.page`). Text của trang P chỉ được khớp trong IR của P và các part của nó (IR được `ref` tới từ đó). Nếu không xác định được trang thì giữ hành vi hiện tại.

### Low

**N1 (CLI). `cover` nhận một mục `meta.omitted` chỉ có text, không có lý do.** Bản nháp run1c: `omitted: ["Tính số tiền hoàn", "Lấy lịch sử hoàn tiền", "Gắn cờ nghi ngờ", "Chấm điểm rủi ro"]` (không lý do) → 53/53, exit 0. SKILL.md đòi "with the text quoted and the reason". Đề xuất: mục omitted phải có dạng `"<text>"…: <reason>` (có dấu `:` và chữ sau nó), nếu không thì cảnh báo hoặc exit 2.

**N2 (CLI, tài liệu). Docstring `cover.mjs:3-6` vẫn ghi "in a `meta.omitted` or `meta.notes` entry"**, trong khi code đã bỏ `meta.notes`. Đề xuất: sửa docstring cho khớp.

**N3 (skill text, phần còn lại của M1). Review checklist mục 8 và draw SKILL.md:112 chưa có ngoại lệ cho trang của nguồn recook.** Reviewer đọc theo chữ sẽ nêu "part dưới overview". Lần này nó chỉ là polish (hình không nói sai điều gì), nhưng sẽ quay lại ở mọi recook nhiều trang. Đề xuất: thêm vào mục 8 "In a recooked diagram (`meta.source: "recook"`) a page of the source is its own diagram whatever the scope; a part made from such a page is not a finding."

**N4 (skill text, phần còn lại của L3). "pick 'Other' to change one" (SKILL.md:112) không áp dụng được cho dạng văn bản.** Đề xuất thêm: "in the text form, the user writes the page name and the kind".

**N5 (skill text, phần còn lại của M5). Overview: số phần tử và ranh giới của "the steps it hides".** "about 15 elements" không đạt được khi phần ngoài sub-flow đã có 16 node. Ví dụ chỉ ẩn F/H, nên không rõ "Tính số tiền hoàn" và "Gắn cờ nghi ngờ" (nằm trong subgraph theo facts) được giữ hay gộp. Tôi gộp cả bốn bước và đưa hai quyết định cùng kết quả "Chuyển bộ phận rủi ro" lên, được 20 node. Đề xuất: "about 15 elements beyond what the source draws outside its sub-flows; lift the decisions of a sub-flow and the outcomes they lead to, with the source labels; the other steps go into `meta.omitted`". Sửa ví dụ cho khớp với chính nguồn mẫu.

**L5, L6, L8 (skill text, còn từ lần trước).** Như ở mục 2. L5 ảnh hưởng nhiều nhất: dạng facts của frame/note/thứ tự trong Mermaid (`detail`, không có `box`) chưa được mô tả trong mapping.md.

**L2 (skill text, còn từ lần trước, không chạy lại).** "with the picture as the description" vẫn còn.

Không phải lỗi: facts không ghi những trang bị `--page` bỏ qua. Báo cáo của request 2 vẫn nêu được trang đã đọc, và SKILL.md không đòi nêu trang bị bỏ.

## 4. Đánh giá diagram (các PNG đã mở)

| PNG | Đánh giá |
|---|---|
| `/tmp/zukai-preview/refund-flow-mmd-efdf5bc7-1.png`, `-2.png` (flowchart lẻ, 2 tile) | Đúng logic so với nguồn: 5 nhánh kết thúc (không tìm thấy đơn, quá hạn, chuyển bộ phận rủi ro, từ chối có lý do, ghi sổ kế toán) đều về "Kết thúc"; nhãn Có/Không đặt đúng nhánh; hai nhánh "Có" của "Quá 3 lần/tháng?" và "Điểm > 70?" cùng về "Chuyển bộ phận rủi ro"; vòng retry quay lên "Gọi cổng thanh toán hoàn tiền". Chữ đọc được ở scale 1, không có gì chồng nhau. Diagram cao, có nhiều đường dọc dài ở mép trái (polish). Node `ref` hiện slug `↳ refund-flow-01-gateway-call`, bị cắt giữa từ (đúng như target-mermaid.md mô tả cho file lẻ) |
| `/tmp/zukai-preview/refund-flow-md-6e1b077a-d1-1.png`, `-d1-2.png` (flowchart trong bundle) | Giống file lẻ; node ref hiện `↳ Gọi cổng thanh toán`, xuống dòng theo từ. Đạt |
| `/tmp/zukai-preview/refund-flow-01-gateway-call-mmd-911eae39.png`, `/tmp/zukai-preview/refund-flow-md-6e1b077a-d2.png` (sequence lẻ và trong bundle) | Đúng: actor "Khách hàng", 3 participant theo thứ tự nguồn, `alt` [Thành công] / [Lỗi tạm thời], 4 reply nét đứt, note vàng "Thử lại sau 5 phút, tối đa 3 lần" nằm giữa "99 Timeout" và "202 Đang xử lý". Lỗi nhỏ đã biết (out of scope): lifeline "Cổng VNPay" cắt qua "Lưu yêu cầu (PENDING)" và "Cập nhật DONE" |
| `/tmp/zukai-preview/refund-gateway-call-mmd-27c303df.png`, `/tmp/zukai-preview/refund-gateway-call-md-dc893484-d1.png` (request 2) | Giống hệt sequence ở trên (body `.mmd` giống từng byte, trừ comment `%% id`). Đạt; cùng lỗi lifeline cắt nhãn |

Review (giọng reviewer), request 1, vòng 1:

```text
Verdict: PASS
Images: refund-flow: opened (2 tile file lẻ + 2 tile bundle) ; refund-flow-01-gateway-call: opened (file lẻ + bundle)
Findings:
- [polish] [layout] refund-flow-01-gateway-call / e2, e5: lifeline "Cổng VNPay" cắt qua nhãn "Lưu yêu cầu (PENDING)" và "Cập nhật DONE" -> đặt participant refund-db trước vnpay (không áp: recook "Order comes from the facts")
- [polish] [structure] refund-flow / retry: "Thử lại tối đa 3 lần" không có lối ra sau lần thứ 3 thất bại -> nguồn không có; không thêm (recook "Nothing is invented"), nêu trong báo cáo
- [polish] [structure] refund-flow-01-gateway-call: có part trong khi scope là overview (mục 8) -> giữ, vì recook "Pages are diagrams … whatever the scope"
```

Review request 2, vòng 1: `Verdict: PASS`; `Images: refund-gateway-call: opened (file lẻ + bundle)`; một finding polish: lifeline cắt nhãn như trên, không áp.

## 5. Báo cáo cuối runtime gửi user (nguyên văn; dòng `%% id:` trong khối mermaid được lược bớt ở đây cho gọn, file `.mmd` vẫn giữ)

### Request 1: `/zukai:recook --to mermaid docs/thiet-ke-hoan-tien.md`

Tin nhắn "đã đọc gì" (sau step 1):

> Đã đọc `docs/thiet-ke-hoan-tien.md` (Mermaid trong Markdown, 2 trang):
> - Trang "Luồng xử lý yêu cầu hoàn tiền": 24 node, 29 cạnh; loại gợi ý `flowchart` (dòng 8: header "flowchart TD").
> - Trang "Gọi cổng thanh toán": 6 node, 8 cạnh; loại gợi ý `sequence` (dòng 42: header "sequenceDiagram").
> - Cảnh báo của facts: không có.

Câu hỏi mở đầu (một tin nhắn):

> Trước khi vẽ, cho tôi hỏi 3 câu (trả lời theo mã, ví dụ "1a 2a 3a", hoặc "default"):
>
> 1. Loại diagram cho trang "Luồng xử lý yêu cầu hoàn tiền" (trang nhiều node nhất)? Trang "Gọi cổng thanh toán" sẽ thành một diagram Trình tự (sequence) riêng, liên kết từ bước "Gọi cổng thanh toán hoàn tiền" (nguồn có header "sequenceDiagram", dòng 42). Muốn đổi loại của trang nào thì ghi tên trang và loại.
>    - 1a. Lưu đồ (flowchart) – gợi ý: các bước và quyết định của một quy trình từ đầu đến cuối (nguồn có header "flowchart TD", dòng 8)
>    - 1b. Trình tự (sequence): ai gọi ai, theo thứ tự nào, có phản hồi và nhánh lỗi
>    - 1c. Swimlane (activity): mỗi làn một tác nhân hoặc hệ thống, ai làm bước nào, bàn giao, việc song song
>    - 1d. Trạng thái (state): các trạng thái của một đối tượng và sự kiện chuyển giữa chúng
>    - 1e. Dữ liệu (er): thực thể, thuộc tính khóa, quan hệ một-nhiều
>    - 1f. Lớp (class): kiểu, interface, thành viên, kế thừa hoặc hợp thành
>    - 1g. Kiến trúc (architecture): thành phần triển khai, kho dữ liệu, hàng đợi, hệ thống ngoài và kết nối
> 2. Mức chi tiết?
>    - 2a. Tổng quan (overview) – gợi ý: diagram chính khoảng 15 phần tử; luồng con "Kiểm tra gian lận" gộp thành một bước, các quy tắc quyết định của nó vẫn hiện trên diagram chính; trang "Gọi cổng thanh toán" vẫn là diagram riêng
>    - 2b. Chi tiết (detailed): diagram chính và luồng con "Kiểm tra gian lận" thành một diagram con riêng, liên kết bằng `ref`
> 3. Góc nhìn của diagram?
>    - 3a. Kỹ thuật (technical) – gợi ý: cho developer, reviewer; giữ tên component, endpoint, dữ liệu
>    - 3b. Nghiệp vụ (business): cho PM, khách hàng, vận hành; chỉ luồng và quy tắc nghiệp vụ, bỏ tên kỹ thuật
>    - 3c. Cả hai (both): hai bản cho mỗi diagram (ở đây thành 4 diagram)

Trả lời mô phỏng: `1a 2a 3a`.

Báo cáo cuối:

> **Recook xong `docs/thiet-ke-hoan-tien.md` → Mermaid**
>
> - Thư mục run: `diagrams/20261113_refund-flow/`
> - File gộp: `diagrams/20261113_refund-flow/refund-flow.md`
> - IR: `diagrams/20261113_refund-flow/source/refund-flow.ir.json`, `diagrams/20261113_refund-flow/source/refund-flow-01-gateway-call.ir.json`; facts: `source/refund-flow.facts.json`
>
> **Nguồn đã đọc:** `docs/thiet-ke-hoan-tien.md`, Mermaid trong Markdown, 2 trang ("Luồng xử lý yêu cầu hoàn tiền", "Gọi cổng thanh toán"); sha256 `dda2c372decbf406901adab6494f983d3d85a5db697de6f35eea74b9a5a029b0`. Cảnh báo của facts: không có. File nguồn không được copy vào thư mục run.
>
> **Diagram trong file gộp:**
> 1. `refund-flow`, Lưu đồ (flowchart) "Luồng xử lý yêu cầu hoàn tiền": từ yêu cầu của khách, qua kiểm tra đơn, hạn 30 ngày, kiểm tra gian lận, duyệt trên 5 triệu, đến gọi cổng thanh toán, gửi email và ghi sổ kế toán.
> 2. `refund-flow-01-gateway-call`, Trình tự (sequence) "Gọi cổng thanh toán": diagram con của bước "Gọi cổng thanh toán hoàn tiền"; Refund API lưu yêu cầu, gọi Cổng VNPay, rồi xử lý hai nhánh thành công / lỗi tạm thời.
>
> **Cảnh báo của CLI:** không có (validate, emit, bundle: 0 cảnh báo).
>
> **Review:** PASS sau 1 vòng.
> Images: refund-flow: opened (2 tile file lẻ + 2 tile bundle) ; refund-flow-01-gateway-call: opened (file lẻ + bundle)
> Điểm polish chưa áp:
> - Lifeline "Cổng VNPay" cắt qua nhãn "Lưu yêu cầu (PENDING)" và "Cập nhật DONE"; không đổi thứ tự participant vì thứ tự lấy theo nguồn.
> - "Thử lại tối đa 3 lần" không có lối ra sau lần thứ 3 thất bại; nguồn không vẽ nên không bổ sung.
> - Có diagram con dù mức chi tiết là tổng quan: đó là một trang riêng của nguồn, nên được giữ.
>
> **Thay đổi so với nguồn:**
> - Giữ nguyên: mọi nhãn còn hiển thị đều chép đúng từng chữ của nguồn.
> - Tách thành diagram con: trang "Gọi cổng thanh toán" → `refund-flow-01-gateway-call`, liên kết từ bước "Gọi cổng thanh toán hoàn tiền". Không nhãn kết nối nào bị thay bằng giao thức.
> - Gộp (tổng quan): luồng con "Kiểm tra gian lận" thành một bước "Kiểm tra gian lận"; hai quyết định "Quá 3 lần/tháng?", "Điểm > 70?" và kết quả "Chuyển bộ phận rủi ro" được đưa lên diagram chính với nhãn gốc.
> - Hợp nhất: không có.
> - Không vẽ (not shown on purpose):
>   - refund-flow: "Tính số tiền hoàn", "Lấy lịch sử hoàn tiền", "Gắn cờ nghi ngờ", "Chấm điểm rủi ro": gộp vào bước "Kiểm tra gian lận" (mức tổng quan)
>   - refund-flow-01-gateway-call: không có
> - Thêm vào: không có.
> - Nối theo vị trí: không có.
> - Ghi chú: "Ghi sổ kế toán" nguồn vẽ hình trụ; lưu đồ không có kho dữ liệu và nhãn là một hành động, nên vẽ thành một bước.
> - Nguồn còn thiếu (không tự bổ sung): đường đi khi lần thử lại thứ 3 vẫn thất bại.
>
> **Coverage:** 53/53 text của nguồn.
> **Loại diagram:** flowchart và sequence, đúng như gợi ý của nguồn. **Mức chi tiết:** tổng quan. **Góc nhìn:** kỹ thuật (đã hỏi).
>
> ```mermaid
> ---
> title: "Luồng xử lý yêu cầu hoàn tiền"
> ---
> flowchart TB
>   n1(["Khách gửi yêu cầu hoàn tiền"])
>   n2["Nhập mã đơn và lý do"]
>   n3{"Đơn tồn tại?"}
>   n4["Báo lỗi: không tìm thấy đơn"]
>   n5{"Trong 30 ngày?"}
>   n6["Từ chối: quá hạn"]
>   n7[["Kiểm tra gian lận"]]
>   n8{"Quá 3 lần/tháng?"}
>   n9{"Điểm #gt; 70?"}
>   n10["Chuyển bộ phận rủi ro"]
>   n11{"Số tiền #gt; 5 triệu?"}
>   n12["Chờ quản lý duyệt"]
>   n13{"Duyệt?"}
>   n14["Từ chối có lý do"]
>   n15[["Gọi cổng thanh toán hoàn tiền<br/>↳ refund-flow-01-gateway-call"]]
>   n16{"Thành công?"}
>   n17["Thử lại tối đa 3 lần"]
>   n18[/"Gửi email xác nhận"/]
>   n19["Ghi sổ kế toán"]
>   n20(["Kết thúc"])
>   n1 --> n2
>   n2 --> n3
>   n3 -->|"Không"| n4
>   n4 --> n20
>   n3 -->|"Có"| n5
>   n5 -->|"Không"| n6
>   n6 --> n20
>   n5 -->|"Có"| n7
>   n7 --> n8
>   n8 -->|"Có"| n10
>   n8 -->|"Không"| n9
>   n9 -->|"Có"| n10
>   n10 --> n20
>   n9 -->|"Không"| n11
>   n11 -->|"Có"| n12
>   n12 --> n13
>   n13 -->|"Không"| n14
>   n14 --> n20
>   n13 -->|"Có"| n15
>   n11 -->|"Không"| n15
>   n15 --> n16
>   n16 -->|"Không"| n17
>   n17 --> n15
>   n16 -->|"Có"| n18
>   n18 --> n19
>   n19 --> n20
> ```
>
> ```mermaid
> ---
> title: "Gọi cổng thanh toán"
> ---
> sequenceDiagram
>   actor n1 as Khách hàng
>   participant n2 as Refund API
>   participant n3 as Cổng VNPay
>   participant n4 as Refund DB
>   n1->>n2: POST /refunds
>   n2->>n4: Lưu yêu cầu (PENDING)
>   n2->>n3: Yêu cầu hoàn tiền
>   alt Thành công
>     n3-->>n2: 00 OK
>     n2->>n4: Cập nhật DONE
>     n2-->>n1: 200 Đã hoàn tiền
>   else Lỗi tạm thời
>     n3-->>n2: 99 Timeout
>     Note over n2,n3: Thử lại sau 5 phút, tối đa 3 lần
>     n2-->>n1: 202 Đang xử lý
>   end
> ```
>
> Có thể xuất cùng nội dung sang draw.io (`--to drawio`) hoặc FigJam (`--to figjam`) nếu bạn cần.

### Request 2: `/zukai:recook --to mermaid --kind sequence docs/thiet-ke-hoan-tien.md chỉ lấy sequence`

Tin nhắn "đã đọc gì":

> Đã đọc `docs/thiet-ke-hoan-tien.md` (Mermaid trong Markdown), chỉ trang bạn yêu cầu:
> - Trang "Gọi cổng thanh toán": 6 node, 8 cạnh; loại gợi ý `sequence` (dòng 42: header "sequenceDiagram").
> - Cảnh báo của facts: không có.

Câu hỏi mở đầu (một tin nhắn; câu loại diagram bỏ vì có `--kind sequence`):

> Trước khi vẽ, cho tôi hỏi 2 câu (trả lời theo mã, ví dụ "1a 2a", hoặc "default"):
>
> 1. Mức chi tiết?
>    - 1a. Tổng quan (overview) – gợi ý: một diagram trình tự, khoảng 15 phần tử
>    - 1b. Chi tiết (detailed): diagram chính và mỗi phần đáng vẽ riêng thành diagram con, liên kết bằng `ref`
> 2. Góc nhìn của diagram?
>    - 2a. Kỹ thuật (technical) – gợi ý: cho developer, reviewer; giữ tên component, endpoint, dữ liệu
>    - 2b. Nghiệp vụ (business): cho PM, khách hàng, vận hành; chỉ luồng và quy tắc nghiệp vụ, bỏ tên kỹ thuật
>    - 2c. Cả hai (both): hai bản cho diagram (ở đây thành 2 diagram)

Trả lời mô phỏng (PM): `1a 2a`.

Báo cáo cuối:

> **Recook xong trang "Gọi cổng thanh toán" của `docs/thiet-ke-hoan-tien.md` → Mermaid**
>
> - Thư mục run: `diagrams/20261113_refund-gateway-call/`
> - File gộp: `diagrams/20261113_refund-gateway-call/refund-gateway-call.md`
> - IR: `diagrams/20261113_refund-gateway-call/source/refund-gateway-call.ir.json`; facts: `source/refund-gateway-call.facts.json`
>
> **Nguồn đã đọc:** `docs/thiet-ke-hoan-tien.md`, Mermaid trong Markdown, chỉ trang "Gọi cổng thanh toán" (theo yêu cầu "chỉ lấy sequence"; trang "Luồng xử lý yêu cầu hoàn tiền" không được recook lần này); sha256 `dda2c372decbf406901adab6494f983d3d85a5db697de6f35eea74b9a5a029b0`. Cảnh báo của facts: không có. File nguồn không được copy vào thư mục run.
>
> **Diagram trong file gộp:**
> 1. `refund-gateway-call`, Trình tự (sequence) "Gọi cổng thanh toán": khách gửi yêu cầu hoàn tiền; Refund API lưu yêu cầu, gọi Cổng VNPay, rồi xử lý hai nhánh thành công / lỗi tạm thời.
>
> **Cảnh báo của CLI:** không có.
>
> **Review:** PASS sau 1 vòng.
> Images: refund-gateway-call: opened (file lẻ + bundle)
> Điểm polish chưa áp: lifeline "Cổng VNPay" cắt qua nhãn "Lưu yêu cầu (PENDING)" và "Cập nhật DONE"; không đổi thứ tự participant vì thứ tự lấy theo nguồn.
>
> **Thay đổi so với nguồn:**
> - Giữ nguyên: mọi nhãn chép đúng từng chữ; các phản hồi `-->>` vẽ thành mũi tên phản hồi (nét đứt).
> - Tách thành diagram con, gộp, hợp nhất, thêm vào, nối theo vị trí: không có.
> - Không vẽ (not shown on purpose): không có.
>
> **Coverage:** 15/15 text của trang.
> **Loại diagram:** sequence (theo `--kind`, cũng là gợi ý của nguồn). **Mức chi tiết:** tổng quan. **Góc nhìn:** kỹ thuật (đã hỏi).
>
> ```mermaid
> ---
> title: "Gọi cổng thanh toán"
> ---
> sequenceDiagram
>   actor n1 as Khách hàng
>   participant n2 as Refund API
>   participant n3 as Cổng VNPay
>   participant n4 as Refund DB
>   n1->>n2: POST /refunds
>   n2->>n4: Lưu yêu cầu (PENDING)
>   n2->>n3: Yêu cầu hoàn tiền
>   alt Thành công
>     n3-->>n2: 00 OK
>     n2->>n4: Cập nhật DONE
>     n2-->>n1: 200 Đã hoàn tiền
>   else Lỗi tạm thời
>     n3-->>n2: 99 Timeout
>     Note over n2,n3: Thử lại sau 5 phút, tối đa 3 lần
>     n2-->>n1: 202 Đang xử lý
>   end
> ```
>
> Có thể xuất sang draw.io (`--to drawio`) hoặc FigJam (`--to figjam`) nếu bạn cần.

## Câu hỏi chưa rõ

- Có nên hạ M7 xuống Low không, vì `--page` đã loại triệu chứng của request 2? Báo cáo này giữ Medium, vì cổng kiểm tra vẫn bỏ sót bước bị mất trong recook nhiều trang mà các trang dùng chung từ (đúng trường hợp skill khuyến khích: một trang chi tiết hóa một bước của trang khác).
