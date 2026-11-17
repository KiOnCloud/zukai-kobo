<!-- zukai doc, lang=en: generated from the IR, regenerate instead of editing -->
# Large process with 50 steps

Diagram kind: Flowchart

## Steps

| No. | Step | Kind | Group | Next |
| --- | --- | --- | --- | --- |
| 1 | Step 1 | Decision | Intake | → Step 2 |
| 2 | Step 2 | Process | Intake | → Step 3 |
| 3 | Step 3 | Process | Intake | → Step 4<br>[no] → Step 8 |
| 4 | Step 4 | Input / output | Intake | → Step 5 |
| 5 | Step 5 | Subprocess | Intake | → Step 6 |
| 6 | Step 6 | Process | — | [yes] → Step 7 checks the inventory level |
| 7 | Step 7 checks the inventory level | Decision | — | → Step 8 |
| 8 | Step 8 | Process | — | → Step 9 |
| 9 | Step 9 | Process | — | → Step 10 |
| 10 | Step 10 | Input / output | — | → Step 11 |
| 11 | Step 11 | Subprocess | — | → Step 12 |
| 12 | Step 12 | Process | — | [yes] → Step 13<br>[no] → Step 17 |
| 13 | Step 13 | Decision | — | → Step 14 checks the inventory level |
| 14 | Step 14 checks the inventory level | Process | — | → Step 15 |
| 15 | Step 15 | Process | — | → Step 16 |
| 16 | Step 16 | Input / output | — | → Step 17 |
| 17 | Step 17 | Subprocess | — | → Step 18 |
| 18 | Step 18 | Process | — | [yes] → Step 19 |
| 19 | Step 19 | Decision | — | → Step 20 |
| 20 | Step 20 | Process | Fulfilment | → Step 21 checks the inventory level |
| 21 | Step 21 checks the inventory level | Process | Fulfilment | → Step 22<br>[no] → Step 26 |
| 22 | Step 22 | Input / output | Fulfilment | → Step 23 |
| 23 | Step 23 | Subprocess | Fulfilment | → Step 24 |
| 24 | Step 24 | Process | Fulfilment | [yes] → Step 25 |
| 25 | Step 25 | Decision | Fulfilment | → Step 26 |
| 26 | Step 26 | Process | Fulfilment | → Step 27 |
| 27 | Step 27 | Process | — | → Step 28 checks the inventory level |
| 28 | Step 28 checks the inventory level | Input / output | — | → Step 29 |
| 29 | Step 29 | Subprocess | — | → Step 30 |
| 30 | Step 30 | Process | — | [yes] → Step 31<br>[no] → Step 35 checks the inventory level |
| 31 | Step 31 | Decision | — | → Step 32 |
| 32 | Step 32 | Process | — | → Step 33 |
| 33 | Step 33 | Process | — | → Step 34 |
| 34 | Step 34 | Input / output | — | → Step 35 checks the inventory level |
| 35 | Step 35 checks the inventory level | Subprocess | — | → Step 36 |
| 36 | Step 36 | Process | — | [yes] → Step 37 |
| 37 | Step 37 | Decision | — | → Step 38 |
| 38 | Step 38 | Process | — | → Step 39 |
| 39 | Step 39 | Process | — | → Step 40<br>[no] → Step 44 |
| 40 | Step 40 | Input / output | — | → Step 41 |
| 41 | Step 41 | Subprocess | — | → Step 42 checks the inventory level |
| 42 | Step 42 checks the inventory level | Process | — | [yes] → Step 43 |
| 43 | Step 43 | Decision | — | → Step 44 |
| 44 | Step 44 | Process | — | → Step 45 |
| 45 | Step 45 | Process | — | → Step 46 |
| 46 | Step 46 | Input / output | — | → Step 47 |
| 47 | Step 47 | Subprocess | — | → Step 48 |
| 48 | Step 48 | Process | — | [yes] → Step 49 checks the inventory level |
| 49 | Step 49 checks the inventory level | Decision | — | → Step 50 |
| 50 | Step 50 | Process | — | — |

## Groups

| No. | Group |
| --- | --- |
| 1 | Intake |
| 2 | Fulfilment |
