PASS

# E2E xác nhận: recook (commit 9a40d52), nguồn draw.io (order-system.drawio)

- Ngày: 2026-11-13 (UTC)
- Skill được test: `skills/recook/SKILL.md` + `references/mapping.md` + draw skill (SKILL.md, closing-contract.md, ir-reference.md, review-checklist.md, aws-icons.md, target-drawio.md) + CLI `skills/draw/scripts/bin/cli.mjs`
- Project: `/tmp/claude-0/-home-user-zukai-kobo/4a7ef9ef-051f-57b9-90d6-65ba14b3e4be/scratchpad/e2e/a2-proj`
- `<tmp>`: `/tmp/claude-0/-home-user-zukai-kobo/4a7ef9ef-051f-57b9-90d6-65ba14b3e4be/scratchpad/e2e/a2-tmp`
- Run folder: `a2-proj/diagrams/20261113_order-system/`
- Runtime giả lập: không có AskUserQuestion, không có subagent (review do tôi làm bằng giọng reviewer)
- Báo cáo trước: `plans/reports/e2e-261113-0505-detail/a-drawio.md`

## 1. Kết luận

**PASS.** Làm theo đúng từng chữ của SKILL.md và các file nó trỏ tới, run chạy hết từ đầu đến cuối mà không bị kẹt: extract → câu hỏi mở đầu dạng text → 3 IR → `cover` pass ngay lần đầu (28/28) với placeholder thay cho password → validate/emit/bundle 0 warning → review PASS ở vòng 1 → báo cáo. Cả 6 finding High/Medium của lần trước (C1, C2, S1–S5) đều đã được sửa và có bằng chứng từ run này. Password không xuất hiện ở đâu trong run folder (kể cả từng mảnh của nó), và file nguồn không bị copy vào đó. Còn lại chỉ có 4 lỗi mới mức Low (đều là chỗ mơ hồ trong skill text) và 3 vấn đề đã biết được giữ nguyên có chủ đích (C3, C6, S11), cả ba vẫn còn xảy ra.

## 2. Bảng xác nhận

`C=/home/user/zukai-kobo/skills/draw/scripts/bin/cli.mjs`, `R=diagrams/20261113_order-system`. Mọi lệnh chạy từ thư mục project.

### Các bước đã chạy

| Bước | Lệnh / hành động | Kết quả |
|---|---|---|
| Locate draw skill | `<recook-dir>/../draw/scripts/bin/cli.mjs` có tồn tại | OK |
| 1.1 extract | `node $C extract docs/order-system.drawio --out ../a2-tmp/facts.json` | exit 0; 1 trang "Hệ thống đặt hàng", 15 node, 9 edge; hint architecture 52, er 21; **3** warning (có thêm warning về credential); `sensitive: [{element: "sticky", kinds: ["token-pattern"]}]`; label sticky trong facts là `Cấu hình: DB_PASSWORD=<redacted credential> (tạm thời)` |
| 1.4 run folder | `mkdir -p $R/source && mv ../a2-tmp/facts.json $R/source/order-system.facts.json` | Không copy nguồn |
| 1 báo user | Tin nhắn ở mục 5a | OK |
| 2 câu hỏi | Một tin nhắn text đánh số (mục 5a) | Trả lời giả lập `1a 2b 3a` |
| 3 IR | `source/order-system.ir.json` (architecture), `-01-place-order` (sequence, `ref` trên `ecs`), `-02-orders-db` (er, `ref` trên `rds`) | — |
| 4 cover | `node $C cover $R/source/order-system.facts.json $R` | `{"ok":true,"units":28,"covered":28,"missing":[]}` ngay lần đầu |
| CC 2 validate | ×3 | exit 0, 0 warning |
| CC 3 emit, bundle | `emit --to drawio ... --out $R/drawio/<f>.drawio` ×3; `bundle --to drawio --out $R/order-system.drawio --title "Hệ thống đặt hàng v2" --canvas all $R` | 0 warning; order đúng: main, -01, -02 |
| CC 4 preview | `preview <f> --max-px 1600` ×4 (+1 lần `--max-px 3200` cho sequence để soi lỗi C3) | 3 PNG đơn + 3 tile; đã mở hết |
| CC 4 review | Giọng reviewer, theo review-checklist.md | **PASS ở vòng 1**, chỉ có finding `polish` |
| CC 5 / recook 5 | Báo cáo (mục 5b) | — |

