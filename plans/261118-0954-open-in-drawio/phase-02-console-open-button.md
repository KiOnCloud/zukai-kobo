---
phase: 2
title: "Phase 2: Console open button"
status: pending
priority: P2
effort: "0.75d"
dependencies: [1]
---

# Phase 2: Console open button

## Goal

The labs console offers Open in draw.io for a run's draw.io files and hands the chosen file
to draw.io on the web through the same bridge as the chat.

## Context

- Run header, Picture and Files are in `src/labs-ui/views/run-detail.mjs`.
- `GET /api/runs/:run/files/:name` sends a listed file of the run.
- The console's policy (`CONSOLE_CSP`, `labs-server.mjs`) governs its own page; opening a
  popup to another origin is a navigation of a new window, which the policy does not block.
- `dom.mjs` accepts only `#/` and `blob:` link addresses: the button calls `window.open`
  from its click handler, it is not a link.

## Requirements

- [x] The button appears only where a draw.io file exists: in the run header for the combined `<run-slug>.drawio`, on each `.drawio` row of Files, and in Picture for `drawio/<id>.drawio` of the current diagram.
- [x] Clicking opens `embedUrl(host)` as a popup from the click and loads the file with its name as the title.
- [x] Messages are taken only from that window and only from the embed origin.
- [x] Save downloads the file under its name, and an `Alert` says where to put it to change the run.
- [x] A blocked popup gives an `Alert` that says how to allow it.
- [x] The embed host comes from the server (`GET /api/state` gains `drawio: { embed }`, filled from `ZUKAI_DRAWIO_EMBED` or the default), so tests can use the stand-in.

## Files to Create / Modify

- Create: `skills/draw/scripts/src/labs-ui/views/open-drawio.mjs` (the button and the bridge call)
- Modify: `skills/draw/scripts/src/labs-ui/views/run-detail.mjs` (the three places)
- Modify: `skills/draw/scripts/src/labs-server.mjs` (`drawio.embed` in the state)
- Modify: `skills/draw/scripts/tests/labs-ui.test.mjs`, `tests/labs-ui-e2e.test.mjs`, `tests/labs-server.test.mjs`
- Modify: `skills/draw/scripts/bin/labs-ui/*` (rebuilt)

## Tasks & Steps

1. `open-drawio.mjs`: a Sienna secondary `Button` "Open in draw.io" with the icon `external`; on click, open the popup, fetch the file as text, call `embedBridge`; a popup that did not answer `init` within 60 s gives an `Alert`.
2. The three places in `run-detail.mjs`; nothing for a run without a `.drawio` file.
3. `drawio.embed` in `/api/state`; a server test.
4. jsdom: the button's presence per run shape; the bridge ignoring a message from another source or origin.
5. Playwright with the stand-in host: click, the file loads with its pages, Save downloads it under its name; no CSP violation in the console; the popup cannot read the console's token (cross-origin).
6. Rebuild; the Sienna and drift tests pass (one secondary button per place, no new style).

## Verification

- `cd skills/draw/scripts && npx vitest run tests/labs-ui.test.mjs tests/labs-ui-e2e.test.mjs tests/labs-server.test.mjs tests/sienna.test.mjs tests/bundle-drift.test.mjs`

## Risk Assessment

| Risk | Signal | Response |
|---|---|---|
| The popup can navigate the console through `window.opener` | Inherent to the embed protocol in a popup | The embed page is draw.io's own; the console holds no secret in its URL; stated in the docs. |
| A large file is slow to fetch and post | Several MB | The file comes from the local server; `postMessage` has no size limit; the spinner of the embed page shows meanwhile. |

## Security Considerations

The console posts the diagram only to the window it opened, with the embed origin as the
target; it takes no message from any other window or origin; its own page and policy are
unchanged.
