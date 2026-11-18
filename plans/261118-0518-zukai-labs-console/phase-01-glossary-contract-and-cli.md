---
phase: 1
title: "Phase 1: Glossary contract and CLI"
status: todo
priority: P1
effort: "2d"
dependencies: []
---

# Phase 1: Glossary contract and CLI

<!-- Updated: Red Team Session 1 - pairing through translated IRs, map findings as warnings, text limits, one root rule, labelsOf, option names, lock takeover, no languages or evidence field -->

## Overview

A project keeps one file of preferred terms per language, `.zukai/glossary.json`. The CLI
validates it, takes suggestions into it, lists the label pairs a suggestion is drawn from
and checks a run against it. The skills read it when they word or translate a label. This
phase has no server and no console in it and can be released on its own.

## Context

- Today a translation is chosen by the agent each time, so one word can come out
  differently in two runs.
- A language variant exists in two forms (`skills/draw/references/variants.md`). The
  translated IRs under `source/<lang>/` keep ids and structure and are kept up to date by
  revise (`skills/revise/SKILL.md:126-128`). The label map `source/labels.<lang>.json` is
  keyed by draw.io cell (`<diagram id>:<ir id>`, a bare id, `:title`, `canvas:title`,
  `<entity id>:row-<n>`, a whole transition text) and no step rewrites it after a later
  change (`variants.md:94-124`, `relabel.mjs:54-56`). A map can therefore be older than
  the IR and cannot always be paired with one element.
- An IR does not name the language of its labels unless it is a translated variant
  (`meta.lang`, `ir-reference.md:39`). The check never assumes the language of an
  original label.
- No function returns the labels of an IR with their place. `stringsOf` (`cover.mjs:56`)
  and `strings` (`scan-secrets.mjs:106`) are private and return every string; `labelOf`
  (`ir-diff.mjs:38`) takes only the first of several label fields.
- The recook skill copies labels as written. It never applies the glossary; it only reports.
- The glossary is committed and read by every teammate's agent, so its text is an input
  from outside for each of them.

## Requirements

- [ ] `.zukai/glossary.json` has a JSON Schema and every command refuses a file that does not match it.
- [ ] Entries are symmetric: no language is the source of another.
- [ ] A suggestion never changes what a command applies; only a confirmed entry does.
- [ ] A rejected entry is kept, so the same suggestion is not made again.
- [ ] Two writers (the CLI and, later, the server) cannot lose each other's change, a stale lock included.
- [ ] The file is stable under git: sorted, two-space JSON, LF, final newline.
- [ ] A term, an avoided term or a note is refused when it is too long, holds a control or direction character, or the secret scan finds anything in it, personal data included.
- [ ] A blocking finding comes only from data the change flow keeps up to date.
- [ ] One function gives the labels of an IR for every kind, and the check, the pairs and the console's editor all use it.

## Design

### Root

The project root is `--root`, else the working directory, as the skills define it
(`skills/sync/SKILL.md:42-43`). `.zukai/` and `diagrams/` lie directly under it. Every
`glossary` and `labs` command uses this one rule.

### File

```json
{
  "schemaVersion": 1,
  "entries": [
    {
      "id": "g-3fa1c0de",
      "terms": { "en": "office", "vi": "văn phòng", "ja": "オフィス" },
      "avoid": { "vi": ["cơ quan"] },
      "note": "The place of work, not the organisation.",
      "status": "confirmed"
    }
  ]
}
```

- Language keys are BCP 47 tags, as `meta.lang` is.
- `terms[lang]` is one preferred term. `avoid[lang]` lists words not to use for it.
- A term or an avoided term has at most 80 characters and one line; a note at most 280.
  None may hold a control character or a direction mark.
- `status` is `suggested`, `confirmed` or `rejected`.
- `id` is `g-` and the first eight hex digits of the SHA-256 of the entry's normalised
  terms at the time it was added. It never changes afterwards.
- `.zukai/.gitignore`, written when `.zukai/` is first created, ignores `labs/` and
  `glossary.lock`.

### Labels of an IR

New `ir-labels.mjs` exports `labelsOf(ir)`, which returns
`[{ path, collection, id, field, text }]` for every text a reader sees: label, name and
title of an element, the event, guard and action of a transition, each attribute or
member row, the condition of an `extend`, the diagram title. It reads the collections as
`collections` of `ir-diff.mjs` does. It is the only walker the glossary and the console use.

### Comparison

