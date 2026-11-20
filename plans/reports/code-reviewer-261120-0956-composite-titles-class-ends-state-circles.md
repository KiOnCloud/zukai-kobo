# Code review: composite titles, class ends on the table and ends on state circles

Reviewed the diff of `skills/draw/scripts/src/emit-drawio.mjs` that became `ded8def`, with
its tests, the new fixture and the doc edits. The reviewer read the plan and the diff
without the implementer's conclusions, ran the same IRs through the tree before the change
and the tree after it, and found nothing blocking. The findings below were each reproduced
with a probe before they were handled.

| # | Severity | Finding | Outcome |
|---|---|---|---|
| 1 | Medium | A composite whose title stands between two lines and is a pixel too wide for the gap was widened a few pixels a round and never placed: the widening was sized against the longest free stretch of the header (the gap between the lines), but a frame grows at its far side and the lines keep their places, so only the last stretch gets longer. After six layouts the composite was 23 px wider than on 2.8.0, the title still lay on a line and a `layout:` warning was added. The formula is the shared one of `placeGroupTitles`; this change exposed state diagrams to it. | Fixed. The frame grows by what the stretch at its far end lacks, which places the title in one round. Test: "widens a composite once, by what the far end of its header lacks, when lines stand on both sides of the title". No fixture of another kind changes a byte. |
| 2 | Low | Two title tests asserted the clearance without asserting that a line crosses the header, so they passed with none. | Fixed: both assert a crossing first. |
| 3 | Low | `target-drawio.md` said a frame is widened "so no line runs through a frame title", with no word of the warning after six layouts. | Fixed in the row and in the maintainer notes. |
| 4 | Low | A crossed composite whose long title wrapped is widened until the title stands on one line, and its header keeps the height of the wrapped title: `state/valid-ref-parts` with an 88 character ref title goes from 177 px to 640 px wide with a 94 px header over two lines of text. | Not changed. The plan accepts it (risk note of phase 1; the widening was the confirmed answer of the validation). Reported to the user as an open decision. |
| 5 | Low | The three render tests are skipped where Playwright is not installed, as the export tests are. | Not changed; the anchors they measure are asserted without a browser in the unit tests. |
| 6 | Outside the diff | A transition from a composite state to itself throws `TypeError: Cannot read properties of undefined (reading 'drawWidth')` in `graphCells`, in every direction, on 2.8.0 as well. | Not changed here: older than this plan and outside its scope. Reported to the user. |

Checked and found sound: the stricter header filter loses no crossing in a flowchart, an
architecture or a use case diagram (their lines end on nodes only, and members stand inside
the frame below the header); the order of `sidePorts`, the header pass, the title loop and
`fanInJunctions` in `emitState`; `minGap: 0` cannot give ports to a class without a relation
to itself, and none in a left-to-right or right-to-left diagram; `ellipsePoint` computes in
the order of the code it replaced in `usecaseAnchor`; a self-loop on a state circle cannot
be written.
