import { test, expect } from '@playwright/test';
import { USERS, loginAs, authHeader, RoleName } from '../helpers/auth.helper';

test.describe('Auth — Login & Profile', () => {
  // ── Login — every role ────────────────────────────────────────────────────

  for (const role of ['admin', 'manager', 'supervisor', 'operator'] as RoleName[]) {
    test(`POST /api/auth/login — ${role} can login successfully`, async ({ request }) => {
      const res = await request.post('/api/auth/login', { data: USERS[role] });
      expect(res.status()).toBe(201);

      const body = await res.json();
      expect(body.data.accessToken).toBeTruthy();
      expect(body.data.user).toBeTruthy();
      expect(body.data.user.email).toBe(USERS[role].email);
      expect(body.data.user.role).toBeTruthy();
      expect(body.data.user.role.name).toBe(role === 'operator' ? 'operator' : role);
      expect(body.data.user.firstName).toBeTruthy();
      expect(body.data.user.lastName).toBeTruthy();
      expect(body.data.user.employeeId).toBeTruthy();
    });
  }

  // ── Login — failure cases ─────────────────────────────────────────────────

  test('POST /api/auth/login — rejects wrong password', async ({ request }) => {
    const res = await request.post('/api/auth/login', {
      data: { email: USERS.admin.email, password: 'wrong-password' },
    });
    expect(res.status()).toBe(401);
  });

  test('POST /api/auth/login — rejects non-existent email', async ({ request }) => {
    const res = await request.post('/api/auth/login', {
      data: { email: 'nobody@pcs.com', password: '123456' },
    });
    expect(res.status()).toBe(401);
  });

  test('POST /api/auth/login — rejects empty body', async ({ request }) => {
    const res = await request.post('/api/auth/login', { data: {} });
    expect([400, 401]).toContain(res.status());
  });

  test('POST /api/auth/login — rejects missing password', async ({ request }) => {
    const res = await request.post('/api/auth/login', {
      data: { email: USERS.admin.email },
    });
    expect([400, 401]).toContain(res.status());
  });

  // ── Profile ───────────────────────────────────────────────────────────────

  for (const role of ['admin', 'manager', 'supervisor', 'operator'] as RoleName[]) {
    test(`GET /api/auth/profile — ${role} can fetch own profile`, async ({ request }) => {
      const { token } = await loginAs(request, role);
      const res = await request.get('/api/auth/profile', {
        headers: authHeader(token),
      });
      expect(res.status()).toBe(200);

      const body = await res.json();
      expect(body.data.email).toBe(USERS[role].email);
      expect(body.data.role).toBeTruthy();
      // passwordHash must not be exposed
      expect(body.data.passwordHash).toBeUndefined();
    });
  }

  test('GET /api/auth/profile — rejects without token', async ({ request }) => {
    const res = await request.get('/api/auth/profile');
    expect(res.status()).toBe(401);
  });

  test('GET /api/auth/profile — rejects invalid token', async ({ request }) => {
    const res = await request.get('/api/auth/profile', {
      headers: authHeader('invalid.jwt.token'),
    });
    expect(res.status()).toBe(401);
  });

  // ── Permissions config ────────────────────────────────────────────────────

  test('GET /api/auth/permissions — returns permissions object', async ({ request }) => {
    const { token } = await loginAs(request, 'admin');
    const res = await request.get('/api/auth/permissions', {
      headers: authHeader(token),
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    // The permissions config is returned directly (not wrapped in data by interceptor
    // if it's a plain object, or wrapped if it is). Either way, verify it's an object.
    const perms = body.data || body;
    expect(perms).toBeTruthy();
  });
});
