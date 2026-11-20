---
title: Arrowheads on slanted shapes and merged fan-in
date: 2026-11-20
summary: "draw.io arrows end on the drawn outline, arrowheads keep 10 px, five or more arrows merge with a junction dot; release 2.8.0; a review found a self-loop regression, fixed"
---

# Arrowheads on slanted shapes and merged fan-in

## What happened

Implemented plan `plans/261120-0538-fan-in-arrowheads-on-shapes/` on branch
`claude/sleepy-cray-1b79nh` (from main f01ac8f, release 2.7.1) in three commits: `d5d8999`
(feature), `e78ece4` (release 2.8.0), `a0cd373` (fixes from the code review).

- **Root cause confirmed first.** A fan-in of 3 into a parallelogram, drawn by the draw.io
  viewer from the 2.7.1 bundle, ended with the line at y=110 and the arrowhead tip at
  y=110.97 on a vertical 4.28 px stub: `anchor()` wrote a point on the bounding box and left
  the perimeter on, so draw.io moved the end towards the centre of the shape.
- **Outline ends** (`graphCells`, shared by six kinds): `outlinePoint` moves an end along the
  line's own direction onto the slanted edge of a parallelogram or a hexagon; the anchor is
  written as the share of the box plus a pixel offset with `perimeter=0`.
- **Gap and merge** (flowchart, state): `sidePorts` runs after the first layout, grows a side
  that is too short for its ends, gives every end of such a node a fixed port and puts five
  or more unlabelled lines on one port; `fanInJunctions` finds where they have all joined
  and the emitter draws a dot tagged `zukaiJunction=1`.
- `fanIn: auto | merge | separate` in the flowchart and state schema; `extract-drawio` and
  `extract-figjam` leave the dot out.

## What went wrong on the way

- `sideOf` first copied the tolerance test of `clientPorts` (within 0.5 px of a border, else
  bottom). The port ELK makes for a back edge lies 1 px outside the box, so a back edge on
  the right side was read as "bottom" and came out at the bottom corner. Found on the render
  of a loop head with nine inputs; a point on no border now takes the nearest side.
- A 30 px final-state circle with three transitions was widened to 40 px. Circles are now
  left alone (`fixedOutline`).
- Shares written to three decimals put nine merged ends 0.05 px off their waypoint: two
  distinct arrowheads and a thick-looking line. The offset now takes up the rest.
- The measuring script counted a back edge and a self-loop as bent, because they arrive
  across the flow by design. That hid one real defect: a self-loop on a node with ports in a
  left-to-right diagram. The independent reviewer reproduced it (the loop ran corner to
  corner round the box); the two ends of such a loop now get ports. Lesson: look at the
  picture of every case class once, not only at the numbers.
- One test (`fanIn` rejected on ER) passed for the wrong reason, because its IR was invalid
  anyway. It now runs over every valid fixture.

## Decisions

- One junction dot per merged group, where the shared line begins; another only where four
  merged segments meet. The plan said "one dot" in its criteria and "one per parting point"
  in a step; a dot at every T made seven dots for nine inputs.
- Ends beside a shape whose layout box a self-loop widened (top-down, bottom-up) are spread
  over the shape. This goes past "rectangles with room keep their geometry" for that one
  case, because those ends were off the shape; two state fixtures changed and were checked
  on renders.
- Architecture gets the outline fix only, as planned: nine connections into a 40 px queue
  are still 4 px apart.

## Evidence

- 108 of 108 renders through the final bundle pass (last stretch within 0.5 px of the flow,
  tip within 1.12 px of the outline, separate tips 10 px or more apart in flowchart and
  state, one arrowhead and one dot per merged group).
- 14 rectangle cases and 38 ER, class, use case, sequence and activity fixtures are
  byte-identical to the 2.7.1 bundle.
- `npm test`: 2381 passed, 43 skipped (the same 43 as before the change); `bundle-drift`
  passes. `tests/fan-in-render-e2e.test.mjs` fails on the 2.7.1 bundle with the 4.28 px bend.

## Next steps

- Decide whether architecture diagrams should get the 10 px gap; their layout tries several
  arrangements and scores them, so the port pass would have to run inside each try.
- A final state with many transitions is neither spaced nor merged; a merge into the circle
  would need the end on the circle's outline.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
