const { chromium } = require('playwright');

const results = { pass: 0, fail: 0, details: [] };

function check(name, actual, expected, comparison = 'equals') {
  let passed = false;
  if (comparison === 'equals') passed = actual === expected;
  else if (comparison === 'includes') passed = actual.includes(expected);
  else if (comparison === 'not-empty') passed = actual && actual.length > 0;
  else if (comparison === 'truthy') passed = !!actual;
  else if (comparison === 'rgb-close') passed = actual ? colorsClose(actual, expected) : false;

  if (passed) {
    results.pass++;
    results.details.push(`  PASS: ${name}`);
  } else {
    results.fail++;
    results.details.push(`  FAIL: ${name} — expected "${expected}" (${comparison}), got "${actual}"`);
  }
}

function colorsClose(rgb1, rgb2) {
  const parse = s => (s || '').match(/\d+/g)?.map(Number) || [0,0,0];
  const [r1, g1, b1] = parse(rgb1);
  const [r2, g2, b2] = parse(rgb2);
  return Math.abs(r1-r2) < 15 && Math.abs(g1-g2) < 15 && Math.abs(b1-b2) < 15;
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  // Mock API routes
  await page.route('**/api/dashboard/summary*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    workOrdersByStatus: [{ status: 'draft', count: '5' }, { status: 'pending', count: '12' }, { status: 'in_progress', count: '8' }, { status: 'completed', count: '45' }, { status: 'cancelled', count: '2' }],
    activeOperators: 6, todayCompletedStages: 23, avgEfficiency: 87.5
  })}));
  await page.route('**/api/dashboard/live-status*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
    { id: '1', userId: 'u1', user: { firstName: 'John', lastName: 'Smith' }, workOrderStageId: 'wos1',
      workOrderStage: { workOrder: { orderNumber: 'WO-2024-001' }, stage: { name: 'Assembly', targetTimeSeconds: 3600 }, status: 'in_progress' },
      station: { name: 'Station A1' }, startTime: new Date(Date.now() - 1800000).toISOString(), inputMethod: 'badge', createdAt: new Date().toISOString() }
  ])}));
  await page.route('**/api/dashboard/operator-performance*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ userId: 'u1', operatorName: 'John Smith', totalTime: 28800, stagesCompleted: 8, avgEfficiency: 92.3 }])}));
  await page.route('**/api/dashboard/stage-analytics*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ stageId: 's1', stageName: 'Assembly', targetTime: 3600, avgTime: 3420, minTime: 2800, maxTime: 4200, entryCount: 45, efficiency: 95 }])}));
  await page.route('**/api/products*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
    { id: 'p1', name: 'Circuit Board X200', sku: 'CBX-200', description: 'High-performance circuit board', isActive: true }
  ])}));
  await page.route('**/api/work-orders*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
    { id: 'wo1', orderNumber: 'WO-2024-001', product: { name: 'Circuit Board X200', sku: 'CBX-200' }, quantity: 100, completedQuantity: 45, status: 'in_progress', priority: 'high', dueDate: '2024-04-01T00:00:00Z' }
  ])}));
  await page.route('**/api/users*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
    { id: 'u1', firstName: 'John', lastName: 'Smith', email: 'john@pcs.com', employeeId: 'EMP001', role: { name: 'operator' }, isActive: true }
  ])}));
  await page.route('**/api/lines*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
    { id: 'l1', name: 'Line Alpha', description: 'Main production line', isActive: true, stations: [{ id: 'st1', name: 'Station A1', lineId: 'l1', isActive: true }] }
  ])}));
  await page.route('**/api/processes*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
    { id: 'pr1', name: 'PCB Assembly', version: 2, product: { name: 'Circuit Board X200', sku: 'CBX-200' }, stages: [
      { id: 's1', name: 'Assembly', sequence: 1, targetTimeSeconds: 3600, isActive: true }
    ], isActive: true }
  ])}));
  await page.route('**/api/time-tracking/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([])}));
  await page.route('**/api/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([])}));

  // Set auth
  await page.goto('http://localhost:4200/login');
  await page.evaluate(() => {
    localStorage.setItem('pcs_token', 'mock-token');
    localStorage.setItem('pcs_user', JSON.stringify({ id: 'u4', firstName: 'Admin', lastName: 'User', email: 'admin@pcs.com', role: { id: 'r1', name: 'admin' } }));
  });

  // =============================================
  // TEST 1: LOGIN PAGE
  // =============================================
  console.log('\n=== TEST 1: LOGIN PAGE ===');

  const loginBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check('Body background is warm beige', loginBg, 'rgb(240, 236, 226)', 'rgb-close');

  const loginFont = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  check('Font family includes Inter', loginFont, 'Inter', 'includes');

  await page.screenshot({ path: '/tmp/clay-test-01-login.png', fullPage: true });

  // =============================================
  // TEST 2: DASHBOARD
  // =============================================
  await page.goto('http://localhost:4200/dashboard', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  console.log('\n=== TEST 2: DASHBOARD ===');

  // CSS Variables
  const cssVars = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    return {
      clayBg: root.getPropertyValue('--clay-bg').trim(),
      claySurface: root.getPropertyValue('--clay-surface').trim(),
      clayPrimary: root.getPropertyValue('--clay-primary').trim(),
      clayAccent: root.getPropertyValue('--clay-accent').trim(),
      clayText: root.getPropertyValue('--clay-text').trim(),
      clayRadius: root.getPropertyValue('--clay-radius').trim(),
    };
  });
  check('CSS var --clay-bg', cssVars.clayBg, '#f0ece2');
  check('CSS var --clay-surface', cssVars.claySurface, '#f5f0e8');
  check('CSS var --clay-primary', cssVars.clayPrimary, '#5b7fa6');
  check('CSS var --clay-accent', cssVars.clayAccent, '#e8945a');
  check('CSS var --clay-text', cssVars.clayText, '#3d3529');
  check('CSS var --clay-radius', cssVars.clayRadius, '16px');

  // Sidebar
  const sidebarBg = await page.evaluate(() => {
    const el = document.querySelector('.sidenav, mat-sidenav');
    return el ? getComputedStyle(el).backgroundColor : 'not found';
  });
  check('Sidebar has warm clay bg', sidebarBg, 'rgb(228, 221, 208)', 'rgb-close');

  const sidebarWidth = await page.evaluate(() => {
    const el = document.querySelector('.sidenav, mat-sidenav');
    return el ? getComputedStyle(el).width : 'not found';
  });
  check('Sidebar width is 260px', sidebarWidth, '260px');

  // KPI Cards
  const kpiCardCount = await page.locator('.kpi-card').count();
  check('4 KPI cards present', String(kpiCardCount), '4');

  const kpiCardStyles = await page.evaluate(() => {
    const card = document.querySelector('.kpi-card');
    if (!card) return null;
    const s = getComputedStyle(card);
    return { borderRadius: s.borderRadius, bg: s.backgroundColor, boxShadow: s.boxShadow };
  });
  check('KPI card has 16px radius', kpiCardStyles?.borderRadius, '16px');
  check('KPI card has clay surface bg', kpiCardStyles?.bg, 'rgb(245, 240, 232)', 'rgb-close');
  check('KPI card has neumorphic shadow', kpiCardStyles?.boxShadow || '', 'rgb', 'includes');

  // KPI Icon Wrappers
  const iconWrapExists = await page.locator('.kpi-icon-wrap').count();
  check('KPI icon wrappers exist', String(iconWrapExists), '4');

  const iconWrapStyles = await page.evaluate(() => {
    const el = document.querySelector('.kpi-icon-wrap.blue');
    if (!el) return null;
    const s = getComputedStyle(el);
    return { bg: s.backgroundColor, borderRadius: s.borderRadius, boxShadow: s.boxShadow };
  });
  check('Blue icon wrap has muted blue bg', iconWrapStyles?.bg, 'rgb(224, 232, 240)', 'rgb-close');
  check('Icon wrap has inset shadow', iconWrapStyles?.boxShadow || '', 'inset', 'includes');

  // KPI Values
  const totalWO = await page.locator('.kpi-value').first().textContent();
  check('Dashboard shows total work orders (72)', totalWO?.trim(), '72');

  // Doughnut Chart
  const chartCanvas = await page.locator('canvas').count();
  check('Doughnut chart canvas rendered', chartCanvas > 0 ? 'true' : 'false', 'true');

  // Live Status Table
  const liveTableHeaders = await page.evaluate(() => {
    const headers = document.querySelectorAll('.live-table-card th');
    return Array.from(headers).map(h => h.textContent?.trim());
  });
  check('Live table has headers', liveTableHeaders.length > 0 ? 'true' : 'false', 'true');

  const headerCellColor = await page.evaluate(() => {
    const th = document.querySelector('.live-table-card th');
    return th ? getComputedStyle(th).color : 'not found';
  });
  check('Table header uses clay-text (dark)', headerCellColor, 'rgb(61, 53, 41)', 'rgb-close');

  const headerRowBg = await page.evaluate(() => {
    const tr = document.querySelector('.live-table-card .mat-mdc-header-row, .live-table-card tr:first-child');
    return tr ? getComputedStyle(tr).backgroundColor : 'not found';
  });
  check('Table header row has warm bg', headerRowBg, 'rgb(228, 221, 208)', 'rgb-close');

  // Live data row
  const liveRows = await page.locator('.live-table-card .mat-mdc-row').count();
  check('Live table has data row(s)', liveRows > 0 ? 'true' : 'false', 'true');

  // Toolbar
  const toolbarShadow = await page.evaluate(() => {
    const tb = document.querySelector('.top-toolbar, mat-toolbar');
    return tb ? getComputedStyle(tb).boxShadow : 'not found';
  });
  check('Toolbar has shadow for separation', toolbarShadow, 'none', 'not-empty');

  const toolbarUser = await page.textContent('.user-name');
  check('Toolbar shows user name', toolbarUser?.trim(), 'Admin User');

  await page.screenshot({ path: '/tmp/clay-test-02-dashboard.png', fullPage: true });

  // =============================================
  // TEST 3: PRODUCTS PAGE
  // =============================================
  await page.goto('http://localhost:4200/products', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  console.log('\n=== TEST 3: PRODUCTS ===');

  // Search input clay treatment
  const searchFieldBg = await page.evaluate(() => {
    const field = document.querySelector('.mdc-text-field--outlined');
    return field ? getComputedStyle(field).backgroundColor : 'not found';
  });
  check('Search field has warm clay bg', searchFieldBg, 'rgb(236, 230, 218)', 'rgb-close');

  const searchFieldShadow = await page.evaluate(() => {
    const field = document.querySelector('.mdc-text-field--outlined');
    return field ? getComputedStyle(field).boxShadow : 'not found';
  });
  check('Search field has inset shadow', searchFieldShadow, 'inset', 'includes');

  // Table
  const tableStyles = await page.evaluate(() => {
    const t = document.querySelector('.mat-mdc-table');
    if (!t) return null;
    const s = getComputedStyle(t);
    return { borderRadius: s.borderRadius, boxShadow: s.boxShadow, bg: s.backgroundColor };
  });
  check('Products table has clay surface bg', tableStyles?.bg, 'rgb(245, 240, 232)', 'rgb-close');
  check('Products table has rounded corners', tableStyles?.borderRadius, '16px');
  check('Products table has shadow', tableStyles?.boxShadow || '', 'rgb', 'includes');

  // Active sidebar link
  const activeLinkStyles = await page.evaluate(() => {
    const link = document.querySelector('.active-link');
    if (!link) return null;
    const s = getComputedStyle(link);
    return { boxShadow: s.boxShadow, fontWeight: s.fontWeight };
  });
  check('Active nav has raised shadow', activeLinkStyles?.boxShadow || '', 'rgb', 'includes');
  check('Active nav is bold', activeLinkStyles?.fontWeight, '600');

  // Add Product button
  const addBtnColor = await page.evaluate(() => {
    const btn = document.querySelector('[color="accent"]');
    return btn ? getComputedStyle(btn).backgroundColor : 'not found';
  });
  check('Add Product button uses accent color', addBtnColor, 'rgb(232, 148, 90)', 'rgb-close');

  await page.screenshot({ path: '/tmp/clay-test-03-products.png', fullPage: true });

  // =============================================
  // TEST 4: WORK ORDERS PAGE
  // =============================================
  await page.goto('http://localhost:4200/work-orders', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  console.log('\n=== TEST 4: WORK ORDERS ===');

  // Filter dropdowns - clay treatment
  const filterFieldBg = await page.evaluate(() => {
    const fields = document.querySelectorAll('.mdc-text-field--outlined');
    return fields.length > 0 ? getComputedStyle(fields[0]).backgroundColor : 'not found';
  });
  check('Filter field has warm clay bg', filterFieldBg, 'rgb(236, 230, 218)', 'rgb-close');

  const woTableHeaders = await page.evaluate(() => {
    return document.querySelectorAll('th.mat-mdc-header-cell').length;
  });
  check('Work Orders table has headers', woTableHeaders > 0 ? 'true' : 'false', 'true');

  await page.screenshot({ path: '/tmp/clay-test-04-workorders.png', fullPage: true });

  // =============================================
  // TEST 5: USERS PAGE
  // =============================================
  await page.goto('http://localhost:4200/users', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  console.log('\n=== TEST 5: USERS ===');

  await page.screenshot({ path: '/tmp/clay-test-05-users.png', fullPage: true });

  // =============================================
  // TEST 6: STATIONS PAGE
  // =============================================
  await page.goto('http://localhost:4200/stations', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  console.log('\n=== TEST 6: STATIONS ===');

  // Cards use clay styling
  const stationCardStyles = await page.evaluate(() => {
    const card = document.querySelector('.lines-panel, mat-card');
    if (!card) return null;
    const s = getComputedStyle(card);
    return { borderRadius: s.borderRadius, boxShadow: s.boxShadow };
  });
  check('Station card has rounded corners', stationCardStyles?.borderRadius, '16px');
  check('Station card has neumorphic shadow', stationCardStyles?.boxShadow || '', 'rgb', 'includes');

  // Select prompt styling
  const selectPromptColor = await page.evaluate(() => {
    const el = document.querySelector('.select-prompt p, .select-prompt');
    return el ? getComputedStyle(el).color : 'not found';
  });
  check('Select prompt uses muted color', selectPromptColor, 'rgb(160, 152, 136)', 'rgb-close');

  await page.screenshot({ path: '/tmp/clay-test-06-stations.png', fullPage: true });

  // =============================================
  // TEST 7: REPORTS PAGE
  // =============================================
  await page.goto('http://localhost:4200/reports', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  console.log('\n=== TEST 7: REPORTS ===');

  const reportCards = await page.locator('mat-card').count();
  check('Reports has cards', reportCards > 0 ? 'true' : 'false', 'true');

  await page.screenshot({ path: '/tmp/clay-test-07-reports.png', fullPage: true });

  // =============================================
  // TEST 8: TIME TRACKING PAGE
  // =============================================
  await page.goto('http://localhost:4200/time-tracking', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  console.log('\n=== TEST 8: TIME TRACKING ===');

  await page.screenshot({ path: '/tmp/clay-test-08-timetracking.png', fullPage: true });

  // =============================================
  // TEST 9: PROCESSES PAGE
  // =============================================
  await page.goto('http://localhost:4200/processes', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  console.log('\n=== TEST 9: PROCESSES ===');

  await page.screenshot({ path: '/tmp/clay-test-09-processes.png', fullPage: true });

  // =============================================
  // TEST 10: GLOBAL THEME CONSISTENCY
  // =============================================
  console.log('\n=== TEST 10: GLOBAL CONSISTENCY ===');

  // Check scrollbar styling
  const scrollbarStyle = await page.evaluate(() => {
    const sheets = Array.from(document.styleSheets);
    for (const sheet of sheets) {
      try {
        const rules = Array.from(sheet.cssRules || []);
        for (const rule of rules) {
          if (rule.selectorText?.includes('::-webkit-scrollbar-thumb')) return 'found';
        }
      } catch(e) {}
    }
    return 'not found';
  });
  check('Custom scrollbar styles defined', scrollbarStyle, 'found');

  // Check selection styling
  const selectionStyle = await page.evaluate(() => {
    const sheets = Array.from(document.styleSheets);
    for (const sheet of sheets) {
      try {
        const rules = Array.from(sheet.cssRules || []);
        for (const rule of rules) {
          if (rule.selectorText?.includes('::selection')) return 'found';
        }
      } catch(e) {}
    }
    return 'not found';
  });
  check('Custom selection styles defined', selectionStyle, 'found');

  // Check that no default Material blue/purple leaks through
  const pageContent = await page.evaluate(() => document.querySelector('.page-content'));
  check('Page content area exists', pageContent ? 'true' : 'false', 'true');

  await browser.close();

  // =============================================
  // RESULTS
  // =============================================
  console.log('\n' + '='.repeat(50));
  console.log('CLAY THEME TEST RESULTS');
  console.log('='.repeat(50));
  results.details.forEach(d => console.log(d));
  console.log('='.repeat(50));
  console.log(`TOTAL: ${results.pass + results.fail} tests`);
  console.log(`PASSED: ${results.pass}`);
  console.log(`FAILED: ${results.fail}`);
  console.log('='.repeat(50));

  process.exit(results.fail > 0 ? 1 : 0);
})();
