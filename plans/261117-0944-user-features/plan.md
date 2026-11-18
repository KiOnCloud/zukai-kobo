# User features: sync, SVG export, description tables, visual diff, GCP, use case, PlantUML

Status: done. All seven features are merged and released as 2.3.0; the suite passes (60 files, 1817 tests, 1 skipped, with pwsh and draw.io desktop on PATH). Skill-level rounds: e2e-261117-scout-sync-doc-svg.md, e2e-261117-usecase-diff-plantuml.md, e2e-261117-gcp.md, e2e-261117-confirm.md (every High and Medium finding fixed), and the Low findings fixed after them. install.ps1 runs in the tests under PowerShell 7 and in a windows-latest CI job; draw.io desktop 26.0.9 runs headless in the tests. Real FigJam boards: e2e-261118-figjam-real-board.md and e2e-261118-figjam-real-board-rerun.md (board eogYZmhMNnhYdRxA95Wdpx): drawing, overlay, read-back, revise redraw, call counts, section marker, script self-check and label backgrounds all pass. Open: the windows-latest CI job has not run yet (no PR); the main flow of one deployment diagram still runs along the bottom of its frames.

## Outcome

Seven user-facing additions, released together as 2.3.0:

| Slug | What the user gets |
|---|---|
| `sync` | `/zukai:sync` brings a scouted run up to date with the code; `cli stale` says which runs are out of date |
| `export-svg` | `cli export` writes a `.drawio.svg` per diagram: shown by GitHub and any wiki, still editable in draw.io |
| `doc-tables` | `emit --to doc` / `bundle --to doc` write the description tables of a diagram as Markdown |
| `visual-diff` | `diff --drawio <out>` draws what changed between two versions of a run on the diagram itself |
| `gcp` | Architecture diagrams of GCP systems get GCP icons and frames, on a par with AWS, and scout reads GCP evidence |
| `usecase` | A new diagram kind `usecase` (actors, use cases, system boundary, include/extend/generalization) |
| `plantuml` | `/zukai:recook` reads PlantUML text (`.puml`, `.plantuml`, Markdown fences) with a deterministic extractor |

## Constraints (all slugs)

- Follow `docs/architecture.md`, above all the Extension rule and the Testing strategy. The
  agent writes IR only; everything else is deterministic code in `skills/draw/scripts/src/`.
- No new runtime dependency unless unavoidable; the CLI stays one committed bundle
  (`npm run build`), works offline except `preview` (and `export`, which shares its renderers).
- Existing IR files, commands, exit codes (0, 1 usage, 2 check failed) and outputs keep
  working. Schema changes are additive and optional; `schemaVersion` stays 1.
- Existing snapshots must not change unless the slug says so. New behaviour gets new fixtures.
- Nothing approximated silently: what a target cannot show is a named warning or an error.
- Skill instructions stay runtime-neutral (Claude Code and Codex), in the style of the
  existing `SKILL.md` and `references/` files: plain sentences, no plan or phase names.
- No plan ids, slugs of this plan, phase numbers or finding codes in code comments, test
  names or commit messages. Conventional commits, no AI references in the subject or body.
- Parallel work: each slug is built in its own git worktree and merged by the controller.
  To keep merges small, a slug does NOT edit `README.md`, `docs/*.md` (except regenerating
  `docs/feature-matrix.md` when the matrix JSON changed), the version numbers in
  `plugin.json` / `package.json`, or `THIRD_PARTY_NOTICES.md`. It hands the controller the
  text for those in its report instead. `bin/cli.mjs` is rebuilt and committed in the
  worktree (the drift test needs it); the controller rebuilds it after each merge.

## Non-goals

Azure icons. Reading screenshots or images. PDF export. A CHANGELOG or release automation.
Any change of layout for existing fixtures.

## Decisions per slug

### sync

- The IR gains optional `meta.sources`: an array of project-relative file paths the diagram
  was derived from. The scout protocol writes it (it keeps citing paths in `meta.notes`).
- `cli sources <run-dir>` records a content hash of every `meta.sources` file in
  `source/<run>.sources.json`; the closing contract calls it for a scouted run. For a run
  without `meta.sources` it falls back to path-like tokens of `meta.notes` that exist on disk.
- `cli stale <run-dir>... [--root <project>]` compares the record with the files now: exit 0
  when nothing changed, exit 2 with a JSON list (changed, deleted, per diagram) otherwise,
  exit 1 when the run has no record. Deterministic, offline, usable in CI.
- `/zukai:sync [<run-folder>]` is a fourth skill (`skills/sync/SKILL.md`), installed and
  checked like `revise` and `recook` (installers, CI frontmatter list, install test,
  copied name `zukai-sync`). Flow: `stale`; scout again with the delivered IR in hand,
  keeping every id and label the code still supports; write the result under `drafts/`;
  `diff`; show the change list; on confirmation `snapshot`, apply, run the closing contract,
  record sources again. No change in the code that matters means no change in the run.

