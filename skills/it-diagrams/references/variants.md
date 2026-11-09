# Variants of a run: audience and language

One flow often needs more than one picture: a technical view for developers, a business
view for a non-technical reader, and sometimes the same view in another language. This file
records how the skill produces them so the variants do not drift apart.

## Decision

- **Audience is a property of the IR** (`meta.audience`: `technical`, the default, or
  `business`), one IR file per audience. A business view is a different diagram of the same
  subject, not a filtered copy, so the model derives it with the rules below and the review
  checks it against them. Per-node technical flags or per-audience labels inside one IR
  were considered and rejected: they would double the size of every IR and still leave the
  structural changes (dropped steps, merged branches) impossible to express.
- **Language is handled on the output**, not in the IR. For draw.io, `relabel` applies a
  label map to an emitted file and keeps every id and geometry, so manual edits survive and
  the layout stays identical; boxes are not resized, so each label that no longer fits is
  reported as a `layout:` warning. For Mermaid there is no layout to keep: translate a copy
  of the IR (set `meta.lang`) and emit again. Label catalogues keyed by node id inside the IR
  were rejected: one IR per language would be needed anyway for the Mermaid path, and the
  draw.io path must not re-emit, or hand edits are lost.

## Business view: what goes, what stays

Derive the business IR from the technical one (same kind, same scope, same subject, file
`source/<slug>-business.ir.json`, `meta.audience: "business"`), then apply these rules:

| Remove | Keep |
|---|---|
| Class, method, function, table, column, queue, endpoint and configuration names; replace with what the thing does for the reader ("the order record", not `OrderEntity`) | Every business condition with its value: time windows, lookback days, thresholds, limits, counts, cut-off times, roles that may act |
| Steps that exist only for the implementation: queueing, logging, caching, input sanitising, retries, serialisation, mapping between layers | Every outcome the reader can observe: an approval, a rejection, a notification, a wait, a stored result |
| Words that hide a rule ("safe", "valid", "eligible") with no condition next to them | The actors and systems the reader knows by name (the shop, the warehouse, the bank) |
| Technical branches whose outcomes the reader cannot distinguish (merge them into one step) | Branches whose outcomes differ for the reader, even when the code treats them alike |

A business diagram is not "the technical one with fewer nodes": a reviewer who removed the
lookback window and the thresholds produced a view the reader rejected as too simple. When
in doubt, keep the condition and reword it. The other failure is as real: a review that
asked for every dropped technical branch back turned a business view into the technical
diagram again. The checklist therefore separates a business rule (a value the reader would
check) from a defensive path (invalid input, log-only failure, retry), ranks findings as
`wrong`, `missing-rule` or `polish` with only the first two blocking `PASS`, and allows a
rule-bearing action up to four lines.

Record every deliberate omission in `meta.omitted`, one entry each with a short reason
("No retry branch: the reader only needs the outcome", "Input validation: technical"). The
reviewer never asks for an entry of that list back, whatever the audience, and the closing
report and the Markdown bundle show the list under the diagram so the reader knows what the
picture does not cover. When the user asks to drop something during the review loop, add
it to `meta.omitted` instead of arguing with the next review round.

The audience comes from the opening question of `SKILL.md` ("Who will read it?":
`technical`, `business`, `both`), from `--audience`, or from a request that states the
reader; the suggestion is `business` when the request mentions a non-technical reader. For
`both`, make the technical IR first, derive the business IR from it as
`source/<slug>-business.ir.json`, and validate, emit, bundle and review the two together in
one run; the report lists them as two views of the same subject.

## Language variant of an existing run

For draw.io (the layout is preserved):

```bash
node "<skill-dir>/scripts/bin/cli.mjs" relabel <run-folder>/<run-slug>.drawio --map <run-folder>/source/labels.<lang>.json --out <run-folder>/<run-slug>.<lang>.drawio
```

Write the map from the IR: one key per element id whose label changes, `<diagram id>:title`
for each page title, and `<diagram id>:<ir id>` to address one page of a bundle (the same
key also covers that diagram's copy on the canvas page). The CLI keeps a leading
`«stereotype»` line and a bold title; the `↳ <sub-diagram>` line of a step with `ref` takes
the target page's new title when the map renames it, so translate every page title. Cells
the author copied by hand in draw.io have generated ids and cannot be found by key: the CLI
gives them the translation of any replaced cell with the same source text (`byText` in the
result) and lists every labelled text that is still untouched, once per distinct text with
the places it occurs, in `untouched` and as one warning line per text. Labels without a
letter (`2`, `0, 1, 3`) are never listed. Texts that stay the same in every language (a
product name as a lane, a code word such as `get`) go once into the map's `"$keep"` list,
which applies to every page and copy; a complete map plus `$keep` leaves `untouched` empty.
Show every warning verbatim: `layout:` warnings name the boxes whose new text wraps to more
lines than the box's height holds (and than the old text took), has an unbreakable word
wider than the box, or exceeds a non-wrapping box, measured at 1.75 Latin widths per CJK
character, which matches draw.io's 12 px font within a few percent; a cell and its canvas
copy give one warning naming both pages. The fix is a shorter label, or a re-emit from a
translated IR when the user prefers resized shapes over a preserved layout. Keys that
matched nothing are listed in `unmatched`; they usually mean a typo in the id.

```json
{ "$keep": ["API", "get"], "login:title": "ログイン", "login:a-submit": "送信する" }
```

For Mermaid: copy each IR to `source/<slug>.<lang>.ir.json`, translate the labels, set
`meta.lang`, validate, emit and bundle as in the closing contract. The relabel map and the
translated IR go through the same review as any diagram: wording items apply, layout items
apply to the draw.io result after `relabel`.
