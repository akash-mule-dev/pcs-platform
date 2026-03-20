import { test, expect } from '@playwright/test';

test.describe('Phase 13 — Infrastructure & Health Checks', () => {
  test('GET /api/health — should return health status (no auth required)', async ({ request }) => {
    const res = await request.get('/api/health');
    expect(res.status()).toBe(200);
    const body = await res.json();
    const data = body.data;
    expect(data).toHaveProperty('status');
    expect(data.status).toBe('healthy');
    expect(data).toHaveProperty('timestamp');
    expect(data).toHaveProperty('uptime');
    expect(typeof data.uptime).toBe('number');
    expect(data.uptime).toBeGreaterThan(0);

    // Database info
    expect(data).toHaveProperty('database');
    expect(data.database.connected).toBe(true);
    expect(typeof data.database.latencyMs).toBe('number');
    expect(data.database.latencyMs).toBeGreaterThanOrEqual(0);

    // Memory info
    expect(data).toHaveProperty('memory');
    expect(typeof data.memory.rss).toBe('number');
    expect(typeof data.memory.heapUsed).toBe('number');
    expect(typeof data.memory.heapTotal).toBe('number');
  });

  test('GET /api/health/ready — should return readiness status', async ({ request }) => {
    const res = await request.get('/api/health/ready');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe('ready');
  });

  test('Health endpoints should not require authentication', async ({ request }) => {
    // No Authorization header
    const healthRes = await request.get('/api/health');
    expect(healthRes.status()).toBe(200);

    const readyRes = await request.get('/api/health/ready');
    expect(readyRes.status()).toBe(200);
  });

  test('Swagger docs should be accessible', async ({ request }) => {
    const res = await request.get('/api/docs');
    // Swagger UI returns HTML
    expect(res.status()).toBe(200);
    const text = await res.text();
    expect(text).toContain('swagger');
  });
});
