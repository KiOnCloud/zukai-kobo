---
phase: 2
title: "Phase 2: Labs server and read API"
status: todo
priority: P1
effort: "2d"
dependencies: [1]
---

# Phase 2: Labs server and read API

## Overview

`cli labs start` serves the console's API on `127.0.0.1`, once per project, and reads the
runs under `diagrams/` without ever writing there. This phase delivers the process
lifecycle, the request checks, the read routes and the glossary routes. Jobs come in
phase 3 and the pages in phase 4.

## Context

- The CLI is one committed bundle on Node 22.13 with no install step, so the server is
  `node:http` and nothing else.
- A page on any site can send a request to `127.0.0.1`. A `text/plain` POST needs no
  preflight, and DNS rebinding makes a foreign name resolve to the loopback address. The
  token header, the `Host` check and the absence of CORS headers are what stop both.
- Read models already exist as functions: `listRevisions`, `staleRun`, `diffRun`,
  `validateIr`, `inspect`, `bundle(..., 'doc')`, `orderIrFiles`, `runFolderOf`.
- `CLAUDE_CODE_REMOTE=true` marks a cloud session of Claude Code (observed in this session).

## Requirements

- [ ] One server per project root; a second start reuses it and starts no process.
- [ ] The port is the same for a project every time; a busy port is never answered by taking the next one.
- [ ] The server listens on `127.0.0.1` only and sends no `Access-Control-*` header.
- [ ] Every `/api` route needs the browser token in `X-Zukai-Token`; every `/agent` route needs the agent token.
- [ ] A `Host` other than `127.0.0.1:<port>`, or an `Origin` other than `http://127.0.0.1:<port>`, is refused before anything else is read.
- [ ] No route writes under `diagrams/`. The server writes `.zukai/labs/` and, through the glossary store, `.zukai/glossary.json`.
- [ ] A file is served only when it is in the server's own listing of that run and its real path lies inside the run folder.
- [ ] The log holds method, route pattern, status and duration; never a body, a query string or a token.
- [ ] The server ends itself when it has been idle, when its lock file is gone, and on `labs stop`.
- [ ] `labs start` refuses a cloud session unless `--allow-remote` is given.

## Design

### Commands

```text
cli.mjs labs start [--root <project>] [--port <n>] [--idle-minutes <n>] [--allow-remote]
cli.mjs labs status [--root <project>]
cli.mjs labs stop [--root <project>]
cli.mjs labs serve ...        (what start runs as a child; not for users)
```

Each prints one JSON object on stdout. `start` and `status` include the console URL,
`http://127.0.0.1:<port>/#t=<browser token>`.

### State folder

```text
<root>/.zukai/labs/
  .gitignore      "*"  (written at first start, so the project's own file is not edited)
  server.json     pid, port, instance, version, startedAt, both tokens; mode 0600
  server.log      capped at 1 MB, started again when the cap is reached
  jobs/           phase 3
```

### Port

`4700 + (first four bytes of SHA-256 of the real path of the root, as an integer, modulo
200)`. `--port` or `ZUKAI_LABS_PORT` replaces it.

### Start

1. In a cloud session (`CLAUDE_CODE_REMOTE=true`) without `--allow-remote`: exit 1 and say
   that a browser on the user's device cannot reach this machine.
2. Read `server.json`. When it is there, ask `GET /health` on its port (one second). An
   answer with the same `instance` means reuse: print `reused: true` and the URL, exit 0.
   An answer from an older `version` means the plugin was upgraded: ask that server to
   shut down with the agent token, then go on. No answer means the lock is stale: remove
   the file and go on. The recorded pid is never signalled on its own, because a pid
   without an answer may belong to another program by now.
3. Start `labs serve` as a detached child whose output goes to `server.log`.
4. The child binds the port. The bind is the mutex: only after it succeeds does the child
   write `server.json` (temporary sibling, then rename). On `EADDRINUSE` the child exits.
5. `start` polls `/health` for five seconds. An answer from the instance it started:
   print it. An answer from another instance of this root (two starts raced): read
   `server.json` again and report reuse. Anything else on the port: exit 1, name the port,
   give the command that shows its owner (`lsof -i :<port>`, `netstat -ano` on Windows)
   and name `--port`. The port is never incremented.

### End

- Idle: no request with a valid token and no agent call for `--idle-minutes` (default 30)
  while no job is queued or running with a live agent.
- Lost lock: every 30 s the server checks that `server.json` still names its instance and
  exits when it does not.
- `labs stop`: `POST /agent/shutdown` with the agent token; the server finishes open
  responses, removes `server.json` and exits. `stop` waits for the port to close.

### Request checks, in this order

1. Method is one the route table knows; `OPTIONS` is 403.
2. `Host` equals `127.0.0.1:<port>`.
3. `Origin`, when sent, equals `http://127.0.0.1:<port>`; `Sec-Fetch-Site`, when sent, is `same-origin` or `none`.
4. Static files: `GET` only, from a fixed map of names to files, never from a joined path.
5. `/api/*`: `X-Zukai-Token` compared in constant time. A body needs `Content-Type: application/json` and is at most 1 MB.
6. `/agent/*`: `X-Zukai-Agent-Token`, read by the CLI from `server.json`.

Every response carries `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`,
`Cache-Control: no-store` and a `Content-Security-Policy` with `default-src 'none'` that
allows scripts, styles and connections from the console's own origin only.

### Read routes

