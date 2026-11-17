<!-- zukai doc, lang=en: generated from the IR, regenerate instead of editing -->
# Booking platform on Google Cloud

Diagram kind: Architecture diagram

## Components

| No. | Component | Kind | Boundary | Icon |
| --- | --- | --- | --- | --- |
| 1 | Staff browser | Client | — | — |
| 2 | Cloud CDN | Service | Production project | `gcp:cloud_cdn` |
| 3 | Application Load Balancer | Service | Production project › asia-northeast1 (Tokyo) › VPC network › Proxy-only subnet | `gcp:cloud_load_balancing` |
| 4 | Booking API (GKE) | Service | Production project › asia-northeast1 (Tokyo) › VPC network › GKE subnet | `gcp:container_engine` |
| 5 | Identity provider | External system | — | `gcp:application` |
| 6 | Firebase Realtime Database | External system | — | `gcp:firebase` |
| 7 | Client log collector | External system | — | `gcp:application` |

## Data stores

| No. | Data store | Kind | Boundary | Icon |
| --- | --- | --- | --- | --- |
| 1 | Cloud Storage web app | Database | Production project › asia-northeast1 (Tokyo) | `gcp:cloud_storage` |
| 2 | Firestore | Database | Production project › asia-northeast1 (Tokyo) | `gcp:cloud_firestore` |
| 3 | Cloud Storage attachments | Database | Production project › asia-northeast1 (Tokyo) | `gcp:cloud_storage` |

## Boundaries

| No. | Boundary | Frame | Inside |
| --- | --- | --- | --- |
| 1 | Production project | `gcp:project` | — |
| 2 | asia-northeast1 (Tokyo) | `gcp:region` | Production project |
| 3 | VPC network | `gcp:vpc_network` | Production project › asia-northeast1 (Tokyo) |
| 4 | Proxy-only subnet | `gcp:subnet` | Production project › asia-northeast1 (Tokyo) › VPC network |
| 5 | GKE subnet | `gcp:subnet` | Production project › asia-northeast1 (Tokyo) › VPC network |

## Connections

| No. | From | To | Label | Direction |
| --- | --- | --- | --- | --- |
| 1 | Staff browser | Cloud CDN | HTTPS | One way |
| 2 | Staff browser | Application Load Balancer | REST | One way |
| 3 | Staff browser | Identity provider | sign in | One way |
| 4 | Staff browser | Firebase Realtime Database | listen for version | One way |
| 5 | Staff browser | Client log collector | client logs | One way |
| 6 | Cloud CDN | Cloud Storage web app | — | One way |
| 7 | Application Load Balancer | Booking API (GKE) | HTTP | One way |
| 8 | Booking API (GKE) | Firestore | read / write | One way |
| 9 | Booking API (GKE) | Cloud Storage attachments | store files | One way |
| 10 | Booking API (GKE) | Identity provider | verify token | One way |
| 11 | Booking API (GKE) | Firebase Realtime Database | publish version | One way |
