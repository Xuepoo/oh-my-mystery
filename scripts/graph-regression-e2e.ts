import assert from 'node:assert/strict';
import { chromium, type Page } from 'playwright';

const ROOT = new URL('..', import.meta.url).pathname;
const WEB_URL = 'http://localhost:3000';
const API_URL = 'http://localhost:8787/api/health';
const spawned: ReturnType<typeof Bun.spawn>[] = [];

async function ensureServer(url: string, command: string[], cwd: string): Promise<void> {
  try {
    const response = await fetch(url);
    if (response.ok) return;
  } catch {}

  spawned.push(Bun.spawn(command, { cwd, stdout: 'ignore', stderr: 'ignore' }));
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await Bun.sleep(200);
  }
  throw new Error(`Server did not become ready: ${url}`);
}

async function reset(page: Page, width = 1280, height = 800): Promise<void> {
  await page.setViewportSize({ width, height });
  await page.goto(WEB_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() =>
    Boolean((window as any).__OMM_APP__?.viewport?.getNodes().length),
  );
  // Startup schedules three seed expansions shortly after initialization.
  // Capture baselines only after those requests and the graph settle.
  await page.waitForFunction(() => (window as any).__OMM_APP__.viewport.getLinks().length > 0);
  await page.waitForTimeout(2_000);
  await page.evaluate(() => {
    const app = (window as any).__OMM_APP__;
    app.viewport.freeze(true);
    app.scene.markDirty();
  });
}

async function getTouchTarget(page: Page): Promise<{ id: string; x: number; y: number }> {
  return page.evaluate(() => {
    const app = (window as any).__OMM_APP__;
    const node = app.viewport
      .getNodes()
      .find(
        (candidate: any) =>
          !app.viewport.isNodeExpanded(candidate.id) &&
          candidate.sx > 120 &&
          candidate.sx < app.scene.width - 120 &&
          candidate.sy > 140 &&
          candidate.sy < app.scene.height - 120 &&
          !app.isEventOverUI(candidate.sx, candidate.sy) &&
          !app.welcomeLayer.isPointInside(candidate.sx, candidate.sy),
      );
    if (!node) throw new Error('No unobstructed graph node found');
    return { id: node.id, x: node.sx, y: node.sy };
  });
}

