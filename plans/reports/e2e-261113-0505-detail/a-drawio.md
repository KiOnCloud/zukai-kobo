# E2E: recook 2.2.0, nguồn draw.io (order-system.drawio)

- Ngày: 2026-11-13 (UTC)
- Skill được test: `skills/recook/SKILL.md` + `references/mapping.md` + draw skill (SKILL.md, closing-contract.md, ir-reference.md, review-checklist.md, aws-icons.md, target-drawio.md) + CLI `skills/draw/scripts/bin/cli.mjs`
- Project: `/tmp/claude-0/-home-user-zukai-kobo/4a7ef9ef-051f-57b9-90d6-65ba14b3e4be/scratchpad/e2e/a-proj`
- Run folder: `.../a-proj/diagrams/20261113_order-system/`
- Runtime giả lập: không có AskUserQuestion, không có subagent (review do tôi làm bằng giọng reviewer)

## 1. Kết luận

Về kỹ thuật, skill đã chạy hết từ đầu đến cuối và ra được một run có ích: extract đọc đúng file nén, một architecture diagram ở mức resource với AWS icon, hai part (`sequence`, `er`) liên kết bằng `ref`, bundle có canvas, preview render được. **Nhưng làm theo đúng từng chữ thì không có run nào "đúng" được:** (1) `cover` không bao giờ pass khi nguồn có password, vì text duy nhất được chấp nhận là bản chép có chứa chính password đó, mà rule secret lại cấm điều này (deadlock); (2) phần giao cho user vẫn còn password thật trong `source/order-system.facts.json` (plaintext) và `source/original/` (nén), đúng như skill yêu cầu giữ lại; (3) review checklist mục 11 bắt sửa label component, còn rule "Content stays" của recook cấm reword. Vì vậy review FAIL đủ 3 vòng và phải giao kèm finding. Ngoài ra secret scan của CLI không phát hiện được `DB_PASSWORD=...`.

## 2. Bảng các bước

`C=/home/user/zukai-kobo/skills/draw/scripts/bin/cli.mjs`, `R=diagrams/20261113_order-system`, mọi lệnh chạy từ thư mục project.

| Bước SKILL.md | Đã làm (lệnh chính xác) | Kết quả |
|---|---|---|
| Locate the draw skill | `<recook-dir>/../draw/scripts/bin/cli.mjs` tồn tại → dùng nó | OK |
| Arguments | `docs/order-system.drawio`, không có flag → `--to` mặc định `drawio` | OK |
| 1.1 Tạo run folder, copy nguồn | `mkdir -p $R/source/original && cp docs/order-system.drawio $R/source/original/` (slug lấy từ tên file vì lúc này chưa biết title) | OK |
| 1.2 extract | `node $C extract $R/source/original/order-system.drawio --out $R/source/order-system.facts.json` | exit 0; 1 trang "Hệ thống đặt hàng", 15 node, 9 edge; hints architecture 52 / er 21; 2 warning |
| 1 (báo cho user những gì đã đọc) | Viết tin nhắn tóm tắt (xem mục 5, phần mở đầu) | OK |
| 2 Câu hỏi mở đầu | Một tin nhắn text, đánh số (vì runtime không có AskUserQuestion; recook không nói fallback này, tôi lấy từ draw SKILL.md:144-149). Câu hỏi nguyên văn ở cuối bảng | Trả lời giả lập: `1a 2b 3a` (architecture, detailed, technical) |
| 3 Viết IR | `source/order-system.ir.json` (architecture), `source/order-system-01-place-order.ir.json` (sequence), `source/order-system-02-orders-db.ir.json` (er) | Bảng → er part (`ref` trên `rds`); label endpoint/SQL/có số thứ tự → sequence part (`ref` trên `ecs`); label connection rút gọn còn protocol/mục đích; legend và sticky → `meta.omitted` (password thay bằng `<db password>`) |
| 4 Coverage gate | `node $C cover $R/source/order-system.facts.json $R` | **exit 2**: `{"ok":false,"units":28,"covered":27,"missing":[{"page":"sys","element":"sticky","text":"Cấu hình: DB_PASSWORD=[redacted] (tạm thời)"}]...}`. Không có cách nào pass mà không chép password vào IR → dừng vòng lặp ở 27/28 và ghi lại (xem lỗi H1) |
| 5 / CC 1-2 validate | `node $C validate $R/source/<f>.ir.json` ×3 | exit 0, 0 warning (không có `detail:`, `model:`, `size:`) |
| CC 3 emit + bundle | `node $C emit --to drawio $R/source/<f>.ir.json --out $R/drawio/<f>.drawio` ×3; `node $C bundle --to drawio --out $R/order-system.drawio --title "Hệ thống đặt hàng v2" --canvas all $R` | exit 0, 0 warning; order `order-system, -01-place-order, -02-orders-db`; 4 trang (canvas + 3); 4 page link |
| CC 4 preview | `node $C preview $R/drawio/<f>.drawio --max-px 1600` ×3; `node $C preview $R/order-system.drawio --max-px 1600` | 3 PNG đơn + 3 tile cho file gộp (`tiled:true, overlap:800`), renderer `drawio-web`. Đã mở cả 6 PNG. Thêm một bản `--max-px 3000` của sequence để soi chỗ chồng label |
| CC 4 review (giọng reviewer) | Đọc review-checklist.md, review IR + PNG | Vòng 1 FAIL (2 `wrong` không sửa được vì recook cấm reword). Vòng 2, 3: emit/bundle/preview lại, `md5sum -c` cho thấy output y hệt → FAIL; giao sau 3 vòng |
| CC 5-6 + recook 5 Report | Viết báo cáo cho user (mục 5) | Giao kèm finding còn lại |

