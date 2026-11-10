---
name: it-diagrams
description: Produce IT diagrams (sequence, flowchart, state, ER, class, architecture) from clarified requirements, an existing codebase or a raw idea. Writes a validated JSON diagram model (IR) first, then emits Mermaid, draw.io (.drawio, editable shapes) or FigJam (via the Figma MCP server) with deterministic scripts; never hand-writes diagram syntax. Use for "draw the login sequence", "diagram this service", "architecture of the order flow", "ER diagram from these entities", or any request to visualise a system, process or data model.
---

# it-diagrams

Turn a request into a diagram through one fixed contract: choose a mode, build a JSON IR,
validate it, then emit the target. The model writes IR only. Mermaid text, draw.io XML and
FigJam boards come from the bundled CLI, which validates, checks the feature matrix, scans for
secrets and emits deterministically.

## Locate the skill directory

Every CLI call needs `<skill-dir>`, the directory that contains this `SKILL.md`. The working
directory is the user's project, never the skill folder, so always use the absolute path.
Claude Code substitutes it here: `${CLAUDE_SKILL_DIR}`. If that line shows a literal variable
name, you are in another runtime: use the path where you read this file (for Codex,
`<project>/.agents/skills/it-diagrams` or `~/.agents/skills/it-diagrams`).

```bash
node "<skill-dir>/scripts/bin/cli.mjs" validate <ir.json>
node "<skill-dir>/scripts/bin/cli.mjs" emit --to <mermaid|drawio|figjam> <ir.json> [--out <file>]
```

Node 22.13 or newer is required; the CLI has no other dependency and never touches the network.

## Arguments and modes

The invocation arguments select the mode and target. Claude Code appends them as
`ARGUMENTS: <text>`; in other runtimes read them from the user's request.

- First word is the mode: `clarify`, `scout` or `brainstorm`.
- `--to <target>` picks `drawio` (default: editable file, the form PMs review), `mermaid`
  (text for Markdown) or `figjam`.
- `--kind <kind>` fixes the diagram kind (see the next section); without it the kind is
  always asked, never guessed.
- `--scope overview|detailed` fixes the level of detail (see the next section); without it
  the scope is asked together with the kind.
- `--audience technical|business|both` sets who reads the diagram (`meta.audience`). Without
  it the audience is asked in the opening call (see the next section); the question is
  skipped only when the flag is given or the request states the reader in so many words
  ("for the PM", "for the client", "for developers"), and in that case the report says which
  audience was used and why. `references/variants.md` says what a business view removes and
  keeps, and how to produce a language variant (`relabel` for draw.io) of an existing run.
- No mode given: ask "Which input do you have: requirements to clarify, code to scout, or a
  raw idea to brainstorm?" as one more part of the opening call described in the next
  section (mode, kind, scope and view, at most four questions in one `AskUserQuestion`
  call, else one text message). Nothing else is asked before the user answers.

| Mode | When | Protocol |
|---|---|---|
| `clarify` | The user describes a business flow, feature or process in prose and the details are not yet unambiguous | `references/clarify-protocol.md` |
| `scout` | The diagram must reflect existing source code in the working directory | `references/scout-protocol.md` |
| `brainstorm` | The user has a raw idea and does not yet know which diagrams would help | `references/brainstorm-protocol.md` |

Read the protocol file for the chosen mode before doing anything else. `clarify` runs in the
main session because it asks the user questions. `scout` and `brainstorm` are read-only and
may run in a subagent when the runtime offers one; the subagent returns the IR JSON inline and
the main session writes the file and runs the CLI. Whatever the mode, the closing contract
below runs in full: write, validate, emit, bundle, review until it passes, then report.

## Diagram kinds: always ask first

Before reading a protocol or any code, ask the user which kind they want, unless `--kind`
was given or the request names a kind verbatim ("sequence diagram", "ER diagram",
"swimlane"). In `brainstorm` mode skip this question: the brainstorm protocol proposes kinds
as candidates instead.

