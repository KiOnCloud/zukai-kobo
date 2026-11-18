---
phase: 1
title: "Phase 1: Open command and embed bridge"
status: pending
priority: P2
effort: "1d"
dependencies: []
---

# Phase 1: Open command and embed bridge

## Goal

`cli open` opens a run's draw.io file in draw.io desktop or, without it, in draw.io on the
web through an opener page that hands the diagram over by `postMessage`; `cli open --check`
says whether that is possible here.

## Context

- `findDrawioBinary()` and `drawioCommand()` in `src/preview.mjs` find draw.io desktop and
  wrap it in `xvfb-run` when Linux has no display; a window under `xvfb-run` is invisible.
- `isCloudSession()` in `src/labs-lifecycle.mjs` reads `CLAUDE_CODE_REMOTE`.
- `drawioPages()` in `src/export-svg.mjs` reads a draw.io file; `drawioXmlOf()` in
  `src/extract-drawio.mjs` reads the diagram embedded in a `.drawio.svg`.
- A run folder holds the combined `<run-slug>.drawio` (target drawio), `figjam/` (target
  figjam) or `<run-slug>.md` and `mermaid/` (target mermaid), per `closing-contract.md`.
- draw.io's embed protocol (trial 2026-11-18): the embed page posts a JSON string
  `{"event":"init"}` to its parent or opener; the host answers
  `{"action":"load","xml":...,"title":...,"autosave":0}`; the page posts `{"event":"load"}`
  and, on Save, `{"event":"save","xml":...}`; `{"action":"status","modified":false}` clears
  the unsaved mark.

## Requirements

- [ ] The diagram never appears in a URL or on a command line.
- [ ] The opener page is written with mode 0600 into a 0700 folder `zukai-open/` under the OS temp folder; pages older than 24 hours are removed on each run.
- [ ] The opener is spawned with an argument list and detached: `open` (macOS), `xdg-open` (Linux), `cmd /c start "" <path>` (Windows).
- [ ] Desktop is used when found and a display is there (`--web` forces the web, `--desktop` refuses when desktop is missing).
- [ ] A Mermaid file or run, a FigJam-only run and a cloud session are refused with a reason; `--check` reports the same without side effects.
- [ ] Messages are taken only from the embed window and only from the embed origin.

## Design

### Shared bridge, `src/drawio-embed.mjs`

- `EMBED_HOST` (`https://embed.diagrams.net`, replaced by `ZUKAI_DRAWIO_EMBED` in tests) and
  `embedUrl(host)` = `<host>/?embed=1&proto=json&spin=1&noExitBtn=1&saveAndExit=0`.
- `embedBridge(win, { host, xml, title, onSave, onLoad })`: a browser function with no
  imports. It listens for messages whose `source` is `win` and whose `origin` is `host`,
  answers `init` with `load`, calls `onLoad` on `load`, and on `save` calls `onSave(xml)` and
  posts `status` with `modified: false`. Returns a function that stops listening.
- `openerPage({ host, xml, title })`: the chat's page as one HTML string.
  - A full-window frame of `embedUrl(host)`.
  - The diagram as a JSON block (`<` written as `<`).
  - `embedBridge` inlined with `Function.prototype.toString`.
  - When no `init` came after 20 s, a button "Open in draw.io" that opens the same URL as a
    popup and bridges it, beside "Download <title>".
  - On Save, a download of `<title>` from a blob.
  - Its own `Content-Security-Policy` meta: scripts inline only, frames from the host only,
    no connections.

### Command

```text
cli.mjs open <run-dir|file.drawio|file.drawio.svg> [--web|--desktop]
cli.mjs open --check <run-dir|file.drawio|file.drawio.svg>
```

- **Resolve the file:**
  - A run folder stands for its combined `<run-slug>.drawio`; without one, for its only
    `drawio/*.drawio` when there is one file, else a refusal that lists them.
  - A `.drawio.svg` opens the diagram embedded in it.
  - A run with only `figjam/`, a `.mmd` or `.md` file and a run with only Mermaid output are
    refused with `not-supported` and a reason; the FigJam one adds that the board link is in
    the run's report.
