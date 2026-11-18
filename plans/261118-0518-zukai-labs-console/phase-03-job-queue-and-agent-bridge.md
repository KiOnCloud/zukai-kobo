---
phase: 3
title: "Phase 3: Job queue and agent bridge"
status: todo
priority: P1
effort: "2d"
dependencies: [2]
---

# Phase 3: Job queue and agent bridge

## Overview

The console asks for a change by queueing a job. The agent session that runs
`/zukai:labs` takes one job at a time with `cli labs wait`, carries it out with the
existing skills, asks the user through the console with `cli labs ask` and closes it with
`cli labs done`. The server owns the job state alone. A guard on `snapshot` and `restore`
keeps a second session from changing a run that a job holds.

## Context

- The server cannot call the agent. The agent calls the server and blocks until there is
  work, which every runtime that can run a command can do.
- In Claude Code a foreground command may run ten minutes and a background command two
  hours, and the session is woken when a background command exits (the Bash tool of this
  session says so). Other runtimes block on a shorter foreground call and call again.
- Every change of a delivered run starts with `snapshot` or `restore` (revise sections 5
  and 7, sync on "apply"). Those two commands are the place for the guard.
- The skills ask the user at fixed points: the opening question of draw, the clarify
  rounds, "redraw and lose these edits", the pick of a draft, "apply" in sync.

## Requirements

- [ ] One job runs at a time; the next is handed out only when the one before is closed.
- [ ] One agent session is attached at a time; a second is refused while the first is alive.
- [ ] A job is validated when it is queued; an invalid one is refused and never reaches the agent.
- [ ] The queue is bounded: 20 waiting jobs, then 429.
- [ ] Job state survives a restart of the server; a job that was running then is marked interrupted.
- [ ] The console can tell "no agent", "agent waiting", "agent working" and "agent silent on a running job".
- [ ] A question can be asked and answered across a timeout of the asking command.
- [ ] `snapshot` and `restore` refuse a run held by a running job unless called for that job.
- [ ] Finished jobs are pruned to the latest 50, with their draft files.

## Design

### Job record, `.zukai/labs/jobs/<id>.json`

```json
{
  "id": "j20261118-051842-3fa1",
  "kind": "revise",
  "run": "20261109_login-flow",
  "params": { "request": "add a stock check after login", "preview": false },
  "state": "queued",
  "attempt": 1,
  "createdAt": "...", "startedAt": null, "finishedAt": null,
  "session": null,
  "progress": [],
  "question": null,
  "answers": [],
  "cancelRequested": false,
  "report": null
}
```

### Kinds

| Kind | Parameters | The skill route it stands for |
|---|---|---|
| `draw` | `mode`, `request`, `to`, `kind?`, `scope?`, `audience?`, `svg?`, `doc?` | draw, with the opening question already answered |
| `revise` | `run`, `request`, `preview?`, `svg?`, `doc?` | revise, direct, consult or new diagram |
| `restore` | `run`, `target` (`undo`, `redo` or `rNNN`) | revise, undo route |
| `apply-edit` | `run`, `diagram`, `baseRev`; the edited IR is stored beside the job | revise, direct route with the IR given |
| `sync` | `run` | sync |
| `recook` | `source` (a path inside the project, or a FigJam board link), `to?`, `kind?`, `scope?`, `audience?`, `svg?`, `doc?` | recook |
| `export` | `run`, `svg?`, `doc?` (languages) | the closing contract's picture and table steps |
| `glossary-suggest` | `runs` (ids, or `all`) | `glossary pairs`, then `glossary add` |

The parameters of each kind are checked against the same value lists the CLI uses
(`KINDS`, `EMIT_TARGETS`, `DOC_LANGS`). An `apply-edit` is queued only when the IR passes
`validateIr`; a `source` path is refused when it is absolute or leaves the project.

### States

```text
queued ──wait──▶ running ◀──answer── needs-input
   │                │  └──ask──────────▲
   │                ├──done──▶ done | failed | cancelled
   └──cancel──▶ cancelled
running | needs-input ──server restart, or the user's "mark interrupted"──▶ interrupted
interrupted ──requeue──▶ queued (attempt + 1)      interrupted ──cancel──▶ cancelled
```

A cancel of a running job sets `cancelRequested`; every later answer to the agent carries
it, and the agent stops at the next safe point and closes the job as `cancelled`. Any
other transition is refused with 409.

### Agent routes and commands

| Command | Route | Result |
|---|---|---|
| `labs wait --session <id> [--timeout <s>]` | `POST /agent/wait` (held open) | exit 0 and the job on stdout; exit 3 when the time is up; exit 1 when no server runs or another session is attached |
| `labs progress <job> --session <id> --message <text>` | `POST /agent/jobs/:id/progress` | exit 0; the output says when a cancel was asked |
| `labs ask <job> --session <id> --question @<file.json> [--timeout <s>]` | `POST /agent/jobs/:id/ask` (held open) | exit 0 and the answer; exit 3 when the time is up, the question stays open and the same call fetches the answer later |
| `labs done <job> --session <id> --status <done|failed|cancelled> [--report @<file>]` | `POST /agent/jobs/:id/done` | exit 0 |

Exit code 3 is new and means "nothing yet, call again". Only `wait` and `ask` return it;
the usage text says so beside the three existing codes.

A question file is `{ "id", "question", "options": [{ "label", "description" }], "multiple"?, "attachments"?: [files of the run] }`,
the shape the skills already write for `AskUserQuestion`. The same `id` asked again
returns the open question's answer and creates nothing.

### Session

