<!-- zukai doc, lang=en: generated from the IR, regenerate instead of editing -->
# Orders on AWS: the topic calls back the API

Diagram kind: Architecture diagram

## Components

| No. | Component | Kind | Boundary | Icon |
| --- | --- | --- | --- | --- |
| 1 | API Gateway | Service | AWS Cloud › eu-west-1 | `aws:api_gateway` |
| 2 | order-api (Lambda) | Service | AWS Cloud › eu-west-1 | `aws:lambda` |
| 3 | fulfilment (Fargate) | Service | AWS Cloud › eu-west-1 › VPC | `aws:fargate` |
| 4 | Carrier API | External system | — | `aws:generic_application` |

## Data stores

| No. | Data store | Kind | Boundary | Icon |
| --- | --- | --- | --- | --- |
| 1 | RDS orders | Database | AWS Cloud › eu-west-1 › VPC | `aws:rds` |
| 2 | S3 shipping-labels | Storage | AWS Cloud › eu-west-1 | `aws:s3` |

## Queues

| No. | Queue | Kind | Boundary | Icon |
| --- | --- | --- | --- | --- |
| 1 | SNS order-events | Queue | AWS Cloud › eu-west-1 | `aws:sns` |

## Boundaries

| No. | Boundary | Frame | Inside |
| --- | --- | --- | --- |
| 1 | AWS Cloud | `aws:aws_cloud` | — |
| 2 | eu-west-1 | `aws:region` | AWS Cloud |
| 3 | VPC | `aws:vpc` | AWS Cloud › eu-west-1 |

## Connections

| No. | From | To | Label | Direction |
| --- | --- | --- | --- | --- |
| 1 | API Gateway | order-api (Lambda) | invoke | One way |
| 2 | order-api (Lambda) | SNS order-events | publish | One way |
| 3 | SNS order-events | fulfilment (Fargate) | deliver | One way |
| 4 | fulfilment (Fargate) | RDS orders | SQL | One way |
| 5 | fulfilment (Fargate) | S3 shipping-labels | put objects | One way |
| 6 | fulfilment (Fargate) | Carrier API | HTTPS | One way |
| 7 | SNS order-events | order-api (Lambda) | deliver | One way |

Not shown on purpose:

- SNS subscriptions: each is the connection from the topic to its subscriber
