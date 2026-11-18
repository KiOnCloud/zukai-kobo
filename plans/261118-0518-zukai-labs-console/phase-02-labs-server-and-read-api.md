---
phase: 2
title: "Phase 2: Labs server and read API"
status: todo
priority: P1
effort: "2.5d"
dependencies: [1]
---

# Phase 2: Labs server and read API

<!-- Updated: Red Team Session 1 - one token, proof of identity before a token is sent, stale lock by refused connection only, no self-exit on a lost lock, full content policy, every path parameter from a listing, log without messages, pages held in memory, host names, Windows job -->
<!-- Updated: Validation Session 1 - detached child with idle end confirmed; Tables, Files and Changes since kept -->
<!-- Updated: Validation Session 2 - the content policy allows what the Sienna design system needs: own fonts, data pictures, style attributes -->

## Overview

`cli labs start` serves the console's API on `127.0.0.1`, once per project, and reads the
runs under `diagrams/` without ever writing there. This phase delivers the process
lifecycle, the request checks, the read routes and the glossary routes. Jobs come in
phase 3 and the pages in phases 4 and 5.

## Context

- The CLI is one committed bundle on Node 22.13 with no install step, so the server is
  `node:http` and nothing else. No HTTP code exists in `src/` today.
- A page on any site can send a request to `127.0.0.1`. A `text/plain` POST needs no
  preflight, and DNS rebinding makes a foreign name resolve to the loopback address. The
  token header, the `Host` check and the absence of CORS headers are what stop both.
- The read models (`listRevisions`, `diffRun`, `bundle`) are synchronous and can hold the
  event loop for more than a second on a large run, so one missed health check proves nothing.
- A plugin lives in a folder named after its version (`docs/install.md:122-123`), and a
  copied install is replaced in place (`install.sh:176-186`). A running server must not
  depend on its page files staying on disk.
- `CLAUDE_CODE_REMOTE=true` marks a cloud session of Claude Code (observed in the
  planning session, not in the repository).
- The Windows job of CI installs and runs `cli.mjs help` only; it runs no test today
  (`.github/workflows/ci.yml:83-120`).

## Requirements

- [ ] One server per project root; a second start reuses it and starts no process.
- [ ] The port is the same for a project every time; a busy port is never answered by taking the next one.
- [ ] The server listens on `127.0.0.1` only, whatever the options, and sends no `Access-Control-*` header.
- [ ] Every `/api` and `/agent` route needs the token in `X-Zukai-Token`.
- [ ] The CLI sends the token only to a server that has proved it holds the same token.
- [ ] A `Host` whose name is not `127.0.0.1` or `localhost`, or an `Origin` that is not the origin of that `Host`, is refused before anything else is read.
- [ ] No route writes under `diagrams/`. The server writes `.zukai/labs/` and, through the glossary store, `.zukai/glossary.json`.
- [ ] Every path parameter is looked up in a listing the server built itself; none is joined into a path.
- [ ] The log holds method, route pattern, status, duration and, for an error, its name and code; never a message, a body, a query string or the token.
- [ ] `server.json` is removed only by the process that proved it stale; a live server never loses it to a start.
- [ ] The server ends itself when it has been idle and on `labs stop`; never while a job is open.
- [ ] `labs start` refuses a cloud session unless `--skip-cloud-check` is given.

## Design

### Commands

```text
cli.mjs labs start [--root <project>] [--port <n>] [--idle-minutes <n>] [--skip-cloud-check]
cli.mjs labs status [--root <project>]
cli.mjs labs stop [--root <project>] [--force]
cli.mjs labs serve ...        (what start runs as a child; not for users)
```

Each prints one JSON object on stdout. `start` and `status` include the console URL,
`http://127.0.0.1:<port>/#t=<token>`, the root and the number of runs found there.

### State folder

