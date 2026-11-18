---
phase: 1
title: "Reports folder, report contract and revisions"
status: completed
priority: P1
effort: "1.5d"
dependencies: []
---

# Phase 1: Reports folder, report contract and revisions

## Goal

A project has a `reportsDir` (default `reports`) and the CLI can scaffold, list, snapshot,
restore, diff and render report folders, while every run command behaves exactly as in
2.6.0, whatever the state of `reportsDir`.

## Context

- `project-config.mjs`: `readProjectConfig` :97-120 returns one result for the whole file;
  `checkRunsDir` :67-91; `runsPath` :130; `projectOfRun` :161-180; `setRunsDir` :185-211
  keeps unknown keys (:194); `runDirAt` :223-231 matches any `yyyymmdd_slug` folder (`RUN_RE` :25).
- `readProjectConfig` has 11 production callers that read `ok`, `error` and `runsDir`:
  `cli.mjs:854,960`; `labs-lifecycle.mjs:27`; `labs-server.mjs:191,224`;
  `run-index.mjs:79,166`; `project-config.mjs:124,167,186,218`; tests
  `project-config.test.mjs:21,24,29,59`.
- `revisions.mjs` is run-specific (`checkRun` :112-118; restore deletes draw.io/Mermaid
  outputs :276) and assumes one writer (:34-36): it numbers revisions without a lock (:126)
  and removes every `.rNNN.tmp-*` folder (:145-147). Reusable pieces: `REV` :39,
  `revisionDirs` :102, `timeline` :70-93, `filesUnder` :96, temp-and-rename :155-179.
- `run-index.mjs`: `registerProject` :117-127, `scanProjects` :154-188 (an `owned` set of
  runs folders, :165-170). `registerRunProject` in `cli.mjs` :942-953 goes through
  `runDirAt` and `projectOfRun`, which cannot match a report folder and swallows the miss.
- `scan-secrets.mjs` `scanSecrets` :120 gives one finding per string (first pattern, first
  match, :123-133); only `DEFINITE_KINDS` (:17) refuse a write.
- CLI dispatch: if-chain in `main` :397-827; command groups `GROUPS` :274 take two words
  (`glossary list`); options in `COMMAND_OPTIONS` :236-271 (a command missing there accepts
  every option, :303, so every new command gets an entry).

## Files to Create / Modify

- Modify: `skills/draw/scripts/src/project-config.mjs` (`reports` result, `checkReportsDir`, `reportsPath`, `setReportsDir`, nesting checks both ways)
- Create: `skills/draw/scripts/src/reports.mjs` (folder contract, `report.json`, drafts, revisions, render)
- Create: `skills/draw/scripts/src/report-markdown.mjs` (wrapper over bundled `marked`: raw HTML off, escaping, link and image rules)
- Create: `skills/draw/scripts/src/schema/report-v1.schema.json`
- Modify: `skills/draw/scripts/src/revisions.mjs` (extract the shared helpers; run behaviour unchanged)
- Modify: `skills/draw/scripts/src/run-index.mjs` (reports count as holding work)
- Modify: `skills/draw/scripts/src/cli.mjs` (`reports-dir [set]`; group `report new|list|snapshot|restore|diff|render|check`)
- Modify: `skills/draw/scripts/package.json`, `package-lock.json` (`marked` as a pinned devDependency; bundled into `bin/cli.mjs`)
- Create: `skills/draw/scripts/tests/reports.test.mjs`, `report-markdown.test.mjs`, `reports-e2e.test.mjs`
- Modify: `skills/draw/scripts/tests/project-config.test.mjs`, `run-index.test.mjs`, `revisions.test.mjs`

## Report folder contract

```
<reportsDir>/<yyyymmdd>_<slug>/
  report.md          source the agent, the quick edit and a restore write
  report.html        rendered output (default deliverable), self-contained, print styles
  report.json        { report: 1, title, kind, template: { id, scope, version }, lang, runs: [...], sources: [...], created, updated }
  assets/            files a report may inline (png, jpg, svg, webp), each at most 2 MB
  <lang>/report.md   translations, rendered to <lang>/report.html
  drafts/            polish drafts: polish-<n>.md with polish-<n>.json { baseRev, draftRev, findings }
  history/rNNN/      snapshots of report.md and translations with revision.json
```

A folder is a report only when it holds a valid `report.json`; that is what listings,
`runDirAt`-like matching and the index scan count. <!-- Updated: Red Team Session 1 - report.json marks a report -->

## Tasks & Steps

