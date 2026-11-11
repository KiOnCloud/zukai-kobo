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

The table is written for the kinds that show a flow (`flowchart`, `activity`, `sequence`,
`state`). The other three kinds are made of the very names the table removes, so each has a
rule of its own:

| Kind | Business view |
|---|---|
| `architecture` | The same deployed picture read as "which systems take part and who runs them". Keep every system the reader knows by name, product names included ("Amazon SQS" is a name a client reads on an invoice), and keep the AWS icons: the checklist's rule that a label names its icon's service still holds. Remove what only an operator needs: instance sizes, table counts, replica settings, subnets and availability zones (keep the account or region frame when it says who owns or where the data lives). Replace a protocol on a connection with what the connection is for ("gửi sự kiện tích điểm" for "SQS SendMessage", still no endpoint or field). A component that has no name the reader knows and that the reader cannot tell apart from its neighbour (an unnamed internal queue between two services) is merged into the connection it serves; one that carries a product name stays. A `detail accepted:` choice of the technical view holds for the business view too: copy the note. |
| `er` | A glossary of the business objects and how many of each belong together. Keep the entities the reader has a word for, named with that word ("Đơn hàng", not `orders`), their relations and cardinalities, and the attributes that carry a rule or that the reader would ask for (status, amount, expiry date). Remove surrogate keys, foreign-key columns, audit columns, column types that say nothing to the reader (write `text`, `number`, `date`), and tables that only join two others (the relation becomes many-to-many). |
| `class` | Rarely worth a business view: when the classes are domain concepts, draw them as the `er` glossary above; when they are technical structure (services, handlers, DTOs), there is no business reading, so say that in one line and deliver the technical view alone, even under `both`. |

With `both` and a run of several kinds, apply the rule of each kind; a diagram that has no
business view by the table above is listed in the report as "technical only", with the reason.

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

The audience comes from the opening question of `SKILL.md` ("Which view?": `technical`,
`business`, `both`), from `--audience`, or from a request that states the reader; the
suggestion is `business` when the request mentions a non-technical reader. For `both`, make
the technical IR first, derive the business IR from it as `source/<slug>-business.ir.json`,
and validate, emit, bundle and review the two together in one run; the report lists them as
two views of the same subject.

`both` in a run with parts (`detailed`):

- every part gets a business view too, `<slug>-NN-<part>-business`, unless the part has
  none by the kind table above;
- a `ref` in a business diagram names the business part (`ref: "<slug>-NN-<part>-business"`),
  so a business reader never lands on a technical page; when that part has no business
  view, the business diagram drops the `ref` and keeps the step as one plain step;
- the two views of one subject carry different titles, or the combined file has two pages
  and two canvas headings that read the same: the business title says which view it is, in
  the user's language ("Duyệt hoàn tiền (nghiệp vụ)").

`both` doubles the number of diagrams, so `SKILL.md` has the count said before the IRs are
written and suggests one view when the request holds no technical names.

## Language variant of an existing run

For draw.io (the layout is preserved):

```bash
node "<skill-dir>/scripts/bin/cli.mjs" relabel <run-folder>/<run-slug>.drawio --map <run-folder>/source/labels.<lang>.json --out <run-folder>/<run-slug>.<lang>.drawio
```

Write the map from the IR: one key per element id whose label changes, `<diagram id>:title`
for each page title, and `<diagram id>:<ir id>` to address one page of a bundle (the same
key also covers that diagram's copy on the canvas page). The diagram id in a key is the IR
file name without `.ir.json`, in lower case, whatever its length; it is what `drift` prints
as `diagram`. In a run with business views always use the `<diagram id>:` form: a bare
`<ir id>` renames that id on every page, and a technical diagram and its business view
share their ids. The keys of the things that are not plain elements:

- a label on a line (a flowchart edge, a connection, a message, an activity guard): the id
  of that edge, connection, message or flow;
- a state transition: its id, with the whole text as it is drawn, `event [guard] / action`;
- the canvas page of a bundle: `canvas:title`;
- an attribute row of an ER entity or a member row of a class: `<entity id>:row-<n>`, with
  `n` counted from 0 in the order of the IR (the whole row text is replaced, key mark and
  type included). The CLI keeps a leading
`«stereotype»` line and a bold title; the `↳ <sub-diagram>` line of an element with `ref` takes
the target page's new title when the map renames it, so translate every page title. Cells
the author copied by hand in draw.io have generated ids and cannot be found by key: the CLI
gives them the translation of any replaced cell with the same source text (`byText` in the
result; the same text on another page is replaced that way too, so the count is not only
hand-copied cells) and lists every labelled text that is still untouched, once per distinct
text with the places it occurs, in `untouched` on stdout. On stderr they are one warning
line that gives the count and the first few texts: a map that rewords two labels would
otherwise print a warning for every other label of the file. Labels without a
letter (`2`, `0, 1, 3`) are never listed. Texts that stay the same in every language (a
product name as a lane, a code word such as `get`) go once into the map's `"$keep"` list,
which applies to every page and copy; a complete map plus `$keep` leaves `untouched` empty.
Show every warning verbatim: `layout:` warnings name the boxes whose new text wraps to more
lines than the box's height holds (and than the old text took), has an unbreakable word
wider than the box, or exceeds a non-wrapping box, measured by the glyph widths of
draw.io's 12 px font and wrapped where draw.io wraps; a cell and its canvas
copy give one warning naming both pages. The fix is a shorter label, or a re-emit from a
translated IR when the user prefers resized shapes over a preserved layout. A name
below a figure (an AWS icon, a client) is the one label `relabel` gives more room: the figure
does not hold it, so its wrap width grows until the new name takes no more lines than the old one,
as far as the frame around the figure and the figures beside it leave room (never across a
frame line, at most 200 px). A name that is still reported after that is longer than that
room and wraps, which can put its second line beside a connection that leaves the icon
downwards: when more than half of the icon names of a page are reported, say so and
offer the translated IR for that diagram instead of delivering the relabelled page.

`relabel` writes into each page it changed the labels the page was laid out for (a
`zukaiLabels` property of the page, which draw.io keeps on save). `drift` reads it, so a
relabelled file is not reported as moved by hand.

A language variant covers the combined file. The single files under `drawio/` stay in the
source language unless the user asks for them too (the same map works, one file at a time;
keys for other pages come back as `unmatched`). Review the variant by previewing the
combined `<run-slug>.<lang>.drawio`; set nothing in the IRs, which stay the source of the
original language. Keys that
matched nothing are listed in `unmatched`; they usually mean a typo in the id.

```json
{ "$keep": ["API", "get"], "login:title": "ログイン", "login:a-submit": "送信する" }
```

For Mermaid: copy each IR to `source/<slug>.<lang>.ir.json`, translate the labels, set
`meta.lang`, validate, emit and bundle as in the closing contract (`references/closing-contract.md`). The relabel map and the
translated IR go through the same review as any diagram: wording items apply, layout items
apply to the draw.io result after `relabel`.
