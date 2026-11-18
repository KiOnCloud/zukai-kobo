# Install Zukai

One source folder, `skills/draw/`, is distributed two ways, together with the three skills
that work on its runs (`skills/revise/`, `skills/recook/` and `skills/sync/`). Pick one channel per
machine: installing both the plugin and a project copy makes two copies of the same skill
compete for routing.

| Channel | Installed as | Invoked with |
|---|---|---|
| Claude Code plugin | plugin `zukai`, skill `draw` | `/zukai:draw` |
| OpenAI Codex folder copy | `.agents/skills/zukai/` | `$zukai` |
| Claude Code folder copy (fallback) | `.claude/skills/zukai/` | `/zukai` |

A folder copy has no plugin namespace in front of it, so the installer names the copy
`zukai` instead of `draw`.

Requirements: Node 22.13 or newer on `PATH`. The emitters are a committed single-file bundle,
so no `npm install` is needed to use the skill. The draw.io desktop app and the Figma MCP
server are optional and detected at run time.

For the FigJam target the session needs the remote Figma MCP server connected by the user
(in Claude Code via the Figma connector or an `mcp` entry for `https://mcp.figma.com/mcp`;
plugins cannot declare MCP servers). Its `generate_diagram` tool creates the board. Without
it the skill emits Mermaid and explains how to paste it into FigJam.

### Optional: a renderer for the visual check

After emitting, the skill renders the result to a temporary PNG and inspects it itself to
catch layout problems before reporting (the image is not kept as an output). That needs one of:

- draw.io desktop, which renders `.drawio` files offline. The CLI looks for `drawio` or
  `draw.io` on `PATH` and then in the default install places: `/Applications/draw.io.app`
  (also under `~/Applications`) on macOS, `Program Files\draw.io` or
  `%LOCALAPPDATA%\Programs\draw.io` on Windows, `/opt/drawio`, `/usr/bin` or `/snap/bin`
  on Linux. Its failure hint lists every place it tried;
- Playwright with Chromium, which renders both `.drawio` (draw.io viewer page) and `.mmd`
  (Mermaid 12) in a local browser:

```bash
npm install -g playwright && npx playwright install chromium
```

  The CLI looks for Playwright in the project, next to itself, and in the global npm root
  (`npm root -g`, whatever prefix npm uses); `NODE_PATH` works too. The failure hint names
  the places it looked.

Without either, the skill skips the visual check and says so. The diagram is always rendered
inside the local browser; only the renderer page or library is fetched from the network.

The SVG pictures (`--svg`, or `cli.mjs export <file.drawio|run-folder>`) need the same
renderers, and unlike the visual check they are a deliverable, so without a renderer
`export` exits 1, names every place it looked and writes no picture. draw.io desktop is
tried first and Playwright second. Labels are written as SVG text only when Playwright is
installed, because that step needs a browser: with draw.io desktop alone the pictures are
written with HTML labels, which only a browser draws, and the output says so
(`text: "html"` and a warning per file). Install Playwright beside draw.io desktop when the
pictures go into a PDF or a wiki that renders SVG itself.

## Claude Code (plugin)

Add the marketplace and install the plugin. The repository is public, so no GitHub account
or credential is needed; only `git` on `PATH`.

```text
/plugin marketplace add KiOnCloud/zukai-kobo
/plugin install zukai@zukai
```

On Claude Code 2.1.275 or later the two steps collapse into one:

```text
/plugin install zukai --marketplace KiOnCloud/zukai-kobo
```

The same commands work from a shell as `claude plugin marketplace add ...` and
`claude plugin install ...`. After install, `/zukai:draw`, `/zukai:revise`, `/zukai:recook`
and `/zukai:sync` appear in the skill list.

### Uninstall

```text
/plugin uninstall zukai@zukai
/plugin marketplace remove zukai
```

Removing the marketplace also uninstalls every plugin installed from it. Both steps leave
`~/.claude/plugins/` as it was before the install: the plugin copy lived under
`cache/zukai/zukai/<version>/`, the marketplace clone under
`marketplaces/zukai/`, and the records in `installed_plugins.json` and
`known_marketplaces.json`.

