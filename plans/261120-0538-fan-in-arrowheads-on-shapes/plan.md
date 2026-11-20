---
title: "Arrowheads on slanted shapes and crowded fan-in"
description: "Arrows end on the outline that is drawn, never bent at a parallelogram's corner; ends on one side stay at least 10 px apart; five or more arrows into one side merge into one line with a junction dot."
status: pending
priority: P1
effort: 4d
branch: claude/sleepy-cray-1b79nh
tags: [fix, layout, drawio]
blockedBy: []
blocks: []
created: 2026-11-20
---

# Arrowheads on slanted shapes and crowded fan-in

## Overview

Two reported bugs come from one root cause and one compounding cause, both confirmed by
rendering with the draw.io viewer:

- Arrows into a parallelogram (`io`) or hexagon (`queue`) are anchored on the bounding box
  with the perimeter on. draw.io pulls each end toward the centre, adds a jog, and the
  arrowhead bends: it points down at the corner when there are few arrows, and turns a
  straight edge diagonal.
- ELK spreads `k` ends over the node's height with no minimum, so 9 ends on a 40 px box sit
  4 px apart under 7 px arrowheads, on any shape.

Contract, evidence and decisions: [brainstorm report](../reports/brainstorm-261120-0538-fan-in-arrowheads.md).
Scope mode: HOLD SCOPE (no `--yagni`).

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | [Ends on the drawn outline](./phase-01-ends-on-the-drawn-outline.md) | Pending |
| 2 | [Minimum gap between separate ends](./phase-02-minimum-gap-between-ends.md) | Pending |
| 3 | [Merged fan-in with a junction dot](./phase-03-merged-fan-in.md) | Pending |
| 4 | [`fanIn` override, docs, tests sweep and release](./phase-04-override-docs-and-release.md) | Pending |

Order: 1 → 2 → 3 → 4. Phase 2 and phase 3 both change how flowchart and state nodes get
ports before the second layout pass, so they run in sequence, not in parallel.

## Decision table (per node side, `auto` mode)

| Group of ends into one side | Drawn as |
|---|---|
| `k ≤ 4` | Separate; on the outline; side grown to `(k+1) × 10 px` when shorter |
| `k ≥ 5`, 5 or more of them mergeable | The mergeable edges share one port at the middle of the side, one trunk and one junction dot; the rest stay separate beside it, the trunk counting as one end for the 10 px gap |
| `k ≥ 5`, fewer than 5 mergeable | Separate, as for `k ≤ 4` |

Mergeable: no label, not a back edge, and the same line and arrow style as the others merged.
Kinds: flowchart and state. Architecture always keeps arrows separate (it still gets the
outline fix, which lives in the shared `graphCells`).
<!-- Updated: Validation Session 1 - mixed groups merge their unlabelled subset; fanIn limited to flowchart and state -->

Every end of a node that gets fixed ports gets a port, back edges included (on the side
across the flow, as `decisionPorts` does): `layoutGraph` drops a node's back-edge ports once
it has fixed ports (`layout-graph.mjs:446`, :451-456).
<!-- Updated: Validation Session 1 - every end of a ported node gets a port -->


## Acceptance criteria

Measured on the SVG the draw.io viewer draws (`cli export`), as in the brainstorm repro:

- [ ] Every edge into an `io` or `queue` node ends with a segment along the flow
      (`|Δy| < 0.5` for LR/RL, `|Δx| < 0.5` for TB/BT), the arrowhead tip within 1.5 px of
      the drawn outline, for 3, 4 and 9 incoming edges in all four directions.
- [ ] A straight edge into a slanted shape stays straight.
- [ ] Separate ends on one side are at least 10 px apart, on rectangles and slanted shapes.
- [ ] A mergeable group of 5 or more draws one arrowhead and one junction dot; `extract` of
      the result returns the same nodes and edges as the IR (no junction node).
- [ ] A group of 7 with 2 labelled edges merges the 5 unlabelled ones and keeps the 2
      labelled ones separate, at least 10 px from the trunk.
- [ ] A loop head that gets fixed ports lays out without an ELK error and its back edge
      still arrives on the side across the flow.
- [ ] `fanIn: separate` and `fanIn: merge` override the threshold in flowchart and state;
      the architecture schema rejects `fanIn` and architecture arrows stay separate.
- [ ] Rectangle targets whose ends are already 10 px apart keep their current geometry.
- [ ] `npm test` passes, the bundle is rebuilt and `bundle-drift` passes.

## Risks

- Existing tests that assert `entryX=0` on `io` nodes or exact node heights will change; each
  change is checked against a render, not just updated.
- Growing a side changes rank spacing, which can move neighbouring nodes; the second layout
  pass absorbs it, as `clientPorts` already does for architecture.
- A node with fixed ports loses its back-edge ports in `layoutGraph`; ports for every end
  (Validation Session 1) prevent a missing-port error.

## Unresolved questions

None. Architecture scope and mixed groups were decided in Validation Session 1.

## Validation Log

### Session 1 — 2026-11-20
**Trigger:** `/ak-plan` on an existing plan: validate it.
**Questions asked:** 4

