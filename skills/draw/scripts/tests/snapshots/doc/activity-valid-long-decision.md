<!-- zukai doc, lang=en: generated from the IR, regenerate instead of editing -->
# Upload check

Diagram kind: Activity diagram

## Lanes

| No. | Lane |
| --- | --- |
| 1 | Client |
| 2 | Upload API |

## Steps

| No. | Lane | Step | Kind | Next |
| --- | --- | --- | --- | --- |
| 1 | Client | (Start) | Start | → Send a file |
| 2 | Client | Send a file | Action | → Type is PDF or PNG and size is under the configured limit? (hand-off to Upload API) |
| 3 | Upload API | Type is PDF or PNG and size is under the configured limit? | Decision | [no] → Reject the upload<br>[yes] → Store the file |
| 4 | Upload API | Reject the upload | Action | → (End) (hand-off to Client) |
| 5 | Upload API | Store the file | Action | → (End) (hand-off to Client) |
| 6 | Client | (End) | End | — |
