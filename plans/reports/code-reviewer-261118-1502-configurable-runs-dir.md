# Code review: configurable runs folder and the run index

Reviewed commit `27fac76` (the uncommitted diff at review time). No critical or high finding.
Every finding below was checked against the code and reproduced with a probe or a test
before it was fixed.

| # | Severity | Finding | Outcome |
|---|---|---|---|
| 1 | Medium | `projectOfRun` fell back to "a parent named `diagrams`" when a setting above the run could not be read, or when the path was spelled in another case or through a link. With `runsDir: "docs/diagrams"`, this made `labs holds` answer `held: false` for a run a console job held, and registered `docs/` as a phantom project. | Fixed. Real paths are compared (`realpathSync.native`). An unreadable setting above the run throws `bad-config`, and `labs holds` exits 1 with it. The fallback applies only when the grandparent has no setting. |
| 2 | Medium | Every index write dropped projects with a temporarily bad setting or an unreachable root. | Fixed. Only a root that is gone (`ENOENT`, `ENOTDIR`) is pruned. |
| 3 | Medium | An index written by a newer version, or one that could not be read, was overwritten with a one-entry file. | Fixed. Such a file is kept: register skips the write, `index rebuild` and `index forget` fail with `index-write`, and `index list` warns. |
| 4 | Medium | The console's first page was built before the first state, so it named `diagrams/` in a project with another runs folder. | Fixed. A view is redrawn when the state's runs folder differs from the one it was drawn with. The e2e test fails without the fix. |
| 5 | Low | The server read the setting once per run on every 1.5 s poll. | Fixed. The folder is resolved once per listing. |
| 6 | Low | `index rebuild --scan ~` took the home folder for a project because of `~/.zukai`. | Fixed. The index's own folder makes no project unless it holds a `config.json`. |
| 7 | Low | Windows short names (`GIT~1`, `ZUKAI~1`) passed the `.git`/`.zukai` check. | Fixed. A part that reads as a short name is refused. |
| 8 | Low | Hints name the working directory's runs folder, not the run's project. | Not changed. It is cosmetic, and no path is resolved from it. |
| — | Test isolation | `open-drawio-e2e.test.mjs` stripped `ZUKAI_HOME` from the CLI environment. | Fixed. `ZUKAI_HOME` is kept. |
| — | Open question | `labs status` exited 1 on a bad setting, which hid a running server. | Changed. `status` answers with `runsDir: null` and `configError`. `start` still refuses. |

Accepted as designed: two sessions writing the index at once can lose one entry, which the
next registering command adds back. The plan's "merge before rename" wording overstated this;
the code reads, filters and renames.