Every question, option label and option description of the opening call is written in the
user's language; the English keyword that maps to the flag stays in parentheses after the
label (`Trình tự (sequence)`, `Tổng quan (overview)`), so the user reads words they use and
the answer still selects the value. A label alone, such as a bare `business`, is never
shown: each option says what choosing it does.

Ask the scope in the same call. Both scopes start from one main diagram of the whole
feature, and they differ in how sub-flows are handled:

- `overview` (suggested by default): the main diagram only, about 15 elements, each sub-flow
  collapsed into one step. Emphasis replaces sub-diagrams: when a sub-flow holds a decisive
  rule (a check that rejects, a branch that changes the outcome), lift that rule into the main
  diagram as its own decision or step so the reader sees it without opening anything else.
- `detailed`: the main diagram `<slug>` plus one sub-diagram `<slug>-NN-<part>` per sub-flow
  worth its own picture. The main diagram stays readable (about 15 to 20 elements); each
  collapsed element carries `ref: "<slug>-NN-<part>"`. Every kind has one element for it: a
  flowchart node or an activity action (drawn as a subroutine), a sequence message (the call
  whose inside the part shows), a state, an architecture component, a class, an ER entity.
  In the combined file that element shows the sub-diagram's title as a second label line
  and, in draw.io, links to its page. Never tie a part to the main diagram any other way: no
  part id in a label, no note. Each sub-diagram's title names the element it details. Report
  the main diagram first, then its parts.

Never produce parts without a main diagram, and never split under `overview`.

Ask the view in the same call too, unless `--audience` was given or the request names the
reader. What is chosen is the view of the diagram (whether technical names stay), so the
question asks for that, not for the reader's name. Question "Which view?" (in Vietnamese
"Góc nhìn của diagram?"), options, each with the consequence in its description:

- `technical` (suggested by default), label in the user's language such as "Kỹ thuật
  (technical)": for developers and reviewers; keeps component, endpoint and data names.
- `business`, such as "Nghiệp vụ (business)": for a PM, a client or operations; only the
  flow and the business rules, no technical names, by `references/variants.md`. Suggest this
  one instead when the request mentions such a reader without stating it as the audience.
- `both`, such as "Cả hai (both)": one technical IR and one `<slug>-business.ir.json` per
  diagram in the same run folder, derived as `variants.md` describes; the report lists them
  as two views of the same subject.

When the runtime offers the `AskUserQuestion` tool (Claude Code does), use it, once, with
the mode question (only if the mode is missing; options `clarify`, `scout`, `brainstorm`
with the descriptions from the mode table), the kind question, the scope question (options
`overview (suggested)` and `detailed`, with the descriptions above) and the audience
question in the same call; that is at most four questions, the tool's limit. The tool
allows four options per question, so the kind question offers the three kinds that fit the
request best, best fit first and labelled "(suggested)", each with its one-line description
below; its question text names the other kinds and says to pick "Other" and type one of
them. In `brainstorm` mode the kind question is skipped and the audience answer fills the
audience slot of the brainstorm protocol, which then does not ask again. Without that tool,
send one text message with the full numbered list below, mark the suggestion, add the scope
and audience as numbered items, and accept a number, a name or "default".

| # | Kind | One-line description for the user | Best target |
|---|---|---|---|
| 1 | `sequence` | Who calls whom, in what order, with replies and failure branches | mermaid, drawio |
| 2 | `flowchart` | Steps and decisions of one process from start to end | mermaid, drawio |
| 3 | `activity` | Swimlanes per actor or system showing who does each step, hand-offs and parallel work | drawio |
| 4 | `state` | The statuses one thing can be in and the events that move it between them | mermaid, drawio |
| 5 | `er` | Data entities, their key attributes and one-to-many relations | mermaid, drawio |
| 6 | `class` | Types, interfaces, their members and inheritance or composition | mermaid, drawio |
| 7 | `architecture` | Deployable components, data stores, queues, external systems and the connections between them; with AWS service icons and VPC or subnet frames in draw.io when the system runs on AWS | mermaid, drawio |

