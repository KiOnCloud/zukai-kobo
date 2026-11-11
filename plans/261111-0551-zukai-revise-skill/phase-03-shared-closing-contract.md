---
phase: 3
title: "Shared closing contract"
status: pending
priority: P1
effort: 2h
dependencies: []
---

# Phase 3: Shared closing contract

## Goal

Keep one copy of the closing contract that both skills read, and make the draw skill hand
changes of a delivered run to revise.

## Key insights (verified)

- The contract lives in `skills/draw/SKILL.md` from `## Closing contract` (line 184) to the
  end, including "Rules that hold in every mode".
- It is cited as "the closing contract from `SKILL.md`" in
  `references/scout-protocol.md` (lines 6, 116), `references/clarify-protocol.md` (lines 4, 139)
  and `references/variants.md` (line 91).
- No test reads that section; CI only checks the frontmatter keys and `name: draw`.

## Files to create / modify

- Create `skills/draw/references/closing-contract.md`: the section moved verbatim, plus one
  paragraph "When revise calls this contract": reuse the run folder and its run slug, skip
  step 6 (offering other targets) unless the user asks, and in step 5 add the revision number
  and the change list.
- Modify `skills/draw/SKILL.md`: replace the section with a short pointer that says every mode
  ends by reading and running `references/closing-contract.md` in full, with no shortcut.
  Append to the `description`: "To change a diagram that was already delivered, use the
  revise skill."
- Modify `skills/draw/references/scout-protocol.md`, `clarify-protocol.md`, `variants.md`:
  point at `references/closing-contract.md`.

## Tasks & steps

1. Move the text verbatim (no rewording in the same change, so review is a pure move).
2. Add the revise paragraph.
3. Update the three references and the SKILL.md pointer.
4. `grep -rn "closing contract" skills/` shows no remaining pointer at `SKILL.md`.

## Verification

- `git diff --stat` shows the moved block as removed from SKILL.md and added to the new file
  with only the revise paragraph as new text.
- Frontmatter CI step (run locally with the same `node -e` script from `.github/workflows/ci.yml`) passes.
- `npm test` passes (no test reads the moved section; this guards against accidental edits elsewhere).

## Risks

- A model may stop reading after the pointer. Mitigation: the pointer keeps the heading
  "Closing contract (every mode ends here, with no shortcut)" and names the file as mandatory.
