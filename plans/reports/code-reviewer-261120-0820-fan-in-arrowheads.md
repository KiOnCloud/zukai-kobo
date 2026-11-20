# Code review: arrowheads on slanted shapes and crowded fan-in

Reviewed commit `d5d8999` (the uncommitted diff at review time, byte-identical in `src`). The
reviewer read the plan and the diff without the implementer's conclusions. No critical
finding. Every finding below was reproduced with a probe before it was fixed in `a0cd373`.

| # | Severity | Finding | Outcome |
|---|---|---|---|
| 1 | Major | A node with fixed ports had none for a self-loop that ELK routes (left-to-right, right-to-left), so ELK attached the loop to the corners: it left the top-right corner, wrapped the whole node and its arrowhead met the top-left corner from the side. Four ends on a state were enough to trigger it. | Fixed. `sidePorts` gives the two ends of such a loop ports on the side the first layout put them; a loop takes no part in a merge. Test: "keeps a self-loop a small loop over the top of a node that got ports". |
| 2 | Major | In a top-down or bottom-up diagram a rectangle with a self-loop has a layout box wider than its shape. Ends the layout put beside the shape were clamped to its corners (a diagonal stub, 13 to 28 px off the flow). Present before the change; the off-outline check covered parallelograms only. | Fixed. Ends off the outline are spread over the shape for every shape. Two state fixtures changed: their lines left the bottom corners of such a state before. Checked on renders. |
| 3 | Minor | The port ELK makes for a line that leads back lies a pixel outside the box; on the flat bottom of a parallelogram that pixel was written as `entryDy=1`. | Fixed. The end is taken on the box before it is moved onto the outline. |
| 4 | Minor | `docs/install.md` said every other shape keeps its anchors; every end of a node that gets ports gains `Perimeter=0` and an offset. | Fixed in the upgrade notes. |
| 5 | Minor | Junction ids counted across the page (`t1:junction:1`, `t2:junction:2`), so a merge added at one node renumbered the dots of later nodes. | Fixed. Numbered per node. |
| 6 | Minor | The tests rebuilt each end from the anchors and waypoints; none measured what draw.io draws, which is what the acceptance criteria name. | Fixed. `tests/fan-in-render-e2e.test.mjs` exports through the bundle and measures the viewer's SVG. On the 2.7.1 bundle it fails with the reported bend (4.28 px). |

Checked and found sound: the outline geometry of both shapes on every side and in the slant
strips; merges inside groups, nested groups and composite states, in four directions; back
edges and loop heads with ports; mixed groups of 6 and 7; no id collision of ports or dots;
identical output across runs; the other callers of `graphCells` (ER, class, use case,
activity) unchanged apart from the ends on parallelograms and hexagons; `extract`, `drift`,
`cover`, `relabel`, the bundle canvas and the FigJam reader with the dot; the schema.

Accepted as designed: `fanIn: auto` is the default is asserted by comparing two outputs,
which alone would pass if the field were ignored; the `merge` and `separate` tests beside it
fail in that case.
