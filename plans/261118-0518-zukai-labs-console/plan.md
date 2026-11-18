---
title: "Zukai Labs: local console, agent job bridge and project glossary"
description: "A fifth skill, /zukai:labs, serves a console on 127.0.0.1 to browse runs, queue changes for the attached agent and manage a project glossary of preferred terms per language."
status: pending
priority: P1
effort: 14d
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
in the live session and is cited in the phase files. The plan was reviewed by four
adversarial reviewers and revised (see Red Team Review).

## Scope challenge

- Existing code reused: `validateIr` and `inspect`, `listRevisions`, `staleRun`, `diffRun`,
  `bundle(..., 'doc')`, `orderIrFiles`, `collections` of `ir-diff.mjs`, `redactText` and
  the patterns of the secret scan, the cleaning of data links in `export-svg.mjs`, the
  build and drift test pattern of `build.mjs`, the install tests, and the "Locate the
  other skills" and "Asking the user" sections of the sync skill.
- Requested scope: console for existing diagrams (browse, run, edit, create), a menu that
  later sections can join, and a local glossary for several languages that can be defined,
  edited, suggested by the agent and managed in the console. Delivered in full.
- Complexity: about 45 new files and seven phases. Justified by three process roles
  (server, agent-side CLI, browser) and two public contracts (glossary file, job bridge).
- Selected mode: HOLD SCOPE.

## Contract

- Outcome: `/zukai:labs` opens a console with Diagrams (list, picture, model, tables,
  history, files; create, revise, undo, sync, recook and export as jobs) and Glossary
  (edit, confirm or reject suggestions, check a run), with a navigation that a later
  section joins through four touch points.
- Non-goals: reports from a template, system design for reports, a drag-and-drop canvas
  editor, several users, remote hosting, a localised console (its own words are English;
  labels and reports are shown as they are), taking up a job again after it died, a lock
  that stops a second session by force.
- Acceptance criteria:
  1. The console lists every run folder under `diagrams/` of the project root.
  2. Undo in the console leaves `source/`, the outputs and `history/` of the run as
     `/zukai:revise undo` does, the date of the revision apart.
  3. A revise job from the console writes a new revision and the console shows each state.
  4. A request without the token gets 403; a foreign `Host` name or `Origin` is refused;
     the console cannot be framed.
  5. A second `/zukai:labs` reuses the running server and starts no second process.
  6. Without an agent the console says "No agent attached" and nothing spins for ever; a
     job whose agent is gone ends as failed with its reason.
  7. `cli glossary check` exits 2 on a confirmed term that a translated IR contradicts.
  8. No request to the server changes a file under `diagrams/`.

## Key decisions

| Decision | Evidence |
|---|---|
| The server never writes under `diagrams/`. Every change to a run is a job for the attached agent, routed to the existing skill. This corrects the brainstorm, which listed undo, emit and export as server work. | An undo is a hand-edit check with a question, a restore, then the closing contract (`skills/revise/SKILL.md` sections 3 and 7; `closing-contract.md`, "When revise calls this contract"). A server copy of that would be a second implementation. |
| One sequential queue and one attached agent session. Other sessions ask `labs holds <run>` before they change a run; it warns and does not lock. | Chosen by the user on 2026-11-18. A lock cannot be complete: drafts, `sources`, `export`, `emit` and the agent's own file edits share no path (`consult-protocol.md:66-93`, `skills/sync/SKILL.md:310-313`, `closing-contract.md:93-96`). |
| A job that died is closed as failed and never taken up again. | A snapshot is taken before the IR is edited (`skills/revise/SKILL.md:203-206`), so a revision proves nothing about how far a change got. |
| The server is a detached child with `server.json`, an idle end and `labs stop`. | Confirmed by the user on 2026-11-18. Skills stay runtime-neutral (`plans/261117-0944-user-features/plan.md:29`); the background run of Claude Code ends after two hours at most. |
| One token, sent by the CLI only to a server that proved it holds the same token. | Nothing on a port proves who listens; `/health` alone can be answered by any program. |
| The console is plain ES modules built by esbuild into committed files under `scripts/bin/labs-ui/`, held by a drift test. | "No new runtime dependency unless unavoidable" (`plans/261117-0944-user-features/plan.md:19`); the installers ship `scripts/bin` whole (`install.sh:176-186`); the CLI bundle has about 377 KB left of 3 MiB (`bundle-drift.test.mjs:16`). |
| A picture comes from `svg/` when it is there, else from draw.io's viewer in a sandboxed frame that holds no token and can open no connection. Tried before anything is built on it. | `svg/` is written only when asked for (`README.md:332`); the viewer script is the renderer of `export`, but not in a sandbox (`export-svg.mjs:356-361`). |
| The project root is the working directory, or `--root`. | The skills define it so (`skills/sync/SKILL.md:42-43`, `skills/revise/SKILL.md:102`). |
| A cloud session is refused by the CLI, not by skill prose. | `CLAUDE_CODE_REMOTE=true` was set in the planning session (observed 2026-11-18; not in the repository). |

