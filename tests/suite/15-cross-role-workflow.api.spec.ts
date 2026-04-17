import { test, expect } from '@playwright/test';
import { loginAs, authHeader } from '../helpers/auth.helper';

/**
 * Cross-Role End-to-End Workflow.
 * Simulates the complete production cycle across all 4 roles:
 *   1. Admin creates product, process, line, station
 *   2. Manager creates work order
 *   3. Supervisor assigns operator to stages
 *   4. Operator clocks in, works, clocks out
 *   5. Manager reviews dashboard analytics
 *   6. Supervisor corrects time entry if needed
 *
 * This is the most important test — it validates the entire data flow.
 */
test.describe('Cross-Role Workflow — Complete production cycle', () => {
  test.describe.configure({ mode: 'serial' });
  // Shared state across the test sequence
  let adminToken: string;
  let managerToken: string;
  let supervisorToken: string;
  let operatorToken: string;
  let operatorUser: any;

  let productId: string;
  let processId: string;
  let lineId: string;
  let stationId: string;
  let workOrderId: string;
  let workOrderStages: any[];
  let timeEntryId: string;

  test.beforeAll(async ({ request }) => {
    ({ token: adminToken } = await loginAs(request, 'admin'));
    ({ token: managerToken } = await loginAs(request, 'manager'));
    ({ token: supervisorToken } = await loginAs(request, 'supervisor'));
    ({ token: operatorToken, user: operatorUser } = await loginAs(request, 'operator'));
  });

  // ── Step 1: Admin sets up infrastructure ──────────────────────────────────

  test('Step 1a: Admin creates product', async ({ request }) => {
    const res = await request.post('/api/products', {
      headers: authHeader(adminToken),
      data: {
        name: `E2E Workflow Product ${Date.now()}`,
        description: 'End-to-end workflow test product',
      },
    });
    expect(res.status()).toBe(201);
    productId = (await res.json()).data.id;
    expect(productId).toBeTruthy();
  });

  test('Step 1b: Admin creates process with stages', async ({ request }) => {
    const res = await request.post('/api/processes', {
      headers: authHeader(adminToken),
      data: {
        name: `E2E Assembly Process ${Date.now()}`,
        productId,
        stages: [
          { name: 'Material Prep', targetTimeSeconds: 600 },
          { name: 'Assembly', targetTimeSeconds: 1200 },
          { name: 'Quality Check', targetTimeSeconds: 300 },
        ],
      },
    });
    expect(res.status()).toBe(201);
    processId = (await res.json()).data.id;
    expect(processId).toBeTruthy();
  });

  test('Step 1c: Admin creates production line', async ({ request }) => {
    const res = await request.post('/api/lines', {
      headers: authHeader(adminToken),
      data: {
        name: `E2E Line ${Date.now()}`,
        description: 'Workflow test line',
      },
    });
    expect(res.status()).toBe(201);
    lineId = (await res.json()).data.id;
  });

  test('Step 1d: Admin creates station on line', async ({ request }) => {
    const res = await request.post('/api/stations', {
      headers: authHeader(adminToken),
      data: { name: `E2E Station ${Date.now()}`, lineId },
    });
    expect(res.status()).toBe(201);
    stationId = (await res.json()).data.id;
  });

  // ── Step 2: Manager creates work order ────────────────────────────────────

  test('Step 2: Manager creates work order', async ({ request }) => {
    // Retry up to 3 times — concurrent workers can cause duplicate orderNumber race
    let wo: any;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const res = await request.post('/api/work-orders', {
        headers: authHeader(managerToken),
        data: {
          productId,
          processId,
          lineId,
          quantity: 25,
          priority: 'high',
        },
      });
      if (res.status() === 201) {
        wo = (await res.json()).data;
        break;
      }
      if (attempt === 3) {
        expect(res.status()).toBe(201);
      }
      await new Promise(r => setTimeout(r, 300 * attempt));
    }
    workOrderId = wo.id;
    expect(wo.status).toBe('draft');
    expect(wo.quantity).toBe(25);
    expect(wo.priority).toBe('high');
  });

  // ── Step 3: Manager transitions to pending ────────────────────────────────

  test('Step 3a: Manager transitions WO to pending', async ({ request }) => {
    const res = await request.patch(`/api/work-orders/${workOrderId}/status`, {
      headers: authHeader(managerToken),
      data: { status: 'pending' },
    });
    expect(res.status()).toBe(200);
    expect((await res.json()).data.status).toBe('pending');
  });

  // ── Step 4: Supervisor assigns operator and starts WO ─────────────────────

  test('Step 4a: Supervisor transitions WO to in_progress', async ({ request }) => {
    const res = await request.patch(`/api/work-orders/${workOrderId}/status`, {
      headers: authHeader(supervisorToken),
      data: { status: 'in_progress' },
    });
    expect(res.status()).toBe(200);
    expect((await res.json()).data.status).toBe('in_progress');
  });

  test('Step 4b: Supervisor reads work order stages', async ({ request }) => {
    const res = await request.get(`/api/work-orders/${workOrderId}`, {
      headers: authHeader(supervisorToken),
    });
    expect(res.status()).toBe(200);
    const wo = (await res.json()).data;
    workOrderStages = wo.stages;
    expect(workOrderStages.length).toBe(3); // 3 stages created above
  });

  test('Step 4c: Supervisor assigns operator to first stage', async ({ request }) => {
    test.skip(!workOrderStages || workOrderStages.length === 0, 'No stages');

    // The assign DTO expects Stage.id (process stage), not WorkOrderStage.id
    const stageId = workOrderStages[0].stageId || workOrderStages[0].stage?.id;
    const res = await request.post(`/api/work-orders/${workOrderId}/assign`, {
      headers: authHeader(supervisorToken),
      data: {
        assignments: [
          {
            stageId,
            userId: operatorUser.id,
            stationId,
          },
        ],
      },
    });
    expect([200, 201]).toContain(res.status());
  });

  // ── Step 5: Operator clocks in and works ──────────────────────────────────

  test('Step 5a: Operator clocks in to assigned stage', async ({ request }) => {
    test.skip(!workOrderStages || workOrderStages.length === 0, 'No stages');

    const res = await request.post('/api/time-tracking/clock-in', {
      headers: authHeader(operatorToken),
      data: {
        workOrderStageId: workOrderStages[0].id,
        stationId,
        inputMethod: 'web',
      },
    });
    expect(res.status()).toBe(201);
    const entry = (await res.json()).data;
    timeEntryId = entry.id;
    expect(entry.startTime).toBeTruthy();
    expect(entry.endTime).toBeNull();
  });

  test('Step 5b: Operator verifies they appear in active entries', async ({ request }) => {
    const res = await request.get('/api/time-tracking/active', {
      headers: authHeader(operatorToken),
    });
    expect(res.status()).toBe(200);
    const active = (await res.json()).data;
    const myEntry = active.find((e: any) => e.id === timeEntryId);
    expect(myEntry).toBeTruthy();
  });

  test('Step 5c: Operator clocks out', async ({ request }) => {
    test.skip(!timeEntryId, 'No time entry');

    const res = await request.post('/api/time-tracking/clock-out', {
      headers: authHeader(operatorToken),
      data: {
        timeEntryId,
        notes: 'Material prep completed successfully',
      },
    });
    expect(res.status()).toBe(201);
    const entry = (await res.json()).data;
    expect(entry.endTime).toBeTruthy();
    expect(entry.durationSeconds).toBeGreaterThanOrEqual(0);
  });

  // ── Step 6: Supervisor reviews and corrects ───────────────────────────────

  test('Step 6a: Supervisor views operator time entries', async ({ request }) => {
    const res = await request.get(
      `/api/time-tracking/user/${operatorUser.id}`,
      { headers: authHeader(supervisorToken) },
    );
    expect(res.status()).toBe(200);
    const entries = (await res.json()).data;
    expect(Array.isArray(entries)).toBeTruthy();
    expect(entries.length).toBeGreaterThanOrEqual(1);
  });

  test('Step 6b: Supervisor adds break time correction', async ({ request }) => {
    test.skip(!timeEntryId, 'No time entry');

    const res = await request.patch(`/api/time-tracking/${timeEntryId}`, {
      headers: authHeader(supervisorToken),
      data: {
        breakSeconds: 600,
        notes: 'Added 10min break that was not logged',
      },
    });
    expect(res.status()).toBe(200);
    const entry = (await res.json()).data;
    expect(entry.breakSeconds).toBe(600);
  });

  // ── Step 7: Manager reviews analytics ─────────────────────────────────────

  test('Step 7a: Manager views dashboard summary', async ({ request }) => {
    const res = await request.get('/api/dashboard/summary', {
      headers: authHeader(managerToken),
    });
    expect(res.status()).toBe(200);
  });

  test('Step 7b: Manager views operator performance', async ({ request }) => {
    const res = await request.get('/api/dashboard/operator-performance', {
      headers: authHeader(managerToken),
    });
    expect(res.status()).toBe(200);
  });

  test('Step 7c: Manager views stage analytics', async ({ request }) => {
    const res = await request.get('/api/dashboard/stage-analytics', {
      headers: authHeader(managerToken),
    });
    expect(res.status()).toBe(200);
  });

  // ── Step 8: Verify data integrity across roles ────────────────────────────

  test('Step 8a: Operator can see the work order they worked on', async ({ request }) => {
    const res = await request.get(`/api/work-orders/${workOrderId}`, {
      headers: authHeader(operatorToken),
    });
    expect(res.status()).toBe(200);
    const wo = (await res.json()).data;
    expect(wo.status).toBe('in_progress');
  });

  test('Step 8b: Time tracking history reflects the work done', async ({ request }) => {
    const res = await request.get(
      `/api/time-tracking/history?workOrderId=${workOrderId}`,
      { headers: authHeader(adminToken) },
    );
    expect(res.status()).toBe(200);
    const entries = (await res.json()).data;
    expect(entries.length).toBeGreaterThanOrEqual(1);
  });

  test('Step 8c: Admin can see audit trail of all actions', async ({ request }) => {
    const res = await request.get('/api/audit?limit=20', {
      headers: authHeader(adminToken),
    });
    expect(res.status()).toBe(200);
    const logs = (await res.json()).data;
    expect(logs.length).toBeGreaterThanOrEqual(1);
  });

  // ── Step 9: Complete the work order ───────────────────────────────────────

  test('Step 9: Manager completes the work order', async ({ request }) => {
    const res = await request.patch(`/api/work-orders/${workOrderId}/status`, {
      headers: authHeader(managerToken),
      data: { status: 'completed' },
    });
    expect(res.status()).toBe(200);
    expect((await res.json()).data.status).toBe('completed');
  });
});
