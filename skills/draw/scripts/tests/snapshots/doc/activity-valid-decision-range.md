<!-- zukai doc, lang=en: generated from the IR, regenerate instead of editing -->
# Ticket triage

Diagram kind: Activity diagram

## Lanes

| No. | Lane |
| --- | --- |
| 1 | Help desk |

## Steps

| No. | Lane | Step | Kind | Next |
| --- | --- | --- | --- | --- |
| 1 | Help desk | (Start) | Start | → Conditions present and office type 0-5? |
| 2 | Help desk | Conditions present and office type 0-5? | Decision | [yes] → Escalate<br>[no] → Close the ticket |
| 3 | Help desk | Escalate | Action | → (End) |
| 4 | Help desk | Close the ticket | Action | → (End) |
| 5 | Help desk | (End) | End | — |
