# Closing contract of a report

Every mode that wrote a report (write, polish, translate) ends with these steps, in order. Each
command runs from the project root with the CLI of `<draw-dir>`.

## Steps

1. **The record is valid.** `report.json` was written by `report new` and is never edited by
   hand. When a command answers `not-a-report` or `invalid`, stop and say which file.
2. **Check.** `report check <report-folder>`. Read `findings`:
   - `secret` with `level: blocking`: a credential by its form. Remove it from the line named
     and check again. A report is never delivered with one.
   - `secret` with `level: warning`: a guess (an assignment, a long random string, an e-mail
     address or a telephone number). Replace it with a placeholder unless the user said it is
     no secret; say which you kept.
   - `avoided-term`, `kept-term-changed`, `sections-differ` (blocking): fix them with the
     polish protocol (`polish-protocol.md`) when the user asked for a polish, else rewrite the
     sentence yourself with the confirmed term and check again. A finding you cannot fix is
     reported under "Not fixed" with the reason.
   - `untranslated-term`, `translation-mismatch` (warnings): rewrite the sentence when the
     confirmed term fits it; otherwise list it.
   `glossary: "missing"` means the project has no glossary: only the secret scan ran; say so
   in one line.
3. **Render.** `report render <report-folder>` writes `report.html` (and each
   `<lang>/report.html`) through the template's layout. Exit 2 means a credential is still in
   the text: back to step 2. A `warning` (the template was not found where it was recorded,
   or the default layout was used) is passed on in one line.
4. **Register.** `report new` registered the project in the run index already; nothing to do
   for a later mode.
5. **Reply.** Name `report.html` first: it is the deliverable, and the browser prints it to
   PDF (File, Print, Save as PDF). Then `report.md`, the folder, the template (id and scope),
   the language, the runs embedded, and the findings left with their reason. Offer to open the
   HTML file (`start`, `open` or `xdg-open` with the path, or the labs console's Reports
   section); open it only on the user's yes.
6. **Never commit.** The report stays in the working tree for the user to review.

## Revisions

`report snapshot <report-folder> --request "<why>"` before a change that rewrites a report
the user already has (a polish is applied through `report apply`, which snapshots by itself;
a translation snapshots before it writes). `report revisions` lists them and `report restore
<report-folder> <rNNN>` puts one back byte for byte, after a snapshot of the state it leaves.
A report keeps 20 revisions.