async function touch(
  page: Page,
  type: string,
  pointerId: number,
  x: number,
  y: number,
): Promise<void> {
  await page.evaluate(
    ({ type, pointerId, x, y }) => {
      const canvas = document.getElementById('app-canvas')!;
      canvas.dispatchEvent(
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

async function tap(page: Page, pointerId: number, x: number, y: number): Promise<void> {
  await touch(page, 'pointerdown', pointerId, x, y);
  await touch(page, 'pointerup', pointerId, x, y);
}

async function run(): Promise<void> {
  await ensureServer(API_URL, ['bun', 'src/server.ts'], `${ROOT}apps/api`);
  await ensureServer(
    WEB_URL,
    ['bun', 'run', 'dev', '--', '--host', '127.0.0.1', '--port', '3000'],
    `${ROOT}apps/web`,
  );

  const browser = await chromium.launch({
    headless: true,
    executablePath: '/usr/bin/google-chrome-stable',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.addInitScript(() => {
    localStorage.setItem('omm-welcome-dismissed', '1');
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          (window as any).__COPIED_TEXT__ = value;
        },
      },
    });
  });

  try {
    await reset(page);
    const target = await getTouchTarget(page);
    const beforeTap = await page.evaluate((id) => {
      const app = (window as any).__OMM_APP__;
      const node = app.viewport.graph.getNode(id);
      return { x: node.x, y: node.y };
    }, target.id);
    const casefileRequests: string[] = [];
    const recordCasefileRequest = (request: { url(): string }) => {
      if (/\/api\/entity\/.*\/(profile|relations|recommendations)/.test(request.url())) {
        casefileRequests.push(request.url());
      }
    };
    page.on('request', recordCasefileRequest);
    await tap(page, 1, target.x, target.y);
    await page.waitForFunction(
      (id) => (window as any).__OMM_APP__.drawer.session.entityId === id,
      target.id,
    );
    await page.waitForFunction(
      () => (window as any).__OMM_APP__.drawer.session.profile.status === 'ready',
    );
    assert.equal(
      await page.evaluate(() => (window as any).__OMM_APP__.drawer.session.entityId),
      target.id,
    );
    assert.deepEqual(
      await page.evaluate((id) => {
        const node = (window as any).__OMM_APP__.viewport.graph.getNode(id);
        return { x: node.x, y: node.y };
      }, target.id),
      beforeTap,
    );
    assert.equal(casefileRequests.filter((url) => url.endsWith('/profile')).length, 1);
    assert.equal(
      casefileRequests.some((url) => url.includes('/relations')),
      false,
    );
    assert.equal(
      casefileRequests.some((url) => url.includes('/recommendations')),
      false,
    );

    const firstCopyTarget = await page.evaluate(() => {
      const target = (window as any).__OMM_APP__.drawer.copyTargets[0];
      return { x: target.x + target.w / 2, y: target.y + target.h / 2, value: target.copyValue };
    });
    await tap(page, 2, firstCopyTarget.x, firstCopyTarget.y);
    await page.waitForFunction(
      (value) => (window as any).__COPIED_TEXT__ === value,
      firstCopyTarget.value,
    );

    const relationsTab = await page.evaluate(() => {
      const tab = (window as any).__OMM_APP__.drawer.tabRects.find(
        (candidate: any) => candidate.tab === 'relations',
      ).rect;
      return { x: tab.x + tab.w / 2, y: tab.y + tab.h / 2 };
    });
    await tap(page, 3, relationsTab.x, relationsTab.y);
    await page.waitForFunction(
      () => (window as any).__OMM_APP__.drawer.session.relations.status === 'ready',
    );
    assert.equal(casefileRequests.filter((url) => url.includes('/relations')).length, 1);
    page.off('request', recordCasefileRequest);

    await reset(page);
    const doubleTarget = await getTouchTarget(page);
    const beforeExpanded = await page.evaluate(
      (id) => (window as any).__OMM_APP__.viewport.isNodeExpanded(id),
      doubleTarget.id,
    );
    for (let i = 0; i < 2; i++) {
      await tap(page, 10 + i, doubleTarget.x, doubleTarget.y);
      await page.waitForTimeout(90);
    }
    await page.waitForFunction(
      ({ id, before }) => (window as any).__OMM_APP__.viewport.isNodeExpanded(id) !== before,
      { id: doubleTarget.id, before: beforeExpanded },
    );

    await reset(page);
    const longTarget = await getTouchTarget(page);
    await touch(page, 'pointerdown', 20, longTarget.x, longTarget.y);
    await page.waitForTimeout(620);
    assert.equal(
      await page.evaluate(() => (window as any).__OMM_APP__.radialMenu.isMenuOpen()),
      true,
    );
    await touch(page, 'pointerup', 20, longTarget.x, longTarget.y);
    assert.equal(
      await page.evaluate(() => Boolean((window as any).__OMM_APP__.pendingNodeClick)),
      false,
    );

    await reset(page);
    const cancelTarget = await getTouchTarget(page);
    await touch(page, 'pointerdown', 30, cancelTarget.x, cancelTarget.y);
    await touch(page, 'pointerdown', 31, cancelTarget.x + 80, cancelTarget.y);
    await page.waitForTimeout(620);
    assert.equal(
      await page.evaluate(() => (window as any).__OMM_APP__.radialMenu.isMenuOpen()),
      false,
    );
    await touch(page, 'pointerup', 31, cancelTarget.x + 80, cancelTarget.y);
    await touch(page, 'pointerup', 30, cancelTarget.x, cancelTarget.y);

    await reset(page);
    const state = await page.evaluate(async () => {
      const app = (window as any).__OMM_APP__;
      const baseline = {
        nodes: app.viewport.getNodes().length,
        links: app.viewport.getLinks().length,
      };
      const candidates = app.viewport
        .getNodes()
        .filter((node: any) => !app.viewport.isNodeExpanded(node.id))
        .slice(0, 2);
      for (const node of candidates) await app.toggleNodeExpansion(node.id);
      const historyAfterExpand = app.expansionHistory.length;
      app.undoLastExpansion();
      await new Promise((resolve) => setTimeout(resolve, 100));
      app.undoLastExpansion();
      await new Promise((resolve) => setTimeout(resolve, 100));
      const restored = {
        nodes: app.viewport.getNodes().length,
        links: app.viewport.getLinks().length,
        history: app.expansionHistory.length,
      };

      const hidden = app.viewport.getNodes()[0];
      app.viewport.hideNode(hidden.id);
      const hiddenCount = app.viewport.getHiddenNodes().length;
      app.viewport.restoreNode(hidden.id);

      const boundedStart = app.viewport
        .getNodes()
        .find((node: any) => !app.viewport.isNodeExpanded(node.id));
      const beforeBounded = app.viewport.getNodes().length;
      await app.viewport.expandBounded(boundedStart.id, 2, 40);
      return {
        baseline,
        historyAfterExpand,
        restored,
        hiddenCount,
        hiddenAfterRestore: app.viewport.getHiddenNodes().length,
        boundedAdded: app.viewport.getNodes().length - beforeBounded,
      };
    });
    assert.equal(state.historyAfterExpand, 2);
    assert.deepEqual(state.restored, { ...state.baseline, history: 0 });
    assert.equal(state.hiddenCount, 1);
    assert.equal(state.hiddenAfterRestore, 0);
    assert.ok(state.boundedAdded <= 40);

    await reset(page, 390, 844);
    const mobileTargets = await page.evaluate(() => {
      const app = (window as any).__OMM_APP__;
      return {
        relation: app.relationshipFilterBar.toggleRect,
        stats: app.graphStatsPanel.toggleRect,
      };
    });
    assert.ok(mobileTargets.relation.w >= 44 && mobileTargets.relation.h >= 44);
    assert.ok(mobileTargets.stats.w >= 44 && mobileTargets.stats.h >= 44);
    assert.deepEqual(errors, []);
    console.log('Graph regression E2E: 14 checks passed');
  } finally {
    await browser.close();
    for (const process of spawned) process.kill();
  }
}

await run();