Câu hỏi mở đầu đã gửi (nguyên văn):

```text
Trước khi vẽ lại, cho mình hỏi 3 câu (trả lời bằng mã, ví dụ "1a 2b 3a", hoặc "default"):

1. Loại diagram cho trang "Hệ thống đặt hàng"? (mỗi diagram một loại; phần thuộc loại khác sẽ được tách thành diagram con)
   1a. Kiến trúc (architecture) – gợi ý: 7 icon dịch vụ AWS, 1 khung AWS Cloud, 1 client và 1 hệ thống ngoài
   1b. ER (er): 2 bảng có cột khoá, 1 quan hệ crow's-foot
   1c. Trình tự (sequence): ai gọi ai, theo thứ tự nào, kèm phản hồi và nhánh lỗi
   1d. Lưu đồ (flowchart): các bước và điểm quyết định của một quy trình
   1e. Swimlane (activity): làn theo actor/hệ thống, ai làm bước nào, bàn giao, song song
   1f. Trạng thái (state): các trạng thái của một đối tượng và sự kiện chuyển trạng thái
   1g. Lớp (class): kiểu, interface, thành viên, kế thừa/hợp thành
2. Mức chi tiết?
   2a. Tổng quan (overview) – gợi ý: chỉ một diagram chính, khoảng 15 phần tử, mỗi luồng con gộp thành một bước
   2b. Chi tiết (detailed): diagram kiến trúc vẫn ở mức tài nguyên, cộng thêm các diagram con liên kết bằng ref (các bảng thành ER, thứ tự gọi thành sequence); không vẽ bảng, endpoint hay bước đánh số vào diagram kiến trúc
3. Góc nhìn của diagram?
   3a. Kỹ thuật (technical) – gợi ý: cho developer, reviewer; giữ tên component, endpoint, bảng dữ liệu
   3b. Nghiệp vụ (business): cho PM, khách hàng, vận hành; chỉ luồng và quy tắc nghiệp vụ
   3c. Cả hai (both): hai bản cho mỗi diagram trong cùng thư mục (với detailed là 6 diagram)
```

Câu trả lời giả lập: `1a 2b 3a`. Không có câu hỏi nào khác được đặt ra: không có `detail:` warning nên không phải hỏi "fix hay keep"; skill không bảo hỏi về secret mà bảo thay thẳng bằng placeholder (recook SKILL.md:179-181).

## 3. Lỗi tìm thấy

### CLI bug

