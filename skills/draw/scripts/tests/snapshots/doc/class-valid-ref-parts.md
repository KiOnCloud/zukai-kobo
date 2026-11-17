<!-- zukai doc, lang=en: generated from the IR, regenerate instead of editing -->
# Order domain (main)

Diagram kind: Class diagram

## Classes

### Order

Details: `order-sync-01-load`

| No. | Member | Kind | Type |
| --- | --- | --- | --- |
| 1 | id | Attribute | string |

### IPriceRule

Stereotype: «interface»

Details: `order-sync-02-store`

| No. | Member | Kind | Type |
| --- | --- | --- | --- |
| 1 | apply(order: Order) | Method | — |

## Relations

| No. | From | Relation | To | Label |
| --- | --- | --- | --- | --- |
| 1 | Order | Dependency | IPriceRule | priced by |
