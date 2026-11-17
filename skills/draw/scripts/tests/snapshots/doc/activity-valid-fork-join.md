<!-- zukai doc, lang=en: generated from the IR, regenerate instead of editing -->
# Order fulfilment

Diagram kind: Activity diagram

## Lanes

| No. | Lane |
| --- | --- |
| 1 | Sales |
| 2 | Warehouse |
| 3 | Finance |

## Steps

| No. | Lane | Step | Kind | Next |
| --- | --- | --- | --- | --- |
| 1 | Sales | (Start) | Start | → Receive order |
| 2 | Sales | Receive order | Action | → (Fork) |
| 3 | Sales | (Fork) | Fork | → Pick items (hand-off to Warehouse)<br>→ Issue invoice (hand-off to Finance) |
| 4 | Warehouse | Pick items | Action | → Pack parcel |
| 5 | Warehouse | Pack parcel | Action | → (Join) |
| 6 | Finance | Issue invoice | Action | → Capture payment |
| 7 | Finance | Capture payment | Action | → Payment ok? |
| 8 | Finance | Payment ok? | Decision | [yes] → (Join) (hand-off to Warehouse)<br>[no] → Put order on hold (hand-off to Sales) |
| 9 | Warehouse | (Join) | Join | → Hand over to carrier |
| 10 | Warehouse | Hand over to carrier | Action | → Notify customer (hand-off to Sales) |
| 11 | Sales | Notify customer | Action | → (Merge) |
| 12 | Sales | Put order on hold | Action | → (Merge) |
| 13 | Sales | (Merge) | Merge | → (End) |
| 14 | Sales | (End) | End | — |
