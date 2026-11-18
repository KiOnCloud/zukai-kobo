---
phase: 4
title: "Phase 4: Console UI"
status: todo
priority: P1
effort: "3d"
dependencies: [2, 3]
---

# Phase 4: Console UI

## Overview

The pages the server serves: a navigation, the Diagrams section, the Glossary section and
a job panel that is always in view. Plain ES modules, built by esbuild into committed
files under `scripts/bin/labs-ui/`, with a drift test like the one of the CLI bundle.

## Context

- The installers copy `scripts/bin` whole and remove `scripts/src` (`install.sh:176-186`),
  so the built pages go to `bin/labs-ui/` and their sources to `src/labs-ui/`.
- The CLI bundle has about 230 KB left of its 3 MB budget; the pages are files beside it,
  not text inside it.
- A label, a title, a request and a report are text from outside: a recooked diagram
  brings the words of whoever drew it. None of it may reach the page as markup.
- draw.io's viewer is the renderer `export` already uses in a local browser
  (`export-svg.mjs:360`); only the viewer is fetched, the diagram stays on the machine.

## Requirements

- [ ] The token is read from the URL fragment once, kept for the tab, removed from the address bar and sent as `X-Zukai-Token`.
- [ ] No data from the server is ever set as HTML; every text goes in as a text node.
- [ ] The state of the agent is always visible; with no agent the page says "No agent attached" and how to attach one.
- [ ] A job that waits for the user shows its question and takes the answer in the page.
- [ ] An IR can be saved only when the server's validation passes; the save is a job.
- [ ] A picture is shown without the network when the run has one under `svg/`.
- [ ] The viewer of draw.io and of Mermaid runs in a frame that cannot read the token or call the API.
- [ ] A further section joins through one entry in the navigation list and one view module.
- [ ] The built files are deterministic and equal a fresh build, byte for byte.
- [ ] The pages work with the keyboard and follow the light or dark setting of the system.

## Design

### Files

```text
src/labs-ui/
  index.html
  main.mjs            start: token, navigation, event loop
  api.mjs             fetch with the token, the held-open event call, errors as values
  store.mjs           one state object with subscribe; no library
  dom.mjs             h(tag, props, ...children): text nodes only, no innerHTML
  nav.mjs             the list of sections: [{ id, label, view }]
  views/runs-list.mjs
  views/run-detail.mjs      tabs: Picture, Model, Tables, History, Files
  views/model-editor.mjs    label form and raw JSON, validate, save as a job
  views/new-diagram.mjs     draw and recook forms
  views/job-panel.mjs       agent state, queue, progress, question, report
  views/glossary.mjs
  viewer/frame.mjs          parent side: creates the frame, posts the diagram to it
  viewer/viewer.html        the page inside the frame
  viewer/viewer.mjs         loads the renderer, draws what is posted
  app.css
bin/labs-ui/                the built copies: index.html, app.js, app.css, viewer.html, viewer.js
```

### Navigation

`nav.mjs` is an array. Diagrams and Glossary are its two entries. The route of a section
is `#/<id>/...`. There is no loader and no registry.

### Diagrams

- Runs list: date, title, kinds, targets, revisions, a stale mark for a scouted run,
  a filter by text. "New diagram" and "Recook" open their forms.
- Run header: Revise (request text, with "preview as drafts"), Undo, Redo, Sync (a scouted
  run only), Export (pictures, tables). Each queues a job. Undo and Redo show the revision
  the server names as the target and are disabled when it names none.
- Picture: one diagram at a time with a page list. From `svg/<id>.drawio.svg` when it is
  there and not older than the IR, shown as an image from a blob. Otherwise from the
  `.drawio` or `.mmd` file through the viewer frame. Without the network and without a
  picture: a sentence that says so, with the Export button and the Tables tab.
- Model: a form of every label (`path`, id, text field) and the raw JSON beside it; both
  edit one IR. "Validate" calls `/api/validate` and lists errors with path and hint, and
  the glossary's findings for the edited labels. "Save" is enabled for a valid, changed
  IR and queues `apply-edit` with the `rev` the IR was loaded with.
- Tables: the description tables, as text in a fixed-width block, with a language choice.
- History: revisions newest first as `rNNN · date · request`, "Restore" per revision,
  "Changes since" as the list `diffRun` gives.
- Files: the listed files with size and date and the path to copy; `.drawio` downloads.

### New diagram and recook

The draw form takes what the opening question would ask: mode, request, target, kind,
scope, audience, pictures, tables. Kind may be left open; the agent then asks through the
job. The recook form takes a path inside the project or a board link, and the same options.

### Job panel

Agent state as one line: "No agent attached: run /zukai:labs in your terminal",
"Agent waiting", "Agent working on <job>", "No word from the agent for <n> min". The
queue in order, each with cancel. The running job with its progress lines. A question as
a card: the text, one button per option with its description, a field for another answer,
and the attached files of the run opened in the viewer. A closed job shows its report as
plain text. An interrupted or stalled job offers "Requeue" and "Cancel".

### Glossary

