---
title: "Reports, report templates and glossary polish"
description: "Write reports of any kind from templates with an HTML version, in the chat (/zukai:report) and in a new Reports section of the labs console, and finish them with the glossary: a polish job rewrites non-standard words with the confirmed terms behind a diff, and translation keeps the terms a language keeps."
status: in-progress
priority: P2
effort: 10d
branch: claude/reports-and-templates
tags: [feature, cli, skills, labs, glossary]
blockedBy: []
blocks: []
created: 2026-11-19
---

# Reports, report templates and glossary polish

## Overview

Zukai gains reports: an issue investigation, a tech research, a feature write-up or any kind
a template describes. A report is written by the new report skill from a template, kept as
Markdown with revisions, rendered to HTML (the default output, printable to PDF) through
the template's own HTML layout, and finished against the project glossary. Templates live in
three scopes (project, user, built-in), are created and customised through Claude, previewed
as HTML in the console, and exported and imported as one file. The labs console gets a
**Reports** section that lists, previews, edits, polishes, translates and exports reports
and manages templates.

Contract, decisions and options: [brainstorm report](../reports/brainstorm-261118-2349-reports-and-glossary-polish.md).
Scope mode: HOLD SCOPE (no `--yagni`); everything the brainstorm accepted is planned.

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | [Reports folder, report contract and revisions](./phase-01-reports-dir-and-report-folders.md) | Completed |
| 2 | [Report templates: scopes, HTML layout, export and import](./phase-02-report-templates.md) | Completed |
| 3 | [Glossary on prose: check, keep terms, translations](./phase-03-glossary-on-prose.md) | Completed |
| 4 | [Report skill and its closing contract](./phase-04-report-skill.md) | Completed (live agent round not run) |
| 5 | [Labs Reports section, routes and job kinds](./phase-05-labs-reports-section.md) | Completed (Playwright round not run locally; checked in headless Chrome) |
| 6 | [Docs, tests sweep and release 2.7.0](./phase-06-docs-tests-and-release.md) | In progress (released in #77; CI, macOS and Playwright done; live agent round pending) |

Order: 1 → 2 → 3 → 4 → 5 → 6. Phases 2 and 3 both build on phase 1 and touch different
modules (`report-templates.mjs`, `glossary.mjs`), so they may run in parallel; phase 4 needs
both; phase 5 needs 1–4; phase 6 closes.

## Key design decisions

- **One owner module per contract**, as `glossary.mjs` owns the glossary: `reports.mjs`
  (folders, `report.json`, drafts, revisions, render), `report-templates.mjs` (scopes,
  validation, save, export/import), `report-markdown.mjs` (bundled `marked` with raw HTML
  off and link and image rules), and a prose source in `glossary.mjs`.
- **Runs keep their config meaning.** `readProjectConfig` keeps `ok`, `error` and `runsDir`
  exactly as in 2.6.0 for its 11 callers and adds `reports: { ok, dir, error }`, so a bad
  `reportsDir` stops report commands only; overlap of the two folders is checked both ways.
- **No new runtime dependency for users.** `marked` (already in the lockfile) is bundled into
  `bin/cli.mjs` (decided 2026-11-19); PDF is the browser's print of the HTML.
- **Report jobs carry `reportName`.** `job.report` already holds the agent's closing text and
  keeps that meaning; `forAgent` hands the agent `reportDir`; `holds` covers reports.
- **Templates are untrusted input**: an id pattern, validation on every read and write, a
  real-path check on save, built-ins found only through the plugin layout or the copied
  install's version marker, and guides and samples treated as data, never instructions.
- **Report HTML is shown in a sealed page of its own** (`report-frame.html`): opaque origin,
  its one script by hash, inline styles and `data:` images, `allow-modals` for printing,
  inert links, served with a per-page policy. The console CSP (`style-src 'self'`) cannot
  show a template's styles.
- **The server writes report content only for the quick Markdown edit and a restore**, each
  after a revision snapshot and refused while a report job or a pending draft holds the
  report (decided 2026-11-19). Writing, polishing, translating and template drafting are
  agent jobs; template import and export are deterministic server calls, as glossary writes are.
- **Release 2.7.0** (decided 2026-11-19).

## Success criteria

The nine acceptance criteria of the brainstorm contract, each mapped to the phase that
proves it:

- [ ] 1. `/zukai:report` writes each built-in kind into `reportsDir` with `report.md`, `report.html`, `report.json` — phases 1, 4 (CLI and console side proven by tests; the live agent round is pending)
- [x] 2. Every template previews as HTML with its sample; `report.html` takes the template's layout — phases 2, 5
- [ ] 3. Templates created or customised through Claude land in the named scope; nearer scope wins and is named — phases 2, 4, 5 (CLI and console side proven by tests; the live agent round is pending)
- [x] 4. Export then import round-trips; unsafe HTML is refused; an existing id is kept unless `--replace` — phase 2
- [x] 5. The Reports section lists, previews, exports (HTML, Markdown, PDF), shows history and diffs, and queues the four job kinds — phase 5
- [ ] 6. An avoided word is found by `report check`, rewritten by the polish job, shown as a diff and applied as a revision — phases 3, 4, 5 (CLI and console side proven by tests; the live agent round is pending)
- [ ] 7. A term kept across languages (`en`/`ja` "office") survives translation and a changed one is flagged — phases 3, 4 (CLI and console side proven by tests; the live agent round is pending)
- [x] 8. An unusable `reportsDir` stops report commands with `bad-config` and writes nothing — phase 1
- [x] 9. Tests cover the modules, prose check, templates, console (unit and Playwright) and jobs; bundle drift passes — every phase, swept in 6 (Playwright and the full suite run on macOS 2026-11-19)

## Red Team Review

### Session — 2026-11-19
**Findings:** 15 groups from 37 reviewer findings (15 accepted, 0 rejected; every finding cited file:line evidence that held up)
**Severity breakdown:** 3 Critical, 10 High, 2 Medium
**Reviewers:** Security Adversary, Failure Mode Analyst, Assumption Destroyer, Scope & Complexity Critic

| # | Finding | Severity | Disposition | Applied To |
|---|---------|----------|-------------|------------|
| 1 | `job.report` already holds the agent's closing text | Critical | Accept | plan, Phase 5 |
| 2 | Template id from an import becomes a folder name (path escape) | Critical | Accept | Phase 2 |
| 3 | Built-in templates not found in copied installs | Critical | Accept | Phases 2, 4 |
| 4 | Config split left `ok` undefined for 11 callers; overlap checked one way | High | Accept | plan, Phase 1 |
| 5 | Report-only projects never registered; scan counts stray folders | High | Accept | Phase 1 |
| 6 | Sealed frame blocked by static headers; `print()` ignored in sandbox; links navigate | High | Accept | plan, Phase 5 |
| 7 | Revisions with two writers race and rotate; undo had no write path | High | Accept | Phases 1, 4, 5 |
| 8 | Polish apply could overwrite later edits | High | Accept | Phases 4, 5 |
| 9 | No validated save command; three-word commands do not parse | High | Accept | Phases 2, 4 |
| 10 | Clone templates unvalidated; guides could steer the agent | High | Accept | Phases 2, 4 |
| 11 | Secret scan stops at the first match; agent writes bypass it | High | Accept | Phases 1, 4 |
| 12 | `lang`, `from`, `to` query values become path parts | High | Accept | Phase 5 |
| 13 | Console does not reload on report writes | High | Accept | Phase 5 |
| 14 | Prose matching: Latin next to Kana, avoid inside own term, markers, relative images | Medium | Accept | Phases 1, 3 |
| 15 | Requested items missing: kind, tables embed, viewer-link fallback, untranslated terms, CI bundle check | Medium | Accept | Phases 1, 3, 5 |

## Validation Log

### Session 1 — 2026-11-19
Questions asked: 4.

| Question | Decision |
|---|---|
| Apply the red-team findings? | Apply all 15 |
| Markdown renderer | `marked`, bundled into `bin/cli.mjs`, raw HTML off |
| Who restores a report revision from the console | The server, after a snapshot, like the quick edit |
| Release version | 2.7.0 |

Propagated to phases 1, 2, 4, 5 and 6 with `<!-- Updated: ... -->` markers.

### Whole-Plan Consistency Sweep
- Files reread: plan.md, phase-01 … phase-06
- Decision deltas checked: 9 (`reportName`; `reports` config result; overlap both ways; `marked`; restore route; `template` command group with validate and save; id pattern and validation on read; per-page frame policy with `allow-modals`; drafts with `baseRev`/`draftRev`)
- Reconciled stale references: 0 remaining (searched for the old renderer, `job.report`, three-word template commands, the old built-in path and the old job count)
- Unresolved contradictions: 0

## Code review

### Session — 2026-11-19 (after implementation)
A reviewer agent reproduced two High findings and one Medium; all fixed with regression tests.

| # | Finding | Severity | Fix |
|---|---------|----------|-----|
| 1 | A validated template could redirect `report.html` (`http-equiv` with `>` in a quoted value) and push the CSP `<meta>` into a comment | High | CSP meta written right after the doctype; `http-equiv`, foreign `<meta>` attributes, backslashes, `image-set` and CSS character references refused |
| 2 | Saving through a linked `.zukai/report-templates` could replace a folder outside the project | High | the scope folder and its base must be real folders at their expected real path |
| 3 | A report folder without `report.md` broke the console's Reports list | Medium | listed as `broken`; source route answers 404 |
| 4 | Links followed for `report.md`, `report.html` and history files | Low | real-file checks before each read |
| 5 | Two `report new` at once could share a folder | Low | folder made exclusively, next name on EEXIST |
| 6 | Device names accepted as language tags | Low | `LANG_RE` refuses `con`, `prn`, `aux`, `nul` |
| 7 | Console import check never said the id exists | Low | the check sends the scope; the frame is disposed |
| 8 | Entity references shown literally | Low | text keeps a character reference as one |
| 9 | `runs-dir set reports` refused in every project | Low | kept: the plan's decision checks the overlap both ways against the effective reports folder |
| 10 | Every state poll and listing reads all reports | Low | left as is for tens of reports; a cache by modification time is the next step if needed |

