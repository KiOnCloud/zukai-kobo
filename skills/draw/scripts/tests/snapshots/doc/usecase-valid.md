<!-- zukai doc, lang=en: generated from the IR, regenerate instead of editing -->
# Library lending

Diagram kind: Use case diagram

## Actors

| No. | Actor | Kind | Role |
| --- | --- | --- | --- |
| 1 | Member | Person | Primary |
| 2 | Librarian | Person | Primary |
| 3 | Payment provider | System | Supporting |

## Use cases

| No. | Use case | Boundary |
| --- | --- | --- |
| 1 | Search the catalogue | Library system |
| 2 | Borrow a book | Library system |
| 3 | Return a book | Library system |
| 4 | Check the library card | Library system |
| 5 | Pay a late fee | Library system |
| 6 | Register a new member | Library system |

## Boundaries

| No. | Boundary |
| --- | --- |
| 1 | Library system |

## Relations

| No. | From | Relation | To | Condition |
| --- | --- | --- | --- | --- |
| 1 | Member | Association | Search the catalogue | — |
| 2 | Member | Association | Borrow a book | — |
| 3 | Member | Association | Return a book | — |
| 4 | Librarian | Association | Register a new member | — |
| 5 | Borrow a book | Include | Check the library card | — |
| 6 | Pay a late fee | Extend | Return a book | the book is overdue |
| 7 | Payment provider | Association | Pay a late fee | — |
