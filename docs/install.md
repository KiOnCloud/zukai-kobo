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
/plugin marketplace add KiOnCloud/zukai
/plugin install zukai@zukai
```

On Claude Code 2.1.275 or later the two steps collapse into one:

```text
/plugin install zukai --marketplace KiOnCloud/zukai
```

The same commands work from a shell as `claude plugin marketplace add ...` and
`claude plugin install ...`. After install, `/zukai:draw` appears in the skill
list.

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
the user. Clone this repository once, then copy the skill into the project:

```bash
git clone git@github.com:KiOnCloud/zukai.git
```

```bash
./zukai/install.sh --target codex --dest /path/to/your-project
```

On Windows:

```powershell
powershell -ExecutionPolicy Bypass -File .\zukai\install.ps1 -Target codex -Dest C:\path\to\your-project
```

The installer copies `skills/draw/` to `<project>/.agents/skills/zukai/`, changes the
`name` line of the copied `SKILL.md` from `draw` to `zukai` so it matches the folder, and
writes `.zukai-version` next to `SKILL.md`. It copies into a temporary sibling and
renames it into place, so an interrupted run never leaves a half install. It never runs
`npm`, never touches the network, and never deletes an existing copy: a differing one is
moved to `zukai.bak-<timestamp>` first.

To update, pull the repository and run the installer again. Exit codes:

| Code | Meaning |
|---|---|
| 0 | Installed, upgraded, or already up to date |
| 1 | Usage or I/O error, or a prerelease version marker that cannot be compared |
| 3 | The installed copy is newer than the source; nothing changed |

In Codex, invoke the skill with `$zukai` or let it route from the description.

## Claude Code without the plugin (fallback)

If a machine cannot add the marketplace, the same installer copies the skill into
`.claude/skills/` of a project:

```bash
./zukai/install.sh --target claude-project --dest /path/to/your-project
```

Invoke the copy with `/zukai`. The script warns that this channel competes with the plugin
if both are present.

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
  `it-diagrams.bak-<timestamp>`, so the two do not compete. A folder with that name and no
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
