# Báo cáo E2E toàn bộ feature của Zukai 2.0.3

Ngày chạy: 2026-11-11 (UTC), commit `973243e`, Node 22.23.4 (smoke thêm trên Node 24.22.1).

## Kết luận

Luồng chính của mọi feature đều chạy được đến cuối: 7 kind, 3 target ở tầng CLI, 3 mode của
`draw`, 4 route của `revise`, installer. Tuy vậy có 6 lỗi thật ở CLI và tài liệu skill, cùng
một nhóm điểm chưa hợp lí về thiết kế và bố cục. Không có lỗi nào làm hỏng dữ liệu nguồn
(`source/*.ir.json`); lỗi nặng nhất làm sai file `.drawio` gộp và làm mất bản sao file sửa tay.

## Phạm vi và cách chạy

| Hạng mục | Cách chạy | Kết quả |
|---|---|---|
| Unit test (`npm test`) | chạy nguyên bộ | 626 passed, 1 skipped |
| `claude plugin validate . --strict` | chạy thật | passed, 1 cảnh báo thiếu icon |
| 65 fixture x 3 target | `validate` + `emit` từng file | 57 hợp lệ emit được ra drawio và mermaid; 8 fixture `invalid-*` bị từ chối đúng; figjam từ chối `activity`, `class` và fixture có credential đúng như feature matrix |
| Render | `preview` cả 114 file drawio + mermaid | 114/114 ra PNG |
| Lệnh CLI và ca lỗi | `bundle`, `diff`, `drift`, `relabel`, `snapshot`, `revisions`, `restore`, tham số sai, IR hỏng | xem mục lỗi |
| `install.sh` | cài mới, chạy lại, nâng cấp, hạ cấp, marker hỏng, tên cũ `it-diagrams`, đường dẫn có dấu cách | đúng tài liệu, trừ mục 9 |
| `draw clarify` + `revise` (direct, relabel, undo/redo, xoay vòng history) | một agent đóng vai runtime, làm đúng từng chữ của skill, người dùng giả lập tiếng Việt | chi tiết: `e2e-261111-1250-detail/a-clarify-revise.md` |
| `draw scout` (mermaid, drawio) + `revise` consult, new diagram | như trên, scout chính repo này | chi tiết: `e2e-261111-1250-detail/b-scout-consult.md` |
| `draw brainstorm` (AWS) + business view + bản tiếng Nhật + figjam + ca tham số lạ | như trên | chi tiết: `e2e-261111-1250-detail/c-brainstorm-variants.md` |

Chưa kiểm tra được:

- `install.ps1`: máy không có PowerShell.
- Tạo board FigJam thật: cố ý không gọi Figma MCP để không tạo board trong tài khoản; chỉ
  kiểm tra `emit --to figjam` và phần hướng dẫn.
- Agent `diagram-reviewer`, `source-scout`, `diagram-brainstorm`: plugin không được cài trong
  phiên này nên review đi theo nhánh "other runtimes" của skill.
- draw.io desktop: không có; `drift` chỉ được thử với file re-save giả lập (nén trang, thêm
  `dx/dy`, `host/agent`), và ca đó qua.

Ba báo cáo chi tiết trỏ tới file tái hiện trong thư mục scratchpad của phiên, thư mục đó mất
khi container bị thu hồi. Các lệnh tái hiện ngắn ở dưới tự đủ để chạy lại.

## A. Lỗi thật (đã tái hiện)

### 1. Id trang draw.io bị cắt ở 40 ký tự, hai diagram trùng id

`slugify` ở `skills/draw/scripts/src/emit-drawio.mjs:120` cắt `.slice(0, 40)`. Quy ước tên
của chính skill (`<slug>-NN-<part>` và `<slug>-NN-<part>-business`) dễ vượt 40 ký tự.

