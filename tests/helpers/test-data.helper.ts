import { APIRequestContext, expect } from '@playwright/test';
import { authHeader } from './auth.helper';

// ── Products ────────────────────────────────────────────────────────────────

export async function createProduct(
  request: APIRequestContext,
  token: string,
  overrides: Record<string, any> = {},
) {
  const res = await request.post('/api/products', {
    headers: authHeader(token),
    data: {
      name: `Test Product ${Date.now()}`,
      description: 'Auto-generated for testing',
      ...overrides,
    },
  });
  expect(res.status()).toBe(201);
  const body = await res.json();
  return body.data;
}

// ── Processes (with inline stages) ──────────────────────────────────────────

export async function createProcess(
  request: APIRequestContext,
  token: string,
  productId: string,
  overrides: Record<string, any> = {},
) {
  const res = await request.post('/api/processes', {
    headers: authHeader(token),
    data: {
      name: `Test Process ${Date.now()}`,
      productId,
      stages: [
        { name: 'Preparation', targetTimeSeconds: 600, description: 'Prep work' },
        { name: 'Assembly', targetTimeSeconds: 900, description: 'Main assembly' },
        { name: 'QC Check', targetTimeSeconds: 300, description: 'Quality check' },
      ],
      ...overrides,
    },
  });
  expect(res.status()).toBe(201);
  const body = await res.json();
  return body.data;
}

// ── Lines ───────────────────────────────────────────────────────────────────

export async function createLine(
  request: APIRequestContext,
  token: string,
  overrides: Record<string, any> = {},
) {
  const res = await request.post('/api/lines', {
    headers: authHeader(token),
    data: {
      name: `Test Line ${Date.now()}`,
      description: 'Auto-generated for testing',
      ...overrides,
    },
  });
  expect(res.status()).toBe(201);
  const body = await res.json();
  return body.data;
}

// ── Stations ────────────────────────────────────────────────────────────────

export async function createStation(
  request: APIRequestContext,
  token: string,
  lineId: string,
  overrides: Record<string, any> = {},
) {
  const res = await request.post('/api/stations', {
    headers: authHeader(token),
    data: {
      name: `Test Station ${Date.now()}`,
      lineId,
      ...overrides,
    },
  });
  expect(res.status()).toBe(201);
  const body = await res.json();
  return body.data;
}

// ── Work Orders ─────────────────────────────────────────────────────────────

export async function createWorkOrder(
  request: APIRequestContext,
  token: string,
  productId: string,
  processId: string,
  overrides: Record<string, any> = {},
) {
  // Retry up to 3 times — concurrent workers can cause duplicate orderNumber (race condition)
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await request.post('/api/work-orders', {
      headers: authHeader(token),
      data: {
        productId,
        processId,
        quantity: 10,
        priority: 'medium',
        ...overrides,
      },
    });
    if (res.status() === 201) {
      const body = await res.json();
      return body.data;
    }
    if (attempt === 3) {
      expect(res.status()).toBe(201); // final attempt — let it fail with a clear message
    }
    // Brief pause before retry
    await new Promise(r => setTimeout(r, 200 * attempt));
  }
}

// ── Full test setup ─────────────────────────────────────────────────────────

export interface TestSetup {
  product: any;
  process: any;
  line: any;
  station: any;
  workOrder: any;
}

export async function createFullTestSetup(
  request: APIRequestContext,
  token: string,
): Promise<TestSetup> {
  const product = await createProduct(request, token);
  const process = await createProcess(request, token, product.id);
  const line = await createLine(request, token);
  const station = await createStation(request, token, line.id);
  const workOrder = await createWorkOrder(request, token, product.id, process.id, {
    lineId: line.id,
  });
  return { product, process, line, station, workOrder };
}

// ── Fetch helpers ───────────────────────────────────────────────────────────

export async function getRoles(request: APIRequestContext, token: string) {
  const res = await request.get('/api/users?limit=1', { headers: authHeader(token) });
  const body = await res.json();
  return body;
}

export async function getWorkOrder(
  request: APIRequestContext,
  token: string,
  id: string,
) {
  const res = await request.get(`/api/work-orders/${id}`, {
    headers: authHeader(token),
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  return body.data;
}