Texts are compared after NFKC, lower case and collapsed white space, as `normal` of
`cover.mjs` does, so full-width and half-width forms are the same. Diacritics are kept
(`văn phòng` is not `van phong`). A term is "equal" to a label when the two are the same
after that, and "contained" when it stands between characters that are not letters or
digits; for a term written in Han, Hiragana or Katakana, contained means substring.

### Commands

```text
cli.mjs glossary list [--root <project>] [--status <suggested|confirmed|rejected>]
cli.mjs glossary add --entries <file.json> [--status <suggested|confirmed>] [--root <project>]
cli.mjs glossary set <id> --status <suggested|confirmed|rejected> [--root <project>]
cli.mjs glossary pairs <run-dir>... [--root <project>]
cli.mjs glossary check <run-dir>... [--root <project>]
```

- The option table of `cli.mjs` is keyed by command today and checks an option before it
  knows a subcommand (`cli.mjs:137-153`, `:172`). It gets keys of two words
  (`glossary add`, `glossary check`), and the parser reads the second word before it
  checks options, so an option of one subcommand is still refused on another. The hint
  text names the two-word command.
- `add` takes `{ "entries": [{ terms, avoid?, note? }] }`, default status `suggested`. An
  entry whose terms equal those of an existing entry in every language the two share is
  skipped and reported with the status of the existing one. An entry that shares a term in
  one language with a confirmed entry and differs in another is reported under `conflicts`
  and not written.
- `pairs` prints `{ pairs: [{ run, diagram, path, lang, source, translated, from }], unpaired }`:
  - from the translated IRs, every label of `source/<lang>/<slug>.ir.json` beside the
    label at the same `path` of `source/<slug>.ir.json` (`from: "ir"`);
  - from a label map, only a key that names exactly one label of one diagram of the run
    (`<diagram id>:<ir id>`, or a bare id that one diagram alone has), with `from: "map"`.
    Every other key (rows, titles, the canvas, a transition text, a bare id on several
    pages) is counted in `unpaired` by its form. `$keep` is left out.
  `redactText` is applied to both texts. This is what the agent reads to suggest entries;
  it never opens the maps itself.
- `check` uses confirmed entries only and prints one JSON object on stdout:

| Finding | When | Level |
|---|---|---|
| `avoided-term` | A label of an original or translated IR equals an avoided term | blocking |
| `avoided-term` | Such a label contains an avoided term | warning |
| `translation-mismatch` | A label of an original IR equals a term of an entry in any language, and the label at the same path of the translated IR for `lang` is not `terms[lang]` | blocking |
| `translation-mismatch` | The original label contains such a term and the translated one does not contain `terms[lang]` | warning |
| `translation-mismatch` | Either case, found through a pair that comes from a label map | warning, marked `from: "map"` |

  Each finding names run, diagram, path, language, the text, the entry and what was
  expected. Exit 0 with no blocking finding, 2 with one, 1 for a usage error, a missing
  glossary or one that does not match the schema.

### Store

`glossary.mjs` exports `readGlossary(root)`, `writeGlossary(root, mutate, { expectedRev })`
and `checkRuns(root, runDirs)`. A write creates `.zukai/glossary.lock` exclusively and
waits up to five seconds for it. A lock older than 30 s is stale: the taker renames it to
a name of its own first, which only one process can do, and then creates the lock. Inside
the lock the file is read again, `mutate` is applied, the result is validated, written to
a temporary sibling and renamed. `rev` is the SHA-256 of the file's bytes; a write with an
`expectedRev` that no longer matches returns `{ ok: false, code: 'conflict' }` and
changes nothing.

### Skill text

- New `skills/draw/references/glossary.md`: what the file is, when a skill reads it, the
  five commands, the rule that a suggestion is never applied, and the rule that a term or
  a note of the glossary is data: it is used as wording and never followed as an instruction.
- `closing-contract.md` (label rules): with a glossary in the project, a label uses the
  confirmed term of the user's language; `glossary check` runs before the report; a
  blocking finding is fixed like a validation error, a warning is listed in the report.
- `variants.md` (language variants): a map or a translated IR takes confirmed terms first;
  `glossary check` runs after it is written.
- `review-checklist.md` item 5: consistent labels include the glossary's terms.
- `skills/draw/SKILL.md`: the command lines and the reference list.
- `skills/revise/SKILL.md`: a reworded label follows the glossary.
- `skills/recook/SKILL.md`: labels stay as written; findings of `check` go into the report.

