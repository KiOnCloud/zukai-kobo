<!-- zukai doc, lang=en: generated from the IR, regenerate instead of editing -->
# Order platform on AWS

Diagram kind: Architecture diagram

## Components

| No. | Component | Kind | Boundary | Icon |
| --- | --- | --- | --- | --- |
| 1 | Customer browser | Client | — | — |
| 2 | CloudFront | Service | AWS Cloud | `aws:cloudfront` |
| 3 | Application Load Balancer | Service | AWS Cloud › ap-northeast-1 › VPC 10.0.0.0/16 › Public subnet | `aws:elastic_load_balancing` |
| 4 | Order API (ECS Fargate) | Service | AWS Cloud › ap-northeast-1 › VPC 10.0.0.0/16 › Private subnet | `aws:fargate` |
| 5 | Fulfilment worker | Service | AWS Cloud › ap-northeast-1 | `aws:lambda` |
| 6 | Payment provider | External system | — | — |

## Data stores

| No. | Data store | Kind | Boundary | Icon |
| --- | --- | --- | --- | --- |
| 1 | Static assets (S3) | Database | AWS Cloud | `aws:s3` |
| 2 | Aurora PostgreSQL | Database | AWS Cloud › ap-northeast-1 › VPC 10.0.0.0/16 › Private subnet | `aws:aurora` |
| 3 | ElastiCache Redis | Cache | AWS Cloud › ap-northeast-1 › VPC 10.0.0.0/16 › Private subnet | `aws:elasticache` |
| 4 | SQS orders | Queue | AWS Cloud › ap-northeast-1 | `aws:sqs` |

## Boundaries

| No. | Boundary | Frame | Inside |
| --- | --- | --- | --- |
| 1 | AWS Cloud | `aws:aws_cloud` | — |
| 2 | ap-northeast-1 | `aws:region` | AWS Cloud |
| 3 | VPC 10.0.0.0/16 | `aws:vpc` | AWS Cloud › ap-northeast-1 |
| 4 | Public subnet | `aws:public_subnet` | AWS Cloud › ap-northeast-1 › VPC 10.0.0.0/16 |
| 5 | Private subnet | `aws:private_subnet` | AWS Cloud › ap-northeast-1 › VPC 10.0.0.0/16 |

## Connections

| No. | From | To | Label | Direction |
| --- | --- | --- | --- | --- |
| 1 | Customer browser | CloudFront | HTTPS | One way |
| 2 | CloudFront | Static assets (S3) | static files | One way |
| 3 | CloudFront | Application Load Balancer | /api | One way |
| 4 | Application Load Balancer | Order API (ECS Fargate) | HTTP | One way |
| 5 | Order API (ECS Fargate) | Aurora PostgreSQL | SQL | One way |
| 6 | Order API (ECS Fargate) | ElastiCache Redis | cache | One way |
| 7 | Order API (ECS Fargate) | SQS orders | order placed | One way |
| 8 | SQS orders | Fulfilment worker | trigger | One way |
| 9 | Order API (ECS Fargate) | Payment provider | capture payment | One way |
