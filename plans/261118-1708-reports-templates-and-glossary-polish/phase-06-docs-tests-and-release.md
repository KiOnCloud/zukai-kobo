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
- [ ] 2. Full suite on Linux (CI) and on Windows (local): no failure new to this branch; the five Windows-only failures known on `main` (`install-ps1`, `preview`, `sources`) are reported, not hidden.
- [x] 3. `npm run build`, commit `bin/`, `bundle-drift.test.mjs` passes; `claude plugin validate . --strict` passes.
- [ ] 4. The live round of phase 4 and the console round of phase 5, recorded in the PR body step by step.
- [ ] 5. Version 2.7.0 everywhere; PR titled `feat: release 2.7.0 with reports, report templates and glossary polish`.

## Verification

- `cd skills/draw/scripts && npx vitest run`
- `claude plugin validate . --strict`
- `git grep -n "2\.6\.0"` shows no stale version reference outside history and plans.

## Risks

- Docs drift from behaviour. Response: every user-facing claim names the command or test that proves it before the PR opens.
