<!-- zukai doc, lang=en: generated from the IR, regenerate instead of editing -->
# Refund approval

Diagram kind: Flowchart

## Steps

| No. | Step | Kind | Group | Next |
| --- | --- | --- | --- | --- |
| 1 | Customer asks for a refund | Start / end | — | → Refund form with order number and reason |
| 2 | Refund form with order number and reason | Input / output | — | → Order found? |
| 3 | Order found? | Decision | — | [no] → Ask the customer to correct the order number<br>[yes] → Amount over 500 EUR? |
| 4 | Ask the customer to correct the order number | Process | — | → Refund form with order number and reason |
| 5 | Amount over 500 EUR? | Decision | Approval | [no] → Approve automatically<br>[yes] → Manager review |
| 6 | Approve automatically | Process | Approval | → Pay back to the original card |
| 7 | Manager review | Subprocess | Approval | → Manager approves? |
| 8 | Manager approves? | Decision | Approval | [no] → Send rejection with reason<br>[yes] → Pay back to the original card |
| 9 | Send rejection with reason | Process | — | → Refund closed |
| 10 | Pay back to the original card | Process | Payout | → Book the refund in the ledger |
| 11 | Book the refund in the ledger | Process | Finance | → Refund closed |
| 12 | Card refunds take 3 to 5 working days | Note | Payout | → Pay back to the original card |
| 13 | Refund closed | Start / end | — | — |

## Groups

| No. | Group | Inside |
| --- | --- | --- |
| 1 | Finance | — |
| 2 | Payout | Finance |
| 3 | Approval | — |
