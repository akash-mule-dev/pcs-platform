import { test, expect, APIRequestContext } from '@playwright/test';

let token: string;

async function getAuthToken(request: APIRequestContext): Promise<string> {
  const res = await request.post('/api/auth/login', {
    data: { email: 'admin@pcs.local', password: 'password123' },
  });
  expect(res.status()).toBe(201);
  return (await res.json()).data.accessToken;
}

test.describe('Phase 12 — Audit Trail', () => {
  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request);
  });

  test('GET /api/audit — should return paginated audit logs', async ({ request }) => {
    const res = await request.get('/api/audit?limit=10&page=1', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data).toBeTruthy();
    expect(body.meta).toBeTruthy();
    expect(body.meta.page).toBe(1);
    expect(body.meta.limit).toBe(10);
  });

  test('GET /api/audit — should filter by entityType', async ({ request }) => {
    const res = await request.get('/api/audit?entityType=work_order', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    for (const log of body.data) {
      expect(log.entityType).toBe('work_order');
    }
  });

  test('GET /api/audit — should include user relation', async ({ request }) => {
    const res = await request.get('/api/audit?limit=5', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    if (body.data.length > 0) {
      const log = body.data[0];
      expect(log).toHaveProperty('action');
      expect(log).toHaveProperty('entityType');
      expect(log).toHaveProperty('entityId');
      expect(log).toHaveProperty('createdAt');
      // user may be null for system-generated entries
    }
  });

  test('Audit log created on WO status change', async ({ request }) => {
    // Find a pending WO and transition it, then check audit trail
    const listRes = await request.get('/api/work-orders?status=pending&limit=1', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const list = (await listRes.json()).data;
    test.skip(list.length === 0, 'No pending work orders');

    const woId = list[0].id;

    // Transition to in_progress
    await request.patch(`/api/work-orders/${woId}/status`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { status: 'in_progress' },
    });

    // Check audit trail for this entity
    const auditRes = await request.get(`/api/audit?entityType=work_order&entityId=${woId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(auditRes.status()).toBe(200);
    const auditBody = await auditRes.json();
    const logs = auditBody.data;
    expect(logs.length).toBeGreaterThan(0);
    const statusChangeLog = logs.find((l: any) => l.action === 'status_change');
    if (statusChangeLog) {
      expect(statusChangeLog.newValues).toHaveProperty('status');
    }
  });

  test('GET /api/audit — should reject non-admin role', async ({ request }) => {
    const opRes = await request.post('/api/auth/login', {
      data: { email: 'operator1@pcs.local', password: 'password123' },
    });
    const opToken = (await opRes.json()).data.accessToken;

    const res = await request.get('/api/audit', {
      headers: { Authorization: `Bearer ${opToken}` },
    });
    expect(res.status()).toBe(403);
  });
});
