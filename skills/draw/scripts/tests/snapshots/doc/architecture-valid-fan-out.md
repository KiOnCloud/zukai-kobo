<!-- zukai doc, lang=en: generated from the IR, regenerate instead of editing -->
# Order service fan-out

Diagram kind: Architecture diagram

## Components

| No. | Component | Kind |
| --- | --- | --- |
| 1 | API gateway | Service |
| 2 | Order service | Service |
| 3 | Payment service | Service |
| 4 | Catalog service | Service |

## Data stores

| No. | Data store | Kind |
| --- | --- | --- |
| 1 | Orders DB | Database |
| 2 | Event bus | Queue |

## Connections

| No. | From | To | Label | Direction |
| --- | --- | --- | --- | --- |
| 1 | API gateway | Order service | REST | One way |
| 2 | Order service | Orders DB | SQL | One way |
| 3 | Order service | Payment service | gRPC | One way |
| 4 | Order service | Event bus | publish OrderPaid | One way |
| 5 | Order service | Catalog service | check stock | One way |
