# Recook skill

Status: done. Every end-to-end case passes on the final state: draw.io (e2e-261113-0535-confirm/a-drawio.md), Mermaid (b3-mermaid.md), Codex copy with .drawio.svg, both views and revise (d-codex-svg-revise.md), FigJam real board (c4-figjam.md). install.ps1 not run (no PowerShell).

## Outcome

`/zukai:recook <file|board>` rebuilds a diagram made elsewhere (draw.io, FigJam, Mermaid) as
Zukai IR under Zukai's rules, then delivers it through the draw skill's closing contract.

## Decisions (user, 2026-11-13)

- Sources: draw.io (`.drawio`, `.drawio.svg`, `.drawio.png`, compressed or not, multi-page),
  FigJam board (read through `use_figma`), Mermaid text (`.mmd`, Markdown fences).
- A source that mixes kinds or is too detailed is split by Zukai's rules (main diagram plus
  parts linked with `ref`) and the change list is reported; no draft round.
- Command name: `/zukai:recook`; copied installs `zukai-recook`.

## Non-goals

Images and screenshots, Excel shapes, PlantUML. Keeping the source layout.

## Design

- `extract <file>` (CLI, deterministic) writes neutral facts: pages with nodes (label, shape
  class, parent, box, icon, link), edges (from, to, label, arrows, dashed; endpoints inferred
  from geometry are flagged) and kind hints with evidence.
- `extract --figjam-script <file.js> [--section <name>]` writes a read-only `use_figma`
  script; its JSON result is saved and passed to `extract` like a file.
- The agent maps facts to IR (`skills/recook/SKILL.md`), never reading raw XML.
- `cover <facts.json> <ir.json|run-dir>...` exits 2 when a source text is in no IR element
  and in no `meta.omitted` / `meta.notes` entry.
- `meta.source` gains `recook`.

## Acceptance criteria

1. Every valid fixture emitted to draw.io and to Mermaid, then extracted: top kind hint is
   the fixture's kind and `cover` against the fixture passes.
2. Hand-made draw.io files (compressed, uncompressed, multi-page, `.drawio.svg`,
   `.drawio.png`, loose edges, text over shapes) extract with the expected nodes and edges.
3. `cover` exits 2 when a label is dropped, 0 when it is kept or listed as omitted.
4. The FigJam reader script never changes the board and normalises to the same facts
   (unit-tested against a fake `figma` object; e2e on a real board when Figma is connected).
5. Installers copy `zukai-recook`; CI frontmatter check covers it; README, docs and
   version 2.2.0 updated; bundle rebuilt; full test suite passes.

## Files

- New: `skills/recook/SKILL.md`, `skills/draw/scripts/src/extract.mjs`,
  `extract-drawio.mjs`, `extract-mermaid.mjs`, `extract-figjam.mjs`, `cover.mjs`, tests.
- Changed: `cli.mjs`, `ir-v1.schema.json`, `figjam-native.mjs` (export helpers),
  `install.sh`, `install.ps1`, `install.test.mjs`, `ci.yml`, README, `docs/*`, versions.

## Risks

- Free-form drawings: loose edges and overlaid texts are guessed from geometry and flagged.
- Coverage is token based per element: a short common word (an edge "Yes") can be matched by
  another element; the check catches dropped elements, not every re-attachment.
- `install.ps1` cannot be run here (no PowerShell).