| Route | Returns | From |
|---|---|---|
| `GET /health` | app name, instance, version, root name (no token needed; holds no data of the project) | |
| `GET /api/state` | project name, version, agent state, job counts, glossary counts and `rev` | |
| `GET /api/runs` | every `diagrams/<yyyymmdd>_<slug>`: date, title, diagrams (id, kind, title, audience), targets present, revision count, origin (`meta.source`), language variants | `orderIrFiles`, the folders of the run |
| `GET /api/runs/:run` | diagrams, listed files, revisions with the undo and redo targets, the stale result when the run has a record | `listRevisions`, `staleRun` |
| `GET /api/runs/:run/diagrams/:id` | the IR, its `rev` (SHA-256), its labels as `[{ path, id, label }]`, the warnings of `inspect` | `validateIr`, `inspect` |
| `GET /api/runs/:run/doc?lang=` | the description tables as Markdown, built in memory | `bundle(..., 'doc')` |
| `GET /api/runs/:run/revisions/:rev/changes` | what changed between that revision and now | `diffRun` |
| `GET /api/runs/:run/files/<name>` | one listed file | |
| `POST /api/validate` | errors and warnings for an IR in the body; nothing is stored | `validateIr`, `inspect` |
| `GET /api/glossary` | the file and its `rev` | `readGlossary` |
| `POST /api/glossary/entries`, `PATCH` and `DELETE /api/glossary/entries/:id` | the changed file; 409 when `rev` no longer matches | `writeGlossary` |
| `GET /api/glossary/check?run=` | the findings for one run | `checkRuns` |

A run id must match `^\d{8}_[\w.-]+$` and name a real folder (not a link) under
`diagrams/`. A language variant folder (`source/<lang>/`) is listed as a variant, not as
further diagrams, as `closing-contract.md` has it.

## Files to Create / Modify

- Create: `skills/draw/scripts/src/labs-lifecycle.mjs` (port, lock file, start, status, stop, cloud check)
- Create: `skills/draw/scripts/src/labs-server.mjs` (listener, checks, route table, static map, log)
- Create: `skills/draw/scripts/src/labs-runs.mjs` (the read models of runs and files)
- Create: `skills/draw/scripts/tests/labs-server.test.mjs`
- Create: `skills/draw/scripts/tests/labs-runs.test.mjs`
- Create: `skills/draw/scripts/tests/labs-lifecycle-e2e.test.mjs`
- Modify: `skills/draw/scripts/src/cli.mjs` (the `labs` command and its options)
- Modify: `skills/draw/scripts/bin/cli.mjs` (rebuilt)

## Implementation Steps

1. `labs-runs.mjs`: list and read runs from a fixture project; unit-test it against runs with parts, a business view, a language variant, a Mermaid run and a FigJam run.
2. `labs-server.mjs`: a `createLabsServer({ root, port, tokens, uiDir, idleMs, now })` that tests can start on port 0; the checks as one function per step, in the order above.
3. The security table test: for every route, a request without a token, with a wrong token, with a foreign `Host`, with a foreign `Origin`, as `text/plain`, as `OPTIONS`.
4. The no-write test: hash every file under `diagrams/` of the fixture, call every route with valid and invalid input, hash again.
5. The file route: listing, real path, links that point outside, `..`, an encoded slash.
6. The glossary routes on the store of phase 1, with the 409 case.
7. `labs-lifecycle.mjs`: the port function, the lock file, `start`, `status`, `stop`, the cloud check.
8. E2E through the bundle: start, start again (same pid), status, stop; a stale `server.json`; another program on the port; two starts at once; idle end (a test variable shortens the idle time); a removed lock file.
9. Wire `labs` into `cli.mjs`; rebuild.

## Todo

- [ ] Read models of runs
- [ ] Listener, checks and route table
- [ ] Security table test
- [ ] No-write test
- [ ] File route with path confinement
- [ ] Glossary routes
- [ ] Lifecycle: port, lock, start, status, stop
- [ ] Lifecycle e2e through the bundle
- [ ] CLI wiring and rebuilt bundle

## Success Criteria

- The security table test passes for every route: 403 without the token, 403 for a foreign `Host` or `Origin`, 415 for a body that is not JSON.
- The no-write test finds the tree under `diagrams/` unchanged.
- Two `labs start` calls for one project report one pid; `ps` shows one server.
- With another program on the port, `start` exits 1, names the port and starts nothing.
- After the idle time the port is closed and `server.json` is gone.
- With `CLAUDE_CODE_REMOTE=true`, `start` exits 1 without starting a child; with `--allow-remote` it starts.
- `server.log` after the test run holds no token and no request body.

## Risk Assessment

| Risk | Signal | Response |
|---|---|---|
| Two projects hash to one port | `start` reports a Zukai server of another root on the port | The message names `--port`; the variable `ZUKAI_LABS_PORT` makes the choice lasting. |
| Mode 0600 means nothing on Windows | The Windows job reads `server.json` as another user | Documented: the folder inherits the profile's access rules; one user per machine is the assumption of this plan. |
| A detached child outlives its session | `labs status` shows a server no session uses | The idle end closes it; `labs stop` closes it at once. |
| `detached` behaves differently on Windows | The lifecycle e2e fails in the Windows job | Stop goes through HTTP, never a signal; add the lifecycle e2e to the Windows job in phase 6. |

## Security Considerations

- Threat: a web page the user visits while the console runs. It can reach the port but
  cannot read the token (it is in the URL fragment of another origin and in a file of the
  user), cannot set a custom header without a preflight that is refused, and cannot pass
  the `Host` check through a rebound name.
- Threat: another local user. Out of scope beyond the file mode of `server.json`.
- Diagrams can hold customer names. They are read from disk and sent to the local browser
  only; nothing is sent elsewhere, and nothing of them is logged.