Example for a login feature with `AskUserQuestion`, no mode given, user writing
Vietnamese: question "Bạn có đầu vào nào?", options "Làm rõ yêu cầu (clarify)", "Đọc code
(scout)", "Ý tưởng thô (brainstorm)", each with the mode table's description translated;
question "Loại diagram? Loại khác: state, er, class, architecture (chọn Other và gõ tên)",
options "Trình tự (sequence) – gợi ý", "Lưu đồ (flowchart)", "Swimlane (activity)", each
with its description translated; question "Mức chi tiết?", options "Tổng quan (overview) –
gợi ý" and "Chi tiết (detailed)"; question "Góc nhìn của diagram?", options "Kỹ thuật
(technical) – gợi ý: developer, reviewer; giữ tên component, endpoint, bảng dữ liệu",
"Nghiệp vụ (business): PM, khách hàng, vận hành; chỉ luồng và quy tắc nghiệp vụ", "Cả hai
(both): một bản mỗi loại trong cùng thư mục". One call, then continue with the answers; do
not re-ask when the user already answered.

The IR fields for each kind, with one complete example per kind, are in
`references/ir-reference.md`. Read it before writing IR.

AWS icons. When an `architecture` diagram shows a system that runs on AWS and the target is
`drawio`, draw it as an AWS architecture diagram: read `references/aws-icons.md`, set `icon`
on each component that is an AWS service (`"icon": "aws:lambda"`) and `group` on each
boundary that is an AWS construct (`"group": "aws:vpc"`). Copy the value from that file and
never write one from memory: the names are draw.io's, not the service abbreviations
(`aws:identity_and_access_management`, not `aws:iam`), and an unknown name fails validation
with the nearest names as a hint. A component with no matching icon (the customer's own
system, a third party) keeps its generic shape, and `kind` stays on every component: it is
what Mermaid and FigJam draw, with a warning that the icons were lost. Either
direction works: a frame title steps aside when a connection enters its frame from above.
Skip the icons when the user asks for a vendor-neutral picture.

## Targets

| Target | Output | Condition | Reference |
|---|---|---|---|
| `drawio` | `.drawio` file with editable shapes, laid out automatically (default) | always available | `references/target-drawio.md` |
| `mermaid` | Mermaid text to paste into Markdown | always available | `references/target-mermaid.md` |
| `figjam` | New or existing FigJam board | a Figma MCP tool named `generate_diagram` is available in the session; otherwise fall back to `mermaid` and say so | `references/target-figjam.md` |

The feature matrix (`docs/feature-matrix.md` in the repository, data in
`scripts/src/feature-matrix.json`) decides per kind, target and feature whether something is
`supported`, `degraded` (emitted with a warning naming the element and what was lost) or
`unsupported` (the emit fails for that target). Never approximate silently: print every
warning the CLI returns to the user, verbatim.

## Closing contract (every mode ends here, with no shortcut)

Every run writes into one folder of the user's project, `diagrams/<yyyymmdd>_<run-slug>/`,
where the date is today and `<run-slug>` is a short English kebab-case name of the feature
(`login-by-staff`). A re-emit later in the same conversation reuses the folder. Inside:

| Path | Content |
|---|---|
| `source/<slug>.ir.json` | one IR per diagram (the main diagram first, then its parts); with audience `both`, `<slug>-business.ir.json` next to each technical IR |
| `<run-slug>.drawio` | the whole run as one draw.io file, one named page per diagram (target `drawio`) |
| `<run-slug>.md` | the whole run as one Markdown file, one heading and block per diagram (target `mermaid`) |
| `drawio/<slug>.drawio` | each diagram on its own, for reuse (target `drawio`) |
| `mermaid/<slug>.mmd` | each diagram on its own (target `mermaid`) |

