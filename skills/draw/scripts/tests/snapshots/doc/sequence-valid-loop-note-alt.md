<!-- zukai doc, lang=en: generated from the IR, regenerate instead of editing -->
# Pay with retries

Diagram kind: Sequence diagram

## Participants

| No. | Participant | Kind |
| --- | --- | --- |
| 1 | Web shop | Participant |
| 2 | Order service | Participant |
| 3 | Order database | Database |
| 4 | Payment provider | Participant |

## Steps

| No. | From | To | Message | Kind | Condition |
| --- | --- | --- | --- | --- | --- |
| 1 | Web shop | Order service | POST /orders | Synchronous | — |
| 2 | Order service | Payment provider | Authorize card payment for the order total | Synchronous | loop: up to 3 attempts |
| 3 | Payment provider | Order service | authorized | Reply | loop: up to 3 attempts |
| 4 | Order service | Web shop | 201 Created | Reply | alt: authorized |
| 5 | Order service | Web shop | 402 Payment Required | Reply | alt else: declined after 3 attempts |

## Notes

| No. | Note | Participant | Position | Placed after |
| --- | --- | --- | --- | --- |
| 1 | Timeout 10 s | Payment provider | Right | 2. Authorize card payment for the order total |
