<!-- zukai doc, lang=en: generated from the IR, regenerate instead of editing -->
# Order fulfilment

Diagram kind: Activity diagram

## Lanes

| No. | Lane |
| --- | --- |
| 1 | Customer |
| 2 | Shop |
| 3 | Warehouse |

## Steps

| No. | Lane | Step | Kind | Next |
| --- | --- | --- | --- | --- |
| 1 | Customer | (Start) | Start | → Place an order |
| 2 | Customer | Place an order | Action | → Collect the order lines placed in the last 24 hours (express orders: last 48 hours); skip cancelled lines; gift orders: wrapped items only; bulk orders: drop back-ordered items (hand-off to Shop) |
| 3 | Shop | Collect the order lines placed in the last 24 hours (express orders: last 48 hours); skip cancelled lines; gift orders: wrapped items only; bulk orders: drop back-ordered items | Action | → Any lines? |
| 4 | Shop | Any lines? | Decision | [yes] → Price the lines with the customer's current tier, from 00:00 of the order day (members) or the previous day (guests); skip expired coupons<br>[no: nothing to ship] → (Merge) |
| 5 | Shop | Price the lines with the customer's current tier, from 00:00 of the order day (members) or the previous day (guests); skip expired coupons | Action | → (Merge) |
| 6 | Shop | (Merge) | Merge | → Pick the items (hand-off to Warehouse) |
| 7 | Warehouse | Pick the items | Action | → Ship the parcel |
| 8 | Warehouse | Ship the parcel | Action | → (End) |
| 9 | Warehouse | (End) | End | — |
