import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import {
  chromium,
  firefox,
  type Browser,
  type BrowserContext,
  type BrowserType,
  type Page,
  type Route,
} from 'playwright';

const ROOT = new URL('..', import.meta.url).pathname;
const WEB_URL = 'http://127.0.0.1:3000';
const DENSE_ROOT_ID = 'award:dense-regression';
const DEFERRED_ROOT_ID = 'award:deferred-regression';
const PAGE_SIZE = 50;
const spawned: ReturnType<typeof Bun.spawn>[] = [];

interface MockState {
  denseRequests: URL[];
  pathRequests: URL[];
  releaseDeferred: (() => void) | null;
  pathResponses: PathPayload[];
}

interface PathPayload {
  found: boolean;
  nodes: ReturnType<typeof entity>[];
  edges: { source: string; target: string; predicate: string }[];
  hops: number;
  explanation: string;
}

function entity(id: string, type: string, name: string) {
  return {
    id,
    type,
    names: { labels: { zh: name, en: name }, aliases: {} },
    labels: { zh: name, en: name },
  };
}

function neighborhood(rootId: string, page: number, count: number, hasMore: boolean) {
  const root = entity(rootId, 'award', rootId === DENSE_ROOT_ID ? '密集奖项' : '延迟奖项');
  const neighbors = Array.from({ length: count }, (_, index) => {
    const ordinal = (page - 1) * PAGE_SIZE + index + 1;
    return entity(`${rootId}:work:${ordinal}`, 'work', `获奖推理作品 ${ordinal}`);
  });
  return {
    entity: root,
    neighbors,
    facts: neighbors.map((neighbor) => ({
      subject_id: neighbor.id,
      predicate: 'award',
      object_ref: rootId,
      source: neighbor.id,
      target: rootId,
    })),
    hasMore,
    nextCursor: hasMore ? `cursor-${page}` : undefined,
    total: rootId === DENSE_ROOT_ID ? PAGE_SIZE * 4 : count,
  };
}

function pathPayload(kind: 'found' | 'no-path' | 'budget'): PathPayload {
  const source = entity('wd:Q35610', 'author', '阿瑟·柯南·道尔');
  const target = entity('wd:Q347412', 'author', '江户川乱步');
  if (kind === 'found') {
    return {
      found: true,
      nodes: [source, target],
      edges: [{ source: source.id, target: target.id, predicate: 'influenced_by' }],
      hops: 1,
      explanation: '成功连通，共经过 1 条关系跳跃',
    };
  }
  return {
    found: false,
    nodes: [],
    edges: [],
    hops: -1,
    explanation:
      kind === 'budget'
        ? '关系网络过于庞大，已在安全搜索上限内停止，请尝试选择关联更紧密的实体'
        : '在限定跳数内未发现直接关联路径',
  };
}

async function ensureWebServer(): Promise<void> {
  try {
    if ((await fetch(WEB_URL)).ok) return;
  } catch {}
  spawned.push(
    Bun.spawn(['bun', 'run', 'dev', '--', '--host', '127.0.0.1', '--port', '3000'], {
      cwd: `${ROOT}apps/web`,
      stdout: 'ignore',
      stderr: 'ignore',
    }),
  );
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(WEB_URL)).ok) return;
    } catch {}
    await Bun.sleep(200);
  }
  throw new Error(`Web server did not become ready: ${WEB_URL}`);
}

async function fulfillJson(route: Route, body: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify(body),
  });
}

async function installApiMock(context: BrowserContext): Promise<MockState> {
  const state: MockState = {
    denseRequests: [],
    pathRequests: [],
    releaseDeferred: null,
    pathResponses: [pathPayload('found'), pathPayload('no-path'), pathPayload('budget')],
  };
  await context.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.startsWith('/api/')) {
      await route.fallback();
      return;
    }
    if (url.pathname === '/api/seeds') {
      await fulfillJson(route, {
        seeds: [
          entity('seed:one', 'author', '种子作家一'),
          entity('seed:two', 'author', '种子作家二'),
          entity('seed:three', 'author', '种子作家三'),
        ],
      });
      return;
    }
    if (url.pathname === '/api/nodes') {
      const ids = (url.searchParams.get('ids') || '').split(',').filter(Boolean);
      await fulfillJson(
        route,
        ids.map((id) => entity(id, 'author', id)),
      );
      return;
    }
    const neighborMatch = url.pathname.match(/^\/api\/entity\/(.+)\/neighbors$/);
    if (neighborMatch) {
      const id = decodeURIComponent(neighborMatch[1]!);
      if (id === DENSE_ROOT_ID) {
        state.denseRequests.push(url);
        const page = state.denseRequests.length;
        await fulfillJson(route, neighborhood(id, page, PAGE_SIZE, page < 4));
        return;
      }
      if (id === DEFERRED_ROOT_ID) {
        await new Promise<void>((resolve) => {
          state.releaseDeferred = resolve;
        });
        await fulfillJson(route, neighborhood(id, 1, 12, false));
        return;
      }
      await fulfillJson(route, neighborhood(id, 1, 0, false));
      return;
    }
    if (url.pathname === '/api/path') {
      state.pathRequests.push(url);
      const response = state.pathResponses.shift() || pathPayload('budget');
      await fulfillJson(route, response);
      return;
    }
    if (url.pathname === '/api/chronicles') {
      await fulfillJson(route, []);
      return;
    }
    if (url.pathname === '/api/stats') {
      await fulfillJson(route, { total: 203, byType: {}, facts: 212, awards: 2 });
      return;
    }
    if (url.pathname === '/api/search') {
      await fulfillJson(route, { query: url.searchParams.get('q') || '', results: [] });
      return;
    }
    await fulfillJson(route, {});
  });
  return state;
}

