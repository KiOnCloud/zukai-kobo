<!-- zukai doc, lang=en: generated from the IR, regenerate instead of editing -->
# Participant kinds

Diagram kind: Sequence diagram

## Participants

| No. | Participant | Kind |
| --- | --- | --- |
| 1 | Web shop | Boundary |
| 2 | Order service | Control |
| 3 | Order | Entity |
| 4 | Order database | Database |
| 5 | Customer | Actor |

## Steps

| No. | From | To | Message | Kind |
| --- | --- | --- | --- | --- |
| 1 | Customer | Web shop | Submit order | Synchronous |
| 2 | Web shop | Order service | POST /orders | Synchronous |
| 3 | Order service | Order | create | Synchronous |
| 4 | Order service | Order database | INSERT order | Synchronous |
| 5 | Order database | Order service | ok | Reply |
| 6 | Order service | Web shop | 201 Created | Reply |