### Credentials (only for a private fork)

The public repository needs none. A private fork or mirror does: Claude Code runs `git`
with prompts turned off and uses whatever credential the machine already holds. It has no
token of its own.

- HTTPS: run `gh auth login`, then `gh auth setup-git`, so the credential helper stores a
  token. A helper that would need to prompt fails.
- SSH: the key must be loaded in `ssh-agent` and `github.com` must be in `known_hosts`.
  Machines without a GitHub SSH key should set `CLAUDE_CODE_PLUGIN_PREFER_HTTPS=1` so
  installs from inside a session do not try SSH first.

Background auto-update is off until a user enables it under `/plugin` > Marketplaces. When
it is on, the check uses the same stored credential and never prompts. If no stored
credential is available the update fails quietly and the installed copy keeps working; set
`CLAUDE_CODE_PLUGIN_KEEP_MARKETPLACE_ON_FAILURE=1` to skip the re-clone attempt entirely.
Without auto-update, pull a new release with `/plugin marketplace update zukai`.
A `GITHUB_TOKEN` in the environment alone does not authenticate the background check; it
has to flow through a credential helper such as the one `gh auth setup-git` configures.

### Updates

Users receive a new copy only when `version` in `.claude-plugin/plugin.json` changes.
Every release bumps that number; it is the single version for both channels.

## OpenAI Codex (folder copy)

Codex reads skills from `.agents/skills/` in the project and from `~/.agents/skills/` for
the user. Clone this repository once, then copy the skills into the project:

```bash
git clone git@github.com:KiOnCloud/zukai-kobo.git
```

```bash
./zukai-kobo/install.sh --target codex --dest /path/to/your-project
```

On Windows:

```powershell
powershell -ExecutionPolicy Bypass -File .\zukai-kobo\install.ps1 -Target codex -Dest C:\path\to\your-project
```

`install.ps1` runs in Windows PowerShell 5.1 and in PowerShell 7 (`pwsh -File ...`, also on
macOS and Linux). It takes `-Target` and `-Dest` where `install.sh` takes `--target` and
`--dest`, says the same, ends with the same exit codes and leaves the same files, byte for
byte: the copies keep the line feeds of the repository, and the version files and renamed
`SKILL.md` files are written without a byte-order mark. Without `-Dest` the current folder
is the project.

The installer copies `skills/draw/` to `<project>/.agents/skills/zukai/`,
`skills/revise/` to `<project>/.agents/skills/zukai-revise/`, `skills/recook/` to
`<project>/.agents/skills/zukai-recook/` and `skills/sync/` to
`<project>/.agents/skills/zukai-sync/`, changes the `name` line of each copied `SKILL.md`
(`draw` to `zukai`, `revise` to `zukai-revise`, `recook` to `zukai-recook`, `sync` to
`zukai-sync`) so it matches the folder, and writes a version file next to each
(`.zukai-version`, `.zukai-revise-version`, `.zukai-recook-version`,
`.zukai-sync-version`). The four belong together: `zukai-revise`, `zukai-recook` and
`zukai-sync` run the CLI of the sibling `zukai/` folder, and `zukai-sync` also reads the
draft rules of the sibling `zukai-revise/` folder, so a run installs whichever of them is
missing or older and leaves one already at this version alone. It copies into a temporary sibling and moves the
copies into place only when all of them are complete, so an interrupted copy never leaves a
half-copied folder; if a move itself fails (a locked folder on Windows), one skill can end up
updated and another not, and running the installer again finishes the job. It never runs `npm`, never touches the network, and never deletes an existing copy:
a differing one is moved out of the skills folder first, to
`<project>/.agents/zukai-backups/<name>-<timestamp>` (a backup inside `skills/` would still
be a skill named `zukai` and compete with the new one). Backups that an earlier version left
as `<name>.bak-<timestamp>` inside `skills/` are moved there on the next run. The copy holds
what the skills run with (`SKILL.md`, `references/`, `scripts/bin/cli.mjs` and the feature
matrix, about 3 MB); the sources, tests and fixtures of the CLI stay in the repository.

