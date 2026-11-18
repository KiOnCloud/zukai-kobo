<!-- zukai doc, lang=en: generated from the IR, regenerate instead of editing -->
# Order platform (main)

Diagram kind: Architecture diagram

## Components

| No. | Component | Kind | Details |
| --- | --- | --- | --- |
| 1 | Back office | Client | `order-sync-02-store` |
| 2 | Order API | Service | `order-sync-01-load` |

## Data stores

| No. | Data store | Kind |
| --- | --- | --- |
| 1 | Orders DB | Database |

## Connections

| No. | From | To | Label | Direction |
| --- | --- | --- | --- | --- |
| 1 | Back office | Order API | HTTPS | One way |
| 2 | Order API | Orders DB | SQL | One way |
