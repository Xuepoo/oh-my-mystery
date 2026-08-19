# VectoJS Upgrade and Graph Baseline Design

## Context

OMM is preparing separate follow-up work for mobile usability, graph-local search, force-layout stability, and award/work data quality. Before those behavioral changes, OMM needs a known-compatible VectoJS dependency baseline and repeatable browser measurements. This design covers GitHub issue #23 and CarryCtx task CTX-0059 only.

OMM currently resolves `@vectojs/core@1.35.3`, `@vectojs/ui@2.16.7`, `@vectojs/markdown@0.20.3`, `@vectojs/graph-layout@0.2.1`, `@vectojs/devtools@0.11.1`, and `@vectojs/styles@0.3.2`. The root manifest also contains an unused `@vectojs/graph3d` override. The latest compatible local releases are core 1.37.0, UI 2.18.0, and Markdown 0.21.0. Graph-layout 0.2.1 remains the latest 2D release and has no WASM backend.

## Goals

- Upgrade only the compatible VectoJS packages that are behind current releases.
- Remove stale configuration that implies OMM uses graph3d or force-layout WASM.
- Make only compatibility changes required by the upgraded public APIs.
- Record deterministic, production-shaped desktop, mobile, and graph-layout baselines.
- Distinguish dependency regressions from already-known OMM layout and interaction defects.
- Produce machine-readable results that follow-up tasks can compare against.

## Non-Goals

- Redesigning the mobile header, tools, minimap, or casefile drawer.
- Implementing graph-local search or selected-node highlighting.
- Changing force constants, reheat policy, pagination, or node placement.
- Fixing casefile drag-after-navigation behavior.
- Rebuilding crawler or D1 data.
- Adding graph3d, WebAssembly, WebGL graph edges, or WebGPU graph physics.
- Treating screenshots or FPS as performance evidence.

## 1. Dependency Contract

Update the web manifest and lockfile to resolve:

| Package             | Current | Target |
| ------------------- | ------: | -----: |
| `@vectojs/core`     |  1.35.3 | 1.37.0 |
| `@vectojs/ui`       |  2.16.7 | 2.18.0 |
| `@vectojs/markdown` |  0.20.3 | 0.21.0 |

Retain:

- `@vectojs/graph-layout@0.2.1`
- `@vectojs/devtools@0.11.1`
- `@vectojs/styles@0.3.2`

Remove the root `@vectojs/graph3d` override because no package imports or resolves graph3d. The production dependency graph and built assets must contain neither graph3d nor a force-layout WASM asset.

The upgrade uses Bun's existing workspace install. No package is linked to the sibling VectoJS checkout in the committed result. The sibling checkout is reference source only; published package artifacts remain authoritative.

## 2. Compatibility Boundary

Review release notes and TypeScript errors for the following public contracts:

- `Scene` construction, resize, destruction, on-demand rendering, dirty tracking, and frame statistics
- pointer, touch, wheel, keyboard, and projected input behavior
- `Entity.hasPendingAnimations()` and loading animation wake/sleep behavior
- UI panel, tabs, card, input, and scroll APIs used by OMM
- content and accessibility projection synchronization
- DevTools headless snapshot, geometry, hit-test, accelerator, and dirty audits
- Markdown package imports that enter the web bundle

When an API changed, adapt the smallest owning OMM unit and add a regression test for that public behavior. Do not refactor unaffected UI or convert the existing manual Canvas routing to a new event architecture in this task.

Known defects must remain explicitly classified as pre-existing baseline findings, not silently accepted as upgrade regressions:

- crowded and overlapping mobile controls
- global rather than graph-local search
- search results without persistent visual focus
- fixed mobile minimap
- casefile drag failure after repeated relation navigation
- relation/recommendation duplicates
- global layout movement after topology append and drag

If an upgraded package worsens one of these defects numerically or behaviorally, that is still an upgrade regression and blocks this task.

## 3. Baseline Runner Architecture

Add one repository-owned browser baseline runner under `scripts/` and focused pure helpers/tests where needed. The runner uses the already installed Playwright dependency directly, never `bunx` or another on-demand fetcher.

The runner emits a versioned JSON report under ignored `tmp/` storage:

```ts
interface OmmBaselineReportV1 {
  schemaVersion: 1;
  generatedAt: string;
  runnerRevision: string;
  artifacts: Array<{
    id: string;
    arm: 'baseline' | 'candidate';
    appRevision: string;
    sourceTreeSha256: string;
    lockfileSha256: string;
    dependencyVersions: Record<string, string>;
    installedPackageManifestSha256: string;
    repeatedInstallManifestSha256: string;
    buildSha256: string;
    buildMode: 'production-preview';
  }>;
  environments: Array<{
    id: string;
    browser: string;
    executableSha256: string;
    userAgent: string;
    hardwareConcurrency: number;
    os: string;
    cpu: string;
    memoryBytes: number;
    browserExecutable: string;
    browserVersion: string;
    playwrightVersion: string;
    bunVersion: string;
  }>;
  viewports: Array<{
    id: string;
    width: number;
    height: number;
    requestedDeviceScaleFactor: number;
  }>;
  fixture: { schemaVersion: number; sha256: string };
  workloads: WorkloadSpec[];
  runs: BaselineRun[];
  interaction: InteractionResult[];
  layout: LayoutResult[];
  audits: AuditResult[];
  comparison?: ComparisonOutcome[];
  comparisonInputs?: {
    baselineReportSha256: string;
    candidateReportSha256: string;
  };
}
```

Each `WorkloadSpec` records its ID, seed, graph hash, node/link counts, complete numeric force options, warmup ticks, measured ticks, maximum settling ticks, append root/count, and drag path where applicable. Each `BaselineRun` records a unique ID, `artifactId`, `environmentId`, `viewportId`, repetition, scenario or workload ID, start time, observed effective DPR and Canvas backing dimensions, timer resolution, and raw metrics. An interaction, layout, audit, target, overlap, or escape result records its producing `runId`. Each `ComparisonOutcome` records the paired baseline and candidate artifact IDs, `environmentId`, `viewportId`, scenario/workload, metric and phase IDs, the five baseline run IDs, the five candidate run IDs, five raw values per arm, medians, absolute delta, percentage or bounded comparison, threshold, pass/fail/informational status, and unavailable reason. Geometry comparison outcomes additionally classify exact finding keys as `grandfathered`, `new`, `worsened`, `improved`, `unchanged`, or `failed`.

`runnerRevision` and each `appRevision` are full 40-character Git commit IDs. Quotable comparisons require clean source trees; uncommitted candidate or runner changes fail before building. Each artifact additionally records a canonical source-tree hash. The source-tree and build hashes are SHA-256 over a UTF-8 manifest sorted by POSIX relative path; each entry is `path`, NUL, executable-bit (`0` or `1`), NUL, file-byte SHA-256, newline. Git metadata, `node_modules`, ignored `tmp`, and build output are excluded from source hashes; only the build directory is included in build hashes. Symlinks hash their UTF-8 link target instead of followed bytes.

`runnerRevision` identifies the candidate-owned runner source independently from either app revision. `generatedAt`, per-run timestamps, artifact IDs, and revision names are metadata and are excluded from metric comparison. Workloads use fixed seeds, fixed node/link ordering, checked graph hashes, fixed viewport sizes, and explicitly recorded force settings. Comparator output reports both absolute values and percentage deltas; it does not overwrite either input report.

Reports use RFC 8785 JSON canonicalization for report hashes, excluding only `generatedAt`, per-run timestamps, `comparison`, and `comparisonInputs`. The comparator records hashes of both canonical input reports. Fixture and installed-package hashes use the same sorted manifest algorithm as source/build hashes. The fixture manifest root is the committed fixture directory and includes every file below it. The installed-package manifest root is the arm's `node_modules`; it includes every file or symlink reachable below each resolved `@vectojs/*` package directory, with paths relative to `node_modules`. Executable bits and symlinks follow the source/build rules.

The runner exits non-zero for failed correctness gates or threshold regressions. Unsupported browser metrics are recorded as unavailable with a reason rather than zero.

### Frozen API fixtures

Interaction baselines never query live D1 or production APIs. Commit bounded fixture responses for seeds, nodes, search, profile, relation pages, recommendations, neighbors, paths, chronicles, stats, and expected errors. The runner intercepts `/api/**` before navigation and serves those bytes with deterministic delays. Every report records the fixture schema version and SHA-256.

The same fixture bytes serve both dependency arms. Production smoke tests remain delivery checks; their data and timings never enter dependency comparison.

### Paired worktrees and repetitions