To update, pull the repository and run the installer again. Exit codes:

| Code | Meaning |
|---|---|
| 0 | Installed, upgraded, or already up to date |
| 1 | Usage or I/O error, or a prerelease version marker that cannot be compared |
| 3 | An installed copy is newer than the source; nothing changed |

In Codex, invoke the skills with `$zukai`, `$zukai-revise`, `$zukai-recook` and
`$zukai-sync`, or let them route from their descriptions. To uninstall, delete the four
folders (`zukai/`, `zukai-revise/`, `zukai-recook/` and `zukai-sync/`) and the
`zukai-backups/` folder beside `skills/` when you no longer need its copies. Delete all
four together: `zukai-revise/`, `zukai-recook/` and `zukai-sync/` stop at their first step
without the CLI of `zukai/`. The run folders under `diagrams/` belong to the project and
are not touched by an install or an uninstall.

## Claude Code without the plugin (fallback)

If a machine cannot add the marketplace, the same installer copies the four skills into
`.claude/skills/` of a project:

```bash
./zukai-kobo/install.sh --target claude-project --dest /path/to/your-project
```

```powershell
powershell -ExecutionPolicy Bypass -File .\zukai-kobo\install.ps1 -Target claude-project -Dest C:\path\to\your-project
```

Invoke the copies with `/zukai`, `/zukai-revise`, `/zukai-recook` and `/zukai-sync`. The
script warns that this channel competes with the plugin if both are present. To uninstall,
delete the same four folders from `.claude/skills/`, and `.claude/zukai-backups/` when you
no longer need its copies.

## Upgrading to 2.0.0

Version 2.0.0 adds the revise skill. Existing `.ir.json` files, run folders and CLI commands
keep working unchanged; what changed is the layout of the skill itself, which matters if you
maintain a fork or wrap the skill:

- The closing contract (write, validate, emit, bundle, review, report) moved from
  `skills/draw/SKILL.md` to `skills/draw/references/closing-contract.md`, where both skills
  read it. A fork that edited that section of `SKILL.md` has to move its edits.
- A second skill folder, `skills/revise/`, is installed next to the draw skill on every
  channel (`zukai-revise/` for folder copies). It has no CLI of its own.
- The CLI has five new commands: `diff`, `drift`, `snapshot`, `revisions` and `restore`.
- Run folders may now hold `history/` (the five latest revisions) and, during a what-if,
  `drafts/`. Both are written only by revise.

Plugin users update as usual (see Updates); folder copies run the installer again.

## Upgrading to 2.0.1

Version 2.0.1 fixes revise adding a diagram to a run without the draw skill's rules, which
let an architecture diagram through with tables, handlers and numbered steps drawn into it.
IR files, run folders and CLI commands are unchanged. What you may notice:

- `/zukai:revise` has a fourth route, "new diagram", which asks what `draw` asks (kind,
  scope, view) before it adds a diagram to a run. Detail asked of an architecture diagram
  becomes linked sub-diagrams of another kind.
- An architecture diagram that emitted without warnings may now get `detail:` warnings: for
  database or storage icons without `kind`, for a plain boundary that holds only components
  of one icon, and for connection labels that start with step numbers. The skill no longer
  accepts such a warning on its own: it fixes the model or asks you, and records a kept
  warning in `meta.notes` as `detail accepted: ...`.
- `diff` hints at an added diagram that nothing links to and at a second architecture
  diagram in one run.
- Forks: the changes are in `skills/revise/SKILL.md` (step 4 and the new step 8),
  `skills/draw/references/closing-contract.md` (the `detail:` rule) and
  `skills/draw/references/review-checklist.md` (items 8 and 11).

## Upgrading to 2.0.2

Version 2.0.2 fixes the place of a system outside the AWS frames that one component in the
frames calls and that calls another component in turn (a function calls a partner API, the
partner calls the load balancer). It was drawn at the start of the flow with one connection
running round the whole picture; it now stands in the row along the frames, between the
two. Nothing else changes. A delivered diagram of that shape comes out arranged differently
when it is emitted again, so `/zukai:revise` reports it as changed since delivery before it
redraws it.

