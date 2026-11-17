<!-- zukai doc, lang=en: generated from the IR, regenerate instead of editing -->
# Clinic appointments

Diagram kind: Use case diagram

## Actors

| No. | Actor | Kind | Role |
| --- | --- | --- | --- |
| 1 | Patient | Person | Primary |
| 2 | Receptionist | Person | Primary |
| 3 | Doctor | Person | Primary |
| 4 | Health insurer | System | Supporting |
| 5 | Nightly reminder run | System | Primary |

## Use cases

| No. | Use case | Boundary |
| --- | --- | --- |
| 1 | Book an appointment | Booking portal |
| 2 | Cancel an appointment | Booking portal |
| 3 | Remind the patient | Booking portal |
| 4 | Check a patient in | Practice management |
| 5 | Record the consultation | Practice management |
| 6 | Issue an invoice | Practice management |
| 7 | Claim the cost from the insurer | Practice management |

## Boundaries

| No. | Boundary |
| --- | --- |
| 1 | Booking portal |
| 2 | Practice management |

## Relations

| No. | From | Relation | To | Condition |
| --- | --- | --- | --- | --- |
| 1 | Patient | Association | Book an appointment | — |
| 2 | Patient | Association | Cancel an appointment | — |
| 3 | Nightly reminder run | Association | Remind the patient | — |
| 4 | Receptionist | Association | Book an appointment | — |
| 5 | Receptionist | Association | Check a patient in | — |
| 6 | Doctor | Association | Record the consultation | — |
| 7 | Receptionist | Association | Issue an invoice | — |
| 8 | Claim the cost from the insurer | Extend | Issue an invoice | the patient is insured |
| 9 | Claim the cost from the insurer | Association | Health insurer | — |
