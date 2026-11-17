<!-- zukai doc, lang=en: generated from the IR, regenerate instead of editing -->
# Order domain

Diagram kind: Class diagram

## Classes

### Order

| No. | Member | Kind | Type |
| --- | --- | --- | --- |
| 1 | id | Attribute | string |
| 2 | total | Attribute | decimal |

### OrderLine

| No. | Member | Kind | Type |
| --- | --- | --- | --- |
| 1 | qty | Attribute | int |

### Shipment

| No. | Member | Kind | Type |
| --- | --- | --- | --- |
| 1 | carrier | Attribute | string |

### PricingService

| No. | Member | Kind | Type |
| --- | --- | --- | --- |
| 1 | price(order: Order) | Method | decimal |

### IPriceRule

Stereotype: «interface»

| No. | Member | Kind | Type |
| --- | --- | --- | --- |
| 1 | apply(line: OrderLine) | Method | — |

### DiscountRule

| No. | Member | Kind | Type |
| --- | --- | --- | --- |
| 1 | apply(line: OrderLine) | Method | — |

### TaxRule

| No. | Member | Kind | Type |
| --- | --- | --- | --- |
| 1 | apply(line: OrderLine) | Method | — |

### PromoRule

| No. | Member | Kind | Type |
| --- | --- | --- | --- |
| 1 | apply(line: OrderLine) | Method | — |

## Relations

| No. | From | Relation | To | Label | From cardinality | To cardinality |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Order | Composition | OrderLine | — | 1 | 1..\* |
| 2 | Order | Composition | Shipment | — | 1 | 0..1 |
| 3 | PricingService | Composition | IPriceRule | ordered rules | 1 | 0..\* |
| 4 | DiscountRule | Realization | IPriceRule | — | — | — |
| 5 | TaxRule | Realization | IPriceRule | — | — | — |
| 6 | PromoRule | Realization | IPriceRule | — | — | — |
| 7 | PricingService | Dependency | Order | reads | — | — |
