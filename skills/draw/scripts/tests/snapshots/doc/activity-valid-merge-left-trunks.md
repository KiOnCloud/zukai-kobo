<!-- zukai doc, lang=en: generated from the IR, regenerate instead of editing -->
# Catalogue export

Diagram kind: Activity diagram

## Lanes

| No. | Lane |
| --- | --- |
| 1 | Client |
| 2 | Shop API |
| 3 | Product store |

## Steps

| No. | Lane | Step | Kind | Next |
| --- | --- | --- | --- | --- |
| 1 | Client | (Start) | Start | → Request the catalogue of one shop |
| 2 | Client | Request the catalogue of one shop | Action | → Shop code valid? (hand-off to Shop API) |
| 3 | Shop API | Shop code valid? | Decision | [yes] → Read the shop's active categories (hand-off to Product store)<br>[no] → (Merge) |
| 4 | Product store | Read the shop's active categories | Action | → Any categories? (hand-off to Shop API) |
| 5 | Shop API | Any categories? | Decision | [yes] → Read the products on sale today (hand-off to Product store)<br>[no] → (Merge) |
| 6 | Product store | Read the products on sale today | Action | → Any products? (hand-off to Shop API) |
| 7 | Shop API | Any products? | Decision | [yes] → Drop products without a price<br>[no] → (Merge) |
| 8 | Shop API | Drop products without a price | Action | → Return the catalogue |
| 9 | Shop API | Return the catalogue | Action | → (End) (hand-off to Client) |
| 10 | Shop API | (Merge) | Merge | → Return an empty catalogue |
| 11 | Shop API | Return an empty catalogue | Action | → (End) (hand-off to Client) |
| 12 | Client | (End) | End | — |
