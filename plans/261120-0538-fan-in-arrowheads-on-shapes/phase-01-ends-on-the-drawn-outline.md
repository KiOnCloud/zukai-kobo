---
phase: 1
title: "Ends on the drawn outline"
status: pending
priority: P1
effort: "1d"
dependencies: []
---

# Phase 1: Ends on the drawn outline

## Goal

An edge that meets a parallelogram or a hexagon ends on the slanted line at the height (or
x) ELK routed it to, and draw.io keeps that point, so the last segment and the arrowhead run
along the flow.

## Context

- `graphCells` (`emit-drawio.mjs:417`) is shared by flowchart (:788), state (:825), ER
  (:1039), class (:1085), architecture (:2260) and use case (:2756).
- `anchor()` :448 clamps ELK's point to the box (`entryX=0` on the left side);
  `anchorStyle()` :459 writes `Perimeter=0` only when `dx/dy` is set. `anchor()` has four
  call sites: `noteSide` :470-471, the self-loop ELK routes over the top in vertical flows
  :504, every routed edge :549, and label placement via `drawnEnd` :556.
  <!-- Updated: Validation Session 1 - full caller list of anchor() -->
- `usecaseAnchorStyle` :2608 is a separate function for use case diagrams and stays as it is.
- `noteSide()` :461 classifies sides by `a.x <= 0.01` / `a.x >= 0.99`, which stops working
  once a left-side anchor lies on the slant.
- Shapes whose outline is narrower than the box: `STYLE.io` :182
  (`parallelogramPerimeter`, `fixedSize=1`, `size=SLANT`) and `STYLE.queue` :202
  (`hexagonPerimeter2`). `SLANT` :153 = 20 px.
- Top and bottom of a parallelogram are `SLANT` shorter than the box (top starts `SLANT` in
  from the left, bottom ends `SLANT` before the right). ELK can end a TB edge in that strip.
- Fixed ports already exist: `decisionPorts` :581, `clientPorts` :2404, and `layoutGraph`
  turns `n.ports` into `FIXED_POS` ports (`layout-graph.mjs:451`).

## Files to Modify

- `skills/draw/scripts/src/emit-drawio.mjs`: an outline function per shape, `anchor()`,
  `anchorStyle()`, `noteSide()`; top/bottom ports for `io` in flowchart.
- `skills/draw/scripts/tests/emit-drawio.test.mjs` (or a new `emit-outline-ends.test.mjs`).

## Steps

1. Add `outlinePoint(shape, box, point, side)`: for `io`, left `x = b.x + s·(1 − (y − b.y)/h)`,
   right `x = b.x + w − s·(y − b.y)/h`; for `queue`, the two segments of each side meeting at
   mid-height; top and bottom keep `y` and take `x` as routed. Unknown shapes return the
   point unchanged (rectangles keep today's anchors byte for byte).
2. In `anchor()`, take the side from ELK's raw point (not from the clamped ratio), move the
   point with `outlinePoint`, and mark the anchor `fixed` so `anchorStyle()` writes
   `entryPerimeter=0` / `exitPerimeter=0`.
3. Make `noteSide()` use the side found in step 2.
4. Flowchart TB/BT into an `io` node: give the node ports on the top and bottom inside the
   drawn extent (`[s, w]` on top, `[0, w − s]` at the bottom), spread in first-pass order,
   using the `clientPorts` pattern and a second layout pass only when such a side is used.
   The ports on that node cover every end, back edges included (see phase 2, step 2).
5. Tests: 3, 4 and 9 edges into `io` and `queue` in LR, RL, TB, BT, and a self-loop on an
   `io` node in TB (the :504 path); assert
   `entryPerimeter=0`, the anchor on the outline and the end's y (or x) equal to ELK's; a
   straight edge has no waypoint and equal ends; a rectangle's style string is unchanged.

## Validation

- Unit tests above; `npm test` for the touched emitters.
- Render `fan3`, `fan4`, `fan9` with `cli export` and check the last segment of each edge
  (`|Δ| < 0.5`) and the arrowhead tip against the outline.

## Risk and rollback

- Label positions measured on the drawn line (`labelOnDrawnLine`) shift by up to `SLANT`;
  check the architecture label tests.
- Rollback: revert the commit; the change is local to `graphCells` and flowchart ports.
