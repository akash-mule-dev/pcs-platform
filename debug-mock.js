const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  // Register specific BEFORE catch-all
  await page.route('**/**/api/dashboard/summary', r => {
    console.log('MOCK HIT: summary (specific)');
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"workOrdersByStatus":[{"status":"draft","count":"5"},{"status":"completed","count":"45"}],"activeOperators":6,"todayCompletedStages":23,"avgEfficiency":87.5}' });
  });
  await page.route('**/**/api/dashboard/live-status', r => {
    console.log('MOCK HIT: live-status');
    r.fulfill({ status: 200, contentType: 'application/json', body: '[{"id":"1","user":{"firstName":"John","lastName":"Smith"},"workOrderStage":{"workOrder":{"orderNumber":"WO-001"},"stage":{"name":"Assembly","targetTimeSeconds":3600},"status":"in_progress"},"station":{"name":"St A1"},"startTime":"2026-03-10T08:00:00Z"}]' });
  });
  await page.route('**/**/api/**', r => {
    console.log('MOCK CATCH-ALL:', r.request().url());
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.goto('http://localhost:4200/login');
  await page.evaluate(() => {
    localStorage.setItem('pcs_token', 'mock');
    localStorage.setItem('pcs_user', JSON.stringify({ id: 'u4', firstName: 'Admin', lastName: 'User', email: 'a@b.com', role: { name: 'admin' } }));
  });
  await page.goto('http://localhost:4200/dashboard', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  
  const val = await page.locator('.kpi-value').first().textContent();
  console.log('KPI VALUE:', val);
  
  await browser.close();
})();