A system that one component calls and that calls the same component back still took the
long way in this version when the two were written as two connections; 2.0.3 fixes that.

## Upgrading to 2.0.3

Version 2.0.3 fixes the last case of a connection running round the AWS frames: a system
outside the frames and one component that call each other, written as two connections (an
API calls a partner, the partner calls the API back). The system now stands beside the
frames, level with that component, and the two connections are two straight lines side by
side. In a top-down diagram a system in the row along the frames is now placed by its
figure, not by the box that holds its name, so it may stand a few pixels from where 2.0.2
drew it. A delivered diagram of either shape comes out arranged differently when it is
emitted again, so `/zukai:revise` reports it as changed since delivery before it redraws it.

## Upgrading to 2.0.4

Version 2.0.4 fixes what the end-to-end test of 2.0.3 found (`plans/reports/`). What changes
for a run you already have:

- Page ids in a combined draw.io file are no longer cut at 40 characters. A file written by
  2.0.3 or older is still read as it is; a redraw gives it full ids.
- `emit` and `bundle` refuse a credential they recognise by its form on every target, not
  only for FigJam. Replace the value with a placeholder, or pass `--allow-sensitive` when it
  is not a secret.
- `bundle` takes the run folder and orders the diagrams itself (main diagram first).
- Backups of an older copy go to `zukai-backups/` beside the skills folder, and the copy no
  longer holds the CLI's sources and tests.

## Upgrading to 2.0.5

Version 2.0.5 closes the low findings that the end-to-end test of the 2.0.4 fixes left open.
Nothing changes in how a run is written or read:

- A class self-relation keeps its cardinalities off its own label.
- `relabel` reports a label on a line that became much longer than the one it replaces.
- The branch label of a sequence block no longer covers the frame's border.
- `emit --to mermaid` says when `architecture-beta` will cut the slug of a `ref` inside a word.
- `preview` no longer leaves empty bands around a drawing whose labels reach past its shapes.
- The secret scan quotes nothing of a mail address or telephone number, and the closing
  contract names the placeholder addresses it does not report.

Also new since 2.0.3 and not listed under 2.0.4 above: `validate` and every emit print
`model:` and `size:` warnings; an unknown target and an option without its value exit 1,
not 2; `preview` writes each file to a path of its own; `restore <run> undo|redo` takes one
step along the run's history; hand-edited files of a rotated revision are kept under
`history/extras/` and listed as `keptExtras`.

## Upgrading to 2.1.0

Version 2.1.0 adds two ways to complete a FigJam board. Nothing changes for the other
targets, and `emit --to figjam` without the new options writes the same text as before
except for the points listed last.

- `emit --to figjam <ir.json> --overlay <file.js>` also writes a script for the Figma MCP
  tool `use_figma`. Run after `generate_diagram`, it draws what that tool leaves out of a
  sequence diagram: block frames, notes, messages of a participant to itself, participant
  kinds and activation bars.
- `emit --to figjam <ir.json> --native <file.js>` writes scripts that draw the whole board at
  the coordinates of the draw.io file, for every kind, class and activity diagrams included.
  With `--native` and no `--out` the command prints one JSON line, not the Mermaid text.
- The native board is set in the font Arimo and draws the AWS pictograms from the stencil
  geometry of draw.io, which is now part of the bundle (see `THIRD_PARTY_NOTICES.md`).
- Both scripts stop with a message and change nothing when the board is not the one they
  expect. Neither is checked against Figma on a schedule: before a release, run one sequence
  fixture with `--overlay` and one fixture with `--native` on a real board and look at the
  result, as `skills/draw/references/target-figjam.md` describes.
- The figjam text itself changed where `generate_diagram` was found to drop or reject
  something: a note and the label row of a nested block are written as rows of their own, a
  composite state takes two lines, an ER diagram always states its direction, and an ER type
  with a comma is written without it.

