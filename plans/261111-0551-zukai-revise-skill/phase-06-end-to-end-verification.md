---
phase: 6
title: "End-to-end verification"
status: in-progress
priority: P1
effort: 0.5d
dependencies: [5]
---

# Phase 6: End-to-end verification

## Goal

Prove each route of `/zukai:revise` on a real run folder before release, and compare the
result with the plan's success criteria.

## Setup

In a scratch project, produce a run with `/zukai:draw` (or by hand with the CLI from
fixtures): a `detailed` flowchart with one `ref` part and audience `both`, target draw.io,
plus a second run with target Mermaid.

## Scenarios

| # | Request | Expected |
|---|---|---|
| 1 | "đổi nhãn bước X thành Y" | direct route, no question, `history/r001`, label changed in IR and output |
| 2 | "thêm bước validate sau bước nhập" | direct route, one clarify question about the failure outcome, part and business view updated or listed in the change list |
| 3 | "nếu bước duyệt chuyển lên trước thanh toán thì sao?" | consult route, 2-3 drafts under `drafts/`, `source/` and outputs byte-identical (check with `sha256sum`) until confirm |
| 4 | Scenario 3, then "bỏ" | `drafts/` deleted, run unchanged |
| 5 | Scenario 3, then pick draft b, ask one tweak, confirm | snapshot, `source/` equals draft b, review gate runs, report lists the revision |
| 6 | Move a box in the delivered `.drawio`, then scenario 1 | drift reported, `relabel` used, moved box keeps its position |
| 7 | Move a box, then scenario 2 | drift reported, consent asked, drifted file saved under `history/rNNN/extras/` |
| 8 | "undo" twice | second undo returns to the state before the first undo |
| 9 | Seven revisions | only five `history/r*` folders remain |
| 10 | New session, `/zukai:revise diagrams/<run> …` | run found from the path; without a path, found by slug |
| 11 | Mermaid run, scenario 3 | drafts show Mermaid text inline, no drift step |
| 12 | No run on disk | revise stops and points at `/zukai:draw` |

## Verification

- `cd skills/draw/scripts && npm test` and the bundle drift test pass.
- `claude plugin validate . --strict` passes.
- Every scenario's outcome recorded in the PR description, with any deviation and its fix.
- Each plan success criterion checked off against a scenario.

## Results (2026-11-11)

- `npm test`: 605 passed, 1 skipped; the bundle drift test passes. `claude plugin validate . --strict` passes. The CI frontmatter check passes for both skills. `install.sh` was run under sh and dash.
- The CLI side of scenarios 1, 3–9 and 11 was run on a scratch run, and all of it passed. Delivered files stayed byte-identical while drafts existed. Dropping the drafts wrote no revision. A hand-moved box kept its `x` through `relabel`. The drifted file was kept under `extras/`. Undoing the undo restored the earlier bytes. Five revisions were kept. `drift` refused Mermaid output.
- An independent review found 4 high, 8 medium and 9 low findings. All were fixed with regression tests except the following:
  - Not fixed: when two diagram ids share their first 40 characters, they get the same page id. This was already the case before this work and lives in the emitter's `slugify`.
  - Not executed: the model-driven parts. These are route choice, the clarify question (scenario 2), finding a run from a new session (scenario 10) and stopping when no run exists (scenario 12). They need `/zukai:revise` run in a Claude Code session with the plugin installed.
  - Not executed: `install.ps1`, because no PowerShell is available. It was reviewed line by line against `install.sh` instead.
