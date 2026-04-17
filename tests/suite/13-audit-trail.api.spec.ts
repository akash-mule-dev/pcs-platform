import { test, expect } from '@playwright/test';
import { loginAs, authHeader } from '../helpers/auth.helper';
import { createProduct } from '../helpers/test-data.helper';

test.describe('Audit Trail — Logging & access control', () => {
  let adminToken: string;
  let managerToken: string;
  let supervisorToken: string;
  let operatorToken: string;

  test.beforeAll(async ({ request }) => {
    ({ token: adminToken } = await loginAs(request, 'admin'));
    ({ token: managerToken } = await loginAs(request, 'manager'));
    ({ token: supervisorToken } = await loginAs(request, 'supervisor'));
    ({ token: operatorToken } = await loginAs(request, 'operator'));

    // Perform an action that should create an audit entry
    await createProduct(request, adminToken, { name: `Audit Test Product ${Date.now()}` });
  });

  // ── List Audit Logs ───────────────────────────────────────────────────────

  test('GET /api/audit — admin can list audit logs', async ({ request }) => {
    const res = await request.get('/api/audit?page=1&limit=10', {
      headers: authHeader(adminToken),
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data)).toBeTruthy();
    expect(body.meta).toBeTruthy();
  });

  test('GET /api/audit — manager can list audit logs', async ({ request }) => {
    const res = await request.get('/api/audit', {
      headers: authHeader(managerToken),
    });
    expect(res.status()).toBe(200);
  });

  test('GET /api/audit — supervisor CANNOT list audit logs', async ({ request }) => {
    const res = await request.get('/api/audit', {
      headers: authHeader(supervisorToken),
    });
    expect(res.status()).toBe(403);
  });

  test('GET /api/audit — operator CANNOT list audit logs', async ({ request }) => {
    const res = await request.get('/api/audit', {
      headers: authHeader(operatorToken),
    });
    expect(res.status()).toBe(403);
  });

  test('GET /api/audit — rejects without auth', async ({ request }) => {
    const res = await request.get('/api/audit');
    expect(res.status()).toBe(401);
  });

  // ── Pagination ────────────────────────────────────────────────────────────

  test('GET /api/audit — supports pagination parameters', async ({ request }) => {
    const res = await request.get('/api/audit?page=1&limit=5&order=DESC', {
      headers: authHeader(adminToken),
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.meta.limit).toBe(5);
    expect(body.meta.page).toBe(1);
  });

  // ── Filtering ─────────────────────────────────────────────────────────────

  test('GET /api/audit — filter by entityType', async ({ request }) => {
    const res = await request.get('/api/audit?entityType=product', {
      headers: authHeader(adminToken),
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    for (const log of body.data) {
      expect(log.entityType?.toLowerCase()).toBe('product');
    }
  });

  test('GET /api/audit — filter by userId', async ({ request }) => {
    const { user: adminUser } = await loginAs(request, 'admin');
    const res = await request.get(`/api/audit?userId=${adminUser.id}`, {
      headers: authHeader(adminToken),
    });
    expect(res.status()).toBe(200);
  });

  // ── Audit entry structure ─────────────────────────────────────────────────

  test('Audit entries have correct structure', async ({ request }) => {
    const res = await request.get('/api/audit?limit=5', {
      headers: authHeader(adminToken),
    });
    const body = await res.json();
    if (body.data.length > 0) {
      const entry = body.data[0];
      expect(entry.id).toBeTruthy();
      expect(entry.action).toBeTruthy();      // create, update, delete
      expect(entry.entityType).toBeTruthy();   // product, work_order, etc.
      expect(entry.createdAt).toBeTruthy();
    }
  });
});