Tái hiện: hai IR `refund-approval-02-gateway-refund-via-payment.ir.json` và bản
`-business` của nó, rồi `bundle --to drawio --canvas all`. Kết quả: hai `<diagram>` cùng
`id="refund-approval-02-gateway-refund-via-pa"`, id cell trùng nhau, và `drift` trên file vừa
tạo trả `drifted:true`. Hệ quả kéo theo: `revise` luôn tưởng người dùng đã sửa tay; key
`relabel` viết theo id thật (như `variants.md` hướng dẫn) không khớp, để lại tên trang và
dòng `↳` cũ. Chưa kiểm chứng draw.io desktop xử lý id trang trùng ra sao.

### 2. Lệnh bundle trong closing contract cho thứ tự ngược với lời nó nói

`references/closing-contract.md:25` ghi `bundle ... source/*.ir.json` "(main diagram first)".
Glob xếp `checkout-01-login` và `checkout-business` trước `checkout` (dấu `-` đứng trước `.`),
nên diagram phụ và bản business đứng đầu file gộp và đầu canvas. Cả ba luồng đều vấp; agent
phải tự liệt kê file bằng tay. `readIrSet` trong `cli.mjs` cũng `.sort()` theo cùng thứ tự.

### 3. `emit --to mermaid` crash với architecture có hub lớn

`planArchitectureGrid` (`src/emit-mermaid.mjs:429-430`): `near()` trả `undefined` khi 48 ô
quanh điểm neo đã kín, và hai dòng này thiếu fallback mà dòng 428 và 432 có.

Tái hiện: một component nối tới 49 component khác (50 component). Kết quả là `TypeError`
kèm stack trace, exit 1, không phải lỗi JSON theo hợp đồng của CLI. `validate` vẫn báo hợp lệ.
49 component thì chạy và rơi về flowchart có cảnh báo, đúng thiết kế.

### 4. `diff` không thấy thay đổi thứ tự

`src/ir-diff.mjs` so theo id nên đảo thứ tự `messages` hay `participants` của sequence trả
`differs:false`, trong khi Mermaid xuất ra khác. Với sequence, thứ tự chính là nội dung. Yêu
cầu what-if "đưa bước X lên trước bước Y" vì thế không có change list nào từ `diff`, dù
`revise` bắt buộc báo cáo change list từ lệnh này.

### 5. Quy tắc chọn đích của undo/redo sai sau lần redo đầu

`skills/revise/SKILL.md:148-155`. Với chuỗi S1, S2, S3: undo, undo, redo cho S2, S1, S2 như
mong đợi. Lần redo thứ hai lẽ ra về S3 nhưng quy tắc "revision mới nhất có `undoOf`" đưa về
S1. Một lần undo ngay sau redo thì restore đúng trạng thái hiện tại (không đổi gì) mà vẫn
đẩy revision cũ nhất ra khỏi history.

### 6. Fallback của FigJam đi vòng qua chốt chặn secret

`references/target-figjam.md` mục 5 bảo dán kết quả `emit --to mermaid` vào FigJam. Bản
mermaid có front matter và entity kiểu `#gt;` mà profile figjam cố ý bỏ, và `emit --to
mermaid` không bao giờ từ chối secret (chỉ cảnh báo, exit 0). Trong khi đó `ir-reference.md`
hứa "the FigJam target refuses to send them". Fallback nên dùng chính `emit --to figjam`.

## B. Mâu thuẫn và chỗ hổng trong tài liệu skill

7. **Bảng route của `revise` làm route direct gần như không tới được trong run `both`.** Dòng
   Consult bắt mọi thay đổi "reaches a `-business` view", nên đổi một chữ trong nhãn cũng phải
   đi consult với 2-3 bản nháp, trái với nhánh "label-only giữ sửa tay" ở bước 3.
8. **`SKILL.md:26` nói CLI "never touches the network"**, nhưng `preview` tải renderer từ
   `viewer.diagrams.net` và jsDelivr. `docs/architecture.md:62` và README thì viết đúng.
9. **Installer để bản backup ngay trong thư mục skills.** Sau nâng cấp có
   `.agents/skills/zukai.bak-<timestamp>/SKILL.md` vẫn mang `name: zukai`. Chính `install.sh`
   ghi chú rằng hai bản cùng tên sẽ tranh routing. Việc runtime có nạp thư mục `.bak-*` hay
   không thì chưa kiểm chứng.
