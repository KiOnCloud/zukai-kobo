---
title: "Open a run's diagram in draw.io from the console and from the chat"
description: "An Open in draw.io button in the labs console, cli open for the agent, and a closing question after every draw.io run; the diagram reaches draw.io by postMessage, never in a URL."
status: completed
priority: P2
effort: 2.5d
branch: claude/wizardly-babbage-o4mmey
tags: [feature, frontend, cli, skills]
blockedBy: []
blocks: []
created: 2026-11-18
---

# Open a run's diagram in draw.io from the console and from the chat

## Overview

A user wants to look at and edit a delivered diagram in draw.io without hunting for the
file. In the labs console, "Open in draw.io" opens draw.io in a new tab with the file
loaded. In the chat, every run that wrote a draw.io file ends with one question, "Open it
in draw.io?", and on yes the agent runs `cli open`, which opens draw.io desktop when it is
installed and draw.io on the web otherwise. A FigJam run gives its board link instead;
Mermaid is not opened yet.

Planned from the brainstorm of 2026-11-18 (this conversation); every load-bearing fact
below comes from a trial run in this session or from the repository, cited per decision.

## Contract

- **Outcome:** the console's Open in draw.io and the chat's closing question open the
  run's draw.io file in draw.io, desktop when installed, else the web app, with every page
  of the file as a tab and Save working.
- **Constraints:**
  - The diagram never travels in a URL: it reaches the web app by `postMessage` (draw.io's
    embed protocol), so there is no length limit and nothing of it lands in the browser's
    history or in a synced history.
  - The labs server still never writes under `diagrams/`; the console still loads no script,
    style or frame of another host into its own page.
  - The agent runs one command (`cli open`); the CLI spawns the opener with an argument
    list, never a shell string.
  - Runtime-neutral skill text: the closing question uses `AskUserQuestion` where the
    runtime has it, else one text line.
  - No new runtime dependency.
- **Non-goals:**
  - Writing an edit made in draw.io on the web back into the run (Save downloads the file;
    a later plan can wire the `save` event to a job).
  - Opening Mermaid text (`.mmd`, the combined `.md`): not supported yet.
  - Opening draw.io desktop from the console (the browser cannot start a local program, and
    the server will not start one on a request).
  - Choosing a start page (the whole file opens; its pages are tabs).
- **Acceptance criteria:**
  1. `cli open <run-dir|file.drawio|file.drawio.svg>` opens draw.io desktop when it is found
     and a display is there, else writes the opener page and opens it in the default
     browser; it prints one JSON object (`opened: desktop|web`) and exits 0.
  2. `cli open --check` prints whether and how a diagram can be opened here and changes
     nothing; a cloud session, a machine without a display or browser opener, a Mermaid run
     and a FigJam-only run each give `can: false` with a reason.
  3. A file of 845 KB and 72 pages opens with every page as a tab (the stand-in embed host in
     tests; the real host in the local gate).
  4. The opener page holds the diagram only in its own file (mode 0600 in a 0700 folder under
     the OS temp folder), and pages older than 24 hours are removed on the next run.
  5. In the console, a run with a draw.io file shows Open in draw.io in its header, on each
     `.drawio` row of Files and for the current diagram in Picture; clicking it opens draw.io
     with that file; Save downloads it.
  6. The console takes a message only from the window it opened and only from the embed
     host's origin; no CSP violation is reported.
  7. Every draw.io run of draw, revise, recook and sync ends with the closing question where
     `cli open --check` says it can open; the web option says that diagrams.net receives the
     diagram; inside a labs job the question is a card of the console, asked before the job
     is closed; a FigJam run ends with its board link; a Mermaid run ends without the
     question.

## Key decisions

