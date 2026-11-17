<!-- zukai doc, lang=en: generated from the IR, regenerate instead of editing -->
# Invoicing system on AWS (current state)

Diagram kind: Architecture diagram

## Components

| No. | Component | Kind | Boundary | Icon |
| --- | --- | --- | --- | --- |
| 1 | Users | Client | — | — |
| 2 | Application Load Balancer | Service | AWS account › ap-northeast-1 › VPC › Public subnet | `aws:elastic_load_balancing` |
| 3 | Invoice API (ECS on Fargate) | Service | AWS account › ap-northeast-1 › VPC › Private subnet | `aws:fargate` |
| 4 | Third-party tax rate API | External system | — | — |
| 5 | Lambda function | Service | AWS account › ap-northeast-1 | `aws:lambda` |

## Data stores

| No. | Data store | Kind | Boundary | Icon |
| --- | --- | --- | --- | --- |
| 1 | RDS PostgreSQL | Database | AWS account › ap-northeast-1 › VPC › Private subnet | `aws:rds` |
| 2 | SQS queue | Queue | AWS account › ap-northeast-1 | `aws:sqs` |
| 3 | S3 bucket | Database | AWS account › ap-northeast-1 | `aws:s3` |

## Boundaries

| No. | Boundary | Frame | Inside |
| --- | --- | --- | --- |
| 1 | AWS account | `aws:aws_account` | — |
| 2 | ap-northeast-1 | `aws:region` | AWS account |
| 3 | VPC | `aws:vpc` | AWS account › ap-northeast-1 |
| 4 | Public subnet | `aws:public_subnet` | AWS account › ap-northeast-1 › VPC |
| 5 | Private subnet | `aws:private_subnet` | AWS account › ap-northeast-1 › VPC |

## Connections

| No. | From | To | Label | Direction |
| --- | --- | --- | --- | --- |
| 1 | Users | Application Load Balancer | HTTPS | One way |
| 2 | Application Load Balancer | Invoice API (ECS on Fargate) | forwards requests | One way |
| 3 | Invoice API (ECS on Fargate) | RDS PostgreSQL | reads and writes | One way |
| 4 | Invoice API (ECS on Fargate) | Third-party tax rate API | gets tax rates (HTTPS) | One way |
| 5 | Invoice API (ECS on Fargate) | SQS queue | invoice issued | One way |
| 6 | SQS queue | Lambda function | invoice issued | One way |
| 7 | Lambda function | S3 bucket | stores rendered PDF | One way |