async function readyPage(context: BrowserContext): Promise<{ page: Page; errors: string[] }> {
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('omm-welcome-dismissed', '1');
  });
  await page.goto(WEB_URL, { waitUntil: 'domcontentloaded' });
  try {
    await page.waitForFunction(
      () => Boolean((window as any).__OMM_APP__?.viewport?.getNodes().length),
      undefined,
      { timeout: 10_000 },
    );
  } catch (error) {
    throw new Error(`App initialization failed: ${errors.join(' | ')}`, { cause: error });
  }
  await page.waitForTimeout(250);
  await page.evaluate(() => {
    const app = (window as any).__OMM_APP__;
    app.viewport.freeze(true);
    app.viewport.setCamera({
      panX: app.scene.width / 2,
      panY: app.scene.height / 2 + 32,
      zoom: 1,
    });
  });
  return { page, errors };
}

async function verifyPagination(page: Page, state: MockState): Promise<void> {
  await page.evaluate((rootId) => {
    const app = (window as any).__OMM_APP__;
    app.viewport.addManualNode({
      id: rootId,
      type: 'award',
      name: '密集奖项',
      labels: { zh: '密集奖项' },
      color: '#e2ad4b',
      val: 1,
    });
  }, DENSE_ROOT_ID);

  const additions: number[] = [];
  for (let action = 0; action < 4; action++) {
    const before = await page.evaluate(
      () => (window as any).__OMM_APP__.viewport.getNodes().length,
    );
    await page.evaluate(
      (rootId) => (window as any).__OMM_APP__.viewport.expandNode(rootId),
      DENSE_ROOT_ID,
    );
    const after = await page.evaluate(() => (window as any).__OMM_APP__.viewport.getNodes().length);
    additions.push(after - before);
  }
  await page.waitForTimeout(300);

  assert.equal(state.denseRequests.length, 4, 'four actions must issue exactly four requests');
  assert.deepEqual(additions, [50, 50, 50, 50], 'each action must add at most one API page');
  assert.deepEqual(
    state.denseRequests.map((url) => url.searchParams.get('limit')),
    ['50', '50', '50', '50'],
  );
  assert.deepEqual(
    state.denseRequests.map((url) => url.searchParams.get('cursor')),
    [null, 'cursor-1', 'cursor-2', 'cursor-3'],
  );
  assert.equal(
    await page.evaluate(
      (rootId) => (window as any).__OMM_APP__.viewport.canLoadMore(rootId),
      DENSE_ROOT_ID,
    ),
    false,
  );
}

