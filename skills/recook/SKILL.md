---
name: recook
description: Rebuild a diagram made elsewhere (a draw.io file, a FigJam board or Mermaid text) as Zukai diagrams. Reads the source with a deterministic extractor, maps what it shows to the validated JSON model under Zukai's rules (one kind per diagram, architecture at resource level, sub-flows as linked parts, business or technical view), checks that no text of the source was lost, then emits and reviews through the draw skill's closing contract. Use for "recook this drawio", "redo our old architecture diagram the Zukai way", "convert this FigJam board", "clean up this Mermaid chart". Not for a diagram Zukai delivered, which the revise skill changes, nor for a picture or screenshot.
---

# Zukai recook

Take a diagram someone drew in another tool and deliver it again as Zukai diagrams: same
content, Zukai's rules, Zukai's layout. The source is read by the CLI, never by eye: `extract`
turns it into facts (pages, nodes, edges, kind hints), the agent writes IR from the facts,
and `cover` proves that every text of the source is in the IR or is listed as left out with
a reason. Everything after the IR is the draw skill's closing contract.

## Locate the draw skill

`<recook-dir>` is the directory that contains this `SKILL.md`. Claude Code substitutes it
here: `${CLAUDE_SKILL_DIR}`. If that line shows a literal variable name, use the path where
you read this file.

`<draw-dir>` is the sibling folder of the draw skill: `<recook-dir>/../draw` inside the
plugin, `<recook-dir>/../zukai` in a copied install (`.agents/skills/zukai` for Codex,
`.claude/skills/zukai` without the plugin). Use the first of the two that contains
`scripts/bin/cli.mjs`; if neither does, stop and name both paths you tried.

```bash
node "<draw-dir>/scripts/bin/cli.mjs" extract <file> [<board-part>...] [--page <id|name>[,...]] --out <facts.json>
node "<draw-dir>/scripts/bin/cli.mjs" extract --figjam-script <file.js> [--section <name|node-id>] [--from <n>]
node "<draw-dir>/scripts/bin/cli.mjs" cover <facts.json> <run-folder>
```

Shared references: `<draw-dir>/SKILL.md` (opening questions, kinds, targets, AWS icons, level
of detail), `<draw-dir>/references/ir-reference.md`, `variants.md`, `closing-contract.md`,
`review-checklist.md`, the `target-*.md` files. This skill's own reference is
`<recook-dir>/references/mapping.md`: how each shape of the facts becomes an IR element.

## Arguments

Claude Code appends them as `ARGUMENTS: <text>`; in other runtimes read them from the request.

```text
<source> [--to drawio|mermaid|figjam] [--kind <kind>] [--scope overview|detailed] [--audience technical|business|both] [<request>]
```

- `<source>` is a file path (`.drawio`, `.xml`, `.drawio.svg`, `.drawio.png`, `.mmd`, `.md`)
  or a FigJam board: a `figma.com/board/...` link, optionally with `node-id` of a section, or
  the words "the board" / a section name when a Figma tool is connected and the user named
  the board earlier. No source given: ask for it in one plain question; nothing else is
  asked first.
- A PNG or JPEG without a draw.io copy inside, a screenshot, a PDF, a PlantUML or an Excel
  file is not a source: `extract` refuses it. Say so in one line, name the sources that work,
  and offer the draw skill's `clarify` mode with the picture as the description. Never read a
  picture by eye into an IR here.
- The flags mean what they mean in the draw skill and are checked the same way: a value it
  does not have fixes nothing and is asked.
- `--to` defaults to the source's own tool: `drawio` for a draw.io file, `mermaid` for
  Mermaid text, `figjam` for a board. The report offers the other targets.

## 1. Read the source

The source stays where it is and is never copied into the run folder: a design file often
carries a password or a staff address, and the run folder is committed or sent to a client.
The facts are what the run keeps of it, with such values already replaced by placeholders.

