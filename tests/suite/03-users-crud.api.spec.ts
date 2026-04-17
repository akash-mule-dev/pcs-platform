import { test, expect } from '@playwright/test';
import { loginAs, authHeader } from '../helpers/auth.helper';

test.describe('Users — CRUD operations', () => {
  let adminToken: string;
  let managerToken: string;
  let createdUserId: string;
  let roleId: string;

  test.beforeAll(async ({ request }) => {
    ({ token: adminToken } = await loginAs(request, 'admin'));
    ({ token: managerToken } = await loginAs(request, 'manager'));

    // Get a role ID (operator) for user creation
    const usersRes = await request.get('/api/users?limit=1', {
      headers: authHeader(adminToken),
    });
    const usersBody = await usersRes.json();
    // Find the operator role from an existing user, or list roles
    const profileRes = await request.get('/api/auth/profile', {
      headers: authHeader((await loginAs(request, 'operator')).token),
    });
    const profile = await profileRes.json();
    roleId = profile.data.role.id || profile.data.roleId;
  });

  // ── List users ────────────────────────────────────────────────────────────

  test('GET /api/users — admin can list users with pagination', async ({ request }) => {
    const res = await request.get('/api/users?page=1&limit=5', {
      headers: authHeader(adminToken),
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data)).toBeTruthy();
    expect(body.meta).toBeTruthy();
    expect(body.meta.limit).toBe(5);
    expect(body.meta.page).toBe(1);
    expect(typeof body.meta.itemCount).toBe('number');
    expect(typeof body.meta.pageCount).toBe('number');
  });

  test('GET /api/users — manager can list users', async ({ request }) => {
    const res = await request.get('/api/users', {
      headers: authHeader(managerToken),
    });
    expect(res.status()).toBe(200);
  });

  test('GET /api/users — supervisor cannot list users', async ({ request }) => {
    const { token } = await loginAs(request, 'supervisor');
    const res = await request.get('/api/users', {
      headers: authHeader(token),
    });
    expect(res.status()).toBe(403);
  });

  test('GET /api/users — operator cannot list users', async ({ request }) => {
    const { token } = await loginAs(request, 'operator');
    const res = await request.get('/api/users', {
      headers: authHeader(token),
    });
    expect(res.status()).toBe(403);
  });

  // ── Create user ───────────────────────────────────────────────────────────

  test('POST /api/users — admin can create a user', async ({ request }) => {
    const timestamp = Date.now();
    const res = await request.post('/api/users', {
      headers: authHeader(adminToken),
      data: {
        employeeId: `TEST-${timestamp}`,
        email: `testuser-${timestamp}@pcs.com`,
        mobileNo: `98765${String(timestamp).slice(-5)}`,
        password: '123456',
        firstName: 'Test',
        lastName: 'User',
        roleId,
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    createdUserId = body.data.id;
    expect(body.data.employeeId).toBe(`TEST-${timestamp}`);
    expect(body.data.firstName).toBe('Test');
    expect(body.data.lastName).toBe('User');
  });

  test('SECURITY: POST /api/users response should NOT expose passwordHash', async ({ request }) => {
    const timestamp = Date.now();
    const res = await request.post('/api/users', {
      headers: authHeader(adminToken),
      data: {
        employeeId: `SEC-${timestamp}`,
        mobileNo: `91111${String(timestamp).slice(-5)}`,
        password: '123456',
        firstName: 'Security',
        lastName: 'Check',
        roleId,
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    // BUG: API currently leaks passwordHash in create response
    expect(body.data.passwordHash).toBeUndefined();
  });

  test('POST /api/users — manager cannot create users', async ({ request }) => {
    const res = await request.post('/api/users', {
      headers: authHeader(managerToken),
      data: {
        employeeId: 'FAIL-001',
        mobileNo: '0000000000',
        password: '123456',
        firstName: 'Should',
        lastName: 'Fail',
        roleId,
      },
    });
    expect(res.status()).toBe(403);
  });

  test('POST /api/users — rejects missing required fields', async ({ request }) => {
    const res = await request.post('/api/users', {
      headers: authHeader(adminToken),
      data: { firstName: 'Incomplete' },
    });
    expect(res.status()).toBe(400);
  });

  // ── Get single user ───────────────────────────────────────────────────────

  test('GET /api/users/:id — admin can get user details', async ({ request }) => {
    test.skip(!createdUserId, 'No user was created');
    const res = await request.get(`/api/users/${createdUserId}`, {
      headers: authHeader(adminToken),
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.id).toBe(createdUserId);
    expect(body.data.passwordHash).toBeUndefined();
  });

  test('GET /api/users/:id — returns 404 for non-existent user', async ({ request }) => {
    const fakeId = '00000000-0000-0000-0000-000000000000';
    const res = await request.get(`/api/users/${fakeId}`, {
      headers: authHeader(adminToken),
    });
    expect([404, 400]).toContain(res.status());
  });

  // ── Update user ───────────────────────────────────────────────────────────

  test('PATCH /api/users/:id — admin can update user', async ({ request }) => {
    test.skip(!createdUserId, 'No user was created');
    const res = await request.patch(`/api/users/${createdUserId}`, {
      headers: authHeader(adminToken),
      data: { firstName: 'Updated', lastName: 'Name' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.firstName).toBe('Updated');
  });

  test('PATCH /api/users/:id — manager cannot update user', async ({ request }) => {
    test.skip(!createdUserId, 'No user was created');
    const res = await request.patch(`/api/users/${createdUserId}`, {
      headers: authHeader(managerToken),
      data: { firstName: 'Hacked' },
    });
    expect(res.status()).toBe(403);
  });

  // ── Delete user ───────────────────────────────────────────────────────────

  test('DELETE /api/users/:id — admin can delete (deactivate) user', async ({ request }) => {
    test.skip(!createdUserId, 'No user was created');
    const res = await request.delete(`/api/users/${createdUserId}`, {
      headers: authHeader(adminToken),
    });
    expect(res.status()).toBe(200);
  });

  test('DELETE /api/users/:id — manager cannot delete user', async ({ request }) => {
    const { user } = await loginAs(request, 'operator');
    const res = await request.delete(`/api/users/${user.id}`, {
      headers: authHeader(managerToken),
    });
    expect(res.status()).toBe(403);
  });
});
