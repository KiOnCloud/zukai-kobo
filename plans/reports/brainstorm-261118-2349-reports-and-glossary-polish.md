---
type: brainstorm
date: 2026-11-18
topic: Reports with templates, a Reports section in the labs console, and glossary-driven polish
base: main at 41de5b4 (release 2.6.0)
status: accepted, ready to plan
---

# Brainstorm: reports, report templates and glossary polish

## Request

Add a report feature to Zukai: write reports (issue investigation, tech research, feature
write-up and other kinds) from report templates. It needs a command called like the other
skills, a new section in the labs console to operate it and preview the result, and the
glossary as the tool that finishes a report: words that are not standard (generic AI
wording, inconsistent translations) are replaced by the project's standard terms.

## Decisions taken with the user (2026-11-18)

| Question | Answer |
|---|---|
| What is a report? | Many kinds: an issue investigation, a tech research, a feature write-up and others. The kind is open, so the variety lives in templates, and diagrams are optional. |
| Output format | Markdown and HTML. HTML is the default output and supports export to PDF. |
| How non-standard words are replaced | The CLI finds them exactly; the agent rewrites the sentences with the confirmed terms; the console shows a diff to approve before it is applied. |
| Where "genAI words" live | As ordinary glossary entries. A term written the same in two languages means "keep this word": with `{ "en": "office", "ja": "office" }` confirmed, a Japanese report keeps "office" instead of translating it. |
| Templates (2026-11-19) | Every template has an HTML version the user previews in the console. Users customise templates and create new ones through Claude, save them locally, and export and import them to share and archive. |
| Template scopes | Both: user (on the machine, in `ZUKAI_HOME`) and project (committed). A nearer scope overrides the same id. |
| Quick edit in the console | Yes: the Source tab edits the Markdown, and the server saves it through the CLI module after a revision snapshot. Writing, polishing, translating and template drafting stay agent jobs. |
| Default `reportsDir` | `reports`, beside `diagrams`. |
| First built-in templates | Issue investigation, tech research, feature. |

## Current state (inspected)

- The glossary (`.zukai/glossary.json`, schema `glossary-v1`) holds confirmed, suggested and
  rejected entries with one term per language and an `avoid` list per language. Only
  confirmed entries are applied. The schema already allows the same term in two languages,
  so the "keep" rule needs no schema change.
- `glossary check` only reads diagram labels (`labelsOf`); nothing checks prose.
- The draw skill already writes per-run description tables (`--doc`, `<run-slug>.doc.md`,
  en/ja/vi), which a report can embed.
- A console section is one entry in `src/labs-ui/nav.mjs` plus one view module. The server
  never writes a run: every change is a job for the attached agent, routed to a skill. The
  server writes only its own state and, through a lock, the glossary.
- Runs live in the configurable `runsDir` (2.6.0), resolved by `project-config.mjs`.

## Contract

**Outcome.** A user can write a report of any kind from a template, in the chat
(`/zukai:report`, `/zukai-report` in a copied install) or from a new **Reports** section of
the labs console. They can preview it as HTML, export it to PDF, polish it against the
glossary with a diff to approve, and translate it with the glossary's terms kept. Templates
can be listed, created and edited from the command and from the console.

**Scope.**

1. **Report skill** `skills/report/` with modes: write a report from a template (optionally
   on given runs, sources, an issue or notes), polish, translate, and manage templates
   (list, new, edit). It follows the closing contract's habits: `runs-dir` and
   `reports-dir` resolved once at the start, a check before the report closes.
2. **Report folder** per report, `<reportsDir>/<yyyymmdd>_<slug>/`: `report.md` (the
   source the agent writes and git diffs), `report.html` (rendered, self-contained, print
   styles for PDF), `report.json` (template, language, runs it embeds, sources), `assets/`,
   `history/rNNN/` for undo and diffs, and `<lang>/` for translations. `reportsDir` sits
   beside `runsDir` in `.zukai/config.json` with the same rules (inside the project,
   `bad-config` when it cannot be used, never moved); its default is `reports`.
