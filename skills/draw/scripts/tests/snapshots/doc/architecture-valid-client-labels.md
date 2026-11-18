<!-- zukai doc, lang=en: generated from the IR, regenerate instead of editing -->
# Shop platform

Diagram kind: Architecture diagram

## Components

| No. | Component | Kind | Boundary |
| --- | --- | --- | --- |
| 1 | Customer web browser | Client | Users |
| 2 | Partner integration (order import) | Client | Users |
| 3 | Order API | Service | Shop |

## Data stores

| No. | Data store | Kind | Boundary |
| --- | --- | --- | --- |
| 1 | Orders DB | Database | Shop |

## Boundaries

| No. | Boundary |
| --- | --- |
| 1 | Users |
| 2 | Shop |

## Connections

| No. | From | To | Label | Direction |
| --- | --- | --- | --- | --- |
| 1 | Customer web browser | Order API | HTTPS | One way |
| 2 | Partner integration (order import) | Order API | HTTPS | One way |
| 3 | Order API | Orders DB | SQL | One way |
