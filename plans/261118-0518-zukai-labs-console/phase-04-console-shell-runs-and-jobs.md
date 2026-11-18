---
phase: 4
title: "Phase 4: Console shell, runs and jobs"
status: todo
priority: P1
effort: "2.5d"
dependencies: [2, 3]
---

# Phase 4: Console shell, runs and jobs

<!-- Updated: Red Team Session 1 - the console is built in two phases; state is polled; the question card takes up to four questions and a body; a failed job shows the revisions written since it started -->
<!-- Updated: Validation Session 1 - Tables, Files and Changes since are kept -->
<!-- Updated: Validation Session 2 - the console is built on the Sienna design system: its tokens, stylesheet and helpers are copied in, its fonts are served by the console, its rules for colour, type, layout and wording apply to every view -->

## Overview

The pages the server serves, first half: the Sienna design system brought into the
build, the navigation, the list of runs, the read-only tabs of a run, the job panel and
the forms that queue jobs. Plain ES modules, built by esbuild into committed files under
`scripts/bin/labs-ui/`, with a drift test like the one of the CLI bundle. The viewer, the
model editor and the Glossary section follow in phase 5.

## Context

- The installers copy `scripts/bin` whole and remove `scripts/src` (`install.sh:176-186`),
  so the built pages go to `bin/labs-ui/` and their sources to `src/labs-ui/`.
- The CLI bundle is 2,768,504 bytes of a 3 MiB budget (`bundle-drift.test.mjs:16`), which
  leaves about 377 KB; the pages are files beside it, not text inside it.
- A label, a title, a request, a question and a report are text from outside: a recooked
  diagram brings the words of whoever drew it. None of it may reach the page as markup.

Sienna, the design system the user chose (read on 2026-11-18, version `1794980790-4acd`;
it is one of the user's Design System artifacts and is found there by its name):

- It is made for pages without a framework: a stylesheet with a class contract
  (`components/bundle.css`, 21 KB, every class `sn-*`, state from native attributes) and a
  helper script (`components/bundle.js`, 18 KB, one classic script that sets
  `window.Sienna`) whose functions return DOM elements: Button, Input, Select, Checkbox,
  Radio, Switch, Chip, Badge, Card, Alert, Tabs, Table, Menu, Dialog, Avatar, Tooltip and
  `icon` (19 stroke icons). The helpers put text in as text nodes.
- `tokens.json` holds colours in a light and a dark theme (switched by `data-theme` on
  `<html>`), a type scale in three families, spacing, radius, shadow and size tokens. The
  compiled `tokens.css` is made by the artifact's page and is not among its files; its
  shape is documented (`:root, [data-theme="light"]` for colours and shadows, a
  `[data-theme="dark"]` block, `:root` for the rest and `--font-<key>`, one class per
  type style).
- The stylesheet's first line imports its three families from Google Fonts (Newsreader,
  Instrument Sans, JetBrains Mono); `type.fonts` lists no file. It draws the glyphs of
  checkboxes and selects as `data:` pictures, and two helpers (Card, Alert) set a `style`
  attribute. Each of the three meets the content policy of phase 2.
- Instrument Sans, the family of every control, label and table cell, is published with
  the `latin` and `latin-ext` subsets only (Fontsource listing, looked up 2026-11-18). A
  Vietnamese label would take its accented letters from the next family of the stack,
  and a Japanese one every letter.
- Its rules that bear on this console: paper surfaces parted by hairlines, no shadow
  unless something floats; serif for a page's statement, sans for everything operated;
  one clay element in view at a time; a status colour always with a word or an icon, and
  never a green beside a red; one primary button per view; sentence case, verb-first
  buttons, an error that says what happened and what to do; tables without stripes, with
  status as a Badge and numbers right-aligned; forms in one column with the primary
  action last.

## Requirements

