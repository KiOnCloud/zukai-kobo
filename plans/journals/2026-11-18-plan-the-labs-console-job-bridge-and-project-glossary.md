---
title: "Plan the labs console, job bridge and project glossary"
date: 2026-11-18
summary: "Hard-mode plan for /zukai:labs, revised after four adversarial reviews and four user decisions; no code changed."
---

# Plan the labs console, job bridge and project glossary

## What happened

- Brainstormed `/zukai:labs`: a console on `127.0.0.1` for the runs under `diagrams/`, with the agent reached through a queue in the open session, and a project glossary at `.zukai/glossary.json`. The contract was accepted with every default.
- Wrote the plan under `plans/261118-0518-zukai-labs-console/` and had four reviewers attack it (security, failure modes, assumptions, scope). 37 raw findings merged into 15, all with file and line evidence, all accepted; four parts of them were rejected with reasons.
- The first draft was wrong in ways the review caught: a guard on `snapshot` and `restore` that missed most write paths, a resume of dead jobs that could deliver a half-applied change as done, a question format that could not hold the four-question opening of draw, a content policy that blocked the console's own pictures, and a claim that the skills already treat diagram text as data, which no skill says.

## Decision

- The server never writes under `diagrams/`; every change of a run is a job the attached agent carries out with the existing skill. An undo is a hand-edit check, a restore and the closing contract, so a server copy would be a second implementation.
- Cross-session protection is the advisory `labs holds <run>`, chosen by the user over a lock: the agent edits IR files with its own file tool, so no CLI lock can be complete.
- A job that died is closed as failed and never taken up again.
- The server is a detached child with an idle end and `labs stop`, confirmed by the user against the personal rule that prefers the harness's background run.
- Tables, Files and "Changes since" stay in the console, added by the user beyond the wording of the request.
- The console is built in two phases; the viewer frame is tried in a sandbox before anything is built on it.

## Next steps

- Implement from `plans/261118-0518-zukai-labs-console/plan.md`, phase 1 first (the glossary can be released alone).
- Still unverified: a variable that marks a Codex cloud task; whether draw.io's viewer draws inside a sandboxed frame with no connection out.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
