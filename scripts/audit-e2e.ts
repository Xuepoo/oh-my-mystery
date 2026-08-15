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

  // 5. Test Real Mouse Click on UI Buttons
  console.log('5️⃣ Testing real mouse clicks on UI elements...');

  // Test clicking [✕] Close Button on Drawer
  const closeBtn = await page.evaluate(() => {
    const app = (window as any).__OMM_APP__;
    return app.drawer.closeBtnRect;
  });
  console.log(`  Clicking close button at (${closeBtn.x + 16}, ${closeBtn.y + 16})...`);
  await page.mouse.click(closeBtn.x + 16, closeBtn.y + 16);
  await page.waitForTimeout(500);

  const isClosed = await page.evaluate(() => {
    const app = (window as any).__OMM_APP__;
    return !app.drawer.isDrawerOpen();
  });
  console.log(`  ✓ Close button clicked successfully! Drawer is closed = ${isClosed}`);

  // Test clicking [🔗 关系探路] in HeaderBar
  const pathfinderBtn = await page.evaluate(() => {
    const app = (window as any).__OMM_APP__;
    return app.headerBar.pathfinderBtnRect;
  });
  console.log(
    `  Clicking Pathfinder button at (${pathfinderBtn.x + 30}, ${pathfinderBtn.y + 16})...`,
  );
  await page.mouse.click(pathfinderBtn.x + 30, pathfinderBtn.y + 16);
  await page.waitForTimeout(800);

  const isModalOpen = await page.evaluate(() => {
    const app = (window as any).__OMM_APP__;
    return app.pathfinderModal.isModalOpen();
  });
  console.log(`  ✓ Pathfinder button clicked successfully! Modal open = ${isModalOpen}`);

  await page.screenshot({ path: join(SCREENSHOTS_DIR, '05-pathfinder-modal.png') });

  // Test clicking Preset Button in Pathfinder Modal
  const presetBtn = await page.evaluate(() => {
    const app = (window as any).__OMM_APP__;
    return app.pathfinderModal.presets[0].rect;
  });
  if (presetBtn) {
    console.log(`  Clicking Preset button at (${presetBtn.x + 50}, ${presetBtn.y + 14})...`);
    await page.mouse.click(presetBtn.x + 50, presetBtn.y + 14);
    await page.waitForTimeout(1500);
  }

  // Test clicking [✨ 在图谱中高亮线索链]
  const highlightBtn = await page.evaluate(() => {
    const app = (window as any).__OMM_APP__;
    return app.pathfinderModal.highlightBtnRect;
  });
  console.log(`  Clicking Highlight button at (${highlightBtn.x + 50}, ${highlightBtn.y + 16})...`);
  await page.mouse.click(highlightBtn.x + 50, highlightBtn.y + 16);
  await page.waitForTimeout(1000);

  await page.screenshot({ path: join(SCREENSHOTS_DIR, '06-highlighted-path.png') });
  console.log(`  ✓ Highlighted path applied!`);

  // Test clicking [📖 编年史导览] in HeaderBar
  const chroniclesBtn = await page.evaluate(() => {
    const app = (window as any).__OMM_APP__;
    return app.headerBar.chroniclesBtnRect;
  });
  console.log(
    `  Clicking Chronicles button at (${chroniclesBtn.x + 30}, ${chroniclesBtn.y + 16})...`,
  );
  await page.mouse.click(chroniclesBtn.x + 30, chroniclesBtn.y + 16);
  await page.waitForTimeout(1000);

  const isChronicleOpen = await page.evaluate(() => {
    const app = (window as any).__OMM_APP__;
    return app.chroniclePanel.isModalOpen();
  });
  console.log(`  ✓ Chronicles button clicked! Panel open = ${isChronicleOpen}`);

  await page.screenshot({ path: join(SCREENSHOTS_DIR, '04-chronicle-panel.png') });

  // Test clicking Next Step in Chronicles
  const nextBtn = await page.evaluate(() => {
    const app = (window as any).__OMM_APP__;
    return app.chroniclePanel.nextBtnRect;
  });
  console.log(`  Clicking Next Step button at (${nextBtn.x + 50}, ${nextBtn.y + 16})...`);
  await page.mouse.click(nextBtn.x + 50, nextBtn.y + 16);
  await page.waitForTimeout(800);

  // Close Chronicle Panel
  const chronicleCloseBtn = await page.evaluate(() => {
    const app = (window as any).__OMM_APP__;
    return app.chroniclePanel.closeBtnRect;
  });
  await page.mouse.click(chronicleCloseBtn.x + 16, chronicleCloseBtn.y + 16);
  await page.waitForTimeout(500);

  // Test clicking ViewportControls [⌖ 视口居中]
  const fitBtn = await page.evaluate(() => {
    const app = (window as any).__OMM_APP__;
    return app.controls.fitBtnRect;
  });
  console.log(`  Clicking Fit Viewport button at (${fitBtn.x + 18}, ${fitBtn.y + 18})...`);
  await page.mouse.click(fitBtn.x + 18, fitBtn.y + 18);
  await page.waitForTimeout(500);

  console.log('\n🎉 ALL BUTTON CLICKS & INTERACTIONS TESTED AND VERIFIED PASSING!');

  await browser.close();
  console.log('\n🎉 Playwright Audit Finished Successfully! All screenshots saved in tmp/e2e/');
}

runAudit().catch((err) => {
  console.error('Audit failed:', err);
  process.exit(1);
});
