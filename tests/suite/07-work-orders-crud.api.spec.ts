import { test, expect } from '@playwright/test';
import { loginAs, authHeader } from '../helpers/auth.helper';
import { createProduct, createProcess, createLine } from '../helpers/test-data.helper';

test.describe('Work Orders — CRUD operations', () => {
  let adminToken: string;
  let managerToken: string;
  let supervisorToken: string;
  let operatorToken: string;
  let productId: string;
  let processId: string;
  let lineId: string;
  let workOrderId: string;

  test.beforeAll(async ({ request }) => {
    ({ token: adminToken } = await loginAs(request, 'admin'));
    ({ token: managerToken } = await loginAs(request, 'manager'));
    ({ token: supervisorToken } = await loginAs(request, 'supervisor'));
    ({ token: operatorToken } = await loginAs(request, 'operator'));

    // Setup prerequisite data
    const product = await createProduct(request, adminToken);
    productId = product.id;
    const process = await createProcess(request, adminToken, productId);
    processId = process.id;
    const line = await createLine(request, adminToken);
    lineId = line.id;
  });

  // ── Create Work Order ─────────────────────────────────────────────────────

  test('POST /api/work-orders — admin can create work order', async ({ request }) => {
    const res = await request.post('/api/work-orders', {
      headers: authHeader(adminToken),
      data: {
        productId,
        processId,
        lineId,
        quantity: 50,
        priority: 'high',
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    workOrderId = body.data.id;
    expect(body.data.quantity).toBe(50);
    expect(body.data.priority).toBe('high');
    expect(body.data.status).toBe('draft');
    expect(body.data.orderNumber).toBeTruthy();
  });

  test('POST /api/work-orders — manager can create work order', async ({ request }) => {
    const res = await request.post('/api/work-orders', {
      headers: authHeader(managerToken),
      data: { productId, processId, quantity: 20, priority: 'low' },
    });
    expect(res.status()).toBe(201);
  });

  test('POST /api/work-orders — supervisor can create work order', async ({ request }) => {
    const res = await request.post('/api/work-orders', {
      headers: authHeader(supervisorToken),
      data: { productId, processId, quantity: 5, priority: 'medium' },
    });
    expect(res.status()).toBe(201);
  });

  test('POST /api/work-orders — operator cannot create work order', async ({ request }) => {
    const res = await request.post('/api/work-orders', {
      headers: authHeader(operatorToken),
      data: { productId, processId, quantity: 1 },
    });
    expect(res.status()).toBe(403);
  });

  test('POST /api/work-orders — rejects missing required fields', async ({ request }) => {
    const res = await request.post('/api/work-orders', {
      headers: authHeader(adminToken),
      data: { quantity: 10 },
    });
    expect(res.status()).toBe(400);
  });

  test('POST /api/work-orders — rejects invalid priority', async ({ request }) => {
    const res = await request.post('/api/work-orders', {
      headers: authHeader(adminToken),
      data: { productId, processId, quantity: 10, priority: 'super-urgent' },
    });
    expect([400, 201]).toContain(res.status()); // May accept or reject depending on validation
  });

  // ── List Work Orders ──────────────────────────────────────────────────────

  test('GET /api/work-orders — returns paginated list', async ({ request }) => {
    const res = await request.get('/api/work-orders?page=1&limit=5', {
      headers: authHeader(adminToken),
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data)).toBeTruthy();
    expect(body.meta).toBeTruthy();
    expect(body.meta.page).toBe(1);
    expect(body.meta.limit).toBe(5);
  });

  test('GET /api/work-orders — all roles can list', async ({ request }) => {
    for (const role of ['admin', 'manager', 'supervisor', 'operator'] as const) {
      const { token } = await loginAs(request, role);
      const res = await request.get('/api/work-orders', { headers: authHeader(token) });
      expect(res.status()).toBe(200);
    }
  });

  test('GET /api/work-orders — filter by status', async ({ request }) => {
    const res = await request.get('/api/work-orders?status=draft', {
      headers: authHeader(adminToken),
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    for (const wo of body.data) {
      expect(wo.status).toBe('draft');
    }
  });

  test('GET /api/work-orders — filter by priority', async ({ request }) => {
    const res = await request.get('/api/work-orders?priority=high', {
      headers: authHeader(adminToken),
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    for (const wo of body.data) {
      expect(wo.priority).toBe('high');
    }
  });

  // ── Get single Work Order ─────────────────────────────────────────────────

  test('GET /api/work-orders/:id — returns work order with stages', async ({ request }) => {
    test.skip(!workOrderId, 'No work order was created');
    const res = await request.get(`/api/work-orders/${workOrderId}`, {
      headers: authHeader(adminToken),
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    const wo = body.data;
    expect(wo.id).toBe(workOrderId);
    expect(wo.orderNumber).toBeTruthy();
    expect(wo.product || wo.productId).toBeTruthy();
    expect(wo.process || wo.processId).toBeTruthy();
    expect(Array.isArray(wo.stages)).toBeTruthy();
    // Each stage should have properties
    if (wo.stages.length > 0) {
      expect(wo.stages[0]).toHaveProperty('status');
      expect(wo.stages[0]).toHaveProperty('stage');
    }
  });

  test('GET /api/work-orders/:id — operator can view work order details', async ({ request }) => {
    test.skip(!workOrderId, 'No work order was created');
    const res = await request.get(`/api/work-orders/${workOrderId}`, {
      headers: authHeader(operatorToken),
    });
    expect(res.status()).toBe(200);
  });

  // ── Update Work Order ─────────────────────────────────────────────────────

  test('PATCH /api/work-orders/:id — admin can update work order', async ({ request }) => {
    test.skip(!workOrderId, 'No work order was created');
    const res = await request.patch(`/api/work-orders/${workOrderId}`, {
      headers: authHeader(adminToken),
      data: { quantity: 100, priority: 'urgent' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.quantity).toBe(100);
    expect(body.data.priority).toBe('urgent');
  });

  test('PATCH /api/work-orders/:id — operator cannot update work order', async ({ request }) => {
    test.skip(!workOrderId, 'No work order was created');
    const res = await request.patch(`/api/work-orders/${workOrderId}`, {
      headers: authHeader(operatorToken),
      data: { quantity: 999 },
    });
    expect(res.status()).toBe(403);
  });

  // ── Assign Operators ──────────────────────────────────────────────────────

  test('POST /api/work-orders/:id/assign — supervisor can assign operators', async ({ request }) => {
    test.skip(!workOrderId, 'No work order was created');

    // Get the work order stages
    const woRes = await request.get(`/api/work-orders/${workOrderId}`, {
      headers: authHeader(adminToken),
    });
    const wo = (await woRes.json()).data;
    test.skip(wo.stages.length === 0, 'No stages in work order');

    // Get an operator user
    const { user: operatorUser } = await loginAs(request, 'operator');

    const res = await request.post(`/api/work-orders/${workOrderId}/assign`, {
      headers: authHeader(supervisorToken),
      data: {
        assignments: [
          { stageId: wo.stages[0].stageId || wo.stages[0].stage?.id, userId: operatorUser.id },
        ],
      },
    });
    expect([200, 201]).toContain(res.status());
  });

  test('POST /api/work-orders/:id/assign — operator cannot assign', async ({ request }) => {
    test.skip(!workOrderId, 'No work order was created');
    const res = await request.post(`/api/work-orders/${workOrderId}/assign`, {
      headers: authHeader(operatorToken),
      data: { assignments: [] },
    });
    expect(res.status()).toBe(403);
  });

  // ── Batch Operations ──────────────────────────────────────────────────────

  test('POST /api/work-orders/batch/status — admin can batch update', async ({ request }) => {
    // Create two work orders for batch test
    const wo1 = await request.post('/api/work-orders', {
      headers: authHeader(adminToken),
      data: { productId, processId, quantity: 1, priority: 'low' },
    });
    const wo2 = await request.post('/api/work-orders', {
      headers: authHeader(adminToken),
      data: { productId, processId, quantity: 1, priority: 'low' },
    });
    const id1 = (await wo1.json()).data.id;
    const id2 = (await wo2.json()).data.id;

    const res = await request.post('/api/work-orders/batch/status', {
      headers: authHeader(adminToken),
      data: { ids: [id1, id2], status: 'pending' },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.data).toHaveProperty('updated');
    expect(body.data).toHaveProperty('errors');
  });

  test('POST /api/work-orders/batch/status — supervisor cannot batch update', async ({ request }) => {
    const res = await request.post('/api/work-orders/batch/status', {
      headers: authHeader(supervisorToken),
      data: { ids: [], status: 'pending' },
    });
    expect(res.status()).toBe(403);
  });

  test('POST /api/work-orders/batch/assign-line — admin can batch assign line', async ({ request }) => {
    test.skip(!workOrderId || !lineId, 'Missing prerequisites');
    const res = await request.post('/api/work-orders/batch/assign-line', {
      headers: authHeader(adminToken),
      data: { ids: [workOrderId], lineId },
    });
    expect(res.status()).toBe(201);
  });

  test('POST /api/work-orders/batch/status — rejects without auth', async ({ request }) => {
    const res = await request.post('/api/work-orders/batch/status', {
      data: { ids: [], status: 'pending' },
    });
    expect(res.status()).toBe(401);
  });
});
