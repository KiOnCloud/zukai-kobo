---
phase: 2
title: "CLI revision history"
status: completed
priority: P1
effort: 0.5d
dependencies: [1]
---

# Phase 2: CLI revision history

## Goal

Make snapshot, listing, rotation and restore of a run's revisions deterministic CLI
operations, so the model never deletes or copies history files by hand.

## Design

```text
diagrams/<yyyymmdd>_<run-slug>/
  source/*.ir.json                  current models (unchanged layout)
  history/r001/ … r005/             newest five revisions of the whole run
    revision.json                   { rev, createdAt, request, files, extras, bundle? }
    source/*.ir.json                every IR of the run at that point
    extras/<path>                   delivered outputs that carried hand edits (optional)
  drafts/a|b|c/                     consult drafts (written by the skill, phase 4)
```

- A revision copies every IR of the run, not only changed ones: runs are small, and restoring
  a whole set keeps a main diagram, its `ref` parts and its `-business` views consistent.
- Numbering is max existing + 1, zero-padded to three digits; rotation deletes the lowest
  numbers beyond `--keep`, after the new revision is written completely.
- `bundle` stores the options recovered by `drift` (or given by the skill) so a restore can
  rebuild the combined file.

## Files to create / modify

- Create `skills/draw/scripts/src/revisions.mjs`: `snapshotRun`, `listRevisions`, `restoreRun`.
- Modify `skills/draw/scripts/src/cli.mjs`: commands `snapshot`, `revisions`, `restore`.
- Create `skills/draw/scripts/tests/revisions.test.mjs`.
- Regenerate `skills/draw/scripts/bin/cli.mjs`.

## Tasks & steps

1. `snapshot <run-dir> [--keep 5] [--request <text>] [--extra <file>]... [--bundle <json>]`:
   write into `history/.r<NNN>.tmp-<pid>` first, then rename to `history/r<NNN>`, so an
   interrupted run never leaves a half revision; drop stale `.tmp-*` siblings first. Print
   `{ ok, rev, path, removed: [revs] }`.
2. `revisions <run-dir>`: list `{ rev, createdAt, request, files }`, newest first.
3. `restore <run-dir> <rNNN> [--keep 5] [--request <text>]`: snapshot the current state first
   (request `undo to rNNN`), then replace `source/*.ir.json` with the revision's set, delete
   current IRs absent from it, and delete their per-diagram outputs (`drawio/<slug>.drawio`,
   `mermaid/<slug>.mmd`). Print `{ ok, restored, snapshot, removedDiagrams, bundle }`. The
   skill then runs the closing contract to re-emit and re-bundle.
4. Validate inputs: a run dir without `source/` → exit 1 with a hint; unknown revision →
   exit 1 listing the existing ones; `--keep` must be an integer ≥ 1.
5. `npm run build`, `npm test`.

## Verification

- `revisions.test.mjs` in a temp dir: six snapshots leave `r002`–`r006`; restore of a
  revision with two IRs over a state with three removes the third IR and its outputs;
  restore creates a snapshot first, and restoring that snapshot returns the original bytes;
  a simulated crash (pre-existing `.tmp-*` dir) is cleaned on the next snapshot.
- `cli.test.mjs`: exit codes 0/1 and JSON shape for the three commands.

## Risks

- Same-second snapshots: `createdAt` is informational; ordering uses `rev` only.
- A user who hand-edits files inside `history/` breaks nothing but their own revision; restore
  validates every IR before replacing `source/` and aborts with exit 2 on failure.
