# Target: Mermaid

Emits Mermaid text for every v1 kind: `flowchart`, `sequenceDiagram`, `stateDiagram-v2`,
`erDiagram`, `classDiagram` and `architecture-beta`, with a YAML front matter title.

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
- sequence participants of kind `database`, `boundary`, `control`, `entity` are written as
  Mermaid participant types (`participant id@{ "type" : "database" } as Label`, Mermaid 11.x
  or newer). With `--mermaid-stable`, and in the figjam profile, they are plain participants.
- composite states nested deeper than two levels are flattened into their parent.
- activity diagrams have no Mermaid equivalent. The default output is `swimlane-beta` (beta
  syntax; needs Mermaid 11.16 or newer and the rendering of fork and join bars is not
  verified). With `--mermaid-stable` the output is a plain `flowchart` whose subgraphs stand
  in for lanes and whose fork and join are labelled bars; the warning says which form was
  used and what it loses. Offer `--to drawio` for a real swimlane diagram.

## Combined file for a run

```bash
node "<skill-dir>/scripts/bin/cli.mjs" bundle --to mermaid --out ./diagrams/<yyyymmdd>_<run-slug>/<run-slug>.md --title "<feature>" ./diagrams/<yyyymmdd>_<run-slug>/source/*.ir.json
```

Writes every diagram of the run into one file (one heading and one fenced `mermaid` block per diagram, with a `Source:` line pointing at its IR), in the order given: main diagram
first. Every IR is validated before anything is written; errors and warnings carry the
`diagram` id they belong to. Individual files in `mermaid/` stay the reusable copies.

Inside the bundle a step with `ref` shows the referenced diagram's title (`↳ <title>`), the
same text as the draw.io bundle, so the two files read alike. Mermaid gets no link: Markdown
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
node "<skill-dir>/scripts/bin/cli.mjs" preview ./diagrams/order-checkout.mmd
```

Renders the text with Mermaid 12.3 in a local Chromium through Playwright into a PNG in the
system temp directory (the text is rendered locally; only the Mermaid library is fetched).
The image is for your own inspection, not for the user; do not mention or offer it. Exit 1
with a hint when Playwright is not installed; the step is optional. Look at the PNG as
described in `SKILL.md` before reporting.

## Where the output goes and how to paste it

Write next to the IR with the `.mmd` extension unless the user named a path, and also print
the text in a fenced `mermaid` block so the user can paste it into Markdown, a wiki page, a
GitHub or GitLab comment, or https://mermaid.live. The front matter (`---` / `title:` /
`---`) is part of the diagram and is accepted by every Mermaid renderer from version 10.

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
kinds render on Mermaid 10 as well. If a user's renderer is older, pass `--mermaid-stable`
or offer `--to drawio`.

Class members use Mermaid's own notation, type first (`+int Quantity`, `+find() Order`),
while draw.io writes UML order (`+Quantity: int`, `+find(): Order`). Both come from the same
IR fields; the difference is the renderer's convention, not the model.
