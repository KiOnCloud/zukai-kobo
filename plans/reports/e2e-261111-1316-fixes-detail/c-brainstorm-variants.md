# E2E C: brainstorm, variants, FigJam fallback, secrets, arguments, checks, installer

Date 2026-11-11 (UTC). Runtime played: no `AskUserQuestion`, no subagents, no Figma tool.
CLI: `node /home/user/zukai-kobo/skills/draw/scripts/bin/cli.mjs` (called `$CLI` below), plugin version 2.0.3.
Scratch root (called `$S` below): `/tmp/claude-0/-home-user-zukai-kobo/d18c1f21-fd55-4bdd-a991-536a40188c82/scratchpad/e2e-c`.
The "user's project" is `$S/proj`; every run command was executed with it as working directory.
Nothing under `/home/user/zukai-kobo` was changed except this report. I ran one read-only `git status --short` by mistake (the task said not to use git); it changed nothing, and it showed uncommitted edits under `skills/draw/` that were already there.
`preview` without `--out` writes into `/tmp/zukai-preview/`, as the contract describes; that is the only place outside `$S` that received files.

## Result per step

| Step | Check | Result |
|---|---|---|
| 1a | Wording of the view question in four files | PASS |
| 1b | Number of diagrams said before writing | PASS (with a note) |
| 1c | Business view rules for architecture and ER | PASS with two ambiguities (F4, F5) |
| 1d | Bundle command used literally, page order | PASS |
| 1e | `detail:` warnings, "keep" recorded, endpoint label fixed | PASS (one gap, F3) |
| 1f | ER cardinality markers at a shared end | FAIL (F1, visual defect) |
| 1f | Flowchart decision branch labels (top to bottom) | PASS |
| 2 | Left-to-right flowchart, two decisions, one loop back | PASS |
| 3 | Language variant by `relabel` | PASS for keys and warnings; two doc gaps (F6, F7), one over-cautious warning class (F8) |
| 4 | FigJam fallback text, secret scan on every target | PASS for the CLI; one doc contradiction (F2), two scan gaps (F9) |
| 5 | Arguments | PASS for five of six; `--to pdf` has no question to ask (F10) |
| 6 | Validate-time checks | PASS for detection; contract gaps for `size:` and `meta.omitted` (F11, F12) |
| 7 | Installer | PASS in all scenarios |

## Step 1: `/zukai:draw brainstorm tính năng tích điểm thành viên cho app bán hàng, chạy trên AWS`

What happened. Mode `brainstorm` was read from the first word (`SKILL.md:36`). Without `AskUserQuestion` the opening call was one text message with two numbered questions, scope and view (the kind question is left out in brainstorm mode, `SKILL.md:139-143`); answers `overview` and `both`, target `drawio` by default. Brainstorm protocol: idea restated, three candidates proposed, the user picked all three (architecture, flowchart, er). The first one picked gave the run its slug, so the run folder is `$S/proj/diagrams/20261111_loyalty-points/` with `loyalty-points` (architecture), `loyalty-points-flow` (flowchart) and `loyalty-points-data` (er), each with a `-business` IR. Clarify slots were filled with assumed answers recorded as `assumed:` notes.

**(a) View question wording: PASS.** All four texts use the same question, "Which view?": `skills/draw/SKILL.md:111` (with the Vietnamese "Góc nhìn của diagram?"), `references/brainstorm-protocol.md:12`, `references/variants.md:64`, `agents/diagram-brainstorm.md:19`. A different contradiction sits two lines further down in the agent file, see F13.

**(b) Count before writing: PASS.** `SKILL.md:121-123` says "It doubles the run: with `detailed` and two parts that is six diagrams ... before writing the IRs you state the number in one line", and `variants.md:82-83` repeats it. Following that, I stated "6 diagram: 3 diagram x 2 góc nhìn" before writing. Note: the only worked example is for `detailed` with parts; the brainstorm case (several picked candidates under `overview`) has to be derived from "one technical IR and one `<slug>-business.ir.json` per diagram" (`SKILL.md:119-120`).

