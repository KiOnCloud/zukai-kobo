# Consult protocol

Used by the revise skill when a request asks what a change would look like, when it removes
elements or reaches a `ref` part or a business view, or when `--preview` is given. The user
sees real drafts of the run, compares them, adjusts one and confirms it; only then is the run
written. Paths below are relative to the run folder; `<draw-dir>` and the CLI are located as
`SKILL.md` describes.

```text
drafts/a/source/*.ir.json      a full copy of the run's IRs with draft a's change
drafts/a/drawio/<slug>.drawio  or mermaid/<slug>.mmd: each diagram of the draft
drafts/a/<run-slug>.drawio     or <run-slug>.md: the draft as one file
drafts/b/ …                    the next draft, same layout
```

## 1. Find the axis of choice

Read the request against the IRs and list the readings that lead to different diagrams:
where the new element goes, what happens on its failure branch, which actor or lane owns it,
whether "B" replaces "A" or stands beside it, whether the business view changes too. The
readings that differ on one of these are the drafts. A question the drafts do not answer
(a value, a name, a threshold) is asked first, once, with `AskUserQuestion`, at most four
questions, in the user's language.

## 2. Build two or three drafts

Each draft is a complete copy of `source/` under `drafts/<a|b|c>/source/` with one reading
applied, by the same editing rules as the direct route (stable old ids, new ids from names,
cascade into `ref` parts and `-business` views). Build two or three drafts that differ in a
way the user would notice. When only one reading is viable, build one draft and say why in
one sentence; never invent a variant to reach a count.

## 3. Check and emit each draft

For each draft:

1. `validate` every IR; on errors fix only the listed paths and validate again.
2. Emit each diagram into `drafts/<x>/drawio/` or `drafts/<x>/mermaid/` with
   `emit --to <target> --out`, then `bundle` into `drafts/<x>/<run-slug>.<drawio|md>` with
   the run's `bundle` options (from `drift`, or the run's feature name as title).
3. `diff <run>/source <run>/drafts/<x>/source` for the change list and its hints.

Print every CLI warning verbatim. No review gate runs on drafts: the review runs once, on the
confirmed result.

## 4. Present the drafts

One block per draft, in the user's language:

- a one-line name that says what is different ("A: kiểm tra trước khi thanh toán");
- the change list in plain words: added, removed and changed elements by their labels, the
  diagrams touched, and every hint from `diff`;
- the path of the draft's combined file, to open in draw.io;
- for a Mermaid run, the draft's Mermaid text of each changed diagram in a fenced `mermaid`
  block, so it can be read without opening a file.

Then one `AskUserQuestion`: one option per draft (its name, the change list in short as the
description), plus "drop all drafts". The user can also answer with a change to one draft.

## 5. Adjust

A change asked for one draft is made in that draft's `source/`, then step 3 runs again for
it and step 4 shows it again with the other drafts gone. Repeat until the user confirms.

## 6. Confirm

1. `snapshot <run> --request "<the request> (draft <x>)" --bundle '<bundle json>'`, plus
   `--extra` for files that drifted (the skill's step 3).
2. Copy `drafts/<x>/source/*.ir.json` over `source/`; delete IRs from `source/` that the
   draft does not have, with their `drawio/<slug>.drawio` or `mermaid/<slug>.mmd`.
3. Delete `drafts/`.
4. Run `<draw-dir>/references/closing-contract.md` in full. The report names the draft
   chosen and the revision written.

## 7. Drop

Delete `drafts/` and say that the run is unchanged. `source/`, the delivered files and
`history/` were never touched, so nothing else needs undoing.
