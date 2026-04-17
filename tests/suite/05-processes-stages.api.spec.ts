import { test, expect } from '@playwright/test';
import { loginAs, authHeader } from '../helpers/auth.helper';
import { createProduct } from '../helpers/test-data.helper';

test.describe('Processes & Stages — CRUD operations', () => {
  let adminToken: string;
  let managerToken: string;
  let supervisorToken: string;
  let operatorToken: string;
  let productId: string;
  let processId: string;
  let stageIds: string[] = [];

  test.beforeAll(async ({ request }) => {
    ({ token: adminToken } = await loginAs(request, 'admin'));
    ({ token: managerToken } = await loginAs(request, 'manager'));
    ({ token: supervisorToken } = await loginAs(request, 'supervisor'));
    ({ token: operatorToken } = await loginAs(request, 'operator'));

    // Create a product to attach processes to
    const product = await createProduct(request, adminToken);
    productId = product.id;
  });

  // ── Create Process with inline stages ─────────────────────────────────────

  test('POST /api/processes — admin can create process with stages', async ({ request }) => {
    const res = await request.post('/api/processes', {
      headers: authHeader(adminToken),
      data: {
        name: `Assembly Process ${Date.now()}`,
        productId,
        stages: [
          { name: 'Cutting', targetTimeSeconds: 600, description: 'Cut raw materials' },
          { name: 'Welding', targetTimeSeconds: 1200, description: 'Weld components' },
          { name: 'Painting', targetTimeSeconds: 900, description: 'Apply finish coat' },
          { name: 'Inspection', targetTimeSeconds: 300, description: 'Final QC' },
        ],
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    processId = body.data.id;
    expect(body.data.name).toContain('Assembly Process');
    expect(body.data.productId || body.data.product).toBeTruthy();
  });

  test('POST /api/processes — manager can create process', async ({ request }) => {
    const res = await request.post('/api/processes', {
      headers: authHeader(managerToken),
      data: {
        name: `Manager Process ${Date.now()}`,
        productId,
        stages: [{ name: 'Step 1', targetTimeSeconds: 500 }],
      },
    });
    expect(res.status()).toBe(201);
  });

  test('POST /api/processes — supervisor cannot create process', async ({ request }) => {
    const res = await request.post('/api/processes', {
      headers: authHeader(supervisorToken),
      data: { name: 'Should Fail', productId },
    });
    expect(res.status()).toBe(403);
  });

  test('POST /api/processes — rejects missing productId', async ({ request }) => {
    const res = await request.post('/api/processes', {
      headers: authHeader(adminToken),
      data: { name: 'No Product' },
    });
    expect(res.status()).toBe(400);
  });

  // ── List Processes ────────────────────────────────────────────────────────

  test('GET /api/processes — returns paginated list', async ({ request }) => {
    const res = await request.get('/api/processes?page=1&limit=5', {
      headers: authHeader(adminToken),
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data)).toBeTruthy();
    expect(body.meta).toBeTruthy();
  });

  test('GET /api/processes — supervisor can list', async ({ request }) => {
    const res = await request.get('/api/processes', {
      headers: authHeader(supervisorToken),
    });
    expect(res.status()).toBe(200);
  });

  test('GET /api/processes — operator cannot list', async ({ request }) => {
    const res = await request.get('/api/processes', {
      headers: authHeader(operatorToken),
    });
    expect(res.status()).toBe(403);
  });

  // ── Get single Process (with stages) ──────────────────────────────────────

  test('GET /api/processes/:id — returns process with stages', async ({ request }) => {
    test.skip(!processId, 'No process was created');
    const res = await request.get(`/api/processes/${processId}`, {
      headers: authHeader(adminToken),
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.id).toBe(processId);
    expect(Array.isArray(body.data.stages)).toBeTruthy();
    expect(body.data.stages.length).toBeGreaterThanOrEqual(1);

    // Save stage IDs for later tests
    stageIds = body.data.stages.map((s: any) => s.id);
  });

  // ── Update Process ────────────────────────────────────────────────────────

  test('PATCH /api/processes/:id — admin can update process', async ({ request }) => {
    test.skip(!processId, 'No process was created');
    const res = await request.patch(`/api/processes/${processId}`, {
      headers: authHeader(adminToken),
      data: { name: 'Updated Assembly Process' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.name).toBe('Updated Assembly Process');
  });

  // ── Add Stage to existing Process ─────────────────────────────────────────

  test('POST /api/processes/:id/stages — admin can add stage', async ({ request }) => {
    test.skip(!processId, 'No process was created');
    const res = await request.post(`/api/processes/${processId}/stages`, {
      headers: authHeader(adminToken),
      data: {
        name: 'Packaging',
        sequence: 5,
        targetTimeSeconds: 450,
        description: 'Final packaging step',
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.data.name).toBe('Packaging');
    stageIds.push(body.data.id);
  });

  test('POST /api/processes/:id/stages — supervisor cannot add stage', async ({ request }) => {
    test.skip(!processId, 'No process was created');
    const res = await request.post(`/api/processes/${processId}/stages`, {
      headers: authHeader(supervisorToken),
      data: { name: 'Fail', sequence: 99, targetTimeSeconds: 100 },
    });
    expect(res.status()).toBe(403);
  });

  // ── Update Stage ──────────────────────────────────────────────────────────

  test('PATCH /api/stages/:id — admin can update stage', async ({ request }) => {
    test.skip(stageIds.length === 0, 'No stages available');
    const res = await request.patch(`/api/stages/${stageIds[0]}`, {
      headers: authHeader(adminToken),
      data: { name: 'Updated Cutting', targetTimeSeconds: 700 },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.name).toBe('Updated Cutting');
    expect(body.data.targetTimeSeconds).toBe(700);
  });

  // ── Reorder Stages ────────────────────────────────────────────────────────

  test('PATCH /api/processes/:id/stages/reorder — admin can reorder stages', async ({ request }) => {
    test.skip(!processId || stageIds.length < 2, 'Not enough stages');
    const reversed = [...stageIds].reverse();
    const res = await request.patch(`/api/processes/${processId}/stages/reorder`, {
      headers: authHeader(adminToken),
      data: { stageIds: reversed },
    });
    expect(res.status()).toBe(200);
  });

  // ── Delete Stage ──────────────────────────────────────────────────────────

  test('DELETE /api/stages/:id — admin can delete a stage', async ({ request }) => {
    test.skip(stageIds.length === 0, 'No stages available');
    const stageToDelete = stageIds[stageIds.length - 1]; // delete last
    const res = await request.delete(`/api/stages/${stageToDelete}`, {
      headers: authHeader(adminToken),
    });
    expect(res.status()).toBe(200);
  });

  // ── Delete Process ────────────────────────────────────────────────────────

  test('DELETE /api/processes/:id — manager cannot delete process', async ({ request }) => {
    test.skip(!processId, 'No process was created');
    const res = await request.delete(`/api/processes/${processId}`, {
      headers: authHeader(managerToken),
    });
    expect(res.status()).toBe(403);
  });

  test('DELETE /api/processes/:id — admin can delete process', async ({ request }) => {
    // Create a disposable process
    const createRes = await request.post('/api/processes', {
      headers: authHeader(adminToken),
      data: {
        name: `Disposable ${Date.now()}`,
        productId,
        stages: [{ name: 'S1', targetTimeSeconds: 100 }],
      },
    });
    const disposableId = (await createRes.json()).data.id;

    const res = await request.delete(`/api/processes/${disposableId}`, {
      headers: authHeader(adminToken),
    });
    expect(res.status()).toBe(200);
  });
});