**(c) Business view rules: PASS with ambiguities.** `variants.md:41` (architecture) and `variants.md:42` (er) were enough to derive both business IRs:
- Architecture: the AWS icons stay ("keep the AWS icons", `variants.md:41`), product names stay, connection protocols became purposes ("xem điểm, đổi voucher" for "HTTPS").
- ER: entities renamed to the reader's words ("Thành viên", "Giao dịch điểm", "Voucher"), surrogate keys and foreign-key columns removed, types written as `text`, `number`, `date`, relations and cardinalities kept.
- Both business IRs validated with 0 warnings and I judged them PASS against checklist items 12 and 13 in the review step.
- Two places needed a decision the text does not make (F4, F5): what the business architecture does with tables the user chose to keep apart, and whether an SQS queue between two services is kept ("Amazon SQS is a name a client reads on an invoice") or merged ("a queue between two services is merged into the connection it serves"). Both sentences are in the same table cell.

**(d) Bundle command, literally: PASS.**
```
$CLI bundle --to drawio --out diagrams/20261111_loyalty-points/loyalty-points.drawio --title "Tích điểm thành viên" --canvas all diagrams/20261111_loyalty-points
"order":["loyalty-points","loyalty-points-business","loyalty-points-data","loyalty-points-data-business","loyalty-points-flow","loyalty-points-flow-business"]
```
The main diagram comes first, then its business view, then each further diagram followed by its business view, as `closing-contract.md:35-37` says. The further diagrams come in name order (data before flow), not in the order the user picked them (flowchart before er); no text promises pick order.

**(e) `detail:` warnings: PASS.** First draft (`validate`, exit 0, 2 warnings):
> detail: 3 components ("tbl-members", "tbl-ledger", "tbl-vouchers") are stores of one kind that only "loyalty-api" uses; an architecture diagram shows a resource once, not its tables or its parts

> detail: the label of connection "c-api-lambda" ("POST /redeem") reads as an endpoint path; an architecture diagram labels a connection with its protocol, its port or what it is for in the infrastructure

I changed the label to `invoke` and recorded the user's decision as the contract's example shows (`closing-contract.md:113-116`): `detail accepted: "tbl-members", "tbl-ledger" and "tbl-vouchers" stay separate components, the user's choice`. The next `validate` and `emit` printed `"warnings":0`. Two control runs confirm the mechanism: a note without the quoted ids (`$S/misc/arch-noids.ir.json`) still warns, and a fourth table added later (`$S/misc/arch-4th.ir.json`) brings the warning back naming all four. Note: by `closing-contract.md:118-120` the question to the user is due only "when the request itself asked for what the warning names"; this request did not, so the literal contract would have merged the tables without asking, and the "keep" decision was the simulated user's own initiative. The first draft I tried, with a second Lambda writing to one of the three tables, produced no store warning at all (F3).

**(f) PNGs.**
- ER, top to bottom: FAIL. In the technical ER the relations "sở hữu" (one to many) and "trả cho" (one to zero-or-one) both end at `vouchers`, at the same point of its top edge (`entryX=0.506;entryY=0` on both edges in the file). The zero-or-many and the zero-or-one markers are drawn on top of each other and cannot be told apart; no `layout:` warning is printed. Setting `toAttribute` on both relations did not move either end. The business ER, whose entities have no `fk` attributes, got two separate ends and is readable. In review round 1 I filed this as a `wrong` layout finding and fixed it from the IR with `direction: "LR"`, where each end lands on its own FK row; round 2 passed.
- Flowchart decision labels, top to bottom: PASS. In both flowchart PNGs every branch label stands on or beside the line of its own branch (four decisions in the technical view, three in the business view). The label of the branch that turns sideways stands just below the tip beside the shared trunk, a few pixels above the split; it is readable because the other label is on the far side or further down.
- Review verdict of the run: round 1 FAIL (one `wrong`, the ER markers), round 2 PASS. The combined file's canvas page comes back from `preview --max-px 1600` as 7 tiles (F14).

