<!-- zukai doc, lang=en: generated from the IR, regenerate instead of editing -->
# Web tier across two Availability Zones

Diagram kind: Architecture diagram

## Components

| No. | Component | Kind | Boundary | Icon |
| --- | --- | --- | --- | --- |
| 1 | Users | Client | — | — |
| 2 | Route 53 | Service | Production account | `aws:route_53` |
| 3 | Application Load Balancer | Service | Production account › VPC | `aws:elastic_load_balancing` |
| 4 | Web server A | Service | Production account › VPC › Auto Scaling group › Availability Zone 1a | `aws:ec2` |
| 5 | Web server C | Service | Production account › VPC › Auto Scaling group › Availability Zone 1c | `aws:ec2` |
| 6 | Secrets Manager | Service | Production account | `aws:secrets_manager` |
| 7 | On-premise ERP | External system | Corporate data center | — |
| 8 | Nightly export job | Service | Corporate data center | — |

## Data stores

| No. | Data store | Kind | Boundary | Icon |
| --- | --- | --- | --- | --- |
| 1 | RDS primary | Database | Production account › VPC › Database security group | `aws:rds` |
| 2 | RDS standby (Multi-AZ) | Database | Production account › VPC › Database security group | `aws:rds` |

## Boundaries

| No. | Boundary | Frame | Inside |
| --- | --- | --- | --- |
| 1 | Production account | `aws:aws_account` | — |
| 2 | VPC | `aws:vpc` | Production account |
| 3 | Auto Scaling group | `aws:auto_scaling_group` | Production account › VPC |
| 4 | Availability Zone 1a | `aws:availability_zone` | Production account › VPC › Auto Scaling group |
| 5 | Availability Zone 1c | `aws:availability_zone` | Production account › VPC › Auto Scaling group |
| 6 | Database security group | `aws:security_group` | Production account › VPC |
| 7 | Corporate data center | — | — |

## Connections

| No. | From | To | Label | Direction |
| --- | --- | --- | --- | --- |
| 1 | Users | Route 53 | DNS | One way |
| 2 | Users | Application Load Balancer | HTTPS | One way |
| 3 | Application Load Balancer | Web server A | — | One way |
| 4 | Application Load Balancer | Web server C | — | One way |
| 5 | Web server A | RDS primary | SQL | One way |
| 6 | Web server C | RDS primary | SQL | One way |
| 7 | RDS primary | RDS standby (Multi-AZ) | replication | Both ways |
| 8 | Web server A | Secrets Manager | read secret | One way |
| 9 | Nightly export job | RDS standby (Multi-AZ) | read replica | One way |
| 10 | Nightly export job | On-premise ERP | export | One way |
