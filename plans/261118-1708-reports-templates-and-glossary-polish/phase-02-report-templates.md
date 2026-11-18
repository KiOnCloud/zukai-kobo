---
phase: 2
title: "Report templates: scopes, HTML layout, export and import"
status: pending
priority: P1
effort: "2d"
dependencies: [1]
---

# Phase 2: Report templates: scopes, HTML layout, export and import

## Goal

Templates exist in three scopes with an HTML layout and sample content, are validated as
untrusted input every time they are read or written, resolve nearest-first, are saved by
the agent through a validating command, and round-trip through one export file.

## Context

- User scope lives beside the run index: `indexHome()` in `run-index.mjs:34`.
- Copied installs rename skill folders (`install.sh:57`: `draw:zukai`, and the report skill
  will be `zukai-report`); each copy holds a version marker such as `.zukai-revise-version`.
  The labs skill already resolves both layouts (`skills/labs/SKILL.md:24-30`).
- `.zukai/` can come with a clone (`labs-server.mjs:117`), so project templates are untrusted.
- Command groups take two words (`cli.mjs:274`, `:284-292`); three-word commands do not parse.
- Precedents for ids and folder names: `^g-[0-9a-f]{8}$` (`glossary-v1.schema.json:26`) and
  `checkRunsDir` (`project-config.mjs:67-91`).

## Template contract

```
<id>/
  template.md    front matter: id, name, kind, lang, description, version
                 one "## <Section>" per section, each followed by
                 <!-- zukai:section id="<section-id>" guide="what this section must hold" [embed="diagram|tables"] -->
  template.html  markup and CSS only; placeholders {{title}}, {{meta}}, {{toc}},
                 {{section:<section-id>}} and {{sections}}
  sample.json    { "title": "...", "meta": {...}, "sections": { "<section-id>": "<markdown>" } }
```

- Template id and section ids match `^[a-z0-9][a-z0-9-]{0,63}$`. <!-- Updated: Red Team Session 1 - id pattern -->
- A report's `report.md` keeps id-only markers `<!-- zukai:section id="..." -->`; guides stay
  in the template and never enter a report or a translation. <!-- Updated: Red Team Session 1 - id-only markers -->

Export file `<id>.zukai-template.json`: `{ "zukaiTemplate": 1, "id", "name", "version",
"exported", "files": { "template.md": "...", "template.html": "...", "sample.json": "..." } }`.

## Files to Create / Modify

- Create: `skills/draw/scripts/src/report-templates.mjs`
- Create: `skills/draw/scripts/src/schema/report-template-v1.schema.json` (front matter, sample, export file)
- Create: `skills/report/templates/issue-investigation/`, `tech-research/`, `feature/` (three files each)
- Modify: `skills/draw/scripts/src/cli.mjs` (group `template list|show|preview|validate|save|export|import`) <!-- Updated: Red Team Session 1 - validate and save, two-word group -->
- Modify: `skills/draw/scripts/src/reports.mjs` (`newReport` and `renderReport` take a resolved template)
- Create: `skills/draw/scripts/tests/report-templates.test.mjs`, `report-templates-e2e.test.mjs`

## Tasks & Steps

- [ ] 1. Scope roots: project `.zukai/report-templates/`, user `<indexHome()>/report-templates/`, built-in found from the CLI's location by the first of: `<draw-dir>/../report/templates` in the plugin layout (the plugin's `skills/report/`), or `<draw-dir>/../zukai-report/templates` when that folder holds `.zukai-report-version` with the CLI's own version. A folder that matches neither is never read as built-in. <!-- Updated: Red Team Session 1 - copied installs and version marker -->
- [ ] 2. `validateTemplate(files)` runs on every read and every write (list, resolve, preview, render, save, import): front matter against the schema with the id pattern; the id in the export file equals the front-matter id and the folder name; section ids unique and matching the placeholders (unknown placeholders refused); `template.html` safety: refuse `<script`, `<iframe`, `<object`, `<embed`, `<base`, `<form`, `<link`, `<meta http-equiv`, any `on*=` attribute, `javascript:`/`vbscript:` URLs, `url(`/`src`/`href` that is not `data:` or `#`, `@import`; size caps (template.html 256 KB, each data URI 128 KB, export file 1 MB); `scanSecrets` per string; guide and sample text bounded and free of control or direction characters (the glossary's rules). An invalid template is listed with its reasons and is never used. <!-- Updated: Red Team Session 1 - validate on every read -->
- [ ] 3. `resolveTemplate(root, id)` nearest-first (project, user, built-in). `listTemplates` marks for each id the one used and the ones it overrides; a project template that overrides a built-in one is flagged as such, so a template that came with a clone is visible. <!-- Updated: Red Team Session 1 - flag clone overrides -->
- [ ] 4. `saveTemplate(root, scope, files, { replace })` (CLI `template save <folder> --scope user|project [--replace]`) validates, then writes through temp-and-rename under `report-templates.lock` in the scope root, after a real-path check that the target folder is a direct child of the scope root. A built-in template is never written; customising one saves a copy to user or project scope. `template validate <folder>` prints the result without writing. <!-- Updated: Red Team Session 1 - save and validate commands, path check -->
- [ ] 5. `exportTemplate(root, id, { scope })` writes `<id>.zukai-template.json`; `importTemplate(root, file, { scope, replace, check })` validates the whole file before writing, refuses an existing id without `replace`, reports what it replaced, and with `check` writes nothing and returns the validation and the preview.
- [ ] 6. `previewTemplate(root, id, { scope })` renders `sample.json` through `template.html` with phase 1's renderer (CLI `template preview <id> --out <file>`; the console uses the same function).
- [ ] 7. Built-in templates, each with an HTML layout (cover, metadata block, table of contents, print styles with page breaks before level-one sections) and sample content:
  - issue investigation: summary, symptoms, impact, timeline, root cause, evidence, fix, prevention, open questions
  - tech research: question, context, options, criteria, findings, comparison, recommendation, references
  - feature: background, requirements, design (`embed="diagram"`), data and description tables (`embed="tables"`), scope and non-goals, test plan, risks, rollout
- [ ] 8. Document the template contract and the Markdown subset in `skills/report/references/templates.md` (used by phase 4).

## Verification

- `cd skills/draw/scripts && npx vitest run tests/report-templates.test.mjs`
- `npm run build && npx vitest run tests/report-templates-e2e.test.mjs tests/bundle-drift.test.mjs`
- Cases: each built-in validates and previews; built-ins resolve from a copied install made by `install.sh` and `install.ps1` into a temp folder, and an unrelated `skills/report/templates` without the marker is ignored; a project template overrides a user and a built-in one with the same id, `list` names all three and flags the project override; export then import into another `ZUKAI_HOME` gives identical files; import refuses `"id": "../../x"`, `CON`, an id that differs from the front matter, `<script>`, `onload=`, `href="https://..."`, `@import`, an oversized data URI and an existing id (accepted with `--replace`); a hand-placed invalid project template is listed as invalid and refused by `report new`; saving over a built-in without a scope is refused.

## Risks

- A blocklist of HTML can miss a vector. Signal: a red-team or test case passes an executable construct. Response: the sealed frame (phase 5) and the CSP meta (phase 1) are the second and third walls; widen the refusal list and add the case as a test.
- User scope on a shared machine: templates there are personal by design, never committed. Documented in phase 6.
