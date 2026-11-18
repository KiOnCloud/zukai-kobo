---
phase: 4
title: "Phase 4: Console shell, runs and jobs"
status: todo
priority: P1
effort: "2d"
dependencies: [2, 3]
---

# Phase 4: Console shell, runs and jobs

<!-- Updated: Red Team Session 1 - the console is built in two phases; state is polled; the question card takes up to four questions and a body; a failed job shows the revisions written since it started -->
<!-- Updated: Validation Session 1 - Tables, Files and Changes since are kept -->

## Overview

The pages the server serves, first half: the build, the navigation, the list of runs, the
read-only tabs of a run, the job panel and the forms that queue jobs. Plain ES modules,
built by esbuild into committed files under `scripts/bin/labs-ui/`, with a drift test
like the one of the CLI bundle. The viewer, the model editor and the Glossary section
follow in phase 5.

## Context

- The installers copy `scripts/bin` whole and remove `scripts/src` (`install.sh:176-186`),
  so the built pages go to `bin/labs-ui/` and their sources to `src/labs-ui/`.
- The CLI bundle is 2,768,504 bytes of a 3 MiB budget (`bundle-drift.test.mjs:16`), which
  leaves about 377 KB; the pages are files beside it, not text inside it.
- A label, a title, a request, a question and a report are text from outside: a recooked
  diagram brings the words of whoever drew it. None of it may reach the page as markup.

## Requirements

- [ ] The token is read from the URL fragment once, kept for the tab, removed from the address bar and sent as `X-Zukai-Token`.
- [ ] No data from the server is ever set as HTML; every text goes in as a text node.
- [ ] The state of the agent is always visible; with no agent the page says "No agent attached" and how to attach one.
- [ ] A job that waits for the user shows its text and its questions and takes the answers in the page.
- [ ] A failed job says why, and which revisions of its run were written while it ran.
- [ ] A run shows its picture from `svg/` without the network.
- [ ] A further section joins through one entry in the navigation list and one view module.
- [ ] The built files are deterministic and equal a fresh build, byte for byte.

## Design

### Files

```text
src/labs-ui/
  index.html
  main.mjs            start: token, navigation, state polling
  api.mjs             fetch with the token; errors as values
  store.mjs           one state object with subscribe; no library
  dom.mjs             h(tag, props, ...children): text nodes only, no innerHTML
  nav.mjs             the list of sections: [{ id, label, view }]
  views/runs-list.mjs
  views/run-detail.mjs      tabs: Picture, Tables, History, Files (Model in phase 5)
  views/new-diagram.mjs     draw and recook forms
  views/job-panel.mjs       agent state, queue, progress, question card, report
  app.css
bin/labs-ui/                the built copies: index.html, app.js, app.css
```

### Navigation

`nav.mjs` is an array with one entry, Diagrams, in this phase. The route of a section is
`#/<id>/...`. There is no loader and no registry.

### State

`main.mjs` asks `GET /api/state` every 1.5 seconds while the tab is visible and reloads a
view's data when the change counter moved. A 403 means the server was started again: the
page says so and asks for the URL that `labs status` prints.

### Diagrams

- Runs list: date, title, kinds, targets, revisions, a stale mark for a scouted run, a
  filter by text. "New diagram" and "Recook" open their forms.
- Run header: Revise (request text, with "preview as drafts"), Undo, Redo, Sync (a scouted
  run only), Export (pictures, tables). Each queues a job. Undo and Redo show the revision
  the server names as the target and are disabled when it names none.
- Picture: one diagram at a time with a page list, from `svg/<id>.drawio.svg` when it is
  there and not older than the IR, shown as an image from a blob. Otherwise a sentence
  that there is no picture yet, with the Export button; the live viewer comes in phase 5.
- Tables: the description tables as text in a fixed-width block, with a language choice.
- History: revisions newest first as `rNNN · date · request`, "Restore" per revision,
  "Changes since" as the list `diffRun` gives.
- Files: the listed files with size and date and the path to copy; `.drawio` downloads.

### New diagram and recook

