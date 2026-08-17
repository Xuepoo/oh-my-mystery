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
