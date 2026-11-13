# E2E recook với FigJam thật (board `45AQFIpbiwRlA0biqsBxCY`), skill recook 2.2.0

Ngày 2026-11-13 (UTC). Runtime mô phỏng: không có AskUserQuestion, không có subagent. Board chỉ được ĐỌC.
Project: `/tmp/claude-0/-home-user-zukai-kobo/4a7ef9ef-051f-57b9-90d6-65ba14b3e4be/scratchpad/e2e/c-proj`.

## 1. Kết luận

Đường đọc board chạy được từ đầu đến cuối: script đọc do CLI viết chạy nguyên văn bằng `use_figma`, chia part đúng (page 1191 node → 3 part 44 947 / 44 909 / 31 635 byte, `next` 395 → 863 → null), `extract` ghép part và tách page thành 19 diagram. Cả hai request đều ra file (`order-checkout.drawio`, `zukai-test.md`), qua `cover`, review PASS sau 1 vòng.
Nhưng extractor **đọc sai mọi section vẽ bằng `emit --native`**: rhombus, parallelogram và note thành edge không có đầu, edge có nhãn thành box, nền và vạch header của frame thành node và edge riêng. Kind hint của cả 12 section native là `flowchart`, kể cả class, ER, sequence, state và architecture. Request 1 chỉ ra được diagram đúng vì runtime suy luận thêm từ toạ độ trong facts, điều mà SKILL.md không cho phép. Đọc đúng chữ thì kết quả là flowchart sai mà vẫn qua `cover` và review.
Request 2 lộ hai lỗi lớn: `cover` đòi phủ chữ của **mọi** diagram trên page, nên runtime phải liệt kê 314 text không liên quan vào `meta.omitted` (25 entry, hiện ra trong mục "Not shown on purpose" của bundle). Kind hint của state diagram thì sai (`flowchart` 7 > `state` 2).

## 2. Các bước theo request

### Request 1: `/zukai:recook https://www.figma.com/board/45AQFIpbiwRlA0biqsBxCY/Zukai-test?node-id=14-444 --to drawio`

| Bước SKILL.md | Đã làm (lệnh / tool call, kích thước) | Kết quả |
|---|---|---|
| Locate draw skill | `<recook-dir>/../draw` = `/home/user/zukai-kobo/skills/draw`, có `scripts/bin/cli.mjs` | OK |
| Arguments | source = link board + `node-id=14-444` → node `14:444`; `--to drawio`; không có `--kind/--scope/--audience` | OK |
| Load Figma tools | `ToolSearch select:mcp__Figma__create_session,mcp__Figma__use_figma`. Session không có `ReadMcpResourceTool`, nên figma-use được đọc bằng `mcp__Figma__get_figma_skill skill://figma/figma-use/SKILL.md` (và cả `figma-use-figjam`, vì target-figjam.md nhắc tới) | OK. `create_session` → `bba216b9-1994-48dd-b0e4-ba7d781d5213` |
| §1.3 lấy tên section từ id | `use_figma` 1 dòng read-only: `return (await figma.getNodeByIdAsync("14:444")).name` | `"Order checkout (native)"` |
| §1.1 tạo run folder | `mkdir -p diagrams/20261113_order-checkout/source/original` | slug lấy từ title của section |
| §1.3 viết script đọc | `node …/cli.mjs extract --figjam-script ../tmp-c/read-board.js --section "Order checkout (native)"` (file nằm ngoài run folder) | exit 0, script 3 748 byte |
| §1.3 đọc board | `use_figma` (code = script, nguyên văn), `skillNames: resource:figma-use` | 1 part: 67 node, `next: null`, **6 395 byte** → `source/original/board-1.json` |
| §1.2 extract | `extract …/board-*.json --out …/order-checkout.facts.json` | exit 0; 1 page, 11 node, 10 edge, hint `flowchart` 10 ("10 boxs joined by arrows"), 5 warning (xem §3, H1) |
| Báo user những gì đã đọc | tin nhắn ở §5 | – |
| §2 câu hỏi mở đầu | một tin nhắn text (không có AskUserQuestion) | trả lời mô phỏng: 1a flowchart, 2a overview, 3a technical |
| §3 viết IR | `source/order-checkout.ir.json`: flowchart, 9 node, 9 edge, group Fulfilment. Facts sai nên runtime dựng lại decision, note, io và 3 nhãn edge từ box và y của facts, ghi rõ trong `meta.notes` "facts misread: …" | validate exit 0, 0 warning |
| §4 cover | `cover …facts.json diagrams/20261113_order-checkout` | `{"units":14,"covered":14}` exit 0 |
| §5 closing contract | `emit --to drawio … --out drawio/order-checkout.drawio`; `bundle --to drawio --out order-checkout.drawio --title "Order checkout (native)" <run>`; `preview` từng file, `--max-px 1600` | 0 warning; 2 PNG (renderer drawio-web), đã mở cả hai |
| Review (giọng reviewer) | checklist trên IR + PNG | PASS, 1 vòng; chỉ có polish/emitter (§4) |
| Kiểm tra thêm | `cover facts fixtures/flowchart/valid.json` → 14/14; `diff fixture IR` → cùng 9 node, 9 edge, 1 group (chỉ khác id, title, meta và shape của reserve/receipt) | khớp fixture về cấu trúc |

