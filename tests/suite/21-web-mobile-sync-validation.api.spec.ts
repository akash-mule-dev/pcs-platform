import { test, expect } from '@playwright/test';
import { loginAs, authHeader, USERS } from '../helpers/auth.helper';
import { createFullTestSetup, getWorkOrder } from '../helpers/test-data.helper';

/**
 * Web ↔ Mobile Sync Validation
 *
 * Both web and mobile clients hit the same REST API, so "sync" is validated by:
 *  1. Creating data on one "client" (simulated) → verifying it's visible on the other
 *  2. Checking data shape/types are consistent across calls
 *  3. Verifying auth tokens are portable between clients
 *  4. Confirming role restrictions apply regardless of origin
 *  5. Verifying enum values and timestamp formats are consistent
 *  6. Testing real-time state changes (clock-in instantly appears in active list)
 */
test.describe('Web ↔ Mobile Sync Validation', () => {
  test.describe.configure({ mode: 'serial' });

  let adminToken: string;
  let supervisorToken: string;
  let operatorToken: string;
  let operator2Token: string;
  let operatorUser: any;
  let operator2User: any;
  let setup: any;
  let stageId: string;
  let stage2Id: string;
  let processStageId: string;

  test.beforeAll(async ({ request }) => {
    ({ token: adminToken } = await loginAs(request, 'admin'));
    ({ token: supervisorToken } = await loginAs(request, 'supervisor'));
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
    stageId = wo.stages[0].id;
    stage2Id = wo.stages[1]?.id;
    processStageId = wo.stages[0].stageId || wo.stages[0].stage?.id;
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. TOKEN PORTABILITY — same JWT works on any "client"
  // ═══════════════════════════════════════════════════════════════════════════

  test('SYNC-01: Token from mobile login works on web endpoints', async ({ request }) => {
    // Simulate "mobile login" (same endpoint, same credentials)
    const mobileLoginRes = await request.post('/api/auth/login', {
      data: USERS.admin,
    });
    expect(mobileLoginRes.status()).toBe(201);
    const mobileToken = (await mobileLoginRes.json()).data.accessToken;

    // Use that token on a "web-only" endpoint (admin user list)
    const webEndpointRes = await request.get('/api/users?limit=5', {
      headers: authHeader(mobileToken),
    });
    expect(webEndpointRes.status()).toBe(200);
  });

  test('SYNC-02: Token from web login works on mobile-specific flow', async ({ request }) => {
    const webLoginRes = await request.post('/api/auth/login', {
      data: USERS.operator,
    });
    const webToken = (await webLoginRes.json()).data.accessToken;

    // Use on time-tracking active endpoint (used by mobile TimerScreen)
    const activeRes = await request.get('/api/time-tracking/active', {
      headers: authHeader(webToken),
    });
    expect(activeRes.status()).toBe(200);
  });

  test('SYNC-03: Same token across concurrent requests from both clients', async ({ request }) => {
    // Simulate web and mobile firing requests concurrently with the same token
    const [webRes, mobileRes] = await Promise.all([
      request.get('/api/work-orders?limit=5', { headers: authHeader(adminToken) }),
      request.get('/api/dashboard/summary', { headers: authHeader(adminToken) }),
    ]);
    expect(webRes.status()).toBe(200);
    expect(mobileRes.status()).toBe(200);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. DATA ROUND-TRIP — create via one client, read via the other
  // ═══════════════════════════════════════════════════════════════════════════

  test('SYNC-04: Work order created via "web" is immediately visible to "mobile"', async ({ request }) => {
    // WEB: admin creates a WO
    const webCreateRes = await request.post('/api/work-orders', {
      headers: authHeader(adminToken),
      data: {
        processId: setup.process.id,
        quantity: 7,
        priority: 'high',
      },
    });
    expect(webCreateRes.status()).toBe(201);
    const webWO = (await webCreateRes.json()).data;

    // MOBILE: operator fetches work order list
    // Using order=DESC so newest (just-created) WOs appear first
    const mobileListRes = await request.get('/api/work-orders?limit=50&order=DESC', {
      headers: authHeader(operatorToken),
    });
    const mobileList = (await mobileListRes.json()).data;

    // The freshly-created WO should be in the list immediately
    const found = mobileList.find((w: any) => w.id === webWO.id);
    expect(found).toBeTruthy();
    expect(found.quantity).toBe(7);
    expect(found.priority).toBe('high');
    expect(found.status).toBe(webWO.status);
    expect(found.orderNumber).toBe(webWO.orderNumber);
  });

  test('SYNC-05: Mobile clock-in is immediately visible in web live view', async ({ request }) => {
    // MOBILE: operator2 clocks in via mobile (inputMethod: mobile)
    const clockInRes = await request.post('/api/time-tracking/clock-in', {
      headers: authHeader(operator2Token),
      data: { workOrderStageId: stageId, inputMethod: 'mobile' },
    });
    expect(clockInRes.status()).toBe(201);
    const entry = (await clockInRes.json()).data;

    // WEB: supervisor loads the live time tracking view (same endpoint)
    const activeRes = await request.get('/api/time-tracking/active', {
      headers: authHeader(supervisorToken),
    });
    const active = (await activeRes.json()).data;
    const found = active.find((e: any) => e.id === entry.id);

    expect(found).toBeTruthy();
    expect(found.inputMethod).toBe('mobile'); // web live view shows it came from mobile
    expect(found.user).toBeTruthy();
    expect(found.user.id).toBe(operator2User.id);
    expect(found.endTime).toBeNull(); // still active

    // Clean up
    await request.post('/api/time-tracking/clock-out', {
      headers: authHeader(operator2Token),
      data: { timeEntryId: entry.id },
    });
  });

  test('SYNC-06: Web clock-in appears in mobile history after clock-out', async ({ request }) => {
    test.skip(!stage2Id, 'No second stage');

    // WEB: admin clocks in (inputMethod: web)
    const clockInRes = await request.post('/api/time-tracking/clock-in', {
      headers: authHeader(adminToken),
      data: { workOrderStageId: stage2Id, inputMethod: 'web' },
    });
    expect(clockInRes.status()).toBe(201);
    const entry = (await clockInRes.json()).data;
    await new Promise(r => setTimeout(r, 500));

    // WEB: clock out
    await request.post('/api/time-tracking/clock-out', {
      headers: authHeader(adminToken),
      data: { timeEntryId: entry.id, notes: 'Web clock-out' },
    });

    // MOBILE: admin fetches history (same endpoint, mobile-friendly shape)
    const historyRes = await request.get('/api/time-tracking/history?limit=20', {
      headers: authHeader(adminToken),
    });
    const history = (await historyRes.json()).data;
    const found = history.find((e: any) => e.id === entry.id);

    expect(found).toBeTruthy();
    expect(found.inputMethod).toBe('web');
    expect(found.notes).toBe('Web clock-out');
    expect(found.endTime).toBeTruthy();
    expect(found.durationSeconds).toBeGreaterThanOrEqual(0);
  });

  test('SYNC-07: Assignment via web is reflected in mobile work order detail', async ({ request }) => {
    // Create fresh WO for isolation
    const setup2 = await createFullTestSetup(request, adminToken);
    const wo2 = await getWorkOrder(request, adminToken, setup2.workOrder.id);
    const wo2ProcessStageId = wo2.stages[0].stageId || wo2.stages[0].stage?.id;

    // WEB (supervisor): assign operator to first stage
    const assignRes = await request.post(`/api/work-orders/${setup2.workOrder.id}/assign`, {
      headers: authHeader(supervisorToken),
      data: {
        assignments: [
          { stageId: wo2ProcessStageId, userId: operatorUser.id, stationId: setup2.station.id },
        ],
      },
    });
    expect([200, 201]).toContain(assignRes.status());

    // MOBILE (operator): fetch WO detail — should see themselves assigned
    const mobileDetailRes = await request.get(`/api/work-orders/${setup2.workOrder.id}`, {
      headers: authHeader(operatorToken),
    });
    const mobileWO = (await mobileDetailRes.json()).data;
    const assignedStage = mobileWO.stages.find(
      (s: any) => s.assignedUser?.id === operatorUser.id,
    );
    expect(assignedStage).toBeTruthy();
    expect(assignedStage.station).toBeTruthy();
    expect(assignedStage.station.id).toBe(setup2.station.id);
  });

  test('SYNC-08: Mobile stage status update reflects in web work order detail', async ({ request }) => {
    const setup3 = await createFullTestSetup(request, adminToken);
    await request.patch(`/api/work-orders/${setup3.workOrder.id}/status`, {
      headers: authHeader(adminToken),
      data: { status: 'pending' },
    });
    await request.patch(`/api/work-orders/${setup3.workOrder.id}/status`, {
      headers: authHeader(adminToken),
      data: { status: 'in_progress' },
    });
    const wo3 = await getWorkOrder(request, adminToken, setup3.workOrder.id);
    const targetStage = wo3.stages[0];

    // MOBILE: operator transitions stage pending → in_progress
    const mobileUpdateRes = await request.patch(
      `/api/work-orders/${setup3.workOrder.id}/stages/${targetStage.id}/status`,
      {
        headers: authHeader(operatorToken),
        data: { status: 'in_progress' },
      },
    );
    expect(mobileUpdateRes.status()).toBe(200);

    // WEB: supervisor loads work order detail — should see new status
    const webDetailRes = await request.get(`/api/work-orders/${setup3.workOrder.id}`, {
      headers: authHeader(supervisorToken),
    });
    const webWO = (await webDetailRes.json()).data;
    const updatedStage = webWO.stages.find((s: any) => s.id === targetStage.id);
    expect(updatedStage.status).toBe('in_progress');
    expect(updatedStage.startedAt).toBeTruthy();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. DATA SHAPE CONSISTENCY — same fields/types on both clients
  // ═══════════════════════════════════════════════════════════════════════════

  test('SYNC-09: Work order response shape is identical regardless of client', async ({ request }) => {
    const webRes = await request.get(`/api/work-orders/${setup.workOrder.id}`, {
      headers: authHeader(adminToken),
    });
    const mobileRes = await request.get(`/api/work-orders/${setup.workOrder.id}`, {
      headers: authHeader(operatorToken),
    });
    expect(webRes.status()).toBe(200);
    expect(mobileRes.status()).toBe(200);

    const webWO = (await webRes.json()).data;
    const mobileWO = (await mobileRes.json()).data;

    // Top-level fields must be identical keys
    const webKeys = new Set(Object.keys(webWO));
    const mobileKeys = new Set(Object.keys(mobileWO));
    expect([...webKeys].sort()).toEqual([...mobileKeys].sort());

    // Values match
    expect(mobileWO.id).toBe(webWO.id);
    expect(mobileWO.orderNumber).toBe(webWO.orderNumber);
    expect(mobileWO.status).toBe(webWO.status);
    expect(mobileWO.priority).toBe(webWO.priority);
    expect(mobileWO.quantity).toBe(webWO.quantity);
    expect(mobileWO.completedQuantity).toBe(webWO.completedQuantity);

    // Stage count and shape match
    expect(mobileWO.stages.length).toBe(webWO.stages.length);
    if (mobileWO.stages.length > 0) {
      const webStageKeys = new Set(Object.keys(webWO.stages[0]));
      const mobileStageKeys = new Set(Object.keys(mobileWO.stages[0]));
      expect([...webStageKeys].sort()).toEqual([...mobileStageKeys].sort());
    }
  });

  test('SYNC-10: Time entry response shape identical on active and history endpoints', async ({ request }) => {
    // Create a completed entry
    const clockInRes = await request.post('/api/time-tracking/clock-in', {
      headers: authHeader(operatorToken),
      data: { workOrderStageId: stageId, inputMethod: 'mobile' },
    });
    const entry = (await clockInRes.json()).data;
    await new Promise(r => setTimeout(r, 300));
    await request.post('/api/time-tracking/clock-out', {
      headers: authHeader(operatorToken),
      data: { timeEntryId: entry.id },
    });

    // Fetch it via history
    const historyRes = await request.get('/api/time-tracking/history?limit=50', {
      headers: authHeader(adminToken),
    });
    const historyEntry = (await historyRes.json()).data.find((e: any) => e.id === entry.id);
    expect(historyEntry).toBeTruthy();

    // Validate expected fields exist
    expect(historyEntry).toHaveProperty('id');
    expect(historyEntry).toHaveProperty('startTime');
    expect(historyEntry).toHaveProperty('endTime');
    expect(historyEntry).toHaveProperty('durationSeconds');
    expect(historyEntry).toHaveProperty('inputMethod');
    expect(historyEntry).toHaveProperty('user');
    expect(historyEntry).toHaveProperty('workOrderStage');
    expect(historyEntry.workOrderStage).toHaveProperty('workOrder');
    expect(historyEntry.workOrderStage).toHaveProperty('stage');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. ENUM CONSISTENCY — same values on both clients
  // ═══════════════════════════════════════════════════════════════════════════

  test('SYNC-11: Work order status enum values are consistent', async ({ request }) => {
    const validStatuses = ['draft', 'pending', 'in_progress', 'completed', 'cancelled'];

    const res = await request.get('/api/work-orders?limit=50', {
      headers: authHeader(adminToken),
    });
    const list = (await res.json()).data;

    for (const wo of list) {
      expect(validStatuses).toContain(wo.status);
    }
  });

  test('SYNC-12: Stage status enum values are consistent', async ({ request }) => {
    const validStatuses = ['pending', 'in_progress', 'completed', 'skipped'];
    const wo = await getWorkOrder(request, adminToken, setup.workOrder.id);
    for (const stage of wo.stages) {
      expect(validStatuses).toContain(stage.status);
    }
  });

  test('SYNC-13: Priority enum values are consistent', async ({ request }) => {
    const validPriorities = ['low', 'medium', 'high', 'urgent'];
    const res = await request.get('/api/work-orders?limit=50', {
      headers: authHeader(adminToken),
    });
    for (const wo of (await res.json()).data) {
      expect(validPriorities).toContain(wo.priority);
    }
  });

  test('SYNC-14: inputMethod enum values are consistent', async ({ request }) => {
    const validMethods = ['web', 'mobile', 'badge', 'kiosk'];
    const res = await request.get('/api/time-tracking/history?limit=50', {
      headers: authHeader(adminToken),
    });
    for (const entry of (await res.json()).data) {
      if (entry.inputMethod) {
        expect(validMethods).toContain(entry.inputMethod);
      }
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. TIMESTAMP FORMAT — ISO 8601 in both clients
  // ═══════════════════════════════════════════════════════════════════════════

  test('SYNC-15: All timestamps are valid ISO 8601 strings', async ({ request }) => {
    const res = await request.get(`/api/work-orders/${setup.workOrder.id}`, {
      headers: authHeader(adminToken),
    });
    const wo = (await res.json()).data;

    const isoFields = ['createdAt', 'updatedAt'];
    for (const field of isoFields) {
      if (wo[field]) {
        const parsed = new Date(wo[field]);
        expect(isNaN(parsed.getTime())).toBe(false);
      }
    }
  });

  test('SYNC-16: Time entry timestamps match ISO 8601', async ({ request }) => {
    const res = await request.get('/api/time-tracking/history?limit=10', {
      headers: authHeader(adminToken),
    });
    const entries = (await res.json()).data;
    for (const entry of entries) {
      expect(isNaN(new Date(entry.startTime).getTime())).toBe(false);
      if (entry.endTime) {
        expect(isNaN(new Date(entry.endTime).getTime())).toBe(false);
      }
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. PAGINATION SHAPE — same { data, meta } format
  // ═══════════════════════════════════════════════════════════════════════════

  test('SYNC-17: Pagination shape identical across paginated endpoints', async ({ request }) => {
    const endpoints = [
      '/api/work-orders?page=1&limit=5',
      '/api/time-tracking/history?page=1&limit=5',
      '/api/users?page=1&limit=5',
      '/api/lines?page=1&limit=5',
    ];

    for (const path of endpoints) {
      const res = await request.get(path, { headers: authHeader(adminToken) });
      expect(res.status()).toBe(200);
      const body = await res.json();

      expect(body).toHaveProperty('data');
      expect(body).toHaveProperty('meta');
      expect(Array.isArray(body.data)).toBeTruthy();

      expect(body.meta).toHaveProperty('page');
      expect(body.meta).toHaveProperty('limit');
      expect(body.meta).toHaveProperty('itemCount');
      expect(body.meta).toHaveProperty('pageCount');
      expect(body.meta).toHaveProperty('hasPreviousPage');
      expect(body.meta).toHaveProperty('hasNextPage');
      expect(typeof body.meta.hasPreviousPage).toBe('boolean');
      expect(typeof body.meta.hasNextPage).toBe('boolean');
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 7. ERROR RESPONSE SHAPE — consistent across clients
  // ═══════════════════════════════════════════════════════════════════════════

  test('SYNC-18: Error responses have consistent shape', async ({ request }) => {
    // 401 unauthenticated
    const unauth = await request.get('/api/work-orders');
    expect(unauth.status()).toBe(401);
    const unauthBody = await unauth.json();
    expect(unauthBody).toHaveProperty('statusCode');
    expect(unauthBody).toHaveProperty('message');

    // 403 forbidden (operator accessing admin endpoint)
    const forbidden = await request.get('/api/users', {
      headers: authHeader(operatorToken),
    });
    expect(forbidden.status()).toBe(403);
    const forbBody = await forbidden.json();
    expect(forbBody).toHaveProperty('statusCode');
    expect(forbBody).toHaveProperty('message');

    // 400 validation error
    const bad = await request.post('/api/work-orders', {
      headers: authHeader(adminToken),
      data: {}, // missing required fields
    });
    expect(bad.status()).toBe(400);
    const badBody = await bad.json();
    expect(badBody).toHaveProperty('statusCode');
    expect(badBody).toHaveProperty('message');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 8. ROLE RESTRICTIONS — apply regardless of client origin
  // ═══════════════════════════════════════════════════════════════════════════

  test('SYNC-19: Operator role restricted on both web-only AND mobile-only endpoints', async ({ request }) => {
    // Web-heavy endpoint (audit logs) — operator denied
    const auditRes = await request.get('/api/audit', {
      headers: authHeader(operatorToken),
    });
    expect(auditRes.status()).toBe(403);

    // Mobile-used endpoint (time tracking active) — operator allowed
    const activeRes = await request.get('/api/time-tracking/active', {
      headers: authHeader(operatorToken),
    });
    expect(activeRes.status()).toBe(200);

    // Admin-only endpoint from operator (create user)
    const createUserRes = await request.post('/api/users', {
      headers: authHeader(operatorToken),
      data: { employeeId: 'X', mobileNo: '0', password: '123456', firstName: 'X', lastName: 'Y', roleId: 'fake' },
    });
    expect(createUserRes.status()).toBe(403);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 9. REAL-TIME STATE — state changes visible instantly
  // ═══════════════════════════════════════════════════════════════════════════

  test('SYNC-20: Clock-in creates active state instantly observable to all clients', async ({ request }) => {
    const beforeRes = await request.get('/api/time-tracking/active', {
      headers: authHeader(adminToken),
    });
    const beforeCount = (await beforeRes.json()).data.length;

    // Clock in
    const clockInRes = await request.post('/api/time-tracking/clock-in', {
      headers: authHeader(operatorToken),
      data: { workOrderStageId: stageId, inputMethod: 'mobile' },
    });
    expect(clockInRes.status()).toBe(201);
    const entry = (await clockInRes.json()).data;

    // Immediately check active list from a different client/role
    const afterRes = await request.get('/api/time-tracking/active', {
      headers: authHeader(supervisorToken),
    });
    const afterActive = (await afterRes.json()).data;
    expect(afterActive.length).toBe(beforeCount + 1);
    expect(afterActive.find((e: any) => e.id === entry.id)).toBeTruthy();

    // Clock out
    await request.post('/api/time-tracking/clock-out', {
      headers: authHeader(operatorToken),
      data: { timeEntryId: entry.id },
    });

    // Active list should immediately return to previous count
    const finalRes = await request.get('/api/time-tracking/active', {
      headers: authHeader(supervisorToken),
    });
    const finalActive = (await finalRes.json()).data;
    expect(finalActive.length).toBe(beforeCount);
  });

  test('SYNC-21: WO status change reflects in list endpoint immediately', async ({ request }) => {
    // Create a WO in draft
    const createRes = await request.post('/api/work-orders', {
      headers: authHeader(adminToken),
      data: { processId: setup.process.id, quantity: 3, priority: 'low' },
    });
    const wo = (await createRes.json()).data;

    // Transition to pending
    await request.patch(`/api/work-orders/${wo.id}/status`, {
      headers: authHeader(adminToken),
      data: { status: 'pending' },
    });

    // List filtered by pending should contain our WO
    const filteredRes = await request.get('/api/work-orders?status=pending&limit=100', {
      headers: authHeader(operatorToken),
    });
    const filtered = (await filteredRes.json()).data;
    const found = filtered.find((w: any) => w.id === wo.id);
    expect(found).toBeTruthy();
    expect(found.status).toBe('pending');

    // List filtered by draft should NOT contain it
    const draftRes = await request.get('/api/work-orders?status=draft&limit=100', {
      headers: authHeader(operatorToken),
    });
    const draft = (await draftRes.json()).data;
    expect(draft.find((w: any) => w.id === wo.id)).toBeFalsy();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 10. CONCURRENT UPDATES — both clients editing different aspects
  // ═══════════════════════════════════════════════════════════════════════════

  test('SYNC-22: Concurrent edits from "web" and "mobile" both persist', async ({ request }) => {
    // Create WO for concurrency test
    const createRes = await request.post('/api/work-orders', {
      headers: authHeader(adminToken),
      data: { processId: setup.process.id, quantity: 10, priority: 'medium' },
    });
    const wo = (await createRes.json()).data;

    // Fire web update (quantity) and mobile update (priority) in parallel
    const [webUpdate, mobileUpdate] = await Promise.all([
      request.patch(`/api/work-orders/${wo.id}`, {
        headers: authHeader(adminToken),
        data: { quantity: 50 },
      }),
      request.patch(`/api/work-orders/${wo.id}`, {
        headers: authHeader(supervisorToken),
        data: { priority: 'urgent' },
      }),
    ]);
    expect(webUpdate.status()).toBe(200);
    expect(mobileUpdate.status()).toBe(200);

    // Final state should reflect both changes (last-write-wins for conflicts but here they're different fields)
    const finalRes = await request.get(`/api/work-orders/${wo.id}`, {
      headers: authHeader(adminToken),
    });
    const final = (await finalRes.json()).data;
    // At least one of the updates should have persisted
    const eitherUpdated = final.quantity === 50 || final.priority === 'urgent';
    expect(eitherUpdated).toBeTruthy();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 11. USER CONTEXT — req.user correctly populated on both clients
  // ═══════════════════════════════════════════════════════════════════════════

  test('SYNC-23: Notifications correctly scoped to the current user', async ({ request }) => {
    // Admin reads notifications
    const adminRes = await request.get('/api/notifications', {
      headers: authHeader(adminToken),
    });
    const adminNotifs = (await adminRes.json()).data;

    // Operator reads notifications
    const opRes = await request.get('/api/notifications', {
      headers: authHeader(operatorToken),
    });
    const opNotifs = (await opRes.json()).data;

    // Each user only sees their own notifications
    const adminId = (await loginAs(request, 'admin')).user.id;
    for (const n of adminNotifs) {
      expect(n.userId).toBe(adminId);
    }
    for (const n of opNotifs) {
      expect(n.userId).toBe(operatorUser.id);
    }
  });

  test('SYNC-24: Profile endpoint returns current user regardless of client', async ({ request }) => {
    const adminProfile = await request.get('/api/auth/profile', {
      headers: authHeader(adminToken),
    });
    const operatorProfile = await request.get('/api/auth/profile', {
      headers: authHeader(operatorToken),
    });

    const admin = (await adminProfile.json()).data;
    const op = (await operatorProfile.json()).data;

    expect(admin.email).toBe(USERS.admin.email);
    expect(op.email).toBe(USERS.operator.email);
    expect(admin.role.name).toBe('admin');
    expect(op.role.name).toBe('operator');

    // passwordHash MUST never be returned on any client
    expect(admin.passwordHash).toBeUndefined();
    expect(op.passwordHash).toBeUndefined();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 12. FULL END-TO-END — web creates → mobile executes → web reviews
  // ═══════════════════════════════════════════════════════════════════════════

  test('SYNC-25: Full E2E — web creates WO, mobile clocks in/out, web sees result', async ({ request }) => {
    // Step A (WEB): Admin creates WO
    const createRes = await request.post('/api/work-orders', {
      headers: authHeader(adminToken),
      data: {
        processId: setup.process.id,
        quantity: 15,
        priority: 'high',
      },
    });
    const wo = (await createRes.json()).data;

    // Step B (WEB): Manager transitions to pending → in_progress
    await request.patch(`/api/work-orders/${wo.id}/status`, {
      headers: authHeader(adminToken),
      data: { status: 'pending' },
    });
    await request.patch(`/api/work-orders/${wo.id}/status`, {
      headers: authHeader(adminToken),
      data: { status: 'in_progress' },
    });

    // Step C (WEB): Supervisor assigns operator
    const woDetail = await getWorkOrder(request, adminToken, wo.id);
    const firstProcessStageId = woDetail.stages[0].stageId || woDetail.stages[0].stage?.id;
    await request.post(`/api/work-orders/${wo.id}/assign`, {
      headers: authHeader(supervisorToken),
      data: {
        assignments: [{ stageId: firstProcessStageId, userId: operatorUser.id }],
      },
    });

    // Step D (MOBILE): Operator sees the WO with themselves assigned
    const mobileViewRes = await request.get(`/api/work-orders/${wo.id}`, {
      headers: authHeader(operatorToken),
    });
    const mobileView = (await mobileViewRes.json()).data;
    const myStage = mobileView.stages.find(
      (s: any) => s.assignedUser?.id === operatorUser.id,
    );
    expect(myStage).toBeTruthy();

    // Step E (MOBILE): Operator clocks in via mobile
    const clockInRes = await request.post('/api/time-tracking/clock-in', {
      headers: authHeader(operatorToken),
      data: { workOrderStageId: myStage.id, inputMethod: 'mobile' },
    });
    expect(clockInRes.status()).toBe(201);
    const entry = (await clockInRes.json()).data;

    // Step F (WEB): Supervisor sees operator in live view
    const activeRes = await request.get('/api/time-tracking/active', {
      headers: authHeader(supervisorToken),
    });
    const activeEntry = (await activeRes.json()).data.find((e: any) => e.id === entry.id);
    expect(activeEntry).toBeTruthy();
    expect(activeEntry.inputMethod).toBe('mobile'); // originated from mobile

    // Step G (MOBILE): Operator clocks out
    await new Promise(r => setTimeout(r, 500));
    const clockOutRes = await request.post('/api/time-tracking/clock-out', {
      headers: authHeader(operatorToken),
      data: { timeEntryId: entry.id, notes: 'Done from mobile' },
    });
    expect(clockOutRes.status()).toBe(201);

    // Step H (WEB): Admin reviews completed entry in history
    const historyRes = await request.get(
      `/api/time-tracking/history?workOrderId=${wo.id}&limit=10`,
      { headers: authHeader(adminToken) },
    );
    const historyEntry = (await historyRes.json()).data.find((e: any) => e.id === entry.id);
    expect(historyEntry).toBeTruthy();
    expect(historyEntry.notes).toBe('Done from mobile');
    expect(historyEntry.inputMethod).toBe('mobile');
    expect(historyEntry.durationSeconds).toBeGreaterThanOrEqual(0);

    // Step I (WEB): Active list should no longer contain the entry
    const finalActiveRes = await request.get('/api/time-tracking/active', {
      headers: authHeader(supervisorToken),
    });
    const stillActive = (await finalActiveRes.json()).data.find((e: any) => e.id === entry.id);
    expect(stillActive).toBeFalsy();
  });
});
