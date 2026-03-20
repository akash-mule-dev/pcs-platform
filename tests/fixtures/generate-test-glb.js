/**
 * Generates a test GLB file with named meshes for quality overlay testing.
 * Creates a simple assembly with 5 named parts: housing_top, housing_bottom,
 * bolt_left, bolt_right, gasket_ring
 *
 * Usage: node tests/fixtures/generate-test-glb.js
 */

const fs = require('fs');
const path = require('path');

function createTriangleMesh(name, translation, color) {
  // Each mesh is a colored triangle at a given position
  return { name, translation, color };
}

function buildGLB() {
  // Define 5 parts with positions
  const parts = [
    { name: 'housing_top',    tx: 0, ty: 0.5, tz: 0, color: [0.8, 0.8, 0.8, 1] },
    { name: 'housing_bottom', tx: 0, ty: -0.5, tz: 0, color: [0.6, 0.6, 0.6, 1] },
    { name: 'bolt_left',      tx: -0.8, ty: 0, tz: 0, color: [0.4, 0.4, 0.5, 1] },
    { name: 'bolt_right',     tx: 0.8, ty: 0, tz: 0, color: [0.4, 0.4, 0.5, 1] },
    { name: 'gasket_ring',    tx: 0, ty: 0, tz: 0.3, color: [0.3, 0.3, 0.3, 1] },
  ];

  // Vertex data: a simple box-like shape per part
  // Each part = 8 vertices (cube), 12 triangles (36 indices)
  const cubePositions = new Float32Array([
    // Front face
    -0.2, -0.2,  0.2,   0.2, -0.2,  0.2,   0.2,  0.2,  0.2,  -0.2,  0.2,  0.2,
    // Back face
    -0.2, -0.2, -0.2,  -0.2,  0.2, -0.2,   0.2,  0.2, -0.2,   0.2, -0.2, -0.2,
    // Top face
    -0.2,  0.2, -0.2,  -0.2,  0.2,  0.2,   0.2,  0.2,  0.2,   0.2,  0.2, -0.2,
    // Bottom face
    -0.2, -0.2, -0.2,   0.2, -0.2, -0.2,   0.2, -0.2,  0.2,  -0.2, -0.2,  0.2,
    // Right face
     0.2, -0.2, -0.2,   0.2,  0.2, -0.2,   0.2,  0.2,  0.2,   0.2, -0.2,  0.2,
    // Left face
    -0.2, -0.2, -0.2,  -0.2, -0.2,  0.2,  -0.2,  0.2,  0.2,  -0.2,  0.2, -0.2,
  ]);

  const cubeIndices = new Uint16Array([
    0,1,2,  0,2,3,    // front
    4,5,6,  4,6,7,    // back
    8,9,10, 8,10,11,  // top
    12,13,14,12,14,15, // bottom
    16,17,18,16,18,19, // right
    20,21,22,20,22,23, // left
  ]);

  // Build the binary buffer: positions + indices for all 5 parts
  const posBytes = cubePositions.byteLength;
  const idxBytes = cubeIndices.byteLength;
  const partBufSize = posBytes + idxBytes;
  const totalBufSize = partBufSize * parts.length;

  // Pad to 4-byte alignment
  const paddedBufSize = Math.ceil(totalBufSize / 4) * 4;
  const binBuffer = Buffer.alloc(paddedBufSize);

  // Write each part's data
  for (let i = 0; i < parts.length; i++) {
    const offset = i * partBufSize;
    Buffer.from(cubePositions.buffer).copy(binBuffer, offset);
    Buffer.from(cubeIndices.buffer).copy(binBuffer, offset + posBytes);
  }

  // Build glTF JSON
  const bufferViews = [];
  const accessors = [];
  const meshes = [];
  const nodes = [];
  const nodeIndices = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const baseOffset = i * partBufSize;

    // BufferView for positions
    const posViewIdx = bufferViews.length;
    bufferViews.push({
      buffer: 0,
      byteOffset: baseOffset,
      byteLength: posBytes,
      target: 34962, // ARRAY_BUFFER
    });

    // BufferView for indices
    const idxViewIdx = bufferViews.length;
    bufferViews.push({
      buffer: 0,
      byteOffset: baseOffset + posBytes,
      byteLength: idxBytes,
      target: 34963, // ELEMENT_ARRAY_BUFFER
    });

    // Accessor for positions
    const posAccIdx = accessors.length;
    accessors.push({
      bufferView: posViewIdx,
      componentType: 5126, // FLOAT
      count: 24,
      type: 'VEC3',
      max: [0.2, 0.2, 0.2],
      min: [-0.2, -0.2, -0.2],
    });

    // Accessor for indices
    const idxAccIdx = accessors.length;
    accessors.push({
      bufferView: idxViewIdx,
      componentType: 5123, // UNSIGNED_SHORT
      count: 36,
      type: 'SCALAR',
    });

    // Material index = part index
    const materialIdx = i;

    // Mesh
    const meshIdx = meshes.length;
    meshes.push({
      name: part.name,
      primitives: [{
        attributes: { POSITION: posAccIdx },
        indices: idxAccIdx,
        material: materialIdx,
      }],
    });

    // Node
    const nodeIdx = nodes.length;
    nodes.push({
      name: part.name,
      mesh: meshIdx,
      translation: [part.tx, part.ty, part.tz],
    });
    nodeIndices.push(nodeIdx);
  }

  // Materials
  const materials = parts.map(p => ({
    name: p.name + '_material',
    pbrMetallicRoughness: {
      baseColorFactor: p.color,
      metallicFactor: 0.3,
      roughnessFactor: 0.7,
    },
  }));

  const gltfJson = {
    asset: { version: '2.0', generator: 'PCS-Platform-Test' },
    scene: 0,
    scenes: [{ name: 'TestAssembly', nodes: nodeIndices }],
    nodes,
    meshes,
    accessors,
    bufferViews,
    materials,
    buffers: [{ byteLength: paddedBufSize }],
  };

  const jsonStr = JSON.stringify(gltfJson);
  const jsonBuf = Buffer.from(jsonStr);
  // Pad JSON to 4-byte alignment
  const jsonPadded = Math.ceil(jsonBuf.length / 4) * 4;
  const jsonChunk = Buffer.alloc(jsonPadded, 0x20);
  jsonBuf.copy(jsonChunk);

  // GLB structure: header(12) + JSON chunk(8 + jsonPadded) + BIN chunk(8 + paddedBufSize)
  const totalLength = 12 + 8 + jsonPadded + 8 + paddedBufSize;

  const glb = Buffer.alloc(totalLength);
  let offset = 0;

  // Header
  glb.writeUInt32LE(0x46546C67, offset); offset += 4; // magic: glTF
  glb.writeUInt32LE(2, offset); offset += 4;           // version
  glb.writeUInt32LE(totalLength, offset); offset += 4;  // length

  // JSON chunk
  glb.writeUInt32LE(jsonPadded, offset); offset += 4;
  glb.writeUInt32LE(0x4E4F534A, offset); offset += 4; // JSON
  jsonChunk.copy(glb, offset); offset += jsonPadded;

  // BIN chunk
  glb.writeUInt32LE(paddedBufSize, offset); offset += 4;
  glb.writeUInt32LE(0x004E4942, offset); offset += 4; // BIN\0
  binBuffer.copy(glb, offset);

  return glb;
}

// Generate and save
const glb = buildGLB();
const outDir = path.join(__dirname);
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'test-assembly.glb');
fs.writeFileSync(outPath, glb);
console.log(`Generated test GLB: ${outPath} (${glb.length} bytes)`);
console.log('Parts: housing_top, housing_bottom, bolt_left, bolt_right, gasket_ring');
