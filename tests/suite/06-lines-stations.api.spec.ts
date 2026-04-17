import { test, expect } from '@playwright/test';
import { loginAs, authHeader } from '../helpers/auth.helper';

test.describe('Lines & Stations — CRUD operations', () => {
  let adminToken: string;
  let managerToken: string;
  let supervisorToken: string;
  let operatorToken: string;
  let lineId: string;
  let stationId: string;

  test.beforeAll(async ({ request }) => {
    ({ token: adminToken } = await loginAs(request, 'admin'));
    ({ token: managerToken } = await loginAs(request, 'manager'));
    ({ token: supervisorToken } = await loginAs(request, 'supervisor'));
    ({ token: operatorToken } = await loginAs(request, 'operator'));
  });

  // ── Create Line ───────────────────────────────────────────────────────────

  test('POST /api/lines — admin can create line', async ({ request }) => {
    const res = await request.post('/api/lines', {
      headers: authHeader(adminToken),
      data: { name: `Line Alpha ${Date.now()}`, description: 'Primary assembly line' },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    lineId = body.data.id;
    expect(body.data.name).toContain('Line Alpha');
    expect(body.data.isActive).toBe(true);
  });

  test('POST /api/lines — manager can create line', async ({ request }) => {
    const res = await request.post('/api/lines', {
      headers: authHeader(managerToken),
      data: { name: `Manager Line ${Date.now()}` },
    });
    expect(res.status()).toBe(201);
  });

  test('POST /api/lines — supervisor cannot create line', async ({ request }) => {
    const res = await request.post('/api/lines', {
      headers: authHeader(supervisorToken),
      data: { name: 'Should Fail' },
    });
    expect(res.status()).toBe(403);
  });

  test('POST /api/lines — operator cannot create line', async ({ request }) => {
    const res = await request.post('/api/lines', {
      headers: authHeader(operatorToken),
      data: { name: 'Should Fail' },
    });
    expect(res.status()).toBe(403);
  });

  // ── List Lines ────────────────────────────────────────────────────────────

  test('GET /api/lines — returns paginated list', async ({ request }) => {
    const res = await request.get('/api/lines?page=1&limit=10', {
      headers: authHeader(adminToken),
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data)).toBeTruthy();
    expect(body.meta).toBeTruthy();
  });

  test('GET /api/lines — all roles can list lines', async ({ request }) => {
    for (const role of ['admin', 'manager', 'supervisor', 'operator'] as const) {
      const { token } = await loginAs(request, role);
      const res = await request.get('/api/lines', { headers: authHeader(token) });
      expect(res.status()).toBe(200);
    }
  });

  // ── Get single Line ───────────────────────────────────────────────────────

  test('GET /api/lines/:id — returns line details', async ({ request }) => {
    test.skip(!lineId, 'No line was created');
    const res = await request.get(`/api/lines/${lineId}`, {
      headers: authHeader(adminToken),
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.id).toBe(lineId);
  });

  // ── Update Line ───────────────────────────────────────────────────────────

  test('PATCH /api/lines/:id — admin can update line', async ({ request }) => {
    test.skip(!lineId, 'No line was created');
    const res = await request.patch(`/api/lines/${lineId}`, {
      headers: authHeader(adminToken),
      data: { name: 'Updated Line Name', description: 'Updated description' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.name).toBe('Updated Line Name');
  });

  test('PATCH /api/lines/:id — supervisor cannot update line', async ({ request }) => {
    test.skip(!lineId, 'No line was created');
    const res = await request.patch(`/api/lines/${lineId}`, {
      headers: authHeader(supervisorToken),
      data: { name: 'Hacked' },
    });
    expect(res.status()).toBe(403);
  });

  // ═══ STATIONS ═════════════════════════════════════════════════════════════

  // ── Create Station ────────────────────────────────────────────────────────

  test('POST /api/stations — admin can create station', async ({ request }) => {
    test.skip(!lineId, 'No line was created');
    const res = await request.post('/api/stations', {
      headers: authHeader(adminToken),
      data: { name: `Station A1 ${Date.now()}`, lineId },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    stationId = body.data.id;
    expect(body.data.name).toContain('Station A1');
  });

  test('POST /api/stations — manager can create station', async ({ request }) => {
    test.skip(!lineId, 'No line was created');
    const res = await request.post('/api/stations', {
      headers: authHeader(managerToken),
      data: { name: `Station B1 ${Date.now()}`, lineId },
    });
    expect(res.status()).toBe(201);
  });

  test('POST /api/stations — supervisor cannot create station', async ({ request }) => {
    test.skip(!lineId, 'No line was created');
    const res = await request.post('/api/stations', {
      headers: authHeader(supervisorToken),
      data: { name: 'Should Fail', lineId },
    });
    expect(res.status()).toBe(403);
  });

  test('POST /api/stations — rejects missing lineId', async ({ request }) => {
    const res = await request.post('/api/stations', {
      headers: authHeader(adminToken),
      data: { name: 'No Line Station' },
    });
    expect(res.status()).toBe(400);
  });

  // ── List Stations for Line ────────────────────────────────────────────────

  test('GET /api/lines/:lineId/stations — returns stations for a line', async ({ request }) => {
    test.skip(!lineId, 'No line was created');
    const res = await request.get(`/api/lines/${lineId}/stations`, {
      headers: authHeader(adminToken),
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data)).toBeTruthy();
    expect(body.data.length).toBeGreaterThanOrEqual(1);
  });

  // ── Update Station ────────────────────────────────────────────────────────

  test('PATCH /api/stations/:id — admin can update station', async ({ request }) => {
    test.skip(!stationId, 'No station was created');
    const res = await request.patch(`/api/stations/${stationId}`, {
      headers: authHeader(adminToken),
      data: { name: 'Updated Station Name' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.name).toBe('Updated Station Name');
  });

  // ── Delete Station ────────────────────────────────────────────────────────

  test('DELETE /api/stations/:id — supervisor cannot delete station', async ({ request }) => {
    test.skip(!stationId, 'No station was created');
    const res = await request.delete(`/api/stations/${stationId}`, {
      headers: authHeader(supervisorToken),
    });
    expect(res.status()).toBe(403);
  });

  test('DELETE /api/stations/:id — admin can delete station', async ({ request }) => {
    test.skip(!lineId, 'No line was created');
    // Create a disposable station
    const createRes = await request.post('/api/stations', {
      headers: authHeader(adminToken),
      data: { name: `Disposable ${Date.now()}`, lineId },
    });
    const disposableId = (await createRes.json()).data.id;

    const res = await request.delete(`/api/stations/${disposableId}`, {
      headers: authHeader(adminToken),
    });
    expect(res.status()).toBe(200);
  });

  // ── Delete Line ───────────────────────────────────────────────────────────

  test('DELETE /api/lines/:id — manager cannot delete line', async ({ request }) => {
    test.skip(!lineId, 'No line was created');
    const res = await request.delete(`/api/lines/${lineId}`, {
      headers: authHeader(managerToken),
    });
    expect(res.status()).toBe(403);
  });

  test('DELETE /api/lines/:id — admin can delete line', async ({ request }) => {
    // Create a disposable line
    const createRes = await request.post('/api/lines', {
      headers: authHeader(adminToken),
      data: { name: `Disposable Line ${Date.now()}` },
    });
    const disposableId = (await createRes.json()).data.id;

    const res = await request.delete(`/api/lines/${disposableId}`, {
      headers: authHeader(adminToken),
    });
    expect(res.status()).toBe(200);
  });
});
