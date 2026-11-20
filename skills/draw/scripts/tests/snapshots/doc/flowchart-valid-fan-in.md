<!-- zukai doc, lang=en: generated from the IR, regenerate instead of editing -->
# Nightly import

Diagram kind: Flowchart

## Steps

| No. | Step | Kind | Next |
| --- | --- | --- | --- |
| 1 | Export from CRM | Process | → Collect the nightly batch |
| 2 | Export from billing | Process | → Collect the nightly batch |
| 3 | Export from support desk | Process | → Collect the nightly batch |
| 4 | Export from web shop | Process | → Collect the nightly batch |
| 5 | Export from partner portal | Process | → Collect the nightly batch |
| 6 | Export from warehouse | Process | → Collect the nightly batch |
| 7 | Manual upload | Process | late file → Collect the nightly batch |
| 8 | Collect the nightly batch | Input / output | → Batch complete? |
| 9 | Batch complete? | Decision | [yes] → Load into the reporting store<br>[no] → Collect the nightly batch |
| 10 | Load into the reporting store | Process | → Import finished |
| 11 | Import finished | Start / end | — |
