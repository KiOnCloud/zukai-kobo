FAIL

# E2E xác nhận: recook từ FigJam board thật (commit 42f5fa7)

## 1. Kết luận

FAIL. Cả ba request đều ra file (2 draw.io, 1 Mermaid), `cover` đạt 100 %, review PASS ngay vòng 1, và các fix lớn của lần trước có tác dụng thật: H2, M1–M4, M6 đã sửa, H1 sửa được phần flowchart, state, activity, sequence và architecture. Nhưng facts vẫn chưa khớp board ở bốn chỗ mức Medium: message async thành sync, một self-message bị nối vào note, ranh giới nhánh `else` bị mất, và icon AWS cùng group frame bị mất. Thêm vào đó, link board mà skill bắt ghi vào `meta.notes` lại làm `emit --to figjam` (target mặc định của board) bị từ chối. Phần H1 cho board ER và class native vẫn đọc sai (High, ngoài ba request nhưng nằm trên cùng page).

Phạm vi: board `45AQFIpbiwRlA0biqsBxCY`, chỉ đọc (5 lần `use_figma`, code là reader script do CLI viết, giữ nguyên). Không gọi `generate_diagram` hay `create_new_file`, không ghi gì lên board.

Số byte phải chép tay (M5, đã biết, ngoài phạm vi): 9 426 (18:444) + 10 033 (20:444) + 121 561 (cả page, 3 phần) = **141 020 byte**, kiểm bằng số node (`total`) sau mỗi phần.

### Diễn biến theo request (tóm tắt)

| Request | Facts | Câu hỏi đã hỏi (text, không có AskUserQuestion) | Trả lời mô phỏng | Kết quả |
|---|---|---|---|---|
| 1. 18:444 → drawio | 1 page, 8 node, 10 edge, hint `sequence` 44 ("4 lifelines", "2 block frames") | 1) Loại diagram (1a Trình tự (sequence) – gợi ý: 4 lifeline, 2 khung block; 1b–1g sáu loại còn lại); 2) Mức chi tiết (2a Tổng quan (overview) – gợi ý / 2b Chi tiết (detailed)); 3) Góc nhìn của diagram? (3a Kỹ thuật (technical) – gợi ý / 3b Nghiệp vụ (business) / 3c Cả hai (both)) | 1a, 2a, 3a | `diagrams/20261113_login-with-password/`, cover 21/21, review PASS vòng 1 |
| 2. 20:444 → drawio | 1 page, 15 node, 9 edge, hint `architecture` 74 ("9 service icons", "5 cloud group frames") | giống trên, kiến trúc gợi ý | 1a, 2a, 3a | `diagrams/20261113_order-platform-on-aws/`, cover 24/24, review PASS vòng 1 |
| 3. cả page → mermaid | 3 phần (`next` 394, 862, null), 19 page facts; page `#18` (tên `""`) là state diagram | Không hỏi kind (request nêu "sơ đồ trạng thái"), không hỏi page (request nêu "Awaiting payment, Paid … trực tiếp trên page"). Chỉ hỏi 1) Mức chi tiết, 2) Góc nhìn | 1a (overview), 2a (technical) | `extract … --page "page:Page 1#18"`, `diagrams/20261113_order-states/`, cover 11/11, review PASS vòng 1 |

Câu hỏi thêm ở cả ba run (do secret scan, xem N1): "Cảnh báo `high-entropy` nằm ở link board trong ghi chú nguồn (`meta.notes`). Đây có phải bí mật không, hay giữ nguyên?" Trả lời mô phỏng của PM: "Không phải bí mật, đó chỉ là link board, cứ giữ." Với draw.io và Mermaid đó chỉ là cảnh báo, nên không cần `--allow-sensitive`.

Đối chiếu với fixture (`cover <facts> <fixture>`): sequence 21/21, architecture 24/24, state 11/11, đều exit 0. `diff` ngữ nghĩa so với fixture:
- R1: chỉ khác ở `m10` "Audit login attempt", fixture là `async`, IR ra `sync` (N2).
- R2: `fulfilment-worker` mất `aws:lambda`, vì nhãn không nêu dịch vụ (N5). Tôi thêm `aws:generic_application` cho Payment provider theo draw skill.
- R3: khớp hoàn toàn; chỉ title là chữ thêm vào (N8).

## 2. Bảng xác nhận các finding cũ

