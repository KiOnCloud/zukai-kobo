# Install Zukai

One source folder, `skills/draw/`, is distributed two ways, together with the skills that
work on its runs and reports (`skills/revise/`, `skills/recook/`, `skills/sync/`,
`skills/labs/` and `skills/report/`), six skills in all. Pick one channel per
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

The SVG pictures (`--svg`, or `cli.mjs export <file.drawio|file.drawio.svg|run-folder>`) need the same
renderers, and unlike the visual check they are a deliverable, so without a renderer
`export` exits 1, names every place it looked and writes no picture. draw.io desktop is
tried first and Playwright second. Labels are written as SVG text only when Playwright is
installed, because that step needs a browser: with draw.io desktop alone the pictures are
written with HTML labels, which only a browser draws, and the output says so
(`text: "html"` and a warning per file). Install Playwright beside draw.io desktop when the
pictures go into a PDF or a wiki that renders SVG itself.

#### draw.io desktop on Linux without a display

draw.io desktop is an Electron app: it needs a display even to print its version, and run
as root it also needs Chromium's sandbox turned off. On Linux the CLI always adds
`--no-sandbox --disable-gpu` after its own arguments, and when neither `DISPLAY` nor
`WAYLAND_DISPLAY` is set (a server, a container, CI) it starts draw.io under `xvfb-run -a`,
which lends it a virtual display for that one call. So a headless machine needs only the
`xvfb` package beside draw.io (`apt-get install xvfb`); the `.deb` installs draw.io at
`/opt/drawio/drawio`, where the CLI finds it, or put `drawio` on `PATH`. Without `xvfb-run`
the output says that draw.io found no display and what to install, and a `drawio` on
`PATH` that does not start is reported as found but not starting, with the reason. The
`Failed to connect to the bus` lines draw.io prints on such a machine are harmless and are
left out of the messages.

What was verified, with draw.io desktop 26.0.9 (the `.deb` of its release page) on Linux
without a display, as root, through `xvfb-run`:

- The calls the CLI makes are `drawio -x -f png -s <scale> -b 20 -o <out.png> <file>` for
  `preview` and `drawio -x -f svg -b <border> -o <out.svg> <page-file>` for `export` (one
  file per page), each followed by `--no-sandbox --disable-gpu`; `drawio --version` finds the
  app. All of these flags are in `drawio --help` of 26.0.9.
- draw.io exits 0 when an export fails: it prints `Error: Export failed: <file>` and writes
  nothing. The CLI takes only a file that the call itself wrote as a result (`preview`
  deletes the image at its output path first), and reports draw.io's own error line.
- `preview` and `export` with draw.io alone and with Playwright beside it, on a single-page
  file, a run with a canvas page and steps that refer to other pages, a use case diagram,
  and architecture diagrams on AWS and on Google Cloud, with `--page` by id and by name, a
  page that does not exist (exit 1 with the list of pages), an editable picture as input,
  and `preview --max-px` (a wide diagram cut into tiles within the cap). Each picture
  carries exactly its page in `content`, `extract` and `cover` read it back, and the
  pictures and previews were looked at.
- draw.io 26 writes the SVG with `viewBox="-0.5 -0.5 <width> <height>"` and, beside each
  HTML label, a PNG of the label for viewers that cannot draw HTML. With Playwright both are
  replaced by SVG text, which also makes the file five to eight times smaller.

### The labs console

`/zukai:labs` needs nothing to install beyond the skills: its server is part of the CLI
bundle and its pages and fonts are committed under `skills/draw/scripts/bin/labs-ui/`. It
needs a browser on the same machine as the agent session, because the server listens on
`127.0.0.1` only. Over SSH, `labs start` says to forward the port
(`ssh -L <port>:127.0.0.1:<port>`); a forwarded port works. In a cloud session it is
refused with `cloud-session`, since a browser on your device cannot reach the machine the
session runs on; run `/zukai:labs` in a session on your own computer instead.
`--skip-cloud-check` starts it anyway, for a browser on that same cloud machine, and the
skill passes it only when you ask for it in your own words.

The port is derived from the project folder, so it is the same every time; a busy port is
reported, never replaced by the next one. `--port <n>` chooses another for one start, and
`ZUKAI_LABS_PORT` makes the choice lasting. To stop the server, ask `/zukai:labs stop`, or
run `labs stop` from the project root:

```bash
node <skill-dir>/scripts/bin/cli.mjs labs stop
```

