<!-- zukai doc, lang=en: generated from the IR, regenerate instead of editing -->
# Routing: reject branch next to merged branches

Diagram kind: Activity diagram

## Lanes

| No. | Lane |
| --- | --- |
| 1 | Order service |

## Steps

| No. | Lane | Step | Kind | Next |
| --- | --- | --- | --- | --- |
| 1 | Order service | (Start) | Start | → Which type? |
| 2 | Order service | Which type? | Decision | [unsupported] → Return 400<br>[A] → Process A<br>[B] → Process B<br>[C] → Process C |
| 3 | Order service | Return 400 | Action | → (End) |
| 4 | Order service | (End) | End | — |
| 5 | Order service | Process A | Action | → Notify customer? |
| 6 | Order service | Process B | Action | → Notify customer? |
| 7 | Order service | Process C | Action | → Notify customer? |
| 8 | Order service | Notify customer? | Decision | [yes] → Return result<br>[no] → (End) |
| 9 | Order service | Return result | Action | → (End) |
| 10 | Order service | (End) | End | — |
