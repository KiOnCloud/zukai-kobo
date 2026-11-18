---
phase: 3
title: "Phase 3: Job queue and agent bridge"
status: todo
priority: P1
effort: "2d"
dependencies: [2]
---

# Phase 3: Job queue and agent bridge

<!-- Updated: Red Team Session 1 - no requeue, no resume, cancel for a waiting job only, question file with up to four questions and a body, one ask per id, a timeout is never an answer, contact rules, held calls capped at nine minutes, no new exit code, state polling in place of an event feed -->
<!-- Updated: Validation Session 1 - advisory `labs holds` in place of a guard on `snapshot` and `restore` -->

## Overview

The console asks for a change by queueing a job. The agent session that runs
`/zukai:labs` takes one job at a time with `cli labs wait`, carries it out with the
existing skills, asks the user through the console with `cli labs ask` and closes it with
`cli labs done`. The server owns the job state alone. `cli labs holds <run>` lets any
other session see that a job holds a run before it starts a change of its own.

## Context

- The server cannot call the agent. The agent calls the server and blocks until there is
  work, which every runtime that can run a command can do.
- In Claude Code a foreground command may run ten minutes and a background command two
  hours, and the session is woken when a background command exits (the Bash tool of the
  planning session says so). Other runtimes block on a shorter foreground call.
- The skills ask in ways one plain question does not hold. Draw asks up to four questions
  in one call (`skills/draw/SKILL.md:60-62`, `:189-193`). Clarify shows the IR draft and
  then asks, and treats silence as yes where a runtime cannot wait
  (`clarify-protocol.md:19-21`). Consult shows its drafts, asks for the pick and repeats
  until the user confirms (`consult-protocol.md:66-89`).
- A snapshot is taken before the IRs are edited (`skills/revise/SKILL.md:203-206`), so a
  revision written by a job that died proves nothing about how far the change got.
- No command of the CLI can stop a second session from writing a run: drafts, `sources`,
  `export`, `emit` and the agent's own edits of an IR file take no common path
  (`consult-protocol.md:66-93`, `skills/sync/SKILL.md:310-313`,
  `closing-contract.md:93-96`). The protection against that is a check at the start of a
  change, not a lock.

## Requirements

- [ ] One job runs at a time; the next is handed out only when the one before is closed.
- [ ] One agent session is attached at a time; a second is refused while the first is alive.
- [ ] A job is validated when it is queued; an invalid one is refused and never reaches the agent.
- [ ] The queue is bounded: 20 waiting jobs, then 429.
- [ ] Job state survives a restart of the server; a job that was open then is closed as failed, with the reason.
- [ ] A job that died is never taken up again; the console says which revisions were written while it ran.
- [ ] The console can tell "no agent", "agent waiting", "agent working" and "agent silent on a job".
- [ ] One ask can hold up to four questions and a text to read first; a call that ends before the answer is never an answer.
- [ ] Every result of a `labs` command is one JSON object with exit code 0, 1 or 2; no new code is added.
- [ ] Any session can ask whether a job holds a run, without writing anything.
- [ ] Finished jobs are pruned to the latest 50, with their folders.

## Design

### Job record, `.zukai/labs/jobs/<id>.json`

```json
{
  "id": "j20261118-051842-3fa1",
  "kind": "revise",
  "run": "20261109_login-flow",
  "params": { "request": "add a stock check after login", "preview": false },
  "state": "queued",
  "createdAt": "...", "startedAt": null, "finishedAt": null,
  "session": null,
  "progress": [],
  "ask": null,
  "asked": [],
  "report": null,
  "reason": null
}
```

A job may have a folder `.zukai/labs/jobs/<id>/` for the edited IR of an `apply-edit` and
for texts the agent wants shown with a question.

### Kinds

| Kind | Parameters | The skill route it stands for |
|---|---|---|
| `draw` | `mode`, `request`, `to`, `kind?`, `scope?`, `audience?`, `svg?`, `doc?` | draw, with the opening question already answered |
| `revise` | `run`, `request`, `preview?`, `svg?`, `doc?` | revise, direct, consult or new diagram |
| `restore` | `run`, `target` (`undo`, `redo` or `rNNN`) | revise, undo route |
| `apply-edit` | `run`, `diagram`, `baseRev`; the edited IR is stored in the job's folder | revise, direct route with the IR given |
| `sync` | `run` | sync |
| `recook` | `source` (a file inside the project, or a FigJam board link), `to?`, `kind?`, `scope?`, `audience?`, `svg?`, `doc?` | recook |
| `export` | `run`, `svg?`, `doc?` (languages) | the closing contract's picture and table steps |
| `glossary-suggest` | `runs` (ids, or `all`) | `glossary pairs`, then `glossary add` |

