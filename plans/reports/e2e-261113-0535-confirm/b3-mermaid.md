# E2E xác nhận fix recook (commit 42f5fa7): kịch bản B lần 3, nguồn Mermaid hai trang

## 1. Kết luận

**PASS**

Cả hai request đều giao đúng khi làm theo chữ của skill. Request 1 ra flowchart `refund-flow` và part sequence `refund-flow-01-gateway-call` nối bằng `ref`, cover 53/53. Request 2 chỉ có trang sequence, cover 15/15, nằm ở run folder riêng. M7 (Medium) đã sửa: probe bỏ "Thành công?" và "Thử lại tối đa 3 lần" giờ cho exit 2 và liệt kê đúng hai text đó. Không còn finding High hay Medium nào. Còn lại vài finding Low về câu chữ của skill (L2, L6, L8, phần ranh giới của N5) và hai điểm Low mới (N7, N8).

Bối cảnh chạy: 2026-11-13 UTC, Node v22.23.4. Runtime mô phỏng không có `AskUserQuestion` và không có subagent; tôi tự làm review theo giọng reviewer. Không dùng git. Project: `/tmp/claude-0/-home-user-zukai-kobo/4a7ef9ef-051f-57b9-90d6-65ba14b3e4be/scratchpad/e2e/b3-proj`. `<tmp>`: `/tmp/claude-0/-home-user-zukai-kobo/4a7ef9ef-051f-57b9-90d6-65ba14b3e4be/scratchpad/e2e/b3-tmp`. `C=/home/user/zukai-kobo/skills/draw/scripts/bin/cli.mjs`. `<draw-dir>` = `<recook-dir>/../draw`, có `scripts/bin/cli.mjs`.

### Các bước đã chạy

| Req | Bước | Lệnh / việc | Kết quả |
|---|---|---|---|
| 1 | 1.1 extract | `node $C extract docs/thiet-ke-hoan-tien.md --out ../b3-tmp/facts.json` | exit 0. `mermaid-1` "Luồng xử lý yêu cầu hoàn tiền": 24 node, 29 edge, hint `flowchart` 100 ("line 8: header \"flowchart TD\""). `mermaid-2` "Gọi cổng thanh toán": 6 node, 8 edge, hint `sequence` 100. Không có warning, không có `sensitive`. sha256 `dda2c372…a029b0` |
| 1 | 1.4 run folder | `diagrams/20261113_refund-flow/` (chưa có `diagrams/`); `mv` facts → `source/refund-flow.facts.json` | nguồn không bị copy |
| 1 | 2 câu hỏi | một tin nhắn văn bản đánh số (nguyên văn bên dưới) | trả lời mô phỏng `1a 2a 3a` |
| 1 | 3 IR | `source/refund-flow.ir.json` (flowchart: 22 node, 28 edge), `source/refund-flow-01-gateway-call.ir.json` (sequence: 4 participant, 8 message, 1 `alt`, 1 note) | `meta.notes[0]` theo mẫu `recooked from …, page "<name>"` |
| 1 | 4 cover | `node $C cover …/refund-flow.facts.json diagrams/20261113_refund-flow` | `{"ok":true,"units":53,"covered":53,"missing":[]}` ngay lần đầu |
| 1 | CC 2–3 | `validate` ×2, `emit --to mermaid --out mermaid/<id>.mmd` ×2, `bundle --to mermaid --out …/refund-flow.md --title "Thiết kế chức năng hoàn tiền" diagrams/20261113_refund-flow` | mọi lệnh exit 0, 0 warning; `order: ["refund-flow","refund-flow-01-gateway-call"]`. Không có cảnh báo `size:` (22 node) |
| 1 | CC 4 | `preview --max-px 1600` cho 2 file lẻ và bundle; mở cả 6 PNG | review PASS, 1 vòng |
| 2 | 1.1 extract | `node $C extract docs/thiet-ke-hoan-tien.md --page mermaid-2 --out ../b3-tmp/facts.json` (tên trang lấy từ facts của request 1) | facts chỉ còn `mermaid-2`. Thử thêm `--page sequence` → exit 1, hint liệt kê hai trang (xem N7) |
| 2 | 1.4 run folder | `diagrams/20261113_refund-gateway-call/`, facts → `source/refund-gateway-call.facts.json` | folder mới |
| 2 | 2 câu hỏi | `--kind sequence` bỏ câu kind; hỏi scope và view | PM trả lời `1a 2a` |
| 2 | 3–4 | `source/refund-gateway-call.ir.json`; `cover` | `{"ok":true,"units":15,"covered":15,"missing":[]}` |
| 2 | CC 2–4 | validate, emit, bundle (`--title "Gọi cổng thanh toán"`), preview; mở 2 PNG | 0 warning; review PASS, 1 vòng |

