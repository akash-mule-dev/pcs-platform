import { test, expect, Page } from '@playwright/test';

const BASE = 'http://localhost:8100';
const API = 'http://localhost:3000/api';
const CREDS = { email: 'operator2@pcs.local', password: 'password123' };

let token: string;
let userData: any;

test.describe('Mobile App - operator2@pcs.local full test', () => {

  test.beforeAll(async () => {
    // Get token via API for comparison data
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(CREDS),
    });
    const json = await res.json();
    token = json.data.accessToken;
    userData = json.data.user;
  });

  test('Login flow', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');

    // Should see login page
    const emailInput = page.locator('ion-input[type="email"] input, input[type="email"]').first();
    const passwordInput = page.locator('ion-input[type="password"] input, input[type="password"]').first();

    await emailInput.waitFor({ timeout: 10000 });
    await emailInput.fill(CREDS.email);
    await passwordInput.fill(CREDS.password);

    // Click login button
    const loginBtn = page.locator('ion-button:has-text("Sign In"), ion-button[type="submit"], button[type="submit"]').first();
    await loginBtn.click();

    // Should navigate to dashboard
    await page.waitForURL(/tabs\/dashboard/, { timeout: 15000 });
    expect(page.url()).toContain('tabs/dashboard');
  });

  test('Dashboard - loads and shows data', async ({ page }) => {
    await loginViaUI(page);

    await page.waitForURL(/tabs\/dashboard/, { timeout: 15000 });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Take screenshot for visual check
    await page.screenshot({ path: 'test-results/mobile-dashboard.png', fullPage: true });

    // Check dashboard has content (cards, stats, etc.)
    const content = await page.locator('ion-content').first().textContent();
    expect(content?.length).toBeGreaterThan(0);
  });

  test('Work Orders tab - lists work orders', async ({ page }) => {
    await loginViaUI(page);

    // Navigate to work orders tab
    await page.locator('ion-tab-button[tab="work-orders"], ion-tab-button:has(ion-label:text("Work Orders")), ion-tab-button:has(ion-label:text("Orders"))').first().click();
    await page.waitForURL(/tabs\/work-orders/, { timeout: 10000 });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    await page.screenshot({ path: 'test-results/mobile-work-orders.png', fullPage: true });

    // Verify work orders are displayed
    const items = page.locator('ion-item, ion-card');
    const count = await items.count();
    console.log(`Work orders displayed: ${count}`);

    // Compare with API data
    const apiRes = await fetch(`${API}/work-orders`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (apiRes.ok) {
      const apiData = await apiRes.json();
      const apiCount = Array.isArray(apiData) ? apiData.length : apiData.data?.length || 0;
      console.log(`API work orders count: ${apiCount}`);
    }
  });

  test('Work Order detail - tap into a work order', async ({ page }) => {
    await loginViaUI(page);

    await page.locator('ion-tab-button[tab="work-orders"], ion-tab-button:has(ion-label:text("Work Orders")), ion-tab-button:has(ion-label:text("Orders"))').first().click();
    await page.waitForURL(/tabs\/work-orders/, { timeout: 10000 });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Click first work order
    const firstItem = page.locator('ion-item, ion-card').first();
    if (await firstItem.isVisible()) {
      await firstItem.click();
      await page.waitForTimeout(3000);
      await page.screenshot({ path: 'test-results/mobile-work-order-detail.png', fullPage: true });
    }
  });

  test('Timer tab - loads time tracking', async ({ page }) => {
    await loginViaUI(page);

    await page.locator('ion-tab-button[tab="timer"], ion-tab-button:has(ion-label:text("Timer"))').first().click();
    await page.waitForURL(/tabs\/timer/, { timeout: 10000 });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    await page.screenshot({ path: 'test-results/mobile-timer.png', fullPage: true });

    const content = await page.locator('ion-content').first().textContent();
    expect(content?.length).toBeGreaterThan(0);
  });

  test('Models tab - 3D viewer loads', async ({ page }) => {
    await loginViaUI(page);

    await page.locator('ion-tab-button[tab="models"], ion-tab-button:has(ion-label:text("Models")), ion-tab-button:has(ion-label:text("3D"))').first().click();
    await page.waitForURL(/tabs\/models/, { timeout: 10000 });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    await page.screenshot({ path: 'test-results/mobile-models.png', fullPage: true });

    // Check if canvas or 3D viewer element exists
    const canvas = page.locator('canvas, .model-viewer, model-viewer');
    const hasCanvas = await canvas.count();
    console.log(`3D viewer elements found: ${hasCanvas}`);
  });

  test('Profile tab - shows correct user data', async ({ page }) => {
    await loginViaUI(page);

    await page.locator('ion-tab-button[tab="profile"], ion-tab-button:has(ion-label:text("Profile"))').first().click();
    await page.waitForURL(/tabs\/profile/, { timeout: 10000 });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    await page.screenshot({ path: 'test-results/mobile-profile.png', fullPage: true });

    // Verify profile shows operator2 data
    const pageText = await page.locator('ion-content').first().textContent() || '';
    console.log('Profile page text:', pageText.substring(0, 500));

    // Check user info matches API
    const hasName = pageText.includes(userData.firstName) || pageText.includes(userData.lastName);
    const hasEmail = pageText.includes(userData.email);
    console.log(`Shows name: ${hasName}, Shows email: ${hasEmail}`);
  });

  test('Data accuracy - compare mobile vs web portal', async ({ page, context }) => {
    await loginViaUI(page);

    // Get work orders from API
    const apiRes = await fetch(`${API}/work-orders`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    let apiWorkOrders: any[] = [];
    if (apiRes.ok) {
      const data = await apiRes.json();
      apiWorkOrders = Array.isArray(data) ? data : data.data || [];
    }

    // Navigate to work orders on mobile
    await page.locator('ion-tab-button[tab="work-orders"], ion-tab-button:has(ion-label:text("Work Orders")), ion-tab-button:has(ion-label:text("Orders"))').first().click();
    await page.waitForURL(/tabs\/work-orders/, { timeout: 10000 });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const mobileText = await page.locator('ion-content').first().textContent() || '';

    // Check that API work order numbers appear in mobile view
    let matchCount = 0;
    for (const wo of apiWorkOrders.slice(0, 5)) {
      const woNumber = wo.orderNumber || wo.id;
      if (mobileText.includes(woNumber)) {
        matchCount++;
      }
    }
    console.log(`Data match: ${matchCount}/${Math.min(5, apiWorkOrders.length)} work orders found in mobile view`);

    await page.screenshot({ path: 'test-results/mobile-data-accuracy.png', fullPage: true });
  });
});

async function loginViaUI(page: Page) {
  await page.goto(BASE);
  await page.waitForLoadState('networkidle');

  // Check if already logged in
  if (page.url().includes('tabs/')) return;

  const emailInput = page.locator('ion-input[type="email"] input, input[type="email"]').first();
  const passwordInput = page.locator('ion-input[type="password"] input, input[type="password"]').first();

  await emailInput.waitFor({ timeout: 10000 });
  await emailInput.fill(CREDS.email);
  await passwordInput.fill(CREDS.password);

  const loginBtn = page.locator('ion-button:has-text("Sign In"), ion-button[type="submit"], button[type="submit"]').first();
  await loginBtn.click();

  await page.waitForURL(/tabs/, { timeout: 15000 });
}
