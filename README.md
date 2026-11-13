# Zukai

[![CI](https://github.com/KiOnCloud/zukai-kobo/actions/workflows/ci.yml/badge.svg)](https://github.com/KiOnCloud/zukai-kobo/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Software diagrams generated from a validated model, not drawn by hand.**

Zukai (図解, "to explain with a diagram") is an Agent Skill for Claude Code and OpenAI Codex.
It turns requirements, an existing codebase or a raw idea into sequence, flowchart, activity,
state, ER, class and architecture diagrams, and emits them as editable draw.io files, Mermaid
text or FigJam boards.

The agent never writes diagram syntax. It writes one small JSON model per diagram; a bundled
CLI validates that model and emits the output deterministically. A diagram is therefore
either correct against its model or rejected with a list of errors, and the same model
always produces the same file.

## Contents

- [Why Zukai](#why-zukai)
- [Quick start](#quick-start)
- [Usage](#usage)
- [Diagram kinds and targets](#diagram-kinds-and-targets)
- [How it works](#how-it-works)
- [Output](#output)
- [Requirements](#requirements)
- [Other runtimes](#other-runtimes)
- [Documentation](#documentation)
- [Development](#development)
- [Status](#status)
- [License](#license)

## Why Zukai

- **Validated before it is drawn.** Every diagram starts as a JSON intermediate
  representation (IR) checked against a schema and a reference pass: unique ids, existing
  endpoints, no containment cycles, well-nested sequence blocks. Every error comes back with
  its path and a hint.
- **Deterministic output.** Emitters are plain functions from IR to text. The IR is small
  enough to review and to diff, and it is the file you edit when the diagram has to change.
- **Editable results.** The default target is an uncompressed `.drawio` file, laid out
  automatically, in which every shape and connection can still be moved and restyled.
- **Four ways in.** Interview the user (`clarify`), read the code (`scout`), start from
  an idea and choose among proposed diagram sets (`brainstorm`), or rebuild a diagram made in
  draw.io, FigJam or Mermaid (`/zukai:recook`), with a check that no text of it was lost.
- **Nothing approximated silently.** A feature matrix states, per diagram kind, target and
  feature, whether it is supported, degraded with a named warning, or rejected.
- **Two audiences from one subject.** A technical view keeps component, endpoint and data
  names; a business view keeps only the flow and the business rules.
- **Reviewed before delivery.** Each diagram is checked against a review checklist, on a
  rendered image when a renderer is installed, and labels are scanned for credentials on
  every emit.

## Quick start

Requirements: Claude Code, `git`, and Node 22.13 or newer.

```bash
claude plugin marketplace add KiOnCloud/zukai-kobo
```

```bash
claude plugin install zukai@zukai
```

Then open Claude Code in the project the diagram is about:

```text
/zukai:draw scout the login flow
```

Zukai asks one question (diagram kind, scope and view), writes the model, validates it,
emits the files, has them reviewed and reports where they are. The five-minute walkthrough
is in [docs/quickstart.md](docs/quickstart.md); every install option is in
[docs/install.md](docs/install.md).

## Usage

```text
/zukai:draw <clarify|scout|brainstorm> [options] <request>
```

| Mode | Use it when | What happens |
|---|---|---|
| `clarify` | You can describe the process in prose | Zukai interviews you until every required slot of the chosen diagram kind is filled, in at most three rounds |
| `scout` | The diagram must reflect existing code | Zukai reads the codebase and derives the diagram from entry points, call chains, enums, entities or the dependency-injection graph |
| `brainstorm` | You have an idea and do not yet know which diagrams help | Zukai proposes two or three candidate diagram sets, you pick one, then it clarifies |

| Option | Values | Effect |
|---|---|---|
| `--to` | `drawio` (default), `mermaid`, `figjam` | Output target |
| `--kind` | `sequence`, `flowchart`, `activity`, `state`, `er`, `class`, `architecture` | Fixes the diagram kind |
| `--scope` | `overview`, `detailed` | One main diagram, or a main diagram linked to one sub-diagram per sub-flow |
| `--audience` | `technical`, `business`, `both` | Who reads the diagram |

Anything not given as an option is asked once, in a single question, in the user's language.

```text
/zukai:draw clarify order approval process
/zukai:draw scout --kind activity --scope overview the refund flow
/zukai:draw brainstorm --to mermaid a loyalty points feature
```

### Changing a delivered diagram

```text
/zukai:revise [<run-folder>] [--preview|--apply] <request>
```

`revise` changes a run that `draw` already delivered, in this conversation or an earlier
one. It edits the model, never the output, and takes one of four routes:

| Route | When | What happens |
|---|---|---|
| Direct | A clear, local change ("rename Pay to Pay by card", "add a stock check after login") | Asks only what the change leaves open (where it goes, where a failed check leads), saves the previous version, applies the change and runs the usual validate, emit and review |
| Consult | A what-if ("what if approval came before payment?"), a change that removes elements, a change of structure that reaches a sub-diagram or the business view, or `--preview` | Builds two or three drafts under `drafts/` with a change list for each; nothing delivered changes until you pick one, adjust it and confirm |
| New diagram | A diagram the run does not have yet ("add an architecture diagram", "also draw the sequence of the payment step") | Asks what `draw` would ask (kind, scope, view), applies the same diagram rules, then adds it to the run as a linked sub-diagram, a business view or a diagram of its own; detail asked of an architecture diagram becomes linked sub-diagrams, never a second, fuller architecture diagram |
| Undo | "undo", "redo", "go back to r003" | Restores an earlier revision of the whole run; undo and redo walk back and forth along one line of states |

Before overwriting a draw.io file it checks whether you edited it by hand in draw.io. A
label-only change then keeps your layout; any other change asks first and keeps a copy of
your edited file in the revision. That copy is never deleted for you: when its revision is
rotated out, it moves to `history/extras/`.

```text
/zukai:revise add a validation step after the card is entered
/zukai:revise what if the approval moved before payment?
/zukai:revise add an architecture diagram of the services behind this flow
/zukai:revise undo
```

### Recooking a diagram made elsewhere

```text
/zukai:recook <file|figjam-board-link> [--to drawio|mermaid|figjam] [--kind ...] [--scope ...] [--audience ...]
```

`recook` takes a diagram someone drew in draw.io, FigJam or Mermaid and delivers it again as
Zukai diagrams: the same content, Zukai's rules and layout. It never reads the source by eye:

1. `extract` reads the file (`.drawio` compressed or not, every page, `.drawio.svg`,
   `.drawio.png`, `.mmd`, Markdown with Mermaid blocks) or the board (through a read-only
   script for the Figma tool `use_figma`) into facts: nodes, edges and the kind each page
   looks like, with the evidence.
2. The opening question suggests the kind from that evidence; scope and view are asked as in
   `draw`.
3. The IR is written from the facts under Zukai's rules. Labels are copied as written; a page
   that mixes kinds or is too detailed is split into a main diagram and linked parts (the
   tables drawn into an architecture diagram become an `er` part).
4. `cover` checks that every text of the source is in the IR or listed in `meta.omitted`
   with a reason, then the usual validate, emit and review run.

The report lists what was kept, split, merged, left out, added and joined by position. The
source stays where it is; the run keeps only the facts, with any password or personal data
replaced by a placeholder.

```text
/zukai:recook docs/legacy/order-flow.drawio
/zukai:recook https://www.figma.com/board/<key>/Checkout?node-id=12-34 --to drawio
/zukai:recook --scope detailed architecture.md
```

## Diagram kinds and targets

| Kind | Shows |
|---|---|
| `sequence` | Who calls whom, in what order, with replies and failure branches |
| `flowchart` | Steps and decisions of one process from start to end |
| `activity` | Swimlanes per actor or system, with hand-offs, fork and join |
| `state` | The statuses one thing can be in and the events that move it between them |
| `er` | Data entities, their key attributes and relations |
| `class` | Types, interfaces, their members, inheritance and composition |
| `architecture` | Deployable components, data stores, queues, external systems and their connections |

| Target | Output | Notes |
|---|---|---|
| `drawio` | `.drawio` file, uncompressed mxGraph XML | Default. Laid out automatically; every shape and edge stays editable. Architecture diagrams of AWS systems use AWS service icons with VPC, subnet and account frames |
| `mermaid` | Mermaid text | Paste into Markdown or a wiki |
| `figjam` | New or existing FigJam board | Needs the Figma MCP server in the session; without it you get the FigJam text to paste into the board yourself. Block frames, notes, self-messages, participant kinds and activation bars of a sequence diagram are drawn on the board by a second, generated script. `emit --native` writes a script that draws the whole board at the coordinates of the draw.io layout instead, which also covers class and activity diagrams |

draw.io is the target for `activity` diagrams. Mermaid renders them with its beta swimlane
syntax, and FigJam takes them only as the board drawn by `emit --native`. The complete table of what each target supports is
[docs/feature-matrix.md](docs/feature-matrix.md).

## How it works

```text
clarify | scout | brainstorm  ->  IR (JSON)  ->  validate  ->  feature matrix  ->  model and detail  ->  secret scan  ->  emit
```

The IR is the only thing the agent writes. An excerpt of a sequence diagram:

```json
{
  "schemaVersion": 1,
  "kind": "sequence",
  "title": "Login with password",
  "participants": [
    { "id": "web", "label": "Web app", "kind": "participant" },
    { "id": "auth", "label": "Auth service", "kind": "control" }
  ],
  "messages": [
    { "id": "m2", "from": "web", "to": "auth", "label": "POST /login", "kind": "sync" }
  ]
}
```

The bundled CLI then does the rest, and can be run by hand:

```bash
node <skill-dir>/scripts/bin/cli.mjs validate login.ir.json
```

```bash
node <skill-dir>/scripts/bin/cli.mjs emit --to drawio login.ir.json --out login.drawio
```

Before emitting, the CLI consults the feature matrix. For each kind, target and feature a
cell is `supported`, `degraded` (emitted with a warning naming the element and what was lost)
or `unsupported` (the emit fails for that target). The design and the reasoning behind each
layout are in [docs/architecture.md](docs/architecture.md).

## Output

Every run writes into one folder of your project:

```text
diagrams/20261109_login-flow/
  login-flow.drawio          the whole run: one page per diagram
  drawio/<diagram>.drawio    each diagram on its own
  source/<diagram>.ir.json   the model the diagrams were generated from
  source/<run>.facts.json    what a recook read from its source, secrets replaced by placeholders
  history/r001/ ... r005/    the five latest revisions of the whole run (written by revise)
  history/extras/rNNN/       hand-edited files of revisions that were rotated out (kept until you delete them)
  drafts/a/ b/ c/            drafts of a what-if, until one is confirmed or dropped
```

To change a diagram, ask `/zukai:revise`, or edit the `.ir.json` file and emit again. The XML
is an output, not a source.

## Requirements

- Node 22.13 or newer. The CLI is a committed single-file bundle, so using Zukai never
  needs `npm install`. Validating and emitting never touch the network.
- Optional: draw.io desktop or Playwright with Chromium, for the rendered review step.
- Optional: the Figma MCP server, for the FigJam target.

## Other runtimes

The same skill folders run outside the Claude Code plugin. `install.sh` (and `install.ps1`
on Windows) copies all three into a project:

| Runtime | Install | Invoke |
|---|---|---|
| Claude Code plugin | `claude plugin install zukai@zukai` | `/zukai:draw`, `/zukai:revise`, `/zukai:recook` |
| OpenAI Codex | `install.sh --target codex --dest <project>` | `$zukai`, `$zukai-revise`, `$zukai-recook` |
| Claude Code without the plugin | `install.sh --target claude-project --dest <project>` | `/zukai`, `/zukai-revise`, `/zukai-recook` |

Use one channel per machine. Details, uninstall, update and private-fork credentials are in
[docs/install.md](docs/install.md).

Zukai was published as `it-diagrams` up to version 1.0.0. Existing `.ir.json` files keep
working; see [Upgrading from it-diagrams](docs/install.md#upgrading-from-it-diagrams).

## Documentation

| Document | Content |
|---|---|
| [docs/quickstart.md](docs/quickstart.md) | From nothing to a reviewed draw.io diagram in five minutes |
| [docs/install.md](docs/install.md) | Every install channel, updates, uninstall, credentials |
| [docs/architecture.md](docs/architecture.md) | Pipeline, layout engines, extension rule, testing strategy |
| [docs/feature-matrix.md](docs/feature-matrix.md) | What each target supports for each diagram kind |
| [skills/draw/SKILL.md](skills/draw/SKILL.md) | The draw skill's own contract, as the agent reads it |
| [skills/revise/SKILL.md](skills/revise/SKILL.md) | The revise skill's own contract, as the agent reads it |
| [skills/recook/SKILL.md](skills/recook/SKILL.md) | The recook skill's own contract, as the agent reads it |

## Development

```bash
cd skills/draw/scripts && npm ci && npm test
```

The CLI bundle in `skills/draw/scripts/bin/` is committed; rebuild it with `npm run build`
after changing anything under `src/`. A test fails when the committed bundle drifts from the
sources.

## Status

Version 2.2.0 is the open beta. Version 2.2.0 added `/zukai:recook` and version 2.0.0 added `/zukai:revise`; forks of the skill should read
[Upgrading to 2.2.0](docs/install.md#upgrading-to-220),
[Upgrading to 2.0.0](docs/install.md#upgrading-to-200) and
[Upgrading to 2.0.1](docs/install.md#upgrading-to-201). Every diagram kind and target listed above works and is
covered by tests. Layout is what still changes between releases, so a diagram emitted again
after an update can come out arranged differently.

Report a wrong or ugly diagram at
[github.com/KiOnCloud/zukai-kobo/issues](https://github.com/KiOnCloud/zukai-kobo/issues) and attach the
`.ir.json` file the skill wrote, which is enough to reproduce it.

## License

[MIT](LICENSE). The committed CLI bundle also carries elkjs (EPL-2.0) and ajv (MIT); see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
