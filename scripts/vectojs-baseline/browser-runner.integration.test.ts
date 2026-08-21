import { describe, expect, test } from 'bun:test';
import type { Page } from 'playwright';
import { executeScenarioStep, expectedRouteIds } from './browser-runner';
import type { FixtureManifest } from './fixture';

describe('browser runner integration', () => {
  test('selects only routes required by the scenario', () => {
    expect(expectedRouteIds('desktop-search')).toEqual(['seeds', 'stats', 'search-root']);
    expect(expectedRouteIds('mobile-idle')).toEqual(['seeds', 'stats']);
  });

  test('dispatches graph dragging from the instrumented node center', async () => {
    const events: Array<[string, number?, number?]> = [];
    const page = {
      evaluate(_callback: unknown, id: string) {
        expect(id).toBe('wd:Q1001');
        return Promise.resolve({ x: 100, y: 200 });
      },
      mouse: {
        move(x: number, y: number) {
          events.push(['move', x, y]);
          return Promise.resolve();
        },
        down() {
          events.push(['down']);
          return Promise.resolve();
        },
        up() {
          events.push(['up']);
          return Promise.resolve();
        },
      },
    } as unknown as Page;

    await executeScenarioStep('drag-related-work', page, {
      previewUrl: 'http://candidate.test',
      fixture: fixture(),
      viewport: { width: 1280, height: 800, dpr: 1, mobile: false },
      runId: 'candidate-chrome-1',
      scenarioId: 'desktop-graph-input',
      browser: 'chrome',
    });

    expect(events[0]).toEqual(['move', 100, 200]);
    expect(events[1]).toEqual(['down']);
    expect(events.at(-2)).toEqual(['move', 180, 240]);
    expect(events.at(-1)).toEqual(['up']);
  });

  test('reports search input and application state when results time out', async () => {
    const page = {
      keyboard: { type: async () => {} },
      waitForFunction: async () => {
        throw new Error('timeout');
      },
      evaluate: async () => ({
        activeTag: 'INPUT',
        inputValue: '江户川乱步',
        query: '江户川乱步',
        resultCount: 0,
      }),
    } as unknown as Page;

    await expect(
      executeScenarioStep('type-search', page, {
        previewUrl: 'http://candidate.test',
        fixture: fixture(),
        viewport: { width: 1280, height: 800, dpr: 1, mobile: false },
        runId: 'candidate-chrome-1',
        scenarioId: 'desktop-search',
        browser: 'chrome',
      }),
    ).rejects.toThrow(
      'Search results timed out: {"activeTag":"INPUT","inputValue":"江户川乱步","query":"江户川乱步","resultCount":0}',
    );
  });

  test('waits for animation-free scene sleep as one atomic idle state', async () => {
    const waits: unknown[][] = [];
    const page = {
      waitForFunction: async (...args: unknown[]) => {
        waits.push(args);
      },
    } as unknown as Page;

    await executeScenarioStep('await-idle', page, {
      previewUrl: 'http://candidate.test',
      fixture: fixture(),
      viewport: { width: 1280, height: 800, dpr: 1, mobile: false },
      runId: 'candidate-firefox-3',
      scenarioId: 'desktop-idle',
      browser: 'firefox',
    });

    expect(waits).toHaveLength(1);
    expect(waits[0]?.[2]).toEqual({ timeout: 45_000 });
  });

  test('accepts idle state reached at the wait timeout boundary', async () => {
    const page = {
      waitForFunction: async () => {
        throw new Error('timeout');
      },
      evaluate: async () => ({
        animationFree: true,
        sceneAlive: false,
        animationDiagnostics: {
          physicsActive: false,
          cameraAnimating: false,
          drawerAnimating: false,
        },
        graphNodeCount: 3,
      }),
    } as unknown as Page;

    await executeScenarioStep('await-idle', page, {
      previewUrl: 'http://candidate.test',
      fixture: fixture(),
      viewport: { width: 1280, height: 800, dpr: 1, mobile: false },
      runId: 'candidate-firefox-timeout-boundary',
      scenarioId: 'desktop-idle',
      browser: 'firefox',
    });
  });
});

function fixture(): FixtureManifest {
  return {
    schemaVersion: 1,
    entities: {
      rootAuthor: 'wd:Q347412',
      relatedWork: 'wd:Q1001',
      relatedAuthor: 'wd:Q35064',
      hiddenWork: 'wd:Q1002',
      globalOnlyResult: 'wd:Q9999',
    },
    expected: { firstProfileCopy: '江户川乱步' },
    controls: [],
    allowedContainmentPairs: [],
    routes: [],
  };
}
