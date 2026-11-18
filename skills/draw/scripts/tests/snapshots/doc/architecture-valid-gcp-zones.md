<!-- zukai doc, lang=en: generated from the IR, regenerate instead of editing -->
# Web tier across two zones

Diagram kind: Architecture diagram

## Components

| No. | Component | Kind | Boundary | Icon |
| --- | --- | --- | --- | --- |
| 1 | Users | Client | — | — |
| 2 | Cloud DNS | Service | Production project | `gcp:cloud_dns` |
| 3 | Application Load Balancer | Service | Production project › VPC network | `gcp:cloud_load_balancing` |
| 4 | Web server A | Service | Production project › VPC network › Managed instance group › Zone asia-northeast1-a | `gcp:compute_engine` |
| 5 | Web server C | Service | Production project › VPC network › Managed instance group › Zone asia-northeast1-c | `gcp:compute_engine` |
| 6 | Secret Manager | Service | Production project | — |
| 7 | On-premise ERP | External system | Corporate data center | — |
| 8 | Nightly export job | Service | Corporate data center | — |

## Data stores

| No. | Data store | Kind | Boundary | Icon |
| --- | --- | --- | --- | --- |
| 1 | Cloud SQL primary | Database | Production project › VPC network › Database firewall rule | `gcp:cloud_sql` |
| 2 | Cloud SQL standby (HA) | Database | Production project › VPC network › Database firewall rule | `gcp:cloud_sql` |

## Boundaries

| No. | Boundary | Frame | Inside |
| --- | --- | --- | --- |
| 1 | Production project | `gcp:project` | — |
| 2 | VPC network | `gcp:vpc_network` | Production project |
| 3 | Managed instance group | `gcp:instance_group` | Production project › VPC network |
| 4 | Zone asia-northeast1-a | `gcp:zone` | Production project › VPC network › Managed instance group |
| 5 | Zone asia-northeast1-c | `gcp:zone` | Production project › VPC network › Managed instance group |
| 6 | Database firewall rule | `gcp:firewall` | Production project › VPC network |
| 7 | Corporate data center | — | — |

## Connections

| No. | From | To | Label | Direction |
| --- | --- | --- | --- | --- |
| 1 | Users | Cloud DNS | DNS | One way |
| 2 | Users | Application Load Balancer | HTTPS | One way |
| 3 | Application Load Balancer | Web server A | — | One way |
| 4 | Application Load Balancer | Web server C | — | One way |
| 5 | Web server A | Cloud SQL primary | SQL | One way |
| 6 | Web server C | Cloud SQL primary | SQL | One way |
| 7 | Cloud SQL primary | Cloud SQL standby (HA) | replication | Both ways |
| 8 | Web server A | Secret Manager | read secret | One way |
| 9 | Nightly export job | Cloud SQL standby (HA) | read replica | One way |
| 10 | Nightly export job | On-premise ERP | export | One way |
