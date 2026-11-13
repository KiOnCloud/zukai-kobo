FAIL

# E2E xác nhận lần 3: recook từ FigJam board thật (commit 8ad47cb)

## 1. Kết luận

FAIL. Cả bốn request đều ra file (3 draw.io, 1 Mermaid). `cover` đạt 100 % với cả facts lẫn fixture, review PASS ngay vòng 1. N1–N4 đã sửa thật: link board không còn bị secret scan chặn, async, self-message và nhánh `else` giờ đều đọc đúng. Còn hai lỗi làm diagram lệch nguồn. (a) H1 phần class: tam giác rỗng và diamond rỗng trên board native bị đọc là "đặc", nên aggregation `r6` thành composition mà không có cảnh báo nào. (b) Lỗi CLI mới mức Medium: đầu ER `zero-one` luôn đọc ra `ERzeroToMany`. Lần này bắt được chỉ nhờ quy tắc "đường xiên thì hỏi" của mapping.md, mà quy tắc đó lại quy nguyên nhân sai.

Phạm vi: board `45AQFIpbiwRlA0biqsBxCY`, chỉ đọc. Có 4 lần `use_figma`, code là reader script do CLI viết, giữ nguyên (bốn file chỉ khác dòng `SECTION`, đã `diff`). Không gọi `generate_diagram`, `create_new_file` hay `get_screenshot`.

Số byte phải chép tay (M5, ngoài phạm vi): 9 692 (18:444) + 6 874 (17:444) + 7 237 (15:444) + 10 722 (20:444) = **34 525 byte**. Mỗi phần đều được kiểm bằng `nodes.length === total` (100, 72, 74, 106), `next: null`.

### Diễn biến theo request

Load tool: `ToolSearch select:mcp__Figma__create_session,mcp__Figma__use_figma` nạp được hai tool. `ReadMcpResourceTool` **không có** trong session (ToolSearch không trả về), nên tôi đọc `skill://figma/figma-use/SKILL.md` bằng `mcp__Figma__get_figma_skill`. Đã gọi `create_session` một lần, session `d4041f0c-…`, mỗi `use_figma` đều truyền `skillNames: "resource:figma-use"`.

| Request | Facts | Câu hỏi | Trả lời mô phỏng | Kết quả |
|---|---|---|---|---|
| 1. 18:444 → drawio | 1 page "Login with password (native)", 8 node, 10 edge; hint `sequence` 44 ("4 lifelines", "2 block frames") | Q1 (bên dưới) | 1a, 2a, 3a | `diagrams/20261113_login-with-password/`, cover 21/21, review PASS vòng 1 |
| 2. 17:444 → drawio | 1 page "Order data model (native)", 5 node, 4 edge; hint `er` 32 ("4 tables with key columns", "4 relations with crow's-foot ends") | Q1 với er gợi ý; thêm Q-ER ở bước 3 | 1a, 2a, 3a; Q-ER: xem dưới | `diagrams/20261113_order-data-model/`, cover 21/21, PASS vòng 1 |
| 3. 15:444 → mermaid | 1 page "Order domain (native)", 6 node, 6 edge; hint `class` 42 ("4 boxes with members or a «stereotype»", "2 inheritance or composition ends"), `er` 3 ("1 table with rows") | Q1: 1a Lớp (class) – gợi ý, 1b Dữ liệu (er) – điểm 3, rồi 5 loại còn lại | 1a, 2a, 3a | `diagrams/20261113_order-domain/`, cover 24/24, PASS vòng 1 |
| 4. 20:444 → drawio | 1 page "Order platform on AWS (native)", 15 node, 9 edge; hint `architecture` 74 ("9 service icons", "5 cloud group frames") | Q1 với architecture gợi ý | 1a, 2a, 3a | `diagrams/20261113_order-platform-on-aws/`, cover 24/24, PASS vòng 1 |

Q1 của request 1, đúng văn bản đã viết (dạng text, không có AskUserQuestion). Ba request kia giống hệt, chỉ đổi phần facts và thứ tự loại:

