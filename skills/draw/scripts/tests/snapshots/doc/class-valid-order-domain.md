<!-- zukai doc, lang=en: generated from the IR, regenerate instead of editing -->
# Order domain and persistence

Diagram kind: Class diagram

## Classes

### Entity&lt;TId&gt;

Stereotype: «abstract»

| No. | Member | Kind | Type | Visibility |
| --- | --- | --- | --- | --- |
| 1 | Id | Attribute | TId | protected |
| 2 | Equals(object other) | Method | bool | public |

### AggregateRoot&lt;TId&gt;

Stereotype: «abstract»

| No. | Member | Kind | Type | Visibility |
| --- | --- | --- | --- | --- |
| 1 | \_events | Attribute | List&lt;IDomainEvent&gt; | private |
| 2 | Raise(IDomainEvent e) | Method | void | protected |
| 3 | PullEvents() | Method | IReadOnlyList&lt;IDomainEvent&gt; | public |

### Order

| No. | Member | Kind | Type | Visibility |
| --- | --- | --- | --- | --- |
| 1 | \_lines | Attribute | List&lt;OrderLine&gt; | private |
| 2 | Status | Attribute | OrderStatus | public |
| 3 | AddLine(Product product, int quantity, decimal unitPrice) | Method | ErrorOr&lt;OrderLine&gt; | public |
| 4 | Pay(PaymentReference reference) | Method | ErrorOr&lt;Success&gt; | public |
| 5 | Cancel(string reason) | Method | void | public |

### OrderLine

| No. | Member | Kind | Type | Visibility |
| --- | --- | --- | --- | --- |
| 1 | Quantity | Attribute | int | public |
| 2 | UnitPrice | Attribute | decimal | public |

### OrderStatus

Stereotype: «enumeration»

| No. | Member | Kind | Type | Visibility |
| --- | --- | --- | --- | --- |
| 1 | Pending | Attribute | — | public |
| 2 | Paid | Attribute | — | public |
| 3 | Cancelled | Attribute | — | public |

### IRepository&lt;T&gt;

Stereotype: «interface»

| No. | Member | Kind | Type | Visibility |
| --- | --- | --- | --- | --- |
| 1 | GetAsync(Guid id, CancellationToken ct) | Method | Task&lt;T?&gt; | public |
| 2 | AddAsync(T entity, CancellationToken ct) | Method | Task | public |

### IOrderRepository

Stereotype: «interface»

| No. | Member | Kind | Type | Visibility |
| --- | --- | --- | --- | --- |
| 1 | FindByCustomerAsync(Guid customerId) | Method | Task&lt;IReadOnlyList&lt;Order&gt;&gt; | public |

### EfOrderRepository

| No. | Member | Kind | Type | Visibility |
| --- | --- | --- | --- | --- |
| 1 | \_db | Attribute | ShopDbContext | private |

### IDomainEvent

Stereotype: «interface»

(no members)

### OrderPaid

| No. | Member | Kind | Type | Visibility |
| --- | --- | --- | --- | --- |
| 1 | OrderId | Attribute | Guid | public |

## Relations

| No. | From | Relation | To | Label | From cardinality | To cardinality |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | AggregateRoot&lt;TId&gt; | Inheritance | Entity&lt;TId&gt; | — | — | — |
| 2 | Order | Inheritance | AggregateRoot&lt;TId&gt; | — | — | — |
| 3 | OrderLine | Inheritance | Entity&lt;TId&gt; | — | — | — |
| 4 | Order | Composition | OrderLine | — | 1 | 1..\* |
| 5 | Order | Association | OrderStatus | has | — | — |
| 6 | IOrderRepository | Inheritance | IRepository&lt;T&gt; | — | — | — |
| 7 | EfOrderRepository | Realization | IOrderRepository | — | — | — |
| 8 | EfOrderRepository | Dependency | Order | persists | — | — |
| 9 | OrderPaid | Realization | IDomainEvent | — | — | — |
| 10 | AggregateRoot&lt;TId&gt; | Aggregation | IDomainEvent | — | 1 | 0..\* |
| 11 | Order | Dependency | OrderPaid | raises | — | — |
