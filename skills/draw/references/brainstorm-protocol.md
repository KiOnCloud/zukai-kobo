# Brainstorm protocol

Turn a raw idea into a choice of diagrams, let the user pick, then route into the clarify
protocol. Read-only; may run in a subagent (Claude Code: the `diagram-brainstorm` agent),
which returns the candidate list inline. The user's choice and everything after it happen
in the main session.

## Steps

1. Restate the idea in one sentence to confirm the subject and the audience (who will read
   the diagram: developers, a client, operations, a reviewer). The opening call of
   `SKILL.md` already asked "Who will read it?"; use that answer (`technical` reads as
   developers, `business` as the named non-technical reader, `both` as two views) and do not
   ask again. Only when no answer exists (another runtime skipped the question) assume
   developers and say so.
2. Propose two or three candidate diagram sets. Each candidate is one line:
   `<kind>: <scope> for <audience>, answers "<question>"`. Candidates must differ in kind or
   scope; never offer the same diagram twice with different words. Prefer the smallest set
   that answers the audience's question. Examples:
   - `sequence: checkout from cart to confirmation for developers, answers "which services
     are called and in what order?"`
   - `architecture: order platform with AWS boundaries for the client, answers "what runs
     where and what talks to what?"`
   - `state: order lifecycle for operations, answers "which statuses exist and what moves an
     order between them?"`
3. Ask the user to pick one (or several, which become several IR files). Offer a default:
   the candidate that best matches the words the user used.
4. For the chosen candidate, continue with `references/clarify-protocol.md`: the candidate's
   scope and audience already fill the kind and subject slots, so the interview starts with
   the remaining required slots.
5. Set `meta.source` to `brainstorm` and record the candidates that were not chosen in
   `meta.notes` so the user can come back to them.

## When running as a subagent

Reply with the restated idea, the candidate list, and the recommended default. Do not
interview the user and do not write IR; the main session takes over from step 3.
