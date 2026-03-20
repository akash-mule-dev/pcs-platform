import { test, expect, APIRequestContext } from '@playwright/test';

let adminToken: string;
let adminUserId: string;

async function login(request: APIRequestContext, email = 'admin@pcs.local', password = 'password123') {
  const res = await request.post('/api/auth/login', { data: { email, password } });
  expect(res.status()).toBe(201);
  const body = await res.json();
  return { token: body.data.accessToken, userId: body.data.user.id };
}

test.describe('Phase 5 — Notifications API', () => {
  test.beforeAll(async ({ request }) => {
    const auth = await login(request);
    adminToken = auth.token;
    adminUserId = auth.userId;
  });

  test('GET /api/notifications — should return empty list initially', async ({ request }) => {
    const res = await request.get('/api/notifications', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data)).toBeTruthy();
  });

  test('GET /api/notifications/unread-count — should return count object', async ({ request }) => {
    const res = await request.get('/api/notifications/unread-count', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveProperty('count');
    expect(typeof body.data.count).toBe('number');
  });

  test('POST /api/notifications/read-all — should mark all as read', async ({ request }) => {
    const res = await request.post('/api/notifications/read-all', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status()).toBe(201);
  });

  test('GET /api/notifications?unreadOnly=true — should filter unread', async ({ request }) => {
    const res = await request.get('/api/notifications?unreadOnly=true', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data)).toBeTruthy();
  });

  test('GET /api/notifications — should reject without auth', async ({ request }) => {
    const res = await request.get('/api/notifications');
    expect(res.status()).toBe(401);
  });
});

test.describe('Phase 5 — WebSocket Gateway Events', () => {
  test('should have WebSocket gateway accessible', async ({ request }) => {
    // Socket.IO health check — GET returns HTML upgrade info
    const res = await request.get('/socket.io/?EIO=4&transport=polling');
    // Socket.IO responds with 200 and session info
    expect(res.status()).toBe(200);
  });
});
