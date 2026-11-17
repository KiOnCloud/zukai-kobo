<!-- zukai doc, lang=en: generated from the IR, regenerate instead of editing -->
# Orders (main)

Diagram kind: ER diagram

## Entities

### CUSTOMER

Details: `order-sync-01-load`

| No. | Attribute | Type | Key |
| --- | --- | --- | --- |
| 1 | id | int | PK |

### ORDER

| No. | Attribute | Type | Key |
| --- | --- | --- | --- |
| 1 | id | int | PK |
| 2 | customer\_id | int | FK |

## Relations

| No. | From | From cardinality | To | To cardinality | Relation | Identifying |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | CUSTOMER | 1 | ORDER | 0..* | places | Yes |
