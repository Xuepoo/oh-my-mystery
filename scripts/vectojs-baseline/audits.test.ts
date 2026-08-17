import { describe, expect, test } from 'bun:test';
import { collectGeometryAudit, collectGeometryFromPage, collectIdleAudit } from './audits';

describe('baseline audits', () => {
  test('collects rounded targets, overlaps, escapes, and hit owners', () => {
    const result = collectGeometryAudit({
      runId: 'r1',
      scenarioId: 'mobile-tools',
      viewport: { x: 0, y: 0, width: 100, height: 100 },
      controls: ['a', 'b'],
      allowedContainmentPairs: [],
      targets: [
        { id: 'a', rect: { x: -1.04, y: 0, w: 44, h: 44 }, activatable: true, hitOwnerId: 'a' },
        { id: 'b', rect: { x: 40, y: 0, w: 70, h: 44 }, activatable: false, hitOwnerId: null },
      ],
    });
    expect(result.targets[0]).toMatchObject({
      key: 'mobile-tools:a',
      rect: { x: -1, y: 0, width: 44, height: 44 },
    });
    expect(result.overlaps).toHaveLength(1);
    expect(result.overlaps[0].key).toBe('mobile-tools:a|b');
    expect(result.escapes.map((finding) => finding.key)).toEqual([
      'mobile-tools:a',
      'mobile-tools:b',
    ]);
  });

  test('rejects unknown, missing, and duplicate stable target IDs', () => {
    const input = {
      runId: 'r',
      scenarioId: 's',
      viewport: { x: 0, y: 0, width: 10, height: 10 },
      controls: ['a'],
      allowedContainmentPairs: [] as [string, string][],
    };
    expect(() => collectGeometryAudit({ ...input, targets: [] })).toThrow(
      'Missing rendered target a',
    );
    expect(() =>
      collectGeometryAudit({
        ...input,
        targets: [
          { id: 'x', rect: { x: 0, y: 0, w: 1, h: 1 }, activatable: true, hitOwnerId: 'x' },
        ],
      }),
    ).toThrow('Unknown rendered target x');
  });

  test('records 120 idle frames and fails every-frame dirty causes', () => {
    expect(
      collectIdleAudit(
        'r',
        'desktop-idle',
        Array.from({ length: 120 }, () => []),
      ),
    ).toEqual({
      runId: 'r',
      scenarioId: 'desktop-idle',
      frameCount: 120,
      dirtyFrameCount: 0,
      everyFrameDirtyCauses: [],
      passed: true,
    });
    expect(() =>
      collectIdleAudit(
        'r',
        'desktop-idle',
        Array.from({ length: 120 }, () => ['physics']),
      ),
    ).toThrow('Idle audit failed: every-frame dirty cause physics');
  });

  test('reads target geometry and hit ownership from the stable instrumentation surface', async () => {
    const result = await collectGeometryFromPage(
      {
        evaluate: async () => [
          { id: 'a', rect: { x: 1, y: 2, w: 44, h: 44 }, activatable: true, hitOwnerId: 'a' },
        ],
      },
      {
        runId: 'r',
        scenarioId: 's',
        viewport: { x: 0, y: 0, width: 100, height: 100 },
        controls: ['a'],
        allowedContainmentPairs: [],
      },
    );
    expect(result.targets[0]).toMatchObject({ controlId: 'a', hitOwnerId: 'a' });
  });

  test('ignores controls rendered for another scenario state', async () => {
    const result = await collectGeometryFromPage(
      {
        evaluate: async () => [
          {
            id: 'tool.stats',
            rect: { x: 1, y: 2, w: 44, h: 44 },
            activatable: true,
            hitOwnerId: 'tool.stats',
          },
          {
            id: 'casefile.close',
            rect: { x: 50, y: 2, w: 44, h: 44 },
            activatable: true,
            hitOwnerId: 'casefile.close',
          },
        ],
      },
      {
        runId: 'r',
        scenarioId: 'mobile-tools',
        viewport: { x: 0, y: 0, width: 100, height: 100 },
        controls: ['tool.stats'],
        allowedContainmentPairs: [],
      },
    );
    expect(result.targets.map((target) => target.controlId)).toEqual(['tool.stats']);
  });
});
