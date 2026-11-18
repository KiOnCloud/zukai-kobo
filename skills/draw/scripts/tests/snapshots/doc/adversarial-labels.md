<!-- zukai doc, lang=en: generated from the IR, regenerate instead of editing -->
# Adversarial "labels" %%{init: {"theme":"forest"}}%%

Diagram kind: Flowchart

## Steps

| No. | Step | Kind | Group | Next |
| --- | --- | --- | --- | --- |
| 1 | He said "end" | Start / end | — | "quoted" label → line one<br>line two |
| 2 | line one<br>line two | Process | — | [x --&gt; y] → &lt;script&gt;alert(1)&lt;/script&gt; |
| 3 | &lt;script&gt;alert(1)&lt;/script&gt; | Decision | — | [end] → %%{init: {"theme":"forest"}}%% |
| 4 | %%{init: {"theme":"forest"}}%% | Process | — | → click n1 href "https://evil.example" |
| 5 | click n1 href "https://evil.example" | Input / output | subgraph end | → n1 --&gt; n2; n2 --&gt; n3 |
| 6 | n1 --&gt; n2; n2 --&gt; n3 | Subprocess | subgraph end | → postgres://app:Sup3rS3cret@db.internal:5432/orders |
| 7 | postgres://app:Sup3rS3cret@db.internal:5432/orders | Note | — | → api key ghp\_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ab |
| 8 | api key ghp\_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ab | Process | — | → 注文を確定する \[確認済み\] {JSON} |
| 9 | 注文を確定する \[確認済み\] {JSON} | Process | — | → a \| b \| c \#1 &amp; co |
| 10 | a \| b \| c \#1 &amp; co | Process | — | — |

## Groups

| No. | Group |
| --- | --- |
| 1 | subgraph end |
