import { test, expect, APIRequestContext } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

let token: string;
let createdModelId: string;

// Helper: login and get token
async function getAuthToken(request: APIRequestContext): Promise<string> {
  const res = await request.post('/api/auth/login', {
    data: { email: 'admin@pcs.local', password: 'password123' },
  });
  expect(res.status()).toBe(201);
  const body = await res.json();
  return body.data.accessToken;
}

test.describe('3D Models API — /api/models', () => {
  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request);
  });

  test('GET /api/models — should return paginated list', async ({ request }) => {
    const res = await request.get('/api/models', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    // TransformInterceptor unwraps PageDto: { data: [...], meta: {...} }
    expect(body.data).toBeInstanceOf(Array);
    expect(body.meta).toBeDefined();
    expect(body.meta).toHaveProperty('page');
    expect(body.meta).toHaveProperty('limit');
    expect(body.meta).toHaveProperty('itemCount');
  });

  test('GET /api/models — should filter by modelType', async ({ request }) => {
    const res = await request.get('/api/models?modelType=quality', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    const models = body.data;
    expect(models).toBeInstanceOf(Array);
    for (const model of models) {
      expect(model.modelType).toBe('quality');
    }
  });

  test('POST /api/models — should upload a 3D model file', async ({ request }) => {
    // Create a minimal valid GLB file (empty glTF binary)
    // GLB header: magic(4) + version(4) + length(4) + JSON chunk header(8) + JSON
    const jsonChunk = Buffer.from(JSON.stringify({
      asset: { version: '2.0', generator: 'PCS-Test' },
      scene: 0,
      scenes: [{ nodes: [] }],
    }));
    // Pad JSON to 4-byte alignment
    const paddedLength = Math.ceil(jsonChunk.length / 4) * 4;
    const paddedJson = Buffer.alloc(paddedLength, 0x20); // space padding
    jsonChunk.copy(paddedJson);

    const header = Buffer.alloc(12);
    header.writeUInt32LE(0x46546C67, 0); // magic: glTF
    header.writeUInt32LE(2, 4);           // version: 2
    header.writeUInt32LE(12 + 8 + paddedLength, 8); // total length

    const chunkHeader = Buffer.alloc(8);
    chunkHeader.writeUInt32LE(paddedLength, 0);
    chunkHeader.writeUInt32LE(0x4E4F534A, 4); // type: JSON

    const glbBuffer = Buffer.concat([header, chunkHeader, paddedJson]);

    // Write temp file
    const tmpPath = path.join(__dirname, '..', 'test-results', 'test-model.glb');
    fs.mkdirSync(path.dirname(tmpPath), { recursive: true });
    fs.writeFileSync(tmpPath, glbBuffer);

    const res = await request.post('/api/models', {
      headers: { Authorization: `Bearer ${token}` },
      multipart: {
        name: 'Test Model',
        modelType: 'quality',
        description: 'Playwright test upload',
        file: {
          name: 'test-model.glb',
          mimeType: 'model/gltf-binary',
          buffer: glbBuffer,
        },
      },
    });

    expect(res.status()).toBe(201);
    const body = await res.json();
    const model = body.data;
    expect(model.id).toBeTruthy();
    expect(model.name).toBe('Test Model');
    expect(model.modelType).toBe('quality');
    expect(model.fileName).toContain('.glb');
    expect(model.fileSize).toBeGreaterThan(0);
    createdModelId = model.id;

    // Cleanup temp file
    fs.unlinkSync(tmpPath);
  });

  test('GET /api/models/:id — should return uploaded model', async ({ request }) => {
    test.skip(!createdModelId, 'No model was created');

    const res = await request.get(`/api/models/${createdModelId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    const model = body.data;
    expect(model.id).toBe(createdModelId);
    expect(model.name).toBe('Test Model');
    expect(model.modelType).toBe('quality');
  });

  test('GET /api/models/:id/file — should stream the GLB file', async ({ request }) => {
    test.skip(!createdModelId, 'No model was created');

    const res = await request.get(`/api/models/${createdModelId}/file`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const buffer = await res.body();
    expect(buffer.length).toBeGreaterThan(0);
    // Check GLB magic bytes
    expect(buffer.readUInt32LE(0)).toBe(0x46546C67); // glTF
  });

  test('PATCH /api/models/:id — should update model metadata', async ({ request }) => {
    test.skip(!createdModelId, 'No model was created');

    const res = await request.patch(`/api/models/${createdModelId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Updated Test Model', description: 'Updated by Playwright' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.name).toBe('Updated Test Model');
    expect(body.data.description).toBe('Updated by Playwright');
  });

  test('GET /api/models/:id — should return 404 for non-existent model', async ({ request }) => {
    const res = await request.get('/api/models/00000000-0000-0000-0000-000000000000', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(404);
  });

  test('POST /api/models — should reject without auth', async ({ request }) => {
    const res = await request.post('/api/models', {
      multipart: {
        name: 'Unauthorized',
        file: {
          name: 'test.glb',
          mimeType: 'model/gltf-binary',
          buffer: Buffer.from('fake'),
        },
      },
    });
    expect(res.status()).toBe(401);
  });

  test('DELETE /api/models/:id — should delete the model', async ({ request }) => {
    test.skip(!createdModelId, 'No model was created');

    const res = await request.delete(`/api/models/${createdModelId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);

    // Verify it's gone
    const check = await request.get(`/api/models/${createdModelId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(check.status()).toBe(404);
  });
});