Checks when a job is queued: `run` and `diagram` are names from the server's listings;
option values are from the lists the CLI uses (`KINDS`, `EMIT_TARGETS`, `DOC_LANGS`);
`request` has at most 4000 characters and no control character; the IR of an `apply-edit`
passes `validateIr`; a `source` file is relative, and its real path lies inside the
project.

### States

```text
queued ──wait──▶ running ◀──answer── needs-input
   │                │  └──ask──────────▲
   │                └──done──▶ done | failed
   └──cancel──▶ cancelled
running | needs-input ──▶ failed, with a reason:
    server-stopped   the server ended while the job was open
    session-lost     another session took over (see Session)
    not-closed       the session that held it asked for new work
    marked           the user marked a silent job as failed in the console
```

Any other transition is refused with 409. A job that is running is not cancelled from the
console: the user stops the agent in its session, or marks the job failed when the agent
is silent. A failed job is never queued again; the user queues a new one.

For a job with a run, `GET /api/jobs/:id` adds `revisionsSince`: the revisions of that run
that `listRevisions` dates after the job started. The console shows them with a failed
job, because the run may be half changed, and offers Undo to the first of them as a job
of its own.

### Agent routes and commands

| Command | Route | Result on stdout |
|---|---|---|
| `labs wait --session <id> [--timeout <s>]` | `POST /agent/wait` (held open) | `{ "session", "job": {...} }` or `{ "session", "job": null }` when the time is up |
| `labs progress <job> --session <id> --message <text>` | `POST /agent/jobs/:id/progress` | `{ "ok": true }` |
| `labs ask <job> --session <id> --question @<file.json> [--timeout <s>]` | `POST /agent/jobs/:id/ask` (held open) | `{ "answers": [...] }` or `{ "answers": null }` when the time is up |
| `labs done <job> --session <id> --result <done|failed> [--report @<file>]` | `POST /agent/jobs/:id/done` | `{ "ok": true }` |
| `labs holds <run> [--root <project>]` | `GET /agent/holds?run=` | `{ "held": false }`, or `{ "held": true, "job", "kind", "since" }` |

Exit codes stay as they are: 0 for a result, also for "nothing yet"; 1 for an error, with
`{ "error": { "code", "message" } }` on stderr; 2 only for `holds` when the run is held,
as `stale` uses 2 for "there is something". Error codes: `no-server`, `not-this-project`
(the proof of phase 2 failed), `session-refused`, `session-replaced`, `transport`,
`bad-request`. `holds` with no server prints `{ "held": false }` and exits 0.

The server ends a held call after nine minutes with "nothing yet"; `--timeout` can only
shorten that. The client is `node:http` with no timeout of its own, so a held call is
never cut by a default of the HTTP client.

### Question file

```json
{
  "id": "pick-draft-2",
  "body": "Draft A moves approval before payment (3 changes) ...",
  "questions": [
    { "header": "Draft", "question": "Which draft should be applied?",
      "options": [{ "label": "A", "description": "..." }, { "label": "B", "description": "..." }],
      "multiSelect": false }
  ],
  "attachments": ["drafts/a/changes.diff.drawio", "@job/ir-draft.json"]
}
```

- One to four questions, the fields `AskUserQuestion` takes. `body` is plain text shown
  above them: an IR draft, the change lists of drafts.
- An attachment is a file of the job's run (its `drafts/` included) or, with `@job/`, a
  file in the job's folder. The server lists it for the console; it is checked like every
  file parameter of phase 2.
- The answer is `{ "answers": [{ "selected": [labels], "other": text? }] }`, one per question.
- An `id` names one ask. While it is open, the same call fetches its answer after a
  time-out. Once it is answered, the same `id` is refused with `bad-request`, so each
  round of a loop has an id of its own.
- "Nothing yet" is never an answer and never consent.

### Session and contact

`labs start` prints a fresh `session` id with each call, and every answer to the agent
repeats it. Contact of a session is any call it makes, and all the time one of its held
calls is open. A `wait` from session S is taken when no session is attached, when S is
the attached one, or when the attached one is out of contact: for 60 seconds while it
holds no job, for 15 minutes while it holds one. A takeover closes the old session's job
as `session-lost`, ends its open calls with `session-replaced` and is written to the log.
Every later call of the old session gets `session-replaced`. Otherwise the new session
gets `session-refused` with the time of the other's last contact.

### What the console sees

`GET /api/state` gives `agent: { attached, waiting, lastContact }`, the queue and the
open job with `silent: true` when its session has been out of contact for 15 minutes,
and a change counter. The console asks for it every 1.5 seconds while its tab is visible.