```text
<root>/.zukai/labs/     ignored by .zukai/.gitignore (phase 1)
  server.json     pid, port, instance, version, startedAt, token; mode 0600
  server.log      capped at 1 MB, started again when the cap is reached
  jobs/           phase 3
```

### Token

32 random bytes from `node:crypto`, base64url, made inside the `serve` child after it has
bound the port and never passed on a command line or in the environment. One token for
the browser and the CLI, compared with `timingSafeEqual`. A new server has a new token.

### Port

`4700 + (first four bytes of SHA-256 of the real path of the root, as an integer, modulo
200)`. `--port` or `ZUKAI_LABS_PORT` replaces it.

### Start

1. In a cloud session (`CLAUDE_CODE_REMOTE=true`) without `--skip-cloud-check`: exit 1
   and say that a browser on the user's device cannot reach this machine. Under SSH
   (`SSH_CONNECTION` set) the server starts and the output says that the port must be
   forwarded.
2. Read `server.json`. When it is there, connect to its port.
   - Connection refused: nobody listens, so the file is stale. Read it again and delete
     it only when it still names the same instance; then go on to step 3.
   - Connected: ask `GET /health?nonce=<random>`, up to five seconds with retries. The
     answer carries the version, whether a job is open, and
     `HMAC-SHA256(token, nonce)`. A proof that matches the token of `server.json` is this
     project's server: reuse it, print `reused: true` and the URL, exit 0. When its
     version differs and no job is open, ask it to shut down, wait for the port to close
     and go on to step 3; with a job open, reuse it and say that the new version starts
     when the job is closed.
   - No answer in time, or a proof that does not match: exit 1, name the port and the
     command that shows its owner (`lsof -i :<port>`, `netstat -ano` on Windows), name
     `--port`. The file is not deleted and no token is sent.
3. Start `labs serve` as a detached child with its output discarded; the server writes
   its own log.
4. The child binds the port. Only after the bind succeeds does it make the token, read
   its page files into memory and write `server.json` (temporary sibling, then rename).
   On `EADDRINUSE` it exits.
5. `start` waits five seconds for a `server.json` whose server proves itself as in step
   2, and prints it. When two starts raced, both find the one server that bound. When
   none appears: exit 1 with the message of the last case of step 2. The port is never
   incremented.

### End

- Idle: for `--idle-minutes` (default 30) no request with the token, no agent call and no
  open held call, and no job that is queued, running or waiting for an answer with an
  agent heard from in the last 15 minutes.
- `labs stop`: proves the server as in step 2, then `POST /agent/shutdown`. The server
  refuses new requests, releases held calls, removes `server.json` and exits; `stop`
  waits for the port to close. With a job open, `stop` says so and needs `--force`.

### Request checks, in this order

1. Method is one the route table knows; `OPTIONS` is 403.
2. The name in `Host` is `127.0.0.1` or `localhost`, with any port (a forwarded port has another number).
3. `Origin`, when sent, equals `http://` and the `Host` value; `Sec-Fetch-Site`, when sent, is `same-origin` or `none`.
4. Static files: `GET` only, from a fixed map of names to the pages held in memory.
5. `/api/*` and `/agent/*`: the token. A body needs `Content-Type: application/json` and is at most 1 MB.

Every response carries `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`,
`Cache-Control: no-store`, `X-Frame-Options: DENY` and, for the console's pages:

```text
Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self';
  style-src-attr 'unsafe-inline'; font-src 'self'; connect-src 'self';
  img-src 'self' blob: data:; frame-src 'self'; frame-ancestors 'none';
  base-uri 'none'; form-action 'none'
```

Three parts of it are there for the Sienna design system the pages are built on (phase
4): its fonts are served by the console (`font-src 'self'`), its stylesheet draws the
glyphs of checkboxes and selects as `data:` pictures, and two of its helpers set a
`style` attribute with fixed text. No style sheet, script or font of another host is allowed.

The page inside the viewer frame gets a policy of its own (phase 5).

### Log

