# Third-party notices

The committed bundle `skills/draw/scripts/bin/cli.mjs` contains the following
third-party code. Licence texts are in each package's npm distribution.

| Package | Version | Licence | Use |
|---|---|---|---|
| elkjs | 0.12.1 | EPL-2.0 OR GPL-3.0-or-later (used unmodified under EPL-2.0; licence text in the elkjs npm package, LICENSE.md) | Graph layout for the draw.io emitter |
| ajv | 8.20.x | MIT | JSON Schema validation of the IR |

Development-only dependencies (`esbuild`, `vitest`, `mermaid`, `jsdom`, `fast-xml-parser`) are
not part of the bundle and are not redistributed.

## Data

`skills/draw/scripts/src/aws-icons.json` and `skills/draw/references/aws-icons.md`
list the stencil names, titles and style values of the AWS shape library of draw.io
(jgraph/drawio, Apache-2.0), read from `src/main/webapp/js/diagramly/sidebar/Sidebar-AWS4.js`
at the tag recorded in the JSON file. An emitted `.drawio` file names the stencils and
draw.io draws them.

`skills/draw/scripts/src/stencil-paths.json`, which is part of the bundle, holds the outline
geometry of those stencils and of the product logos and figures the AWS architecture emitter
uses, converted from the stencil libraries `aws4.xml`, `gcp2.xml` and `networks.xml` in
`src/main/webapp/js/stencils.min.js` of draw.io (jgraph/drawio, Apache-2.0) at the tag and
checksum recorded in the file. It is used only by `emit --to figjam --native`, which draws
the icons a diagram uses on a FigJam board.

AWS service names and the AWS Architecture Icons are trademarks and property of Amazon Web
Services, Inc.; the product logos are trademarks of their owners. This project is not
affiliated with or endorsed by AWS or by those owners.
