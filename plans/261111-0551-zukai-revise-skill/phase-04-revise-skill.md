---
phase: 4
title: "Revise skill"
status: completed
priority: P1
effort: 1d
dependencies: [1, 2, 3]
---

# Phase 4: Revise skill

## Goal

Ship `skills/revise/SKILL.md`, a thin skill that turns a change request on a delivered run
into IR edits through a direct, consult or undo route, and ends with the draw skill's
closing contract.

## Frontmatter

```yaml
name: revise
description: Change diagrams Zukai already delivered: replace, add, remove or reword steps, participants, states or connections in an existing run, or explore a what-if by proposing two or three draft variants to compare before anything is overwritten. Edits the IR only, keeps the last five revisions for rollback, warns before overwriting hand edits made in draw.io, then re-emits through the draw skill's closing contract. Use for "add a validation step to the login flow", "replace Redis with SQS in the architecture", "what if approval came before payment?", "undo the last change". Not for new diagrams: use draw.
```

## Files to create / modify

- Create `skills/revise/SKILL.md` (target under 250 lines, the size of the draw skill).
- Create `skills/revise/references/consult-protocol.md`: how drafts are built, compared and
  promoted (kept separate so the direct route never loads it).

## SKILL.md content, in order

1. **Locate the draw skill.** `<revise-dir>` is `${CLAUDE_SKILL_DIR}`; `<draw-dir>` is the
   sibling `draw` folder (plugin) or `zukai` folder (copied install: `.agents/skills/zukai`,
   `.claude/skills/zukai`). Check that `<draw-dir>/scripts/bin/cli.mjs` exists; if not, stop
   and say which paths were tried. Every CLI call and every shared reference
   (`ir-reference.md`, `review-checklist.md`, `variants.md`, `target-*.md`,
   `closing-contract.md`) comes from `<draw-dir>`. Nothing is copied into `skills/revise`.
2. **Arguments.** `[<run-folder|ir-path>] [--preview|--apply] <request>`. `--preview` forces
   consult, `--apply` forces direct; both given is an error.
3. **Find the run.** A path argument wins (an IR path means its run folder). Otherwise scan
   `diagrams/*/` in the working directory; one folder whose run slug or diagram titles match
   the request → use it and say so; zero or several → one `AskUserQuestion` with up to four
   most recent runs (date and slug), each with its diagram titles as the description. A run
   created earlier in this conversation is the default when the request does not name one.
4. **Read the state.** Read every `source/*.ir.json`, `<draw-dir>/references/ir-reference.md`,
   and the run's targets (which of `drawio/`, `mermaid/` exist).
5. **Check drift (draw.io runs).** Run `drift` on the combined file with all IRs, and on each
   `drawio/<slug>.drawio` with its IR. Keep the recovered `bundle` options for the re-bundle.
   When drifted: list the changes in plain words, then
   - label-only request → use `relabel` on each drifted file (geometry kept), update the IR
     labels too so the model stays the source, and skip re-emit for those files;
   - structural request → ask once: "re-draw and lose these hand edits" or "stop"; on
     re-draw, pass the drifted files to `snapshot --extra` so they are recoverable.
   Mermaid runs skip this step.
6. **Route.**
   - *Undo*: "undo", "quay lại", "revert", or a revision named (`r003`). → step 9.
   - *Consult*: what-if or question phrasing ("nếu … thì", "có nên", "thử", "what if"), a
     change that removes elements or cascades (a `ref` part, a `-business` view, a removed
     element still referenced), or `--preview`. → step 8.
   - *Direct*: everything else, or `--apply`. → step 7.
   Say which route was taken in one line.
7. **Direct route.**
   - Clarify gate: every change must pin its anchor (which element it goes before or after,
     on which branch), the outcome of each new branch, and the diagrams it touches. When one
     is missing, ask one round in a single `AskUserQuestion` (≤ 4 questions, concrete
     placements as options, in the user's language as the draw skill requires).
   - `snapshot --request "<request>"` (plus `--bundle`), edit the IRs (new ids from names,
     old ids unchanged, cascade to `ref` parts and `-business` views by `variants.md`), run
     `diff` between the new revision's `source/` and the edited `source/`, then the closing
     contract.
8. **Consult route** — read `references/consult-protocol.md`.
9. **Undo route.** `revisions`, show the newest five as `rNNN · date · request`, ask which one
   unless the request named it or said "the last change" (→ newest), then `restore`, then
   the closing contract (re-emit, re-bundle with the stored `bundle` options, review).
10. **Report.** The closing contract's report plus: route taken, revision number written,
    the `diff` change list in plain words, drift outcome, and where the previous version is
    (`history/rNNN`).

Rules: never edit `.drawio` or `.mmd` by hand; never touch `history/` except through the CLI;
a run produced by `scout` that receives a hypothetical change gets a `meta.notes` entry
saying it no longer reflects the code at that point.

## consult-protocol.md content

1. Find the axis of choice: the readings of the request that lead to different diagrams
   (placement, branch outcome, which actor owns the step, replace vs add beside).
2. Build 2-3 drafts, each a full copy of the run's IRs under `drafts/<a|b|c>/source/`,
   differing on that axis. Build one draft only when a single reading is viable and say why;
   never invent a variant to reach a count. Questions the axis does not cover are asked
   first, in one round.
3. For each draft: `validate` every IR (fix until it passes), emit into
   `drafts/<x>/drawio|mermaid/`, bundle into `drafts/<x>/<run-slug>.<drawio|md>`, and run
   `diff <run>/source <run>/drafts/<x>/source`. No review gate on drafts.
4. Present: one block per draft with a one-line name, the change list in plain words
   (added, removed, changed, cascade hints), the path of its combined file, and for Mermaid
   runs the draft's Mermaid text in a fenced block. End with one `AskUserQuestion`: pick a
   draft, ask for changes to one, or drop all.
5. Iterate on the chosen draft in place (re-validate, re-emit, re-diff) until the user confirms.
6. Confirm: `snapshot --request "<request> (draft <x>)"`, copy `drafts/<x>/source/*.ir.json`
   over `source/` (removing IRs the draft removed), delete `drafts/`, run the closing contract.
7. Drop: delete `drafts/`; `source/` and outputs were never touched.

## Verification

- CI frontmatter script, extended in phase 5, accepts `skills/revise/SKILL.md`.
- Walkthroughs in phase 6 exercise every numbered step.

## Risks

- Routing overlap with draw ("add a step to the login diagram" with no run on disk). Mitigation:
  revise stops with "no delivered run found; use draw" when step 3 finds nothing.
- Drafts left behind if the session ends mid-consult. Mitigation: step 3 reports an existing
  `drafts/` folder and offers to resume or drop it.
