# Brainstorm: arrowheads on slanted shapes and crowded fan-in

Date: 2026-11-20 · Branch: `claude/sleepy-cray-1b79nh` · Status: accepted by the user

## Outcome

Every arrow into a node ends on the outline that is drawn, as a horizontal (or vertical)
arrowhead at the height ELK routed it to, and arrowheads on one side of a node never touch.
Few arrows stay separate; many arrows into one side merge into one line.

## Two reported bugs, one root cause (confirmed by rendering with the draw.io viewer)

- **Root cause.** `anchor()` in `graphCells` (`emit-drawio.mjs:448`) turns ELK's end point,
  which lies on the bounding box, into `entryX/entryY` and leaves the perimeter on
  (`anchorStyle` :459 adds `Perimeter=0` only for an offset). draw.io then projects that
  point onto `parallelogramPerimeter` / `hexagonPerimeter2` along the ray from the centre,
  so the end moves off ELK's height; the orthogonal router adds a 1–2 px jog just before the
  end and the arrowhead takes the jog's direction.
  - Few arrows (3): the end at 0.25 of the height is furthest from the centre; its arrowhead
    points straight down at the top corner. Measured: line at y=110, arrowhead tip at
    y=111.19 drawn as a vertical segment.
  - Even a straight edge turns diagonal (4 arrows: y 120 → 120.67).
- **Compounding cause, any shape.** ELK spreads `k` ends over the node's own height,
  `h/(k+1)` apart, with no minimum. 9 ends on a 40 px box are 4 px apart; the arrowhead is
  7 px tall, so they overlap on a rectangle as well (measured on `rect9`).

Repro files: `fan3`, `fan4`, `fan9`, `rect3`, `rect9` IRs and renders, plus the prototypes
`apply_fix.py` and `apply_merge.py`, in the session scratchpad (not kept in the repo).

## Decisions

| Decision | Value | Why |
|---|---|---|
| Anchor ends on the drawn outline (fix 1) | Always, for `io` (parallelogram) and `queue` (hexagon) | Removes the root cause; separate and merged ends both need it |
| Group | Ends into one node on one side | The spacing problem is per side |
| Merge threshold `N` | 5: a group of 5 or more merges | Chosen by the user over 4 |
| Minimum gap between separate ends (fix 2) | 10 px; the side grows to `(k+1) × 10` when shorter | Approved by the user on the 4-arrow render (box 40 → 50 px) |
| A group that cannot merge | Stays separate with fix 2 | An edge with a label, another arrow or line style, or a back edge cannot share a line |
| Merged line | One shared port at the middle of the side, one junction dot where the branches meet the trunk | Without a dot a branch that passes straight through the trunk reads as a crossing |
| Junction dot | A tagged vertex that `extract` skips | `extract-drawio.mjs:239` keeps every vertex, so an untagged dot would come back as a node |
| Per-diagram override | `fanIn: auto \| merge \| separate`, default `auto` | A fifth edge rearranges the picture; a reviewer can pin the old look |
| Kinds | `fanIn` on flowchart and state only; architecture always separate (Validation Session 1) | In architecture a merged trunk reads as one shared channel, which can be false |
| Mixed group | Merge the mergeable subset when it has 5 or more; the rest stay separate (Validation Session 1) | A cleaner picture than keeping the whole group separate |

## Options weighed

- Grow the side only: keeps every arrow and its label; a target with 9 inputs becomes 100 px tall.
- Merge only: one clean arrow; loses per-edge labels and a merged bundle comes apart when
  someone drags one edge in draw.io.
- Threshold by available space instead of count: adapts to tall boxes, but a label edit that
  adds a line can flip the picture without an obvious reason. Count was kept for predictability.

## Unresolved questions

None; both were decided in the plan's Validation Session 1.
