import { describe, expect, mock, test } from 'bun:test';

mock.module('@vectojs/core', () => ({
  Entity: class MockEntity {
    interactive = false;
  },
}));

const { getRelationshipFilterLayout } = await import('./RelationshipFilterBar');

describe('relationship filter bar layout', () => {
  test('starts desktop filters to the right of the toggle and wraps there', () => {
    const layout = getRelationshipFilterLayout(640, 5);

    expect(layout.filters[0]!.x).toBeGreaterThan(layout.toggle.x + layout.toggle.w);
    expect(layout.filters[4]!.x).toBe(layout.filters[0]!.x);
    expect(layout.filters[4]!.y).toBeGreaterThan(layout.filters[0]!.y);
  });

  test('retains the compact three-column mobile grid', () => {
    const layout = getRelationshipFilterLayout(360, 5);

    expect(layout.filters.slice(0, 3).map((rect) => rect.y)).toEqual([128, 128, 128]);
    expect(layout.filters[3]!.x).toBe(layout.filters[0]!.x);
    expect(layout.filters[3]!.y).toBe(180);
    expect(layout.filters.every((rect) => rect.x + rect.w <= 344)).toBe(true);
  });
});
