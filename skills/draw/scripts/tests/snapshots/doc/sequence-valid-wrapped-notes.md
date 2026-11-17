<!-- zukai doc, lang=en: generated from the IR, regenerate instead of editing -->
# Order lookup

Diagram kind: Sequence diagram

## Participants

| No. | Participant | Kind |
| --- | --- | --- |
| 1 | Web shop | Participant |
| 2 | Order service | Control |
| 3 | Order database | Database |

## Steps

| No. | From | To | Message | Kind |
| --- | --- | --- | --- | --- |
| 1 | Web shop | Order service | GET /orders/{id} | Synchronous |
| 2 | Order service | Order database | SELECT order | Synchronous |
| 3 | Order database | Order service | order row | Reply |
| 4 | Order service | Web shop | 200 OK (order JSON) | Reply |

## Notes

| No. | Note | Participant | Position | Placed after |
| --- | --- | --- | --- | --- |
| 1 | Cache key is the order id plus the tenant prefix | Web shop, Order service | Over | 1. GET /orders/{id} |
| 2 | Rows older than two years are read from the archive schema instead of the live one | Order service, Order database | Over | 3. order row |
| 3 | Response is gzip compressed when the client sends Accept-Encoding gzip and the body is larger than 1 KB | Web shop, Order service | Over | 4. 200 OK (order JSON) |