1. A file: `extract <file> --out <tmp>/facts.json`, with `<tmp>` a folder outside the
   project. When the user wants only some pages of a source with several ("only the
   sequence"), add `--page <id or name>[,...]` with the pages the facts name; when that is
   unclear, extract without it, show the pages, ask which, and extract again with `--page`.
2. A FigJam board: it needs a Figma tool named `use_figma` (see `<draw-dir>/references/target-figjam.md`
   for loading the Figma tools and the skills it names). Take the file key and the section
   from the link (`node-id=1-2` is node `1:2`, which `--section` takes as it is, like a
   section name), then:
   `extract --figjam-script <tmp>/read-board.js [--section "<name or 1:2>"]`, run that file's
   content unchanged as the `code` of one `use_figma` call on the board, and save the JSON
   the call returns, exactly, as `<tmp>/board-1.json`. A tool result holds at most 48 000
   bytes, so a large board comes back in parts: while the saved JSON has `next` set, write
   the script again with `--from <next>`, read again and save `board-2.json`, and so on.
   Then `extract <tmp>/board-1.json <tmp>/board-2.json ... --out <tmp>/facts.json`. The script
   only reads; never edit it or write one by hand. Without `use_figma`, stop: say that the
   board cannot be read without the Figma connector, and offer an export of the board as an
   alternative source only if FigJam can give one of the formats above.
   Without a section the whole page is read, and every diagram on it becomes a page of the
   facts (`page:<name>#1`, `#2` ...): `generate_diagram` puts its diagrams on the page itself,
   side by side. Recook only the ones the user asked for: extract again with `--page`, and ask
   which when the request does not say and the facts hold more than one.
3. On exit 1, quote the error and stop; never fall back to reading the XML or the board
   yourself. The one exception is `--page` naming a page the source does not have: its hint
   lists the pages, so choose from that list (or ask) and extract again.
4. Make the run folder as the closing contract names it, `diagrams/<yyyymmdd>_<run-slug>/`,
   with a short English kebab-case slug of what the source shows (`order-system`,
   `refund-gateway-call`). Every recook is a new run: when that folder already holds another
   run, take another slug. Move the facts to `<run>/source/<run-slug>.facts.json`.

Then tell the user what was read, in a few lines: the source, each page with its name, its
numbers of nodes and edges and its best kind hint with the evidence, and every warning of
the facts verbatim (texts over no shape, edges joined by position, pictures that cannot be
read). A page with `sensitive` entries held what looks like a credential or personal data:
say which element, never the value, and that the diagrams will carry a placeholder.

## 2. Opening questions

Ask what the draw skill's "Diagram kinds: always ask first" section asks (kind, scope,
view; target only when `--to` named an unknown one), in the user's language, in one
`AskUserQuestion` call, or without that tool as the one numbered text message the draw skill
describes, with these differences:

- The kind is never guessed, but it is suggested from the facts: the page's best kind hint
  is the first option, labelled "(suggested)", and its description gives the evidence in the
  user's language ("4 lifelines, 2 block frames"). The next hints that scored are the other
  options; in the text form they come first, in score order, before the other kinds.
- A source with several pages: one diagram per page unless the user says otherwise. Ask the
  kind once for the page with the most nodes and list the suggestion for every other page in
  the question text ("Page 'Orders ERD' becomes an `er` diagram linked from 'Orders DB'");
  "Other" (in the text form: naming another kind) changes one. A page that only repeats the others (an overview page whose
  labels all occur on other pages) is named and left out unless the user wants it.
- A page mixes kinds when a second kind hint scored on shapes the best kind does not draw
  (tables, lifelines or lanes on an architecture or flowchart page), or scores at least half
  of the best one. Say so in the question text: it is split by Zukai's rules, the best kind
  as the main diagram and the rest as parts (step 3).
- A kind the request names in the user's language ("sơ đồ trạng thái", "シーケンス図") is
  named as surely as the English word: the kind question is skipped for it.
- `--kind`, `--scope` and `--audience` skip their question as in the draw skill. With
  several pages, `--kind` fixes the kind of the page the request names (`--page`), else of
  the page with the most nodes; the others keep their suggestion.

