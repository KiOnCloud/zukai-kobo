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
at the tag recorded in the JSON file. No icon artwork is copied or embedded: an emitted
`.drawio` file names the stencils and draw.io draws them. AWS service names and the AWS
Architecture Icons are trademarks and property of Amazon Web Services, Inc.; this project is
not affiliated with or endorsed by AWS.
