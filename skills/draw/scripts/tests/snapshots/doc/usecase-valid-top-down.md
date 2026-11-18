<!-- zukai doc, lang=en: generated from the IR, regenerate instead of editing -->
# Parking garage

Diagram kind: Use case diagram

## Actors

| No. | Actor | Kind | Role |
| --- | --- | --- | --- |
| 1 | Driver | Person | Primary |
| 2 | Subscriber | Person | Primary |
| 3 | Visitor | Person | Primary |
| 4 | Attendant | Person | Primary |
| 5 | Card acquirer | System | Supporting |
| 6 | Plate recognition | System | Supporting |

## Use cases

| No. | Use case | Boundary |
| --- | --- | --- |
| 1 | Enter the garage | Garage system |
| 2 | Leave the garage | Garage system |
| 3 | Pay the parking fee | Garage system |
| 4 | Read the number plate | Garage system |
| 5 | Open the barrier by hand | Garage system |

## Boundaries

| No. | Boundary |
| --- | --- |
| 1 | Garage system |

## Relations

| No. | From | Relation | To | Condition |
| --- | --- | --- | --- | --- |
| 1 | Subscriber | Generalization | Driver | — |
| 2 | Visitor | Generalization | Driver | — |
| 3 | Driver | Association | Enter the garage | — |
| 4 | Driver | Association | Leave the garage | — |
| 5 | Attendant | Association | Open the barrier by hand | — |
| 6 | Enter the garage | Include | Read the number plate | — |
| 7 | Leave the garage | Include | Read the number plate | — |
| 8 | Pay the parking fee | Extend | Leave the garage | no subscription |
| 9 | Pay the parking fee | Association | Card acquirer | — |
| 10 | Read the number plate | Association | Plate recognition | — |
