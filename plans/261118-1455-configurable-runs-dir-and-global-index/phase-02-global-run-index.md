---
phase: 2
title: "Phase 2: Global run index"
status: completed
priority: P2
effort: "1d"
dependencies: [1]
---

# Phase 2: Global run index

## Goal

A per-user `index.json` lists the projects that hold runs; `index list` scans their runs
folders on read, so the index is a cache that can be deleted and rebuilt at any time.

## Context

- `preview.mjs:175` already resolves `LOCALAPPDATA` with a home fallback on Windows.
- Commands that write into a run folder: `bundle`, `snapshot`, `restore` (`revisions.mjs`),
  `sources`; `labs start` and `runs-dir set` know the project too.
- Phase 1 gives `runsPath(root)` and `runNames(root)`.

## Files to Create / Modify

- Create: `skills/draw/scripts/src/run-index.mjs`, `tests/run-index.test.mjs`,
  `tests/run-index-e2e.test.mjs`
- Modify: `src/cli.mjs` (register after the commands above; `index` commands), `src/labs-lifecycle.mjs`
- Rebuild: `bin/cli.mjs`

## Design

- **Location:** `ZUKAI_HOME` when set (tests), else `%LOCALAPPDATA%\zukai` on Windows, else
  `~/.zukai`. The folder is created with mode 0700 and the file with 0600.
- **File:** `{ "index": 1, "projects": [ { "root": "<absolute>", "lastSeen": "<ISO>" } ] }`.
  No run names, titles or diagram text: everything else is read from disk.
- **Register** (`registerProject(root)`): after a successful `bundle`, `snapshot`, `restore`,
  `sources`, `labs start` or `runs-dir set`. Read, upsert by real path, write a temp file
  and rename it; the read happens right before the write so a concurrent writer loses at
  most its own entry, which its next command adds back. Any error is swallowed: the command's
  output and exit code do not change.
- **Read** (`listIndex()`): for each project, `alive` when the root exists and its config
  resolves; then `runsDir` and `runs` (name, newest first) from `runNames`. A corrupt
  `index.json` reads as empty and is replaced on the next write; `index list` says so in a
  `warnings` entry.
- **Prune:** a write drops projects not alive; reading never writes.
- **Commands:**
  - `index list` prints `{ ok, file, projects: [ { root, alive, runsDir, runs, lastSeen } ], warnings }`.
  - `index rebuild [--scan <dir>]...` drops dead projects and, for each `--scan`, walks up to
    four levels, skipping `node_modules`, `.git` and hidden folders, and registers each
    folder that holds `.zukai/` or a runs folder with at least one run.
  - `index forget <root>` removes one project.
- **Opt-out:** `ZUKAI_INDEX=off` makes register a no-op and `index` commands exit 1 with
  code `index-off`.

## Tasks & Steps

1. [x] Write `run-index.mjs` with location, read, register, prune, rebuild and forget, and
   unit tests: register twice keeps one entry, a deleted root is dead and pruned on write,
   corrupt file reads as empty, `ZUKAI_INDEX=off`, Windows location from `LOCALAPPDATA`.
2. [x] Call `registerProject` after the six commands; never let it change their output.
3. [x] Add `index list|rebuild|forget` to the CLI, usage and `help`.
4. [x] E2E through the bundle with `ZUKAI_HOME` in a temp folder: two projects, one with a
   custom `runsDir`, a `bundle` in each, `index list`, delete one, `index list`, delete
   `index.json`, `index rebuild --scan`, compare with the first list.
5. [x] Rebuild `bin/cli.mjs`.

## Verification

- `npm test` passes; no test writes outside its temp `ZUKAI_HOME`.
- A failing index write (read-only `ZUKAI_HOME`) leaves the output of `bundle` byte for byte
  as before.

## Security

- The index holds absolute paths of client projects under the user's home, nothing of their
  content. Mode 0600; documented in phase 4 with the opt-out.