Tin nhắn "đã đọc gì" (request 1):

> Đã đọc `docs/thiet-ke-hoan-tien.md` (Mermaid trong Markdown, 2 trang):
> - Trang "Luồng xử lý yêu cầu hoàn tiền": 24 node, 29 cạnh; loại gợi ý `flowchart` (dòng 8: header "flowchart TD").
> - Trang "Gọi cổng thanh toán": 6 node, 8 cạnh; loại gợi ý `sequence` (dòng 42: header "sequenceDiagram").
> - Cảnh báo của facts: không có.

Câu hỏi mở đầu (request 1, một tin nhắn):

> Trước khi vẽ, cho tôi hỏi 3 câu (trả lời theo mã, ví dụ "1a 2a 3a", hoặc "default"):
>
> 1. Loại diagram cho trang "Luồng xử lý yêu cầu hoàn tiền" (trang nhiều node nhất)? Trang "Gọi cổng thanh toán" sẽ thành một diagram Trình tự (sequence) riêng, liên kết từ bước "Gọi cổng thanh toán hoàn tiền". Muốn đổi loại của một trang thì ghi tên trang và tên loại khác.
>    - 1a. Lưu đồ (flowchart) – gợi ý: các bước và quyết định của một quy trình từ đầu đến cuối (nguồn có header "flowchart TD", dòng 8)
>    - 1b. Trình tự (sequence): ai gọi ai, theo thứ tự nào, có phản hồi và nhánh lỗi
>    - 1c. Swimlane (activity): mỗi làn một tác nhân hoặc hệ thống, ai làm bước nào, bàn giao, việc song song
>    - 1d. Trạng thái (state): các trạng thái của một đối tượng và sự kiện chuyển giữa chúng
>    - 1e. Dữ liệu (er): thực thể, thuộc tính khóa, quan hệ một-nhiều
>    - 1f. Lớp (class): kiểu, interface, thành viên, kế thừa hoặc hợp thành
>    - 1g. Kiến trúc (architecture): thành phần triển khai, kho dữ liệu, hàng đợi, hệ thống ngoài và kết nối
> 2. Mức chi tiết?
>    - 2a. Tổng quan (overview) – gợi ý: diagram chính khoảng 15 phần tử; luồng con "Kiểm tra gian lận" gộp thành một bước, các quy tắc quyết định của nó vẫn hiện trên diagram chính; trang "Gọi cổng thanh toán" vẫn là diagram riêng
>    - 2b. Chi tiết (detailed): luồng con "Kiểm tra gian lận" thành một diagram con riêng, liên kết bằng `ref`
> 3. Góc nhìn của diagram?
>    - 3a. Kỹ thuật (technical) – gợi ý: cho developer, reviewer; giữ tên component, endpoint, dữ liệu
>    - 3b. Nghiệp vụ (business): cho PM, khách hàng, vận hành; chỉ luồng và quy tắc nghiệp vụ, bỏ tên kỹ thuật
>    - 3c. Cả hai (both): hai bản cho mỗi diagram (ở đây thành 4 diagram)