## Upgrading to 2.2.0

Version 2.2.0 adds the recook skill, `/zukai:recook` (`$zukai-recook` and `/zukai-recook` in
a copied install), which rebuilds a diagram made in draw.io, FigJam or Mermaid as Zukai
diagrams. Nothing changes for existing runs and commands.

- `extract <file> --out <facts.json>` reads a `.drawio` file (compressed or not, every page),
  an editable `.drawio.svg` or `.drawio.png`, Mermaid text (`.mmd`, or Markdown with fenced
  blocks) or a board read from FigJam, and writes facts: nodes, edges and kind hints per page.
- `extract --figjam-script <file.js> [--section <name|node-id>] [--from <n>]` writes a script for the
  Figma MCP tool `use_figma` that reads a board without changing it; `extract` then reads the
  JSON it returns. A tool result holds at most 48 000 bytes, so a large board is read in
  parts (`--from` the `next` of the previous part) and `extract` takes every part at once. A
  whole page read without a section gives one facts page per diagram on it.
- `extract --page <id|name>[,...]` keeps only those pages of a source with several.
- Facts never hold a credential or personal data: `extract` replaces each such value with a
  `<redacted ...>` placeholder and lists where under `sensitive`. The skill never copies the
  source into the run folder.
- `cover <facts.json> <run-folder>` exits 2 when a text of the source is in none of the IRs
  and in no `meta.omitted` entry.
- The secret scan now also reports a password or key at the end of a name joined by `_` or
  `.` (`DB_PASSWORD=`, `db.password:`), and the level-of-detail check reports a connection
  labelled with a SQL statement.
- `meta.source` accepts `recook`.
- The copied install has a third folder, `zukai-recook`; run the installer again to get it.
  A fork that installs the skills by hand has to copy `skills/recook/` beside the others.
- Before a release, read one real board with the reader script and compare the facts with
  the board, as for the other FigJam scripts: the script is tested against a stand-in for the
  Figma API only.

## Upgrading to 2.2.1

Version 2.2.1 fixes a label that ran out of its box in draw.io output. A node wraps its label
at 260 px, but a word with no place to break (a call such as
`ngComponentOutlet(ComponentMap[cell.component],`, a qualified name, a URL) stands alone on
its line, and when it was wider than the box it ran past both borders. A sequence note and
the header of a class or ER table spilled the same way, and a table row cut the end of the
word off. Nothing was reported.

A node, a table and a sequence note are now at least as wide as their widest such word
needs, as a decision and a participant header already were; a note moves the lifelines
beside it apart to make the room. Text that can wrap still wraps at the same width, so a
diagram without such a word comes out as before. A delivered diagram that has one comes out
arranged differently when it is emitted again, so `/zukai:revise` reports it as changed
since delivery before it redraws it. Nothing changes in how a run is written or read.

## Upgrading to 2.2.2

Version 2.2.2 finishes what 2.2.1 began: the title of an activity lane and of a composite
state no longer runs out of its header in draw.io output. A lane was as wide as its nodes
needed, at least 220 px, and a composite state as wide as its members, so a title that is
one long word (a class or component name) had nowhere to wrap; in a left-to-right activity
diagram the turned titles of neighbouring lanes were drawn over each other.

A lane and a composite state are now at least as wide as the widest such word of their
title needs; in a left-to-right activity diagram that is the height of the lane. A title of
several words wraps as before, so a diagram without such a title comes out unchanged. A
delivered diagram that has one comes out arranged differently when it is emitted again, so
`/zukai:revise` reports it as changed since delivery before it redraws it. The script of
`emit --to figjam --native` is made from the same layout, so the board follows. Nothing
changes in how a run is written or read.

## Upgrading to 2.3.0

Version 2.3.0 adds a fourth skill, an eighth diagram kind, two outputs beside the targets,
a picture of every change, a fourth source for recook and Google Cloud icons for
architecture diagrams. Existing `.ir.json` files, run
folders and CLI commands keep working unchanged, and a diagram emitted again to draw.io or
Mermaid comes out as 2.2.2 drew it, with one exception: a sequence diagram with a
self-message whose label is too wide to stand centred over its loop (see below).