| Finding | Verdict | Bằng chứng từ lần chạy này |
|---|---|---|
| H1 extract đọc sai board `emit --native` | **NOT FIXED (một phần)** | Đã đúng với flowchart: page `#2` "Order checkout (native)" có `decision`, `io`, `note`, `subroutine`, 9 edge với nhãn yes/no/captured. Đúng với state `#7` (initial/final/composite), activity `#4/#9/#11` (lane, decision), sequence 18:444 (4 lifeline, 2 frame, 2 note) và architecture 20:444 (5 group, 9 icon, 9 edge đúng đầu). **Vẫn sai** với ER native `#5` "Order data model (native)": quan hệ "places" và "appears in" thành node `box`, vì group có ELLIPSE của đầu crow's-foot mà `drawnKind` đòi `ellipses.length === 0` cho edge; `x:r4` mất; chỉ còn 1/4 edge. Class native `#3`: mọi đầu đều `classic` (tam giác rỗng và diamond mất), multiplicities nhập vào label (`"1\nlines\n1..*"`) thay vì `startLabel`/`endLabel`. Tên group `x:<id>` vẫn bị bỏ qua. Sequence: mũi tên mở (async) không phân biệt được (N2) |
| H2 cover không giới hạn theo diagram | **FIXED** | `extract --page` có sẵn; R3 dùng `--page "page:Page 1#18"` → facts 1 page, cover 11/11. `cover.mjs` lọc theo `page "<name>"` trong `meta.notes`. Cover cùng IR với facts cả page cho 11/341, đúng là chữ của các page khác |
| M1 kind hint sai cho state của `generate_diagram` | **FIXED** | Page `#18`: hint duy nhất `state` 10 ("1 initial state, 1 final state", "1 edge labelled [guard]"), ellipse 32 px → `initial`, group 2 ellipse → `final` |
| M2 reader chỉ tìm section theo tên | **FIXED** (còn Low) | `--section "18:444"` và `"20:444"` chạy được với một `use_figma`. Còn lại: script lấy section đầu tiên trùng tên, không báo lỗi khi trùng (N10) |
| M3 cover nhận text trong `meta.notes` | **FIXED** | Thử: bỏ note n1 khỏi IR và đưa "Rate limited per IP" vào `meta.notes` → cover exit 2, missing 73:480, hint "a meta.notes entry does not count" |
| M4 bảng ER của FigJam có `label ""` | **FIXED** (còn Low) | Page `#16`: `label "Customer"`, `"Order"` … Nhưng `texts[0]` vẫn lặp lại tên (`["Customer", "uuid id PK", …]`) (N11) |
| M5 chép kết quả `use_figma` tốn kém | **OUT OF SCOPE** (đã biết) | 141 020 byte chép tay, 5 lần gọi; request 3 cần 121 561 byte chỉ để lấy 7 node |
| M6 kind nêu bằng tiếng Việt | **FIXED** | SKILL §2 thêm bullet "A kind the request names in the user's language … the kind question is skipped". R3 bỏ câu kind |
| M7 "Content stays" đụng quy tắc khác | **FIXED** | (a) §3 "What a Zukai drawing adds is not content": dòng `↳ <slug>` là `ref`. (b) ＜＞％＆ viết lại thành ASCII: R3 có guard `attempts < 3`. (c) Ngôn ngữ: recook nói "no translation", và closing contract §4 coi việc đổi chữ của nhãn recook là `polish`. closing-contract "Rules" vẫn viết "Write them in the user's language" mà không có ngoại lệ, nhưng không gây hậu quả |
| H3 không có lối thoát khi facts tự mâu thuẫn | **FIXED** (về văn bản) | §3 thêm "Facts that cannot be right … say in the report which elements look misread, keep what is sure". Đã dùng cho edge 73:509 (N3). review-checklist vẫn không cho reviewer xem facts hay so số node/edge (N9) |
| L1 page không tên `name: ""` | **NOT FIXED** | Page `#16`–`#19` vẫn `"name": ""`; R3 phải dùng id `page:Page 1#18` trong note và `--page` |
| L1 "boxs", "boundarys" | **FIXED** | Evidence: "4 tables", "6 rounded boxes", "30 boxes", "5 boundaries" (`plural()` mới) |
| L1 CHEVRON→note, PREDEFINED_PROCESS→subroutine | **NOT FIXED** | Page `#17`: "Payment provider" `note`, "SQS orders" `subroutine` (`SHAPE_TYPES` dòng 114–115) |
| L1 Bundle Mermaid heading đôi | **NOT FIXED** | `order-states.md`: `# Trạng thái đơn hàng` rồi `## Trạng thái đơn hàng` |
| L2 `get_metadata` | **FIXED** | Không còn trong SKILL; node-id đi thẳng vào `--section` |
| L2 target-figjam.md "for loading the Figma tools" | **NOT FIXED** | target-figjam.md chỉ có hướng dẫn load cho §5/§7 (vẽ), bảo dùng cả `figma-use-figjam`; không có phần đọc board |
| L2 Thiếu `ReadMcpResourceTool`, nên dùng `get_figma_skill` | **NOT FIXED** (phụ thuộc môi trường) | Lần này cũng không có `ReadMcpResourceTool`; đã đọc `skill://figma/figma-use/SKILL.md` bằng `get_figma_skill`. Skill không nhắc tool này |
| L2 Slug run folder trước khi đọc board | **FIXED** | §1.4 tạo folder sau khi đọc, slug "of what the source shows" |
| L2 `recooked from source/original/<file>` | **FIXED** | Giờ là "`<source path or board link>`, page "<name>"" |
| L2 Title khi diagram không có tên | **NOT FIXED** | R3: không có hướng dẫn; tôi lấy title từ lời user và ghi `added:` (N8) |
| L2 Báo cáo phải liệt kê 25 entry omitted | **FIXED** | Nhờ `--page`, không IR nào cần `meta.omitted` |

