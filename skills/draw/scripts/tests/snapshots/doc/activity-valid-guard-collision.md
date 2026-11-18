<!-- zukai doc, lang=en: generated from the IR, regenerate instead of editing -->
# Corporate login

Diagram kind: Activity diagram

## Lanes

| No. | Lane |
| --- | --- |
| 1 | User |
| 2 | Web app |
| 3 | Client API |

## Steps

| No. | Lane | Step | Kind | Next |
| --- | --- | --- | --- | --- |
| 1 | User | (Start) | Start | → (Merge) |
| 2 | User | (Merge) | Merge | → Enter custID and custPass |
| 3 | User | Enter custID and custPass | Action | → Submit login-by-staff (hand-off to Web app) |
| 4 | Web app | Submit login-by-staff | Action | → Verify staff with CK Pass (hand-off to Client API) |
| 5 | Client API | Verify staff with CK Pass | Action | → Token and office? |
| 6 | Client API | Token and office? | Decision | [yes] → Filter active offices<br>[no] → Show login error (hand-off to Web app) |
| 7 | Client API | Filter active offices | Action | → Store token and staff info (hand-off to Web app) |
| 8 | Web app | Store token and staff info | Action | → Only one entity? |
| 9 | Web app | Show login error | Action | [no: report the error, back to the form] → (Merge) (hand-off to User)<br>[no] → Only one entity? |
| 10 | Web app | Only one entity? | Decision | [yes] → (End)<br>[no: show the office list] → Choose office (hand-off to User) |
| 11 | User | Choose office | Action | → (End) (hand-off to Web app) |
| 12 | Web app | (End) | End | — |