### Request 2: `/zukai:recook https://www.figma.com/board/45AQFIpbiwRlA0biqsBxCY/Zukai-test --to mermaid lấy sơ đồ trạng thái đơn hàng (Awaiting payment, Paid, ...) nằm trực tiếp trên page`

| Bước SKILL.md | Đã làm | Kết quả |
|---|---|---|
| §1.1 run folder | `diagrams/20261113_zukai-test/source/original` (slug từ tên file board "Zukai-test", đúng chữ của skill) | – |
| §1.3 script | `extract --figjam-script ../tmp-c/read-board.js` (không có section) | SECTION=null, FROM=0 |
| đọc part 1 | `use_figma` (script nguyên văn) | 395 node, `next: 395`, **44 947 byte** → `board-1.json` (ghi tay lại đúng từng byte JSON đã nhận) |
| đọc part 2 | `extract --figjam-script … --from 395` → `use_figma` | 468 node, `next: 863`, **44 909 byte** → `board-2.json` |
| đọc part 3 | `--from 863` → `use_figma` | 328 node, `next: null`, **31 635 byte** → `board-3.json`; tổng 1191 = `total` |
| §1.2 extract | `extract …/board-*.json --out …/zukai-test.facts.json` | exit 0; **19 page** (bảng ở §5). State diagram = `page:Page 1#18`, name `""`, 9 node, 8 edge, hint `flowchart` 7 > `state` 2 |
| §1.3 chọn diagram | request đã nói rõ (Awaiting payment, Paid) → `#18`, không hỏi | – |
| §2 câu hỏi | "sơ đồ trạng thái" được coi là nêu tên kind → bỏ câu kind. Hỏi scope và view trong một tin nhắn text | overview, technical |
| §3 IR | `source/zukai-test.ir.json`: state, 7 state (initial, final, composite "Under review" chứa 2 state), 8 transition | validate exit 0 |
| §4 cover lần 1 | `cover … <run>` | **exit 2: 337 unit, 23 covered, 314 missing** (toàn bộ chữ của 18 diagram khác) |
| §4 cover lần 2 | thêm `meta.omitted` cho mọi page khác; lần đầu validate lỗi (`maxLength 500`), chia lại thành 25 entry ≤ 500 ký tự | validate 0; cover 337/337 exit 0 |
| §5 closing | `emit --to mermaid … --out mermaid/zukai-test.mmd`; `bundle --to mermaid --out zukai-test.md --title "Trạng thái đơn hàng" <run>`; `preview` cả hai | 0 warning; PNG đã mở |
| Review | vòng 1 PASS; polish "flagged chạy xuyên tiêu đề composite" → đổi `direction` TB → LR (sửa IR thuần), validate/emit/bundle/preview lại, không thêm vòng review | PASS |
| Kiểm tra thêm | facts chỉ có page #18 → `cover` 11/11 với IR, 11/11 với `fixtures/state/valid-self-loop.json` (fixture thật là file này, title "Payment retries", không phải valid-order-lifecycle) | khớp fixture: 7 state, 8 transition giống hệt |

Write calls tới board: **0**. `generate_diagram` và `create_new_file` đều không gọi. `use_figma` được gọi 5 lần: 1 lần lấy tên và 4 lần chạy script đọc.

## 3. Lỗi tìm thấy

### CLI bug

