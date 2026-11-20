<!-- zukai doc, lang=en: generated from the IR, regenerate instead of editing -->
# Support ticket

Diagram kind: State diagram

## States

| No. | State | Kind |
| --- | --- | --- |
| 1 | (Initial) | Initial |
| 2 | New | Simple |
| 3 | Assigned | Simple |
| 4 | Waiting for customer | Simple |
| 5 | Escalated | Simple |
| 6 | Resolved | Simple |
| 7 | Cancelled | Simple |
| 8 | (Final) | Final |

## Transitions

| State / Event | assign | ask customer | escalate | customer confirms | fix delivered | close | (no event) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| (Initial) | — | — | — | — | — | — | → New |
| New | → Assigned | — | — | — | — | — | → Cancelled |
| Assigned | — | → Waiting for customer | → Escalated | — | — | — | → Cancelled |
| Waiting for customer | — | — | — | → Resolved | — | — | → Cancelled |
| Escalated | — | — | — | — | → Resolved | — | → Cancelled |
| Resolved | — | — | — | — | — | → (Final) | → Cancelled |
| Cancelled | — | — | — | — | — | — | → (Final) |
| (Final) | — | — | — | — | — | — | — |
