import { test, expect } from '@playwright/test';
import { loginAs, authHeader } from '../helpers/auth.helper';

test.describe('Dashboard & Analytics', () => {
  let adminToken: string;
  let managerToken: string;
  let supervisorToken: string;
  let operatorToken: string;

  test.beforeAll(async ({ request }) => {
    ({ token: adminToken } = await loginAs(request, 'admin'));
    ({ token: managerToken } = await loginAs(request, 'manager'));
    ({ token: supervisorToken } = await loginAs(request, 'supervisor'));
    ({ token: operatorToken } = await loginAs(request, 'operator'));
  });

  // ── Summary ───────────────────────────────────────────────────────────────

  test('GET /api/dashboard/summary — returns KPI data', async ({ request }) => {
    const res = await request.get('/api/dashboard/summary', {
      headers: authHeader(adminToken),
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data).toBeTruthy();
  });

  test('GET /api/dashboard/summary — all roles can access', async ({ request }) => {
    for (const role of ['admin', 'manager', 'supervisor', 'operator'] as const) {
      const { token } = await loginAs(request, role);
      const res = await request.get('/api/dashboard/summary', {
        headers: authHeader(token),
      });
      expect(res.status()).toBe(200);
    }
  });

  test('GET /api/dashboard/summary — rejects without auth', async ({ request }) => {
    const res = await request.get('/api/dashboard/summary');
    expect(res.status()).toBe(401);
  });

  // ── Live Status ───────────────────────────────────────────────────────────

  test('GET /api/dashboard/live-status — returns current status', async ({ request }) => {
    const res = await request.get('/api/dashboard/live-status', {
      headers: authHeader(adminToken),
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data).toBeTruthy();
  });

  // ── Operator Performance ──────────────────────────────────────────────────

  test('GET /api/dashboard/operator-performance — admin can access', async ({ request }) => {
    const res = await request.get('/api/dashboard/operator-performance', {
      headers: authHeader(adminToken),
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data).toBeTruthy();
  });

  test('GET /api/dashboard/operator-performance — supervisor can access', async ({ request }) => {
    const res = await request.get('/api/dashboard/operator-performance', {
      headers: authHeader(supervisorToken),
    });
    expect(res.status()).toBe(200);
  });

  test('GET /api/dashboard/operator-performance — operator CANNOT access', async ({ request }) => {
    const res = await request.get('/api/dashboard/operator-performance', {
      headers: authHeader(operatorToken),
    });
    expect(res.status()).toBe(403);
  });

  // ── Stage Analytics ───────────────────────────────────────────────────────

  test('GET /api/dashboard/stage-analytics — admin can access', async ({ request }) => {
    const res = await request.get('/api/dashboard/stage-analytics', {
      headers: authHeader(adminToken),
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data).toBeTruthy();
  });

  test('GET /api/dashboard/stage-analytics — manager can access', async ({ request }) => {
    const res = await request.get('/api/dashboard/stage-analytics', {
      headers: authHeader(managerToken),
    });
    expect(res.status()).toBe(200);
  });

  test('GET /api/dashboard/stage-analytics — supervisor CANNOT access', async ({ request }) => {
    const res = await request.get('/api/dashboard/stage-analytics', {
      headers: authHeader(supervisorToken),
    });
    expect(res.status()).toBe(403);
  });

  test('GET /api/dashboard/stage-analytics — operator CANNOT access', async ({ request }) => {
    const res = await request.get('/api/dashboard/stage-analytics', {
      headers: authHeader(operatorToken),
    });
    expect(res.status()).toBe(403);
  });

  // ── OEE ───────────────────────────────────────────────────────────────────

  test('GET /api/dashboard/oee — admin can access OEE metrics', async ({ request }) => {
    const today = new Date().toISOString().split('T')[0];
    const res = await request.get(
      `/api/dashboard/oee?startDate=${today}&endDate=${today}`,
      { headers: authHeader(adminToken) },
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data).toBeTruthy();
  });

  test('GET /api/dashboard/oee — supervisor CANNOT access', async ({ request }) => {
    const res = await request.get('/api/dashboard/oee', {
      headers: authHeader(supervisorToken),
    });
    expect(res.status()).toBe(403);
  });

  // ── Export ────────────────────────────────────────────────────────────────

  test('GET /api/dashboard/export — admin can export data', async ({ request }) => {
    const today = new Date().toISOString().split('T')[0];
    const res = await request.get(
      `/api/dashboard/export?startDate=${today}&endDate=${today}`,
      { headers: authHeader(adminToken) },
    );
    expect(res.status()).toBe(200);
  });

  test('GET /api/dashboard/export — operator CANNOT export', async ({ request }) => {
    const res = await request.get('/api/dashboard/export', {
      headers: authHeader(operatorToken),
    });
    expect(res.status()).toBe(403);
  });
});