## 3. Lỗi mới

### Medium

**N1 (skill text và CLI mâu thuẫn): link board bắt buộc trong `meta.notes` bị secret scan coi là token; `emit --to figjam` bị từ chối.**
- Bằng chứng: cả ba IR khi `validate` đều có `{"stage":"secret-scan","path":"/meta/notes/0","kind":"high-entropy","message":"high-entropy string (com/…(43 chars)) looks like a token; confirm it is not a secret"}`.
- `emit --to figjam` của R1 và R2 ra exit 2, `refusing to emit for figjam`. Vậy recook một board với `--to` mặc định (`figjam`) không thể emit nếu không hỏi user và dùng `--allow-sensitive`, chỉ vì dòng mà SKILL §3 bắt phải ghi.
- Với drawio và Mermaid, closing contract buộc hỏi user (tôi đã hỏi) và cảnh báo vẫn còn trong mọi emit.
- Sửa (CLI): `scan-secrets` bỏ qua URL `figma.com/(board|design|file)/<key>` (file key không phải credential), ít nhất trong `meta.notes`. Hoặc (skill) ghi link không có file key, nhưng như vậy mất nguồn.

**N2 (CLI): message async trên board native đọc thành sync.**
- `drawnKind` trả `endArrow: drawn.arrow ? 'classic' : 'none'` cho mọi mũi tên, nên "Audit login attempt" (fixture `async`, mũi tên mở) ra `classic`.
- mapping.md ("solid line with an `open` end `async`") làm IR ra `sync`, và review không bắt được vì reviewer không thấy board.
- Sửa: reader trả thêm `closed`/`filled` cho VECTOR (như H1(a) đề nghị); `drawnKind` phân biệt đầu kín có fill (`block`) với chữ V mở (`open`). Thêm fixture sequence native có async vào test.

**N3 (CLI): self-message bị nối vào note.**
- Edge 73:509 "Verify password hash" có `"from":"73:470","to":"73:484"`, tức `to` là note "Hash: argon2id".
- Nguyên nhân: `at()` lấy shape có diện tích nhỏ nhất chứa đầu nét trong `DRAWN_NEAR` = 16 px. Điểm (14359, 292) nằm cách mép trên của note (y 308) đúng 16 px, và note nhỏ hơn lifeline.
- Theo chữ của skill thì message không được tới note; tôi dùng quy tắc "Facts that cannot be right", vẽ thành self-message của Auth service và ghi chú.
- mapping.md chỉ mô tả self-message của `generate_diagram` (2–3 edge không nhãn + text tự do), không mô tả dạng native (một edge có nhãn, quay về chính lifeline).
- Sửa: trong page có lifeline, đầu của edge chỉ được nối vào lifeline (không vào note, frame); hai đầu cùng nằm trên một đường lifeline (±10 px) thì là self-message. Thêm một dòng vào mapping.md cho dạng native.

**N4 (CLI): facts không cho biết nhánh `else` bắt đầu ở đâu.**
- Frame 73:446 chỉ có `texts: ["else password wrong"]`. Vạch chia 73:447 (group `x:b1:sep-1`) bị bỏ, kèm warning "1 line without arrow or label … left out as drawing (a pictogram, a divider)".
- Runtime phải đoán m6, m7 | m8, m9 (tôi đoán theo nghĩa 200/401 và ghi chú "unsure").
- Facts của Mermaid thì có `detail: "alt e3..e4 | else e5"`.
- Sửa: extract ghi y của mỗi branch (`detail: "alt | else at y=480"`, hoặc `texts` kèm y) và mapping.md nói cách chia message theo y.

