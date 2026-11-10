# Target: Mermaid

Emits Mermaid text for every v1 kind: `flowchart`, `sequenceDiagram`, `stateDiagram-v2`,
`erDiagram`, `classDiagram` and `architecture-beta`, with a YAML front matter title
(`swimlane-beta`, the form of an activity diagram, is the one exception: see below).

## Run

`<skill-dir>` is the directory that contains the `SKILL.md` you loaded. The working
directory is the user's project, so pass absolute paths.

```bash
node "<skill-dir>/scripts/bin/cli.mjs" emit --to mermaid ./diagrams/order-checkout.ir.json --out ./diagrams/order-checkout.mmd
```

Without `--out` the Mermaid text goes to stdout. Either way:

- Exit 0: success. Warnings, if any, are one JSON object on stderr: `{"warnings":[...]}`.
- Exit 2: validation or feature-matrix errors as JSON on stderr. Fix the IR at the listed
  paths and run again. Never edit the Mermaid text to work around an error.
- Exit 1: the input could not be read or the output could not be written.

## Warnings

Each warning has a `stage` (`feature-matrix`, `secret-scan`, `emit`), a JSON-pointer `path`
into the IR and a `message` that names the element and what changed. Print every warning to
the user verbatim, as a bulleted list, before showing the diagram. Never drop one, never
summarise several into "some features were degraded".

Expected degradations on Mermaid (full list in `docs/feature-matrix.md`):

- architecture connection labels are dropped (`architecture-beta` has no edge labels), and
  `queue` and `cache` components use the server icon. Sides are placement constraints in
  `architecture-beta` (`a:R --> L:b` puts b right of a on the same row), so the emitter first
  places the components on a grid and derives every side pair from it. A graph the grid
  cannot hold (a triangle or any diagonal relation, a line that would run through another
  component, a boundary whose box would contain an outsider) is emitted as a `flowchart` with
  boundaries as subgraphs instead, with a `layout:` warning that names the reason; the
  flowchart keeps the connection labels, draws two-way connections as `<-->`, shows every
  component kind as a shape, and carries none of the architecture-beta matrix warnings.
  `--to drawio` draws every architecture faithfully.
- AWS icons and group frames (`icon`, `group`) are not drawn in either form: each component
  gets the icon or shape of its `kind`, each frame is a plain group, and one warning per
  field says so. Use `--to drawio` for an AWS architecture diagram.
- sequence participants of kind `database`, `boundary`, `control`, `entity` are written as
  Mermaid participant types (`participant id@{ "type" : "database" } as Label`, Mermaid 11.x
  or newer). With `--mermaid-stable`, and in the figjam profile, they are plain participants.
- composite states nested deeper than two levels are flattened into their parent.
- activity diagrams have no Mermaid equivalent. The default output is `swimlane-beta` (beta
  syntax; needs Mermaid 11.16 or newer and the rendering of fork and join bars is not
  verified). With `--mermaid-stable` the output is a plain `flowchart` whose subgraphs stand
  in for lanes; the warning says which form was used and what it loses. Its control nodes
  carry no text, so nothing in the picture is in another language than the diagram: initial
  is a filled circle, final a double circle with a ring, fork and join are filled boxes
  across the flow (upright in a left-to-right diagram). They are classic shapes with a label
  of blanks, painted by `style` lines at the end of the text. A classic node takes its size
  from its label, so a bar is as thick as a line of text, not thin, and Mermaid 12 draws the
  upright bar of a left-to-right diagram as a block, because it gives every box a minimum
  width. Offer `--to drawio` for a real swimlane diagram with thin bars.
- the `swimlane-beta` text carries no title. Mermaid draws a front-matter title where
  `swimlane-beta` puts its lane header row, so the title would sit on top of the lane names
  (and, with lanes as rows, inside the first lane). A single emit warns at `/title`; the
  combined file shows the title as the heading above the block, so `bundle` does not warn,
  and the `--mermaid-stable` flowchart form keeps it. A picture without a title is therefore expected for this form, not a defect
  of the IR.