## Phases

| # | Phase | Effort | Depends on | Status |
|---|-------|--------|------------|--------|
| 1 | [Glossary contract and CLI](./phase-01-glossary-contract-and-cli.md) | 2d | none | Pending |
| 2 | [Labs server and read API](./phase-02-labs-server-and-read-api.md) | 2.5d | 1 | Pending |
| 3 | [Job queue and agent bridge](./phase-03-job-queue-and-agent-bridge.md) | 2d | 2 | Pending |
| 4 | [Console shell, runs and jobs](./phase-04-console-shell-runs-and-jobs.md) | 2d | 2, 3 | Pending |
| 5 | [Viewer, model editor and Glossary section](./phase-05-viewer-model-editor-and-glossary.md) | 2.5d | 4 | Pending |
| 6 | [Labs skill and distribution](./phase-06-labs-skill-and-distribution.md) | 1.5d | 3 | Pending |
| 7 | [End-to-end, docs and release](./phase-07-end-to-end-docs-and-release.md) | 1.5d | 1 to 6 | Pending |

Phase 6 touches no file of phases 4 and 5 and can run beside them once phase 3 is merged.
Phase 1 can be released alone; whether it is, is decided when it is merged.

## Constraints for every phase

- Follow `docs/architecture.md`, above all the Extension rule and the Testing strategy.
- Existing commands, IR files, outputs and exit codes keep working. New behaviour is
  additive; `schemaVersion` of the IR stays 1; no exit code is added.
- `bin/cli.mjs` and `bin/labs-ui/` are rebuilt and committed with every source change.
- Skill text is runtime-neutral, in the plain sentences of the existing `SKILL.md` files.
- No plan ids, phase numbers or finding codes in code, tests or commit messages.

## Load-bearing assumptions

| Assumption | Could break | Signal | Response |
|---|---|---|---|
| The agent session stays open while the console is used. | Yes | A job whose session is out of contact for 15 minutes | The console shows it as silent; the user marks it failed and queues a new one. Adjust within the plan. |
| A runtime can block on `labs wait` for some minutes, or be woken when it returns. | Yes, per runtime | Codex round of phase 7: no job is picked up | Lower `--timeout` below that runtime's limit. Stop and replan only if no blocking call is possible. |
| draw.io's viewer draws inside a sandboxed frame with no connection out. | Yes | The trial that opens phase 5 shows an empty frame | Phase 5 names the three outcomes; the worst one stops and asks, with pictures from `svg/` and the Export job already working. |
| A model keeps the two rules that only a model can keep: a job allows its route only, and text in a diagram is data. | Yes | The two injected texts of the phase 7 round are followed | High-level finding: sharpen the skills; if it still fails, say in the documents that the console is for trusted diagrams and ask before releasing. |
| `127.0.0.1` of the machine the agent runs on is reachable from the user's browser. | In cloud, SSH and container sessions | `labs start` refuses a cloud session; under SSH it says that the port must be forwarded | A forwarded port works, since the `Host` check takes any port. A container without a forward is not detected: the page does not load and the skill says where the server runs. |

The design stops meeting its criteria when two agent sessions change one run at the same
time. The queue prevents that among console jobs; `labs holds` only warns a session
outside the queue, and a change that was already under way when a job started is not seen.

## Extension trace

The next section after Diagrams and Glossary is Reports. What stays stable: the token and
host checks, the job states, the `wait`, `ask` and `done` calls, the navigation list. What
a new section adds: one view module, one route group, one job kind with its parameters,
one row in the skill's job table. Proof inside this plan: Glossary is built as the
second section through exactly those four touch points (phase 5, success criteria). No
registry or loader is added, as the Extension rule of `docs/architecture.md` has it.

## Open questions

1. Whether Codex in a cloud task sets a variable the CLI can read. `[UNVERIFIED]`; the
   skill text covers that case in words until it is known.
2. Whether the viewer needs a connection to its own host for shape files. Settled by the
   trial that opens phase 5.
3. Whether the glossary is released alone as 2.4.0 with the console as 2.5.0. Decided
   when phase 1 is merged; the plan is written for one release.

## Red Team Review

