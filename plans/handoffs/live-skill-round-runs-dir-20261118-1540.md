---
handoff-version: 1
generated: 2026-11-18T15:40:00Z
generator: ak-handoff
focus: "Local session to run the live skill round for the configurable runs folder (2.6.0) on branch claude/upbeat-wright-llans1"
workspace: zukai-kobo (repository root)
branch: claude/upbeat-wright-llans1
head: ed4d30f
---

# HANDOFF: live skill round for the configurable runs folder (2.6.0)

## Mission and current status

Focus: "Local session to run the live skill round for the configurable runs folder (2.6.0) on branch claude/upbeat-wright-llans1"

Outcome: show that the five skills (draw, revise, sync, recook, labs), driven by an agent in
a local Claude Code session, follow a project's runs folder set to `docs/diagrams`. Every run
must be written, found, listed, revised, synced, recooked and shown in the labs console from
that folder. `git status` in the sample project must show changes only under `docs/diagrams/`
and `.zukai/`. This is acceptance criterion 3 of the plan, and the last open item.

Done:
- All four phases of `plans/261118-1455-configurable-runs-dir-and-global-index/` are
  implemented and pushed. Release 2.6.0 is in commit `27fac76`, and the review fixes are in
  `ed4d30f`.
- `vitest` passes: 2170 tests, 41 skipped (no draw.io desktop or PowerShell in the cloud
  container).
- The same flow was run through the CLI in a sample git project, with no agent: bundle,
  sources, snapshot, emit, extract/cover, stale, restore and `labs holds`. It wrote only
  under `docs/diagrams/`.

Remaining:
- The live, agent-driven round below. It must run locally, because `labs start` refuses a
  cloud session.
- A decision from the user: keep or revert `labs status` answering with `configError`
  (see Open risks).
- A PR, only if the user asks for one.

Urgency: not captured in this session.

## Scope and guardrails

Workspace: a local clone of `KiOnCloud/zukai-kobo`, branch `claude/upbeat-wright-llans1`,
plus a throwaway sample project outside the clone.

In scope:
- Running the skills against the sample project and recording what each one wrote.
- Fixing a defect the round finds in skill prose (`skills/*/SKILL.md`,
  `skills/draw/references/*.md`) or in `skills/draw/scripts/src/`, with a test. Then rebuild
  with `npm run build` in `skills/draw/scripts` and commit `bin/` along with the change.

Out of scope:
- New features.
- Moving runs between folders; this is a non-goal of the plan.
- Changing the decisions listed below without the user's approval.

Constraints (from the user and the repository):
- Develop and push on `claude/upbeat-wright-llans1` only.
- Use conventional commits. Put no plan ids, phase numbers or AI references in code, tests or
  commit messages.
- `bin/cli.mjs` and `bin/labs-ui/` are rebuilt and committed with every source change; the
  drift test enforces this.
- Follow `docs/architecture.md`, above all the Extension rule and the Testing strategy.

Safety boundaries:
- No force-push.
- Do not write into the user's real projects. Use the sample project only.
- Point the run index at a temporary folder (`ZUKAI_HOME`) for the round, unless the user
  wants it in their real `~/.zukai`.
- Stop the labs server you started (`labs stop`) before you finish.

## Current state

Branch: `claude/upbeat-wright-llans1`
HEAD: `ed4d30f` (fix: guard run ownership, keep index entries and redraw the console for the runs folder). The commit with this handoff file follows it.
Working tree: clean at capture time, apart from this handoff file.
Changed files: none uncommitted.
Untracked files: none.
Intentional local modifications: no.

Verify with `git fetch origin claude/upbeat-wright-llans1 && git log --oneline -3` before
acting.

## Decisions and rationale

| Decision | Rationale | Alternative rejected | Reference |
|---|---|---|---|
| `runsDir` lives in the committed `.zukai/config.json` and must stay inside the project | Runs are part of the project; the sources record stores a root relative to the run | Plugin install folder (replaced on upgrade); `CLAUDE_PLUGIN_DATA` (missing in Codex and folder-copy installs); a central store (runs leave git) | plan.md, Validation Log Q1 |
| A setting that cannot be used gives `bad-config` (exit 1), never a fall back to `diagrams/` | A silent fallback writes runs into the wrong folder | Fall back with a warning | plan.md Constraints |
| Changing `runsDir` warns and never moves runs | A move is a change the user should make and review | Auto-move | Validation Log Q3 |
| The run index holds roots and lastSeen only, and is a rebuildable cache | It never holds data a run folder does not | Caching run names or titles | phase-02 |
| The index drops only projects whose folder is gone, and never overwrites a newer-version or unreadable index | Review findings 2 and 3 | Prune anything not alive | `plans/reports/code-reviewer-261118-1502-configurable-runs-dir.md` |
| `labs holds` fails closed (`bad-config`) when a setting above the run cannot be read | A "not held" answer could let two sessions change one run | The `diagrams` parent fallback | Review finding 1 |
| `labs status` still answers on a bad setting, with `configError`; `labs start` refuses | A running console and its open job stay reachable | Refuse `status` too | Awaiting user confirmation |
| Each skill runs `runs-dir` once at its start | Draw reads the closing contract only at the end, so the rule had to sit earlier | Resolving only in the closing contract | `skills/draw/SKILL.md`, closing contract |
| Version 2.6.0 | Settled by the user | — | Validation Log Q4 |