### Verification Results
- **Tier:** Standard (4 phases: Fact Checker + Contract Verifier, plus one traced flow)
- **Claims checked:** 31
- **Verified:** 24 | **Failed:** 6 | **Unverified:** 1

#### Failures
1. [Fact Checker] `drawnEnd` cited at `emit-drawio.mjs:555`; actual :556.
2. [Contract Verifier] `anchor()` callers: plan named :549, `drawnEnd` and `noteSide`; found 4 sites: :470-471 (`noteSide`), :504 (self-loop over the top in vertical flows), :549, :556.
3. [Fact Checker] Phase 2 said `emitState` follows `emitFlowchart`; it lays out again only when a state grows `taller` (:824-825) and has no group-title loop.
4. [Flow Tracer] Phase 2 and 3 set fixed ports on some ends only; `layoutGraph` builds a ported node with `FIXED_POS` (layout-graph.mjs:451) and never creates its back-edge ports (:446, :456), so a back edge into it points at a missing port.
5. [Fact Checker] Phase 4 put `fanIn` beside the top-level `direction` (:81); :81 is `$defs/direction`, shared through `$defs/envelope` (:156), and each kind has `unevaluatedProperties: false`, so `fanIn` belongs in the flowchart and state definitions.
6. [Scope] `plan.md` accepted `fanIn: merge` for architecture while phase 3 merges only in flowchart and state.
- Unverified: whether elkjs 0.12 returns `junctionPoints` for edges that share a port (`node_modules` was not readable in this session); phase 3 falls back to computing the parting point.
- Verified, among others: `graphCells` :417 and its 6 callers; `anchorStyle` :459; `STYLE.io` :182; `STYLE.queue` :202; `SLANT` :153; `decisionPorts` :581; `clientPorts` :2404 and its caller :2324; `extract-drawio.mjs:239` keeps every vertex; `figjam-native.mjs:1011` reads the draw.io XML; `figjam-overlay.mjs` takes no graph layout (sequence only); version lives in `.claude-plugin/plugin.json` and `package.json`.

#### Questions & Answers

1. **[Scope]** Plan cho phép override `fanIn: merge` cho cả diagram kiến trúc, nhưng phase 3 chỉ làm merge cho flowchart và state. Hai chỗ này mâu thuẫn. Chọn hướng nào?
   - Options: Chỉ flowchart, state | Làm merge cho kiến trúc | Kiến trúc dùng auto
   - **Answer:** Chỉ flowchart, state
   - **Rationale:** Keeps a trunk from reading as a shared channel in architecture and keeps scope.
2. **[Architecture]** Khi một node có fixed port (do giãn cạnh hoặc merge), layoutGraph bỏ qua các back-edge port của node đó. Back edge vào node sẽ trỏ tới một port không tồn tại, và ELK báo lỗi. Xử lý thế nào?
   - Options: Gắn port cho mọi đầu | Bỏ qua node đầu vòng lặp
   - **Answer:** Gắn port cho mọi đầu
   - **Rationale:** Loop heads also get the gap and the merge; follows `decisionPorts`.
3. **[Tradeoffs]** Một cụm từ 5 mũi tên trở lên, có mũi tên có label lẫn không label: merge thế nào?
   - Options: Tách riêng toàn bộ | Merge phần không label
   - **Answer:** Merge phần không label
   - **Rationale:** A cleaner picture; the rule is "5 or more mergeable edges merge".
4. **[Assumptions]** Có 4 chỗ sai thực tế không đổi quyết định (drawnEnd :556; caller :504; emitState `taller`; `fanIn` trong schema từng kind). Sửa luôn chứ?
   - Options: Sửa luôn | Xem trước rồi sửa
   - **Answer:** Sửa luôn

#### Confirmed Decisions
- `fanIn`: flowchart and state only; architecture always separate.
- Ported nodes: every end gets a port, back edges on the side across the flow.
- Mixed groups: merge the mergeable subset when it has 5 or more; the rest stay separate.

#### Impact on Phases
- Phase 1: caller list of `anchor()` and the `drawnEnd` line.
- Phase 2: `emitState` relayout described as it is; every end of a ported node gets a port.
- Phase 3: subset merge; ports for every end; `junctionPoints` marked unverified.
- Phase 4: `fanIn` in the flowchart and state schema definitions; architecture rejects it.

### Whole-Plan Consistency Sweep
- Files reread: plan.md, phase-01-ends-on-the-drawn-outline.md, phase-02-minimum-gap-between-ends.md, phase-03-merged-fan-in.md, phase-04-override-docs-and-release.md, ../reports/brainstorm-261120-0538-fan-in-arrowheads.md
- Decision deltas checked: 4 (architecture scope, ports for every end, subset merge, factual corrections)
- Reconciled stale references: 7 (architecture `separate` override in plan, phase 4 and the brainstorm report; "every edge mergeable" in the decision table and phase 3; `drawnEnd` line; `emitState` relayout; schema location; extract frame-part line :234 → :236)
- Unresolved contradictions: 0
