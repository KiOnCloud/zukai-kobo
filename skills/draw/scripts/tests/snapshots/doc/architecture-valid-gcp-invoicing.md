<!-- zukai doc, lang=en: generated from the IR, regenerate instead of editing -->
# Invoicing system on Google Cloud (current state)

Diagram kind: Architecture diagram

## Components

| No. | Component | Kind | Boundary | Icon |
| --- | --- | --- | --- | --- |
| 1 | Users | Client | — | — |
| 2 | External Application Load Balancer | Service | Project invoicing-prod | `gcp:cloud_load_balancing` |
| 3 | Invoice API (Cloud Run) | Service | Project invoicing-prod › asia-northeast1 | `gcp:cloud_run` |
| 4 | Third-party tax rate API | External system | — | — |
| 5 | PDF renderer (Cloud Run) | Service | Project invoicing-prod › asia-northeast1 | `gcp:cloud_run` |

## Data stores

| No. | Data store | Kind | Boundary | Icon |
| --- | --- | --- | --- | --- |
| 1 | Cloud SQL for PostgreSQL | Database | Project invoicing-prod › asia-northeast1 › VPC network › Private subnet 10.8.0.0/24 | `gcp:cloud_sql` |
| 2 | Pub/Sub topic | Queue | Project invoicing-prod › asia-northeast1 | `gcp:cloud_pubsub` |
| 3 | Cloud Storage bucket | Database | Project invoicing-prod › asia-northeast1 | `gcp:cloud_storage` |

## Boundaries

| No. | Boundary | Frame | Inside |
| --- | --- | --- | --- |
| 1 | Project invoicing-prod | `gcp:project` | — |
| 2 | asia-northeast1 | `gcp:region` | Project invoicing-prod |
| 3 | VPC network | `gcp:vpc_network` | Project invoicing-prod › asia-northeast1 |
| 4 | Private subnet 10.8.0.0/24 | `gcp:subnet` | Project invoicing-prod › asia-northeast1 › VPC network |

## Connections

| No. | From | To | Label | Direction |
| --- | --- | --- | --- | --- |
| 1 | Users | External Application Load Balancer | HTTPS | One way |
| 2 | External Application Load Balancer | Invoice API (Cloud Run) | forwards requests | One way |
| 3 | Invoice API (Cloud Run) | Cloud SQL for PostgreSQL | reads and writes | One way |
| 4 | Invoice API (Cloud Run) | Third-party tax rate API | gets tax rates (HTTPS) | One way |
| 5 | Invoice API (Cloud Run) | Pub/Sub topic | invoice issued | One way |
| 6 | Pub/Sub topic | PDF renderer (Cloud Run) | push | One way |
| 7 | PDF renderer (Cloud Run) | Cloud Storage bucket | stores rendered PDF | One way |

Not shown on purpose:

- Serverless VPC access connector and its subnet: supporting resources of the connection from the API to the database
- Pub/Sub subscription: it is the connection from the topic to the renderer