## Step 2: left-to-right flowchart

`/zukai:draw clarify --kind flowchart --scope overview --audience business quy trình đổi điểm lấy voucher`, IR `$S/proj/diagrams/20261111_redeem-voucher/source/redeem-voucher.ir.json` with `direction: "LR"`, decisions `q-enough` and `q-other`, loop back `q-other -> choose`. `validate`, `emit`, `bundle`: 0 warnings.

**PASS.** In the PNG every answer can be assigned: "đủ" stands on the branch that goes up to "Trừ điểm của khách", "không đủ" on the line that goes on to the second decision, "không" on the line to "Khách thoát, không đổi", and "có" beside the bottom tip on the line that returns to "Chọn voucher muốn đổi".

## Step 3: Japanese variant by `relabel`

Map `$S/proj/diagrams/20261111_loyalty-points/source/labels.ja.json`, output `loyalty-points.ja.drawio`, command as in `variants.md:90`.

- Keys: PASS. `<diagram id>:<ir id>`, `<diagram id>:title`, edge and connection ids, ER relation ids and `canvas:title` all matched (`"unmatched":[]`); the seven page names in the output are Japanese, the canvas page included. ER relation labels work with the relation id although the list in `variants.md:101-104` names only "a flowchart edge, a connection, a message, an activity guard" and state transitions.
- Undocumented key (F6): after the first pass 20 texts were `untouched`, all of them ER attribute rows. `variants.md` gives no key for a row. The place names in `untouched` (`loyalty-points-data-business:members:row-0`) do work as keys, with the whole row text as value; I found that only by trying. With those keys and `$keep` the second pass reported `"replaced":171`, 0 untouched.
- Warnings: first pass 9 (8 `layout:` plus one summary line "20 labels kept their text: ... and 15 more"), second pass 10 `layout:`. Each names the cell once with both pages ("on pages canvas, loyalty-points-flow"), as the text promises. Wording samples: "layout: the new label wraps to 2 lines below its shape, where the layout left room for 1" and "layout: the new label needs about 142 px in a 162x80 diamond that holds 131 px on one line".
- False warnings: none of the "wraps to 2 lines" warnings is false. The three icon or client names and the two ER rows reported do wrap in the PNG (the ER rows are clipped, the Lambda name runs onto its "read / write" connection). The diamond warnings are a different matter (F8): of five, only `q-dup` visibly crosses the rhombus edges; `q-min` and `q-tier` (reported on both the technical and the business page, so four of the ten warnings) render on one line inside the rhombus with a thin margin.
- AWS page: `variants.md:122-126` says a re-emit from a translated IR "is the usual one" for an architecture diagram with AWS icons and "When most of the icon names of a page are reported, say so and offer the translated IR instead of delivering the relabelled page." Here 2 of 11 names (technical) and 1 of 7 (business) were reported, so the relabelled pages were delivered with their warnings. "Most" has no number, and the text does not say how one page of a combined file is replaced by a re-emitted one (F7).

## Step 4: FigJam without a Figma tool, and the secret scan

**Fallback text: PASS.** `target-figjam.md:78-81` names the command: "The text to paste is the one section 2 made: the output of `emit --to figjam`, never of `emit --to mermaid`." I wrote it with `--out diagrams/20261111_redeem-voucher/figjam/redeem-voucher.mmd`, previewed and reviewed it, and printed it in a fenced `mermaid` block. The `figjam` text starts with `flowchart LR`, has no front matter and no entity codes. A control label `Điểm > 100 & "voucher" < 5 #gt; (a) [b]` gives `Điểm ＞ 100 ＆ 'voucher' ＜ 5 gt (a) b` for `figjam` (with a warning) and `#gt; 100 #amp; #quot;voucher#quot; #lt; 5 #35;gt#59; ...` plus front matter for `mermaid`. `SKILL.md:213` still says "otherwise fall back to `mermaid`", which contradicts this (F2).