> Mình đã đọc section "Login with password (native)" trên board: 1 trang, 8 node, 10 edge, gợi ý loại sequence (4 lifeline, 2 khung block). Cảnh báo của facts: "1 line without arrow or label that joins no two shapes was left out as drawing (a pictogram, a divider)"; "10 edges are not connected to a shape at one end or both; their ends were taken from the shape where the line stops (fromInferred / toInferred)". Không có thông tin nhạy cảm.
> 1. Loại diagram? 1a Trình tự (sequence) – gợi ý: 4 lifeline, 2 khung block; 1b Lưu đồ (flowchart); 1c Swimlane (activity); 1d Trạng thái (state); 1e Dữ liệu (er); 1f Lớp (class); 1g Kiến trúc (architecture) (mỗi loại kèm mô tả một dòng của draw skill, đã dịch)
> 2. Mức chi tiết? 2a Tổng quan (overview) – gợi ý: một diagram chính khoảng 15 phần tử, mỗi luồng con gộp thành một bước; 2b Chi tiết (detailed): diagram chính và một diagram con cho mỗi luồng con
> 3. Góc nhìn của diagram? 3a Kỹ thuật (technical) – gợi ý: developer, reviewer; giữ tên component, endpoint, bảng dữ liệu; 3b Nghiệp vụ (business): PM, khách hàng, vận hành; chỉ luồng và quy tắc nghiệp vụ; 3c Cả hai (both): hai bản cho mỗi diagram

Q-ER (request 2, bước 3). mapping.md dòng "ends read from a board drawn as shapes" nói: "on a slanted stretch … check those ends against the picture or ask". Runtime không có ảnh board, nên tôi hỏi:

> Hai đường quan hệ trên board vẽ xiên, nên đầu "một" và "nhiều" khó phân biệt. Bạn nhìn board xác nhận giúp: (a) "appears in" Product → Order line: phía Product là một (1), phía Order line là không hoặc nhiều (0..*)? (b) Đường nét đứt không nhãn Order → Audit log: mình đọc ra cả hai phía là không hoặc nhiều (0..*). Đúng không?

PM trả lời (mô phỏng, theo đúng những gì board vẽ): "(a) đúng. (b) phía Order là vòng tròn với một gạch, tức 0..1; phía Audit log là chân gà 0..*." IR dùng `zero-one`.

Báo cáo cuối của mỗi run có đủ những gì closing contract và recook đòi: hash facts, warnings, change list, coverage, kind và lý do. Cuối mỗi run tôi offer các target khác bằng một dòng.

## 2. Bảng xác nhận các finding của c2 (mục 3 và H1)

