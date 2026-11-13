PASS

# E2E xác nhận lần 4: recook từ FigJam board thật (commit f45b740)

## 1. Kết luận

PASS. Cả bốn request đều giao được khi làm đúng theo chữ của skill (1 Mermaid, 3 draw.io). `cover` đạt 100 % với cả IR lẫn fixture, review PASS ngay vòng 1. So với source model (bỏ qua id, title và meta), IR của class, ER và sequence **giống hệt fixture**. Bản AWS chỉ khác ở hai mục đã biết: "Fulfilment worker" không có icon (known (a)), và "Payment provider" có `aws:generic_application` theo quy tắc của draw SKILL. Hai lỗi chặn của c3 đã được sửa: H1 class (đầu rỗng đọc thành đặc) và N-A (ER `zero-one` đọc thành `many`). Cardinality của cả bốn relation ER được quyết định từ facts, không phải hỏi user. Không còn finding High hay Medium, chỉ còn vài lỗi Low về câu chữ của skill (mục 4).

Phạm vi: board `45AQFIpbiwRlA0biqsBxCY`, chỉ đọc. Có đúng 4 lần `use_figma`, `code` là reader script do CLI viết, giữ nguyên (`diff` cho thấy bốn file chỉ khác dòng `SECTION`). Không gọi `generate_diagram`, `create_new_file` hay `get_screenshot`. `emit --native` chỉ chạy một lần, ghi ra file local trong `<tmp>` để kiểm N5, không gửi gì lên board.

Số byte phải chép tay (known (b)): 7 205 (15:444) + 6 875 (17:444) + 9 671 (18:444) + 10 591 (20:444) = **34 342 byte** (kích thước file, đã gồm 1 byte xuống dòng cuối mỗi file). Phần nào cũng đã kiểm `nodes.length === total` (74, 72, 100, 106) và `next: null`.

### Diễn biến

Nạp tool: `ToolSearch select:mcp__Figma__create_session,mcp__Figma__use_figma` nạp được cả hai tool. `ReadMcpResourceTool` **không có** (ToolSearch không trả về), nên tôi đọc `skill://figma/figma-use/SKILL.md` bằng `mcp__Figma__get_figma_skill`. Gọi `create_session` một lần, được session `cac4c380-357e-4d14-8a11-e1197a453880`. Mỗi `use_figma` đều truyền `sessionId` và `skillNames: "resource:figma-use"`.

| Request | Facts (sha256 đầu) | Hint | Trả lời mô phỏng | Run folder | cover IR / fixture |
|---|---|---|---|---|---|
| 1. 15:444 → mermaid | "Order domain (native)", 6 node, 6 edge (`d92b9ac6…`) | `class` 52 ("4 boxes with members or a «stereotype»", "4 inheritance or composition ends"); `er` 3 ("1 table with rows") | 1a, 2a, 3a | `diagrams/20261113_order-domain/` | 24/24, 24/24 |
| 2. 17:444 → drawio | "Order data model (native)", 5 node, 4 edge (`22e73d81…`) | `er` 32 ("4 tables with key columns", "4 relations with crow's-foot ends") | 1a, 2a, 3a | `diagrams/20261113_order-data-model/` | 21/21, 21/21 |
| 3. 18:444 → drawio | "Login with password (native)", 8 node, 10 edge (`c1cc03f9…`) | `sequence` 44 ("4 lifelines", "2 block frames") | 1a, 2a, 3a | `diagrams/20261113_login-with-password/` | 21/21, 21/21 |
| 4. 20:444 → drawio | "Order platform on AWS (native)", 15 node, 9 edge (`6a98ed3d…`) | `architecture` 74 ("9 service icons", "5 cloud group frames") | 1a, 2a, 3a | `diagrams/20261113_order-platform-on-aws/` | 24/24, 24/24 |

Không page nào có `sensitive`. Warnings của facts, nguyên văn:
- 15:444: "6 edges are not connected to a shape at one end or both; their ends were taken from the shape where the line stops (fromInferred / toInferred)"
- 17:444: "4 edges are not connected …" (cùng câu)
- 18:444: "1 line without arrow or label that joins no two shapes was left out as drawing (a pictogram, a divider)"; "10 edges are not connected …"
- 20:444: "9 edges are not connected …"

