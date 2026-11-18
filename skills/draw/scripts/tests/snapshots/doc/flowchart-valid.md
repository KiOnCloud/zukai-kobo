<!-- zukai doc, lang=en: generated from the IR, regenerate instead of editing -->
# Order checkout

Diagram kind: Flowchart

## Steps

| No. | Step | Kind | Group | Next | Details |
| --- | --- | --- | --- | --- | --- |
| 1 | Customer submits cart | Start / end | — | → Validate cart contents | — |
| 2 | Validate cart contents | Process | — | → All items in stock? | — |
| 3 | All items in stock? | Decision | — | [yes] → Reserve stock<br>[no] → Offer backorder | — |
| 4 | Reserve stock | Subprocess | Fulfilment | → Capture payment | — |
| 5 | Capture payment | Process | Fulfilment | captured → Send receipt email | `order-checkout-payment` |
| 6 | Send receipt email | Input / output | Fulfilment | → Order placed | — |
| 7 | Order placed | Start / end | — | — | — |
| 8 | Offer backorder | Process | — | → Order placed | — |
| 9 | Stock is checked per warehouse | Note | — | → All items in stock? | — |

## Groups

| No. | Group |
| --- | --- |
| 1 | Fulfilment |