| Finding | Verdict | Bằng chứng (lần chạy này) |
|---|---|---|
| H1 phần ER native | **FIXED** (còn lỗi mới N-A) | Đọc đủ 5 bảng, 4/4 edge, `x:r4` không còn bị mất; `fromPart`/label đúng. Đầu đọc được: places `ERmandOne`/`ERzeroToMany`, contains `ERmandOne`/`ERoneToMany`, appears in `ERmandOne`/`ERzeroToMany`, đều khớp fixture. Riêng r4 phía Order ra `ERzeroToMany`, fixture là `zero-one` (N-A) |
| H1 phần class native | **NOT FIXED (phần còn lại)** | Đã đúng: multiplicities nằm ở `startLabel "1"` / `endLabel "1..*"` và `endLabel "1"`; diamond, tam giác, `open` và nét đứt đều nhận ra. Còn sai: mọi đầu rỗng đọc thành đặc. r1 (inheritance) và r4 (realization) ra `endArrow: "block"`; r6 (aggregation) ra `startArrow: "diamond"`, giống hệt r2 (composition). Reader ghi `"closed":1,"filled":1` cho cả 70:492 lẫn 70:516. Nguyên nhân: `figjam-native.mjs` dòng 705 `const inside = filled ? stroke : WHITE;`, tức đầu rỗng được tô trắng, mà reader coi mọi fill nhìn thấy được là "filled". mapping.md (class) không có dòng nào cho `block`. Hậu quả: IR có r6 `composition`, fixture là `aggregation` |
| N1 link board trong `meta.notes` bị secret scan | **FIXED** | `validate`: `"warnings":0` ở cả bốn IR. `emit --to figjam` (R1, chỉ ghi file local vào `<tmp>`) exit 0, chỉ còn 8 warning feature-matrix của overlay, không còn `refusing to emit for figjam` |
| N2 async đọc thành sync | **FIXED** | Edge 73:534 "Audit login attempt" có `"endArrow":"open"`, không có `dashed`, nên IR là `async`, khớp fixture m10. Return vẫn `dashed`/`open`, sync là `block` |
| N3 self-message bị nối vào note | **FIXED** | 73:509 "Verify password hash" có `"from":"73:470","to":"73:470"`. mapping.md đã thêm câu cho board native: "A message to itself is one edge from a lifeline to the same lifeline with its label" |
| N4 không biết nhánh `else` bắt đầu ở đâu | **FIXED** | Frame 73:446 có `detail: "\"else password wrong\" from y 469"`; mapping.md có đoạn hướng dẫn chia message theo `y`. m8 (y 514) và m9 (y 554) vào nhánh else, khớp fixture |
| N5 icon AWS và group frame | **CLI: NOT FIXED; skill text: FIXED** | Facts vẫn ra 9 icon `drawio:unknown` và 5 `group` không có `aws:*`. mapping.md (dòng `drawio:`) giờ nói rõ: trong diagram AWS, nhãn nêu dịch vụ thì lấy icon từ `aws-icons.md` và ghi `added:`; nhãn không nêu thì không icon. Làm theo đó ra 7 icon đúng; "Fulfilment worker" mất `aws:lambda`. Group frame: mapping không có câu tương ứng, tôi theo đoạn "AWS icons" của draw SKILL (xem N-D) |
| N6 note chồng hai đầu lifeline | **NOT FIXED** | mapping.md vẫn ghi "beside or over the participants its box overlaps". Note 73:480 (x 14183–14339) chồng box head của Web app (14111–14231) và Auth (14291–14411), nên IR ra `over web, auth`, fixture là `right of web`. Box nằm giữa hai đường lifeline (14171 và 14351), không chạm đường nào |
| N7 section thành container khi đọc cả page | **OUT OF SCOPE** | Cả bốn request đều đọc theo section (`root` = section), nên không kiểm được |
| N8 title khi page không tên | **FIXED (văn bản)**, chưa gặp | SKILL §1.4 thêm: "A facts page without a name … gets its title from what it shows … recorded as an `added:` note". Cả bốn section đều có tên |
| N9 reviewer không xem facts | **NOT FIXED** | review-checklist.md không nhắc đến facts. Reviewer chỉ có IR và PNG, nên PASS dù r6 sai kind và N-A cho cardinality sai |
| N10 trùng tên section | **NOT FIXED** (Low) | Reader vẫn `page.findOne(... n.id === SECTION \|\| n.name === SECTION)`, không báo khi trùng tên. Với node-id thì không ảnh hưởng |
| N11 `texts[0]` lặp tên bảng | **OUT OF SCOPE** | Bốn section là board native (group), không có node `TABLE`. Bảng native không lặp tên (`texts` bắt đầu bằng "PK id: uuid") |
| N12 layout Mermaid | **OUT OF SCOPE** (emitter) | R3 (class) render sạch, không có nhãn chồng |
| L1 bundle Mermaid heading đôi | **NOT FIXED** | `order-domain.md`: `# Order domain (native)` rồi `## Order domain (native)` |
| L2 không có `ReadMcpResourceTool` | **NOT FIXED** (môi trường) | Phải dùng `get_figma_skill`. SKILL §1.2 vẫn chỉ nói "or its resource …", không nêu tool nào đọc được resource |
| L2 target-figjam.md và figma-use-figjam | **NOT FIXED** (Low) | Recook trỏ sang target-figjam.md "for its own scripts", mà §5/§7 ở đó bắt load cả `figma-use-figjam`; recook chỉ nói `figma-use`. Tôi theo đề bài, chỉ load figma-use |