Create temporary baseline and candidate worktrees under the candidate repository's ignored `tmp/vectojs-baseline/runs/` directory, with the baseline pinned to its recorded full revision. From each worktree root, remove every `node_modules` directory, assign a fresh arm-specific `BUN_INSTALL_CACHE_DIR` under the same run directory, and run `bun install --frozen-lockfile --ignore-scripts`. Build from the same root with `bun run build`, which is the exact production build command. Installation inherits only `PATH`, `HOME`, `TMPDIR`, `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY`; unset `BUN_INSTALL`, `BUNFIG`, `NODE_PATH`, and package-link environment variables. A committed arm-local `bunfig.toml`, when present, remains an explicit source input. After installation, assert that every resolved `@vectojs/*` package path is inside that arm's worktree, is a regular registry package rather than a symlink to either repository or sibling checkout, and matches the version recorded in the arm's lockfile. Derive the resolved dependency set by reading the installed package manifests reached from each workspace package, not from ambient Bun state.

Delete every arm-local `node_modules` directory and its cache, repeat the fresh install once, and require byte-identical lockfile, resolved dependency set, and installed package-file manifest. Neither arm may resolve through the other arm's cache, `node_modules`, Bun link state, workspace path, or sibling VectoJS checkout. Record each lockfile hash, resolved dependency set, installed package manifest hash, and output build hash.

The candidate-owned runner at the recorded `runnerRevision` treats both builds as external preview targets and does not modify or import application code from either arm for interaction checks. Its committed fixtures, synthetic graph bytes, comparator, and browser driver are the only runner inputs. Thus the old application revision remains byte-unchanged while being measured by the same runner that measures the candidate.

Synthetic graph JSON and drag paths are generated once, byte-identical, and hash-checked before both arms. A minimal arm-local browser entry imports that arm's resolved graph-layout package. Browser executables, environment, fixtures, runner revision, viewports, and build mode remain identical.

The candidate-owned physics entry is bundled twice into separate ignored `tmp/vectojs-baseline/runs/` output directories, once with module resolution rooted in each arm. It is never copied into either source tree and is excluded from both source/build hashes. The runner records the resolved graph-layout package path and installed-package manifest hash for each generated bundle and fails if the bundle imports OMM application modules or resolves outside its assigned arm.

Use `/usr/bin/google-chrome-stable` for Chrome and the executable returned by the installed Playwright package's `firefox.executablePath()` for Firefox. Missing files fail setup; the runner never downloads browsers. Hash each executable before repetition 1 and require the same path, SHA-256, and full version for both arms and all repetitions.

Run five paired repetitions for every browser/workload. Repetitions 1, 3, and 5 execute browsers in Chrome then Firefox order and arms baseline then candidate. Repetitions 2 and 4 execute browsers in Firefox then Chrome order and arms candidate then baseline. Within one browser/arm, execute this exact matrix:

| Order | Suite       | Viewport            | Scenario/workload order                                                                                           |
| ----: | ----------- | ------------------- | ----------------------------------------------------------------------------------------------------------------- |
|     1 | interaction | 1280x800 DPR 1      | `desktop-bootstrap`, `desktop-search`, `desktop-graph-input`, `desktop-casefile`, `desktop-tools`, `desktop-idle` |
|     2 | interaction | 1440x900 DPR 1      | same scenario order                                                                                               |
|     3 | interaction | 390x844 DPR 2 touch | `mobile-bootstrap`, `mobile-header`, `mobile-graph-input`, `mobile-casefile`, `mobile-tools`, `mobile-idle`       |
|     4 | interaction | 412x915 DPR 2 touch | same scenario order                                                                                               |
|     5 | physics     | 1280x800 DPR 1      | `sparse-500`, `hub-1000`, `mixed-3000`, `drag-1000`                                                               |

Pass/fail uses the median of five. A correctness failure is not discarded; diagnostic runs cannot replace required runs.

### Normative interaction protocol

Frozen fixtures define these stable IDs: root author `wd:Q347412`, related work `wd:Q1001`, related author `wd:Q35064`, hidden work `wd:Q1002`, and global-only result `wd:Q9999`. Fixture schema validation fails unless all IDs and expected response bytes exist.

Each scenario starts from a new browser context, installs API interception before navigation, waits for `document.fonts.ready`, application readiness, and two consecutive animation-free frames, then performs its ordered actions. Pointer coordinates are the recorded center of the target geometry unless a delta is specified. A wait after each action ends when the expected state predicate is true for two animation frames or at five seconds, which fails the scenario.