| Decision | Evidence |
|---|---|
| The diagram goes to draw.io by `postMessage`, not in a `#R` URL fragment. | Trial 2026-11-18: a `#R` URL works (16 KB XML, 3 KB URL) but a 5-diagram run already passes Windows' 8,191-character command line once it is handed to `cmd /c start`, and the full diagram would sit in the browser history. By `postMessage`, an 845 KB file of 72 pages loaded with a 77-character URL. |
| The host is `https://embed.diagrams.net`. | Embed mode on `app.diagrams.net` loaded the file but showed "app.diagrams.net will stop working for embed mode. Please use embed.diagrams.net." (trial screenshot). |
| The chat's opener page frames the embed host; when it has not answered in 20 s, the page shows a button that opens it as a popup. | A page opened by the OS opener has no user gesture, so a popup would be blocked; a frame needs none. Whether `embed.diagrams.net` lets a `file://` page frame it is unverified here (the host answers 403 to a headless browser), so the popup, which the trial proved end to end, is the fallback. The local gate of phase 1 settles it. |
| The console opens the embed host as a popup from the click. | The click is a user gesture; the console's own page and policy stay unchanged; the trial proved the popup protocol from a `http://127.0.0.1` page. |
| Desktop first when it is found and a display is there. | Desktop saves into the run's own file, which revise already reads as a hand edit (`drift`); `findDrawioBinary()` exists in `preview.mjs:191`. On Linux without `DISPLAY` or `WAYLAND_DISPLAY`, `drawioCommand` (`preview.mjs:133`) wraps it in `xvfb-run`, an invisible window, so that case counts as "no display"; macOS and Windows always count as having one. |
| The closing question is asked only where `cli open --check` says yes; inside a labs job it is asked through the console with `labs ask`, before `labs done`. | A cloud session cannot reach the user's browser (`isCloudSession`, `labs-lifecycle.mjs:88`). Chosen by the user on 2026-11-18 for jobs: the question is part of the followed contract, so it reaches the console like every other question; `labs ask` needs the job open, so it comes before `labs done`. |
| Tests use a stand-in embed host, chosen by `ZUKAI_DRAWIO_EMBED`, and a stand-in opener, chosen by `ZUKAI_OPENER`. | The real host refuses headless browsers (403 for the `HeadlessChrome` user agent, 200 for a normal one, checked with curl); tests must not open real browsers. The labs server already takes test variables (`ZUKAI_LABS_*`). |

## Phases

| # | Phase | Effort | Depends on | Status |
|---|-------|--------|------------|--------|
| 1 | [Open command and embed bridge](./phase-01-open-command-and-embed-bridge.md) | 1d | none | Done |
| 2 | [Console open button](./phase-02-console-open-button.md) | 0.75d | 1 | Done |
| 3 | [Skills, docs and release](./phase-03-skills-docs-and-release.md) | 0.75d | 1, 2 | Done but the skill round in a local session and the PR |

## Constraints for every phase

- Follow `docs/architecture.md`, above all the Extension rule and the Testing strategy.
- Existing commands, outputs and exit codes keep working; no exit code is added.
- `bin/cli.mjs` and `bin/labs-ui/` are rebuilt and committed with every source change.
- No plan ids, phase numbers or finding codes in code, tests or commit messages.

## Load-bearing assumptions

| Assumption | Could break | Signal | Response |
|---|---|---|---|
| `embed.diagrams.net` answers a real browser and keeps its embed protocol (`init`, `load`, `save`, `status`). | Yes: third-party, unversioned | The local gate shows no `init`, or a release check finds the file not loaded | The opener page falls back to its button and then to "download the file"; record it; desktop keeps working. |
| `embed.diagrams.net` can be framed by a `file://` page. | Unknown | Local gate: the frame stays blank | Keep the popup button as the chat's only route (one click more) and say so in the docs. |
| A user's browser allows the console's popup from the click. | Popup blockers | `window.open` returns null | The console says the popup was blocked and how to allow it. |

## Extension trace

The next target to open is Mermaid. What stays stable: `cli open` and its `--check`, the
closing question, the console button's place. What changes: the resolver maps a `.mmd` or
combined `.md` to a page that renders it (the labs viewer already draws Mermaid), and
`--check` stops answering `can: false` for it. No registry is added.

## Open questions

1. ~~Whether `embed.diagrams.net` lets a `file://` page frame it.~~ Settled on 2026-11-18: it
   does (no `frame-ancestors`, no `X-Frame-Options`; the real host loaded and saved a 74-page
   file inside a frame of a `file://` page). See phase 1, "Local gate result".

## Validation Log

