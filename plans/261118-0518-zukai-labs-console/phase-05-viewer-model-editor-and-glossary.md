---
phase: 5
title: "Phase 5: Viewer, model editor and Glossary section"
status: done
priority: P1
effort: "2.5d"
dependencies: [4]
---

# Phase 5: Viewer, model editor and Glossary section

<!-- Updated: Validation Session 2 - the views of this phase use the Sienna parts named below -->
<!-- Updated: Red Team Session 1 - split from the first console phase; the viewer is tried before anything is built on it; full policy for the frame, no connection out of it, cleaned text, checked messages, a wait of 60 s -->

## Overview

The second half of the console: a frame that draws a diagram which has no picture under
`svg/`, the editor of a diagram's model, and the Glossary section. The frame is tried
first, because the rest of the Picture tab depends on whether it works.

## Context

- A picture under `svg/` exists only when the user asked for it and a renderer was
  installed (`README.md:332`), so most runs have none and need the frame to be seen.
- `export` draws with draw.io's viewer script on a blank page with no policy and no
  sandbox (`export-svg.mjs:356-361`). That shows the script can draw a page of ours; it
  does not show that it draws inside a sandboxed frame. This is the one assumption of
  the plan that only a trial settles.
- The viewer script has no version in its address (`preview.mjs:69`); Mermaid is pinned
  to 12.3.0 (`preview.mjs:25`). `export` removes data links from the diagram before the
  viewer sees it (`export-svg.mjs:80`, `:363`) and waits 60 s for a page (`:182`).
- A diagram may hold customer names, and a recooked one may hold a picture cell that
  points at a foreign address.

## Requirements

- [x] The frame cannot read the token, call the API or open a connection to any host.
- [x] The frame gets the diagram with data links and foreign picture addresses removed.
- [x] The console takes a message only from its own frame; the frame only from its parent.
- [x] Without the network, or when the frame does not draw, the Picture tab says so and offers what still works.
- [x] An IR can be saved only when the server's validation passes; the save is a job.
- [x] The label form shows every label `labelsOf` returns, a transition's guard and an entity's rows included.
- [x] Glossary joins the console through one navigation entry, one view module, one route group and one job kind.

## Design

### Files

```text
src/labs-ui/
  viewer/frame.mjs          parent side: creates the frame, posts the diagram, takes the result
  viewer/viewer.html        the page inside the frame
  viewer/viewer.mjs         loads the renderer, draws what is posted
  views/model-editor.mjs    label form and raw JSON, validate, save as a job
  views/glossary.mjs
bin/labs-ui/                adds viewer.html and viewer.js; app.js and app.css grow
```

### Viewer frame

The server sends `viewer.html` with a policy of its own:

```text
Content-Security-Policy: sandbox allow-scripts; default-src 'none';
  script-src 'self' https://viewer.diagrams.net https://cdn.jsdelivr.net/npm/mermaid@12.3.0/;
  style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'
```

- The sandbox gives the frame an origin of its own: no storage of the console, no token,
  and an `Origin: null` the API refuses. With `connect-src 'none'` and pictures from
  `data:` and `blob:` only, the third-party script has no way to send the diagram anywhere.
- `GET /api/runs/:run/diagrams/:id/picture` returns what to draw: the kind (`drawio` or
  `mermaid`) and the text, with data links removed as `export` removes them and every
  picture address that is not `data:` taken out of the cell styles.
- The parent posts `{ kind, text }` to the frame and takes a reply only when
  `event.source` is the frame's window. The frame takes a message only from
  `window.parent`. The reply is the size of the drawing or an error text.
- A frame that has not replied after 60 s is replaced by the sentence "This diagram
  could not be drawn here", with the Export button and the Tables tab.
- The Picture tab uses the frame only when `svg/` has no fresh picture.
- The frame stands on a white ground in both themes, framed like a picture from `svg/`
  (phase 4). The page inside it takes nothing from Sienna: it holds the drawing only.

### Model editor

