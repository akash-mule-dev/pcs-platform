import { test, expect, APIRequestContext } from '@playwright/test';

let token: string;

async function getAuthToken(request: APIRequestContext): Promise<string> {
  const res = await request.post('/api/auth/login', {
    data: { email: 'admin@pcs.local', password: 'password123' },
  });
  expect(res.status()).toBe(201);
  const body = await res.json();
  return body.data.accessToken;
}

test.describe('Phase 8 — Reporting & Analytics', () => {
  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request);
  });

  test('GET /api/dashboard/oee — should return OEE metrics', async ({ request }) => {
    const res = await request.get('/api/dashboard/oee', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    const oee = body.data;
    expect(oee).toHaveProperty('oee');
    expect(oee).toHaveProperty('availability');
    expect(oee).toHaveProperty('performance');
    expect(oee).toHaveProperty('quality');
    expect(oee).toHaveProperty('totalEntries');
    expect(oee).toHaveProperty('totalActualTime');
    expect(oee).toHaveProperty('totalPlannedTime');
    // Values should be numbers between 0-100
    expect(typeof oee.oee).toBe('number');
    expect(oee.oee).toBeGreaterThanOrEqual(0);
    expect(oee.oee).toBeLessThanOrEqual(100);
    expect(oee.availability).toBeGreaterThanOrEqual(0);
    expect(oee.performance).toBeGreaterThanOrEqual(0);
    expect(oee.quality).toBeGreaterThanOrEqual(0);
  });

  test('GET /api/dashboard/oee — should accept date range filters', async ({ request }) => {
    const startDate = new Date(2026, 0, 1).toISOString();
    const endDate = new Date(2026, 11, 31).toISOString();
    const res = await request.get(`/api/dashboard/oee?startDate=${startDate}&endDate=${endDate}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveProperty('oee');
  });

  test('GET /api/dashboard/export — should return CSV-friendly data', async ({ request }) => {
    const res = await request.get('/api/dashboard/export', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    const data = body.data;
    expect(Array.isArray(data)).toBeTruthy();
    // If there's seeded data, verify structure
    if (data.length > 0) {
      const row = data[0];
      expect(row).toHaveProperty('operator');
      expect(row).toHaveProperty('employeeId');
      expect(row).toHaveProperty('workOrder');
      expect(row).toHaveProperty('stage');
      expect(row).toHaveProperty('startTime');
      expect(row).toHaveProperty('endTime');
      expect(row).toHaveProperty('durationSeconds');
      expect(row).toHaveProperty('targetTimeSeconds');
      expect(row).toHaveProperty('variance');
      expect(row).toHaveProperty('inputMethod');
      expect(row).toHaveProperty('isRework');
    }
  });

  test('GET /api/dashboard/export — should filter by date range', async ({ request }) => {
    const startDate = new Date(2026, 2, 1).toISOString();
    const endDate = new Date(2026, 2, 31).toISOString();
    const res = await request.get(`/api/dashboard/export?startDate=${startDate}&endDate=${endDate}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data)).toBeTruthy();
  });

  test('GET /api/dashboard/operator-performance — should return operator metrics', async ({ request }) => {
    const res = await request.get('/api/dashboard/operator-performance', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    const data = body.data;
    expect(Array.isArray(data)).toBeTruthy();
    if (data.length > 0) {
      expect(data[0]).toHaveProperty('userId');
      expect(data[0]).toHaveProperty('operatorName');
      expect(data[0]).toHaveProperty('totalTime');
      expect(data[0]).toHaveProperty('stagesCompleted');
      expect(data[0]).toHaveProperty('avgEfficiency');
    }
  });

  test('GET /api/dashboard/stage-analytics — should return stage metrics', async ({ request }) => {
    const res = await request.get('/api/dashboard/stage-analytics', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    const data = body.data;
    expect(Array.isArray(data)).toBeTruthy();
    if (data.length > 0) {
      expect(data[0]).toHaveProperty('stageId');
      expect(data[0]).toHaveProperty('stageName');
      expect(data[0]).toHaveProperty('targetTime');
      expect(data[0]).toHaveProperty('avgTime');
      expect(data[0]).toHaveProperty('entryCount');
      expect(data[0]).toHaveProperty('efficiency');
    }
  });

  test('GET /api/dashboard/summary — should return dashboard summary with caching', async ({ request }) => {
    // First call populates cache
    const res1 = await request.get('/api/dashboard/summary', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res1.status()).toBe(200);
    const body1 = await res1.json();
    expect(body1.data).toHaveProperty('workOrdersByStatus');
    expect(body1.data).toHaveProperty('activeOperators');
    expect(body1.data).toHaveProperty('todayCompletedStages');

    // Second call should also succeed (may come from cache)
    const res2 = await request.get('/api/dashboard/summary', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res2.status()).toBe(200);
  });

  test('GET /api/dashboard/oee — should reject operator role', async ({ request }) => {
    // Login as operator
    const opRes = await request.post('/api/auth/login', {
      data: { email: 'operator1@pcs.local', password: 'password123' },
    });
    const opToken = (await opRes.json()).data.accessToken;

    const res = await request.get('/api/dashboard/oee', {
      headers: { Authorization: `Bearer ${opToken}` },
    });
    expect(res.status()).toBe(403);
  });
});
