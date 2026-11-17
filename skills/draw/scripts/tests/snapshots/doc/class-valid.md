<!-- zukai doc, lang=en: generated from the IR, regenerate instead of editing -->
# Order domain

Diagram kind: Class diagram

## Classes

### Order

Stereotype: «aggregate root»

| No. | Member | Kind | Type | Visibility |
| --- | --- | --- | --- | --- |
| 1 | Id | Attribute | Guid | public |
| 2 | lines | Attribute | List&lt;OrderLine&gt; | private |
| 3 | AddLine(Product product, int quantity) | Method | ErrorOr&lt;OrderLine&gt; | public |
| 4 | Total() | Method | Money | public |

### OrderLine

| No. | Member | Kind | Type | Visibility |
| --- | --- | --- | --- | --- |
| 1 | Quantity | Attribute | int | public |
| 2 | UnitPrice | Attribute | Money | public |

### Product

| No. | Member | Kind | Type |
| --- | --- | --- | --- |
| 1 | Sku | Attribute | string |

### Entity

Stereotype: «abstract»

| No. | Member | Kind | Type | Visibility |
| --- | --- | --- | --- | --- |
| 1 | Id | Attribute | Guid | protected |

### IOrderRepository

Stereotype: «interface»

| No. | Member | Kind | Type |
| --- | --- | --- | --- |
| 1 | Save(Order order, CancellationToken ct) | Method | Task |

### EfOrderRepository

(no members)

## Relations

| No. | From | Relation | To | Label | From cardinality | To cardinality |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Order | Inheritance | Entity | — | — | — |
| 2 | Order | Composition | OrderLine | lines | 1 | 1..\* |
| 3 | OrderLine | Association | Product | for | — | 1 |
| 4 | EfOrderRepository | Realization | IOrderRepository | — | — | — |
| 5 | EfOrderRepository | Dependency | Order | persists | — | — |
| 6 | Order | Aggregation | Product | — | — | — |
