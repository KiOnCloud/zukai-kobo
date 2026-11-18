<!-- zukai doc, lang=en: generated from the IR, regenerate instead of editing -->
# Routing: early exit shares the merge band

Diagram kind: Activity diagram

## Lanes

| No. | Lane |
| --- | --- |
| 1 | Order service |

## Steps

| No. | Lane | Step | Kind | Next |
| --- | --- | --- | --- | --- |
| 1 | Order service | (Start) | Start | → Which order type? |
| 2 | Order service | Which order type? | Decision | [unsupported] → Return 400<br>[1] → Standard order flow<br>[2] → Express order flow<br>[3] → Backorder flow<br>[4] → Pre-order flow |
| 3 | Order service | Return 400 | Action | → (End) |
| 4 | Order service | (End) | End | — |
| 5 | Order service | Standard order flow | Action | → Notify customer? |
| 6 | Order service | Express order flow | Action | → Notify customer? |
| 7 | Order service | Backorder flow | Action | → Notify customer? |
| 8 | Order service | Pre-order flow | Action | → Notify customer? |
| 9 | Order service | Notify customer? | Decision | [yes] → Return result<br>[no] → (End) |
| 10 | Order service | Return result | Action | → (End) |
| 11 | Order service | (End) | End | — |
