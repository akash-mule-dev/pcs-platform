/**
 * Steel-Assembly-Beam End-to-End Test Suite
 *
 * Tests the complete lifecycle:
 * 1. Product creation
 * 2. Process creation with 5 fabrication stages
 * 3. Work order creation and status transitions
 * 4. Operator assignment
 * 5. Time tracking (clock-in / clock-out) with duration accuracy validation
 * 6. Multi-operator parallel work
 * 7. Time tracking history verification
 * 8. Mobile API compatibility
 * 9. Dashboard sync
 *
 * NOTE: All API responses are wrapped in { data: ... }
 */

import { test, expect, APIRequestContext } from '@playwright/test';

const API = 'http://localhost:3000';

// ── helpers ──────────────────────────────────────────────────────────────────

interface AuthToken {
  token: string;
  userId: string;
}

async function login(request: APIRequestContext, email: string): Promise<AuthToken> {
  const res = await request.post(`${API}/api/auth/login`, {
    data: { email, password: 'password123' },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  return { token: body.data.accessToken, userId: body.data.user.id };
}

function h(token: string) {
  return { Authorization: `Bearer ${token}` };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── shared state ─────────────────────────────────────────────────────────────

let admin: AuthToken;
let operator1: AuthToken;
let operator2: AuthToken;

let productId: string;
let processId: string;
let stageIds: string[] = [];        // process-level stage IDs
let workOrderId: string;
let workOrderNumber: string;
let woStageIds: string[] = [];      // work-order stage IDs
let lineId: string;
let stationId: string;

// ══════════════════════════════════════════════════════════════════════════════

test.describe.serial('Steel-Assembly-Beam Full E2E', () => {

  // ── 1. Auth ────────────────────────────────────────────────────────────────

  test('1.1 – Login as admin, operator1, operator2', async ({ request }) => {
    admin = await login(request, 'admin@pcs.local');
    operator1 = await login(request, 'operator1@pcs.local');
    operator2 = await login(request, 'operator2@pcs.local');
    expect(admin.token).toBeTruthy();
    expect(operator1.token).toBeTruthy();
    expect(operator2.token).toBeTruthy();
  });

  // ── 2. Product ─────────────────────────────────────────────────────────────

  test('2.1 – Create Steel-Assembly-Beam product', async ({ request }) => {
    const res = await request.post(`${API}/api/products`, {
      headers: h(admin.token),
      data: {
        name: 'Steel-Assembly-Beam',
        description: 'Structural steel beam assembly – E2E test product',
      },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    productId = body.data.id;
    expect(productId).toBeTruthy();
    expect(body.data.name).toBe('Steel-Assembly-Beam');
  });

  test('2.2 – Verify product appears via GET', async ({ request }) => {
    const res = await request.get(`${API}/api/products/${productId}`, {
      headers: h(admin.token),
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.data.name).toBe('Steel-Assembly-Beam');
    expect(body.data.isActive).toBe(true);
  });

  // ── 3. Process + Stages ────────────────────────────────────────────────────

  test('3.1 – Create process for Steel-Assembly-Beam', async ({ request }) => {
    const res = await request.post(`${API}/api/processes`, {
      headers: h(admin.token),
      data: { name: 'Steel Beam Fabrication', productId },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    processId = body.data.id;
    expect(processId).toBeTruthy();
    expect(body.data.productId).toBe(productId);
  });

  test('3.2 – Add 5 fabrication stages', async ({ request }) => {
    const stages = [
      { name: 'Material Cutting',    sequence: 1, targetTimeSeconds: 600, description: 'Cut steel beams to spec' },
      { name: 'Welding',             sequence: 2, targetTimeSeconds: 900, description: 'Weld beam joints' },
      { name: 'Surface Treatment',   sequence: 3, targetTimeSeconds: 480, description: 'Sandblasting and primer' },
      { name: 'Quality Inspection',  sequence: 4, targetTimeSeconds: 300, description: 'Dimensional and weld QC' },
      { name: 'Packaging',           sequence: 5, targetTimeSeconds: 240, description: 'Wrap and label for shipping' },
    ];
    for (const stage of stages) {
      const res = await request.post(`${API}/api/processes/${processId}/stages`, {
        headers: h(admin.token),
        data: stage,
      });
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      stageIds.push(body.data.id);
    }
    expect(stageIds).toHaveLength(5);
  });

  test('3.3 – Verify process has all 5 stages in order', async ({ request }) => {
    const res = await request.get(`${API}/api/processes/${processId}`, {
      headers: h(admin.token),
    });
    expect(res.ok()).toBeTruthy();
    const p = (await res.json()).data;
    expect(p.stages).toHaveLength(5);
    const names = [...p.stages]
      .sort((a: any, b: any) => a.sequence - b.sequence)
      .map((s: any) => s.name);
    expect(names).toEqual([
      'Material Cutting', 'Welding', 'Surface Treatment',
      'Quality Inspection', 'Packaging',
    ]);
  });

  // ── 4. Line & station ─────────────────────────────────────────────────────

  test('4.1 – Get existing line and station', async ({ request }) => {
    const res = await request.get(`${API}/api/lines`, { headers: h(admin.token) });
    expect(res.ok()).toBeTruthy();
    const lines = (await res.json()).data;
    expect(lines.length).toBeGreaterThan(0);
    lineId = lines[0].id;
    stationId = lines[0].stations[0].id;
    expect(lineId).toBeTruthy();
    expect(stationId).toBeTruthy();
  });

  // ── 5. Work Order ─────────────────────────────────────────────────────────

  test('5.1 – Create work order for Steel-Assembly-Beam', async ({ request }) => {
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 7);

    const res = await request.post(`${API}/api/work-orders`, {
      headers: h(admin.token),
      data: { productId, processId, lineId, quantity: 10, priority: 'high', dueDate: dueDate.toISOString() },
    });
    expect(res.ok()).toBeTruthy();
    const wo = (await res.json()).data;
    workOrderId = wo.id;
    workOrderNumber = wo.orderNumber;
    expect(workOrderNumber).toMatch(/^WO-\d{4}-\d{4}$/);
    expect(wo.status).toBe('draft');
    expect(wo.product.name).toBe('Steel-Assembly-Beam');
    expect(wo.stages).toHaveLength(5);

    // Save WO stage IDs sorted by stage sequence
    woStageIds = wo.stages
      .sort((a: any, b: any) => a.stage.sequence - b.stage.sequence)
      .map((s: any) => s.id);
  });

  test('5.2 – All WO stages start as pending', async ({ request }) => {
    const wo = (await (await request.get(`${API}/api/work-orders/${workOrderId}`, { headers: h(admin.token) })).json()).data;
    for (const s of wo.stages) {
      expect(s.status).toBe('pending');
    }
  });

  // ── 6. Status Transitions ─────────────────────────────────────────────────

  test('6.1 – draft → pending', async ({ request }) => {
    const res = await request.patch(`${API}/api/work-orders/${workOrderId}/status`, {
      headers: h(admin.token), data: { status: 'pending' },
    });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).data.status).toBe('pending');
  });

  test('6.2 – pending → in_progress', async ({ request }) => {
    const res = await request.patch(`${API}/api/work-orders/${workOrderId}/status`, {
      headers: h(admin.token), data: { status: 'in_progress' },
    });
    expect(res.ok()).toBeTruthy();
    const wo = (await res.json()).data;
    expect(wo.status).toBe('in_progress');
    expect(wo.startedAt).toBeTruthy();
  });

  test('6.3 – Invalid transition (in_progress → pending) fails', async ({ request }) => {
    const res = await request.patch(`${API}/api/work-orders/${workOrderId}/status`, {
      headers: h(admin.token), data: { status: 'pending' },
    });
    expect(res.ok()).toBeFalsy();
    expect(res.status()).toBe(400);
  });

  // ── 7. Operator Assignment ─────────────────────────────────────────────────

  test('7.1 – Assign op1 to stages 1-3, op2 to stages 4-5', async ({ request }) => {
    const assignments = [
      { stageId: stageIds[0], userId: operator1.userId, stationId },
      { stageId: stageIds[1], userId: operator1.userId, stationId },
      { stageId: stageIds[2], userId: operator1.userId, stationId },
      { stageId: stageIds[3], userId: operator2.userId, stationId },
      { stageId: stageIds[4], userId: operator2.userId, stationId },
    ];
    const res = await request.post(`${API}/api/work-orders/${workOrderId}/assign`, {
      headers: h(admin.token), data: { assignments },
    });
    expect(res.ok()).toBeTruthy();
    const wo = (await res.json()).data;
    const sorted = [...wo.stages].sort((a: any, b: any) => a.stage.sequence - b.stage.sequence);
    expect(sorted[0].assignedUser.email).toBe('operator1@pcs.local');
    expect(sorted[3].assignedUser.email).toBe('operator2@pcs.local');
  });

  // ── 8. Time Tracking – Accuracy Tests ──────────────────────────────────────

  test('8.1 – Op1 clocks in to Stage 1 (Material Cutting)', async ({ request }) => {
    const before = Date.now();
    const res = await request.post(`${API}/api/time-tracking/clock-in`, {
      headers: h(operator1.token),
      data: { workOrderStageId: woStageIds[0], stationId, inputMethod: 'web' },
    });
    expect(res.ok()).toBeTruthy();
    const entry = (await res.json()).data;
    expect(entry.userId).toBe(operator1.userId);
    expect(entry.endTime).toBeNull();

    // Start time within 5s of wall clock
    const startTs = new Date(entry.startTime).getTime();
    expect(Math.abs(startTs - before)).toBeLessThan(5000);
  });

  test('8.2 – Op1 appears in active entries', async ({ request }) => {
    const entries = (await (await request.get(`${API}/api/time-tracking/active`, { headers: h(admin.token) })).json()).data;
    const mine = entries.find((e: any) => e.userId === operator1.userId && !e.endTime);
    expect(mine).toBeTruthy();
    expect(mine.workOrderStage.id).toBe(woStageIds[0]);
  });

  test('8.3 – WO stage 1 is now in_progress', async ({ request }) => {
    const wo = (await (await request.get(`${API}/api/work-orders/${workOrderId}`, { headers: h(admin.token) })).json()).data;
    const s1 = wo.stages.find((s: any) => s.id === woStageIds[0]);
    expect(s1.status).toBe('in_progress');
    expect(s1.startedAt).toBeTruthy();
  });

  test('8.4 – Duplicate clock-in fails', async ({ request }) => {
    const res = await request.post(`${API}/api/time-tracking/clock-in`, {
      headers: h(operator1.token),
      data: { workOrderStageId: woStageIds[1], inputMethod: 'web' },
    });
    expect(res.ok()).toBeFalsy();
    expect(res.status()).toBe(400);
  });

  let timeEntryId1: string;

  test('8.5 – Wait 5s, clock out Stage 1, verify duration accuracy', async ({ request }) => {
    // Get active entry ID
    const entries = (await (await request.get(`${API}/api/time-tracking/active`, { headers: h(operator1.token) })).json()).data;
    const mine = entries.find((e: any) => e.userId === operator1.userId);
    timeEntryId1 = mine.id;

    await sleep(5000);

    const beforeOut = Date.now();
    const res = await request.post(`${API}/api/time-tracking/clock-out`, {
      headers: h(operator1.token),
      data: { timeEntryId: timeEntryId1, notes: 'Beams cut to 6m length' },
    });
    expect(res.ok()).toBeTruthy();
    const entry = (await res.json()).data;

    expect(entry.endTime).toBeTruthy();
    expect(entry.durationSeconds).toBeGreaterThanOrEqual(4);
    expect(entry.durationSeconds).toBeLessThan(20);
    expect(entry.notes).toBe('Beams cut to 6m length');

    // Duration matches (endTime - startTime) / 1000
    const start = new Date(entry.startTime).getTime();
    const end = new Date(entry.endTime).getTime();
    const computed = Math.round((end - start) / 1000);
    expect(entry.durationSeconds).toBe(computed);

    // End time near our wall clock
    expect(Math.abs(new Date(entry.endTime).getTime() - beforeOut)).toBeLessThan(5000);
  });

  test('8.6 – WO stage 1 completed with actualTimeSeconds', async ({ request }) => {
    const wo = (await (await request.get(`${API}/api/work-orders/${workOrderId}`, { headers: h(admin.token) })).json()).data;
    const s1 = wo.stages.find((s: any) => s.id === woStageIds[0]);
    expect(s1.status).toBe('completed');
    expect(s1.completedAt).toBeTruthy();
    expect(s1.actualTimeSeconds).toBeGreaterThanOrEqual(4);
  });

  // ── 9. Multi-stage – op1 through stages 2 & 3 ─────────────────────────────

  test('9.1 – Op1 clocks in Stage 2 (Welding)', async ({ request }) => {
    const res = await request.post(`${API}/api/time-tracking/clock-in`, {
      headers: h(operator1.token),
      data: { workOrderStageId: woStageIds[1], stationId, inputMethod: 'web' },
    });
    expect(res.ok()).toBeTruthy();
  });

  test('9.2 – Clock out Stage 2 after 3s', async ({ request }) => {
    await sleep(3000);
    const entries = (await (await request.get(`${API}/api/time-tracking/active`, { headers: h(operator1.token) })).json()).data;
    const mine = entries.find((e: any) => e.userId === operator1.userId);
    const res = await request.post(`${API}/api/time-tracking/clock-out`, {
      headers: h(operator1.token),
      data: { timeEntryId: mine.id, notes: 'Welding complete' },
    });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).data.durationSeconds).toBeGreaterThanOrEqual(2);
  });

  test('9.3 – Op1 clocks in Stage 3 (Surface Treatment)', async ({ request }) => {
    const res = await request.post(`${API}/api/time-tracking/clock-in`, {
      headers: h(operator1.token),
      data: { workOrderStageId: woStageIds[2], stationId, inputMethod: 'web' },
    });
    expect(res.ok()).toBeTruthy();
  });

  test('9.4 – Clock out Stage 3 after 3s', async ({ request }) => {
    await sleep(3000);
    const entries = (await (await request.get(`${API}/api/time-tracking/active`, { headers: h(operator1.token) })).json()).data;
    const mine = entries.find((e: any) => e.userId === operator1.userId);
    const res = await request.post(`${API}/api/time-tracking/clock-out`, {
      headers: h(operator1.token),
      data: { timeEntryId: mine.id },
    });
    expect(res.ok()).toBeTruthy();
  });

  // ── 10. Parallel operator – op2 on stages 4 & 5 ───────────────────────────

  test('10.1 – Op2 clocks in Stage 4 (Quality Inspection) via mobile', async ({ request }) => {
    const res = await request.post(`${API}/api/time-tracking/clock-in`, {
      headers: h(operator2.token),
      data: { workOrderStageId: woStageIds[3], stationId, inputMethod: 'mobile' },
    });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).data.inputMethod).toBe('mobile');
  });

  test('10.2 – Active entries: op1=none, op2=active', async ({ request }) => {
    const entries = (await (await request.get(`${API}/api/time-tracking/active`, { headers: h(admin.token) })).json()).data;
    const op1 = entries.find((e: any) => e.userId === operator1.userId && !e.endTime);
    const op2 = entries.find((e: any) => e.userId === operator2.userId && !e.endTime);
    expect(op1).toBeFalsy();
    expect(op2).toBeTruthy();
  });

  test('10.3 – Clock out op2 from Stage 4 after 3s', async ({ request }) => {
    await sleep(3000);
    const entries = (await (await request.get(`${API}/api/time-tracking/active`, { headers: h(operator2.token) })).json()).data;
    const mine = entries.find((e: any) => e.userId === operator2.userId);
    const res = await request.post(`${API}/api/time-tracking/clock-out`, {
      headers: h(operator2.token),
      data: { timeEntryId: mine.id, notes: 'Inspection passed' },
    });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).data.durationSeconds).toBeGreaterThanOrEqual(2);
  });

  test('10.4 – Op2 completes Stage 5 (Packaging)', async ({ request }) => {
    const clockIn = await request.post(`${API}/api/time-tracking/clock-in`, {
      headers: h(operator2.token),
      data: { workOrderStageId: woStageIds[4], stationId, inputMethod: 'mobile' },
    });
    expect(clockIn.ok()).toBeTruthy();

    await sleep(3000);

    const entries = (await (await request.get(`${API}/api/time-tracking/active`, { headers: h(operator2.token) })).json()).data;
    const mine = entries.find((e: any) => e.userId === operator2.userId);
    const clockOut = await request.post(`${API}/api/time-tracking/clock-out`, {
      headers: h(operator2.token),
      data: { timeEntryId: mine.id, notes: 'Packed and labeled' },
    });
    expect(clockOut.ok()).toBeTruthy();
  });

  // ── 11. All stages completed ───────────────────────────────────────────────

  test('11.1 – All 5 WO stages are completed with time data', async ({ request }) => {
    const wo = (await (await request.get(`${API}/api/work-orders/${workOrderId}`, { headers: h(admin.token) })).json()).data;
    for (const s of wo.stages) {
      expect(s.status).toBe('completed');
      expect(s.actualTimeSeconds).toBeGreaterThan(0);
      expect(s.completedAt).toBeTruthy();
    }
  });

  test('11.2 – Complete the work order', async ({ request }) => {
    const res = await request.patch(`${API}/api/work-orders/${workOrderId}/status`, {
      headers: h(admin.token), data: { status: 'completed' },
    });
    expect(res.ok()).toBeTruthy();
    const wo = (await res.json()).data;
    expect(wo.status).toBe('completed');
    expect(wo.completedAt).toBeTruthy();
  });

  // ── 12. Time Tracking History & Accuracy ───────────────────────────────────

  test('12.1 – History shows 5 entries for this WO, all with accurate durations', async ({ request }) => {
    const res = await request.get(`${API}/api/time-tracking/history?workOrderId=${workOrderId}`, {
      headers: h(admin.token),
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.data.length).toBe(5);

    for (const entry of body.data) {
      expect(entry.endTime).toBeTruthy();
      expect(entry.durationSeconds).toBeGreaterThan(0);
      // Verify duration = round((end - start) / 1000)
      const start = new Date(entry.startTime).getTime();
      const end = new Date(entry.endTime).getTime();
      expect(entry.durationSeconds).toBe(Math.round((end - start) / 1000));
    }
  });

  test('12.2 – Op1 has 3 entries for this WO', async ({ request }) => {
    const entries = (await (await request.get(`${API}/api/time-tracking/user/${operator1.userId}`, { headers: h(admin.token) })).json()).data;
    const woEntries = entries.filter((e: any) => woStageIds.includes(e.workOrderStageId));
    expect(woEntries).toHaveLength(3);
  });

  test('12.3 – Op2 has 2 entries for this WO', async ({ request }) => {
    const entries = (await (await request.get(`${API}/api/time-tracking/user/${operator2.userId}`, { headers: h(admin.token) })).json()).data;
    const woEntries = entries.filter((e: any) => woStageIds.includes(e.workOrderStageId));
    expect(woEntries).toHaveLength(2);
  });

  test('12.4 – No active entries remain for this WO', async ({ request }) => {
    const entries = (await (await request.get(`${API}/api/time-tracking/active`, { headers: h(admin.token) })).json()).data;
    const ours = entries.filter((e: any) => woStageIds.includes(e.workOrderStage?.id));
    expect(ours).toHaveLength(0);
  });

  // ── 13. Time Entry Correction ──────────────────────────────────────────────

  test('13.1 – Admin corrects a time entry (add break time)', async ({ request }) => {
    const hist = (await (await request.get(`${API}/api/time-tracking/history?workOrderId=${workOrderId}`, { headers: h(admin.token) })).json()).data;
    const entryId = hist[0].id;

    const res = await request.patch(`${API}/api/time-tracking/${entryId}`, {
      headers: h(admin.token),
      data: { breakSeconds: 30, notes: 'Added 30s break correction' },
    });
    expect(res.ok()).toBeTruthy();
    const corrected = (await res.json()).data;
    expect(corrected.breakSeconds).toBe(30);
    expect(corrected.notes).toBe('Added 30s break correction');
  });

  // ── 14. Mobile API Compatibility ───────────────────────────────────────────

  let mobileWoId: string;
  let mobileWoStageId: string;

  test('14.1 – Create second WO and test mobile clock-in/out', async ({ request }) => {
    // Create
    const createRes = await request.post(`${API}/api/work-orders`, {
      headers: h(admin.token),
      data: { productId, processId, lineId, quantity: 5, priority: 'medium' },
    });
    expect(createRes.ok()).toBeTruthy();
    mobileWoId = (await createRes.json()).data.id;

    // draft → pending → in_progress
    await request.patch(`${API}/api/work-orders/${mobileWoId}/status`, {
      headers: h(admin.token), data: { status: 'pending' },
    });
    await request.patch(`${API}/api/work-orders/${mobileWoId}/status`, {
      headers: h(admin.token), data: { status: 'in_progress' },
    });

    // Get first stage
    const wo = (await (await request.get(`${API}/api/work-orders/${mobileWoId}`, { headers: h(admin.token) })).json()).data;
    mobileWoStageId = wo.stages.sort((a: any, b: any) => a.stage.sequence - b.stage.sequence)[0].id;

    // Mobile clock-in
    const clockInRes = await request.post(`${API}/api/time-tracking/clock-in`, {
      headers: h(operator1.token),
      data: { workOrderStageId: mobileWoStageId, stationId, inputMethod: 'mobile' },
    });
    expect(clockInRes.ok()).toBeTruthy();
    const clockIn = (await clockInRes.json()).data;
    expect(clockIn.inputMethod).toBe('mobile');

    // Verify in active
    const active = (await (await request.get(`${API}/api/time-tracking/active`, { headers: h(operator1.token) })).json()).data;
    expect(active.find((e: any) => e.id === clockIn.id)).toBeTruthy();

    await sleep(3000);

    // Mobile clock-out
    const clockOutRes = await request.post(`${API}/api/time-tracking/clock-out`, {
      headers: h(operator1.token),
      data: { timeEntryId: clockIn.id, notes: 'Mobile clock-out test' },
    });
    expect(clockOutRes.ok()).toBeTruthy();
    const clockOut = (await clockOutRes.json()).data;
    expect(clockOut.durationSeconds).toBeGreaterThanOrEqual(2);
    expect(clockOut.inputMethod).toBe('mobile');
  });

  // ── 15. Dashboard ─────────────────────────────────────────────────────────

  test('15.1 – Dashboard summary accessible', async ({ request }) => {
    const res = await request.get(`${API}/api/dashboard/summary`, { headers: h(admin.token) });
    expect(res.status()).not.toBe(500);
  });

  test('15.2 – Work order progress endpoint works', async ({ request }) => {
    const res = await request.get(`${API}/api/dashboard/work-order-progress/${workOrderId}`, { headers: h(admin.token) });
    expect(res.status()).not.toBe(500);
  });

  // ── 16. Guard rails ───────────────────────────────────────────────────────

  test('16.1 – Completed WO cannot go back to in_progress', async ({ request }) => {
    const res = await request.patch(`${API}/api/work-orders/${workOrderId}/status`, {
      headers: h(admin.token), data: { status: 'in_progress' },
    });
    expect(res.ok()).toBeFalsy();
  });

  test('16.2 – Operator cannot create products (role guard)', async ({ request }) => {
    const res = await request.post(`${API}/api/products`, {
      headers: h(operator1.token),
      data: { name: 'Should-Fail', description: 'unauthorized' },
    });
    expect(res.ok()).toBeFalsy();
    expect(res.status()).toBe(403);
  });
});
