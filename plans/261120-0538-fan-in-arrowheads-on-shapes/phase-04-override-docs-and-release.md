---
phase: 4
title: "fanIn override, docs, tests sweep and release"
status: completed
priority: P2
effort: "0.5d"
dependencies: [3]
---

# Phase 4: `fanIn` override, docs, tests sweep and release

## Goal

A flowchart or state diagram can pin its fan-in look with `fanIn: auto | merge | separate`;
architecture always keeps arrows separate and its schema rejects `fanIn`; docs describe the
rule; the bundle is rebuilt and the release is cut.
<!-- Updated: Validation Session 1 - fanIn limited to flowchart and state -->

## Context

- IR schema: `skills/draw/scripts/src/schema/ir-v1.schema.json` is discriminated on `kind`
  (`oneOf` :27). Shared fields live in `$defs/envelope` (`direction` :156, defined at
  `$defs/direction` :81), and every kind sets `unevaluatedProperties: false`. `fanIn` goes
  into `$defs/flowchart` and `$defs/state` only, so any other kind rejects it.
  <!-- Updated: Validation Session 1 - schema location corrected -->
- Release files in the last release (2.7.1): `.claude-plugin/plugin.json` (version),
  `skills/draw/scripts/package.json`, `package-lock.json`, `README.md`, `bin/cli.mjs`.
- IR docs: `skills/draw/references/ir-reference.md` (flowchart :65); draw.io layout rules:
  `skills/draw/references/target-drawio.md` (:205).
- The consumer bundle `skills/draw/scripts/bin/cli.mjs` is built by `build.mjs` and checked
  by `tests/bundle-drift.test.mjs`.
- Releases bump the version in `skills/draw/scripts/package.json` and the plugin manifests,
  as in the 2.7.x commits.

## Files to Modify

- `schema/ir-v1.schema.json` (`$defs/flowchart`, `$defs/state`).
- `emit-drawio.mjs`: `emitFlowchart` and `emitState` read `ir.fanIn` (default `auto`).
- `references/ir-reference.md`, `references/target-drawio.md`.
- `.claude-plugin/plugin.json`, `package.json`, `package-lock.json`, `README.md`,
  `bin/cli.mjs` (rebuilt).

## Steps

1. Schema and emitter: `fanIn` enum on flowchart and state; `merge` merges any mergeable
   subset of 2 or more, `separate` never merges, `auto` merges a mergeable subset of 5 or
   more. A test checks that an architecture IR with `fanIn` fails validation.
2. Docs: the decision table, the 10 px gap, and when to pin `fanIn`.
3. Full `npm test`; fix regressions against renders, never by loosening assertions.
4. Rebuild the bundle, bump the minor version, update the changelog section of the README
   if the project keeps one there.

## Validation

- `npm test`, `bundle-drift`, and the acceptance criteria in `plan.md` on fresh renders.

## Risk and rollback

- Unknown `fanIn` values must fail validation, not be ignored.
- Rollback: revert the release commit.
