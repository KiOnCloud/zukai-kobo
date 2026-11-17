<!-- zukai doc, lang=en: generated from the IR, regenerate instead of editing -->
# Repository

Diagram kind: Class diagram

## Classes

### IOrderRepository

Stereotype: «interface»

| No. | Member | Kind | Type | Visibility |
| --- | --- | --- | --- | --- |
| 1 | FindByCustomerAsync(Guid customerId) | Method | Task&lt;IReadOnlyList&lt;Order&gt;&gt; | public |

### Order

| No. | Member | Kind | Type | Visibility |
| --- | --- | --- | --- | --- |
| 1 | Status | Attribute | OrderStatus | public |
| 2 | AddLine(Product product, int quantity, decimal unitPrice) | Method | ErrorOr&lt;OrderLine&gt; | public |

## Relations

| No. | From | Relation | To | Label |
| --- | --- | --- | --- | --- |
| 1 | IOrderRepository | Dependency | Order | loads |
