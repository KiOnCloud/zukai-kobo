<!-- zukai doc, lang=en: generated from the IR, regenerate instead of editing -->
# Report service

Diagram kind: Architecture diagram

## Components

| No. | Component | Kind |
| --- | --- | --- |
| 1 | Web app | Client |
| 2 | Scheduler | Service |
| 3 | Report service (PDF, CSV, XLSX, HTML, JSON, ...) - stateless | Service |

## Data stores

| No. | Data store | Kind |
| --- | --- | --- |
| 1 | Main DB (orders, invoices, customers, payments) | Database |
| 2 | Archive DB of closed customer accounts (read only) | Database |

## Queues

| No. | Queue | Kind |
| --- | --- | --- |
| 1 | Export requests waiting for the nightly run (FIFO) | Queue |

## Connections

| No. | From | To | Label | Direction |
| --- | --- | --- | --- | --- |
| 1 | Web app | Report service (PDF, CSV, XLSX, HTML, JSON, ...) - stateless | HTTPS | One way |
| 2 | Scheduler | Report service (PDF, CSV, XLSX, HTML, JSON, ...) - stateless | nightly run | One way |
| 3 | Report service (PDF, CSV, XLSX, HTML, JSON, ...) - stateless | Main DB (orders, invoices, customers, payments) | SQL | One way |
| 4 | Report service (PDF, CSV, XLSX, HTML, JSON, ...) - stateless | Archive DB of closed customer accounts (read only) | SQL | One way |
| 5 | Scheduler | Export requests waiting for the nightly run (FIFO) | enqueue | One way |