- **`/zukai:sync`** (`$zukai-sync` and `/zukai-sync` in a copied install) brings a run that
  `scout` drew up to date with the code. The IR has a new optional field, `meta.sources`:
  the files a diagram was read from, as paths from the project root with forward slashes.
  `sources <run-dir> [--root <project>] [--only <id,id,...>]` writes
  `source/<run-slug>.sources.json` with a SHA-256 of each of those files, and
  `stale <run-dir>... [--root <project>]` compares that record with the files and writes
  nothing: exit 0 when no recorded file changed, 2 when one changed or is gone or a diagram
  names sources the record does not hold, 1 when a run has no record. A `scout` run now ends
  by recording its sources; `snapshot` keeps the record with the revision and `restore`
  puts it back.
- **`export <file.drawio|run-dir> [--out <dir|file.svg>] [--page <id|name>[,...]]`** writes each page of a draw.io
  file as `<name>.drawio.svg`, an SVG picture with the page's diagram embedded, so a wiki
  shows it and draw.io still opens it. For a run folder the pictures go to
  `svg/<slug>.drawio.svg`, with `svg/canvas.drawio.svg` for the page that shows the
  diagrams side by side. `--page` writes the pictures of the pages named only. The skills
  take `--svg`. The command needs a renderer (see the optional renderer section above).
- **`preview` takes `--page <id|name>`** for a draw.io file of several pages (a combined
  file, the picture of a change); without it the first page is rendered, as before, and a
  name the file does not have exits 1 with the list of its pages. It also renders an
  editable picture (`.drawio.svg`) from the diagram it carries. Its output gained `page`
  and `pages`.
- **A command refuses an option it does not take** (exit 1, with the options it does
  take). Up to 2.2.2 such an option was read and dropped: `preview --page`, for one, did
  nothing and said nothing. A script that passes a stray option to a command now fails
  there.
- **`emit --to doc <ir.json>` and `bundle --to doc --lang <en|ja|vi> --out <file.md> <run-dir>`**
  write the description tables: every element of a diagram as Markdown tables, for a
  specification or a design document. A run has them as `<run-slug>.doc.md`; the skills
  take `--doc`. They are no target and have no column in the feature matrix. `--lang` sets
  the language of the headings and column headers (default `en`); labels stay as the IR
  has them.
- **`diff <old> <new> --drawio <out.diff.drawio>`** writes a picture of the change beside
  the list: one page per diagram that changed, added elements green, changed or moved ones
  amber, removed ones red with a dashed outline, and a legend. Revise writes it for every
  change of a draw.io run, as `drafts/<a|b|c>/changes.diff.drawio` for each draft of a
  what-if and as `drafts/changes-<rNNN>.diff.drawio` for an applied change; sync writes the
  same file for an applied sync. It is a review aid: the CLI does not write it over another
  draw.io file, and `drift` refuses to read it. A diagram that differs in `meta` fields
  alone gets no page and is listed under `unchanged`.
- **The list of `diff` says what a field was.** Each entry of `changed` gained `values`:
  per changed field, `from` and `to` (one of them left out when the field was not set).
  Every key the list had is still there. A block of a sequence diagram is no longer
  listed as changed because a message was put into it or taken out of it: the message is
  listed, and the frames around it are not coloured in the picture.
- **The kind `usecase`**: actors (a person or an outside system, primary or supporting),
  use cases, system boundaries, and the relations `association`, `include`, `extend` (with
  an optional `condition`) and `generalization`. draw.io draws it as UML does. Mermaid has
  no use case diagram and gets a flowchart form with `degraded` warnings; the FigJam text
  target refuses the kind, and `emit --to figjam --native` draws the board. A use case takes
  `ref`, so the scope `detailed` links it to the part that shows its steps. `validate` and
  every emit warn about a use case no actor reaches and an actor without a use case. The
  actors of a side stand in the order of the IR and the use cases are placed from that
  order too, so one added element does not rearrange the picture.