### export-svg

- `cli export <file.drawio|run-dir> [--out <dir|file>]` writes one `<diagram>.drawio.svg`
  per page (run folder: `svg/<slug>.drawio.svg`), each with the page's own mxfile embedded
  in the `content` attribute so draw.io opens it for editing and `extract` reads it back.
- Renderers are those of `preview` (draw.io desktop, or Playwright with the viewer page).
  Without one, exit 1 with the same kind of message `preview` gives; never a fake SVG.
- The skills offer it in the closing contract: asked for when the user wants a picture for
  a wiki or README, or passed `--svg`.
- Round trip is part of the tests: export, `extract`, `cover` against the IR passes.

### doc-tables

- `emit --to doc <ir.json>` and `bundle --to doc --out <run>.doc.md <run-dir>` write
  Markdown tables for every kind: sequence (numbered steps: from, to, message, kind, block
  condition), state (state list and a state x event transition table), er (one column table
  per entity plus relations), activity (steps per lane with hand-offs and guards), flowchart
  (steps and decisions with their outcomes), class (members per type plus relations),
  architecture (components, stores, connections). Every element of the IR appears; `ref`
  becomes a link to the part's heading in a bundle.
- Column headers come in English, Japanese and Vietnamese: `--lang en|ja|vi`, default `en`.
- Labels are escaped for Markdown tables; the secret scan applies as for a local file.

### visual-diff

- `cli diff <old> <new> --drawio <out.drawio>` (IR files or run folders, as `diff` takes
  them) writes a draw.io file of the new version in which added elements are green, changed
  ones amber, and removed ones are drawn again in red with a dashed outline, plus a legend.
  One page per diagram that changed; a diagram only in one side is a page marked whole.
- The plain `diff` output and exit codes do not change.
- The revise skill uses it: a consult draft and the report of a direct change can show the
  picture; the review looks at it when a renderer is present.

### gcp

- GCP on a par with AWS for architecture diagrams in draw.io: service icons (`gcp:<name>`
  as component icons, already in the catalog as logos), group frames (project, region,
  zone, VPC network, subnet) from draw.io's own GCP library, the same placement rules AWS
  diagrams get (stores beside their user, outside systems beside the frames), level-of-detail
  checks that know GCP stores, validation of unknown `gcp:` names, FigJam native stencils.
- The scout protocol and `SKILL.md` read GCP evidence (Terraform `google_*`, Cloud Run /
  GKE manifests, `gcloud` deploy scripts, client libraries) as they read AWS evidence.
- Shared behaviour of the two providers lives in shared code, not in a copy.

### usecase

- New kind by the Extension rule: schema branch, matrix entry for every target, emitters
  (draw.io with layout; Mermaid has no use case diagram, so a documented degraded form or
  `unsupported`, decided in the matrix; FigJam through `emit --native`), reference checks,
  model checks, question bank in the clarify protocol, scout rules, variants, review
  checklist, recook mapping and kind hints, `ref` to a part, fixtures and snapshots.

### plantuml

- `extract` reads PlantUML sources by content: sequence, class, state, activity (new
  syntax), component/deployment (as architecture facts), use case, and ER (`entity`).
  Same facts format, kind hints with evidence, redaction, `cover`. Unsupported constructs
  are reported, not dropped silently. The recook skill and its mapping reference name the
  new source; the "PlantUML is not read" refusal is removed.

## Acceptance criteria

1. `cd skills/draw/scripts && npm ci && npm test` passes with no existing snapshot changed
   (except where a slug's decision requires it, stated in its report).
2. Each slug has end-to-end tests that run the committed bundle from another working
   directory, as `tests/fixes-e2e.test.mjs` does, covering its happy path and its failures.
3. Each slug's skill instructions are exercised by a fresh agent that plays the user on a
   sample project with only the installed skill folder, and the round is recorded in
   `plans/reports/e2e-261117-<slug>.md` with the commands run, the files produced and any
   finding. High and medium findings are fixed and re-run.
4. README, `docs/architecture.md`, `docs/install.md` (Upgrading to 2.3.0),
   `docs/quickstart.md` where relevant, the feature matrix page and version 2.3.0 are
   updated by the controller; CI checks cover the new skill.

## Phases

1. Build each slug in its own worktree (parallel).
2. Merge in the order doc-tables, export-svg, visual-diff, sync, plantuml, usecase, gcp;
   rebuild the bundle and run the suite after each merge.
3. Cross-slug gaps (the new kind in doc tables, visual diff, PlantUML mapping; GCP in doc
   tables), docs and version.
4. Skill-level end-to-end rounds on the merged state; fix and re-run.
