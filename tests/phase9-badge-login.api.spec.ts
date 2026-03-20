import { test, expect, APIRequestContext } from '@playwright/test';

let adminToken: string;

async function getAuthToken(request: APIRequestContext): Promise<string> {
  const res = await request.post('/api/auth/login', {
    data: { email: 'admin@pcs.local', password: 'password123' },
  });
  expect(res.status()).toBe(201);
  return (await res.json()).data.accessToken;
}

test.describe('Phase 9 — Badge/NFC Login', () => {
  test.beforeAll(async ({ request }) => {
    adminToken = await getAuthToken(request);
  });

  test('POST /api/auth/badge-login — should login with valid badge ID', async ({ request }) => {
    // First find a user with a badge ID
    const usersRes = await request.get('/api/users?limit=20', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const users = (await usersRes.json()).data;
    const userWithBadge = users.find((u: any) => u.badgeId);

    test.skip(!userWithBadge, 'No users with badge IDs exist');

    const res = await request.post('/api/auth/badge-login', {
      data: { badgeId: userWithBadge.badgeId },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.data.accessToken).toBeTruthy();
    expect(body.data.user).toBeTruthy();
    expect(body.data.user.badgeId).toBe(userWithBadge.badgeId);
  });

  test('POST /api/auth/badge-login — should reject invalid badge ID', async ({ request }) => {
    const res = await request.post('/api/auth/badge-login', {
      data: { badgeId: 'NONEXISTENT-BADGE-12345' },
    });
    expect(res.status()).toBe(401);
  });

  test('POST /api/auth/badge-login — should return same token format as password login', async ({ request }) => {
    const usersRes = await request.get('/api/users?limit=20', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const users = (await usersRes.json()).data;
    const userWithBadge = users.find((u: any) => u.badgeId);

    test.skip(!userWithBadge, 'No users with badge IDs exist');

    const res = await request.post('/api/auth/badge-login', {
      data: { badgeId: userWithBadge.badgeId },
    });
    const body = await res.json();
    const data = body.data;

    // Same structure as password login
    expect(data).toHaveProperty('accessToken');
    expect(data).toHaveProperty('user');
    expect(data.user).toHaveProperty('id');
    expect(data.user).toHaveProperty('email');
    expect(data.user).toHaveProperty('firstName');
    expect(data.user).toHaveProperty('lastName');
    expect(data.user).toHaveProperty('role');

    // Token should be usable for API calls
    const profileRes = await request.get('/api/auth/profile', {
      headers: { Authorization: `Bearer ${data.accessToken}` },
    });
    expect(profileRes.status()).toBe(200);
  });
});
