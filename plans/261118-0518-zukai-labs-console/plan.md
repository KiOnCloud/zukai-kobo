---
title: "Zukai Labs: local console, agent job bridge and project glossary"
description: "A fifth skill, /zukai:labs, serves a console on 127.0.0.1 to browse runs, queue changes for the attached agent and manage a project glossary of preferred terms per language."
status: pending
priority: P1
effort: 12d
branch: claude/wizardly-babbage-o4mmey
tags: [feature, frontend, backend, api]
blockedBy: []
blocks: []
created: 2026-11-18
---

# Zukai Labs: local console, agent job bridge and project glossary

## Overview

A fifth skill, `/zukai:labs`, serves a console on `127.0.0.1` to browse the runs under
`diagrams/`, queue changes that the attached agent carries out with the existing skills, and
manage a project glossary of preferred terms per language. The glossary is a data contract
of its own (`.zukai/glossary.json` plus `cli glossary check`) and ships first, because it
is useful without the console.

Planned in hard mode. The brainstorm contract was accepted with every default on
2026-11-18. No outside research was run: every load-bearing fact is in this repository or
in the live session and is cited below.

## Scope challenge

- Existing code reused: `validateIr` and `inspect`, `listRevisions`, `staleRun`,
  `gitRootOf`, `diffRun`, `bundle(..., 'doc')`, `runFolderOf` and `orderIrFiles`,
  `redactText` and `scanSecrets`, the label map format of `relabel`, the build and drift
  test pattern of `build.mjs`, the install tests, and the "Locate the other skills" and
  "Asking the user" sections of the sync skill.
- Requested scope: console for existing diagrams (browse, run, edit, create), a menu that
  later sections can join, and a local glossary for several languages that can be defined,
  edited, suggested by the agent and managed in the console. Delivered in full.
- Complexity: about 30 new files and six phases. Justified by three process roles (server,
  agent-side CLI, browser) and two public contracts (glossary file, job bridge).
- Selected mode: HOLD SCOPE.

## Contract

- Outcome: `/zukai:labs` opens a console with Diagrams (list, picture, model, tables,
  history, files; create, revise, undo, sync, recook and export as jobs) and Glossary
  (edit, confirm or reject suggestions, check a run), with a navigation that a later
  section joins through four touch points.
- Non-goals: reports from a template, system design for reports, a drag-and-drop canvas
  editor, several users, remote hosting, a localised console (its own words are English;
  labels and reports are shown as they are).
- Acceptance criteria:
  1. The console lists every run folder under `diagrams/`.
  2. Undo in the console leaves the run exactly as `/zukai:revise undo` does.
  3. A revise job from the console writes a new revision and the console shows each state.
  4. A request without the token gets 403; a foreign `Host` or `Origin` is refused.
  5. A second `/zukai:labs` reuses the running server and starts no second process.
  6. Without an agent the console says "No agent attached" and nothing spins for ever.
  7. `cli glossary check` exits 2 on a confirmed term that a translation contradicts.
  8. No request to the server changes a file under `diagrams/`.

## Key decisions

| Decision | Evidence |
|---|---|
| The server never writes under `diagrams/`. Every change to a run is a job for the attached agent, routed to the existing skill. This corrects the brainstorm, which listed undo, emit and export as server work. | An undo is a hand-edit check with a question, a restore, then the closing contract (`skills/revise/SKILL.md` sections 3 and 7; `closing-contract.md`, "When revise calls this contract"). A server copy of that would be a second implementation. |
| One sequential queue and one attached agent session. `snapshot` and `restore` refuse a run that a running job of another caller holds. | No lock exists today (no match for `lock` under `skills/`); `revisions.mjs` is atomic per revision only. |
| The server is a detached child with a lock file, an idle shutdown and `labs stop`. | Skills must stay runtime-neutral (`plans/261117-0944-user-features/plan.md`, Constraints); the background run of Claude Code ends after two hours at most. |
| The console is plain ES modules built by esbuild into committed files under `scripts/bin/labs-ui/`, held by a drift test. | "No new runtime dependency unless unavoidable" (same file); the installers ship `scripts/bin` whole (`install.sh:176-186`); the bundle has 230 KB left of its 3 MB budget (`bundle-drift.test.mjs`). |
| A picture comes from `svg/` when it is there, else from draw.io's viewer in a sandboxed frame that holds no token. | The viewer script is already the renderer of `export` (`export-svg.mjs:360`). |
| A cloud session is refused by the CLI, not by skill prose. | `CLAUDE_CODE_REMOTE=true` is set in this cloud session (observed 2026-11-18). |

