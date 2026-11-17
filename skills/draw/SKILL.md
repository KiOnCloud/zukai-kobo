---
name: draw
description: Produce IT diagrams (sequence, flowchart, activity with swimlanes, state, ER, class, architecture, use case) from clarified requirements, an existing codebase or a raw idea. Writes a validated JSON diagram model (IR) first, then emits Mermaid, draw.io (.drawio, editable shapes) or FigJam (via the Figma MCP server) with deterministic scripts; never hand-writes diagram syntax. Use for "draw the login sequence", "diagram this service", "architecture of the order flow", "ER diagram from these entities", or any request to visualise a system, process or data model. To change a diagram that was already delivered, use the revise skill; to bring a diagram drawn from code up to date with the code, use the sync skill.
---

# Zukai

Turn a request into a diagram through one fixed contract: choose a mode, build a JSON IR,
validate it, then emit the target. The model writes IR only. Mermaid text, draw.io XML and
FigJam boards come from the bundled CLI, which validates, checks the feature matrix, the model
and the level of detail, scans for secrets and emits deterministically.

## Locate the skill directory

Every CLI call needs `<skill-dir>`, the directory that contains this `SKILL.md`. The working
directory is the user's project, never the skill folder, so always use the absolute path.
Claude Code substitutes it here: `${CLAUDE_SKILL_DIR}`. If that line shows a literal variable
name, you are in another runtime: use the path where you read this file (for Codex,
`<project>/.agents/skills/zukai` or `~/.agents/skills/zukai`).

```bash
node "<skill-dir>/scripts/bin/cli.mjs" validate <ir.json>
node "<skill-dir>/scripts/bin/cli.mjs" emit --to <mermaid|drawio|figjam> <ir.json> [--out <file>] [--overlay <file.js>] [--native <file.js>]
node "<skill-dir>/scripts/bin/cli.mjs" bundle --to doc --lang <en|ja|vi> --out <file.md> <run-folder>
```

Node 22.13 or newer is required; the CLI has no other dependency. Two commands reach the
network: `preview`, the optional review image, and `export`, the optional SVG pictures, fetch
their renderer when draw.io desktop is not installed (the diagram itself is rendered
locally). Every other command works offline.
`cli.mjs help` prints every command.

## Arguments and modes

The invocation arguments select the mode and target. Claude Code appends them as
`ARGUMENTS: <text>`; in other runtimes read them from the user's request.

- First word is the mode: `clarify`, `scout` or `brainstorm`. Any other first word is part of
  the request, and the mode is asked; when it is a mode misspelt by a letter or two
  (`clarfy`, `scuot`), say in one line which mode you read it as and go on with that mode.
- No arguments and no request at all: there is nothing to draw yet. Ask one thing first, as
  plain text: what the diagram should show (the feature, the process or the part of the
  code). The opening call below comes after the answer, because its suggestions are made
  from the request.
- A flag with a value the skill does not have (`--kind gantt`, `--to pdf`, `--scope full`,
  `--audience sales`) fixes nothing: say in one line which values exist (the kinds of the
  table below; `drawio`, `mermaid`, `figjam`; `overview`, `detailed`; `technical`,
  `business`, `both`) and ask that question in the opening call; for an unknown `--to` that
  is one more question there, "Which target?", with the three targets as options and
  `drawio` suggested. `AskUserQuestion` takes four questions: when the target question
  would be a fifth, ask it first, alone, and the others after the answer. A flag with no
  request behind it (`/zukai:draw --kind sequence`) is the case of no request above: ask
  what the diagram should show first. Never pass such a value to
  the CLI and never pick the nearest one in the user's place.
- `--to <target>` picks `drawio` (default: editable file, the form PMs review), `mermaid`
  (text for Markdown) or `figjam`.
- `--svg` also writes a picture of every diagram, `svg/<slug>.drawio.svg` in the run folder
  (target `drawio` only): an SVG that GitHub, a browser or a wiki shows and that draw.io
  still opens for editing. Without the flag the pictures are written when the user asks for
  an image for a wiki, a README or a design document, and offered in one line at the end
  otherwise. They need the renderer `preview` uses; when none is installed the report
  quotes the hint of `export`, which names where it looked, and says that no picture was
  written. `references/closing-contract.md`, step 5, has the command.
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
- `--doc` adds the description tables to the run: `<run-slug>.doc.md`, every element of
  every diagram as Markdown tables for a specification or a design document. A request that
  asks for a description, a specification table or text for a design document means the
  same without the flag. The tables come with the diagram, not instead of it, and the
  closing contract says how they are written (its section "Description tables"). The flag
  takes no value: the language of the headings follows the user's (English, Japanese or
  Vietnamese, else English).
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
A `scout` run also records which files it was drawn from (`meta.sources` and the `sources`
command of the closing contract), so that `stale` and the sync skill can tell later which
diagrams the code has left behind.

