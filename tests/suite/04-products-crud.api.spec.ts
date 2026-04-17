import { test, expect } from '@playwright/test';
import { loginAs, authHeader } from '../helpers/auth.helper';

test.describe('Products — CRUD operations', () => {
  let adminToken: string;
  let managerToken: string;
  let supervisorToken: string;
  let operatorToken: string;
  let createdProductId: string;

  test.beforeAll(async ({ request }) => {
    ({ token: adminToken } = await loginAs(request, 'admin'));
    ({ token: managerToken } = await loginAs(request, 'manager'));
    ({ token: supervisorToken } = await loginAs(request, 'supervisor'));
    ({ token: operatorToken } = await loginAs(request, 'operator'));
  });

  // ── Create ────────────────────────────────────────────────────────────────

  test('POST /api/products — admin can create product', async ({ request }) => {
    const res = await request.post('/api/products', {
      headers: authHeader(adminToken),
      data: { name: `Admin Product ${Date.now()}`, description: 'Created by admin test' },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    createdProductId = body.data.id;
    expect(body.data.name).toContain('Admin Product');
    expect(body.data.description).toBe('Created by admin test');
    expect(body.data.isActive).toBe(true);
  });

  test('POST /api/products — manager can create product', async ({ request }) => {
    const res = await request.post('/api/products', {
      headers: authHeader(managerToken),
      data: { name: `Manager Product ${Date.now()}` },
    });
    expect(res.status()).toBe(201);
  });

  test('POST /api/products — supervisor cannot create product', async ({ request }) => {
    const res = await request.post('/api/products', {
      headers: authHeader(supervisorToken),
      data: { name: 'Should Fail' },
    });
    expect(res.status()).toBe(403);
  });

  test('POST /api/products — operator cannot create product', async ({ request }) => {
    const res = await request.post('/api/products', {
      headers: authHeader(operatorToken),
      data: { name: 'Should Fail' },
    });
    expect(res.status()).toBe(403);
  });

  test('POST /api/products — rejects missing name', async ({ request }) => {
    const res = await request.post('/api/products', {
      headers: authHeader(adminToken),
      data: { description: 'No name provided' },
    });
    expect(res.status()).toBe(400);
  });

  // ── List ──────────────────────────────────────────────────────────────────

  test('GET /api/products — returns paginated list', async ({ request }) => {
    const res = await request.get('/api/products?page=1&limit=5', {
      headers: authHeader(adminToken),
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data)).toBeTruthy();
    expect(body.meta).toBeTruthy();
    expect(body.meta.page).toBe(1);
    expect(body.meta.limit).toBe(5);
  });

  test('GET /api/products — all roles can list products', async ({ request }) => {
    for (const token of [adminToken, managerToken, supervisorToken, operatorToken]) {
      const res = await request.get('/api/products', { headers: authHeader(token) });
      expect(res.status()).toBe(200);
    }
  });

  // ── Get single ────────────────────────────────────────────────────────────

  test('GET /api/products/:id — returns product details', async ({ request }) => {
    test.skip(!createdProductId, 'No product was created');
    const res = await request.get(`/api/products/${createdProductId}`, {
      headers: authHeader(adminToken),
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.id).toBe(createdProductId);
  });

  test('GET /api/products/:id — 404 for non-existent product', async ({ request }) => {
    const res = await request.get('/api/products/00000000-0000-0000-0000-000000000000', {
      headers: authHeader(adminToken),
    });
    expect([404, 400]).toContain(res.status());
  });

  // ── Update ────────────────────────────────────────────────────────────────

  test('PATCH /api/products/:id — admin can update product', async ({ request }) => {
    test.skip(!createdProductId, 'No product was created');
    const res = await request.patch(`/api/products/${createdProductId}`, {
      headers: authHeader(adminToken),
      data: { name: 'Updated Product Name', description: 'Updated description' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.name).toBe('Updated Product Name');
  });

  test('PATCH /api/products/:id — manager can update product', async ({ request }) => {
    test.skip(!createdProductId, 'No product was created');
    const res = await request.patch(`/api/products/${createdProductId}`, {
      headers: authHeader(managerToken),
      data: { description: 'Manager updated this' },
    });
    expect(res.status()).toBe(200);
  });

  test('PATCH /api/products/:id — supervisor cannot update product', async ({ request }) => {
    test.skip(!createdProductId, 'No product was created');
    const res = await request.patch(`/api/products/${createdProductId}`, {
      headers: authHeader(supervisorToken),
      data: { name: 'Hacked' },
    });
    expect(res.status()).toBe(403);
  });

  // ── Deactivate ────────────────────────────────────────────────────────────

  test('PATCH /api/products/:id — can deactivate product', async ({ request }) => {
    test.skip(!createdProductId, 'No product was created');
    const res = await request.patch(`/api/products/${createdProductId}`, {
      headers: authHeader(adminToken),
      data: { isActive: false },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.isActive).toBe(false);

    // Reactivate for other tests
    await request.patch(`/api/products/${createdProductId}`, {
      headers: authHeader(adminToken),
      data: { isActive: true },
    });
  });

  // ── Delete ────────────────────────────────────────────────────────────────

  test('DELETE /api/products/:id — manager cannot delete product', async ({ request }) => {
    test.skip(!createdProductId, 'No product was created');
    const res = await request.delete(`/api/products/${createdProductId}`, {
      headers: authHeader(managerToken),
    });
    expect(res.status()).toBe(403);
  });

  test('DELETE /api/products/:id — admin can delete product', async ({ request }) => {
    // Create a disposable product
    const createRes = await request.post('/api/products', {
      headers: authHeader(adminToken),
      data: { name: `Disposable ${Date.now()}` },
    });
    const disposableId = (await createRes.json()).data.id;

    const res = await request.delete(`/api/products/${disposableId}`, {
      headers: authHeader(adminToken),
    });
    expect(res.status()).toBe(200);
  });
});