## 3. So sánh IR với fixture theo request

`cover <facts> <fixture>` exit 0 cả bốn: 21/21, 21/21, 24/24, 24/24. `cli diff <fixture> <IR>` cho các khác biệt dưới đây. Title của cả bốn đều có thêm " (native)": đó là tên section trên board, và quy tắc "A page title used as the diagram title is kept" giữ nó, nên không phải lỗi.

**R1 sequence.** Khớp hoàn toàn ở 4 participant (actor, participant, control, database), 10 message: sync m1, m2, m3, m5; return m4, m6–m9; async m10; self-message m5. Hai block khớp: alt b1 [m6, m7] với else "password wrong" [m8, m9]; loop b2 [m1..m9]. n2 khớp (over auth, db, sau m5). `diff` báo "kind" thay đổi ở m1, m2, m3, m5 và web, chỉ vì fixture ghi `sync`/`participant` tường minh còn IR để mặc định, nghĩa như nhau. **Khác thật duy nhất: n1** `over web, auth` thay vì `right of web` (N6).

**R2 ER.** Entity, attribute (pk/fk, comment "unique, lower-cased", `decimal(10,2)`) và 4 relation đều khớp: places one/many, contains one/one-many, appears in one/many, r4 zero-one/many, `identifying: false`. Id `audit-log` thay vì `audit` (lấy từ nhãn, closing contract). **r4 `zero-one` đúng chỉ nhờ hỏi user**, vì facts ghi `ERzeroToMany` (N-A). Có gặp đúng known limit "slanted line": đường 72:510 xiên. Nhưng nguyên nhân thật không phải độ xiên (xem N-A).

**R3 class.** 6 class, stereotype, visibility, params/returns khớp; r2 multiplicities 1 / 1..*, r3 association "for" toCardinality 1, r5 dependency "persists" đều khớp. r1 inheritance và r4 realization khớp, nhưng chỉ vì tôi tự suy `block` ra "tam giác" khi mapping không có dòng nào cho `block`. **r6 sai: `composition`, fixture `aggregation`** (H1 class). Emitter Mermaid đổi stereotype thành `aggregate_root` và có warning.

**R4 architecture.** 10 component, 5 boundary (group đúng tên), 9 connection với nhãn khớp (giữ "/api": đổi nó thì đổi route của CloudFront, nên qua test của Level of detail; CLI không báo `detail:`). Khác: `worker` không có icon (fixture `aws:lambda`, N5 CLI); `psp` có `aws:generic_application`, fixture không có. Cái thứ hai do draw SKILL đòi ("A system outside AWS … takes a general resource"), có ghi `added:`, không phải lỗi recook.

## 4. Lỗi mới / còn lại theo mức

### High

**H1 (class, CLI và reader): đầu rỗng của board native đọc thành đặc.** Đây là phần còn lại của H1.
- Bằng chứng ở mục 2. Hậu quả: aggregation thành composition một cách im lặng (diagram nói sai); inheritance và realization ra `block`, mà mapping.md không có dòng nào cho kind đó.
- Theo chữ của mapping ("When a shape fits no row … never to a look-alike element"), r1 và r4 thậm chí không có chỗ đặt.
- Sửa (reader): trả màu fill (hex, hoặc cờ `white`) thay vì `filled` boolean; extract coi fill trắng là rỗng (`block-open`, `diamond-open`). Hoặc (emitter native) vẽ đầu rỗng với `fill: null` và che nét bằng cách lùi đường thẳng, như draw.io đã làm.
- Sửa (mapping.md class): thêm `block` → inheritance/realization, kèm câu "board native: kiểm tra với user khi không phân biệt được đặc/rỗng".
- Thêm fixture test: class native có aggregation, inheritance, realization.

