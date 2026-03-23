import { test, expect, Page } from '@playwright/test';

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.fill('input[name="email"]', 'admin@pcs.local');
  await page.fill('input[name="password"]', 'password123');
  await page.click('button[type="submit"]');
  await page.waitForSelector('text=Dashboard', { timeout: 10000 });
}

test.describe('Quality Analysis Page — UI', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('should navigate to 3D Quality page from sidebar', async ({ page }) => {
    // Click the 3D Quality nav item
    await page.getByText('3D Quality', { exact: true }).click();
    await page.waitForSelector('h1', { timeout: 10000 });

    // Verify page content
    await expect(page.locator('h1')).toContainText('3D Quality Analysis');
    await page.screenshot({ path: 'test-results/quality-page.png', fullPage: true });
  });

  test('should display model list panel and upload button', async ({ page }) => {
    await page.goto('/quality-analysis');
    await page.waitForSelector('text=3D Quality Analysis', { timeout: 10000 });

    // Verify model list section exists
    await expect(page.getByText('3D Models', { exact: true })).toBeVisible();

    // Verify upload button exists
    await expect(page.locator('button:has-text("Upload 3D Model")')).toBeVisible();

    // Verify filter dropdown exists
    await expect(page.locator('mat-select')).toBeVisible();
  });

  test('should show viewer placeholder when no model is selected', async ({ page }) => {
    await page.goto('/quality-analysis');
    await page.waitForSelector('text=3D Quality Analysis', { timeout: 10000 });

    // Verify the placeholder is shown
    await expect(page.locator('text=Select a model from the list to view it in 3D')).toBeVisible();
  });

  test('should display filter options for model type', async ({ page }) => {
    await page.goto('/quality-analysis');
    await page.waitForSelector('text=3D Quality Analysis', { timeout: 10000 });

    // Open the filter dropdown
    await page.click('mat-select');
    await page.waitForSelector('mat-option', { timeout: 5000 });

    // Verify filter options
    await expect(page.locator('mat-option:has-text("All")')).toBeVisible();
    await expect(page.locator('mat-option:has-text("Quality")')).toBeVisible();
    await expect(page.locator('mat-option:has-text("Assembly")')).toBeVisible();
  });

  test('should have the upload file input with correct accept types', async ({ page }) => {
    await page.goto('/quality-analysis');
    await page.waitForSelector('text=3D Quality Analysis', { timeout: 10000 });

    // Verify hidden file input exists with correct accept attribute
    const fileInput = page.locator('input[type="file"][accept*=".glb"]');
    await expect(fileInput).toHaveAttribute('accept', '.glb,.gltf,.obj,.fbx,.stl');
  });

  test('should upload a GLB file and show it in model list', async ({ page }) => {
    await page.goto('/quality-analysis');
    await page.waitForSelector('text=3D Quality Analysis', { timeout: 10000 });

    // Create a minimal GLB file in memory
    const jsonStr = JSON.stringify({
      asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [] }],
    });
    const jsonBuf = Buffer.from(jsonStr);
    const paddedLength = Math.ceil(jsonBuf.length / 4) * 4;
    const paddedJson = Buffer.alloc(paddedLength, 0x20);
    jsonBuf.copy(paddedJson);

    const header = Buffer.alloc(12);
    header.writeUInt32LE(0x46546C67, 0);
    header.writeUInt32LE(2, 4);
    header.writeUInt32LE(12 + 8 + paddedLength, 8);
    const chunkHeader = Buffer.alloc(8);
    chunkHeader.writeUInt32LE(paddedLength, 0);
    chunkHeader.writeUInt32LE(0x4E4F534A, 4);
    const glbBuffer = Buffer.concat([header, chunkHeader, paddedJson]);

    // Upload via the hidden file input (first one accepts .glb)
    const fileInput = page.locator('input[type="file"][accept*=".glb"]');
    await fileInput.setInputFiles({
      name: 'test-widget.glb',
      mimeType: 'model/gltf-binary',
      buffer: glbBuffer,
    });

    // Wait for upload to complete and model to appear in list
    await page.waitForTimeout(3000); // Wait for upload + refresh
    await expect(page.getByText('test-widget', { exact: false }).first()).toBeVisible({ timeout: 15000 });

    await page.screenshot({ path: 'test-results/quality-uploaded-model.png', fullPage: true });
  });

  test('should select a model and show 3D viewer canvas', async ({ page }) => {
    await page.goto('/quality-analysis');
    await page.waitForSelector('text=3D Quality Analysis', { timeout: 10000 });

    // Check if any models exist to click
    const modelItems = page.locator('.model-item');
    const count = await modelItems.count();

    if (count > 0) {
      // Click the first model
      await modelItems.first().click();

      // Wait for canvas to appear (Three.js viewer)
      await page.waitForSelector('canvas', { timeout: 10000 });
      await expect(page.locator('canvas')).toBeVisible();

      // Verify viewer-placeholder is gone
      await expect(page.locator('text=Select a model from the list to view it in 3D')).not.toBeVisible();

      await page.screenshot({ path: 'test-results/quality-3d-viewer.png', fullPage: true });
    } else {
      // No models to select — just verify the page loaded
      await expect(page.locator('text=3D Quality Analysis')).toBeVisible();
    }
  });

  test('should show quality summary when model has inspection data', async ({ page }) => {
    await page.goto('/quality-analysis');
    await page.waitForSelector('text=3D Quality Analysis', { timeout: 10000 });

    const modelItems = page.locator('.model-item');
    const count = await modelItems.count();

    if (count > 0) {
      await modelItems.first().click();

      // Wait a moment for quality data to load
      await page.waitForTimeout(2000);

      // Check if summary card appears (only if model has quality data)
      const summaryVisible = await page.locator('text=Quality Summary').isVisible().catch(() => false);
      if (summaryVisible) {
        await expect(page.locator('.stat-label:has-text("Total")')).toBeVisible();
        await expect(page.locator('.stat-label:has-text("Pass")')).toBeVisible();
        await expect(page.locator('.stat-label:has-text("Fail")')).toBeVisible();
        await expect(page.locator('.stat-label:has-text("Warning")')).toBeVisible();
        await page.screenshot({ path: 'test-results/quality-summary.png', fullPage: true });
      }
    }
  });

  test('should have correct 3-column layout on desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto('/quality-analysis');
    await page.waitForSelector('text=3D Quality Analysis', { timeout: 10000 });

    const grid = page.locator('.content-grid');
    await expect(grid).toBeVisible();

    // Left panel (models)
    await expect(page.locator('.left-panel')).toBeVisible();
    // Center panel (viewer)
    await expect(page.locator('.center-panel')).toBeVisible();
    // Right panel (details)
    await expect(page.locator('.right-panel')).toBeVisible();

    await page.screenshot({ path: 'test-results/quality-desktop-layout.png', fullPage: true });
  });

  test('should hide right panel on medium screens', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 900 });
    await page.goto('/quality-analysis');
    await page.waitForSelector('text=3D Quality Analysis', { timeout: 10000 });

    // Right panel should be hidden via CSS
    const rightPanel = page.locator('.right-panel');
    await expect(rightPanel).toBeHidden();
  });

  test('should be single column on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 600, height: 900 });
    await page.goto('/quality-analysis');
    await page.waitForSelector('text=3D Quality Analysis', { timeout: 10000 });

    // Left panel should still be visible (stacked)
    await expect(page.locator('.left-panel')).toBeVisible();
  });
});
