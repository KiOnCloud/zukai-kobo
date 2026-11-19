---
phase: 6
title: "Docs, tests sweep and release 2.7.0"
status: in-progress
priority: P2
effort: "1d"
dependencies: [1, 2, 3, 4, 5]
---

# Phase 6: Docs, tests sweep and release 2.7.0

## Goal

Users and maintainers can find, install and extend reports from the docs, the whole suite
passes, and the release is cut as 2.7.0.

## Files to Create / Modify

- Modify: `README.md` (a "Reports" section: the command, kinds, templates and scopes, HTML and PDF, the glossary polish and translation, the console section)
- Modify: `docs/install.md` (the sixth skill, user template folder, "Upgrading to 2.7.0", uninstall note for `<ZUKAI_HOME>/report-templates/`)
- Modify: `docs/architecture.md` ("Reports and templates": owner modules, the `reports` config result beside the runs-only `ok`, the sealed report frame and per-page policies, the quick-edit and restore exceptions to "every change is a job", templates as untrusted input; Extension rule and Testing strategy lists; "five skills" → six at :942-943) <!-- Updated: Red Team Session 1 - docs follow the fixes -->
- Modify: `docs/install.md` "Upgrading to 2.7.0" also covers a 2.6.0 project whose `runsDir` is `reports` (set `reportsDir` elsewhere) and the bundled `marked`
- Modify: `docs/quickstart.md` (one report walk-through)
- Modify: `skills/draw/references/glossary.md` (prose checks and the keep rule)
- Modify: `.claude-plugin/plugin.json`, `skills/draw/scripts/package.json`, `package-lock.json` (2.7.0; description mentions reports)

## Tasks & Steps

- [x] 1. Write the docs above, each claim checked against the code and tests of phases 1–5.
- [x] 2. Full suite on Linux (CI) and on Windows (local): no failure new to this branch; the five Windows-only failures known on `main` (`install-ps1`, `preview`, `sources`) are reported, not hidden.
  - CI on PR #77 passed (`test`, `install-windows`).
  - macOS (2026-11-19, Playwright through `NODE_PATH`): 20 failures at first. 16 were tests comparing a `tmpdir()` path with the resolved `/private/var` path the CLI prints, now compared by real path. 2 were the Linux-only xvfb stand-ins, now skipped off Linux. 1 was the template import of the Reports console, which only failed under load. That led to a real fix: the Templates view now builds its import block once, so a reload or a route keeps a checked file, with a jsdom regression test. After the fixes: 2279 passed and 1 failed. The remaining failure is `text-metrics` "matches the width Chromium draws": macOS Helvetica draws bold Vietnamese up to 3.9 px wider than the estimate, which is still inside `roomFor`'s margin. Left open for a decision.
- [x] 3. `npm run build`, commit `bin/`, `bundle-drift.test.mjs` passes; `claude plugin validate . --strict` passes.
- [ ] 4. The live round of phase 4 and the console round of phase 5, recorded in the PR body step by step.
  - Console round (Playwright `labs-ui-e2e`, the Reports section included): passed on macOS, 17 of 17.
  - Live agent round: not run. Headless `claude -p` failed with "OAuth session expired and could not be refreshed". A sample project for it is ready (`reportsDir` set to `docs/reports`, a confirmed `office` en/ja kept term, a canary file for the hostile-template case).
- [x] 5. Version 2.7.0 everywhere; PR titled `feat: release 2.7.0 with reports, report templates and glossary polish` (merged as #77).

## Verification

- `cd skills/draw/scripts && npx vitest run`
- `claude plugin validate . --strict`
- `git grep -n "2\.6\.0"` shows no stale version reference outside history and plans.

## Risks

- Docs drift from behaviour. Response: every user-facing claim names the command or test that proves it before the PR opens.
