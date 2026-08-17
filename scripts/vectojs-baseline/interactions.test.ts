import { describe, expect, test } from 'bun:test';
import { scenarioIds, scenarioSteps, runScenario } from './interactions';

describe('interaction scenarios', () => {
  test('pins every scenario and its exact suite ordering', () => {
    expect(scenarioIds('desktop')).toEqual([
      'desktop-bootstrap',
      'desktop-search',
      'desktop-graph-input',
      'desktop-casefile',
      'desktop-tools',
      'desktop-idle',
    ]);
    expect(scenarioIds('mobile')).toEqual([
      'mobile-bootstrap',
      'mobile-header',
      'mobile-graph-input',
      'mobile-casefile',
      'mobile-tools',
      'mobile-idle',
    ]);
    expect(scenarioSteps('desktop-graph-input')).toEqual([
      'navigate',
      'click-root',
      'double-click-root',
      'drag-related-work',
      'wheel-zoom',
      'pan-blank',
      'activate-fit',
      'assert-no-pointer-owner',
    ]);
    expect(scenarioSteps('mobile-graph-input')).toContain('cancel-pending-pointer');
  });

  test('executes steps serially and emits stable result records from instrumentation', async () => {
    const active: string[] = [];
    const page = {
      evaluate: async () => ({ graph: { nodeCount: 3, linkCount: 2, hiddenNodeCount: 0 } }),
    };
    const records = await runScenario('desktop-bootstrap', page, {
      runId: 'run-1',
      execute: async (step) => {
        active.push(step);
      },
    });
    expect(active).toEqual(['navigate', 'assert-root', 'assert-finite-camera-geometry']);
    expect(records.map((record) => record.sequence)).toEqual([0, 1, 2]);
    expect(records[2]).toMatchObject({
      runId: 'run-1',
      scenarioId: 'desktop-bootstrap',
      stepId: 'assert-finite-camera-geometry',
      instrumentation: { graph: { nodeCount: 3, linkCount: 2, hiddenNodeCount: 0 } },
    });
  });

  test('stops on a failed step and does not reorder later actions', async () => {
    const active: string[] = [];
    await expect(
      runScenario(
        'desktop-search',
        { evaluate: async () => ({}) },
        {
          runId: 'run',
          execute: async (step) => {
            active.push(step);
            if (step === 'type-search') throw new Error('bad');
          },
        },
      ),
    ).rejects.toThrow('desktop-search/type-search: bad');
    expect(active).toEqual(['navigate', 'press-search-shortcut', 'type-search']);
  });
});