## Phases

| # | Phase | Effort | Depends on | Status |
|---|-------|--------|------------|--------|
| 1 | [Glossary contract and CLI](./phase-01-glossary-contract-and-cli.md) | 2d | none | Pending |
| 2 | [Labs server and read API](./phase-02-labs-server-and-read-api.md) | 2d | 1 | Pending |
| 3 | [Job queue and agent bridge](./phase-03-job-queue-and-agent-bridge.md) | 2d | 2 | Pending |
| 4 | [Console UI](./phase-04-console-ui.md) | 3d | 2, 3 | Pending |
| 5 | [Labs skill and distribution](./phase-05-labs-skill-and-distribution.md) | 1.5d | 3 | Pending |
| 6 | [End-to-end, docs and release](./phase-06-end-to-end-docs-and-release.md) | 1.5d | 1 to 5 | Pending |

Phases 4 and 5 touch disjoint files and can run side by side once phase 3 is merged.

## Constraints for every phase

- Follow `docs/architecture.md`, above all the Extension rule and the Testing strategy.
- Existing commands, IR files, outputs and exit codes keep working. New behaviour is
  additive; `schemaVersion` of the IR stays 1.
- `bin/cli.mjs` and `bin/labs-ui/` are rebuilt and committed with every source change.
- Skill text is runtime-neutral, in the plain sentences of the existing `SKILL.md` files.
- No plan ids, phase numbers or finding codes in code, tests or commit messages.

## Load-bearing assumptions

| Assumption | Could break | Signal | Response |
|---|---|---|---|
| The agent session stays open while the console is used. | Yes | A job with no agent contact for ten minutes | The console marks it stalled; the user requeues or cancels it. Adjust within the plan. |
| A runtime can block on `labs wait` or be woken when it exits. | Yes, per runtime | Codex e2e round: no job is picked up | Lower the wait timeout below that runtime's tool timeout. Stop and replan only if no blocking call is possible. |
| The draw.io viewer runs inside a sandboxed frame with an opaque origin. | Yes | Phase 4 viewer test shows an empty frame | Fall back to pictures from `svg/` only and offer the export job. Adjust within the plan. |
| `127.0.0.1` is reachable from the user's browser. | In cloud and SSH sessions | `labs start` refuses, or the page does not load | Covered: the CLI refuses a cloud session and names the reason. |

The design stops meeting its criteria when two agent sessions change one run at the same
time outside the queue; the guard on `snapshot` and `restore` is what prevents that.

## Extension trace

The next section after Diagrams and Glossary is Reports. What stays stable: the token and
host checks, the job states, the `wait`, `ask` and `done` calls, the navigation list. What
a new section adds: one view module, one route group, one job kind with its parameters,
one route in the skill's job table. Proof inside this plan: Glossary is built as the
second section through exactly those four touch points (phase 4, success criteria). No
registry or loader is added, as the Extension rule of `docs/architecture.md` has it.

## Open questions

Listed for the validation interview; each has the default the phases are written for.

1. Console code without a framework (default) or with Preact bundled as a build dependency.
2. Server as a detached child with idle shutdown (default) or run by the harness in the
   background.
3. One release 2.4.0 (default) or the glossary as 2.4.0 and the console as 2.5.0.
4. Whether Codex in a cloud task sets a variable the CLI can read. `[UNVERIFIED]`; the
   skill text covers that case in words until it is known.

<!-- slug: zukai-labs-console -->
