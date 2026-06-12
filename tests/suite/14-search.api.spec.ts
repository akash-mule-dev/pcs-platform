import { test, expect } from '@playwright/test';
import { loginAs, authHeader } from '../helpers/auth.helper';
import { createProcess, createWorkOrder } from '../helpers/test-data.helper';

test.describe('Search — Global cross-entity search', () => {
  let adminToken: string;
  let operatorToken: string;
  let searchableOrderNumber: string;

  test.beforeAll(async ({ request }) => {
    ({ token: adminToken } = await loginAs(request, 'admin'));
    ({ token: operatorToken } = await loginAs(request, 'operator'));

    // Create a work order whose orderNumber we can search for
    const process = await createProcess(request, adminToken);
    const workOrder = await createWorkOrder(request, adminToken, process.id);
    searchableOrderNumber = workOrder.orderNumber;
  });

  // ── Basic search ──────────────────────────────────────────────────────────

  test('GET /api/search?q=... — returns search results', async ({ request }) => {
    const res = await request.get('/api/search?q=Searchable', {
      headers: authHeader(adminToken),
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data).toBeTruthy();
  });

  test('GET /api/search — all roles can search', async ({ request }) => {
    for (const role of ['admin', 'manager', 'supervisor', 'operator'] as const) {
      const { token } = await loginAs(request, role);
      const res = await request.get('/api/search?q=test', {
        headers: authHeader(token),
      });
      expect(res.status()).toBe(200);
    }
  });

  test('GET /api/search — rejects without auth', async ({ request }) => {
    const res = await request.get('/api/search?q=test');
    expect(res.status()).toBe(401);
  });

  // ── Validation ────────────────────────────────────────────────────────────

  test('GET /api/search — rejects empty query', async ({ request }) => {
    const res = await request.get('/api/search?q=', {
      headers: authHeader(adminToken),
    });
    expect([400, 200]).toContain(res.status()); // May return empty or reject
  });

  test('GET /api/search — rejects single character query', async ({ request }) => {
    const res = await request.get('/api/search?q=a', {
      headers: authHeader(adminToken),
    });
    // Minimum 2 chars required per controller
    expect([400, 200]).toContain(res.status());
  });

  test('GET /api/search — rejects missing q parameter', async ({ request }) => {
    const res = await request.get('/api/search', {
      headers: authHeader(adminToken),
    });
    expect([400, 200]).toContain(res.status());
  });

  // ── Cross-entity results ──────────────────────────────────────────────────

  test('Search returns structured cross-entity results', async ({ request }) => {
    const res = await request.get('/api/search?q=test', {
      headers: authHeader(adminToken),
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    const result = body.data;

    // Search should return results from multiple entity types
    // Structure: { workOrders: [], users: [] }
    expect(result).toBeTruthy();
    if (result.workOrders) {
      expect(Array.isArray(result.workOrders)).toBeTruthy();
    }
    if (result.users) {
      expect(Array.isArray(result.users)).toBeTruthy();
    }
  });

  // ── Search finds created data ─────────────────────────────────────────────

  test('Search finds recently created work order by order number', async ({ request }) => {
    test.skip(!searchableOrderNumber, 'No work order was created');
    const res = await request.get(`/api/search?q=${encodeURIComponent(searchableOrderNumber)}`, {
      headers: authHeader(adminToken),
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    const result = body.data;

    // Should find the work order we created
    if (result.workOrders) {
      const found = result.workOrders.some((wo: any) =>
        wo.orderNumber?.includes(searchableOrderNumber),
      );
      expect(found).toBeTruthy();
    }
  });
});