The server writes one line per request and one per error. An error line has the route
pattern and the error's `name` and `code`, with the file and line of its stack frames and
never its message, because a parser's message quotes its input (`cli.mjs:219`). Handlers
for an uncaught exception and an unhandled rejection write the same kind of line.

### Read routes

| Route | Returns | From |
|---|---|---|
| `GET /health?nonce=` | app name, version, job open or not, the proof (no token needed; nothing of the project) | |
| `GET /api/state` | project name, version, agent state, job counts, glossary counts and `rev`, a change counter | |
| `GET /api/runs` | every run folder: date, title, diagrams (id, kind, title, audience), targets present, revision count, origin (`meta.source`), language variants | `orderIrFiles`, the folders of the run |
| `GET /api/runs/:run` | diagrams, listed files, revisions with the undo and redo targets, the stale result when the run has a record | `listRevisions`, `staleRun` |
| `GET /api/runs/:run/diagrams/:id` | the IR, its `rev` (SHA-256), its labels, the warnings of `inspect` | `labelsOf`, `validateIr`, `inspect` |
| `GET /api/runs/:run/doc?lang=` | the description tables as Markdown, built in memory | `bundle(..., 'doc')` |
| `GET /api/runs/:run/revisions/:rev/changes` | what changed between that revision and now | `diffRun` |
| `GET /api/runs/:run/files/:name` | one listed file | |
| `POST /api/validate` | errors and warnings for an IR in the body; nothing is stored | `validateIr`, `inspect` |
| `GET /api/glossary` | the file and its `rev` | `readGlossary` |
| `POST /api/glossary/entries`, `PATCH` and `DELETE /api/glossary/entries/:id` | the changed file; 409 when `rev` no longer matches | `writeGlossary` |
| `GET /api/glossary/check?run=` | the findings for one run | `checkRuns` |

Parameters: `:run` is a name from the listing of real folders (not links) under
`diagrams/` that match `^\d{8}_`; `:id` is an id from `orderIrFiles` of that run; `:rev`
is a revision `listRevisions` returned; `lang` is one of `DOC_LANGS`; `:name` is an entry
of the file listing of that run, whose real path lies inside the run folder; an entry id
is one the glossary holds. Anything else is 404 before a path is built. A language variant
folder (`source/<lang>/`) is listed as a variant, not as further diagrams
(`closing-contract.md:24`).

## Files to Create / Modify

- Create: `skills/draw/scripts/src/labs-lifecycle.mjs` (root, port, `server.json`, proof, start, status, stop, cloud check)
- Create: `skills/draw/scripts/src/labs-server.mjs` (listener, checks, route table, static map, log)
- Create: `skills/draw/scripts/src/labs-runs.mjs` (the read models of runs and files)
- Create: `skills/draw/scripts/tests/labs-server.test.mjs`
- Create: `skills/draw/scripts/tests/labs-runs.test.mjs`
- Create: `skills/draw/scripts/tests/labs-lifecycle-e2e.test.mjs`
- Modify: `skills/draw/scripts/src/cli.mjs` (`labs start|status|stop|serve` as two-word keys, their options)
- Modify: `skills/draw/scripts/bin/cli.mjs` (rebuilt)
- Modify: `.github/workflows/ci.yml` (the Windows job installs the dev dependencies and runs the lifecycle e2e file)

## Implementation Steps