Câu hỏi mở đầu của request 1, đúng văn bản đã gửi (dạng text vì không có AskUserQuestion; `--to` đã cho nên không hỏi target):

> Mình đã đọc section "Order domain (native)" (node 15:444) trên board FigJam: 1 trang "Order domain (native)", 6 node, 6 edge. Gợi ý tốt nhất là sơ đồ lớp (class), điểm 52: 4 hộp có member hoặc «stereotype», 4 đầu mũi tên kế thừa hoặc composition. Cảnh báo của facts: "6 edges are not connected to a shape at one end or both; their ends were taken from the shape where the line stops (fromInferred / toInferred)". Không có thông tin nhạy cảm.
> 1. Loại diagram? 1a Lớp (class) – gợi ý: 4 hộp có member hoặc «stereotype», 4 đầu kế thừa/composition; 1b Dữ liệu (er): thực thể dữ liệu, thuộc tính khoá và quan hệ một-nhiều (điểm 3: 1 bảng có dòng); 1c Trình tự (sequence): ai gọi ai, theo thứ tự nào, kèm phản hồi và nhánh lỗi; 1d Lưu đồ (flowchart): các bước và quyết định của một quy trình từ đầu đến cuối; 1e Swimlane (activity): mỗi làn một actor hoặc hệ thống, ai làm bước nào, bàn giao và việc song song; 1f Trạng thái (state): các trạng thái của một đối tượng và sự kiện chuyển giữa chúng; 1g Kiến trúc (architecture): component triển khai, kho dữ liệu, hàng đợi, hệ thống ngoài và kết nối giữa chúng
> 2. Mức chi tiết? 2a Tổng quan (overview) – gợi ý: một diagram chính khoảng 15 phần tử, mỗi luồng con gộp thành một bước; 2b Chi tiết (detailed): diagram chính và một diagram con cho mỗi luồng con
> 3. Góc nhìn của diagram? 3a Kỹ thuật (technical) – gợi ý: developer, reviewer; giữ tên component, endpoint, bảng dữ liệu; 3b Nghiệp vụ (business): PM, khách hàng, vận hành; chỉ luồng và quy tắc nghiệp vụ; 3c Cả hai (both): hai bản cho mỗi diagram

Request 2–4 hỏi giống hệt, chỉ thay phần facts, và kind gợi ý đứng đầu (er; sequence; architecture), các kind còn lại theo thứ tự của bảng. Câu trả lời mô phỏng của PM cho cả bốn: "1a, 2a, 3a". Không có câu hỏi nào khác: ER không cần hỏi (xem mục 3), không có cảnh báo `detail:`, `model:` hay `size:`. Câu hỏi "trang trộn nhiều kind" của request 1 không được nêu, vì hint `er` (3 điểm) nằm trên một hộp mà class vẽ được và chưa tới nửa của 52 (xem L-3).

Theo closing contract: validate cả bốn IR với `"warnings":0`. Emit: class → Mermaid có 1 warning (nguyên văn: `stereotype "aggregate root" of "order" was rewritten as "aggregate_root" for classDiagram syntax`); ba bản draw.io có 0 warning, không có `layout:` hay `detail:`. Bundle chạy theo thư mục run. Preview đủ file đơn lẻ lẫn file gộp, review 1 vòng, PASS cả bốn. Báo cáo cho user có đủ hash, warnings, change list ("giữ nguyên"; added: 7 icon và 5 group frame của request 4, cộng icon general resource cho Payment provider; joined by position: tất cả các edge, vì board native không có connector), coverage và kind. Cuối mỗi run có một dòng offer các target khác.

## 2. Bảng xác nhận các finding của c3