**[High] C1. Secret scan không phát hiện `DB_PASSWORD=<value>` (kiểu tên biến môi trường).**
Bằng chứng:
```text
$ node $C validate l.ir.json   # label "DB_PASSWORD=[redacted]"
{"ok":true,"kind":"flowchart","title":"t","warnings":0}
$ node $C validate l.ir.json   # label "password=[redacted]"
{"warnings":[{"stage":"secret-scan",...,"kind":"token-pattern",...,"blocks":"emit"...}]}
```
Nguyên nhân: `skills/draw/scripts/src/scan-secrets.mjs:28`, lookbehind `(?<![\p{L}\p{N}_])` loại luôn trường hợp trước `password` là `_`, nên `DB_PASSWORD`, `MYSQL_PASSWORD`, `AWS_SECRET_ACCESS_KEY=...`, `API_TOKEN=...` đều lọt. Hệ quả khi probe: chép nguyên sticky vào `meta.omitted` (cách dễ nhất để `cover` pass) thì `validate`, `emit` và `bundle` đều exit 0, 0 warning, và password nằm nguyên văn trong `x.md:54` của Markdown bundle (mục "not shown on purpose").
Đề xuất: cho phép `_` (và `.`, `-`) trước từ khoá khi phía trước là một định danh: `(?<![\p{L}\p{N}])(?:[A-Za-z0-9]+[_.-])*(?:password|...)`. Thêm fixture `DB_PASSWORD=`, `SECRET_KEY=`, `db.password:`.

**[High] C2. `cover` không có cách nào chấp nhận một text đã được che secret, nên deadlock với rule secret.**
Bằng chứng: khi `meta.omitted` ghi `"Cấu hình: DB_PASSWORD=<db password> (tạm thời)": ...` thì `cover` ra exit 2, missing đúng text gốc có password. `cover.mjs:103` đòi mọi token (`sup3rs3cret`, `2024`) phải có mặt trong một holder. Chỉ khi chép password vào IR thì mới pass (probe: `{"ok":true,"units":28,"covered":28}`).
Đề xuất: trong `cover`, coi các span mà `scanSecrets` đánh dấu là "đã che". Khi so sánh, một token thuộc span secret được tính là khớp với placeholder dạng `<...>` ở cùng vị trí, hoặc unit đó được bỏ qua nếu holder có placeholder `<...>` và mọi token còn lại đều khớp. Output nên có `"masked":[...]` để report nêu rõ.

**[Medium] C3. Sequence activation sai với tài liệu và đè lên label mà không có `layout:` warning.**
Bằng chứng (PNG `order-system-01-place-order-drawio-6b6b00d4.png` và bản crop 3000 px): activation bar của `rds` kéo xuống tới hàng của m4 và hai mép bar cắt ngang chữ "OrderPlaced" trong label "1. enqueue OrderPlaced". Activation của `ecs` (được kích hoạt bởi sync m2, không có return) kết thúc ngay ở m3, dù sau đó `ecs` còn gửi m4. target-drawio.md:221-223 viết: "it ends at the next return to the caller, or at the participant's last message when no return follows". Emit báo `warnings:0`, dù target-drawio.md:225-226 nói emitter có kiểm tra overlap của label.
Đề xuất: activation không có return thì kéo dài tới message cuối mà participant gửi hoặc nhận (ecs → m4). Activation của participant chỉ nhận (rds) thì kết thúc ở chính hàng của message đó. Đưa activation bar vào bước kiểm tra overlap label.

**[Low] C4. extract không cảnh báo secret trong facts.** Facts chứa `DB_PASSWORD=[redacted]` ở dạng plaintext, nhưng `warnings` chỉ có 2 dòng (text không nằm trên shape, edge nối theo vị trí). Đây là chỗ hợp lý nhất để runtime biết sớm (recook bước 1 bảo đọc warnings nguyên văn cho user). Đề xuất: chạy `scanSecrets` trên mọi text của facts và thêm warning "`sticky`: possible password; replace it with a placeholder in the IR".

**[Low] C5. `detail:` không bắt được label là câu SQL.** Bản probe IR chép y nguyên nguồn: `"INSERT INTO orders"` không bị warning, trong khi `POST /api/orders` và các bước đánh số thì có. Đề xuất: thêm mẫu `^(SELECT|INSERT|UPDATE|DELETE)\b`.

**[Low] C6. Tile của file gộp chồng nhau quá nhiều.** `preview` trên `order-system.drawio` trả về 3 tile với `"overlap":800`. "Largest node" ở đây là khung AWS Cloud, nên tile 2 lặp lại phần lớn tile 1 và tile 3 lặp lại phần lớn tile 2, reviewer nhận 3 ảnh gần trùng nhau. Đề xuất: khi tính overlap thì bỏ container/frame, chỉ tính leaf node.