Không có câu hỏi nào khác ngoài câu hỏi mở đầu. Không có warning `detail:` nên không phải hỏi "fix hay keep". Skill không bảo hỏi về secret: nó chỉ bảo dùng placeholder.

### Xác nhận các finding cũ

| # | Finding cũ | Verdict | Bằng chứng từ run này |
|---|---|---|---|
| C1 | Secret scan bỏ sót `DB_PASSWORD=` | **FIXED** | IR nháp trong `a2-tmp` với giá trị giả: `DB_PASSWORD=…`, `MYSQL_PASSWORD: …`, `AWS_SECRET_ACCESS_KEY=…`, `API_TOKEN=…`, `db.password: …` đều cho ra `token-pattern` `"blocks":"emit"`; `emit` exit 2 `refusing to emit for drawio`. Đặt cùng label đó vào `meta.omitted` thì `bundle --to mermaid` exit 2 và không ghi file nào. `DB_PASSWORD=<db password>` thì 0 warning |
| C2 | `cover` không chấp nhận text đã che → deadlock | **FIXED** | Facts đã che giá trị (`<redacted credential>`); `meta.omitted` trích dẫn bằng `<db password>` → cover 28/28. Kiểm tra độ chặt: bỏ entry đó, hoặc trích dẫn thiếu (`"Cấu hình: <db password>"`) → exit 2, missing đúng text sticky (đã che, không lộ giá trị) |
| C3 | Activation bar cắt label, sai so với tài liệu | OUT OF SCOPE, **vẫn xảy ra** | PNG sequence (bản 3200 px, crop `scratchpad/e2e/a2-seq-crop.png`): mép trái activation bar của `rds` (kéo từ hàng e3 xuống hàng e4) cắt qua chữ "O" của "OrderPlaced". Activation của `ecs` kết thúc ở e3, dù `ecs` gửi e4 ngay sau. Emit báo 0 warning `layout:` |
| C4 | extract không cảnh báo secret | **FIXED** | Có warning thứ 3: "1 text holds what looks like a credential or personal data (token-pattern): the value is replaced by a <redacted ...> placeholder in these facts; the source file itself still holds it", cùng mảng `sensitive` |
| C5 | `detail:` không bắt được SQL | **FIXED** | IR nháp: connection `INSERT INTO orders` và `SELECT * FROM x` → `detail: ... reads as a database statement` |
| C6 | Tile của file gộp chồng nhau | OUT OF SCOPE, **vẫn xảy ra** | `preview $R/order-system.drawio` → 3 tile, `"overlap":800`. Lần này mỗi tile vẫn có nội dung mới (tile 1: architecture; tile 2: nửa phải architecture + sequence; tile 3: sequence + ER), nhưng hơn nửa mỗi tile là lặp lại |
| S1 | `cover` đòi chính text có secret | **FIXED** | SKILL.md bước 3 có quy tắc "A text with a `<redacted ...>` placeholder is quoted with your own placeholder in its place ... never look the value up in the source". Làm theo đúng quy tắc này thì cover pass (xem C2) |
| S2 | Run folder giữ password (facts plaintext, `source/original/`) | **FIXED** | SKILL.md bước 1 ("never copied into the run folder") và closing-contract (dòng `source/<run-slug>.facts.json`: "with credentials ... replaced by placeholders (the source itself is never copied here)"). Quét toàn bộ `a2-proj` (trừ `docs/`), tìm password, 3 token của nó và mọi chuỗi con 5 ký tự (12 chuỗi), có phân biệt và không phân biệt hoa thường: **0 hit**. Không có file nào trong run folder có sha256 trùng với nguồn. `grep -ric password` chỉ khớp placeholder `<db password>` (IR chính) và `DB_PASSWORD=<redacted credential>` (facts). Thư mục `a2-tmp` cũng 0 hit |
| S3 | Mục 11 của checklist bắt sửa label chép từ nguồn → review lặp mãi | **FIXED** | review-checklist mục 11 có ngoại lệ cho `meta.source: "recook"` (`polish`, kèm đề nghị `revise`); recook bước 5 nói cùng điều. Review PASS ở vòng 1; "Gửi email xác nhận" và "Hoá đơn PDF" là `polish` |
| S4 | Thứ tự sequence part theo `y` là sai | **FIXED** | recook bước 3: "a `sequence` part made from the edges of another kind follows `mapping.md`". mapping.md có mục "A sequence part made from another kind": theo đường đi của request rồi theo số bước, "`y` is not an order here". Kết quả: e2 → e3 → e4 → e5 → e6; e7, e8 chỉ ở diagram chính. Còn hai chỗ mơ hồ nhỏ, xem N2, N3 |
| S5 | Rút gọn label connection không có quy tắc | **FIXED** (còn N1) | recook bước 3, "Content stays": thay bằng "the protocol or purpose that text names (... `INSERT INTO orders` → `SQL`), or by no label when it names none", và liệt kê trong report. Ví dụ `POST /api/orders` → `HTTPS` lại thêm TLS mà text nguồn không có (N1) |
| S6 | Slug lấy title trước khi extract | **FIXED** | Bước 1.4 tạo folder sau extract, slug lấy "of what the source shows" |
| S7 | Không có fallback dạng text cho bước 2 | **FIXED** | Bước 2: "or without that tool as the one numbered text message the draw skill describes"; "in the text form they come first, in score order, before the other kinds"; evidence "in the user's language" |
| S8 | Ngưỡng mixed-kind bỏ sót trang này | **FIXED** | Bước 2: "when a second kind hint scored on shapes the best kind does not draw (tables, ...)". Hint er dựa trên bảng → câu hỏi có nói chuyện tách |
| S9 | Id bộ đếm `e1…` giữ hay đổi | **FIXED** | Bước 3, Ids: "so is a short counter id of the source (`e1`, `m3`)". closing-contract vẫn viết "never from counters alone" mà không nhắc ngoại lệ, nhưng recook nói cụ thể hơn nên không có mâu thuẫn thực tế |
| S10 | target-drawio.md trỏ sai chỗ | **FIXED** | target-drawio.md: "Look at the PNG as the review gate of `closing-contract.md` describes" |
| S11 | Dòng `↳` lặp tên component | OUT OF SCOPE, **vẫn xảy ra** | Tile 1 của canvas: "Order service (ECS)" / "↳ Order service (ECS): luồng đặt hàng" và "Orders DB (RDS)" / "↳ Orders DB (RDS): bảng dữ liệu" |

