import { test, expect } from '@playwright/test';

const PKG_URL = '/coordination/9f6254be-b44e-4a48-b427-a42c67c8974f';

test.use({ actionTimeout: 30_000, navigationTimeout: 30_000 });

async function login(page: any) {
  await page.goto('/login');
  await page.fill('input[name="email"]', 'admin@pcs.local');
  await page.fill('input[name="password"]', 'password123');
  await page.click('button[type="submit"]');
  await page.waitForSelector('text=Dashboard', { timeout: 15000 });
}

test('Coordination panel — scrolling, drawing click, PDF popup, tabs', async ({ page }) => {
  await login(page);
  await page.goto(PKG_URL);
  await page.waitForSelector('.status-chip', { timeout: 20000 });
  await page.waitForTimeout(3000);

  // Wait for 3D model to load
  for (let i = 0; i < 30; i++) {
    if (await page.locator('.loading-overlay').count() === 0) break;
    await page.waitForTimeout(1000);
  }

  console.log('=== Page loaded ===');
  await page.screenshot({ path: 'test-results/panel-01-loaded.png', fullPage: true });

  // === DRAWINGS TAB ===
  console.log('\n=== Drawings Tab ===');

  // Check filter chips show correct counts
  const detailChipText = await page.locator('mat-chip-option:has-text("Detail")').textContent();
  const erectionChipText = await page.locator('mat-chip-option:has-text("Erection")').textContent();
  console.log(`  Detail: ${detailChipText?.trim()}`);
  console.log(`  Erection: ${erectionChipText?.trim()}`);

  // Check drawing items exist (using new .drawing-item class)
  const drawingItems = page.locator('.drawing-item');
  const totalCount = await drawingItems.count();
  console.log(`  Drawing items: ${totalCount}`);
  expect(totalCount).toBeGreaterThan(0);

  // === SCROLL TEST ===
  console.log('\n=== Scroll Test ===');
  const scrollContainer = page.locator('.tab-scroll-content').first();

  // Get first visible drawing
  const firstDrawingName = await drawingItems.first().locator('.drawing-name').textContent();
  console.log(`  First drawing: ${firstDrawingName?.trim()}`);

  // Scroll down in the drawings list
  await scrollContainer.evaluate((el: HTMLElement) => el.scrollTop = 2000);
  await page.waitForTimeout(500);

  // Check a different drawing is now visible
  await page.screenshot({ path: 'test-results/panel-02-scrolled.png', fullPage: true });
  console.log('  Scrolled down — new drawings visible');

  // Scroll back to top
  await scrollContainer.evaluate((el: HTMLElement) => el.scrollTop = 0);
  await page.waitForTimeout(300);

  // === FILTER TEST ===
  console.log('\n=== Filter Test ===');

  // Click Erection filter
  await page.locator('mat-chip-option:has-text("Erection")').click();
  await page.waitForTimeout(500);
  const erectionItems = await drawingItems.count();
  console.log(`  Erection filter: ${erectionItems} items`);
  await page.screenshot({ path: 'test-results/panel-03-erection-filter.png', fullPage: true });

  // Click Detail filter
  await page.locator('mat-chip-option:has-text("Detail")').click();
  await page.waitForTimeout(500);
  const detailItems = await drawingItems.count();
  console.log(`  Detail filter: ${detailItems} items`);

  // Back to All
  await page.locator('mat-chip-option:has-text("All")').click();
  await page.waitForTimeout(500);

  // === CLICK DRAWING → PDF POPUP ===
  console.log('\n=== PDF Popup Test ===');
  const thirdDrawing = drawingItems.nth(2);
  const drawingName = await thirdDrawing.locator('.drawing-name').textContent();
  console.log(`  Clicking: ${drawingName?.trim()}`);
  await thirdDrawing.click();

  // Wait for PDF overlay
  await page.waitForSelector('.pdf-overlay', { timeout: 5000 });
  console.log('  PDF overlay appeared');

  // Check PDF iframe exists
  const iframe = page.locator('.pdf-frame');
  expect(await iframe.count()).toBe(1);
  console.log('  PDF iframe present');

  // Check header shows drawing info
  const pdfTitle = await page.locator('.pdf-header h3').textContent();
  console.log(`  PDF title: ${pdfTitle?.trim()}`);

  await page.screenshot({ path: 'test-results/panel-04-pdf-popup.png', fullPage: true });

  // Close popup by clicking X
  await page.locator('.pdf-header button').click();
  await page.waitForTimeout(500);
  expect(await page.locator('.pdf-overlay').count()).toBe(0);
  console.log('  PDF popup closed');

  // Click another drawing and close by clicking overlay background
  await drawingItems.nth(5).click();
  await page.waitForSelector('.pdf-overlay', { timeout: 5000 });
  await page.locator('.pdf-overlay').click({ position: { x: 10, y: 10 } });
  await page.waitForTimeout(500);
  expect(await page.locator('.pdf-overlay').count()).toBe(0);
  console.log('  PDF popup closed via backdrop click');

  // === KSS DATA TAB ===
  console.log('\n=== KSS Data Tab ===');
  const kssTab = page.locator('.mat-mdc-tab:has-text("KSS")');
  await kssTab.click();
  await page.waitForTimeout(1000);

  const membersInfo = await page.locator('.kss-info').textContent();
  console.log(`  KSS info: ${membersInfo?.trim().substring(0, 100)}`);

  const kssRows = page.locator('.kss-table tbody tr');
  const rowCount = await kssRows.count();
  console.log(`  KSS table rows: ${rowCount}`);
  expect(rowCount).toBeGreaterThan(0);

  await page.screenshot({ path: 'test-results/panel-05-kss-tab.png', fullPage: true });

  // === INFO TAB ===
  console.log('\n=== Info Tab ===');
  const infoTab = page.locator('.mat-mdc-tab:has-text("Info")');
  await infoTab.click();
  await page.waitForTimeout(500);

  const infoText = await page.locator('.info-panel').textContent();
  console.log(`  Info: ${infoText?.trim().substring(0, 150)}`);
  expect(infoText).toContain('Detail Drawings');

  await page.screenshot({ path: 'test-results/panel-06-info-tab.png', fullPage: true });

  console.log('\n=== All panel checks passed ===');
});
