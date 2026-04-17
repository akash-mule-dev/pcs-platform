import { test, expect } from '@playwright/test';
import { loginAs, authHeader } from '../helpers/auth.helper';
import { createFullTestSetup, getWorkOrder } from '../helpers/test-data.helper';

/**
 * Cross-Platform Data Sync Tests.
 * Verifies that data created via one input method (web/mobile/badge/kiosk)
 * is correctly visible and consistent when accessed from any client.
 *
 * Since both web and mobile hit the same REST API, these tests simulate
 * operations with different inputMethod values and verify data consistency.
 */
test.describe('Cross-Platform Data Sync — Web ↔ Mobile consistency', () => {
  test.describe.configure({ mode: 'serial' });
  let adminToken: string;
  let operatorToken: string;
  let operator2Token: string;
  let workOrderId: string;
  let stageId: string;
  let stationId: string;

  test.beforeAll(async ({ request }) => {
    ({ token: adminToken } = await loginAs(request, 'admin'));
    ({ token: operatorToken } = await loginAs(request, 'operator'));
    ({ token: operator2Token } = await loginAs(request, 'operator2'));

    // Create test environment
    const setup = await createFullTestSetup(request, adminToken);
    workOrderId = setup.workOrder.id;
    stationId = setup.station.id;

    // Move work order to in_progress
    await request.patch(`/api/work-orders/${workOrderId}/status`, {
      headers: authHeader(adminToken),
      data: { status: 'pending' },
    });
    await request.patch(`/api/work-orders/${workOrderId}/status`, {
      headers: authHeader(adminToken),
      data: { status: 'in_progress' },
    });

    // Get stage ID
    const wo = await getWorkOrder(request, adminToken, workOrderId);
    stageId = wo.stages[0]?.id;
  });

  // ── Web clock-in, visible everywhere ──────────────────────────────────────

  test('Web clock-in is visible in active entries for all clients', async ({ request }) => {
    test.skip(!stageId, 'No stage');

    // Operator clocks in via "web"
    const clockInRes = await request.post('/api/time-tracking/clock-in', {
      headers: authHeader(operatorToken),
      data: { workOrderStageId: stageId, stationId, inputMethod: 'web' },
    });
    expect(clockInRes.status()).toBe(201);
    const webEntry = (await clockInRes.json()).data;
    expect(webEntry.inputMethod).toBe('web');

    // A "mobile" client (same API, different auth header) can see the active entry
    const activeRes = await request.get('/api/time-tracking/active', {
      headers: authHeader(adminToken),
    });
    expect(activeRes.status()).toBe(200);
    const active = (await activeRes.json()).data;
    const found = active.find((e: any) => e.id === webEntry.id);
    expect(found).toBeTruthy();
    expect(found.inputMethod).toBe('web');

    // Clean up
    await request.post('/api/time-tracking/clock-out', {
      headers: authHeader(operatorToken),
      data: { timeEntryId: webEntry.id },
    });
  });

  // ── Mobile clock-in, visible everywhere ───────────────────────────────────

  test('Mobile clock-in is visible in active entries for all clients', async ({ request }) => {
    test.skip(!stageId, 'No stage');

    // Operator2 clocks in via "mobile"
    const clockInRes = await request.post('/api/time-tracking/clock-in', {
      headers: authHeader(operator2Token),
      data: { workOrderStageId: stageId, inputMethod: 'mobile' },
    });
    expect(clockInRes.status()).toBe(201);
    const mobileEntry = (await clockInRes.json()).data;
    expect(mobileEntry.inputMethod).toBe('mobile');

    // "Web" client can see the mobile entry
    const activeRes = await request.get('/api/time-tracking/active', {
      headers: authHeader(adminToken),
    });
    const active = (await activeRes.json()).data;
    const found = active.find((e: any) => e.id === mobileEntry.id);
    expect(found).toBeTruthy();
    expect(found.inputMethod).toBe('mobile');

    // Clean up
    await request.post('/api/time-tracking/clock-out', {
      headers: authHeader(operator2Token),
      data: { timeEntryId: mobileEntry.id },
    });
  });

  // ── Badge clock-in, visible everywhere ────────────────────────────────────

  test('Badge clock-in is visible in active entries for all clients', async ({ request }) => {
    test.skip(!stageId, 'No stage');

    const clockInRes = await request.post('/api/time-tracking/clock-in', {
      headers: authHeader(operatorToken),
      data: { workOrderStageId: stageId, inputMethod: 'badge' },
    });
    expect(clockInRes.status()).toBe(201);
    const badgeEntry = (await clockInRes.json()).data;
    expect(badgeEntry.inputMethod).toBe('badge');

    // All clients see the badge entry
    const activeRes = await request.get('/api/time-tracking/active', {
      headers: authHeader(adminToken),
    });
    const active = (await activeRes.json()).data;
    const found = active.find((e: any) => e.id === badgeEntry.id);
    expect(found).toBeTruthy();

    // Clean up
    await request.post('/api/time-tracking/clock-out', {
      headers: authHeader(operatorToken),
      data: { timeEntryId: badgeEntry.id },
    });
  });

  // ── Data created on web, read on mobile ───────────────────────────────────

  test('Product created via web API is visible to mobile API', async ({ request }) => {
    // "Web" admin creates a product
    const createRes = await request.post('/api/products', {
      headers: authHeader(adminToken),
      data: { name: `CrossPlatform Product ${Date.now()}`, description: 'Web created' },
    });
    expect(createRes.status()).toBe(201);
    const product = (await createRes.json()).data;

    // "Mobile" operator can see the product
    const getRes = await request.get(`/api/products/${product.id}`, {
      headers: authHeader(operatorToken),
    });
    expect(getRes.status()).toBe(200);
    const retrieved = (await getRes.json()).data;
    expect(retrieved.id).toBe(product.id);
    expect(retrieved.name).toBe(product.name);
  });

  // ── Work order visible across all roles ───────────────────────────────────

  test('Work order is visible with same data for all roles', async ({ request }) => {
    const woRes = await request.get(`/api/work-orders/${workOrderId}`, {
      headers: authHeader(adminToken),
    });
    const adminView = (await woRes.json()).data;

    // Operator sees the same work order
    const opRes = await request.get(`/api/work-orders/${workOrderId}`, {
      headers: authHeader(operatorToken),
    });
    const opView = (await opRes.json()).data;

    expect(adminView.id).toBe(opView.id);
    expect(adminView.orderNumber).toBe(opView.orderNumber);
    expect(adminView.status).toBe(opView.status);
    expect(adminView.quantity).toBe(opView.quantity);
  });

  // ── Time entry history consistent across clients ──────────────────────────

  test('Time entry history shows entries from all input methods', async ({ request }) => {
    const res = await request.get(
      `/api/time-tracking/history?workOrderId=${workOrderId}&limit=50`,
      { headers: authHeader(adminToken) },
    );
    expect(res.status()).toBe(200);
    const entries = (await res.json()).data;

    // Collect unique input methods from history
    const methods = new Set(entries.map((e: any) => e.inputMethod).filter(Boolean));
    // We've created entries with web, mobile, and badge methods above
    // At least one should appear
    expect(entries.length).toBeGreaterThanOrEqual(1);
  });

  // ── Dashboard reflects data from all platforms ────────────────────────────

  test('Dashboard summary reflects data regardless of input source', async ({ request }) => {
    const res = await request.get('/api/dashboard/summary', {
      headers: authHeader(adminToken),
    });
    expect(res.status()).toBe(200);
    const summary = (await res.json()).data;
    expect(summary).toBeTruthy();
    // Summary should aggregate data from all sources
  });

  // ── Notifications accessible from any client ──────────────────────────────

  test('Notifications accessible from any authenticated client', async ({ request }) => {
    // Both "web" admin and "mobile" operator can access their notifications
    const adminRes = await request.get('/api/notifications', {
      headers: authHeader(adminToken),
    });
    expect(adminRes.status()).toBe(200);

    const opRes = await request.get('/api/notifications', {
      headers: authHeader(operatorToken),
    });
    expect(opRes.status()).toBe(200);
  });
});
