<!-- zukai doc, lang=en: generated from the IR, regenerate instead of editing -->
# Fan-in and triangle

Diagram kind: Architecture diagram

## Components

| No. | Component | Kind |
| --- | --- | --- |
| 1 | Web client | Client |
| 2 | Mobile app | Client |
| 3 | API gateway | Service |
| 4 | Order service | Service |
| 5 | Catalog service | Service |

## Connections

| No. | From | To | Direction |
| --- | --- | --- | --- |
| 1 | Web client | API gateway | One way |
| 2 | Mobile app | API gateway | One way |
| 3 | API gateway | Order service | One way |
| 4 | API gateway | Catalog service | One way |
| 5 | Order service | Catalog service | One way |
