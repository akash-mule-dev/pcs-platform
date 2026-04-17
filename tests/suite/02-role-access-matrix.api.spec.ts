import { test, expect } from '@playwright/test';
import { loginAs, authHeader, RoleName } from '../helpers/auth.helper';

/**
 * Role-based access matrix.
 * Tests that each endpoint correctly allows/denies access per role.
 * This is a comprehensive permission verification — one of the most critical tests.
 */

interface EndpointCheck {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  body?: any;
  allowed: RoleName[];
  denied: RoleName[];
  description: string;
}

const ENDPOINTS: EndpointCheck[] = [
  // ── Users ──
  {
    method: 'GET', path: '/api/users',
    allowed: ['admin', 'manager'],
    denied: ['supervisor', 'operator'],
    description: 'List users',
  },
  {
    method: 'POST', path: '/api/users',
    body: { employeeId: `MATRIX-${Date.now()}`, mobileNo: '9999999999', password: '123456', firstName: 'Matrix', lastName: 'Test', roleId: 'placeholder' },
    allowed: ['admin'],
    denied: ['manager', 'supervisor', 'operator'],
    description: 'Create user',
  },
  // ── Products ──
  {
    method: 'GET', path: '/api/products',
    allowed: ['admin', 'manager', 'supervisor', 'operator'],
    denied: [],
    description: 'List products',
  },
  {
    method: 'POST', path: '/api/products',
    body: { name: `Matrix Product ${Date.now()}`, description: 'role test' },
    allowed: ['admin', 'manager'],
    denied: ['supervisor', 'operator'],
    description: 'Create product',
  },
  // ── Processes ──
  {
    method: 'GET', path: '/api/processes',
    allowed: ['admin', 'manager', 'supervisor'],
    denied: ['operator'],
    description: 'List processes',
  },
  // ── Lines ──
  {
    method: 'GET', path: '/api/lines',
    allowed: ['admin', 'manager', 'supervisor', 'operator'],
    denied: [],
    description: 'List lines',
  },
  {
    method: 'POST', path: '/api/lines',
    body: { name: `Matrix Line ${Date.now()}` },
    allowed: ['admin', 'manager'],
    denied: ['supervisor', 'operator'],
    description: 'Create line',
  },
  // ── Work Orders ──
  {
    method: 'GET', path: '/api/work-orders',
    allowed: ['admin', 'manager', 'supervisor', 'operator'],
    denied: [],
    description: 'List work orders',
  },
  // ── Time Tracking ──
  {
    method: 'GET', path: '/api/time-tracking/active',
    allowed: ['admin', 'manager', 'supervisor', 'operator'],
    denied: [],
    description: 'Get active time entries',
  },
  {
    method: 'GET', path: '/api/time-tracking/history',
    allowed: ['admin', 'manager', 'supervisor', 'operator'],
    denied: [],
    description: 'Get time tracking history',
  },
  // ── Dashboard ──
  {
    method: 'GET', path: '/api/dashboard/summary',
    allowed: ['admin', 'manager', 'supervisor', 'operator'],
    denied: [],
    description: 'Dashboard summary',
  },
  {
    method: 'GET', path: '/api/dashboard/operator-performance',
    allowed: ['admin', 'manager', 'supervisor'],
    denied: ['operator'],
    description: 'Operator performance (restricted)',
  },
  {
    method: 'GET', path: '/api/dashboard/stage-analytics',
    allowed: ['admin', 'manager'],
    denied: ['supervisor', 'operator'],
    description: 'Stage analytics (restricted)',
  },
  // ── Audit ──
  {
    method: 'GET', path: '/api/audit',
    allowed: ['admin', 'manager'],
    denied: ['supervisor', 'operator'],
    description: 'Audit trail',
  },
  // ── Search ──
  {
    method: 'GET', path: '/api/search?q=test',
    allowed: ['admin', 'manager', 'supervisor', 'operator'],
    denied: [],
    description: 'Global search',
  },
  // ── Notifications ──
  {
    method: 'GET', path: '/api/notifications',
    allowed: ['admin', 'manager', 'supervisor', 'operator'],
    denied: [],
    description: 'List notifications',
  },
  {
    method: 'GET', path: '/api/notifications/unread-count',
    allowed: ['admin', 'manager', 'supervisor', 'operator'],
    denied: [],
    description: 'Unread notification count',
  },
  // ── Quality Data ──
  {
    method: 'GET', path: '/api/quality-data',
    allowed: ['admin', 'manager', 'supervisor'],
    denied: ['operator'],
    description: 'List quality data',
  },
  // ── Coordination ──
  {
    method: 'GET', path: '/api/coordination',
    allowed: ['admin', 'manager', 'supervisor'],
    denied: ['operator'],
    description: 'List coordination packages',
  },
];

test.describe('Role Access Matrix — Permission enforcement', () => {
  // For each endpoint, test all allowed roles get 2xx and all denied roles get 403
  for (const ep of ENDPOINTS) {
    for (const role of ep.allowed) {
      test(`${ep.description} — ${role} ALLOWED (${ep.method} ${ep.path})`, async ({ request }) => {
        const { token } = await loginAs(request, role);
        const opts: any = { headers: authHeader(token) };
        if (ep.body) opts.data = ep.body;

        let res;
        switch (ep.method) {
          case 'GET':    res = await request.get(ep.path, opts); break;
          case 'POST':   res = await request.post(ep.path, opts); break;
          case 'PATCH':  res = await request.patch(ep.path, opts); break;
          case 'DELETE':  res = await request.delete(ep.path, opts); break;
        }
        // Allowed roles should NOT get 401 or 403
        expect(res.status()).not.toBe(401);
        expect(res.status()).not.toBe(403);
      });
    }

    for (const role of ep.denied) {
      test(`${ep.description} — ${role} DENIED (${ep.method} ${ep.path})`, async ({ request }) => {
        const { token } = await loginAs(request, role);
        const opts: any = { headers: authHeader(token) };
        if (ep.body) opts.data = ep.body;

        let res;
        switch (ep.method) {
          case 'GET':    res = await request.get(ep.path, opts); break;
          case 'POST':   res = await request.post(ep.path, opts); break;
          case 'PATCH':  res = await request.patch(ep.path, opts); break;
          case 'DELETE':  res = await request.delete(ep.path, opts); break;
        }
        expect(res.status()).toBe(403);
      });
    }
  }

  // ── Unauthenticated access ────────────────────────────────────────────────

  const protectedPaths = [
    '/api/users',
    '/api/products',
    '/api/processes',
    '/api/work-orders',
    '/api/time-tracking/active',
    '/api/dashboard/summary',
    '/api/notifications',
    '/api/audit',
    '/api/quality-data',
    '/api/coordination',
  ];

  for (const path of protectedPaths) {
    test(`Unauthenticated GET ${path} — returns 401`, async ({ request }) => {
      const res = await request.get(path);
      expect(res.status()).toBe(401);
    });
  }
});
