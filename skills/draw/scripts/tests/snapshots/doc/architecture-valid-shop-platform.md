<!-- zukai doc, lang=en: generated from the IR, regenerate instead of editing -->
# Shop platform

Diagram kind: Architecture diagram

## Components

| No. | Component | Kind | Boundary |
| --- | --- | --- | --- |
| 1 | Customer browser | Client | — |
| 2 | Mobile app | Client | — |
| 3 | CDN | External system | — |
| 4 | API gateway | Service | Cloud account › Private network |
| 5 | Order service | Service | Cloud account › Private network |
| 6 | Catalog service | Service | Cloud account › Private network |
| 7 | Payment service | Service | Cloud account › Private network |
| 8 | Mail worker | Service | Cloud account |
| 9 | Payment provider | External system | — |
| 10 | SMTP relay | External system | — |

## Data stores

| No. | Data store | Kind | Boundary |
| --- | --- | --- | --- |
| 1 | Orders DB (PostgreSQL) | Database | Cloud account › Private network |
| 2 | Catalog DB | Database | Cloud account › Private network |
| 3 | Redis cache | Cache | Cloud account › Private network |
| 4 | Event bus | Queue | Cloud account |

## Boundaries

| No. | Boundary | Inside |
| --- | --- | --- |
| 1 | Cloud account | — |
| 2 | Private network | Cloud account |

## Connections

| No. | From | To | Label | Direction |
| --- | --- | --- | --- | --- |
| 1 | Customer browser | CDN | HTTPS | One way |
| 2 | CDN | API gateway | HTTPS | One way |
| 3 | Mobile app | API gateway | HTTPS | One way |
| 4 | API gateway | Order service | REST | One way |
| 5 | API gateway | Catalog service | REST | One way |
| 6 | Order service | Orders DB (PostgreSQL) | SQL | One way |
| 7 | Catalog service | Catalog DB | SQL | One way |
| 8 | Catalog service | Redis cache | read-through | Both ways |
| 9 | Order service | Payment service | gRPC | One way |
| 10 | Payment service | Payment provider | HTTPS + webhook | Both ways |
| 11 | Order service | Event bus | publish OrderPaid | One way |
| 12 | Event bus | Mail worker | subscribe | One way |
| 13 | Mail worker | SMTP relay | SMTP | One way |
| 14 | Order service | Catalog service | check stock | One way |