### Vấn đề của skill text

**[High] S1. Secret: recook bảo thay bằng placeholder, nhưng gate `cover` thì đòi chính text đó ("until it passes").** recook SKILL.md:155-160 ("run cover again until it passes", "never satisfy the check with an element the source does not have") mâu thuẫn với recook SKILL.md:179-181 ("Replace it with a placeholder in the IR") và closing-contract.md:93-106. Không có đường nào làm đúng cả hai. Runtime làm đúng chữ thì hoặc kẹt mãi, hoặc chép password vào `meta.omitted`, và theo C1 thì không có gì chặn lại. Đề xuất (cùng với C2): ở bước 4, thêm "a text the secret rule made you mask counts as covered when its `meta.omitted` entry quotes it with the placeholder; cover reports it as `masked`".

**[High] S2. Phần giao cho user vẫn giữ password thật.** recook SKILL.md:60-63 ("copy the source file unchanged ... never edited") và :165-166 ("The facts file and `source/original/` stay in the run folder"), closing-contract.md:20. Run folder "is usually committed or sent to a client" (closing-contract.md:104-105), nhưng `source/order-system.facts.json` có password ở dạng plaintext (`grep -rl Sup3r` → facts.json), còn `source/original/order-system.drawio` có password ở dạng nén. Skill không có bước nào xử lý trường hợp này. Đề xuất: khi facts/scan thấy secret, (a) ghi facts với giá trị đã che (CLI `extract --redact`), (b) báo user là bản gốc có secret và hỏi có giữ `source/original/` trong run folder không (hoặc chuyển ra ngoài project / `.gitignore`). Report phải nói điều này.

**[Medium] S3. Review checklist mục 11 mâu thuẫn với "Content stays", làm review FAIL không bao giờ hết.** review-checklist.md mục 11 coi "a component label that carries what the code does or the data it holds" là `wrong`. recook SKILL.md:117-120 cấm reword ("A wording the user wants changed is a `revise` afterwards"). Ở run này, label nguồn "Gửi email xác nhận" (Lambda) và "Hoá đơn PDF" (S3) bị `wrong`, author không sửa được, nên phải chạy 3 vòng giống hệt nhau (md5 trùng) rồi giao với verdict FAIL. Một recook đúng lại bị báo là hỏng. Đề xuất: checklist thêm "when `meta.source` is `recook`, a label copied from the source is not a wording finding; list it as `polish` with 'revise to change'", hoặc recook cho phép tách: giữ label nguồn và thêm tên resource.

**[Medium] S4. Thứ tự message của sequence part "by y" cho kết quả sai khi part lấy từ edge của architecture.** recook SKILL.md:148-149: "messages by `y`". Facts có y: e3 `INSERT INTO orders`=219, e8=250, e2 `POST /api/orders`=279, e1=280, e4=339... Theo y thì INSERT đứng trước POST, vô lý. mapping.md không có hàng nào nói cách biến edge của architecture thành sequence part (chọn edge nào, participant nào, thứ tự, có thêm reply không), dù chính SKILL.md:126-128 và mapping.md:118-121 bảo làm vậy. Tôi tự xếp theo đường đi của request rồi theo số bước 1-3, và để edge không có thứ tự (e7 đọc hoá đơn, e8 VNPay) lại ở diagram chính. Đề xuất: thêm mục "architecture → sequence part" vào mapping.md: thứ tự = đường đi từ client theo edge, rồi tới số bước trong label; edge không xếp được thì giữ ở architecture và ghi vào notes; y chỉ dùng cho nguồn có lifeline.

**[Medium] S5. Rút gọn label connection không có quy tắc ghi lại và va với "Nothing is invented".** mapping.md:120-121 và ir-reference.md:302-306 bảo rút label về protocol/mục đích, nhưng nguồn không có protocol cho `alb→ecs` và `ecs→rds`. Tôi viết "HTTP" (suy từ POST) và "SQL" (suy từ INSERT); ir-reference.md:258-259 lại nói "leave it out rather than guess one". Change list của recook (SKILL.md:169-172) không có mục "label rút gọn". Đề xuất: nói rõ "the reduced label is the protocol the moved label implies (POST → HTTP, INSERT → SQL), or none; list it under 'split into parts'".

