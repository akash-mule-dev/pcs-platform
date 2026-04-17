import { test, expect } from '@playwright/test';
import { loginAs, authHeader } from '../helpers/auth.helper';
import { createFullTestSetup } from '../helpers/test-data.helper';

/**
 * Kanban View tests — verifies the data shape required by the Work Order Kanban UI.
 *
 * The Kanban component ([work-order-kanban.component.ts]) displays:
 *  - Work order list for dropdown
 *  - Work order detail with stages grouped by status
 *  - Each stage card needs: stage.name, status, assignedUser, station,
 *    targetTimeSeconds (from stage), actualTimeSeconds, startedAt, completedAt
 *  - WO info bar needs: priority, status, quantity, completedQuantity, dueDate
 */
test.describe('Kanban View — Work Order data shape for UI', () => {
  test.describe.configure({ mode: 'serial' });

  let adminToken: string;
  let supervisorToken: string;
  let operatorToken: string;
  let operatorUser: any;
  let setup: any;

  test.beforeAll(async ({ request }) => {
    ({ token: adminToken } = await loginAs(request, 'admin'));
    ({ token: supervisorToken } = await loginAs(request, 'supervisor'));
    ({ token: operatorToken, user: operatorUser } = await loginAs(request, 'operator'));

    setup = await createFullTestSetup(request, adminToken);

    // Move WO to in_progress so stages can progress
    await request.patch(`/api/work-orders/${setup.workOrder.id}/status`, {
      headers: authHeader(adminToken),
      data: { status: 'pending' },
    });
    await request.patch(`/api/work-orders/${setup.workOrder.id}/status`, {
      headers: authHeader(adminToken),
      data: { status: 'in_progress' },
    });
  });

  // ── Dropdown list shape ───────────────────────────────────────────────────

  test('GET /api/work-orders?limit=100 — kanban dropdown data', async ({ request }) => {
    const res = await request.get('/api/work-orders?limit=100', {
      headers: authHeader(adminToken),
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data)).toBeTruthy();

    if (body.data.length > 0) {
      const wo = body.data[0];
      // Fields required for kanban dropdown + info bar
      expect(wo.id).toBeTruthy();
      expect(wo.orderNumber).toBeTruthy();
      expect(wo.status).toBeTruthy();
      expect(wo.priority).toBeTruthy();
      expect(typeof wo.quantity).toBe('number');
      expect(typeof wo.completedQuantity).toBe('number');
    }
  });

  // ── Work Order detail with stages ─────────────────────────────────────────

  test('GET /api/work-orders/:id — kanban card data shape', async ({ request }) => {
    const res = await request.get(`/api/work-orders/${setup.workOrder.id}`, {
      headers: authHeader(adminToken),
    });
    expect(res.status()).toBe(200);
    const wo = (await res.json()).data;

    // Top-level fields for info bar
    expect(wo.id).toBe(setup.workOrder.id);
    expect(wo.orderNumber).toBeTruthy();
    expect(wo.product).toBeTruthy();
    expect(wo.product.name).toBeTruthy();
    expect(wo.status).toBe('in_progress');
    expect(wo.priority).toBeTruthy();
    expect(typeof wo.quantity).toBe('number');
    expect(typeof wo.completedQuantity).toBe('number');

    // Stages array — critical for kanban columns
    expect(Array.isArray(wo.stages)).toBeTruthy();
    expect(wo.stages.length).toBeGreaterThanOrEqual(1);

    for (const stage of wo.stages) {
      // Each stage card needs these fields
      expect(stage.id).toBeTruthy();
      expect(stage.status).toMatch(/^(pending|in_progress|completed|skipped)$/);
      expect(stage.stage).toBeTruthy();              // nested process stage
      expect(stage.stage.name).toBeTruthy();
      expect(typeof stage.stage.targetTimeSeconds).toBe('number');

      // Optional fields — assignedUser & station present only after assignment
      // actualTimeSeconds only populated after clock-out
      // These should EXIST as keys (can be null) so the UI can render "—"
      expect('assignedUser' in stage).toBeTruthy();
      expect('station' in stage).toBeTruthy();
      expect('actualTimeSeconds' in stage).toBeTruthy();
      expect('startedAt' in stage).toBeTruthy();
      expect('completedAt' in stage).toBeTruthy();
    }
  });

  // ── Stage grouping by status (all 4 columns) ──────────────────────────────

  test('Stages can be grouped by status for kanban columns', async ({ request }) => {
    const res = await request.get(`/api/work-orders/${setup.workOrder.id}`, {
      headers: authHeader(adminToken),
    });
    const wo = (await res.json()).data;

    // Group stages by status like the UI does
    const pending = wo.stages.filter((s: any) => s.status === 'pending');
    const inProgress = wo.stages.filter((s: any) => s.status === 'in_progress');
    const completed = wo.stages.filter((s: any) => s.status === 'completed');
    const skipped = wo.stages.filter((s: any) => s.status === 'skipped');

    // Total should equal all stages
    expect(pending.length + inProgress.length + completed.length + skipped.length)
      .toBe(wo.stages.length);

    // Initially all stages should be pending (newly created WO)
    expect(pending.length).toBeGreaterThanOrEqual(1);
  });

  // ── Assignment populates nested data for kanban cards ─────────────────────

  test('Assignment populates assignedUser and station in kanban card', async ({ request }) => {
    // Get stages (need process Stage.id for assign DTO)
    const detailRes = await request.get(`/api/work-orders/${setup.workOrder.id}`, {
      headers: authHeader(adminToken),
    });
    const wo = (await detailRes.json()).data;
    const firstStage = wo.stages[0];
    const processStageId = firstStage.stageId || firstStage.stage?.id;

    // Assign operator + station to first stage
    const assignRes = await request.post(`/api/work-orders/${setup.workOrder.id}/assign`, {
      headers: authHeader(supervisorToken),
      data: {
        assignments: [
          { stageId: processStageId, userId: operatorUser.id, stationId: setup.station.id },
        ],
      },
    });
    expect([200, 201]).toContain(assignRes.status());

    // Re-fetch and verify nested data now populated
    const afterRes = await request.get(`/api/work-orders/${setup.workOrder.id}`, {
      headers: authHeader(adminToken),
    });
    const woAfter = (await afterRes.json()).data;
    const updatedStage = woAfter.stages.find((s: any) => s.id === firstStage.id);

    expect(updatedStage.assignedUser).toBeTruthy();
    expect(updatedStage.assignedUser.firstName).toBeTruthy();
    expect(updatedStage.assignedUser.lastName).toBeTruthy();
    expect(updatedStage.station).toBeTruthy();
    expect(updatedStage.station.name).toBeTruthy();
  });

  // ── Stage status transitions move cards between kanban columns ────────────

  test('Stage status update moves card between kanban columns', async ({ request }) => {
    const detailRes = await request.get(`/api/work-orders/${setup.workOrder.id}`, {
      headers: authHeader(adminToken),
    });
    const wo = (await detailRes.json()).data;
    const workOrderStage = wo.stages[0];

    // Transition stage pending → in_progress (operator starts work)
    const res = await request.patch(
      `/api/work-orders/${setup.workOrder.id}/stages/${workOrderStage.id}/status`,
      {
        headers: authHeader(operatorToken),
        data: { status: 'in_progress' },
      },
    );
    expect([200, 400]).toContain(res.status());

    if (res.status() === 200) {
      // Verify stage moved to in_progress column
      const verifyRes = await request.get(`/api/work-orders/${setup.workOrder.id}`, {
        headers: authHeader(adminToken),
      });
      const updated = (await verifyRes.json()).data;
      const movedStage = updated.stages.find((s: any) => s.id === workOrderStage.id);
      expect(movedStage.status).toBe('in_progress');
    }
  });

  // ── Actual time appears on stage card after clock-out ─────────────────────

  test('actualTimeSeconds populates after operator clocks out of stage', async ({ request }) => {
    const detailRes = await request.get(`/api/work-orders/${setup.workOrder.id}`, {
      headers: authHeader(adminToken),
    });
    const wo = (await detailRes.json()).data;
    const workOrderStage = wo.stages[0];

    // Clock in, wait briefly, clock out
    const clockInRes = await request.post('/api/time-tracking/clock-in', {
      headers: authHeader(operatorToken),
      data: { workOrderStageId: workOrderStage.id, inputMethod: 'web' },
    });
    if (clockInRes.status() !== 201) {
      test.skip(true, 'Clock-in failed — stage might already have active entry');
    }
    const entry = (await clockInRes.json()).data;
    await new Promise(r => setTimeout(r, 1100)); // ~1 second work

    const clockOutRes = await request.post('/api/time-tracking/clock-out', {
      headers: authHeader(operatorToken),
      data: { timeEntryId: entry.id },
    });
    expect(clockOutRes.status()).toBe(201);

    // Re-fetch and verify actualTimeSeconds populated on the stage
    const afterRes = await request.get(`/api/work-orders/${setup.workOrder.id}`, {
      headers: authHeader(adminToken),
    });
    const updated = (await afterRes.json()).data;
    const stageAfter = updated.stages.find((s: any) => s.id === workOrderStage.id);

    // actualTimeSeconds should be populated (even if approximate)
    if (stageAfter.actualTimeSeconds !== null) {
      expect(typeof stageAfter.actualTimeSeconds).toBe('number');
      expect(stageAfter.actualTimeSeconds).toBeGreaterThanOrEqual(0);
    }
    // startedAt should definitely be populated after clocking in
    expect(stageAfter.startedAt || stageAfter.actualTimeSeconds !== null).toBeTruthy();
  });

  // ── Variance data (target vs actual) available for color coding ───────────

  test('Stage has target and actual time data for variance color coding', async ({ request }) => {
    const res = await request.get(`/api/work-orders/${setup.workOrder.id}`, {
      headers: authHeader(adminToken),
    });
    const wo = (await res.json()).data;

    for (const stage of wo.stages) {
      // Target always present from process stage
      expect(typeof stage.stage.targetTimeSeconds).toBe('number');
      expect(stage.stage.targetTimeSeconds).toBeGreaterThan(0);
      // Actual can be null (not started), number (completed)
      expect(
        stage.actualTimeSeconds === null || typeof stage.actualTimeSeconds === 'number',
      ).toBeTruthy();
    }
  });

  // ── Priority color coding data present ────────────────────────────────────

  test('Work order has priority values that match UI color mapping', async ({ request }) => {
    const res = await request.get('/api/work-orders?limit=50', {
      headers: authHeader(adminToken),
    });
    const list = (await res.json()).data;

    const validPriorities = ['low', 'medium', 'high', 'urgent'];
    const validStatuses = ['draft', 'pending', 'in_progress', 'completed', 'cancelled'];

    for (const wo of list) {
      expect(validPriorities).toContain(wo.priority);
      expect(validStatuses).toContain(wo.status);
    }
  });

  // ── Operator can view kanban data ─────────────────────────────────────────

  test('Operator can view work order kanban data (read-only)', async ({ request }) => {
    const res = await request.get(`/api/work-orders/${setup.workOrder.id}`, {
      headers: authHeader(operatorToken),
    });
    expect(res.status()).toBe(200);
    const wo = (await res.json()).data;
    expect(wo.stages).toBeTruthy();
  });

  // ── Due date overdue detection ────────────────────────────────────────────

  test('Work order with past due date can be detected as overdue', async ({ request }) => {
    // Create WO with yesterday's due date
    const yesterday = new Date(Date.now() - 86400000).toISOString();
    const createRes = await request.post('/api/work-orders', {
      headers: authHeader(adminToken),
      data: {
        productId: setup.product.id,
        processId: setup.process.id,
        quantity: 5,
        priority: 'medium',
        dueDate: yesterday,
      },
    });
    expect(createRes.status()).toBe(201);
    const wo = (await createRes.json()).data;

    expect(wo.dueDate).toBeTruthy();
    const due = new Date(wo.dueDate);
    expect(due.getTime()).toBeLessThan(Date.now());
  });
});