Console routes: `POST /api/jobs` (queue), `GET /api/jobs`, `GET /api/jobs/:id`,
`GET /api/jobs/:id/files/:name` (a file of the job's folder that an open ask names),
`POST /api/jobs/:id/answer`, `POST /api/jobs/:id/cancel` (a waiting job),
`POST /api/jobs/:id/fail` (a silent one).

## Files to Create / Modify

- Create: `skills/draw/scripts/src/labs-jobs.mjs` (records, kinds, states, queue, sessions)
- Create: `skills/draw/scripts/src/labs-client.mjs` (`wait`, `progress`, `ask`, `done`, `holds` over `node:http`)
- Create: `skills/draw/scripts/tests/labs-jobs.test.mjs`
- Create: `skills/draw/scripts/tests/labs-bridge-e2e.test.mjs`
- Modify: `skills/draw/scripts/src/labs-server.mjs` (job and agent routes)
- Modify: `skills/draw/scripts/src/labs-lifecycle.mjs` (`session` in the output of `start`; open jobs closed at start)
- Modify: `skills/draw/scripts/src/cli.mjs` (`labs wait|progress|ask|done|holds` as two-word keys; `--session`, `--message`, `--question`, `--result`, `--report`, `--timeout`)
- Modify: `skills/draw/scripts/bin/cli.mjs` (rebuilt)

## Implementation Steps

1. `labs-jobs.mjs` as a pure state machine over a store interface: every arrow of the diagram, every other pair refused. Test it without a server.
2. Checks per kind, from the CLI's own value lists and the server's listings.
3. Persistence: one file per job, written through a temporary sibling; at start, close open jobs as `server-stopped`; prune to 50.
4. Sessions, contact and takeover, with an injected clock.
5. The held routes (`wait`, `ask`): released by a state change, by the nine-minute cap, by a takeover and by the server's end.
6. The question file: its schema, the listing of attachments, the one-ask-per-id rule.
7. `labs-client.mjs` and the five commands, with the error codes.
8. `revisionsSince` for a job with a run.
9. E2E through the bundle: queue over HTTP, `wait` returns the job, an ask with three questions and a body, the answer over HTTP, `done`; a `wait` that returns nothing; an `ask` cut by the cap and fetched again; an answered id asked again; a second session refused, then taking over; a restart with an open job; the queue bound; `holds` with and without a job, and with no server.

## Todo

- [ ] State machine and its transition test
- [ ] Checks per kind
- [ ] Persistence, jobs closed at start, pruning
- [ ] Sessions, contact and takeover
- [ ] Held routes with the cap
- [ ] Question file and attachments
- [ ] `wait`, `progress`, `ask`, `done`, `holds` and the error codes
- [ ] `revisionsSince`
- [ ] Bridge e2e through the bundle
- [ ] Rebuilt bundle

## Success Criteria

- The transition test covers every arrow of the diagram and refuses every other pair of states.
- With one job open, `wait` hands out no second job.
- A session with an open `wait` is never taken over, however long it waits.
- A second session's `wait` gets `session-refused` while the first holds a job and was heard from in the last 15 minutes, and takes over after that; the first session's next call gets `session-replaced` and its job is `failed` with `session-lost`.
- An ask with three questions and a body arrives in `GET /api/jobs/:id` as written; its answers reach the agent in order.
- An `ask` that returned `null` returns the user's later answer when called again; one ask is shown, not two. The same id after the answer is refused.
- A job with an IR that fails `validateIr` is answered with 422 and is not in the queue; so is a request of 4001 characters.
- The twenty-first waiting job gets 429.
- After a server restart the job that was open is `failed` with `server-stopped` and lists the revisions written since it started.
- `holds <run>` exits 2 while a job on that run is open and 0 otherwise, also with no server.
- No command of this phase exits with a code other than 0, 1 or 2, and every existing test passes unchanged.

## Risk Assessment

| Risk | Signal | Response |
|---|---|---|
| A job dies half way (IR written, outputs not rebuilt) | A failed job lists a revision written since it started | The console says the run may be half changed and offers Undo to that revision; the next revise would also see the stale outputs in its hand-edit check. |
| A second session changes a run after `holds` said it was free | The round of phase 7 shows two writers | Known limit of an advisory check, stated in the documents: a console job that starts later is not seen by a change already under way. |
| A runtime cannot hold a command open for nine minutes | The Codex round of phase 7 never sees a job | `--timeout` is set below the runtime's limit by the skill; each "nothing yet" costs one short turn. |
| An agent is slow, not gone, and the user marks its job failed | The agent's next call gets 409 | The skill stops writing at once and says in which state it left the run (phase 6). |

## Security Considerations

- A job reaches the queue only with the token, so a foreign page cannot write one (phase 2).
- A job's request is limited in length and is carried out only within the route of its
  kind; phase 6 writes that rule into the skill.
- Job files hold the request text, questions and reports. They stay in `.zukai/labs/`,
  which git ignores, and are pruned.