Application readiness means `window.__OMM_APP__` exists and the fixture root is present in `viewport.getNodes()`. An animation-free frame means `viewport.isPhysicsActive()`, `viewport.isCameraAnimating()`, and `drawer.hasPendingAnimations()` are all false immediately before two consecutive `requestAnimationFrame` callbacks. A blank point is the first point in row-major order from the grid `x = 16, 32, ... width - 16`, `y = headerBottom + 16, ... height - 16` for which `isEventOverUI(x, y)` and `overlayLayer.getNodeAtScreenPoint(x, y)` are both false; absence fails the scenario.

| Scenario              | Ordered actions and required final state                                                                                                                                                                                                                                                                                                     |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `desktop-bootstrap`   | Navigate; root exists; camera and projected geometry are finite.                                                                                                                                                                                                                                                                             |
| `desktop-search`      | Press `/`; type `江户川乱步`; activate first result with Enter; exactly one selection callback occurs and current baseline camera state is recorded.                                                                                                                                                                                         |
| `desktop-graph-input` | Click root center; double-click root center; drag related work by `(80, 40)` using down, ten linear moves, up; wheel `-120`; pan blank area by `(60, 30)`; activate fit; each action occurs once and leaves no pointer owner.                                                                                                                |
| `desktop-casefile`    | Open root; await profile; activate relations then recommendations; load one relation page; copy first field; scroll 120 logical pixels; activate first relation arrow to `wd:Q35064`; close; fixture requests and copied bytes match exactly.                                                                                                |
| `desktop-tools`       | Toggle each relationship filter and require its selected index to change; open then close stats and minimap; clear and require zero nodes; undo and require the prior node count; toggle visibility open then closed; fit and require finite changed camera, freeze and require physics frozen then active, reset and require finite camera. |
| `desktop-idle`        | Step/wait until physics and loaders complete; observe 120 frames; no every-frame dirty cause exists.                                                                                                                                                                                                                                         |
| `mobile-bootstrap`    | Navigate; root exists; DPR/backing assertions pass; camera and geometry are finite.                                                                                                                                                                                                                                                          |
| `mobile-header`       | Focus search by `/`; type fixture query; close dropdown by Escape; record input, dropdown, logo, and action geometry.                                                                                                                                                                                                                        |
| `mobile-graph-input`  | Tap root; double-tap root at 100ms interval; long-press root for 600ms; pan blank by `(50, 20)`; drag related work by `(50, 30)` with ten moves; perform two-pointer pinch from 80 to 120 logical-pixel separation; cancel a pending pointer; no pointer owner remains.                                                                      |
| `mobile-casefile`     | Open root; copy first profile field; scroll content 120 pixels beginning on that field and assert no copy; activate relations; follow arrow to `wd:Q35064`; close; requests and copied bytes match fixtures.                                                                                                                                 |
| `mobile-tools`        | Apply the exact desktop tool sequence and state predicates to every currently rendered mobile control, recording every target, overlap, escape, hit owner, and state transition.                                                                                                                                                             |
| `mobile-idle`         | Same 120-frame idle observation as desktop.                                                                                                                                                                                                                                                                                                  |

The fixture manifest stores the exact response bytes and delay for each route, expected route count after each action, copied string (`江户川乱步` for the first profile field), stable control IDs, and the predicates above. Stable IDs are `header.search`, `header.pathfinder`, `header.settings`, `header.chronicle`, `header.help`, `tool.relationship`, `tool.stats`, `tool.minimap`, `tool.clear`, `tool.history.undo`, `tool.history.redo`, `tool.visibility`, `viewport.fit`, `viewport.freeze`, `viewport.reset`, `casefile.close`, `casefile.copy`, `casefile.tab.profile`, `casefile.tab.relations`, and `casefile.tab.recommendations`; repeated relationship filters and rows append their fixture key. Allowed containment pairs are limited to a casefile row and its own navigation arrow. The committed manifest is part of the fixture SHA-256 and is identical for both arms.

## 4. Desktop Interaction Baseline

Run visible, focused Chrome and Firefox windows at:

- 1280 by 800 logical pixels, DPR 1
- 1440 by 900 logical pixels, DPR 1

Each browser performs bounded deterministic checks against the frozen fixtures:

- application bootstrap and initial graph materialization
- global search input focus, query, result activation, and current camera behavior
- node click/tap, double-click expansion, drag, release, pan, wheel zoom, and fit
- casefile profile load, lazy relations/recommendations, copy, scrolling, and close
- relation pagination and navigation to another entity
- relationship filters, stats, minimap, and viewport controls
- idle transition after all work settles

