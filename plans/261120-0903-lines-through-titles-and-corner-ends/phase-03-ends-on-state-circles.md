---
phase: 3
title: "Ends on the circle of an initial or final state"
status: completed
priority: P2
effort: "0.25d"
dependencies: []
---

# Phase 3: Ends on the circle of an initial or final state

## Goal

A line that leaves an initial state or arrives at a final state meets the circle at the
column (or the height) the layout routed it at, so several lines on one circle run straight
to it without a jog.

## Context

- `STYLE.initial` and `STYLE.final` (`emit-drawio.mjs:191-192`) are `ellipse` cells with
  `shape=startState` / `shape=endState`, 30 x 30 (`CIRCLE`). They are `fixedOutline`
  (:1080), so `sidePorts` leaves them alone (:705).
- `anchor()` in `graphCells` (:524) moves an end onto the outline only for the shapes
  `slantedShape` names (:298: parallelogram, hexagon), through `outlinePoint` (:311).
  Callers of `slantedShape`: :533 (`anchor`) and :715 (`sidePorts`, which asks for `'io'`).
- draw.io ends a line on the ellipse inscribed in the 30 px box (a single line starts at
  the bottom of the box, 15 px below the centre; the black disc it draws is smaller). An end
  off the middle of a side is moved towards the centre: measured on main, three lines out
  of an initial state start `M 234.43 48.93 L 233 48.9 L 233 75`, a 1.4 px jog.
- `usecaseAnchor` (:2858) already carries the formula for an ellipse (the last stretch is
  carried on in its own direction to the outline, clamped at 0.98 of the half axis) for the
  ovals of a use case diagram, which has its own anchor path.

## Files to Modify

- `skills/draw/scripts/src/emit-drawio.mjs`: the shape test, `outlinePoint`, and the
  ellipse formula shared with `usecaseAnchor`.
- `skills/draw/scripts/tests/emit-outline-ends.test.mjs`, `tests/fan-in-shapes.mjs`
  (the outline of a circle for `outlineOf`).
- `skills/draw/scripts/tests/snapshots/drawio/state-*.drawio`: every state fixture.

## Steps

1. Let the shape test name the circle too (`shape=startState` / `shape=endState`), and give
   it a name that fits all three shapes; update its two callers.
2. In `outlinePoint`, a circle branch: on the left and right the end keeps its height and
   takes the x of the ellipse there; on the top and bottom it keeps its column. Put the
   ellipse formula in one helper that `usecaseAnchor` uses as well, with the same clamp; use
   case output must stay byte-identical.
3. `anchor()` then writes the end as an offset with `perimeter=0`, as for the other shapes.
4. Tests: two, three and four lines out of an initial state and into a final state, in
   four directions: each end on the circle of radius 15 (within 0.01 px), first or last
   stretch along the flow; one line alone ends where it did (the middle of the side); a
   circle inside a composite; use case snapshots unchanged.

## Validation

- Unit tests above; the changed state snapshots compared on renders.
- Render the three-line probe with `cli export`: the lines start `M 233 48.27 L 233 75`
  (prototype), no stretch across the flow.

## Risk and rollback

- Every end on a circle gains `Perimeter=0`, so all state snapshots change by that marker
  even where the picture is the same.
- Ends at the far edge of a side are clamped at 0.98 of the radius, as for use case ovals.
- A circle cannot grow: many ends on one stay closer than 10 px. Not changed here.
- Rollback: remove the circle from the shape test.
