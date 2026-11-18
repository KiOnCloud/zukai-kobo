---
phase: 6
title: "Phase 6: End-to-end, docs and release"
status: todo
priority: P2
effort: "1.5d"
dependencies: [1, 2, 3, 4, 5]
---

# Phase 6: End-to-end, docs and release

## Overview

The skill is exercised by a fresh agent on a sample project, the findings are fixed, the
documents say what changed, and the version becomes 2.4.0.

## Context

- Earlier releases were closed by skill-level rounds recorded under `plans/reports/`
  (`e2e-261117-*.md`): a fresh agent plays the user with only the installed skill folder.
- The documents that name the skills and the commands: `README.md`,
  `docs/architecture.md`, `docs/install.md`, `docs/quickstart.md`.
- The version lives in `.claude-plugin/plugin.json` and
  `skills/draw/scripts/package.json` (and its lock file).
- A container can run the round with a browser on the same machine: `labs start
  --allow-remote` and Playwright.

## Requirements

- [ ] Each acceptance criterion of `plan.md` is shown by a test or by a recorded step of the round.
- [ ] The round runs on the plugin layout and on a copied install, in Claude Code and, where it can be run, in Codex.
- [ ] High and medium findings are fixed and the step is run again.
- [ ] The documents describe the console, the glossary, the fifth skill and the `.zukai/` folder.
- [ ] No process started by the round is left running.

## Design

### The round

| Step | Shows |
|---|---|
| Install the five skills into a sample project with two runs (one scouted, one with a `vi` variant) | Distribution |
| `/zukai:labs`, open the URL, list the runs | Acceptance 1 |
| Queue a revise from the console; answer its question in the console; read the report | Acceptance 3 |
| Undo in the console; compare `source/`, the outputs and `history/` with a copy of the run that was undone by `/zukai:revise undo` | Acceptance 2 |
| Edit a label in the model editor and save; a label-only change keeps a hand edit made in draw.io | The `apply-edit` route |
| `curl` every route without the token, with a foreign `Host`, with a foreign `Origin` | Acceptance 4 |
| `/zukai:labs` in a second session | Acceptance 5 |
| End the agent session with a job queued | Acceptance 6 |
| "Suggest from diagrams", confirm one entry, break its translation in the map, `glossary check` | Acceptance 7 |
| Hash `diagrams/` before and after a pass over every console route that is not a job | Acceptance 8 |
| `/zukai:revise` from a second session on the run of a running job | The guard |
| End the server's session and wait for the idle time | No process left |

The round is recorded in `plans/reports/e2e-<yymmdd>-labs.md` with the commands, the
files produced and each finding with its level.

### Documents

- `README.md`: a "Console" part under Usage (`/zukai:labs`, what a job is, what needs an
  attached agent), a "Glossary" part, the fifth row of every table that lists the skills,
  `.zukai/` beside the Output section, Requirements (a browser on the same machine; the
  viewer is fetched like the renderer of `preview`), Status.
- `docs/architecture.md`: "Glossary" and "Labs console" sections (the three process
  roles, why the server never writes a run, the queue and the guard, the request checks),
  Distribution (five skills), Testing strategy (the new test files).
- `docs/install.md`: Upgrading to 2.4.0, the fifth folder, what `.zukai/` holds and which
  part of it is committed, how to stop the server, uninstall.
- `docs/quickstart.md`: one pointer to the console after the first diagram.
- `THIRD_PARTY_NOTICES.md`: the viewer and Mermaid are fetched by the browser at run time
  and are not redistributed.

## Files to Create / Modify

- Create: `plans/reports/e2e-<yymmdd>-labs.md`
- Modify: `README.md`, `docs/architecture.md`, `docs/install.md`, `docs/quickstart.md`, `THIRD_PARTY_NOTICES.md`
- Modify: `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` (description), `skills/draw/scripts/package.json`, `package-lock.json`
- Modify: `.github/workflows/ci.yml` (the lifecycle e2e in the Windows job)
- Modify: `skills/draw/scripts/bin/cli.mjs`, `bin/labs-ui/` (rebuilt after the fixes)
- Modify: this plan (status, the outcome of the round)

## Implementation Steps

1. Build the sample project and its two runs.
2. Run the round on the plugin layout; record it.
3. Fix high and medium findings; run the failed steps again; fix the low ones that are one line.
4. Run the round's install and job steps on a copied install, and in Codex where a session is at hand.
5. Add the lifecycle e2e to the Windows job.
6. Write the documents; check every command line in them against `cli.mjs help`.
7. Set the version, rebuild, run the whole suite, `claude plugin validate . --strict`.
8. Check that no server of the round is left (`labs status` in each sample project, then `ps`).

## Todo

- [ ] Sample project
- [ ] Round on the plugin layout, recorded
- [ ] Findings fixed and steps run again
- [ ] Round on a copied install and in Codex
- [ ] Windows job
- [ ] README and docs
- [ ] Version 2.4.0, rebuilt bundle, full suite
- [ ] No process left

## Success Criteria

- Every row of the round's table has a recorded result; none is open at high or medium level.
- `cd skills/draw/scripts && npm ci && npm test` passes; no snapshot that existed before this plan changed.
- Every command line in the documents is accepted by the CLI.
- `plugin.json` and `package.json` say 2.4.0; `bin/cli.mjs` and `bin/labs-ui/` equal a fresh build.
- `ps` shows no `labs serve` after the round.

## Risk Assessment

| Risk | Signal | Response |
|---|---|---|
| No Codex session is at hand | The Codex rows of the round are empty | Record them as not run, with the reason, and keep the wait rule for a foreground call as tested by the bridge e2e. |
| The Windows job fails on the detached child | The lifecycle e2e is red there | Fix in `labs-lifecycle.mjs`; if it cannot be fixed in this plan, the documents say that the console needs macOS or Linux and the job is marked as known. Stop and ask before releasing that way. |
| The round finds that undo from the console differs from `/zukai:revise undo` | The comparison of step 4 shows a difference | It is a finding at high level: the job route must follow the undo route with nothing added. |

## Security Considerations

The round's `curl` pass is the check of the request rules on a real server. The sample
project holds invented names only; no report of the round quotes a token.