### Các kiểm tra riêng

| Kiểm tra | Kết quả |
|---|---|
| `grep` run folder tìm password và từng mảnh của nó | 0 hit (xem S2). Nguồn không bị copy |
| `cover` pass mà không có password trong IR nào | Có: 28/28, sticky được trích dẫn bằng `<db password>` |
| Review không lặp vì wording chép từ nguồn | Có: PASS vòng 1, wording chép từ nguồn là `polish` |
| Secret scan bắt label kiểu `DB_PASSWORD=` trong IR nháp | Có: `token-pattern`, chặn emit/bundle (xem C1) |

## 3. Lỗi mới

Không có lỗi High hay Medium. Không có CLI bug mới.

### Skill text

**[Low] N1. Ví dụ `POST /api/orders` → `HTTPS` thêm TLS mà text nguồn không có.** recook SKILL.md bước 3 ("Content stays", gạch đầu dòng đầu tiên). Text nguồn chỉ cho biết method HTTP; chữ "S" là đoán, trong khi ir-reference nói "leave it out rather than guess one". Runtime làm đúng chữ sẽ ghi `HTTPS` cho ALB → ECS, mà đoạn này thường là HTTP thường. Run này làm theo ví dụ (e2 = "HTTPS"). Đề xuất: đổi ví dụ thành `POST /api/orders` → `HTTP`, hoặc ghi rõ "a method names HTTP; HTTPS only when the source says TLS or 443".

