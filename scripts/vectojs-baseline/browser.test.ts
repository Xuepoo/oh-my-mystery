import { describe, expect, test } from 'bun:test';
import {
  assertViewportAndBacking,
  browserContextOptions,
  browserExecutableMetadata,
  headedLaunchArgs,
  headedLaunchEnv,
  mergeLaunchEnvironment,
  resolveBrowserExecutable,
  runInNewContext,
  waitForStablePredicate,
  waitForApplicationReady,
} from './browser';

describe('browser helpers', () => {
  test('constructs exact desktop and mobile context options', () => {
    expect(browserContextOptions({ width: 1280, height: 800, dpr: 1, mobile: false })).toEqual({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
    });
    expect(
      browserContextOptions({ width: 390, height: 844, dpr: 2, mobile: true }, 'firefox'),
    ).toEqual({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      hasTouch: true,
      userAgent: 'OMM Baseline Mobile Firefox',
    });
  });

  test('hashes executable bytes and records the full version', async () => {
    const metadata = await browserExecutableMetadata('chrome', '/browser/chrome', {
      readFile: async () => new Uint8Array([1, 2, 3]),
      version: async () => 'Chrome 130.0.1',
    });
    expect(metadata).toEqual({
      browser: 'chrome',
      executablePath: '/browser/chrome',
      executableSha256: '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81',
      version: 'Chrome 130.0.1',
    });
  });

  test('pins Chrome and resolves Firefox from Playwright without downloading', () => {
    expect(resolveBrowserExecutable('chrome', { executablePath: () => '/ignored' })).toBe(
      '/usr/bin/google-chrome-stable',
    );
    expect(
      resolveBrowserExecutable(
        'firefox',
        { executablePath: () => '/playwright/firefox' },
        () => true,
      ),
    ).toBe('/playwright/firefox');
  });

  test('falls back to the installed Firefox when the Playwright cache is stale', () => {
    expect(
      resolveBrowserExecutable(
        'firefox',
        { executablePath: () => '/missing/firefox' },
        () => false,
      ),
    ).toBe('/usr/bin/firefox');
  });

  test('configures headed Wayland launch args and environment per engine', () => {
    expect(headedLaunchArgs('chrome')).toEqual(['--ozone-platform=wayland']);
    expect(headedLaunchArgs('firefox')).toEqual([]);
    expect(headedLaunchEnv('chrome')).toBeUndefined();
    expect(headedLaunchEnv('firefox')).toEqual({ MOZ_ENABLE_WAYLAND: '1' });
  });

  test('merges inherited process environment into the headed Firefox launch env', () => {
    expect(
      mergeLaunchEnvironment(
        { DISPLAY: ':1', WAYLAND_DISPLAY: 'wayland-1', UNSET: undefined },
        'firefox',
      ),
    ).toEqual({ DISPLAY: ':1', WAYLAND_DISPLAY: 'wayland-1', MOZ_ENABLE_WAYLAND: '1' });
    expect(mergeLaunchEnvironment({ DISPLAY: ':1' }, 'chrome')).toBeUndefined();
  });

  test('creates and always closes a fresh context', async () => {
    const events: string[] = [];
    const browser = {
      newContext: async () => ({
        newPage: async () => ({ id: 'page' }),
        close: async () => events.push('close'),
      }),
    };
    await expect(
      runInNewContext(browser, {}, async () => {
        events.push('run');
        throw new Error('failed');
      }),
    ).rejects.toThrow('failed');
    expect(events).toEqual(['run', 'close']);
  });

  test('waits for fonts, readiness, and two animation-free frames', async () => {
    const calls: string[] = [];
    await waitForApplicationReady(
      {
        evaluate: async (_fn: unknown, argument?: unknown) =>
          calls.push(String(argument ?? 'fonts')),
        waitForFunction: async (_fn: unknown, argument?: unknown) => calls.push(String(argument)),
      },
      'wd:Q347412',
    );
    expect(calls).toEqual(['fonts', 'wd:Q347412', 'animationFree']);
  });

  test('uses the bounded two-frame predicate wait', async () => {
    const calls: unknown[] = [];
    await waitForStablePredicate(
      { waitForFunction: async (...arguments_: unknown[]) => calls.push(arguments_) },
      'drawer-open',
      1234,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject([expect.any(Function), 'drawer-open', { timeout: 1234 }]);
  });

  test('fails Firefox DPR2 rather than falling back', () => {
    expect(() =>
      assertViewportAndBacking(
        'firefox',
        { width: 390, height: 844, dpr: 1, backingWidth: 390, backingHeight: 844 },
        { width: 390, height: 844, dpr: 2 },
      ),
    ).toThrow('Firefox DPR 2 assertion failed: devicePixelRatio expected 2, received 1');
  });

  test('tolerates headed GPU device-pixel-ratio float error', () => {
    expect(() =>
      assertViewportAndBacking(
        'chrome',
        {
          width: 390,
          height: 844,
          dpr: 2.0000000298023224,
          backingWidth: 780,
          backingHeight: 1688,
        },
        { width: 390, height: 844, dpr: 2 },
      ),
    ).not.toThrow();
    expect(() =>
      assertViewportAndBacking(
        'chrome',
        { width: 390, height: 844, dpr: 2.1, backingWidth: 780, backingHeight: 1688 },
        { width: 390, height: 844, dpr: 2 },
      ),
    ).toThrow('devicePixelRatio expected 2, received 2.1');
  });
});
