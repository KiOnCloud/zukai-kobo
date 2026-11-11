# R2-B: skill texts, CLI and pictures (final verification round)

Date 2026-11-11 (UTC). The tester played a runtime without `AskUserQuestion` and without
subagents, with Figma treated as not connected. All files were written under
`/tmp/claude-0/-home-user-zukai-kobo/d18c1f21-fd55-4bdd-a991-536a40188c82/scratchpad/r2-b/`
(called `$R` below; the user's project is `$R/proj`). `CLI` stands for
`node /home/user/zukai-kobo/skills/draw/scripts/bin/cli.mjs`. Nothing else under the
repository was changed and git was not used. Secret values are written as [redacted].

Result: 19 checks, 18 PASS and 1 PASS with a reservation (C7). No blocking bug was found.
Fifteen findings follow the table: one low bug, three visual defects, four contradictions
between texts, and seven ambiguities or UX notes.

## Checks

| # | Result | Evidence |
|---|---|---|
| T1 | PASS | `skills/draw/SKILL.md:39-42`: "No arguments and no request at all: there is nothing to draw yet. Ask one thing first, as plain text: what the diagram should show". The opening call comes after the answer. |
| T2 | PASS | `SKILL.md:37-38`: "when it is a mode misspelt by a letter or two (`clarfy`, `scuot`), say in one line which mode you read it as and go on with that mode". The request names no kind verbatim and no reader, so kind, scope and view go into one text message with numbered questions and lettered options (`SKILL.md:141-147`), in Vietnamese with the English keyword in parentheses (`SKILL.md:86-90`). The order of the seven kinds on the text path for a request that is not about modules is not stated (finding 15). |
| T3 | PASS | `SKILL.md:43-49`: "fixes nothing: say in one line which values exist ... and ask that question in the opening call ... Never pass such a value to the CLI and never pick the nearest one". The kind question is then asked normally. With the flag alone and no request, the text does not say whether "what should the diagram show" comes first (finding 9). |
| T4 | PASS, with a contradiction | `SKILL.md:46-48`: "for an unknown `--to` that is one more question there, \"Which target?\", with the three targets as options and `drawio` suggested". So the question exists and its options are `drawio` (suggested), `mermaid`, `figjam`. It collides with "at most four questions" and is missing from the list of text-path items (finding 9). `CLI emit --to pdf` exits 1 with `unknown target "pdf"`, hint `--to takes one of: mermaid, drawio, figjam`. |
| T5 | PASS | Tool path: `SKILL.md:134-136` (three kinds, best fit first) with `SKILL.md:205-209`: "offer `class` first ..., `flowchart` second ... and `architecture` third". Text path: `SKILL.md:143-145`: "lists all seven kinds ... (for a request about the modules of one program, the three kinds of \"Modules are not resources\" first and in that order, then the rest)". Both paths give class, flowchart, architecture; the text path adds sequence, activity, state, er. `scout-protocol.md:15-18` and `clarify-protocol.md:45` agree. |
| T6 | PASS for the question, FAIL for the candidate rule | The question reads "Which view?" in all four files: `SKILL.md:113-114` (Vietnamese "Góc nhìn của diagram?"), `brainstorm-protocol.md:12`, `variants.md:64`, `agents/diagram-brainstorm.md:19`. The candidate line uses `<subject>` in both `brainstorm-protocol.md:17` and `agents/diagram-brainstorm.md:22`, but the agent still says "differ in kind or scope" (finding 5). |
| T7 | PASS | `SKILL.md:217`: "hand the user the `figjam` text to paste, as section 5 of the reference says (never the `mermaid` text), and say so". `target-figjam.md:80-90`: "The text to paste is the one section 2 made: the output of `emit --to figjam`, never of `emit --to mermaid`", printed in a fenced `mermaid` block with paste steps and the warnings of that emit. The two agree. `CLI emit --to figjam c6/flow-lr.ir.json` exits 0 and prints `flowchart LR` with no front matter; a class IR exits 2 with `kind "class" is unsupported on target "figjam"`. |
| T8 | PASS | Architecture: `variants.md:41` is enough ("keep the AWS icons", "one that carries a product name stays", "Replace a protocol on a connection with what the connection is for"); an SQS queue with its icon stays because its label must name the service. ER: `variants.md:42` is enough (reader's words, cardinalities, rule attributes; no surrogate keys, FK columns, audit columns; join tables become many-to-many). `detail accepted:`: "holds for the business view too: copy the note" (`variants.md:41`). Keys (`variants.md:101-107`): the id of the edge, connection, message or flow; a transition's id with the whole text `event [guard] / action`; `canvas:title`; `<entity id>:row-<n>` counted from 0. All four were run: `relabel` replaced `canvas:title`, `<diagram>:e3`, `st:t1` and `er-tb:order:row-1` with `unmatched: []`. |
| T9 | PASS | `closing-contract.md:29-34`: fix the IR for each `model:` warning or record the reason in `meta.omitted`; on `size:` "say the count to the user and offer the scope `detailed`". `closing-contract.md:110-123`: `detail:` is fixed before the review, "the author never accepts one. Only the user can keep it". `closing-contract.md:96-103`: a credential by its form is refused by every target; a guess is a warning for drawio and mermaid and a refusal for figjam. `closing-contract.md:104-105`: `--allow-sensitive` "Pass it only after the user said so for that value, never on your own". |
| T10 | PASS, with a gap | Wording in a `both` run: direct, `revise/SKILL.md:140`: "A change of wording only ... is always direct, in however many parts and views the same wording appears". Undo and redo: `revise/SKILL.md:191`: "Never work the target out from the list yourself: pass the word". Two runs: `revise/SKILL.md:65-68`: the one the request points at; "the most recent one is not a default". Not a run: `revise/SKILL.md:61-63`: say the path and what is missing, list the runs, stop. Mermaid: `revise/SKILL.md:128-131`: `drift <run>/<run-slug>.md <run>`; run on an edited copy it returned `drifted: true` with `"change":"edited"` for the two edited diagrams. Every question in this skill names `AskUserQuestion` only (finding 8). |
| C1 | PASS | `CLI bundle --to drawio --out .../refund.drawio --title "Hoàn tiền" --canvas all diagrams/20261111_refund` and the same for mermaid: exit 0, `order` is main, main-business, part, part-business. Pages: `canvas`, then those four; headings in `refund.md` in the same order. The page ids are full and unique (44 to 74 characters). `drift` on both files right after writing: `"drifted":false`, bundle options recovered (`{"title":"Hoàn tiền","canvas":"all","gap":120}` and `{"title":"Hoàn tiền"}`). `preview` of both: exit 0, one PNG for the canvas and four for the Markdown blocks. |
| C2 | PASS | 60 connections: exit 0, a `size:` warning (61 components) and a fallback warning, output is `flowchart TB`. `diff` of the two sequences: `"reordered":[{"collection":"messages","moved":[{"id":"m2","label":"call 2","after":"m3"}]}]`, nothing under added, removed or changed. `snapshot` on empty `source/`: exit 1, "no IR files in ...; nothing to snapshot", no `history/` created. `emit ... --out --allow-sensitive`: exit 1, `option --out needs a value, but "--allow-sensitive" follows it`, no file written. `emit --to pdf`: exit 1. `--help`: exit 0 with the usage. |
| C3 | PASS | See the table below. No command echoed a full value. |
| C4 | PASS | `validate` exits 0 with: `model: decision "d" has one way out` and `model: "lonely" is connected to nothing`; `model: no initial state`; `model: return "m1" from "b" to "a" comes before any call from "a" to "b"`; `model: entity "order" has a foreign key ("customer_id") but takes part in no relation`; `size: 200 nodes in one diagram`. |
| C5 | PASS | First emit: two `detail:` warnings (three stores that only "api" uses; the label `POST /redeem` "reads as an endpoint path"). With `meta.notes: ['detail accepted: "points", "members" and "rewards" stay separate components, the user's choice']` the next emit prints only the endpoint warning. A note without the quoted ids does not stop it. |
| C6 | PASS, three visual defects | See "Pictures" below. |
| C7 | PASS with a reservation | Emit: 0 warnings. `relabel`: `replaced: 9, byText: 0, unmatched: [], untouched: [], warnings: 0`. The five icon names are on one line each and none lies on a connection, but one connection label touches another connection (finding 4). `drift` against a Japanese IR with the same file name: `"drifted":false,"relabelled":8`. Against the same IR saved as `orders-ja.ir.json`: `"drifted":true` with ten `moved` or `restyled` entries (finding 1). |
| C8 | PASS | States after `undo, undo, redo, redo, undo` from S3: S2, S1, S2, S3, S2. One more `undo` gives S1, the next exits 1 with "nothing earlier to go back to". Extras: the sixth snapshot prints `"removed":["r001"],"keptExtras":["history/extras/r001/drawio/x.drawio"]` and the file is at that path. |
| C9 | PASS | See "Installer" below. |

### C3 in detail

Each label was run through `validate`, `emit` to the three targets with `--out`, and `bundle`
to drawio and mermaid. `validate` always exits 0 and prints the finding as a warning.

| Label | Kind reported | drawio and mermaid (emit, bundle) | figjam | File written | Echoed |
|---|---|---|---|---|---|
| `password=[redacted]` | `token-pattern`, `"blocks":"emit"` | exit 2, "refusing to emit for drawio" (and mermaid) | exit 2 | no | no; the message shows `pass…(21 chars)` |
| `mật khẩu: [redacted]` | `token-pattern` | exit 2 | exit 2 | no | no; `mật …(22 chars)` |
| `パスワード：[redacted]` | `token-pattern` | exit 2 | exit 2 | no | no; `パスワー…(18 chars)` |
| customer e-mail address | `personal-data` | exit 0 with a warning | exit 2 | yes for drawio and mermaid, with the address in the file; no for figjam | the first four characters and the length |
| `0912345678` in a label | `personal-data` | exit 0 with a warning | exit 2 | as above | `0912…(10 chars)` |

This matches `closing-contract.md:96-103`. `token: required` is reported as `assignment`, a
warning only, as the contract says.

### Pictures (C6, C7)

- (i) Left to right: the start node, both decisions and the OTP step sit on one line; the end
  node is 7 px lower. "đúng" and "có" are above the straight lines, "không" is on the lower
  branch, "sai" is at the bottom corner where the return line leaves. Top to bottom: one
  column, "sai" on the return line at the right, "không" on the branch that turns right,
  "có" on the straight line. Every answer can be attributed.
- (ii) Top to bottom: the two markers enter the top of Order about 105 px apart. Left to
  right with both relations on `customer_id`: the row was made taller and the two markers
  are about 40 px apart on it.
- (iii) The loop is on the right of Category. "0..1" is clear, but "0..*" lies on the loop's
  vertical line and touches "parent of" (finding 2).
- (iv) The note stands below the `alt` frame, between the frame and the last message. The
  label "else không đủ" cuts the activation bar and the frame's border (finding 3).
- (v) Flowchart form with subgraphs, with the warning `architecture-beta cannot place this
  diagram without overlaps (the label of "api" is longer than 16 characters ...)`. The
  frames Cloud and VPC hold only the service and the database; the browser and the payment
  provider are outside. The line from the browser runs past the word "Cloud".
- (vi) "Từ chối ngay" leaves downwards, runs left round the column of "Duyệt" and joins the
  other two conclusions on one line into the merge. There is no line jump and no layout
  warning. The detour is needed because "Duyệt" stands directly below.
- C7: described in the table and in finding 4.

### Installer (C9)

`sh install.sh --target codex --dest <dir>` in four temp projects under `$R`:

| Case | Output and exit | Skills folder | Backups |
|---|---|---|---|
| fresh | "Installed zukai 2.0.3", exit 0 | `zukai` (2.4M: `.zukai-version`, `SKILL.md`, `references/`, `scripts/bin/cli.mjs`, `scripts/package.json`, `scripts/src/feature-matrix.json`), `zukai-revise` (40K) | none |
| again | "already up to date", exit 0 | unchanged | none |
| over 1.0.0 | "Upgrading zukai -> 2.0.3", exit 0 | `zukai`, `zukai-revise`, marker 2.0.3 | `.agents/zukai-backups/zukai-<stamp>` and `zukai-revise-<stamp>` (2.4M), a user file in the old copy kept |
| leftover `zukai.bak-20260101000000` | "Backup from an earlier install moved out of the skills folder", exit 0 | `zukai`, `zukai-revise` only | `.agents/zukai-backups/zukai-20260101000000` |

A copy marked 9.0.0 is refused with exit 3. The installed `cli.mjs` is byte-identical to the
repository's bundle; `validate` and `emit` ran from it and the emitted file equals the
repository CLI's output.

## Findings

1. **bug (low): `drift` reports false moves for a relabelled file when the translated IR has
   another file name.** `skills/draw/scripts/src/drift.mjs`; `variants.md:132-134` promises
   that "a relabelled file is not reported as moved by hand". Repro:
   `CLI drift c7/orders.ja.drawio c7/orders-ja.ir.json` gives `drifted: true` with ten
   `moved` or `restyled` cells; the same IR as `c7/ja/orders.ir.json` gives `drifted: false`.
   The `zukaiLabels` keys carry the page id `orders`, so they are not found under the id
   `orders-ja`, yet the page is still compared.
2. **visual-defect: class self-relation.** The cardinality at the arrow end is drawn on the
   loop's vertical line and touches the relation label; its background breaks the line. No
   `layout:` warning. Repro: `$R/proj/c6/class.ir.json`, picture `$R/c6-class-crop.png`.
3. **visual-defect: sequence `else` label.** The white background of "else không đủ" wipes
   out a piece of the API activation bar and of the frame's left border; the "alt" tab also
   runs across the bar. Repro: `$R/proj/c6/seq.ir.json`, picture `$R/c6-seq-crop.png`.
4. **visual-defect: connection label after `relabel`.** The longer Japanese label of `c2`
   ends on the vertical line of `c4`, and `relabel` reports `warnings: 0`.
   `variants.md:120-124` describes `layout:` warnings for boxes only. Repro:
   `$R/proj/c7/labels.ja.json`, picture `$R/c7-ja-crop.png`.
5. **doc-contradiction: candidates differ in "scope" or in "subject".**
   `agents/diagram-brainstorm.md:22-23` says "Candidates must differ in kind or scope" and
   its description (`:3`) lists "(kind, scope, audience, ...)", while the same line says the
   subject is not the scope, and `brainstorm-protocol.md:20` says "differ in kind or subject".
6. **doc-contradiction: "2.0.3 or older" cut page ids, but this source is 2.0.3 and does
   not.** `skills/revise/SKILL.md:103-104`, `target-drawio.md:153-154` and
   `docs/architecture.md:171` against `.claude-plugin/plugin.json` (`"version": "2.0.3"`).
   C1 shows ids of up to 74 characters and the installer stamps the copy 2.0.3. Either the
   version was not raised or the texts name the wrong one.
7. **doc-contradiction: what the secret scan does on mermaid and drawio.**
   `ir-reference.md:57-58` says "The emitter scans for them and warns; the FigJam target
   refuses to send them", and `target-figjam.md:81-82` says the `mermaid` target "does not
   refuse on what the secret scan found". `closing-contract.md:96-98` and the CLI refuse a
   credential by its form on every target (C3, exit 2).
8. **ambiguity: revise has no path for a runtime without `AskUserQuestion`.**
   `skills/revise/SKILL.md:71, 151, 189, 230` and `consult-protocol.md:27, 66` all say "ask
   ... with `AskUserQuestion`". The draw skill gives the text form (`SKILL.md:141-147`) and
   the closing contract says "where the runtime has it" (`closing-contract.md:113`). The
   installer targets Codex, which has no such tool. The tester asked in one numbered text
   message, by analogy; no sentence says so.
9. **doc-contradiction and ambiguity: the target question and the flag-only invocation.**
   `SKILL.md:46-48` adds "one more question" for an unknown `--to`, but `SKILL.md:64` and
   `:133` cap the call at "at most four questions, the tool's limit", which mode, kind,
   scope and view already fill when no mode is given. The text path lists its items as
   "(mode, kind, scope, view)" (`SKILL.md:142`) without the target. With `--kind gantt` or
   `--to pdf` and no request, `SKILL.md:39` ("No arguments and no request at all") does not
   literally apply, so the order of "say which values exist" and "what should the diagram
   show" is left open.
10. **UX: a page-scoped relabel key still renames the same text on other pages.**
    `CLI relabel refund.drawio --map t8/m1.json` with three keys gives `replaced: 6,
    byText: 6`: "có" became "yes" on the business view and both parts as well. The text
    documents it (`revise/SKILL.md:115-118`, `variants.md:110-113`) and asks to name them in
    the report, but it defeats the reason given for the `<diagram id>:` form
    (`revise/SKILL.md:113-114`) whenever the views share a wording.
11. **ambiguity (low): which ids a `detail accepted:` note must quote.**
    `closing-contract.md:117` says "quotes every id the warning named". The warning names
    four ids ("points", "members", "rewards" and "api"); the CLI is satisfied with the three
    stores, as the contract's own example suggests.
12. **UX (low): secret-scan messages.** A finding shows the first four characters of the
    match, which for a telephone number or an address is part of the value. The hint for a
    telephone number suggests `<customer e-mail>`, and the figjam refusal for an address
    suggests `<db password>`.
13. **ambiguity (low): `README.md:148`** says figjam "falls back to Mermaid text" without the
    Figma server, where the skill insists on the `figjam` text and "never the `mermaid` text".
14. **ambiguity (low): `SKILL.md:132-133`** calls the fourth question "the audience question"
    in the paragraph that otherwise fixes its wording as "Which view?".
15. **ambiguity (low): two details the texts leave to the reader.** The text path does not
    say in which order the seven kinds are listed for a request that is not about modules
    (table order with the suggestion marked, or best fit first as on the tool path). In a
    bundle, the row key is `<diagram id>:<entity id>:row-<n>`; `variants.md:105` gives only
    `<entity id>:row-<n>`. Both forms worked.

## PNG files opened

All under `/tmp/claude-0/-home-user-zukai-kobo/d18c1f21-fd55-4bdd-a991-536a40188c82/scratchpad/r2-b/`:

- `c1-drawio.png` (canvas page of the combined draw.io file), `c1-md-d2.png` (second block of
  the combined Markdown file). `c1-md-d1.png`, `c1-md-d3.png` and `c1-md-d4.png` were
  rendered but not opened.
- `c6-flow-lr.png`, `c6-flow-tb.png`, `c6-er-tb.png`, `c6-er-lr.png`, `c6-class.png`,
  `c6-class-big.png`, `c6-seq.png`, `c6-arch.png`, `c6-act.png`.
- `c6-class-crop.png`, `c6-seq-crop.png`, `c7-ja-crop.png`: enlarged crops made with PIL from
  the previews, to confirm findings 2, 3 and 4.
- `c7-vi.png`, `c7-ja.png`.

## Not done

Nothing was skipped. The FigJam board itself was not made, as instructed; only the `figjam`
text was emitted.
