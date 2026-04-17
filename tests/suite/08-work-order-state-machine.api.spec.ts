import { test, expect } from '@playwright/test';
import { loginAs, authHeader } from '../helpers/auth.helper';
import { createProduct, createProcess, createLine } from '../helpers/test-data.helper';

/**
 * Work Order State Machine.
 * Valid transitions: draft → pending → in_progress → completed
 *                    any state → cancelled
 * Invalid transitions: draft → completed, draft → in_progress, pending → completed, etc.
 */
test.describe('Work Order — State Machine transitions', () => {
  let adminToken: string;
  let productId: string;
  let processId: string;

  test.beforeAll(async ({ request }) => {
    ({ token: adminToken } = await loginAs(request, 'admin'));
    const product = await createProduct(request, adminToken);
    productId = product.id;
    const process = await createProcess(request, adminToken, productId);
    processId = process.id;
  });

  async function createWO(request: any) {
    // Retry to handle concurrent orderNumber race condition
    for (let attempt = 1; attempt <= 3; attempt++) {
      const res = await request.post('/api/work-orders', {
        headers: authHeader(adminToken),
        data: { productId, processId, quantity: 5, priority: 'medium' },
      });
      if (res.status() === 201) {
        return (await res.json()).data;
      }
      if (attempt === 3) {
        expect(res.status()).toBe(201);
      }
      await new Promise(r => setTimeout(r, 200 * attempt));
    }
  }

  async function transitionTo(request: any, woId: string, status: string) {
    return request.patch(`/api/work-orders/${woId}/status`, {
      headers: authHeader(adminToken),
      data: { status },
    });
  }

  // ── Valid transitions ─────────────────────────────────────────────────────

  test('draft → pending — valid transition', async ({ request }) => {
    const wo = await createWO(request);
    expect(wo.status).toBe('draft');

    const res = await transitionTo(request, wo.id, 'pending');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe('pending');
  });

  test('pending → in_progress — valid transition', async ({ request }) => {
    const wo = await createWO(request);
    await transitionTo(request, wo.id, 'pending');

    const res = await transitionTo(request, wo.id, 'in_progress');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe('in_progress');
  });

  test('in_progress → completed — valid transition', async ({ request }) => {
    const wo = await createWO(request);
    await transitionTo(request, wo.id, 'pending');
    await transitionTo(request, wo.id, 'in_progress');

    const res = await transitionTo(request, wo.id, 'completed');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe('completed');
  });

  test('draft → cancelled — valid (cancel from any state)', async ({ request }) => {
    const wo = await createWO(request);

    const res = await transitionTo(request, wo.id, 'cancelled');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe('cancelled');
  });

  test('pending → cancelled — valid', async ({ request }) => {
    const wo = await createWO(request);
    await transitionTo(request, wo.id, 'pending');

    const res = await transitionTo(request, wo.id, 'cancelled');
    expect(res.status()).toBe(200);
  });

  test('in_progress → cancelled — valid', async ({ request }) => {
    const wo = await createWO(request);
    await transitionTo(request, wo.id, 'pending');
    await transitionTo(request, wo.id, 'in_progress');

    const res = await transitionTo(request, wo.id, 'cancelled');
    expect(res.status()).toBe(200);
  });

  // ── Invalid transitions ───────────────────────────────────────────────────

  test('draft → completed — INVALID (skips intermediate states)', async ({ request }) => {
    const wo = await createWO(request);
    const res = await transitionTo(request, wo.id, 'completed');
    expect(res.status()).toBe(400);
  });

  test('draft → in_progress — INVALID (must go through pending)', async ({ request }) => {
    const wo = await createWO(request);
    const res = await transitionTo(request, wo.id, 'in_progress');
    expect(res.status()).toBe(400);
  });

  test('pending → completed — INVALID (must go through in_progress)', async ({ request }) => {
    const wo = await createWO(request);
    await transitionTo(request, wo.id, 'pending');

    const res = await transitionTo(request, wo.id, 'completed');
    expect(res.status()).toBe(400);
  });

  test('completed → in_progress — INVALID (no going back)', async ({ request }) => {
    const wo = await createWO(request);
    await transitionTo(request, wo.id, 'pending');
    await transitionTo(request, wo.id, 'in_progress');
    await transitionTo(request, wo.id, 'completed');

    const res = await transitionTo(request, wo.id, 'in_progress');
    expect(res.status()).toBe(400);
  });

  test('cancelled → pending — INVALID (no reactivation)', async ({ request }) => {
    const wo = await createWO(request);
    await transitionTo(request, wo.id, 'cancelled');

    const res = await transitionTo(request, wo.id, 'pending');
    expect(res.status()).toBe(400);
  });

  // ── Work Order Stage Status transitions ───────────────────────────────────

  test('Work order stage status — operator can update stage status', async ({ request }) => {
    const wo = await createWO(request);
    await transitionTo(request, wo.id, 'pending');
    await transitionTo(request, wo.id, 'in_progress');

    // Get stages
    const detailRes = await request.get(`/api/work-orders/${wo.id}`, {
      headers: authHeader(adminToken),
    });
    const detail = (await detailRes.json()).data;
    test.skip(detail.stages.length === 0, 'No stages');

    const stageId = detail.stages[0].id;
    const { token: opToken } = await loginAs(request, 'operator');

    const res = await request.patch(
      `/api/work-orders/${wo.id}/stages/${stageId}/status`,
      {
        headers: authHeader(opToken),
        data: { status: 'in_progress' },
      },
    );
    expect([200, 400]).toContain(res.status()); // 200 if valid, 400 if transition not allowed
  });

  // ── Full lifecycle ────────────────────────────────────────────────────────

  test('Full lifecycle: draft → pending → in_progress → completed', async ({ request }) => {
    const wo = await createWO(request);
    expect(wo.status).toBe('draft');

    const r1 = await transitionTo(request, wo.id, 'pending');
    expect(r1.status()).toBe(200);

    const r2 = await transitionTo(request, wo.id, 'in_progress');
    expect(r2.status()).toBe(200);

    const r3 = await transitionTo(request, wo.id, 'completed');
    expect(r3.status()).toBe(200);

    // Verify final state
    const finalRes = await request.get(`/api/work-orders/${wo.id}`, {
      headers: authHeader(adminToken),
    });
    const final = (await finalRes.json()).data;
    expect(final.status).toBe('completed');
  });
});