- **Two more `model:` warnings** on `validate` and on every emit: an `initial` or `final`
  state that carries a label (no target draws it: a terminal status is an ordinary state
  with a transition to an unlabelled `final` state), and a boundary or group without a
  member (it is drawn as an empty frame). Both are warnings; nothing that validated before
  is refused.
- **`/zukai:recook` reads PlantUML**: `.puml`, `.plantuml`, `.pu` and `.iuml` files and
  Markdown with `plantuml` fences. Sequence, class, state, activity (the new syntax),
  component, deployment, use case and ER diagrams are read; any other type (a mind map, a
  Gantt chart, the legacy activity syntax) comes back as a page marked `unsupported` with
  its type and the reason, and no diagram is made from it. An `!include` is not followed
  and is reported in a warning. PlantUML is a source only; such a recook defaults to
  `--to drawio`.
- **Google Cloud in architecture diagrams**: a component takes `icon: "gcp:<name>"` and a
  boundary `group: "gcp:<name>"` (`gcp:project`, `gcp:region`, `gcp:zone`,
  `gcp:vpc_network`, `gcp:subnet`, `gcp:google_cloud`, `gcp:kubernetes_cluster` and
  others), by the same rule as `aws:`. The names are listed in
  `skills/draw/references/gcp-icons.md`; an unknown one fails validation with the nearest
  names, or, for a name people write for a service draw.io names otherwise
  (`gcp:cloud_scheduler`, `gcp:gke`, `gcp:secret_manager`), with the catalog name or the
  statement that draw.io has no stencil for it (the table at the end of that file). A system on both clouds shows both in one diagram. draw.io draws the icons and
  frames; Mermaid and the FigJam text draw the generic shapes, with one `degraded` warning
  per provider; `emit --to figjam --native` draws the GCP stencils on the board. `scout`
  reads Terraform `google_*` resources, Cloud Run and GKE manifests, `gcloud` deploy
  scripts and Google client libraries as evidence of the services.

What changes for a run you already have:

- Nothing breaks. No IR has to be edited and no file has to be emitted again.
- A run scouted before 2.3.0 has no sources record, so `stale` exits 1 for it until one is
  written. Run `/zukai:sync` on it once: it asks whether the diagrams still match the code
  (then it records them as they are) or should be compared with the code now. Its diagrams
  have no `meta.sources` either; `sources` then takes the file paths cited in their
  `meta.notes` that exist under the project root and says so (`fallback`), and a sync
  writes the field.
- A run that was not drawn from code (`clarify`, `brainstorm`, `recook`) has no record and
  needs none: `sources` refuses it and `/zukai:sync` points to `/zukai:revise`. Leave such
  runs out of a CI check.
- A `drafts/` folder counts as an open consult only when it holds `consult.json`, for
  revise and for sync alike. One that holds only `changes-<rNNN>.diff.drawio` files is the
  pictures of earlier changes: the skills leave them where they are when a consult is
  confirmed or dropped, remove the picture of a change that an undo took back, and you can
  delete them at any time. The rules are in one place, the section "The drafts folder" of
  the closing contract.
- A sequence diagram with a self-message whose label is too wide to stand centred over its
  loop is drawn differently: the label starts right of the activation bar instead of
  running under it, and the frames around the message and the gap to the next lifeline are
  as wide as the label needs. `drift` reports a file of such a diagram delivered by an
  older version as moved; emit it again when you want the new drawing. The description
  tables of an architecture diagram list queues under a heading of their own and call a
  bucket storage; they are written again on the next change.
- An architecture diagram whose connections form a circle (a topic that pushes back to the
  service that publishes to it) is laid out with the connection that closes the circle,
  the later one in `connections`, drawn against the flow. A diagram without such a circle
  is drawn as before.
- Revise and sync rebuild every target a run folder holds (draw.io, Mermaid, the FigJam
  files, the pictures, the description tables), not only the one the request named.
