import assert from 'node:assert/strict';
import { chromium, type BrowserContext, type Page } from 'playwright';

const ROOT = new URL('..', import.meta.url).pathname;
const WEB_URL = 'http://localhost:3000';
const spawned: ReturnType<typeof Bun.spawn>[] = [];

async function ensureServer(url: string, command: string[], cwd: string): Promise<void> {
  try {
    if ((await fetch(url)).ok) return;
  } catch {}
  spawned.push(Bun.spawn(command, { cwd, stdout: 'ignore', stderr: 'ignore' }));
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await Bun.sleep(200);
  }
  throw new Error(`Server did not become ready: ${url}`);
}

async function dispatchTouch(
  page: Page,
  type: string,
  pointerId: number,
  x: number,
  y: number,
): Promise<void> {
  await page.evaluate(
    ({ type, pointerId, x, y }) => {
      document.getElementById('app-canvas')!.dispatchEvent(
        new PointerEvent(type, {
          pointerId,
          pointerType: 'touch',
          clientX: x,
          clientY: y,
          isPrimary: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    { type, pointerId, x, y },
  );
}

async function readyPage(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.addInitScript(() => localStorage.setItem('omm-welcome-dismissed', '1'));
  await page.goto(WEB_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean((window as any).__OMM_APP__));
  return page;
}

async function verifyContext(
  context: BrowserContext,
  width: number,
  height: number,
): Promise<void> {
  const page = await readyPage(context);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await dispatchTouch(page, 'pointerdown', 11, width / 2, height / 2);
  await page.keyboard.press('?');
  await page.waitForFunction(() => (window as any).__OMM_APP__.helpModal.isModalOpen());
  await dispatchTouch(page, 'pointerup', 11, width / 2, height / 2);
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );

  const helpState = await page.evaluate(() => {
    const app = (window as any).__OMM_APP__;
    return {
      activePointers: app.activePointers.size,
      pinch: app.pinchState,
      isPointerDown: app.isPointerDown,
      modal: app.helpModal.modalRect,
      links: app.helpModal.joinRects,
    };
  });
  assert.equal(helpState.activePointers, 0);
  assert.equal(helpState.pinch, null);
  assert.equal(helpState.isPointerDown, false);
  for (const link of helpState.links) {
    assert.ok(
      link.x >= helpState.modal.x && link.x + link.w <= helpState.modal.x + helpState.modal.w,
    );
    assert.ok(
      link.y >= helpState.modal.y && link.y + link.h <= helpState.modal.y + helpState.modal.h,
    );
  }

  assert.equal(await page.getByRole('link', { name: 'OMM GitHub' }).count(), 1);
  assert.equal(
    await page.getByRole('link', { name: 'OMM GitHub' }).getAttribute('target'),
    '_blank',
  );
  assert.equal(
    await page.getByRole('link', { name: 'VectoJS GitHub' }).getAttribute('href'),
    'https://github.com/vectojs/vectojs',
  );
  await page.evaluate(() => {
    (window as any).__OPEN_CALLS__ = [];
    window.open = ((...args: unknown[]) => {
      (window as any).__OPEN_CALLS__.push(args);
      return { opener: window };
    }) as typeof window.open;
  });
  const projectedLink = await page.getByRole('link', { name: 'VectoJS GitHub' }).boundingBox();
  assert.ok(projectedLink);
  await page.mouse.click(
    projectedLink.x + projectedLink.width / 2,
    projectedLink.y + projectedLink.height / 2,
  );
  assert.deepEqual(await page.evaluate(() => (window as any).__OPEN_CALLS__), [
    ['https://github.com/vectojs/vectojs', '_blank', 'noopener,noreferrer'],
  ]);

  await page.mouse.click(2, height / 2);
  await page.waitForFunction(() => !(window as any).__OMM_APP__.helpModal.isModalOpen());
  await page.keyboard.press('/');
  assert.equal(
    await page
      .locator('#omm-header-search-input')
      .evaluate((input) => input === document.activeElement),
    true,
  );

  await page
    .locator('#omm-header-search-input')
    .evaluate((input: HTMLInputElement) => input.blur());
  await page.keyboard.press('/');
  await page.waitForTimeout(300);
  assert.equal(
    await page
      .locator('#omm-header-search-input')
      .evaluate((input) => input === document.activeElement),
    true,
  );

  await page.evaluate(() => {
    const textarea = document.createElement('textarea');
    textarea.id = 'shortcut-editable';
    document.body.appendChild(textarea);
    textarea.focus();
  });
  await page.keyboard.press('/');
  assert.equal(
    await page.locator('#shortcut-editable').evaluate((input) => input === document.activeElement),
    true,
  );
  await page.locator('#shortcut-editable').evaluate((input) => input.remove());

  await page.keyboard.press('?');
  await page.waitForFunction(() => (window as any).__OMM_APP__.helpModal.isModalOpen());
  assert.equal(
    await page
      .locator('#omm-header-search-input')
      .evaluate((input) => getComputedStyle(input).visibility),
    'hidden',
  );
  await page.keyboard.press('/');
  assert.equal(
    await page
      .locator('#omm-header-search-input')
      .evaluate((input) => input === document.activeElement),
    false,
  );
  const closeButton = await page.getByRole('button', { name: '关闭使用指南' }).boundingBox();
  assert.ok(closeButton);
  await page.mouse.click(
    closeButton.x + closeButton.width / 2,
    closeButton.y + closeButton.height / 2,
  );
  await page.waitForFunction(() => !(window as any).__OMM_APP__.helpModal.isModalOpen());
  assert.equal(
    await page
      .locator('#omm-header-search-input')
      .evaluate((input) => getComputedStyle(input).visibility),
    'visible',
  );

  await page.waitForFunction(() => !(window as any).__OMM_APP__.viewport.isCameraAnimating());
  const settledBefore = await page.evaluate(() => {
    const viewport = (window as any).__OMM_APP__.viewport;
    return { panX: viewport.panX, panY: viewport.panY, zoom: viewport.zoom };
  });
  await dispatchTouch(page, 'pointerdown', 13, width / 2, height / 2);
  await dispatchTouch(page, 'pointermove', 13, width / 2 + 24, height / 2 + 16);
  await dispatchTouch(page, 'pointerup', 13, width / 2 + 24, height / 2 + 16);
  const after = await page.evaluate(() => {
    const app = (window as any).__OMM_APP__;
    return {
      panX: app.viewport.panX,
      panY: app.viewport.panY,
      zoom: app.viewport.zoom,
      activePointers: app.activePointers.size,
      pinch: app.pinchState,
    };
  });
  assert.equal(after.zoom, settledBefore.zoom);
  assert.ok(after.panX !== settledBefore.panX || after.panY !== settledBefore.panY);
  assert.equal(after.activePointers, 0);
  assert.equal(after.pinch, null);

  const layoutState = await page.evaluate(async () => {
    const app = (window as any).__OMM_APP__;
    const trails = Array.from({ length: 6 }, (_, index) => ({
      slug: `trail-${index}`,
      title: { zh: `时间线 ${index + 1}` },
      description: { zh: '跨越时代的推理文学线索。' },
      steps: [
        {
          id: `step-${index}`,
          title: { zh: '章节' },
          summary: { zh: '用于响应式布局验证的编年史摘要。' },
          primaryEntityId: 'test:one',
          focusEntityIds: ['test:one'],
          year: 1920,
        },
      ],
    }));
    app.chroniclePanel.open(trails);
    app.scene.markDirty();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const chronicle = app.chroniclePanel.getLayout();
    app.chroniclePanel.close();

    app.viewport.addManualNode({
      id: 'test:one',
      type: 'author',
      name: 'One',
      labels: {},
      color: '#fff',
      val: 1,
      x: -100,
      y: 0,
    });
    app.viewport.addManualNode({
      id: 'test:two',
      type: 'work',
      name: 'Two',
      labels: {},
      color: '#fff',
      val: 1,
      x: 100,
      y: 0,
    });
    app.scene.markDirty();
    for (let frame = 0; frame < 120; frame++) {
      if (app.minimap.projection?.points.has('test:one')) break;
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    const projection = app.minimap.projection;
    if (!projection?.points.has('test:one')) throw new Error('Minimap projection did not update');
    const map = app.minimap.mapRect;
    const letterbox =
      projection.drawRect.y > map.y
        ? { x: map.x + map.w / 2, y: map.y + 1 }
        : projection.drawRect.x > map.x
          ? { x: map.x + 1, y: map.y + map.h / 2 }
          : null;
    return {
      chronicle,
      minimap: {
        map,
        draw: projection.drawRect,
        letterboxAccepted: letterbox ? app.minimap.handleClick(letterbox.x, letterbox.y) : null,
        nodeAccepted: app.minimap.handleClick(
          projection.points.get('test:one').x,
          projection.points.get('test:one').y,
        ),
      },
    };
  });
  const { chronicle, minimap } = layoutState;
  assert.ok(chronicle.tabs.y + chronicle.tabs.h <= chronicle.card.y);
  assert.ok(chronicle.card.y + chronicle.card.h <= chronicle.nav.y);
  assert.ok(chronicle.nav.y + chronicle.nav.h <= chronicle.modal.y + chronicle.modal.h);
  assert.ok(minimap.draw.x >= minimap.map.x);
  assert.ok(minimap.draw.y >= minimap.map.y);
  assert.ok(minimap.draw.x + minimap.draw.w <= minimap.map.x + minimap.map.w);
  assert.ok(minimap.draw.y + minimap.draw.h <= minimap.map.y + minimap.map.h);
  if (minimap.letterboxAccepted !== null) assert.equal(minimap.letterboxAccepted, false);
  assert.equal(minimap.nodeAccepted, true);
  assert.deepEqual(errors, []);
  await page.close();
}

async function verifyTallDesktop(context: BrowserContext): Promise<void> {
  const page = await readyPage(context);
  await page.keyboard.press('?');
  await page.waitForFunction(() => {
    const modal = (window as any).__OMM_APP__.helpModal;
    return modal.isModalOpen() && modal.modalRect.h > 0 && modal.joinRects.length === 2;
  });
  const state = await page.evaluate(() => {
    const app = (window as any).__OMM_APP__;
    return {
      modal: app.helpModal.modalRect,
      links: app.helpModal.joinRects,
    };
  });
  assert.equal(state.modal.h, 680);
  assert.equal(state.links.length, 2);
  assert.ok(state.links.every((link: any) => link.y + link.h <= state.modal.y + state.modal.h));
  await page.mouse.click(2, 567);
  await page.waitForFunction(() => !(window as any).__OMM_APP__.helpModal.isModalOpen());
  await page.close();
}

async function verifyFirstVisit(context: BrowserContext): Promise<void> {
  const page = await context.newPage();
  await page.goto(WEB_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean((window as any).__OMM_APP__));
  await page.keyboard.press('/');
  assert.equal(
    await page
      .locator('#omm-header-search-input')
      .evaluate((input) => input === document.activeElement),
    true,
  );
  await page.close();
}

await ensureServer(
  WEB_URL,
  ['bun', 'run', 'dev', '--', '--host', '127.0.0.1', '--port', '3000'],
  `${ROOT}apps/web`,
);
const browser = await chromium.launch({
  headless: process.env.UI_POLISH_HEADED !== '1',
  executablePath: '/usr/bin/google-chrome-stable',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--ozone-platform=wayland'],
});
try {
  for (const deviceScaleFactor of [1, 2]) {
    const portrait = await browser.newContext({
      viewport: { width: 360, height: 640 },
      deviceScaleFactor,
    });
    await verifyContext(portrait, 360, 640);
    await portrait.close();

    const landscape = await browser.newContext({
      viewport: { width: 640, height: 360 },
      deviceScaleFactor,
    });
    await verifyContext(landscape, 640, 360);
    await landscape.close();
  }
  const desktop = await browser.newContext({ viewport: { width: 1050, height: 1134 } });
  await verifyTallDesktop(desktop);
  await desktop.close();

  const firstVisit = await browser.newContext({ viewport: { width: 1050, height: 1134 } });
  await verifyFirstVisit(firstVisit);
  await firstVisit.close();
  console.log('UI polish E2E: pointer, shortcut, DPR, tall desktop, and first-visit checks passed');
} finally {
  await browser.close();
  for (const process of spawned) process.kill();
}