Request 2 hỏi hai câu (1. Mức chi tiết: 1a overview gợi ý / 1b detailed; 2. Góc nhìn: 2a technical gợi ý / 2b business / 2c both, "hai bản cho diagram"). PM trả lời `1a 2a`. Không có câu hỏi nào khác: không có `size:`, `detail:` hay finding của secret scan.

Báo cáo cuối của request 1 (tóm tắt các mục bắt buộc): run folder `diagrams/20261113_refund-flow/`, file gộp `refund-flow.md`, hai diagram (flowchart chính, rồi part sequence), CLI 0 warning, review PASS sau 1 vòng, `Images: refund-flow: opened (2 tile file lẻ + 2 tile bundle) ; refund-flow-01-gateway-call: opened (file lẻ + bundle)`. Nguồn: file Markdown/Mermaid, 2 trang, sha256 như trên, không có `sensitive`, nguồn không bị copy. Danh sách thay đổi: giữ nguyên mọi nhãn; trang "Gọi cổng thanh toán" thành part, gắn trên "Gọi cổng thanh toán hoàn tiền", không nhãn kết nối nào bị thay bằng giao thức; gộp (overview) "Lấy lịch sử hoàn tiền", "Chấm điểm rủi ro" vào bước "Kiểm tra gian lận"; không hợp nhất, không thêm, không có cạnh nối theo vị trí; còn thiếu trong nguồn: lối ra sau lần thử lại thứ 3. Coverage 53/53; loại diagram đúng như gợi ý. Có hai khối `mermaid` và một dòng đề nghị `--to drawio` / `--to figjam`. Request 2: tương tự, coverage 15/15, ghi rõ chỉ trang "Gọi cổng thanh toán" được recook (theo "chỉ lấy sequence").

## 2. Bảng xác nhận (finding ở mục 3 của `b-mermaid.md`)

