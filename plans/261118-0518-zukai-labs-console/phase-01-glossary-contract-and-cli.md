---
phase: 1
title: "Phase 1: Glossary contract and CLI"
status: todo
priority: P1
effort: "2d"
dependencies: []
---

# Phase 1: Glossary contract and CLI

## Overview

A project keeps one file of preferred terms per language, `.zukai/glossary.json`. The CLI
validates it, takes suggestions into it, lists the label pairs a suggestion is drawn from
and checks a run against it. The skills read it when they word or translate a label. This
phase has no server and no console in it and can be released on its own.

## Context

- Today a translation is chosen by the agent each time, so one word can come out
  differently in two runs. The only record of an earlier choice is the label map
  `source/labels.<lang>.json` of each run (`skills/draw/references/variants.md`).
- An IR does not name the language of its labels unless it is a translated variant
  (`meta.lang`, `ir-reference.md:39`). The check therefore never assumes the language of
  an original label.
- The recook skill copies labels as written. It never applies the glossary; it only reports.
- `cover.mjs` (`stringsOf`, `normal`) and `scan-secrets.mjs` (`strings`) each walk the texts
  of an IR. The glossary check uses one of them and adds no third walker.

## Requirements

- [ ] `.zukai/glossary.json` has a JSON Schema and is refused by every command when it does not match it.
- [ ] Entries are symmetric: no language is the source of another.
- [ ] A suggestion never changes what a command applies; only a confirmed entry does.
- [ ] A rejected entry is kept, so the same suggestion is not made again.
- [ ] Two writers (the CLI and, later, the server) cannot lose each other's change.
- [ ] The file is stable under git: sorted, two-space JSON, LF, final newline.
- [ ] A term, note or avoided term that the secret scan calls a credential is refused.
- [ ] Evidence holds ids (run, diagram, element, language), never label text.

## Design

### File

```json
{
  "schemaVersion": 1,
  "languages": ["en", "vi", "ja"],
  "entries": [
    {
      "id": "office",
      "terms": { "en": "office", "vi": "văn phòng", "ja": "オフィス" },
      "avoid": { "vi": ["cơ quan"] },
      "note": "The place of work, not the organisation.",
      "status": "confirmed",
      "evidence": [{ "run": "20261109_login-flow", "diagram": "login-flow", "element": "n3", "lang": "vi" }]
    }
  ]
}
```

- Language keys are BCP 47 tags, as `meta.lang` is. `languages` is optional and only
  orders the columns of the console.
- `terms[lang]` is one preferred term. `avoid[lang]` lists words not to use for it.
- `status` is `suggested`, `confirmed` or `rejected`.
- `id` is a slug of the first term, with `-2`, `-3` on a clash. It never changes.

### Comparison

Texts are compared after NFC, lower case and collapsed white space. Diacritics are kept
(`văn phòng` is not `van phong`). A term is "equal" to a label when the two are the same
after that, and "contained" when it stands between characters that are not letters or
digits; for a term written in Han, Hiragana or Katakana, contained means substring.

### Commands

```text
cli.mjs glossary list [--root <project>] [--status <suggested|confirmed|rejected>]
cli.mjs glossary add --from <file.json> [--status <suggested|confirmed>] [--root <project>]
cli.mjs glossary set <id> --status <suggested|confirmed|rejected> [--root <project>]
cli.mjs glossary pairs <run-dir>... [--root <project>]
cli.mjs glossary check <run-dir>... [--root <project>]
```

- The project root is `--root`, else the nearest folder with `.git` at or above the
  working directory (`gitRootOf`), else the working directory.
- `add` takes `{ "entries": [{ terms, avoid?, note?, evidence? }] }`, default status
  `suggested`. An entry whose terms equal those of an existing entry in every language the
  two share is skipped and reported with the status of the existing one. An entry that
  shares a term in one language with a confirmed entry and differs in another is reported
  under `conflicts` and not written.
- `pairs` reads `source/labels.<lang>.json` and `source/<lang>/<slug>.ir.json` of each run
  and prints `{ pairs: [{ run, diagram, element, lang, source, translated }] }`, with
  `redactText` applied and the `$keep` list left out. It is what the agent reads to
  suggest entries; the agent never opens the maps itself.
- `check` uses confirmed entries only and prints one JSON object on stdout:

| Finding | When | Level |
|---|---|---|
| `avoided-term` | A label equals an avoided term | blocking |
| `avoided-term` | A label contains an avoided term | warning |
| `translation-mismatch` | An original label equals a term of an entry in any language, and its translation into `lang` is not `terms[lang]` | blocking |
| `translation-mismatch` | An original label contains such a term, and its translation does not contain `terms[lang]` | warning |

  Each finding names run, diagram, element, language, the text, the entry and what was
  expected. Exit 0 with no blocking finding, 2 with one, 1 for a usage error, a missing
  glossary or one that does not match the schema.

