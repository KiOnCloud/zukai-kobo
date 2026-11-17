<!-- zukai doc, lang=en: generated from the IR, regenerate instead of editing -->
# Order sync

Diagram kind: Sequence diagram

## Participants

| No. | Participant | Kind |
| --- | --- | --- |
| 1 | Sync job | Control |
| 2 | Order service | Participant |
| 3 | Orders DB | Database |

## Steps

| No. | From | To | Message | Kind | Condition | Details |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Sync job | Order service | loadOrders(request) | Synchronous | — | `order-sync-01-load` |
| 2 | Order service | Sync job | orders | Reply | — | — |
| 3 | Sync job | Sync job | mergeChanges(orders) | Synchronous | opt: any orders | `order-sync-02-store` |
| 4 | Sync job | Orders DB | save(orders) | Synchronous | opt: any orders | — |
| 5 | Orders DB | Sync job | saved | Reply | opt: any orders | — |
