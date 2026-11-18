---
phase: 5
title: "Labs Reports section, routes and job kinds"
status: completed
priority: P1
effort: "3d"
dependencies: [1, 2, 3, 4]
---

# Phase 5: Labs Reports section, routes and job kinds

## Goal

The labs console has a **Reports** section to list, preview, edit, restore, polish,
translate and export reports and to preview, create, customise, export and import
templates, with the agent carrying out the content jobs.

## Context

- Extension rule (`docs/architecture.md` :912-927): one `nav.mjs` entry, one view module,
  one server route group, one job kind with its labs-skill row.
- Server: route array `labs-server.mjs` :221-324 (route compiler :154), jobs routes spread
  at :323; glossary writes :284-311; `MAX_BODY` 1 MB :34; `ConfigError` → 409 :417;
  `CONSOLE_CSP` :37 (`style-src 'self'`, `frame-ancestors 'none'`); static pages: only
  `/viewer.html` gets its own CSP and frame policy (:176, :378-379), every other page gets
  `CONSOLE_CSP` and `X-Frame-Options: DENY` (:332); the change stamp `runsStamp` :188-201
  hashes runs and glossary only, and views reload only when it moves (`main.mjs:184-194`);
  `lang` is checked against a list on an existing route (:247-248).
- Viewer frame `viewer/frame.mjs`: `sandbox="allow-scripts"` :18, posts with `'*'` after a
  `ready` :34-36; page CSP `viewerCsp` :47 (includes `sandbox allow-scripts`), script hash
  :50; built in `build.mjs` :83-85; CI asserts committed pages (`ci.yml:68`).
- Jobs: `kindSpecs` `labs-jobs.mjs` :60-77; every job already has `report`, the agent's
  closing text (`queue` :262, `done` :437, shown by `job-panel.mjs:32,145`,
  `views/jobs.mjs:119`); `job.run` is read by `wellFormed` :146-148, attachments :387,
  `holds` :476, `summary` :479, `question-card.mjs:22,90`; apply-edit binds to `baseRev`
  :71. `KIND_LABEL` `labs-ui/words.mjs` :9-10. `api.mjs` :49-55 has get/post/patch/del/blob, no put.
- UI: `SECTIONS` `nav.mjs` :11-16 (asserted exactly by `labs-ui.test.mjs:373`); a section
  returns `{ element, reload, title, store, route }` (`views/glossary.mjs` :47, :254-257).

## Files to Create / Modify

- Create: `skills/draw/scripts/src/labs-reports.mjs` (listing and details for the server, mirroring `labs-runs.mjs`)
- Modify: `skills/draw/scripts/src/labs-server.mjs` (report and template route group; per-page policy for static pages; change stamp; `/api/state` gains `reportsDir`, report count, `reportsConfigError`)
- Modify: `skills/draw/scripts/src/labs-jobs.mjs` (four kinds; `reportName` field; kind-aware target dir; `holds` for reports)
- Create: `skills/draw/scripts/src/labs-ui/report-frame/` and the built page `bin/labs-ui/report-frame.html`
- Modify: `skills/draw/scripts/build.mjs` (build and inline the report frame page), `.github/workflows/ci.yml` (:68 asserts `report-frame.html`)
- Create: `skills/draw/scripts/src/labs-ui/views/reports.mjs`, `report-detail.mjs`, `report-templates.mjs`, `new-report.mjs`
- Modify: `skills/draw/scripts/src/labs-ui/nav.mjs`, `words.mjs`, `api.mjs` (`put`), `views/overview.mjs`, `views/jobs.mjs`, `views/job-panel.mjs`, `views/question-card.mjs` (report jobs link to their report)
- Create: `tests/labs-reports.test.mjs`; modify `tests/labs-server.test.mjs`, `labs-jobs.test.mjs`, `labs-ui.test.mjs` (:373 sections list), `labs-ui-e2e.test.mjs`, `labs-project.mjs` (reports in the test project)

## Routes

| Method and path | Does |
|---|---|
| `GET /api/reports` | list: name, title, kind, template, lang, translations, updated, findings count |
| `GET /api/reports/:name` | detail: meta, revisions, translations, drafts, glossary findings (`checkProse`) |
| `GET /api/reports/:name/source[?lang=]` | `report.md` text and its `rev` (SHA-256) |
| `PUT /api/reports/:name/source[?lang=]` | quick edit: body `{ text, rev }`; 409 on a stale `rev`; refused while a report job is queued or open for it or a draft is pending apply; snapshot, per-block secret scan, write, re-render |
| `POST /api/reports/:name/restore` | body `{ revision, rev }`; same refusals; snapshot, `restoreReport`, re-render (decided 2026-11-19) |
| `GET /api/reports/:name/html[?lang=]` | the rendered HTML as data for the sealed frame |
| `GET /api/reports/:name/diff?from=&to=` | line diff; `from`/`to` are `current`, revision names or draft names from the listings |
| `GET /api/reports/:name/download?format=md\|html[&lang=]` | file download |
| `GET /api/report-templates` | every template with scope, override marks, validity and reasons |
| `GET /api/report-templates/:id/preview?scope=` | sample rendered through the template |
| `GET /api/report-templates/:id/export?scope=` | the export file |
| `POST /api/report-templates/import` | body: export file and `{ scope, replace }`; `?check=1` writes nothing and returns validation and preview |

