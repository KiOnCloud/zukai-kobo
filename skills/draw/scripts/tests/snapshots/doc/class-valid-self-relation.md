<!-- zukai doc, lang=en: generated from the IR, regenerate instead of editing -->
# Invoice settlement

Diagram kind: Class diagram

## Classes

### Payment

| No. | Member | Kind | Type | Visibility |
| --- | --- | --- | --- | --- |
| 1 | amount | Attribute | decimal | public |
| 2 | receivedOn | Attribute | Date | public |

### Reminder

| No. | Member | Kind | Type | Visibility |
| --- | --- | --- | --- | --- |
| 1 | level | Attribute | int | public |

### Dispute

| No. | Member | Kind | Type | Visibility |
| --- | --- | --- | --- | --- |
| 1 | reason | Attribute | string | public |

### LedgerEntry

| No. | Member | Kind | Type | Visibility |
| --- | --- | --- | --- | --- |
| 1 | account | Attribute | string | public |

### Invoice

| No. | Member | Kind | Type | Visibility |
| --- | --- | --- | --- | --- |
| 1 | number | Attribute | string | public |
| 2 | total | Attribute | decimal | private |
| 3 | credit(amount: decimal) | Method | Invoice | public |

## Relations

| No. | From | Relation | To | Label | From cardinality | To cardinality |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Payment | Association | Invoice | settles | 0..\* | 1 |
| 2 | Reminder | Association | Invoice | — | — | 1 |
| 3 | Dispute | Dependency | Invoice | — | — | — |
| 4 | LedgerEntry | Association | Invoice | — | 1..\* | 1 |
| 5 | Invoice | Association | Invoice | credits | 0..1 | 0..\* |
