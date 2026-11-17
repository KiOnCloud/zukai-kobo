<!-- zukai doc, lang=en: generated from the IR, regenerate instead of editing -->
# Invoice download

Diagram kind: Activity diagram

## Lanes

| No. | Lane |
| --- | --- |
| 1 | Client |
| 2 | Billing API |
| 3 | Invoice store |

## Steps

| No. | Lane | Step | Kind | Next |
| --- | --- | --- | --- | --- |
| 1 | Client | (Start) | Start | → Request an invoice PDF |
| 2 | Client | Request an invoice PDF | Action | → Find the invoice file by number and version (hand-off to Invoice store) |
| 3 | Invoice store | Find the invoice file by number and version | Action | → File found? (hand-off to Billing API) |
| 4 | Billing API | File found? | Decision | [no] → Return 'invoice not found'<br>[yes] → Send the PDF to the client |
| 5 | Billing API | Return 'invoice not found' | Action | → (End) (hand-off to Client) |
| 6 | Billing API | Send the PDF to the client | Action | → Save the PDF (hand-off to Client) |
| 7 | Client | Save the PDF | Action | → (End) |
| 8 | Client | (End) | End | — |
