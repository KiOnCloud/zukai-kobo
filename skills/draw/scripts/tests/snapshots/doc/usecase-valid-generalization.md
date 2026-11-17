<!-- zukai doc, lang=en: generated from the IR, regenerate instead of editing -->
# Online shop checkout

Diagram kind: Use case diagram

## Actors

| No. | Actor | Kind | Role |
| --- | --- | --- | --- |
| 1 | Customer | Person | Primary |
| 2 | Guest | Person | Primary |
| 3 | Registered customer | Person | Primary |
| 4 | Support agent | Person | Primary |
| 5 | Payment service provider | System | Supporting |
| 6 | Carrier | System | Supporting |

## Use cases

| No. | Use case | Boundary |
| --- | --- | --- |
| 1 | Place an order | Online shop |
| 2 | Pay for the order | Online shop |
| 3 | Pay by card | Online shop |
| 4 | Pay by bank transfer | Online shop |
| 5 | Apply a voucher | Online shop |
| 6 | Collect loyalty points | Online shop |
| 7 | Track the delivery | Online shop |
| 8 | Refund an order | Online shop |

## Boundaries

| No. | Boundary |
| --- | --- |
| 1 | Online shop |

## Relations

| No. | From | Relation | To | Condition |
| --- | --- | --- | --- | --- |
| 1 | Guest | Generalization | Customer | — |
| 2 | Registered customer | Generalization | Customer | — |
| 3 | Customer | Association | Place an order | — |
| 4 | Customer | Association | Track the delivery | — |
| 5 | Registered customer | Association | Collect loyalty points | — |
| 6 | Support agent | Association | Refund an order | — |
| 7 | Place an order | Include | Pay for the order | — |
| 8 | Apply a voucher | Extend | Place an order | the customer has a voucher code |
| 9 | Pay by card | Generalization | Pay for the order | — |
| 10 | Pay by bank transfer | Generalization | Pay for the order | — |
| 11 | Pay for the order | Association | Payment service provider | — |
| 12 | Refund an order | Association | Payment service provider | — |
| 13 | Track the delivery | Association | Carrier | — |