It refuses while a job is open, since stopping then ends that job as failed; `--force`
stops it anyway. The server also ends by itself after 30 minutes with nothing to do
(`--idle-minutes <n>` on `labs start` changes that). `labs status` says whether it runs.

The console and the glossary keep their files in `.zukai/` under the project root:
`glossary.json`, the project glossary, which is committed with the project; `.gitignore`,
written with the folder, which keeps the other two out of git; `glossary.lock`, held for
a moment while the glossary is written; and `labs/`, the console's state on this machine
(`server.json` with the port, the process and the console's token, `server.log`, and one
folder per job). An install or an uninstall never touches `.zukai/`.

### Reports and report templates

`/zukai:report` (`/zukai-report` and `$zukai-report` in a copied install) needs nothing
beyond the skills: the Markdown renderer is bundled into the CLI. Its built-in templates live
in the report skill's `templates/` folder; the CLI finds them beside the draw skill in the
plugin, and in a copied install through `zukai-report/.zukai-report-version`, which must
carry the CLI's version, so install the six skills together.

Reports live under `reports/` unless `.zukai/config.json` names another folder,
`{"config": 1, "reportsDir": "docs/reports"}`, under the rules of `runsDir`; the reports
folder and the runs folder never overlap (neither inside the other):

```bash
node <skill-dir>/scripts/bin/cli.mjs reports-dir set docs/reports
node <skill-dir>/scripts/bin/cli.mjs reports-dir
```