**Secret scan.** IRs in `$S/sec/`. No message echoes the value; each shows the first four characters of the match and its length ("pass…(21 chars)", "mật …(22 chars)", "lan.…(20 chars)").

| Label | `validate` | `emit figjam` | `emit mermaid` | `emit drawio` | `bundle drawio` / `bundle mermaid` |
|---|---|---|---|---|---|
| `password=Sup3rS3cret!` | exit 0, warning `token-pattern` | exit 2, no file | exit 2, no file | exit 2, no file | exit 2, no file |
| `mật khẩu: Sup3rS3cret!` | exit 0, warning `token-pattern` | exit 2, no file | exit 2, no file | exit 2, no file | exit 2, no file |
| `lan.nguyen@gmail.com` | exit 0, warning `personal-data` | exit 2, no file | exit 0, file written, warning | exit 0, file written, warning | exit 0, file written, warning |
| `lan.nguyen@example.com` | exit 0, no warning | exit 0, file written | exit 0 | exit 0 | exit 0 |

Refusal message: `refusing to emit for <target>: possible key=value assignment of a password, token or secret (pass…(21 chars)); remove it before sharing the diagram`, hint `replace the value in the IR with a placeholder such as <db password>, or pass --allow-sensitive if it is not a secret`. The e-mail refusal for `figjam` carries the same `<db password>` hint. This matches `closing-contract.md:93-99`.

What the contract tells me to do:
- Credential by its form: "no target writes it ... Fix the IR" (`closing-contract.md:93-95`). I replace the value with `<db password>`.
- Guess (the mail address): warning for `drawio` and `mermaid`, refusal for `figjam`; "fix the IR for these too before delivering; leave one in only when the user says it is not a secret, and say so in the report" (`closing-contract.md:96-99`).
- `--allow-sensitive` is explained: PASS. `closing-contract.md:100-101` ("the user's word that a finding is not a secret. Pass it only after the user said so for that value, never on your own"), `target-figjam.md:25-27`, and `cli.mjs help`. With the flag, `emit --to drawio` of the `password=` IR exits 0 and writes the file with a warning.
- Gaps (F9): the placeholder domains (`example.com` and others) are exempt without any text saying so, and a telephone number without separators (`0912345678`) is not found, while `0912 345 678` and `+84 912 345 678` are.

## Step 5: arguments

| Invocation | Sentence followed | Result |
|---|---|---|
| `/zukai:draw` | "No arguments and no request at all: there is nothing to draw yet. Ask one thing first, as plain text: what the diagram should show" (`SKILL.md:39-42`) | PASS |
| `/zukai:draw clarfy vẽ luồng đăng nhập` | "when it is a mode misspelt by a letter or two (`clarfy`, `scuot`), say in one line which mode you read it as and go on with that mode" (`SKILL.md:37-38`) | PASS |
| `/zukai:draw vẽ luồng đăng nhập` | "Any other first word is part of the request, and the mode is asked" (`SKILL.md:36-37`) and "No mode given: ask ... as one more part of the opening call" (`SKILL.md:60-63`) | PASS |
| `--kind gantt` | "A flag with a value the skill does not have ... fixes nothing: say in one line which values exist ... and ask that question in the opening call. Never pass such a value to the CLI and never pick the nearest one" (`SKILL.md:43-47`) | PASS |
| `--to pdf` | The same sentence. It lists the targets, but "that question" does not exist: the opening call is defined as "mode, kind, scope and view, at most four questions" (`SKILL.md:62`, `SKILL.md:139-141`) | FAIL, no target question is defined (F10) |
| `/zukai:draw scout kiến trúc các module của CLI này` | "the kind question of the opening call is still asked, even when the request says "architecture": offer `class` first ..., `flowchart` second ... and `architecture` third" (`SKILL.md:198-205`) | PASS; in a text runtime the kind question "lists all seven kinds" (`SKILL.md:141`), so the three go first and the other four follow, which the text leaves to me |

