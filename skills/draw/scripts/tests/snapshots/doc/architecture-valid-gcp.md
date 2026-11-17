<!-- zukai doc, lang=en: generated from the IR, regenerate instead of editing -->
# Order platform on Google Cloud

Diagram kind: Architecture diagram

## Components

| No. | Component | Kind | Boundary | Icon |
| --- | --- | --- | --- | --- |
| 1 | Customer browser | Client | — | — |
| 2 | Cloud CDN | Service | Google Cloud | `gcp:cloud_cdn` |
| 3 | Internal Application Load Balancer | Service | Google Cloud › asia-northeast1 › VPC network 10.0.0.0/16 › Proxy-only subnet | `gcp:cloud_load_balancing` |
| 4 | Order API (GKE) | Service | Google Cloud › asia-northeast1 › VPC network 10.0.0.0/16 › Private subnet | `gcp:container_engine` |
| 5 | Fulfilment worker | Service | Google Cloud › asia-northeast1 | `gcp:cloud_functions` |
| 6 | Payment provider | External system | — | — |

## Data stores

| No. | Data store | Kind | Boundary | Icon |
| --- | --- | --- | --- | --- |
| 1 | Static assets (Cloud Storage) | Database | Google Cloud | `gcp:cloud_storage` |
| 2 | Cloud SQL for PostgreSQL | Database | Google Cloud › asia-northeast1 › VPC network 10.0.0.0/16 › Private subnet | `gcp:cloud_sql` |
| 3 | Memorystore for Redis | Cache | Google Cloud › asia-northeast1 › VPC network 10.0.0.0/16 › Private subnet | `gcp:cloud_memorystore` |
| 4 | Pub/Sub orders | Queue | Google Cloud › asia-northeast1 | `gcp:cloud_pubsub` |

## Boundaries

| No. | Boundary | Frame | Inside |
| --- | --- | --- | --- |
| 1 | Google Cloud | `gcp:google_cloud` | — |
| 2 | asia-northeast1 | `gcp:region` | Google Cloud |
| 3 | VPC network 10.0.0.0/16 | `gcp:vpc_network` | Google Cloud › asia-northeast1 |
| 4 | Proxy-only subnet | `gcp:subnet` | Google Cloud › asia-northeast1 › VPC network 10.0.0.0/16 |
| 5 | Private subnet | `gcp:subnet` | Google Cloud › asia-northeast1 › VPC network 10.0.0.0/16 |

## Connections

| No. | From | To | Label | Direction |
| --- | --- | --- | --- | --- |
| 1 | Customer browser | Cloud CDN | HTTPS | One way |
| 2 | Cloud CDN | Static assets (Cloud Storage) | static files | One way |
| 3 | Cloud CDN | Internal Application Load Balancer | /api | One way |
| 4 | Internal Application Load Balancer | Order API (GKE) | HTTP | One way |
| 5 | Order API (GKE) | Cloud SQL for PostgreSQL | SQL | One way |
| 6 | Order API (GKE) | Memorystore for Redis | cache | One way |
| 7 | Order API (GKE) | Pub/Sub orders | order placed | One way |
| 8 | Pub/Sub orders | Fulfilment worker | trigger | One way |
| 9 | Order API (GKE) | Payment provider | capture payment | One way |
