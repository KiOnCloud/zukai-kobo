---
title: "Plan lines through composite titles, class corner ends and circle jogs"
date: 2026-11-20
summary: "Three draw.io layout defects confirmed on 2.8.0 (all present in 2.7.1), prototyped and planned in four phases for 2.8.1"
---

# Plan lines through composite titles, class corner ends and circle jogs

## What happened

After release 2.8.0 merged (`7c26f13`, PR #79), the user sent renders of
`state/valid-self-loop` and reported a line through the title of a composite state and an
odd route at a state's corner. Both were checked on main with the draw.io viewer before
planning; plan `plans/261120-0903-lines-through-titles-and-corner-ends/`, four phases, on
branch `claude/sleepy-cray-1b79nh`.

- **A, confirmed.** `emitState` gives a composite no `title` and never calls
  `placeGroupTitles`, unlike flowchart, architecture and use case. Every state fixture with
  a composite has a line at or through its title (t3 at x=625 against text 549.8 to 625.2
  in `valid-self-loop`; through the middle in three others).
- **The corner route of the third image is the 2.7.1 picture.** 2.8.0 moved those ends onto
  the shape for flowchart and state (`exitX=0` / `1` became `0.333` / `0.667`). The same
  fault is still in class diagrams (B): a class with a self-relation in a top-down or
  bottom-up diagram, from 3 relations on a side; ER is clean in all four directions.
- **C, found while probing.** Several lines on the 30 px circle of an initial or final
  state jog at the circle (`M 234.43 48.93 L 233 48.9 L 233 75`): the perimeter projection
  2.8.0 fixed for parallelograms, on a shape it left out.

All three give the same bytes in the 2.7.1 bundle, so none is a regression of 2.8.0.

## Decisions (Validation Session 1, 4 questions)

- Scope: A, B and C.
- A composite is widened when its header has no free stretch for the title, as a flowchart
  group is.
- Class: `sidePorts` with `minGap: 0` and `fanIn: 'separate'`, so only ends beside the table
  are spread; no 10 px rule and no growth for class.
- Release: patch 2.8.1.

## How the design was checked

A throwaway edit of `emit-drawio.mjs` (reverted, nothing committed) implemented the three
fixes in about 20 lines and was measured on renders: titles clear in six state fixtures and
four probes, no class end at a corner in 16 probes, circle lines straight. The 38 line and
caller references in the phases were checked against the source by script: 38 verified.

## Next steps

- Implement with `/ak-cook` on the plan when the user chooses to.
- Not in the plan: many ends on one circle stay closer than 10 px (a circle cannot grow),
  and architecture still has no 10 px rule.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
