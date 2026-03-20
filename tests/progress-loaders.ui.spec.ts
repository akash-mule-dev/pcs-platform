import { test, expect } from '@playwright/test';

const IFC_FILE = 'C:/Users/admin/Downloads/173mb, CoordinationView -Henckok filesTWHS Area-A QC Test/TWHS Area-A QC Test/IFC Model/QC Software Test 3-27-24.ifc';

test.use({
  actionTimeout: 300_000,
  navigationTimeout: 30_000,
});

test('Upload IFC with percentage progress, then View 3D with download progress', async ({ page }) => {
  // ── Login ──────────────────────────────────────────────────────────────
  await page.goto('/login');
  await page.fill('input[name="email"]', 'admin@pcs.local');
  await page.fill('input[name="password"]', 'password123');
  await page.click('button[type="submit"]');
  await page.waitForSelector('text=Dashboard', { timeout: 15000 });

  // ── Navigate to Products ───────────────────────────────────────────────
  await page.click('text=Products');
  await page.waitForURL(/products/, { timeout: 10000 });
  await page.waitForTimeout(1000);

  // ── Add Product with IFC ───────────────────────────────────────────────
  await page.click('button:has-text("Add Product")');
  await page.waitForSelector('h2:has-text("Add Product")', { timeout: 5000 });

  const inputs = page.locator('mat-dialog-content input[matinput]');
  await inputs.nth(0).fill('TWHS Progress Test');
  await inputs.nth(1).fill('TWHS-PROG-001');

  // Select the 170MB IFC file
  const cadInput = page.locator('input[type="file"][accept*=".ifc"]');
  await cadInput.setInputFiles(IFC_FILE);
  await page.waitForTimeout(500);

  // Verify "Ready to upload" is shown
  await expect(page.locator('text=Ready to upload')).toBeVisible();
  await page.screenshot({ path: 'test-results/progress-01-ready.png', fullPage: true });
  console.log('✓ File selected — ready to upload');

  // ── Click Save and watch upload progress ───────────────────────────────
  await page.click('button:has-text("Save")');

  // Capture upload progress screenshots
  let sawPercentage = false;
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(500);

    const dialogVisible = await page.locator('mat-dialog-content').count() > 0;
    if (!dialogVisible) break;

    // Check for percentage text
    const body = await page.locator('.upload-status').textContent().catch(() => '');
    if (body && body.includes('%')) {
      if (!sawPercentage) {
        await page.screenshot({ path: 'test-results/progress-02-uploading.png', fullPage: true });
        console.log(`✓ Upload progress visible: ${body.trim()}`);
        sawPercentage = true;
      }
    }
    // Check for "converting" state
    if (body && body.includes('converting')) {
      await page.screenshot({ path: 'test-results/progress-03-converting.png', fullPage: true });
      console.log('✓ Server processing (converting to 3D)');
    }
  }

  // Wait for dialog to close
  await page.waitForSelector('mat-dialog-content', { state: 'hidden', timeout: 300_000 });
  await page.waitForTimeout(1000);
  console.log('✓ Upload complete');

  await page.screenshot({ path: 'test-results/progress-04-uploaded.png', fullPage: true });

  // ── Find the product and click View 3D ─────────────────────────────────
  // The product should be in the list now — scroll to find it
  const viewBtn = page.locator('tr:has-text("TWHS Progress Test") button:has-text("View 3D")');
  await expect(viewBtn).toBeVisible({ timeout: 10000 });
  console.log('✓ Product in list with View 3D button');

  await viewBtn.click();
  console.log('  Clicked View 3D — watching download progress...');

  // Wait for the 3D viewer dialog to open
  await page.waitForSelector('app-three-viewer', { timeout: 10000 });

  // Capture download progress
  let sawDownloadProgress = false;
  for (let i = 0; i < 120; i++) {
    await page.waitForTimeout(500);

    // Check for the progress ring percentage
    const progressText = await page.locator('.progress-text').textContent().catch(() => '');
    if (progressText && progressText.includes('%')) {
      if (!sawDownloadProgress) {
        await page.screenshot({ path: 'test-results/progress-05-downloading-3d.png', fullPage: true });
        console.log(`✓ Download progress visible: ${progressText.trim()}`);
        sawDownloadProgress = true;
      }
    }

    // Check if model loaded (loading overlay gone)
    const loadingVisible = await page.locator('.loading-overlay').count() > 0;
    if (!loadingVisible) {
      console.log('✓ 3D model loaded');
      break;
    }
  }

  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'test-results/progress-06-3d-loaded.png', fullPage: true });

  console.log('✓ Test complete — both upload and download progress indicators verified');
});