| Finding c3 | Verdict | Bằng chứng (lần chạy này) |
|---|---|---|
| H1 class native: đầu rỗng đọc thành đặc | **FIXED** | Reader giờ coi fill trắng là rỗng ("only a coloured fill makes it a filled one"). Board JSON: 70:489 và 70:508 (tam giác) `"closed":1`, không có `filled`; 70:516 (diamond của r6) không có `filled`; 70:492 (diamond của r2) `"filled":1`. Facts: r1 `endArrow:"block-open"`, r4 `dashed` + `block-open`, r2 `startArrow:"diamond"`, r6 `startArrow:"diamond-open"`. IR ra inheritance, realization, composition, aggregation, khớp fixture. mapping.md (class) giờ có thêm "a filled `block` end" → association |
| H1 ER native (phần đã sửa ở c3) | **FIXED** (giữ nguyên) | 5 bảng, 4/4 edge, end ra `ERmandOne`/`ERzeroToMany`, `ERmandOne`/`ERoneToMany`, `ERmandOne`/`ERzeroToMany`, `ERzeroToOne`/`ERzeroToMany` |
| N-A ER `zero-one` đọc thành `ERzeroToMany` | **FIXED** | Cùng vector 72:512 (`nv` 4, box 8×9) giờ ra `startArrow:"ERzeroToOne"`. mapping.md bỏ câu "on a slanted stretch … or ask"; dòng mới chỉ nói đến board đọc bằng reader trước 2.2.0. r4 thành `zero-one`/`many`, `identifying:false`, quyết định từ facts, không hỏi user |
| N-B câu hỏi đầu xiên ở bước 3 | **FIXED** (hết lý do tồn tại) | mapping.md không còn đòi hỏi về đầu xiên, nên không còn lượt hỏi thứ hai |
| N1 link board trong `meta.notes` bị secret scan chặn | **FIXED** | `validate`: `"warnings":0` cả bốn. `emit --to figjam --native` cho IR AWS (file local) exit 0 |
| N2 async đọc thành sync | **FIXED** | 73:534 "Audit login attempt" `endArrow:"open"`, không `dashed` → `async` (m10) |
| N3 self-message | **FIXED** | 73:509 `from = to = 73:470` → m5 auth → auth |
| N4 nhánh `else` | **FIXED** | 73:446 `detail: "\"else password wrong\" from y 469"`; m8 (y 514), m9 (y 554) vào nhánh else; b1 = [m6, m7] + else [m8, m9], khớp fixture |
| N5 icon/group AWS, phần CLI | **FIXED** (cho board vẽ từ 2.2.0); board này **OUT OF SCOPE** | `figjam-native.mjs` `nameOf` thêm `[<stencil>]` vào tên group; script native của IR AWS có `CloudFront [aws:cloudfront]`, `AWS Cloud [aws:aws_cloud]`, `ap-northeast-1 [aws:region]` …; `extract-figjam.mjs` dòng 224–229 đọc tag ra `icon`/`group`. Section 20:444 vẽ trước đó nên facts vẫn ra 9 `drawio:unknown` và 5 `group` không có tag (known (a)) |
| N5 phần skill text | **FIXED** | mapping.md có dòng `drawio:` (icon theo nhãn, ghi `added:`) và dòng "read from a board" cho tag 2.2.0 |
| N6 note theo head chứ không theo lifeline | **FIXED** (còn một chỗ mơ hồ nhỏ, L-1) | mapping.md: "`over` the participants whose lifeline (the line through the middle of the head, not the head's width) its box crosses; with none crossed, `right` …". Note 73:480 (x 14183–14339) không cắt đường 14171 hay 14351, nên IR ra `right of web-app` sau m1, khớp fixture n1. n2 (14331–14551) cắt 14351 và 14531, nên ra `over auth, db` sau m5, khớp fixture |
| N7 section thành container khi đọc cả page | **OUT OF SCOPE** | Cả bốn request đều đọc theo section |
| N8 title cho page không tên | **FIXED (văn bản)**, chưa gặp | SKILL §1.4 vẫn có câu đó; cả bốn section đều có tên |
| N9 reviewer không xem facts | **NOT FIXED** (Low) | review-checklist.md không nhắc đến facts; closing-contract chỉ liệt kê facts file trong bảng đường dẫn. Lần này không gây hại vì facts đúng |
| N10 trùng tên section | **NOT FIXED** (Low) | Reader vẫn `page.findOne(... n.id === SECTION \|\| n.name === SECTION)`, không báo trùng tên. Với node-id thì không ảnh hưởng |
| N11 `texts[0]` lặp tên bảng | **OUT OF SCOPE** | Không có node `TABLE` (board native) |
| N12 layout Mermaid | **OUT OF SCOPE** | Class render sạch |
| N-C quy tắc id `<page>:<id>` | **NOT FIXED** (Low) | SKILL dòng 192 vẫn "an id of a Zukai file (`<page>:<id>`) keeps the part after the colon". Id node Figma (`70:490`) có cùng dạng. Extract vẫn bỏ tên group `x:r4`, `x:b1` |
| N-D quy tắc `group` không có `aws:*` | **NOT FIXED** (Low) | mapping.md (architecture) vẫn chỉ có "`group` → a boundary with that `group`". Tôi theo đoạn "AWS icons" của draw SKILL và ghi `added: group …`. Với board vẽ từ 2.2.0, tag trong tên group giải quyết việc này |
| L1 bundle Mermaid heading đôi | **OUT OF SCOPE** (known (c)), vẫn còn | `order-domain.md`: `# Order domain (native)` rồi `## Order domain (native)` |
| L2 `ReadMcpResourceTool` | **NOT FIXED** (Low, môi trường) | Phải dùng `get_figma_skill`; SKILL §1.2 vẫn chỉ nói "or its resource …" |
| L2 figma-use-figjam | **NOT FIXED** (Low) | Recook dẫn sang target-figjam.md "for its own scripts", mà §5/§7 ở đó bắt load cả `figma-use-figjam`; recook chỉ nhắc `figma-use`. Tôi theo đề bài, chỉ load figma-use |
| Emitter `«aggregate_root»` | **OUT OF SCOPE** (known (c)) | Warning như trên |

