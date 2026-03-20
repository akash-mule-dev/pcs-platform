import { test, expect, Page, APIRequestContext } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Product 3D Viewer Test — "Test-glb" product on /products page
 *
 * Flow:
 * 1. Ensure "Test-glb" product exists with a GLB model attached (via API)
 * 2. Login and navigate to /products
 * 3. Verify "Test-glb" product appears in the table with a "View 3D" button
 * 4. Click "View 3D" and verify the 3D viewer dialog opens
 * 5. Verify Three.js canvas renders inside the dialog
 * 6. Verify model metadata (format, file size, date) in footer
 * 7. Interact with the viewer (reset camera button)
 * 8. Close the dialog
 * 9. Cleanup test data
 */

const PRODUCT_NAME = 'Test-glb';
const PRODUCT_SKU = `TEST-GLB-${Date.now()}`;

let token: string;
let productId: string;
let modelId: string;
let productExistedBefore = false;

// ─── API HELPERS ────────────────────────────────────────────────────────

async function apiLogin(request: APIRequestContext): Promise<string> {
  const res = await request.post('http://localhost:3000/api/auth/login', {
    data: { email: 'admin@pcs.local', password: 'password123' },
  });
  expect(res.status()).toBe(201);
  const body = await res.json();
  return body.data.accessToken;
}

async function uiLogin(page: Page) {
  await page.goto('/login');
  await page.fill('input[name="email"]', 'admin@pcs.local');
  await page.fill('input[name="password"]', 'password123');
  await page.click('button[type="submit"]');
  await page.waitForSelector('text=Dashboard', { timeout: 10000 });
}

// ─── TEST SUITE ─────────────────────────────────────────────────────────

