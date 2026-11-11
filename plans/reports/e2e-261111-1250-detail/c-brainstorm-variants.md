# Zukai end-to-end test C: brainstorm, views, language variant, FigJam, bad arguments

Tester acted as the runtime agent, following `skills/draw/SKILL.md` and its references literally.
Context: UTC, 2026-11-11, user language Vietnamese, Node v22.23.4, no draw.io desktop on PATH
(preview renderer was `drawio-web` / `mermaid-web` through Playwright). Nothing under
`/home/user/zukai-kobo` was modified. No Figma/Canva tool was called (only the schema of
`mcp__Figma__generate_diagram` was loaded, to compare it with `target-figjam.md`).

Paths used below:

- `PROJ` = `/tmp/claude-0/-home-user-zukai-kobo/d341e1af-4dbd-40ea-aeb1-5a8be443704e/scratchpad/proj-brainstorm`
- `TMP`  = `/tmp/claude-0/-home-user-zukai-kobo/d341e1af-4dbd-40ea-aeb1-5a8be443704e/scratchpad/tmp-c`
- `PNG`  = `/tmp/claude-0/-home-user-zukai-kobo/d341e1af-4dbd-40ea-aeb1-5a8be443704e/scratchpad/reports/c-png`
- `CLI`  = `node /home/user/zukai-kobo/skills/draw/scripts/bin/cli.mjs`
- `REF`  = `/home/user/zukai-kobo/skills/draw/references`

---

## 1. Per step

### Step 1: `/zukai:draw brainstorm tính năng tích điểm thành viên cho app bán hàng, chạy trên AWS` — PASS with findings

Expected by the docs: opening call asks scope + view only (kind skipped in brainstorm), then
brainstorm protocol steps 1-5, clarify protocol for the chosen candidates, closing contract.

What happened:

- Opening call: two questions (scope, view), see section 3. Kind question skipped as SKILL.md:66-68
  says. Answers: overview, both.