### Medium

**N-A (CLI): đầu ER `zero-one` của board native luôn đọc thành `ERzeroToMany`.**
- `figjam-native.mjs` dòng 736 vẽ `ERzeroToOne` bằng ring, một bar và một `stub` (đoạn dài E+w/2 ≈ 9 px chạy dọc đường). `edgeEnds` trong `extract-figjam.mjs` (khoảng dòng 555–563) tính `along(k) >= 6` là crow's foot.
- Với 72:512 (box 8×9), `along` = 9, nên ra "many". Không phụ thuộc độ xiên: trên đường thẳng đứng, box của bar cộng stub vẫn dài 9 px dọc đường.
- mapping.md nói lẫn lộn này chỉ xảy ra "on a slanted stretch". Nên với một đường thẳng runtime sẽ không hỏi, và cardinality sai lọt qua review (N9).
- Sửa (CLI): phân biệt bằng hình. Bar của zero-one vuông góc với đường, stub nằm trên trục; crow's foot có hai nhánh lệch khỏi trục. Ví dụ: đếm số đỉnh lệch khỏi trục, hoặc so `w` và `h` của box sau khi xoay theo hướng đường. Thêm test ER native có `zero-one` trên đường thẳng và đường xiên. Sửa câu trong mapping.md cho đúng nguyên nhân.

**N5 phần CLI (còn lại): board AWS native không cho icon và group.**
- Hậu quả trong lần này nhỏ (một icon Lambda mất), nhưng mọi board AWS native đều phụ thuộc runtime đoán icon từ nhãn.
- Gợi ý: pictogram của frame có số đỉnh rất đặc trưng (AWS Cloud `nv` 142, region 29, VPC 71, subnet 47) và icon dịch vụ có path riêng. Extract có thể so với `stencil-paths.json`. Hoặc emitter native đặt tên group `x:<id> aws:<icon>` để extract đọc ra.

### Low

- **N6 (skill text, còn):** note theo box head chứ không theo đường lifeline. Đề nghị: "the lifelines (centre lines) its box overlaps; when it overlaps none, `right` of the nearest lifeline on its left".
- **N9 (skill text, còn):** review không thấy facts. Đề nghị reviewer của run recook nhận cả facts, và checklist thêm mục so kind của từng edge (đầu mũi tên, dashed) với IR.
- **N-B (skill text):** mapping.md cho câu hỏi "check those ends … or ask" ở bước 3, trong khi SKILL §2 chỉ mô tả một lượt hỏi mở đầu. Không nói câu hỏi này đi chung với lượt nào. Tôi hỏi một lượt riêng. Đề nghị: gom vào lượt mở đầu khi facts đã cho thấy đầu xiên.
- **N-C (skill text):** quy tắc id "an id of a Zukai file (`<page>:<id>`) keeps the part after the colon" dễ bị áp vào id node Figma (`73:489` thành `489`). Tôi dùng `m1…` theo closing contract. Nên nói rõ: id node Figma không phải id nguồn. Reader đã thấy tên group `x:b1`, `x:r4` của Zukai nhưng extract bỏ đi; nếu giữ thì ra đúng id gốc.
- **N-D (skill text):** mapping.md (architecture) có quy tắc icon theo nhãn nhưng không có quy tắc tương ứng cho `group` không có `aws:*`. Tôi theo draw SKILL "set `group` on each boundary that is an AWS construct", có ghi `added:`. Nên thêm một câu cho group.
- **L1, L2 cũ** (heading đôi, `ReadMcpResourceTool`, figma-use-figjam): như bảng mục 2.
- **Emitter:** Mermaid đổi stereotype `aggregate root` thành `«aggregate_root»` (có warning). Với recook, chữ của nguồn bị đổi trên hình. Nên dùng tên có dấu cách nếu Mermaid cho phép (`<<aggregate root>>` hiển thị được trong v11).

## 5. Đánh giá diagram (PNG đã mở)