Existing behavior is recorded rather than redesigned. Page errors, unhandled rejections, non-finite geometry, stuck pointer ownership, and an always-awake idle scene are failures. Pointer targets must activate exactly once, drag pointer error is at most one logical pixel, camera values remain finite, and copied fixture values match exactly.

## 5. Mobile Compatibility Baseline

Run Chrome and Firefox contexts at DPR 2:

- 390 by 844 logical pixels
- 412 by 915 logical pixels

Both use logical `viewport`, `deviceScaleFactor: 2`, `hasTouch: true`, and `isMobile: true` where supported. Firefox receives the same viewport, DPR, touch injection, user-agent class, and logical coordinates even where it lacks Chromium's full device emulation. Before testing, assert `innerWidth`, `innerHeight`, `devicePixelRatio === 2`, and Canvas backing dimensions equal logical dimensions times two. An engine unable to satisfy these assertions is recorded as unavailable with a reason, fails this required gate, and makes the runner exit non-zero; it never silently falls back to DPR 1.

Checks include:

- application bootstrap at the exact logical viewport
- HeaderBar DOM input and Canvas geometry
- tap, double-tap, long-press, one-finger pan, node drag, two-finger pinch, and pointer cancellation
- details profile load, field tap-copy, content scroll, relation navigation, and close
- relationship filter, statistics, minimap, clear/history/visibility, and viewport-control hit regions
- interactive target dimensions, including known pre-existing undersized targets
- input and Canvas hit geometry remain aligned at DPR 2
- idle scene sleeps after interaction

The report records target dimensions, existing overlaps, and viewport escapes as structured findings:

```ts
interface TargetFinding {
  runId: string;
  key: string; // scenario ID + stable control ID
  rect: Rect;
  width: number;
  height: number;
  activatable: boolean;
  hitOwnerId: string | null;
}
interface OverlapFinding {
  runId: string;
  key: string; // scenario ID + sorted stable control IDs
  controlIds: [string, string];
  intersection: Rect;
  edgeDepths: { left: number; right: number; top: number; bottom: number };
}
interface EscapeFinding {
  runId: string;
  key: string; // scenario ID + stable control ID
  controlId: string;
  edgeDepths: { left: number; right: number; top: number; bottom: number };
}
```

Stable control IDs come from the fixture scenario manifest and fail capture when a rendered target cannot be mapped. Report an overlap when two simultaneously rendered interactive target rectangles have intersection width and height greater than 0.5 logical pixel, excluding only manifest-listed allowed containment pairs. “Reachable overlap” means both targets are separately activatable at their centers. Findings match across arms only by exact key within the same browser, viewport, and scenario. A key present only in the candidate is new and fails; splitting or merging intersections creates new keys and fails. “Activatable” means a primary pointer release at the target center produces the manifest's expected state transition exactly once within five seconds. A baseline `activatable: true` changing to false is unreachable and fails. Coordinates round to 0.1 logical pixel; intersections use half-open rectangles and 0.5-pixel geometry tolerance. Fonts must be ready and non-ambient transitions settled before capture.

Pre-existing targets below 44 by 44, reachable overlaps, and viewport escapes are grandfathered findings, not correctness failures in this task. The candidate must not shrink a target by more than 0.5 logical pixel, add a sub-44 target, add an overlap or escape, increase an existing overlap by more than 1 logical pixel per edge, increase an existing viewport escape by more than 0.5 logical pixel on any edge, or make a baseline-activatable control unreachable. The mobile follow-up must eliminate grandfathered findings.

This task does not fix the existing mobile overlaps. The follow-up mobile design will use these findings as its before-state.

## 6. Graph-Layout Workloads

Use checked-in deterministic synthetic graph JSON independent of network and D1 state. A generation helper creates it once, and normal benchmark runs only read and hash the committed bytes. JSON is UTF-8 with LF, two-space indentation, one final newline, root property order `nodes`, `links`; node property order `id`, `type`, `radius`, `x`, `y`; link property order `id`, `source`, `target`, `predicate`; and nodes/links sorted by ID. Numbers use ECMAScript `JSON.stringify` representation. The SHA-256 is over those exact bytes.

