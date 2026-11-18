<!-- zukai doc, lang=en: generated from the IR, regenerate instead of editing -->
# Sync and async report

Diagram kind: Activity diagram

## Lanes

| No. | Lane |
| --- | --- |
| 1 | Client |
| 2 | API |
| 3 | Worker |

## Steps

| No. | Lane | Step | Kind | Next |
| --- | --- | --- | --- | --- |
| 1 | Client | (Start) | Start | → Request a report |
| 2 | Client | Request a report | Action | → Sync or async? (hand-off to API) |
| 3 | API | Sync or async? | Decision | [async] → Queue a background job<br>[sync] → Build the report now |
| 4 | API | Queue a background job | Action | → (Fork) |
| 5 | API | (Fork) | Fork | → Reply 202<br>→ Job builds the report |
| 6 | API | Reply 202 | Action | → (End) |
| 7 | API | (End) | End | — |
| 8 | API | Job builds the report | Action | → Input usable? (hand-off to Worker) |
| 9 | API | Build the report now | Action | → Input usable? (hand-off to Worker) |
| 10 | Worker | Input usable? | Decision | [no] → Empty report (hand-off to API)<br>[yes] → Build the report |
| 11 | API | Empty report | Action | → Who gets it? |
| 12 | Worker | Build the report | Action | → Who gets it? (hand-off to API) |
| 13 | API | Who gets it? | Decision | [sync] → Return the report<br>[async] → Send the report |
| 14 | API | Return the report | Action | → (End) |
| 15 | API | (End) | End | — |
| 16 | API | Send the report | Action | → (End) |
| 17 | API | (End) | End | — |
