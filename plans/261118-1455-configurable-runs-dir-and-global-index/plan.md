---
title: "Configurable runs folder and a global run index"
description: "Runs stay in the project under diagrams/ by default; .zukai/config.json runsDir moves them and every skill, the CLI and the labs console follow it; ~/.zukai/index.json lists the projects that hold runs as a rebuildable cache."
status: pending
priority: P2
effort: 3.5d
branch: claude/upbeat-wright-llans1
tags: [feature, cli, skills, labs]
blockedBy: []
blocks: []
created: 2026-11-18
---

# Configurable runs folder and a global run index

## Overview

Today every run lives in `diagrams/<yyyymmdd>_<run-slug>/` under the project root, and
`diagrams/` is hard-coded in the CLI (`labs-runs.mjs:35`, `cli.mjs:830`, several hints), in
the labs console's text and in the prose of all five skills. This plan makes the folder a
project setting, `runsDir` in `.zukai/config.json`, committed with the project, and adds a
per-user index of the projects that hold runs, so `index list` can answer "which diagrams
do I have, in which project" across projects.

Decided in the brainstorm of 2026-11-18 (this conversation): runs never live in the plugin's
install folder (`~/.claude/plugins/cache/zukai/zukai/<version>/` is replaced on every
version bump) nor in `CLAUDE_PLUGIN_DATA` (absent from the Codex and folder-copy channels),
and a central store is not the default (runs would leave git and the team).

## Contract

- **Outcome:** a project without `.zukai/config.json` behaves exactly as today. A project
  with `runsDir` has every run written, listed, revised, synced, recooked, opened and shown
  in the console from that folder. `index list` shows every known project with its runs.
- **Constraints:**
  - `runsDir` is a relative path inside the project root (validated in phase 1; decision 1).
  - An invalid or unreadable config is an error (exit 1, code `bad-config`), never a silent
    fallback to `diagrams/`.
  - The index holds project roots and a last-seen time only; runs are scanned from disk on
    every read, so the index never holds data a run folder does not.
  - Writing the index never fails the command that triggered it.
  - The sources record contract (`root` relative to the run, `sources.mjs:14`) is unchanged.
  - Existing commands, outputs and exit codes keep working; new fields only.
- **Non-goals:** storage in the plugin install folder or `CLAUDE_PLUGIN_DATA`; a central
  store as default; moving existing runs when `runsDir` changes; resolving a run of another
  project by name in revise or sync; a labs console section for other projects.

## Phases

| # | Phase | Effort | Depends on | Status |
|---|-------|--------|------------|--------|
| 1 | [Runs folder contract and CLI](./phase-01-runs-dir-contract-and-cli.md) | 1d | none | Pending |
| 2 | [Global run index](./phase-02-global-run-index.md) | 1d | 1 | Pending |
| 3 | [Skills and console follow the runs folder](./phase-03-skills-and-console-follow-runs-dir.md) | 1d | 1 | Pending |
| 4 | [Docs, tests and release](./phase-04-docs-tests-and-release.md) | 0.5d | 1, 2, 3 | Pending |

## Acceptance criteria

1. Without `.zukai/config.json`, `npm test` passes unchanged and every path is `diagrams/`.
2. `runs-dir` prints the resolved folder and where it came from; `runs-dir set <rel>` writes
   the config, refuses an absolute path, `..`, `.zukai/`, `.git/` or a link leading out of
   the project, and warns (never moves) when the old folder holds runs.
3. With `runsDir: "docs/diagrams"`, a draw, revise, sync, recook and labs job round in the
   sample project writes and reads only `docs/diagrams/`; the console shows that folder in
   every place it showed `diagrams/`.
4. `index list` lists each registered project with its runs folder and runs; a deleted
   project is reported dead and pruned on the next write; deleting `index.json` and running
   `index rebuild --scan <dir>` restores the same list.
5. `ZUKAI_INDEX=off` stops every read and write of the index.
6. `bin/cli.mjs` and `bin/labs-ui/` are rebuilt and the drift test passes.

## Constraints for every phase

- Follow `docs/architecture.md`, above all the Extension rule and the Testing strategy.
- `bin/cli.mjs` and `bin/labs-ui/` are rebuilt and committed with every source change.
- No plan ids, phase numbers or finding codes in code, tests or commit messages.

## Load-bearing assumptions

| Assumption | Could break | Signal | Response |
|---|---|---|---|
| Every write of a run goes through a CLI command that can register the project (`bundle`, `snapshot`, `restore`, `sources`). | A skill writes a run with file tools only | A run exists but its project is missing from `index list` | `labs start` and `runs-dir` also register; `index rebuild --scan` recovers it. |
| `.zukai/.gitignore` does not ignore `config.json`. | No: it ignores only `labs/` and `glossary.lock` (verified, `glossary.mjs:43-49` and the fixture) | `git status` does not show the new config | Phase 1 keeps a test on it. |
| Two sessions writing the index at once is rare. | Parallel worktrees | A project missing after a race | Merge before rename; the next write re-registers it (the index is a cache). |

## Extension trace

The next likely variant is a runs folder shared by several projects (a docs repository).
What stays: `runsPath(root)` as the one resolver and the index's project list. What would
change: the inside-the-project rule and the sources record's relative `root`. Nothing is
built for it; decision 1 records the cost.

## Open questions

None; settled in the Validation Log below.

## Validation Log

### Session 1 — 2026-11-18
**Trigger:** decisions left open after drafting.
**Questions asked:** 4

#### Verification Results
- **Claims checked:** 9 | **Verified:** 9 | **Failed:** 0 | **Unverified:** 0
- Verified: `diagramsDir` (`labs-runs.mjs:35`) and its users (`labs-server.mjs:30`, `:191`);
  the `diagrams` name check (`cli.mjs:828-830`); `projectRoot` (`glossary.mjs:38`); the
  sources record's relative `root` and its root choice (`sources.mjs:14`, `:85`);
  `snapshot`/`restore` commands (`cli.mjs:216-218`); the `.zukai/.gitignore` content;
  `LOCALAPPDATA` handling (`preview.mjs:175`); version markers (`plugin.json`,
  `skills/draw/scripts/package.json`, commit `f651991`).

#### Questions & Answers
1. **[Scope]** Where may `runsDir` point? **Answer:** inside the project only.
2. **[Scope]** Who reads the index? **Answer:** the CLI `index list` only.
3. **[Workflow]** Changing `runsDir` while the old folder holds runs? **Answer:** warn, never move.
4. **[Release]** Version? **Answer:** 2.6.0.

#### Impact on Phases
- Phase 4: version 2.6.0. Phases 1 to 3 already matched every answer.

### Whole-Plan Consistency Sweep (Session 1)
- Files reread: plan.md, phase-01 to phase-04
- Decision deltas checked: 4
- Unresolved contradictions: 0

<!-- slug: configurable-runs-dir-and-global-index -->