A `reportsDir` that cannot be used stops the report commands with `bad-config` and writes
nothing; every run command keeps working. Templates have three scopes: the project's
`.zukai/report-templates/` (committed and shared), yours under the run index's folder
(`<ZUKAI_HOME>/report-templates/`, `~/.zukai/report-templates/` or
`%LOCALAPPDATA%\zukai\report-templates\`; personal, never committed, so keep company
templates in the project scope on a shared machine) and the built-in ones. An uninstall
leaves your templates in place with the index; delete that folder to remove them.

### Where the runs live, and the run index

A project's runs live under `diagrams/` unless `.zukai/config.json` names another folder
inside the project, `{"config": 1, "runsDir": "docs/diagrams"}`. The file is committed, so
every teammate's agent writes into the same folder. Set it with `runs-dir set` from the
project root and read it back with `runs-dir`:

```bash
node <skill-dir>/scripts/bin/cli.mjs runs-dir set docs/diagrams
node <skill-dir>/scripts/bin/cli.mjs runs-dir
```

The folder must stay inside the project: an absolute path, a `..` part, `.zukai/`, `.git/`
or a link that leads out of the project is refused. Runs already under the old folder are
not moved; `runs-dir set` names the old folder and how many runs it holds, so you can move
them yourself (with `git mv`) or leave them. A setting that cannot be used stops every
command that reads runs with `bad-config` and the file to fix, never a quiet fall back to
`diagrams/`.

Each user also has a run index, a list of the projects that hold runs, which
`index list` prints with the runs each one holds now:

```bash
node <skill-dir>/scripts/bin/cli.mjs index list
```

It holds the project folders and when they were last used, nothing of the diagrams, and it
lives outside every project: `~/.zukai/index.json`, or `%LOCALAPPDATA%\zukai\index.json` on
Windows (`ZUKAI_HOME` moves it). The folder is private to the user (0700, the file 0600).
The commands that write runs add their project to it; a project folder that was deleted is
reported as dead and dropped the next time the index is written. The index is a cache: if
it is lost, `index rebuild --scan <folder>` finds the projects up to four levels below that
folder again, and `index forget <folder>` removes one. `ZUKAI_INDEX=off` stops every read and
write of it. An uninstall leaves the index in place; delete `~/.zukai/` (or
`%LOCALAPPDATA%\zukai\`) to remove it.

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
`claude plugin install ...`. After install, `/zukai:draw`, `/zukai:revise`, `/zukai:recook`,
`/zukai:sync` and `/zukai:labs` appear in the skill list.

### Uninstall

```text
/plugin uninstall zukai@zukai
/plugin marketplace remove zukai
```

Stop the labs console first if it runs (`/zukai:labs stop`): a running server holds its
pages in memory and does not end because its folder was removed, only when it is stopped
or idle. Removing the marketplace also uninstalls every plugin installed from it. Both steps leave
`~/.claude/plugins/` as it was before the install: the plugin copy lived under
`cache/zukai/zukai/<version>/`, the marketplace clone under
`marketplaces/zukai/`, and the records in `installed_plugins.json` and
`known_marketplaces.json`. The per-user run index, `~/.zukai/` (or `%LOCALAPPDATA%\zukai\`
on Windows), is left in place; delete that folder to remove it (see "Where the runs live, and
the run index" above).

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
`<project>/.agents/skills/zukai-recook/`, `skills/sync/` to
`<project>/.agents/skills/zukai-sync/` and `skills/labs/` to
`<project>/.agents/skills/zukai-labs/`, changes the `name` line of each copied `SKILL.md`
(`draw` to `zukai`, `revise` to `zukai-revise`, `recook` to `zukai-recook`, `sync` to
`zukai-sync`, `labs` to `zukai-labs`) so it matches the folder, and writes a version file
next to each (`.zukai-version`, `.zukai-revise-version`, `.zukai-recook-version`,
`.zukai-sync-version`, `.zukai-labs-version`). The five belong together: `zukai-revise`,
`zukai-recook`, `zukai-sync` and `zukai-labs` run the CLI of the sibling `zukai/` folder,
`zukai-sync` also reads the draft rules of the sibling `zukai-revise/` folder, and
`zukai-labs` carries out its jobs by following the other four, so a run installs whichever
of them is missing or older and leaves one already at this version alone. It copies into a temporary sibling and moves the
copies into place only when all of them are complete, so an interrupted copy never leaves a
half-copied folder; if a move itself fails (a locked folder on Windows), one skill can end up
updated and another not, and running the installer again finishes the job. It never runs `npm`, never touches the network, and never deletes an existing copy:
a differing one is moved out of the skills folder first, to
`<project>/.agents/zukai-backups/<name>-<timestamp>` (a backup inside `skills/` would still
be a skill named `zukai` and compete with the new one). Backups that an earlier version left
as `<name>.bak-<timestamp>` inside `skills/` are moved there on the next run. The copy holds
what the skills run with (`SKILL.md`, `references/`, `scripts/bin/cli.mjs`, the console's
pages and fonts in `scripts/bin/labs-ui/`, and the feature matrix, about 3 MB); the
sources, tests and fixtures of the CLI stay in the repository.

To update, pull the repository and run the installer again. Exit codes:

| Code | Meaning |
|---|---|
| 0 | Installed, upgraded, or already up to date |
| 1 | Usage or I/O error, or a prerelease version marker that cannot be compared |
| 3 | An installed copy is newer than the source; nothing changed |

In Codex, invoke the skills with `$zukai`, `$zukai-revise`, `$zukai-recook`, `$zukai-sync`,
`$zukai-labs` and `$zukai-report`, or let them route from their descriptions. To uninstall,
stop the console if it runs (`labs stop`, above), then delete the six folders (`zukai/`,
`zukai-revise/`, `zukai-recook/`, `zukai-sync/`, `zukai-labs/` and `zukai-report/`) and
the `zukai-backups/` folder beside `skills/` when you no longer need its copies. Delete all
six together: the others stop at their first step without the CLI of `zukai/`, and the CLI
finds no built-in report template without `zukai-report/`. The run folders under
`diagrams/`, the reports under `reports/` and the `.zukai/` folder belong to the project and
are not touched by an install or an uninstall.

## Claude Code without the plugin (fallback)

If a machine cannot add the marketplace, the same installer copies the six skills into
`.claude/skills/` of a project:

```bash
./zukai-kobo/install.sh --target claude-project --dest /path/to/your-project
```

```powershell
powershell -ExecutionPolicy Bypass -File .\zukai-kobo\install.ps1 -Target claude-project -Dest C:\path\to\your-project
```

Invoke the copies with `/zukai`, `/zukai-revise`, `/zukai-recook`, `/zukai-sync` and
`/zukai-labs`. The script warns that this channel competes with the plugin if both are
present. To uninstall, stop the console if it runs, then delete the same five folders from
`.claude/skills/`, and `.claude/zukai-backups/` when you no longer need its copies.

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
Mermaid comes out as 2.2.2 drew it, except for the drawings listed below: a sequence
diagram with a self-message whose label is too wide to stand centred over its loop, a
class diagram with a general class or an interface, and the start node of a swimlane
diagram in Mermaid.

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
- **`export <file.drawio|file.drawio.svg|run-dir> [--out <dir|file.svg>] [--page <id|name>[,...]]`** writes each page of a draw.io
  file as `<name>.drawio.svg`, an SVG picture with the page's diagram embedded, so a wiki
  shows it and draw.io still opens it. For a run folder the pictures go to
  `svg/<slug>.drawio.svg`, with `svg/canvas.drawio.svg` for the page that shows the
  diagrams side by side. `--page` writes the pictures of the pages named only. Given an
  editable picture, it draws the diagram the picture holds again, by default over the
  picture itself, as `preview` and `extract` read it. The skills take `--svg`. The command
  needs a renderer (see the optional renderer section above).
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
- A class diagram puts the general class above its subclasses and an interface above the
  classes that realise it. A class diagram with either comes out arranged differently when
  it is emitted again, so `/zukai:revise` reports it as changed since delivery before it
  redraws it.
- The start node of a swimlane diagram in Mermaid is a filled circle (`f-circ`), as UML
  draws it; Mermaid drew the circle written before hollow whatever its style said. A
  swimlane diagram emitted again to Mermaid differs in that line, and `extract` reads the
  filled circle back as the start node.
- An architecture connection that runs through the header bar of a plain frame, beside its
  title, is reported as a `layout:` warning on every emit to draw.io. Nothing is refused.
- In the picture of a change, a boundary, a group or a composite state that only gained or
  lost a member is no longer coloured amber: the member that came or went is coloured.
- The description tables: the Condition column says what a block means (`If …`,
  `Otherwise, if …`, `Repeated: …`), and an ordinary state is called 通常 in Japanese and
  Thông thường in Vietnamese.
- `bundle --to doc` prints each `model:` and `detail:` warning once; it printed the
  warnings of the diagrams a second time.
- `sources` and `stale` find the record of a run folder that was renamed or copied under
  another name, where the record keeps the old slug. A folder that holds several records
  and none named after the run exits 1 and names them: keep the one that belongs to the
  run, or delete them and record again.
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
- The scripts for `use_figma` (`--native`, `--overlay`, `extract --figjam-script`) write
  their data over lines of at most 200 characters and check its length and hash before they
  touch the board: a copy that lost or changed a character throws and changes nothing; pass
  the script again from its file.
- A native script that finds two sections holding shapes of its run (a copy made on the
  board) draws into the last, as before, and its result carries a `warning` naming the other.
- On a board drawn by `emit --to figjam --native`, the title of a frame without a header
  strip (an Availability Zone, a GCP frame) now stands at the top of the frame, so such a
  board comes out differently when it is drawn again.
- Maintainers: the catalog generator takes two more files,
  `npm run gen:icons -- <path to Sidebar-AWS4.js> [tag] [path to Sidebar-GCP2.js] [path to mxGCP2.js]`
  (`gen:aws-icons` still works), and writes `gcp-icons.md` beside `aws-icons.md`.
- `cover` now also checks lines: every edge of the source whose two ends are known must be
  joined by a relation of the IR between the elements that carry those texts, or be left out
  in `meta.omitted`. A lost edge makes `cover` exit 2 and is listed under `lostEdges` by its
  ends and label. The keys `units`, `covered` and `missing` are unchanged; `edges` is added.
- `emit --to figjam --native` now prints `calls`, `created` and `bytes`: the number of
  `use_figma` calls, the count each call must return as `created`, and the size of each
  script. The new `bundle --to figjam --native <file.js> <run-folder>` draws the boards of a
  whole run with as few calls as fit, which matters on Figma's Starter plan (about twenty
  MCP calls).
- A native script (`emit --native`, `bundle --to figjam --native`) draws over a section only
  when it drew that section for the same run folder: its shapes are named `zukai-native
  <yyyymmdd>_<run-slug>`. Beside a section of the same title that it did not draw for the
  run (drawn by hand, by `generate_diagram`, or for another run, such as the board a recook
  read) it makes a new section, `<title> (2)` or the next number free, so a recook drawn back
  onto its board never overwrites the source. A board drawn by an earlier version is drawn
  again into a new section; delete the old one by hand.
- `bundle --to figjam --native` prints `created` per diagram, as each script returns it: for
  each script a list with one number per diagram in it (`[[88, 108]]`), no longer one sum.
- `target-figjam.md` section 8 says that `figma-generate-design`, which the Figma server
  makes mandatory before a `use_figma` call that changes the board, is one more call to
  count, and that its design-system workflow does not apply to Zukai's scripts.
- A board drawn by `emit --native` from 2.3.0 on names the group of a line after its own
  label and tags client screens (`[client]`) and the Google Cloud mark (`[part]`). Recook
  reads use case, GCP and multi-cloud boards back completely, boards drawn by earlier
  versions included.
- In the FigJam text of a sequence diagram, a self-message whose label wraps beyond one row
  keeps further empty rows, as a long note does.
- A native or overlay script fits the white back of a label to its text as Figma finally sets it, waiting up to 3 s for a fallback face (Japanese, Chinese, Korean), and recook reads a labelled line of an older board whose back came out narrower than its text as a line, no longer as a box.
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

## Upgrading to 2.3.1

Version 2.3.1 changes one drawing and nothing else: no IR field, command, option, exit
code or file of a run differs from 2.3.0.

- A left-to-right or right-to-left architecture diagram with frames whose main flow ran along
  the bottom edge of a frame, with what stands beside it above (a worker in a cluster beside
  the services the requests pass), is drawn turned over when that brings the flow under the
  headers, through the middle of the frames, with no more crossings or warnings: what stood
  above the flow stands below it, and a system called from there stands below the frames.
  `drift` reports such a file delivered by an older version as moved; emit it again for the
  new drawing. Every other diagram is drawn as before.

## Upgrading to 2.3.2

Version 2.3.2 changes the text of the FigJam target only: no drawing, command, option,
exit code or file of a run differs from 2.3.1. `references/target-figjam.md` now says that
the call count stated before drawing is an upper bound, not a forecast of where a Starter
plan refuses; that after a refusal the agent calls Figma no more, `whoami` included; and that
on a limited plan the diagrams that did not run are emitted again as one
`bundle --to figjam --native` script before going on. Forks that copy that reference should
take the new text.

## Upgrading to 2.3.3

Version 2.3.3 changes the text of the FigJam target only: no drawing, command, option,
exit code or file of a run differs from 2.3.2. When a call limit stops a board midway,
`references/target-figjam.md` now says how to finish a diagram left incomplete: running its
parts that did not run is enough when nothing on the board changed since, and running it
again from part 1 is the safe choice when in doubt. The bundle written to save calls takes
only the diagrams none of whose parts ran, and it goes into the run folder of the first of
them. A Starter plan allows 20 Figma MCP calls a month.

## Upgrading to 2.8.1

Version 2.8.1 fixes three places where a draw.io line met a shape badly. Existing `.ir.json`
files, run folders, CLI commands, options and exit codes keep working unchanged; a draw.io
file emitted again from the same IR can differ as described here, and `drift` reports no
difference between such a file and its IR. ER, architecture, use case, sequence and activity
diagrams, and class diagrams without a relation of a class to itself, are emitted byte for
byte as by 2.8.0.

- **The title of a composite state.** A transition that enters a state inside a composite
  from above (or leaves one through the top, bottom-up) ran through the title of the
  composite. The title now moves along the header to the nearest free stretch, 12 px or
  more from the line and its label, as the title of a flowchart group does: the style of
  the composite gains `align=left;spacingLeft=<px>`. A composite too narrow for its title
  beside the line is widened. A composite whose header no line crosses, and one that a
  transition only ends on, keeps its centred title and its style.
- **Relations into a class with a relation to itself.** Top-down and bottom-up, three or
  more relations into such a class had their outer ends drawn into the corners of the table
  from the side. Every end now lies on the top or bottom of the table with a last stretch
  along the flow; the edge styles of that class gain `entryPerimeter=0` or
  `exitPerimeter=0`. Classes keep their size and the relations stay apart.
- **Lines on the circle of an initial or final state.** Two or more lines on one side of
  the circle each had a jog of a pixel or two where they met it. Each now ends on the
  circle at the column (or the height) it was routed at. Every edge that starts at an
  initial state or ends at a final one gains `exitPerimeter=0` or `entryPerimeter=0`, so
  the file of every state diagram differs by that marker even where the picture is the same.

## Upgrading to 2.8.0

Version 2.8.0 changes how draw.io draws arrows into slanted shapes and many arrows into one
node. Existing `.ir.json` files, run folders, CLI commands, options and exit codes keep
working unchanged; a draw.io file emitted again from the same IR can differ as described
here, and `drift` reports no difference between such a file and its IR.

- **Arrows into a parallelogram or a hexagon.** A line into a flowchart `io` step or an
  architecture `queue` ends on the slanted edge that is drawn, at the height the layout
  routed it at. Before, draw.io moved the end towards the centre of the shape, so an
  arrowhead near a corner pointed along a small jog and a straight line turned slanted.
  The edge style of such an end gains `entryPerimeter=0` or `exitPerimeter=0` and a pixel
  offset.
- **Room between arrowheads (flowchart, state).** Line ends on one side of a node are at
  least 10 px apart. A node with four or more ends on a 40 px side is taller (or wider) than
  before: (ends + 1) x 10 px, and every line end at such a node is written with
  `entryPerimeter=0` or `exitPerimeter=0` and, where its share of the side is not exact to
  three decimals, a pixel offset of a fraction of a pixel. In a top-down or bottom-up
  diagram, a step with a self-loop beside it has the ends on its top and bottom spread over
  the shape itself; before, the outer ones could end at its corners from the side. A node
  whose ends already had the room, on the shape, keeps its size and its anchors.
- **Merged fan-in (flowchart, state).** Five or more lines into one side of a node that
  carry no label and do not lead back to an earlier step are drawn as one line with one
  arrowhead and a junction dot. The model keeps every edge, and `extract`, `drift`, `cover`
  and a FigJam board read back leave the dot out. To keep every arrowhead, set
  `"fanIn": "separate"` at the top of the IR; `"merge"` merges from two lines on. The field
  is optional and only `flowchart` and `state` take it; other kinds reject it as an unknown
  property. Architecture diagrams never merge their connections.
- **Forks that read draw.io files.** A vertex whose style holds `zukaiJunction=1` is a mark
  on the drawing, not an element: skip it as `extract` does.

## Upgrading to 2.7.1

Version 2.7.1 fixes the console and the tests. Existing `.ir.json` files, run folders, report
folders, templates, CLI commands, options and exit codes keep working unchanged.

- **Template import in the console.** A template file that passed the check under
  Reports › Templates, with its Import button, stays on the page when the console reloads
  after the agent wrote a file or when the route changes. Before, the check had to be run
  again.
- **The tests on macOS.** Tests that compare paths under the temporary folder use its real
  path (`/private/var` on macOS), and the `xvfb-run` stand-ins run on Linux only. Nothing
  the CLI prints changed.

## Upgrading to 2.7.0

Version 2.7.0 adds reports: `/zukai:report`, report templates in three scopes, the glossary
held against prose (polish and translation) and the Reports section of the labs console.
Existing `.ir.json` files, run folders, CLI commands, options and exit codes keep working
unchanged.

- **A sixth skill.** `report` (`zukai-report` in a copied install, with
  `.zukai-report-version` and its `templates/` folder). Run the installer again; it adds the
  folder beside the other five.
- **`reportsDir`.** The reports live under `reports/` unless `.zukai/config.json` names
  another folder (`reports-dir set <folder>`). `readProjectConfig` keeps `ok`, `error` and
  `runsDir` for the runs only and adds `reports: { ok, dir, error }`, so a bad `reportsDir`
  stops the report commands only. `runs-dir set` now refuses a runs folder that overlaps the
  reports folder (the one set, else `reports`).
- **A project whose runs folder is `reports/`.** Every run command keeps working. The default
  reports folder would overlap it, so the report commands stop with `bad-config` until
  `reports-dir set <folder>` gives the reports a folder of their own, for example
  `docs/reports`.
- **New commands.** `reports-dir`, `report new|list|revisions|snapshot|restore|diff|render|check|draft|apply|discard`
  and `template list|show|preview|validate|save|export|import`; `labs holds` also takes a
  report folder. `report check` and `report render` exit 2 on a blocking finding, as
  `glossary check` does.
- **The glossary.** `glossary add` refuses a new entry whose avoided word is part of its own
  term in the same language; `glossary list` names an older such entry under `warnings`.
  Label checks of runs are unchanged.
- **The console.** A Reports section and four job kinds (`report-write`, `report-polish`,
  `report-translate`, `report-template`); a report job names its report in `reportName` and
  gets `reportDir`, and `report` stays the agent's closing text. The server writes a report's
  Markdown for a quick edit and a restore only, each after a snapshot. A new page,
  `report-frame.html`, shows a report in a sandboxed frame with a policy of its own.
- **marked.** The Markdown renderer `marked` is bundled into `bin/cli.mjs`; users install
  nothing. It is a pinned development dependency for the build.

## Upgrading to 2.6.0

Version 2.6.0 lets a project keep its runs in a folder of its choice and lists the projects
that hold runs. Existing `.ir.json` files, run folders, CLI commands, options and exit codes
keep working unchanged, and a project without `.zukai/config.json` behaves exactly as 2.5.1
did: its runs stay under `diagrams/`.

- **`runs-dir`.** `cli.mjs runs-dir` prints the project's runs folder and where it came from;
  `runs-dir set <folder>` writes `runsDir` into `.zukai/config.json`, a committed file. Every
  skill resolves the folder once at its start, and the CLI, its hints and the labs console
  follow it. A setting that cannot be used is the new error code `bad-config` (exit 1);
  `labs start` and `labs holds` refuse it, and `labs status` still answers, with
  `configError`, so a running console stays reachable.
- **`index list`, `index rebuild`, `index forget`.** A per-user run index lists the projects
  that hold runs, with the runs each holds now. `bundle`, `snapshot`, `restore`, `sources`,
  `labs start` and `runs-dir` add the project they work in; the index never fails them.
  `ZUKAI_INDEX=off` turns it off; the `index` commands then exit 1 with `index-off`.
- **The console** names the project's runs folder wherever it named `diagrams/`, Copy path
  included, and says on its Overview when the setting cannot be used. A job the agent takes
  carries `runDir`, the absolute path of its run.

What changes for a project you already have:

- Nothing, until `runs-dir set` is run. Changing the folder later moves no run: the old runs
  stay where they are and drop out of the console and the skills until you move them.
- The first command that writes a run creates `~/.zukai/` (or `%LOCALAPPDATA%\zukai\`) with
  `index.json`, which holds the absolute paths of your projects and nothing of their content.
  Set `ZUKAI_INDEX=off` if you do not want it.
- Forks and wrappers: the closing contract now names the run folder `<runs-dir>/...` and
  says how to resolve it; the draw, revise, sync, recook and labs skills run `runs-dir` at
  their start. The tests keep the index in a temporary `ZUKAI_HOME` (`tests/setup-index-home.mjs`,
  through `vitest.config.mjs`), which the installers leave out of a copied install.

## Upgrading to 2.5.1

Version 2.5.1 opens a run's diagram in draw.io from the chat and from the labs console.
Existing `.ir.json` files, run folders, CLI commands, options and exit codes keep working
unchanged, no exit code was added, and a diagram emitted again comes out as 2.5.0 drew it.

- **`open`.** `cli.mjs open <run-folder|file.drawio|file.drawio.svg>` starts draw.io
  desktop when it is found and a display is there, and otherwise opens draw.io on the web
  in the default browser. `--web` skips draw.io desktop, `--desktop` refuses without it,
  and `open --check` says whether and how a file can be opened here and opens nothing. A
  run folder stands for its combined `<run-slug>.drawio`. `cli.mjs help` gives the refusals
  and their codes.
- **The closing question.** Every run of draw, revise, recook and sync that wrote a
  draw.io file ends with "Open it in draw.io?" (closing contract, step 8), asked only where
  `open --check` says it can open and never answered in the user's place; inside a labs job
  it is a card of the console, asked before the job is closed. A FigJam run gives its board
  link, a Mermaid run ends as before.
- **The console** offers Open in draw.io in a run's header, on each `.drawio` row of Files
  and in Picture. It opens a popup: a browser that blocks pop-ups needs them allowed for
  the console's address.

What changes for a project you already have:

- Nothing breaks, and nothing is written into a run. On the web route the diagram is held
  for 24 hours in a page of its own under `zukai-open/` in the system temp folder (the
  folder 0700, the page 0600), removed by the next `open` after that; the page hands the
  diagram to `embed.diagrams.net` by `postMessage`, so diagrams.net receives it and no
  address carries it. Save on the web downloads the file; changing the run with it stays
  your step.
- On Linux, a browser installed as a snap or a flatpak (Ubuntu's Firefox and Chromium) has a
  `/tmp` of its own and shows "file not found" for the page; draw.io desktop, or a default
  browser that is not confined, opens it.
- Forks and wrappers: the closing contract gained step 8, `skills/draw/SKILL.md` the
  `open` line, and the labs skill the closing card before `labs done`. Tests point
  `ZUKAI_DRAWIO_EMBED` at a stand-in of the embed page and `ZUKAI_OPENER` at a stand-in of
  the browser opener; neither is for users.

## Upgrading to 2.5.0

Version 2.5.0 redesigns the pages of the labs console. The server, its API, the job kinds,
the `labs` and `glossary` commands, their options and exit codes are unchanged, and no
skill, IR, run folder or emitted file differs from 2.4.0.

- **Overview** is the console's first page: what needs you (the agent's question, a failed
  job, runs behind their code, glossary suggestions), the ways to start a diagram, and the
  runs and jobs of late. The address with the token now opens it instead of Diagrams.
- **New diagram and recook** show each choice as what it is: the input, the kind (with a
  drawing of it) and the target as tiles, the level of detail and the view as segments,
  the description tables as toggles. "Ask me later" replaces "Let the agent ask" and is
  drawn apart; a summary beside the form says what is set, what the agent will ask and
  whether an agent is attached, and a target that loses part of a kind says so.
- **Jobs** lists every job the server keeps, and each job has a page: its request, its
  question answered full width, the questions already answered, every step, its report,
  and for a failed job why and the undo.
- **A run** shows the source files that changed since it was drawn, the list of its
  diagrams, its history as a timeline with marked changes, its files by folder with a
  preview, and a Glossary tab with its check. Runs are listed as cards or a table, with
  filters by kind and state.
- **Glossary** has three tabs: the entries, a review of the suggestions one by one, and the
  check of a run. Deleting an entry asks first.
- **The agent panel** can be closed; a question of the agent is then announced in the page.
  It shows the agent's state with the command to attach one, the open job's steps, the
  queue and the jobs closed last. The navigation gained a choice of theme.

What changes for a project you already have: nothing. A console started by 2.4.0 keeps
serving the old pages until it stops; `/zukai:labs` replaces a server of another version
unless a job is open, so run `/zukai:labs stop` first if one is. Maintainers: the console's
modules gained `views/overview.mjs`, `jobs.mjs`, `question-card.mjs`, `choice.mjs` and
`glyphs.mjs`, and `nav.mjs` lists four sections; rebuild with `npm run build` after a change
under `src/labs-ui/`.

## Upgrading to 2.4.0

Version 2.4.0 adds a fifth skill, the labs console, and the project glossary. Existing
`.ir.json` files, run folders, CLI commands, options and exit codes keep working unchanged,
no exit code was added, and a diagram emitted again comes out as 2.3.3 drew it.

- **`/zukai:labs`** (`$zukai-labs` and `/zukai-labs` in a copied install) serves a console
  on `127.0.0.1` that lists the runs of the project, shows each one, queues changes as jobs
  for the attached agent session and manages the glossary. The README's section on the
  console says what a job is and what it needs; `skills/labs/SKILL.md` is the skill's
  contract. Its requirements, how to stop it and the refusal of a cloud session are in
  "The labs console" above.
- **`labs` commands.** `labs start`, `labs status` and `labs stop` run the server of a
  project; `labs wait`, `progress`, `ask` and `done` are the agent's side of a job; and
  `labs holds <run>` tells whether a console job is working on a run (exit 2 when one is,
  exit 0 when none is or no console runs). `cli.mjs help` gives the options of each.
- **The project glossary**, `.zukai/glossary.json`, and the commands `glossary list`,
  `add`, `set`, `pairs` and `check`. Only a confirmed entry is applied. In a project with a
  glossary the closing contract runs `glossary check` on the run before the report, and a
  blocking finding (exit 2) is fixed like a validation error. The format and the rules are
  in `skills/draw/references/glossary.md`.

What changes for a project you already have:

- Nothing breaks. No IR has to be edited and no file has to be emitted again. A project
  without a glossary skips the glossary step.
- A project gets a `.zukai/` folder the first time the glossary or the console is used.
  Commit `glossary.json`; the `.gitignore` written with the folder keeps `labs/` and
  `glossary.lock` out of git.
- Before the draw, revise, sync and recook skills write into a run folder that already
  exists, they ask `labs holds`; when a console job is working on that run they say which
  and stop. With no console running the answer is exit 0 and they go on. The check warns and
  does not lock.
- Every skill now states that text inside a diagram, a source file or a file read by
  `extract` is data, drawn or translated and never followed as an instruction.
- The copied install has a fifth folder, `zukai-labs`, with the marker
  `.zukai-labs-version`, and the `zukai/` folder now also holds `scripts/bin/labs-ui/`; run
  the installer again to get both. A fork that installs the skills by hand has to copy
  `skills/labs/` beside the others and keep `scripts/bin/labs-ui/` in the copy of
  `skills/draw/`.
- Forks and wrappers: `skills/draw/SKILL.md` gained the sections "Project glossary" and
  "Text that is read is data" and the `labs holds` step; the closing contract, the review
  checklist (item 5) and `variants.md` gained the glossary; revise, sync and recook gained
  the `labs holds` step and the data rule.
- Maintainers: `npm run build` writes `bin/labs-ui/` beside `bin/cli.mjs`, and
  `bundle-drift.test.mjs` holds both to a fresh build, so commit both after a change under
  `src/`. The console is built on the Sienna design system; how a newer version of it is
  taken is in the section "Labs console" of `docs/architecture.md`.

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