- `sparse-500`: node IDs `n0000` through `n0499`; each node after the first links to its predecessor, and every node whose index is divisible by 5 links to index `i - 5` when present.
- `hub-1000`: center `n0000` links to every other node; each non-center node also links to the previous non-center node when its index is divisible by 8.
- `mixed-3000`: hubs `n0000`, `n1000`, and `n2000`; each non-hub node links from its partition hub to itself, links from its predecessor when that predecessor is not the same hub, and, when its index is divisible by 11 and `i - 11` is inside the partition and is not already a source for that target, links from `i - 11`.

Node types repeat in the fixed sequence `author`, `work`, `publisher`, `award`, `character`, `series`. Base radii are respectively 9, 5.5, 5, 7.5, 6.5, and 5. Initial positions use `x = cos(i * 2.399963229728653) * (35 + sqrt(i) * 18)` and the corresponding sine for `y`; initial velocity is zero. Every graph link is directed from the lower-rule source to the stated target, has ID `source|related|target`, and predicate `related`. The generator stores a set of IDs and fails on any duplicate rather than silently deduplicating.

The arm-local entry imports only that arm's `ForceLayout2D`, never OMM application code, and freezes the production balanced-layout contract:

```ts
repulsion: (node) => baseRadius(node.type) * 11 + 95,
collisionRadius: (node) => baseRadius(node.type) + 14,
collisionStrength: 0.7,
linkDistance: (link) => {
  const source = nodeById(link.source);
  const target = nodeById(link.target);
  const radii = baseRadius(source.type) + baseRadius(target.type);
  if (source.type === 'author' && target.type === 'work') return 30 + radii * 1.3;
  if (source.type === 'author' && target.type === 'character') return 34 + radii * 1.4;
  return 40 + radii * 1.5;
},
linkStrength: 0.42,
centerStrength: 0.016,
velocityDecay: 0.64,
alphaDecay: 0.024,
repulsionDistanceMax: 450,
seed: 7,
```

Sparse and hub warm for 8 ticks and measure 40 ticks; mixed warms for 12 and measures 50. Every measured tick receives one event-loop yield after timing. Initial and post-append settling each stop when `step()` returns false or fail after the 2,000th active tick. Append roots are `n0250`, `n0000`, and `n1000` respectively. Each append creates IDs `a0000` through `a0049` at the root position plus the same golden-angle offset formula with radius `45 + sqrt(i) * 5`; each new work node receives a directed link from the root, and appended nodes whose one-based ordinal is divisible by 5 and greater than 1 receive a directed link from the previous appended node. Browser, arm, viewport, and workload order follow Section 3.

The phase order for each graph workload is: construct and `setGraph`; warmup; measured ticks; continue initial settling to false; copy the initial snapshot and metrics; time `appendGraph`; time one first post-append tick; continue post-append settling to false while sampling displacement/link metrics; copy final metrics; dispose. Warmup and measured ticks count toward the initial 2,000-tick cap, and a false return during either ends initial settling early; missing required measured samples fails the run.

For every workload, record:

- tick p50, p95, and maximum milliseconds
- synchronous steps above 50 milliseconds
- initial settling ticks and wall time
- append 50 mutation milliseconds
- first post-append tick milliseconds
- post-append settling ticks and wall time
- old-node RMS displacement after append
- maximum displacement among old nodes more than two graph hops from the append root
- post-append peak link length and its ratio to configured rest length
- final non-finite position count
- final collision-overlap count above a documented tolerance

Tick percentiles use nearest rank: sort the finite measured tick milliseconds ascending and select one-based index `ceil(p * sampleCount)`, clamped to `1..sampleCount`. Thus p50 selects indices 20 and 25 for 40 and 50 samples, and p95 selects indices 38 and 48 respectively. No interpolation is used. Missing or non-finite samples fail the raw run.

Correctness bounds are: zero non-finite positions; no final collision overlap above one world unit; `step()` returns false before the 2,000-tick cap; dragged-node pointer error at most one world unit; every measured/first-post-append step below 50 milliseconds; and finite peak link length no greater than 20 times its configured rest length. Final collision overlap checks every unordered node pair and counts a pair when `radiusA + radiusB - distance > 1` world unit.

Timing uses `performance.now()`. Tick, first-post-append, and append mutation timings surround only the synchronous `step(1)` or `appendGraph()` call. Event-loop yields, payload creation, hashing, snapshots, and metric calculation are excluded. Settling wall time starts immediately before its first `step(1)` and ends after the first false-returning step; it includes one `setTimeout(0)` yield after each active step but excludes pre/post snapshots. The append payload is prepared outside the timed mutation. Position snapshots are copied only at measurement boundaries. The runner reacquires the layout position view after topology operations.