1. `labs-runs.mjs`: list and read runs from a fixture project; unit-test it against runs with parts, a business view, a language variant, a Mermaid run and a FigJam run.
2. `labs-server.mjs`: a `createLabsServer({ root, port, token, pages, idleMs, now })` that tests start on port 0; the checks as one function per step, in the order above.
3. The security table test: for every route, a request without the token, with a wrong one, with a foreign `Host` name, with a foreign `Origin`, as `text/plain`, as `OPTIONS`; the exact policy header; a page that frames the console.
4. The no-write test: hash every file under `diagrams/` of the fixture, call every route with valid and invalid input, hash again.
5. The parameter test: for every parameterised route, `..`, an encoded slash, an absolute path, a link that points outside, a name that is not in the listing.
6. The log test: send malformed bodies that hold a marker text; the marker and the token are not in `server.log`.
7. The glossary routes on the store of phase 1, with the 409 case.
8. `labs-lifecycle.mjs`: the port function, the proof, `start`, `status`, `stop`, the cloud check.
9. E2E through the bundle: start, start again (same pid), status, stop; a stale `server.json` with nobody on the port; a `server.json` whose server is slow to answer (the file must survive); another program on the port, one that answers `/health` without the proof included; two starts at once; the idle end (a test variable shortens the time); the page folder removed while the server runs.
10. Wire `labs` into `cli.mjs`; rebuild.
11. The Windows job: `npm ci` in `skills/draw/scripts` and `npx vitest run tests/labs-lifecycle-e2e.test.mjs`.

## Todo

- [ ] Read models of runs
- [ ] Listener, checks, policy headers and route table
- [ ] Security table test
- [ ] No-write test
- [ ] Parameter test
- [ ] Log test
- [ ] Glossary routes
- [ ] Lifecycle: port, token, proof, start, status, stop
- [ ] Lifecycle e2e through the bundle
- [ ] CLI wiring and rebuilt bundle
- [ ] Windows job runs the lifecycle e2e

## Success Criteria

- The security table test passes for every route: 403 without the token, 403 for a foreign `Host` name or `Origin`, 415 for a body that is not JSON; the policy header is the one above, character for character.
- The no-write test finds the tree under `diagrams/` unchanged.
- Two `labs start` calls for one project report one pid; `ps` shows one server.
- A start against a server that answers late neither deletes `server.json` nor starts a child.
- With another program on the port, `start` exits 1, names the port, starts nothing and has sent no token (the stand-in records what it received).
- After the idle time the port is closed and `server.json` is gone; with a job open the server is still there.
- With `CLAUDE_CODE_REMOTE=true`, `start` exits 1 without starting a child; with `--skip-cloud-check` it starts.
- The server keeps serving its pages after the page folder is removed.
- The lifecycle e2e passes in the Windows job.

## Risk Assessment

| Risk | Signal | Response |
|---|---|---|
| Two projects hash to one port | `start` reports a server on the port that does not prove itself | The message names `--port`; `ZUKAI_LABS_PORT` makes the choice lasting. |
| Mode 0600 means nothing on Windows | `server.json` is readable by another account | Documented: the folder inherits the profile's access rules; one user per machine is the assumption of this plan. |
| A detached child outlives its session | `labs status` shows a server no session uses | The idle end closes it; `labs stop` closes it at once. |
| `detached` behaves differently on Windows | The lifecycle e2e is red in the Windows job | Stop goes through HTTP, never a signal; fix in `labs-lifecycle.mjs` within this phase, since the job runs here. |
| A large run blocks the server for seconds | `start` reports "no answer in time" for a live server | It retries for five seconds and deletes nothing; move the heavy read models behind a cache keyed by file dates if the round of phase 7 shows it. |

## Security Considerations

- Threat: a web page the user visits while the console runs. It can reach the port but
  cannot read the token, cannot set a custom header without a preflight that is refused,
  cannot pass the `Host` check through a rebound name, and cannot frame the console.
- Threat: a local program that takes the port. It gets no token, because the CLI sends
  one only after the proof; the user's browser is sent to it only if the user opens an
  old URL, and an old URL carries a token that is no longer valid for anything.
- Threat: another local account. Out of scope beyond the file mode of `server.json`.
- The token stands in the URL that `start` prints, so it is in the transcript of the
  agent session. It is of use only from this machine, with a header a foreign page cannot
  set, and a program of the same user can read `server.json` anyway; it ends with the server.
- Diagrams can hold customer names. They are read from disk and sent to the local browser
  only, and nothing of them is logged.
