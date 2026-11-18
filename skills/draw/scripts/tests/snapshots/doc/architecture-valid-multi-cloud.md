<!-- zukai doc, lang=en: generated from the IR, regenerate instead of editing -->
# Shop on AWS with analytics on Google Cloud

Diagram kind: Architecture diagram

## Components

| No. | Component | Kind | Boundary | Icon |
| --- | --- | --- | --- | --- |
| 1 | Customer browser | Client | — | — |
| 2 | CloudFront | Service | AWS Cloud | `aws:cloudfront` |
| 3 | Application Load Balancer | Service | AWS Cloud › ap-northeast-1 › VPC › Public subnet | `aws:elastic_load_balancing` |
| 4 | Shop API (ECS Fargate) | Service | AWS Cloud › ap-northeast-1 › VPC › Private subnet | `aws:fargate` |
| 5 | Event forwarder | Service | AWS Cloud › ap-northeast-1 | `aws:lambda` |
| 6 | Dataflow pipeline | Service | Google Cloud › asia-northeast1 | `gcp:cloud_dataflow` |
| 7 | Reports (Cloud Run) | Service | Google Cloud › asia-northeast1 | `gcp:cloud_run` |
| 8 | Analysts | Client | — | — |
| 9 | Payment provider | External system | — | `aws:generic_application` |

## Data stores

| No. | Data store | Kind | Boundary | Icon |
| --- | --- | --- | --- | --- |
| 1 | Aurora PostgreSQL | Database | AWS Cloud › ap-northeast-1 › VPC › Private subnet | `aws:aurora` |
| 2 | BigQuery | Database | Google Cloud › asia-northeast1 | `gcp:bigquery` |

## Queues

| No. | Queue | Kind | Boundary | Icon |
| --- | --- | --- | --- | --- |
| 1 | Kinesis order events | Queue | AWS Cloud › ap-northeast-1 | `aws:kinesis_data_streams` |
| 2 | Pub/Sub order events | Queue | Google Cloud › asia-northeast1 | `gcp:cloud_pubsub` |

## Boundaries

| No. | Boundary | Frame | Inside |
| --- | --- | --- | --- |
| 1 | AWS Cloud | `aws:aws_cloud` | — |
| 2 | ap-northeast-1 | `aws:region` | AWS Cloud |
| 3 | VPC | `aws:vpc` | AWS Cloud › ap-northeast-1 |
| 4 | Public subnet | `aws:public_subnet` | AWS Cloud › ap-northeast-1 › VPC |
| 5 | Private subnet | `aws:private_subnet` | AWS Cloud › ap-northeast-1 › VPC |
| 6 | Google Cloud | `gcp:google_cloud` | — |
| 7 | asia-northeast1 | `gcp:region` | Google Cloud |

## Connections

| No. | From | To | Label | Direction |
| --- | --- | --- | --- | --- |
| 1 | Customer browser | CloudFront | HTTPS | One way |
| 2 | CloudFront | Application Load Balancer | /api | One way |
| 3 | Application Load Balancer | Shop API (ECS Fargate) | HTTP | One way |
| 4 | Shop API (ECS Fargate) | Aurora PostgreSQL | SQL | One way |
| 5 | Shop API (ECS Fargate) | Kinesis order events | order placed | One way |
| 6 | Kinesis order events | Event forwarder | trigger | One way |
| 7 | Event forwarder | Pub/Sub order events | publish (HTTPS) | One way |
| 8 | Pub/Sub order events | Dataflow pipeline | pull | One way |
| 9 | Dataflow pipeline | BigQuery | streaming insert | One way |
| 10 | Reports (Cloud Run) | BigQuery | query | One way |
| 11 | Analysts | Reports (Cloud Run) | HTTPS | One way |
| 12 | Shop API (ECS Fargate) | Payment provider | capture payment | One way |