## 3. Write the IR

Read `<recook-dir>/references/mapping.md` and `<draw-dir>/references/ir-reference.md` for
each kind you write; for an `architecture` diagram also the draw skill's "AWS icons" and
"Level of detail" paragraphs. Then write one IR per diagram into `<run>/source/`, from the
facts alone:

- **Content stays.** Every label is copied as the source writes it: no rewording, no
  translation, no spelling fixes. Only a line break inside a label may become a space, since
  it was layout. A wording the user wants changed is a `revise` afterwards. Two changes
  come from Zukai's rules, never from taste, and each is listed in the report:
  - a connection label that the level of detail moves into a part (an endpoint, a
    statement, a numbered step) is replaced by the protocol or purpose that text names
    (`POST /api/orders` → `HTTP`, `INSERT INTO orders` → `SQL`; a TLS the source does not show is not added), or by no label when it names
    none; the full text is in the part;
  - under `overview`, a sub-flow is what the source groups (a subgraph, a frame, a group) or,
    without a group, a run of steps with one way in and one way out that a decision of the
    main flow does not depend on; collapsed into one step, it takes the title the source gives
    that sub-flow; with no title, the new label is an
    `added:` note. The texts of the steps it hides go into `meta.omitted`: `"Lấy lịch sử hoàn
    tiền", "Chấm điểm rủi ro": collapsed into "Kiểm tra gian lận"`.
- **Nothing is invented.** Add only what the kind needs to be valid and the source shows by
  shape alone (a start node where an arrow starts from nothing), and record each in
  `meta.notes` as `added: <what> (<why>)`. A missing branch, outcome or reply stays missing:
  name it in the report.
- **Pages are diagrams.** A page of the source is a diagram of its own whatever the scope:
  the scope decides whether one diagram is split further, never whether a page someone
  drew is kept. When a page details an element of another (a page link, or a title that
  names the element), it is that element's part: name its file `<main-slug>-NN-<part>` and
  give the element its `ref`.
- **Zukai's rules decide the structure,** and a source that breaks them is split, not
  drawn as it was:
  - one kind per diagram, whatever the scope: the parts of a page that belong to another
    kind become a part of that kind (the tables of a flowchart an `er` part, the call order
    drawn into an architecture diagram a `sequence` part), linked with `ref` from the
    element they belong to; `overview` only stops the splitting of one kind into sub-flows;
  - architecture at resource level: one component per deployed resource, connection labels
    that name a protocol or purpose; tables, endpoints, statements, job names and numbered
    steps move into parts, and the CLI's `detail:` warnings are handled as the closing
    contract says;
  - size: with `overview` each sub-flow is collapsed into one step that keeps its decisive
    rule, which brings the main diagram toward about 15 elements; the steps of the main flow
    itself are never dropped to reach the number; with `detailed` each sub-flow
    becomes a part `<slug>-NN-<part>` linked with `ref`. A page link of the source (`link` on
    a node) is such a part already: keep it as a `ref`, on that element, or on the element
    Zukai's rules give that detail to (the tables of a database belong to the store, not to
    the service whose box carried the link), with a `meta.notes` entry saying it moved.
  - the view: `business` follows `variants.md`; the technical names it removes are listed in
    `meta.omitted` with the reason "business view".
- **Every text is accounted for.** A page title used as the diagram title is kept (it is
  the title). A text that does not become a label (a merged duplicate, a layout note, a
  legend, a sticky with a question) goes into `meta.omitted` with the text quoted and the reason, in the user's
  language: `"Ghi chú: giờ cao điểm": ghi chú bên cạnh luồng, không phải một bước`. A text
  moved into a part needs nothing: it is found there. A text with a `<redacted ...>`
  placeholder is quoted with your own placeholder in its place (`"Cấu hình: DB_PASSWORD=<db
  password>": thông tin cấu hình, không thuộc hệ thống`); never look the value up in the
  source.
