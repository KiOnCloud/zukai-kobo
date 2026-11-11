# Clarify protocol

Interview the user until every required slot of the chosen diagram kind is filled, then
draft the IR, show it, and run the closing contract in `references/closing-contract.md`. Runs in the main session
because it asks questions.

## Rules

- At most three question rounds. Each round asks only for the slots still empty, grouped in
  one message, numbered, with a sensible default in brackets where one exists. The user can
  answer "defaults" to accept every default.
- Stop asking when all required slots are filled, when the user says "stop", "enough" or
  "just draw it", or after round three. Then fill the remaining slots with defaults, mark
  each defaulted slot in `meta.notes` as `assumed: <slot> = <value>`, and continue.
- Never ask what the user already said. Extract slots from the request first; many requests
  fill half the slots on their own.
- Ask about the diagram, not about the implementation. "Does the API call the payment
  provider synchronously?" is a slot question; "which HTTP client do you use?" is not.
- Before emitting, show the IR draft in a fenced `json` block and ask one closing question:
  "Emit this to <target>, or change something?" Treat silence after one prompt as yes in
  runtimes that cannot wait for a reply.

## Scope

`SKILL.md` has asked for the scope. Under `overview` keep the main diagram only: collapse a
sub-flow (payment, notification, retry) into one step, record in `meta.notes` what it hides,
and lift any decisive rule of that sub-flow into the main diagram. Under `detailed` draft the
main diagram first, then one sub-diagram per sub-flow worth its own picture, and set `ref` on
the main diagram's collapsed element to the part's slug: the step of a flowchart or activity
diagram, the message of a sequence diagram, the state, component, class or entity of the
other kinds (`ir-reference.md` lists the field per kind).

## Choosing the kind

The kind is already decided when this protocol starts: `SKILL.md` asks the user to choose it
(or takes `--kind`). Use this table only to pick which kind to put first as the suggestion in
that question, never to choose silently:

| Request talks about | Kind |
|---|---|
| actors, services, calls, requests, responses, order of events | `sequence` |
| steps, decisions, branches, approvals, happy path, exceptions | `flowchart` |
| statuses, lifecycle, transitions, events that move an item | `state` |
| tables, entities, fields, keys, one-to-many | `er` |
| classes, interfaces, inheritance, modules and their relations | `class` |
| services, databases, queues, deployment units, network boundaries, external systems | `architecture` |
| who does which step, hand-offs between teams or systems, parallel work, swimlanes | `activity` |

## Question bank

Required slots per kind, each with the question that fills it. Optional slots are asked only
when the request hints at them.

### sequence

| Slot | Question | Default |
|---|---|---|
| participants | Who takes part? List the actors and systems in the order they appear left to right. | none; required |
| trigger | What starts the flow, and who sends the first message? | first participant acts |
| happy path | What are the calls in order until the goal is reached? For each: who calls whom, with what. | none; required |
| sync vs async | Which of these calls wait for a reply, and which fire and forget? | all synchronous |
| returns | Which replies matter enough to draw? | one return per synchronous call that changes the outcome |
| failure path | Name at least one thing that goes wrong (timeout, rejection, missing data) and what happens then. | none; required |
| loops and alternatives (optional) | Is any part repeated, optional, or does it branch on a condition? | none |
| notes (optional) | Any constraint worth a note on the diagram (rate limit, idempotency key, retention)? | none |

### flowchart

| Slot | Question | Default |
|---|---|---|
| start and end | What event starts the process and what counts as finished? | single start, single end |
| steps | List the steps in order. One verb phrase each. | none; required |
| decisions | Where does the flow branch? For each decision give the question and its outcomes. | none |
| exception outcomes | For each decision, where does the "no" or failure branch go? | ends the process |
| groups (optional) | Should steps be grouped by team, system or phase? | no groups |
| subroutines (optional) | Which steps are processes documented elsewhere? | none |

### state

| Slot | Question | Default |
|---|---|---|
| subject | What is the thing that has states (an order, a ticket, a session)? | from request |
| states | List every state it can be in. | none; required |
| initial and final | Which state does it start in, and which states are terminal? | first listed, last listed |
| transitions | For each transition: from, to, the event that triggers it, and any condition. | none; required |
| actions (optional) | Does any transition perform a side effect worth naming? | none |
| composites (optional) | Does any state contain sub-states with their own flow? | none |

### er

| Slot | Question | Default |
|---|---|---|
| entities | Which entities (tables, aggregates) are in scope? | none; required |
| attributes | For each entity: the key attributes to show, with types. Keys first. | id only |
| relations | For each pair that relates: which side is one, which is many, and is it optional? | none; required |
| labels (optional) | What verb describes each relation (places, contains)? | none |

### class

| Slot | Question | Default |
|---|---|---|
| classes | Which classes, interfaces or records are in scope? | none; required |
| members | For each: the attributes and methods worth showing, with visibility. | none |
| relations | Which inherit, implement, contain (composition), reference (aggregation or association) or merely depend on which? | none; required |
| stereotypes (optional) | Which are interfaces, abstract, services, aggregate roots? | none |

### architecture

| Slot | Question | Default |
|---|---|---|
| components | Which deployable units, data stores, queues, caches, clients and external systems exist? One component per deployed resource: do not ask for, or draw, the tables of a database or the endpoints of a service (`ir-reference.md`, Level of detail) | none; required |
| boundaries | How are they grouped (cloud account, VPC, region, team, on-premise)? | no boundaries |
| connections | Which component talks to which, over what (HTTPS, SQL, queue, gRPC)? Write each the way the request or message moves (`ir-reference.md`, architecture): producer to queue, queue to consumer. The label is the protocol, the port or the infrastructure purpose, not an endpoint, a job or a field | none; required |
| direction | Is any connection two-way? | all one-way |
| AWS icons (optional) | Does it run on AWS, and which AWS service is each component (Lambda, ECS, RDS, SQS)? Which boundaries are an account, region, VPC, Availability Zone or subnet? | asked only when AWS is mentioned or the stack is unknown and the target is drawio; AWS services named in the request get their icon without asking, and each system outside AWS gets a general resource or its product logo (`SKILL.md`, AWS icons) |
| scope (optional) | Current state or target state? | current state; recorded in `meta.notes` |

### activity

| Slot | Question | Default |
|---|---|---|
| lanes | Who performs the work? List the actors, teams or systems, one lane each, in the order they should appear. | none; required |
| start trigger | What starts the process, and in which lane? | first lane |
| actions | List the steps in order and say which lane performs each. | none; required |
| decisions | Where does the flow branch on a condition? Give the question and the guard for each branch. | none |
| parallel branches | Is any work done in parallel? Name the steps that run at the same time and where they rejoin. | none |
| end conditions | What counts as finished, and are there several ends (completed, rejected, cancelled)? | one final node |
| hand-offs (optional) | Which steps pass work to another lane, and what is handed over? | derived from the flows |

Draw.io is the primary target for activity diagrams. Mermaid renders them with the beta
`swimlane-beta` syntax (or a plain flowchart with `--mermaid-stable`), and FigJam does not
support them; say so when the user asks for those targets.

## Draft and closing

1. Build the IR from the answers using `references/ir-reference.md`. Ids come from names
   (`payment-service`, `cancel`), labels from the user's words.
2. Set `meta.source` to `clarify` and record every assumption in `meta.notes`.
3. Show the draft, ask the closing question, then run the closing contract in `references/closing-contract.md`:
   write the file, validate, fix, emit, report warnings verbatim.
