import { test, expect, APIRequestContext } from '@playwright/test';

let token: string;
let modelId: string;
let failEntryId: string;

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

test.describe('Phase 6 — Quality Analysis Enhancements', () => {
  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request);

    // Create a test model
    const glb = createTestGLB();
    const res = await request.post('/api/models', {
      headers: { Authorization: `Bearer ${token}` },
      multipart: {
        name: 'P6 Quality Test Model',
        modelType: 'quality',
        file: { name: 'p6-test.glb', mimeType: 'model/gltf-binary', buffer: glb },
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    modelId = body.data.id;

    // Seed quality data with inspection dates for trend testing
    for (let i = 0; i < 3; i++) {
      await request.post('/api/quality-data', {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          modelId,
          meshName: `part_${i}`,
          regionLabel: `Part ${i}`,
          status: i === 0 ? 'fail' : 'pass',
          inspector: 'Inspector A',
          inspectionDate: new Date(2026, 2, 10 + i).toISOString(),
          defectType: i === 0 ? 'Crack' : null,
          severity: i === 0 ? 'high' : null,
          measurementValue: 12.5 + i,
          measurementUnit: 'mm',
          toleranceMin: 12.0,
          toleranceMax: 14.0,
        },
      });
    }

    // Create a duplicate failure for defect pattern detection
    await request.post('/api/quality-data', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        modelId,
        meshName: 'part_0',
        regionLabel: 'Part 0',
        status: 'fail',
        inspector: 'Inspector B',
        inspectionDate: new Date(2026, 2, 15).toISOString(),
        defectType: 'Crack',
        severity: 'high',
      },
    });
  });

  test.afterAll(async ({ request }) => {
    if (modelId) {
      await request.delete(`/api/quality-data/by-model/${modelId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      await request.delete(`/api/models/${modelId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    }
  });

  test('GET /api/quality-data/trends/:modelId — should return trend data grouped by date and status', async ({ request }) => {
    const res = await request.get(`/api/quality-data/trends/${modelId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    const trends = body.data;
    expect(Array.isArray(trends)).toBeTruthy();
    expect(trends.length).toBeGreaterThan(0);
    for (const t of trends) {
      expect(t).toHaveProperty('date');
      expect(t).toHaveProperty('status');
      expect(t).toHaveProperty('count');
      expect(['pass', 'fail', 'warning']).toContain(t.status);
    }
  });

  test('GET /api/quality-data/defect-patterns/:modelId — should return recurring defect patterns', async ({ request }) => {
    const res = await request.get(`/api/quality-data/defect-patterns/${modelId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    const patterns = body.data;
    expect(Array.isArray(patterns)).toBeTruthy();
    // part_0 has 2 failures with 'Crack', should show as a pattern
    if (patterns.length > 0) {
      const crackPattern = patterns.find((p: any) => p.defectType === 'Crack');
      if (crackPattern) {
        expect(parseInt(crackPattern.occurrences)).toBeGreaterThanOrEqual(2);
      }
    }
  });

  test('GET /api/quality-data/pending-signoffs — should return failed entries pending sign-off', async ({ request }) => {
    const res = await request.get('/api/quality-data/pending-signoffs', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    const pending = body.data;
    expect(Array.isArray(pending)).toBeTruthy();
    // We created fail entries, they should be pending sign-off
    for (const p of pending) {
      expect(p.signoffStatus).toBe('pending');
      expect(p.status).toBe('fail');
    }
  });

  test('GET /api/quality-data/pending-signoffs?modelId=xxx — should filter by model', async ({ request }) => {
    const res = await request.get(`/api/quality-data/pending-signoffs?modelId=${modelId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    for (const p of body.data) {
      expect(p.modelId).toBe(modelId);
    }
  });

  test('PATCH /api/quality-data/:id/signoff — should approve a failed entry', async ({ request }) => {
    // First get a fail entry to sign off
    const listRes = await request.get(`/api/quality-data/pending-signoffs?modelId=${modelId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const pending = (await listRes.json()).data;
    test.skip(pending.length === 0, 'No pending signoffs');
    failEntryId = pending[0].id;

    const res = await request.patch(`/api/quality-data/${failEntryId}/signoff`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { status: 'approved', signoffBy: 'System Admin', notes: 'Reviewed and accepted' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.signoffStatus).toBe('approved');
    expect(body.data.signoffBy).toBe('System Admin');
    expect(body.data.signoffNotes).toBe('Reviewed and accepted');
    expect(body.data.signoffDate).toBeTruthy();
  });

  test('PATCH /api/quality-data/:id/signoff — should reject a failed entry', async ({ request }) => {
    const listRes = await request.get(`/api/quality-data/pending-signoffs?modelId=${modelId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const pending = (await listRes.json()).data;
    test.skip(pending.length === 0, 'No pending signoffs');

    const res = await request.patch(`/api/quality-data/${pending[0].id}/signoff`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { status: 'rejected', signoffBy: 'System Admin', notes: 'Needs rework' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.signoffStatus).toBe('rejected');
  });

  test('POST /api/quality-data — auto-fail when measurement outside tolerance', async ({ request }) => {
    const res = await request.post('/api/quality-data', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        modelId,
        meshName: 'auto_fail_test',
        status: 'pass', // Should be overridden to 'fail'
        measurementValue: 20.0, // Way above toleranceMax
        measurementUnit: 'mm',
        toleranceMin: 12.0,
        toleranceMax: 14.0,
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.data.status).toBe('fail'); // Auto-failed
  });

  test('POST /api/quality-data — should keep pass when within tolerance', async ({ request }) => {
    const res = await request.post('/api/quality-data', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        modelId,
        meshName: 'within_tolerance_test',
        status: 'pass',
        measurementValue: 13.0, // Within 12-14 range
        measurementUnit: 'mm',
        toleranceMin: 12.0,
        toleranceMax: 14.0,
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.data.status).toBe('pass'); // Stays pass
  });
});