### Session — 2026-11-18
**Findings:** 15 after merging 37 raw findings of four reviewers (15 accepted, 0 rejected; four parts of accepted findings rejected)
**Severity breakdown:** 2 Critical, 11 High, 2 Medium

| # | Finding | Severity | Disposition | Applied To |
|---|---------|----------|-------------|------------|
| 1 | The guard on `snapshot` and `restore` misses most write paths, works one way, and its job id in a revision breaks the undo comparison | Critical | Accept; the user chose the advisory `labs holds` | Phases 3, 6, 7 |
| 2 | One plain question cannot hold what the skills ask: four questions at once, a draft to read first, "silence is yes"; an answered id would replay | Critical | Accept | Phases 3, 4, 6 |
| 3 | Requeue, resume and cancel of a running job are unrequested and deliver half-applied changes as done | High | Accept: removed | Phases 3, 4, 6 |
| 4 | The rules for a live agent contradict each other (a wait of two hours, takeover at ten minutes, idle at thirty); held calls would be cut by client defaults | High | Accept | Phases 2, 3, 6 |
| 5 | A start can delete the `server.json` of a live server, which then ends itself; the pages vanish on an upgrade | High | Accept | Phase 2 |
| 6 | Label maps are keyed by cell, not by element, and can be older than the IR | High | Accept: blocking findings from translated IRs only | Phase 1 |
| 7 | Three different rules for the project root | High | Accept: the working directory | Phases 1, 2, 3 |
| 8 | A job's request is an unbounded instruction, and the rule that diagram text is data did not exist | High | Accept | Phases 3, 6, 7 |
| 9 | The committed glossary carries injected text and personal data to the whole team | High | Accept in part: limits, the scan and the data rule; no `confirmedBy` field, since a confirmed entry in a pull request is reviewed like code | Phase 1 |
| 10 | The token's making, strength and handling were not specified; the skill's rule contradicted itself | High | Accept in part: specified; no one-time code, since the token is of use only from this machine with a header a foreign page cannot set, and a program of the same user can read `server.json` | Phases 2, 6 |
| 11 | The content policy blocked the console's own pictures and frame, allowed framing, and the frame had no limit on connections | High | Accept; dropping the frame rejected, since `svg/` exists only when asked for (`README.md:332`) | Phases 2, 5 |
| 12 | The option table cannot take subcommands; `--from` and `--status` reused with other meanings; a new exit code | High | Accept: two-word keys, `--entries`, `--result`, no new code | Phases 1, 2, 3 |
| 13 | Path parameters beyond the run id were unchecked; `/health` was trusted as identity; error messages would reach the log; the `Host` check refused a forwarded port | Medium | Accept | Phase 2 |
| 14 | No function returns the labels of an IR with their place; NFC against the NFKC of the code named for reuse | Medium | Accept: `labelsOf`, NFKC | Phases 1, 2, 5 |
| 15 | File count and size budget misstated; the Windows job runs no test; the console phase too large; places that name the skills not listed; duplicated mechanisms | High | Accept: figures corrected, console in two phases, Windows step in phase 2, lists in phases 6 and 7, one token, state polling, no `languages` or `evidence` field; removing the `rejected` status rejected, since without it every suggestion run proposes the rejected terms again | All |