- Candidates proposed (brainstorm-protocol.md step 2, one line each):
  1. `architecture: tích điểm thành viên trên AWS (app, API, dữ liệu, hàng đợi, email, đối tác) for developers + business, answers "cái gì chạy ở đâu và nối với cái gì?"` (default: the request says "chạy trên AWS")
  2. `flowchart: tích điểm sau thanh toán và đổi điểm lấy voucher for developers + business, answers "các bước và điều kiện nào quyết định thành viên được điểm, được voucher?"`
  3. `state: vòng đời của điểm thưởng for developers + business, answers "điểm có những trạng thái nào và điều gì làm nó đổi trạng thái?"`
  The protocol calls these "candidate diagram sets" but defines each candidate as one kind on one
  line, so no "set" contains three kinds; the simulated user picked all three ("or several, which
  become several IR files"). See findings F2, F3.
- Clarify rounds: required slots that the answer sheet did not fill were asked once (section 3),
  answered "defaults", and recorded as `assumed: ...` in `meta.notes`.
- Architecture went through `aws-icons.md`: `aws:mobile_client`, `aws:api_gateway`, `aws:lambda`,
  `aws:dynamodb`, `aws:sqs`, `aws:simple_email_service`, `aws:generic_application` (payment
  gateway), `aws:traditional_server` (on-premise CRM), frame `aws:aws_cloud`. All validated; all
  icons render with their picture in the PNGs (no empty squares).
- `detail:` warnings, deliberate breach IR `TMP/repro/arch-v1-detail-breach.ir.json`
  (3 DynamoDB tables used by one Lambda, connection label `POST /loyalty/points/redeem`):

  ```
  $ CLI emit --to drawio TMP/repro/arch-v1-detail-breach.ir.json --out x.drawio      (exit 0)
  stderr: {"warnings":[{"stage":"detail","path":"/components/3","message":"detail: 3 components (\"tbl-members\", \"tbl-points\", \"tbl-vouchers\") are stores of one kind that only \"loyalty-fn\" uses; an architecture diagram shows a resource once, not its tables or its parts","hint":"draw one component and put the number in its label (\"DynamoDB (3 tables)\"); ..."},
          {"stage":"detail","path":"/connections/0/label","message":"detail: the label of connection \"c-app-api\" (\"POST /loyalty/points/redeem\") reads as an endpoint path; an architecture diagram labels a connection with its protocol, its port or what it is for in the infrastructure","hint":"write the protocol or the purpose (\"HTTPS\", ...)"}]}
  stdout: {"ok":true,"out":"...","warnings":2}
  ```

  Both breaches are reported, as documented. `validate` on the same file says only
  `{"ok":true,...}` (documented: warnings come "on every emit"). `bundle` repeats them.
  Closing contract rule applied: question asked once with the fix first (section 3), user chose
  the fix; IR changed to one `DynamoDB (3 bảng)` component, table names moved to `meta.notes`,
  label `HTTPS`; re-emit gives `warnings:0`.
- Review gate (other-runtimes path, checklist read, reviewer voice), round 1:

  ```text
  Verdict: PASS
  Images: loyalty-architecture: opened ; loyalty-architecture-business: opened ; loyalty-points-flow: opened ; loyalty-points-flow-business: opened ; loyalty-points-states: opened ; loyalty-points-states-business: opened
  Findings:
  - [polish] [wording] loyalty-architecture / c-api-fn, c-fn-db: "invoke", "read / write" are English in a Vietnamese diagram -> "gọi hàm", "đọc / ghi"
  - [polish] [wording] loyalty-points-states / t-earn: "1 điểm / 10.000đ" has a second "/" that reads as the event/action separator -> "1 điểm mỗi 10.000đ"
  - [polish] [layout] loyalty-points-states / t-redeemed-end, t-expired-end: the two arrows into the final state end almost on the same point, the upper one with a small kink -> emitter: (not fixable from the IR)
  ```

  Polish applied, validated, emitted, bundled again without a new round (closing contract step 4).
  Final warnings: none.

Surprises in this step: F1, F4, F5, F6, F7, F8, F9, F20.

### Step 2: business views against `variants.md` — PARTIAL (flowchart/state PASS, architecture undefined)

- Flowchart business (`loyalty-points-flow-business`): removed webhook, Lambda, `PointTransactions`,
  SQS, SES, `Vouchers`, "API"; kept every rule with its value (1 điểm mỗi 10.000đ, hết hạn sau
  12 tháng, hạng Bạc / Vàng / Kim cương theo tổng điểm năm, "Đủ điểm còn hạn?"), the observable
  outcomes (email, voucher, rejection) and the actors the reader knows (CRM của khách, app).
  `meta.omitted` has two entries. Same kind/scope/subject, file name `-business.ir.json`,
  `meta.audience: "business"`. Follows the table.
- State business: same structure, technical event/action names reworded. Follows the table.
- Architecture business: `variants.md` gives no usable rule. Its table speaks of "steps",
  "branches", "outcomes"; for an architecture diagram it only yields "remove queue, endpoint and
  configuration names" and "remove queueing". Taken literally I removed the SQS component and API
  Gateway, renamed Lambdas to "Dịch vụ tích điểm" / "Dịch vụ thông báo", replaced protocol labels
  with purposes, and kept the AWS icons because SKILL.md:147-150 demands an icon on every AWS
  component. The result contradicts review-checklist item 6 ("An AWS `icon` is the service its
  label names, and a `group` is the construct its label names"): a Lambda icon labelled "Dịch vụ
  tích điểm", an AWS Cloud frame labelled "Chạy trên AWS". See F10.
- ER / class business view (not in my set; doc reading only, not executed): `variants.md` says
  "same kind" and at the same time "remove class, method, function, table, column ... names".
  For an `er` or `class` diagram those names are the entire content. Undefined. See F10.

### Step 3: `tạo bản tiếng Nhật của run này` (relabel route) — PASS with findings

Command (as `variants.md` prescribes):

```
$ CLI relabel diagrams/20261111_loyalty-points/loyalty-points.drawio --map diagrams/20261111_loyalty-points/source/labels.ja.json --out diagrams/20261111_loyalty-points/loyalty-points.ja.drawio     (exit 0)
stdout: {"ok":true,"out":".../loyalty-points.ja.drawio","replaced":181,"byText":0,"unmatched":[],"untouched":[],"warnings":10}
stderr warnings (all `layout:`):
- the new label wraps to 2 lines in a 140x80 diamond that holds 0 at that width; "loyalty-points-flow-business:enough-points" on pages canvas, loyalty-points-flow-business
- (same) "loyalty-points-flow:enough-points" on pages canvas, loyalty-points-flow
- the new label wraps to 2 lines below its shape, where the layout left room for 1; "loyalty-architecture-business:loyalty-service" ...
- (same) loyalty-architecture-business:payment-gateway, loyalty-architecture:mobile-app, :loyalty-fn, :loyalty-db, :events-queue, :ses, :payment-gateway
```

Checks:

- Map key format: `<diagram id>:<ir id>` and `<diagram id>:title` work as documented; a complete
  map plus `$keep` (`API Gateway`, `HTTPS`, `AWS Cloud`) gives empty `untouched` and `unmatched`,
  as promised. Undocumented but needed: edge/connection/transition labels are keyed by the edge
  id (cell `...:label`), a state transition must be translated as the whole composed string
  `event [guard] / action`, and the canvas page is renamed with `canvas:title` (F12).
- `$keep`: works, applies to every page and the canvas.
- `byText` / `untouched` / `unmatched` (probe `TMP/repro/labels-probe.ja.json`):
  `{"replaced":18,"byText":7,"unmatched":["loyalty-architecture:no-such-id","typo-id"],"untouched":[59 entries]}`
  plus one warning line per untouched text and one for the unmatched keys. Reporting works.
  `byText` is only a number, and it counted canvas copies reached through bare keys, not
  hand-copied cells (F13). Bare keys silently hit both views of a `both` run (F13).
- Where files live: map in `<run>/source/labels.ja.json`, output `<run>/loyalty-points.ja.drawio`
  (both exist). Not listed in the run-folder table of `closing-contract.md`; the per-diagram
  `drawio/<slug>.drawio` files get no language variant by the documented route (F14).
- `meta.lang`: not touched on the draw.io route (by design: IR stays as is). The `.ja.drawio`
  carries no language marker (`<mxfile host="zukai" compressed="false" type="device" pages="7">`),
  the only record is the file name (F14).
- Page names: all 7 `<diagram name=...>` are Japanese in the output.
- `↳` ref lines (separate small detailed run, `TMP/ref-run/`): with `redeem-01-check:title` in the
  map the ref cell becomes `ポイント確認<br>↳ 有効ポイントの確認` on both the canvas and the page. Without
  that key the `↳` line stays Vietnamese and the page title is reported in `untouched` (good).
  With a bare `title` key the pages are renamed but the `↳` line keeps the old title (F15).
- Japanese fit in the preview (geometry kept): see F16, F17. Real overflows exist and are warned
  about; two of the ten warnings are false positives.

### Step 4: `/zukai:draw clarify --to figjam --kind flowchart --scope overview --audience business quy trình đổi điểm lấy voucher` — PASS for the CLI, FAIL for the fallback text and the secret policy

- No opening call (all four flags given); report must say "audience business, from the flag".
- `emit --to figjam` (exit 0): Mermaid text on stdout without front matter, one warning on stderr:

  ```
  {"warnings":[{"stage":"emit","path":"/nodes/2/label","message":"label \"Đủ điểm còn hạn (>= giá voucher)?\" contains characters FigJam cannot show (quotes, markup, line breaks); written as \"Đủ điểm còn hạn (≥ giá voucher)?\""}]}
  ```

  Full text kept in `TMP/figjam.stdout`. `emit --to figjam --out file.mmd` also works (undocumented).
  `bundle --to figjam` -> exit 2 `bundle supports drawio and mermaid, not "figjam"` (documented).
- Tool present in this session: `mcp__Figma__generate_diagram` (deferred). Section 1-3 of
  `target-figjam.md` are executable. Section 4 is only partly executable here: the skill
  `figma-generate-diagram` is not in this session's skill list and the session has no tool to
  read the `skill://figma/...` resource (unverified whether another session has one). The
  parameter names `name`, `mermaidSyntax`, `fileKey` match the tool schema. Differences between
  the reference and the tool's own description: F19. Stopped before the call, as instructed.
- Fallback executed (as if the tool were absent): `emit --to mermaid --out
  diagrams/20261111_voucher-redeem/mermaid/voucher-redeem.mmd` (exit 0, 0 warnings), bundle
  `voucher-redeem.md`, preview opened (`PNG/s4-voucher-redeem-mermaid.png`, clean). The fallback
  text differs from the figjam profile exactly where the CLI says FigJam cannot cope (F18).
- Secret scan matrix (IRs in `TMP/repro/secret-*.ir.json`):

  | IR | `--to figjam` | `--to figjam --allow-sensitive` | `--to mermaid` (with or without flag) | `--to drawio` (with or without flag) |
  |---|---|---|---|---|
  | label `password=Sup3rS3cret!` | exit 2, `refusing to emit for figjam: possible key=value assignment of a password, token or secret (pass…(21 chars))`, no stdout | exit 0, text contains the secret, 1 warning | exit 0, text contains the secret, 1 `secret-scan` warning | exit 0, file written with the secret, 1 warning |
  | label `AKIAIOSFODNN7EXAMPLE` | exit 2, `refusing to emit for figjam: possible AWS access key id (AKIA…(20 chars))` | exit 0 + warning | exit 0 + warning | exit 0 + warning |
  | `meta.notes` `postgres://admin:hunter2@db.internal:5432/app` (never part of the Mermaid text) | exit 2 refusal at `/meta/notes/0` | exit 0 + warning | exit 0 + warning | exit 0 + warning |
  | label `mật khẩu: Sup3rS3cret!` | exit 0, no warning | exit 0 | exit 0, no warning | exit 0, no warning |

  `bundle --to drawio` on the password IR: exit 0, warning, secret in the file. `validate`: no
  secret warning. Compared with the docs: "the FigJam target refuses to send them" holds.
  "treat its warnings as blockers for shared targets" is agent policy only, the CLI blocks
  nothing but figjam, and the documented figjam fallback routes around the block (F18, F21).

### Step 5: missing / unknown arguments — FAIL (text ambiguous or silent), CLI PASS

- `/zukai:draw` (no arguments). Prescribed opening call (SKILL.md:46-49, 109-120): one
  `AskUserQuestion` call with four questions: mode, kind, scope, view (verbatim in section 3).
  Not unambiguous: there is no request, so "the three kinds that fit the request best" has no
  basis; nothing ever asks what the diagram is about; and the kind question is asked in the same
  call as the mode question although a `brainstorm` answer makes it void (F22).
- `/zukai:draw foo bar`. SKILL.md:33 says "First word is the mode: `clarify`, `scout` or
  `brainstorm`." It does not say what an unknown first word is. Most literal reading: no mode
  given, "foo bar" is the request, same four-question call as above. A typo such as `clarfy`
  is silently treated as the subject (F23).
- `/zukai:draw clarify --kind gantt lịch dự án`. The skill text has no rule for a kind outside
  its table of seven: `--kind` "fixes the diagram kind", so the kind question is skipped and the
  clarify protocol has no question bank for it. The CLI is clear:

  ```
  $ CLI validate TMP/repro/gantt.ir.json      (exit 2)
  {"ok":false,"errors":[{"path":"/kind","message":"must be equal to one of the allowed values","hint":"allowed values: \"flowchart\", \"sequence\", \"state\", \"er\", \"class\", \"architecture\", \"activity\""}]}
  ```

  What I would do (not prescribed): tell the user gantt is not supported and ask the kind
  question with the seven kinds (F24).
- `--to pdf`. The skill text lists three targets and says nothing about another value. CLI:

  ```
  $ CLI emit --to pdf <ir>     (exit 2)
  {"ok":false,"errors":[{"path":"/","message":"unknown target \"pdf\"","hint":"targets: mermaid, drawio, figjam"}],"warnings":[]}
  $ CLI bundle --to pdf ...    (exit 2)  bundle supports drawio and mermaid, not "pdf"
  $ CLI emit <ir>  (no --to)   (exit 1)  emit needs --to <target> and exactly one file   + usage
  ```

  Clear messages. The skill never tells the agent to say "PDF is not a target; emit draw.io and
  export from there" (F24). Note the CLI has no default target although the skill calls drawio
  "default"; the agent must always pass `--to`.

---

## 2. Findings

Severity: bug / doc-contradiction / ambiguity / UX-unreasonable / visual-defect.

**F1 — doc-contradiction — the opening question has two different wordings.**
SKILL.md:95-98 and :138 insist the question is "Which view?" / "Góc nhìn của diagram?" ("the
question asks for that, not for the reader's name"). `REF/brainstorm-protocol.md:12`,
`REF/variants.md:51` and `agents/diagram-brainstorm.md:19` all say the opening call asked
"Who will read it?". Repro: `grep -n "Who will read\|Which view" skills/draw/SKILL.md skills/draw/references/*.md agents/*.md`.

**F2 — ambiguity — "candidate diagram sets" are single diagrams.**
`REF/brainstorm-protocol.md:16-19`: "Propose two or three candidate diagram sets. Each candidate
is one line: `<kind>: <scope> for <audience>, answers "<question>"`". A set with several kinds
cannot be written in that form; the only way to get architecture + flowchart + state is the
aside in step 3 ("or several, which become several IR files"). "Prefer the smallest set" then has
no meaning. No rule says whether several picked candidates are several "main diagrams" of one
run under `overview` (SKILL.md:79 "the main diagram only") or several runs.

**F3 — ambiguity — "scope" means two things, and `both` has no candidate wording.**
In the candidate line `<scope>` is the subject ("checkout from cart to confirmation"), while the
opening call's scope is `overview|detailed`; step 4 then says "the candidate's scope and audience
already fill the kind and subject slots". With the view answer `both` the protocol only says
"`both` as two views"; what goes into `for <audience>` is not said.

**F4 — bug / doc-contradiction — the documented bundle command puts parts and business views before the main diagram.**
`REF/closing-contract.md:25` and `REF/target-drawio.md:27` give
`bundle ... source/*.ir.json` "(main diagram first)". The shell sorts `-` before `.`, so
`<slug>-business.ir.json` and `<slug>-01-<part>.ir.json` come before `<slug>.ir.json`.
Repro 1: `cd PROJ && ls diagrams/20261111_loyalty-points/source/*.ir.json` lists
`loyalty-architecture-business.ir.json` before `loyalty-architecture.ir.json`; the first bundle I
ran with the glob returned `"canvas":["loyalty-architecture-business","loyalty-architecture",...]`.
Repro 2: `TMP/ref-run/source/` -> glob order `redeem-01-check.ir.json`, `redeem.ir.json` (part
first, so the file would open on the part's page when there is no canvas). I had to list the
files by hand to follow the contract.

**F5 — ambiguity — who decides on a `detail:` warning.**
`REF/closing-contract.md:75-84`: "Fix the IR and emit again before the review gate; the author
never accepts one. Only the user can keep it: ask once ... with the fix as the first option".
If the author must always fix, there is nothing to ask; if the user must be asked, the author
does not "fix and emit again" first. The text does not say when the question is due (only when
the author believes the warning is wrong? always?). SKILL.md:172-173 has the same pair of
sentences.

**F6 — bug — a one-segment endpoint is not seen as an endpoint path.**
`scripts/src/check-detail.mjs:23` (`ENDPOINT_PATH` needs two path segments). Repro:
`CLI emit --to drawio TMP/repro/detail-single-segment-path.ir.json --out /tmp/x.drawio` ->
only the "3 components" warning; the connection label `POST /redeem` passes although
`ir-reference.md` ("An endpoint path ... is behaviour") and SKILL.md:164-165 name exactly this.

**F7 — UX-unreasonable — a kept `detail:` warning is repeated on every emit and bundle.**
After the user says "keep", `detail accepted:` goes into `meta.notes`, but the CLI ignores it.
Repro: `CLI emit --to drawio TMP/repro/detail-accepted-note.ir.json --out /tmp/x.drawio` -> the
same two warnings. Since "print every warning ... verbatim" holds, the user reads an accepted
warning in every later report (and in every revise).

**F8 — bug (robustness) — `preview` without `--out` writes into one shared directory keyed by file name only.**
`scripts/src/preview.mjs:369` (`join(tmpdir(), 'zukai-preview', basename + '.png')`). During my
run `/tmp/zukai-preview/` also held `refund-approval*.png`, `ck-sync*.png`, `order-checkout*.png`
from other sessions. Two projects or parallel sessions with the same slug overwrite each other's
PNG, and a reviewer can open a picture of another run. `REF/closing-contract.md:35-37` documents
"writes to the same path each time" only for one run.

**F9 — doc-contradiction (minor) — "Look at the PNG as described in `SKILL.md`".**
`REF/target-drawio.md:97-98` and `REF/target-mermaid.md` (Preview section). SKILL.md says nothing
about looking at PNGs; the rule is in `closing-contract.md` step 4 and `review-checklist.md`.

**F10 — ambiguity / doc-contradiction — business view of architecture, ER and class diagrams is undefined.**
`REF/variants.md:23-33`. The table is written for flows. For `architecture`: are AWS service
names components to keep ("systems the reader knows by name") or "queue ... configuration names"
to remove? Does the SQS component go ("queueing")? Do AWS icons stay (SKILL.md:147-150 requires
them, review-checklist.md:38-40 item 6 requires the label to name the icon's service, item 12
forbids "queue ... name")? For `er` / `class`: "same kind" plus "remove class, method, function,
table, column names" removes the whole diagram. With view `both` and a brainstorm set that holds
an architecture diagram, the agent has to invent the rule. Files showing my literal reading:
`PROJ/diagrams/20261111_loyalty-points/source/loyalty-architecture-business.ir.json`,
`PNG/s1-r1-loyalty-architecture-business.png`.

**F11 — UX-unreasonable — clarify's "show the IR draft in a fenced json block" does not scale to `both` or several candidates.**
`REF/clarify-protocol.md:19-21`. This run had six IRs (about 250 lines of JSON) to show before
one closing question; the protocol gives no shorter form for multi-diagram runs, and a business
reader is the least likely to read JSON.

**F12 — ambiguity — relabel map keys for edges, transitions and the canvas are not documented.**
`REF/variants.md:66-77`, `REF/target-drawio.md:64-78` say "one key per element id". Found by
probing: an edge / connection / message label is keyed by the edge id (the cell is
`<id>:label`); a state transition must be given as one string in the rendered form
`event [guard] / action`; the canvas page name is `canvas:title`. The docs call the bundle
canvas key nowhere. Repro: `TMP/repro/labels-probe.ja.json` (keys `canvas:title`,
`loyalty-points-states:t-earn`).

**F13 — UX-unreasonable — bare keys in a bundle: silent cross-view hits and a misleading `byText`.**
With view `both` the technical and business IRs share ids by construction. A bare key
(`"mobile-app": "販売アプリ"`) replaced "App bán hàng (mobile)" on the technical page and
"App bán hàng trên điện thoại" on the business page, with no warning. The canvas copies are not
matched by a bare key at all (`scripts/src/relabel.mjs:78-98`: on the canvas the key is
`<diagram>:<id>`), they are reached only through the by-text pass, so `byText` was 7 with no
hand-copied cell in the file; the docs describe `byText` as hand-copied cells. `byText` is a
count without a list. Repro:
`CLI relabel PROJ/diagrams/20261111_loyalty-points/loyalty-points.drawio --map TMP/repro/labels-probe.ja.json --out TMP/repro/probe.ja.drawio`
(stdout kept in `TMP/repro/probe.stdout`).

**F14 — ambiguity — where a language variant lives and what it covers.**
`REF/variants.md:60-64` puts the map in `source/labels.<lang>.json` and the output beside the
bundle; `REF/closing-contract.md:10-16` (run-folder table) lists neither. The route relabels only
the combined file; the reusable `drawio/<slug>.drawio` copies stay Vietnamese and nothing says
whether they should be relabelled too (it works: same map, the other pages' keys come back as
`unmatched`, e.g. 72 unmatched for one file). The review gate asks for a preview of "each
individual output file", which do not exist for the variant; `preview` on the bundle renders the
canvas page only (6 tiles here). `meta.lang` is never set on this route and the source IRs carry
no `meta.lang: "vi"`, so no artefact records which language a `.drawio` is in except its name.
Whether `revise` keeps `<run-slug>.<lang>.drawio` in step after a change: unverified (not run).

**F15 — bug (minor) — bare `title` renames the pages but not the `↳` lines.**
`scripts/src/relabel.mjs:49` builds the ref-line titles only from keys ending in `:title`.
Repro: `cd TMP/ref-run && CLI relabel redeem.drawio --map labels-baretitle.json --out redeem.ja3.drawio`
-> pages are named "共通タイトル", the ref cell still reads `ポイント確認<br>↳ Kiểm tra điểm còn hạn`,
and that stale line is not in `untouched`.

**F16 — visual-defect — Japanese labels after `relabel` (expected by design, but the result is poor for AWS diagrams).**
Seen in `PNG/s3-ja-loyalty-architecture.png`, `PNG/s3-ja-loyalty-architecture-business.png`,
`PNG/s3-ja-loyalty-points-flow.png`:
- icon names wrap in the middle of a word because the wrap width is the old name's width:
  "SQS ポイントイベ/ント", "DynamoDB（3テーブ/ル）", "SES メール送/信", "販売アプリ（モバイ/ル）";
- the second line of "ポイント付与 Lambda" and of "ポイント付与サー/ビス" lies on the outgoing
  connection (the arrow to the store starts inside the name);
- the decision "有効なポイントが足りる？" touches / crosses the slanted edges of its 140x80 rhombus;
- flowchart boxes sized for one line now hold two (e.g. "SESでメール送信：獲得ポイント/数"), text
  fills the box top to bottom; no warning for these (consistent with the doc: the box "holds" them).
Every icon name longer than the Vietnamese one triggers a warning (8 of 10 warnings), so for an
AWS architecture diagram the "layout preserved" route nearly always ends in "re-emit from a
translated IR". The state diagram is fine.

**F17 — bug (minor) — two relabel `layout:` warnings are false, and the diamond message is odd.**
"決済ゲートウェイ" is warned as "wraps to 2 lines below its shape" on both architecture pages
but renders on one line in both PNGs (measured 12.3 px per CJK glyph against a label width taken
from "Cổng thanh toán"). The diamond warning reads "wraps to 2 lines in a 140x80 diamond that
holds 0 at that width" — "holds 0" tells the user nothing. Repro: the relabel command of step 3;
stderr kept in `TMP/relabel-ja.stderr`.

**F18 — doc-contradiction — the FigJam fallback hands the user the wrong profile and defeats the secret gate.**
`REF/target-figjam.md:71-76`: "Run `emit --to mermaid` instead ... paste the text" into FigJam.
(a) `target-figjam.md:3-4,30-35` says FigJam needs the `figjam` profile ("the subset Figma
accepts": no front matter, no entity encoding). The fallback text has both:
`diff TMP/figjam.stdout PROJ/diagrams/20261111_voucher-redeem/mermaid/voucher-redeem.mmd` ->
front matter `--- title: ... ---` added and `n3{"Đủ điểm còn hạn (#gt;= giá voucher)?"}` instead
of `(≥ giá voucher)`. How FigJam's paste dialog treats these: unverified (no Figma call made);
the CLI's own warning says FigJam cannot show them. The "say which warnings applied" sentence
cannot be followed either: `emit --to mermaid` returned 0 warnings, the one that matters appears
only with `--to figjam`.
(b) the refusal for secrets exists only on `--to figjam`; the fallback's `--to mermaid` exits 0
with `password=Sup3rS3cret!` in the text the user is told to paste into FigJam
(`CLI emit --to mermaid TMP/repro/secret-password.ir.json`).
`emit --to figjam` (stdout or `--out`) would be the right source for the fallback text.

**F19 — ambiguity — `target-figjam.md` section 4 against the Figma tool's own description.**
- The reference says "Do not ask which plan to use and do not guess a `planKey`"; the tool
  schema says "If the user has more than one plan, ask which one to use before calling".
- The tool asks for LR by default and quoted labels; the CLI output is `flowchart TB` for a TB
  IR (quotes are present). Not an error, but "labels lose quotes" in the reference reads as if
  the output were unquoted.
- With `fileKey`, the Figma server instructions require `create_session` first and a `sessionId`
  on the call; the reference does not mention it.
- The skill `figma-generate-diagram` it tells the agent to load was not available in this
  session and the fallback is an MCP resource URI the session had no reader for. Whether the
  call succeeds without it: unverified.
- The figjam warning text says "(quotes, markup, line breaks)" for a label whose only problem
  was `>=`.

**F20 — ambiguity — the run folder and the review gate are not defined for the figjam target.**
`REF/closing-contract.md:10-18,28-29`: the table has no row for figjam ("it has no bundle"),
step 4 previews "each individual output file" and a FigJam board is not one. Nothing says to
write the figjam Mermaid text to a file and preview it (which works:
`CLI emit --to figjam <ir> --out x.mmd && CLI preview x.mmd`, `PNG/s4-voucher-redeem-figjam-profile.png`),
or whether the review runs before the board is created (it should, since the data leaves the
machine at that point).

**F21 — ambiguity — "treat its warnings as blockers for shared targets".**
`REF/closing-contract.md:68-70`. "Shared targets" is not defined (FigJam only? a `.drawio`
committed to a repository?). The CLI writes the secret into `.drawio`, `.mmd` and the bundle with
exit 0, `validate` does not report it at all, and `--allow-sensitive` is a no-op outside figjam.
Also: a secret in `meta.notes` blocks the figjam emit although notes are never sent, and the scan
knows only English keywords: `mật khẩu: Sup3rS3cret!` passes every target without a warning
(`TMP/repro/secret-vn-prose.ir.json`) although the skill tells the agent to write labels in the
user's language.

**F22 — ambiguity — `/zukai:draw` with no arguments.**
SKILL.md:46-49 and :109-120. (a) No request exists, so the kind question's "three kinds that fit
the request best, best fit first and labelled (suggested)" cannot be built, and "Nothing else is
asked before the user answers" leaves no place to ask for the subject; no later step asks for it
either (clarify's slots assume it, state's `subject` slot says "from request"). (b) The kind
question is in the same call as the mode question, but "In `brainstorm` mode skip this question":
if the user answers `brainstorm`, the kind answer is void or contradicts the candidates. (c) For
runtimes without `AskUserQuestion`: "send one text message with the full numbered list below ...
add the scope and audience as numbered items, and accept a number" — the kinds are 1-7; whether
scope/audience/mode continue the numbering or start their own lists is not said, so a reply
"1" or "default" is ambiguous, and the sentence does not say whether the kind list is left out in
brainstorm mode.

**F23 — ambiguity — unknown first word.**
SKILL.md:33 ("First word is the mode") with no rule for another word. Literal reading: it is the
request and the mode is asked. A misspelt mode (`clarfy`) becomes part of the subject without a
word to the user.

**F24 — ambiguity — unsupported `--kind` / `--to` values are not handled in the skill text.**
SKILL.md:34-37. Nothing says what to do with `--kind gantt` or `--to pdf`; the flag "fixes" the
value and suppresses the question, so a literal agent reaches the CLI before anything stops it
(`validate` exit 2 with the allowed kinds; `emit` exit 2 `unknown target "pdf"` with the three
targets). The closing contract's "say what the feature matrix reports" does not apply: neither
value is in the matrix.

**F25 — UX-unreasonable (minor) — English strings in user-facing output.**
The Markdown bundle writes `Source:` and `Not shown on purpose:` in English whatever the user's
language (`PROJ/diagrams/20261111_voucher-redeem/voucher-redeem.md`), while the contract says
"Labels are what the reader sees. Write them in the user's language."

**F26 — UX-unreasonable (minor) — nothing tells the two views apart in the combined file.**
With `both`, page names are the IR titles. `variants.md` does not ask for distinct titles; had I
kept the same title for both views (as "same subject" suggests) the draw.io file would have two
pages with the same name and the canvas two identical headings.

**F27 — visual-defect (minor) — state diagram, two arrows into the final state.**
`PNG/s1-final-loyalty-points-states.png`: the arrows from "Đã đổi voucher" and "Hết hạn" end
almost on the same point of the final circle, the upper one with a slight kink. Cannot be fixed
from the IR.

No visual defect found in the technical and business architecture PNGs (icons present, no line
through a name or frame title, CRM beside its caller as `target-drawio.md` describes) or in the
two Vietnamese flowcharts (branch labels on their own branch, groups enclose their members).

---

## 3. Questions "asked" (verbatim) and answers taken

**Step 1 opening call** (one `AskUserQuestion` call, two questions; mode given, kind skipped):

1. "Mức chi tiết?" — options:
   - "Tổng quan (overview) – gợi ý": chỉ một diagram chính, khoảng 15 phần tử, mỗi luồng con gộp thành một bước; quy tắc quyết định được đưa lên diagram chính.
   - "Chi tiết (detailed)": diagram chính cộng một diagram con cho mỗi luồng con đáng vẽ riêng, liên kết bằng `ref`.
   Answer (sheet): overview.
2. "Góc nhìn của diagram?" — options:
   - "Kỹ thuật (technical) – gợi ý": developer, reviewer; giữ tên component, endpoint, bảng dữ liệu.
   - "Nghiệp vụ (business)": PM, khách hàng, vận hành; chỉ luồng và quy tắc nghiệp vụ, không có tên kỹ thuật.
   - "Cả hai (both)": một bản mỗi loại trong cùng thư mục.
   Answer (sheet): both.

**Step 1 brainstorm restatement and pick:** "Bạn muốn vẽ tính năng tích điểm thành viên của app
bán hàng chạy trên AWS, cho cả người đọc kỹ thuật và nghiệp vụ (hai góc nhìn). Chọn một hoặc
nhiều phương án: 1. architecture ... (gợi ý) 2. flowchart ... 3. state ..." (lines in section 1).
Answer (sheet): the set with architecture plus two other kinds -> all three.

**Step 1 clarify, round 1** (one message, only empty slots; facts from the sheet were used first):

1. (architecture, boundaries) "Các thành phần được nhóm thế nào (tài khoản AWS, VPC, region, on-premise)? [mặc định: không có khung; AWS được nêu nên dùng một khung AWS Cloud]"
2. (architecture, connections) "Thành phần nào gọi thành phần nào, qua giao thức gì? Cổng thanh toán và CRM nối vào đâu? [bắt buộc, không có mặc định]"
3. (architecture, direction) "Có kết nối nào hai chiều không? [mặc định: tất cả một chiều]"
4. (architecture, scope) "Hiện trạng hay trạng thái mục tiêu? [mặc định: hiện trạng]"
5. (flowchart, start and end) "Sự kiện nào bắt đầu quy trình và thế nào là xong? [mặc định: một điểm đầu, một điểm cuối]"
6. (flowchart, steps / decisions / exception outcomes) "Liệt kê các bước theo thứ tự; luồng rẽ nhánh ở đâu; nhánh 'không' đi về đâu? [nhánh thất bại: kết thúc quy trình]"
7. (state, subject / states / initial and final / transitions) "Đối tượng nào có trạng thái, gồm những trạng thái nào, bắt đầu và kết thúc ở đâu, sự kiện nào chuyển trạng thái? [bắt buộc]"
   Answer: not on the sheet -> "defaults"; every filled slot is recorded as `assumed: ...` in `meta.notes`.

**Step 1 closing question (clarify):** six IR drafts shown as `json` blocks, then "Xuất các
diagram này ra drawio, hay cần thay đổi gì?" Answer: yes (default).

**Step 1 `detail:` question** (closing contract): "Bản vẽ kiến trúc đang vẽ ba bảng DynamoDB
thành ba thành phần riêng (chỉ một Lambda dùng) và ghi đường dẫn endpoint `POST
/loyalty/points/redeem` trên một kết nối. Sơ đồ kiến trúc chỉ nên cho thấy tài nguyên và cách
chúng kết nối." Options: 1. "Sửa (gợi ý)": một thành phần "DynamoDB (3 bảng)", nhãn kết nối là
giao thức; tên bảng ghi vào ghi chú, chi tiết endpoint để cho diagram loại khác. 2. "Giữ như đang
vẽ". Answer (sheet): fix.

**Step 3:** no question in `variants.md`; none asked.

**Step 4 clarify, round 1:** 1. "Sự kiện nào bắt đầu quy trình và thế nào là xong? [một điểm đầu,
một điểm cuối]" 2. "Liệt kê các bước theo thứ tự, mỗi bước một cụm động từ. [bắt buộc]" 3. "Luồng
rẽ nhánh ở đâu? Câu hỏi và các kết quả của từng quyết định. [không có]" 4. "Nhánh 'không' hoặc
thất bại đi về đâu? [kết thúc quy trình]". Answer: not on the sheet -> defaults, `assumed:` notes.
Closing question: "Xuất diagram này ra figjam, hay cần thay đổi gì?" -> yes.
Line that would precede the Figma call (`target-figjam.md` section 3): "Tiêu đề và các nhãn của
diagram sẽ được gửi tới Figma và một board mới sẽ được tạo trong Drafts của bạn." Fallback line:
"Không có Figma MCP server nào được kết nối; dưới đây là bản Mermaid để dán vào FigJam."

**Step 5a, `/zukai:draw`** (one call, four questions, as SKILL.md:132-141 shows for Vietnamese):

1. "Bạn có đầu vào nào?" — "Làm rõ yêu cầu (clarify)": bạn mô tả luồng nghiệp vụ, tính năng hoặc quy trình bằng lời và chi tiết chưa rõ; "Đọc code (scout)": diagram phải phản ánh mã nguồn hiện có trong thư mục làm việc; "Ý tưởng thô (brainstorm)": bạn có ý tưởng thô và chưa biết diagram nào sẽ giúp ích.
2. "Loại diagram? Loại khác: state, er, class, architecture (chọn Other và gõ tên)" — "Trình tự (sequence) – gợi ý", "Lưu đồ (flowchart)", "Swimlane (activity)", each with its translated description. (No request exists, so the three kinds and the suggestion are arbitrary: F22.)
3. "Mức chi tiết?" — "Tổng quan (overview) – gợi ý", "Chi tiết (detailed)".
4. "Góc nhìn của diagram?" — "Kỹ thuật (technical) – gợi ý ...", "Nghiệp vụ (business) ...", "Cả hai (both) ...".

**Step 5b, `/zukai:draw foo bar`:** the same four-question call with "foo bar" as the request
(literal reading, F23).

**Step 5c/5d:** nothing prescribed; no question defined by the skill (F24).

---

## 4. Run folders, repro inputs and PNGs

Run folders (kept):

- `PROJ/diagrams/20261111_loyalty-points/` — `source/` (6 IRs + `labels.ja.json`), `drawio/` (6 files), `loyalty-points.drawio` (canvas + 6 pages), `loyalty-points.ja.drawio`
- `PROJ/diagrams/20261111_voucher-redeem/` — `source/voucher-redeem.ir.json`, `mermaid/voucher-redeem.mmd`, `voucher-redeem.md`

Repro inputs (kept):

- `TMP/repro/arch-v1-detail-breach.ir.json`, `detail-single-segment-path.ir.json`, `detail-accepted-note.ir.json`, `detail-vn-prose.ir.json`
- `TMP/repro/labels-probe.ja.json`, `probe.stdout`, `probe.stderr`, `probe.ja.drawio`; `TMP/relabel-ja.stdout`, `TMP/relabel-ja.stderr`
- `TMP/ja-single/*.ja.drawio` (each diagram relabelled on its own, used for the Japanese previews)
- `TMP/ref-run/` (`source/redeem.ir.json`, `source/redeem-01-check.ir.json`, `redeem.drawio`, `labels.ja.json`, `labels-noparttitle.ja.json`, `labels-baretitle.json`, `redeem.ja*.drawio`)
- `TMP/figjam.stdout`, `TMP/figjam.stderr`, `TMP/figjam-out.mmd`
- `TMP/repro/secret-password.ir.json`, `secret-akia.ir.json`, `secret-in-notes.ir.json`, `secret-vn-prose.ir.json`, `gantt.ir.json`

PNGs in `PNG/` (opened with Read unless marked):

- `s1-arch-v1-breach.png` (breach IR, opened)
- `s1-r1-loyalty-architecture.png`, `s1-r1-loyalty-architecture-business.png`, `s1-r1-loyalty-points-flow.png`, `s1-r1-loyalty-points-flow-business.png`, `s1-r1-loyalty-points-states.png`, `s1-r1-loyalty-points-states-business.png` (review round 1, all opened)
- `s1-final-loyalty-architecture.png` (opened), `s1-final-loyalty-points-states.png` (not opened; only a label wording changed)
- `s1-bundle-loyalty-points-1.png` (canvas tile 1, opened), `-2` to `-6` (not opened)
- `s3-ja-loyalty-architecture.png`, `s3-ja-loyalty-architecture-business.png`, `s3-ja-loyalty-points-flow.png`, `s3-ja-loyalty-points-states.png` (opened); `s3-ja-loyalty-points-flow-business.png`, `s3-ja-loyalty-points-states-business.png`, `s3-ja-canvas-1..6.png` (not opened)
- `s4-voucher-redeem-mermaid.png` (opened), `s4-voucher-redeem-figjam-profile.png` (not opened)

Unverified items, stated as such above: how FigJam's paste dialog and `generate_diagram` treat
front matter and `#gt;` entities; whether `generate_diagram` works without the
`figma-generate-diagram` skill; whether `revise` keeps a `.<lang>.drawio` in step; the ER / class
business view (doc reading only).
