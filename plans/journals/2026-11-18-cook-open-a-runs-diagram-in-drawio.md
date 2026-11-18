---
title: "Cook: open a run's diagram in draw.io"
date: 2026-11-18
summary: "cli open, the console's Open in draw.io and the closing question shipped on the branch as 2.4.1; real embed host framed by a file:// page; review fixes for consent, Windows and crashes"
---

# Cook: open a run's diagram in draw.io

## What happened
Implemented all three phases of `plans/261118-0954-open-in-drawio`: `cli open` and
`open --check` (`open-drawio.mjs`, `drawio-embed.mjs`), the console's Open in draw.io, the
closing contract's step 8 and the labs card, docs and version 2.4.1. The plan's open question
was settled in this cloud session: Playwright Chromium with a desktop user agent framed the
real `embed.diagrams.net` from a `file://` page (it sends no `frame-ancestors`), loaded an
872 KB, 74-page bundle and saved it back through `save`/`status`.

## Review
An independent review found no critical defect. Fixed: the closing question now runs
`open --desktop` or `--web` to match the route offered (an unflagged `open` could fall through
to diagrams.net); Windows opens with `explorer.exe` by full path instead of `cmd /c start`
(cmd parses `& ^ %`, and a bare `cmd` resolves in the working directory first); no
`--no-sandbox` on the interactive desktop window; folder and write errors return JSON.

## Not done
Snap and flatpak browsers cannot read `/tmp`; documented, code unchanged pending a decision.
The skill round in a local session and the PR remain.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
