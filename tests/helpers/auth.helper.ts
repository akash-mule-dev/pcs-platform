import { APIRequestContext } from '@playwright/test';

/**
 * Seed user credentials — must match backend/src/seed/seed.service.ts
 */
export const USERS = {
  admin:      { email: 'admin@pcs.com',       password: '123456' },
  manager:    { email: 'manager@pcs.com',      password: '123456' },
  supervisor: { email: 'supervisor1@pcs.com',  password: '123456' },
  operator:   { email: 'operator1@pcs.com',    password: '123456' },
  operator2:  { email: 'operator2@pcs.com',    password: '123456' },
} as const;

export type RoleName = keyof typeof USERS;

const tokenCache: Partial<Record<RoleName, string>> = {};
const userCache: Partial<Record<RoleName, any>> = {};

export async function loginAs(
  request: APIRequestContext,
  role: RoleName,
): Promise<{ token: string; user: any }> {
  if (tokenCache[role]) return { token: tokenCache[role]!, user: userCache[role]! };

  const res = await request.post('/api/auth/login', { data: USERS[role] });
  if (res.status() !== 201) {
    throw new Error(`Login as ${role} failed with status ${res.status()}: ${await res.text()}`);
  }
  const body = await res.json();
  tokenCache[role] = body.data.accessToken;
  userCache[role] = body.data.user;
  return { token: body.data.accessToken, user: body.data.user };
}

export function authHeader(token: string) {
  return { Authorization: `Bearer ${token}` };
}

export function clearTokenCache() {
  for (const key of Object.keys(tokenCache)) {
    delete tokenCache[key as RoleName];
    delete userCache[key as RoleName];
  }
}
