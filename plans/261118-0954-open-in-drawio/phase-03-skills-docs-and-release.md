---
phase: 3
title: "Phase 3: Skills, docs and release"
status: pending
priority: P2
effort: "0.75d"
dependencies: [1, 2]
---

# Phase 3: Skills, docs and release

<!-- Updated: Validation Session 2 - the web option says diagrams.net receives the diagram -->

## Goal

Every draw.io run ends with "Open it in draw.io?", a FigJam run with its board link, and the
documents and version say what was added.

## Context

- draw, revise and recook end with `skills/draw/references/closing-contract.md`; sync's
  changes go through revise's routes and end there too.
- The labs skill (`skills/labs/SKILL.md`) closes a job with the followed skill's report.

## Requirements

- [x] The closing contract's last step, after the report: when the run wrote a draw.io file, run `cli open --check <run-folder>`; when `can` is true, ask once (`AskUserQuestion` where the runtime has it, else one text line) "Open <run-slug>.drawio in draw.io?" with "Open it in draw.io desktop" or, when `via` is `web`, "Open it on the web (diagrams.net receives the diagram)" first, and "Not now"; on yes, run `cli open <run-folder>` and pass its result on in one line.
- [x] A FigJam run ends with its board link (already in the report); no question.
- [x] A Mermaid run ends without the question.
- [x] Inside a labs job the question is a console card: before `labs done`, the agent asks it with `labs ask` (id `open-drawio`, options "Open it" and "Not now"), runs `cli open` on yes, then closes the job; the report also names the console's Open in draw.io.
- [x] `cli open` is never run without the user's yes.
- [x] Documents: README (Usage), `docs/architecture.md` (the bridge, the opener page, the routes), `docs/install.md` (Upgrading to 2.4.1), `THIRD_PARTY_NOTICES.md` (embed.diagrams.net fetched by the browser at run time).
- [x] Version 2.4.1 in `plugin.json`, `package.json` and its lock; bundle rebuilt; full suite; strict validation.

## Files to Create / Modify

- Modify: `skills/draw/references/closing-contract.md`, `skills/draw/SKILL.md` (the command line), `skills/labs/SKILL.md` (the closing question as a console card before `labs done`)
- Modify: `README.md`, `docs/architecture.md`, `docs/install.md`, `THIRD_PARTY_NOTICES.md`
- Modify: `.claude-plugin/plugin.json`, `skills/draw/scripts/package.json`, `package-lock.json`, `bin/cli.mjs`, `bin/labs-ui/`

## Tasks & Steps

1. The closing step and its cases in the closing contract; the command line in `skills/draw/SKILL.md`; the job rule in the labs skill.
2. A short skill round: draw a flowchart to draw.io in a local session and answer yes (desktop if installed, else web); revise it and answer no; a FigJam run and a Mermaid run end without the question; a labs job asks it as a console card before it is closed.
3. The documents; every command line checked against `cli.mjs help`.
4. Version 2.4.1; rebuild; `npm test`; `claude plugin validate . --strict`.
5. A PR to main in the style of the earlier releases.

## Verification

- `grep -n "cli.mjs\" open" skills/draw/references/closing-contract.md` finds the closing step.
- `cd skills/draw/scripts && npm test` passes; `claude plugin validate . --strict` passes.

## Risk Assessment

| Risk | Signal | Response |
|---|---|---|
| The question is felt as noise on every run | User feedback after the round | One question, last, with "Not now"; it can be dropped by a later preference flag if asked for. |
| An agent opens without asking | The round shows `cli open` without a yes | The rule is in the closing contract's own words; the round checks it. |

## Security Considerations

`cli open` runs only on the user's yes; it opens the run's own file and nothing a request or
a label names.
