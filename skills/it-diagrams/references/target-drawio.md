# Target: draw.io

Emits an uncompressed `.drawio` file (mxGraph XML) in which every node, container, edge and
edge label is an individually selectable, movable shape. No draw.io binary is needed: graph
shaped kinds are laid out by the bundled ELK engine, sequence diagrams by a fixed grid.

## Run

`<skill-dir>` is the directory that contains the `SKILL.md` you loaded. The working
directory is the user's project, so pass absolute paths.

```bash
node "<skill-dir>/scripts/bin/cli.mjs" emit --to drawio ./diagrams/order-checkout.ir.json --out ./diagrams/order-checkout.drawio
```

- Exit 0: the file was written. stdout holds `{"ok":true,"out":"<path>","warnings":N}`.
- Exit 2: validation or feature-matrix errors as JSON on stderr. Fix the IR, run again.
- Exit 1: the input could not be read or the output could not be written.

Warnings arrive as one JSON object on stderr (`{"warnings":[...]}`). Show every warning to
the user verbatim; never drop one. For draw.io every v1 feature is `supported`, so the
usual warnings come from the secret scan.

## Combined file for a run

```bash
node "<skill-dir>/scripts/bin/cli.mjs" bundle --to drawio --out ./diagrams/<yyyymmdd>_<run-slug>/<run-slug>.drawio --title "<feature>" ./diagrams/<yyyymmdd>_<run-slug>/source/*.ir.json
```

Writes every diagram of the run into one file (one named page per diagram, each page headed by its title), in the order given: main diagram
first. Every IR is validated before anything is written; errors and warnings carry the
`diagram` id they belong to. Individual files in `drawio/` stay the reusable copies.

Inside the bundle a step with `ref` shows the referenced diagram's title (`↳ <title>`) and
is a draw.io page link: clicking it opens that page. The diagram id a `ref` names is the IR
file name without `.ir.json`, so `ref: "login-01-mfa"` resolves when
`source/login-01-mfa.ir.json` is in the bundle. A `ref` the bundle does not hold keeps the
slug text, gets no link, and the CLI warns (`ref "<slug>" is not in this bundle`). A single
`emit` has no bundle to resolve against, so it always shows the slug, without a warning.

### Canvas page

```bash
node "<skill-dir>/scripts/bin/cli.mjs" bundle --to drawio --out <run-slug>.drawio --title "<feature>" --canvas all --gap 120 source/*.ir.json
node "<skill-dir>/scripts/bin/cli.mjs" bundle --to drawio --out <run-slug>.drawio --title "<feature>" --canvas login,login-01-mfa source/*.ir.json
```

`--canvas` adds a first page, named after `--title` (or `Canvas`), that holds the listed
diagrams side by side: left to right in the given order, top-aligned, `--gap` pixels apart
(default 120), each under its own title. `all` takes every diagram in bundle order; a
comma-separated list of diagram ids (IR file names without `.ir.json`) takes a subset, and an
unknown id is an error. The diagrams still get their own pages after the canvas, so page
links from `ref` steps keep working from both. Edges and lane children move with their
diagram; the output is deterministic, so re-running `bundle` reproduces the file. The option
is draw.io only: the Markdown bundle already shows every diagram in one document.

## Language variant with the layout kept

```bash
node "<skill-dir>/scripts/bin/cli.mjs" relabel <file.drawio> --map <labels.json> --out <file.<lang>.drawio>
```

Applies a JSON map of IR id (or `<diagram id>:<ir id>` for one page of a bundle, `title`
for the page title) to new label text. Ids and geometry are untouched, so manual edits and
the layout survive; a leading `«stereotype»` line and a bold title are kept, and the
`↳ <sub-diagram>` line of a `ref` step follows the target page's new title when the map
has `<target id>:title`. Hand-copied cells (generated ids) get the translation of a replaced
cell with the same source text; every labelled text still untouched is listed once with
the places it occurs, except labels without letters and texts named in the map's `$keep`
list. Boxes are not resized: a label that wraps to more lines than its box holds, has an
unbreakable word wider than its box, or overflows a non-wrapping box (CJK characters count
1.75 Latin widths) is one `layout:` warning per cell across pages, and keys that matched
nothing are listed. Compressed
input is accepted; the output is always uncompressed. The whole protocol, including the
business-audience variant, is in `variants.md`.

