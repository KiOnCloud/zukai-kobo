---
title: "Plan: open a run's diagram in draw.io"
date: 2026-11-18
summary: "Brainstorm and plan for Open in draw.io from the console and a closing question in the chat; diagram handed over by postMessage, not URL"
---

# Plan: open a run's diagram in draw.io

## What happened
Planned `plans/261118-0954-open-in-drawio` (3 phases, version 2.4.1). Trials in this session:
a `#R` URL fragment opens the full editor (16 KB XML -> 3 KB URL) but a 5-diagram run already
passes Windows' 8,191-character command line and the diagram would sit in browser history;
draw.io's embed protocol over `postMessage` loaded an 845 KB, 72-page file with a 77-character
URL. Embed mode on app.diagrams.net is being retired in favour of embed.diagrams.net, which
answers 403 to headless browsers, so tests use a stand-in host and the real host is a local gate.

## Decision
Desktop first when installed; otherwise an opener page (frame, popup button as fallback) or a
console popup. Save on the web downloads only. Inside a labs job the closing question is a
console card. A force push of the restarted branch was refused; the old branch history was
merged instead.

## Next steps
`/ak-cook plans/261118-0954-open-in-drawio/plan.md`; the local gate on embed.diagrams.net first.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
