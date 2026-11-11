---
phase: 5
title: "Distribution and docs"
status: completed
priority: P2
effort: 0.5d
dependencies: [4]
---

# Phase 5: Distribution and docs

## Goal

Install and document the second skill on every channel, and release it as 2.0.0.

## Key insights (verified)

- The plugin channel picks up `skills/revise/` automatically (`.claude-plugin/plugin.json`
  declares no skill list); the plugin exposes it as `/zukai:revise`.
- `install.sh` and `install.ps1` copy only `skills/draw`, rename `name: draw` to
  `name: zukai`, and track the version in `.zukai-version`
  (`install.sh` lines 42-46, 99-133; `install.ps1` line 27).
- CI asserts `name: draw` in `skills/draw/SKILL.md` and portable frontmatter keys only
  (`.github/workflows/ci.yml`).
- Version `1.2.0` appears in `.claude-plugin/plugin.json`, `skills/draw/scripts/package.json`
  and `README.md` line 223.

## Files to modify

- `install.sh`, `install.ps1`: install two skills, `draw` → `zukai` and `revise` →
  `zukai-revise`, each with its own temp copy, name rewrite, version marker
  (`.zukai-revise-version`), backup and atomic move. One failure leaves both destinations as
  they were (copy both temp folders before moving either).
- `skills/draw/scripts/tests/install.test.mjs`: both folders installed with the right
  `name:` line; an up-to-date install of both is left alone; revise can find
  `../zukai/scripts/bin/cli.mjs` from its installed folder.
- `.github/workflows/ci.yml`: run the frontmatter check on both SKILL.md files, asserting
  `name: draw` and `name: revise`.
- `.claude-plugin/plugin.json`, `skills/draw/scripts/package.json`: version `2.0.0`
  (`build.mjs` does not embed the version, so the bundle is unaffected).
- `README.md`: Usage section gains `/zukai:revise` with the three routes and examples;
  "How it works" and "Output" show `history/` and `drafts/`; Other runtimes table gains
  `$zukai-revise` and `/zukai-revise`; status line says 2.0.0.
- `docs/quickstart.md` section "5. Change something later": replace "edit the IR and emit
  again" with `/zukai:revise` examples (direct, what-if, undo), keeping the manual route as
  a fallback.
- `docs/install.md`: Codex and fallback sections list both folders; uninstall removes both;
  an "Upgrading to 2.0.0" note says what changed for forks: the closing contract moved to
  `skills/draw/references/closing-contract.md`, a second skill folder is installed, and run
  folders may now hold `history/` and `drafts/`. Existing `.ir.json` files are unaffected.
- `docs/architecture.md`: a "Revising a run" section (revision layout, drift by re-emit,
  per-run snapshots, why drafts never touch `source/`), and the Testing strategy paragraph
  names the new tests.

## Tasks & steps

1. Update both installers; run `install.sh --target codex --dest <tmp>` and
   `--target claude-project --dest <tmp>` by hand and inspect both folders.
2. Update tests and CI.
3. Bump versions, rebuild, `npm test`.
4. Update README and docs; check every link and command in them against the code.

## Verification

- `npm test` passes (install tests run where `sh` is available).
- CI frontmatter script passes locally for both skills.
- `claude plugin validate . --strict` passes (pre-release step in `docs/install.md`).
- On Windows-only behaviour: `install.ps1` reviewed line by line against `install.sh`;
  run it if a PowerShell is available, otherwise state that it was not executed.
