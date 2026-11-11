---
title: "zukai:revise — change delivered diagrams with consult, drafts and rollback"
description: "Add a second plugin skill, /zukai:revise, that changes an existing diagram run directly or through 2-3 confirmed drafts, keeps the last five revisions and warns before overwriting draw.io hand edits."
status: pending
priority: P1
effort: 3d
branch: claude/elegant-feynman-lkgx0p
tags: [feature, cli, skill, docs]
blockedBy: []
blocks: []
created: 2026-11-11
---

# zukai:revise

## Overview

Users ask for changes after a diagram is delivered ("replace A with B", "add a step",
"what if approval came before payment?"). The engine already supports editing (the IR is
the source, ids are stable, emit is deterministic), but no skill turns such a request into
an IR change, and a plain re-emit silently destroys layout edits made in draw.io
(`skills/draw/references/variants.md`). This plan adds a thin second skill,
`skills/revise`, that reuses the draw skill's CLI and closing contract, plus four CLI
commands that make the change list, hand-edit detection and rollback deterministic.

## Decisions (accepted in brainstorm)

- Separate skill `/zukai:revise` (Codex `$zukai-revise`), not a mode of `draw`. It owns no
  CLI copy and no closing-contract copy: both stay in `skills/draw/`.
- Three routes: **direct** (imperative, local change), **consult** (what-if phrasing,
  cascading or destructive change, or `--preview`), **undo**. `--apply` forces direct.
- A clarify gate (anchor, outcome of a new branch, affected diagrams) runs on every route.
- Consult works like brainstorm: 2-3 genuinely distinct drafts under `drafts/a|b|c/`, each
  with a CLI change list; one draft only when a single reading is viable, with the reason.
  Delivered files stay byte-identical until the user confirms; review gate runs only after.
- Revisions are per run (all IRs of the run at once) in `history/r<NNN>/`, newest five kept.
- Old runs from earlier sessions can be revised (path argument or `diagrams/*/` lookup).
- Hand edits are detected by comparing the delivered `.drawio` with a fresh emit; label-only
  changes then go through `relabel`; structural changes need consent and back up the file.

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | [CLI diff and drift](./phase-01-cli-diff-and-drift.md) | Pending |
| 2 | [CLI revision history](./phase-02-cli-revision-history.md) | Pending |
| 3 | [Shared closing contract](./phase-03-shared-closing-contract.md) | Pending |
| 4 | [Revise skill](./phase-04-revise-skill.md) | Pending |
| 5 | [Distribution and docs](./phase-05-distribution-and-docs.md) | Pending |
| 6 | [End-to-end verification](./phase-06-end-to-end-verification.md) | Pending |

Order: 1 → 2 (both edit `src/cli.mjs` and the bundle) → 3 → 4 → 5 → 6. Not parallel-safe.

## Success Criteria

- [ ] A local imperative change updates the run without extra questions and leaves the
      prior IR set in `history/`.
- [ ] A what-if produces 2-3 drafts with CLI change lists; `source/` and the delivered
      outputs are byte-identical until confirmation; rejecting leaves the run unchanged.
- [ ] `diff` lists added, removed and changed elements by id, including cascades to `ref`
      parts and `-business` variants.
- [ ] A hand-edited `.drawio` is reported before overwrite; a label-only change keeps its
      geometry through `relabel`.
- [ ] Undo restores a whole revision (multi-IR) and is itself undoable; at most five
      revisions remain.
- [ ] Released as 2.0.0 with an upgrade note for forks.
- [ ] `npm test` passes, the committed bundle matches a fresh build, both installers install
      `zukai` and `zukai-revise`, and `claude plugin validate . --strict` passes.

## Dependencies

- Node 22.13+, `npm ci` in `skills/draw/scripts` for tests (no `node_modules` today).
- No cross-plan dependencies.

## Validation Log

### Verification Results
- Claims checked: 14 (line references in SKILL.md and protocols, installer lines, CLI structure, schema collections, emit determinism, version locations)
- Verified: 12 | Failed: 2 | Unverified: 0
- Tier: Full (6 phases)
- Failures, corrected in the phase files: `check-references.test.mjs` checks IR references, not reference files (phase 3); `build.mjs` does not embed the version, so a version bump needs no rebuild (phase 5).

### Decisions (2026-11-11)
1. Mermaid drafts print their Mermaid text inline next to the change list; draw.io drafts give the file path. (phase 4, consult-protocol step 4: already planned)
2. An imperative request that cascades or removes elements switches to the consult route; `--apply` forces direct. (phase 4, step 6: already planned)
3. Release as 2.0.0, not 1.3.0: the move of the closing contract is treated as breaking for forks of the skill. (phase 5 updated with the version and an upgrade note)
4. The plan is committed to the feature branch so a later `/ak-cook` session can use it; remove `plans/` before merge, as in earlier releases.
