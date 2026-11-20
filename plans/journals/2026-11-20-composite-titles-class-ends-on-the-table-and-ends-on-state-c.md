---
title: "Composite titles, class ends on the table and ends on state circles"
date: 2026-11-20
summary: "draw.io: a composite title steps aside for a transition through its header, class relations end on the table beside a self-relation, lines meet state circles without a jog; release 2.8.1; a review found a widening that never converged, fixed"
---

# Composite titles, class ends on the table and ends on state circles

## What happened

Implemented plan `plans/261120-0903-lines-through-titles-and-corner-ends/` on branch
`claude/sleepy-cray-1b79nh` (from main 7c26f13, release 2.8.0): `ded8def` (fix), `79ba3c6`
(release 2.8.1), `9d7a467` (fix from the code review), plan records `36c7749` and `288a0c4`.
All of it is in `skills/draw/scripts/src/emit-drawio.mjs`.

- **Composite titles.** `emitState` gave its containers no `title`, so `placeGroupTitles`
  skipped them. Each composite now has one and runs the loop the other three callers run
  (up to six layouts, then a warning).
- **Class ends.** `sidePorts` takes `minGap` (default 10); `emitClass` calls it with
  `minGap: 0` and `fanIn: 'separate'`, so only ends beside a table drawn narrower than its
  layout box are spread over the table. Nothing grows and nothing merges.
- **Circles.** `slantedShape` became `outlineShape` and names the circle; `ellipsePoint` is
  shared by `outlinePoint` and `usecaseAnchor`, with the arithmetic in the order of the code
  it replaced, so use case output stays byte-identical.

## What the plan had wrong

The context note of phase 1 named four fixtures with a line "through the middle of the
title". In two of them (`valid`, `valid-order-lifecycle`) the line ends on the top border of
the composite, 9 px above the title, and crosses nothing. `placeGroupTitles` counted a
segment that touches the border. Left so, an arrow to a composite moved its title, and a
long title under an arrow at the middle of the frame never found a place: two existing tests
(issue 65, issue 67) failed with a frame twice as wide and a warning. The filter now takes a
segment only when it runs into the strip. No other kind can end a line on a frame.

## What the review found

A reviewer agent compared the tree before and after on its own IRs. One real regression: a
title between two lines, a pixel too wide for the gap, was widened a few pixels a round and
gave up after six, 23 px wider than on 2.8.0 with the title still on a line. The widening
was sized against the longest free stretch, but a frame grows at its far side and the lines
keep their places, so only the last stretch gets longer. Sized against that stretch, the
title is placed in one round. The formula is shared by four kinds; no fixture of the other
three changes a byte.

## Verification

- `npm test`: 2440 passed, 43 skipped. Three render tests through the bundle fail on the
  2.8.0 bundle with the three defects (title -37.7 px, class end 20.8 px sideways, circle
  jog 1.43 px) and pass on 2.8.1.
- 85 outputs byte-identical between the 2.8.0 and 2.8.1 bundles (every activity,
  architecture, ER, flowchart, sequence and use case fixture, classes without a
  self-relation); 7 differ (six state fixtures, the new class fixture).
- Renders by the draw.io viewer: titles 13.97 px or more from lines, class tips on the table
  for 3, 4 and 6 relations top-down and bottom-up, circle ends 0.00 px off the flow for 2, 3
  and 4 lines in four directions.

## Lessons

- A plan's root cause statement is a claim to measure again before implementing: "through
  the title" and "ends above the title" looked alike in the planning notes and are different
  defects with different fixes.
- An existing loop is not proof of convergence for a new caller. Flowchart groups never had
  two lines round a title that nearly fits; state composites do.
- A commit made before the bundle is rebuilt at the old version leaves `bundle-drift` red at
  that commit: build once at 2.8.0 for the fix, once at 2.8.1 for the release.

## Open

- A crossed composite whose long title wrapped is widened until the title stands on one
  line and keeps the tall header (177 px to 640 px with a 94 px header in the review's
  probe). The plan accepts it; the header could be measured again at the final width.
- A transition from a composite state to itself throws in `graphCells`, on 2.8.0 as well.
  Not part of this plan.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
