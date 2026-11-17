<!-- zukai doc, lang=en: generated from the IR, regenerate instead of editing -->
# Payment retries

Diagram kind: State diagram

## States

| No. | State | Kind | Parent state |
| --- | --- | --- | --- |
| 1 | (Initial) | Initial | — |
| 2 | Awaiting payment | Simple | — |
| 3 | Under review | Composite | — |
| 4 | Checking | Simple | Under review |
| 5 | On hold | Simple | Under review |
| 6 | Paid | Simple | — |
| 7 | (Final) | Final | — |

## Transitions

| State / Event | payment failed | flagged | more data | suspicious | cleared | payment captured | (no event) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| (Initial) | — | — | — | — | — | — | → Awaiting payment |
| Awaiting payment | → Awaiting payment [attempts &lt; 3] / notify customer | → Checking | — | — | — | → Paid | — |
| Under review | — | — | — | — | — | — | — |
| Checking | — | — | → Checking | → On hold | — | — | — |
| On hold | — | — | — | — | → Paid | — | — |
| Paid | — | — | — | — | — | — | → (Final) |
| (Final) | — | — | — | — | — | — | — |
