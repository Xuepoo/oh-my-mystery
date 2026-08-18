import { describe, expect, mock, test } from 'bun:test';

mock.module('@vectojs/core', () => ({
  Entity: class {
    interactive = false;
  },
}));

const { createMinimapProjection } = await import('./Minimap');

describe('minimap projection', () => {
  test('keeps a connected horizontal network visible with stable extents', () => {
    const projection = createMinimapProjection(
      [
        { id: 'a', type: 'author', name: 'a', color: '#fff', val: 1, labels: {}, x: -100, y: 10 },
        { id: 'b', type: 'work', name: 'b', color: '#fff', val: 1, labels: {}, x: 100, y: 10 },
      ],
      { x: 10, y: 20, w: 150, h: 90 },
    )!;

    expect(projection.points.get('a')!.x).toBeGreaterThanOrEqual(10);
    expect(projection.points.get('b')!.x).toBeLessThanOrEqual(160);
    expect(projection.points.get('a')!.y).toBeCloseTo(projection.points.get('b')!.y);
    expect(projection.drawRect.x).toBeGreaterThanOrEqual(10);
    expect(projection.drawRect.x + projection.drawRect.w).toBeLessThanOrEqual(160);
    expect(projection.worldAt(10, 20)).toBeNull();
  });

  test('handles one positioned node and ignores non-finite positions', () => {
    const projection = createMinimapProjection(
      [
        { id: 'a', type: 'author', name: 'a', color: '#fff', val: 1, labels: {}, x: 5, y: 8 },
        {
          id: 'bad',
          type: 'work',
          name: 'bad',
          color: '#fff',
          val: 1,
          labels: {},
          x: Infinity,
          y: 0,
        },
      ],
      { x: 0, y: 0, w: 100, h: 60 },
    )!;
    const point = projection.points.get('a')!;

    expect(Number.isFinite(point.x)).toBe(true);
    expect(Number.isFinite(point.y)).toBe(true);
    expect(projection.points.has('bad')).toBe(false);
    expect(projection.worldAt(point.x, point.y)).toEqual({ x: 5, y: 8 });
    expect(projection.pointAt(5, 8)).toEqual(point);
  });
});