10. **Business view chưa được định nghĩa cho architecture, ER và class.** `variants.md` bảo
    giữ nguyên kind và bỏ tên bảng, cột, class; với ER/class thì không còn gì để vẽ, với
    architecture thì đụng quy tắc icon AWS và mục 6 của review checklist.
11. **Câu hỏi mở đầu không nhất quán.** `SKILL.md` hỏi "Which view?", còn
    `brainstorm-protocol.md`, `variants.md` và `agents/diagram-brainstorm.md` hỏi "Who will
    read it?".
12. **Không có quy tắc cho tham số lạ.** `/zukai:draw` không tham số thì không bước nào hỏi
    chủ đề; từ đầu tiên không phải mode, `--kind gantt`, `--to pdf` đều không được nhắc tới.
    CLI thì báo lỗi rõ.
13. **Run Mermaid không có `bundle` options.** `drift` từ chối file `.md`, nhưng consult và
    direct đều yêu cầu `--bundle @<file>`; agent phải tự viết object.
14. **Tìm run mơ hồ** khi hội thoại đã tạo hai run, và không có quy tắc cho path argument
    không phải run.
15. **Mô tả skill và plugin thiếu `activity`.** Frontmatter của `draw` và `plugin.json` liệt
    kê 6 kind, không có activity/swimlane.
16. **"Vẽ kiến trúc các module" không có lời giải.** Quy tắc level-of-detail ép về mức tài
    nguyên triển khai (ra 3 ô), còn mười component là module thì CLI không cảnh báo gì.

## C. Hành vi chưa hợp lí

17. **Quét secret chỉ chặn ở figjam và chỉ hiểu từ khoá tiếng Anh.** drawio, mermaid và
    bundle ghi secret ra file với exit 0; `--allow-sensitive` vô nghĩa ngoài figjam;
    "shared targets" không được định nghĩa. Nhãn dạng `mật khẩu: <giá trị>` qua mọi target
    mà không có cảnh báo nào, kể cả figjam. Dữ liệu cá nhân (email, số điện thoại) không được
    quét dù closing contract cấm đưa vào nhãn.
18. **`validate` chỉ kiểm cấu trúc, trừ `activity`.** Flowchart có decision không lối ra,
    node mồ côi, cạnh trùng; state không có initial hoặc có state không tới được; sequence có
    return trước call; ER có FK không có relation: tất cả qua với 0 cảnh báo. README quảng bá
    "validated before it is drawn" nên người đọc dễ hiểu rộng hơn thực tế.
19. **`relabel` cho một nhãn in cảnh báo cho mọi nhãn còn lại.** Đổi một nhãn sinh 46 cảnh báo
    "label not relabelled" (23 KB) mà closing contract buộc in nguyên văn.
20. **Sau `relabel`, `drift` báo 95 cell "moved/resized"** mà người dùng không hề chạm, vì
    nhãn mới làm bố cục kỳ vọng thay đổi. Lần revise sau sẽ kể ra các "sửa tay" không có thật.
21. **Bản sao file sửa tay mất lặng lẽ.** `history/rNNN/extras/` là bản duy nhất của file
    draw.io đã sửa tay; sau 5 snapshot nữa nó bị xoá, mỗi undo/redo cũng tính một lần, và CLI
    chỉ in `"removed":["r003"]`.
22. **Review gate không bao giờ nhìn file gộp.** `preview` từ chối `.md`, và contract chỉ
    preview từng file riêng, trong khi nhãn `↳` ở file gộp khác với file riêng.
23. **`preview` không có `--out` ghi vào `/tmp/zukai-preview/<basename>.png` dùng chung.**
    `x.drawio` và `x.mmd` đè nhau, các phiên chạy song song cũng đè nhau (đã thấy trong lần
    chạy này).
24. **Parse tham số CLI.** `--out --allow-sensitive` ghi ra file tên `--allow-sensitive` và bỏ
    qua cờ; `--out` thiếu giá trị thì in ra stdout không báo lỗi; target lạ trả exit 2 thay vì
    1; không có `--help`.
