---
phase: 1
title: "Composite titles step aside"
status: pending
priority: P1
effort: "0.5d"
dependencies: []
---

# Phase 1: Composite titles step aside

## Goal

The title of a composite state stands where no transition line or line label crosses it: it
keeps its centred place when that is free and otherwise moves along the header to the
nearest free stretch, as the title of a flowchart group already does.

## Context

- `emitState` (`emit-drawio.mjs:1058`) builds its containers at :1073 with `headerHeight`
  and `minWidth` and no `title`. After the layout it only grows a header whose title wraps
  (:1090-1095), then calls `graphCells` (:1096).
- `placeGroupTitles` (:1459) reads `c.title` (`width`, `height`, `start`, `centred`,
  `plain`), marks the stretches of the header strip that a line or a line label runs
  through, each with `TITLE_LINE_GAP` = 12 px (:1391) on both sides, sets `c.titleOffset`,
  and widens the frame (`c.minWidth`) when no free stretch is long enough. It returns
  whether a frame was widened. It skips a container without `title` (:1471).
- Its three callers loop up to six layouts: `emitFlowchart` (:1046-1052), `emitArchitecture`
  (:2628-2634) and `emitUsecase` (:3012-3018). `emitUsecase` is the nearest pattern: its
  boundary header grows with a wrapped title, and it refreshes `c.title` when it does
  (:3003).
- `plainTitle` (:1448) gives the title of a plain frame; with `plain` a frame no line
  crosses is left exactly as draw.io draws it, wrapped title included. `titleAt` (:1509)
  writes `align=left;spacingLeft=<offset>` into the style.
- `STYLE.composite` (:194) is a rounded `swimlane` with `startSize=30`. A composite with
  `ref` has a two-line title; `plainTitle` takes its widest line.
- Measured on main: `state/valid-self-loop` t3 at x=625 against title text 549.8 to 625.2;
  `valid-order-lifecycle` t4, `valid` t3 and `valid-ref-parts` t3 through the middle of the
  title; a probe with three transitions into one composite has all three through it.
  Left-to-right composites are clear: their lines enter through a side.

## Files to Modify

- `skills/draw/scripts/src/emit-drawio.mjs`: `emitState` only.
- `skills/draw/scripts/tests/emit-loops-titles-ends.test.mjs`: title tests for composites.
- `skills/draw/scripts/tests/fan-in-render-e2e.test.mjs` (or a sibling): one render case.
- `skills/draw/scripts/tests/snapshots/drawio/state-*.drawio`: four fixtures change.

## Steps

1. Give each composite `title: plainTitle(label, headerHeight)` where the containers are
   built (:1073).
2. In the header pass (:1090-1095), refresh `c.title` with the new height when a header
   grows, as `emitUsecase` does at :3003.
3. After that pass, run the `placeGroupTitles` loop of the other callers (up to six
   layouts through the existing `arrange`), then apply `titleAt` to every container with a
   `titleOffset`. The fixed ports of `sidePorts` stay on the nodes through these layouts, and
   `fanInJunctions` keeps reading the last layout.
4. When a title is still unplaced after six rounds, add a warning at `/states`:
   "layout: a transition crosses the title of a composite state; no free place was found for
   it along the top of the state", hint "shorten the state label or change \"direction\"".
5. Tests: one, two and three transitions into a composite from above (TB) and out through
   its top (BT): the title's text box, at its `spacingLeft`, is 12 px or more from every
   line and label in the header strip; a composite no line crosses has its style unchanged;
   a left-to-right composite is unchanged; a composite with `ref` (two title lines); a
   composite nested in another, where the line crosses both headers; a merged fan-in into a
   state inside a composite keeps its junction dot on the lines.

## Validation

- Unit tests above; the four state snapshots that change, each compared on a render.
- Render `state/valid-self-loop`, `state/valid-order-lifecycle` and the three-line probe
  with `cli export`: the `<text>` of the title and the lines in the header are 12 px apart.
- `figjam-native` draws a swimlane title at its `spacingLeft` (`figjam-native.mjs:339`,
  as for flowchart groups); the all-fixtures FigJam tests cover the moved titles.

## Risk and rollback

- A crossed composite whose long title wrapped is widened until the title fits on one line
  beside the lines; the header keeps its height. Same as a use case boundary.
- The title of a composite entered by lines on both sides of its middle stands off-centre,
  at the left or the right of the header.
- Rollback: remove the loop; nothing else depends on it.
