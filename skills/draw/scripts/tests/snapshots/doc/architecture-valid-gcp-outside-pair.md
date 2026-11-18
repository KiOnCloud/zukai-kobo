<!-- zukai doc, lang=en: generated from the IR, regenerate instead of editing -->
# Scheduled sync on Google Cloud with a partner that calls back

Diagram kind: Architecture diagram

## Components

| No. | Component | Kind | Boundary | Icon |
| --- | --- | --- | --- | --- |
| 1 | Cloud Scheduler job | Service | Google Cloud › Region | `gcp:scheduled_tasks` |
| 2 | Sync function | Service | Google Cloud › Region | `gcp:cloud_functions` |
| 3 | Application Load Balancer | Service | Google Cloud › Region | `gcp:cloud_load_balancing` |
| 4 | API (Cloud Run) | Service | Google Cloud › Region | `gcp:cloud_run` |
| 5 | Partner API | External system | — | `gcp:application_system` |

## Data stores

| No. | Data store | Kind | Boundary | Icon |
| --- | --- | --- | --- | --- |
| 1 | Firestore (6 collections) | Database | Google Cloud › Region | `gcp:cloud_firestore` |

## Boundaries

| No. | Boundary | Frame | Inside |
| --- | --- | --- | --- |
| 1 | Google Cloud | `gcp:google_cloud` | — |
| 2 | Region | `gcp:region` | Google Cloud |

## Connections

| No. | From | To | Label | Direction |
| --- | --- | --- | --- | --- |
| 1 | Cloud Scheduler job | Sync function | invoke | One way |
| 2 | Sync function | Application Load Balancer | HTTPS | One way |
| 3 | Application Load Balancer | API (Cloud Run) | HTTP | One way |
| 4 | API (Cloud Run) | Firestore (6 collections) | read / write | One way |
| 5 | API (Cloud Run) | Partner API | HTTPS | One way |
| 6 | Partner API | API (Cloud Run) | webhook | One way |