The draw form takes what the opening question would ask: mode, request, target, kind,
scope, audience, pictures, tables. Kind may be left open; the agent then asks through the
job. The recook form takes a file inside the project or a board link, and the same options.

### Job panel

- Agent state as one line: "No agent attached: run /zukai:labs in your terminal", "Agent
  waiting", "Agent working on <job>", "No word from the agent for <n> min".
- The queue in order, each waiting job with Cancel.
- The open job with its progress lines; when the agent is silent, "Mark as failed".
- A question card: the body as plain text in a scrolling block, then each question with
  its header, one button per option with its description and a field for another answer;
  an attached file of the run as a link into the Files tab, an attached file of the
  job's folder as a text block under the body. One "Send" for the whole card.
- A closed job with its report as plain text. A failed one with its reason in words and,
  for a run, "Revisions written while this job ran: rNNN" with "Undo to rNNN".

### Build

`build.mjs` gets a second set of options for the pages (browser, ESM, no hashes in file
names, whitespace minified) and `uiFiles()` for the drift test. `npm run build` writes
the CLI bundle and the pages. The bundled CLI finds its page folder with
`new URL('./labs-ui/', import.meta.url)` and reads it into memory once (phase 2); tests
pass the folder in.

## Files to Create / Modify

- Create: `skills/draw/scripts/src/labs-ui/` (the eleven files above)
- Create: `skills/draw/scripts/bin/labs-ui/index.html`, `app.js`, `app.css` (built, committed)
- Create: `skills/draw/scripts/tests/labs-ui.test.mjs` (jsdom: `dom.mjs`, `store.mjs`, the views against a stand-in API)
- Modify: `skills/draw/scripts/build.mjs` (the page build)
- Modify: `skills/draw/scripts/tests/bundle-drift.test.mjs` (pages equal a fresh build; size budget; LF)
- Modify: `skills/draw/scripts/src/labs-server.mjs` (the static map)
- Modify: `.github/workflows/ci.yml` (assert the page files are committed)

## Implementation Steps

1. The build and the drift test, before any view, so every later commit is held to it.
2. `dom.mjs`, `store.mjs`, `api.mjs` with jsdom tests; a test that a label holding markup comes out as text.
3. Token handling and the page shown without one.
4. Navigation and the runs list.
5. Run detail: Picture from `svg/`, Tables, History with "Changes since", Files.
6. The job panel on the polled state, with the question card for one to four questions.
7. Run actions, the draw and recook forms.
8. The failed-job view with the revisions written since.

## Todo

- [ ] Page build and drift test
- [ ] DOM, store and API helpers with tests
- [ ] Token handling
- [ ] Navigation and runs list
- [ ] Run detail tabs
- [ ] Job panel and question card
- [ ] Run actions, draw and recook forms
- [ ] Failed-job view

## Success Criteria

- The drift test fails when a page source changes without a rebuild; the built pages are under 300 KB in total.
- A label, a question body and a report that hold `<img src=x onerror=...>` are shown as those characters and run nothing.
- Opened without the fragment, the page asks for the URL of `labs status` and no API call succeeds.
- With no agent, queueing a job shows it as waiting under "No agent attached"; no spinner without a text beside it.
- A card with three questions sends three answers in one request; the stand-in agent receives them in order.
- A job closed as `server-stopped` shows its reason and the revision written since it started.
- A run with `svg/` shows its picture with the network off.
- Every view of this phase is reachable and usable with the keyboard alone.

## Risk Assessment

| Risk | Signal | Response |
|---|---|---|
| Plain modules become hard to follow as views grow | A view passes 300 lines or state is copied between views | Split the view. Views use only `h` and the store, so a move to a small library later touches `dom.mjs` and `store.mjs` first. |
| Polling every 1.5 s is felt on a large project | `GET /api/state` takes more than 100 ms in the round of phase 7 | State holds counts and the open job only; lists are loaded when the counter moves. |

## Security Considerations

- The token lives in the tab's session storage and in memory. The policy of phase 2
  allows the console's own files only, so no script from another origin runs in the page.
- Downloads are sent as attachments with `nosniff`; an SVG is shown as an image, where a
  script inside it does not run.