## Work performed

- Added `skills/draw/scripts/src/project-config.mjs`, the resolver: `runsPath`,
  `readProjectConfig`, `checkRunsDir`, `projectOfRun`, `setRunsDir`, `runFolderPattern` and
  `runDirAt`.
- Added `skills/draw/scripts/src/run-index.mjs`: register, list, rebuild, forget and scan.
- `src/cli.mjs`: new `runs-dir [set <folder>]` and `index list|rebuild|forget` commands.
  Registration after `bundle`, `snapshot`, `restore`, `sources`, `labs start`, `runs-dir set`,
  and `runs-dir` when the project holds runs. `labs holds` uses `projectOfRun`. `labs start`
  refuses `bad-config`.
- `src/labs-runs.mjs`, `labs-server.mjs` (`/api/state` gains `runsDir` and `configError`; a
  `ConfigError` becomes HTTP 409 `bad-config`), `labs-lifecycle.mjs` (`runsDir` and
  `configError` in `start` and `status`), and `labs-jobs.mjs` (jobs carry `runDir`).
- Console: `src/labs-ui/words.mjs` `runsDirOf`, the views that named `diagrams/`, and
  `main.mjs`, which redraws a view drawn with another runs folder.
- Skill prose: closing contract (the `<runs-dir>` rule), `draw/SKILL.md`, `revise`, `sync`,
  `recook`, `labs/SKILL.md` (`runs-dir` before `labs start`; `runDir` used as the path
  argument), and notes in `target-drawio.md`, `target-mermaid.md` and `ir-reference.md`.
- Tests: `project-config.test.mjs`, `run-index.test.mjs`, `run-index-e2e.test.mjs`. The labs
  runs, server and Playwright e2e suites run over `RUNS_DIRS` = default and `docs/diagrams`.
  `vitest.config.mjs` and `tests/setup-index-home.mjs` give every test a temporary
  `ZUKAI_HOME`. `install.sh` and `install.ps1` leave `vitest.config.mjs` out of installs.