`labs start` prints a fresh `session` id with each call. A `wait` from session S is taken
when no session is attached, when S is the attached one, or when the attached one has
made no call for ten minutes (takeover, written to the log). Otherwise it gets 409 with
the time of the other session's last call. A call on a job must carry the session that
took it.

### What the console sees

`GET /api/state` gives `agent: { attached, waiting, lastSeen }`; a job gets `stalled: true`
while it is `running` and its session has made no call for ten minutes. An open `ask`
counts as contact. `GET /api/events?since=<n>` is held open up to 25 s and returns the
changes of jobs, agent state and the glossary `rev` since `n`.

Console routes: `POST /api/jobs` (queue), `GET /api/jobs`, `GET /api/jobs/:id`,
`POST /api/jobs/:id/answer`, `POST /api/jobs/:id/cancel`, `POST /api/jobs/:id/requeue`,
`POST /api/jobs/:id/interrupt`.

### Run guard

`snapshot` and `restore` take `--job <id>`. Before they write, they read
`.zukai/labs/server.json` and the job files of the project the run lies in. When the
server of that file answers `/health` and a job in state `running` or `needs-input` names
the run, a call without that job's id exits 1 and says which job holds the run and that
`labs status` shows it. Without a live server nothing is checked, so a project that never
used the console behaves as before. The request text of the revision gets the job id
appended, which is how an interrupted job is recognised later.

## Files to Create / Modify

- Create: `skills/draw/scripts/src/labs-jobs.mjs` (records, kinds, states, queue, sessions, events)
- Create: `skills/draw/scripts/src/labs-client.mjs` (`wait`, `progress`, `ask`, `done` over HTTP)
- Create: `skills/draw/scripts/src/labs-guard.mjs` (the check `snapshot` and `restore` call)
- Create: `skills/draw/scripts/tests/labs-jobs.test.mjs`
- Create: `skills/draw/scripts/tests/labs-bridge-e2e.test.mjs`
- Create: `skills/draw/scripts/tests/labs-guard.test.mjs`
- Modify: `skills/draw/scripts/src/labs-server.mjs` (job and agent routes)
- Modify: `skills/draw/scripts/src/labs-lifecycle.mjs` (`session` in the output of `start`; interrupted jobs at start)
- Modify: `skills/draw/scripts/src/cli.mjs` (`labs wait|progress|ask|done`, `--job`, `--session`, `--message`, `--question`, `--timeout`, exit code 3)
- Modify: `skills/draw/scripts/src/revisions.mjs` or its callers in `cli.mjs` (the guard before a write)
- Modify: `skills/draw/scripts/bin/cli.mjs` (rebuilt)

## Implementation Steps

1. `labs-jobs.mjs` as a pure state machine over a store interface: every transition of the diagram, every other one refused. Test it without a server.
2. Parameter checks per kind, from the CLI's own value lists.
3. Persistence: one file per job, written through a temporary sibling; load at start, mark interrupted, prune to 50.
4. Sessions and the takeover rule, with an injected clock.
5. The held-open routes (`wait`, `ask`, `events`): a waiting response is released by a state change, by its timeout and by the server's end.
6. `labs-client.mjs` and the four commands; exit code 3.
7. The guard, called by the `snapshot` and `restore` commands; its three cases (no server, held by another, held by this job).
8. E2E through the bundle: queue over HTTP, `wait` returns the job, `ask` and an answer over HTTP, `done`; a `wait` that times out; a second session; a cancel; a restart with a running job; the queue bound.

## Todo

- [ ] State machine and its transition test
- [ ] Parameter checks per kind
- [ ] Persistence, interrupted jobs, pruning
- [ ] Sessions and takeover
- [ ] Held-open routes and the event feed
- [ ] `wait`, `progress`, `ask`, `done` and exit code 3
- [ ] Guard on `snapshot` and `restore`
- [ ] Bridge e2e through the bundle
- [ ] Rebuilt bundle

## Success Criteria

- The transition test covers every arrow of the diagram and refuses every other pair of states.
- With one job running, `wait` hands out no second job.
- A second session's `wait` exits 1 while the first is alive and succeeds ten minutes after its last call.
- `ask` that timed out returns the user's later answer when called again with the same question id; one question is shown, not two.
- A job with an IR that fails `validateIr` is answered with 422 and is not in the queue.
- The twenty-first waiting job gets 429.
- With a running job on a run, `snapshot <run>` exits 1; with `--job <that id>` it writes the revision; with the server stopped it writes as before.
- After a server restart the job that was running is `interrupted` and can be requeued.
- Every existing test of `snapshot`, `restore` and revise passes unchanged.

## Risk Assessment

| Risk | Signal | Response |
|---|---|---|
| A job stops half way (IR written, outputs not rebuilt) | A requeued job finds a revision that carries its id | The skill finishes through the closing contract and does not apply the change a second time (phase 5 writes the rule). |
| A stale job file blocks `snapshot` for ever | The guard refuses with no console open | The guard checks only when the server answers; a stopped server never blocks. |
| A runtime cannot hold a command open long enough | The Codex round of phase 6 never sees a job | `--timeout` is set below the runtime's limit by the skill; each timeout costs one short turn. |
| The agent forgets `done` | A job stays `running` with a waiting agent | A `wait` from the session that holds a running job closes that job as `failed` with the reason "the session asked for new work without closing this job". |

## Security Considerations

- A job's request text is the user's own instruction to the agent. It reaches the queue
  only with the browser token, so a foreign page cannot write one (phase 2).
- Agent routes need the agent token, which the browser never receives.
- Job files hold the request text and reports. They stay in `.zukai/labs/`, which ignores
  itself for git, and are pruned.