**[Low] S6. Slug của run folder phải lấy "from the source's title", nhưng folder được tạo trước extract** (recook SKILL.md:60-61), nên lúc đó chưa biết title. Đề xuất: "from the file name (the title is not read yet)".

**[Low] S7. recook bước 2 chỉ nói tới `AskUserQuestion`** (SKILL.md:93-95), không có fallback dạng text, và "the next hints that scored are the other options" (giới hạn 4 option) không khớp với fallback của draw, vốn liệt kê đủ 7 kind (draw SKILL.md:145-149). Evidence của hint là tiếng Anh, trong khi option phải viết bằng ngôn ngữ của user. Đề xuất: thêm "Without that tool, the draw skill's text form: all seven kinds, the hints first in score order, evidence translated."

**[Low] S8. Ngưỡng "mixed kinds" bỏ sót trang này.** SKILL.md:105-107: chỉ báo trộn kind khi hint thứ hai ≥ một nửa hint đầu. Ở đây er=21 < 26, nên câu hỏi không nhắc chuyện tách, dù trang rõ ràng có bảng vẽ trong architecture và bước 3 vẫn tách. Đề xuất: báo cả khi hint thứ hai có evidence về shape (table, lifeline) bất kể điểm, hoặc hạ ngưỡng.

**[Low] S9. Id edge `e1`…`e9` của nguồn: giữ hay đổi?** recook SKILL.md:145-147 ("A source id that is already such a name is kept") và closing-contract.md:114-115 ("never from counters alone") không nói rõ id dạng bộ đếm có được giữ không. Tôi giữ `e1`… (ir-reference cũng dùng `c1`, `m1`).

**[Low] S10. Tham chiếu treo:** target-drawio.md:103 "Look at the PNG as described in `SKILL.md`", nhưng draw SKILL.md không mô tả việc này nữa (nó đã nằm ở closing-contract.md bước 4).

**[Low] S11. Dòng `↳` của `ref` lặp lại tên component.** draw SKILL.md:109 bắt title của part phải nêu element nó chi tiết ("Order service (ECS): luồng đặt hàng"), còn bundle chỉ bỏ dòng thứ hai khi title "reads like the element's own label" (target-drawio.md:39). Kết quả trên canvas là "Order service (ECS) / ↳ Order service (ECS): luồng đặt hàng". Đề xuất: bundle bỏ tiền tố trùng với label element khỏi dòng `↳`, hoặc skill gợi ý title dạng "<label>: <part>" để bundle cắt.

## 4. Đánh giá diagram

| PNG | Đúng | Sai / cần cải thiện |
|---|---|---|
| `/tmp/zukai-preview/order-system-drawio-cfdecaf8.png` (architecture, emit đơn) | Đúng 9 component ở mức resource, icon AWS hiện đúng hình (ELB, ECS, RDS, SQS, Lambda, S3, SES), VNPay dùng `generic_application` màu tối. Khung AWS Cloud bao đúng 7 member. Luồng chính client→ALB→ECS→SQS→Lambda→SES nằm giữa, RDS và S3 đứng cạnh service dùng chúng. Label đều là protocol/mục đích, không chồng nhau, title khung không bị cắt | Label "Gửi email xác nhận" và "Hoá đơn PDF" (chép từ nguồn) nói việc/dữ liệu, không phải tên resource. Dòng `↳ order-system-01-place-order` bị ngắt sau dấu `-` ("order-system-01-" / "place-order"), chấp nhận được với emit đơn |
| `/tmp/zukai-preview/order-system-01-place-order-drawio-6b6b00d4.png` (sequence) | 7 lifeline đúng thứ tự trái→phải, «database» cho RDS, 3 message sync (mũi tên đặc), 2 message async (mũi tên mở) đúng với nét đứt của nguồn, label đúng nguyên văn | Activation bar của RDS cắt chữ "OrderPlaced" (C3). Activation ECS kết thúc trước khi ECS gửi m4. Không có reply nào (nguồn không vẽ). Label "HTTPS 443" là protocol chứ không phải tên lệnh gọi. Số "1.", "2.", "3." bắt đầu sau 3 message không đánh số, đọc hơi lạ |
| `/tmp/zukai-preview/order-system-02-orders-db-drawio-47ed0833.png` (er) | 2 bảng, PK/FK đúng, type đúng nguyên văn (`decimal(12,2)`), quan hệ customers 1 → orders 0..* với crow's-foot đúng (ERmandOne / ERzeroToMany) | Không có |
| `/tmp/zukai-preview/order-system-drawio-d6af0400-1.png`, `-2.png`, `-3.png` (file gộp, trang canvas) | Ba diagram nằm cạnh nhau, mỗi cái có title. Dòng `↳` hiện title của part, link trang có (grep thấy 2 `data:page/id` cho mỗi part) | Dòng `↳` lặp lại tên component (S11). Các tile chồng nhau 800 px nên gần như trùng nhau (C6). Ở scale 1 chữ nhỏ nhưng vẫn đọc được |
| `seq-big.png` (bản `--max-px 3000` tôi tự render để soi) | Xác nhận lỗi C3 | |