| Finding | Verdict | Bằng chứng trong lần chạy này |
|---|---|---|
| M7: `cover` không biết trang (CLI) | **FIXED** | Bản nháp `b3-tmp/probe-m7`: xóa node `gateway-ok` ("Thành công?") và `retry` ("Thử lại tối đa 3 lần") khỏi flowchart IR (validate vẫn qua) → `cover` exit 2, `{"ok":false,"units":53,"covered":51,"missing":[{"page":"mermaid-1","element":"N","text":"Thành công?"},{"page":"mermaid-1","element":"N1","text":"Thử lại tối đa 3 lần"}]}`. Probe ngược (`probe-m7b`): đổi nhãn `alt` của part thành "OK" và bỏ note → exit 2, thiếu "Thành công" và "Thử lại sau 5 phút, tối đa 3 lần" của `mermaid-2`, dù flowchart vẫn có "Thành công?". Khi part không ghi `page "…"` (fallback "searched for every page"), kết quả vẫn đúng, vì flowchart IR có ghi trang của nó |
| N1: omitted không có lý do vẫn được tính (CLI) | **FIXED** | `probe-n1`, mỗi dạng sau đều cho exit 2 và thiếu F, H: `["\"Lấy lịch sử hoàn tiền\"", "\"Chấm điểm rủi ro\""]` (chỉ có text), `"\"…\", \"…\""` (một entry, không lý do), text trần, `"\"…\":"` (dấu hai chấm nhưng không có lý do), `"Lấy lịch sử hoàn tiền: gộp"` (text không đặt trong ngoặc kép). Dạng đúng `"\"…\": gộp vào …"` → 53/53. Còn một lỗ nhỏ, xem N8 |
| N2: docstring `cover.mjs` còn nói `meta.notes` | **FIXED** | `cover.mjs:5-7`: "A `meta.notes` entry does not count: a note is not shown…" |
| M1: pages / parts / `overview` mâu thuẫn | **FIXED** | draw `SKILL.md:112`: "never split under `overview` (a recook keeps the pages its source already has, as the recook skill says)". `review-checklist.md` mục 8: "A recooked run (`meta.source: "recook"`) also keeps each page of its source as a diagram of its own whatever the scope". Khi review, part dưới overview không còn là finding |
| N3: checklist mục 8 thiếu ngoại lệ recook | **FIXED** | như trên |
| N4: "pick 'Other'" không dùng được ở dạng văn bản | **FIXED** | recook `SKILL.md:112`: "\"Other\" (in the text form: naming another kind) changes one". Câu 1 của tin nhắn ghi "ghi tên trang và tên loại khác" |
| M5: overview "about 15" không đạt được | **FIXED** | recook `SKILL.md:162-164`: "brings the main diagram toward about 15 elements; the steps of the main flow itself are never dropped to reach the number". Diagram chính 22 node, không mâu thuẫn với chữ của skill, CLI không báo `size:` |
| N5: ranh giới của "the steps it hides" | **NOT FIXED (Low, phần số lượng đã sửa qua M5)** | Ví dụ ở `SKILL.md:141` vẫn chỉ ẩn "Lấy lịch sử hoàn tiền", "Chấm điểm rủi ro". Làm theo chữ, tôi giữ "Tính số tiền hoàn" (E) và "Gắn cờ nghi ngờ" (G1), dù facts đặt cả hai trong subgraph `KT`. Kết quả 22 node; lần chạy trước gộp cả bốn bước và ra 20 node. Hai người cùng đọc theo chữ ra hai diagram khác nhau (xem mục 3) |
| L5: dạng frame/note của Mermaid trong mapping | **FIXED** | `mapping.md:27-29`: "Facts read from Mermaid have no `box`: the order of the text is the order, and a frame's or a note's `detail` says where it stands (`"alt e3..e4 \| else e5"` …; `"over W,P; after e3"` …)". Tôi map `alt` / `else` và note `over refund-api,vnpay; after e7` mà không phải đoán. Chi tiết thừa còn lại: dòng `frame` ở `mapping.md:41` vẫn tả dạng draw.io (operator ở đầu label, branch bắt đầu bằng `else`) mà không chỉ sang đoạn trên |
| L6: `terminal` "with a start or end word" | **NOT FIXED (Low)** | `mapping.md:59` không đổi. "Khách gửi yêu cầu hoàn tiền" (`shape: terminal`) không có từ bắt đầu/kết thúc nào. Đọc đúng chữ thì nó không khớp dòng nào, và đầu `mapping.md` bảo shape như vậy thuộc "another kind (a part) or to `meta.omitted`", tức node bắt đầu sẽ bị bỏ. Tôi vẫn ghi `terminal` |
| L8: id nguồn (`A`, `C1`, `KH`) | **NOT FIXED (Low)** | `SKILL.md:180` không đổi: "a short counter id of the source (`e1`, `m3`)". Không rõ `C1`, `G2` có phải "counter id" không, và `KH` (viết tắt tiếng Việt) có phải "such a name" không. Tôi đặt id node theo tên tiếng Anh và giữ `e1…e29` |
| L2: `clarify` "with the picture as the description" | **NOT FIXED (Low, không chạy tới)** | `SKILL.md:51` không đổi; `clarify-protocol.md` không nói gì về ảnh. Câu này vẫn đối nghịch với "Never read a picture by eye into an IR here" ngay sau nó |
| L12 (out of scope): heading tiếng Anh "Not shown on purpose:" | **OUT OF SCOPE, vẫn xảy ra** | `diagrams/20261113_refund-flow/refund-flow.md` có "Not shown on purpose:" dưới khối flowchart (`pipeline.mjs:141`). Bundle của request 2 không có, vì không có mục omitted nào |
| L10 (out of scope): lifeline VNPay cắt nhãn message | **OUT OF SCOPE, vẫn xảy ra** | Ở cả 4 PNG sequence, lifeline "Cổng VNPay" cắt qua "Lưu yêu cầu (PENDING)" và "Cập nhật DONE" |

