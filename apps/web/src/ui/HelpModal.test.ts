import { describe, expect, mock, test } from 'bun:test';

mock.module('@vectojs/core', () => ({
  Entity: class MockEntity {
    interactive = false;
    a11yHidden = false;
    scene = { width: 0, height: 0, markDirty() {} };
    add() {
      return this;
    }
    on() {
      return this;
    }
    focus() {}
  },
}));

const { HelpModal, getHelpModalLayout } = await import('./HelpModal');

describe('help modal barrier and layout', () => {
  test('owns the entire pointer surface while open, including outside its card', () => {
    const modal = new HelpModal();
    expect(modal.isPointInside(20, 20)).toBe(false);

    modal.open();
    expect(modal.isPointInside(20, 20)).toBe(true);
    expect(modal.isPointInside(800, 600)).toBe(true);

    modal.close();
    expect(modal.isPointInside(20, 20)).toBe(false);
  });

  test('keeps all internal regions inside short and desktop cards', () => {
    for (const [width, height] of [
      [360, 300],
      [640, 360],
      [1280, 720],
      [1050, 1134],
    ]) {
      const layout = getHelpModalLayout(width, height);
      const { modal, join } = layout;
      expect(modal.x).toBeGreaterThanOrEqual(0);
      expect(modal.y).toBeGreaterThanOrEqual(0);
      expect(modal.x + modal.w).toBeLessThanOrEqual(width);
      expect(modal.y + modal.h).toBeLessThanOrEqual(height);
      expect(layout.sectionsY).toBeGreaterThanOrEqual(modal.y);
      expect(join.y).toBeGreaterThan(layout.sectionsY);
      expect(join.y + join.h).toBeLessThanOrEqual(layout.footerY ?? modal.y + modal.h);
      if (layout.footerY !== null) {
        expect(layout.footerY).toBeLessThanOrEqual(modal.y + modal.h);
      }
    }
  });

  test('fits all five shortcut lines in a tall desktop section', () => {
    const layout = getHelpModalLayout(1050, 1134);
    const bodyOffset = 34;
    const lineHeight = 20;
    const textHeight = 14;
    expect(layout.sectionHeight).toBeGreaterThanOrEqual(bodyOffset + lineHeight * 4 + textHeight);
  });

  test('projects fixed external destinations as accessible links', () => {
    const modal = new HelpModal() as HelpModal & {
      linkTargets: { getA11yAttributes(): unknown }[];
    };
    expect(modal.linkTargets.map((target) => target.getA11yAttributes())).toEqual([
      {
        tag: 'a',
        label: 'OMM GitHub',
        href: 'https://github.com/Xuepoo/oh-my-mystery',
        target: '_blank',
        pointerEvents: 'auto',
      },
      {
        tag: 'a',
        label: 'VectoJS GitHub',
        href: 'https://github.com/vectojs/vectojs',
        target: '_blank',
        pointerEvents: 'auto',
      },
    ]);
  });

  test('lets projected controls receive pointer activation without blocking the backdrop', () => {
    const modal = new HelpModal() as HelpModal & {
      closeTarget: { getA11yAttributes(): unknown };
    };
    expect(modal.getA11yAttributes()).toMatchObject({ pointerEvents: 'none' });
    expect(modal.closeTarget.getA11yAttributes()).toMatchObject({ pointerEvents: 'auto' });
  });
});
