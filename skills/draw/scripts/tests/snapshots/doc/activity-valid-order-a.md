<!-- zukai doc, lang=en: generated from the IR, regenerate instead of editing -->
# Order A: early exit declared first

Diagram kind: Activity diagram

## Lanes

| No. | Lane |
| --- | --- |
| 1 | Order service |

## Steps

| No. | Lane | Step | Kind | Next |
| --- | --- | --- | --- | --- |
| 1 | Order service | (Start) | Start | → In stock? |
| 2 | Order service | In stock? | Decision | [yes] → Reserve stock<br>[no] → Return empty result |
| 3 | Order service | Reserve stock | Action | → Create shipment |
| 4 | Order service | Create shipment | Action | → (End) |
| 5 | Order service | (End) | End | — |
| 6 | Order service | Return empty result | Action | → (End) |
| 7 | Order service | (End) | End | — |
