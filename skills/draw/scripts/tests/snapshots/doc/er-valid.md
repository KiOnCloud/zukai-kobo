<!-- zukai doc, lang=en: generated from the IR, regenerate instead of editing -->
# Order data model

Diagram kind: ER diagram

## Entities

### Customer

| No. | Attribute | Type | Key | Comment |
| --- | --- | --- | --- | --- |
| 1 | id | uuid | PK | — |
| 2 | email | string | — | unique, lower-cased |
| 3 | created\_at | timestamp | — | — |

### Order

| No. | Attribute | Type | Key |
| --- | --- | --- | --- |
| 1 | id | uuid | PK |
| 2 | customer\_id | uuid | FK |
| 3 | status | string | — |
| 4 | total | decimal(10,2) | — |

### Order line

| No. | Attribute | Type | Key |
| --- | --- | --- | --- |
| 1 | id | uuid | PK |
| 2 | order\_id | uuid | FK |
| 3 | product\_id | uuid | FK |
| 4 | quantity | int | — |

### Product

| No. | Attribute | Type | Key |
| --- | --- | --- | --- |
| 1 | id | uuid | PK |
| 2 | name | string | — |

### Audit log

(no attributes)

## Relations

| No. | From | From cardinality | To | To cardinality | Relation | Identifying |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Customer | 1 | Order | 0..* | places | Yes |
| 2 | Order | 1 | Order line | 1..* | contains | Yes |
| 3 | Product | 1 | Order line | 0..* | appears in | Yes |
| 4 | Order | 0..1 | Audit log | 0..* | — | No |
