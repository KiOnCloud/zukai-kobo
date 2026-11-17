<!-- zukai doc, lang=en: generated from the IR, regenerate instead of editing -->
# Customers and orders

Diagram kind: ER diagram

## Entities

### Customer

| No. | Attribute | Type | Key |
| --- | --- | --- | --- |
| 1 | id | uuid | PK |
| 2 | email | varchar(255) | — |
| 3 | referred\_by | uuid | FK |

### Address

| No. | Attribute | Type | Key |
| --- | --- | --- | --- |
| 1 | id | uuid | PK |
| 2 | customer\_id | uuid | FK |

### Order

| No. | Attribute | Type | Key |
| --- | --- | --- | --- |
| 1 | id | uuid | PK |
| 2 | customer\_id | uuid | FK |
| 3 | billing\_address\_id | uuid | FK |
| 4 | shipping\_address\_id | uuid | FK |

## Relations

| No. | From | From cardinality | To | To cardinality | Relation | Identifying |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Customer | 1 | Order | 0..* | places | Yes |
| 2 | Customer | 1 | Address | 1..* | has | Yes |
| 3 | Address | 1 | Order | 0..* | bills to | No |
| 4 | Address | 0..1 | Order | 0..* | ships to | No |
| 5 | Customer | 0..1 | Customer | 0..* | refers | No |