- `direction` is written for an `erDiagram` as it is for state and class diagrams. With
  `--mermaid-stable`, and in the figjam profile, the line is left out because older parsers
  may reject it; the diagram is then laid out top to bottom and, unless the IR asked for
  `TB`, the emit warns at `/direction`.

## Combined file for a run

```bash
node "<skill-dir>/scripts/bin/cli.mjs" bundle --to mermaid --out ./diagrams/<yyyymmdd>_<run-slug>/<run-slug>.md --title "<feature>" ./diagrams/<yyyymmdd>_<run-slug>/source/*.ir.json
```

Writes every diagram of the run into one file (one heading and one fenced `mermaid` block per diagram, with a `Source:` line pointing at its IR), in the order given: main diagram
first. Every IR is validated before anything is written; errors and warnings carry the
`diagram` id they belong to. Individual files in `mermaid/` stay the reusable copies.

Inside the bundle an element with `ref` (a node, an action, a message, a state, a component,
a class or an entity) shows the referenced diagram's title (`↳ <title>`) on a second label
line, the same text as the draw.io bundle, so the two files read alike; an
`architecture-beta` label has no line break, so there the title follows on the same line. Mermaid gets no link: Markdown
renderers such as GitHub strip `click` directives, and the sub-diagram is the next heading
in the same file anyway. A `ref` the bundle does not hold keeps the slug and the CLI warns.
A single `emit` always shows the slug. `--canvas` is refused for this target: the document
already holds every diagram in order, which is what a canvas gives draw.io.

## Language variant

Mermaid has no layout to preserve, so a translated diagram is a translated IR: copy it to
`source/<slug>.<lang>.ir.json`, set `meta.lang`, translate the labels, and emit again. See
`variants.md`.

## Preview

```bash
node "<skill-dir>/scripts/bin/cli.mjs" preview ./diagrams/order-checkout.mmd --max-px 1600
```

`--max-px <n>` caps the longest side and tiles a very tall or wide diagram, as for draw.io
(see `target-drawio.md`); the JSON lists every file under `files`.

Renders the text with Mermaid 12.3 in a local Chromium through Playwright into a PNG in the
system temp directory (the text is rendered locally; only the Mermaid library is fetched).
The image is for your own inspection, not for the user; do not mention or offer it. Exit 1
with a hint when Playwright is not installed; the step is optional. Look at the PNG as
described in `SKILL.md` before reporting.

## Where the output goes and how to paste it

Write next to the IR with the `.mmd` extension unless the user named a path, and also print
the text in a fenced `mermaid` block so the user can paste it into Markdown, a wiki page, a
GitHub or GitLab comment, or https://mermaid.live. The front matter (`---` / `title:` /
`---`) is part of the diagram and is accepted by every Mermaid renderer from version 10;
a `swimlane-beta` text has none, so say the title in the line above its block.

## What the text contains

- Ids are generated (`n1`, `n2`, in input order). The IR id of each element sits on the
  line before it as a `%% id: <ir-id>` comment, so a reader can map the text back to the
  IR. Reserved words and arrow-like characters in IR ids therefore never break the syntax.
- Labels are quoted and entity-encoded (`#quot;`, `#lt;`, `#37;`, `<br/>` for line breaks).
  Do not "clean up" the encoding by hand; renderers decode it.
- Output is deterministic: the same IR gives byte-identical text, so files diff cleanly.

## Mermaid version

The text targets Mermaid 12 (the test suite parses every output with Mermaid 12.3).
`architecture-beta` and typed sequence participants need Mermaid 11 or newer; the other
kinds render on Mermaid 10 as well. The `direction` line of an `erDiagram` is read by
Mermaid 12.3; Mermaid's documentation does not say which version introduced it, so treat it
as needing a current renderer. If a user's renderer is older, pass `--mermaid-stable` or
offer `--to drawio`.

Class members use Mermaid's own notation, type first (`+int Quantity`, `+find() Order`),
while draw.io writes UML order (`+Quantity: int`, `+find(): Order`). Both come from the same
IR fields; the difference is the renderer's convention, not the model.
