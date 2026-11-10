# Review checklist and verdict

Every diagram passes a review before it is delivered. In Claude Code the `diagram-reviewer`
agent runs it in a separate context; in other runtimes the main session runs it as an explicit
step, reading this file first and judging the diagram as a reviewer, not as its author. The
reviewer gets: the IR file(s), the preview PNG(s) from `preview`, and the CLI warnings.

## Layout (look at the PNG)

1. Every arrow starts and ends at the intended elements and points the right way; branch
   arrows leave a decision at its tip and share one trunk when they head the same way.
2. No label overlaps another label, a frame, a note or a shape; nothing is cut off or
   outside the page. No connection runs through a component name or a frame title. A
   line that passes a shape or a text with clear space between them is how a connection gets
   round its neighbours, not a finding; report it only when it touches one. An AWS icon shows its picture: an empty coloured or white square means
   the viewer lacks that stencil, which is reported, not passed.
3. Frames, groups and lanes enclose exactly their members; each action sits in the lane of
   the actor that performs it; the reading order (top to bottom or left to right) matches
   the order in the IR. One exception is intended and is not a finding: in an AWS
   architecture diagram a system outside the frames that a component inside them calls
   stands beside the frames, level with its caller, or at the nearer end of the frames when
   it has several callers, so its arrow may run across or against the reading order
   (`target-drawio.md`).
4. Every CLI warning that starts with `layout:` is resolved or explicitly accepted.

## Wording (read the IR)

5. Labels are in the user's language, consistent throughout, and short: an action is one
   verb phrase, a decision is a question, a guard is one or two words or a short condition,
   a message names the call or the reply. Two lines at most; long explanations go to
   `meta.notes`. Exception: in a `business` diagram an action or decision that states a
   business rule with its values may take up to four lines, because splitting the rule into
   several elements would make the simpler view larger than the technical one.
6. Names are consistent: the same system, actor or entity has the same label everywhere;
   stereotypes and lane names match the vocabulary of the project. An AWS `icon` is the
   service its label names, and a `group` is the construct its label names (a subnet is not
   drawn as a VPC).
7. The title says what the diagram shows; ids and file names are English kebab-case; no
   credential, connection string, token or personal data appears anywhere.

## Structure (read the IR)

8. One main diagram covers the whole feature at the chosen scope; parts exist only under
   `detailed` and are referenced with `ref` on the element they detail (a step, a message,
   a state, a component, a class or an entity), never by an id written into a label;
   nothing in the request is missing and nothing outside it was added.
9. No degenerate control: a merge or join with one incoming flow, a decision or fork with
   one outgoing flow, a node nothing reaches, a branch that never ends.
10. In `scout` mode the diagram contains only what the code does, with the source files in
    `meta.notes`, and no open questions or suggestions anywhere in the output.

## Audience (read `meta.audience`; see `variants.md`)

11. `business`: no class, method, table, column, queue, endpoint or configuration name
    remains; no implementation-only step (queueing, logging, caching, sanitising, retries)
    remains; no label hides a rule behind a word such as "safe" or "valid".
12. `business`: every business rule of the technical diagram is still present with its
    value. A business rule is a condition whose value the reader would check: a time
    window, a lookback period, a threshold, a limit, a cut-off, a role that may act, and
    the outcomes the reader can observe (an approval, a rejection, a notification, a wait).
    A defensive path is not one: an empty result for an invalid input, a log-only failure,
    a retry, a validation of the request shape; these may be dropped or merged without a
    finding. When the technical IR is given, compare the two and list each dropped business
    rule as a `missing-rule` finding.
13. `technical` (or unset): names match the code or the specification exactly; nothing was
    reworded for a non-technical reader.
14. Anything listed in `meta.omitted` was left out on purpose: never ask for it back, in any
    audience. The author's or the user's decision to omit wins over items 8, 9 and 12; the
    closing report lists the omissions so the reader knows what the picture does not cover.

## Verdict format

```text
Verdict: PASS | FAIL
Images: <diagram id>: opened | not opened (<reason>) ; ...
Findings:
- [wrong|missing-rule|polish] [layout|wording|structure] <diagram id> / <element id or path>: <what is wrong> -> <fix, as an IR change>
```

The `Images:` line says, for every diagram, whether the reviewer actually opened its PNG
(every tile when there are several). A diagram whose image was not opened was reviewed on
the IR and warnings only, and the layout items could not be checked; the closing report
repeats this line as it is.

Every finding carries a severity first:

- `wrong`: the picture says something false. A step in the wrong order, an arrow to the
  wrong element, a label that overlaps or sits on another flow so it reads as the wrong
  branch, an inconsistent name for one thing, a credential in a label.
- `missing-rule`: a business rule, condition or observable outcome that the source (the
  technical IR, the code, the user's description) has and the diagram lost, and that is not
  in `meta.omitted`.
- `polish`: everything else a reader would notice: a long label, an uneven layout, a note
  that could be shorter, a guard that could be one word.

`FAIL` means at least one `wrong` or `missing-rule` finding remains. `polish` findings are
listed and fixed when the fix is a plain IR edit, but they never block `PASS` and never
start a new review round on their own. A finding the author cannot fix from the IR (an
emitter defect) is listed with the prefix `emitter:` and does not block `PASS`, but it is
reported to the user verbatim.
