# Zukai

[![CI](https://github.com/KiOnCloud/zukai-kobo/actions/workflows/ci.yml/badge.svg)](https://github.com/KiOnCloud/zukai-kobo/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Software diagrams generated from a validated model, not drawn by hand.**

Zukai (図解, "to explain with a diagram") is an Agent Skill for Claude Code and OpenAI Codex.
It turns requirements, an existing codebase or a raw idea into sequence, flowchart, activity,
state, ER, class, architecture and use case diagrams, and emits them as editable draw.io
files, Mermaid text or FigJam boards. A diagram drawn from code can later be brought up to
date with the code, and a run can also carry SVG pictures and description tables for a wiki
or a design document. Reports (an issue investigation, a tech research, a feature write-up)
are written from templates as Markdown and HTML, held to the project glossary.

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
  draw.io, FigJam, Mermaid or PlantUML (`/zukai:recook`), with a check that no text of it
  was lost.
- **Diagrams that follow the code.** A diagram read from code records the files it was drawn
  from. `/zukai:sync` tells which of them changed and changes the diagram by what the code
  changed, and one CLI command answers the same question in CI.
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
| `--kind` | `sequence`, `flowchart`, `activity`, `state`, `er`, `class`, `architecture`, `usecase` | Fixes the diagram kind |
| `--scope` | `overview`, `detailed` | One main diagram, or a main diagram linked to one sub-diagram per sub-flow |
| `--audience` | `technical`, `business`, `both` | Who reads the diagram |
| `--svg` | no value | Also writes `svg/<diagram>.drawio.svg` for every diagram: a picture that GitHub, a browser or a wiki shows and that draw.io still opens for editing (target `drawio` only; needs a renderer) |
| `--doc` | no value | Also writes `<run>.doc.md`: every element of every diagram as Markdown tables, for a specification or a design document |

Anything not given as an option is asked once, in a single question, in the user's language.

A run that wrote a draw.io file ends with one question, "Open it in draw.io?". On yes, the
agent runs `cli.mjs open <run-folder>`, which starts draw.io desktop when it is installed,
with the run's own file (a save there is a hand edit the next revise reads), and otherwise
opens draw.io on the web in your browser with every page of the file as a tab. On the web
the diagram is handed to draw.io's page (`embed.diagrams.net`) by `postMessage`, never put
in an address, so diagrams.net receives it but your browser history does not; Save
downloads the file, and the run changes only when you put that file in place of the run's
own. On Ubuntu, Firefox and Chromium as snaps cannot read the page `open` writes under
`/tmp`; install draw.io desktop there, or set a browser that is not a snap as the default.
The question is left out where nothing could be opened (a cloud session, a machine
without a display), for a Mermaid run, and for a FigJam run, which gives its board link
instead.

```text
/zukai:draw clarify order approval process
/zukai:draw scout --kind activity --scope overview the refund flow
/zukai:draw brainstorm --to mermaid a loyalty points feature
/zukai:draw clarify --kind usecase --svg --doc what each role does in the library system
```

### Changing a delivered diagram

```text
/zukai:revise [<run-folder>] [--preview|--apply] [--doc] [--svg] <request>
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

For a draw.io run, every change also comes with a picture of the change: a draw.io file of
the new version with one page per diagram that changed, where what was added is green, what
changed or moved is amber and what was removed is drawn again in red with a dashed outline,
and a legend under each page that gives the old value of everything amber. A what-if writes
it into each draft as `drafts/<a|b|c>/changes.diff.drawio`; an applied change writes
`drafts/changes-<rNNN>.diff.drawio`, named after the revision that holds the state before
the change. The picture is a review aid and never part of the delivery. The CLI writes it
on its own too:

```bash
node <skill-dir>/scripts/bin/cli.mjs diff <old.ir.json|old-dir> <new.ir.json|new-dir> --drawio <out.diff.drawio>
```

```text
/zukai:revise add a validation step after the card is entered
/zukai:revise what if the approval moved before payment?
/zukai:revise add an architecture diagram of the services behind this flow
/zukai:revise undo
```

### Recooking a diagram made elsewhere

```text
/zukai:recook <file|figjam-board-link> [--to drawio|mermaid|figjam] [--kind ...] [--scope ...] [--audience ...] [--doc] [--svg]
```

`recook` takes a diagram someone drew in draw.io, FigJam, Mermaid or PlantUML and delivers
it again as Zukai diagrams: the same content, Zukai's rules and layout. It never reads the
source by eye:

1. `extract` reads the file (`.drawio` compressed or not, every page, `.drawio.svg`,
   `.drawio.png`, `.mmd`, PlantUML text as `.puml`, `.plantuml`, `.pu` or `.iuml`, Markdown
   with Mermaid or PlantUML blocks) or the board (through a read-only script for the Figma
   tool `use_figma`) into facts: nodes, edges and the kind each page looks like, with the
   evidence.
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

From PlantUML, `extract` reads sequence, class, state, activity (the new syntax: `start`,
`:action;`, `if ... endif`), component, deployment, use case and ER diagrams. Each
`@startuml ... @enduml` block of a file and each fenced block of a Markdown file is a page.
A diagram type that is not read (a mind map, a Gantt chart, a wireframe, an activity diagram
in the legacy `(*) -->` syntax) is reported as such for its page, with the reason, and is
never guessed from the text. The preprocessor is not run, so an `!include` is not followed
and is reported in a warning. PlantUML is a source only: the run is delivered as draw.io
unless `--to` says otherwise.

```text
/zukai:recook docs/legacy/order-flow.drawio
/zukai:recook https://www.figma.com/board/<key>/Checkout?node-id=12-34 --to drawio
/zukai:recook --scope detailed architecture.md
/zukai:recook docs/design/checkout.puml
```

### Syncing a diagram with the code

```text
/zukai:sync [<run-folder>]
```

A diagram drawn by `scout` shows the code as it was on that day. Every such diagram names
the files it was read from in `meta.sources`, and the run ends by recording a SHA-256 of
each of them in `source/<run>.sources.json`. `sync` starts from that record:

1. `stale` compares the record with the files. When none changed, `sync` says so and writes
   nothing.
2. Otherwise it reads the changed files again with the delivered diagram open and changes
   only what the changed code changes: an element the code still supports keeps its id, its
   label word for word and its place.
3. It shows the change list per diagram, each entry with the file that caused it, and a
   draft of the result under `drafts/`. Nothing delivered changes until you answer "apply".
4. On "apply" it saves a revision, emits and reviews like every other change, and records
   the sources again. `/zukai:revise undo` goes back to the earlier diagrams together with
   their record.

A change in the code that no diagram shows (a refactoring, a comment) only renews the
record. A run that was not drawn from code is refused with a pointer to `/zukai:revise`,
and a change the code does not have is a `revise`, not a `sync`. A run scouted before
version 2.3.0 has no record; `sync` then asks whether to record it as it is or to compare
it with the code now.

The same check runs without an agent, without git and without the network, so one line in
CI tells when a committed diagram has fallen behind the code:

```bash
node <skill-dir>/scripts/bin/cli.mjs stale diagrams/20261109_login-flow
```

It prints one JSON object and exits 0 when no recorded file changed, 2 when one changed or
is gone (listed per diagram), and 1 when the run has no record. Several run folders can be
given in one call.

```text
/zukai:sync
/zukai:sync diagrams/20261109_login-flow
```

### The project glossary

A project can keep its preferred terms per language in `.zukai/glossary.json`, so that one
word comes out the same way in every run and every translation, whoever's agent writes the
labels. An entry holds one term per language (no language is the source of another), the
words to avoid for it, a note and a status: `suggested`, `confirmed` or `rejected`. Only a
confirmed entry is applied. The skills use its term when they write, reword or translate a
label, and every run of a project with a glossary ends with `glossary check`, which blocks
a label that equals an avoided word and a translated label that does not carry the
confirmed term of its language. Recook copies labels as the source writes them and only
reports what the check finds.

Entries come from you, or as suggestions from the agent, which reads the pairs of original
and translated labels in runs that already have a language variant. A suggestion is shown
and never used until you confirm it, in the console or with `glossary set`; a rejected entry
is kept so that it is not suggested again. The file is committed, so a confirmed entry
reaches every teammate's agent: review it as you would review code, and keep the names of
people out of it. The same check runs without an agent:

```bash
node <skill-dir>/scripts/bin/cli.mjs glossary check diagrams/20261109_login-flow
```

It exits 2 on a blocking finding and 1 when the project has no glossary or the file does
not match its schema. The entry format, the five `glossary` commands and when each skill
reads the file are in
[skills/draw/references/glossary.md](skills/draw/references/glossary.md).

### Reports

```text
/zukai:report [write] <kind or template> <subject>
/zukai:report polish <report-folder>
/zukai:report translate <report-folder> <lang>
/zukai:report template new|customise|export|import ...
```

`report` writes a report of any kind from a template: an issue investigation, a tech research,
a feature write-up, or a kind of your own. A report is a folder under the project's reports
folder (`reports/` unless `.zukai/config.json` names another, `reports-dir set <folder>`):
`report.md` (the source), `report.html` (the deliverable, which the browser prints to PDF),
`report.json` (what the report is) and `history/` with its last 20 revisions. The agent
fills the template's sections in your language with the glossary's confirmed terms, asks
only what a section needs and you did not say, and can embed the diagrams and description
tables of the runs you name. Raw HTML in the Markdown is shown as text, links keep only
`http`, `https` or `#` targets, pictures come from the report's `assets/` only, and the HTML
runs no script and fetches nothing.

`polish` holds a report to the glossary: `report check` finds an avoided word (also a Latin
word inside Japanese prose), a term left untranslated, and a term the glossary keeps the
same in two languages that a translation changed; the agent rewrites those sentences into a
draft, shows its diff, and applies it only when you say so and the report has not changed
since. `translate` writes `<lang>/report.md` with the same sections, the target language's
terms first, and kept terms verbatim. The same check runs without an agent:

```bash
node <skill-dir>/scripts/bin/cli.mjs report check reports/20261119_checkout-fails
```

It exits 2 on a blocking finding (a credential, an avoided word, a kept term changed, a
translation whose sections differ). Templates come in three scopes, nearest first: the
project's (`.zukai/report-templates/`, committed), yours (beside the run index, never
committed) and the three built-in ones. You create or customise one through the agent, which
validates it, shows its preview and saves it to the scope you choose; `template export` and
`template import` move one as a single file, and an import is checked in full (HTML that
could run code or fetch anything is refused) before it is saved. The template contract is
in [skills/report/references/templates.md](skills/report/references/templates.md).

### The labs console

```text
/zukai:labs [status|stop]
```

`labs` serves a page on `127.0.0.1` for the project the session runs in. Its **Overview**
says what needs you (the agent's question, a failed job, runs behind their code, glossary
suggestions) and offers the ways to start a diagram. **Diagrams** lists the runs under
the project's runs folder (`diagrams/` by default) as cards or a table and shows each one: the source files that changed since it
was drawn, its diagrams, and their picture, model, description tables, history with what
changed since each revision, files and glossary check. A new diagram is a form of choices
shown as what they are (the input, the kind with a drawing of it, the level of detail, the
view, the outputs); whatever you leave as "Ask me later" the agent asks while the job runs,
and a summary beside the form says which. **Jobs** lists every job, and a job's page holds its
request, its question, the questions already answered, every step, its report and, for a
failed job, why and the undo. **Reports** lists the reports with their findings and shows
each one: its HTML in a sealed frame (by language), its Markdown with a quick edit, its
glossary findings with "Polish with glossary", its history with diffs and a restore, Export
HTML, Export Markdown, Print to PDF and Translate, and a polish draft's diff with Apply and
Discard; New report and Templates (preview, new, customise, export, import) sit beside it. **Glossary** holds the entries, a review of the suggestions
one by one, and the check of a run. An agent panel beside the page shows the agent, its open
job, the queue and the jobs closed last; it can be closed, and a question of the agent is
then announced in the page. The agent gives
the address in the chat, in the form `http://127.0.0.1:<port>/#t=<token>`. The token is the
console's key for that one server: do not paste the address anywhere else. The port is the
same for the project every time.

The console reads the runs and never writes one. Under the reports folder it writes only
a quick edit of a report's Markdown and a restore of one of its revisions, each after a
snapshot and refused while a report job or a polish draft holds the report. Everything that changes a diagram is a
**job**: a new diagram, a change, an undo or a return to an earlier revision, a label edit
made in the console's model editor, a sync, a recook, an export of pictures or tables, and
glossary suggestions drawn from the runs. A job is queued in the console and carried out by
the agent session that ran `/zukai:labs`, with the skill you would call in the chat
(`draw`, `revise`, `sync` or `recook`) and all of its rules. Jobs run one at a time in the
order they were queued; you follow each step in the console, answer its questions there,
and read its report when it closes. A job does only what its kind stands for: a request
that asks for anything else (a shell command, git, a file outside the run) is not carried
out.

Jobs need an attached agent session, and that session has to stay open while you use the
console. Without one the console says "No agent attached" and queued jobs wait. A job whose
session has not been heard from for 15 minutes is shown as silent, and you can mark it
failed. A job that was never closed (the session ended, the server stopped) ends as failed
with its reason and is never taken up again, since nothing shows how far it got; the
console lists the revisions it wrote, and an undo is a job of its own.

One agent session per run is the rule. A second `/zukai:labs` reuses the running server
and is refused while the first session is attached and in contact. A session outside the
console (a `/zukai:revise` in another terminal) asks `labs holds <run>` before it changes a
run and stops when a console job is working on it. That check only warns; it is not a lock,
so do not change one run from two sessions at once.

A run with a draw.io file shows **Open in draw.io** in its header (the whole run), **Open
this diagram in draw.io** above the Picture of a diagram, and an open icon on each `.drawio`
row of Files. Each opens draw.io on the web in a window of its
own and hands it the file, as the chat's `open` does; Save downloads the file. If nothing
opens, allow pop-ups for the console's address.

The console's own words (menus, buttons, states) are English; labels, the questions of a
job and its report are in the language they were written in. `/zukai:labs status` says
whether the console runs and gives its address again, `/zukai:labs stop` stops it, and it
ends by itself after 30 minutes with nothing to do. How a job is routed, how its questions
reach the console and what each error means are in
[skills/labs/SKILL.md](skills/labs/SKILL.md).

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
| `usecase` | Who uses the system and for what: actors, their goals, the system boundary, shared and optional behaviour |

| Target | Output | Notes |
|---|---|---|
| `drawio` | `.drawio` file, uncompressed mxGraph XML | Default. Laid out automatically; every shape and edge stays editable. Architecture diagrams of systems on AWS or Google Cloud use the provider's service icons (`icon: "aws:<name>"`, `icon: "gcp:<name>"`) and its frames (VPC, subnet and account on AWS; project, region, zone, VPC network and subnet on Google Cloud); a system on both clouds shows both in one diagram |
| `mermaid` | Mermaid text | Paste into Markdown or a wiki |
| `figjam` | New or existing FigJam board | Needs the Figma MCP server in the session; without it you get the FigJam text to paste into the board yourself. Block frames, notes, self-messages, participant kinds and activation bars of a sequence diagram are drawn on the board by a second, generated script. `emit --native` writes a script that draws the whole board at the coordinates of the draw.io layout instead, which also covers class, activity and use case diagrams and draws the AWS and Google Cloud icons |

draw.io is the target for `activity` diagrams. Mermaid renders them with its beta swimlane
syntax, and FigJam takes them only as the board drawn by `emit --native`. draw.io is also the
target for `usecase` diagrams, which it draws as UML does (stick figures, ellipses, the
system boundary, `«include»` and `«extend»` arrows). Mermaid has no use case diagram and gets
a flowchart form with a warning that says what was lost; the FigJam text target refuses the
kind, and `emit --native` draws the board. The complete table of what each target supports is
[docs/feature-matrix.md](docs/feature-matrix.md).

### Other outputs

Two outputs stand beside the target of a run, not in its place, and are written only when
asked for:

- **SVG pictures** (`--svg`, or `cli.mjs export <file.drawio|run-folder> [--out <dir|file.svg>]`).
  Each page of the draw.io file becomes `svg/<diagram>.drawio.svg`: an SVG picture with the
  page's diagram embedded, so Markdown shows it as an image and draw.io opens the same file
  for editing. With Playwright installed, labels are written as SVG text, so viewers other
  than a browser show them too. `export` needs one of the renderers of the rendered review step and writes nothing
  without one.
- **Description tables** (`--doc`, or `cli.mjs bundle --to doc --lang <en|ja|vi> --out <file.md> <run-folder>`).
  `<run>.doc.md` lists every element of every diagram as Markdown tables: the numbered steps
  of a sequence, a state by event table, the attributes of each entity, the actors and use
  cases. Headings and column headers are in English, Japanese or Vietnamese; labels stay as
  the model has them. The tables are generated from the model and are not a target, so they
  have no column in the feature matrix: a table leaves nothing out.

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

Every run writes into one folder of your project, under `diagrams/` unless the project
names another runs folder (see "Where the runs live" below):

```text
diagrams/20261109_login-flow/
  login-flow.drawio          the whole run: one page per diagram
  login-flow.doc.md          the description tables of the whole run (only when asked for)
  drawio/<diagram>.drawio    each diagram on its own
  svg/<diagram>.drawio.svg   a picture of each diagram that draw.io still opens (only when asked for)
  source/<diagram>.ir.json   the model the diagrams were generated from
  source/<run>.facts.json    what a recook read from its source, secrets replaced by placeholders
  source/<run>.sources.json  a scouted run: a hash of every source file its diagrams were drawn from
  history/r001/ ... r005/    the five latest revisions of the whole run (written by revise and sync)
  history/extras/rNNN/       hand-edited files of revisions that were rotated out (kept until you delete them)
  drafts/a/ b/ c/            drafts of a what-if or of a sync, until one is confirmed or dropped
  drafts/changes-rNNN.diff.drawio   the picture of an applied change, a review aid
```

To change a diagram, ask `/zukai:revise`, or edit the `.ir.json` file and emit again. The XML
is an output, not a source.

Beside `diagrams/`, the project root gets a `.zukai/` folder once the glossary or the
console is used:

```text
.zukai/
  glossary.json   the project glossary, committed with the project
  .gitignore      written with the folder: keeps labs/ and glossary.lock out of git
  glossary.lock   held for a moment while the glossary is written
  labs/           the console's state on this machine: server.json (port, token, process), server.log, jobs/
```

Commit `glossary.json`. `labs/` belongs to one machine and holds the console's token, which
is why `.zukai/.gitignore` keeps it out of git.

### Where the runs live

To keep the runs somewhere else in the project, say `docs/diagrams/`, set the project's runs
folder once from the project root; it is written to `.zukai/config.json`, which is committed
like the glossary, so every teammate's agent, the CLI and the console use the same folder:

```bash
node <skill-dir>/scripts/bin/cli.mjs runs-dir set docs/diagrams
node <skill-dir>/scripts/bin/cli.mjs runs-dir        # prints the folder and where it came from
```

The folder stays inside the project (no absolute path, no `..`, not `.zukai/` or `.git/`).
Runs already in the old folder are not moved: `runs-dir set` says how many are left there.

To see which diagrams you have across projects, `index list` prints every project the CLI
has written runs in, with its runs folder and its runs, read from disk each time:

```bash
node <skill-dir>/scripts/bin/cli.mjs index list
```

The list is a per-user cache in `~/.zukai/index.json` (`%LOCALAPPDATA%\zukai\` on Windows)
that holds project folders only, never diagram content. `index rebuild --scan <folder>`
rebuilds it, and `ZUKAI_INDEX=off` turns it off ([docs/install.md](docs/install.md#where-the-runs-live-and-the-run-index)).

## Requirements

- Node 22.13 or newer. The CLI is a committed single-file bundle, so using Zukai never
  needs `npm install`. Validating and emitting never touch the network.
- Optional: draw.io desktop or Playwright with Chromium, for the rendered review step and
  for the SVG pictures of `export`, which uses the same renderers. `preview` and `export`
  are the two commands that may reach the network, and only to fetch the renderer.
- Optional: the Figma MCP server, for the FigJam target.
- For the labs console: a browser on the same machine as the agent. The server listens on
  `127.0.0.1` only (over SSH, forward its port), and in a cloud session `/zukai:labs` is
  refused, because a browser on your device cannot reach that machine. The console's pages,
  scripts and fonts come from the server. When a run has no picture under `svg/`, the
  browser fetches draw.io's viewer (and Mermaid, for a Mermaid run) into a sandboxed frame,
  as the renderer of `preview` is fetched, and draws the diagram there. The frame can open
  no connection except to `viewer.diagrams.net`, which serves draw.io's shape files; the
  viewer script that holds the diagram comes from that host, so a diagram you would not send
  there belongs under `svg/` (Export pictures) rather than in the live frame.

## Other runtimes

The same skill folders run outside the Claude Code plugin. `install.sh` (and `install.ps1`
on Windows) copies all five into a project:

| Runtime | Install | Invoke |
|---|---|---|
| Claude Code plugin | `claude plugin install zukai@zukai` | `/zukai:draw`, `/zukai:revise`, `/zukai:recook`, `/zukai:sync`, `/zukai:labs` |
| OpenAI Codex | `install.sh --target codex --dest <project>` | `$zukai`, `$zukai-revise`, `$zukai-recook`, `$zukai-sync`, `$zukai-labs` |
| Claude Code without the plugin | `install.sh --target claude-project --dest <project>` | `/zukai`, `/zukai-revise`, `/zukai-recook`, `/zukai-sync`, `/zukai-labs` |

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
| [skills/sync/SKILL.md](skills/sync/SKILL.md) | The sync skill's own contract, as the agent reads it |
| [skills/labs/SKILL.md](skills/labs/SKILL.md) | The labs skill's own contract: the console, its jobs and its questions |
| [skills/draw/references/glossary.md](skills/draw/references/glossary.md) | The project glossary: entries, commands, and when each skill reads it |
| [skills/report/SKILL.md](skills/report/SKILL.md) | The report skill's own contract: writing, polishing, translating, templates |
| [skills/report/references/templates.md](skills/report/references/templates.md) | The report template contract: sections, layout, scopes, export file |

## Development

```bash
cd skills/draw/scripts && npm ci && npm test
```

The CLI bundle in `skills/draw/scripts/bin/` is committed; rebuild it with `npm run build`
after changing anything under `src/`. A test fails when the committed bundle drifts from the
sources.

## Status

Version 2.7.1 is the open beta; it keeps a template file checked for import in the console
while the page reloads and makes the test suite pass on macOS. Version 2.7.0 added `/zukai:report`, report templates in three scopes,
the glossary on prose (polish and translation) and the Reports section of the console.
Version 2.6.0 added a configurable runs folder and the run index, and version 2.5.0
redesigned the labs console with an overview, a page per job, the choices of a new diagram
shown as what they are and an agent panel that can be closed. Version 2.4.0 added the labs console, `/zukai:labs`, and the project
glossary. Version 2.3.3 says how to finish a FigJam board a call limit stopped
midway, and version 2.3.2 states the FigJam call budget more exactly. Version 2.3.1 drew an architecture whose main flow ran along the bottom of its frames through their
middle. Version 2.3.0 added `/zukai:sync`, the use case kind, the SVG pictures,
the description tables, the picture of a change, the PlantUML reader and Google Cloud icons
for architecture diagrams; version 2.2.0 added
`/zukai:recook` and version 2.0.0 added `/zukai:revise`. Forks of the skill should read
[Upgrading to 2.7.1](docs/install.md#upgrading-to-271),
[Upgrading to 2.7.0](docs/install.md#upgrading-to-270),
[Upgrading to 2.6.0](docs/install.md#upgrading-to-260),
[Upgrading to 2.5.0](docs/install.md#upgrading-to-250),
[Upgrading to 2.4.0](docs/install.md#upgrading-to-240),
[Upgrading to 2.3.3](docs/install.md#upgrading-to-233),
[Upgrading to 2.3.2](docs/install.md#upgrading-to-232),
[Upgrading to 2.3.1](docs/install.md#upgrading-to-231),
[Upgrading to 2.3.0](docs/install.md#upgrading-to-230),
[Upgrading to 2.2.0](docs/install.md#upgrading-to-220),
[Upgrading to 2.0.0](docs/install.md#upgrading-to-200) and
[Upgrading to 2.0.1](docs/install.md#upgrading-to-201). Every diagram kind and target listed above works and is
covered by tests. Layout is what still changes between releases, so a diagram emitted again
after an update can come out arranged differently.

Report a wrong or ugly diagram at
[github.com/KiOnCloud/zukai-kobo/issues](https://github.com/KiOnCloud/zukai-kobo/issues) and attach the
`.ir.json` file the skill wrote, which is enough to reproduce it.

## License

[MIT](LICENSE). The committed CLI bundle also carries elkjs (EPL-2.0), ajv (MIT) and marked (MIT), and the
console's pages carry three font families under the SIL Open Font License 1.1 and the files
of the Sienna design system; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