## Preview

```bash
node "<skill-dir>/scripts/bin/cli.mjs" preview ./diagrams/order-checkout.drawio --max-px 1600
```

Renders a PNG into the system temp directory and prints `{"ok":true,"preview":<path>,
"files":[...],"tiled":false,"scale":2,"renderer":...}`. `--max-px <n>` caps the longest side
at `n` pixels (both renderers; draw.io desktop re-exports at the fitting scale); a diagram
at least twice as tall as it is wide (or the reverse) that would shrink below scale 1 is
instead cut into tiles `<name>-1.png`, `<name>-2.png`, ... at scale 1, all listed in
`files`, so the reviewer opens each. The image is for your own inspection, not for the user; do not mention or
offer it. The renderer is draw.io desktop when its CLI is on `PATH` (offline), else
Playwright with Chromium loading draw.io's viewer page in a local browser (the XML is rendered
locally; only the page itself is fetched). Exit 1 with a hint when neither is installed; the
step is optional and `docs/install.md` says how to set a renderer up. Look at the PNG as
described in `SKILL.md` before reporting.

## Where the output goes and how to open it

Write next to the IR file with the `.drawio` extension unless the user names a path. The
file opens in draw.io desktop, in the VS Code draw.io extension, and at
https://app.diagrams.net (File > Open from > Device). Shapes stay editable after opening:
labels, styles and positions can be changed, and because the file is uncompressed the XML
is diffable in git.

Layout is automatic and deterministic: the same IR gives byte-identical output. If a wide
graph reads badly, flip `direction` in the IR (`TB` to `LR`) and emit again rather than
moving shapes by hand, so the IR stays the source of truth.

## What the emitter produces

