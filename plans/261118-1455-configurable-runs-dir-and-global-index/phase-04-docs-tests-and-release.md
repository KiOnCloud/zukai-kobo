---
phase: 4
title: "Phase 4: Docs, tests and release"
status: pending
priority: P2
effort: "0.5d"
dependencies: [1, 2, 3]
---

# Phase 4: Docs, tests and release

## Goal

Users can find, set and undo the runs folder and the index from the docs, and the release
ships with every test green.

## Files to Create / Modify

- Modify: `README.md` (runs folder setting, `index list`), `docs/architecture.md` (a section
  "Runs folder and run index": resolver, config, index as cache, registration points,
  testing list), `docs/install.md` (`~/.zukai/` is left by uninstall; how to remove it;
  `ZUKAI_INDEX=off`), `docs/quickstart.md` (one line on `runs-dir set`)
- Modify: `.claude-plugin/plugin.json` and the other version markers the release process
  bumps (see the previous release commit `f651991`)
- Create: `plans/journals/2026-11-18-<slug>.md` via the journal step

## Tasks & Steps

1. [ ] Docs above, each claim checked against the code of phases 1 to 3.
2. [ ] Full `npm test`; install tests (`install.test.mjs`, `install-ps1.test.mjs`) unchanged.
<!-- Updated: Validation Session 1 - version 2.6.0 -->
3. [ ] Version bump to 2.6.0 in `.claude-plugin/plugin.json` and
   `skills/draw/scripts/package.json`, and a changelog entry in the same form as 2.5.1.
4. [ ] Commit on `claude/upbeat-wright-llans1`, conventional message, no plan ids.

## Verification

- Every doc link resolves; `check-references` passes.
- A fresh project without config shows no difference from 2.5.1 in a draw run.