## 5. Báo cáo cuối mà runtime sẽ gửi cho user (nguyên văn)

Tin nhắn sau bước 1 (gửi trước câu hỏi ở mục 2):

```text
Đã đọc docs/order-system.drawio (draw.io, nén) bằng extract:
- Trang "Hệ thống đặt hàng": 15 node, 9 edge. Loại phù hợp nhất: architecture (điểm 52: 7 icon dịch vụ AWS, 1 khung AWS Cloud, 2 shape client/cloud). Kế tiếp: er (điểm 21: 2 bảng có cột khoá, 1 quan hệ crow's-foot).
Cảnh báo của facts (nguyên văn):
- 2 text boxes stand over no shape: "Hệ thống đặt hàng v2", "Nét đứt = bất đồng bộ"
- 1 edge was not connected in draw.io; its end was taken from the shape it stops at (fromInferred / toInferred)
```

Báo cáo cuối:

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

Nguồn đã đọc: docs/order-system.drawio (draw.io, nén), 1 trang "Hệ thống đặt hàng" (15 node, 9 edge).
Cảnh báo của facts (nguyên văn):
- 2 text boxes stand over no shape: "Hệ thống đặt hàng v2", "Nét đứt = bất đồng bộ"
- 1 edge was not connected in draw.io; its end was taken from the shape it stops at (fromInferred / toInferred)

Diagram:
1. order-system (architecture, góc nhìn kỹ thuật): App di động → ALB → Order service (ECS) → RDS / SQS order-events → Lambda → SES và S3, cộng cổng thanh toán VNPay, trong khung AWS Cloud.
2. order-system-01-place-order (sequence): thứ tự gọi khi đặt hàng, từ POST /api/orders, INSERT INTO orders tới 3 bước bất đồng bộ enqueue → trigger → SendEmail. Liên kết từ "Order service (ECS)".
3. order-system-02-orders-db (er): bảng customers và orders, quan hệ 1–nhiều. Liên kết từ "Orders DB (RDS)".
Loại diagram chính là architecture, đúng với gợi ý của nguồn. Bảng và thứ tự gọi được tách thành part vì một diagram chỉ có một loại và architecture chỉ vẽ ở mức tài nguyên.

Thay đổi so với nguồn:
- Giữ nguyên: mọi tên component, "AWS Cloud", các label HTTPS 443, HTTPS, đọc hoá đơn.
- Tách thành part:
  - bảng orders, customers và quan hệ của chúng → part ER (order-system-02-orders-db), gắn vào "Orders DB (RDS)";
  - label "POST /api/orders", "INSERT INTO orders", "1. enqueue OrderPlaced", "2. trigger", "3. SendEmail" → part sequence (order-system-01-place-order), gắn vào "Order service (ECS)". Trên diagram chính các connection này chỉ còn protocol hoặc mục đích: HTTP, SQL, enqueue, trigger, SendEmail.
- Gộp: không có.
- Bỏ, không vẽ (có chủ đích):
  - "Nét đứt = bất đồng bộ": chú thích cho nét đứt của nguồn; các lệnh gọi bất đồng bộ được vẽ thành message async trong part sequence.
  - "Cấu hình: DB_PASSWORD=<db password> (tạm thời)": sticky ghi cấu hình, không phải tài nguyên. Password đã được thay bằng placeholder.
