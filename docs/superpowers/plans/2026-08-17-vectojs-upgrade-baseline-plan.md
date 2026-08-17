# VectoJS Upgrade and Graph Baseline Implementation Plan

## Scope

Implement CTX-0059 without changing product behavior. Upgrade compatible VectoJS packages, add deterministic baseline infrastructure, compare commit `63d7f9a` against the candidate in headed Chrome and Firefox, and deliver only if correctness and regression gates pass.

## 1. Deterministic Core

Create focused modules and Bun tests under `scripts/vectojs-baseline/`:

- report types, validation, and canonicalization
- source, build, fixture, browser, and package-tree manifests
- nearest-rank percentiles and five-run medians
- percentage, bounded, and zero-required comparisons
- rectangle overlap, viewport escape, and finding classification

Gate:

```bash
bun test scripts/vectojs-baseline
oxfmt --check scripts/vectojs-baseline
oxlint --deny-warnings scripts/vectojs-baseline
```

## 2. Frozen Fixtures

Add `scripts/fixtures/vectojs-baseline/manifest.json`, bounded API responses, and the sparse-500, hub-1000, and mixed-3000 graph files. Add explicit graph generation and fixture validation tests. Normal captures only read and hash committed bytes.

Gate:

```bash
bun test scripts/vectojs-baseline
bun run scripts/vectojs-baseline/generate-graphs.ts --check
```

## 3. Browser Instrumentation

Add `apps/web/src/testing/omm-app-instrumentation.ts`, its tests, a typed window declaration, and minimal read-only geometry getters in existing UI owners. Preserve current `window.__OMM_APP__` compatibility. Expose readiness, animation state, camera, graph counts, pointer ownership, stable control targets, hit ownership, drawer state, and tool state. Do not redesign controls or add DOM layout.

Gate:

```bash
bun test apps/web/src/testing/omm-app-instrumentation.test.ts
bun run --filter '@omm/web' build
```

## 4. Isolated Arm Preparation

Implement helpers for clean revision checks, baseline worktree creation at `63d7f9a`, isolated Bun caches, two frozen installs per arm, exact production builds, package resolution checks, hashes, temporary physics bundles, and cleanup. A diagnostic preparation run must produce two independently hashed artifacts without changing either lockfile or source tree.

## 5. Browser and Physics Runner

Create the repository entry `scripts/vectojs-baseline.ts` and focused browser, route, interaction, physics, graph-metric, and audit modules. Use direct Playwright, production previews, fixture interception, fresh contexts, fixed browser hashes and run order, DPR checks, and guaranteed cleanup.

Gate: one diagnostic repetition passes in headed Chrome and Firefox before all five repetitions run.

## 6. Dependency Upgrade

Modify `apps/web/package.json`, root `package.json`, and `bun.lock`:

- core 1.37.0
- UI 2.18.0
- Markdown 0.21.0
- retain graph-layout 0.2.1, DevTools 0.11.1, styles 0.3.2
- remove graph3d override

Add application compatibility code only when a type, unit, or browser gate proves it necessary.

Gate:

```bash
bun install --frozen-lockfile --ignore-scripts
bun test
bun run check
bun run build
```

## 7. Paired Capture

Commit runner, fixtures, instrumentation, and dependency state before quotable capture. Run all five headed repetitions. Keep raw reports under ignored `tmp/vectojs-baseline/` and add a concise checked-in summary under `docs/superpowers/reports/`.

If a regression persists, reduce the upgrade set or file a minimal upstream issue. Do not waive a gate.

## 8. Delivery

Run all formatting, lint, test, build, diff, security, and bundle gates. Review intended changes, commit, push, open the Issue #23 PR, wait for CI/review, squash merge, verify deployment and production, checkpoint CTX-0059, and remove the clean worktree.
