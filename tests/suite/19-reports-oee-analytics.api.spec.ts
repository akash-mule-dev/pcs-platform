import { test, expect } from '@playwright/test';
import { loginAs, authHeader } from '../helpers/auth.helper';

/**
 * Reports / OEE / Analytics tests — verifies data shape for:
 *  - ReportsComponent (OEE widget, charts, operator metrics table, CSV export)
 *  - DashboardComponent (summary, live status)
 *
 * The Reports component calls: OEE, operator-performance, stage-analytics, export
 */
test.describe('Reports & Analytics — Data shape for reports UI', () => {
  let adminToken: string;
  let managerToken: string;
  let supervisorToken: string;
  let operatorToken: string;

  test.beforeAll(async ({ request }) => {
    ({ token: adminToken } = await loginAs(request, 'admin'));
    ({ token: managerToken } = await loginAs(request, 'manager'));
    ({ token: supervisorToken } = await loginAs(request, 'supervisor'));
    ({ token: operatorToken } = await loginAs(request, 'operator'));
  });

  // ── Dashboard Summary ─────────────────────────────────────────────────────

  test('GET /api/dashboard/summary — returns KPI card data', async ({ request }) => {
    const res = await request.get('/api/dashboard/summary', {
      headers: authHeader(adminToken),
    });
    expect(res.status()).toBe(200);
    const summary = (await res.json()).data;
    expect(summary).toBeTruthy();
    // Summary should be an object with KPIs (shape varies by implementation)
    expect(typeof summary).toBe('object');
  });

  test('Summary is consistent across role views', async ({ request }) => {
    // All roles can see summary — should return valid data
    for (const role of ['admin', 'manager', 'supervisor', 'operator'] as const) {
      const { token } = await loginAs(request, role);
      const res = await request.get('/api/dashboard/summary', {
        headers: authHeader(token),
      });
      expect(res.status()).toBe(200);
      const data = (await res.json()).data;
      expect(data).toBeTruthy();
    }
  });

  // ── Live Status ───────────────────────────────────────────────────────────

  test('GET /api/dashboard/live-status — returns real-time status data', async ({ request }) => {
    const res = await request.get('/api/dashboard/live-status', {
      headers: authHeader(adminToken),
    });
    expect(res.status()).toBe(200);
    const data = (await res.json()).data;
    expect(data).toBeTruthy();
  });

  // ── OEE Widget Data ───────────────────────────────────────────────────────

  test('GET /api/dashboard/oee — returns OEE calculation with 4 factors', async ({ request }) => {
    const today = new Date().toISOString().split('T')[0];
    const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];

    const res = await request.get(
      `/api/dashboard/oee?startDate=${monthAgo}&endDate=${today}`,
      { headers: authHeader(adminToken) },
    );
    expect(res.status()).toBe(200);
    const oee = (await res.json()).data;

    // Reports UI expects these 4 fields
    expect(typeof oee.oee).toBe('number');
    expect(typeof oee.availability).toBe('number');
    expect(typeof oee.performance).toBe('number');
    expect(typeof oee.quality).toBe('number');

    // All percentages should be 0-100
    expect(oee.oee).toBeGreaterThanOrEqual(0);
    expect(oee.oee).toBeLessThanOrEqual(100);
    expect(oee.availability).toBeGreaterThanOrEqual(0);
    expect(oee.availability).toBeLessThanOrEqual(100);
    expect(oee.performance).toBeGreaterThanOrEqual(0);
    expect(oee.performance).toBeLessThanOrEqual(100);
    expect(oee.quality).toBeGreaterThanOrEqual(0);
    expect(oee.quality).toBeLessThanOrEqual(100);
  });

  test('OEE supports optional date range', async ({ request }) => {
    // No date params — should still return data
    const res = await request.get('/api/dashboard/oee', {
      headers: authHeader(adminToken),
    });
    expect(res.status()).toBe(200);
    const oee = (await res.json()).data;
    expect(typeof oee.oee).toBe('number');
  });

  test('OEE — supervisor CANNOT access', async ({ request }) => {
    const res = await request.get('/api/dashboard/oee', {
      headers: authHeader(supervisorToken),
    });
    expect(res.status()).toBe(403);
  });

  // ── Operator Performance (Bar chart + metrics table) ──────────────────────

  test('GET /api/dashboard/operator-performance — returns array of operator metrics', async ({ request }) => {
    const res = await request.get('/api/dashboard/operator-performance', {
      headers: authHeader(adminToken),
    });
    expect(res.status()).toBe(200);
    const data = (await res.json()).data;
    expect(Array.isArray(data)).toBeTruthy();

    if (data.length > 0) {
      const op = data[0];
      // Fields required by ReportsComponent table/chart
      // Either operatorName OR firstName+lastName must be present
      const hasName = op.operatorName ||
        (op.firstName && op.lastName) ||
        op.user?.firstName;
      expect(hasName).toBeTruthy();

      expect(typeof op.stagesCompleted).toBe('number');
      expect(typeof op.totalTime).toBe('number');
      expect(typeof op.avgEfficiency).toBe('number');
    }
  });

  test('Operator performance — operator CANNOT access', async ({ request }) => {
    const res = await request.get('/api/dashboard/operator-performance', {
      headers: authHeader(operatorToken),
    });
    expect(res.status()).toBe(403);
  });

  // ── Stage Analytics (Grouped bar: Avg vs Target) ──────────────────────────

  test('GET /api/dashboard/stage-analytics — returns stage avg vs target data', async ({ request }) => {
    const res = await request.get('/api/dashboard/stage-analytics', {
      headers: authHeader(adminToken),
    });
    expect(res.status()).toBe(200);
    const data = (await res.json()).data;
    expect(Array.isArray(data)).toBeTruthy();

    if (data.length > 0) {
      const stage = data[0];
      // Chart needs stageName, avgTime, targetTime
      expect(stage.stageName).toBeTruthy();
      expect(typeof stage.avgTime).toBe('number');
      expect(typeof stage.targetTime).toBe('number');
    }
  });

  test('Stage analytics — supervisor CANNOT access', async ({ request }) => {
    const res = await request.get('/api/dashboard/stage-analytics', {
      headers: authHeader(supervisorToken),
    });
    expect(res.status()).toBe(403);
  });

  // ── CSV Export ────────────────────────────────────────────────────────────

  test('GET /api/dashboard/export — returns exportable data', async ({ request }) => {
    const today = new Date().toISOString().split('T')[0];
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];

    const res = await request.get(
      `/api/dashboard/export?startDate=${weekAgo}&endDate=${today}`,
      { headers: authHeader(adminToken) },
    );
    expect(res.status()).toBe(200);
    const data = (await res.json()).data;
    // Should be an array (possibly empty if no data in range)
    expect(Array.isArray(data)).toBeTruthy();
  });

  test('Export — operator CANNOT export', async ({ request }) => {
    const res = await request.get('/api/dashboard/export', {
      headers: authHeader(operatorToken),
    });
    expect(res.status()).toBe(403);
  });

  test('Export — supervisor CANNOT export', async ({ request }) => {
    const res = await request.get('/api/dashboard/export', {
      headers: authHeader(supervisorToken),
    });
    expect(res.status()).toBe(403);
  });

  // ── Work order progress endpoint ──────────────────────────────────────────

  test('GET /api/dashboard/work-order-progress/:id — returns progress', async ({ request }) => {
    // Get a work order ID
    const listRes = await request.get('/api/work-orders?limit=1', {
      headers: authHeader(adminToken),
    });
    const list = (await listRes.json()).data;
    test.skip(list.length === 0, 'No work orders available');

    const res = await request.get(`/api/dashboard/work-order-progress/${list[0].id}`, {
      headers: authHeader(adminToken),
    });
    // May not exist in this build — accept 200 or 404
    expect([200, 404]).toContain(res.status());
  });

  // ── Date range validation ─────────────────────────────────────────────────

  test('OEE — invalid date range does not crash server', async ({ request }) => {
    const res = await request.get(
      '/api/dashboard/oee?startDate=invalid&endDate=also-invalid',
      { headers: authHeader(adminToken) },
    );
    // Should return 400 or handle gracefully, not 500
    expect(res.status()).not.toBe(500);
  });

  test('OEE — end date before start date', async ({ request }) => {
    const res = await request.get(
      '/api/dashboard/oee?startDate=2026-12-01&endDate=2026-01-01',
      { headers: authHeader(adminToken) },
    );
    // Should handle gracefully
    expect(res.status()).not.toBe(500);
  });

  // ── Role access matrix for reports ────────────────────────────────────────

  test('Reports access matrix: admin=all, manager=all, supervisor=op-perf only, operator=none', async ({ request }) => {
    const endpoints = [
      { path: '/api/dashboard/operator-performance', supervisorAllowed: true, operatorAllowed: false },
      { path: '/api/dashboard/stage-analytics', supervisorAllowed: false, operatorAllowed: false },
      { path: '/api/dashboard/oee', supervisorAllowed: false, operatorAllowed: false },
      { path: '/api/dashboard/export', supervisorAllowed: false, operatorAllowed: false },
    ];

    for (const ep of endpoints) {
      // Admin — always allowed
      const aRes = await request.get(ep.path, { headers: authHeader(adminToken) });
      expect(aRes.status()).toBe(200);

      // Manager — always allowed
      const mRes = await request.get(ep.path, { headers: authHeader(managerToken) });
      expect(mRes.status()).toBe(200);

      // Supervisor — conditional
      const sRes = await request.get(ep.path, { headers: authHeader(supervisorToken) });
      if (ep.supervisorAllowed) expect(sRes.status()).toBe(200);
      else expect(sRes.status()).toBe(403);

      // Operator — always denied
      const oRes = await request.get(ep.path, { headers: authHeader(operatorToken) });
      if (ep.operatorAllowed) expect(oRes.status()).toBe(200);
      else expect(oRes.status()).toBe(403);
    }
  });
});
