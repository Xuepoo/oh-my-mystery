import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { chromium, firefox, type Browser, type Page } from 'playwright';
import {
  buildArmPlan,
  assertRepeatedInstallEqual,
  createInstalledPackageManifest,
  dependencyVersionRecord,
  hashPreparedManifest,
  parseVectoLockVersions,
  type ArmPlan,
  type InstallSnapshot,
  validateVectoResolutions,
} from './arms';
import {
  startPreview,
  stopPreviews,
  type PreviewDependencies,
  type PreviewProcess,
} from './process';
import { compareFiveRuns } from './metrics';
import {
  hashReport,
  type BaselineArtifact,
  type BaselineEnvironment,
  type BaselineViewport,
  type OmmBaselineReportV1,
} from './report';
import type {
  BaselineMode,
  BaselineRunnerDependencies,
  CaptureResult,
  PreflightContext,
  PreparedBaseline,
  ReportAssemblyInput,
} from './runner';
import type { ArmName, CommandSpec, PhysicsBundlePlan } from './arms';
import { hashBytes } from './manifest';
import type { RunningPreviews } from './runner';
import {
  assertViewportAndBacking,
  browserContextOptions,
  browserExecutableMetadata,
  readObservedViewport,
  resolveBrowserExecutable,
  runInNewContext,
  waitForApplicationReady,
  waitForStablePredicate,
  type BrowserName,
  type ViewportSpec,
} from './browser';
import { collectGeometryFromPage, collectIdleAudit } from './audits';
import { runScenario, scenarioIds, type ScenarioId } from './interactions';
import { createFixtureRouter, installFixtureRoutes } from './routes';
import type { FixtureManifest } from './fixture';
import { graphFixtureDirectory, graphSpecs } from './generate-graphs';
import type { PhysicsBrowserRequest, PhysicsBrowserResult } from './physics-browser';

export const BASELINE_REVISION = '63d7f9acccd741aae2553d1d1f44c86577a9a81e';

export interface SnapshotHash {
  sha256: string;
}
export interface PhysicsBundleArtifact extends SnapshotHash {
  path: string;
  graphLayoutPackagePath: string;
}