Only the folders of the targets actually emitted exist; `source/` always does.

1. Write every IR of the run into `source/`. Say where you wrote them.
2. Run `validate` on each. On exit code 2, show the errors verbatim, fix the IR (only the
   listed paths), and validate again. Do not emit until every IR passes.
3. Emit each diagram on its own into `drawio/` or `mermaid/` with `emit --to <target> --out`,
   then build the combined file with
   `bundle --to <target> --out <run-folder>/<run-slug>.<drawio|md> --title "<feature>" source/*.ir.json`
   (main diagram first). For draw.io with more than one diagram add `--canvas all`, so the
   file opens on a page that shows every diagram side by side before the one-per-page
   copies. For `figjam` follow the target reference; it has no bundle.
4. Review gate. Run `node "<skill-dir>/scripts/bin/cli.mjs" preview <file> --max-px 1600`
   on each individual output file; it renders a PNG into the system temp directory when
   draw.io desktop or Playwright is available, exit 1 with a hint otherwise. The cap keeps
   the longest side at 1600 px so the reviewer can open the image; a very tall or wide
   diagram comes back as tiles, all listed under `files` in the JSON output, and the
   reviewer gets every file. The PNG is the reviewer's working copy, never an output for
   the user. Then
   have the diagrams reviewed against `references/review-checklist.md`: in Claude Code spawn
   the `diagram-reviewer` agent with the IR paths, the PNG paths and the CLI warnings; in
   other runtimes read the checklist and review as a separate, explicit step in the
   reviewer's voice. On `FAIL`, apply every `wrong` and `missing-rule` finding by editing
   the IR (never the output file), apply `polish` findings that are plain IR edits, emit,
   bundle and preview again, and review again. Repeat until `PASS` or three rounds; after
   three rounds deliver anyway and list the remaining findings verbatim. A finding that asks
   for something the user chose to leave out is not applied: record the omission in
   `meta.omitted` (with its reason) so the next round does not raise it again. If no
   preview could be rendered, the review runs on the IR and warnings only and says so.
5. Show the user: the run folder, the combined file, the list of diagrams in it, every
   warning verbatim, the review verdict with the number of rounds and any remaining
   findings, the reviewer's own `Images:` line per diagram (opened or not opened; never
   assume it opened them, and when `preview` failed quote its hint, which names where it
   looked for a renderer), the `meta.omitted`
   entries of each diagram as "not shown on purpose", the audience used and why when it was
   not asked (flag or reader named in the request), and a one-line summary per diagram;
   with `both`, list the technical and the business IR of each subject together as two
   views of it. For Mermaid also print each text in a fenced `mermaid` block. In `scout` mode the report describes what the code does and where; it never adds
   open questions, spec doubts, bug suspicions or suggestions about the business logic.
6. Offer the other targets in one line. Do not emit them unless asked.

Rules that hold in every mode:

- Never hand-write Mermaid, draw.io XML or FigJam content. If the CLI cannot express
  something, say what the feature matrix reports and offer another target or a smaller
  diagram.
- Never put credentials, connection strings, tokens or personal data in labels or notes.
  Replace anything that looks like one with a placeholder such as `<db password>`. The CLI
  scans for secrets; treat its warnings as blockers for shared targets.
- Keep ids stable across re-runs so a user can diff IR files: derive them from names
  (`order-service`, `m3`), never from counters alone.
- Labels are what the reader sees. Write them in the user's language. File names, ids and
  the `meta.notes` paths are English ASCII, so the files sort, diff and reference cleanly.
- For draw.io, the CLI reports `layout:` warnings when two labels or a note would still
  overlap after automatic placement. Treat them like any other warning: show them, then offer
  to shorten the label or move the note and emit again.
- One diagram per IR file; the run folder holds all of them and the combined file shows them
  together, so the user never has to open the parts to see the whole.