**H1 (High): `extract` đọc sai mọi board vẽ bằng `emit --native`** (`src/extract-figjam.mjs` dòng 157–178).
Bằng chứng, section 14:444 (`facts` của request 1):
- Rhombus "All items in stock?" (group 69:467 = 1 VECTOR + TEXT), parallelogram "Send receipt email" (69:457) và note "Stock is checked per warehouse" (69:477, 2 VECTOR) được ghi thành **edge**, vì nhánh `solids.length === 0 && strokes.length > 0` coi mọi group chỉ có vector là đường nối. Hai trong số đó thành edge `from: null, to: null`.
- Edge có nhãn ("yes" 69:488, "no" 69:493, "captured" 69:501: VECTOR + RECTANGLE nền nhãn + TEXT) được ghi thành **box** node, vì RECTANGLE nền nhãn được tính là solid.
- Frame Fulfilment: RECTANGLE nền (69:444) thành box rỗng `label ""`, vạch header (69:445) thành edge `69:444 → "no"`.
- Subroutine "Reserve stock" (RECTANGLE + VECTOR thanh đôi) chỉ còn là `box`.
- Kết quả: 11 node / 10 edge, trong khi fixture có 9 node / 9 edge; decision, note và io mất hẳn. Ba edge nối thật (`yes`, `no`, `captured`) biến mất.
- Trên page (request 2), 12 section native đều hint `flowchart`: Order domain (class), Order data model (ER), Login with password (sequence), Order lifecycle (state), Order platform on AWS, Booking API (architecture), Return request, Order fulfilment, Corporate login (activity), Stencil sample (28 edge "không đầu").
- Tên group `x:e1`, `x:t4` … (native script ghi id IR vào đó) bị bỏ, nên quy tắc "id of a Zukai file keeps the part after the colon" của SKILL.md §3 không áp dụng được.

Sửa:
(a) Reader script trả thêm `filled: 1` (fills hiển thị) và `closed: 1` (vectorNetwork có vòng kín) cho VECTOR. Extractor coi vector kín hoặc có fill là shape: rhombus → `decision`, 4 đỉnh nghiêng → `io`, góc gấp → `note`.
(b) Trong group có stroke, RECTANGLE nhỏ nằm dưới TEXT là nền nhãn, không phải solid.
(c) RECTANGLE và VECTOR trực tiếp của một group-frame có cùng box với frame thì thuộc về frame.
(d) Đọc tên group `x:<id>` và tên group bằng nhãn để lấy id và nhận ra node/edge của native emit. Thêm fixture board native cho mỗi kind vào test.

**H2 (High): `cover` không giới hạn được ở diagram được chọn** (`src/cover.mjs` `unitsOf`, CLI `cover`).
SKILL.md §1.3 nói "Recook only the ones the user asked for", nhưng `cover <facts> <run>` kiểm mọi page. Request 2: exit 2, 314/337 missing, tất cả là chữ của 18 diagram không được yêu cầu. Cách duy nhất để qua mà vẫn đúng chữ skill là liệt kê chúng trong `meta.omitted` (25 entry, giới hạn 500 ký tự mỗi entry buộc phải chia nhỏ). Các entry này hiện trong mục "Not shown on purpose" của `zukai-test.md` và trong báo cáo cho user.
Sửa: thêm `cover --page <id>` (hoặc `extract --page`), và để IR ghi `meta.notes` "recooked from … page "X"" làm bộ lọc tự động. Đồng thời sửa SKILL.md §4.

**M1 (Medium): kind hint sai cho state diagram do `generate_diagram` vẽ.**
Page #18: `flowchart` 7 ("7 boxs joined by arrows") > `state` 2 ("1 edge labelled [guard]"). Bằng chứng state có sẵn trong facts nhưng không được dùng: ellipse rỗng 32×32 nơi transition đầu xuất phát, group "State End" (2 ellipse đồng tâm) được ghi thành `container` rỗng thay vì `final`, 2 self-loop, section "Under review" chứa state. Nếu hỏi kind đúng chữ skill ("best kind hint is the first option, (suggested)") thì câu trả lời mô phỏng "the suggested one" sẽ cho ra flowchart.
Sửa: ellipse ≤ 40 px không chữ có cạnh đi ra → `initial`; group 2 ellipse đồng tâm → `final`; tăng điểm `state` khi có các dấu hiệu đó và self-loop.

**M2 (Medium): reader chỉ tìm section theo tên** (`figjamReaderScript`: `page.findOne(n => n.type==='SECTION' && n.name===SECTION)`).
Link có `node-id` buộc runtime phải chạy thêm một `use_figma` để lấy tên. Tên trùng thì lấy section đầu tiên; board này đã có "Fulfilment" vừa là section 5:256 vừa là group native, và "AWS Cloud" là section lẫn group.
Sửa: `--section` nhận cả id `14:444` / `14-444` (`figma.getNodeByIdAsync`), và báo lỗi khi tên trùng.

