import { test, expect } from '@playwright/test';

test.describe('POST /api/auth/login', () => {
  test('should login successfully with valid credentials', async ({ request }) => {
    const response = await request.post('/api/auth/login', {
      data: {
        email: 'admin@pcs.local',
        password: 'password123',
      },
    });

    expect(response.status()).toBe(201);
    const body = await response.json();
    const data = body.data;
    expect(data.accessToken).toBeTruthy();
    expect(data.user).toBeTruthy();
    expect(data.user.email).toBe('admin@pcs.local');
    expect(data.user.firstName).toBe('System');
    expect(data.user.lastName).toBe('Admin');
    expect(data.user.role.name).toBe('admin');
  });

  test('should reject invalid password', async ({ request }) => {
    const response = await request.post('/api/auth/login', {
      data: {
        email: 'admin@pcs.local',
        password: 'wrongpassword',
      },
    });

    expect(response.status()).toBe(401);
  });

  test('should reject non-existent user', async ({ request }) => {
    const response = await request.post('/api/auth/login', {
      data: {
        email: 'nobody@pcs.local',
        password: 'password123',
      },
    });

    expect(response.status()).toBe(401);
  });
});
