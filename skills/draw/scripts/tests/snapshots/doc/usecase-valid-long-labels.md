<!-- zukai doc, lang=en: generated from the IR, regenerate instead of editing -->
# 経費精算

Diagram kind: Use case diagram

## Actors

| No. | Actor | Kind | Role |
| --- | --- | --- | --- |
| 1 | 従業員 | Person | Primary |
| 2 | Phê duyệt viên cấp phòng ban và cấp công ty | Person | Primary |
| 3 | AccountsPayableReconciliationService | System | Supporting |

## Use cases

| No. | Use case | Boundary |
| --- | --- | --- |
| 1 | 出張旅費および交際費の経費精算申請を提出する | 経費精算システム (Expense reimbursement system of the whole group) |
| 2 | Attach the receipts and the supporting documents that the finance policy asks for | 経費精算システム (Expense reimbursement system of the whole group) |
| 3 | Duyệt yêu cầu hoàn ứng | 経費精算システム (Expense reimbursement system of the whole group) |
| 4 | ExportApprovedExpenseClaimsToAccountsPayable(batch) | 経費精算システム (Expense reimbursement system of the whole group) |
| 5 | OK | 経費精算システム (Expense reimbursement system of the whole group) |

## Boundaries

| No. | Boundary |
| --- | --- |
| 1 | 経費精算システム (Expense reimbursement system of the whole group) |

## Relations

| No. | From | Relation | To | Condition |
| --- | --- | --- | --- | --- |
| 1 | 従業員 | Association | 出張旅費および交際費の経費精算申請を提出する | — |
| 2 | 出張旅費および交際費の経費精算申請を提出する | Include | Attach the receipts and the supporting documents that the finance policy asks for | — |
| 3 | Phê duyệt viên cấp phòng ban và cấp công ty | Association | Duyệt yêu cầu hoàn ứng | — |
| 4 | ExportApprovedExpenseClaimsToAccountsPayable(batch) | Extend | Duyệt yêu cầu hoàn ứng | 承認済みの申請がある |
| 5 | AccountsPayableReconciliationService | Association | ExportApprovedExpenseClaimsToAccountsPayable(batch) | — |
| 6 | 従業員 | Association | OK | — |
