import { test, expect, Page } from '@playwright/test';

const BASE = 'http://localhost:8100';
const API  = 'http://localhost:3000';

const USERS = [
  { email: 'admin@pcs.local',       role: 'admin' },
  { email: 'manager@pcs.local',     role: 'manager' },
  { email: 'supervisor1@pcs.local', role: 'supervisor' },
  { email: 'operator2@pcs.local',   role: 'operator' },
];

const ROUTES = [
  '/tabs/dashboard',
  '/tabs/work-orders',
  '/tabs/timer',
  '/tabs/models',
  '/tabs/profile',
];

/**
 * Login via API, then inject the token into Ionic Storage (IndexedDB)
 * so we bypass shadow-DOM input issues entirely.
 */
async function loginViaAPI(page: Page, email: string) {
  // Hit the backend directly to get a JWT
  const res = await page.request.post(`${API}/api/auth/login`, {
    data: { email, password: 'password123' },
  });
  expect(res.ok(), `Login API failed for ${email}: ${res.status()}`).toBeTruthy();
  const { accessToken, user } = await res.json();

  // Navigate to the app so we have access to its origin
  await page.goto(`${BASE}/login`);
  await page.waitForLoadState('domcontentloaded');

  // Inject token + user into Ionic Storage (uses _ionicstorage IndexedDB)
  await page.evaluate(
    ({ token, userData }) => {
      return new Promise<void>((resolve, reject) => {
        const dbReq = indexedDB.open('_ionicstorage', 1);
        dbReq.onupgradeneeded = () => {
          const db = dbReq.result;
          if (!db.objectStoreNames.contains('_ionickv')) {
            db.createObjectStore('_ionickv');
          }
        };
        dbReq.onsuccess = () => {
          const db = dbReq.result;
          const tx = db.transaction('_ionickv', 'readwrite');
          const store = tx.objectStore('_ionickv');
          store.put(token, 'auth_token');
          store.put(JSON.stringify(userData), 'auth_user');
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
        dbReq.onerror = () => reject(dbReq.error);
      });
    },
    { token: accessToken, userData: user }
  );

  // Reload so the app picks up the stored auth
  await page.goto(`${BASE}/tabs/dashboard`);
  await page.waitForLoadState('networkidle');
}

/**
 * Fallback: fill the login form directly via the UI.
 */
async function loginViaUI(page: Page, email: string) {
  await page.goto(`${BASE}/login`);
  await page.waitForLoadState('networkidle');

  // Ionic ion-input renders a native <input> inside shadow DOM
  // Use the native input inside ion-input
  const emailInput = page.locator('ion-input[type="email"]').locator('input').first();
  const passInput  = page.locator('ion-input[type="password"]').locator('input').first();

  await emailInput.waitFor({ state: 'attached', timeout: 10000 });
  await emailInput.fill(email);
  await passInput.fill('password123');

  // Small wait for ngModel to propagate
  await page.waitForTimeout(500);

  const loginBtn = page.locator('ion-button').filter({ hasText: 'Sign In' });
  await loginBtn.click();

  await page.waitForURL(/\/tabs\//, { timeout: 15000 });
}

async function login(page: Page, email: string) {
  try {
    await loginViaAPI(page, email);
    // Verify we're on tabs
    if (!page.url().includes('/tabs/')) {
      throw new Error('API login did not redirect to tabs');
    }
  } catch {
    // Fallback to UI login
    await loginViaUI(page, email);
  }
}

for (const user of USERS) {
  test.describe(`Mobile App — ${user.role} (${user.email})`, () => {

    test.beforeEach(async ({ page }) => {
      await login(page, user.email);
    });

    test(`[${user.role}] Login succeeds`, async ({ page }) => {
      await expect(page).toHaveURL(/tabs/);
      await page.screenshot({ path: `test-results/mobile-${user.role}-login-success.png` });
    });

    for (const route of ROUTES) {
      const routeName = route.replace('/tabs/', '');

      test(`[${user.role}] ${route} loads`, async ({ page }) => {
        await page.goto(`${BASE}${route}`);
        await page.waitForLoadState('networkidle');
        await expect(page).toHaveURL(new RegExp(routeName));

        const content = page.locator('ion-content').first();
        await expect(content).toBeVisible();

        await page.screenshot({ path: `test-results/mobile-${user.role}-${routeName}.png` });
      });
    }

    const TAB_EXPECTATIONS = [
      { tab: 'dashboard',   url: /tabs\/dashboard/ },
      { tab: 'work-orders', url: /tabs\/work-orders/ },
      { tab: 'timer',       url: /tabs\/timer/ },
      { tab: 'models',      url: /tabs\/models/ },
      { tab: 'profile',     url: /tabs\/profile/ },
    ];

    for (const { tab, url } of TAB_EXPECTATIONS) {
      test(`[${user.role}] Tab click navigates to ${tab}`, async ({ page }) => {
        await page.goto(`${BASE}/tabs/dashboard`);
        await page.waitForLoadState('networkidle');

        await page.locator(`ion-tab-button[tab="${tab}"]`).click();
        await page.waitForTimeout(500);
        await expect(page).toHaveURL(url);
      });
    }

    test(`[${user.role}] Unknown route redirects to tabs`, async ({ page }) => {
      await page.goto(`${BASE}/nonexistent-route`);
      await page.waitForLoadState('networkidle');
      await expect(page).toHaveURL(/tabs/);
    });
  });
}
