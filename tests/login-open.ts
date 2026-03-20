import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 500 });
  const page = await browser.newPage();

  await page.goto('http://localhost:54543/login');

  // Fill in credentials
  await page.fill('input[name="email"]', 'admin@pcs.local');
  await page.fill('input[name="password"]', 'password123');

  // Click Sign In
  await page.click('button[type="submit"]');

  // Wait for dashboard to load
  await page.waitForSelector('text=Dashboard', { timeout: 10000 });

  console.log('Login successful! Browser will stay open. Press Ctrl+C to close.');

  // Keep browser open
  await new Promise(() => {});
})();
