import { describe, expect, test } from 'bun:test';
import {
  assertViewportAndBacking,
  browserContextOptions,
  browserExecutableMetadata,
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
      resolveBrowserExecutable('firefox', { executablePath: () => '/playwright/firefox' }),
    ).toBe('/playwright/firefox');
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
});
