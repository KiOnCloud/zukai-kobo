<!-- zukai doc, lang=en: generated from the IR, regenerate instead of editing -->
# Booking platform on AWS

Diagram kind: Architecture diagram

## Components

| No. | Component | Kind | Boundary | Icon |
| --- | --- | --- | --- | --- |
| 1 | Staff browser | Client | — | — |
| 2 | CloudFront | Service | Production account | `aws:cloudfront` |
| 3 | Application Load Balancer | Service | Production account › ap-northeast-1 (Tokyo) › VPC › Public subnets | `aws:elastic_load_balancing` |
| 4 | Booking API (ECS Fargate) | Service | Production account › ap-northeast-1 (Tokyo) › VPC › Private subnets | `aws:fargate` |
| 5 | Identity provider | External system | — | `aws:generic_application` |
| 6 | Firebase Realtime Database | External system | — | `gcp:firebase` |
| 7 | Client log collector | External system | — | `aws:generic_application` |

## Data stores

| No. | Data store | Kind | Boundary | Icon |
| --- | --- | --- | --- | --- |
| 1 | S3 web app | Database | Production account › ap-northeast-1 (Tokyo) | `aws:s3` |
| 2 | DynamoDB | Database | Production account › ap-northeast-1 (Tokyo) | `aws:dynamodb` |
| 3 | S3 attachments | Database | Production account › ap-northeast-1 (Tokyo) | `aws:s3` |

## Boundaries

| No. | Boundary | Frame | Inside |
| --- | --- | --- | --- |
| 1 | Production account | `aws:aws_account` | — |
| 2 | ap-northeast-1 (Tokyo) | `aws:region` | Production account |
| 3 | VPC | `aws:vpc` | Production account › ap-northeast-1 (Tokyo) |
| 4 | Public subnets | `aws:public_subnet` | Production account › ap-northeast-1 (Tokyo) › VPC |
| 5 | Private subnets | `aws:private_subnet` | Production account › ap-northeast-1 (Tokyo) › VPC |

## Connections

| No. | From | To | Label | Direction |
| --- | --- | --- | --- | --- |
| 1 | Staff browser | CloudFront | HTTPS | One way |
| 2 | Staff browser | Application Load Balancer | REST | One way |
| 3 | Staff browser | Identity provider | sign in | One way |
| 4 | Staff browser | Firebase Realtime Database | listen for version | One way |
| 5 | Staff browser | Client log collector | client logs | One way |
| 6 | CloudFront | S3 web app | — | One way |
| 7 | Application Load Balancer | Booking API (ECS Fargate) | HTTP | One way |
| 8 | Booking API (ECS Fargate) | DynamoDB | read / write | One way |
| 9 | Booking API (ECS Fargate) | S3 attachments | store files | One way |
| 10 | Booking API (ECS Fargate) | Identity provider | verify token | One way |
| 11 | Booking API (ECS Fargate) | Firebase Realtime Database | publish version | One way |
