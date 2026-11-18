<!-- zukai doc, lang=en: generated from the IR, regenerate instead of editing -->
# Return request

Diagram kind: Activity diagram

## Lanes

| No. | Lane |
| --- | --- |
| 1 | Customer |
| 2 | Support |

## Steps

| No. | Lane | Step | Kind | Next | Details |
| --- | --- | --- | --- | --- | --- |
| 1 | Customer | (Start) | Start | → Request return | — |
| 2 | Customer | Request return | Action | → Review request (hand-off to Support) | — |
| 3 | Support | Review request | Action | → Eligible? | — |
| 4 | Support | Eligible? | Decision | [yes] → Approve and send label<br>[no] → Explain rejection | — |
| 5 | Support | Approve and send label | Action | → Ship item back (hand-off to Customer) | `return-request-label` |
| 6 | Customer | Ship item back | Action | → (End) | — |
| 7 | Support | Explain rejection | Action | → (End) (hand-off to Customer) | — |
| 8 | Customer | (End) | End | — | — |
