<!-- zukai doc, lang=en: generated from the IR, regenerate instead of editing -->
# Invoicing on Google Cloud: the topic pushes back to the API

Diagram kind: Architecture diagram

## Components

| No. | Component | Kind | Boundary | Icon |
| --- | --- | --- | --- | --- |
| 1 | Cloud Scheduler nightly-reminders | Service | Project invoicing-prod › europe-west1 | `gcp:scheduled_tasks` |
| 2 | invoice-api (Cloud Run) | Service | Project invoicing-prod › europe-west1 | `gcp:cloud_run` |
| 3 | invoice-worker (Cloud Run) | Service | Project invoicing-prod › europe-west1 | `gcp:cloud_run` |
| 4 | Payment API | External system | — | `gcp:application` |

## Data stores

| No. | Data store | Kind | Boundary | Icon |
| --- | --- | --- | --- | --- |
| 1 | Cloud SQL invoices-pg | Database | Project invoicing-prod › europe-west1 › VPC network invoicing-vpc | `gcp:cloud_sql` |
| 2 | Cloud Storage invoice-pdfs | Storage | Project invoicing-prod › europe-west1 | `gcp:cloud_storage` |

## Queues

| No. | Queue | Kind | Boundary | Icon |
| --- | --- | --- | --- | --- |
| 1 | Pub/Sub invoice-events | Queue | Project invoicing-prod › europe-west1 | `gcp:cloud_pubsub` |

## Boundaries

| No. | Boundary | Frame | Inside |
| --- | --- | --- | --- |
| 1 | Project invoicing-prod | `gcp:project` | — |
| 2 | europe-west1 | `gcp:region` | Project invoicing-prod |
| 3 | VPC network invoicing-vpc | `gcp:vpc_network` | Project invoicing-prod › europe-west1 |

## Connections

| No. | From | To | Label | Direction |
| --- | --- | --- | --- | --- |
| 1 | Cloud Scheduler nightly-reminders | invoice-api (Cloud Run) | HTTP POST (OIDC) | One way |
| 2 | invoice-api (Cloud Run) | Cloud SQL invoices-pg | SQL | One way |
| 3 | invoice-api (Cloud Run) | Pub/Sub invoice-events | publish | One way |
| 4 | Pub/Sub invoice-events | invoice-worker (Cloud Run) | push | One way |
| 5 | invoice-worker (Cloud Run) | Cloud SQL invoices-pg | SQL | One way |
| 6 | invoice-worker (Cloud Run) | Cloud Storage invoice-pdfs | write objects | One way |
| 7 | invoice-worker (Cloud Run) | Payment API | HTTPS | One way |
| 8 | Pub/Sub invoice-events | invoice-api (Cloud Run) | push | One way |

Not shown on purpose:

- Pub/Sub subscriptions: each is the connection from the topic to its subscriber