Những điểm khác đã kiểm tra:
- E-mail nhân viên ở phần văn xuôi: chạy `grep -rn -i -e congty -e "lien\.nguyen" -e @ diagrams` → không có kết quả (exit 1). Không có file nào trong `diagrams/` tên giống file nguồn. Facts không thấy địa chỉ này (nó nằm ngoài khối Mermaid) nên không có mục `sensitive`; như vậy là đúng.
- Dashed `-->>` thành `return`; PNG vẽ nét đứt.

## 3. Lỗi mới / còn lại

Không có High hoặc Medium.

### Low

**N5 (skill text, còn lại từ lần trước). Ranh giới của các bước bị gộp dưới `overview`.** Bằng chứng: xem bảng. Chữ "the texts of the steps it hides" chỉ được định nghĩa qua ví dụ. Ví dụ đó giữ E và G1, trong khi facts đặt chúng trong subgraph. Lần chạy trước cũng làm theo chữ nhưng gộp cả hai. Đề xuất: viết rõ quy tắc, ví dụ "the collapsed step replaces the steps of the sub-flow that are not its decisions or the outcomes they lead to; a step the source also writes on the main path (an edge into the sub-flow) stays", rồi nói ví dụ khớp với quy tắc vì lý do nào.

**N7 (skill text, mới). `--page` khi request gọi trang bằng tên loại.** `SKILL.md:65-67`: "add `--page <id or name>[,...]` with the pages the facts name". Ở một phiên mới, agent chưa có facts nên không biết tên trang. Cách gần nhất với request "chỉ lấy sequence" là `--page sequence`, và lệnh này exit 1 (`no page "sequence" in this source`, hint liệt kê trang). Step 3 lại bảo "On exit 1, quote the error and stop", nên agent làm đúng chữ sẽ dừng hẳn. Lần này tôi có facts của request 1 nên dùng được `mermaid-2`. Đề xuất: "without facts of this source yet, extract once without `--page` to learn the page names, then again with `--page`; an exit 1 from `--page` alone is not a stop: pick the page from its hint". Có thể sửa thêm ở CLI: cho `--page` nhận tên loại khi đúng một trang có hint mạnh nhất là loại đó.

**N8 (CLI, mới, rất nhỏ). Regex của omitted kiểm tra cả entry, không kiểm tra text.** `cover.mjs` `/["”»』」]\s*:\s*\S/` chỉ cần có *một* ngoặc kép đóng theo sau là `:` ở bất kỳ đâu trong entry. Bằng chứng: entry `Chấm điểm rủi ro "x": y` (text không nằm trong ngoặc kép) vẫn được tính là che "Chấm điểm rủi ro" (53/53, exit 0). Hint của exit 2 cũng không nêu dạng bắt buộc (`"…": reason`). Đề xuất: chỉ tính các text nằm trong ngoặc kép đứng trước dấu `:`; thêm vào hint câu "in the form `\"<text>\": <reason>`".

**L6, L8, L2 (skill text, còn lại từ lần trước).** Như ở mục 2. L6 nguy hiểm nhất trong ba cái: đọc đúng chữ thì node bắt đầu không có "start word" sẽ bị bỏ.

**Chi tiết của L5 (skill text).** Dòng `frame` ở `mapping.md:41` có thể thêm "(from Mermaid: the operator and the sections are in `detail`, see above)".

Không phải lỗi: bundle request 2 không ghi trang bị `--page` bỏ qua; báo cáo vẫn nêu được trang đã đọc.

## 4. Đánh giá diagram (các PNG đã mở)