## Step 6: validate-time checks

IRs in `$S/v/`. Every `validate` exits 0 with the warning; `emit --to drawio` repeats it and writes the file.

- (i) `model: decision "q" has one way out; a decision is a question with at least two answers` and `model: "lonely" is connected to nothing`.
- (ii) `model: no initial state; the reader cannot tell where the thing starts`.
- (iii) `model: return "m1" from "api" to "app" comes before any call from "app" to "api"`.
- (iv) `model: entity "voucher" has a foreign key ("member_id") but takes part in no relation`.
- (v) `size: 200 nodes in one diagram; a reader follows about 15 to 20, and the layout slows down with every element`.

Detection: PASS for all five. The contract for `model:` is clear: "Fix the IR for each `model:` warning before emitting, or record the reason in `meta.omitted` when the gap is on purpose" (`closing-contract.md:29-30`). Two gaps: recording the reason does not stop the warning (F12), and for `size:` the contract says "the others are handled as the rules below say" but no rule below mentions `size:` (F11).

## Step 7: installer

| Scenario | Exit | Skills folder after | Second `name: zukai` in the skills folder | Backup | Size | Installed CLI |
|---|---|---|---|---|---|---|
| Fresh `codex` (`$S/inst-a`) | 0 | `zukai`, `zukai-revise` | none | none | 2.4M + 40K | `validate` exit 0 |
| Same again | 0, "already up to date" | unchanged | none | none | 2.4M + 40K | exit 0 |
| Fresh `claude-project` (`$S/inst-b`), then again | 0, 0 | `zukai`, `zukai-revise` | none | none | 2.4M + 40K | exit 0 |
| Upgrade over 1.0.0 (`$S/inst-c`) | 0 | `zukai`, `zukai-revise` | none | `.agents/zukai-backups/zukai-20261111141421` | 2.4M + 40K | exit 0 |
| Leftover `zukai.bak-20260101000000` (`$S/inst-d`) | 0 | `zukai`, `zukai-revise` | none | `.agents/zukai-backups/zukai-20260101000000` | 2.4M + 40K | exit 0 |
| Leftover `.bak` beside an up-to-date copy (`$S/inst-a`) | 0 | `zukai`, `zukai-revise` | none | `.agents/zukai-backups/zukai-20260202000000` | unchanged | not re-run |

**PASS.** The only other `SKILL.md` with `name: zukai` is in `zukai-backups/`, outside the skills folder. The `claude-project` run prints the fallback-channel warning. The CLI check was `node <dest>/.agents/skills/zukai/scripts/bin/cli.mjs validate $S/proj/diagrams/20261111_redeem-voucher/source/redeem-voucher.ir.json` (`.claude/skills` for `inst-b`).

## Findings

