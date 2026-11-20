---
title: "Lines through composite titles, class ends at table corners and jogs at state circles"
description: "A line that enters a composite state from above no longer runs through its title; class relations end on the table when a self-relation widened its layout box; lines meet the circle of an initial or final state without a jog."
status: pending
priority: P1
effort: 1.5d
branch: claude/sleepy-cray-1b79nh
tags: [bugfix, layout, drawio]
blockedBy: []
blocks: []
created: 2026-11-20
---

# Lines through composite titles, class ends at table corners and jogs at state circles

## Overview

Three draw.io layout defects, confirmed on main `7c26f13` (release 2.8.0) by rendering with
the draw.io viewer. All three give the same bytes in the 2.7.1 bundle, so none comes from
the fan-in release. Scope mode: HOLD SCOPE (no `--yagni`).

| # | Defect | Root cause | Where it shows |
|---|---|---|---|
| A | A line that enters a composite state from above runs through its title | `emitState` gives a composite no `title` and never calls `placeGroupTitles`, which flowchart, architecture and use case do | every state fixture with a composite: `valid-self-loop` (line at the last letter), `valid-order-lifecycle`, `valid`, `valid-ref-parts` (through the middle) |
| B | A class relation ends at a corner of the table, coming in sideways | `emitClass` widens the layout box of a class with a self-relation and lays out once, so ends the layout puts beside the table are clamped to its corners | class, top-down and bottom-up, a self-relation and 3 or more relations on one side |
| C | Lines out of an initial state (or into a final one) jog at the circle when several meet it | `anchor()` knows the outline of a parallelogram and a hexagon only; draw.io moves the other ends towards the centre of the circle | state, 2 or more lines on one side of a circle |

The corner routing in the user's third image (a line leaving a state from its bottom corner)
is the 2.7.1 picture: 2.8.0 moved those ends onto the shape for flowchart and state. Defect B
is the same fault where it is still left, in class diagrams. Defect C was found while
probing; it is the fault 2.8.0 fixed for parallelograms, on a shape that release left out.

Each fix was prototyped in a throwaway edit and measured on renders (titles clear in all
six state fixtures and four probes; no class end at a corner in 16 probes; circle lines
straight), then reverted. Evidence, probes and prior conventions: the user's report in this
session and `plans/261120-0538-fan-in-arrowheads-on-shapes/`.

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | [Composite titles step aside](./phase-01-composite-titles-step-aside.md) | Pending |
| 2 | [Class relations end on the table](./phase-02-class-ends-on-the-table.md) | Pending |
| 3 | [Ends on the circle of an initial or final state](./phase-03-ends-on-state-circles.md) | Pending |
| 4 | [Docs, test sweep and release 2.8.1](./phase-04-docs-tests-and-release.md) | Pending |

Order: 1, 2 and 3 are independent of one another but all edit `emit-drawio.mjs`, so they run
in sequence; 4 follows the three.

## Acceptance criteria

Measured on the SVG the draw.io viewer draws (`cli export`), through the rebuilt bundle:

- [ ] In every state fixture with a composite and in probes with 1, 2 and 3 transitions
      into one composite (top-down and bottom-up), the text of each composite title is at
      least 12 px from every line and line label in its header strip.
- [ ] A composite whose header no line crosses keeps its title centred and its style bytes.
- [ ] In a class diagram (top-down and bottom-up) with a self-relation and 3, 4 and 6
      relations into the same class, every relation ends on the top or bottom side inside
      the width of the table with a last stretch along the flow; none ends at a corner.
- [ ] Class diagrams without a self-relation, and every ER, architecture, use case, sequence
      and activity fixture, are byte-identical to the 2.8.0 bundle.
- [ ] Two, three and four lines out of an initial state and into a final state, in four
      directions: first and last stretch within 0.5 px of the flow, each end on the circle.
- [ ] `npm test` passes, the bundle is rebuilt and `bundle-drift` passes.

## Risks

- Moving a title can widen its composite, which moves the lines; `placeGroupTitles` already
  loops up to six layouts for that and reports a title it could not place.
- State snapshots change for all three reasons; each change is checked on a render.
- A circle cannot grow, so many ends on one stay closer than 10 px. Out of scope here.

