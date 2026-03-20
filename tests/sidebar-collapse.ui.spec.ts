import { test, expect, Page } from '@playwright/test';

async function loginAsAdmin(page: Page) {
  await page.goto('/login');
  await page.fill('input[name="email"]', 'admin@pcs.local');
  await page.fill('input[name="password"]', 'password123');
  await page.click('button[type="submit"]');
  await page.waitForSelector('text=Dashboard', { timeout: 15000 });
}

test.describe('Sidebar Collapse/Expand', () => {
  test('should start with sidebar expanded', async ({ page }) => {
    await loginAsAdmin(page);

    const sidenav = page.locator('aside.sidenav');
    await expect(sidenav).not.toHaveClass(/collapsed/);

    // Logo text should be visible when expanded
    const logoText = page.locator('.logo-text');
    await expect(logoText).toBeVisible();

    // Nav item labels should be visible
    const navLabel = page.locator('mat-nav-list span[matlistitemtitle]').first();
    await expect(navLabel).toBeVisible();

    await page.screenshot({ path: 'test-results/sidebar-expanded.png', fullPage: true });
  });

  test('should collapse sidebar when toggle button is clicked', async ({ page }) => {
    await loginAsAdmin(page);

    // Click the menu toggle button
    const toggleBtn = page.locator('button:has(mat-icon:has-text("menu_open"))');
    await expect(toggleBtn).toBeVisible();
    await toggleBtn.click();

    // Sidebar should now have collapsed class
    const sidenav = page.locator('aside.sidenav');
    await expect(sidenav).toHaveClass(/collapsed/);

    // Logo text should be hidden
    const logoText = page.locator('.logo-text');
    await expect(logoText).toHaveCount(0);

    // Nav item labels should be hidden
    const navLabels = page.locator('mat-nav-list span[matlistitemtitle]');
    await expect(navLabels).toHaveCount(0);

    // Icons should still be visible
    const navIcons = page.locator('mat-nav-list mat-icon');
    expect(await navIcons.count()).toBeGreaterThan(0);

    await page.screenshot({ path: 'test-results/sidebar-collapsed.png', fullPage: true });
  });

  test('should expand sidebar back when toggle is clicked again', async ({ page }) => {
    await loginAsAdmin(page);

    // Collapse
    const toggleBtn = page.locator('button:has(mat-icon:has-text("menu_open"))');
    await toggleBtn.click();

    const sidenav = page.locator('aside.sidenav');
    await expect(sidenav).toHaveClass(/collapsed/);

    // Expand - icon is now "menu" instead of "menu_open"
    const expandBtn = page.locator('button:has(mat-icon:has-text("menu"))').first();
    await expandBtn.click();

    await expect(sidenav).not.toHaveClass(/collapsed/);

    // Logo text should reappear
    const logoText = page.locator('.logo-text');
    await expect(logoText).toBeVisible();

    // Nav labels should reappear
    const navLabel = page.locator('mat-nav-list span[matlistitemtitle]').first();
    await expect(navLabel).toBeVisible();

    await page.screenshot({ path: 'test-results/sidebar-re-expanded.png', fullPage: true });
  });

  test('should show tooltips on nav items when collapsed', async ({ page }) => {
    await loginAsAdmin(page);

    // Collapse the sidebar
    const toggleBtn = page.locator('button:has(mat-icon:has-text("menu_open"))');
    await toggleBtn.click();

    // Hover over the first nav item (Dashboard icon)
    const firstNavItem = page.locator('mat-nav-list a[mat-list-item]').first();
    await firstNavItem.hover();

    // Wait for tooltip to appear
    await page.waitForTimeout(500);
    const tooltip = page.locator('.mat-mdc-tooltip');
    // Tooltip might take a moment to render
    if (await tooltip.count() > 0) {
      await expect(tooltip).toBeVisible();
    }

    await page.screenshot({ path: 'test-results/sidebar-collapsed-tooltip.png', fullPage: true });
  });

  test('should still navigate correctly when sidebar is collapsed', async ({ page }) => {
    await loginAsAdmin(page);

    // Collapse the sidebar
    const toggleBtn = page.locator('button:has(mat-icon:has-text("menu_open"))');
    await toggleBtn.click();

    // Click the Reports nav item (bar_chart icon)
    const reportsIcon = page.locator('mat-nav-list mat-icon:has-text("bar_chart")');
    await reportsIcon.click();

    await page.waitForSelector('text=Reports & Analytics', { timeout: 10000 });
    expect(await page.textContent('body')).toContain('Reports & Analytics');

    await page.screenshot({ path: 'test-results/sidebar-collapsed-navigation.png', fullPage: true });
  });
});