## 7. Drag Stability Workload

Build and fully cool `hub-1000` using the same 2,000-tick initial settling cap, then:

1. Snapshot all positions.
2. Select non-hub node `n0500`, record its start `(x0, y0)`, call `pinNode(index, x0, y0)`, then `reheat(0.25)` once.
3. For samples `i = 1..30`, set `t = i / 30`, `x = x0 + 160 * t`, `y = y0 + 40 * sin(PI * t)`, call `pinNode(index, x, y)` then `reheat(0.25)`, and yield one browser task. The expected pointer is the sample coordinate.
4. Call `unpinNode(index)` then `reheat(0.08)` once.
5. Step until cooling or the 2,000-tick post-drag settling maximum.

Record:

- maximum dragged-node pointer error across the 30 samples
- post-drag old non-dragged-node RMS displacement
- post-drag far-node maximum displacement
- post-drag peak link length ratio
- post-drag settling ticks and wall time after release
- velocity direction-change count over a late sampling window

Far nodes are nodes more than two undirected graph hops from `n0500` in the pre-drag graph. The late window is the final 60 active ticks, or all active ticks when fewer remain. Velocity is the position delta between consecutive ticks. For every non-dragged node and each axis, count a direction change when consecutive non-zero velocity signs differ and both samples have total speed magnitude above `0.01`; the reported metric is the sum across those nodes and both axes. Drag settling timing uses the same `performance.now()` and event-loop-yield boundary as Section 6.

This task records current repeated-reheat behavior without changing it. The follow-up stability task must improve displacement and settling while retaining correctness and performance.

## 8. Rendering and DevTools Audits

Use VectoJS state-space tools where available:

- a11y tree structure and duplicate control names
- entity/control world bounds
- hit-test explanations for representative controls
- scene snapshot before and after idle
- dirty diagnosis during an idle observation window
- accelerator status, treating installed and active as distinct states

The committed runner must not attach the visual DevTools panel during benchmark measurement. Screenshots may be saved as debugging artifacts after a failure but are not a pass/fail oracle.

## 9. Comparison and Thresholds

Capture a pre-upgrade report from the temporary worktree at commit `63d7f9a` and a post-upgrade report from the task branch using the paired procedure, same runner revision, fixtures, graph hashes, machine, and browser executables defined above.

At the start of every raw run, immediately before its scenarios, estimate timer resolution as the minimum positive delta from 10,000 consecutive `performance.now()` reads and record it on that run. For each comparison, use the maximum resolution among its ten baseline/candidate runs as the metric tolerance. Metric comparison is normative:

| Metric ID                         | Phase(s)                        | Unit       | Larger is worse | Measurement tolerance | Correctness bound per raw run | Median regression limit |
| --------------------------------- | ------------------------------- | ---------- | --------------- | --------------------- | ----------------------------- | ----------------------- |
| `tick-p95`, `tick-max`            | measured                        | ms         | yes             | timer resolution      | every step `< 50ms`           | 10%                     |
| `append-mutation`                 | append                          | ms         | yes             | timer resolution      | finite                        | 15%                     |
| `first-post-append`               | post-append                     | ms         | yes             | timer resolution      | `< 50ms`                      | 10%                     |
| `settling-ticks`                  | initial, post-append, post-drag | ticks      | yes             | 1 tick                | cooled before 2,000           | 10%                     |
| `settling-wall`                   | initial, post-append, post-drag | ms         | yes             | timer resolution      | finite                        | 10%                     |
| `old-node-rms-displacement`       | post-append, post-drag          | world unit | yes             | 0.01                  | finite                        | 10%                     |
| `far-node-maximum-displacement`   | post-append, post-drag          | world unit | yes             | 0.01                  | finite                        | 10%                     |
| `peak-link-ratio`                 | post-append, post-drag          | ratio      | yes             | 0.001                 | finite and `<= 20`            | 10%                     |
| `late-velocity-direction-changes` | post-drag                       | count      | yes             | 1 count               | finite                        | 10%                     |
| `drag-pointer-error`              | drag samples                    | world unit | yes             | 0.01                  | `<= 1`                        | 10%                     |
| `non-finite-position-count`       | every final phase               | count      | yes             | 0                     | `0`                           | must remain 0           |
| `collision-overlap-count`         | initial, post-append, post-drag | count      | yes             | 0                     | `0`                           | must remain 0           |

