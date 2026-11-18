<!-- zukai doc, lang=en: generated from the IR, regenerate instead of editing -->
# Order lifecycle (main)

Diagram kind: State diagram

## States

| No. | State | Kind | Parent state | Details |
| --- | --- | --- | --- | --- |
| 1 | (Initial) | Initial | — | — |
| 2 | New | Simple | — | — |
| 3 | Paying | Simple | — | `order-sync-01-load` |
| 4 | Fulfilment | Composite | — | `order-sync-02-store` |
| 5 | Picking | Simple | Fulfilment | — |
| 6 | Shipped | Simple | Fulfilment | — |
| 7 | (Final) | Final | — | — |

## Transitions

| State / Event | checkout | paid | handed over | (no event) |
| --- | --- | --- | --- | --- |
| (Initial) | — | — | — | → New |
| New | → Paying | — | — | — |
| Paying | — | → Picking | — | — |
| Fulfilment | — | — | — | — |
| Picking | — | — | → Shipped | — |
| Shipped | — | — | — | → (Final) |
| (Final) | — | — | — | — |