async function verifyDeferredCenter(page: Page, state: MockState): Promise<void> {
  const movedCenter = await page.evaluate((rootId) => {
    const app = (window as any).__OMM_APP__;
    app.viewport.addManualNode({
      id: rootId,
      type: 'award',
      name: '延迟奖项',
      labels: { zh: '延迟奖项' },
      color: '#e2ad4b',
      val: 1,
    });
    const node = app.viewport.graph.getNode(rootId);
    (window as any).__DEFERRED_EXPANSION__ = app.viewport.expandNode(rootId);
    app.viewport.beginNodeDrag(rootId);
    const x = (node.x ?? 0) + 360;
    const y = (node.y ?? 0) - 190;
    app.viewport.updateNodeDrag(rootId, x, y);
    return { x, y };
  }, DEFERRED_ROOT_ID);
  await page.waitForFunction(
    (rootId) => (window as any).__OMM_APP__.viewport.isNodeLoading(rootId) === true,
    DEFERRED_ROOT_ID,
  );
  const deadline = Date.now() + 5_000;
  while (!state.releaseDeferred && Date.now() < deadline) await Bun.sleep(10);
  assert.ok(state.releaseDeferred, 'deferred neighbor request was not observed');
  state.releaseDeferred();
  await page.evaluate(() => (window as any).__DEFERRED_EXPANSION__);

  const initialLengths = await page.evaluate((rootId) => {
    const app = (window as any).__OMM_APP__;
    const center = app.viewport.graph.getNode(rootId);
    return app.viewport
      .getLinks()
      .filter((link: any) => link.source === rootId || link.target === rootId)
      .map((link: any) => {
        const otherId = link.source === rootId ? link.target : link.source;
        const other = app.viewport.graph.getNode(otherId);
        return Math.hypot(other.x - center.x, other.y - center.y);
      });
  }, DEFERRED_ROOT_ID);
  assert.equal(initialLengths.length, 12);
  assert.ok(
    initialLengths.every((length) => length >= 35 && length <= 90),
    initialLengths.join(','),
  );
  const resolvedCenter = await page.evaluate((rootId) => {
    const node = (window as any).__OMM_APP__.viewport.graph.getNode(rootId);
    return { x: node.x, y: node.y };
  }, DEFERRED_ROOT_ID);
  assert.ok(
    Math.hypot(resolvedCenter.x - movedCenter.x, resolvedCenter.y - movedCenter.y) < 0.01,
    `resolved center drifted from live center: ${JSON.stringify({ movedCenter, resolvedCenter })}`,
  );
  await page.evaluate(
    (rootId) => (window as any).__OMM_APP__.viewport.endNodeDrag(rootId),
    DEFERRED_ROOT_ID,
  );
}

async function verifyLongDrag(page: Page): Promise<void> {
  const result = await page.evaluate((rootId) => {
    const app = (window as any).__OMM_APP__;
    const graph = app.viewport.graph;
    const originalReheat = graph.reheat.bind(graph);
    let reheats = 0;
    graph.reheat = (alpha: number) => {
      reheats++;
      return originalReheat(alpha);
    };
    const start = graph.getNode(rootId);
    app.viewport.beginNodeDrag(rootId);
    for (let move = 1; move <= 160; move++) {
      app.viewport.updateNodeDrag(
        rootId,
        start.x + move * 3.2,
        start.y + Math.sin(move / 9) * 110 + move * 0.65,
      );
    }
    app.viewport.endNodeDrag(rootId);
    for (let frame = 0; frame < 600; frame++) graph.step();
    const center = graph.getNode(rootId);
    const lengths = app.viewport
      .getLinks()
      .filter((link: any) => link.source === rootId || link.target === rootId)
      .map((link: any) => {
        const other = graph.getNode(link.source === rootId ? link.target : link.source);
        return Math.hypot(other.x - center.x, other.y - center.y);
      })
      .sort((a: number, b: number) => a - b);
    const finite = app.viewport
      .getNodes()
      .every((node: any) => [node.x, node.y, node.vx ?? 0, node.vy ?? 0].every(Number.isFinite));
    return {
      finite,
      reheats,
      simulating: graph.isSimulating(),
      maxLength: lengths.at(-1),
      maxToMedian: lengths.at(-1) / lengths[Math.floor(lengths.length / 2)],
    };
  }, DEFERRED_ROOT_ID);
  assert.equal(result.finite, true);
  assert.equal(result.reheats, 2, 'drag should reheat only on begin and end, not on every move');
  assert.equal(result.simulating, false);
  assert.ok(result.maxLength < 500, `maximum incident link length ${result.maxLength}`);
  assert.ok(result.maxToMedian < 3.5, `maximum/median incident link ratio ${result.maxToMedian}`);
}