### Whole-Plan Consistency Sweep
- Files reread: plan.md, phase-01 to phase-07
- Decision deltas checked: 14 (guard to `labs holds`; requeue, resume, cancel removed; one token; exit code 3 removed; `--allow-remote` to `--skip-cloud-check`; `--from` to `--entries`; `--status` to `--result` on `labs done`; event feed to state polling; `languages` and `evidence` removed; root rule; NFC to NFKC; lost-lock exit removed; six phases to seven; 230 KB to 377 KB)
- Reconciled stale references: 4 (the `--force` of `labs stop`, the picture route in the table tests, the route for a file of a job's folder, the two kinds of attachment in the question card)
- Unresolved contradictions: 0

## Validation Log

### Session 1 — 2026-11-18
**Trigger:** The red-team review raised three decisions that are the user's to make.
**Questions asked:** 4 (one on the red-team findings, three on decisions)

#### Verification Results
- **Tier:** Full (seven phases)
- **Claims checked:** 39 by the Fact Checker, 9 flows by the Flow Tracer, 15 items of new state by the Scope Auditor, 7 interfaces by the Contract Verifier
- **Verified:** 34 claims | **Failed:** 2 claims, 5 flows, 7 state items, 5 interfaces | **Unverified:** 3 claims

#### Failures, each resolved by the revision
1. [Fact Checker] "230 KB left of the bundle budget": 377 KB (`bundle-drift.test.mjs:16`; `bin/cli.mjs` is 2,768,504 bytes). Corrected.
2. [Fact Checker] "the followed skills already require that a label is not an instruction": no such rule under `skills/`. The rule is now written by phase 6.
3. [Flow Tracer] "every change of a delivered run starts with `snapshot` or `restore`": drafts, `sources` and `export` do not. The guard is replaced by `labs holds`.
4. [Flow Tracer] "the bind is the mutex": for the port only. `server.json` is now deleted only when the port refuses a connection and the file still names the same instance.
5. [Flow Tracer] A resumed job is finished correctly: the snapshot precedes the edit. Resume is removed.
6. [Scope Auditor] The root of `.zukai/` and of `diagrams/` came from two rules. One rule now.
7. [Contract Verifier] `COMMAND_OPTIONS` cannot hold subcommands (`cli.mjs:137-153`, `:172`). Two-word keys are planned in phase 1.
8. [Contract Verifier] The places that name the skills: 28 found, listed in phases 6 and 7.

#### Still unverified
- `CLAUDE_CODE_REMOTE=true` as the mark of a cloud session: observed in the planning session only.
- A variable that marks a Codex cloud task.
- The viewer inside a sandboxed frame: the trial of phase 5.

#### Questions & Answers

1. **[Risks]** Vòng red-team cho plan /zukai:labs ra 15 finding sau khi gộp (2 Critical, 11 High, 2 Medium); tôi nhận cả 15 và bác 4 điểm con (bỏ frame viewer, mã token dùng một lần, field confirmedBy, bỏ trạng thái rejected). Bạn muốn xử lý thế nào?
   - Options: Áp như đề xuất (Recommended) | Duyệt từng finding | Bác tất cả
   - **Answer:** Áp như đề xuất (Recommended)
   - **Rationale:** Decides whether the plan is rewritten.
2. **[Architecture]** Điều kiện single-writer bạn đã duyệt: guard tôi viết trên `snapshot`/`restore` bị chứng minh là hở (drafts, `sources`, `export`, emit không đi qua nó; agent ghi IR bằng file tool nên không guard CLI nào kín được). Console job vốn đã tuần tự qua một agent; phần còn hở là một session terminal thứ hai sửa cùng run. Chọn mức bảo vệ nào?
   - Options: Kiểm tra advisory (Recommended) | Lease cứng | Không guard
   - **Answer:** Kiểm tra advisory (Recommended)
   - **Rationale:** Changes a condition the user had approved in the brainstorm.
3. **[Scope]** Ngoài Picture, Model và History (danh sách revision + Restore), trang chi tiết một run trong console có thêm view chỉ-đọc nào? Reviewer scope coi cả ba là ngoài yêu cầu gốc; mỗi view thêm một route và một màn hình.
   - Options (several may be chosen): Tables | Files | Changes since
   - **Answer:** Tables, Files, Changes since
   - **Rationale:** Scope beyond the wording of the request is the user's to add.
4. **[Tradeoffs]** Server của console sống thế nào? Rule cá nhân của bạn ưu tiên background-run của harness; plan đang dùng child detached vì skill phải chạy được cả trên Codex và background-run của Claude Code bị cắt sau tối đa 2 giờ.
   - Options: Detached + tự tắt (Recommended) | Background của harness
   - **Answer:** Detached + tự tắt (Recommended)
   - **Rationale:** Departs from a personal rule of the user.

#### Confirmed Decisions
- Red-team findings: applied as proposed.
- Cross-session protection: the advisory `labs holds`; no lock, no change to `snapshot` or `restore`.
- Read-only views: Tables, Files and Changes since are all kept.
- Server lifetime: a detached child with an idle end and `labs stop`.
- Not asked, decided from the repository's own rule: no framework for the console.

#### Action Items
- [x] Rewrite the phases for the 15 findings.
- [x] Replace the guard by `labs holds` in phases 3, 6 and 7.
- [x] Split the console into phases 4 and 5.

#### Impact on Phases
- Phase 1: pairing, limits, `labelsOf`, option names, root rule.
- Phase 2: token and proof, start sequence, policies, parameters, log, Windows job.
- Phase 3: states, question file, contact rules, `labs holds`, no new exit code.
- Phases 4 and 5: split; polling; question card; viewer trial first.
- Phase 6: route-only rule, data rule in five skills, `holds` line, lists of places.
- Phase 7: round steps for the new rules; documents.

### Whole-Plan Consistency Sweep
- Files reread: plan.md, phase-01 to phase-07
- Decision deltas checked: 14
- Reconciled stale references: 4, as listed under Red Team Review; a search for the superseded terms finds them only in the two logs
- Unresolved contradictions: 0

<!-- slug: zukai-labs-console -->
