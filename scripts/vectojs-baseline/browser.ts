import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type { Browser, BrowserContextOptions, Page } from 'playwright';

export type BrowserName = 'chrome' | 'firefox';

const DPR_TOLERANCE = 1e-4;

export interface ViewportSpec {
  width: number;
  height: number;
  dpr: number;
  mobile: boolean;
}

export interface BrowserExecutableMetadata {
  browser: BrowserName;
  executablePath: string;
  executableSha256: string;
  version: string;
}

interface BrowserTypeLike {
  executablePath(): string;
}

export function resolveBrowserExecutable(
  browser: BrowserName,
  playwrightBrowserType: BrowserTypeLike,
  pathExists: (path: string) => boolean = existsSync,
): string {
  if (browser === 'chrome') return '/usr/bin/google-chrome-stable';
  const playwrightPath = playwrightBrowserType.executablePath();
  if (pathExists(playwrightPath)) return playwrightPath;
  throw new Error(
    `Playwright Firefox is missing at ${playwrightPath}; run ./node_modules/.bin/playwright install firefox`,
  );
}

const HEADED_CHROMIUM_ARGS = ['--ozone-platform=wayland'] as const;

export function headedLaunchArgs(browser: BrowserName): string[] {
  return browser === 'chrome' ? [...HEADED_CHROMIUM_ARGS] : [];
}

export function headedLaunchEnv(browser: BrowserName): Record<string, string> | undefined {
  return browser === 'firefox' ? { MOZ_ENABLE_WAYLAND: '1' } : undefined;
}

export function mergeLaunchEnvironment(
  inherited: Record<string, string | undefined>,
  browser: BrowserName,
): Record<string, string> | undefined {
  const headed = headedLaunchEnv(browser);
  if (!headed) return undefined;
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(inherited)) {
    if (value !== undefined) result[name] = value;
  }
  return { ...result, ...headed };
}

export function browserContextOptions(
  viewport: ViewportSpec,
  browser: BrowserName = 'chrome',
): BrowserContextOptions {
  const options: BrowserContextOptions = {
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.dpr,
  };
  if (viewport.mobile) {
    options.hasTouch = true;
    options.userAgent = `OMM Baseline Mobile ${browser === 'firefox' ? 'Firefox' : 'Chrome'}`;
    if (browser === 'chrome') options.isMobile = true;
  }
  return options;
}

export async function browserExecutableMetadata(
  browser: BrowserName,
  executablePath: string,
  dependencies: {
    readFile?: (path: string) => Promise<Uint8Array>;
    version: () => Promise<string>;
  },
): Promise<BrowserExecutableMetadata> {
  const bytes = await (dependencies.readFile ?? readFile)(executablePath);
  return {
    browser,
    executablePath,
    executableSha256: createHash('sha256').update(bytes).digest('hex'),
    version: await dependencies.version(),
  };
}

interface BrowserLike {
  newContext(options: BrowserContextOptions): Promise<{
    newPage(): Promise<unknown>;
    close(): Promise<unknown>;
  }>;
}

export async function runInNewContext<T>(
  browser: Browser | BrowserLike,
  options: BrowserContextOptions,
  run: (page: Page) => Promise<T>,
): Promise<T> {
  const context = await browser.newContext(options);
  try {
    return await run((await context.newPage()) as Page);
  } finally {
    await context.close();
  }
}

interface ReadinessPage {
  evaluate(pageFunction: unknown, argument?: unknown): Promise<unknown>;
  waitForFunction(
    pageFunction: unknown,
    argument?: unknown,
    options?: { timeout?: number },
  ): Promise<unknown>;
}

export async function waitForStablePredicate(
  page: Pick<ReadinessPage, 'waitForFunction'>,
  instrumentationProperty: string,
  timeout = 5000,
): Promise<void> {
  await page.waitForFunction(
    async (property: string) => {
      const instrumentation = (
        window as unknown as {
          __OMM_APP__?: { instrumentation?: Record<string, unknown> };
        }
      ).__OMM_APP__?.instrumentation;
      if (!instrumentation?.[property]) return false;
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      if (!instrumentation[property]) return false;
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      return Boolean(instrumentation[property]);
    },
    instrumentationProperty,
    { timeout },
  );
}