`tick-p50` and synchronous-step-above-50 count are recorded diagnostics: p50 is informational and has no regression gate; the synchronous-step count must be zero through the per-step `< 50ms` correctness bound. `drag-1000` records initial and post-drag settling plus drag metrics, but has no append phase or append metrics. `sparse-500`, `hub-1000`, and `mixed-3000` record measured, initial, append, and post-append metrics, but no post-drag metrics. Non-finite counts are required after initial settling and each workload's applicable post-append or post-drag settling.

The post-append old-node population is every pre-append node; its far population is more than two undirected hops from the append root in the pre-append graph. The post-drag old-node population is every node except `n0500`; its far population is defined in Section 7. Peak-link ratio is the maximum over all links of Euclidean endpoint distance divided by that link's accessor-resolved rest length, sampled after every active settling tick and including the final false-returning tick.

Every correctness bound applies independently to every one of the five raw repetitions in both arms. A single raw correctness failure fails the upgrade even when the median passes. Regression limits compare the median of five only after all raw correctness bounds pass.

The upgrade passes when:

- all correctness checks pass in both browser engines
- no new mobile overlap, overflow, or unreachable-control finding appears
- tick p95 regression is at most 10% for every graph workload
- append 50 mutation regression is at most 15%
- no new synchronous step exceeds 50 milliseconds
- initial, post-append, and post-drag settling ticks each do not regress by more than 10%
- post-append and post-drag old-node RMS displacement, far-node maximum displacement, and peak-link ratio each do not regress by more than 10%
- first post-append tick, maximum measured tick, and initial/post-append/post-drag settling wall time each do not regress by more than 10%
- maximum tick and first post-append tick remain below 50 milliseconds
- final collision overlap remains zero at the one-world-unit tolerance in every required phase
- dragged-node pointer error remains at most one world unit and does not regress by more than 10%
- late velocity direction changes do not regress by more than 10%
- idle dirty diagnosis has no every-frame cause after physics and loading complete

For a metric where larger is worse, percentage regression is `(candidateMedian - baselineMedian) / baselineMedian * 100` only when the baseline median is strictly greater than its table tolerance. When the baseline median is at or below tolerance, percentage is `null` and the candidate passes only when its median is also at or below the same tolerance; otherwise it fails. There is no secondary absolute-increase branch. Zero-required counts must remain zero. For metrics where smaller is worse, such as target dimensions, use the explicit absolute worsening limits in Section 5 rather than percentage division. Reports always retain raw medians, timer resolution or measurement tolerance, and the selected `percentage`, `bounded`, or `zero-required` comparison mode.

Measurements below timer resolution are therefore reported as bounded, never coerced to zero or used as an unstable denominator. A persistent failure blocks the dependency upgrade and is investigated upstream or by reducing the upgrade set, not waived silently.

## 10. Error Handling

- Browser launch or navigation failure identifies the browser and exits non-zero.
- Failure to establish the required Firefox DPR-2 environment identifies the failed assertion and exits non-zero.
- Missing browser executables produce a clear setup error and do not install software.
- A failed interaction includes the last successful action and relevant numeric state.
- Benchmark timeout disposes layouts and browsers before exiting.
- A package API incompatibility remains a compile-time failure until the owning unit is adapted and tested.
- A VectoJS defect receives a minimal upstream reproduction and issue; OMM does not carry a hidden fork.

## 11. Verification and Delivery

Required gates:

- `oxfmt` on changed TypeScript and JSON-compatible sources
- `oxlint --deny-warnings`
- Markdown lint for the report/design documentation
- all Bun tests
- TypeScript and Vite production build
- headed Chrome and Firefox desktop baselines
- DPR-2 mobile baselines at both sizes
- graph-layout and drag baseline comparison
- `git diff --check`
- `gitleaks detect --source .`
- production bundle inspection proving no graph3d or force WASM asset

The PR includes the dependency/lockfile changes, required compatibility fixes, baseline runner, tests, and a concise checked-in summary of environment and comparison results. Raw timestamped reports remain under ignored `tmp/` unless a stable fixture is necessary for comparator tests.

After CI and review, merge and deploy normally. Production smoke checks cover Pages, API health, initial graph load, and absence of browser page errors. This task is complete only after those checks pass and CTX-0059 is checkpointed; its clean worktree is then removed.
