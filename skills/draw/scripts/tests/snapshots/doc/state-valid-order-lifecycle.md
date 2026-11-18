<!-- zukai doc, lang=en: generated from the IR, regenerate instead of editing -->
# Order lifecycle

Diagram kind: State diagram

## States

| No. | State | Kind | Parent state |
| --- | --- | --- | --- |
| 1 | (Initial) | Initial | — |
| 2 | New | Simple | — |
| 3 | Awaiting payment | Simple | — |
| 4 | Fulfilment | Composite | — |
| 5 | Fulfilment › (Initial) | Initial | Fulfilment |
| 6 | Picking | Simple | Fulfilment |
| 7 | Packing | Simple | Fulfilment |
| 8 | Fulfilment › (Final) | Final | Fulfilment |
| 9 | Shipped | Simple | — |
| 10 | Delivered | Simple | — |
| 11 | Cancelled | Simple | — |
| 12 | Returned | Simple | — |
| 13 | (Final) | Final | — |

## Transitions

| State / Event | checkout | payment failed | payment captured | all items picked | label printed | carrier pickup | proof of delivery | customer cancels | timeout | out of stock | return received | item missing | (no event) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| (Initial) | — | — | — | — | — | — | — | — | — | — | — | — | → New |
| New | → Awaiting payment | — | — | — | — | — | — | → Cancelled | — | — | — | — | — |
| Awaiting payment | — | → Awaiting payment [attempts &lt; 3] / notify customer | → Fulfilment / reserve stock | — | — | — | — | — | → Cancelled [after 24 h] | — | — | — | — |
| Fulfilment | — | — | — | — | — | → Shipped | — | — | — | → Cancelled / refund | — | — | — |
| Fulfilment › (Initial) | — | — | — | — | — | — | — | — | — | — | — | — | → Picking |
| Picking | — | — | — | → Packing | — | — | — | — | — | — | — | → Picking / restock request | — |
| Packing | — | — | — | — | → Fulfilment › (Final) | — | — | — | — | — | — | — | — |
| Fulfilment › (Final) | — | — | — | — | — | — | — | — | — | — | — | — | — |
| Shipped | — | — | — | — | — | — | → Delivered | — | — | — | — | — | — |
| Delivered | — | — | — | — | — | — | — | — | — | — | → Returned [within 30 days] | — | → (Final) |
| Cancelled | — | — | — | — | — | — | — | — | — | — | — | — | → (Final) |
| Returned | — | — | — | — | — | — | — | — | — | — | — | — | → (Final) |
| (Final) | — | — | — | — | — | — | — | — | — | — | — | — | — |
