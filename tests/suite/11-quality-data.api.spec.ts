import { test, expect } from '@playwright/test';
import { loginAs, authHeader } from '../helpers/auth.helper';

test.describe('Quality Data — CRUD & Signoff workflow', () => {
  let adminToken: string;
  let managerToken: string;
  let supervisorToken: string;
  let operatorToken: string;
  let modelId: string;
  let qualityDataId: string;

  test.beforeAll(async ({ request }) => {
    ({ token: adminToken } = await loginAs(request, 'admin'));
    ({ token: managerToken } = await loginAs(request, 'manager'));
    ({ token: supervisorToken } = await loginAs(request, 'supervisor'));
    ({ token: operatorToken } = await loginAs(request, 'operator'));

    // Try to get an existing model ID for quality data tests
    const modelsRes = await request.get('/api/models?limit=1', {
      headers: authHeader(adminToken),
    });
    if (modelsRes.status() === 200) {
      const models = (await modelsRes.json()).data;
      if (Array.isArray(models) && models.length > 0) {
        modelId = models[0].id;
      }
    }
  });

  // ── Create Quality Data ───────────────────────────────────────────────────

  test('POST /api/quality-data — supervisor can create quality data', async ({ request }) => {
    test.skip(!modelId, 'No model available for quality data');

    const res = await request.post('/api/quality-data', {
      headers: authHeader(supervisorToken),
      data: {
        modelId,
        meshName: 'mesh_component_001',
        regionLabel: 'Top Surface',
        status: 'pass',
        inspector: 'Vikram Deshmukh',
        inspectionDate: new Date().toISOString(),
        notes: 'No defects found',
        measurementValue: 12.5,
        measurementUnit: 'mm',
        toleranceMin: 12.0,
        toleranceMax: 13.0,
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    qualityDataId = body.data.id;
    expect(body.data.status).toBe('pass');
    expect(body.data.meshName).toBe('mesh_component_001');
  });

  test('POST /api/quality-data — create with defect', async ({ request }) => {
    test.skip(!modelId, 'No model available');

    const res = await request.post('/api/quality-data', {
      headers: authHeader(supervisorToken),
      data: {
        modelId,
        meshName: 'mesh_component_002',
        status: 'fail',
        inspector: 'Vikram Deshmukh',
        defectType: 'crack',
        severity: 'high',
        notes: 'Visible crack on surface',
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.data.status).toBe('fail');
    expect(body.data.severity).toBe('high');
  });

  test('POST /api/quality-data — operator CANNOT create quality data', async ({ request }) => {
    test.skip(!modelId, 'No model available');

    const res = await request.post('/api/quality-data', {
      headers: authHeader(operatorToken),
      data: {
        modelId,
        meshName: 'test',
        status: 'pass',
      },
    });
    expect(res.status()).toBe(403);
  });

  // ── Bulk Create ───────────────────────────────────────────────────────────

  test('POST /api/quality-data/bulk — can bulk create quality data', async ({ request }) => {
    test.skip(!modelId, 'No model available');

    const res = await request.post('/api/quality-data/bulk', {
      headers: authHeader(adminToken),
      data: {
        items: [
          { modelId, meshName: 'bulk_1', status: 'pass', inspector: 'Auto' },
          { modelId, meshName: 'bulk_2', status: 'warning', inspector: 'Auto', severity: 'low' },
          { modelId, meshName: 'bulk_3', status: 'fail', inspector: 'Auto', defectType: 'scratch', severity: 'medium' },
        ],
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(Array.isArray(body.data)).toBeTruthy();
    expect(body.data.length).toBe(3);
  });

  // ── List Quality Data ─────────────────────────────────────────────────────

  test('GET /api/quality-data — returns paginated list', async ({ request }) => {
    const res = await request.get('/api/quality-data?page=1&limit=10', {
      headers: authHeader(adminToken),
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data)).toBeTruthy();
    expect(body.meta).toBeTruthy();
  });

  test('GET /api/quality-data — operator CANNOT list', async ({ request }) => {
    const res = await request.get('/api/quality-data', {
      headers: authHeader(operatorToken),
    });
    expect(res.status()).toBe(403);
  });

  // ── Get by Model ──────────────────────────────────────────────────────────

  test('GET /api/quality-data/by-model/:modelId — returns data for model', async ({ request }) => {
    test.skip(!modelId, 'No model available');
    const res = await request.get(`/api/quality-data/by-model/${modelId}`, {
      headers: authHeader(adminToken),
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data)).toBeTruthy();
  });

  // ── Summary & Trends ─────────────────────────────────────────────────────

  test('GET /api/quality-data/summary/:modelId — returns quality summary', async ({ request }) => {
    test.skip(!modelId, 'No model available');
    const res = await request.get(`/api/quality-data/summary/${modelId}`, {
      headers: authHeader(adminToken),
    });
    expect(res.status()).toBe(200);
  });

  test('GET /api/quality-data/trends/:modelId — returns trend data', async ({ request }) => {
    test.skip(!modelId, 'No model available');
    const res = await request.get(`/api/quality-data/trends/${modelId}`, {
      headers: authHeader(adminToken),
    });
    expect(res.status()).toBe(200);
  });

  test('GET /api/quality-data/defect-patterns/:modelId — returns defect patterns', async ({ request }) => {
    test.skip(!modelId, 'No model available');
    const res = await request.get(`/api/quality-data/defect-patterns/${modelId}`, {
      headers: authHeader(adminToken),
    });
    expect(res.status()).toBe(200);
  });

  // ── Pending Signoffs ──────────────────────────────────────────────────────

  test('GET /api/quality-data/pending-signoffs — returns pending items', async ({ request }) => {
    const res = await request.get('/api/quality-data/pending-signoffs', {
      headers: authHeader(adminToken),
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data)).toBeTruthy();
  });

  // ── Get single ────────────────────────────────────────────────────────────

  test('GET /api/quality-data/:id — returns quality data details', async ({ request }) => {
    test.skip(!qualityDataId, 'No quality data was created');
    const res = await request.get(`/api/quality-data/${qualityDataId}`, {
      headers: authHeader(adminToken),
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.id).toBe(qualityDataId);
  });

  // ── Update ────────────────────────────────────────────────────────────────

  test('PATCH /api/quality-data/:id — can update quality data', async ({ request }) => {
    test.skip(!qualityDataId, 'No quality data was created');
    const res = await request.patch(`/api/quality-data/${qualityDataId}`, {
      headers: authHeader(supervisorToken),
      data: { notes: 'Updated after re-inspection', status: 'warning' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.notes).toBe('Updated after re-inspection');
  });

  // ── Signoff Workflow ──────────────────────────────────────────────────────

  test('PATCH /api/quality-data/:id/signoff — approve quality data', async ({ request }) => {
    test.skip(!qualityDataId, 'No quality data was created');
    const res = await request.patch(`/api/quality-data/${qualityDataId}/signoff`, {
      headers: authHeader(managerToken),
      data: {
        status: 'approved',
        signoffBy: 'Priya Sharma',
        notes: 'Approved after review',
      },
    });
    expect(res.status()).toBe(200);
  });

  test('PATCH /api/quality-data/:id/signoff — reject quality data', async ({ request }) => {
    test.skip(!modelId, 'No model available');

    // Create new quality data to reject
    const createRes = await request.post('/api/quality-data', {
      headers: authHeader(supervisorToken),
      data: { modelId, meshName: 'reject_test', status: 'fail', inspector: 'Test' },
    });
    const newId = (await createRes.json()).data.id;

    const res = await request.patch(`/api/quality-data/${newId}/signoff`, {
      headers: authHeader(managerToken),
      data: {
        status: 'rejected',
        signoffBy: 'Priya Sharma',
        notes: 'Needs rework',
      },
    });
    expect(res.status()).toBe(200);
  });

  // ── Delete ────────────────────────────────────────────────────────────────

  test('DELETE /api/quality-data/:id — supervisor CANNOT delete', async ({ request }) => {
    test.skip(!qualityDataId, 'No quality data was created');
    const res = await request.delete(`/api/quality-data/${qualityDataId}`, {
      headers: authHeader(supervisorToken),
    });
    expect(res.status()).toBe(403);
  });

  test('DELETE /api/quality-data/:id — admin can delete', async ({ request }) => {
    test.skip(!modelId, 'No model available');

    // Create disposable
    const createRes = await request.post('/api/quality-data', {
      headers: authHeader(adminToken),
      data: { modelId, meshName: 'disposable', status: 'pass', inspector: 'Test' },
    });
    const disposableId = (await createRes.json()).data.id;

    const res = await request.delete(`/api/quality-data/${disposableId}`, {
      headers: authHeader(adminToken),
    });
    expect(res.status()).toBe(200);
  });
});
