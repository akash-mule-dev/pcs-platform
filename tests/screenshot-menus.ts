import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 300 });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  // Login first
  await page.goto('http://localhost:54543/login');
  await page.fill('input[name="email"]', 'admin@pcs.local');
  await page.fill('input[name="password"]', 'password123');
  await page.click('button[type="submit"]');
  await page.waitForSelector('text=Dashboard', { timeout: 10000 });

  const menus = [
    'Dashboard',
    'Products',
    'Processes',
    'Work Orders',
    'Time Tracking',
    'Users',
    'Stations',
    'Reports',
  ];

  for (const menu of menus) {
    await page.click(`text=${menu}`);
    await page.waitForTimeout(1500);
    const filename = menu.toLowerCase().replace(/\s+/g, '-');
    await page.screenshot({ path: `test-results/${filename}.png`, fullPage: true });
    console.log(`Screenshot saved: test-results/${filename}.png`);
  }

  console.log('All screenshots taken!');
  await browser.close();
})();
