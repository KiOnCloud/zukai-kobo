<!-- zukai doc, lang=en: generated from the IR, regenerate instead of editing -->
# Order platform

Diagram kind: Architecture diagram

## Components

| No. | Component | Kind | Boundary |
| --- | --- | --- | --- |
| 1 | Customer browser | Client | — |
| 2 | Angular web app | Service | AWS account › VPC |
| 3 | Order API (.NET) | Service | AWS account › VPC |
| 4 | Fulfilment worker | Service | AWS account › VPC |
| 5 | Payment provider | External system | — |

## Data stores

| No. | Data store | Kind | Boundary |
| --- | --- | --- | --- |
| 1 | PostgreSQL | Database | AWS account › VPC |
| 2 | Redis | Cache | AWS account › VPC |
| 3 | SQS orders | Queue | AWS account |

## Boundaries

| No. | Boundary | Inside |
| --- | --- | --- |
| 1 | AWS account | — |
| 2 | VPC | AWS account |

## Connections

| No. | From | To | Label | Direction |
| --- | --- | --- | --- | --- |
| 1 | Customer browser | Angular web app | HTTPS | One way |
| 2 | Angular web app | Order API (.NET) | REST/JSON | One way |
| 3 | Order API (.NET) | PostgreSQL | SQL | One way |
| 4 | Order API (.NET) | Redis | cache aside | Both ways |
| 5 | Order API (.NET) | SQS orders | publish order placed | One way |
| 6 | SQS orders | Fulfilment worker | consume | One way |
| 7 | Order API (.NET) | Payment provider | capture payment | One way |
