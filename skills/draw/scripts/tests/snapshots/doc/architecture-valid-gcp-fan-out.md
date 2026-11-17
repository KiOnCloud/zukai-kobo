<!-- zukai doc, lang=en: generated from the IR, regenerate instead of editing -->
# Booking API on GKE

Diagram kind: Architecture diagram

## Components

| No. | Component | Kind | Boundary | Icon |
| --- | --- | --- | --- | --- |
| 1 | Staff browser | Client | — | — |
| 2 | Application Load Balancer (HTTPS) | Service | asia-northeast1 (Tokyo) › VPC network › Proxy-only subnet | `gcp:cloud_load_balancing` |
| 3 | Booking API (GKE Autopilot, 2 pods) | Service | asia-northeast1 (Tokyo) › VPC network › GKE subnet | `gcp:container_engine` |
| 4 | Artifact Registry (API image) | Service | asia-northeast1 (Tokyo) | `gcp:container_registry` |
| 5 | Cloud KMS | Service | asia-northeast1 (Tokyo) | `gcp:key_management_service` |
| 6 | Cloud Logging (30 days) | Service | asia-northeast1 (Tokyo) | `gcp:logging` |
| 7 | Identity provider | External system | — | `gcp:application` |
| 8 | Firebase Realtime Database | External system | — | `gcp:firebase` |
| 9 | Hospital records system | External system | — | `gcp:application_system` |

## Data stores

| No. | Data store | Kind | Boundary | Icon |
| --- | --- | --- | --- | --- |
| 1 | Cloud Storage load balancer logs | Database | asia-northeast1 (Tokyo) | `gcp:cloud_storage` |
| 2 | Firestore (9 collections) | Database | asia-northeast1 (Tokyo) | `gcp:cloud_firestore` |
| 3 | Cloud Storage attachments | Database | asia-northeast1 (Tokyo) | `gcp:cloud_storage` |
| 4 | Cloud Tasks reminders | Queue | asia-northeast1 (Tokyo) | `gcp:cloud_tasks` |
| 5 | Pub/Sub booking events | Queue | asia-northeast1 (Tokyo) | `gcp:cloud_pubsub` |

## Boundaries

| No. | Boundary | Frame | Inside |
| --- | --- | --- | --- |
| 1 | asia-northeast1 (Tokyo) | `gcp:region` | — |
| 2 | VPC network | `gcp:vpc_network` | asia-northeast1 (Tokyo) |
| 3 | Proxy-only subnet | `gcp:subnet` | asia-northeast1 (Tokyo) › VPC network |
| 4 | GKE subnet | `gcp:subnet` | asia-northeast1 (Tokyo) › VPC network |

## Connections

| No. | From | To | Label | Direction |
| --- | --- | --- | --- | --- |
| 1 | Staff browser | Application Load Balancer (HTTPS) | HTTPS | One way |
| 2 | Application Load Balancer (HTTPS) | Booking API (GKE Autopilot, 2 pods) | HTTP :8080 | One way |
| 3 | Artifact Registry (API image) | Booking API (GKE Autopilot, 2 pods) | pull image | One way |
| 4 | Application Load Balancer (HTTPS) | Cloud Storage load balancer logs | access logs | One way |
| 5 | Booking API (GKE Autopilot, 2 pods) | Cloud KMS | decrypt at start | One way |
| 6 | Booking API (GKE Autopilot, 2 pods) | Firestore (9 collections) | read / write | One way |
| 7 | Booking API (GKE Autopilot, 2 pods) | Cloud Storage attachments | store files | One way |
| 8 | Booking API (GKE Autopilot, 2 pods) | Cloud Tasks reminders | reminder due | One way |
| 9 | Booking API (GKE Autopilot, 2 pods) | Pub/Sub booking events | publish | One way |
| 10 | Booking API (GKE Autopilot, 2 pods) | Cloud Logging (30 days) | JSON logs | One way |
| 11 | Booking API (GKE Autopilot, 2 pods) | Identity provider | verify token | One way |
| 12 | Booking API (GKE Autopilot, 2 pods) | Firebase Realtime Database | publish version | One way |
| 13 | Booking API (GKE Autopilot, 2 pods) | Hospital records system | fetch records | One way |