| IR element | draw.io shape |
|---|---|
| flowchart `process` / `terminal` / `decision` / `io` / `subroutine` / `note` | rectangle / rounded rectangle / rhombus / parallelogram / process (double bar) / note |
| flowchart `group`, architecture `boundary`, composite `state` | `swimlane` container; children are positioned relative to it |
| state `initial` / `final` | UML start and end state circles |
| self-transition or self-edge (`from` = `to`) | a loop out of the right side of the shape (30 px) and back in, with the label right of the loop; the layout reserves that room next to the shape, inside composites too |
| ER entity, class | `swimlane` table with one child row per attribute or member (stack layout); a member wider than the table wraps and its row grows, so nothing is clipped |
| ER relation | laid out twice: the first pass decides for each end the side and the row (the FK named by `fromAttribute` / `toAttribute`, else the one FK whose name contains the other entity, for a self-relation the one FK that names no other entity, else the header band, which grows 20 px per extra anchor); the second pass gives ELK those anchors as fixed ports, so its routing and crossing avoidance hold in the file; a self-relation loops on the side with fewer ports |
| graph edge (flowchart, state, ER, class, architecture) | written with ELK's waypoints and with fixed exit and entry anchors taken from ELK's end points, so draw.io never re-routes an edge at render time; a label beside a vertical segment (self-loops included) is anchored on the line and left- or right-aligned at a 4 px gap, a label at a horizontal segment sits 4 px above or below it |
| ER relation | orthogonal edge with crow's-foot ends (`ERmandOne`, `ERzeroToOne`, `ERzeroToMany`, `ERoneToMany`); non-identifying relations are dashed |
| class relation | orthogonal edge: hollow triangle (inheritance, dashed for realization), filled or hollow diamond at the whole (composition, aggregation), open arrow (association, dashed for dependency); cardinalities as end labels |
| architecture component `service` / `database` / `queue` / `cache` / `client` / `external` | rounded rectangle / cylinder / hexagon / dashed cylinder / actor figure / dashed rounded rectangle; parallel connections leave 20 px apart and each label sits where the layout engine placed it on its own edge |
| sequence participant | `umlLifeline` with a plain head; `actor` adds a stick figure above the head, `boundary`, `control`, `entity` and `database` show the kind as a `«stereotype»` line above the label (draw.io's robustness glyphs were tried and read as stray arrows) |
| sequence message | horizontal edge between lifelines: filled arrow (sync), open arrow (async), dashed open arrow (return); self-messages loop out to the right and back with both ends anchored on the lifeline's centre line |
| sequence block | `umlFrame` behind the messages it covers, wide enough for the notes attached to them; its tab text and each `else` / `and` label are opaque cells drawn above lifelines and activations |
| sequence note | note shape on the row after the message it follows |
| sequence activation | starts at a sync call and ends at the return to the caller; a return inside one branch of an `alt` or `par` keeps the activation open to the last message of that participant in the block |
| sequence message label | white background, so a lifeline it spans does not cut the text |
| activity lane | full-height coloured `swimlane` column (lanes side by side in IR order, header and body tints from a fixed palette); rows follow the flow order, nodes of a lane sit in its column, flows are routed through the row gaps and lane gutters on separate tracks per target, ordered so branches do not cross, and flows into one node merge into a trunk; a long edge runs straight down its own column when that column is free, else along the lane edge that no cross-lane flow cuts; a crossing that lanes force is reported as a `layout:` warning |
| activity control `initial` / `final` / `decision` / `merge` / `fork` / `join` | UML start and end circles / rhombus with the question / small rhombus / thin filled bars (horizontal for `TB`, vertical for `LR`) |
| edge label | child cell of the edge (`edgeLabel`, not connectable), so it moves with the edge |
| node or action with `ref` | subroutine shape; in a bundle the label's second line is the target title and the cell is a `UserObject` with `link="data:page/id,<page id>"`, draw.io's page link |

Cell ids are `<diagram-slug>:<ir-id>`; derived cells add a suffix such as `:label`, `:row-0`
or `:actor`. Page ids in a bundle are the diagram ids, so links between pages stay stable
across re-runs.

## Layout rules

- Node size: width is 7 px per character of the longest label line plus 24, clamped to
  120 to 260 px; height is 40 plus 20 per extra line; tables add 26 px per row. The
  heuristic lives in one function (`measureNode` in `scripts/src/layout-graph.mjs`), so
  tune it there if Japanese or very long labels wrap badly. Labels wrap inside the shape
  (`whiteSpace=wrap`), and the height grows by one line height per wrapped line at the
  clamped width, so a long label gets a taller box instead of spilling onto its arrows.
- ELK options: layered algorithm, direction from the IR, orthogonal edge routing,
  `hierarchyHandling=INCLUDE_CHILDREN` for edges that cross containers, root-relative
  edge coordinates. Node spacing 40, layer spacing 60 (60 and 80 for ER and class).
- Edges sit on the root layer with absolute bend points; nodes inside a container use
  coordinates relative to the container, as draw.io requires. Container children are never
  auto-stacked by draw.io (no `childLayout` on lanes), so ELK's placement is kept.
- Sequence grid: lifelines start 180 px apart and the gap between two neighbours widens
  until every message label fits between the lifelines it spans. Every message, note, block
  header, `else`/`and` separator and block end has a row of its own (40, 48, 34, 30 and 16 px),
  so frame labels never sit on message labels. Notes take the gap beside their lifeline. A
  sync message activates the target until the matching return. Frames inset 16 px per
  nesting level. After placement the emitter checks every label and note box for overlaps and
  reports each one as a `layout:` warning.

## Alternative: draw.io's own Mermaid import

draw.io can also turn Mermaid text into editable shapes (Arrange > Insert > Mermaid in the
app, or `.mmd` input to the desktop CLI). That needs the desktop or web app and a manual
step, and the layout is draw.io's. Use it when the user wants draw.io's Mermaid styling;
emit with `--to mermaid` and paste. The native emitter exists so the skill produces a
file headlessly and controls layout.

## Verified behaviour

The research sample XML was not opened in a real draw.io at planning time. During
implementation every fixture output was opened in app.diagrams.net headlessly: each file
loaded without a dialog, every cell was selectable and movable, and the shapes rendered as
listed above. Deviations from the research that were applied: ER edges use orthogonal
routing with ELK bend points rather than `entityRelationEdgeStyle`, because that style
ignores waypoints; the actor figure is a separate glyph because a `umlActor` lifeline head
stretches to the lifeline width and paints the label over the figure.
