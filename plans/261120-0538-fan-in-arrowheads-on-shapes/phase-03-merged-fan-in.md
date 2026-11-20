---
phase: 3
title: "Merged fan-in with a junction dot"
status: completed
priority: P1
effort: "1.5d"
dependencies: [2]
---

# Phase 3: Merged fan-in with a junction dot

## Goal

Five or more mergeable edges into one side of a node draw as one line: they share one port at
the middle of that side, run as one trunk, end in one arrowhead, and a junction dot marks
where the branches meet the trunk. The model keeps every edge.

## Context

- `decisionPorts` (`emit-drawio.mjs:581`) already gives every line into a decision one
  shared port, which ELK routes as one line; this phase applies the same idea to fan-in.
- The merge prototype (`apply_merge.py`) drew 9 arrowheads at identical coordinates and
  showed the problem: a branch that passes straight through the trunk reads as a crossing.
  The emitter draws no junction today.
- `extract-drawio.mjs:239` turns every vertex into an element (only empty `text` and frame
  parts are skipped, :236, :307), so an untagged dot would come back as a node in `recook`,
  `drift` and `cover`.
- `figjam-native.mjs:1011` reads the draw.io XML `emitDrawio` wrote, so the dot reaches
  FigJam too.

## Files to Modify

- `skills/draw/scripts/src/emit-drawio.mjs`: merge grouping, shared ports, junction cells.
- `skills/draw/scripts/src/extract-drawio.mjs`: skip a vertex tagged `zukaiJunction=1`.
- `skills/draw/scripts/src/figjam-native.mjs`: draw a tagged junction as a small dot, not a node.
- `skills/draw/scripts/tests/emit-fan-in.test.mjs`, `extract-drawio.test.mjs`, `figjam-native.test.mjs`.

## Steps

1. Before the second layout (phase 2's pass), for each node side with `k ≥ 5` ends, take the
   mergeable subset: no label, not a back edge, the same line and arrow style. If it has 5
   or more edges, merge it; the other ends of that side stay separate beside the trunk and
   go through phase 2's gap rule with the trunk counted as one end. Fewer than 5 mergeable
   edges: leave the whole side to phase 2.
   <!-- Updated: Validation Session 1 - mixed groups merge their unlabelled subset -->
2. Give the merged subset one port at the middle of the side (shifted to keep 10 px from the
   separate ends when there are any); every other end of the node gets a port too (phase 2,
   step 2). With phase 1 the anchor lands on the outline.
3. After layout, find the junction. First read the `junctionPoints` ELK may return for
   edges that share a port [UNVERIFIED for elkjs 0.12]; otherwise take the point where the
   merged routes part (first point along the reversed paths that is not shared by all).
   Emit one 6 px ellipse vertex per parting point, `style` tagged `zukaiJunction=1`, filled
   with the stroke colour, not connectable.
4. Extract: skip tagged vertices before `classify`. FigJam: draw them as a dot.
5. Tests: 9 edges into `io` → one distinct arrowhead path in the export, one junction;
   round trip `emit → extract` gives the IR's nodes and edges; 7 edges with 2 labelled →
   5 merged plus 2 separate at least 10 px from the trunk; 6 edges with 2 labelled → all
   separate; 4 edges never merge; architecture with 9 connections into one component never
   merges.

## Validation

- `npm test`; render `fan9` and a TB variant; `cli extract` and `cli drift` on the result
  report no difference from the IR.

## Risk and rollback

- When the merged routes part at several points (branches from both sides of the trunk),
  more than one junction may be needed; draw one per parting point.
- Rollback: disable merging (the `auto` threshold path); phases 1 and 2 stand alone.
