import { test, expect, APIRequestContext } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

let token: string;
let modelId: string;
let qualityEntryId: string;

async function getAuthToken(request: APIRequestContext): Promise<string> {
  const res = await request.post('/api/auth/login', {
    data: { email: 'admin@pcs.local', password: 'password123' },
  });
  expect(res.status()).toBe(201);
  const body = await res.json();
  return body.data.accessToken;
}

function createTestGLB(): Buffer {
  const jsonChunk = Buffer.from(JSON.stringify({
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [] }],
  }));
  const paddedLength = Math.ceil(jsonChunk.length / 4) * 4;
  const paddedJson = Buffer.alloc(paddedLength, 0x20);
  jsonChunk.copy(paddedJson);

  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546C67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + paddedLength, 8);

  const chunkHeader = Buffer.alloc(8);
  chunkHeader.writeUInt32LE(paddedLength, 0);
  chunkHeader.writeUInt32LE(0x4E4F534A, 4);

  return Buffer.concat([header, chunkHeader, paddedJson]);
}

test.describe('Quality Data API — /api/quality-data', () => {
  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request);

    // Create a test model to attach quality data to
    const glb = createTestGLB();
    const res = await request.post('/api/models', {
      headers: { Authorization: `Bearer ${token}` },
      multipart: {
        name: 'QA Test Model',
        modelType: 'quality',
        file: { name: 'qa-test.glb', mimeType: 'model/gltf-binary', buffer: glb },
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    modelId = body.data.id;
  });

  test.afterAll(async ({ request }) => {
    // Cleanup: delete test model (cascades quality data)
    if (modelId) {
      await request.delete(`/api/models/${modelId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    }
  });

  test('POST /api/quality-data — should create a quality entry', async ({ request }) => {
    const res = await request.post('/api/quality-data', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        modelId,
        meshName: 'housing_top',
        regionLabel: 'Top Housing Panel',
        status: 'pass',
        inspector: 'John Doe',
        inspectionDate: '2026-03-18T10:00:00.000Z',
        notes: 'Surface finish within spec',
        measurementValue: 12.45,
        measurementUnit: 'mm',
        toleranceMin: 12.0,
        toleranceMax: 13.0,
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    const entry = body.data;
    expect(entry.id).toBeTruthy();
    expect(entry.meshName).toBe('housing_top');
    expect(entry.status).toBe('pass');
    expect(entry.inspector).toBe('John Doe');
    qualityEntryId = entry.id;
  });

  test('POST /api/quality-data — should create a fail entry', async ({ request }) => {
    const res = await request.post('/api/quality-data', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        modelId,
        meshName: 'bolt_left',
        regionLabel: 'Left Mounting Bolt',
        status: 'fail',
        defectType: 'Dimensional Out-of-Spec',
        severity: 'high',
        measurementValue: 15.2,
        measurementUnit: 'mm',
        toleranceMin: 12.0,
        toleranceMax: 13.0,
        notes: 'Oversize by 2.2mm',
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.data.status).toBe('fail');
    expect(body.data.severity).toBe('high');
  });

  test('POST /api/quality-data — should create a warning entry', async ({ request }) => {
    const res = await request.post('/api/quality-data', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        modelId,
        meshName: 'gasket_ring',
        regionLabel: 'Gasket Ring',
        status: 'warning',
        defectType: 'Surface Roughness',
        severity: 'medium',
        notes: 'Near upper tolerance limit',
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.data.status).toBe('warning');
  });

  test('POST /api/quality-data/bulk — should bulk create entries', async ({ request }) => {
    const res = await request.post('/api/quality-data/bulk', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        items: [
          { modelId, meshName: 'screw_1', status: 'pass', regionLabel: 'Screw #1' },
          { modelId, meshName: 'screw_2', status: 'pass', regionLabel: 'Screw #2' },
          { modelId, meshName: 'weld_joint', status: 'fail', regionLabel: 'Weld Joint', defectType: 'Crack', severity: 'critical' },
        ],
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.data).toHaveLength(3);
  });

  test('GET /api/quality-data/by-model/:modelId — should return all entries for model', async ({ request }) => {
    const res = await request.get(`/api/quality-data/by-model/${modelId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    const entries = body.data;
    expect(entries.length).toBeGreaterThanOrEqual(6); // 3 individual + 3 bulk
    for (const entry of entries) {
      expect(entry.modelId).toBe(modelId);
      expect(['pass', 'fail', 'warning']).toContain(entry.status);
    }
  });

  test('GET /api/quality-data/summary/:modelId — should return correct counts', async ({ request }) => {
    const res = await request.get(`/api/quality-data/summary/${modelId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    const summary = body.data;
    expect(summary.total).toBeGreaterThanOrEqual(6);
    expect(summary.pass).toBeGreaterThanOrEqual(3);  // housing_top, screw_1, screw_2
    expect(summary.fail).toBeGreaterThanOrEqual(2);   // bolt_left, weld_joint
    expect(summary.warning).toBeGreaterThanOrEqual(1); // gasket_ring
    expect(summary.pass + summary.fail + summary.warning).toBe(summary.total);
  });

  test('GET /api/quality-data/:id — should return single entry', async ({ request }) => {
    test.skip(!qualityEntryId, 'No entry was created');

    const res = await request.get(`/api/quality-data/${qualityEntryId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.id).toBe(qualityEntryId);
    expect(body.data.meshName).toBe('housing_top');
  });

  test('PATCH /api/quality-data/:id — should update entry', async ({ request }) => {
    test.skip(!qualityEntryId, 'No entry was created');

    const res = await request.patch(`/api/quality-data/${qualityEntryId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { status: 'warning', notes: 'Downgraded to warning after review' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe('warning');
    expect(body.data.notes).toBe('Downgraded to warning after review');
  });

  test('POST /api/quality-data — should validate status enum', async ({ request }) => {
    const res = await request.post('/api/quality-data', {
      headers: { Authorization: `Bearer ${token}` },
      data: { modelId, meshName: 'test', status: 'invalid_status' },
    });
    expect(res.status()).toBe(400);
  });

  test('POST /api/quality-data — should reject without auth', async ({ request }) => {
    const res = await request.post('/api/quality-data', {
      data: { modelId, meshName: 'test', status: 'pass' },
    });
    expect(res.status()).toBe(401);
  });

  test('GET /api/quality-data — should support pagination', async ({ request }) => {
    const res = await request.get(`/api/quality-data?modelId=${modelId}&limit=2&page=1`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    // TransformInterceptor unwraps PageDto: { data: [...], meta: {...} }
    expect(body.data.length).toBeLessThanOrEqual(2);
    expect(body.meta.limit).toBe(2);
    expect(body.meta.page).toBe(1);
  });

  test('DELETE /api/quality-data/:id — should delete single entry', async ({ request }) => {
    test.skip(!qualityEntryId, 'No entry was created');

    const res = await request.delete(`/api/quality-data/${qualityEntryId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);

    const check = await request.get(`/api/quality-data/${qualityEntryId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(check.status()).toBe(404);
  });

  test('DELETE /api/quality-data/by-model/:modelId — should delete all entries for model', async ({ request }) => {
    const res = await request.delete(`/api/quality-data/by-model/${modelId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);

    // Verify all gone
    const check = await request.get(`/api/quality-data/by-model/${modelId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await check.json();
    expect(body.data).toHaveLength(0);
  });
});