| PNG | Đánh giá |
|---|---|
| `/tmp/zukai-preview/refund-flow-mmd-6166b89d-1.png`, `/tmp/zukai-preview/refund-flow-mmd-6166b89d-2.png` (flowchart lẻ, 2 tile) | Đúng logic so với nguồn: năm nhánh kết thúc (không tìm thấy đơn, quá hạn, chuyển bộ phận rủi ro, từ chối có lý do, ghi sổ kế toán) đều về "Kết thúc"; nhãn Có/Không đặt đúng nhánh; "Quá 3 lần/tháng?" Có → "Gắn cờ nghi ngờ" → "Chuyển bộ phận rủi ro", và "Điểm > 70?" Có cũng về đó; vòng thử lại quay lên "Gọi cổng thanh toán hoàn tiền". Không có gì chồng nhau, chữ đọc được ở scale 1. Node `ref` hiện slug `↳ refund-flow-01-gateway-call`, bị ngắt giữa từ (đúng như target-mermaid.md nói về file lẻ). Polish: diagram cao, có năm đường dọc dài ở mép trái; "Gửi email xác nhận" xuống dòng thành "xác / nhận" |
| `/tmp/zukai-preview/refund-flow-md-2953d65c-d1-1.png`, `/tmp/zukai-preview/refund-flow-md-2953d65c-d1-2.png` (flowchart trong bundle) | Giống file lẻ; node ref hiện `↳ Gọi cổng thanh toán`, ngắt theo từ. Đạt |
| `/tmp/zukai-preview/refund-flow-01-gateway-call-mmd-6c28cf46.png`, `/tmp/zukai-preview/refund-flow-md-2953d65c-d2.png` (part sequence: lẻ và trong bundle) | Đúng: actor "Khách hàng", ba participant theo thứ tự nguồn, `alt` [Thành công] / [Lỗi tạm thời], bốn reply nét đứt, note vàng "Thử lại sau 5 phút, tối đa 3 lần" nằm giữa "99 Timeout" và "202 Đang xử lý". Lỗi đã biết (out of scope): lifeline "Cổng VNPay" cắt "Lưu yêu cầu (PENDING)" và "Cập nhật DONE" |
| `/tmp/zukai-preview/refund-gateway-call-mmd-75233e00.png`, `/tmp/zukai-preview/refund-gateway-call-md-d16daf27-d1.png` (request 2) | Giống hệt sequence ở trên. Đạt, cùng lỗi lifeline cắt nhãn |

Review request 1, vòng 1 (giọng reviewer):

```text
Verdict: PASS
Images: refund-flow: opened (2 tile file lẻ + 2 tile bundle) ; refund-flow-01-gateway-call: opened (file lẻ + bundle)
Findings:
- [polish] [layout] refund-flow-01-gateway-call / e2, e5: lifeline "Cổng VNPay" cắt qua nhãn "Lưu yêu cầu (PENDING)" và "Cập nhật DONE" -> đặt refund-db trước vnpay (không áp: recook "Order comes from the facts")
- [polish] [structure] refund-flow / retry: "Thử lại tối đa 3 lần" không có lối ra sau lần thứ 3 thất bại -> nguồn không vẽ; không thêm ("Nothing is invented"), nêu trong báo cáo
- [polish] [wording] refund-flow / fraud-check: "Điểm > 70?" đứng ngay sau "Quá 3 lần/tháng?" mà không thấy bước chấm điểm (đã gộp vào "Kiểm tra gian lận") -> không đổi; chữ của nguồn, đã ghi trong meta.omitted
```

Review request 2, vòng 1: `Verdict: PASS`; `Images: refund-gateway-call: opened (file lẻ + bundle)`; một finding polish, lifeline cắt nhãn như trên, không áp.

Status: DONE
Summary: PASS. Cả hai request đều giao đúng khi làm theo chữ; M7, N1–N4, M1, M5, L5 đã sửa (probe M7 giờ exit 2 và liệt kê đúng hai text), còn lại chỉ Low (N5, L2, L6, L8, N7 và N8 mới).
Concerns/Blockers: N7: nếu agent ở phiên mới thử `--page sequence`, lệnh exit 1 và "On exit 1 … stop" sẽ làm request 2 dừng giữa chừng; lần này không xảy ra vì đã có facts của request 1.
