# Install Zukai

One source folder, `skills/draw/`, is distributed two ways. Pick one channel per
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
`claude plugin install ...`. After install, `/zukai:draw` and `/zukai:revise` appear in
the skill list.

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
powershell -ExecutionPolicy Bypass -File .\zukai\install.ps1 -Target codex -Dest C:\path\to\your-project
```

The installer copies `skills/draw/` to `<project>/.agents/skills/zukai/` and
`skills/revise/` to `<project>/.agents/skills/zukai-revise/`, changes the `name` line of
each copied `SKILL.md` (`draw` to `zukai`, `revise` to `zukai-revise`) so it matches the
folder, and writes a version file next to each (`.zukai-version`,
`.zukai-revise-version`). The two belong together: `zukai-revise` runs the CLI of the
sibling `zukai/` folder, so a run installs whichever of the two is missing or older and
leaves one already at this version alone. It copies into a temporary sibling and moves the
copies into place only when all of them are complete, so an interrupted copy never leaves a
half-copied folder; if a move itself fails (a locked folder on Windows), one skill can end up
updated and the other not, and running the installer again finishes the job. It never runs `npm`, never touches the network, and never deletes an existing copy:
a differing one is moved out of the skills folder first, to
`<project>/.agents/zukai-backups/<name>-<timestamp>` (a backup inside `skills/` would still
be a skill named `zukai` and compete with the new one). Backups that an earlier version left
as `<name>.bak-<timestamp>` inside `skills/` are moved there on the next run. The copy holds
what the skills run with (`SKILL.md`, `references/`, `scripts/bin/cli.mjs` and the feature
matrix, about 2.3 MB); the sources, tests and fixtures of the CLI stay in the repository.

To update, pull the repository and run the installer again. Exit codes:

| Code | Meaning |
|---|---|
| 0 | Installed, upgraded, or already up to date |
| 1 | Usage or I/O error, or a prerelease version marker that cannot be compared |
| 3 | An installed copy is newer than the source; nothing changed |

In Codex, invoke the skills with `$zukai` and `$zukai-revise`, or let them route from their
descriptions. To uninstall, delete both folders (`zukai/` and `zukai-revise/`) and the
`zukai-backups/` folder beside `skills/` when you no longer need its copies.

## Claude Code without the plugin (fallback)

If a machine cannot add the marketplace, the same installer copies both skills into
`.claude/skills/` of a project:

```bash
./zukai-kobo/install.sh --target claude-project --dest /path/to/your-project
```

Invoke the copies with `/zukai` and `/zukai-revise`. The script warns that this channel
competes with the plugin if both are present.

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

```bash
claude plugin validate . --strict
```
