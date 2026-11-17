# E2E round: scout, sync, description tables and SVG pictures (2026-11-17)

Tester played the user's agent (following the installed skill text literally) and the user.
Nothing in the repository was edited; this report is the only file created.

## Setup

- Sample project: `/tmp/claude-0/-home-user-zukai-kobo/dfd23dcb-7283-57de-90e1-1d422710abbb/scratchpad/e2e-a/shop-api`
  (git repo, Node ESM service, 11 source files: `src/server.js`, `src/http/login-handler.js`,
  `src/http/order-handler.js`, `src/auth/{auth-service,user-repository,session-store,lockout-policy,password-hasher}.js`,
  `src/orders/order-status.js`, `src/db.js`, `src/redis.js`). The folder did not exist at the
  start of this round, so it was built from scratch.
- Install: `bash /home/user/zukai-kobo/install.sh --target claude-project --dest <project>`
  installed `zukai`, `zukai-revise`, `zukai-recook`, `zukai-sync` 2.2.2 under `.claude/skills/`.
  Only `.claude/skills/` was created (no `.claude/agents/`).
- Only the installed copies were read. CLI: `node .claude/skills/zukai/scripts/bin/cli.mjs` (`$C` below), Node v22.23.4.
- Renderer for `preview` / `export`: `drawio-web` (Playwright) in every call.

## Scenario A: scout, sequence, detailed, both, `--svg --doc` — PASS (with layout findings)

Request: `/zukai scout --kind sequence --scope detailed --audience both --svg --doc the login flow`.

Opening call: every question was fixed by a flag, so nothing was asked. One line said to the
user: "`both` with two parts gives six diagrams."

Commands (all exit 0 unless noted):

```text
$C validate source/<each>.ir.json        # 1 model warning on login-02-create-session-business (reply before its call), fixed in the IR
$C emit --to drawio source/<slug>.ir.json --out drawio/<slug>.drawio      (x6)
$C bundle --to drawio --out login.drawio --title "Login" --canvas all diagrams/20261117_login
$C bundle --to doc --lang en --out login.doc.md --title "Login" diagrams/20261117_login
$C preview login.drawio --max-px 1600    # 6 tiles; and each drawio/<slug>.drawio
$C export diagrams/20261117_login        # 7 pictures, "text":"svg", warnings 0
$C sources diagrams/20261117_login       # 6 diagrams, missing 0
$C stale diagrams/20261117_login         # exit 0, stale false
```

Files produced in `diagrams/20261117_login/`: `source/{login,login-business,login-01-record-failure,login-01-record-failure-business,login-02-create-session,login-02-create-session-business}.ir.json`,
`source/login.sources.json`, `drawio/*.drawio` (6), `login.drawio`, `login.doc.md`,
`svg/{canvas,login,login-business,login-01-…,login-02-…}.drawio.svg` (7).

Checks:

- `meta.sources` in all six IRs (main 7 files, part 01 4 files, part 02 3 files; each business view carries the list of its technical diagram). OK.
- Sources record written, `"root": "../.."`, one SHA-256 per file. OK.
- SVG: each file starts with `<svg content="&lt;mxfile …` (opens in draw.io). Three were rendered to PNG through an `<img>` tag in headless Chromium and opened: they display, with title, and a `ref` message shows the part's title. OK.
- `login.doc.md`: first line `<!-- zukai doc, lang=en: …`, six sections in run order, participants and numbered steps with block conditions, `ref` steps link to the section of the part, "Not shown on purpose" lists. English, complete. OK.
- Review (done inline in the reviewer's voice, no `diagram-reviewer` agent exists in this install): `Verdict: PASS`, round 1, all images opened; findings listed as `emitter:` (F2, F14).

## Scenario B: stale, code change, `/zukai-sync`, undo — PASS

1. `$C stale diagrams/20261117_login` on the fresh run: exit 0, `"stale":false`.
2. Code change: new `src/auth/audit-log.js` and two `audit.record(...)` calls in `auth-service.js`
   (wired in `login-handler.js`); `MAX_FAILED_ATTEMPTS` 5 to 3 and `LOCK_MINUTES` 15 to 30 in
   `lockout-policy.js`; one comment line added in `session-store.js`.
3. `$C stale …`: exit 2; `changed` lists the four edited files per diagram (the new file is not listed, as the skill says).
4. Sync by its SKILL.md: `drift` on the combined file and the six single files (nothing drifted, `bundle` = `{"title":"Login","canvas":"all","gap":120}`);
   draft in `drafts/a/source/`, `drafts/consult.json`; `validate`; `diff source drafts/a/source`; emit and bundle of the draft.
5. Change list shown to the user:
   - Login (POST /login) `login`: added participant "AuditLog", messages "record('login_failed', email, user.id)" after `recordFailure` and "record('login_succeeded', email, user.id)" after `reset` (`src/auth/auth-service.js`, `src/auth/audit-log.js`).
   - recordFailure part: block "failedAttempts >= 5" is now ">= 3", "fewer than 5" now "fewer than 3", "now + 15 min" now "now + 30 min" (`src/auth/lockout-policy.js`).
   - Its business view: "5th failed attempt in a row" now "3rd", "15 minutes" now "30 minutes".
   - `login-business`: only `meta.sources` / `meta.notes` (audit logging is an implementation step, not shown in a business view).
   - No effect: `src/auth/session-store.js` (comment), `src/http/login-handler.js` (wiring).
   - Question (AskUserQuestion): "Apply the sync? (apply / drop the draft / a correction)". User: "apply".
6. Apply: `$C snapshot … --request "sync with the code" --bundle @bundle.json` (r001, keeps `login.sources.json`), copy, delete `drafts/`,
   `diff history/r001/source source --drawio drafts/changes-r001.diff.drawio`, emit x6, bundle, `bundle --to doc`, previews, review PASS (round 1),
   `export` (all 7 SVG rewritten), `sources` (main now 8 files), `stale`: exit 0.
   `login.doc.md` has the two new steps and the new values; `svg/login.drawio.svg` contains "AuditLog".
7. `/zukai-revise undo`: `$C revisions` (`undo: r001`), `$C restore … undo --bundle @bundle.json` gives
   `"restored":"r001","snapshot":"r002","sourcesRecord":"restored"`; outputs rebuilt (emit, bundle, doc, export).
   `stale` then lists the four changed files again (exit 2, confirmed on a copy of the run restored to r001). Tables and pictures no longer mention AuditLog.
   `restore … redo` brought the synced state back byte for byte (`git status` clean apart from `history/`).

## Scenario C: sync on runs it cannot or need not change — PASS

- C1, run not scouted: `diagrams/20261117_password-reset` (flowchart, `meta.source: "clarify"`, made by the draw skill's contract).
  Sync step 2 finds no scouted diagram and refuses with the line of `zukai-sync/SKILL.md:95-98`. CLI agrees:
  `$C stale diagrams/20261117_password-reset` exit 1 `no sources record …`; `$C sources …` exit 1 `no diagram of this run names its source files, so there is nothing to record`.
- C2, scouted run without record: deleted `source/order-status.sources.json` of the run of scenario E.
  `$C stale …` exit 1 `no sources record`, the skill asks once (record it / compare with the code now / stop).
  - Answer "record it": `$C sources …` (1 diagram, 2 files, missing 0), stop; `stale` exit 0.
  - Answer "compare with the code now" (record deleted again): drift check, re-read of both files, no IR change, step 8 first case: `sources`, `stale` exit 0. Nothing else written.

## Scenario D: `/zukai-revise add a rate limit check before the password check` — PASS

- Run found by its labels; `drafts/` held only `changes-r001.diff.drawio`, so no open consult. `drift`: nothing drifted.
- Route: consult (a step added that has to be carried into the business view).
- Questions before the drafts (AskUserQuestion): "Which limit?" User: "10 attempts per minute"; "What does a caller over the limit get?" User: "429 too_many_requests".
- Drafts: A "after the lockout check, right before verifyPassword", B "first thing in login, before the user lookup"; each validated, emitted, bundled, `diff … --drawio drafts/<x>/changes.diff.drawio`. Question: "A, B or drop all drafts?" User: "A".
- Confirm: `snapshot` (r004), note "no longer reflects the code from r004 on" and `meta.source: "manual"` in `login` and `login-business`, copy, delete `drafts/`,
  `diff history/r004/source source --drawio drafts/changes-r004.diff.drawio` (`"written":true`), emit, bundle, `bundle --to doc`, previews, `export`.
- Picture of the change is at `diagrams/20261117_login/drafts/changes-r004.diff.drawio`, where the skill says. Rendered with `preview` and opened: new participant, the three new messages and the new `alt` frame are green; legend present. Three enclosing frames are amber although nothing visible about them changed (F3).
- `svg/*.drawio.svg` all rewritten (same second as the export), `svg/login.drawio.svg` contains "RateLimiter"; `login.doc.md` has the new participant, steps and the business rejection. No sources record written, as the contract says.

## Scenario E: `/zukai scout --kind state the order status`, tables in Japanese — FAIL on first emit, PASS after one review round

- Opening call (AskUserQuestion, two questions): "Which level of detail? overview (suggested) / detailed". User: "overview". "Which view? technical (suggested) / business / both". User: "technical".
- IR `order-status` from `src/orders/order-status.js` and `src/http/order-handler.js`; CANCELLED and REFUNDED written as `kind: "final"` because `scout-protocol.md:85` says so.
- `validate`: `model: no initial state; the reader cannot tell where the thing starts` (kept, recorded in `meta.omitted`: the code creates no order).
- First preview: the two end states are drawn as unnamed end circles; "CANCELLED" and "REFUNDED" appear nowhere in the picture, with no warning (F1). Review round 1 `FAIL`; fixed by making both simple states; round 2 `PASS`.
- `$C bundle --to doc --lang ja --out order-status.doc.md --title "Order status" <run>`; `sources`; `stale` exit 0.
- Read as a Japanese reader: headings and fixed words are Japanese and natural (`図の種類: 状態遷移図`, `状態一覧`, `状態遷移表`, `意図的に省略した内容`); the state by event table is correct and complete
  (6 states, 5 events, guard on DELIVERED/refund). Title, guard and the omitted note stay English (`→ REFUNDED [at most 30 days since delivery]`), so the document is mixed (F6). `種別: 単純` is an unusual word for an ordinary state (F15).
- Second file with translated labels by `variants.md:158-162`: works (`order-status.doc.ja.md`, guard `配達から30日以内`), but the skill does not say where the translated IR lives (F6).

## Findings

| Id | Grade | Where | What happened | Expected |
|---|---|---|---|---|
| F1 | High | `zukai/references/scout-protocol.md:85` ("statuses with no outgoing assignment are `final`"), `ir-reference.md:148`; CLI `emit --to drawio` and `--to mermaid` | A `final` state with a label validates, and both targets drop the label without any warning: the picture shows two anonymous end circles, `grep -c CANCELLED drawio/order-status.drawio` is 0, Mermaid writes `n1 --> [*] : cancel`. The description tables list "CANCELLED / 終了", so picture and tables disagree. Following the scout rule literally gives a state diagram without two of its six statuses. | Either draw the label of a final state, or warn (`degraded`) that it is lost, and have the scout rule say: a terminal status is a simple state, optionally followed by a final one. |
| F2 | Medium | CLI draw.io sequence layout (`drawio/login-01-record-failure.drawio`, `login-business.drawio`, also in the SVGs) | Labels of self-messages inside an `alt` frame run over the frame's right border and are cut by the activation bar ("lockedUntil = null" starts under the bar; "↳ Counting a failed attempt (business view)" crosses both frame borders). No `layout:` warning. | Frame wide enough for the self-message labels, labels clear of the activation; or a `layout:` warning. |
| F3 | Medium | CLI `diff` and `diff --drawio`; `zukai-sync/SKILL.md:245-246`, legend text of the picture | Inserting one message marks every enclosing block as `changed` with `fields: ["branches"]`: three or four `alt` frames are drawn amber although the reader sees no change in them. The JSON gives only the new label and the field names, never the old value, while sync asks for "what the label or field was and is"; the legend says "the old value is listed below" and then lists only "branches changed". | Membership cascades not reported as a change of the block (or marked as such), and old values in the `changed` entries. |
| F4 | Medium | `zukai/references/closing-contract.md:69-70`, `scout-protocol.md:4`, `review-checklist.md:3`, `zukai-sync/SKILL.md:211` | "in Claude Code spawn the `diagram-reviewer` agent" / "the `source-scout` agent", but `install.sh --target claude-project` installs skills only (no `.claude/agents/`). The text gives the inline review to "other runtimes", so Claude Code with this install has no rule. | One sentence: when the agent is not installed, review inline as other runtimes do. |
| F5 | Medium | `zukai-sync/SKILL.md:81-83` against `zukai-revise/SKILL.md:111-112` | After any revise the run keeps `drafts/changes-rNNN.diff.drawio`. Sync says a `drafts/` folder is "reported first. Offer to drop it or to stop; a sync never starts on top of drafts", with no exception for a folder that holds only change pictures, as revise has. Every sync after a revise would start with that question. | The same exception in the sync skill. |
| F6 | Medium | `zukai/SKILL.md:78-80`, `closing-contract.md:219-222`, `variants.md:158-162`, `closing-contract.md:252-256` | A user who writes English and asks for the tables in Japanese: the text does not say whether that is `<run>.doc.md` with `--lang ja` or a second file `<run>.doc.ja.md`, and the labels stay English either way (mixed document). The route with translated IRs names no place for them: in `source/` (the Mermaid convention) the run bundle becomes two diagrams (`"order":["order-status","order-status.ja"]`) and `stale` exits 2 with `"unrecorded":["order-status.ja"]`; kept outside, the table still prints `ソース: source/order-status.ja.ir.json`, a path that does not exist. By the text of the revise section, the next revision rewrites every `doc.<lang>.md` from the run folder, which would replace the translated labels (read, not run). | A rule for "tables in language X" (file name, whether labels are translated), a place for translated IRs that bundle and stale ignore, and a revise rule for such a file. |
| F7 | Medium | `zukai-sync/SKILL.md:263-276` against `consult-protocol.md:95-98` and `closing-contract.md:262-268` | "Follow step 6 of the consult protocol, Confirm, with these values" is followed by five steps that leave out consult step 6.4 (the picture of the change). Whether a sync writes `drafts/changes-rNNN.diff.drawio` and shows it to the reviewer is left open; I wrote it. | Say it either way. |
| F8 | Low | `consult-protocol.md:93`, `zukai-sync/SKILL.md:270` against `zukai-revise/SKILL.md:111-112` | "Delete `drafts/`" on confirm also deletes the pictures of earlier changes that revise says "are left where they are" (`changes-r001.diff.drawio` was gone after scenario D). | Delete the draft folders and `consult.json` only, or drop the sentence about keeping. |
| F9 | Low | `zukai-revise/SKILL.md:215-245` (undo route) | After `restore undo`, `drafts/changes-r001.diff.drawio` still shows the change that was just undone; no rule. | Remove or name it in the report. |
| F10 | Low | CLI `diff --drawio` | A diagram whose only difference is `meta.sources` / `meta.notes` gets a page: `{"diagram":"login-business","state":"changed","added":0,"changed":0,"removed":0}`. | Listed under `unchanged`, or a state of its own. |
| F11 | Low | `closing-contract.md:167-170` and steps 4 to 6; `zukai-sync/SKILL.md:74` | The `sources` command has no step number ("after the review gate and before the report"), so its order against step 5 (pictures) is open. Sync 1.3 says "None: stop with the line of step 2", which reads as list item 2 of the same section; it means section 2. | A numbered place; "the refusal of section 2". |
| F12 | Low | `zukai-sync/SKILL.md:177-179` | "in the place in the array that matches the order of execution" gives no place for a new participant (or lane, class). I appended it. | "A new participant is appended" or similar. |
| F13 | Low | `closing-contract.md:231-233` against CLI `bundle --to doc` | "the `model:` and `detail:` warnings … are not shown twice", but `bundle --to doc` printed `model: no initial state…` again (`"warnings":1`). | Text and CLI agree. |
| F14 | Low | CLI draw.io sequence layout (`drawio/login.drawio`) | A call without a reply (`reset(user)`, `recordFailure(user)`) gets a one-row activation; the next message to a lifeline further right has its label starting on that activation, and the two-line label of `create(user.id)` touches it. | Label centred on its arrow, clear of activations. |
| F15 | Low | `bundle --to doc --lang ja`, all languages for the second point | `種別` of an ordinary state is `単純`; a design document would say `通常` or `状態`. The Condition column prints `alt else: both present` in every language, which a business reader does not know. | Reader's words. |
| F16 | Low | `zukai/SKILL.md:23`, `cli.mjs help` | The usage block of SKILL.md shows `emit --to <mermaid\|drawio\|figjam>` without `doc` and `--lang`; `help` lists `--mermaid-stable` for `emit` only, while `closing-contract.md:245` passes it to `bundle` (the CLI accepts it there). | Same options in both. |
| F17 | Low | CLI `drift` on a one-diagram combined file | `$C drift order-status.drawio <run>` returns `"bundle":{}`: the `--title "Order status"` of the bundle is not recovered (a canvas run returns it). | Title kept, or the text says a one-page file has none. |
| F18 | Low | CLI `stale` / `restore` | A run folder copied under another name: `restore … r001` answers `"sourcesRecord":"restored"`, then `stale` exits 1 `no sources record`, because the record is looked up as `<new-slug>.sources.json`. Renaming a run folder silently orphans its record. | A hint that names the record it found under another name. |
| F19 | Low | CLI `preview`, `closing-contract.md` step 5 | `$C preview svg/login-business.drawio.svg` exits 1: `preview takes a .drawio or .mmd file, or the combined .md file of a Mermaid run`. The pictures of step 5 are delivered without any look at them; checking one needed a hand-made browser script. | `preview` accepts `.drawio.svg`, or step 5 says how the pictures are checked. |
| F20 | Low | `scout-protocol.md:84-85` | "The default or constructor value is the `initial` state" has no rule for code that never creates the thing; the `model:` warning then stays in every emit of the run. | A rule (omit and record, or draw the first status of the table as initial). |

No CLI command named in the installed skill text was rejected. No process of mine is left
running (the two headless-browser runs closed; browsers and a test runner seen in `ps`
belong to other sessions and were not touched).

## Unresolved questions

- F6: should "tables in Japanese" translate labels at all, or is a mixed document the intended result?
- F1: is a labelled final state meant to be valid input?
