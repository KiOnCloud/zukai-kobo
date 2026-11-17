<!-- zukai doc, lang=en: generated from the IR, regenerate instead of editing -->
# Guard on a straight branch

Diagram kind: Activity diagram

## Lanes

| No. | Lane |
| --- | --- |
| 1 | Order service |
| 2 | Bank |

## Steps

| No. | Lane | Step | Kind | Next |
| --- | --- | --- | --- | --- |
| 1 | Order service | (Start) | Start | → Test request? |
| 2 | Order service | Test request? | Decision | [yes: nothing is sent] → (End)<br>[no] → Check the limit (hand-off to Bank) |
| 3 | Order service | (End) | End | — |
| 4 | Bank | Check the limit | Action | → (End) |
| 5 | Bank | (End) | End | — |