## Diagram kinds: always ask first

Before reading a protocol or any code, ask the user which kind they want, unless `--kind`
was given or the request names a kind verbatim ("sequence diagram", "ER diagram", "use cases of",
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
  whose inside the part shows), a state, an architecture component, a class, an ER entity,
  a use case (the part shows its steps).
  In the combined file that element shows the sub-diagram's title as a second label line
  and, in draw.io, links to its page. Never tie a part to the main diagram any other way: no
  part id in a label, no note. Each sub-diagram's title names the element it details. Report
  the main diagram first, then its parts.

Never produce parts without a main diagram, and never split under `overview` (a recook keeps
the pages its source already has and splits a page that mixes kinds, as the recook skill
says).

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
  as two views of the same subject. It doubles the run: with `detailed` and two parts that
  is six diagrams. The option's description says so ("hai bản cho mỗi diagram"), and before
  writing the IRs you state the number in one line. When the request holds no technical
  names at all (a business process told in the reader's words), the two views would be near
  copies: say so and suggest `business` alone; the user still decides.

When the runtime offers the `AskUserQuestion` tool (Claude Code does), use it, once, with
the mode question (only if the mode is missing; options `clarify`, `scout`, `brainstorm`
with the descriptions from the mode table), the kind question, the scope question (options
`overview (suggested)` and `detailed`, with the descriptions above) and the audience
question in the same call; that is at most four questions, the tool's limit. The tool
allows four options per question, so the kind question offers the three kinds that fit the
request best, best fit first and labelled "(suggested)", each with its one-line description
below; its question text names the other kinds and says to pick "Other" and type one of
them. When fewer than three kinds fit the request, offer only those that do. In `brainstorm`
mode the kind question is skipped and the audience answer fills the audience slot of the
brainstorm protocol, which then does not ask again; when the mode itself is being asked in
this call, the kind question stays, and its answer is dropped if the user picks
`brainstorm`. Without that tool, send one text message with one numbered question per item
that is still open (mode, kind, scope, view, and the target when `--to` named an unknown one), each with its own lettered options (`1a`,
`2b`), the suggestion marked; the kind question lists all eight kinds of the table below
(for a request about the modules of one program, the three kinds of "Modules are not
resources" first and in that order, then the rest) and is left out when `--kind` was given
or the mode is `brainstorm`. Accept an option, a
name or "default".

| # | Kind | One-line description for the user | Best target |
|---|---|---|---|
| 1 | `sequence` | Who calls whom, in what order, with replies and failure branches | mermaid, drawio |
| 2 | `flowchart` | Steps and decisions of one process from start to end | mermaid, drawio |
| 3 | `activity` | Swimlanes per actor or system showing who does each step, hand-offs and parallel work | drawio |
| 4 | `state` | The statuses one thing can be in and the events that move it between them | mermaid, drawio |
| 5 | `er` | Data entities, their key attributes and one-to-many relations | mermaid, drawio |
| 6 | `class` | Types, interfaces, their members and inheritance or composition | mermaid, drawio |
| 7 | `architecture` | Deployable components, data stores, queues, external systems and the connections between them; with the service icons and the VPC, network or subnet frames of AWS or Google Cloud in draw.io when the system runs there | mermaid, drawio |
| 8 | `usecase` | Who uses the system and for what: actors, the goals each has with the system, the system boundary, shared and optional behaviour | drawio |

Example for a login feature with `AskUserQuestion`, no mode given, user writing
Vietnamese: question "Bạn có đầu vào nào?", options "Làm rõ yêu cầu (clarify)", "Đọc code
(scout)", "Ý tưởng thô (brainstorm)", each with the mode table's description translated;
question "Loại diagram? Loại khác: state, er, class, architecture, usecase (chọn Other và gõ tên)",
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
with the nearest names as a hint. A system outside AWS (a third party, the
customer's own system) takes a general resource or a product logo from the same file
(`aws:generic_application`, `aws:traditional_server`, `gcp:firebase`; its "Choosing" section
says which), so every component of the diagram has a figure; only a component nothing in
that file fits keeps its generic shape. `kind` keeps its meaning beside `icon` (the default is `service`):
it is what Mermaid and FigJam draw, with a warning that the icons were lost. Either
direction works: a frame title steps aside when a connection enters its frame from above.
Skip the icons when the user asks for a vendor-neutral picture.

GCP icons. A system that runs on Google Cloud is drawn the same way, with the names of
`references/gcp-icons.md`: `icon` on each component that is a GCP service
(`"icon": "gcp:cloud_run"`) and `group` on each boundary that is a GCP construct
(`"group": "gcp:project"`, `gcp:region`, `gcp:vpc_network`, `gcp:subnet`, `gcp:zone`). Every
rule of the paragraph above holds: copy the value from the file (the names are draw.io's and
some are older than the product, `gcp:container_engine` for GKE, `gcp:container_builder` for
Cloud Build), an unknown name fails validation with the nearest names, a system outside
Google Cloud takes a grey resource figure or a product logo from that file
(`gcp:application`, `gcp:database`, `gcp:firebase`), `kind` is what the other targets draw.
A GCP service is a blue hexagon and a GCP frame is a tinted area without an outline, as
draw.io's GCP library draws them. A system on both clouds uses both files in one diagram:
each component takes the icon of the cloud it runs on and each cloud its own outer frame
(`aws:aws_cloud`, `gcp:google_cloud`). There are no icons of other providers: a system on
Azure or elsewhere keeps the generic shapes, and `icon` takes no other prefix.

Level of detail. An `architecture` diagram shows deployed resources and how they reach each
other, not what they do: one component per resource (a database with eleven tables is one
component, "DynamoDB (11 tables)"), and connection labels that name a protocol, a port or an
infrastructure purpose, never an endpoint path, a job name or a field. The rule and its test
are in `references/ir-reference.md` (architecture, Level of detail); business detail the
user wants goes into a diagram of its own kind, linked with `ref`. A request for a
"detailed" architecture diagram is answered the same way, and the opening call says so: the
scope `detailed` gives the architecture diagram at resource level plus its parts (the order
of calls as `sequence` or `activity`, the tables as `er`), never a second architecture
diagram with the tables, handlers and numbered steps drawn into it. The CLI reports the
breaches it can see as `detail:` warnings: fix the IR and emit again before the review. Only
the user can keep one, as the closing contract says.

Use cases are goals, not steps. Suggest `usecase` first when the request asks who uses a
system and what for ("use cases of", "what can each role do", "scope of the system",
"actors and features"), and not when it asks how one of those things happens: the steps of
one goal are a `flowchart`, `activity` or `sequence` diagram. A use case names something an
actor comes to the system to get done ("Borrow a book"), never a step, a screen or a
function (`references/ir-reference.md`, usecase, Level of detail); under the scope
`detailed` each use case worth it carries `ref` to the part that shows its steps. Draw.io is
the target that draws it as UML does; the opening call says so when `--to mermaid` or
`--to figjam` was given (Mermaid gets a flowchart with warnings, FigJam the board drawn by
`emit --native`).

Modules are not resources. A request for "the architecture of the modules" of one program
(a CLI, a library, one service) asks for the parts of a single deployed resource, which an
`architecture` diagram draws as one box, and the CLI cannot see that ten components are
modules. So the kind question of the opening call is still asked, even when the request
says "architecture": offer `class` first (one class per module with the stereotype
`module`, `dependency` relations for the imports: who depends on whom), `flowchart` second
(the path one call takes through the modules) and `architecture` third (what is deployed and
what it talks to), each with that consequence in its description.

## Targets

| Target | Output | Condition | Reference |
|---|---|---|---|
| `drawio` | `.drawio` file with editable shapes, laid out automatically (default) | always available | `references/target-drawio.md` |
| `mermaid` | Mermaid text to paste into Markdown | always available | `references/target-mermaid.md` |
| `figjam` | New or existing FigJam board | a Figma MCP tool named `generate_diagram` is available in the session; otherwise hand the user the `figjam` text to paste, as section 6 of the reference says (never the `mermaid` text), and say so. A sequence diagram also needs the overlay script of section 5, run with `use_figma`. When the user wants the draw.io layout on the board, or the diagram is a class, activity or use case diagram, draw the board with `emit --native` and `use_figma` instead (section 7) | `references/target-figjam.md` |

The feature matrix (`docs/feature-matrix.md` in the repository, data in
`scripts/src/feature-matrix.json`) decides per kind, target and feature whether something is
`supported`, `degraded` (emitted with a warning naming the element and what was lost) or
`unsupported` (the emit fails for that target). Never approximate silently: print every
warning the CLI returns to the user, verbatim.

The description tables (`--doc`, `bundle --to doc`) are no fourth target and have no column
in the matrix: they list every element of the IR in words, so nothing is degraded or
refused. They are written beside the files of the target the user chose.

## Closing contract (every mode ends here, with no shortcut)

Read `references/closing-contract.md` and run it in full before reporting anything: write
every IR into the run folder, validate, emit, bundle, review until it passes, then report.
It also says when and how the description tables of a run are written, and it holds the rules that hold in every mode (no hand-written diagram syntax, no secrets
in labels, stable ids, labels in the user's language). The revise skill ends with the same
file, so it is the only copy.