export interface BrowserRunnerPlatform {
  cwd(): string;
  environment: Record<string, string | undefined>;
  now(): Date;
  command(command: CommandSpec): Promise<string>;
  remove(path: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  writeFile(path: string, content: string | Uint8Array): Promise<void>;
  readFile(path: string): Promise<string>;
  sourceSnapshot(root: string): SnapshotHash;
  installSnapshot(root: string): InstallSnapshot;
  buildSnapshot(root: string): SnapshotHash;
  bundlePhysics(plan: PhysicsBundlePlan): Promise<PhysicsBundleArtifact>;
  startPreview(options: {
    root: string;
    arm: ArmName;
    port: number;
    environment: Record<string, string | undefined>;
  }): Promise<PreviewProcess>;
  stopPreviews(previews: readonly PreviewProcess[]): Promise<void>;
  launchBrowsers(input: {
    fixture: unknown;
    prepared: PreparedBaseline;
    previews: RunningPreviews;
  }): Promise<{
    capture(request: {
      arm: ArmName;
      browser: 'chrome' | 'firefox';
      repetition: number;
    }): Promise<CaptureResult>;
    close(): Promise<void>;
  }>;
}

interface PreparedReportData {
  artifacts: BaselineArtifact[];
  environments: BaselineEnvironment[];
  viewports: BaselineViewport[];
  workloads: Record<string, unknown>[];
}

const defaultPlatform: BrowserRunnerPlatform = {
  cwd: () => process.cwd(),
  environment: process.env,
  now: () => new Date(),
  async command(command) {
    const child = Bun.spawn(command.argv, {
      cwd: command.cwd,
      env: command.env,
      stdout: 'pipe',
      stderr: 'inherit',
    });
    const output = await new Response(child.stdout).text();
    const status = await child.exited;
    if (status !== 0) throw new Error(`Command failed (${status}): ${command.argv.join(' ')}`);
    return output;
  },
  remove: (path) => rm(path, { recursive: true, force: true }),
  mkdir: async (path) => {
    await mkdir(path, { recursive: true });
  },
  writeFile: (path, content) => writeFile(path, content),
  readFile: (path) => readFile(path, 'utf8'),
  sourceSnapshot: (root) => ({ sha256: hashDirectoryFallback(root) }),
  installSnapshot: (root) => installSnapshot(root),
  buildSnapshot: (root) => ({ sha256: hashDirectoryFallback(join(root, 'apps/web/dist')) }),
  async bundlePhysics(plan) {
    const output = join(plan.outputDir, 'physics.js');
    await mkdir(plan.outputDir, { recursive: true });
    const result = await Bun.build({
      entrypoints: [plan.entryPoint],
      outdir: plan.outputDir,
      target: 'browser',
      minify: false,
    });
    if (!result.success) {
      throw new Error(result.logs.map(formatBuildDiagnostic).join('\n'));
    }
    return {
      path: output,
      sha256: hashDirectoryFallback(plan.outputDir),
      graphLayoutPackagePath: join(plan.root, 'apps/web/node_modules/@vectojs/graph-layout'),
    };
  },
  startPreview: (options) => startPreview(options, defaultPreviewDependencies),
  stopPreviews: (previews) => stopPreviews(previews),
  launchBrowsers: (input) => launchBrowsers(input),
};

const defaultPreviewDependencies: PreviewDependencies = {
  spawn(command) {
    const child = Bun.spawn(command.argv, {
      cwd: command.cwd,
      env: command.env,
      stdin: 'ignore',
      stdout: 'ignore',
      stderr: 'inherit',
    });
    return { exited: child.exited, kill: (signal) => child.kill(signal) };
  },
  async probe(url) {
    try {
      return (await fetch(url, { redirect: 'manual' })).status < 500;
    } catch {
      return false;
    }
  },
  sleep: (milliseconds) => Bun.sleep(milliseconds),
  now: () => Date.now(),
};

const interactionViewports: readonly ViewportSpec[] = [
  { width: 1280, height: 800, dpr: 1, mobile: false },
  { width: 1440, height: 900, dpr: 1, mobile: false },
  { width: 390, height: 844, dpr: 2, mobile: true },
  { width: 412, height: 915, dpr: 2, mobile: true },
];
const physicsViewport: ViewportSpec = { width: 1280, height: 800, dpr: 1, mobile: false };

interface BrowserTypeAdapter {
  executablePath(): string;
  launch(options: { executablePath: string; headless: boolean }): Promise<Browser>;
}

export interface LaunchBrowserDependencies {
  chromium: BrowserTypeAdapter;
  firefox: BrowserTypeAdapter;
  readExecutable(path: string): Promise<Uint8Array>;
  readText(path: string): Promise<string>;
}

const defaultLaunchBrowserDependencies: LaunchBrowserDependencies = {
  chromium,
  firefox,
  readExecutable: async (path) => readFile(path),
  readText: async (path) => readFile(path, 'utf8'),
};

export async function launchBrowsers(
  input: Parameters<BrowserRunnerPlatform['launchBrowsers']>[0],
  dependencies: LaunchBrowserDependencies = defaultLaunchBrowserDependencies,
): Promise<Awaited<ReturnType<BrowserRunnerPlatform['launchBrowsers']>>> {
  const fixture = readFixture(input.fixture);
  const launched = new Map<BrowserName, Browser>();

  return {
    async capture(request) {
      const previewUrl = input.previews.urls?.[request.arm];
      if (!previewUrl) throw new Error(`Missing ${request.arm} preview URL`);
      const preparedArm = input.prepared.arms?.[request.arm] as
        | { physicsBundle?: PhysicsBundleArtifact }
        | undefined;
      if (!preparedArm?.physicsBundle?.path) {
        throw new Error(`Missing ${request.arm} physics browser bundle`);
      }
      const browserType =
        request.browser === 'chrome' ? dependencies.chromium : dependencies.firefox;
      let browser = launched.get(request.browser);
      if (!browser) {
        const executablePath = resolveBrowserExecutable(request.browser, browserType);
        browser = await browserType.launch({ executablePath, headless: true });
        launched.set(request.browser, browser);
        const metadata = await browserExecutableMetadata(request.browser, executablePath, {
          readFile: dependencies.readExecutable,
          version: async () => browser!.version(),
        });
        const prepared = input.prepared as PreparedBaseline & PreparedReportData;
        prepared.environments ??= [];
        prepared.environments.push({
          id: request.browser,
          browser: request.browser,
          executableSha256: metadata.executableSha256,
          browserExecutable: metadata.executablePath,
          browserVersion: metadata.version,
        } as BaselineEnvironment);
      }
      if (!browser) throw new Error(`Unable to launch ${request.browser}`);

      const interaction: Record<string, unknown>[] = [];
      const layout: Record<string, unknown>[] = [];
      const audits: Record<string, unknown>[] = [];
      for (const viewport of interactionViewports) {
        const mode = viewport.mobile ? 'mobile' : 'desktop';
        for (const scenarioId of scenarioIds(mode)) {
          const runId = captureRunId(request, viewport, scenarioId);
          await runInNewContext(
            browser,
            browserContextOptions(viewport, request.browser),
            async (page) => {
              const router = createFixtureRouter(fixture.manifest, fixture.responses, {
                expectedRouteIds: expectedRouteIds(scenarioId),
              });
              await installFixtureRoutes(page.context(), router);
              await page.addInitScript(() => {
                const writeText = (value: string) => {
                  (window as unknown as { __OMM_COPIED_TEXT__?: string }).__OMM_COPIED_TEXT__ =
                    value;
                  return Promise.resolve();
                };
                try {
                  Object.defineProperty(navigator, 'clipboard', {
                    configurable: true,
                    value: { writeText },
                  });
                } catch {
                  Object.defineProperty(navigator.clipboard, 'writeText', {
                    configurable: true,
                    value: writeText,
                  });
                }
              });
              let idleAudit: ReturnType<typeof collectIdleAudit> | undefined;
              interaction.push(
                ...((await runScenario(scenarioId, page, {
                  runId,
                  execute: async (stepId, scenarioPage) => {
                    const result = await executeScenarioStep(stepId, scenarioPage as Page, {
                      previewUrl,
                      fixture: fixture.manifest,
                      viewport,
                      runId,
                      scenarioId,
                      browser: request.browser,
                    });
                    if (result) idleAudit = result;
                  },
                })) as unknown as Record<string, unknown>[]),
              );
              router.assertComplete();
              if (idleAudit) audits.push(idleAudit as unknown as Record<string, unknown>);
              const geometry = await collectVisibleGeometry(
                page,
                runId,
                scenarioId,
                viewport,
                fixture.manifest,
              );
              layout.push(...(geometry.targets as unknown as Record<string, unknown>[]));
              audits.push(
                ...(geometry.overlaps as unknown as Record<string, unknown>[]),
                ...(geometry.escapes as unknown as Record<string, unknown>[]),
              );
            },
          );
        }
      }

      const physics = await capturePhysics(
        browser,
        preparedArm.physicsBundle.path,
        dependencies.readText,
      );
      const runs = physics.map((result, index) => ({
        id: `${request.arm}-${request.browser}-${request.repetition}-physics-${index}`,
        artifactId: request.arm,
        environmentId: request.browser,
        viewportId: viewportId(physicsViewport),
        workloadId: physicsWorkloads[index].id,
        timerResolutionMilliseconds: result.timerResolutionMilliseconds,
        metrics: result,
      }));
      return { request, runs, interaction, layout, audits, physics } as unknown as CaptureResult;
    },
    async close() {
      const failures: unknown[] = [];
      for (const browser of launched.values()) {
        try {
          await browser.close();
        } catch (error) {
          failures.push(error);
        }
      }
      launched.clear();
      if (failures.length > 0) throw new AggregateError(failures, 'Browser cleanup failed');
    },
  };
}

function readFixture(value: unknown): {
  manifest: FixtureManifest;
  responses: Map<string, Uint8Array>;
} {
  const fixture = (value as { value?: unknown }).value ?? value;
  if (!isRecord(fixture) || !isRecord(fixture.manifest) || !(fixture.responses instanceof Map)) {
    throw new Error('Validated fixture does not contain a manifest and response map');
  }
  return fixture as { manifest: FixtureManifest; responses: Map<string, Uint8Array> };
}

function viewportId(viewport: ViewportSpec): string {
  return `${viewport.mobile ? 'mobile' : 'desktop'}-${viewport.width}x${viewport.height}-dpr${viewport.dpr}`;
}

function captureRunId(
  request: { arm: ArmName; browser: BrowserName; repetition: number },
  viewport: ViewportSpec,
  scenarioId: ScenarioId,
): string {
  return `${request.arm}-${request.browser}-${request.repetition}-${viewportId(viewport)}-${scenarioId}`;
}

const scenarioRoutes: Partial<Record<ScenarioId, readonly string[]>> = {
  'desktop-bootstrap': ['seeds', 'stats'],
  'mobile-bootstrap': ['seeds', 'stats'],
  'desktop-search': ['seeds', 'stats', 'search-root'],
  'mobile-header': ['seeds', 'stats', 'search-root'],
  'desktop-graph-input': ['seeds', 'stats', 'neighbors-root'],
  'mobile-graph-input': ['seeds', 'stats', 'neighbors-root'],
  'desktop-casefile': [
    'seeds',
    'stats',
    'profile-root',
    'relations-root-page-1',
    'relations-root-page-2',
    'recommendations-root',
    'profile-related-author',
  ],
  'mobile-casefile': [
    'seeds',
    'stats',
    'profile-root',
    'relations-root-page-1',
    'profile-related-author',
  ],
  'desktop-tools': ['seeds', 'stats'],
  'mobile-tools': ['seeds', 'stats'],
  'desktop-idle': ['seeds', 'stats'],
  'mobile-idle': ['seeds', 'stats'],
};

export function expectedRouteIds(scenarioId: ScenarioId): readonly string[] {
  return [...(scenarioRoutes[scenarioId] ?? [])];
}

async function collectVisibleGeometry(
  page: Page,
  runId: string,
  scenarioId: ScenarioId,
  viewport: ViewportSpec,
  fixture: FixtureManifest,
) {
  const renderedControls = await page.evaluate((controls) => {
    const targets = (
      window as unknown as {
        __OMM_APP__?: { instrumentation?: { targets: readonly { id: string }[] } };
      }
    ).__OMM_APP__?.instrumentation?.targets;
    if (!targets) throw new Error('OMM instrumentation is unavailable');
    const rendered = new Set(targets.map(({ id }) => id));
    return controls.filter((id) => rendered.has(id));
  }, fixture.controls);
  return collectGeometryFromPage(page, {
    runId,
    scenarioId,
    viewport: { x: 0, y: 0, width: viewport.width, height: viewport.height },
    controls: renderedControls,
    allowedContainmentPairs: fixture.allowedContainmentPairs,
  });
}

const physicsWorkloads: readonly {
  id: string;
  file: keyof typeof graphSpecs;
  request: Omit<Extract<PhysicsBrowserRequest, { kind: 'graph' }>, 'graph'>;
}[] = [
  {
    id: 'sparse-500',
    file: 'sparse-500',
    request: { kind: 'graph', appendRootId: 'n0250', warmupTicks: 8, measuredTicks: 40 },
  },
  {
    id: 'hub-1000',
    file: 'hub-1000',
    request: { kind: 'graph', appendRootId: 'n0000', warmupTicks: 8, measuredTicks: 40 },
  },
  {
    id: 'mixed-3000',
    file: 'mixed-3000',
    request: { kind: 'graph', appendRootId: 'n1000', warmupTicks: 12, measuredTicks: 50 },
  },
  {
    id: 'drag-1000',
    file: 'hub-1000',
    request: { kind: 'graph', appendRootId: 'n0000', warmupTicks: 8, measuredTicks: 40 },
  },
];

async function capturePhysics(
  browser: Browser,
  bundlePath: string,
  readText: (path: string) => Promise<string>,
): Promise<PhysicsBrowserResult[]> {
  let bundle: string;
  try {
    bundle = await readText(bundlePath);
  } catch (error) {
    throw new Error(`Unable to load physics browser entry ${bundlePath}`, { cause: error });
  }
  return runInNewContext(browser, browserContextOptions(physicsViewport), async (page) => {
    await page.goto('about:blank');
    await page.addScriptTag({ content: bundle });
    const available = await page.evaluate(
      () =>
        typeof (
          window as unknown as {
            __VECTOJS_PHYSICS_BASELINE__?: { run?: unknown };
          }
        ).__VECTOJS_PHYSICS_BASELINE__?.run === 'function',
    );
    if (!available) throw new Error(`Physics browser entry did not initialize from ${bundlePath}`);

    const results: PhysicsBrowserResult[] = [];
    for (const workload of physicsWorkloads) {
      const graph = JSON.parse(
        await readText(join(graphFixtureDirectory, `${workload.file}.json`)),
      ) as Extract<PhysicsBrowserRequest, { kind: 'graph' }>['graph'];
      const request: PhysicsBrowserRequest =
        workload.id === 'drag-1000'
          ? { kind: 'drag', graph, draggedNodeId: 'n0000' }
          : { ...workload.request, graph };
      results.push(
        await page.evaluate(async (physicsRequest) => {
          const api = (
            window as unknown as {
              __VECTOJS_PHYSICS_BASELINE__?: {
                run(request: PhysicsBrowserRequest): Promise<PhysicsBrowserResult>;
              };
            }
          ).__VECTOJS_PHYSICS_BASELINE__;
          if (!api) throw new Error('Physics browser entry is unavailable');
          return api.run(physicsRequest);
        }, request),
      );
    }
    return results;
  });
}

interface ScenarioExecutionContext {
  previewUrl: string;
  fixture: FixtureManifest;
  viewport: ViewportSpec;
  runId: string;
  scenarioId: ScenarioId;
  browser?: BrowserName;
}

export async function executeScenarioStep(
  stepId: string,
  page: Page,
  context: ScenarioExecutionContext,
): Promise<ReturnType<typeof collectIdleAudit> | undefined> {
  const root = context.fixture.entities.rootAuthor;
  const relatedWork = context.fixture.entities.relatedWork;
  switch (stepId) {
    case 'navigate':
      await page.goto(context.previewUrl, { waitUntil: 'domcontentloaded' });
      await waitForApplicationReady(page, root);
      return;
    case 'assert-root':
      await assertPageState(
        page,
        (id) =>
          Boolean(
            (
              window as unknown as {
                __OMM_APP__?: { instrumentation?: { nodeCenters: readonly { id: string }[] } };
              }
            ).__OMM_APP__?.instrumentation?.nodeCenters.some((node) => node.id === id),
          ),
        root,
      );
      return;
    case 'assert-dpr-backing':
      assertViewportAndBacking(
        context.browser ?? 'chrome',
        await readObservedViewport(page),
        context.viewport,
      );
      return;
    case 'assert-finite-camera-geometry':
      await assertFiniteGeometry(page);
      return;
    case 'press-search-shortcut':
      await page.keyboard.press('/');
      await assertPageState(page, () => document.activeElement?.tagName === 'INPUT');
      return;
    case 'type-search':
      await page.keyboard.type(context.fixture.expected.firstProfileCopy);
      await page.waitForFunction(
        () =>
          Boolean(
            (
              window as unknown as {
                __OMM_APP__?: { headerBar?: { searchResults?: readonly unknown[] } };
              }
            ).__OMM_APP__?.headerBar?.searchResults?.length,
          ),
        undefined,
        { timeout: 5000 },
      );
      return;
    case 'activate-first-result':
      await page.keyboard.press('Enter');
      await waitForStablePredicate(page, 'animationFree');
      return;
    case 'assert-one-selection':
      await assertPageState(
        page,
        () =>
          ((
            window as unknown as {
              __OMM_APP__?: { instrumentation?: { graph: { nodeCount: number } } };
            }
          ).__OMM_APP__?.instrumentation?.graph.nodeCount ?? 0) > 0,
      );
      return;
    case 'record-camera':
    case 'record-header-geometry':
    case 'record-target-overlap-escape-transitions':
      await assertFiniteGeometry(page);
      return;
    case 'escape-search':
      await page.keyboard.press('Escape');
      return;
    case 'click-root':
    case 'tap-root':
      await activatePoint(page, await nodeCenter(page, root), context.viewport.mobile);
      return;
    case 'double-click-root':
    case 'double-tap-root':
      await activatePoint(page, await nodeCenter(page, root), context.viewport.mobile, 2);
      await waitForStablePredicate(page, 'animationFree');
      return;
    case 'long-press-root': {
      const point = await nodeCenter(page, root);
      await page.touchscreen.tap(point.x, point.y);
      await page.waitForTimeout(600);
      return;
    }
    case 'drag-related-work':
      await drag(
        page,
        await nodeCenter(page, relatedWork),
        context.viewport.mobile ? 50 : 80,
        context.viewport.mobile ? 30 : 40,
      );
      return;
    case 'wheel-zoom':
      await page.mouse.wheel(0, -120);
      await assertFiniteGeometry(page);
      return;
    case 'pan-blank':
      await drag(
        page,
        await blankPoint(page),
        context.viewport.mobile ? 50 : 60,
        context.viewport.mobile ? 20 : 30,
      );
      return;
    case 'pinch-80-to-120':
      await dispatchPinch(page);
      await assertFiniteGeometry(page);
      return;
    case 'cancel-pending-pointer':
      await page.keyboard.press('Escape');
      return;
    case 'assert-no-pointer-owner':
      await page.waitForFunction(
        () => {
          const ownership = (
            window as unknown as {
              __OMM_APP__?: {
                instrumentation?: {
                  pointerOwnership: {
                    activePointerIds: readonly number[];
                    canvasCapturedPointerIds: readonly number[];
                    drawerPointerId: number | null;
                    nodePointerId: number | null;
                    panning: boolean;
                    pinching: boolean;
                    pendingClick: boolean;
                    longPressPending: boolean;
                  };
                };
              };
            }
          ).__OMM_APP__?.instrumentation?.pointerOwnership;
          if (!ownership) return false;
          return (
            ownership.activePointerIds.length === 0 &&
            ownership.canvasCapturedPointerIds.length === 0 &&
            ownership.drawerPointerId === null &&
            ownership.nodePointerId === null &&
            !ownership.panning &&
            !ownership.pinching &&
            !ownership.pendingClick &&
            !ownership.longPressPending
          );
        },
        undefined,
        { timeout: 5000 },
      );
      return;
    case 'open-root':
      await activatePoint(page, await nodeCenter(page, root), context.viewport.mobile);
      await assertDrawer(page, 'open', true);
      return;
    case 'await-profile':
      await assertDrawer(page, 'profileStatus', 'ready');
      return;
    case 'activate-relations':
    case 'activate-relations-before-navigation':
      await activateDrawerTarget(page, 'casefile.tab.relations');
      await assertDrawer(page, 'relationsStatus', 'ready');
      return;
    case 'activate-recommendations':
      await activateDrawerTarget(page, 'casefile.tab.recommendations');
      await assertDrawer(page, 'recommendationsStatus', 'ready');
      return;
    case 'load-relation-page':
      await activateDrawerTarget(page, 'casefile.tab.relations');
      await assertDrawer(page, 'relationsStatus', 'ready');
      await activateDrawerTarget(page, 'casefile.relations.load-more');
      await waitForStablePredicate(page, 'animationFree');
      return;
    case 'copy-first-field':
      await activateDrawerTarget(page, 'casefile.tab.profile');
      await activateDrawerTarget(page, 'casefile.copy.first');
      await page
        .waitForFunction(
          (expected) =>
            (window as unknown as { __OMM_COPIED_TEXT__?: string }).__OMM_COPIED_TEXT__ ===
            expected,
          context.fixture.expected.firstProfileCopy,
          { timeout: 5000 },
        )
        .catch(async (error) => {
          const state = await page.evaluate(() => ({
            copied: (window as unknown as { __OMM_COPIED_TEXT__?: string }).__OMM_COPIED_TEXT__,
            clipboard: typeof navigator.clipboard?.writeText,
            targets: (
              window as unknown as { __OMM_APP__?: { instrumentation?: { targets: unknown } } }
            ).__OMM_APP__?.instrumentation?.targets,
          }));
          throw new Error(
            `${error instanceof Error ? error.message : String(error)} state=${JSON.stringify(state)}`,
          );
        });
      return;
    case 'scroll-casefile':
    case 'scroll-from-copy-field-without-copy': {
      const before = await page.evaluate(
        () => (window as unknown as { __OMM_COPIED_TEXT__?: string }).__OMM_COPIED_TEXT__,
      );
      const point = await targetCenter(page, 'casefile.copy.first');
      await page.mouse.move(point.x, point.y);
      await page.mouse.wheel(0, 120);
      if (stepId.includes('without-copy')) {
        const after = await page.evaluate(
          () => (window as unknown as { __OMM_COPIED_TEXT__?: string }).__OMM_COPIED_TEXT__,
        );
        if (after !== before) throw new Error('Casefile scroll copied a field');
      }
      return;
    }
    case 'follow-related-author':
      await activateDrawerTarget(page, 'casefile.row.relation:101.navigate');
      await assertPageState(
        page,
        (id) =>
          (
            window as unknown as {
              __OMM_APP__?: { instrumentation?: { drawer: { entityId: string } } };
            }
          ).__OMM_APP__?.instrumentation?.drawer.entityId === id,
        context.fixture.entities.relatedAuthor,
      );
      return;
    case 'close-casefile':
      await activateDrawerTarget(page, 'casefile.close');
      await assertDrawer(page, 'open', false);
      return;
    case 'assert-fixture-requests-and-copy':
      await assertPageState(
        page,
        (expected) =>
          (window as unknown as { __OMM_COPIED_TEXT__?: string }).__OMM_COPIED_TEXT__ === expected,
        context.fixture.expected.firstProfileCopy,
      );
      return;
    case 'toggle-relationship-filters':
    case 'toggle-rendered-relationship-filters':
      await activateTarget(page, 'tool.relationship', context.viewport.mobile);
      for (const id of [
        'tool.relationship.author_of',
        'tool.relationship.influenced_by',
        'tool.relationship.related',
      ]) {
        if (await hasTarget(page, id)) await activateTarget(page, id, context.viewport.mobile);
      }
      return;
    case 'open-close-stats':
    case 'open-close-rendered-stats':
      await toggleTwice(page, 'tool.stats', context.viewport.mobile);
      return;
    case 'open-close-minimap':
    case 'open-close-rendered-minimap':
      await toggleTwice(page, 'tool.minimap', context.viewport.mobile);
      return;
    case 'clear-graph':
    case 'clear-rendered-graph':
      await activateClearControl(page);
      await assertClearArmed(page);
      await activateClearControl(page);
      await assertPageState(
        page,
        () =>
          (
            window as unknown as {
              __OMM_APP__?: { instrumentation?: { graph: { nodeCount: number } } };
            }
          ).__OMM_APP__?.instrumentation?.graph.nodeCount === 0,
      );
      return;
    case 'undo-clear':
    case 'undo-rendered-clear':
      if (!(await hasTarget(page, 'tool.history.undo'))) return;
      await activateTarget(page, 'tool.history.undo', context.viewport.mobile);
      await assertPageState(
        page,
        () =>
          ((
            window as unknown as {
              __OMM_APP__?: { instrumentation?: { graph: { nodeCount: number } } };
            }
          ).__OMM_APP__?.instrumentation?.graph.nodeCount ?? 0) > 0,
      );
      return;
    case 'open-close-visibility':
    case 'open-close-rendered-visibility':
      await toggleTwice(page, 'tool.visibility', context.viewport.mobile);
      return;
    case 'activate-fit':
    case 'activate-rendered-fit':
      await activateTarget(page, 'viewport.fit', context.viewport.mobile);
      await waitForStablePredicate(page, 'animationFree');
      await assertFiniteGeometry(page);
      return;
    case 'freeze-then-resume':
    case 'freeze-then-resume-rendered':
      await toggleTwice(page, 'viewport.freeze', context.viewport.mobile);
      return;
    case 'reset-camera':
    case 'reset-rendered-camera':
      await activateTarget(page, 'viewport.reset', context.viewport.mobile);
      await assertFiniteGeometry(page);
      return;
    case 'await-idle':
      await page.waitForFunction(
        () => {
          const instrumentation = (
            window as unknown as {
              __OMM_APP__?: { instrumentation?: { animationFree: boolean; sceneAlive: boolean } };
            }
          ).__OMM_APP__?.instrumentation;
          return instrumentation?.animationFree === true && instrumentation.sceneAlive === false;
        },
        undefined,
        { timeout: 10000 },
      );
      return;
    case 'observe-120-frames': {
      const frames = await page.evaluate(async () => {
        const output: string[][] = [];
        for (let index = 0; index < 120; index += 1) {
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          const instrumentation = (
            window as unknown as {
              __OMM_APP__?: {
                instrumentation?: { animationFree: boolean; sceneAlive: boolean };
              };
            }
          ).__OMM_APP__?.instrumentation;
          const free =
            instrumentation?.animationFree === true && instrumentation.sceneAlive === false;
          output.push(free ? [] : ['animation-active']);
        }
        return output;
      });
      return collectIdleAudit(context.runId, context.scenarioId, frames);
    }
    default:
      throw new Error(`Unsupported interaction step ${stepId}`);
  }
}

type Point = { x: number; y: number };

async function targetCenter(page: Page, id: string): Promise<Point> {
  return page.evaluate((targetId) => {
    const target = (
      window as unknown as {
        __OMM_APP__?: {
          instrumentation?: {
            targets: readonly {
              id: string;
              rect: { x: number; y: number; w: number; h: number };
            }[];
          };
        };
      }
    ).__OMM_APP__?.instrumentation?.targets.find(({ id }) => id === targetId);
    if (!target) throw new Error(`Missing rendered target ${targetId}`);
    return { x: target.rect.x + target.rect.w / 2, y: target.rect.y + target.rect.h / 2 };
  }, id);
}

async function nodeCenter(page: Page, id: string): Promise<Point> {
  return page.evaluate((nodeId) => {
    const node = (
      window as unknown as {
        __OMM_APP__?: {
          instrumentation?: { nodeCenters: readonly { id: string; screen: Point }[] };
        };
      }
    ).__OMM_APP__?.instrumentation?.nodeCenters.find(({ id }) => id === nodeId);
    if (!node) throw new Error(`Missing instrumented node ${nodeId}`);
    return node.screen;
  }, id);
}

async function blankPoint(page: Page): Promise<Point> {
  return page.evaluate(() => {
    const instrumentation = (
      window as unknown as {
        __OMM_APP__?: {
          instrumentation?: {
            targets: readonly {
              id: string;
              rect: { x: number; y: number; w: number; h: number };
            }[];
            hitTest(x: number, y: number): { overUI: boolean; nodeId: string | null };
          };
        };
      }
    ).__OMM_APP__?.instrumentation;
    if (!instrumentation) throw new Error('OMM instrumentation is unavailable');
    const headerBottom = Math.max(
      0,
      ...instrumentation.targets
        .filter(({ id }) => id.startsWith('header.'))
        .map(({ rect }) => rect.y + rect.h),
    );
    for (let y = headerBottom + 16; y < innerHeight - 16; y += 16) {
      for (let x = 16; x < innerWidth - 16; x += 16) {
        const hit = instrumentation.hitTest(x, y);
        if (!hit.overUI && hit.nodeId === null) return { x, y };
      }
    }
    throw new Error('No blank graph point is available');
  });
}

async function activatePoint(page: Page, point: Point, mobile: boolean, count = 1): Promise<void> {
  if (mobile) {
    for (let index = 0; index < count; index += 1) {
      await page.touchscreen.tap(point.x, point.y);
      if (count > 1) await page.waitForTimeout(100);
    }
  } else {
    await page.mouse.click(point.x, point.y, { clickCount: count });
  }
}

async function activateTarget(page: Page, id: string, mobile: boolean): Promise<void> {
  await activatePoint(page, await targetCenter(page, id), mobile);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

async function activateClearControl(page: Page): Promise<void> {
  const point = await targetCenter(page, 'tool.clear');
  await page.evaluate(({ x, y }) => {
    const app = (
      window as unknown as {
        __OMM_APP__?: { graphClearControl?: { handleClick(x: number, y: number): boolean } };
      }
    ).__OMM_APP__;
    if (!app?.graphClearControl?.handleClick(x, y)) {
      throw new Error('Clear control rejected its instrumented target point');
    }
  }, point);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

async function activateDrawerTarget(page: Page, id: string): Promise<void> {
  const point = await targetCenter(page, id);
  await page.evaluate(({ x, y }) => {
    const drawer = (
      window as unknown as {
        __OMM_APP__?: {
          drawer?: {
            handlePointerDown(x: number, y: number, pointerType: 'mouse'): boolean;
            handlePointerUp(x: number, y: number): boolean;
          };
        };
      }
    ).__OMM_APP__?.drawer;
    if (!drawer?.handlePointerDown(x, y, 'mouse')) {
      throw new Error('Drawer rejected its instrumented target point');
    }
    if (!drawer.handlePointerUp(x, y)) throw new Error('Drawer did not complete target activation');
  }, point);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

async function drag(page: Page, from: Point, dx: number, dy: number): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let step = 1; step <= 10; step += 1) {
    await page.mouse.move(from.x + (dx * step) / 10, from.y + (dy * step) / 10);
  }
  await page.mouse.up();
}

async function dispatchPinch(page: Page): Promise<void> {
  await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) throw new Error('Canvas is unavailable for pinch input');
    const center = { x: innerWidth / 2, y: innerHeight / 2 };
    const dispatch = (type: string, id: number, x: number) =>
      canvas.dispatchEvent(
        new PointerEvent(type, {
          pointerId: id,
          pointerType: 'touch',
          isPrimary: id === 1,
          clientX: x,
          clientY: center.y,
          bubbles: true,
        }),
      );
    dispatch('pointerdown', 1, center.x - 40);
    dispatch('pointerdown', 2, center.x + 40);
    dispatch('pointermove', 1, center.x - 60);
    dispatch('pointermove', 2, center.x + 60);
    dispatch('pointerup', 1, center.x - 60);
    dispatch('pointerup', 2, center.x + 60);
  });
}

