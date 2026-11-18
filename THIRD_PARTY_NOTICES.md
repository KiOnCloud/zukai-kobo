# Third-party notices

The committed bundle `skills/draw/scripts/bin/cli.mjs` contains the following
third-party code. Licence texts are in each package's npm distribution.

| Package | Version | Licence | Use |
|---|---|---|---|
| elkjs | 0.12.1 | EPL-2.0 OR GPL-3.0-or-later (used unmodified under EPL-2.0; licence text in the elkjs npm package, LICENSE.md) | Graph layout for the draw.io emitter |
| ajv | 8.20.x | MIT | JSON Schema validation of the IR |

Development-only dependencies (`esbuild`, `vitest`, `mermaid`, `jsdom`, `fast-xml-parser`) are
not part of the bundle and are not redistributed.

## Labs console

The console's pages under `skills/draw/scripts/bin/labs-ui/` are built from
`skills/draw/scripts/src/labs-ui/` and redistribute the following.

| Font family | Source | Licence | Licence file |
|---|---|---|---|
| Newsreader | `@fontsource-variable/newsreader` 5.3.0 | SIL Open Font License 1.1 | `fonts/OFL-Newsreader.txt` |
| Instrument Sans | `@fontsource-variable/instrument-sans` 5.3.0 | SIL Open Font License 1.1 | `fonts/OFL-InstrumentSans.txt` |
| JetBrains Mono | `@fontsource-variable/jetbrains-mono` 5.3.0 | SIL Open Font License 1.1 | `fonts/OFL-JetBrainsMono.txt` |

The font files are in `bin/labs-ui/fonts/`, each family's licence text beside them. They
were taken from the Fontsource variable packages on npm and cut to the axes the console
uses; none of the three declares a Reserved Font Name. The subsets, axes and files of each
family are recorded in `src/labs-ui/fonts/fonts.json`.

The stylesheet, helper script, type declarations and design tokens of the Sienna design
system (`bundle.css`, `bundle.js`, `index.d.ts`, `tokens.json`) are copied unchanged into
`src/labs-ui/sienna/` and built into the console's pages. Sienna is the project owner's
design system; `src/labs-ui/sienna/sienna.lock.json` records the version, the place each
file was copied from and its SHA-256.

draw.io's viewer (`viewer.diagrams.net`) and Mermaid (from `cdn.jsdelivr.net`) are fetched
by the user's browser at run time, when the console draws a run that has no picture under
`svg/`. Neither is part of the repository or of the console's pages, and neither is
redistributed.

## Data

`skills/draw/scripts/src/aws-icons.json`, `skills/draw/references/aws-icons.md` and
`skills/draw/references/gcp-icons.md` list the stencil names, titles and style values of the
AWS and GCP shape libraries of draw.io (jgraph/drawio, Apache-2.0), read from
`src/main/webapp/js/diagramly/sidebar/Sidebar-AWS4.js`,
`src/main/webapp/js/diagramly/sidebar/Sidebar-GCP2.js` and
`src/main/webapp/shapes/mxGCP2.js` at the tag recorded in the JSON file. An emitted `.drawio` file names the stencils and
draw.io draws them.

`skills/draw/scripts/src/stencil-paths.json`, which is part of the bundle, holds the outline
geometry of those stencils and of the product logos and figures the architecture emitter
uses, converted from the stencil libraries `aws4.xml`, `gcp2.xml` and `networks.xml` in
`src/main/webapp/js/stencils.min.js` of draw.io (jgraph/drawio, Apache-2.0) at the tag and
checksum recorded in the file. It is used only by `emit --to figjam --native`, which draws
the icons a diagram uses on a FigJam board.

AWS service names and the AWS Architecture Icons are trademarks and property of Amazon Web
Services, Inc.; the product logos are trademarks of their owners. This project is not
affiliated with or endorsed by AWS or by those owners.

Google Cloud, the Google Cloud logo and the names and icons of Google Cloud products are
trademarks of Google LLC. Zukai is not affiliated with or endorsed by Google.
