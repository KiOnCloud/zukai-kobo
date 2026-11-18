# Polish protocol

Rewrite the sentences of a report that the glossary flags, with the confirmed terms, and
apply the result only behind a diff the user approved.

1. **Hold.** Outside the labs console, run `labs holds <report-folder>`. Exit 2: a console job
   is working on this report; say so and stop, or wait when the user asks to. Inside a console
   job, skip this step: the job holds the report.
2. **Check.** `report check <report-folder>`. Keep `reports[0].rev`: the SHA-256 of the
   `report.md` you are about to read. When `findings` has no glossary finding, say so and
   stop: there is nothing to polish.
3. **Read.** Read `report.md` once, now. The text you polish is this text.
4. **Rewrite.** Write the whole text to a draft file of your own (the job's folder in the
   console, else a temporary file outside the report). For each finding, rewrite the sentence
   that holds it so that it reads naturally with the confirmed term: a sentence, not a word
   swap (grammar, particles, articles and agreement follow the new term). Change nothing
   else: no other sentence, no heading, no marker line, no link target, no code. A finding
   whose sentence cannot take the term without changing its meaning is left as it is and named
   under "Not fixed" with the reason.
5. **Draft.** `report draft <report-folder> --file <draft.md> --base-rev <rev> --findings
   @<findings.json>` (the findings of step 2 as a JSON array). It answers `polish-<n>`, its
   `draftRev`, and refuses with `conflict` when `report.md` changed since step 2: then start
   again from step 2.
6. **Show.** `report diff <report-folder> current polish-<n>`. Show the changed lines (at most
   40; past that, the count and the first 40) and list each finding with the sentence before
   and after.
7. **Ask.** One question: apply the polish, or discard it (`AskUserQuestion` where the runtime
   has it; in the console, a question card). Silence is never a yes.
8. **Apply.** On yes: `report apply <report-folder> polish-<n> --base-rev <rev> --draft-rev
   <draftRev>`. It snapshots, replaces `report.md` and renders again, or refuses with
   `conflict` when the report or the draft changed since step 5; then say so and start again
   from step 2. On no: `report discard <report-folder> polish-<n>`.
9. **Close.** The closing contract from its step 2 (`closing-contract.md`). The reply says
   which sentences changed (by section) and which findings were not fixed.

A console Apply button queues a polish job with `apply: { draft, baseRev, draftRev }`: carry
out step 8 with those values only, then step 9.