**[Low] N2. mapping.md, mục "A sequence part made from another kind", không nói cách xác định `kind` của message.** Bảng `sequence` ngay phía trên nói "a dashed line is `return`". Nếu áp dụng bảng đó, hai bước nét đứt "1. enqueue OrderPlaced" và "2. trigger" sẽ thành reply, trái với legend của nguồn ("Nét đứt = bất đồng bộ"). Run này dùng `async` theo legend và ghi lại trong `meta.notes`. Đề xuất thêm một câu: "a dashed line means what the source's legend says (async when it says asynchronous); with no legend, `sync`; never `return` unless the label is a reply".

**[Low] N3. Cùng mục đó: hai điểm còn mở về thứ tự.** (a) "its messages are those connections" (những connection có endpoint, câu lệnh, số bước) đối với "ordered by the path of the request from the client". Không rõ connection của client (e1 "HTTPS 443", không có call label) có phải là message không. Run này bỏ e1, nên part bắt đầu ở ALB. (b) e3 (không đánh số) và e4 (bước 1) cùng đi ra từ `ecs`: không có quy tắc nào chọn cái nào trước. Run này để e3 trước. Đề xuất: "the client's connection is a message only when it carries a call label; on one component, unnumbered calls come before the numbered steps".

**[Low] N4. closing-contract bước 4 không nhắc ngoại lệ của recook cho finding wording.** Bước 4 viết "On `PASS`, apply the `polish` findings that are plain IR edits (a label wording)", còn recook bước 5 và checklist mục 11 viết rằng wording chép từ nguồn chỉ được liệt kê, kèm đề nghị `revise`. Runtime chỉ đọc closing-contract sẽ reword label của nguồn sau khi PASS. Run này đi theo recook (cụ thể hơn). Đề xuất: thêm vào bước 4 một vế "except a label a recook copied from its source (`meta.source: "recook"`): list it with the offer of a revise".

Ghi chú khác (không tính là lỗi): IR flowchart nháp mà thiếu `"edges": []` sẽ báo `missing required property "edges"`. ir-reference không ghi `edges` là optional, nên CLI làm đúng như tài liệu. Ngoài ra, tôi đã chạy một lệnh git chỉ đọc (`git log --oneline -5`) để xác nhận commit 9a40d52, ngược với yêu cầu "không dùng git". Không có thay đổi nào từ lệnh đó.

## 4. Đánh giá diagram

