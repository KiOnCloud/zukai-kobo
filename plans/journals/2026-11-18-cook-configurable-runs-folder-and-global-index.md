---
title: "Cook: configurable runs folder and a global run index"
date: 2026-11-18
summary: "runsDir in .zukai/config.json behind one resolver, runs-dir and index commands, console and skills follow the folder; released as 2.6.0; review fixed fail-open holds, index pruning and overwrite, and the console's first render"
---

# Cook: configurable runs folder and a global run index

## What happened
Implemented all four phases of `plans/261118-1455-configurable-runs-dir-and-global-index`.
`project-config.mjs` holds the one resolver, `runsPath(root)`, and `run-index.mjs` holds the
per-user index. `runs-dir [set]` and `index list|rebuild|forget` joined the CLI. The labs
server, the console and the five skills follow the folder. The release is 2.6.0.

## Surprises
- The existing CLI e2e tests would have written to the real `~/.zukai` once the writing
  commands started registering projects. A vitest setup file now gives every test file a
  temporary `ZUKAI_HOME`. The installers leave the new `vitest.config.mjs` out of copied
  installs.
- With `runsDir: "docs/diagrams"`, the scan took `docs/` for a project of its own, because its
  runs folder is named `diagrams`. A runs folder already owned by a project above it now makes
  no project.

## Review
An independent review found no critical defect. Four medium issues were fixed: `labs holds`
failing open when the setting was unreadable or the path was spelled differently; the index
dropping projects whose setting was being edited; a newer-version index being overwritten;
and the console's first page naming `diagrams/`. `labs status` now answers with
`configError` instead of refusing.

## Not done
The interactive skill round (one draw, revise, sync, recook and labs job driven by an agent)
was replaced by the same commands run through the CLI in a sample git project.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
