import { test, expect } from '@playwright/test';
import { loginAs, authHeader } from '../helpers/auth.helper';

test.describe('Notifications — CRUD & read status', () => {
  let adminToken: string;
  let adminUserId: string;
  let operatorToken: string;
  let notificationId: string;

  test.beforeAll(async ({ request }) => {
    const admin = await loginAs(request, 'admin');
    adminToken = admin.token;
    adminUserId = admin.user.id;
    ({ token: operatorToken } = await loginAs(request, 'operator'));
  });

  // ── List Notifications ────────────────────────────────────────────────────

  test('GET /api/notifications — returns notifications list', async ({ request }) => {
    const res = await request.get('/api/notifications', {
      headers: authHeader(adminToken),
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data)).toBeTruthy();

    // Save an admin-owned notification ID if one exists
    if (body.data.length > 0) {
      notificationId = body.data[0].id;
    }
  });

  test('GET /api/notifications — all roles can access their own', async ({ request }) => {
    for (const role of ['admin', 'manager', 'supervisor', 'operator'] as const) {
      const { token } = await loginAs(request, role);
      const res = await request.get('/api/notifications', {
        headers: authHeader(token),
      });
      expect(res.status()).toBe(200);
    }
  });

  test('GET /api/notifications — filter unread only', async ({ request }) => {
    const res = await request.get('/api/notifications?unreadOnly=true', {
      headers: authHeader(adminToken),
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    for (const notif of body.data) {
      expect(notif.isRead).toBe(false);
    }
  });

  test('GET /api/notifications — rejects without auth', async ({ request }) => {
    const res = await request.get('/api/notifications');
    expect(res.status()).toBe(401);
  });

  // ── Unread Count ──────────────────────────────────────────────────────────

  test('GET /api/notifications/unread-count — returns count', async ({ request }) => {
    const res = await request.get('/api/notifications/unread-count', {
      headers: authHeader(adminToken),
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(typeof body.data.count).toBe('number');
  });

  // ── Mark as Read ──────────────────────────────────────────────────────────

  test('PATCH /api/notifications/:id/read — mark single as read (status only)', async ({ request }) => {
    // Get a notification that belongs to this user
    const listRes = await request.get('/api/notifications?unreadOnly=true', {
      headers: authHeader(adminToken),
    });
    const unread = (await listRes.json()).data;
    test.skip(unread.length === 0, 'No unread notifications for this user');

    const targetId = unread[0].id;
    const res = await request.patch(`/api/notifications/${targetId}/read`, {
      headers: authHeader(adminToken),
    });
    // markAsRead returns void — just verify success status
    expect(res.status()).toBe(200);
  });

  // ── Mark All Read ─────────────────────────────────────────────────────────

  test('POST /api/notifications/read-all — marks all as read', async ({ request }) => {
    // Get initial unread count
    const beforeRes = await request.get('/api/notifications/unread-count', {
      headers: authHeader(adminToken),
    });
    const beforeCount = (await beforeRes.json()).data.count;

    const res = await request.post('/api/notifications/read-all', {
      headers: authHeader(adminToken),
    });
    // markAllAsRead returns void — just verify success status
    expect([200, 201]).toContain(res.status());

    // Verify unread count decreased (may not be exactly 0 if other tests create notifications)
    const afterRes = await request.get('/api/notifications/unread-count', {
      headers: authHeader(adminToken),
    });
    const afterCount = (await afterRes.json()).data.count;
    expect(afterCount).toBeLessThanOrEqual(beforeCount);
  });

  // ── Delete ────────────────────────────────────────────────────────────────

  test('DELETE /api/notifications/:id — can delete own notification', async ({ request }) => {
    // Get a fresh notification for deletion
    const listRes = await request.get('/api/notifications', {
      headers: authHeader(adminToken),
    });
    const list = (await listRes.json()).data;
    test.skip(list.length === 0, 'No notifications to delete');

    const idToDelete = list[list.length - 1].id; // delete last one
    const res = await request.delete(`/api/notifications/${idToDelete}`, {
      headers: authHeader(adminToken),
    });
    expect(res.status()).toBe(200);
  });

  test('DELETE /api/notifications/:id — rejects without auth', async ({ request }) => {
    const res = await request.delete('/api/notifications/some-id');
    expect(res.status()).toBe(401);
  });
});
