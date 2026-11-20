---
phase: 2
title: "Class relations end on the table"
status: completed
priority: P1
effort: "0.25d"
dependencies: []
---

# Phase 2: Class relations end on the table

## Goal

In a top-down or bottom-up class diagram, a relation into a class that has a self-relation
ends on the top or bottom of the table itself, with a last stretch along the flow, instead
of at a corner of the table from the side.

## Context

- `emitClass` (`emit-drawio.mjs:1325`) widens the layout box of a class with a self-relation
  on both sides (`sideLoopRoom`, :1350-1354: `drawWidth` keeps the table's own width) and
  lays out once (:1355). ELK spreads the ends of the top and bottom over the wider box;
  `anchor()` clamps an end beside the table to its corner.
- `sidePorts` (:703) already fixes this for flowchart and state: a side with an end off the
  part the outline covers (`off`, :751) has its ends spread over that part and every end of
  the node gets a fixed port. It also spaces ends closer than `MIN_END_GAP` (`close`, :750),
  grows the node (`short`, :758) and merges lines, none of which a class diagram asked for.
  It has two callers: `emitFlowchart` (:1043) and `emitState` (:1087).
- Measured on main: 3, 4 and 6 associations into a class with a self-relation, TB and BT:
  the first and the last end at the top corners (viewer: `L 251 126 L 271.76 126` onto the
  corner at x=274). LR and RL are clean, and so is ER in all four directions (its ends are
  fixed row ports).
- No class fixture has a self-relation, so no class snapshot changes.

## Files to Modify

- `skills/draw/scripts/src/emit-drawio.mjs`: `sidePorts` (one option), `emitClass`.
- `skills/draw/scripts/fixtures/class/valid-self-relation.json` (new): a class with a
  self-relation and four relations into it, top-down.
- `skills/draw/scripts/tests/emit-fan-in.test.mjs` (or `emit-end-labels.test.mjs`): tests.

## Steps

1. Add `minGap` to the options of `sidePorts`, default `MIN_END_GAP`, used at :750 and :758.
   With `minGap: 0` no side counts as crowded and no node grows: only an end off the outline
   (or a merge) gives a node ports.
2. In `emitClass`, lay out through an `arrange` function; after the first layout call
   `sidePorts(layout, { containers: [], nodes, edges, direction }, { fanIn: 'separate', minGap: 0 })`
   and lay out again when it returns true.
3. Check what a class relation carries through the second layout: an inheritance or a
   realization is laid out against its direction (`layoutReversed`), cardinalities and
   end markers are placed from the route, and the self-relation keeps its loop beside the
   table.
4. Tests: 3, 4 and 6 relations into a class with a self-relation, TB and BT: no end at a
   corner, every end on the top or bottom side strictly inside the table's width, last
   stretch along the flow; an inheritance among them; cardinalities still beside their
   ends; LR unchanged; a class diagram without a self-relation emits the same bytes as
   before (the class snapshots).

## Validation

- Unit tests above; the new fixture's snapshot compared on a render.
- Render the probe with `cli export`: every arrowhead on the top side of the table.

## Risk and rollback

- Every end of a class that gets ports is written with `Perimeter=0` (`exactEnds`); only
  classes with a self-relation in a vertical diagram are touched.
- Rollback: drop the `sidePorts` call in `emitClass`; the option stays harmless.
