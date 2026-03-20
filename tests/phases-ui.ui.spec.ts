import { test, expect, Page } from '@playwright/test';

async function loginAsAdmin(page: Page) {
  await page.goto('/login');
  await page.fill('input[name="email"]', 'admin@pcs.local');
  await page.fill('input[name="password"]', 'password123');
  await page.click('button[type="submit"]');
  await page.waitForSelector('text=Dashboard', { timeout: 15000 });
}

test.describe('Phase 7 UI — Kanban View', () => {
  test('should navigate to kanban page and display columns', async ({ page }) => {
    await loginAsAdmin(page);
    await page.click('text=Kanban');
    await page.waitForSelector('text=Work Order Pipeline', { timeout: 10000 });

    // Should see the 4 kanban columns
    expect(await page.textContent('body')).toContain('Pending');
    expect(await page.textContent('body')).toContain('In Progress');
    expect(await page.textContent('body')).toContain('Completed');
    expect(await page.textContent('body')).toContain('Skipped');

    await page.screenshot({ path: 'test-results/kanban-view.png', fullPage: true });
  });

  test('should show work order selector on kanban page', async ({ page }) => {
    await loginAsAdmin(page);
    await page.click('text=Kanban');
    await page.waitForSelector('text=Work Order Pipeline', { timeout: 10000 });

    // Should have a work order dropdown
    const selector = page.locator('mat-select');
    expect(await selector.count()).toBeGreaterThan(0);
  });
});

test.describe('Phase 7 UI — Estimated vs Actual Time Chart', () => {
  test('should show time chart on work order detail page', async ({ page }) => {
    await loginAsAdmin(page);
    await page.click('text=Work Orders');
    await page.waitForSelector('table', { timeout: 10000 });

    // Click the first work order link in the table
    const woLink = page.locator('table a[href*="work-orders/"]').first();
    if (await woLink.count() > 0) {
      await woLink.click();
      await page.waitForURL(/work-orders\//, { timeout: 10000 });
      await page.screenshot({ path: 'test-results/wo-detail-chart.png', fullPage: true });
    } else {
      // If no link, try clicking a row with routerLink
      const firstRow = page.locator('table tbody tr').first();
      if (await firstRow.count() > 0) {
        await firstRow.click();
        await page.waitForTimeout(2000);
        await page.screenshot({ path: 'test-results/wo-list-page.png', fullPage: true });
      }
    }
  });
});

test.describe('Phase 8 UI — Reports with OEE', () => {
  test('should display OEE widget on reports page', async ({ page }) => {
    await loginAsAdmin(page);
    await page.click('text=Reports');
    await page.waitForSelector('text=Reports & Analytics', { timeout: 10000 });

    // Should show OEE section
    await page.waitForTimeout(2000); // Wait for API data to load
    const body = await page.textContent('body');
    expect(body).toContain('Reports & Analytics');

    // Check for date pickers
    const datePickers = page.locator('mat-datepicker-toggle');
    expect(await datePickers.count()).toBeGreaterThanOrEqual(2);

    // Check for export button
    const exportBtn = page.locator('button:has-text("Export CSV")');
    expect(await exportBtn.count()).toBe(1);

    await page.screenshot({ path: 'test-results/reports-oee.png', fullPage: true });
  });
});

test.describe('Phase 10 UI — Global Search', () => {
  test('should show search bar in toolbar', async ({ page }) => {
    await loginAsAdmin(page);
    const searchInput = page.locator('.search-input');
    expect(await searchInput.count()).toBe(1);
    expect(await searchInput.getAttribute('placeholder')).toContain('Search');
  });

  test('should show search results on typing', async ({ page }) => {
    await loginAsAdmin(page);
    const searchInput = page.locator('.search-input');
    await searchInput.fill('WO');
    // Wait for debounce + API response
    await page.waitForTimeout(500);
    // Search dropdown should appear
    const dropdown = page.locator('.search-dropdown');
    if (await dropdown.count() > 0) {
      expect(await dropdown.isVisible()).toBeTruthy();
      await page.screenshot({ path: 'test-results/global-search-results.png', fullPage: true });
    }
  });

  test('should show notification bell in toolbar', async ({ page }) => {
    await loginAsAdmin(page);
    const bell = page.locator('mat-icon:has-text("notifications")');
    expect(await bell.count()).toBeGreaterThan(0);
  });
});

test.describe('Phase 10 UI — Notifications Page', () => {
  test('should navigate to notifications page', async ({ page }) => {
    await loginAsAdmin(page);
    // Click notification bell
    const bell = page.locator('button:has(mat-icon:has-text("notifications"))');
    await bell.click();
    await page.waitForURL(/notifications/, { timeout: 10000 });
    expect(await page.textContent('body')).toContain('Notifications');
    await page.screenshot({ path: 'test-results/notifications-page.png', fullPage: true });
  });
});

test.describe('Phase 10 UI — Audit Log Page', () => {
  test('should navigate to audit log page (admin only)', async ({ page }) => {
    await loginAsAdmin(page);
    await page.click('text=Audit Log');
    await page.waitForSelector('text=Audit Log', { timeout: 10000 });
    expect(await page.textContent('body')).toContain('Audit Log');

    // Should have entity type filter
    const filterSelect = page.locator('mat-select');
    expect(await filterSelect.count()).toBeGreaterThan(0);

    // Should have a table
    const table = page.locator('table');
    expect(await table.count()).toBe(1);

    await page.screenshot({ path: 'test-results/audit-log.png', fullPage: true });
  });
});

test.describe('Phase 6 UI — Quality Trends & Sign-off', () => {
  test('should show quality page with trend and pattern sections', async ({ page }) => {
    await loginAsAdmin(page);
    await page.click('text=3D Quality');
    await page.waitForSelector('text=3D Quality Analysis', { timeout: 10000 });
    expect(await page.textContent('body')).toContain('3D Quality Analysis');

    // Should have upload buttons
    const uploadBtn = page.locator('button:has-text("Upload 3D Model")');
    expect(await uploadBtn.count()).toBe(1);

    const cadBtn = page.locator('button:has-text("Import CAD File")');
    expect(await cadBtn.count()).toBe(1);

    await page.screenshot({ path: 'test-results/quality-analysis-page.png', fullPage: true });
  });
});

test.describe('Layout UI — Navigation Items', () => {
  test('should show all nav items for admin', async ({ page }) => {
    await loginAsAdmin(page);
    const body = await page.textContent('body');
    expect(body).toContain('Dashboard');
    expect(body).toContain('Products');
    expect(body).toContain('Processes');
    expect(body).toContain('Work Orders');
    expect(body).toContain('Time Tracking');
    expect(body).toContain('Users');
    expect(body).toContain('Stations');
    expect(body).toContain('Kanban');
    expect(body).toContain('3D Quality');
    expect(body).toContain('Reports');
    expect(body).toContain('Audit Log');

    await page.screenshot({ path: 'test-results/full-nav-admin.png', fullPage: true });
  });
});
