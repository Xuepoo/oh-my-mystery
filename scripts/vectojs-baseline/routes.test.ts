import { describe, expect, test } from 'bun:test';
import type { FixtureManifest } from './fixture';
import { createFixtureRouter, installFixtureRoutes } from './routes';

const manifest = {
  routes: [
    { id: 'seed', method: 'GET', url: '/api/seeds?x=1', status: 200, delayMs: 7 },
    { id: 'stats', method: 'GET', url: '/api/stats', status: 503, delayMs: 0 },
  ],
} as FixtureManifest;

function request(method: string, url: string) {
  return { method: () => method, url: () => url };
}

describe('fixture router', () => {
  test('matches the exact method and encoded URL, delays, and fulfills bytes', async () => {
    const events: unknown[] = [];
    const router = createFixtureRouter(manifest, new Map([['seed', new Uint8Array([0, 255, 1])]]), {
      sleep: async (milliseconds) => events.push(['sleep', milliseconds]),
    });
    await router.handle({
      request: () => request('GET', 'http://127.0.0.1:4173/api/seeds?x=1'),
      fulfill: async (value: unknown) => {
        events.push(value);
      },
    });

    expect(events).toEqual([
      ['sleep', 7],
      {
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: Buffer.from([0, 255, 1]),
      },
    ]);
    expect(router.counts()).toEqual({ seed: 1, stats: 0 });
  });

  test('accepts legitimate repeats and asserts only the scenario route subset', async () => {
    const router = createFixtureRouter(
      manifest,
      new Map([
        ['seed', new Uint8Array([1])],
        ['stats', new Uint8Array([2])],
      ]),
      { expectedRouteIds: ['stats'] },
    );
    const route = (value: ReturnType<typeof request>) => ({
      request: () => value,
      fulfill: async () => {},
    });

    await expect(router.handle(route(request('POST', 'http://x/api/stats')))).rejects.toThrow(
      'Unknown fixture request POST /api/stats',
    );
    await router.handle(route(request('GET', 'http://x/api/stats')));
    await router.handle(route(request('GET', 'http://x/api/stats')));
    expect(router.counts()).toEqual({ seed: 0, stats: 2 });
    expect(() => router.assertComplete()).not.toThrow();

    const missingExpected = createFixtureRouter(manifest, new Map(), {
      expectedRouteIds: ['seed'],
    });
    expect(() => missingExpected.assertComplete()).toThrow(
      'Missing fixture request GET /api/seeds?x=1',
    );

    const missingBytes = createFixtureRouter(manifest, new Map([['stats', new Uint8Array([2])]]));
    await expect(
      missingBytes.handle(route(request('GET', 'http://x/api/seeds?x=1'))),
    ).rejects.toThrow('Missing fixture response bytes for seed');
  });

  test('installs interception before navigation through the exact API glob', async () => {
    const calls: unknown[] = [];
    const router = createFixtureRouter(manifest, new Map());
    await installFixtureRoutes(
      { route: async (...arguments_: unknown[]) => calls.push(arguments_) },
      router,
    );
    expect(calls[0]).toEqual(['**/api/**', router.handle]);
  });
});