## 3. So sánh IR với fixture theo request

Để so sánh, tôi viết một script nhỏ (`scratchpad/tools/compare-ir.mjs`). Script quy mọi tham chiếu về nhãn và bỏ qua id, title và meta; kind mặc định (`sync`, `participant`, `service`) được coi như viết tường minh. `cli diff` chỉ cho thấy khác về id.

**R1 class (15:444 → Mermaid): giống hệt fixture.** Có 6 class, đủ stereotype («aggregate root», «abstract», «interface»), visibility, params và returns. Relation: r1 inheritance, r2 composition "lines" 1 / 1..*, r3 association "for" toCardinality 1, r4 realization, r5 dependency "persists", r6 aggregation. Khác duy nhất: id `order-repository`/`ef-order-repository` thay vì `repository`/`ef-repository` (lấy từ nhãn theo closing contract), cộng thêm hậu tố " (native)" ở title (là tên section, được giữ theo luật "A page title used as the diagram title is kept").

**R2 ER (17:444 → draw.io): giống hệt fixture.** Đủ entity, attribute (pk/fk, comment "unique, lower-cased", `decimal(10,2)`). Cardinality, quyết định từ facts: places one/many, contains one/one-many, appears in one/many, r4 zero-one/many, `identifying:false` (nét đứt). Không có gì mơ hồ nên không hỏi. Khác duy nhất: id `audit-log` thay vì `audit`. Facts không có `fromPart`/`toPart`, nên IR không ghi `fromAttribute`; đường vẫn bám đúng FK nhờ mặc định.

**R3 sequence (18:444 → draw.io): giống hệt fixture.** 4 participant (actor, participant, control, database). 10 message: sync m1–m3, m5; return m4, m6–m9; async m10; self-message m5. Block: alt b1 [m6, m7] với else "password wrong" [m8, m9]; loop b2 [m1..m9]. Note n1 `right` of Web app sau m1, n2 over Auth service và User DB sau m5. Khác duy nhất: id participant `web-app`, `auth-service`, `user-db`.