## Unresolved questions

None. Scope, the title rule, the class approach and the release were decided in Validation
Session 1.

## Validation Log

### Session 1 — 2026-11-20
**Trigger:** `/ak-plan` after the defects were confirmed on main; validation mode `prompt`.
**Questions asked:** 4

### Verification Results
- **Tier:** Standard (4 phases: Fact Checker + Contract Verifier)
- **Claims checked:** 38
- **Verified:** 38 | **Failed:** 0 | **Unverified:** 0
- Fact Checker: every cited line of `emit-drawio.mjs`, `figjam-native.mjs:339`,
  `target-drawio.md` (:168, :171, :180, :257) and `docs/install.md:771` holds the symbol or
  text the phases name.
- Contract Verifier: `sidePorts` has 2 callers (`emitFlowchart` :1043, `emitState` :1087),
  and the new option has a default, so both keep their behaviour; the shape test has 2
  callers (:533, :715); `placeGroupTitles` has 3 callers (:1046, :2628, :3012) and is not
  changed; none of these symbols is exported or used outside `emit-drawio.mjs`.
- Behaviour, by a throwaway prototype measured on viewer renders and then reverted: titles
  clear in six state fixtures and four probes; no class end at a corner in 16 probes (TB,
  BT, LR, RL with 2, 3, 4 and 6 relations); three lines out of an initial state start
  `M 233 48.27 L 233 75` with no stretch across the flow.

#### Questions & Answers

1. **[Scope]** Đã confirm lỗi A (line cắt title của composite state, ví dụ "Under review"). Ảnh 3 (line rời state từ góc) là bản 2.7.1, state đã được sửa ở 2.8.0. Ngoài A, đưa thêm lỗi nào vào plan?
   - Options (multi-select): B: class vào góc bảng | C: gãy ở hình tròn
   - **Answer:** B: class vào góc bảng, C: gãy ở hình tròn
   - **Rationale:** B is the fault of the third image where it is still left; C is the 2.8.0 outline fix on a shape that release left out. Both go in.
2. **[Tradeoffs]** Lỗi A: khi các line chiếm giữa header của composite state, title dời sang đoạn trống gần nhất. Nếu không đoạn nào đủ dài thì xử lý thế nào? (Prototype với 3 line: composite giãn từ 332 lên 437 px, title nằm bên phải.)
   - Options: Giãn composite (Recommended) | Không giãn, chỉ warning
   - **Answer:** Giãn composite (Recommended)
   - **Rationale:** The same rule as a flowchart group and a use case boundary; a title is never cut, at the price of a frame wider than its content.
3. **[Architecture]** Lỗi B (class diagram): sửa theo hướng nào?
   - Options: Chỉ dàn đầu nằm ngoài bảng (Recommended) | Áp luôn quy tắc 10 px | Bỏ qua B
   - **Answer:** Chỉ dàn đầu nằm ngoài bảng (Recommended)
   - **Rationale:** Class diagrams without a self-relation keep their bytes; the 10 px rule for class was not asked for and would grow tables past their rows.
4. **[Scope]** Plan có kèm release không?
   - Options: Patch 2.8.1 (Recommended) | Không bump version
   - **Answer:** Patch 2.8.1 (Recommended)

#### Confirmed Decisions
- Scope: defects A, B and C.
- Composite title: moves to the nearest free stretch; the composite is widened when none is long enough; a warning after six layouts.
- Class: `sidePorts` with `minGap: 0` and `fanIn: 'separate'`; no 10 px rule, no growth, no merge.
- Release: patch 2.8.1.

#### Impact on Phases
- None. Each answer is the option the phases were drafted with, so phases 1 to 4 stand as written.

### Whole-Plan Consistency Sweep
- Files reread: plan.md, phase-01-composite-titles-step-aside.md, phase-02-class-ends-on-the-table.md, phase-03-ends-on-state-circles.md, phase-04-docs-tests-and-release.md
- Decision deltas checked: 4 (scope, title rule, class approach, release)
- Reconciled stale references: 0
- Unresolved contradictions: 0

<!-- slug: lines-through-titles-and-corner-ends -->