async function verifyLabels(page: Page): Promise<void> {
  const report = await page.evaluate(async () => {
    const app = (window as any).__OMM_APP__;
    app.scene.markDirty();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const badges = app.overlayLayer.nodeBadges.map((badge: any) => ({
      id: badge.id,
      x: badge.pillX,
      y: badge.pillY,
      w: badge.pillW,
      h: badge.pillH,
    }));
    const circles = app.viewport
      .getNodes()
      .filter((node: any) => Number.isFinite(node.sx) && Number.isFinite(node.sy))
      .map((node: any) => ({
        id: node.id,
        x: node.sx,
        y: node.sy,
        radius:
          (node.radius || (node.type === 'author' ? 12 : 7)) *
          Math.min(1.3, Math.max(0.65, app.viewport.zoom)),
      }));
    const overlaps: string[] = [];
    for (let i = 0; i < badges.length; i++) {
      const a = badges[i];
      for (let j = i + 1; j < badges.length; j++) {
        const b = badges[j];
        if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y) {
          overlaps.push(`${a.id}/${b.id}`);
        }
      }
      for (const circle of circles) {
        if (circle.id === a.id) continue;
        const closestX = Math.max(a.x, Math.min(circle.x, a.x + a.w));
        const closestY = Math.max(a.y, Math.min(circle.y, a.y + a.h));
        if (Math.hypot(circle.x - closestX, circle.y - closestY) < circle.radius) {
          overlaps.push(`${a.id}/circle:${circle.id}`);
        }
      }
    }
    const wrongOwners = badges
      .filter((badge: any) => {
        const owner = app.overlayLayer.getNodeAtScreenPoint(
          badge.x + badge.w / 2,
          badge.y + badge.h / 2,
        );
        return owner?.id !== badge.id;
      })
      .map((badge: any) => badge.id);
    return { count: badges.length, overlaps, wrongOwners };
  });
  assert.ok(report.count >= 8, `expected dense labels, received ${report.count}`);
  assert.deepEqual(report.overlaps, []);
  assert.deepEqual(report.wrongOwners, []);
}

async function verifyPathfinder(page: Page, state: MockState): Promise<void> {
  const kinds = ['found', 'no-path', 'budget'] as const;
  const expected = [
    '成功连通，共经过 1 条关系跳跃',
    '在限定跳数内未发现直接关联路径',
    '关系网络过于庞大，已在安全搜索上限内停止，请尝试选择关联更紧密的实体',
  ];
  for (let index = 0; index < kinds.length; index++) {
    const modalState = await page.evaluate(async () => {
      const modal = (window as any).__OMM_APP__.pathfinderModal;
      modal.open();
      modal.setSource('wd:Q35610', '阿瑟·柯南·道尔');
      modal.setTarget('wd:Q347412', '江户川乱步');
      await modal.executeSearch();
      return {
        loading: modal.searchLoading,
        found: modal.pathResult?.found,
        explanation: modal.pathResult?.explanation,
      };
    });
    assert.equal(modalState.loading, false, `${kinds[index]} remained loading`);
    assert.equal(modalState.found, index === 0);
    assert.equal(modalState.explanation, expected[index]);
    await page.evaluate(() => (window as any).__OMM_APP__.pathfinderModal.close());
  }

  assert.equal(state.pathRequests.length, 3);
  assert.ok(
    state.pathRequests.every(
      (url) =>
        url.searchParams.get('source') === 'wd:Q35610' &&
        url.searchParams.get('target') === 'wd:Q347412',
    ),
  );
  const reopened = await page.evaluate(() => {
    const modal = (window as any).__OMM_APP__.pathfinderModal;
    modal.open();
    const stateAfterOpen = {
      loading: modal.searchLoading,
      result: modal.pathResult,
      open: modal.isModalOpen(),
    };
    modal.close();
    return stateAfterOpen;
  });
  assert.deepEqual(reopened, { loading: false, result: null, open: true });
}

async function verifyContext(
  browser: Browser,
  browserName: string,
  deviceScaleFactor: number,
): Promise<void> {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor,
  });
  const mock = await installApiMock(context);
  const { page, errors } = await readyPage(context);
  try {
    await verifyPagination(page, mock);
    await verifyDeferredCenter(page, mock);
    await verifyLongDrag(page);
    await verifyLabels(page);
    await verifyPathfinder(page, mock);
    assert.deepEqual(errors, []);
    console.log(`Graph regression: ${browserName} DPR ${deviceScaleFactor} passed`);
  } finally {
    await context.close();
  }
}

async function launchBrowser(
  type: BrowserType,
  options: { executablePath?: string; args?: string[] } = {},
): Promise<Browser> {
  return type.launch({
    headless: process.env.GRAPH_REGRESSION_HEADED !== '1',
    ...options,
  });
}

await ensureWebServer();
try {
  const chrome = await launchBrowser(chromium, {
    executablePath: '/usr/bin/google-chrome-stable',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    for (const dpr of [1, 2]) await verifyContext(chrome, 'Chrome', dpr);
  } finally {
    await chrome.close();
  }

  const firefoxPath = firefox.executablePath();
  if (existsSync(firefoxPath)) {
    let firefoxBrowser: Browser | null = null;
    try {
      firefoxBrowser = await launchBrowser(firefox);
    } catch (error) {
      console.warn(`Graph regression: Firefox unavailable (${String(error)})`);
    }
    if (firefoxBrowser) {
      try {
        await verifyContext(firefoxBrowser, 'Firefox', 1);
      } finally {
        await firefoxBrowser.close();
      }
    }
  }
  console.log('Graph regression E2E: Issue #29 checks passed');
} finally {
  for (const process of spawned) process.kill();
}
