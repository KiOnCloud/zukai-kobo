# Code review: open in draw.io (8a07b55..227fe2d)

Independent review of the three feature commits, run on 2026-11-18. No critical defect; the
focused tests (88) and the drift and console end-to-end tests passed. Verified as sound: the
bridge checks window and origin, the diagram goes only into a 0600 file and by `postMessage`,
`embedBridge` stays self-contained in the esbuild bundle, the CSP hash survives checkout
(`.gitattributes` forces LF), the page is written with `wx`, and `CONSOLE_CSP` is unchanged.

## Findings and what was done

| # | Severity | Finding | Disposition |
|---|---|---|---|
| H1 | High | A snap or flatpak browser (Ubuntu's Firefox and Chromium) has a private `/tmp`, cannot read the opener page, and `open` still reports `opened: web`. | Documented in README, `docs/install.md` and `docs/architecture.md`. Not changed in code: the plan fixes the page under the OS temp folder, and moving it under `$HOME` is a product decision left to the user. |
| H2 | High | The closing question offers desktop, then runs `open` with no flag, which can fall through to the web. | Fixed: the closing contract and the labs skill run `open --desktop` or `open --web` to match the route the user agreed to; a refused `--desktop` is not retried on the web without asking. |
| M1 | Medium | `cmd /c start "" <path>` lets cmd read `&`, `^`, `%` in the temp path, and a bare `cmd` is found in the working directory first. | Fixed: Windows opens the page with `%SystemRoot%\explorer.exe` by full path; macOS with `/usr/bin/open`. Unit test covers a path with `& ^ %`. |
| M2 | Medium | draw.io desktop was started with `--no-sandbox --disable-gpu`, the flags of a headless export. | Fixed: the interactive window gets the file alone; the e2e test asserts the argument list. |
| M3 | Medium | `pagesFolder` threw on a file or a dangling link in place of `zukai-open/`, and a failed write threw too: a stack trace instead of JSON. | Fixed: both return a `bad-request` refusal; unit tests cover the dangling link and the file. |
| L1 | Low | "Removed after 24 hours" overstated: cleanup ran only on the next web open. | Fixed: every `open` (either route) removes pages older than a day; help and architecture say "the next open removes". |
| L2 | Low | A second click on the opener page's popup button bridged the same window twice: two loads, two downloads per Save. | Fixed: the second click brings the window forward; the Playwright test counts one popup and one download. |
| L3 | Low | The console left one message listener per click. | Fixed: listening stops when the popup is closed or draw.io did not answer. |
| L4 | Low | "Never asked twice for one run" contradicted the revise rule. | Fixed: "asked once per delivery". |
| L5 | Low | After Save of a `.drawio.svg`, the page advised replacing "the run's file". | Fixed: the page says the run is unchanged until the downloaded `.drawio` is put in place of the run's file of that name. |
| L6 | Low | `no-browser` always blamed `xdg-open`. | Fixed: names `ZUKAI_OPENER` when that is what was missing. |
| L7 | Low | Display detection is approximate (macOS over SSH, WSL). | Not changed; noted as a known limit. |

## Open questions

- Should the Linux web route support snap and flatpak browsers by writing the page under a
  non-hidden folder of `$HOME` (with the same 0700 checks) instead of `/tmp`?
