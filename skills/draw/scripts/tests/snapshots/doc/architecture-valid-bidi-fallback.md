<!-- zukai doc, lang=en: generated from the IR, regenerate instead of editing -->
# Triangle with a two-way link

Diagram kind: Architecture diagram

## Components

| No. | Component | Kind |
| --- | --- | --- |
| 1 | Web client | Client |
| 2 | Mobile app | Client |
| 3 | API gateway | Service |
| 4 | Order service | Service |
| 5 | Catalog service | Service |

## Data stores

| No. | Data store | Kind |
| --- | --- | --- |
| 1 | Cache | Cache |

## Connections

| No. | From | To | Label | Direction |
| --- | --- | --- | --- | --- |
| 1 | Web client | API gateway | — | One way |
| 2 | Mobile app | API gateway | — | One way |
| 3 | API gateway | Order service | — | One way |
| 4 | API gateway | Catalog service | — | One way |
| 5 | Order service | Catalog service | — | One way |
| 6 | Catalog service | Cache | — | Both ways |
| 7 | API gateway | Cache | warm | Both ways |
