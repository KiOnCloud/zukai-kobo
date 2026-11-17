<!-- zukai doc, lang=en: generated from the IR, regenerate instead of editing -->
# Booking API on ECS Fargate

Diagram kind: Architecture diagram

## Components

| No. | Component | Kind | Boundary | Icon |
| --- | --- | --- | --- | --- |
| 1 | Staff browser | Client | — | — |
| 2 | Application Load Balancer (HTTPS) | Service | ap-northeast-1 (Tokyo) › VPC › Public subnets | `aws:elastic_load_balancing` |
| 3 | Booking API (ECS Fargate, 2 tasks) | Service | ap-northeast-1 (Tokyo) › VPC › Private subnets | `aws:fargate` |
| 4 | ECR (API image) | Service | ap-northeast-1 (Tokyo) | `aws:ecr` |
| 5 | Secrets Manager | Service | ap-northeast-1 (Tokyo) | `aws:secrets_manager` |
| 6 | Simple Email Service | Service | ap-northeast-1 (Tokyo) | `aws:simple_email_service` |
| 7 | CloudWatch Logs (30 days) | Service | ap-northeast-1 (Tokyo) | `aws:cloudwatch_2` |
| 8 | Identity provider | External system | — | `aws:generic_application` |
| 9 | Firebase Realtime Database | External system | — | `gcp:firebase` |
| 10 | Hospital records system | External system | — | `aws:traditional_server` |

## Data stores

| No. | Data store | Kind | Boundary | Icon |
| --- | --- | --- | --- | --- |
| 1 | S3 load balancer logs | Storage | ap-northeast-1 (Tokyo) | `aws:s3` |
| 2 | DynamoDB (9 tables, on-demand) | Database | ap-northeast-1 (Tokyo) | `aws:dynamodb` |
| 3 | S3 attachments | Storage | ap-northeast-1 (Tokyo) | `aws:s3` |

## Queues

| No. | Queue | Kind | Boundary | Icon |
| --- | --- | --- | --- | --- |
| 1 | SQS reminders | Queue | ap-northeast-1 (Tokyo) | `aws:sqs` |

## Boundaries

| No. | Boundary | Frame | Inside |
| --- | --- | --- | --- |
| 1 | ap-northeast-1 (Tokyo) | `aws:region` | — |
| 2 | VPC | `aws:vpc` | ap-northeast-1 (Tokyo) |
| 3 | Public subnets | `aws:public_subnet` | ap-northeast-1 (Tokyo) › VPC |
| 4 | Private subnets | `aws:private_subnet` | ap-northeast-1 (Tokyo) › VPC |

## Connections

| No. | From | To | Label | Direction |
| --- | --- | --- | --- | --- |
| 1 | Staff browser | Application Load Balancer (HTTPS) | HTTPS | One way |
| 2 | Application Load Balancer (HTTPS) | Booking API (ECS Fargate, 2 tasks) | HTTP :8080 | One way |
| 3 | ECR (API image) | Booking API (ECS Fargate, 2 tasks) | pull image | One way |
| 4 | Application Load Balancer (HTTPS) | S3 load balancer logs | access logs | One way |
| 5 | Booking API (ECS Fargate, 2 tasks) | Secrets Manager | read keys at start | One way |
| 6 | Booking API (ECS Fargate, 2 tasks) | DynamoDB (9 tables, on-demand) | read / write | One way |
| 7 | Booking API (ECS Fargate, 2 tasks) | S3 attachments | store files | One way |
| 8 | Booking API (ECS Fargate, 2 tasks) | SQS reminders | reminder due | One way |
| 9 | Booking API (ECS Fargate, 2 tasks) | Simple Email Service | send mail | One way |
| 10 | Booking API (ECS Fargate, 2 tasks) | CloudWatch Logs (30 days) | JSON logs | One way |
| 11 | Booking API (ECS Fargate, 2 tasks) | Identity provider | verify token | One way |
| 12 | Booking API (ECS Fargate, 2 tasks) | Firebase Realtime Database | publish version | One way |
| 13 | Booking API (ECS Fargate, 2 tasks) | Hospital records system | fetch records | One way |