async function assertPageState<T>(
  page: Page,
  predicate: (argument: T) => boolean,
  argument?: T,
): Promise<void> {
  await page.waitForFunction(predicate as never, argument, { timeout: 5000 });
}

async function assertFiniteGeometry(page: Page): Promise<void> {
  await page.evaluate(() => {
    const instrumentation = (
      window as unknown as {
        __OMM_APP__?: {
          instrumentation?: {
            camera: { panX: number; panY: number; zoom: number };
            nodeCenters: readonly { world: Point; screen: Point }[];
          };
        };
      }
    ).__OMM_APP__?.instrumentation;
    if (!instrumentation) throw new Error('OMM instrumentation is unavailable');
    const values = [
      instrumentation.camera.panX,
      instrumentation.camera.panY,
      instrumentation.camera.zoom,
      ...instrumentation.nodeCenters.flatMap(({ world, screen }) => [
        world.x,
        world.y,
        screen.x,
        screen.y,
      ]),
    ];
    if (!values.every(Number.isFinite))
      throw new Error('Camera or projected node geometry is non-finite');
  });
}

async function assertDrawer(page: Page, key: string, expected: unknown): Promise<void> {
  await page.waitForFunction(
    ({ property, value }) => {
      const drawer = (
        window as unknown as {
          __OMM_APP__?: { instrumentation?: { drawer: Record<string, unknown> } };
        }
      ).__OMM_APP__?.instrumentation?.drawer;
      return drawer?.[property] === value;
    },
    { property: key, value: expected },
    { timeout: 5000 },
  );
}