A form of every label (`path`, id, a text field) and the raw JSON beside it; both edit
one IR. The two are a segmented `Tabs` ("Labels", "JSON"); a label is a Sienna `Input`
with its path as the helper text, the JSON a multiline `Input` in the `code` style. An
error of the validation stands beside its field as Sienna sets an error, and the whole
list in a danger `Alert` above the actions. "Save changes" is the one primary button. "Validate" calls `/api/validate` and lists errors with path and hint, and the
glossary's findings for the edited labels. "Save" is enabled for a valid, changed IR and
queues `apply-edit` with the `rev` the IR was loaded with. A FigJam run can be edited
too; its report says that the board is not redrawn by this (`closing-contract.md`, "When
revise calls this contract").

### Glossary

The page title is `heading-lg`, as Sienna sets it for an admin page. A `Table` with one
column per language found in the entries, the status as a `Badge` (suggested warning,
confirmed neutral with the check icon, rejected neutral outline), `Chip`s to filter by
status, a search `Input`. "Add entry" is the one primary button; editing happens in a
`Dialog` with one `Input` per language.
Add, edit in place, delete. Suggested entries have "Confirm" and "Reject", also for a
selection. "Suggest from diagrams" queues `glossary-suggest`. "Check a run" shows the
findings, warnings apart from blocking ones. A write that gets 409 reloads the file and
says that it changed on disk. The limits of phase 1 are checked in the form before a
write is sent, and again by the server.

## Files to Create / Modify

- Create: `skills/draw/scripts/src/labs-ui/viewer/frame.mjs`, `viewer.html`, `viewer.mjs`
- Create: `skills/draw/scripts/src/labs-ui/views/model-editor.mjs`, `views/glossary.mjs`
- Create: `skills/draw/scripts/bin/labs-ui/viewer.html`, `viewer.js` (built, committed)
- Create: `skills/draw/scripts/tests/labs-ui-e2e.test.mjs` (Playwright where it is found, skipped otherwise, as `export-e2e.test.mjs:152` is)
- Modify: `skills/draw/scripts/src/labs-ui/nav.mjs`, `views/run-detail.mjs` (the Glossary entry; the Model tab; the frame in the Picture tab)
- Modify: `skills/draw/scripts/src/labs-server.mjs` (the picture route; the headers of `viewer.html`)
- Modify: `skills/draw/scripts/src/export-svg.mjs` (export the cleaning of data links, so one function serves both)
- Modify: `skills/draw/scripts/build.mjs`, `tests/bundle-drift.test.mjs`, `tests/labs-ui.test.mjs`
- Modify: `skills/draw/scripts/bin/labs-ui/app.js`, `app.css` (rebuilt)

## Implementation Steps

1. Trial, before anything else: a page with the frame and the policy above, served by the server of phase 2, drawing one fixture of each kind and the AWS architecture fixture with Playwright. Record what was drawn and what the policy blocked. The outcome decides step 2.
2. When the trial draws everything: go on. When only icons are missing because the script fetches its shape files: allow `connect-src https://viewer.diagrams.net` and nothing else, and record it. When nothing is drawn inside a sandbox: stop, record it in the plan and ask before going on; the tab would then show pictures from `svg/` only.
3. The picture route with the cleaned text; a test with a data link and a foreign picture address. The route joins the security table, the no-write test and the parameter test of phase 2.
4. `frame.mjs`, `viewer.mjs` and the message checks; the 60 s fallback.
5. The Mermaid branch of the viewer.
6. The model editor: label form, raw JSON, validation, save as a job.
7. The Glossary section. Count the touch points it needed.
8. The Playwright test: list, picture from the frame, queue a job against a stand-in agent that answers the bridge, answer a question, see the report; the page without a token; the label that holds markup; the frame trying to call `/api/state`; a foreign page framing the console.
9. Keyboard order, focus on route change, labels of form fields, both colour settings, for the views of this phase.

## Todo

- [x] Viewer trial, recorded
- [x] Picture route with cleaned text
- [x] Frame, viewer page and message checks
- [x] Mermaid in the viewer
- [x] Model editor
- [x] Glossary section
- [x] Playwright test
- [x] Keyboard and colour pass

## Success Criteria

- The trial's record names, per kind, whether the frame drew it and what the policy blocked.
- The frame cannot call `/api/state` (the test tries from inside it and gets 403) and cannot fetch a foreign address (the test tries and the request does not leave).
- A diagram with a foreign picture address is posted to the frame without it.
- A message to the console from a window that is not its frame changes nothing.
- "Save" stays disabled for an IR with a validation error; a guard of a state diagram and a row of an entity appear in the label form.
- A glossary term of 81 characters is refused in the form and by the server.
- Glossary was added with one navigation entry, one view module, one route group and one job kind.
- The built pages are still under 300 KB in total and equal a fresh build.
- Every control of this phase is a Sienna component; the Sienna test of phase 4 still passes, with no value written out in `app.css`.

## Risk Assessment

| Risk | Signal | Response |
|---|---|---|
| The viewer does not draw in a sandboxed frame | Step 1 shows an empty frame for every kind | Step 2 names it: stop and ask. The Picture tab from `svg/` and the Export job already work from phase 4. |
| The viewer needs its own host for shape files | Step 1 shows the AWS fixture without icons | Allow that one host for connections; the script comes from the same host, so no further party sees the diagram. |
| The viewer script changes, since its address has no version | A picture that drew yesterday is empty today | The 60 s fallback covers the user; the round of phase 7 is the check before a release. Stated in the documents. |
| Playwright is not in CI | The e2e test is skipped there | The jsdom tests carry the logic; the Playwright round is run and recorded in phase 7. |

## Security Considerations

- A third-party script draws the diagram, inside a frame that can reach nothing. The
  documents say that the script is fetched from `viewer.diagrams.net` or `jsdelivr` and
  that the diagram does not leave the machine.
- The model editor sends an IR to the server for validation only; it is stored only as
  part of a job the user queued.

## Viewer trial (2026-11-18)

Run with Playwright's Chromium against the labs server, one fixture of each draw.io kind,
the AWS architecture fixture and a Mermaid run, each posted to `viewer.html` in a frame with
`sandbox="allow-scripts"` under the frame's own policy.

| Case | Drawn | Size | Blocked by the policy |
|---|---|---|---|
| flowchart/valid | yes | 481 × 985 | nothing |
| sequence/valid | yes | 766 × 802 | nothing |
| state/valid | yes | 465 × 1316 | nothing |
| er/valid | yes | 483 × 770 | nothing |
| class/valid | yes | 405 × 1106 | nothing |
| architecture/valid | yes | 2128 × 463 | nothing |
| activity/valid-two-lanes | yes | 702 × 860 | nothing |
| usecase/valid | yes | 983 × 447 | nothing |
| architecture/valid-aws | yes, icons missing | 1602 × 637 | `connect-src 'none'` blocked `stencils/aws4.xml` and `stencils/networks.xml` of viewer.diagrams.net |
| Mermaid state | yes | 300 × 720 | nothing |

Outcome: the second of step 2. `connect-src https://viewer.diagrams.net` is allowed and
nothing else; with it the AWS fixture draws with every icon. The script comes from the same
host, so no further party sees the diagram.

Three findings changed how the frame is built, none its rules:

- A sandboxed page has an origin of its own, so a script it fetches from the console's host
  is a cross-origin response: a module script fails for want of CORS, a classic one is
  refused by Opaque Response Blocking. The server sends no CORS header, ever, so the
  viewer's script is inlined into `viewer.html` and the policy allows it by its SHA-256 hash
  in place of `'self'`, which is narrower.
- The frame's policy adds `frame-ancestors 'self'` and the page is sent with
  `X-Frame-Options: SAMEORIGIN`, since every other response of the server says `DENY`.
- draw.io's viewer lays nothing out in a box without width; the frame draws in a block of
  its own and shows the SVG of the page, as `export` does. Inside the sandbox the viewer's
  `localStorage` throws `SecurityError` and the viewer carries on without it.