export async function waitForApplicationReady(
  page: Page | ReadinessPage,
  rootEntityId: string,
  timeout = 10000,
  waitForAnimation = true,
  minimumLinkCount = 0,
): Promise<void> {
  await page.evaluate(async () => document.fonts.ready);
  try {
    await page.waitForFunction(
      ({ rootId, minimumLinks }: { rootId: string; minimumLinks: number }) => {
        const app = (
          window as unknown as {
            __OMM_APP__?: {
              instrumentation?: {
                ready: boolean;
                nodeCenters: readonly { id: string }[];
                graph?: { linkCount: number };
              };
            };
          }
        ).__OMM_APP__;
        return Boolean(
          app?.instrumentation?.ready &&
          app.instrumentation.nodeCenters.some(({ id }) => id === rootId) &&
          (app.instrumentation.graph?.linkCount ?? 0) >= minimumLinks,
        );
      },
      { rootId: rootEntityId, minimumLinks: minimumLinkCount },
      { timeout },
    );
    if (waitForAnimation) await waitForStablePredicate(page, 'animationFree', timeout);
  } catch (error) {
    const state = await page.evaluate((rootId) => {
      const app = (
        window as unknown as {
          __OMM_APP__?: {
            instrumentation?: {
              ready?: boolean;
              animationFree?: boolean;
              animationDiagnostics?: {
                physicsActive: boolean;
                cameraAnimating: boolean;
                drawerAnimating: boolean;
              };
              nodeCenters?: readonly { id: string }[];
              graph?: unknown;
            };
          };
        }
      ).__OMM_APP__;
      return {
        ready: app?.instrumentation?.ready,
        animationFree: app?.instrumentation?.animationFree,
        animationDiagnostics: app?.instrumentation?.animationDiagnostics,
        hasRoot: app?.instrumentation?.nodeCenters?.some(({ id }) => id === rootId),
        nodeCount: app?.instrumentation?.nodeCenters?.length,
        graph: app?.instrumentation?.graph,
        hasFocus: document.hasFocus(),
        visibilityState: document.visibilityState,
        url: location.href,
      };
    }, rootEntityId);
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}; readiness=${JSON.stringify(state)}`,
      { cause: error },
    );
  }
}

export interface ObservedViewport {
  width: number;
  height: number;
  dpr: number;
  backingWidth: number;
  backingHeight: number;
}

export function assertViewportAndBacking(
  browser: BrowserName,
  observed: ObservedViewport,
  expected: Pick<ViewportSpec, 'width' | 'height' | 'dpr'>,
): void {
  const prefix =
    browser === 'firefox' && expected.dpr === 2 ? 'Firefox DPR 2 assertion failed: ' : '';
  const checks: Array<[string, number, number, number]> = [
    ['innerWidth', observed.width, expected.width, 0],
    ['innerHeight', observed.height, expected.height, 0],
    ['devicePixelRatio', observed.dpr, expected.dpr, DPR_TOLERANCE],
    ['Canvas backing width', observed.backingWidth, expected.width * expected.dpr, 0],
    ['Canvas backing height', observed.backingHeight, expected.height * expected.dpr, 0],
  ];
  for (const [label, actual, wanted, tolerance] of checks) {
    if (Math.abs(actual - wanted) > tolerance)
      throw new Error(`${prefix}${label} expected ${wanted}, received ${actual}`);
  }
}

export async function readObservedViewport(page: Page): Promise<ObservedViewport> {
  return page.evaluate(() => {
    const dimensions = (
      window as unknown as {
        __OMM_APP__?: {
          instrumentation?: {
            dimensions: { backing: { width: number; height: number } };
          };
        };
      }
    ).__OMM_APP__?.instrumentation?.dimensions;
    if (!dimensions) throw new Error('OMM instrumentation dimensions are unavailable');
    return {
      width: window.innerWidth,
      height: window.innerHeight,
      dpr: window.devicePixelRatio,
      backingWidth: dimensions.backing.width,
      backingHeight: dimensions.backing.height,
    };
  });
}