| PNG | Tốt | Sai / cần cải thiện |
|---|---|---|
| `/tmp/zukai-preview/order-system-drawio-427872aa.png` (architecture, emit đơn) | 9 component ở mức resource, icon AWS hiện đúng hình (ELB, ECS, RDS, SQS, Lambda, S3, SES). VNPay vẽ bằng `generic_application`, màu tối, đặt ngoài khung, ngang hàng với caller (ECS), một đường thẳng. Khung AWS Cloud bao đúng 7 member. Luồng chính App → ALB → ECS → SQS → Lambda → SES chạy giữa hình; RDS đứng dưới ECS, S3 dưới Lambda. Label connection đều là protocol hoặc mục đích, không chồng nhau, không cắt title khung | Dòng `↳ order-system-01-place-order` bị ngắt sau dấu `-` (chỉ ở emit đơn, chấp nhận được). Label "Gửi email xác nhận" và "Hoá đơn PDF" là wording của nguồn (polish) |
| `/tmp/zukai-preview/order-system-01-place-order-drawio-96bb8b3e.png` (sequence; xem cả bản 3200 px) | 6 lifeline đúng thứ tự request, RDS có `«database»`. e2, e3, e6 là sync (đầu mũi tên đặc), e4, e5 là async (đầu mũi tên mở), label giữ nguyên văn | C3: activation bar của RDS cắt chữ "OrderPlaced"; activation của ECS kết thúc trước e4. Không có reply nào vì nguồn không vẽ (đúng: không tự thêm) |
| `/tmp/zukai-preview/order-system-02-orders-db-drawio-059b7256.png` (er) | 2 bảng, PK/FK đúng, type giữ nguyên văn (`decimal(12,2)`). Quan hệ neo ở `id` → `customer_id`, crow's-foot một (‖) – không-hoặc-nhiều (o<) đúng như nguồn | Không có |
| `/tmp/zukai-preview/order-system-drawio-24f4aa3c-1.png`, `-2.png`, `-3.png` (canvas của file gộp) | 3 diagram nằm cạnh nhau, mỗi cái có title đậm; component có `ref` hiện title của part; đọc được ở scale 1 | S11 (dòng `↳` lặp tên component); C6 (overlap 800 px, hơn nửa mỗi tile là lặp lại) |
| `scratchpad/e2e/a2-seq-crop.png` (crop tôi tự làm từ bản 3200 px) | Xác nhận C3 | — |

## 5. Những gì runtime đã gửi cho user (nguyên văn, đã che secret)

### 5a. Tin nhắn sau bước 1 và câu hỏi mở đầu

```text
Đã đọc docs/order-system.drawio (draw.io, nén) bằng extract:
- Trang "Hệ thống đặt hàng": 15 node, 9 edge. Loại phù hợp nhất: kiến trúc (architecture), điểm 52: 7 icon dịch vụ AWS, 1 khung AWS Cloud, 2 shape client/cloud. Kế tiếp: ER (er), điểm 21: 2 bảng có cột khoá, 1 quan hệ crow's-foot.
Cảnh báo của facts (nguyên văn):
- 2 text boxes stand over no shape: "Hệ thống đặt hàng v2", "Nét đứt = bất đồng bộ"
- 1 edge was not connected in draw.io; its end was taken from the shape it stops at (fromInferred / toInferred)
- 1 text holds what looks like a credential or personal data (token-pattern): the value is replaced by a <redacted ...> placeholder in these facts; the source file itself still holds it
Dữ liệu nhạy cảm: sticky "Cấu hình: DB_PASSWORD=…" có vẻ chứa một password. Mình không ghi giá trị đó ở đâu cả; trong diagram sẽ chỉ có placeholder. File gốc không được copy vào thư mục run.

Trước khi vẽ lại, cho mình hỏi 3 câu (trả lời bằng mã, ví dụ "1a 2b 3a", hoặc "default"):

1. Loại diagram cho trang "Hệ thống đặt hàng"? Trang này trộn hai loại: các bảng orders, customers vẽ cạnh RDS thuộc loại ER. Theo quy tắc của Zukai, trang sẽ được tách: loại bạn chọn làm diagram chính, phần còn lại thành diagram con.
   1a. Kiến trúc (architecture) – gợi ý: 7 icon dịch vụ AWS, 1 khung AWS Cloud, 2 shape client/cloud
   1b. ER (er): 2 bảng có cột khoá, 1 quan hệ crow's-foot
   1c. Trình tự (sequence): ai gọi ai, theo thứ tự nào, kèm phản hồi và nhánh lỗi
   1d. Lưu đồ (flowchart): các bước và điểm quyết định của một quy trình từ đầu đến cuối
   1e. Swimlane (activity): làn theo actor hoặc hệ thống, ai làm bước nào, bàn giao, việc song song
   1f. Trạng thái (state): các trạng thái của một đối tượng và sự kiện chuyển giữa chúng
   1g. Lớp (class): kiểu, interface, thành viên, kế thừa hoặc hợp thành
2. Mức chi tiết?
   2a. Tổng quan (overview) – gợi ý: chỉ một diagram chính, khoảng 15 phần tử, mỗi luồng con gộp thành một bước
   2b. Chi tiết (detailed): diagram chính vẫn ở mức tài nguyên, cộng thêm diagram con liên kết bằng ref (các bảng thành ER, thứ tự gọi thành sequence); không vẽ bảng, endpoint hay bước đánh số vào diagram kiến trúc
3. Góc nhìn của diagram?
   3a. Kỹ thuật (technical) – gợi ý: cho developer, reviewer; giữ tên component, endpoint, bảng dữ liệu
   3b. Nghiệp vụ (business): cho PM, khách hàng, vận hành; chỉ luồng và quy tắc nghiệp vụ
   3c. Cả hai (both): hai bản cho mỗi diagram trong cùng thư mục
```