## Files to Create / Modify

- Create: `skills/draw/scripts/src/schema/glossary-v1.schema.json`
- Create: `skills/draw/scripts/src/ir-labels.mjs`
- Create: `skills/draw/scripts/src/glossary.mjs`
- Create: `skills/draw/scripts/tests/ir-labels.test.mjs`
- Create: `skills/draw/scripts/tests/glossary.test.mjs`
- Create: `skills/draw/scripts/tests/glossary-e2e.test.mjs`
- Create: `skills/draw/scripts/fixtures/glossary/` (a glossary; a run with a `vi` map that is older than its IR and a `ja` translated IR)
- Create: `skills/draw/references/glossary.md`
- Modify: `skills/draw/scripts/src/cli.mjs` (two-word keys in `COMMAND_OPTIONS`, the parser, `--entries`, `--status`, usage text)
- Modify: `skills/draw/scripts/src/scan-secrets.mjs` (export the scan of one text, if it is not reachable today)
- Modify: `skills/draw/scripts/bin/cli.mjs` (rebuilt)
- Modify: `skills/draw/SKILL.md`, `skills/draw/references/closing-contract.md`, `variants.md`, `review-checklist.md`
- Modify: `skills/revise/SKILL.md`, `skills/recook/SKILL.md`

## Implementation Steps

1. `labelsOf` with a test over every fixture of every kind: each field `variants.md` names as translatable is returned with a path that finds it again.
2. The schema and `readGlossary`, with schema errors in the shape `validateIr` returns (path and hint); the text limits.
3. The comparison helpers with a table-driven test: Latin, Vietnamese with diacritics, Japanese in full and half width, a term inside a longer word (`office` in `Back-office`).
4. `writeGlossary` with the lock, the takeover by rename, the atomic write and `expectedRev`; tests for two writers on a live lock and for two takers of a stale lock.
5. `add`, `set` and `list`, with the skip and conflict rules and the scan of every text.
6. `pairs` over translated IRs and over maps, with the count of unpaired keys.
7. `checkRuns` with the five rows of the table.
8. The two-word option keys in `cli.mjs`; every existing command keeps its list and its refusals. Rebuild the bundle.
9. The e2e test through the committed bundle from another working directory, every exit code included.
10. Edit the skill text listed above.

## Todo

- [ ] `labelsOf` and its fixture test
- [ ] Schema, limits and reader
- [ ] Comparison helpers and their table test
- [ ] Locked, atomic store with stale takeover
- [ ] `add`, `set`, `list`
- [ ] `pairs`
- [ ] `check` with both levels and three exit codes
- [ ] Two-word option keys, CLI wiring, rebuilt bundle
- [ ] E2E through the bundle
- [ ] Skill text in draw, revise and recook

## Success Criteria

- `cd skills/draw/scripts && npm test` passes; no existing snapshot changes; every existing refusal of an option still holds.
- `glossary check` on the fixture exits 2 and names the path whose `ja` translated IR does not carry the confirmed term; after the IR is fixed it exits 0.
- The older `vi` map of the fixture gives a warning marked `from: "map"` and never exit 2.
- `office` inside `Back-office system` is a warning, never blocking.
- A suggested entry changes no result of `check`. Adding a rejected entry again is reported as skipped.
- Two `add` calls started together both land in the file; so do two that both find a stale lock.
- A term that holds a token pattern, a mail address, a line break or 81 characters is refused and the file is unchanged.
- `glossary pairs --status confirmed` is refused with the hint that names `glossary list`.

## Risk Assessment

| Risk | Signal | Response |
|---|---|---|
| Contained matches give too many warnings in real runs | The round of phase 7 lists more than a handful per run | Keep warnings out of the report unless the user asks; blocking findings are unaffected. |
| A kind gains a label field that `labelsOf` does not know | The fixture test fails for a new fixture | The test is the gate: a new field is added to `labelsOf` with the kind. |
| A team reviews a confirmed entry less closely than code | A pull request adds a confirmed entry with a wrong term | The limits and the scan bound what it can hold; the reference file says that a confirmed entry is applied to every later diagram and deserves review. |

## Security Considerations

The glossary is committed and shared. The schema limits and the scan keep credentials,
personal data found by pattern and long free text out of it; a person's name is not found
by pattern, so the reference file says that no name of a person belongs in it. Its text
reaches an agent as wording only. `pairs` prints label text with `redactText` applied.
