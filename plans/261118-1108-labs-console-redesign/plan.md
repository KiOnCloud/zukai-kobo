---
title: "Labs console redesign"
status: done
branch: claude/loving-meitner-lwv6yc
---

# Labs console redesign

## Outcome

The labs console (`skills/draw/scripts/src/labs-ui/`) reads as a complete product rather than
a minimal shell: the preset options of a new diagram are real choices with their meaning shown,
the agent panel is a working surface that can be closed, and the screens a user needs between
the agent session and the files exist.

## Problems found in 2.4.0 (screenshots at 1440 px)

- New diagram: four selects default to "Let the agent ask", a non-choice shown as a choice;
  kinds are raw identifiers (`er`, `usecase`); the target, the tables and the pictures carry
  no explanation; nothing says what the agent will still ask.
- Agent rail: always 280 px wide, mostly a paragraph of help; the agent state is shown twice
  (rail and sidebar foot); a question card is squeezed into the rail; reports pile up there.
- Missing screens: no overview, no job list or job page (a report can only be read in the
  rail), no review of glossary suggestions, no glossary check of a run beside the run, no
  record of the questions already answered, no stale-source detail, no theme choice.

## Constraints

- Sienna stays the design system; `app.css` keeps to its tokens (`sienna.test.mjs`).
- The server and its API do not change: every new screen reads routes that exist.
- Text from the server enters as text only (`dom.mjs`); glyphs are drawn by the console.
- The e2e and jsdom contracts keep holding: `.zl-shell`, `iframe.zl-frame`, the label
  "Revise this run", the buttons "Revise", "Send answers", "Validate", "Save changes",
  one clay element in view while a question is open.

## Non-goals

- No change to jobs, the bridge, the glossary store or the viewer frame.
- No new dependency and no framework.

## Brief

```text
Register:  Product
Scene:     A developer beside a Claude Code terminal on a laptop, glancing between the agent
           session and the console to queue diagram jobs, answer the agent and review
           results; office daylight, intermittent attention.
Direction: Drafting table: Sienna's warm paper and ink hairlines, because the content is
           diagrams and the console should read like the sheet they are drawn on.
Color:     Restrained; bg surface-100 #faf9f5, text ink #141413, accent clay #d97757 for the
           one action that moves work and for the agent's question.
Type:      Newsreader display + Instrument Sans UI + JetBrains Mono ids; serif vs grotesque.
Signature: A line-drawn glyph per diagram kind (lifelines, crow's feet, compartments) used in
           the kind picker, the run cards and the diagram list of a run.
Dials:     variance 3, motion 2, density 6.
```

## Screens

| Route | Screen |
|---|---|
| `#/overview` | Project overview: what needs you, starting points, recent runs, recent jobs |
| `#/diagrams` | Runs as cards or a table, search, kind and state filters |
| `#/diagrams/new[/<mode>]` | New diagram: choice tiles, kind glyphs, live summary of the job |
| `#/diagrams/recook` | Recook with the same output choices |
| `#/diagrams/<run>/<tab>` | Run: diagram list, stale sources, Picture, Model, Tables, History, Files, Glossary |
| `#/jobs` | Every job with state filters |
| `#/jobs/<id>` | One job: request, question, answered questions, steps, report, failure and undo |
| `#/glossary/<tab>` | Entries, Review suggestions, Check a run |

## Acceptance

- [x] Every route above renders with the sample project of `tests/labs-project.mjs` at 375,
      768 and 1440 px with no horizontal overflow and no console error.
- [x] The agent panel can be closed and opened; a waiting question is announced in the page
      while it is closed.
- [x] `npm test` passes; changed tests change only where the contract changed (the section list, the landing route).
- [x] `bin/labs-ui/` is rebuilt and the drift test passes.
