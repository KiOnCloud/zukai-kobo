<!-- zukai doc, lang=en: generated from the IR, regenerate instead of editing -->
# Guard on a straight branch into a shared bus

Diagram kind: Activity diagram

## Lanes

| No. | Lane |
| --- | --- |
| 1 | Client |
| 2 | API |
| 3 | Store |

## Steps

| No. | Lane | Step | Kind | Next |
| --- | --- | --- | --- | --- |
| 1 | Client | (Start) | Start | → Send order |
| 2 | Client | Send order | Action | → Valid? (hand-off to API) |
| 3 | API | Valid? | Decision | [no] → Reject order<br>[yes] → Check stock |
| 4 | API | Reject order | Action | → (End) |
| 5 | API | Check stock | Action | → Dry run? |
| 6 | API | Dry run? | Decision | [yes: nothing is sent] → (End)<br>[no] → Notify store (hand-off to Store) |
| 7 | Store | Notify store | Action | → Store confirms |
| 8 | Store | Store confirms | Action | → (End) (hand-off to API) |
| 9 | API | (End) | End | — |
