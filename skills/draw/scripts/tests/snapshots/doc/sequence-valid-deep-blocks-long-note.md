<!-- zukai doc, lang=en: generated from the IR, regenerate instead of editing -->
# Nightly stock sync

Diagram kind: Sequence diagram

## Participants

| No. | Participant | Kind |
| --- | --- | --- |
| 1 | Sync job | Control |
| 2 | ERP | Boundary |
| 3 | Shop database | Database |

## Steps

| No. | From | To | Message | Kind | Condition |
| --- | --- | --- | --- | --- | --- |
| 1 | Sync job | ERP | GET /stock?page=n | Synchronous | loop: for every page |
| 2 | ERP | Sync job | stock page | Reply | loop: for every page |
| 3 | Sync job | Shop database | UPDATE stock level | Synchronous | loop: for every page<br>loop: for every item<br>alt: item is known<br>opt: level changed |
| 4 | Shop database | Sync job | rows updated | Reply | loop: for every page<br>loop: for every item<br>alt: item is known<br>opt: level changed |
| 5 | Sync job | Shop database | INSERT sync error | Synchronous | loop: for every page<br>loop: for every item<br>alt else: item is unknown |
| 6 | Sync job | Shop database | COMMIT | Synchronous | loop: for every page<br>loop: for every item |
| 7 | Sync job | Sync job | Write the run summary | Synchronous | — |

## Notes

| No. | Note | Participant | Position | Placed after |
| --- | --- | --- | --- | --- |
| 1 | A page holds at most 500 items. The ERP limits the job to four requests per second, so a full run of 60000 items takes about half a minute of waiting on top of the time the updates take. | ERP | Right | 2. stock page |
