import { test, expect } from '@playwright/test';

test.describe('Login UI', () => {
  test('should login via the browser and reach the dashboard', async ({ page }) => {
    await page.goto('/login');

    // Fill in email and password
    await page.fill('input[name="email"]', 'admin@pcs.local');
    await page.fill('input[name="password"]', 'password123');

    // Click Sign In
    await page.click('button[type="submit"]');

    // Wait for the dashboard heading to appear
    await page.waitForSelector('text=Dashboard', { timeout: 10000 });

    // Take a screenshot of the successful login
    await page.screenshot({ path: 'test-results/login-success.png', fullPage: true });

    // Verify dashboard content is visible
    expect(await page.textContent('body')).toContain('Dashboard');
    expect(await page.textContent('body')).toContain('System Admin');
  });
});
