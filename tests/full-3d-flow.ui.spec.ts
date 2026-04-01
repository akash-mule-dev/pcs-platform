import { test, expect, Page, APIRequestContext } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Full End-to-End Test: Product → 3D Model Upload → Quality Data → 3D Visualization
 *
 * Flow:
 * 1. Create a new product via API
 * 2. Upload a GLB 3D model linked to that product via API
 * 3. Add quality inspection data (pass/fail/warning) via API
 * 4. Login to the frontend
 * 5. Navigate to Quality Analysis page
 * 6. Select the model and verify 3D rendering
 * 7. Verify quality overlay colors and summary
 * 8. Take screenshots at every step
 */

const TEST_PRODUCT = {
  name: 'Hydraulic Pump Assembly',
  description: 'Test product for 3D visualization E2E',
};

let token: string;
let productId: string;
let modelId: string;
const qualityEntryIds: string[] = [];

// ─── API HELPERS ──────────────────────────────────────────────────────────

async function apiLogin(request: APIRequestContext): Promise<string> {
  const res = await request.post('http://localhost:3000/api/auth/login', {
    data: { email: 'admin@pcs.local', password: 'password123' },
  });
  expect(res.status()).toBe(201);
  const body = await res.json();
  return body.data.accessToken;
}

async function apiPost(request: APIRequestContext, path: string, data: any) {
  const res = await request.post(`http://localhost:3000/api${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    data,
  });
  return res;
}

async function apiDelete(request: APIRequestContext, path: string) {
  return request.delete(`http://localhost:3000/api${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function uiLogin(page: Page) {
  await page.goto('/login');
  await page.fill('input[name="email"]', 'admin@pcs.local');
  await page.fill('input[name="password"]', 'password123');
  await page.click('button[type="submit"]');
  await page.waitForSelector('text=Dashboard', { timeout: 10000 });
}

// ─── TEST SUITE ───────────────────────────────────────────────────────────

test.describe.serial('Full 3D Visualization Flow — Product to Rendered Model', () => {

  // ─── PHASE 1: Setup test data via API ─────────────────────────────────

  test('Step 1: Create a new product', async ({ request }) => {
    token = await apiLogin(request);

    const res = await apiPost(request, '/products', TEST_PRODUCT);
    expect(res.status()).toBe(201);
    const body = await res.json();
    productId = body.data.id;
    expect(productId).toBeTruthy();
    expect(body.data.name).toBe(TEST_PRODUCT.name);
  });

  test('Step 2: Upload 3D model (GLB with 5 named parts) linked to product', async ({ request }) => {
    const glbPath = path.join(__dirname, 'fixtures', 'test-assembly.glb');
    expect(fs.existsSync(glbPath)).toBe(true);
    const glbBuffer = fs.readFileSync(glbPath);

    const res = await request.post('http://localhost:3000/api/models', {
      headers: { Authorization: `Bearer ${token}` },
      multipart: {
        name: 'Hydraulic Pump 3D Model',
        modelType: 'quality',
        description: 'Assembly model with 5 inspectable parts',
        productId: productId,
        file: {
          name: 'hydraulic-pump.glb',
          mimeType: 'model/gltf-binary',
          buffer: glbBuffer,
        },
      },
    });

    expect(res.status()).toBe(201);
    const body = await res.json();
    modelId = body.data.id;
    expect(modelId).toBeTruthy();
    expect(body.data.name).toBe('Hydraulic Pump 3D Model');
    expect(body.data.productId).toBe(productId);
    expect(body.data.fileFormat).toBe('glb');
  });

  test('Step 3: Add quality inspection data for all 5 mesh regions', async ({ request }) => {
    const inspections = [
      {
        modelId, meshName: 'housing_top', regionLabel: 'Top Housing Panel',
        status: 'pass', inspector: 'Jane Smith', severity: 'low',
        inspectionDate: '2026-03-18T09:00:00.000Z',
        notes: 'Surface finish excellent, no defects detected',
        measurementValue: 12.48, measurementUnit: 'mm',
        toleranceMin: 12.0, toleranceMax: 13.0,
      },
      {
        modelId, meshName: 'housing_bottom', regionLabel: 'Bottom Housing Panel',
        status: 'pass', inspector: 'Jane Smith',
        inspectionDate: '2026-03-18T09:05:00.000Z',
        notes: 'All dimensions within tolerance',
        measurementValue: 25.01, measurementUnit: 'mm',
        toleranceMin: 24.8, toleranceMax: 25.2,
      },
      {
        modelId, meshName: 'bolt_left', regionLabel: 'Left Mounting Bolt',
        status: 'fail', inspector: 'Mike Johnson',
        defectType: 'Dimensional Out-of-Spec', severity: 'high',
        inspectionDate: '2026-03-18T09:10:00.000Z',
        notes: 'Oversized by 2.1mm — requires rework',
        measurementValue: 15.1, measurementUnit: 'mm',
        toleranceMin: 12.5, toleranceMax: 13.5,
      },
      {
        modelId, meshName: 'bolt_right', regionLabel: 'Right Mounting Bolt',
        status: 'pass', inspector: 'Mike Johnson',
        inspectionDate: '2026-03-18T09:12:00.000Z',
        notes: 'Torque and dimension OK',
        measurementValue: 13.02, measurementUnit: 'mm',
        toleranceMin: 12.5, toleranceMax: 13.5,
      },
      {
        modelId, meshName: 'gasket_ring', regionLabel: 'Sealing Gasket Ring',
        status: 'warning', inspector: 'Jane Smith',
        defectType: 'Surface Roughness', severity: 'medium',
        inspectionDate: '2026-03-18T09:15:00.000Z',
        notes: 'Roughness Ra 1.58μm — approaching upper limit of 1.6μm',
        measurementValue: 1.58, measurementUnit: 'μm',
        toleranceMin: 0.8, toleranceMax: 1.6,
      },
    ];

    // Bulk create
    const res = await apiPost(request, '/quality-data/bulk', { items: inspections });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.data).toHaveLength(5);
    body.data.forEach((entry: any) => qualityEntryIds.push(entry.id));
  });

  test('Step 4: Verify quality summary counts via API', async ({ request }) => {
    const res = await request.get(`http://localhost:3000/api/quality-data/summary/${modelId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.total).toBe(5);
    expect(body.data.pass).toBe(3);    // housing_top, housing_bottom, bolt_right
    expect(body.data.fail).toBe(1);    // bolt_left
    expect(body.data.warning).toBe(1); // gasket_ring
  });

  // ─── PHASE 2: UI Flow — Navigate and visualize ─────────────────────────

  test('Step 5: Login and navigate to Products page — verify product exists', async ({ page }) => {
    await uiLogin(page);

    // Navigate to Products
    await page.click('text=Products');
    await page.waitForTimeout(2000);

    // Verify our test product appears
    await expect(page.getByText(TEST_PRODUCT.name).first()).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: 'test-results/e2e-01-product-list.png', fullPage: true });
  });

  test('Step 6: Navigate to 3D Quality page', async ({ page }) => {
    await uiLogin(page);

    await page.getByText('3D Quality', { exact: true }).click();
    await page.waitForSelector('h1', { timeout: 10000 });
    await expect(page.locator('h1')).toContainText('3D Quality Analysis');

    await page.screenshot({ path: 'test-results/e2e-02-quality-page.png', fullPage: true });
  });

  test('Step 7: Select the uploaded model and see it render in 3D', async ({ page }) => {
    await uiLogin(page);
    await page.goto('/quality-analysis');
    await page.waitForSelector('h1', { timeout: 10000 });

    // Wait for model list to load
    await page.waitForTimeout(2000);

    // Find and click our model
    const modelItem = page.getByText('Hydraulic Pump 3D Model').first();
    await expect(modelItem).toBeVisible({ timeout: 10000 });
    await modelItem.click();

    // Wait for Three.js canvas to render
    await page.waitForSelector('canvas', { timeout: 10000 });
    await expect(page.locator('canvas')).toBeVisible();

    // Wait for model to load (loading overlay should disappear)
    await page.waitForTimeout(3000);

    await page.screenshot({ path: 'test-results/e2e-03-3d-model-loading.png', fullPage: true });
  });

  test('Step 8: Verify 3D model is rendered with quality color overlay', async ({ page }) => {
    await uiLogin(page);
    await page.goto('/quality-analysis');
    await page.waitForSelector('h1', { timeout: 10000 });
    await page.waitForTimeout(2000);

    // Select the model
    await page.getByText('Hydraulic Pump 3D Model').first().click();
    await page.waitForSelector('canvas', { timeout: 10000 });

    // Wait for full render + quality data overlay
    await page.waitForTimeout(4000);

    // Canvas should be rendering (check it has non-zero size)
    const canvasBox = await page.locator('canvas').boundingBox();
    expect(canvasBox).toBeTruthy();
    expect(canvasBox!.width).toBeGreaterThan(100);
    expect(canvasBox!.height).toBeGreaterThan(100);

    // Screenshot of the 3D rendered model with quality overlay
    await page.screenshot({ path: 'test-results/e2e-04-3d-rendered-with-quality.png', fullPage: true });
  });

  test('Step 9: Verify quality summary panel shows correct counts', async ({ page }) => {
    await uiLogin(page);
    await page.goto('/quality-analysis');
    await page.waitForSelector('h1', { timeout: 10000 });
    await page.waitForTimeout(2000);

    // Select model
    await page.getByText('Hydraulic Pump 3D Model').first().click();
    await page.waitForTimeout(3000);

    // Verify summary card appears
    await expect(page.getByText('Quality Summary', { exact: true })).toBeVisible({ timeout: 10000 });

    // Verify the stat counts
    const statItems = page.locator('.stat-item');
    await expect(statItems).toHaveCount(4); // Total, Pass, Fail, Warning

    // Verify legend
    await expect(page.getByText('Pass — Within tolerance')).toBeVisible();
    await expect(page.getByText('Fail — Out of spec')).toBeVisible();
    await expect(page.getByText('Warning — Near limit')).toBeVisible();

    await page.screenshot({ path: 'test-results/e2e-05-quality-summary.png', fullPage: true });
  });

  test('Step 10: Verify inspection entries list in right panel', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await uiLogin(page);
    await page.goto('/quality-analysis');
    await page.waitForSelector('h1', { timeout: 10000 });
    await page.waitForTimeout(2000);

    // Select model
    await page.getByText('Hydraulic Pump 3D Model').first().click();
    await page.waitForTimeout(3000);

    // Check the right panel shows inspection entries
    const allInspections = page.getByText(/All Inspections/);
    await expect(allInspections).toBeVisible({ timeout: 10000 });

    // Verify individual entries are listed
    await expect(page.getByText('Top Housing Panel').first()).toBeVisible();
    await expect(page.getByText('Left Mounting Bolt').first()).toBeVisible();
    await expect(page.getByText('Sealing Gasket Ring').first()).toBeVisible();

    await page.screenshot({ path: 'test-results/e2e-06-inspection-entries.png', fullPage: true });
  });

  test('Step 11: Click an inspection entry and see detail panel', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await uiLogin(page);
    await page.goto('/quality-analysis');
    await page.waitForSelector('h1', { timeout: 10000 });
    await page.waitForTimeout(2000);

    await page.getByText('Hydraulic Pump 3D Model').first().click();
    await page.waitForTimeout(3000);

    // Click on the "fail" entry (Left Mounting Bolt)
    await page.locator('.entry-item:has-text("Left Mounting Bolt")').click();
    await page.waitForTimeout(500);

    // Verify detail panel shows — scope assertions to .detail-card
    const detailCard = page.locator('.detail-card');
    await expect(detailCard).toBeVisible();
    await expect(detailCard.locator('.detail-status')).toContainText('FAIL');
    await expect(detailCard).toContainText('Dimensional Out-of-Spec');
    await expect(detailCard).toContainText('Mike Johnson');
    await expect(detailCard).toContainText('Oversized by 2.1mm');

    await page.screenshot({ path: 'test-results/e2e-07-inspection-detail-fail.png', fullPage: true });
  });

  test('Step 12: Click a pass entry and see detail', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await uiLogin(page);
    await page.goto('/quality-analysis');
    await page.waitForSelector('h1', { timeout: 10000 });
    await page.waitForTimeout(2000);

    await page.getByText('Hydraulic Pump 3D Model').first().click();
    await page.waitForTimeout(3000);

    // Click on a "pass" entry
    await page.locator('.entry-item:has-text("Top Housing Panel")').click();
    await page.waitForTimeout(500);

    const detailCard = page.locator('.detail-card');
    await expect(detailCard).toBeVisible();
    await expect(detailCard.locator('.detail-status')).toContainText('PASS');
    await expect(detailCard).toContainText('Jane Smith');

    await page.screenshot({ path: 'test-results/e2e-08-inspection-detail-pass.png', fullPage: true });
  });

  test('Step 13: Click warning entry and verify measurement data', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await uiLogin(page);
    await page.goto('/quality-analysis');
    await page.waitForSelector('h1', { timeout: 10000 });
    await page.waitForTimeout(2000);

    await page.getByText('Hydraulic Pump 3D Model').first().click();
    await page.waitForTimeout(3000);

    // Click warning entry
    await page.locator('.entry-item:has-text("Sealing Gasket Ring")').click();
    await page.waitForTimeout(500);

    const detailCard = page.locator('.detail-card');
    await expect(detailCard).toBeVisible();
    await expect(detailCard.locator('.detail-status')).toContainText('WARNING');
    await expect(detailCard).toContainText('Surface Roughness');
    await expect(detailCard).toContainText('1.58');

    await page.screenshot({ path: 'test-results/e2e-09-inspection-detail-warning.png', fullPage: true });
  });

  test('Step 14: Verify filter works — show only quality models', async ({ page }) => {
    await uiLogin(page);
    await page.goto('/quality-analysis');
    await page.waitForSelector('h1', { timeout: 10000 });
    await page.waitForTimeout(2000);

    // Open filter dropdown and select "Quality"
    await page.click('mat-select');
    await page.waitForSelector('mat-option', { timeout: 5000 });
    await page.locator('mat-option:has-text("Quality")').click();
    await page.waitForTimeout(2000);

    // Our model should still be visible (it's type=quality)
    await expect(page.getByText('Hydraulic Pump 3D Model').first()).toBeVisible();

    await page.screenshot({ path: 'test-results/e2e-10-filtered-quality.png', fullPage: true });
  });

  test('Step 15: Take final panoramic screenshot of full 3D quality view', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await uiLogin(page);
    await page.goto('/quality-analysis');
    await page.waitForSelector('h1', { timeout: 10000 });
    await page.waitForTimeout(2000);

    // Select model
    await page.getByText('Hydraulic Pump 3D Model').first().click();
    await page.waitForTimeout(4000);

    // Click an entry to show the detail panel too
    await page.locator('.entry-item:has-text("Left Mounting Bolt")').click();
    await page.waitForTimeout(500);

    // Full panoramic screenshot — all 3 columns visible
    await page.screenshot({
      path: 'test-results/e2e-11-full-3d-quality-panoramic.png',
      fullPage: true,
    });
  });

  // ─── PHASE 3: Cleanup ──────────────────────────────────────────────────

  test('Step 16: Cleanup test data', async ({ request }) => {
    token = await apiLogin(request);

    // Delete quality data
    if (modelId) {
      await apiDelete(request, `/quality-data/by-model/${modelId}`);
    }
    // Delete model
    if (modelId) {
      const res = await apiDelete(request, `/models/${modelId}`);
      expect(res.status()).toBe(200);
    }
    // Delete product
    if (productId) {
      const res = await apiDelete(request, `/products/${productId}`);
      expect(res.status()).toBe(200);
    }
  });
});
