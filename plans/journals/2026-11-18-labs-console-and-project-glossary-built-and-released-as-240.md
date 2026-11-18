---
title: Labs console and project glossary built and released as 2.4.0
date: 2026-11-18
summary: "Seven phases of the labs console plan implemented; viewer trial, independent review and end-to-end round each changed the build"
---

# Labs console and project glossary built and released as 2.4.0

## What happened
The plan `plans/261118-0518-zukai-labs-console` was carried out in full on the working branch:
a project glossary (`.zukai/glossary.json`, `glossary list|add|set|pairs|check`), a local
server on 127.0.0.1 (`labs start|status|stop`), a job queue with a bridge for the attached
agent (`labs wait|progress|ask|done|holds`), console pages on the Sienna design system, a
sandboxed viewer frame, a Model tab and a Glossary section, the fifth skill `/zukai:labs`,
the documents and version 2.4.0. Phase 6 ran in a parallel worktree and was merged.

## What the checks found
- Viewer trial: a sandboxed page has an opaque origin, so its own script from the console's
  host failed (module script: CORS; classic script: Opaque Response Blocking). The script is
  now inlined and allowed by hash. AWS stencils need `connect-src https://viewer.diagrams.net`.
  draw.io's viewer draws nothing in a box without width; the frame shows the viewer's SVG.
- Fonts were 620 KB against a 400 KB budget; pinning the axes Sienna uses gave 308 KB.
  Instrument Sans has no Vietnamese or Japanese letters (open for the user).
- Independent review: files under `.zukai/` were trusted although a clone can ship them; a
  forged job id reached a recursive delete outside the project, a log link truncated a user
  file, a dangling lock link froze the server. Fixed in 0b08276 with regression tests.
- End-to-end round (`plans/reports/e2e-261118-labs.md`): acceptance 1-5, 7, 8 passed;
  acceptance 6 failed in part (agent shown as attached after it left; silent job shown only
  after reload). Fixed with the round's other findings in 61e24d4.
- Tooling pitfall: the Write tool turned `\uXXXX` escapes in regex literals into raw
  characters; U+2028 then broke a regex. Swept and replaced with escapes.

## Decision
Every change to a run stays a job for the attached agent; the server writes only `.zukai/`.
The README now says plainly that the viewer frame may reach viewer.diagrams.net.

## Next steps
- User decision: a sans family in Sienna that covers Vietnamese and Japanese.
- Not run: a Codex round, the plugin layout; `install-ps1.test.mjs` waits for the Windows CI job.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
