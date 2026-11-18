---
phase: 1
title: "Phase 1: Runs folder contract and CLI"
status: completed
priority: P2
effort: "1d"
dependencies: []
---

# Phase 1: Runs folder contract and CLI

## Goal

One resolver decides where a project's runs live, every piece of code that hard-codes
`diagrams/` asks it, and the CLI can print and set the folder.

## Context

- `labs-runs.mjs:35` `diagramsDir(root)` is the only code path that builds the runs folder;
  `labs-server.mjs:30`, `:191` and `runNames`, `runPath`, `listRuns` use it.
- `cli.mjs:828-830` (`labs holds`) infers the project of a run from a parent folder named
  `diagrams`.
- Hints naming `diagrams/<yyyymmdd>_<run-slug>`: `cli.mjs:468`, `glossary.mjs:355`,
  `revisions.mjs:112`, `:114`, `sources.mjs:111`, `:113`, `open-drawio.mjs:40`, usage text
  `cli.mjs:95`, `:176`.
- `projectRoot` and `zukaiDir` live in `glossary.mjs:38-39`.
- `sources.mjs:85` picks the project root of a new record as `--root`, else the git work tree
  of the run, else the working directory; a runs folder inside the project keeps that true.

## Files to Create / Modify

- Create: `skills/draw/scripts/src/project-config.mjs`
- Modify: `src/labs-runs.mjs`, `src/labs-server.mjs`, `src/cli.mjs`, `src/glossary.mjs`,
  `src/revisions.mjs`, `src/sources.mjs`, `src/open-drawio.mjs`
- Create: `tests/project-config.test.mjs`; modify `tests/labs-runs.test.mjs`,
  `tests/labs-server.test.mjs`, `tests/cli.test.mjs`
- Rebuild: `bin/cli.mjs`

## Design

- `.zukai/config.json`: `{ "config": 1, "runsDir": "docs/diagrams" }`. Unknown keys are kept
  on write. No file, or no `runsDir`, means `diagrams`.
- `project-config.mjs`:
  - `readProjectConfig(root)` returns `{ ok: true, config, from: "config"|"default" }` or
    `{ ok: false, error: { code: "bad-config", message, hint } }` for unreadable JSON, a
    wrong `config` number or an invalid `runsDir`.
  - `checkRunsDir(root, value)`: a string, forward slashes, not empty, not absolute, no `.`
    or `..` segment, not `.zukai` or under it, not `.git` or under it; when the folder
    exists, its real path stays inside the real project root.
  - `runsPath(root)` returns the absolute folder or throws the `bad-config` error;
    `runsDirOf(root)` returns the relative value for messages.
  - `projectOfRun(runDir)`: the nearest ancestor holding `.zukai/config.json` whose
    `runsPath` is the run's parent, else the grandparent when the parent is named
    `diagrams` (today's rule), else undefined.
- `labs-runs.mjs`: `diagramsDir` becomes `runsPath`, read on every call so a config change
  reaches a running console without a restart.
- `labs holds` uses `projectOfRun` in place of the `diagrams` name check.
- Hints read "the run folder, <runs-dir>/<yyyymmdd>_<run-slug>" with the resolved value
  where a root is known and `diagrams` where it is not.
- New commands:
  - `runs-dir [--root <project>]` prints `{ ok, root, runsDir, path, from }`.
  - `runs-dir set <rel> [--root <project>]` validates, writes the config (temp file and
    rename), and prints `{ ok, runsDir, previous, runsLeftIn? }`; `runsLeftIn` names the old
    folder and its run count when it holds runs. Exit 1 with `bad-config` on an invalid value.

## Tasks & Steps

1. [x] Write `project-config.mjs` and its unit tests first: default, config, each invalid
   value, a link leading out of the project, broken JSON giving `bad-config`.
2. [x] Replace `diagramsDir` with `runsPath` in `labs-runs.mjs` and `labs-server.mjs`.
3. [x] Replace the `diagrams` name check of `labs holds` with `projectOfRun`.
4. [x] Update the hints and usage text listed above.
5. [x] Add `runs-dir` and `runs-dir set` to `COMMAND_OPTIONS`, the usage text and `help`.
6. [x] Check `.zukai/.gitignore` (written by `ensureZukaiDir`) keeps `config.json` tracked.
7. [x] Rebuild `bin/cli.mjs`.

## Verification

- `npm test` in `skills/draw/scripts` passes with no change to existing expectations except
  hint text.
- `labs-runs` and `labs-server` tests run once more against the sample project with
  `runsDir: "docs/diagrams"`.
- `node bin/cli.mjs runs-dir set ../x` exits 1 with `bad-config`.

## Risks

- A bad config now fails commands that worked before only in projects that wrote a bad
  config; the error names the file and the fix.
