---
phase: 3
title: "Phase 3: Skills and console follow the runs folder"
status: completed
priority: P2
effort: "1d"
dependencies: [1]
---

# Phase 3: Skills and console follow the runs folder

## Goal

Every skill and every line of the labs console that names `diagrams/` uses the project's
runs folder instead.

## Context

`diagrams/` appears in the prose of: `skills/draw/SKILL.md`,
`skills/draw/references/closing-contract.md:6`, `target-drawio.md` (4), `target-mermaid.md`
(3), `ir-reference.md` (1), `skills/revise/SKILL.md:92-102`, `skills/sync/SKILL.md:67-73`,
`skills/recook/SKILL.md:128`, `skills/labs/SKILL.md` (6). In the console:
`views/overview.mjs:49`, `:100`, `views/runs-list.mjs:2`, `:33`, `:57`, `:89`,
`views/run-detail.mjs:173`, `:178`, `:239-240`, `:270`, `views/new-diagram.mjs:158`,
`views/open-drawio.mjs:65`. Hash routes `#/diagrams/...` are console routes, not folders,
and stay.

## Files to Create / Modify

- Modify: the skill and reference files above; `src/labs-server.mjs` (`/api/state` gains
  `runsDir`); `src/labs-ui/main.mjs` and the views above; `tests/labs-ui.test.mjs`,
  `tests/labs-ui-e2e.test.mjs`
- Rebuild: `bin/labs-ui/`

## Design

- **Skills:** each skill resolves `<runs-dir>` once, at its start, with
  `node "<draw-dir>/scripts/bin/cli.mjs" runs-dir`, and writes `<runs-dir>` wherever it wrote
  `diagrams/`. On `bad-config` it shows the error and its hint and stops. The closing
  contract states the rule once; the others point to it. Examples in target references keep
  `diagrams/` and say it is the default.
- **Console:** `/api/state` returns `runsDir`; the views read it from the state they already
  receive and show it where they showed `diagrams/`, including "Copy path".

## Tasks & Steps

1. [x] Closing contract: the run folder is `<runs-dir>/<yyyymmdd>_<run-slug>/`, `<runs-dir>`
   from `runs-dir`.
2. [x] Draw, revise, sync, recook, labs: resolve `<runs-dir>` at the start; replace the
   listed mentions; `bad-config` stops with the CLI's message.
3. [x] `/api/state` adds `runsDir`; views use it; jsdom and e2e tests run once with
   `docs/diagrams`.
4. [x] `check-references` test still passes (every referenced file and section exists).
5. [x] Rebuild `bin/labs-ui/`.

## Verification

- `npm test` passes, including the drift test.
- A local skill round in the sample project with `runsDir: "docs/diagrams"`: one draw, one
  revise, one sync, one recook, one labs job; `git status` shows changes only under
  `docs/diagrams/` and `.zukai/`.
