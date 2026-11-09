# Scout protocol

Derive a diagram from the source code in the working directory. Read-only: this protocol
never edits the project. It may run in a subagent (Claude Code: the `source-scout` agent);
the subagent returns the IR JSON inline, with the file paths it used, and the main session
writes the file and runs the closing contract from `SKILL.md`.

## Rules

- Cite evidence. Every element comes from a file; list the paths in `meta.notes`
  (`src/orders/order-service.ts`, `src/Orders/OrderStatus.cs`). A reader must be able to
  check the diagram against the code.
- The kind comes from the user: `SKILL.md` asks for it before this protocol starts. Never
  switch kinds on your own; if the code suggests another kind would fit better, say so in one
  line and keep the one chosen.
- Scope before reading. Ask the user for the entry point only when the request does not name
  one and the repository has more than one plausible candidate; otherwise pick the most
  specific match and say which one you chose.
- Diagram what the code does, not what comments say it does. When they disagree, follow the
  code and add a note naming the file.
- Draw only what exists. Scout is documentation of the current behaviour: do not question
  the business rules, do not flag what looks like a bug or an inconsistency, do not propose
  changes, and do not raise "open questions" for the product owner. When the code leaves
  something ambiguous, take the path the code actually executes, note the file in
  `meta.notes`, and move on. Review findings belong to a code review, not to a diagram.
- Respect the scope the user chose in `SKILL.md`. `overview`: the main diagram only, about
  15 elements, sub-flows collapsed into one step each, decisive rules lifted into the main
  diagram, and a note listing what was collapsed. `detailed`: the main diagram plus one
  sub-diagram per sub-flow that deserves its own picture, each collapsed step carrying `ref`
  to its part, each part complete on its own. Never produce parts without the main diagram.
- Redact. Never copy connection strings, keys, tokens, hostnames with credentials, or
  personal data into labels or notes. Use placeholders such as `<db>` or `<api key>`. The
  CLI's secret scan is the backstop, not the policy.

## Finding the inputs per kind

### sequence

1. Start at the entry point: an HTTP handler, controller action, message consumer, CLI
   command or UI event handler named in the request.
2. Follow the call chain outward: service methods, repository calls, HTTP clients, queue
   publishers. Each distinct component on the path is a participant; classes in the same
   module collapse into one participant unless the request asks for class-level detail.
3. Each call becomes a message in execution order. `await`ed calls and synchronous
   invocations are `sync`; published events, fire-and-forget tasks and callbacks are
   `async`; values returned to the caller that change the flow are `return` messages.
4. `try/catch`, `if/else` and early returns around calls become `alt` or `opt` blocks; loops
   around calls become `loop`; parallel awaits (`Promise.all`, `Task.WhenAll`) become `par`.
5. Participant kinds: external users and clients are `actor`; databases and caches are
   `database`; gateways and controllers are `boundary`; orchestrating services are `control`;
   domain objects are `entity`.

### flowchart

Trace one function or use case. Each statement that does something observable is a `process`
node; each `if`, `switch`, guard or validation is a `decision` with one `conditional` edge
per outcome; calls into documented subsystems are `subroutine`; reads and writes of files,
queues or responses are `io`. Entry and exits are `terminal`. Group by the function or
module that owns the steps.

### state

Look for the thing with a status: an enum of statuses, a `state` column, a state-machine
library configuration, or a set of methods guarded by status checks. Each enum member is a
state; each method or handler that assigns a new status is a transition with the method name
or event as `event` and the guard condition as `guard`. The default or constructor value is
the `initial` state; statuses with no outgoing assignment are `final`.

### er

Read the ORM entities, migrations or schema files. Each entity or table is an entity;
columns are attributes with `pk` for primary keys and `fk` for foreign keys; navigation
properties, foreign keys and join tables give the relations and their cardinalities
(collection navigation means `many`; nullable foreign key means `zero-one`).

### class

Read the types in the requested module. Public members are shown; private members only when
the request asks. `extends` or base classes give `inheritance`; `implements` gives
`realization`; owned collections give `composition`; references to other aggregates give
`aggregation` or `association`; constructor-injected dependencies give `dependency`.

### architecture

Read the composition root and deployment descriptors: dependency injection registrations,
`docker-compose`, Kubernetes manifests, Terraform, `appsettings`, environment variable names.
Each running process is a `service`; configured stores are `database` or `cache`; brokers and
queues are `queue`; browsers, mobile apps and other callers are `client`; third-party APIs
are `external`. Boundaries come from accounts, VPCs, namespaces or compose networks.
Connections come from client registrations, connection strings (host part only) and
publish or subscribe calls.

## Output

Produce the IR with `meta.source` set to `scout` and the cited paths in `meta.notes`, then
hand it to the closing contract in `SKILL.md`. When running as a subagent, reply with:

1. The IR in a fenced `json` block.
2. One paragraph of rationale: entry point chosen and what was left out. No questions, no
   doubts about the business logic, no suggestions.
3. The list of files read.
