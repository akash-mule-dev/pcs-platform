import { test, expect, APIRequestContext } from '@playwright/test';

let token: string;

async function getAuthToken(request: APIRequestContext): Promise<string> {
  const res = await request.post('/api/auth/login', {
    data: { email: 'admin@pcs.local', password: 'password123' },
  });
  expect(res.status()).toBe(201);
  return (await res.json()).data.accessToken;
}

test.describe('Phase 10 — Global Search', () => {
  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request);
  });

  test('GET /api/search?q=WO — should find work orders', async ({ request }) => {
    const res = await request.get('/api/search?q=WO', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    const data = body.data;
    expect(data).toHaveProperty('workOrders');
    expect(data).toHaveProperty('products');
    expect(data).toHaveProperty('users');
    expect(Array.isArray(data.workOrders)).toBeTruthy();
    // Seeded WOs start with "WO-", should find matches
    expect(data.workOrders.length).toBeGreaterThan(0);
  });

  test('GET /api/search?q=PCB — should find products', async ({ request }) => {
    const res = await request.get('/api/search?q=PCB', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.products.length).toBeGreaterThan(0);
    // Search matches on product name
    const match = body.data.products[0];
    expect(match.name.toLowerCase()).toContain('pcb');
  });

  test('GET /api/search?q=John — should find users', async ({ request }) => {
    const res = await request.get('/api/search?q=John', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.users.length).toBeGreaterThan(0);
  });

  test('GET /api/search?q=x — should return empty for short queries', async ({ request }) => {
    const res = await request.get('/api/search?q=x', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.workOrders).toHaveLength(0);
    expect(body.data.products).toHaveLength(0);
    expect(body.data.users).toHaveLength(0);
  });

  test('GET /api/search?q=nonexistent_xyz_123 — should return empty for no matches', async ({ request }) => {
    const res = await request.get('/api/search?q=nonexistent_xyz_123', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.workOrders).toHaveLength(0);
    expect(body.data.products).toHaveLength(0);
    expect(body.data.users).toHaveLength(0);
  });

  test('GET /api/search — should reject without auth', async ({ request }) => {
    const res = await request.get('/api/search?q=WO');
    expect(res.status()).toBe(401);
  });
});
