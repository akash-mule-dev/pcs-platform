import { test, expect } from '@playwright/test';

const IFC_FILE = 'C:/Users/admin/Downloads/173mb, CoordinationView -Henckok filesTWHS Area-A QC Test/TWHS Area-A QC Test/IFC Model/QC Software Test 3-27-24.ifc';

test.use({
  actionTimeout: 300_000,
  navigationTimeout: 30_000,
});

test('Create product "TWHS Area-A" and upload 170MB IFC file', async ({ page }) => {
  // ── Step 1: Login ──────────────────────────────────────────────────────
  await page.goto('/login');
  await page.fill('input[name="email"]', 'admin@pcs.local');
  await page.fill('input[name="password"]', 'password123');
  await page.click('button[type="submit"]');
  await page.waitForSelector('text=Dashboard', { timeout: 15000 });
  console.log('✓ Logged in as admin');

  // ── Step 2: Navigate to Products ───────────────────────────────────────
  await page.click('text=Products');
  await page.waitForURL(/products/, { timeout: 10000 });
  await page.waitForTimeout(1000);
  console.log('✓ Products page');

  await page.screenshot({ path: 'test-results/ifc-01-products.png', fullPage: true });

  // ── Step 3: Open Add Product dialog ────────────────────────────────────
  await page.click('button:has-text("Add Product")');
  await page.waitForSelector('h2:has-text("Add Product")', { timeout: 5000 });
  await page.waitForTimeout(500);
  console.log('✓ Add Product dialog opened');

  // ── Step 4: Fill form ──────────────────────────────────────────────────
  const inputs = page.locator('mat-dialog-content input[matinput]');
  await inputs.nth(0).fill('TWHS Area-A Structural Steel');
  await inputs.nth(1).fill('TWHS-AREA-A-001');
  await page.locator('mat-dialog-content textarea[matinput]').fill(
    'Thomas Worthington High School - Area A structural steel coordination model. Exported from Tekla Structures.'
  );
  console.log('✓ Form filled');

  await page.screenshot({ path: 'test-results/ifc-02-form-filled.png', fullPage: true });

  // ── Step 5: Select IFC file via Import CAD button ──────────────────────
  // The CAD file input accepts .step,.stp,.iges,.igs,.ifc
  const cadInput = page.locator('input[type="file"][accept*=".ifc"]');
  console.log('  Selecting 170MB IFC file...');
  await cadInput.setInputFiles(IFC_FILE);

  // The cadFile variable is set internally but there's no visible chip for it
  // (only modelFile gets the visible chip). Just wait a moment for the change event.
  await page.waitForTimeout(1000);
  console.log('✓ IFC file selected');

  await page.screenshot({ path: 'test-results/ifc-03-file-selected.png', fullPage: true });

  // ── Step 6: Save — creates product then uploads IFC for CAD conversion ─
  await page.click('button:has-text("Save")');
  console.log('  Save clicked — creating product + uploading 170MB IFC...');
  console.log('  This will take several minutes (upload + IFC-to-GLB conversion)...');

  // Take progress screenshots periodically
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(5000);

    // Check if dialog is still open
    const dialogVisible = await page.locator('mat-dialog-content').count() > 0;
    if (!dialogVisible) {
      console.log(`✓ Upload complete after ~${(i + 1) * 5}s`);
      break;
    }

    // Screenshot every 30 seconds
    if (i % 6 === 0) {
      await page.screenshot({ path: `test-results/ifc-04-progress-${i * 5}s.png`, fullPage: true });
      console.log(`  Still uploading... (${(i + 1) * 5}s elapsed)`);
    }
  }

  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'test-results/ifc-05-complete.png', fullPage: true });

  // ── Step 7: Verify product in list ─────────────────────────────────────
  const body = await page.textContent('body');
  expect(body).toContain('TWHS Area-A Structural Steel');
  console.log('✓ Product visible in list');

  await page.screenshot({ path: 'test-results/ifc-06-product-in-list.png', fullPage: true });
  console.log('✓ Test complete');
});