**F1. visual-defect: two ER relations into one entity share one end in a top-to-bottom layout.** `skills/draw/references/target-drawio.md:128` promises that anchors on the top or bottom side "are spread across the width". With two `fk` attributes in the target entity both edges get `entryX=0.506;entryY=0`, the crow's-foot markers overlap, and no `layout:` warning is printed. Repro: `$CLI emit --to drawio $S/misc/er-toattr.ir.json --out /tmp/x.drawio && grep -o 'entryX=[^"]*' /tmp/x.drawio`. Workaround from the IR: `direction: "LR"`.

**F2. doc-contradiction: the FigJam fallback.** `skills/draw/SKILL.md:213` says "otherwise fall back to `mermaid` and say so"; `skills/draw/references/target-figjam.md:78-81` says the text to paste is "the output of `emit --to figjam`, never of `emit --to mermaid`". An agent that reads only the target table emits front matter and entity codes, and skips the figjam refusal for personal data. Repro: `$CLI emit --to mermaid $S/sec/ent.ir.json` against `$CLI emit --to figjam $S/sec/ent.ir.json`.

**F3. bug (detection gap): three tables of one database pass when two components use one of them.** `skills/draw/references/ir-reference.md:315` limits the check to stores "that one component alone uses". An API Lambda and a worker Lambda that both write `point_ledger` leave only two stores with a single user, so the three DynamoDB components draw no warning; only the reviewer (checklist item 11) can catch it. Repro: `$CLI validate $S/misc/arch-shared-table.ir.json` prints the endpoint warning only.

**F4. ambiguity: business architecture and tables the user kept apart.** `skills/draw/references/variants.md:41` removes "table counts" and checklist item 12 (`review-checklist.md:78-80`) forbids table names, but nothing says whether a `detail accepted:` choice of the technical view carries into the business view. I merged the three tables into one "Amazon DynamoDB" and listed it in `meta.omitted`; keeping three stores under business names would have raised the `detail:` warning again on the business IR.

**F5. ambiguity: SQS in a business architecture.** `variants.md:41` says to keep product names ("Amazon SQS" is the example) and, in the same cell, to merge "a queue between two services" into its connection. Checklist item 12 says no queue name remains and has no exception for the architecture rule. I merged the queue and kept "Amazon SNS".

**F6. doc gap (ambiguity): no documented map key for ER attribute rows.** `variants.md:93-104` lists keys for elements, titles, lines, transitions and the canvas. A translation leaves every attribute row `untouched`; the working key `<diagram id>:<entity id>:row-<n>` (value: the whole row text, key mark and type included) appears only in the `untouched` output. Class members are presumably the same; I did not test them. Repro: `$CLI relabel` with a map that has no `:row-` keys on `$S/proj/diagrams/20261111_loyalty-points/loyalty-points.drawio`.

**F7. ambiguity: "most of the icon names" and the mixed route.** `variants.md:125-126` gives no threshold, and the offered alternative (a translated IR for that page) has no procedure for a combined file: the variant "covers the combined file" (`variants.md:132`) and the draw.io path "must not re-emit" (`variants.md:21`).

**F8. UX: the diamond warning fires for labels that still render inside the rhombus.** `q-min` and `q-tier` ("needs about 142 px in a 162x80 diamond that holds 131 px on one line") render on one line inside the shape; only `q-dup` (213 px against 185) crosses the edges. The message does not say what the reader will see. Repro: `$CLI relabel $S/proj/diagrams/20261111_loyalty-points/drawio/loyalty-points-flow.drawio --map $S/proj/diagrams/20261111_loyalty-points/source/labels.ja.json --out /tmp/f.drawio`, then `preview`.

**F9. bug (scan gaps), low: undocumented exemption and unseparated phone numbers.** `skills/draw/scripts/src/scan-secrets.mjs:56` exempts `example.com` and similar domains, which no skill text mentions; `scan-secrets.mjs:52-53` needs separators, so `0912345678` passes for every target, FigJam included, although `closing-contract.md:96-97` names "a telephone number". Repro: `$CLI emit --to figjam $S/sec/s5.ir.json` exits 0.

**F10. doc-contradiction: an unknown `--to` value has no question to go to.** `SKILL.md:43-47` says to "ask that question in the opening call", while `SKILL.md:62` and `SKILL.md:139-141` define the call as mode, kind, scope and view only. With `AskUserQuestion`, a request with no mode and an unknown target would need five questions against the stated limit of four.

**F11. ambiguity: no rule for a `size:` warning.** `closing-contract.md:30-31` sends `size:` to "the rules below", which never mention it. The CLI hint says to split with scope `detailed`, which `SKILL.md:107` forbids under `overview` ("never split under `overview`"). Repro: `$CLI validate $S/v/v.ir.json`.

**F12. UX: a `model:` gap recorded in `meta.omitted` keeps warning.** `closing-contract.md:29-30` allows recording the reason, but the warning returns on every `validate` and `emit` and step 5 has every warning shown verbatim; a `detail accepted:` note, by contrast, silences its warning. Repro: `$CLI validate $S/v/i2.ir.json`.

**F13. doc-contradiction: candidate line in the agent file.** `agents/diagram-brainstorm.md:22-23` uses `<kind>: <scope> for <audience>` and "differ in kind or scope"; `references/brainstorm-protocol.md:17-20` uses `<subject>` and says explicitly that it is "not the `overview` or `detailed` scope of the opening call". The agent's description (line 3) also says "kind, scope, audience". Not exercised here (no subagents); found by reading.

**F14. UX: the canvas page preview is hard to review.** `preview --max-px 1600` of the six-diagram combined file returns 7 tiles of 1500 px with an 800 px overlap, most of each tile blank, each cutting diagrams in half. Repro: `$CLI preview $S/proj/diagrams/20261111_loyalty-points/loyalty-points.drawio --max-px 1600`.

**F15. ambiguity, low: default ER anchor and plural entity names.** `ir-reference.md:181` anchors a relation at "the one FK whose name contains the other entity"; `member_id` does not contain `members`, so the line ends at the header until `toAttribute` is set. Seen in `$S/misc/er-lr.png`.

## PNGs actually opened

- `/tmp/zukai-preview/loyalty-points-drawio-e56e6d1a.png` (technical architecture)
- `/tmp/zukai-preview/loyalty-points-business-drawio-97511471.png`
- `/tmp/zukai-preview/loyalty-points-data-drawio-5cf6a3cf.png` (technical ER, the top-to-bottom version before the fix; the path was overwritten by the left-to-right re-render, which I did not reopen)
- `/tmp/zukai-preview/loyalty-points-data-business-drawio-b24cc16f.png`
- `/tmp/zukai-preview/loyalty-points-flow-drawio-5d46bbf8.png`
- `/tmp/zukai-preview/loyalty-points-flow-business-drawio-2096ea0b.png`
- `/tmp/zukai-preview/loyalty-points-drawio-92ff7ef8-1.png` and `-4.png` (canvas page, 2 of 7 tiles)
- `/tmp/zukai-preview/loyalty-points.ja-drawio-e0bcb0ce-6.png` (Japanese canvas, 1 of 7 tiles)
- `/tmp/zukai-preview/redeem-voucher-drawio-b255ba1d.png` (step 2)
- `/tmp/zukai-preview/redeem-voucher-mmd-a20f9248.png` (step 4, figjam text)
- `$S/misc/er-crop.png` (zoom on the overlapping markers), `$S/misc/er-lr.png` (left-to-right ER with the same IR change as the fix)
- `$S/misc/loyalty-points.ja.png`, `$S/misc/loyalty-points-business.ja.png`, `$S/misc/loyalty-points-flow.ja.png`, `$S/misc/loyalty-points-data-business.ja.png`, `$S/misc/flow-ja-diamonds.png` (single pages relabelled with the same map, for inspection only)

Not opened: canvas tiles 2, 3, 5, 6, 7 of the Vietnamese file, six of the seven Japanese tiles, and the left-to-right technical ER inside the final bundle. The review of those rests on the single-page images.

## Unresolved questions

1. Should a `detail accepted:` choice carry into the business view of the same architecture diagram (F4)?
2. Is the exemption of `example.com` and of unseparated phone numbers intended (F9)? If so, the contract should say so.
3. Should a `model:` warning stop once its reason is in `meta.omitted`, the way `detail accepted:` works (F12)?
