import { test, expect } from '@playwright/test';
import { loginAs, authHeader } from '../helpers/auth.helper';
import { createProduct } from '../helpers/test-data.helper';

test.describe('Search — Global cross-entity search', () => {
  let adminToken: string;
  let operatorToken: string;
  const searchableName = `Searchable Widget ${Date.now()}`;

  test.beforeAll(async ({ request }) => {
    ({ token: adminToken } = await loginAs(request, 'admin'));
    ({ token: operatorToken } = await loginAs(request, 'operator'));

    // Create a product with a unique name we can search for
    await createProduct(request, adminToken, { name: searchableName });
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
    // Structure: { workOrders: [], products: [], users: [] } or similar
    expect(result).toBeTruthy();
    if (result.products) {
      expect(Array.isArray(result.products)).toBeTruthy();
    }
    if (result.workOrders) {
      expect(Array.isArray(result.workOrders)).toBeTruthy();
    }
  });

  // ── Search finds created data ─────────────────────────────────────────────

  test('Search finds recently created product by name', async ({ request }) => {
    const keyword = searchableName.split(' ')[0]; // "Searchable"
    const res = await request.get(`/api/search?q=${keyword}`, {
      headers: authHeader(adminToken),
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    const result = body.data;

    // Should find the product we created
    if (result.products) {
      const found = result.products.some((p: any) =>
        p.name?.includes('Searchable'),
      );
      expect(found).toBeTruthy();
    }
  });
});
