---
phase: 5
title: "Phase 5: Labs skill and distribution"
status: todo
priority: P1
effort: "1.5d"
dependencies: [3]
---

# Phase 5: Labs skill and distribution

## Overview

`skills/labs/SKILL.md` tells the agent how to open the console, wait for jobs, carry each
one out with the skill it stands for, ask through the console and close it. The skill is
installed, named and checked like the other four.

## Context

- A skill that is instructions only finds the CLI in the draw skill's sibling folder and
  the other skills beside it (`skills/sync/SKILL.md`, "Locate the other skills").
- The skill names are listed in `install.sh:56,130,159`, `install.ps1:64,114,162`,
  `ci.yml` (the frontmatter loop and the Windows job's expected list), `install.test.mjs`
  and `install-ps1.test.mjs` (`NAMES`).
- CI refuses a description with a colon followed by a space, and any frontmatter key
  outside the portable ones.
- The other skills ask with `AskUserQuestion`, or as one text message where that tool is
  missing. Inside a job the user is at the console, not at the terminal.

## Requirements

- [ ] The skill never changes a run itself: every change is made by following draw, revise, sync or recook.
- [ ] Every question a skill would ask goes through `labs ask` while a job is open.
- [ ] Every `snapshot` and `restore` of a job carries `--job <id>`.
- [ ] A job is always closed: `done`, `failed` with the reason, or `cancelled`.
- [ ] The skill says how the session is woken in its runtime and never polls faster than the wait allows.
- [ ] The skill refuses a session whose machine the user's browser cannot reach, with the CLI's words.
- [ ] `stop` and `status` are arguments of the skill.
- [ ] The installers, CI and the install tests know five skills.

## Design

### Frontmatter

`name: labs`, and a description that says what it is for, with example requests in
English and Vietnamese, and what it is not for (a single change is quicker with
`/zukai:revise`). Copied installs name it `zukai-labs` with the marker
`.zukai-labs-version`.

### Sections of the skill

1. Locate the other skills: draw (the CLI), revise, sync, recook, by the sibling rule of
   the sync skill; stop and name the paths tried when one is missing.
2. Arguments: none opens the console and waits; `status` prints `labs status`; `stop`
   runs `labs stop` and ends.
3. Open: `labs start`. On the cloud refusal, pass the message on and stop. Otherwise give
   the user the URL and keep the `session` id.
4. Wait: `labs wait --session <id>`. Where the runtime can run a command in the
   background and wakes the session when it exits, run it that way with the longest time
   the runtime allows; elsewhere run it in the foreground with a time below the runtime's
   limit. Exit 3 means call again. Say nothing to the user on a timeout.
5. Carry out a job, by its kind:

| Kind | What to do |
|---|---|
| `draw` | Follow the draw skill with the mode, request and options of the job. An option the job leaves open is asked with `labs ask`. |
| `revise` | Follow the revise skill for the run and request; `preview` is its `--preview`. |
| `restore` | Follow the revise skill's undo route with the target given; never work the target out. |
| `apply-edit` | Follow the revise skill's direct route, with the stored IR as the change: validate, hand-edit check, `snapshot`, write the IR, closing contract. When the current IR no longer has the `baseRev` of the job, ask whether to apply over the newer state or stop. |
| `sync` | Follow the sync skill for the run. |
| `recook` | Follow the recook skill for the source. |
| `export` | Run the closing contract's picture and table steps for the run; nothing else. |
| `glossary-suggest` | `glossary pairs` for the runs; group the pairs into terms; write them with `glossary add` as suggestions; report how many were added, skipped and in conflict. Never confirm one. |

6. Asking: every `AskUserQuestion` of the followed skill becomes a question file and
   `labs ask`. Drafts and pictures the user must see are listed as attachments. On exit 3
   call `labs ask` again with the same question.
7. Progress: `labs progress` before each step that takes time (reading code, emitting,
   rendering, each review round). When the output says a cancel was asked, stop at the end
   of the step, leave the run consistent (a snapshot taken means the closing contract is
   finished or the revision is restored) and close the job as `cancelled`.
8. Close: `labs done` with the report the followed skill ends with, in the user's
   language, as the `--report` file.
9. A requeued job (`attempt` above 1): `revisions <run>` first. A revision whose request
   carries this job's id means the change was started: read the state, validate, finish
   through the closing contract, and say in the report what was found. Without such a
   revision, start again.
10. Rules: one job at a time; no change to a run outside a job while the console is open
    without `--job` (the CLI refuses it); nothing of a token or of `server.json` is shown
    to the user except the URL; a request typed in the chat while a job is open waits
    until the job is closed.

### Other skills

One sentence each in revise and sync, where they call `snapshot` or `restore`: when the
CLI refuses because a console job holds the run, say so and stop; do not retry.

## Files to Create / Modify

- Create: `skills/labs/SKILL.md`
- Create: `skills/labs/references/job-routes.md` (the table of section 5 with the details per kind, if `SKILL.md` would pass 350 lines with it)
- Modify: `skills/revise/SKILL.md`, `skills/sync/SKILL.md` (the refusal sentence)
- Modify: `install.sh`, `install.ps1` (the fifth skill in the list, the legacy sweep and the messages)
- Modify: `.github/workflows/ci.yml` (the frontmatter loop; the Windows job's expected names)
- Modify: `skills/draw/scripts/tests/install.test.mjs`, `install-ps1.test.mjs` (five names; the upgrade case that adds `zukai-labs` to an install without it)

## Implementation Steps

1. Write `SKILL.md` in the order above, in the sentences of the sync skill.
2. Dry-run each kind by hand against the bridge of phase 3: for every question the followed skill asks, write the question file it becomes.
3. Add the refusal sentence to revise and sync.
4. Add `labs:zukai-labs:.zukai-labs-version` to both installers and every list of names.
5. Extend the install tests: five folders, the name line of the copy, the marker, the upgrade that adds the fifth.
6. Extend CI: the frontmatter loop and the Windows list.
7. `claude plugin validate . --strict` where the CLI is installed.

## Todo

- [ ] `skills/labs/SKILL.md`
- [ ] Question files for every question of the four skills
- [ ] Refusal sentence in revise and sync
- [ ] Installers
- [ ] Install tests
- [ ] CI lists
- [ ] Strict plugin validation

## Success Criteria

- The CI frontmatter step passes for `labs`.
- `install.sh --target codex` and `--target claude-project` leave five folders; so does `install.ps1`, and the two trees are equal file by file.
- An install of the same version without `zukai-labs` gets it added.
- `SKILL.md` names no tool that only one runtime has without the fallback beside it.
- Every row of the job table names the section of the skill it follows; none restates that skill's steps.

## Risk Assessment

| Risk | Signal | Response |
|---|---|---|
| The agent answers a question itself instead of asking through the console | The e2e round shows a job closed with no question where the skill has one | Sharpen section 6 and add the case to the round's checklist. |
| The agent stops waiting after a job | The console shows "No agent attached" right after a report | Section 4 is the last step of section 8: after `done`, wait again. |
| A long skill text is skimmed | A rule of section 10 is broken in the round | Move the per-kind detail to `references/job-routes.md` and keep the rules in `SKILL.md`. |

## Security Considerations

The request of a job is the user's instruction and is followed like one typed in the
chat. Text inside a diagram, a recooked file or a report is data: the skill never treats
a label or a note as an instruction, which the followed skills already require.