**R4 architecture (20:444 → draw.io).** 10 component, 5 boundary, cây lồng nhau đúng fixture, 9 connection với nhãn khớp từng chữ. "/api" được giữ: nó đặt route của CloudFront, nên qua test của Level of detail, và CLI không báo `detail:`. Icon lấy từ nhãn theo mapping.md (known (a)): `aws:cloudfront`, `aws:s3`, `aws:elastic_load_balancing`, `aws:fargate`, `aws:aurora`, `aws:elasticache`, `aws:sqs`, mỗi cái một dòng `added: icon … from the label`. Group lấy từ nhãn frame: `aws_cloud`, `region`, `vpc`, `public_subnet`, `private_subnet`, ghi một dòng `added: group …`. Hai khác biệt:
- `fulfilment-worker` không có icon, fixture là `aws:lambda`. Nhãn không nêu dịch vụ nên đây là known (a); báo cáo của run có liệt kê.
- `payment-provider` có `aws:generic_application`, fixture không có. Draw SKILL đòi ("A system outside AWS … takes a general resource"), có ghi `added:`. Đây là quy tắc của Zukai chứ không phải lỗi đọc.

## 4. Lỗi mới / còn lại theo mức

Không có High, không có Medium.

### Low

- **L-1 (skill text, mapping.md sequence `note`): quy tắc "with none crossed, `right` (or `left`) of the nearest lifeline on its left (or right)" không nói khi nào dùng `left`, cũng không nói gì khi hai bên cách đều.** Với n1, khoảng cách từ mép trái box tới đường Web app là 12 px (14183 − 14171), từ mép phải box tới đường Auth cũng 12 px (14351 − 14339). Tôi đọc vế chính (right of the nearest lifeline on its left) và ra đúng fixture. Nhưng runtime khác có thể chọn `left of auth`. Đề nghị: "`right` of the nearest lifeline on its left; `left` of the nearest on its right only when no lifeline stands on its left".
- **L-2 (skill text, mapping.md er): điều kiện "a board read before version 2.2.0 of the reader" không kiểm được.** Board JSON (`zukaiBoard: 1`) và facts đều không ghi phiên bản reader. Đề nghị: reader ghi `reader: "2.2.0"` vào head và extract chép sang facts, hoặc extract cảnh báo khi một đầu ER đọc ra `classic`.
- **L-3 (skill text, SKILL §2 trang trộn kind): ví dụ "(tables, lifelines or lanes on an architecture or flowchart page)" dễ bị đọc sai trên trang class.** Facts gọi hộp class là `table`, và hint `er` 3 điểm ("1 table with rows") nằm trên một hộp class (rất có thể là Product, "Sku: string" không có visibility, nên không được tính vào evidence của class). Đọc vội có thể thành "trang trộn kind" rồi tách ra một part `er`. Tôi theo mapping class ("`table` with members → classes"), nên coi như class vẽ được hình đó. Đề nghị: thêm "a `table` that the best kind maps (class members) does not count", hoặc extract không cho `er` điểm từ hộp mà class đã nhận.
- **N9, N10, N-C, N-D, L2 (×2):** còn nguyên như mục 2. Đề nghị giữ như c3: reviewer của run recook nhận cả facts; reader báo khi trùng tên section; nói rõ id node Figma không phải id nguồn (hoặc extract giữ tên group `x:<id>` của Zukai); thêm một dòng `group` theo nhãn frame vào mapping.md; SKILL §1.2 nêu `get_figma_skill` là cách đọc resource khi không có `ReadMcpResourceTool`, và nói rõ có cần `figma-use-figjam` cho reader script hay không.

Không thấy lỗi CLI mới: extract, cover, validate, emit, bundle, preview và diff đều chạy đúng và exit 0.

## 5. Đánh giá diagram (PNG đã mở)

Review theo review-checklist.md, giọng reviewer, mỗi diagram 1 vòng.

