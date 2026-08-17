import { describe, expect, mock, test } from 'bun:test';

mock.module('@vectojs/core', () => ({
  Entity: class MockEntity {
    interactive = false;
  },
}));

const { getGraphStatsLayout } = await import('./GraphStatsPanel');

describe('graph stats panel layout', () => {
  test('keeps desktop content inside the modal', () => {
    const layout = getGraphStatsLayout(1280, 720);

    expect(layout.cards).toHaveLength(6);
    for (const card of layout.cards) {
      expect(card.x).toBeGreaterThanOrEqual(layout.modal.x);
      expect(card.y).toBeGreaterThanOrEqual(layout.modal.y);
      expect(card.x + card.w).toBeLessThanOrEqual(layout.modal.x + layout.modal.w);
      expect(card.y + card.h).toBeLessThanOrEqual(layout.modal.y + layout.modal.h);
    }
    expect(layout.typeRows).toBe(6);
    expect(layout.typeY + 24 + (layout.typeRows - 1) * layout.typeRowHeight).toBeLessThan(
      layout.modal.y + layout.modal.h,
    );
  });

  test('bounds cards and optional type rows in a short mobile modal', () => {
    const layout = getGraphStatsLayout(360, 240);
    const modalBottom = layout.modal.y + layout.modal.h;

    expect(layout.columns).toBe(2);
    expect(layout.cards.at(-1)!.y + layout.cards.at(-1)!.h).toBeCloseTo(modalBottom - 12);
    expect(layout.typeRows).toBeGreaterThanOrEqual(0);
    if (layout.typeRows > 0) {
      expect(layout.typeY + 24 + (layout.typeRows - 1) * layout.typeRowHeight).toBeLessThan(
        modalBottom,
      );
    }
  });
});