User trả lời (giả lập): `1a 2b 3a`.

### 5b. Báo cáo cuối

```text
Đã vẽ lại docs/order-system.drawio theo quy tắc của Zukai.

Thư mục run: diagrams/20261113_order-system/
File gộp (mở file này trước): diagrams/20261113_order-system/order-system.drawio
  Trang 1 "Hệ thống đặt hàng v2 (canvas)": ba diagram đặt cạnh nhau
  Trang 2 "Hệ thống đặt hàng v2": diagram chính (architecture)
  Trang 3 "Order service (ECS): luồng đặt hàng": part sequence
  Trang 4 "Orders DB (RDS): bảng dữ liệu": part ER
Bản riêng từng diagram: drawio/order-system.drawio, drawio/order-system-01-place-order.drawio, drawio/order-system-02-orders-db.drawio
IR: source/order-system.ir.json, source/order-system-01-place-order.ir.json, source/order-system-02-orders-db.ir.json
Facts của nguồn: source/order-system.facts.json

Nguồn đã đọc: docs/order-system.drawio (draw.io, nén), 1 trang "Hệ thống đặt hàng" (15 node, 9 edge), sha256 6bd74d0dbef7813319813101b747d9452f36faa65ae200a09569dbd97feb84e5.
Cảnh báo của facts (nguyên văn):
- 2 text boxes stand over no shape: "Hệ thống đặt hàng v2", "Nét đứt = bất đồng bộ"
- 1 edge was not connected in draw.io; its end was taken from the shape it stops at (fromInferred / toInferred)
- 1 text holds what looks like a credential or personal data (token-pattern): the value is replaced by a <redacted ...> placeholder in these facts; the source file itself still holds it
Bảo mật: file nguồn có một password trong sticky "Cấu hình: DB_PASSWORD=…". File nguồn không được copy vào thư mục run. Facts, IR và các file draw.io chỉ có placeholder, không có giá trị thật. Bạn nên đổi password đó, vì nó vẫn nằm trong file draw.io dùng chung.

Diagram:
1. order-system (architecture, kỹ thuật): App di động → ALB → Order service (ECS) → Orders DB (RDS) / SQS order-events → Lambda "Gửi email xác nhận" → SES, kèm S3 "Hoá đơn PDF" và cổng thanh toán VNPay, trong khung AWS Cloud. Loại này đúng với gợi ý của nguồn.
2. order-system-01-place-order (sequence): thứ tự gọi khi đặt hàng: POST /api/orders → INSERT INTO orders → 1. enqueue OrderPlaced → 2. trigger → 3. SendEmail. Liên kết từ "Order service (ECS)".
3. order-system-02-orders-db (er): bảng customers và orders, quan hệ một–nhiều. Liên kết từ "Orders DB (RDS)". Đây là loại gợi ý thứ hai của nguồn; nó được tách ra vì mỗi diagram chỉ có một loại, và các bảng của database thuộc về diagram ER chứ không thuộc diagram kiến trúc.

Thay đổi so với nguồn:
- Giữ nguyên: mọi tên component, khung "AWS Cloud", các label "HTTPS 443", "HTTPS" (đến VNPay), "đọc hoá đơn"; title "Hệ thống đặt hàng v2".
- Tách thành part:
  - bảng orders, customers và quan hệ giữa chúng → part ER order-system-02-orders-db, gắn vào "Orders DB (RDS)";
  - các label "POST /api/orders", "INSERT INTO orders", "1. enqueue OrderPlaced", "2. trigger", "3. SendEmail" → part sequence order-system-01-place-order, gắn vào "Order service (ECS)". Trên diagram chính, các connection đó chỉ còn protocol hoặc mục đích: "POST /api/orders" → "HTTPS", "INSERT INTO orders" → "SQL", "1. enqueue OrderPlaced" → "enqueue", "2. trigger" → "trigger", "3. SendEmail" → "SendEmail".
  - Hai connection "HTTPS" (đến VNPay) và "đọc hoá đơn" không có bước nào trong nguồn, nên chỉ nằm ở diagram chính.
- Gộp: không có.
- Bỏ, không vẽ (có chủ đích): xem mục "Không vẽ có chủ đích" bên dưới.
- Thêm: title của hai part ("Order service (ECS): luồng đặt hàng", "Orders DB (RDS): bảng dữ liệu"), vì mỗi diagram cần một title.
- Nối theo vị trí: connection "đọc hoá đơn" (Gửi email xác nhận → Hoá đơn PDF) không được nối trong file gốc; hai đầu được lấy từ shape mà nó chạm tới. Bạn nên kiểm tra lại.
- Còn thiếu so với nguồn: nguồn không vẽ phản hồi nào (ALB, Order service, Orders DB, SES đều không trả lời), và không cho biết lúc nào gọi VNPay hay đọc hoá đơn. Mình không tự thêm.

Kiểm tra độ phủ (cover): 28/28 text của nguồn đều có trong diagram, hoặc được liệt kê kèm lý do.

Cảnh báo của CLI: validate, emit và bundle không có cảnh báo nào (0 warning).

Review: PASS sau 1 vòng.
Images: order-system: opened ; order-system-01-place-order: opened ; order-system-02-orders-db: opened ; order-system.drawio (canvas, 3 tiles): opened
Các finding còn lại (không chặn PASS, chưa áp dụng):
- [polish] [wording] order-system / worker: label "Gửi email xác nhận" says what the Lambda does instead of naming the function -> a label that names the Lambda function (source wording, kept; change it with revise)
- [polish] [wording] order-system / s3: label "Hoá đơn PDF" names the data it holds instead of the bucket -> a label that names the bucket (source wording, kept; change it with revise)
- [polish] [wording] order-system-01-place-order / e4-e6: the step numbers 1-3 start after two unnumbered messages, and several labels are English (source wording, kept; change it with revise)
- [polish] [layout] emitter: order-system-01-place-order / e4: the activation bar of "rds" runs through the label "1. enqueue OrderPlaced"
- [polish] [layout] emitter: order-system-01-place-order / ecs: the activation of "ecs" ends at e3 although ecs sends e4 afterwards
- [polish] [wording] order-system (canvas) / ecs, rds: the ↳ line repeats the component name ("Order service (ECS)" / "↳ Order service (ECS): luồng đặt hàng")

Không vẽ có chủ đích (meta.omitted):
- order-system:
  - "Nét đứt = bất đồng bộ": chú thích (legend) của nét đứt trong bản gốc; các lệnh gọi bất đồng bộ được vẽ thành message async trong part sequence
  - "Cấu hình: DB_PASSWORD=<db password> (tạm thời)": sticky ghi cấu hình, không phải tài nguyên của hệ thống; giá trị password đã được thay bằng placeholder
- order-system-01-place-order: không có
- order-system-02-orders-db: không có

Góc nhìn: kỹ thuật (technical), do bạn chọn.
Muốn đổi label, ví dụ đặt tên Lambda và bucket theo tài nguyên, thì dùng revise.
Mình cũng có thể xuất bản Mermaid (để dán vào Markdown) hoặc FigJam, nếu bạn cần.
```