**M3 (Medium): `cover` chấp nhận text nằm trong `meta.notes`** (holders gồm `meta.notes`, cover.mjs dòng 53).
Kiểm chứng: bỏ node note "Stock is checked per warehouse" khỏi IR mà vẫn qua `cover`, chỉ vì một `meta.notes` có nhắc câu đó. SKILL.md §4 thì cấm "never put a text into meta.notes to hide it". Thêm nữa, từ ngắn như "Customer" (bảng ER) được tìm thấy trong "notify customer".
Sửa: bỏ `meta.notes` khỏi holders, hoặc chỉ nhận entry dạng `moved to <part>`.

**M4 (Medium): bảng ER của FigJam có `label ""`.**
Page #16: 4 `table` với label rỗng, tên entity ("Customer", "Order") nằm trong `texts[0]`. mapping.md lại nói "its label is the entity name".
Sửa: hàng đầu có một ô không rỗng → `label`.

**L1 (Low).**
- Diagram không ở trong section có `name: ""` (page #16–#19), nên báo cáo "each page with its name" không làm được. Sửa: đặt tên theo text lớn nhất, hoặc `"(no name, at x,y)"`.
- Evidence viết sai số nhiều: "10 boxs", "5 boundarys" (`plural()` ở extract-drawio.mjs).
- `SHAPE_TYPES`: `CHEVRON → note`, trong khi `generate_diagram` dùng CHEVRON cho hệ thống external ("Payment provider", page #17) và PREDEFINED_PROCESS cho queue ("SQS orders" → `subroutine`).
- Bundle Mermaid một diagram có title trùng nên ra heading đôi: `# Trạng thái đơn hàng` rồi `## Trạng thái đơn hàng`.

### Vấn đề của văn bản skill

**H3 (High): không có lối thoát khi facts tự mâu thuẫn.**
§1.4 chỉ dừng khi exit 1. §3 bắt viết IR "from the facts alone", "Nothing is invented". Facts của 14:444 có edge mang nhãn mà không có đầu, và box tên "yes"/"no". Làm đúng chữ thì: không có decision, có 3 step giả "yes", "no", "captured", "Send receipt email" thành nhãn edge, và `cover` vẫn qua (text đi vào omitted hoặc nhãn). Review cũng không bắt được, vì checklist không so với nguồn hay facts.
Sửa: thêm vào §1 "khi facts có edge `null`/`null` mang nhãn, hoặc box không cạnh mang nhãn ngắn, thì dừng, báo user facts không tin được và đề nghị export/đọc lại". Thêm vào review-checklist mục cho recook: so số node, edge, decision với facts, và cho reviewer xem facts.

**M5 (Medium): đọc page lớn rất tốn và dễ sai.**
Skill bắt lưu "the JSON the call returns" vào file. Runtime chỉ có thể làm vậy bằng cách gõ lại nguyên văn kết quả tool (121 KB cho request 2, khoảng 40k token output), rồi mới biết là chỉ cần 9 node của page #18. Một byte gõ sai là facts sai mà không ai biết.
Sửa: cho script đọc nhận bộ lọc (`--section` theo id, `--top-level` cho node không ở trong section, hoặc bbox), hoặc chạy extract ngay trong script và trả facts gọn. Thêm checksum/`total` theo part để `extract` phát hiện bản chép sai.

**M6 (Medium): quy tắc kind mâu thuẫn khi request nêu kind bằng tiếng Việt.**
Draw skill bỏ câu kind khi request "names a kind verbatim". Recook §2 lại nói "The kind is never guessed, but it is suggested from the facts" với hint đứng đầu. "sơ đồ trạng thái" có phải là "verbatim" không? Nếu hỏi thì gợi ý sai (flowchart).
Sửa: nói rõ request nêu kind (mọi ngôn ngữ) thì không hỏi; khi hint trái với kind user nêu thì báo trong tin nhắn đọc facts.

**M7 (Medium): "Content stays" đụng với các quy tắc khác.**
(a) Nhãn "Capture payment ↳ order-checkout-payment": giữ nguyên là ghi id part vào nhãn, điều closing contract cấm. Runtime đã bỏ dòng ↳ vào `meta.omitted`.
(b) "payment failed [attempts ＜ 3]": `＜` full-width do chính profile figjam của Zukai thay cho `<`. Giữ nguyên thì Mermaid hiện "＜".
(c) Closing contract "Labels … in the user's language" trái với "no translation".
Sửa: mapping.md thêm "đảo các thay thế của profile figjam (＜＞％＆≤≥≠ → ASCII)", "dòng `↳ <slug>` của Zukai là ref, giữ thành `ref` khi detailed, bỏ khi overview". Ghi rõ recook thắng quy tắc ngôn ngữ.

**L2 (Low).**
- §1.3 "read its name with `use_figma` or `get_metadata`": `get_metadata` không chạy trên FigJam (figma-use-figjam nói thẳng). Nên ghi `get_figjam`.
- §1.3 trỏ tới target-figjam.md "for loading the Figma tools and the skills it names", nhưng file đó chỉ nói cách *vẽ* (§5, §7) và không có phần đọc board. Không rõ có cần `figma-use-figjam` hay không. Task bảo `skillNames: resource:figma-use`, còn target-figjam bảo dùng thêm figma-use-figjam.
- Môi trường không có `ReadMcpResourceTool`; skill nên nhắc `get_figma_skill`.
- §1.1 bắt tạo run folder "now", slug "from the source's title", nhưng với link chỉ có `node-id` thì phải đọc board trước mới biết title. Với request 2 thì slug theo chữ của skill là `zukai-test`, nên IR tên `zukai-test.ir.json` cho một state diagram (bundle cần IR trùng slug).
- Meta note đầu tiên `recooked from source/original/<file>`: một board nhiều part không có "<file>" duy nhất.
- Không nói title lấy từ đâu khi diagram không có tên (page #18). Runtime lấy từ lời user và ghi `added:`.
- Báo cáo §5 yêu cầu liệt kê mọi `meta.omitted`: với H2 đó là 25 entry dài.

## 4. Đánh giá diagram (PNG đã mở)

| PNG | Đánh giá |
|---|---|
| `/tmp/zukai-preview/order-checkout-drawio-d384cde4.png` (drawio/order-checkout.drawio) | Đúng cấu trúc fixture: start → validate → decision, nhánh yes/no, Fulfilment bao reserve/payment/receipt, hai luồng về "Order placed". Nhãn rõ, không chồng nhau. Polish: (1) đường từ note "Stock is checked per warehouse" nhập vào trục validate → decision, nên trông như note là một bước của luồng (emitter: nên là nét đứt và không nhập trunk); (2) nhãn "no" nằm sát chỗ rẽ, cách xa nhánh của nó; (3) "Reserve stock" và "Send receipt email" là hình chữ nhật thường vì extractor làm mất subroutine/io (nguồn có). |
| `/tmp/zukai-preview/order-checkout-drawio-fcdf48f1.png` (order-checkout.drawio, bundle) | Giống bản trên, có thêm tiêu đề "Order checkout (native)". Chữ "(native)" là dấu vết của lần emit trước, nhưng "content stays" nên được giữ. |
| `/tmp/zukai-preview/zukai-test-mmd-488fbb7e.png`, vòng 1 (TB) | Đúng nội dung fixture valid-self-loop. Lỗi layout: đường "flagged" cắt ngang tiêu đề composite "Under review"; nhãn "more data" dính vào đầu mũi tên self-loop; khối nhãn "payment failed [attempts ＜ 3] / notify customer" lớn, đè sát self-loop. |
| `/tmp/zukai-preview/zukai-test-md-334a50a9-d1.png` (bundle, sau polish LR) và `zukai-test-mmd-488fbb7e.png` (render lại LR) | Sạch: không đường nào cắt tiêu đề, self-loop có nhãn phía trên, luồng chính trái → phải, "payment captured" đi vòng dưới. Còn lại: dấu `＜` full-width có khoảng trắng; title tiếng Việt trong khi mọi nhãn là tiếng Anh. |
| `/tmp/zukai-preview/x-mmd-107fd557.png` (thử LR trong scratch) | Dùng để quyết định polish, nội dung giống bản cuối. |

## 5. Báo cáo cuối runtime gửi user (nguyên văn)

### Request 1

Tin nhắn sau extract (bước "tell the user what was read"):

> Đã đọc board FigJam `Zukai-test`, section **"Order checkout (native)"** (node 14:444), 1 lần đọc (67 node trên board).
> - Page `section:Order checkout (native)`: 11 node, 10 edge; kind gợi ý: **flowchart** (bằng chứng: "10 boxs joined by arrows").
> - Cảnh báo của facts (nguyên văn):
>   - edge "69:467" ("All items in stock?") has an end that touches no shape
>   - edge "69:477" ("Stock is checked per warehouse") has an end that touches no shape
>   - edge "69:483" has an end that touches no shape
>   - edge "69:510" has an end that touches no shape
>   - 10 edges are not connected to a shape at one end or both; their ends were taken from the shape where the line stops (fromInferred / toInferred)
>
> Trước khi viết diagram, mình cần bạn chọn:
> 1. Loại diagram? (gợi ý theo nội dung board: 1a)
>    1a. Lưu đồ (flowchart) – gợi ý: các bước và quyết định của một quy trình; bằng chứng "10 boxs joined by arrows"
>    1b. Trình tự (sequence) · 1c. Swimlane (activity) · 1d. Trạng thái (state) · 1e. Dữ liệu (er) · 1f. Lớp (class) · 1g. Kiến trúc (architecture)
> 2. Mức chi tiết? 2a. Tổng quan (overview) – gợi ý: một diagram khoảng 15 phần tử · 2b. Chi tiết (detailed): diagram chính và một diagram con cho mỗi luồng con
> 3. Góc nhìn của diagram? 3a. Kỹ thuật (technical) – gợi ý: giữ tên component, endpoint, dữ liệu · 3b. Nghiệp vụ (business): chỉ luồng và quy tắc nghiệp vụ · 3c. Cả hai (both): hai bản cho mỗi diagram
>
> Trả lời bằng mã (vd. `1a 2a 3a`), tên, hoặc "default".

(Trả lời mô phỏng: `1a 2a 3a`.)

Báo cáo cuối:

> **Run folder:** `diagrams/20261113_order-checkout/`
> **File mở trước:** `diagrams/20261113_order-checkout/order-checkout.drawio` (1 trang: "Order checkout (native)"); bản riêng: `drawio/order-checkout.drawio`. IR: `source/order-checkout.ir.json`.
>
> **Nguồn đã đọc:** board FigJam `45AQFIpbiwRlA0biqsBxCY`, section "Order checkout (native)" (node 14:444), 1 part, lưu nguyên văn ở `source/original/board-1.json`; facts ở `source/order-checkout.facts.json`. Cảnh báo của facts: 5 dòng ở trên (2 edge không có đầu, 2 edge một đầu không chạm shape, 10 edge nối theo vị trí).
>
> ⚠️ **Lưu ý quan trọng:** trình đọc board hiểu sai section này. Section do Zukai vẽ bằng `emit --native` gồm hình chữ nhật, vector và text rời. Trình đọc coi hình thoi "All items in stock?", hình bình hành "Send receipt email" và note "Stock is checked per warehouse" là đường nối, coi ba nhãn "yes", "no", "captured" là ô. Mình đã dựng lại diagram từ vị trí trong facts (không đọc lại board), ghi từng chỗ trong `meta.notes` ("facts misread: …"). Bạn nên so với board một lần.
>
> **Diagram:** `order-checkout`, lưu đồ (flowchart), khớp kind gợi ý: Customer submits cart → Validate cart contents → "All items in stock?": yes → Reserve stock → Capture payment → (captured) Send receipt email → Order placed (cả ba bước giữa nằm trong nhóm Fulfilment); no → Offer backorder → Order placed; note "Stock is checked per warehouse" gắn vào câu hỏi tồn kho.
>
> **Thay đổi so với nguồn:**
> - Giữ nguyên: 9 nhãn bước/note, 3 nhãn nhánh, nhóm Fulfilment, 9 đường nối.
> - Tách thành part: không có (overview).
> - Gộp: không có.
> - Bỏ ra (không hiện có chủ đích): "↳ order-checkout-payment", dòng tham chiếu của Capture payment tới một diagram con không có trên board; scope overview không có part.
> - Thêm: không có phần tử nào ngoài nguồn.
> - Nối theo vị trí (facts đánh dấu inferred): cả 9 đường nối (nguồn là các nét vẽ, không phải connector).
> - Hình dạng bị mất do trình đọc: "Reserve stock" (subroutine) và "Send receipt email" (input/output) thành bước thường.
>
> **Coverage:** 14/14 text của nguồn có trong IR hoặc trong danh sách bỏ ra.
> **Cảnh báo CLI:** không có (validate, emit, bundle: 0 warning).
> **Review:** PASS sau 1 vòng. Images: order-checkout: opened. Còn lại (polish, không sửa): đường từ note nhập vào trục chính trước câu hỏi tồn kho (emitter); "Reserve stock" và "Send receipt email" mất hình subroutine/io (do trình đọc); title giữ "(native)" như nguồn.
> **Góc nhìn:** technical (bạn chọn).
>
> Muốn bản Mermaid (`--to mermaid`) hoặc vẽ lên FigJam (`--to figjam`) thì nói mình.

### Request 2

Tin nhắn sau extract:

> Đã đọc toàn bộ page "Page 1" của board `Zukai-test` (1191 node, 3 lần đọc: 395 + 468 + 328 node). Page có 19 diagram đặt cạnh nhau:
>
> | Page | Tên | Node / edge | Kind gợi ý (bằng chứng) |
> |---|---|---|---|
> | #1 | Login with password | 10 / 13 | sequence 44 (4 lifelines, 2 block frames) |
> | #2 | Order checkout (native) | 12 / 10 | flowchart 10 |
> | #3 | Order domain (native) | 15 / 9 | flowchart 9 |
> | #4 | Return request (native) | 16 / 7 | flowchart 13 |
> | #5 | Order data model (native) | 14 / 4 | flowchart 9 |
> | #6 | Login with password (native) | 27 / 6 | flowchart 23 |
> | #7 | Order lifecycle (native) | 19 / 5 | flowchart 17 |
> | #8 | Order platform on AWS (native) | 29 / 6 | flowchart 23 |
> | #9 | Corporate login, left to right (native) | 25 / 11 | flowchart 21 |
> | #10 | Gradient icon (native) | 4 / 0 | – |
> | #11 | Order fulfilment (native) | 24 / 15 | flowchart 20 |
> | #12 | Booking API on ECS Fargate (native) | 32 / 8 | flowchart 27 |
> | #13 | Stencil sample (native) | 4 / 28 | flowchart 3 |
> | #14 | Nightly stock sync | 10 / 9 | sequence 38 (3 lifelines, 4 block frames) |
> | #15 | Nightly stock sync v2 | 10 / 9 | sequence 38 |
> | #16 | (không tên) | 5 / 4 | er 32 (4 tables with key columns) |
> | #17 | (không tên) | 15 / 9 | architecture 16 (2 store, client, cloud or queue shapes, 5 boundarys); flowchart 9 |
> | #18 | (không tên): Awaiting payment, Under review, Paid … | 9 / 8 | flowchart 7 (7 boxs joined by arrows); state 2 (1 edge labelled "[guard]" or "event / action") |
> | #19 | (không tên) | 10 / 9 | flowchart 18 |
>
> Cảnh báo của facts (nguyên văn): #1 "1 text stands over no shape: "Verify password hash"", #14 và #15 "1 text stands over no shape: "Write the run summary"". Mọi page native và #1, #14, #15 đều có "N edges are not connected to a shape at one end or both; their ends were taken from the shape where the line stops (fromInferred / toInferred)" (#1: 4, #2: 10, #3: 9, #4: 7, #5: 4, #6: 6, #7: 5, #8: 6, #9: 11, #11: 15, #12: 8, #13: 28, #14: 3, #15: 3).
>
> Bạn muốn sơ đồ trạng thái đơn hàng, tức **#18**. Mình làm diagram trạng thái (state) như bạn nói. Gợi ý tự động của trình đọc là flowchart, nhưng #18 có trạng thái đầu/cuối, self-loop và một trạng thái lồng, nên đây là state diagram. Còn hai câu:
> 1. Mức chi tiết? 1a. Tổng quan (overview) – gợi ý · 1b. Chi tiết (detailed)
> 2. Góc nhìn của diagram? 2a. Kỹ thuật (technical) – gợi ý · 2b. Nghiệp vụ (business) · 2c. Cả hai (both): hai bản cho mỗi diagram

(Trả lời mô phỏng: `1a 2a`.)

Báo cáo cuối:

> **Run folder:** `diagrams/20261113_zukai-test/`
> **File mở trước:** `diagrams/20261113_zukai-test/zukai-test.md`; bản riêng `mermaid/zukai-test.mmd`; IR `source/zukai-test.ir.json`.
>
> **Nguồn đã đọc:** board FigJam `45AQFIpbiwRlA0biqsBxCY`, page "Page 1" đọc toàn bộ (3 part, nguyên văn ở `source/original/board-1.json` … `board-3.json`), 19 diagram. Lấy diagram #18, nằm trực tiếp trên page và không có tên. Cảnh báo của facts: như bảng ở trên; #18 không có cảnh báo.
>
> **Diagram:** "Trạng thái đơn hàng", kind state (bạn nêu; gợi ý tự động là flowchart, sai vì trình đọc không nhận ra trạng thái đầu/cuối). Từ trạng thái đầu vào Awaiting payment; payment failed [attempts ＜ 3] / notify customer quay lại chính nó; flagged → Under review (Checking, tự lặp khi "more data"; suspicious → On hold); cleared → Paid; payment captured → Paid; Paid → kết thúc.
>
> ```mermaid
> ---
> title: "Trạng thái đơn hàng"
> ---
> stateDiagram-v2
>   direction LR
>   %% id: awaiting-payment
>   state "Awaiting payment" as n2
>   %% id: under-review
>   state "Under review" as n3 {
>     %% id: checking
>     state "Checking" as n4
>     %% id: on-hold
>     state "On hold" as n5
>     %% id: t-3-94
>     n4 --> n4 : more data
>     %% id: t-3-98
>     n4 --> n5 : suspicious
>   }
>   %% id: paid
>   state "Paid" as n6
>   %% id: t-3-102
>   [*] --> n2
>   %% id: t-3-106
>   n2 --> n2 : payment failed [attempts ＜ 3] / notify customer
>   %% id: t-3-110
>   n2 --> n4 : flagged
>   %% id: t-3-114
>   n5 --> n6 : cleared
>   %% id: t-3-118
>   n2 --> n6 : payment captured
>   %% id: t-3-122
>   n6 --> [*]
> ```
>
> **Thay đổi so với nguồn:**
> - Giữ nguyên: 5 trạng thái có tên, trạng thái lồng "Under review", 8 chuyển trạng thái với nhãn gốc. Chuyển 3:106 được tách theo chính cú pháp của nó: event / guard / action.
> - Thêm: tiêu đề "Trạng thái đơn hàng". Board không có tiêu đề cho diagram này, nên mình lấy từ lời bạn.
> - Đọc lại hình: vòng tròn rỗng → trạng thái đầu; hai vòng tròn lồng nhau → trạng thái cuối.
> - Bỏ ra (không hiện có chủ đích): toàn bộ chữ của 18 diagram còn lại trên page (#1–#17, #19), 25 mục trong `meta.omitted`, mỗi mục ghi "another diagram of the page, not asked for" kèm danh sách chữ. Đây là yêu cầu của bước kiểm tra coverage, không phải nội dung bị mất của sơ đồ trạng thái.
> - Nối theo vị trí: không có (#18 dùng connector thật).
>
> **Coverage:** 337/337 text của facts được tìm thấy (11 trong diagram, phần còn lại trong danh sách bỏ ra).
> **Cảnh báo CLI:** không có.
> **Review:** PASS sau 1 vòng. Images: zukai-test: opened. Đã sửa (polish): đổi hướng sang trái → phải để đường "flagged" không cắt tiêu đề "Under review". Chưa sửa (polish): dấu "＜" full-width trong "attempts ＜ 3", giữ đúng như board (do lần xuất FigJam trước thay cho "<"); tiêu đề tiếng Việt, nhãn tiếng Anh như nguồn.
> **Góc nhìn:** technical (bạn chọn).
>
> Muốn bản draw.io (`--to drawio`) hoặc FigJam (`--to figjam`) thì nói mình.

## 6. Câu hỏi chưa rõ

1. Khi facts tự mâu thuẫn (H3), runtime nên dừng và báo, hay được phép suy luận từ box/y như ở request 1? Báo cáo này đã suy luận và ghi rõ. Làm đúng chữ skill thì phải ra diagram sai.
2. Với request đọc cả page để lấy một diagram, ý định là `cover` chỉ kiểm diagram đó (cần `--page`), hay đúng là muốn liệt kê mọi diagram khác trong `meta.omitted`?
3. "sơ đồ trạng thái" (tiếng Việt) có được tính là "names a kind verbatim" không? Nếu không, câu kind phải gợi ý flowchart (hint sai) và câu trả lời "suggested" sẽ chọn flowchart.
4. Recook có nên đảo các thay thế ký tự của profile figjam (`＜` → `<`) và biến dòng `↳ <slug>` thành `ref`? Hiện tại "Content stays" cấm sửa.
5. Đổi `direction` (TB → LR) do reviewer đề nghị có được coi là "polish sửa IR thuần" trong recook không, khi layout gốc là top-down?
6. Run slug khi đọc cả page: theo tên board (`zukai-test`, đúng chữ skill) hay theo diagram được chọn (`order-state`, đúng closing contract)?