- **Choose the route:**
  1. Cloud session: refuse with `cloud-session`.
  2. `--desktop`, or desktop found and a display available: spawn `<bin> <file>` detached,
     with no `xvfb-run`; output `opened: desktop`.
  3. Otherwise, the web: write the opener page and spawn the OS opener with its path.
     ENOENT from the opener gives `no-browser` with the path of the run's file.
- `ZUKAI_OPENER` replaces the OS opener (tests point it at a stand-in that records its
  arguments). It is documented as a test variable, like `ZUKAI_LABS_*`.
- **Output:** `{ ok, opened: "desktop"|"web", file, page? }`; errors are
  `{ ok: false, error: { code, message, hint } }` on stderr with exit 1. Codes:
  `cloud-session`, `not-supported`, `no-display`, `no-browser`, `not-found`, `bad-request`.
- **`--check`:** `{ ok: true, can, via: "desktop"|"web"|null, reason?, file? }`, exit 0 in
  every case; it runs `findDrawioBinary` but writes and spawns nothing.

## Files to Create / Modify

- Create: `skills/draw/scripts/src/drawio-embed.mjs`
- Create: `skills/draw/scripts/src/open-drawio.mjs` (resolve, route, temp page, cleanup)
- Create: `skills/draw/scripts/tests/open-drawio.test.mjs`
- Create: `skills/draw/scripts/tests/open-drawio-e2e.test.mjs` (through the bundle; Playwright part with the stand-in embed host, skipped without Playwright)
- Create: `skills/draw/scripts/tests/embed-stand-in.mjs` (a local page that speaks the embed protocol)
- Modify: `skills/draw/scripts/src/cli.mjs` (`open`, `--check`, `--web`, `--desktop`, usage)
- Modify: `skills/draw/scripts/bin/cli.mjs` (rebuilt)

## Tasks & Steps

1. **Local gate, first:** write `plans/261118-0954-open-in-drawio/trial/open-trial.html`, an opener page for one fixture built with the real host, and ask the user to open it in their own browser. Record whether the frame loads, and whether the popup button loads. The outcome decides whether the frame or the popup is the chat's first route.
2. `drawio-embed.mjs`, with unit tests: the URL, the escaping of the JSON block (a label holding `</script>`), the inlined bridge.
3. The resolver and its refusals, with a test per run shape (drawio, svg, figjam, mermaid, several `drawio/` files).
4. The route choice with stand-ins: a fake `drawio` on PATH answering `--version`, `DISPLAY` set or not, `CLAUDE_CODE_REMOTE`.
5. The temp page: folder and file modes (not checked on Windows), the 24-hour cleanup, `ZUKAI_OPENER` receiving only the path.
6. `--check` without side effects.
7. Playwright: the opener page against the stand-in embed host loads the 72-page bundle of every fixture, answers `save` with a download and `status`, and ignores a message from another window or origin.
8. Wire `open` into `cli.mjs`; rebuild; e2e through the bundle from another working directory.

## Verification

- `cd skills/draw/scripts && npx vitest run tests/open-drawio.test.mjs tests/open-drawio-e2e.test.mjs`
- The local gate's result recorded in this file.
- `npm test` passes; the bundle stays under its budget.

## Risk Assessment

| Risk | Signal | Response |
|---|---|---|
| The real host refuses to be framed by `file://` | Local gate: blank frame | The popup button becomes the first route of the opener page; the docs say one click opens it. |
| The embed protocol changes | Release check: no `init` or `load` | The page falls back to Download; desktop unaffected. |
| A long `--version` probe of a broken desktop | `findDrawioBinary` takes its 30 s timeout | Accept: it happens only when a broken binary is on PATH, and `--web` skips it. |

## Security Considerations

- The temp page holds the diagram; its folder and file are private to the user, and it is removed after 24 hours.
- The page sends the diagram only to the embed window, by origin; it opens no connection itself.
- draw.io's script on the embed host receives the diagram, as the viewer frame of the labs console does; the docs say so.
