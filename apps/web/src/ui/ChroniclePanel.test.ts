import { describe, expect, mock, test } from 'bun:test';

mock.module('@vectojs/core', () => ({
  Entity: class {
    interactive = false;
  },
}));

const { getChronicleLayout } = await import('./ChroniclePanel');

describe('chronicle layout', () => {
  test('keeps a compact modal inside a short mobile scene', () => {
    const layout = getChronicleLayout(360, 300, 6);
    expect(layout.modal.x).toBeGreaterThanOrEqual(0);
    expect(layout.modal.y).toBeGreaterThanOrEqual(0);
    expect(layout.modal.x + layout.modal.w).toBeLessThanOrEqual(360);
    expect(layout.modal.y + layout.modal.h).toBeLessThanOrEqual(300);
    expect(layout.columns).toBe(2);
    expect(layout.intro).toBeNull();
    expect(layout.progress).toBeNull();
    expect(layout.tabs.y + layout.tabs.h).toBeLessThanOrEqual(layout.card.y);
    expect(layout.card.y + layout.card.h).toBeLessThanOrEqual(layout.nav.y);
    expect(layout.nav.y + layout.nav.h).toBeLessThanOrEqual(layout.modal.y + layout.modal.h);
  });

  test('uses a wider tab layout on desktop', () => {
    const layout = getChronicleLayout(1280, 720, 6);
    expect(layout.columns).toBe(3);
    expect(layout.intro).not.toBeNull();
    expect(layout.progress).not.toBeNull();
    expect(layout.tabs.y + layout.tabs.h).toBeLessThanOrEqual(layout.intro!.y);
    expect(layout.intro!.y + layout.intro!.h).toBeLessThanOrEqual(layout.progress!.y);
    expect(layout.progress!.y + layout.progress!.h).toBeLessThanOrEqual(layout.card.y);
    expect(layout.card.y + layout.card.h).toBeLessThanOrEqual(layout.nav.y);
  });
});
