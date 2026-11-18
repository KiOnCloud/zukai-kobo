<!-- zukai doc, lang=en: generated from the IR, regenerate instead of editing -->
# Order lifecycle

Diagram kind: State diagram

## States

| No. | State | Kind | Parent state |
| --- | --- | --- | --- |
| 1 | (Initial) | Initial | — |
| 2 | Draft | Simple | — |
| 3 | Placed | Simple | — |
| 4 | Processing | Composite | — |
| 5 | Processing › (Initial) | Initial | Processing |
| 6 | Picking | Simple | Processing |
| 7 | Packing | Simple | Processing |
| 8 | Processing › (Final) | Final | Processing |
| 9 | Shipped | Simple | — |
| 10 | Cancelled | Simple | — |
| 11 | (Final) | Final | — |

## Transitions

| State / Event | submit | payment captured | all items picked | label printed | carrier pickup | cancel | (no event) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| (Initial) | — | — | — | — | — | — | → Draft |
| Draft | → Placed [cart not empty] | — | — | — | — | — | — |
| Placed | — | → Processing / reserve stock | — | — | — | → Cancelled [not yet processing] | — |
| Processing | — | — | — | — | → Shipped | — | — |
| Processing › (Initial) | — | — | — | — | — | — | → Picking |
| Picking | — | — | → Packing | — | — | — | — |
| Packing | — | — | — | → Processing › (Final) | — | — | — |
| Processing › (Final) | — | — | — | — | — | — | — |
| Shipped | — | — | — | — | — | — | → (Final) |
| Cancelled | — | — | — | — | — | — | → (Final) |
| (Final) | — | — | — | — | — | — | — |