- Docs: `README.md` ("Where the runs live"), `docs/install.md` ("Where the runs live, and the
  run index", the uninstall note, "Upgrading to 2.6.0"), `docs/architecture.md` ("Runs folder
  and run index", testing list), and `docs/quickstart.md`.
- Version 2.6.0 in `.claude-plugin/plugin.json`, `skills/draw/scripts/package.json` and
  `package-lock.json`.

0 redactions applied.

## Verification

| Check | Command | Outcome | When |
|---|---|---|---|
| Full suite | `cd skills/draw/scripts && npx vitest run` | 2170 passed, 41 skipped | 2026-11-18 15:35 UTC |
| Bundle drift | part of the suite (`bundle-drift.test.mjs`) | pass | same |
| Console in Chromium with `docs/diagrams` | `npx vitest run tests/labs-ui-e2e.test.mjs` | 14 passed; the first-render check fails without the fix | 15:33 UTC |
| CLI round in a sample git project, no agent | bundle, sources, snapshot, emit, extract/cover, stale, restore, `labs holds`, `index list` | writes only under `docs/diagrams/` | 15:21 UTC |
| Real index untouched | `ls ~/.zukai` after the suite | absent | 15:35 UTC |

Not run:
- The agent-driven skill round: it needs a local session, since labs refuses cloud sessions.
- `install-ps1.test.mjs` with PowerShell, and the draw.io desktop paths: neither tool was
  present in the cloud container.
- The Windows CI job: no PR has been opened yet.

## Open risks and blockers

- Type: question. Owner: user. Impact: low. Should `labs status` keep answering with
  `configError` on a bad setting (current behaviour), or refuse like `labs start`?
- Type: risk. Owner: unknown. Impact: medium. The agent may not run `runs-dir` at the start
  of a skill, or may still write `diagrams/` from habit or from the `./diagrams/` examples in
  the references. The round below exists to catch this.
- Type: risk. Owner: unknown. Impact: low. Inside a labs job, revise and sync should take the
  job's `runDir` as their path argument. This is untested with a real agent.
- Type: question. Owner: user. Impact: low. Whether to open a PR after the round.

## Exact next actions

1. **First safe step**: in the local clone, run `git fetch origin claude/upbeat-wright-llans1
   && git checkout claude/upbeat-wright-llans1 && git pull`, then confirm that `git log
   --oneline -3` shows this handoff commit above `ed4d30f`.
2. Build a sample project outside the clone, and use a temporary index folder:
   ```bash
   export ZUKAI_HOME="$(mktemp -d)"
   mkdir -p ~/tmp/zukai-sample/src && cd ~/tmp/zukai-sample && git init -q
   printf 'export function pay(cart) { return cart.total > 0; }\n' > src/pay.js
   git add -A && git commit -qm init
   ```
3. Install the skills from the branch into the sample project. This copy is what the session
   runs:
   ```bash
   /path/to/zukai-kobo/install.sh --target claude-project --dest ~/tmp/zukai-sample
   node ~/tmp/zukai-sample/.claude/skills/zukai/scripts/bin/cli.mjs runs-dir set docs/diagrams --root ~/tmp/zukai-sample
   git -C ~/tmp/zukai-sample add -A && git -C ~/tmp/zukai-sample commit -qm "zukai setup"
   ```
   Then start Claude Code in `~/tmp/zukai-sample` with `ZUKAI_HOME` exported. The skills are
   `/zukai`, `/zukai-revise`, `/zukai-sync`, `/zukai-recook` and `/zukai-labs`.
4. Draw: `/zukai scout the payment flow in src/pay.js`, target draw.io. Check that the session
   ran `runs-dir` first, that the run is `docs/diagrams/<date>_<slug>/`, and that `diagrams/`
   does not exist.
5. Revise: `/zukai-revise rename the first step to "Customer submits the cart"`. Check that it
   found the run under `docs/diagrams/` and wrote `history/r001`.
6. Sync: edit `src/pay.js`, then run `/zukai-sync`. Check that it lists runs from
   `docs/diagrams/`, that `stale` reports the change, and that the run is updated.
7. Recook: give `/zukai-recook` the `.drawio` file from step 4, or any `.drawio`/`.mmd` file.
   Check that the new run is under `docs/diagrams/`.
8. Labs: run `/zukai-labs`, open the URL, and check that Overview, Diagrams, a run's header and
   Copy path all show `docs/diagrams/...`. Queue one revise job from the console, and check
   that the agent takes `runDir` and writes into that run.
9. Bad setting: write `{ "config": 1, "runsDir": "../x" }` into `.zukai/config.json`, ask
   `/zukai` for any diagram, and check that it stops with the `bad-config` message and writes
   nothing. Run `labs status` and check that it carries `configError`. Then restore the file.
10. Check the result: `git -C ~/tmp/zukai-sample status --porcelain` shows only
    `docs/diagrams/` and `.zukai/` (`.zukai/labs/` is git-ignored), and `node
    .claude/skills/zukai/scripts/bin/cli.mjs index list` lists the sample project.
11. Run `/zukai-labs stop`. Report each step as passed or failed, with evidence. For any
    defect, fix it on the branch with a test, run `npm run build` and `npx vitest run` in
    `skills/draw/scripts`, then commit and push.
12. Ask the user to settle the `labs status` question, and whether to open a PR.

## Source pointers

- Plan: `plans/261118-1455-configurable-runs-dir-and-global-index/plan.md` and its phase files.
- Review report: `plans/reports/code-reviewer-261118-1502-configurable-runs-dir.md`.
- Journal: `plans/journals/2026-11-18-cook-configurable-runs-folder-and-global-index.md`.
- Resolver and index: `skills/draw/scripts/src/project-config.mjs` and
  `skills/draw/scripts/src/run-index.mjs`.
- CLI: `skills/draw/scripts/src/cli.mjs` (`runsDirCommand`, `indexCommand`,
  `registerRunProject`, `labs holds`).
- Rule text: `skills/draw/references/closing-contract.md` (the `<runs-dir>` paragraph),
  `skills/draw/SKILL.md`, `skills/revise/SKILL.md` section 1, `skills/sync/SKILL.md`
  section 1, `skills/recook/SKILL.md` step 5, and `skills/labs/SKILL.md` section 3.
- User docs: `docs/install.md` (headings "Where the runs live, and the run index" and
  "Upgrading to 2.6.0") and `README.md` ("Where the runs live").
- Remote branch: `origin/claude/upbeat-wright-llans1` in `KiOnCloud/zukai-kobo`.
