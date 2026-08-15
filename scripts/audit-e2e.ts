import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SCREENSHOTS_DIR = join(import.meta.dir, '../tmp/e2e');
if (!existsSync(SCREENSHOTS_DIR)) {
  mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

async function runAudit() {
  console.log('🎭 Starting Playwright End-to-End Visual & Interaction Audit for OMM...');

  const browser = await chromium.launch({
    headless: true,
    executablePath: '/usr/bin/google-chrome-stable',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      console.error(`  [Chrome Console Error]`, msg.text());
    }
  });

  page.on('pageerror', (err) => {
    console.error(`  [Chrome Page Exception]`, err.message);
  });

  // 1. Initial Landing Page Load
  console.log('1️⃣ Navigating to http://localhost:3000...');
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);

  await page.screenshot({ path: join(SCREENSHOTS_DIR, '01-landing.png') });
  console.log(`  ✓ Captured 01-landing screenshot`);

  // Verify canvas exists & app initialized
  const appState = await page.evaluate(() => {
    const app = (window as any).__OMM_APP__;
    if (!app) return { initialized: false, nodeCount: 0 };
    const entities = app.viewport?.getEntities() || [];
    return {
      initialized: true,
      nodeCount: entities.length,
      isDrawerOpen: app.drawer?.isDrawerOpen() || false,
    };
  });

  console.log(
    `  ✓ App State: Initialized = ${appState.initialized}, Loaded Nodes = ${appState.nodeCount}`,
  );

  // 2. Test Hovering a Node (e.g. index 0)
  console.log('2️⃣ Hovering a seed author node...');
  await page.evaluate(() => {
    const app = (window as any).__OMM_APP__;
    if (app && app.viewport) {
      const entities = app.viewport.getEntities();
      if (entities.length > 0) {
        app.overlayLayer.setHoveredEntity(entities[0]);
      }
    }
  });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: join(SCREENSHOTS_DIR, '02-node-hover.png') });
  console.log(`  ✓ Captured 02-node-hover screenshot`);

  // 3. Test Node Selection & Casefile Drawer
  console.log('3️⃣ Selecting a master author node (wd:Q347412 - Edogawa Ranpo)...');
  await page.evaluate(async () => {
    const app = (window as any).__OMM_APP__;
    if (app) {
      await app.handleSelectNode('wd:Q347412');
    }
  });
  await page.waitForTimeout(2000);

  await page.screenshot({ path: join(SCREENSHOTS_DIR, '03-casefile-drawer.png') });
  console.log(`  ✓ Captured 03-casefile-drawer screenshot`);

  const drawerState = await page.evaluate(() => {
    const app = (window as any).__OMM_APP__;
    return {
      isDrawerOpen: app.drawer?.isDrawerOpen(),
      nodeCount: app.viewport?.getEntities().length,
      drawerDetails: app.activeEntityDetails ? app.activeEntityDetails.entity.names.labels : null,
    };
  });
  console.log(
    `  ✓ Drawer Open = ${drawerState.isDrawerOpen}, Total Nodes after 1-Hop = ${drawerState.nodeCount}`,
  );

  // 4. Test Chronicle Trails
  console.log('4️⃣ Opening Chronicle Trails panel and navigating chapters...');
  await page.evaluate(async () => {
    const app = (window as any).__OMM_APP__;
    if (app) {
      await app.handleOpenChronicles();
    }
  });
  await page.waitForTimeout(1500);

  await page.screenshot({ path: join(SCREENSHOTS_DIR, '04-chronicle-panel.png') });
  console.log(`  ✓ Captured 04-chronicle-panel screenshot`);

  // 5. Test Pathfinder Modal
  console.log('5️⃣ Opening Pathfinder Modal and computing connection path...');
  await page.evaluate(async () => {
    const app = (window as any).__OMM_APP__;
    if (app) {
      app.chroniclePanel.close();
      app.pathfinderModal.open({ id: 'wd:Q347412', name: '江户川乱步' });
      app.pathfinderModal.setTarget('wd:Q35064', '阿加莎·克里斯蒂');
      await app.pathfinderModal.executeSearch();
    }
  });
  await page.waitForTimeout(1500);

  await page.screenshot({ path: join(SCREENSHOTS_DIR, '05-pathfinder-modal.png') });
  console.log(`  ✓ Captured 05-pathfinder-modal screenshot`);

  // 6. Test Highlighting Path on Graph
  console.log('6️⃣ Highlighting clue path on canvas graph...');
  await page.evaluate(() => {
    const app = (window as any).__OMM_APP__;
    if (app && app.pathfinderModal.pathResult?.found) {
      const res = app.pathfinderModal.pathResult;
      app.viewport.highlightPath(
        res.nodes.map((n: any) => n.id),
        res.edges,
      );
      app.pathfinderModal.close();
    }
  });
  await page.waitForTimeout(1500);

  await page.screenshot({ path: join(SCREENSHOTS_DIR, '06-highlighted-path.png') });
  console.log(`  ✓ Captured 06-highlighted-path screenshot`);

  await browser.close();
  console.log('\n🎉 Playwright Audit Finished Successfully! All screenshots saved in tmp/e2e/');
}

runAudit().catch((err) => {
  console.error('Audit failed:', err);
  process.exit(1);
});
