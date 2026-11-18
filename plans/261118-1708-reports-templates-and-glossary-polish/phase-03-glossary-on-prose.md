---
phase: 3
title: "Glossary on prose: check, keep terms, translations"
status: completed
priority: P1
effort: "1d"
dependencies: [1]
---

# Phase 3: Glossary on prose: check, keep terms, translations

## Goal

`report check` holds a report's prose, and each translation, to the confirmed glossary
entries, with findings the polish job and the console can act on and that a correct text
can always clear.

## Context

- `glossary.mjs`: `checkGlossary(glossary, runs)` :456, `checkRuns` :503; helpers
  `normalText` :58, `sameText` :64, `containsText` :71-81 with `WORD = /[\p{L}\p{N}\p{M}]/u`
  :61 (Kana counts as a letter, so `officeを` does not contain "office" today); kinds
  `avoided-term` (:473, blocking only when equal) and `translation-mismatch` (:491); no check
  that an avoided word is not part of its own entry's term (:281-321). CLI exits 2 on
  blocking (`cli.mjs:1062`).
- The schema already allows the same term in two languages (`{ "en": "office", "ja": "office" }`).

## Files to Create / Modify

- Modify: `skills/draw/scripts/src/glossary.mjs` (`checkProse`, prose boundary rule, avoid-inside-term validation)
- Modify: `skills/draw/scripts/src/reports.mjs` (`proseOf(reportDir)`: blocks with section id, line and language; section alignment check)
- Modify: `skills/draw/scripts/src/cli.mjs` (`report check <report-dir>... [--root]`)
- Modify: `skills/draw/scripts/tests/glossary.test.mjs`; create `tests/report-check-e2e.test.mjs`

## Tasks & Steps

- [x] 1. `proseOf` splits Markdown into checkable blocks (paragraphs, list items, table cells, headings), skipping fenced code, inline code and link targets, each with `{ report, file, section, line, lang, text }`. Phase 1's per-block secret scan uses the same splitter.
- [x] 2. Prose boundary rule (prose only; label checks unchanged): a change of script at the edge of a match (Latin next to Han, Hiragana or Katakana) counts as a word boundary, so `officeを使う` contains "office" and an avoided Latin word in Japanese prose is found. <!-- Updated: Red Team Session 1 - Latin next to CJK -->
- [x] 3. Before matching an entry's avoided words in a block, the spans covered by that entry's own confirmed term in the block's language are masked, so `サーバー` never matches the avoided `サーバ`. `addEntries` (and `glossary add`) refuse a new entry whose avoided word is part of its own term in the same language. <!-- Updated: Red Team Session 1 - avoid inside own term -->
- [x] 4. `checkProse(glossary, blocks)` beside `checkGlossary`, same finding shape with `report`, `file`, `section`, `line` in place of `run`, `diagram`, `path`:
  - `avoided-term`: a block contains a confirmed entry's avoided word for its language. **Blocking** in prose; the polish job resolves it.
  - `untranslated-term`: in a report or translation written in language L, a block contains a confirmed entry's term of another language whose term for L is different text. **Warning**. A term that is the same text in both languages (the keep rule) never raises it. <!-- Updated: Red Team Session 1 - requested untranslated check -->
  - `translation-mismatch`: in `<lang>/report.md`, a block of a section whose original contains a confirmed term lacks that entry's term for `<lang>`. **Warning**: sentences are not aligned word for word.
  - `kept-term-changed`: an entry whose term is the same text in the original's and the translation's language is in the original section but absent, verbatim, from the translation's section. **Blocking**.
- [x] 5. Section alignment: a translation whose section ids differ from the original's fails `report check` with one `sections-differ` finding naming the missing and extra ids, and no per-term findings for that file. <!-- Updated: Red Team Session 1 - CLI checks markers -->
- [x] 6. `report check` prints `{ ok, blocking, warnings, findings }` (with the secret-scan findings of phase 1), exit 2 on blocking, 1 on no or invalid glossary when glossary findings are asked for; findings carry the line so the console can point at it.
- [x] 7. Tests with real samples: Vietnamese with diacritics (an avoided word must not match the same letters without diacritics), Japanese without spaces (an avoided term inside a longer run of Kana; `officeの` keeps "office"), `サーバー` vs avoided `サーバ`, English word boundaries ("use" not in "user"), the `office` keep rule en → ja, an English term left in a Japanese original, and a translation with a dropped section.

## Verification

- `cd skills/draw/scripts && npx vitest run tests/glossary.test.mjs`
- `npm run build && npx vitest run tests/report-check-e2e.test.mjs tests/glossary-e2e.test.mjs tests/bundle-drift.test.mjs`

## Risks

- Label checks must not change: `checkGlossary` output for runs stays byte-identical (existing tests); the boundary and masking rules apply to prose only.
- A confirmed glossary written before 2.7.0 may hold an avoided word inside its own term. Signal: `glossary list` reports it. Response: the masking keeps prose checks correct; the new refusal applies to new entries only, and the console shows the old entry for review.