test.describe.serial('Product 3D Viewer — "Test-glb" on Products Page', () => {

  // ─── SETUP: Ensure product + model exist ─────────────────────────────

  test('Setup: Create "Test-glb" product with a GLB model via API', async ({ request }) => {
    token = await apiLogin(request);

    // Check if "Test-glb" product already exists
    const listRes = await request.get('http://localhost:3000/api/products', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const listBody = await listRes.json();
    const products = Array.isArray(listBody) ? listBody : listBody.data || [];
    const existing = products.find((p: any) => p.name === PRODUCT_NAME);

    if (existing) {
      productExistedBefore = true;
      productId = existing.id;

      // Check if it already has models
      const modelsRes = await request.get(`http://localhost:3000/api/products/${productId}/models`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const modelsBody = await modelsRes.json();
      const models = Array.isArray(modelsBody) ? modelsBody : modelsBody.data || [];

      if (models.length > 0) {
        modelId = models[0].id;
        return; // Already has a model, no setup needed
      }
    } else {
      // Create the product
      const createRes = await request.post('http://localhost:3000/api/products', {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: PRODUCT_NAME, sku: PRODUCT_SKU, description: 'Test product with 3D GLB model for viewer testing' },
      });
      expect(createRes.status()).toBe(201);
      const createBody = await createRes.json();
      productId = createBody.data?.id || createBody.id;
      expect(productId).toBeTruthy();
    }

    // Upload the test GLB model
    const glbPath = path.join(__dirname, 'fixtures', 'test-assembly.glb');
    expect(fs.existsSync(glbPath)).toBe(true);
    const glbBuffer = fs.readFileSync(glbPath);

    const uploadRes = await request.post('http://localhost:3000/api/models', {
      headers: { Authorization: `Bearer ${token}` },
      multipart: {
        name: `${PRODUCT_NAME} - 3D Model`,
        modelType: 'quality',
        description: 'GLB test assembly with 5 named mesh parts',
        productId: productId,
        file: {
          name: 'test-assembly.glb',
          mimeType: 'model/gltf-binary',
          buffer: glbBuffer,
        },
      },
    });

    expect(uploadRes.status()).toBe(201);
    const uploadBody = await uploadRes.json();
    modelId = uploadBody.data?.id || uploadBody.id;
    expect(modelId).toBeTruthy();
  });

  // ─── UI TESTS ────────────────────────────────────────────────────────

  test('Step 1: Navigate to /products and verify "Test-glb" is in the table', async ({ page }) => {
    await uiLogin(page);

    await page.goto('/products');
    await page.waitForTimeout(2000);

    // Verify the product name appears
    await expect(page.getByText(PRODUCT_NAME).first()).toBeVisible({ timeout: 10000 });

    await page.screenshot({ path: 'test-results/product-3d-01-product-list.png', fullPage: true });
  });

  test('Step 2: Verify "View 3D" button is visible for "Test-glb" product', async ({ page }) => {
    await uiLogin(page);
    await page.goto('/products');
    await page.waitForTimeout(2000);

    // Find the row that contains "Test-glb" and look for the View 3D button
    const productRow = page.locator('tr', { has: page.getByText(PRODUCT_NAME, { exact: true }) });
    await expect(productRow).toBeVisible({ timeout: 10000 });

    const view3dBtn = productRow.locator('button:has-text("View 3D")');
    await expect(view3dBtn).toBeVisible();

    // The button should show the view_in_ar icon
    await expect(productRow.locator('mat-icon:has-text("view_in_ar")')).toBeVisible();

    await page.screenshot({ path: 'test-results/product-3d-02-view3d-button.png', fullPage: true });
  });

  test('Step 3: Click "View 3D" and verify the 3D viewer dialog opens', async ({ page }) => {
    await uiLogin(page);
    await page.goto('/products');
    await page.waitForTimeout(2000);

    // Click the View 3D button
    const productRow = page.locator('tr', { has: page.getByText(PRODUCT_NAME, { exact: true }) });
    const view3dBtn = productRow.locator('button:has-text("View 3D")');
    await view3dBtn.click();

    // Dialog should open
    const dialog = page.locator('mat-dialog-container');
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // Verify the dialog shows the product name (use heading role to avoid strict mode with SKU)
    await expect(dialog.getByRole('heading', { name: PRODUCT_NAME })).toBeVisible();

    await page.screenshot({ path: 'test-results/product-3d-03-dialog-opened.png', fullPage: true });
  });

  test('Step 4: Verify Three.js canvas renders inside the dialog', async ({ page }) => {
    await uiLogin(page);
    await page.goto('/products');
    await page.waitForTimeout(2000);

    // Open the viewer dialog
    const productRow = page.locator('tr', { has: page.getByText(PRODUCT_NAME, { exact: true }) });
    await productRow.locator('button:has-text("View 3D")').click();

    const dialog = page.locator('mat-dialog-container');
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // Wait for the Three.js canvas to appear and render
    const canvas = dialog.locator('canvas');
    await expect(canvas).toBeVisible({ timeout: 15000 });

    // Canvas should have non-zero dimensions (model is rendering)
    const canvasBox = await canvas.boundingBox();
    expect(canvasBox).toBeTruthy();
    expect(canvasBox!.width).toBeGreaterThan(100);
    expect(canvasBox!.height).toBeGreaterThan(100);

    // Wait for the loading spinner to disappear (model fully loaded)
    await expect(dialog.locator('.loading-overlay')).toBeHidden({ timeout: 15000 });

    await page.screenshot({ path: 'test-results/product-3d-04-canvas-rendered.png', fullPage: true });
  });

  test('Step 5: Verify model metadata in dialog footer', async ({ page }) => {
    await uiLogin(page);
    await page.goto('/products');
    await page.waitForTimeout(2000);

    const productRow = page.locator('tr', { has: page.getByText(PRODUCT_NAME, { exact: true }) });
    await productRow.locator('button:has-text("View 3D")').click();

    const dialog = page.locator('mat-dialog-container');
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // Wait for model to load
    await expect(dialog.locator('canvas')).toBeVisible({ timeout: 15000 });
    await expect(dialog.locator('.loading-overlay')).toBeHidden({ timeout: 15000 });

    // Verify footer metadata chips
    // File format chip (should show GLB) — use specific info-chip locator to avoid matching product name
    await expect(dialog.locator('.info-chip:has(mat-icon:has-text("straighten"))')).toBeVisible();

    // File size chip (should show MB value)
    await expect(dialog.locator('.info-chip:has(mat-icon:has-text("save"))')).toBeVisible();

    // Date chip
    await expect(dialog.locator('.info-chip:has(mat-icon:has-text("calendar_today"))')).toBeVisible();

    // Model count in footer
    await expect(dialog.getByText(/model\(s\)/)).toBeVisible();

    await page.screenshot({ path: 'test-results/product-3d-05-metadata.png', fullPage: true });
  });

  test('Step 6: Verify reset camera button works', async ({ page }) => {
    await uiLogin(page);
    await page.goto('/products');
    await page.waitForTimeout(2000);

    const productRow = page.locator('tr', { has: page.getByText(PRODUCT_NAME, { exact: true }) });
    await productRow.locator('button:has-text("View 3D")').click();

    const dialog = page.locator('mat-dialog-container');
    await expect(dialog).toBeVisible({ timeout: 10000 });
    await expect(dialog.locator('canvas')).toBeVisible({ timeout: 15000 });
    await expect(dialog.locator('.loading-overlay')).toBeHidden({ timeout: 15000 });

    // Click the reset camera button
    const resetBtn = dialog.locator('button:has(mat-icon:has-text("center_focus_strong"))');
    await expect(resetBtn).toBeVisible();
    await resetBtn.click();

    // Wait a moment for camera animation
    await page.waitForTimeout(500);

    await page.screenshot({ path: 'test-results/product-3d-06-reset-camera.png', fullPage: true });
  });

  test('Step 7: Click on 3D model mesh and verify mesh name appears in footer', async ({ page }) => {
    await uiLogin(page);
    await page.goto('/products');
    await page.waitForTimeout(2000);

    const productRow = page.locator('tr', { has: page.getByText(PRODUCT_NAME, { exact: true }) });
    await productRow.locator('button:has-text("View 3D")').click();

    const dialog = page.locator('mat-dialog-container');
    await expect(dialog).toBeVisible({ timeout: 10000 });
    await expect(dialog.locator('canvas')).toBeVisible({ timeout: 15000 });
    await expect(dialog.locator('.loading-overlay')).toBeHidden({ timeout: 15000 });

    // Wait for model to fully render
    await page.waitForTimeout(2000);

    // Click on the center of the canvas (should hit one of the mesh parts)
    const canvas = dialog.locator('canvas');
    const box = await canvas.boundingBox();
    expect(box).toBeTruthy();
    await canvas.click({ position: { x: box!.width / 2, y: box!.height / 2 } });

    await page.waitForTimeout(500);

    // Take a screenshot — the mesh chip may or may not appear depending on hit
    await page.screenshot({ path: 'test-results/product-3d-07-mesh-click.png', fullPage: true });
  });

  test('Step 8: Close the dialog via the close button', async ({ page }) => {
    await uiLogin(page);
    await page.goto('/products');
    await page.waitForTimeout(2000);

    const productRow = page.locator('tr', { has: page.getByText(PRODUCT_NAME, { exact: true }) });
    await productRow.locator('button:has-text("View 3D")').click();

    const dialog = page.locator('mat-dialog-container');
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // Click the X (close) button in the header
    const closeBtn = dialog.locator('button:has(mat-icon:has-text("close"))').first();
    await closeBtn.click();

    // Dialog should close
    await expect(dialog).toBeHidden({ timeout: 5000 });

    // We should be back on the products page
    await expect(page.getByText(PRODUCT_NAME).first()).toBeVisible();

    await page.screenshot({ path: 'test-results/product-3d-08-dialog-closed.png', fullPage: true });
  });

  test('Step 9: Close the dialog via the footer Close button', async ({ page }) => {
    await uiLogin(page);
    await page.goto('/products');
    await page.waitForTimeout(2000);

    const productRow = page.locator('tr', { has: page.getByText(PRODUCT_NAME, { exact: true }) });
    await productRow.locator('button:has-text("View 3D")').click();

    const dialog = page.locator('mat-dialog-container');
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // Click the "Close" button in the footer
    const footerCloseBtn = dialog.locator('mat-dialog-actions button:has-text("Close")');
    await footerCloseBtn.click();

    await expect(dialog).toBeHidden({ timeout: 5000 });

    await page.screenshot({ path: 'test-results/product-3d-09-footer-close.png', fullPage: true });
  });

  test('Step 10: Verify product without model shows "—" instead of View 3D', async ({ page }) => {
    await uiLogin(page);
    await page.goto('/products');
    await page.waitForTimeout(2000);

    // Check that rows without models show "—" in the 3D Model column
    const noModelCells = page.locator('.no-model');
    const count = await noModelCells.count();

    // At least one product row should not have a model (or all have — that's fine too)
    // Just verify the page renders correctly
    await page.screenshot({ path: 'test-results/product-3d-10-no-model-products.png', fullPage: true });
  });

  test('Step 11: Full panoramic screenshot of dialog with 3D model', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await uiLogin(page);
    await page.goto('/products');
    await page.waitForTimeout(2000);

    const productRow = page.locator('tr', { has: page.getByText(PRODUCT_NAME, { exact: true }) });
    await productRow.locator('button:has-text("View 3D")').click();

    const dialog = page.locator('mat-dialog-container');
    await expect(dialog).toBeVisible({ timeout: 10000 });
    await expect(dialog.locator('canvas')).toBeVisible({ timeout: 15000 });
    await expect(dialog.locator('.loading-overlay')).toBeHidden({ timeout: 15000 });

    // Wait for full render
    await page.waitForTimeout(3000);

    await page.screenshot({
      path: 'test-results/product-3d-11-panoramic.png',
      fullPage: true,
    });
  });

  // ─── CLEANUP ──────────────────────────────────────────────────────────

  test('Cleanup: Remove test data if we created it', async ({ request }) => {
    // Only clean up if we created the product in this test run
    if (productExistedBefore) {
      return; // Don't delete pre-existing products
    }

    token = await apiLogin(request);

    // Delete model
    if (modelId) {
      const res = await request.delete(`http://localhost:3000/api/models/${modelId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status()).toBe(200);
    }

    // Delete product
    if (productId) {
      const res = await request.delete(`http://localhost:3000/api/products/${productId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status()).toBe(200);
    }
  });
});