- [x] 1. Config without breaking runs: `readProjectConfig` keeps `ok`, `error` and `runsDir` with their 2.6.0 meaning (runs only) and adds `reports: { ok, dir, error }`. A shape error (not an object, `config` not 1) still sets both. `runsPath` throws only when runs are unusable; `reportsPath` only when `reports.ok` is false. Each of the 11 callers above keeps its behaviour, proven by an unchanged expectation or a new test per caller. <!-- Updated: Red Team Session 1 - ok stays runs-only -->
- [x] 2. `checkReportsDir`: the `checkRunsDir` rules, plus no overlap with `runsDir` (equal, or one inside the other). `setRunsDir` checks the same overlap against the effective `reportsDir`. With `reportsDir` unset and the default `reports` overlapping a 2.6.0 project's `runsDir`, report commands stop with `bad-config` and a hint to run `reports-dir set <folder>`; run commands are untouched. <!-- Updated: Red Team Session 1 - overlap both ways and upgrade case -->
- [x] 3. `setReportsDir` mirrors `setRunsDir` (warns, never moves reports); `reports-dir [set <folder>]` mirrors `runs-dir`.
- [x] 4. Revisions: extract the helpers that are not run-specific (names, timeline, rotation, temp-and-rename) so runs and reports share them, run tests unchanged. For reports, add what a second writer needs: a lock file (`<report>/.revisions.lock`, the glossary's lock pattern) around snapshot and restore; temporary folders removed only when older than ten minutes; `keep` 20 for reports; a snapshot made by a quick edit never rotates out the snapshot taken before the last polish or translation. <!-- Updated: Red Team Session 1 - lock, temp age, keep -->
- [x] 5. `reports.mjs`: `reportNames`, `reportPath` (names looked up in a listing, never joined), `newReport({ root, template, kind, title, lang, runs })`, `readReport`/`writeReportMeta` validated against `report-v1`, `translationLangs`, `draftNames`, `snapshotReport`, `restoreReport` (snapshot first, then copy back), `diffReport(from, to)` where `from`/`to` are revision names, draft names or `current`, each looked up in its listing, `listReports`, `discardDraft`. Drafts older than the newest applied or discarded polish are removed when a new polish starts. <!-- Updated: Red Team Session 1 - drafts and listings -->
- [x] 6. `report-markdown.mjs` on `marked` (decided 2026-11-19): raw HTML in Markdown rendered as text; links only `http:`, `https:` or in-page `#`, `//` refused; images only `data:` or a file listed in the report's `assets/`; heading ids for the table of contents. The template's section markers are recognised and stripped from output. <!-- Updated: Validation Session 1 - marked bundled; Red Team Session 1 - link and image rules -->
- [x] 7. `renderReport(reportDir, { template })` pours the rendered sections into `template.html` (phase 2 placeholders; a minimal default layout when no template is given) and writes `report.html` whose first child of `<head>` is the CSP `<meta>` (`default-src 'none'; style-src 'unsafe-inline'; img-src data:`), before any template markup. Embeds: `embed="diagram"` inlines the run's exported SVG or PNG when present, else a link to the run in the console viewer and a note that a renderer (draw.io desktop or Playwright) makes the picture, as `export` already says; `embed="tables"` inlines the run's description tables (`<run-slug>.doc.md`, or `.doc.<lang>.md` for the report's language). Inlined assets are size-capped. <!-- Updated: Red Team Session 1 - tables embed, viewer-link fallback, CSP first -->
- [x] 8. Secret scan per block, not per file: `report.md`, every translation and every draft are split into blocks (the prose splitter of phase 3, here in its simplest form: paragraphs and lines) and each block is scanned; a definite finding refuses the write the CLI makes and is a blocking finding of `report check` and `report render`, so agent writes are caught at the closing contract. The rendered HTML is scanned before it is written. <!-- Updated: Red Team Session 1 - per-block scan -->
- [x] 9. Index: `report new` and `reports-dir set` call `registerProject(projectRoot(root))` directly, as `runsDirCommand` does (`cli.mjs:975`); `registerRunProject` is unchanged. `scanProjects` adds the reports folder to its `owned` set and counts it only when a subfolder holds a valid `report.json`. <!-- Updated: Red Team Session 1 - register report-only projects -->
- [x] 10. `COMMAND_OPTIONS` entries for every new command; `bad-config` printed as for `runs-dir`.

## Verification

- `cd skills/draw/scripts && npx vitest run tests/project-config.test.mjs tests/reports.test.mjs tests/report-markdown.test.mjs tests/revisions.test.mjs tests/run-index.test.mjs`
- `npm run build && npx vitest run tests/reports-e2e.test.mjs tests/bundle-drift.test.mjs`
- Cases that must exist: a bad `reportsDir` with a good `runsDir` lets `bundle`, `index list`, `labs start` and `/api/state` work and refuses `report new` (exit 1, `bad-config`, nothing written); `runs-dir set reports/diagrams` refused while `reportsDir` is `reports`; a 2.6.0 project with `runsDir: "reports"` keeps every run command; the renderer escapes `<script>` in text and in a table cell and refuses `//evil.example`; `![](../../.env)` is not inlined; two concurrent snapshots of one report both succeed in order; a quick-edit storm does not rotate out the pre-polish snapshot; a restore brings back the exact bytes; a secret on line 40 after a harmless "token:" on line 1 is found; a report-only project is registered and a stray `reports/20240101_x/` without `report.json` is not.

## Risks

- `marked` upgrades can change output. Signal: render snapshots change after a lockfile update. Response: pin the version; render tests assert structure, not whole strings.
- Run behaviour must not change. Signal: any changed expectation in existing run, index or labs tests. Response: add, never alter; stop and replan if a run expectation must change.

## Security

- Names, languages, revisions and drafts are looked up in listings, never joined into paths.
- No raw HTML from Markdown; only listed assets are inlined; the CSP meta comes first in `report.html`.