### Store

`glossary.mjs` exports `readGlossary(root)`, `writeGlossary(root, mutate, { expectedRev })`
and `checkRuns(root, runDirs)`. A write takes `.zukai/glossary.lock` by exclusive create
(pid and time inside; taken over when the pid is gone or the lock is older than 30 s),
reads, applies `mutate`, validates, writes a temporary sibling and renames it. `rev` is
the SHA-256 of the file's bytes; a write with an `expectedRev` that no longer matches
returns `{ ok: false, code: 'conflict' }` and changes nothing.

### Skill text

- New `skills/draw/references/glossary.md`: what the file is, when a skill reads it, the
  five commands, the rule that a suggestion is never applied.
- `closing-contract.md` (label rules): with a glossary in the project, a label uses the
  confirmed term of the user's language; `glossary check` runs before the report and a
  blocking finding is fixed like a validation error.
- `variants.md` (language variants): a map or a translated IR takes confirmed terms first;
  `glossary check` runs after it is written.
- `review-checklist.md` item 5: consistent labels include the glossary's terms.
- `skills/draw/SKILL.md`: the command lines and the reference list.
- `skills/revise/SKILL.md`: a reworded label follows the glossary.
- `skills/recook/SKILL.md`: labels stay as written; findings of `check` go into the report.

## Files to Create / Modify

- Create: `skills/draw/scripts/src/schema/glossary-v1.schema.json`
- Create: `skills/draw/scripts/src/glossary.mjs`
- Create: `skills/draw/scripts/tests/glossary.test.mjs`
- Create: `skills/draw/scripts/tests/glossary-e2e.test.mjs`
- Create: `skills/draw/scripts/fixtures/glossary/` (a glossary, a run with a `vi` map and a `ja` translated IR)
- Create: `skills/draw/references/glossary.md`
- Modify: `skills/draw/scripts/src/cli.mjs` (the `glossary` command, `--status`, usage text)
- Modify: `skills/draw/scripts/bin/cli.mjs` (rebuilt)
- Modify: `skills/draw/SKILL.md`, `skills/draw/references/closing-contract.md`, `variants.md`, `review-checklist.md`
- Modify: `skills/revise/SKILL.md`, `skills/recook/SKILL.md`

## Implementation Steps

1. Write the schema and `readGlossary` with schema errors in the shape `validateIr` returns (path and hint).
2. Write the comparison helpers with a table-driven test: Latin, Vietnamese with diacritics, Japanese, a term inside a longer word (`office` in `Back-office`).
3. Write `writeGlossary` with the lock, the atomic rename and `expectedRev`; test two writers and a stale lock.
4. Write `add`, `set` and `list` on the store, with the skip and conflict rules.
5. Write `pairs` over the two variant layouts of `variants.md`.
6. Write `checkRuns`, reusing one existing text walker; cover the four rows of the table.
7. Wire the `glossary` command into `cli.mjs` with its option list in `COMMAND_OPTIONS`; rebuild the bundle.
8. Write the e2e test through the committed bundle from another working directory, every exit code included.
9. Edit the skill text listed above.

## Todo

- [ ] Schema and reader
- [ ] Comparison helpers and their table test
- [ ] Locked, atomic store
- [ ] `add`, `set`, `list`
- [ ] `pairs`
- [ ] `check` with both levels and three exit codes
- [ ] CLI wiring and rebuilt bundle
- [ ] E2E through the bundle
- [ ] Skill text in draw, revise and recook

## Success Criteria

- `cd skills/draw/scripts && npm test` passes; no existing snapshot changes.
- `glossary check` on the fixture exits 2 and names the element whose `vi` translation of `office` is not `văn phòng`; after the map is fixed it exits 0.
- `office` inside `Back-office system` is a warning, never blocking.
- A suggested entry changes no result of `check`.
- Adding a rejected entry again is reported as skipped.
- Two `add` calls started together both land in the file.
- A term that holds a token pattern is refused and the file is unchanged.

## Risk Assessment

| Risk | Signal | Response |
|---|---|---|
| Contained matches give too many warnings in real runs | The e2e round of phase 6 lists more than a handful per run | Keep them out of the report unless the user asks; blocking findings are unaffected. |
| The schema needs a field once the console exists | A console view needs data the file lacks | Add an optional field; `schemaVersion` stays 1 while changes are additive. |
| Teams edit the file by hand and break the order | A git diff reorders the file | Every write sorts it again; a hand edit that still matches the schema is accepted. |

## Security Considerations

The glossary is committed and shared. It must hold no personal data and no credential: the
secret scan refuses the second, the reference file says the first, and evidence carries
ids only. `pairs` prints label text to the agent with `redactText` applied.