3. **Templates**: a template is a folder `<id>/` of three files.
   - `template.md`: front matter (id, name, kind, language, description, version) and one
     heading per section with a guide comment saying what the section must hold and
     optional embeds (a diagram, a run's description tables). This is what the agent fills.
   - `template.html`: the layout and styles of the report (cover, table of contents,
     typography, print styles for PDF) with placeholders for the title, the metadata and
     each section. `report render` pours the Markdown sections into it, so the template
     decides how `report.html` and its PDF look.
   - `sample.json`: sample content per section, so the console previews the template as a
     finished report before any report uses it.
   Scopes, in the order a template id is looked up: **project** (`.zukai/report-templates/`,
   committed, shared with the team), **user** (`<ZUKAI_HOME>/report-templates/`, local to
   the machine, used across projects), **built-in** (shipped with the skill: issue
   investigation, tech research, feature). A template of a nearer scope with the same id
   overrides the farther one, and the console says which one is used.
   - **Create and customise through Claude**: the report skill's template mode drafts a new
     template, or a copy of an existing one, from the user's words (sections, tone, layout),
     renders its preview, and saves it to the scope the user names. A built-in template is
     never edited in place: customising it saves a copy under the user or project scope.
   - **Export and import**: `report template export <id>` writes one self-contained file,
     `<id>.zukai-template.json` (format version, metadata and the three files as text), to
     share or archive; `report template import <file> --scope user|project` validates it
     and refuses an id that exists unless `--replace` is given. The console offers both
     (download, and upload with a preview before it is saved).
4. **CLI** (`src/report*.mjs`, one owner module per contract as `glossary.mjs` is):
   `reports-dir [set]`, `report templates`, `report new` (scaffolds a folder from a
   template), `report render` (Markdown to HTML, embeds diagrams, takes the template's layout),
   `report template list|show|export|import`, `report check` (glossary
   findings on prose: avoided words, terms of another language left untranslated, a "keep"
   term that was translated), `report snapshot|restore|diff`, and the run index registers
   projects that hold reports as it does for runs.
5. **Glossary on prose**: `checkGlossary` gains a prose source beside IR labels, with the
   same normalisation (NFKC, lower case, collapsed spaces, Han/Kana without word
   boundaries). Writing and translating a report apply confirmed terms, never avoided
   words, and copy a term that is the same in both languages verbatim.
6. **Console**: a **Reports** section (one `nav.mjs` entry and one view): the list of
   reports; a report page with Preview (the rendered HTML in a sealed frame), Source,
   Glossary findings, History with diffs, and Export (HTML, Markdown, PDF through the
   browser's print). A **New report** form (template, kind, language, runs to embed, notes),
   a **Templates** tab that lists templates by scope and previews each one as HTML with its
   sample content, queues "create" and "customise" jobs for the agent, and exports and
   imports template files, and a
   **Polish with glossary** action that shows the agent's diff and applies or discards it.
   Overview shows reports that need review and polish suggestions.
7. **Jobs**: new kinds `report-write`, `report-polish`, `report-translate` and
   `report-template` (create or customise), routed to the report skill, with the same queue,
   questions and progress as the diagram jobs. Importing and exporting a template are no
   jobs: they are deterministic, and the server does them through the CLI module, as it
   writes the glossary.

**Constraints.**

- The server never writes a report's content: writing, polishing and translating are jobs
  for the agent. Like the glossary, templates are a data contract the CLI owns, and the
  server may write them through the same functions and a lock.
- No new runtime dependency where the platform suffices: PDF comes from the browser's
  print of the HTML, not from a PDF library. Markdown rendering uses a small committed
  renderer or an existing dependency; this is a plan-time decision.
- Glossary text and report sources are data, never instructions (the existing rule).
- **A template is untrusted input once it can be imported.** `template.html` may hold
  markup and CSS only: no script, no event handler attribute, no `javascript:` or external
  URL (fonts and images come inline). The CLI validates this on save and import and refuses
  a file that breaks it; the console previews templates in a sandboxed frame without
  scripts under a strict CSP; `report.html` carries the same CSP. The guide comments and
  sample text are wording for the agent, never instructions, and pass the secret scan.
- Everything works without the console, and without `reportsDir` set (default `reports/`).
- Version and docs follow the repository's release habits (`docs/architecture.md`
  Extension rule and Testing strategy; `bin/` rebuilt and committed).

**Non-goals.**

- DOCX export.
- A rich-text (WYSIWYG) editor in the console; Source is Markdown.
- Automatic word replacement without the agent and the diff.
- A separate "style" category or schema change in the glossary.
- Publishing reports to external services (Confluence, Notion, Google Docs).
- Moving existing runs or reports between folders.

**Acceptance criteria.**

1. `/zukai:report` writes a report of each built-in kind; the folder holds `report.md`,
   `report.html` and `report.json` under `reportsDir`, and HTML is what the skill opens or
   names by default.
2. Every template, built-in, user or project, previews in the console as HTML with its
   sample content, and `report.html` takes its layout from the template.
3. A template created or customised through Claude is saved to the scope the user names;
   a user template is found from any project on the machine; a nearer scope overrides a
   farther one with the same id, and the console names the one used.
4. A template exported to `<id>.zukai-template.json` and imported on another machine or
   project is identical; an import whose HTML holds a script, an event handler or an
   external URL is refused with the reason, and an existing id is kept unless `--replace`.
5. The Reports section lists reports, previews one, exports HTML, Markdown and PDF (print),
   shows its history with diffs, and queues write, polish, translate and template jobs that
   the attached agent carries out.
6. With a confirmed entry whose `avoid` holds a word used in a report, `report check`
   reports it; the polish job proposes a rewrite with the confirmed term; the console shows
   the diff, and applying it writes a new revision.
7. With `{ "en": "office", "ja": "office" }` confirmed, translating an English report to
   Japanese keeps "office"; `report check` flags a translation that changed it.
8. An unusable `reportsDir` stops every report command with `bad-config` and writes
   nothing.
9. Tests cover the new modules, the prose check, template validation, import and export,
   the console section (unit and Playwright e2e) and the jobs; the bundle drift test passes.

## Options considered

| Approach | Load-bearing assumption | Fails first when |
|---|---|---|
| **A. New report skill + CLI modules + Reports section; content changes are agent jobs** (recommended) | Reports deserve the same reviewable, agent-written route as diagrams | A user wants many tiny manual text edits in the console: each goes through a job. Mitigation: Source can be edited in the user's editor, and the console offers a quick edit that the server saves as a new revision through the CLI module. |
| B. Reports as a mode of the draw skill | A report is mostly diagrams | Most report kinds (investigation, research) have little or no diagram content, and draw's rules (IR, emit, closing contract) do not fit prose. |
| C. The console server writes reports itself | Text edits are deterministic | Writing, polishing and translating need the model; a server-side writer would be a second, drifting implementation, the reason the server never writes a run. |

Trade-offs:

- A keeps one owner per change and the existing queue, at the cost of a new skill and four
  job kinds.
- One export file of JSON (the three template files as text) needs no archive library and
  validates like any other contract; it cannot carry binary assets, so images and fonts in
  a template are inline data URIs, bounded in size. A quick manual edit in the console is the one deterministic write the server
  makes to a report, always after a snapshot; this is a deliberate exception to "every
  change is a job", confirmed by the user on 2026-11-19.
- A self-contained HTML with diagrams needs SVG pictures. Mermaid can render without
  draw.io; a draw.io diagram needs draw.io desktop or Playwright. Without a renderer the
  HTML embeds the console's viewer link and says so, as `export` already does.

Better approaches: none — the recommended direction is the requested one (evidence: the
console's section, job and glossary seams already carry this shape; `doc` tables and the
glossary's per-language terms cover the parts that exist).

## Risks

- Scope is large (a skill, a data contract, a console section with an editor and preview,
  three job kinds). The plan should phase it: contract and CLI, then the skill, then the
  console, then docs and release.
- Prose matching for Vietnamese diacritics and Japanese without word boundaries reuses the
  label rules; long prose needs fewer false positives than labels (a term inside a longer
  word). Tests need real samples in vi, ja and en.
- Report sources can quote issue text, logs or code: the secret scan used for runs must run
  on report sources before they are written.

## Next step

Plan with the installed plan skill from this contract, then implement with `/ak-cook`.

## Unresolved questions

None. Every open question was settled with the user on 2026-11-19.