- The translated IRs of a language variant live in `source/<lang>/<slug>.ir.json`. A run
  that keeps them as `source/<slug>.<lang>.ir.json` beside the originals has them counted
  as further diagrams by every command that takes the run folder: move them.
- A run that has an `svg/` folder gets its pictures written again on every change by
  revise, asked for or not, so a picture in a wiki never shows the diagram as it was. The
  description tables of a run are written again the same way, in the language their first
  line records.
- Forks and wrappers: the closing contract (`skills/draw/references/closing-contract.md`)
  has a new step 5, the pictures. The report moved from step 5 to step 6 and the offer of
  other targets from step 6 to step 7, and the file gained the sections "Sources of a
  scouted run" and "Description tables". The review checklist gained an item for the use case
  kind (item 12) and a section "Revision" for the picture of a change (items 17 to 19). The
  closing contract also gained the sections "Agents that may not be there" and "The drafts
  folder", which the other texts refer to instead of repeating the rule. A fork that refers to those steps by number has to follow.
- The copied install has a fourth folder, `zukai-sync`, with the marker
  `.zukai-sync-version`; run the installer again to get it. A fork that installs the skills
  by hand has to copy `skills/sync/` beside the others, next to both `zukai/` and
  `zukai-revise/`.
- A `gcp:` name that is not in the catalog is now reported as an unknown GCP icon. The
  product logos (`gcp:firebase` and the like) keep their names, and an AWS diagram with a
  logo is drawn as before.
- On a board drawn by `emit --to figjam --native`, the title of a frame without a header
  strip (an Availability Zone, a GCP frame) now stands at the top of the frame, so such a
  board comes out differently when it is drawn again.
- Maintainers: the catalog generator takes two more files,
  `npm run gen:icons -- <path to Sidebar-AWS4.js> [tag] [path to Sidebar-GCP2.js] [path to mxGCP2.js]`
  (`gen:aws-icons` still works), and writes `gcp-icons.md` beside `aws-icons.md`.
- The committed CLI bundle grew, and its size budget in the tests is now 3 MiB.

To fail a CI job when a committed diagram has fallen behind the code, run `stale` on the
scouted runs. It needs Node, the checkout and nothing else. A GitHub Actions step for a
project that holds a folder copy of the skill:

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: 22
- name: Diagrams are up to date with the code
  run: node .agents/skills/zukai/scripts/bin/cli.mjs stale diagrams/20261109_login-flow
```

The step fails with exit code 2 and prints, per diagram, the files that changed or are
gone; name every scouted run folder in the one call. The answer to a failure is
`/zukai:sync` on that run, which records the sources again once the diagrams match.

## Upgrading from it-diagrams

Zukai was published as `it-diagrams` up to version 1.0.0. The IR format and the CLI did
not change with the name, so existing `.ir.json` files keep working.

- Plugin: remove the old marketplace, which also uninstalls the old plugin, then install
  as described above. The command becomes `/zukai:draw`.

  ```text
  /plugin marketplace remove it-diagrams
  ```

- Folder copy: run the installer again. It installs `zukai/` and moves an
  `it-diagrams/` folder it wrote earlier (recognised by its `.it-diagrams-version` file) to
  `zukai-backups/it-diagrams-<timestamp>` beside the skills folder, so the two do not compete. A folder with that name and no
  version file is left untouched.

## Pre-release checks for maintainers

Run these before tagging a release. CI runs the first two; strict plugin validation runs in
CI only when the Claude Code CLI installs there, otherwise it is a local step.

```bash
cd skills/draw/scripts && npm ci && npm test
```

The tests run `install.ps1` only when PowerShell 7 is on `PATH` as `pwsh` or `ZUKAI_PWSH`
names its executable, and are skipped otherwise; on macOS and Linux they also compare its
result with that of `install.sh` for every case, file by file. The Linux runner of CI has
`pwsh`, so they run there; the Windows job of CI installs both targets with Windows
PowerShell 5.1 and with PowerShell 7 and runs the installed CLI. Locally, run the tests
once with `pwsh` on `PATH` before a release that touches either installer.

```bash
claude plugin validate . --strict
```
