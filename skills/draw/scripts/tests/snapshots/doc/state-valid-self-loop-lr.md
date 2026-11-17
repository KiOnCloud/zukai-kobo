<!-- zukai doc, lang=en: generated from the IR, regenerate instead of editing -->
# Payment retries

Diagram kind: State diagram

## States

| No. | State | Kind |
| --- | --- | --- |
| 1 | (Initial) | Initial |
| 2 | Awaiting payment (attempt n) | Simple |
| 3 | Paid | Simple |
| 4 | Payment failed | Simple |
| 5 | (Final) | Final |

## Transitions

| State / Event | order placed | card declined | payment captured | (no event) |
| --- | --- | --- | --- | --- |
| (Initial) | → Awaiting payment (attempt n) | — | — | — |
| Awaiting payment (attempt n) | — | → Awaiting payment (attempt n) [n &lt; 3]<br>→ Payment failed [n = 3] | → Paid | — |
| Paid | — | — | — | → (Final) |
| Payment failed | — | — | — | → (Final) |
| (Final) | — | — | — | — |
