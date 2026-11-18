---
title: "Plan: configurable runs folder and a global run index"
date: 2026-11-18
summary: "Runs stay in the project; .zukai/config.json runsDir moves them; ~/.zukai/index.json lists projects as a rebuildable cache"
---

# Plan: configurable runs folder and a global run index

## What happened
The first proposal was to store every run in the plugin's own folder. That was rejected,
because the plugin copy lives in `~/.claude/plugins/cache/zukai/zukai/<version>/` and is
replaced on every version bump. `CLAUDE_PLUGIN_DATA` survives updates, but the Codex and
folder-copy channels do not have it. A central store as the default would also take runs out
of git and break the sources record's root, which is stored relative to the run. Planned
`plans/261118-1455-configurable-runs-dir-and-global-index` with 4 phases, version 2.6.0.

## Decision
`runsDir` is a relative path inside the project, written in the committed
`.zukai/config.json`. A bad config is an error and never falls back to `diagrams/`. The index
stores project roots only, and runs are scanned on every read. Only `index list` reads the
index. Changing `runsDir` warns about runs left in the old folder and never moves them.

## Next steps
`/ak-cook plans/261118-1455-configurable-runs-dir-and-global-index/plan.md`

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