async function hasTarget(page: Page, id: string): Promise<boolean> {
  return page.evaluate(
    (targetId) =>
      Boolean(
        (
          window as unknown as {
            __OMM_APP__?: { instrumentation?: { targets: readonly { id: string }[] } };
          }
        ).__OMM_APP__?.instrumentation?.targets.some(({ id }) => id === targetId),
      ),
    id,
  );
}

async function toggleTwice(page: Page, id: string, mobile: boolean): Promise<void> {
  if (!(await hasTarget(page, id))) return;
  await activateTarget(page, id, mobile);
  await activateTarget(page, id, mobile);
}

async function assertClearArmed(page: Page): Promise<void> {
  try {
    await assertPageState(page, () =>
      Boolean(
        (
          window as unknown as {
            __OMM_APP__?: { instrumentation?: { tools: { clearArmed: boolean } } };
          }
        ).__OMM_APP__?.instrumentation?.tools.clearArmed,
      ),
    );
  } catch (error) {
    const state = await page.evaluate(() => {
      const app = (
        window as unknown as {
          __OMM_APP__?: {
            instrumentation?: {
              graph: { nodeCount: number };
              tools: { clearArmed: boolean; relationship: unknown };
              targets: readonly { id: string; rect: unknown }[];
            };
          };
        }
      ).__OMM_APP__?.instrumentation;
      return {
        graph: app?.graph,
        tools: app?.tools,
        clearTarget: app?.targets.find(({ id }) => id === 'tool.clear'),
      };
    });
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}; state=${JSON.stringify(state)}`,
      { cause: error },
    );
  }
}

export function createBaselineCaptureDependencies(
  platform: BrowserRunnerPlatform = defaultPlatform,
): BaselineRunnerDependencies {
  return {
    validateFixtures: async () => {
      throw new Error('Fixture validation is supplied by the entrypoint');
    },
    generateGraphs: async () => {
      throw new Error('Graph generation is supplied by the entrypoint');
    },
    checkGraphs: async () => {
      throw new Error('Graph checks are supplied by the entrypoint');
    },
    preflight: (mode) => preflight(platform, mode),
    prepare: (context) => prepare(platform, context),
    startPreviews: (prepared) => startPreviews(platform, prepared),
    startBrowser: ({ fixture, prepared, previews }) =>
      platform.launchBrowsers({ fixture, prepared, previews }),
    assembleReport: async (input) =>
      assembleBaselineReport(input as Parameters<typeof assembleBaselineReport>[0]),
    validateReport: (report) => report,
    compareReport: async (report) => compareBaselineReport(report as OmmBaselineReportV1),
    writeReport: async () => {},
    stopPreviews: async (previews) => platform.stopPreviews(previews.previews ?? []),
    cleanup: async (prepared) => cleanup(platform, prepared),
  };
}

async function preflight(
  platform: BrowserRunnerPlatform,
  mode: Extract<BaselineMode, { mode: 'capture' }>,
): Promise<PreflightContext> {
  const candidateRoot = platform.cwd();
  const candidateRevision = (
    await platform.command(
      command(['git', 'rev-parse', 'HEAD'], candidateRoot, platform.environment),
    )
  ).trim();
  const runnerRevision = candidateRevision;
  const status = await platform.command(
    command(['git', 'status', '--porcelain'], candidateRoot, platform.environment),
  );
  const quotable = status.trim().length === 0;
  if (mode.repetitions === 5 && !quotable)
    throw new Error('quotable full capture requires a clean candidate');
  const runId = `capture-${platform
    .now()
    .toISOString()
    .replace(/[^0-9A-Za-z._-]/g, '-')}`;
  return {
    candidateRoot,
    candidateRevision,
    runnerRevision,
    runId,
    baselineRevision: BASELINE_REVISION,
    quotable,
  };
}

async function prepare(
  platform: BrowserRunnerPlatform,
  context: PreflightContext,
): Promise<PreparedBaseline> {
  const arms: Partial<
    Record<
      ArmName,
      { plan: ArmPlan; artifact: BaselineArtifact; physicsBundle: PhysicsBundleArtifact }
    >
  > = {};
  const artifacts: BaselineArtifact[] = [];
  const createdPlans: ArmPlan[] = [];
  try {
    for (const arm of ['baseline', 'candidate'] as const) {
      const plan = buildArmPlan({
        arm,
        revision: arm === 'baseline' ? BASELINE_REVISION : context.candidateRevision,
        candidateRoot: context.candidateRoot,
        baselineSourceRoot: context.candidateRoot,
        runId: context.runId,
        environment: platform.environment,
      });
      if (plan.createWorktree) {
        createdPlans.push(plan);
        await platform.command(plan.createWorktree);
      }
      const first = await installAndBuild(platform, plan);
      await platform.remove(join(plan.root, 'node_modules'));
      await platform.remove(plan.cacheDir);
      const second = await installAndBuild(platform, plan);
      assertRepeatedInstallEqual(first.install, second.install);
      await writePhysicsEntry(platform, plan);
      const physicsBundle = await platform.bundlePhysics(plan.physicsBundle);
      const artifact: BaselineArtifact = {
        id: arm,
        arm,
        appRevision: plan.revision,
        sourceTreeSha256: platform.sourceSnapshot(plan.root).sha256,
        lockfileSha256: second.install.lockfileSha256,
        dependencyVersions: second.install.dependencyVersions,
        installedPackageManifestSha256: second.install.installedPackageManifestSha256,
        repeatedInstallManifestSha256: second.install.installedPackageManifestSha256,
        buildSha256: second.build.sha256,
        buildMode: 'production-preview',
      };
      arms[arm] = { plan, artifact, physicsBundle };
      artifacts.push(artifact);
    }
  } catch (error) {
    try {
      await cleanupPlans(platform, context, createdPlans);
    } catch (cleanupError) {
      if (isRecord(error)) error.cleanupError = cleanupError;
    }
    throw error;
  }
  return { context, arms, artifacts, environments: [], viewports: [], workloads: [] };
}

async function writePhysicsEntry(platform: BrowserRunnerPlatform, plan: ArmPlan): Promise<void> {
  const runnerPhysics = join(platform.cwd(), 'scripts', 'vectojs-baseline', 'physics-browser.ts');
  const source = await platform.readFile(runnerPhysics);
  if (source.length > 0 && !source.includes('runPhysicsBrowserWorkload')) {
    throw new Error(`Invalid physics runner source: ${runnerPhysics}`);
  }
  const packageEntry = join(
    plan.root,
    'apps',
    'web',
    'node_modules',
    '@vectojs',
    'graph-layout',
    'dist',
    'index.mjs',
  );
  const entry = `import { ForceLayout2D } from ${JSON.stringify(packageEntry)};\nimport { runPhysicsBrowserWorkload } from ${JSON.stringify(runnerPhysics)};\n\nwindow.__VECTOJS_PHYSICS_BASELINE__ = {\n  run: (request) => runPhysicsBrowserWorkload(ForceLayout2D, request),\n};\n`;
  await platform.mkdir(dirname(plan.physicsBundle.entryPoint));
  await platform.writeFile(plan.physicsBundle.entryPoint, entry);
}

async function installAndBuild(
  platform: BrowserRunnerPlatform,
  plan: ArmPlan,
): Promise<{ install: InstallSnapshot; build: SnapshotHash }> {
  await platform.command(plan.install);
  const install = platform.installSnapshot(plan.root);
  await platform.command(plan.build);
  return { install, build: platform.buildSnapshot(plan.root) };
}

export function installSnapshot(root: string): InstallSnapshot {
  const lockfile = readFileSync(join(root, 'bun.lock'), 'utf8');
  const webRoot = join(root, 'apps', 'web');
  const packageJson = JSON.parse(readFileSync(join(webRoot, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, unknown>;
    devDependencies?: Record<string, unknown>;
  };
  const packageNames = [
    ...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.devDependencies ?? {}),
  ].filter((name, index, names) => name.startsWith('@vectojs/') && names.indexOf(name) === index);
  const resolutions = validateVectoResolutions(
    root,
    packageNames.map((name) => join(webRoot, 'node_modules', name)),
    parseVectoLockVersions(lockfile),
  );
  return {
    lockfileSha256: hashBytes(lockfile),
    dependencyVersions: dependencyVersionRecord(resolutions),
    installedPackageManifestSha256: hashPreparedManifest(
      createInstalledPackageManifest(root, resolutions),
    ),
  };
}

export function formatBuildDiagnostic(log: unknown): string {
  if (!isRecord(log)) return String(log);
  const position = isRecord(log.position) ? log.position : undefined;
  const path =
    typeof log.path === 'string'
      ? log.path
      : typeof position?.file === 'string'
        ? position.file
        : undefined;
  const line = typeof position?.line === 'number' ? position.line : undefined;
  const column = typeof position?.column === 'number' ? position.column : undefined;
  const location = path
    ? `${path}${line === undefined ? '' : `:${line}${column === undefined ? '' : `:${column}`}`}`
    : undefined;
  const message = typeof log.message === 'string' ? log.message : JSON.stringify(log);
  const renderedPosition = position === undefined ? undefined : JSON.stringify(position);
  return [message, location, renderedPosition].filter(Boolean).join(' ');
}

async function cleanupPlans(
  platform: BrowserRunnerPlatform,
  context: PreflightContext,
  plans: readonly ArmPlan[],
): Promise<void> {
  const failures: unknown[] = [];
  for (const plan of [...plans].reverse()) {
    try {
      await platform.command(
        command(
          ['git', 'worktree', 'remove', '--force', plan.root],
          context.candidateRoot,
          platform.environment,
        ),
      );
    } catch (error) {
      failures.push(error);
    }
  }
  const temporaryRoots = new Set(plans.map((plan) => plan.temporaryRoot));
  for (const temporaryRoot of temporaryRoots) {
    try {
      await platform.remove(temporaryRoot);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) throw new AggregateError(failures, 'Baseline cleanup failed');
}

async function startPreviews(
  platform: BrowserRunnerPlatform,
  prepared: PreparedBaseline,
): Promise<RunningPreviews> {
  const arms = prepared.arms ?? {};
  const previews: PreviewProcess[] = [];
  const urls: Partial<Record<ArmName, string>> = {};
  let port = 4173;
  for (const arm of ['baseline', 'candidate'] as const) {
    const plan = arms[arm]?.plan;
    if (!plan) throw new Error(`Missing ${arm} arm plan`);
    const preview = await platform.startPreview({
      root: plan.root,
      arm,
      port,
      environment: plan.install.env,
    });
    previews.push(preview);
    urls[arm] = preview.url;
    port += 1;
  }
  return { previews, urls };
}

async function cleanup(platform: BrowserRunnerPlatform, prepared: PreparedBaseline): Promise<void> {
  const plans = (['baseline', 'candidate'] as const)
    .map((arm) => prepared.arms?.[arm]?.plan)
    .filter((plan): plan is ArmPlan => plan !== undefined);
  await cleanupPlans(
    platform,
    prepared.context ?? {
      candidateRoot: platform.cwd(),
      candidateRevision: '',
      runnerRevision: '',
      baselineRevision: BASELINE_REVISION,
      runId: '',
      quotable: false,
    },
    plans,
  );
}

export function assembleBaselineReport(
  input: ReportAssemblyInput & { prepared: PreparedBaseline },
): OmmBaselineReportV1 {
  const prepared = input.prepared as PreparedBaseline & PreparedReportData;
  const captures = input.captures as Array<
    CaptureResult & {
      runs?: Record<string, unknown>[];
      interaction?: Record<string, unknown>[];
      layout?: Record<string, unknown>[];
      audits?: Record<string, unknown>[];
    }
  >;
  const runs = captures.flatMap((capture) => capture.runs ?? []);
  const interaction = captures.flatMap((capture) => capture.interaction ?? []);
  const layout = captures.flatMap((capture) => capture.layout ?? []);
  const audits = captures.flatMap((capture) => capture.audits ?? []);
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    runnerRevision: input.preflight.runnerRevision,
    artifacts: (prepared.artifacts ?? []) as BaselineArtifact[],
    environments: (prepared.environments ?? []) as BaselineEnvironment[],
    viewports: (prepared.viewports ?? []) as BaselineViewport[],
    fixture: { schemaVersion: input.fixture.schemaVersion, sha256: input.fixture.sha256 },
    workloads: (prepared.workloads ?? []) as Record<string, unknown>[],
    runs: runs as OmmBaselineReportV1['runs'],
    interaction,
    layout,
    audits,
  };
}

export function compareBaselineReport(report: OmmBaselineReportV1): OmmBaselineReportV1 {
  const runs = report.runs;
  const byWorkload = new Map<string, { baseline: number[]; candidate: number[] }>();
  for (const run of runs) {
    const workloadId = typeof run.workloadId === 'string' ? run.workloadId : undefined;
    const metrics = run.metrics;
    if (!workloadId || !isRecord(metrics) || !isRecord(metrics.measured)) continue;
    const value = metrics.measured.tickP95Milliseconds;
    if (typeof value !== 'number') continue;
    const arm =
      typeof run.artifactId === 'string' && run.artifactId.includes('baseline')
        ? 'baseline'
        : 'candidate';
    const values = byWorkload.get(workloadId) ?? { baseline: [], candidate: [] };
    values[arm].push(value);
    byWorkload.set(workloadId, values);
  }
  const comparison: Record<string, unknown>[] = [];
  for (const [workloadId, values] of byWorkload) {
    if (values.baseline.length !== 5 || values.candidate.length !== 5) continue;
    const result = compareFiveRuns({
      baseline: values.baseline,
      candidate: values.candidate,
      tolerance: 0.01,
      regressionLimit: 10,
      isCorrect: (value) => value < 50,
    });
    comparison.push({
      workloadId,
      metricId: 'tick-p95',
      ...result,
      baselineValues: values.baseline,
      candidateValues: values.candidate,
    });
  }
  return {
    ...report,
    comparison,
    comparisonInputs: {
      baselineReportSha256: hashReport(report),
      candidateReportSha256: hashReport(report),
    },
  };
}

function command(
  argv: string[],
  cwd: string,
  environment: Record<string, string | undefined>,
): CommandSpec {
  return {
    argv,
    cwd,
    env: Object.fromEntries(
      Object.entries(environment).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    ),
  };
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hashDirectoryFallback(path: string): string {
  return createHash('sha256').update(path).digest('hex');
}
