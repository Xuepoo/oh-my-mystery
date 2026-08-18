# OMM 1.0.0 VectoJS Upgrade Baseline

## Capture

- Raw report: `tmp/vectojs-baseline/capture-2026-08-18T03-01-46.520Z-paired.json`
- Runner/candidate revision: `c1eb5ffedea22940405acb38011c506070bf646a`
- Instrumented pre-upgrade revision: `d183a100c0fb0a26a74067a7b805e8ac8f322d97`
- Baseline report SHA-256: `973577159075c4bc02e1162de1cde6a337256215ac47743189a75c71df30b0fd`
- Candidate report SHA-256: `a529055cd88565519d3c09ef0d31a851f9f655e0ad65e292c0f50c351c5443a9`
- Fixture SHA-256: `85f1823c4748e25884f4cbcd07ff91f8d0da1bbfb94f24513245fc30f1c5af5f`
- Matrix: five paired headed repetitions in Chrome and Firefox, desktop DPR 1,
  mobile DPR 2 at 390x844 and 412x915, and four graph workloads

The baseline uses the pre-upgrade application with the same test-only
instrumentation as the candidate. Product behavior and VectoJS dependency
versions remain pre-upgrade in that arm.

## Environment

- Linux `7.1.8-1-cachyos`, Intel Core i7-14650HX, 24 logical CPUs, 33.4 GB RAM
- Bun `1.3.14`, Playwright `1.62.1`
- Chrome `151.0.7922.137`
- Firefox `153.0`
- Production-preview builds with isolated frozen installs and distinct source,
  lockfile, installed-package, and build hashes

## Dependency Arms

| Package                 | Baseline | Candidate |
| ----------------------- | -------: | --------: |
| `@vectojs/core`         |   1.35.3 |    1.37.0 |
| `@vectojs/markdown`     |   0.20.3 |    0.21.0 |
| `@vectojs/ui`           |   2.16.7 |    2.18.0 |
| `@vectojs/graph-layout` |    0.2.1 |     0.2.1 |
| `@vectojs/devtools`     |   0.11.1 |    0.11.1 |
| `@vectojs/styles`       |    0.3.2 |     0.3.2 |

## Results

The report contains 684 comparison outcomes: 651 pass, 6 are informational,
and 27 fail. The failures divide into two classes.

### Shared Correctness Failures

Twenty-two outcomes fail absolute graph correctness in both arms with identical
values in every repetition and browser. They are not dependency-upgrade
regressions, but they still fail the specified absolute gates:

- 16 collision-overlap outcomes across initial and post-mutation phases. Counts
  range from 478 to 9,785 and are identical between arms.
- 6 peak-link-ratio outcomes for `hub-1000`, `mixed-3000`, and `drag-1000`.
  Ratios are approximately 458.61, 4,214.57, and 841.09 respectively in both
  arms, above the required maximum of 20.

These findings establish pre-existing fixture/layout correctness debt. They
must be addressed in graph-stability work or by correcting a demonstrated
benchmark-contract defect, not hidden by weakening thresholds for this upgrade.

### Candidate Regressions

Five candidate-only median comparisons exceed the normative limits:

| Browser | Workload     | Metric                 | Baseline | Candidate |   Change | Limit |
| ------- | ------------ | ---------------------- | -------: | --------: | -------: | ----: |
| Chrome  | `sparse-500` | append mutation        |  1.70 ms |   3.10 ms |  +82.35% |   15% |
| Chrome  | `sparse-500` | first post-append tick |  1.60 ms |   3.20 ms | +100.00% |   10% |
| Chrome  | `mixed-3000` | tick p95               | 16.80 ms |  18.60 ms |  +10.71% |   10% |
| Chrome  | `mixed-3000` | tick maximum           | 20.90 ms |  23.00 ms |  +10.05% |   10% |
| Firefox | `sparse-500` | tick maximum           |  3.00 ms |   4.00 ms |  +33.33% |   10% |

These are observed upgrade-arm regressions under the specified comparator, not
proof that one particular package caused them. No synchronous step exceeded 50
ms in either arm.

### Interaction And Geometry

- All 3,280 interaction records pass.
- All 80 idle audits pass with no every-frame dirty cause.
- All 556 geometry outcomes pass: 360 findings are grandfathered and 196 are
  unchanged. There are no new or worsened targets, overlaps, escapes, or
  unreachable controls.
- All raw layout records complete without runner-level failure.

## Recommendation

Do not merge the planned Issue #23 upgrade PR for OMM 1.0.0 from this capture.
The candidate has five threshold regressions, and both arms expose 22 absolute
correctness failures, so the approved acceptance gates are not met. Keep the
product implementation unchanged; investigate reproducibility and package
attribution with the same committed runner, then reduce the upgrade set or file
a minimal upstream issue if a regression persists. A new quotable five-run
paired capture must pass before merge.
