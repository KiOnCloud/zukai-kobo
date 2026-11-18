<!-- zukai doc, lang=en: generated from the IR, regenerate instead of editing -->
# Scheduled sync with a partner that calls back

Diagram kind: Architecture diagram

## Components

| No. | Component | Kind | Boundary | Icon |
| --- | --- | --- | --- | --- |
| 1 | EventBridge rule | Service | AWS Cloud › Region | `aws:eventbridge` |
| 2 | Sync function | Service | AWS Cloud › Region | `aws:lambda` |
| 3 | Application Load Balancer | Service | AWS Cloud › Region | `aws:elastic_load_balancing` |
| 4 | API (ECS Fargate) | Service | AWS Cloud › Region | `aws:fargate` |
| 5 | Partner API | External system | — | `aws:servers` |

## Data stores

| No. | Data store | Kind | Boundary | Icon |
| --- | --- | --- | --- | --- |
| 1 | DynamoDB (6 tables) | Database | AWS Cloud › Region | `aws:dynamodb` |

## Boundaries

| No. | Boundary | Frame | Inside |
| --- | --- | --- | --- |
| 1 | AWS Cloud | `aws:aws_cloud` | — |
| 2 | Region | `aws:region` | AWS Cloud |

## Connections

| No. | From | To | Label | Direction |
| --- | --- | --- | --- | --- |
| 1 | EventBridge rule | Sync function | invoke | One way |
| 2 | Sync function | Application Load Balancer | HTTPS | One way |
| 3 | Application Load Balancer | API (ECS Fargate) | HTTP | One way |
| 4 | API (ECS Fargate) | DynamoDB (6 tables) | read / write | One way |
| 5 | API (ECS Fargate) | Partner API | HTTPS | One way |
| 6 | Partner API | API (ECS Fargate) | webhook | One way |
