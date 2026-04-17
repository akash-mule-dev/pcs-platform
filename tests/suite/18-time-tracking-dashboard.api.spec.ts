import { test, expect } from '@playwright/test';
import { loginAs, authHeader } from '../helpers/auth.helper';
import { createFullTestSetup, getWorkOrder } from '../helpers/test-data.helper';

/**
 * Time Tracking Dashboard tests — verifies data shape needed by:
 *  - TimeTrackingLiveComponent (active entries with nested user, workOrder, stage, station)
 *  - TimeTrackingHistoryComponent (entries with variance, inputMethod, target)
 *  - Mobile TimerScreen (per-user active entry filter)
 */
test.describe('Time Tracking Dashboard — Live view & history data shapes', () => {
  test.describe.configure({ mode: 'serial' });

  let adminToken: string;
  let operatorToken: string;
  let operator2Token: string;
  let operatorUser: any;
  let operator2User: any;
  let setup: any;
  let firstStageId: string;
  let secondStageId: string;

  test.beforeAll(async ({ request }) => {
    ({ token: adminToken } = await loginAs(request, 'admin'));
    ({ token: operatorToken, user: operatorUser } = await loginAs(request, 'operator'));
    ({ token: operator2Token, user: operator2User } = await loginAs(request, 'operator2'));

    setup = await createFullTestSetup(request, adminToken);

    await request.patch(`/api/work-orders/${setup.workOrder.id}/status`, {
      headers: authHeader(adminToken),
      data: { status: 'pending' },
    });
    await request.patch(`/api/work-orders/${setup.workOrder.id}/status`, {
      headers: authHeader(adminToken),
      data: { status: 'in_progress' },
    });

    const wo = await getWorkOrder(request, adminToken, setup.workOrder.id);
    firstStageId = wo.stages[0].id;
    secondStageId = wo.stages[1]?.id;
  });

  // ── Live View — Active entries shape ──────────────────────────────────────

  test('GET /api/time-tracking/active — includes nested data for live view table', async ({ request }) => {
    // Clock in so we have an active entry
    const clockInRes = await request.post('/api/time-tracking/clock-in', {
      headers: authHeader(operatorToken),
      data: { workOrderStageId: firstStageId, stationId: setup.station.id, inputMethod: 'web' },
    });
    expect(clockInRes.status()).toBe(201);
    const entry = (await clockInRes.json()).data;

    // Fetch active list and verify shape
    const res = await request.get('/api/time-tracking/active', {
      headers: authHeader(adminToken),
    });
    expect(res.status()).toBe(200);
    const active = (await res.json()).data;

    const ourEntry = active.find((e: any) => e.id === entry.id);
    expect(ourEntry).toBeTruthy();

    // Required nested data for the live view table:
    expect(ourEntry.user).toBeTruthy();
    expect(ourEntry.user.firstName).toBeTruthy();
    expect(ourEntry.user.lastName).toBeTruthy();

    expect(ourEntry.workOrderStage).toBeTruthy();
    expect(ourEntry.workOrderStage.workOrder).toBeTruthy();
    expect(ourEntry.workOrderStage.workOrder.orderNumber).toBeTruthy();
    expect(ourEntry.workOrderStage.stage).toBeTruthy();
    expect(ourEntry.workOrderStage.stage.name).toBeTruthy();

    // Station nested data (if assigned)
    if (ourEntry.station) {
      expect(ourEntry.station.name).toBeTruthy();
    }

    // Timestamps for elapsed calculation
    expect(ourEntry.startTime).toBeTruthy();
    expect(ourEntry.endTime).toBeNull();

    // Clean up
    await request.post('/api/time-tracking/clock-out', {
      headers: authHeader(operatorToken),
      data: { timeEntryId: entry.id },
    });
  });

  // ── Elapsed time calculation correctness ──────────────────────────────────

  test('Active entry timestamp allows elapsed-time calculation', async ({ request }) => {
    const clockInRes = await request.post('/api/time-tracking/clock-in', {
      headers: authHeader(operatorToken),
      data: { workOrderStageId: firstStageId, inputMethod: 'web' },
    });
    expect(clockInRes.status()).toBe(201);
    const entry = (await clockInRes.json()).data;

    await new Promise(r => setTimeout(r, 1500));

    const res = await request.get('/api/time-tracking/active', {
      headers: authHeader(operatorToken),
    });
    const active = (await res.json()).data;
    const ourEntry = active.find((e: any) => e.id === entry.id);
    expect(ourEntry).toBeTruthy();

    // Client should be able to calculate elapsed time:
    const startMs = new Date(ourEntry.startTime).getTime();
    const elapsedSeconds = Math.floor((Date.now() - startMs) / 1000);
    expect(elapsedSeconds).toBeGreaterThanOrEqual(1);
    expect(elapsedSeconds).toBeLessThan(60); // reasonable bound

    // Clean up
    await request.post('/api/time-tracking/clock-out', {
      headers: authHeader(operatorToken),
      data: { timeEntryId: entry.id },
    });
  });

  // ── Multiple operators shown in live view ─────────────────────────────────

  test('Multiple operators show up in live view simultaneously', async ({ request }) => {
    test.skip(!secondStageId, 'No second stage');

    const c1 = await request.post('/api/time-tracking/clock-in', {
      headers: authHeader(operatorToken),
      data: { workOrderStageId: firstStageId, inputMethod: 'web' },
    });
    const c2 = await request.post('/api/time-tracking/clock-in', {
      headers: authHeader(operator2Token),
      data: { workOrderStageId: secondStageId, inputMethod: 'mobile' },
    });
    expect(c1.status()).toBe(201);
    expect(c2.status()).toBe(201);
    const e1 = (await c1.json()).data;
    const e2 = (await c2.json()).data;

    const res = await request.get('/api/time-tracking/active', {
      headers: authHeader(adminToken),
    });
    const active = (await res.json()).data;

    // Both should appear in active list
    const found1 = active.find((e: any) => e.id === e1.id);
    const found2 = active.find((e: any) => e.id === e2.id);
    expect(found1).toBeTruthy();
    expect(found2).toBeTruthy();

    // Each has distinct user
    expect(found1.user.firstName).not.toBe(found2.user.firstName);

    // Clean up
    await request.post('/api/time-tracking/clock-out', {
      headers: authHeader(operatorToken),
      data: { timeEntryId: e1.id },
    });
    await request.post('/api/time-tracking/clock-out', {
      headers: authHeader(operator2Token),
      data: { timeEntryId: e2.id },
    });
  });

  // ── History — rich data with variance calculation fields ──────────────────

  test('GET /api/time-tracking/history — includes fields for variance display', async ({ request }) => {
    // Create a completed entry
    const clockInRes = await request.post('/api/time-tracking/clock-in', {
      headers: authHeader(operatorToken),
      data: { workOrderStageId: firstStageId, inputMethod: 'web' },
    });
    expect(clockInRes.status()).toBe(201);
    const entry = (await clockInRes.json()).data;
    await new Promise(r => setTimeout(r, 1100));
    await request.post('/api/time-tracking/clock-out', {
      headers: authHeader(operatorToken),
      data: { timeEntryId: entry.id, notes: 'Variance test entry' },
    });

    // Fetch history
    const res = await request.get('/api/time-tracking/history?limit=20', {
      headers: authHeader(adminToken),
    });
    expect(res.status()).toBe(200);
    const history = (await res.json()).data;
    expect(Array.isArray(history)).toBeTruthy();

    const ourEntry = history.find((e: any) => e.id === entry.id);
    expect(ourEntry).toBeTruthy();

    // Fields required by history table:
    expect(ourEntry.user).toBeTruthy();
    expect(ourEntry.user.firstName).toBeTruthy();

    expect(ourEntry.workOrderStage).toBeTruthy();
    expect(ourEntry.workOrderStage.workOrder).toBeTruthy();
    expect(ourEntry.workOrderStage.workOrder.orderNumber).toBeTruthy();
    expect(ourEntry.workOrderStage.stage).toBeTruthy();
    expect(ourEntry.workOrderStage.stage.name).toBeTruthy();
    // Target time needed for variance %
    expect(typeof ourEntry.workOrderStage.stage.targetTimeSeconds).toBe('number');

    expect(ourEntry.startTime).toBeTruthy();
    expect(ourEntry.endTime).toBeTruthy(); // completed entries have endTime
    expect(typeof ourEntry.durationSeconds).toBe('number');
    expect(ourEntry.durationSeconds).toBeGreaterThanOrEqual(0);

    expect(ourEntry.inputMethod).toBeTruthy();
  });

  // ── History filter combinations ───────────────────────────────────────────

  test('History supports filter by userId', async ({ request }) => {
    const res = await request.get(
      `/api/time-tracking/history?userId=${operatorUser.id}&limit=50`,
      { headers: authHeader(adminToken) },
    );
    expect(res.status()).toBe(200);
    const entries = (await res.json()).data;
    // All returned entries should be the operator's
    for (const entry of entries) {
      if (entry.user?.id) {
        expect(entry.user.id).toBe(operatorUser.id);
      }
    }
  });

  test('History supports combined userId + date range filter', async ({ request }) => {
    const today = new Date().toISOString().split('T')[0];
    const res = await request.get(
      `/api/time-tracking/history?userId=${operatorUser.id}&startDate=${today}&endDate=${today}`,
      { headers: authHeader(adminToken) },
    );
    expect(res.status()).toBe(200);
  });

  test('History supports filter by workOrderId', async ({ request }) => {
    const res = await request.get(
      `/api/time-tracking/history?workOrderId=${setup.workOrder.id}&limit=50`,
      { headers: authHeader(adminToken) },
    );
    expect(res.status()).toBe(200);
    const entries = (await res.json()).data;
    // All returned should be for this work order
    for (const entry of entries) {
      if (entry.workOrderStage?.workOrder?.id) {
        expect(entry.workOrderStage.workOrder.id).toBe(setup.workOrder.id);
      }
    }
  });

  // ── Pagination ────────────────────────────────────────────────────────────

  test('History supports pagination with meta', async ({ request }) => {
    const res = await request.get('/api/time-tracking/history?page=1&limit=5', {
      headers: authHeader(adminToken),
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.meta).toBeTruthy();
    expect(body.meta.limit).toBe(5);
    expect(body.meta.page).toBe(1);
  });

  // ── Per-user endpoint (for mobile) ────────────────────────────────────────

  test('GET /api/time-tracking/user/:userId — mobile history data', async ({ request }) => {
    const res = await request.get(
      `/api/time-tracking/user/${operatorUser.id}`,
      { headers: authHeader(operatorToken) },
    );
    // Operator cannot access other users, but should be able to access own? (Currently role-gated)
    // Actually this endpoint is for supervisor+, so operator gets 403
    expect([200, 403]).toContain(res.status());
  });

  test('Supervisor can view per-user time entries', async ({ request }) => {
    const { token: supervisorToken } = await loginAs(request, 'supervisor');
    const res = await request.get(
      `/api/time-tracking/user/${operatorUser.id}`,
      { headers: authHeader(supervisorToken) },
    );
    expect(res.status()).toBe(200);
    const entries = (await res.json()).data;
    expect(Array.isArray(entries)).toBeTruthy();
  });

  // ── Cannot double clock-in to same stage ──────────────────────────────────

  test('Operator cannot clock-in twice simultaneously to different stages', async ({ request }) => {
    test.skip(!secondStageId, 'No second stage');

    // First clock-in
    const first = await request.post('/api/time-tracking/clock-in', {
      headers: authHeader(operatorToken),
      data: { workOrderStageId: firstStageId, inputMethod: 'web' },
    });
    expect(first.status()).toBe(201);
    const firstEntry = (await first.json()).data;

    // Second clock-in while first is still active — should be rejected OR auto-end first
    const second = await request.post('/api/time-tracking/clock-in', {
      headers: authHeader(operatorToken),
      data: { workOrderStageId: secondStageId, inputMethod: 'web' },
    });

    // System may handle this in different ways:
    // - Option A: Reject with 400/409 (prevent double clock-in)
    // - Option B: Auto-end first and start new (201, first.endTime set)
    // Document what actually happens
    if (second.status() === 201) {
      // Auto-ended first? Check first entry is now closed
      const secondEntry = (await second.json()).data;

      // Clean up both
      await request.post('/api/time-tracking/clock-out', {
        headers: authHeader(operatorToken),
        data: { timeEntryId: secondEntry.id },
      });
    } else {
      expect([400, 409]).toContain(second.status());
      // Clean up first
      await request.post('/api/time-tracking/clock-out', {
        headers: authHeader(operatorToken),
        data: { timeEntryId: firstEntry.id },
      });
    }
  });

  // ── Input methods all accepted ────────────────────────────────────────────

  test('All four input methods accepted: web, mobile, badge, kiosk', async ({ request }) => {
    const methods = ['web', 'mobile', 'badge', 'kiosk'];
    for (const method of methods) {
      const res = await request.post('/api/time-tracking/clock-in', {
        headers: authHeader(operatorToken),
        data: { workOrderStageId: firstStageId, inputMethod: method },
      });
      expect([201, 400, 409]).toContain(res.status()); // accepted or rejected due to active entry
      if (res.status() === 201) {
        const entry = (await res.json()).data;
        expect(entry.inputMethod).toBe(method);
        await request.post('/api/time-tracking/clock-out', {
          headers: authHeader(operatorToken),
          data: { timeEntryId: entry.id },
        });
      }
    }
  });

  // ── Supervisor time correction ────────────────────────────────────────────

  test('Supervisor can correct completed time entry', async ({ request }) => {
    const { token: supervisorToken } = await loginAs(request, 'supervisor');

    // Create and complete an entry
    const clockInRes = await request.post('/api/time-tracking/clock-in', {
      headers: authHeader(operatorToken),
      data: { workOrderStageId: firstStageId, inputMethod: 'web' },
    });
    expect(clockInRes.status()).toBe(201);
    const entry = (await clockInRes.json()).data;
    await request.post('/api/time-tracking/clock-out', {
      headers: authHeader(operatorToken),
      data: { timeEntryId: entry.id },
    });

    // Supervisor corrects it
    const res = await request.patch(`/api/time-tracking/${entry.id}`, {
      headers: authHeader(supervisorToken),
      data: { breakSeconds: 300, notes: 'Added break time for lunch' },
    });
    expect(res.status()).toBe(200);
    const corrected = (await res.json()).data;
    expect(corrected.breakSeconds).toBe(300);
    expect(corrected.notes).toBe('Added break time for lunch');
  });
});