### Session 1 — 2026-11-18
**Trigger:** decisions left open by the brainstorm.
**Questions asked:** 4

1. **[Scope]** Which file opens for a run of several diagrams?
   - **Answer:** the combined `<run-slug>.drawio` (every diagram a page tab).
2. **[Workflow]** Is the closing question asked inside a labs job?
   - **Answer:** yes, through the console (a question card), before the job is closed.
3. **[Scope]** Does Save on the web only download the file this round?
   - **Answer:** yes; writing back into the run is a later plan.
4. **[Release]** Version?
   - **Answer:** 2.4.1.

#### Impact on Phases
- Phase 3: the labs skill asks the closing question with `labs ask` before `labs done`, and runs `cli open` on yes; version 2.4.1 in place of 2.5.0.

### Whole-Plan Consistency Sweep (Session 1)
- Files reread: plan.md, phase-01 to phase-03
- Decision deltas checked: 2 (question inside a job; version)
- Unresolved contradictions: 0

### Session 2 — 2026-11-18
**Trigger:** `/ak-plan validate` before implementation.
**Questions asked:** 2

#### Verification Results
- **Tier:** Standard (Fact Checker + Contract Verifier)
- **Claims checked:** 16
- **Verified:** 13 | **Failed:** 1 | **Unverified:** 2

Verified: `findDrawioBinary` (`preview.mjs:191`); `drawioCommand` and its `xvfb-run`
wrapping (`preview.mjs:133-139`); `isCloudSession` (`labs-lifecycle.mjs:88`); `drawioPages`
(`export-svg.mjs:43`); `drawioXmlOf(buf)` (`extract-drawio.mjs:28`); the file route
(`GET /api/runs/:run/files/:name`, `labs-server.mjs`); the `#/` and `blob:` rule
(`labs-ui/dom.mjs:18`); `picture()` and `files()` (`run-detail.mjs:45`, `:117`); `labs serve`
inheriting the start's environment (`labs-lifecycle.mjs:138`), so `ZUKAI_DRAWIO_EMBED` reaches
the server; sync, recook and revise ending with the closing contract (`sync/SKILL.md:301`,
`recook/SKILL.md:12`, `closing-contract.md:324`); the embed `init` and `load` events (trial).

Contract Verifier:
- `cli open` joins `COMMAND_OPTIONS` (`cli.mjs:190`) and the usage text. The install tests and the Windows job assert that some help lines are present, never the whole text, so a new line breaks none of them.
- `/api/state` gains `drawio`. Its one consumer, `labs-ui/main.mjs:79-88`, reads fields one by one, and no test compares the whole state.
- The closing step reaches draw, revise, recook, sync and, through `labs ask`, the labs skill: five consumers, all listed in phase 3.

#### Failures
1. [Fact Checker] `preview.mjs:190`: the function is at `:191`. Corrected.

#### Unverified
- The embed `save` and `status` messages on the real host: only `init` and `load` were seen. Added to the local gate.
- The rule for "a display is there" on Linux: `drawioCommand` reads `DISPLAY` or `WAYLAND_DISPLAY`, and the plan named neither. Written into phase 1, with `--check` reporting `no-display`.

#### Questions & Answers
1. **[Risks]** Without draw.io desktop the closing question opens diagrams.net, whose script receives the whole diagram. How should the question read?
   - **Answer:** say so in the question: the web option reads "Open it on the web (diagrams.net receives the diagram)".
2. **[Tradeoffs]** If the local gate shows that `embed.diagrams.net` cannot be framed by a local page, is one click on the opener page acceptable?
   - **Answer:** yes; the popup button is the fallback route, and the `#R` URL is not used.

#### Impact on Phases
- Phase 1: the display rule; `--check` and the web route report `no-display` on Linux without one; the local gate also presses Save.
- Phase 3: the wording of the web option.

### Whole-Plan Consistency Sweep (Session 2)
- Files reread: plan.md, phase-01 to phase-03
- Decision deltas checked: 3 (display rule; web option wording; Save in the local gate)
- Reconciled stale references: 1 (`preview.mjs:190`)
- Unresolved contradictions: 0
2. Version: 2.4.1, chosen by the user on 2026-11-18.

<!-- slug: open-in-drawio -->
