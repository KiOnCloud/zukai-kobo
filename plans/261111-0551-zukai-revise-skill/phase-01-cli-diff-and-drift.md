---
phase: 1
title: "CLI diff and drift"
status: completed
priority: P1
effort: 1d
dependencies: []
---

# Phase 1: CLI diff and drift

## Goal

Give the revise skill two deterministic CLI answers: what a change does to the model
(`diff`), and whether a delivered draw.io file carries hand edits (`drift`).

## Key insights (verified)

- Emit is deterministic: two emits of the same IR differ only in the diagram id, which
  `cli.mjs` derives from the `--out` file name (`<diagram id="d" ...>`, cell ids `d:<ir id>`).
  A drift check must therefore emit with the diagram id of the file being checked.
- Every kind keeps its elements in top-level arrays of objects with `id`
  (`src/schema/ir-v1.schema.json`): `nodes/edges/groups`, `participants/messages/blocks/notes`,
  `states/transitions`, `entities/relations`, `classes/relations`,
  `components/boundaries/connections`, `lanes/actions/controls/flows`. Nested arrays
  (`attributes`, `methods`, `branches`) belong to their parent element.
- In a bundle, each diagram page is the page emit shifted by `place(page, 0)`
  (`src/emit-drawio.mjs` `emitDrawioBundle`), which depends only on the page's own cells; the
  bundle title appears only as the canvas page name, and the canvas page holds one
  `<id>:title` cell per diagram in canvas order.

## Files to create / modify

- Create `skills/draw/scripts/src/ir-diff.mjs`: `diffIr(oldIr, newIr)` and `diffRun(oldEntries, newEntries)`.
- Create `skills/draw/scripts/src/drift.mjs`: `driftDrawio(xml, entries)`.
- Modify `skills/draw/scripts/src/cli.mjs`: commands `diff` and `drift`, usage text, header comment.
- Create `skills/draw/scripts/tests/ir-diff.test.mjs` and `tests/drift.test.mjs`.
- Modify `skills/draw/scripts/tests/cli.test.mjs`: exit codes and JSON shape of both commands.
- Regenerate `skills/draw/scripts/bin/cli.mjs` with `npm run build`.

## Tasks & steps

1. `diffIr`: for each top-level array whose items carry `id`, report `added` and `removed`
   (`{ collection, id, label }`) and `changed` (`{ collection, id, fields }`, where `fields`
   names the changed keys, nested arrays compared as one value). Also report changed
   top-level scalars (`title`, `kind`, `meta.audience`, `meta.omitted`). A changed `kind`
   is reported as a replacement of the whole diagram. Order output by collection, then id, so
   it is stable.
2. `diffRun`: pair IR files by file name. Report diagrams added or removed, a `diffIr` per
   pair, and cascade hints:
   - an added, removed or changed element that carries `ref: "<slug>"` → `part <slug> may need the same change`;
   - `<slug>.ir.json` changed while `<slug>-business.ir.json` is unchanged → `business view not updated`;
   - a removed element that another element's `ref` or an edge, flow, transition, connection or message still names → listed as a dangling-reference hint (validation also catches this; the hint names it in plain words for the change list).
3. CLI `diff <old> <new>`: two IR files, or two directories (each a `source/` folder), JSON on
   stdout, exit 0 when compared (with or without differences), 1 on I/O error, 2 when either
   side fails `validateIr`.
4. `driftDrawio(xml, entries)`: parse the on-disk file (inflate when compressed, as
   `relabel.mjs` does), emit each IR in memory with its diagram id, and compare cell by cell
   on the page with that diagram id: `added` (cell only on disk, e.g. hand-copied shape),
   `removed`, `moved`/`resized` (geometry or waypoints), `relabelled`, `restyled`. For a
   bundle, compare each diagram page against `place(page, 0)`; compare the canvas page per
   diagram group after translating by that group's `<id>:title` cell. Return also
   `bundle: { title, canvas, gap }` recovered from the canvas page (title from the page name
   minus a trailing ` (canvas)`, canvas ids from title-cell order, gap from title-cell x
   offsets) so a re-bundle reproduces the file. Without a canvas page, `title` is absent.
5. CLI `drift <file.drawio> <ir.json>...`: JSON `{ ok, drifted, pages: [{ diagram, changes }], bundle? }`,
   exit 0 whether drifted or not, 1 on I/O error or a file that is not draw.io, 2 when an IR
   fails validation. A page with no matching IR is reported, not fatal.
6. Export the bundle placement helper from `emit-drawio.mjs` only if `drift.mjs` cannot reuse
   it otherwise; do not duplicate the placement arithmetic.
7. `npm run build`, then `npm test`.

## Verification

- `cd skills/draw/scripts && npm ci && npm test` passes, including `bundle-drift.test.mjs`.
- `ir-diff.test.mjs`: one fixture pair per kind with an add, a remove and a label change gives
  exact output; identical IRs give empty lists; a `ref` change and a technical-only change
  give the two cascade hints.
- `drift.test.mjs`: emit a fixture, assert `drifted: false`; move one vertex, edit one label,
  copy one shape, assert three changes on the right cells; same on a bundle with `--canvas all`,
  including recovery of `title`, `canvas` and `gap`.

## Risks

- CLI upgrade between delivery and revise changes emitter output → `drift` reports drift
  that the user did not make. Mitigation: the revise skill words the warning as "differs
  from what this version would draw" and shows the change list, so the user can tell.
- Recovering `gap` from coordinates is fragile when a canvas member was moved by hand; then
  `drift` already reports that page as drifted and the skill falls back to the default gap.