**N5 (CLI và skill text): board AWS native mất icon, group frame và kind kho dữ liệu.**
- Mọi icon là `drawio:unknown`; group không có `aws:*`.
- mapping.md: `drawio:` → "component without icon, of the kind its label says (client …, else service)". Làm đúng chữ thì Aurora, S3, ElastiCache và SQS đều là `service`, không icon, frame trơn.
- Nhưng SKILL §3 bảo đọc đoạn "AWS icons" của draw skill: "set `icon` on each component that is an AWS service". Hai chỉ dẫn này trái nhau. Tôi theo đoạn AWS icons (chọn icon từ nhãn, ghi `added:`); "Fulfilment worker" không có icon (fixture là `aws:lambda`).
- Sửa (CLI): native emitter ghi tên group dạng `x:<id> aws:<icon>` (hoặc reader trả màu fill và extract so với `stencil-paths.json`), để extract trả `aws:<name>`. Sửa (skill): mapping.md nói rõ khi nhãn nêu dịch vụ AWS thì lấy icon từ `aws-icons.md` và kind theo dịch vụ, ghi `added:`.

### Low

- **N6 (skill text):** note "Rate limited per IP" chồng lên cả hai ô đầu Web app và Auth service. "beside or over the participants its box overlaps" cho ra `over web, auth`, trong khi nguồn là `right of web`. Nên nói theo đường lifeline (tâm), không theo box của head.
- **N7 (CLI):** khi đọc cả page, chính section trở thành node `container` của page facts. `#6` có 9 node, đọc theo section thì 8. Với state `#7`, mapping "container holding states → composite" sẽ bọc cả diagram. Nên bỏ section gốc khỏi nodes (dùng làm `name`).
- **N8 (skill text):** không nói title lấy từ đâu khi page không tên (cũng là L2 cũ).
- **N9 (skill text):** review-checklist không cho reviewer xem facts. N2–N4 không ai bắt được trong review.
- **N10 (CLI):** reader không báo lỗi khi hai section trùng tên.
- **N11 (CLI):** table FigJam vẫn lặp tên trong `texts[0]`.
- **N12 (render, `emitter:`):** Mermaid đặt nhãn "flagged" và đường của nó cắt qua tiêu đề "Under review", và nhãn self-loop "more data" chạm mũi tên. Đây là layout của Mermaid; IR không sửa được.

## 4. Đánh giá diagram (PNG đã mở)

| PNG | Đánh giá |
|---|---|
| `/tmp/zukai-preview/login-with-password-drawio-ba47a666.png` (single) và `…-b3e9c491.png` (bundle, có title) | Đúng nội dung facts: 4 participant (actor có hình người, «control», «database»), loop bao m1–m9, alt có dải else, 2 note đúng chỗ, activation hợp lý, không chồng nhãn. Khác nguồn ở "Audit login attempt" mũi tên đặc (sync, do N2). Verdict reviewer: PASS, không finding wrong |
| `/tmp/zukai-preview/order-platform-on-aws-drawio-2c168598.png` và `…-5bbc8161.png` | AWS diagram đẹp: 5 frame lồng đúng, icon CloudFront, S3, ALB, Fargate, Aurora, ElastiCache, SQS đúng dịch vụ. Payment provider ở trên, ngay hàng với caller; đường "capture payment" cắt mép trên các frame, không qua tiêu đề. "Fulfilment worker" là hộp trơn (không icon, N5), reviewer ghi `polish`, không áp dụng được vì nhãn không nêu dịch vụ. PASS |
| `/tmp/zukai-preview/order-states-mmd-6911db00.png` và `order-states-md-90a945a1-d1.png` | Đủ 5 state, composite Under review chứa Checking và On hold, 2 self-loop, initial/final, guard `attempts < 3` hiện ASCII. Lỗi layout của Mermaid (N12): đường "flagged" xuyên tiêu đề composite, self-loop rất nhỏ. Ghi `emitter:`, không chặn PASS. PASS |

File bàn giao (dưới `/tmp/claude-0/-home-user-zukai-kobo/4a7ef9ef-051f-57b9-90d6-65ba14b3e4be/scratchpad/e2e/c2-proj/diagrams/`):
- `20261113_login-with-password/login-with-password.drawio`
- `20261113_order-platform-on-aws/order-platform-on-aws.drawio`
- `20261113_order-states/order-states.md` (+ `mermaid/order-states.mmd`)

Facts trong `source/` của từng run. Board JSON đã chép nằm ở `…/e2e/c2-tmp/`.

Status: DONE_WITH_CONCERNS
Summary: FAIL. Ba request đều giao được: cover 100 %, review PASS, và H2, M1–M4, M6, M7 đã sửa. Nhưng còn các lỗi Medium về độ trung thực của facts (async, self-message vào note, nhánh else, icon AWS), và link board trong `meta.notes` làm `emit --to figjam` bị từ chối.
Concerns/Blockers: H1 vẫn sai với board ER và class native (High, ngoài ba request). 141 020 byte phải chép tay (M5).
