<!-- zukai doc, lang=en: generated from the IR, regenerate instead of editing -->
# Nightly report

Diagram kind: Flowchart

## Steps

| No. | Step | Kind | Next |
| --- | --- | --- | --- |
| 1 | Scheduler fires at 02:00 | Start / end | → Collect orders created from 00:00 to 23:59<br>of the previous day, excluding test accounts<br>and cancelled orders |
| 2 | Collect orders created from 00:00 to 23:59<br>of the previous day, excluding test accounts<br>and cancelled orders | Process | → Collect orders |
| 3 | Collect orders | Process | → Render the report as PDF and CSV files<br>and upload both to the shared folder |
| 4 | Render the report as PDF and CSV files<br>and upload both to the shared folder | Process | → Report ready |
| 5 | Report ready | Start / end | — |