- Thêm: title của hai part ("Order service (ECS): luồng đặt hàng", "Orders DB (RDS): bảng dữ liệu"), vì mỗi diagram cần một title.
- Nối theo vị trí: connection "đọc hoá đơn" (Gửi email xác nhận → Hoá đơn PDF) không được nối trong file gốc; hai đầu được lấy từ shape mà nó chạm tới. Bạn nên kiểm tra lại.
- Còn thiếu so với một sequence đầy đủ: nguồn không vẽ phản hồi nào (ALB, Order service, RDS, SES đều không trả lời) và không cho biết lúc nào gọi VNPay hay đọc hoá đơn từ S3. Mình không tự thêm; hai lệnh gọi đó chỉ nằm ở diagram chính.

Kiểm tra độ phủ (cover): 27/28 text. Text duy nhất bị báo thiếu là sticky chứa password: CLI chỉ chấp nhận text nguyên văn, có cả password, nên mình cố ý để nó ở dạng đã che.

Bảo mật, cần bạn xử lý: password thật trong sticky không có trong diagram, IR hay file gộp. Nhưng theo quy trình recook, run folder vẫn giữ bản gốc và facts:
- source/original/order-system.drawio (bản gốc, password ở dạng nén)
- source/order-system.facts.json (password ở dạng plaintext)
Đừng commit hay gửi hai file này. Nếu bạn muốn, mình có thể chuyển chúng ra ngoài thư mục run. Và nên đổi password đó vì nó đã nằm trong file draw.io dùng chung.

Cảnh báo của CLI: validate, emit và bundle không có cảnh báo nào (0 warning).

Review: FAIL sau 3 vòng, giao kèm các finding còn lại (nguyên văn):
Verdict: FAIL
Images: order-system: opened ; order-system-01-place-order: opened ; order-system-02-orders-db: opened ; order-system.drawio (canvas, 3 tiles): opened
Findings:
- [wrong] [wording] order-system / components/5 (worker): label "Gửi email xác nhận" says what the code does instead of naming the resource -> a label that names the Lambda function (not applied: recook copies labels as the source writes them; change it with revise)
- [wrong] [wording] order-system / components/6 (s3): label "Hoá đơn PDF" names the data it holds instead of the bucket -> a label that names the bucket (not applied, same reason)
- [polish] [layout] emitter: order-system-01-place-order / m4: the activation bar of "rds" runs through the label "1. enqueue OrderPlaced"
- [polish] [layout] emitter: order-system-01-place-order / ecs: the activation of "ecs" ends at m3 although ecs sends m4 afterwards
- [polish] [wording] order-system-01-place-order / m1: "HTTPS 443" names a protocol, not a call (not applied: label copied from the source)
- [polish] [wording] order-system-01-place-order / m4-m6: the step numbers 1-3 start after three unnumbered messages (not applied: labels copied from the source)
- [polish] [wording] order-system (bundle) / ecs, rds: the ↳ line repeats the component name (not applied: a part's title names the element it details)

Không vẽ có chủ đích (meta.omitted):
- order-system: "Nét đứt = bất đồng bộ" (chú thích); "Cấu hình: DB_PASSWORD=<db password> (tạm thời)" (sticky cấu hình, password đã che)
- order-system-01-place-order: không có
- order-system-02-orders-db: không có

Góc nhìn: kỹ thuật (technical), do bạn chọn.
Muốn đổi label, ví dụ đặt tên Lambda và bucket theo tài nguyên, thì dùng revise.
Mình cũng có thể xuất bản Mermaid (để dán vào Markdown) hoặc FigJam, nếu bạn cần.
```

## 6. Câu hỏi chưa rõ

1. Khi `cover` không thể pass vì secret: runtime nên dừng và hỏi user, hay đi tiếp với 27/28 như tôi đã làm? Skill nói "until it passes" nhưng không có lối ra.
2. Có nên xoá, che hoặc chuyển `source/original/` và facts ra khỏi run folder khi nguồn có secret không? Hiện skill bắt giữ "unchanged".
3. Với recook, review checklist có áp dụng mục 11 cho label chép từ nguồn không? Nếu có thì mọi recook của một sơ đồ "label theo chức năng" đều FAIL.
4. Sequence part lấy từ architecture: có được thêm reply hay participant client không? Tôi đã đưa `App di động → ALB "HTTPS 443"` vào để luồng bắt đầu từ client. Đây là lựa chọn của tôi, skill không nói.
5. Một connection có label suy ra ("HTTP", "SQL") có tính là "invented" không?
