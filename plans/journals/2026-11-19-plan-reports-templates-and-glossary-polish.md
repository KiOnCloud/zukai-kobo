---
title: "Plan reports, templates and glossary polish"
date: 2026-11-19
summary: "Six-phase plan for reports with templates and a labs Reports section; red team found 15 issues, all applied"
---

# Plan reports, templates and glossary polish

## What happened

Planned the reports feature on branch `claude/reports-and-templates` (from main 41de5b4,
release 2.6.0): plan `plans/261118-1708-reports-templates-and-glossary-polish/`, six phases
(reports folder and revisions, templates, glossary on prose, report skill, labs Reports
section, docs and release 2.7.0), from the accepted brainstorm
`plans/reports/brainstorm-261118-2349-reports-and-glossary-polish.md`.

A scout mapped the seams; four red-team reviewers (security, failure modes, assumptions,
scope and contracts) returned 37 findings, grouped into 15 and all accepted. The three
critical ones:

- `job.report` already holds the agent's closing text (`labs-jobs.mjs:262`, `:437`); report
  jobs use a new `reportName` field.
- A template id from an import file became a folder name with no pattern, so an import
  could write outside its scope (for example into `.claude/agents/`).
- Built-in templates were looked up at `../report`, which copied installs rename to
  `zukai-report`; they are now found through the plugin layout or the version marker.

Other fixes that changed the design: `readProjectConfig` keeps `ok` runs-only for its 11
callers and adds `reports: { ok, dir, error }`; report-only projects register through
`registerProject`; the sealed report frame needs a per-page server policy and
`allow-modals` to print; revisions get a lock for the second writer; polish drafts bind to
`baseRev`/`draftRev`; the change stamp includes reports; prose matching treats Latin next to
Kana as a boundary and masks an entry's own term.

## Decision

`marked` bundled into `bin/cli.mjs` (raw HTML off); the server restores a revision like the
quick edit, after a snapshot; `reportsDir` defaults to `reports`; release 2.7.0. Recorded in
the plan's Validation Log.

## Next steps

Implement with `/ak-cook` on the plan, phase by phase; the plan and brainstorm files are not
committed yet.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
