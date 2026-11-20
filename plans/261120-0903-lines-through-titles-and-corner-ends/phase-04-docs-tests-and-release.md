---
phase: 4
title: "Docs, test sweep and release 2.8.1"
status: completed
priority: P2
effort: "0.5d"
dependencies: [1, 2, 3]
---

# Phase 4: Docs, test sweep and release 2.8.1

## Goal

The references describe the three behaviours, the whole suite passes with every changed
snapshot checked on a render, the bundle is rebuilt and the patch release is cut.

## Context

- draw.io reference: `skills/draw/references/target-drawio.md`. Rows that own these facts:
  `state initial / final` (:168), "flowchart group, plain architecture boundary" (:171, the
  title that steps aside), `class relation` (:180), and the layout rule "Line ends on one
  side of a node" (:257).
- Maintainer notes: `docs/architecture.md`, section "Graph kinds in draw.io".
- Release files of 2.8.0: `.claude-plugin/plugin.json`, `skills/draw/scripts/package.json`,
  `package-lock.json`, `README.md` (Status), `docs/install.md` ("Upgrading to 2.8.0", :771),
  `skills/draw/scripts/bin/cli.mjs` (rebuilt by `build.mjs`, checked by
  `tests/bundle-drift.test.mjs`; the bundle carries the version).
- Render test: `tests/fan-in-render-e2e.test.mjs` measures the viewer's SVG and is skipped
  without Playwright.

## Files to Modify

- `skills/draw/references/target-drawio.md`, `docs/architecture.md`, `docs/install.md`,
  `README.md`.
- `.claude-plugin/plugin.json`, `skills/draw/scripts/package.json`, `package-lock.json`,
  `skills/draw/scripts/bin/cli.mjs`.
- `skills/draw/scripts/tests/fan-in-render-e2e.test.mjs`.

## Steps

1. Docs: the composite state joins the frames whose title steps aside; a class relation
   ends on the table when a self-relation widened its box; a line meets the circle of an
   initial or final state on its outline. Upgrade notes "Upgrading to 2.8.1" say what a
   re-emitted file can differ in.
2. Render cases in the e2e test: a composite entered by three lines (title text against
   the lines), the class probe (arrowheads on the top side), three lines out of an initial
   state (no stretch across the flow). Each must fail on the 2.8.0 bundle.
3. Full `npm test`; regressions are fixed against renders, never by loosening an assertion.
4. Compare the outputs that must not change with the 2.8.0 bundle: class without a
   self-relation, ER, architecture, use case, sequence, activity.
5. Bump the patch version, rebuild the bundle, update the README status paragraph.

## Validation

- `npm test`, `bundle-drift`, and the acceptance criteria of `plan.md` on fresh renders
  through the rebuilt bundle.

## Risk and rollback

- The render test needs the viewer script; it is skipped without Playwright, like the
  export tests.
- Rollback: revert the release commit.