`:name`, `lang` (the report's translation listing, or the known languages when a translate
job creates one), `revision`, `from`, `to` (revision and draft listings), `scope` (the three
names) and `:id` (the template listing) are all looked up, never joined; bodies stay under
`MAX_BODY`. <!-- Updated: Red Team Session 1 - query values looked up; restore route -->

## Tasks & Steps

- [x] 1. `labs-reports.mjs`: `listReports`, `reportDetail`, `reportSource`, `reportHtml`, `reportDiff` over `reports.mjs`; a bad `reportsDir` yields `reportsConfigError` in state and 409 on report routes, while run routes keep working.
- [x] 2. Jobs: kinds `report-write` (template, kind, title, lang, runs, notes), `report-polish` (reportName, optional `apply: { draft, baseRev, draftRev }`), `report-translate` (reportName, lang), `report-template` (mode new|customise, from, scope, description). The report name lives in a new field `reportName`, checked by `wellFormed`; `report` keeps its meaning (the agent's closing text) and is tested to survive `done` beside `reportName`. `forAgent` adds `reportDir` (and the scope root for template jobs); attachments and `question-card` work for jobs without `run`; `holds` answers for a report, so the quick edit, restore and a chat polish see a queued or open report job. <!-- Updated: Red Team Session 1 - reportName -->
- [x] 3. Sealed report frame: static pages get a per-page policy map in the server (CSP header, frame policy `SAMEORIGIN` for the frame pages, no `X-Frame-Options: DENY` for them). `report-frame.html` CSP: `sandbox allow-scripts allow-modals; default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src 'sha256-<own>'; frame-ancestors 'self'`. The console frames it with `sandbox="allow-scripts allow-modals"` (opaque origin, no token, `print()` allowed), creates a fresh frame for each document it shows and posts only to that frame's window after its own `ready`; inside, links are inert (no navigation; the URL is shown on hover). Print to PDF calls `print()` inside the frame. <!-- Updated: Red Team Session 1 - per-page policy, allow-modals, inert links -->
- [x] 4. Change stamp: `runsStamp` (or a sibling `reportsStamp` in the same `change` value) also hashes `reportsDir` and the modification times of each report's `report.md`, `report.json`, `drafts/`, `history/` and `<lang>/`, so views reload when the agent writes. <!-- Updated: Red Team Session 1 - reload on report writes -->
- [x] 5. Views: **Reports** list (cards and table like Diagrams, with findings badges); **report page** with tabs Preview (sealed frame, language switch), Source (Markdown editor with save, conflict and held messages), Glossary (findings with line links and "Polish with glossary"), History (revisions with diffs, Restore), Files, and header actions Export HTML, Export Markdown, Print to PDF, Translate; a pending polish draft shows its diff with Apply (queues `report-polish` with `apply`) and Discard (`discardDraft`); **New report** form (kind and template tiles with previews, title, language, runs to embed, notes); **Templates** tab (list by scope with override, clone and validity marks, preview in the sealed frame, Customise and New queue `report-template`, Export downloads, Import uploads with a dry-run preview and validation errors before saving).
- [x] 6. Overview: reports with blocking findings and polish drafts waiting appear under "Needs you"; counts of reports and templates.
- [x] 7. Tests: server routes (list, source round-trip with `rev` conflict, quick edit and restore refused while a report job is queued or open, `lang=../x` and `from=../../x` refused, import dry run and refusals, bad `reportsDir` isolation, report frame headers), jobs (validation of the four kinds, `reportName` and `report` both kept after `done`, `reportDir` handed to the agent, polish apply refused on a changed `baseRev`), UI unit tests for the views and the sections list, and Playwright e2e: open Reports, preview a report in the sealed frame (inline styles applied, no script ran, a link click does not navigate), Print opens the print dialog (or `print()` is called, asserted through a page hook), edit and save Source, see a polish diff and apply it, restore a revision, preview and import a template.

## Verification

- `cd skills/draw/scripts && npx vitest run tests/labs-reports.test.mjs tests/labs-server.test.mjs tests/labs-jobs.test.mjs tests/labs-ui.test.mjs`
- `npm run build && npx vitest run tests/labs-ui-e2e.test.mjs tests/bundle-drift.test.mjs`
- Live: `/zukai:labs` in the sample project; queue each report job kind from the console and see it carried out by the attached agent and the view update without a manual reload.

## Risks

- Chromium's handling of `print()` in a sandboxed frame. Signal: the e2e print check fails. Response: print from a new window opened by the console with the report HTML and the same CSP; never loosen `CONSOLE_CSP`.
- Quick edits racing a job. Response: `rev` checks, `holds` covering queued and open report jobs and pending drafts; tested.

## Security

- The frame pages have an opaque origin and no token; the API refuses their Origin (the viewer's existing protection); report content is posted only to the frame the console just created.
- Import is validated in full before anything is written; the dry run writes nothing.
