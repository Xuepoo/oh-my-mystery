import { describe, expect, it } from 'bun:test';
import {
  createPillCacheKey,
  placeGraphLabels,
  type LabelPlacementCandidate,
} from './GraphOverlayLayer';

const viewport = { x: 0, y: 64, width: 320, height: 200 };

function candidate(
  id: string,
  sx: number,
  sy: number,
  overrides: Partial<LabelPlacementCandidate> = {},
): LabelPlacementCandidate {
  return { id, sx, sy, width: 80, height: 22, radius: 8, ...overrides };
}

function overlaps(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

describe('placeGraphLabels', () => {
  it('retains the hovered label before selected, path, and degree-ranked labels', () => {
    const labels = placeGraphLabels(
      [
        candidate('degree', 160, 130, { degree: 100 }),
        candidate('path', 160, 130, { onPath: true }),
        candidate('selected', 160, 130, { selected: true }),
        candidate('hovered', 160, 130, { hovered: true }),
      ],
      { viewport, maxLabels: 1 },
    );

    expect(labels.map(({ id }) => id)).toEqual(['hovered']);
  });

  it('uses below, above, right, then left and suppresses labels with no free candidate', () => {
    const labels = placeGraphLabels(
      [
        candidate('below', 160, 130, { hovered: true }),
        candidate('above', 160, 130, { selected: true }),
        candidate('right', 160, 130, { onPath: true }),
        candidate('left', 160, 130, { degree: 2 }),
        candidate('suppressed', 160, 130, { degree: 1 }),
      ],
      { viewport },
    );

    expect(labels.map(({ id, side }) => [id, side])).toEqual([
      ['below', 'below'],
      ['above', 'above'],
      ['right', 'right'],
      ['left', 'left'],
    ]);
    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) {
        expect(overlaps(labels[i]!, labels[j]!)).toBe(false);
      }
    }
  });

  it('keeps finite placements inside the graph viewport at all supported zoom levels', () => {
    for (const zoom of [0.15, 0.35, 0.7, 1, 3.5]) {
      const labels = placeGraphLabels(
        [
          candidate(`top-${zoom}`, 44 * zoom + 4, 70, {
            width: 36,
            radius: 12 * Math.min(1.3, Math.max(0.65, zoom)),
          }),
          candidate(`right-${zoom}`, 316, 150, {
            width: 44,
            radius: 7 * Math.min(1.3, Math.max(0.65, zoom)),
          }),
        ],
        { viewport },
      );

      expect(labels.length).toBeGreaterThan(0);
      for (const label of labels) {
        expect([label.x, label.y, label.width, label.height].every(Number.isFinite)).toBe(true);
        expect(label.x).toBeGreaterThanOrEqual(viewport.x + 4);
        expect(label.y).toBeGreaterThanOrEqual(viewport.y + 4);
        expect(label.x + label.width).toBeLessThanOrEqual(viewport.x + viewport.width - 4);
        expect(label.y + label.height).toBeLessThanOrEqual(viewport.y + viewport.height - 4);
      }
    }
  });

  it('uses degree then id for deterministic equal-priority ordering', () => {
    const labels = placeGraphLabels(
      [candidate('b', 160, 130, { degree: 4 }), candidate('a', 160, 130, { degree: 4 })],
      { viewport, maxLabels: 1 },
    );

    expect(labels[0]?.id).toBe('a');
  });

  it('does not place a label over another graph node', () => {
    const labels = placeGraphLabels([candidate('label', 160, 130)], {
      viewport,
      occupied: [{ x: 112, y: 140, width: 16, height: 16 }],
    });

    expect(labels).toHaveLength(1);
    expect(labels[0]?.side).not.toBe('left');
    expect(overlaps(labels[0]!, { x: 112, y: 140, width: 16, height: 16 })).toBe(false);
  });
});

describe('createPillCacheKey', () => {
  it('invalidates measured widths when the font generation changes', () => {
    const before = createPillCacheKey('label', '600 11px sans-serif', 0);
    const after = createPillCacheKey('label', '600 11px sans-serif', 1);

    expect(after).not.toBe(before);
    expect(createPillCacheKey('label', '600 11px sans-serif', 1)).toBe(after);
  });
});