- [ ] The token is read from the URL fragment once, kept for the tab, removed from the address bar and sent as `X-Zukai-Token`.
- [ ] No data from the server is ever set as HTML; every text goes in as a text node, and no data is used as a link address, a class or a style.
- [ ] Every colour, length, radius and shadow in the console's own styles is a Sienna token; no value is written out.
- [ ] Every control is a Sienna component; the console adds layout, never a second button or table style.
- [ ] The copied Sienna files are not edited; a check holds them to the version they were copied from.
- [ ] The console loads nothing from another host: its fonts are its own files.
- [ ] Light and dark follow the system's setting through `data-theme`.
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
  sienna/
    tokens.json           copied from the design system, unchanged
    bundle.css            copied, unchanged
    bundle.js             copied, unchanged
    index.d.ts            copied, unchanged (the reference for the helpers' options)
    sienna.lock.json      the version copied and a SHA-256 of each of the four files
  fonts/                  woff2 files of the three families, with their licence texts
  index.html
  main.mjs                start: token, theme, navigation, state polling
  api.mjs                 fetch with the token; errors as values
  store.mjs               one state object with subscribe; no library
  dom.mjs                 h(tag, props, ...children) for layout: text nodes only, no innerHTML
  nav.mjs                 the list of sections: [{ id, label, view }]
  views/runs-list.mjs
  views/run-detail.mjs    tabs: Picture, Tables, History, Files (Model in phase 5)
  views/new-diagram.mjs   draw and recook forms
  views/job-panel.mjs     agent state, queue, progress, question card, report
  app.css                 the shell's layout, in tokens only
bin/labs-ui/              built: index.html, app.js, app.css, fonts/
```

### Sienna in the build

- `build.mjs` compiles `tokens.css` from `sienna/tokens.json` in the documented shape and
  writes `app.css` as: the `@font-face` rules of `fonts/`, the compiled tokens, Sienna's
  stylesheet without its first line (the import from Google Fonts), then the console's
  own `app.css`. `app.js` holds Sienna's script, then the console's modules; views call
  `window.Sienna`.
- A test reads every `var(--name)` of Sienna's stylesheet and of `app.css` and finds each
  one defined by the compiled tokens, in both themes.
- A test holds the four copied files to the hashes of `sienna.lock.json`. Taking a newer
  Sienna is: copy the four files again, write the new version and hashes, rebuild.
- Fonts: the three families as woff2 files served by the console, in the weights and
  styles Sienna uses (Newsreader 400 and 400 italic with its optical size axis,
  Instrument Sans 400 to 600, JetBrains Mono 400 and 500), cut to the subsets each
  family is published with for Latin and Vietnamese text. Budget: 400 KB for the folder,
  apart from the 300 KB of the pages.
- The content policy of phase 2 allows what Sienna needs and nothing else:
  `font-src 'self'`, `data:` in `img-src`, `style-src-attr 'unsafe-inline'`.

### Shell

- A sidebar of the `sidebar` width on `surface-200` with a `border` on its right: the
  product name "Zukai Labs" in `heading-md` at the top (Sienna has no logo, and this
  phase adds none), the sections of `nav.mjs` as menu items with the selected one on
  `clay-soft`, and the agent's state at the foot.
- Content on `surface-100`, up to the `container` width, aligned to one left edge.
- The job panel as a rail on the right, on `surface-000` behind a `border`; under 1100 px
  of width it moves below the content.
- A page title in `display-md` with an `eyebrow` above it (for a run: its date and
  origin; the title is the run's title, the run's folder name follows in `code`).
- `main.mjs` sets `data-theme` from the system's colour setting and follows its changes.

### Which Sienna part is used where

| Part of the console | Sienna |
|---|---|
| Runs list, History, Files | `Table`: the first column is the link, status in a column of its own as a `Badge`, counts and sizes numeric, row actions as ghost icon buttons in the last column, 50 rows a page with "Previous" and "Next" |
| Tabs of a run | `Tabs`, underline (four here, five with Model) |
| Run actions | `Button`: "Revise" is the one `primary`; "Undo", "Redo", "Sync", "Export" are `secondary`; "Mark as failed" is `danger` |
| Request for a revise, forms for a new diagram and a recook | `Input` (multiline for the request), `Select`, `Radio`, `Checkbox`, `Switch`, in one column, labels above, the action at the bottom right |
| The send button of a request and of a question card | `Button` as the clay disc (`accent`, `round`, icon `arrow-up`). It is the one clay element in view: while a question card is open, the request composer is not shown |
| Question card | `Card` with the body in a `surface-200` block in the `code` style, each question as a `Radio` group or `Checkbox`es with their descriptions, an `Input` for another answer |
| Agent state | `Badge` with a dot and words: neutral "No agent attached", info "Agent working on …", warning "No word from the agent for 16 min", neutral with a check icon "Agent waiting" |
| Job state | `Badge`: queued neutral, running info, waiting for an answer warning, failed danger with the alert icon, done neutral with the check icon (Sienna sets no green beside a red), cancelled neutral outline |
| Stale mark of a scouted run | `Badge`, warning, "Behind the code" |
| A message of the console (the server was started again, a job was refused) | `Alert`, in the words "what happened, then what to do" |
| A list with nothing in it | one line in `display-sm` and one `secondary` button ("No runs yet", "New diagram") |
| Confirmation before "Mark as failed" and before a restore of an old revision | `Dialog` |
| Run ids, revision names, file paths, the description tables | the `code` style; the tables in a `surface-200` block |
| Icons | `Sienna.icon`; a glyph it lacks is a Lucide path at the same stroke, inline |

### Wording

Sentence case everywhere. A button starts with a verb and is never "OK" or "Yes": "Revise",
"Undo to r006", "Export pictures", "Send answers", "Mark as failed". No exclamation mark,
no emoji. Dates are written out in the reader's locale. The console's own words are
English; labels, requests and reports are shown as they are.

### Navigation

`nav.mjs` is an array with one entry, Diagrams, in this phase. The route of a section is
`#/<id>/...`. There is no loader and no registry.

### State

`main.mjs` asks `GET /api/state` every 1.5 seconds while the tab is visible and reloads a
view's data when the change counter moved. A 403 means the server was started again: an
`Alert` says so and asks for the URL that `labs status` prints.

### Diagrams

- Runs list: date, title, kinds, targets, revisions, the stale mark, a search `Input`
  that filters by text. "New diagram" and "Recook" open their forms.
- Run header: the actions of the table above, each queueing a job. Undo and Redo name
  the revision the server gives as the target and are disabled when it gives none.
- Picture: one diagram at a time with a page list, from `svg/<id>.drawio.svg` when it is
  there and not older than the IR, shown as an image from a blob on a white ground in
  both themes (a diagram is drawn for white), framed at `radius-xl` with a `border`.
  Otherwise the empty-list line "No picture yet" with "Export pictures"; the live viewer
  comes in phase 5.
- Tables: the description tables, with a `Select` for the language.
- History: revisions newest first as `rNNN`, date, request; "Restore" per revision;
  "Changes since" as the list `diffRun` gives.
- Files: the listed files with size and date and the path to copy; `.drawio` downloads.

### Job panel

- The queue in order, each waiting job with a ghost "Cancel".
- The open job with its progress lines; when the agent is silent, "Mark as failed".
- The question card of the table above; an attached file of the run as a link into the
  Files tab, an attached file of the job's folder as a text block under the body. One
  send for the whole card.
- A closed job with its report as plain text. A failed one with its reason in words and,
  for a run, "Revisions written while this job ran: r007" with "Undo to r007".

### Build

`build.mjs` gets a second set of options for the pages (browser, ESM, no hashes in file
names, whitespace minified), the steps of "Sienna in the build", and `uiFiles()` for the
drift test. `npm run build` writes the CLI bundle and the pages. The bundled CLI finds
its page folder with `new URL('./labs-ui/', import.meta.url)` and reads it into memory
once (phase 2); tests pass the folder in.

## Files to Create / Modify

- Create: `skills/draw/scripts/src/labs-ui/sienna/` (four copied files and `sienna.lock.json`)
- Create: `skills/draw/scripts/src/labs-ui/fonts/` (the woff2 files and the licence text of each family)
- Create: `skills/draw/scripts/src/labs-ui/` (`index.html`, `app.css` and the nine modules above)
- Create: `skills/draw/scripts/src/sienna-tokens.mjs` (tokens to CSS, used by `build.mjs`)
- Create: `skills/draw/scripts/bin/labs-ui/index.html`, `app.js`, `app.css`, `fonts/` (built, committed)
- Create: `skills/draw/scripts/tests/labs-ui.test.mjs` (jsdom: `dom.mjs`, `store.mjs`, the views against a stand-in API)
- Create: `skills/draw/scripts/tests/sienna.test.mjs` (the lock, the compiled tokens, every variable defined, no value written out in `app.css`)
- Modify: `skills/draw/scripts/build.mjs` (the page build)
- Modify: `skills/draw/scripts/tests/bundle-drift.test.mjs` (pages equal a fresh build; size budgets; LF)
- Modify: `skills/draw/scripts/src/labs-server.mjs` (the static map with the fonts; the three additions to the content policy)
- Modify: `.github/workflows/ci.yml` (assert the page files are committed)

## Implementation Steps

1. Copy the four Sienna files from the design system and write `sienna.lock.json`.
2. `sienna-tokens.mjs` and its test: the documented shape, both themes, every variable of Sienna's stylesheet defined.
3. The fonts: take the woff2 files of each family from its publisher with the licence text; record family, version, subsets and licence. Check with a Vietnamese and a Japanese label which letters each family draws; record the result in this plan.
4. The build and the drift test, before any view, so every later commit is held to it.
5. `dom.mjs`, `store.mjs`, `api.mjs` with jsdom tests; a test that a label holding markup comes out as text, also through each Sienna helper the console uses.
6. Token handling, the theme, the shell, the page shown without a token.
7. Navigation and the runs list.
8. Run detail: Picture from `svg/`, Tables, History with "Changes since", Files.
9. The job panel on the polled state, with the question card for one to four questions.
10. Run actions, the draw and recook forms.
11. The failed-job view with the revisions written since.
12. A pass over every view against the table "Which Sienna part is used where" and the wording rules, in both themes.

## Todo

- [ ] Sienna copied and locked
- [ ] Tokens compiled and tested
- [ ] Fonts taken in, with licences and the coverage check
- [ ] Page build and drift test
- [ ] DOM, store and API helpers with tests
- [ ] Token handling, theme and shell
- [ ] Navigation and runs list
- [ ] Run detail tabs
- [ ] Job panel and question card
- [ ] Run actions, draw and recook forms
- [ ] Failed-job view
- [ ] Sienna pass over every view

## Success Criteria

- The drift test fails when a page source changes without a rebuild; the built pages are under 300 KB and the fonts under 400 KB.
- The Sienna test fails when one of the four copied files differs from its hash, when a variable is used and not defined, and when `app.css` holds a colour or a length that is not a token.
- With the network off, the console looks the same as with it on; the browser asks no other host for anything.
- No message of the browser's console reports a blocked style, picture or font under the content policy.
- At most one clay element is in view in every state of every view; one primary button a view.
- A label, a question body and a report that hold `<img src=x onerror=...>` are shown as those characters and run nothing.
- Opened without the fragment, the page asks for the URL of `labs status` and no API call succeeds.
- With no agent, queueing a job shows it as waiting under "No agent attached"; no spinner without a text beside it.
- A card with three questions sends three answers in one request; the stand-in agent receives them in order.
- A job closed as `server-stopped` shows its reason and the revision written since it started.
- A run with `svg/` shows its picture on a white ground in the dark theme too.
- Text reaches 4.5:1 against its ground in both themes for every view; every view is usable with the keyboard alone, with Sienna's focus ring visible.

## Risk Assessment

| Risk | Signal | Response |
|---|---|---|
| Vietnamese and Japanese labels are drawn in two families at once, since Instrument Sans has no letters for them | Step 3 shows accented Vietnamese letters or kana in the fallback family inside a word | Record it and ask: the fix is a family in Sienna's `sans` stack that covers them, which is a change of the design system, not of this console. The console keeps Sienna's stack until then. |
| The copy of Sienna falls behind the design system | The design system's version is newer than the lock | Taking it is a copy, a lock and a rebuild; the Sienna test and the drift test are the gate. Nothing in the console overrides a Sienna rule, so a new version needs no merge. |
| A Sienna helper lacks what a view needs (a page control, a text block for code) | A view would need a second style for a control | Build it from Sienna's classes and tokens in `app.css`; propose it for the design system; never copy a Sienna rule to change it. |
| `style-src-attr 'unsafe-inline'` is wider than the console needs | A later view sets a `style` attribute from data | The rule that no data is used as a style is tested with the markup label; only Sienna's helpers set the attribute, with fixed text. |
| Plain modules become hard to follow as views grow | A view passes 300 lines or state is copied between views | Split the view. Views use Sienna's helpers, `h` and the store, so a later move to a small library touches `dom.mjs` and `store.mjs` first. |
| Polling every 1.5 s is felt on a large project | `GET /api/state` takes more than 100 ms in the round of phase 7 | State holds counts and the open job only; lists are loaded when the counter moved. |

## Security Considerations

- The token lives in the tab's session storage and in memory. The policy of phase 2
  allows the console's own files only, so no script, style or font from another host
  runs in or is fetched by the page.
- Sienna's script is copied code that runs with the console's rights. It is read before
  it is copied, held to its hash afterwards, and takes no data as markup: its helpers
  set text as text. A link address passed to a helper is built by the console from ids,
  never taken from a diagram.
- Downloads are sent as attachments with `nosniff`; an SVG is shown as an image, where a
  script inside it does not run.