25. **`detail accepted:` không tắt cảnh báo.** Người dùng đã chọn giữ thì cảnh báo vẫn lặp lại
    ở mọi lần emit. Nhãn endpoint một đoạn như `POST /redeem` lại không bị bắt, trong khi
    `GET /orders/{id}/items` thì có.
26. **`snapshot` trên run có `source/` rỗng** tạo revision rỗng mà `restore` sau đó từ chối.
27. **Không cảnh báo kích thước.** Flowchart 200 node emit với 0 cảnh báo dù hướng dẫn là
    khoảng 15 phần tử. Thời gian drawio tăng gần bậc hai (500 node 2,8 s; 1500 node 22 s),
    không ảnh hưởng ở kích thước thực tế.
28. **`both` tạo gấp đôi số diagram** (6 diagram gần giống nhau cho một quy trình nghiệp vụ)
    mà không có hướng dẫn nói trước điều đó với người dùng.
29. **Bản cài copy nặng 4,8 MB** vì mang theo `tests/`, `fixtures/`, snapshot; runtime chỉ cần
    `bin/`, `references/` và `feature-matrix.json`.

## D. Lỗi bố cục nhìn thấy trên ảnh render

30. **Mermaid architecture vỡ khung khi component có `ref`.** Khung nhóm chồng lên nhau, bao
    cả component không thuộc nhóm, id của part xuống dòng giữa chữ; không có cảnh báo. `ref`
    lại là câu trả lời duy nhất skill cho phép khi người dùng xin kiến trúc chi tiết. Chưa rõ
    lỗi thuộc Mermaid 12.3 hay trang preview.
31. **Flowchart hướng `LR`:** các nhánh của một decision rời cùng một điểm, nhãn nhánh dồn ở
    thân chung nên không biết nhãn nào của nhánh nào; start node nằm lệch dưới trục chính khi
    có vòng lặp quay về.
32. **ER:** hai relation đi vào cùng một điểm neo, ký hiệu cardinality đè nhau.
33. **Activity:** guard vẽ trên thân chung sau khi một flow khác đã nhập vào, xa decision của
    nó; action ngoài cùng bên trái đi tới merge bị vòng qua tận bên phải với hai chỗ nhảy
    đường, và hint của cảnh báo gợi ý "lane khác" trong diagram chỉ có một lane.
34. **Bước có `ref` trong file gộp đọc lặp** ("X / ↳ X") vì tiêu đề part buộc phải gọi tên
    bước đó; slug dài trong file riêng tràn lên hai vạch dọc của hình subroutine.
35. **Class:** nhãn của self-relation in đè lên class bên cạnh, 0 cảnh báo `layout:`.
36. **Sequence:** không đặt được note sau một block; `after` message cuối đưa note vào nhánh
    `else` cuối.
37. **Bản tiếng Nhật qua `relabel`:** chữ tràn hộp ở vài chỗ, tên icon AWS xuống dòng giữa
    từ, hai nhãn nằm trên mũi tên; 2 trong 10 cảnh báo layout là sai (nhãn thực tế vừa một
    dòng).

## Đề xuất thứ tự xử lý

1. Mục 1, 2, 3: sửa nhỏ, cục bộ, và đang làm sai output hoặc crash.
2. Mục 5, 6, 7: sửa lời trong skill, không đụng code.
3. Mục 4, 17, 21: cần quyết định thiết kế (diff có tính thứ tự không, secret chặn ở target
   nào, extras có nằm ngoài vòng xoay history không).
4. Nhóm D: mục 30 và 31 ảnh hưởng nhiều nhất tới diagram người dùng thực sự nhận.

## Câu hỏi còn mở

- Việc chỉ figjam chặn secret là chủ ý (file local là việc của người dùng) hay là thiếu sót?
- Giới hạn 40 ký tự của id trang có lý do từ phía draw.io không, hay chỉ để gọn?
- Thư mục `plans/` từng bị gỡ khỏi repo (commit `8d839fc`); báo cáo này đang nằm ở
  `plans/reports/` và chưa được commit.