A table with one column per language, a status filter, text search. Add, edit in place,
delete. Suggested entries have "Confirm" and "Reject", also for a selection. Evidence
links to the run and diagram. "Suggest from diagrams" queues `glossary-suggest`. "Check a
run" shows the findings. A write that gets 409 reloads the file and says that it changed
on disk.

### Viewer frame

The frame is served with `Content-Security-Policy: sandbox allow-scripts` plus a source
list that allows the viewer script from `https://viewer.diagrams.net` and the Mermaid
module from `https://cdn.jsdelivr.net/npm/mermaid@12.3.0/` (the version `preview.mjs`
pins). The sandbox gives it an origin of its own: no storage of the console, no token,
and an `Origin: null` the API refuses. The parent posts `{ kind, text }`; the frame draws
and posts back its size or an error. A frame that reports no result in 20 s is replaced
by the offline sentence.

### Build

`build.mjs` gets a second set of options for the pages (browser, ESM, no hashes in file
names, whitespace minified) and `uiFiles()` for the drift test. `npm run build` writes
the CLI bundle and the pages. The server takes its page folder from
`new URL('./labs-ui/', import.meta.url)`, which is `bin/labs-ui/` in the bundle; tests
pass the folder in.

## Files to Create / Modify

- Create: `skills/draw/scripts/src/labs-ui/` (the files above)
- Create: `skills/draw/scripts/bin/labs-ui/` (built, committed)
- Create: `skills/draw/scripts/tests/labs-ui.test.mjs` (jsdom: `dom.mjs`, `store.mjs`, the views against a stand-in API)
- Create: `skills/draw/scripts/tests/labs-ui-e2e.test.mjs` (Playwright where it is found, skipped otherwise, as `export-e2e.test.mjs` is)
- Modify: `skills/draw/scripts/build.mjs` (the page build)
- Modify: `skills/draw/scripts/tests/bundle-drift.test.mjs` (pages equal a fresh build; size budget; LF)
- Modify: `skills/draw/scripts/src/labs-server.mjs` (the static map and the frame's headers)
- Modify: `.github/workflows/ci.yml` (assert the page files are committed)

## Implementation Steps

1. `dom.mjs`, `store.mjs`, `api.mjs` with jsdom tests; a test that a label holding markup comes out as text.
2. The build and the drift test, before any view, so every later commit is held to it.
3. Navigation and the runs list.
4. Run detail: Picture from `svg/`, Tables, History, Files.
5. The viewer frame for draw.io and Mermaid, with the fallback.
6. The job panel on the event feed, with the question card.
7. Run actions, the draw and recook forms.
8. The model editor: label form, raw JSON, validation, save as a job.
9. The Glossary section. Count the touch points it needed and record them in the success criteria.
10. The Playwright test: list, picture, queue a job against a stand-in agent that answers the bridge, answer a question, see the report; the token-less page; the markup label.
11. Keyboard order, focus on route change, labels of form fields, both colour settings.

## Todo

- [ ] DOM, store and API helpers with tests
- [ ] Page build and drift test
- [ ] Navigation and runs list
- [ ] Run detail tabs
- [ ] Viewer frame and fallback
- [ ] Job panel and question card
- [ ] Run actions, draw and recook forms
- [ ] Model editor
- [ ] Glossary section
- [ ] Playwright test
- [ ] Keyboard and colour pass

## Success Criteria

- The drift test fails when a page source changes without a rebuild.
- The built pages are under 300 KB in total.
- A label `<img src=x onerror=...>` is shown as those characters and runs nothing; the same for a report.
- Opened without the fragment, the page asks for the URL of `labs status` and makes no API call that succeeds.
- With no agent, queueing a job shows it as waiting under "No agent attached"; no spinner without a text beside it.
- A question asked by the stand-in agent appears within a second of the event; the answer reaches the agent's `ask`.
- "Save" stays disabled for an IR with a validation error.
- A run with `svg/` shows its picture with the network off.
- The frame cannot call `/api/state` (the test tries from inside it and gets 403).
- Glossary was added with one navigation entry, one view module, one route group and one job kind.

## Risk Assessment

| Risk | Signal | Response |
|---|---|---|
| The viewer does not draw in a frame with an opaque origin, or needs more hosts for stencils | The viewer test shows an empty frame, or icons are missing on the AWS fixture | Allow the further host of the viewer in the frame's source list; if the sandbox itself is the cause, show pictures from `svg/` only and offer Export. |
| Plain modules become hard to follow as views grow | A view passes 300 lines or state is copied between views | Split the view; the framework question of `plan.md` is the fallback and is cheap to take up, since views only use `h` and the store. |
| Playwright is not in CI | The e2e test is skipped there | The jsdom tests carry the logic; the Playwright round is run and recorded in phase 6. |

## Security Considerations

- The token lives in the tab's session storage and in memory. A script from another
  origin never runs in the console's page: the policy allows the console's own files only.
- The viewer script comes from a third party and runs only inside the sandboxed frame.
- Downloads are sent as attachments with `nosniff`; an SVG is shown as an image, where a
  script inside it does not run.
