import type { BrowserContext, Route } from 'playwright';
import type { FixtureManifest } from './fixture';

export interface FixtureRouteLike {
  request(): { method(): string; url(): string };
  fulfill(options: { status: number; contentType: string; body: Buffer }): Promise<unknown>;
}

export interface FixtureRouter {
  handle(route: Route | FixtureRouteLike): Promise<void>;
  counts(): Record<string, number>;
  assertComplete(): void;
}

interface RouteInstaller {
  route(url: string, handler: (route: Route | FixtureRouteLike) => Promise<void>): Promise<unknown>;
}

export async function installFixtureRoutes(
  context: BrowserContext | RouteInstaller,
  router: FixtureRouter,
): Promise<void> {
  await context.route('**/api/**', router.handle);
}

export function createFixtureRouter(
  manifest: FixtureManifest,
  responses: ReadonlyMap<string, Uint8Array>,
  dependencies: {
    sleep?: (milliseconds: number) => Promise<unknown>;
    expectedRouteIds?: readonly string[];
  } = {},
): FixtureRouter {
  const sleep =
    dependencies.sleep ??
    ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const byRequest = new Map(
    manifest.routes.map((route) => [`${route.method} ${route.url}`, route]),
  );
  if (byRequest.size !== manifest.routes.length)
    throw new Error('Duplicate fixture route definitions');
  const requestCounts = new Map(manifest.routes.map((route) => [route.id, 0]));
  const expectedRouteIds = new Set(
    dependencies.expectedRouteIds ?? manifest.routes.map(({ id }) => id),
  );
  for (const id of expectedRouteIds) {
    if (!requestCounts.has(id)) throw new Error(`Unknown expected fixture route ${id}`);
  }

  return {
    async handle(playwrightRoute): Promise<void> {
      const request = playwrightRoute.request();
      const url = new URL(request.url());
      const key = `${request.method()} ${url.pathname}${url.search}`;
      const fixtureRoute = byRequest.get(key);
      if (!fixtureRoute) throw new Error(`Unknown fixture request ${key}`);
      const count = requestCounts.get(fixtureRoute.id) ?? 0;
      const body = responses.get(fixtureRoute.id);
      if (!body) throw new Error(`Missing fixture response bytes for ${fixtureRoute.id}`);
      requestCounts.set(fixtureRoute.id, count + 1);
      if (fixtureRoute.delayMs > 0) await sleep(fixtureRoute.delayMs);
      await playwrightRoute.fulfill({
        status: fixtureRoute.status,
        contentType: 'application/json; charset=utf-8',
        body: Buffer.from(body),
      });
    },
    counts(): Record<string, number> {
      return Object.fromEntries(
        manifest.routes.map((route) => [route.id, requestCounts.get(route.id) ?? 0]),
      );
    },
    assertComplete(): void {
      for (const route of manifest.routes) {
        if (expectedRouteIds.has(route.id) && requestCounts.get(route.id) === 0) {
          throw new Error(`Missing fixture request ${route.method} ${route.url}`);
        }
      }
    },
  };
}