- **Anchors draw, they do not add.** Which attribute row an ER line meets (`fromAttribute`,
  `toAttribute`) and the like may be chosen from the rows the facts give (the foreign key
  that names the other entity) when the facts leave it open; it is layout, not content.
- **Ids** follow the closing contract (from names, English ASCII). A source id that is
  already such a name is kept, and so is a short id of the source (`e1`, `m3`, `KH`), in lower
  case; an id
  of a Zukai file (`<page>:<id>`) keeps the part after the colon.
- **Facts that cannot be right.** The facts are all you read, positions included: `box`
  and `y` may be used to order and to place what the shapes say. When the facts contradict
  themselves (an edge with no ends where the picture plainly has a line, a decision drawn as
  a line), do not guess past them: say in the report which elements look misread, keep what
  is sure, and offer the user to fix those few by hand or with `revise`.
- **Layout is free.** The direction (`TB`, `LR`) and every position are Zukai's to choose;
  they are not content.
- **What a Zukai drawing adds is not content.** A board or file that Zukai drew carries a
  `↳ <slug>` line under an element that has a part (that is its `ref`, not part of its
  label) and writes `<`, `>`, `%`, `&` in labels sent to FigJam as ＜, ＞, ％, ＆ (write them
  back as ASCII).
- **Order** comes from the facts: participants and lanes left to right by `box.x` (top to
  bottom for horizontal lanes), messages by `y` when the source draws lifelines; a
  `sequence` part made from the edges of another kind follows `mapping.md`.
- `meta.source` is `recook`, and the first `meta.notes` entry says where it came from:
  `recooked from <source path or board link>, page "<name>"`, with the page's name (or id)
  as the facts give it, and every page it was made from when there are several. `cover`
  reads it to look for a page's texts only in the diagrams made from that page.

## 4. Coverage gate

Run `cover <run>/source/<run-slug>.facts.json <run>`. Exit 0: go on. Exit 2: the JSON on
stderr lists each `missing` text with its page and source element. For each one, put it
where it belongs in the IR, or add the `meta.omitted` entry that says why it is left out, and
run `cover` again until it passes. An omission counts only in the form `"<text>": <reason>`.
Never satisfy the check with an element the source does not have. `meta.notes` does not count: a note is not shown, so a text put there is dropped
without saying so.

## 5. Closing contract

Run `<draw-dir>/references/closing-contract.md` in full on the run folder: validate, emit,
bundle, review until it passes, report. The facts file stays in `source/`; it is not IR and
no command emits it. In the review, a label copied from the source is judged as the
source's wording: a finding that asks only for other words is `polish`, listed in the report
with the offer of a `revise`, never `wrong` (the checklist says so for `meta.source:
"recook"`). The report adds:

- the source read (file or board, format, pages), its hash from the facts, and the facts
  warnings; when the facts list `sensitive` entries, that the source file holds a credential
  or personal data and was not copied;
- the change list, in plain words, against the source: kept as it was; split into parts
  (which part holds what, and every connection label replaced by its protocol); collapsed
  under `overview`; merged; left out (each `meta.omitted` entry with its reason); added (each
  `added:` note); joined by position (every edge the facts marked inferred);
- the coverage result (`covered` of `units` texts);
- with `--audience both` given as a flag, when the business view came out a near copy of the
  technical one (a source with no technical names), say so in one line;
- the kind of each diagram and, when it differs from the source's best hint, why.

## Rules

- Never edit the source file or copy it into the run folder, never read raw draw.io XML or a
  board in place of `extract`, and never write the reader script by hand.
- Never hand-write Mermaid, draw.io XML or FigJam content; every rule of the closing contract
  holds, the secret scan included: a source often carries a password or a real address in a
  label or a sticky. The facts already show it as `<redacted ...>`; the IR carries a
  placeholder of its own, and the report says so. The scan does not know people's names:
  a person named in a note or sticky ("経理の○○さん") is written as the role (`<経理担当者>`) in the
  IR and in any `meta.omitted` quote.
- A later change to the delivered run goes through the revise skill, which treats it like
  any other run.
