<!-- zukai doc, lang=en: generated from the IR, regenerate instead of editing -->
# Order sync (main)

Diagram kind: Use case diagram

## Actors

| No. | Actor | Kind | Role |
| --- | --- | --- | --- |
| 1 | Merchant | Person | Primary |
| 2 | Scheduler | System | Primary |
| 3 | Shop API | System | Supporting |

## Use cases

| No. | Use case | Boundary | Details |
| --- | --- | --- | --- |
| 1 | Sync the orders | Order sync service | `order-sync-01-load` |
| 2 | Store the orders | Order sync service | `order-sync-02-store` |
| 3 | Review failed orders | Order sync service | — |

## Boundaries

| No. | Boundary |
| --- | --- |
| 1 | Order sync service |

## Relations

| No. | From | Relation | To |
| --- | --- | --- | --- |
| 1 | Scheduler | Association | Sync the orders |
| 2 | Sync the orders | Include | Store the orders |
| 3 | Merchant | Association | Review failed orders |
| 4 | Sync the orders | Association | Shop API |