| PNG | Đánh giá (giọng reviewer) |
|---|---|
| `/tmp/zukai-preview/login-with-password-drawio-b6cd7c50.png` (single), `/tmp/zukai-preview/login-with-password-drawio-0c666b71.png` (bundle, có title) | 4 participant với hình người cho actor và dòng «control»/«database»; loop bao m1–m9; alt có vạch else đúng giữa m7 và m8; self-message "Verify password hash" là vòng nhỏ trên Auth service; "Audit login attempt" mũi tên mở (async), nằm ngoài loop. Không chồng nhãn. n1 trải qua cả lifeline Web app lẫn Auth (do N6), khác nguồn nhưng đọc được. Verdict: PASS, không finding `wrong` |
| `/tmp/zukai-preview/order-data-model-drawio-f5869c6f.png`, `/tmp/zukai-preview/order-data-model-drawio-e789414f.png` | 5 bảng, PK/FK, comment; đầu crow's-foot đúng IR: ‖ đến o< (places), ‖ đến \|< (contains), ‖ đến o< (appears in), nét đứt o\| đến o< (Order–Audit log). Không đường nào cắt nhãn. PASS. Phía Order của r4 chỉ đúng vì đã hỏi user (N-A) |
| `/tmp/zukai-preview/order-domain-mmd-89ee1911.png`, `/tmp/zukai-preview/order-domain-md-c1fb8c31-d1.png` | 6 class, stereotype, member đầy đủ; tam giác rỗng (inheritance và realization nét đứt), diamond đặc ở lines với 1 / 1..*, "for" với 1, dependency "persists". Layout sạch. Theo IR thì PASS. So với nguồn thì **sai**: Order–Product vẽ diamond đặc (composition), nguồn là diamond rỗng (aggregation). Reviewer không thấy được (N9). `«aggregate_root»` là `emitter:`/polish |
| `/tmp/zukai-preview/order-platform-on-aws-drawio-e560cd26.png`, `/tmp/zukai-preview/order-platform-on-aws-drawio-9ef97e7f.png` | Frame lồng đúng (AWS Cloud, ap-northeast-1, VPC, Public/Private subnet); icon CloudFront, S3, ELB, Fargate, Aurora, ElastiCache, SQS đúng dịch vụ; luồng chính browser → CloudFront → ALB → API chạy giữa hình; Payment provider ngay trên caller, đường "capture payment" cắt mép frame, không qua tiêu đề. "Fulfilment worker" là hộp trơn: polish, không áp dụng được vì nhãn không nêu dịch vụ (N5). PASS |

File bàn giao, dưới `/tmp/claude-0/-home-user-zukai-kobo/4a7ef9ef-051f-57b9-90d6-65ba14b3e4be/scratchpad/e2e/c3-proj/diagrams/`:
- `20261113_login-with-password/login-with-password.drawio`
- `20261113_order-data-model/order-data-model.drawio`
- `20261113_order-domain/order-domain.md` (kèm `mermaid/order-domain.mmd`)
- `20261113_order-platform-on-aws/order-platform-on-aws.drawio`

Mỗi run có facts trong `source/`. Board JSON đã chép nằm ở `/tmp/claude-0/-home-user-zukai-kobo/4a7ef9ef-051f-57b9-90d6-65ba14b3e4be/scratchpad/e2e/c3-tmp/board-{18,17,15,20}-1.json`.

Status: DONE_WITH_CONCERNS
Summary: FAIL. N1–N4 đã sửa và bốn request đều giao được (cover 100 %, review PASS), nhưng board class native vẫn đọc đầu rỗng thành đặc (aggregation thành composition, High), và CLI đọc ER `zero-one` thành `many` (Medium mới).
Concerns/Blockers: N5 phía CLI chưa sửa (icon và group AWS vẫn phải đoán từ nhãn). N6 và N9 còn nguyên. 34 525 byte chép tay qua 4 lần `use_figma` (M5, ngoài phạm vi).
