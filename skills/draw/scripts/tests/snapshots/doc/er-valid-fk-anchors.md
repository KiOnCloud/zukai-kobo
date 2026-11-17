<!-- zukai doc, lang=en: generated from the IR, regenerate instead of editing -->
# Addresses on an order

Diagram kind: ER diagram

## Entities

### Customer

| No. | Attribute | Type | Key |
| --- | --- | --- | --- |
| 1 | id | uuid | PK |

### Address

| No. | Attribute | Type | Key |
| --- | --- | --- | --- |
| 1 | id | uuid | PK |
| 2 | line1 | varchar(200) | — |

### Order

| No. | Attribute | Type | Key |
| --- | --- | --- | --- |
| 1 | id | uuid | PK |
| 2 | customer\_id | uuid | FK |
| 3 | billing\_address\_id | uuid | FK |
| 4 | shipping\_address\_id | uuid | FK |
| 5 | total | decimal(10,2) | — |
| 6 | status | varchar(20) | — |

## Relations

| No. | From | From cardinality | To | To cardinality | Relation | Identifying |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Customer | 1 | Order | 0..* | places | Yes |
| 2 | Address | 1 | Order | 0..* | bills to | No |
| 3 | Address | 0..1 | Order | 0..* | ships to | No |
