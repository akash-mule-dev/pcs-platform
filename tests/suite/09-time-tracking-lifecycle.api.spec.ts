import { test, expect } from '@playwright/test';
import { loginAs, authHeader } from '../helpers/auth.helper';
import { createFullTestSetup, getWorkOrder } from '../helpers/test-data.helper';

/**
 * Time Tracking — the CORE feature of PCS Platform.
 * Tests the full lifecycle: clock-in → active → clock-out → history → corrections.
 */
test.describe('Time Tracking — Full Lifecycle', () => {
  test.describe.configure({ mode: 'serial' });
  let adminToken: string;
  let operatorToken: string;
  let operatorUser: any;
  let supervisorToken: string;
  let workOrderId: string;
  let workOrderStageId: string;
  let stationId: string;
  let timeEntryId: string;

  test.beforeAll(async ({ request }) => {
    ({ token: adminToken } = await loginAs(request, 'admin'));
    ({ token: operatorToken, user: operatorUser } = await loginAs(request, 'operator'));
    ({ token: supervisorToken } = await loginAs(request, 'supervisor'));

    // Create full test environment
    const setup = await createFullTestSetup(request, adminToken);
    workOrderId = setup.workOrder.id;
    stationId = setup.station.id;

    // Transition work order to in_progress so we can clock in
    await request.patch(`/api/work-orders/${workOrderId}/status`, {
      headers: authHeader(adminToken),
      data: { status: 'pending' },
    });
    await request.patch(`/api/work-orders/${workOrderId}/status`, {
      headers: authHeader(adminToken),
      data: { status: 'in_progress' },
    });

    // Get the work order stage ID
    const wo = await getWorkOrder(request, adminToken, workOrderId);
    if (wo.stages && wo.stages.length > 0) {
      workOrderStageId = wo.stages[0].id;
    }
  });

  // ── Clock In ──────────────────────────────────────────────────────────────

  test('POST /api/time-tracking/clock-in — operator can clock in (web)', async ({ request }) => {
    test.skip(!workOrderStageId, 'No work order stage available');

    const res = await request.post('/api/time-tracking/clock-in', {
      headers: authHeader(operatorToken),
      data: {
        workOrderStageId,
        stationId,
        inputMethod: 'web',
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    timeEntryId = body.data.id;
    expect(body.data.startTime).toBeTruthy();
    expect(body.data.endTime).toBeNull();
    expect(body.data.inputMethod).toBe('web');
  });

  test('POST /api/time-tracking/clock-in — admin can clock in', async ({ request }) => {
    test.skip(!workOrderStageId, 'No work order stage available');

    const wo = await getWorkOrder(request, adminToken, workOrderId);
    const secondStageId = wo.stages.length > 1 ? wo.stages[1].id : null;
    test.skip(!secondStageId, 'No second stage');

    const res = await request.post('/api/time-tracking/clock-in', {
      headers: authHeader(adminToken),
      data: {
        workOrderStageId: secondStageId,
        inputMethod: 'web',
      },
    });
    expect(res.status()).toBe(201);

    // Clock out immediately to clean up
    const entryId = (await res.json()).data.id;
    await request.post('/api/time-tracking/clock-out', {
      headers: authHeader(adminToken),
      data: { timeEntryId: entryId },
    });
  });

  test('POST /api/time-tracking/clock-in — supports mobile input method', async ({ request }) => {
    test.skip(!workOrderStageId, 'No work order stage available');

    const { token: op2Token } = await loginAs(request, 'operator2');
    const res = await request.post('/api/time-tracking/clock-in', {
      headers: authHeader(op2Token),
      data: {
        workOrderStageId,
        inputMethod: 'mobile',
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.data.inputMethod).toBe('mobile');

    // Clean up
    await request.post('/api/time-tracking/clock-out', {
      headers: authHeader(op2Token),
      data: { timeEntryId: body.data.id },
    });
  });

  test('POST /api/time-tracking/clock-in — rejects missing workOrderStageId', async ({ request }) => {
    const res = await request.post('/api/time-tracking/clock-in', {
      headers: authHeader(operatorToken),
      data: { inputMethod: 'web' },
    });
    expect(res.status()).toBe(400);
  });

  test('POST /api/time-tracking/clock-in — rejects without auth', async ({ request }) => {
    const res = await request.post('/api/time-tracking/clock-in', {
      data: { workOrderStageId: 'fake-id' },
    });
    expect(res.status()).toBe(401);
  });

  // ── Active Entries ────────────────────────────────────────────────────────

  test('GET /api/time-tracking/active — shows active entries', async ({ request }) => {
    const res = await request.get('/api/time-tracking/active', {
      headers: authHeader(adminToken),
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data)).toBeTruthy();
    // If operator clocked in, there should be at least one active entry
    if (timeEntryId) {
      const active = body.data.find((e: any) => e.id === timeEntryId);
      if (active) {
        expect(active.endTime).toBeNull();
      }
    }
  });

  test('GET /api/time-tracking/active — all roles can view', async ({ request }) => {
    for (const role of ['admin', 'manager', 'supervisor', 'operator'] as const) {
      const { token } = await loginAs(request, role);
      const res = await request.get('/api/time-tracking/active', {
        headers: authHeader(token),
      });
      expect(res.status()).toBe(200);
    }
  });

  // ── Clock Out ─────────────────────────────────────────────────────────────

  test('POST /api/time-tracking/clock-out — operator can clock out', async ({ request }) => {
    test.skip(!timeEntryId, 'No active time entry');

    const res = await request.post('/api/time-tracking/clock-out', {
      headers: authHeader(operatorToken),
      data: {
        timeEntryId,
        notes: 'Completed assembly work',
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.data.endTime).toBeTruthy();
    expect(body.data.durationSeconds).toBeGreaterThanOrEqual(0);
    expect(body.data.notes).toBe('Completed assembly work');
  });

  test('POST /api/time-tracking/clock-out — rejects missing timeEntryId', async ({ request }) => {
    const res = await request.post('/api/time-tracking/clock-out', {
      headers: authHeader(operatorToken),
      data: {},
    });
    expect(res.status()).toBe(400);
  });

  test('POST /api/time-tracking/clock-out — rejects invalid timeEntryId', async ({ request }) => {
    const res = await request.post('/api/time-tracking/clock-out', {
      headers: authHeader(operatorToken),
      data: { timeEntryId: '00000000-0000-0000-0000-000000000000' },
    });
    expect([400, 404]).toContain(res.status());
  });

  // ── History ───────────────────────────────────────────────────────────────

  test('GET /api/time-tracking/history — returns paginated history', async ({ request }) => {
    const res = await request.get('/api/time-tracking/history?page=1&limit=10', {
      headers: authHeader(adminToken),
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data)).toBeTruthy();
    expect(body.meta).toBeTruthy();
  });

  test('GET /api/time-tracking/history — filter by userId', async ({ request }) => {
    const res = await request.get(
      `/api/time-tracking/history?userId=${operatorUser.id}`,
      { headers: authHeader(adminToken) },
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    // All returned entries should belong to the operator
    for (const entry of body.data) {
      if (entry.user) {
        expect(entry.user.id).toBe(operatorUser.id);
      }
    }
  });

  test('GET /api/time-tracking/history — filter by workOrderId', async ({ request }) => {
    const res = await request.get(
      `/api/time-tracking/history?workOrderId=${workOrderId}`,
      { headers: authHeader(adminToken) },
    );
    expect(res.status()).toBe(200);
  });

  test('GET /api/time-tracking/history — filter by date range', async ({ request }) => {
    const today = new Date().toISOString().split('T')[0];
    const res = await request.get(
      `/api/time-tracking/history?startDate=${today}&endDate=${today}`,
      { headers: authHeader(adminToken) },
    );
    expect(res.status()).toBe(200);
  });

  // ── Get entries by user ───────────────────────────────────────────────────

  test('GET /api/time-tracking/user/:userId — supervisor can view operator entries', async ({ request }) => {
    const res = await request.get(
      `/api/time-tracking/user/${operatorUser.id}`,
      { headers: authHeader(supervisorToken) },
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data)).toBeTruthy();
  });

  test('GET /api/time-tracking/user/:userId — operator cannot view others entries', async ({ request }) => {
    const { user: adminUser } = await loginAs(request, 'admin');
    const res = await request.get(
      `/api/time-tracking/user/${adminUser.id}`,
      { headers: authHeader(operatorToken) },
    );
    expect(res.status()).toBe(403);
  });

  // ── Corrections ───────────────────────────────────────────────────────────

  test('PATCH /api/time-tracking/:id — supervisor can correct time entry', async ({ request }) => {
    test.skip(!timeEntryId, 'No time entry to correct');

    const res = await request.patch(`/api/time-tracking/${timeEntryId}`, {
      headers: authHeader(supervisorToken),
      data: {
        notes: 'Corrected by supervisor',
        breakSeconds: 300,
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.notes).toBe('Corrected by supervisor');
    expect(body.data.breakSeconds).toBe(300);
  });

  test('PATCH /api/time-tracking/:id — operator cannot correct time entries', async ({ request }) => {
    test.skip(!timeEntryId, 'No time entry to correct');

    const res = await request.patch(`/api/time-tracking/${timeEntryId}`, {
      headers: authHeader(operatorToken),
      data: { notes: 'Hacked' },
    });
    expect(res.status()).toBe(403);
  });

  // ── Multiple clock-in/out cycle ───────────────────────────────────────────

  test('Full clock-in/out cycle — create and complete a time entry', async ({ request }) => {
    test.skip(!workOrderStageId, 'No work order stage available');

    // Clock in
    const clockInRes = await request.post('/api/time-tracking/clock-in', {
      headers: authHeader(operatorToken),
      data: { workOrderStageId, inputMethod: 'badge' },
    });
    expect(clockInRes.status()).toBe(201);
    const entry = (await clockInRes.json()).data;
    expect(entry.inputMethod).toBe('badge');
    expect(entry.endTime).toBeNull();

    // Verify it appears in active entries
    const activeRes = await request.get('/api/time-tracking/active', {
      headers: authHeader(operatorToken),
    });
    const activeEntries = (await activeRes.json()).data;
    const found = activeEntries.find((e: any) => e.id === entry.id);
    expect(found).toBeTruthy();

    // Clock out
    const clockOutRes = await request.post('/api/time-tracking/clock-out', {
      headers: authHeader(operatorToken),
      data: { timeEntryId: entry.id, notes: 'Badge clock-out test' },
    });
    expect(clockOutRes.status()).toBe(201);
    const completed = (await clockOutRes.json()).data;
    expect(completed.endTime).toBeTruthy();
    expect(completed.durationSeconds).toBeGreaterThanOrEqual(0);

    // Verify it no longer appears in active entries
    const activeRes2 = await request.get('/api/time-tracking/active', {
      headers: authHeader(operatorToken),
    });
    const activeEntries2 = (await activeRes2.json()).data;
    const stillActive = activeEntries2.find((e: any) => e.id === entry.id);
    expect(stillActive).toBeFalsy();

    // Verify it appears in history
    const historyRes = await request.get('/api/time-tracking/history?limit=5', {
      headers: authHeader(operatorToken),
    });
    expect(historyRes.status()).toBe(200);
  });
});
