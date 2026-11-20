---
phase: 2
title: "Minimum gap between separate ends"
status: pending
priority: P1
effort: "1d"
dependencies: [1]
---

# Phase 2: Minimum gap between separate ends

## Goal

Separate ends on one side of a node are at least 10 px apart: a side too short for its ends
grows to `(k+1) × 10 px` and the ends are spread evenly on it, for every shape.

## Context

- ELK spreads ends at `h/(k+1)` with no minimum (measured: 3 → 0.25/0.5/0.75, 9 → 0.1 … 0.9).
- `emitFlowchart` (`emit-drawio.mjs:752`) lays out once, then again only for group titles
  (:776-781). `emitState` (:791) lays out once and again only when a state grows `taller`
  (:816, :824); it has no group-title loop, so the port pass is added to both separately.
  <!-- Updated: Validation Session 1 - emitState relayout described as it is -->
- `layoutGraph` builds a node with `n.ports` as `FIXED_POS` (`layout-graph.mjs:451`) and
  then never creates that node's back-edge ports (:440-446, :456); a back edge into it
  would name a port that does not exist.
- `clientPorts` (:2404) is the existing "first pass shows the sides, second pass routes to
  fixed ports" pattern: it reads each end's side from the first layout and sets evenly spaced
  `n.ports`, then the caller lays out again (:2324).
- `measureNode` (`layout-graph.mjs:39`) sets the node height from the label; a taller node
  must keep its label centred and its outline shape.
- Prototype on the 4-arrow case: gap 10 px grows the box 40 → 50 px; approved by the user.

## Files to Modify

- `skills/draw/scripts/src/emit-drawio.mjs`: a `sidePorts(layout, graph, { minGap })` helper
  used by flowchart and state after the first layout.
- `skills/draw/scripts/tests/emit-fan-in.test.mjs` (new).

## Steps

1. After the first layout, group incoming and outgoing ends by node and side (reuse the side
   detection of phase 1). Skip decisions (their tips are fixed by `decisionPorts`) and
   back-edge ports.
2. For a group whose ends are closer than `MIN_END_GAP = 10`: grow the node along that side
   to `(k+1) × MIN_END_GAP`, and give it `FIXED_POS` ports at `(i+1)/(k+1)` of the side, in
   first-pass order. A node keeps the larger size when two sides need room. Once a node gets
   any port, every end of it gets one: the other sides keep their first-pass positions, and
   a back edge gets a port on the side across the flow, as `decisionPorts` gives it.
   <!-- Updated: Validation Session 1 - every end of a ported node gets a port -->
   A merged trunk (phase 3) counts as one end of its side.
3. Lay out again only when a port was set (as `clientPorts` returns a flag), then run the
   existing group-title loop.
4. Tests: 4 edges into a 40 px `process` and `io` node → node 50 px, ends 10 px apart, edges
   still straight where the first pass had them straight; 3 edges → no change; a loop head
   with 4 forward edges and 1 back edge → no ELK error, back edge on the side across the flow;
   a state with 4 incoming transitions in `emitState`.

## Validation

- `npm test`; render `fan4` and `rect9` with `cli export`: arrowhead tips at least 10 px apart.

## Risk and rollback

- A grown node shifts its rank; check the 50-node fixture (`fixtures/flowchart/large-50-nodes.json`)
  for layout time and warnings.
- Rollback: drop the helper call; phase 1 stands alone.