| PNG | Đánh giá |
|---|---|
| `/tmp/zukai-preview/order-domain-mmd-1b170c81.png` (single), `/tmp/zukai-preview/order-domain-md-768842b1-d1.png` (bundle) | 6 class đủ member và stereotype. Tam giác rỗng nét liền Order → Entity; tam giác rỗng nét đứt EfOrderRepository → IOrderRepository; diamond đặc Order–OrderLine với "1" / "1..*" và nhãn "lines"; **diamond rỗng Order–Product** (aggregation, đúng nguồn); "for" mũi tên mở với "1"; "persists" nét đứt. Không nhãn nào chồng nhau. Verdict: PASS. Images: opened. Findings: `emitter:` «aggregate_root» thay cho «aggregate root» (known (c)) |
| `/tmp/zukai-preview/order-data-model-drawio-d9938556.png`, `/tmp/zukai-preview/order-data-model-drawio-d9c47639.png` | 5 bảng với PK/FK, comment, `decimal(10,2)`. Đầu crow's-foot: ‖ → o< (places), ‖ → \|< (contains), ‖ → o< (appears in), nét đứt o\| → o< (Order–Audit log, zero-one đúng nguồn). Không đường nào cắt nhãn. File gộp có title. PASS, không finding |
| `/tmp/zukai-preview/login-with-password-drawio-e6dd5a30.png`, `/tmp/zukai-preview/login-with-password-drawio-f0b50c0d.png` | Hình người cho actor, dòng «control» và «database» in nghiêng. Loop bao m1–m9; alt với vạch "else password wrong" nằm giữa m7 và m8. "Verify password hash" là vòng tự gọi trên Auth service. "Rate limited per IP" bên phải Web app, sau m1; "Hash: argon2id" trải qua Auth service và User DB. "Audit login attempt" mũi tên mở, ngoài loop. Activation bar hợp lý. PASS. Polish (không chặn): mép phải note n1 sát đường lifeline Auth nhưng không chạm |
| `/tmp/zukai-preview/order-platform-on-aws-drawio-2dd67045.png`, `/tmp/zukai-preview/order-platform-on-aws-drawio-ff959e9a.png` | Frame lồng đúng (AWS Cloud ⊃ ap-northeast-1 ⊃ VPC ⊃ Public/Private subnet). Icon CloudFront, S3, ELB, Fargate, Aurora, ElastiCache, SQS có hình, không có ô trống. Luồng chính browser → CloudFront → ALB → Order API chạy giữa hình. Payment provider ngoài frame, ngay trên caller; đường "capture payment" đi qua mép các frame, không cắt tiêu đề. SQS → worker nằm trong region. PASS. Polish: "Fulfilment worker" là hộp trơn (không áp dụng được vì nhãn không nêu dịch vụ, known (a)); chữ hơi nhỏ ở 1600 px nhưng vẫn đọc được |

File bàn giao, dưới `/tmp/claude-0/-home-user-zukai-kobo/4a7ef9ef-051f-57b9-90d6-65ba14b3e4be/scratchpad/e2e/c4-proj/diagrams/`:
- `20261113_order-domain/order-domain.md` (kèm `mermaid/order-domain.mmd`)
- `20261113_order-data-model/order-data-model.drawio`
- `20261113_login-with-password/login-with-password.drawio`
- `20261113_order-platform-on-aws/order-platform-on-aws.drawio`

Facts của mỗi run nằm trong `source/`. Board JSON đã chép: `/tmp/claude-0/-home-user-zukai-kobo/4a7ef9ef-051f-57b9-90d6-65ba14b3e4be/scratchpad/e2e/c4-tmp/board-{15,17,18,20}-1.json`.

Status: DONE
Summary: PASS. Cả bốn request giao đúng theo chữ của skill. IR class, ER và sequence giống hệt fixture; bản AWS chỉ khác ở các mục đã biết. H1 class và N-A của c3 đã được sửa, không còn finding High hay Medium.
Concerns/Blockers: Còn một số lỗi Low về câu chữ của skill: vị trí note khi hai bên cách đều, điều kiện phiên bản reader không kiểm được, quy tắc trang trộn kind trên trang class, cộng các mục cũ N9, N10, N-C, N-D, L2. Phải chép tay 34 342 byte qua 4 lần `use_figma` (known (b)).
