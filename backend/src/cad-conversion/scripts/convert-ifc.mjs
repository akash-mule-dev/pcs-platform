/**
 * IFC to GLB conversion script.
 *
 * Uses web-ifc to parse IFC files and builds a binary GLB (glTF 2.0) buffer
 * from the extracted geometry.
 *
 * Usage: node convert-ifc.mjs <input.ifc> <output.glb>
 */
import * as WebIFC from 'web-ifc';
import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';

const [,, inputPath, outputPath] = process.argv;

if (!inputPath || !outputPath) {
  console.error('Usage: convert-ifc.mjs <input.ifc> <output.glb>');
  process.exit(1);
}

// ── GLB helpers ──────────────────────────────────────────────────────────

function buildGLB(meshes) {
  // Flatten all meshes into a single buffer with multiple primitives
  const accessors = [];
  const bufferViews = [];
  const meshDefs = [];
  const nodes = [];
  const buffers = [];
  let byteOffset = 0;

  for (let i = 0; i < meshes.length; i++) {
    const mesh = meshes[i];
    if (!mesh.vertices.length || !mesh.indices.length) continue;

    const vertBuf = Buffer.from(new Float32Array(mesh.vertices).buffer);
    const idxBuf = Buffer.from(new Uint32Array(mesh.indices).buffer);

    // Position buffer view
    const posViewIdx = bufferViews.length;
    bufferViews.push({
      buffer: 0,
      byteOffset,
      byteLength: vertBuf.length,
      target: 34962, // ARRAY_BUFFER
    });
    byteOffset += vertBuf.length;

    // Index buffer view
    const idxViewIdx = bufferViews.length;
    bufferViews.push({
      buffer: 0,
      byteOffset,
      byteLength: idxBuf.length,
      target: 34963, // ELEMENT_ARRAY_BUFFER
    });
    byteOffset += idxBuf.length;

    // Compute bounding box for positions
    const verts = mesh.vertices;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let v = 0; v < verts.length; v += 3) {
      minX = Math.min(minX, verts[v]);
      minY = Math.min(minY, verts[v + 1]);
      minZ = Math.min(minZ, verts[v + 2]);
      maxX = Math.max(maxX, verts[v]);
      maxY = Math.max(maxY, verts[v + 1]);
      maxZ = Math.max(maxZ, verts[v + 2]);
    }

    // Position accessor
    const posAccIdx = accessors.length;
    accessors.push({
      bufferView: posViewIdx,
      componentType: 5126, // FLOAT
      count: verts.length / 3,
      type: 'VEC3',
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ],
    });

    // Index accessor
    const idxAccIdx = accessors.length;
    accessors.push({
      bufferView: idxViewIdx,
      componentType: 5125, // UNSIGNED_INT
      count: mesh.indices.length,
      type: 'SCALAR',
    });

    // Mesh definition
    const meshIdx = meshDefs.length;
    meshDefs.push({
      primitives: [{
        attributes: { POSITION: posAccIdx },
        indices: idxAccIdx,
        mode: 4, // TRIANGLES
      }],
    });

    // Node
    nodes.push({ mesh: meshIdx, name: mesh.name || `element_${i}` });
    buffers.push(vertBuf, idxBuf);
  }

  if (nodes.length === 0) {
    throw new Error('No geometry found in IFC file');
  }

  const binBuffer = Buffer.concat(buffers);

  const gltf = {
    asset: { version: '2.0', generator: 'pcs-ifc-converter' },
    scene: 0,
    scenes: [{ nodes: nodes.map((_, i) => i) }],
    nodes,
    meshes: meshDefs,
    accessors,
    bufferViews,
    buffers: [{ byteLength: binBuffer.length }],
  };

  const jsonStr = JSON.stringify(gltf);
  // Pad JSON to 4-byte boundary
  const jsonPad = (4 - (jsonStr.length % 4)) % 4;
  const jsonChunk = Buffer.from(jsonStr + ' '.repeat(jsonPad), 'utf8');

  // Pad binary to 4-byte boundary
  const binPad = (4 - (binBuffer.length % 4)) % 4;
  const binChunk = binPad > 0 ? Buffer.concat([binBuffer, Buffer.alloc(binPad)]) : binBuffer;

  // GLB header: magic(4) + version(4) + length(4)
  // JSON chunk: length(4) + type(4) + data
  // BIN chunk:  length(4) + type(4) + data
  const totalLen = 12 + 8 + jsonChunk.length + 8 + binChunk.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546C67, 0); // 'glTF'
  header.writeUInt32LE(2, 4);          // version
  header.writeUInt32LE(totalLen, 8);

  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonChunk.length, 0);
  jsonHeader.writeUInt32LE(0x4E4F534A, 4); // 'JSON'

  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binChunk.length, 0);
  binHeader.writeUInt32LE(0x004E4942, 4); // 'BIN\0'

  return Buffer.concat([header, jsonHeader, jsonChunk, binHeader, binChunk]);
}

// ── Main conversion ──────────────────────────────────────────────────────

async function main() {
  console.log(`Loading IFC file: ${inputPath}`);

  const ifcApi = new WebIFC.IfcAPI();

  // Locate WASM files from the web-ifc package
  const require = createRequire(import.meta.url);
  const wasmDir = path.dirname(require.resolve('web-ifc/web-ifc.wasm'));
  const wasmPath = wasmDir.replace(/\\/g, '/') + '/';
  console.log(`WASM path: ${wasmPath}`);
  ifcApi.SetWasmPath(wasmPath, true);

  await ifcApi.Init();

  const fileData = fs.readFileSync(inputPath);
  const modelID = ifcApi.OpenModel(fileData);

  console.log(`IFC model opened (ID: ${modelID}), extracting geometry...`);

  const meshes = [];

  // Iterate all meshes from the IFC model
  const flatMeshes = ifcApi.LoadAllGeometry(modelID);
  console.log(`Found ${flatMeshes.size()} geometric elements`);

  for (let i = 0; i < flatMeshes.size(); i++) {
    const flatMesh = flatMeshes.get(i);
    const expressID = flatMesh.expressID;

    // Get element type/name for node naming
    let name = `ifc_${expressID}`;
    try {
      const line = ifcApi.GetLine(modelID, expressID);
      if (line && line.Name && line.Name.value) {
        name = line.Name.value;
      }
    } catch { /* skip name lookup errors */ }

    // Collect vertices and indices from all placements of this element
    const allVerts = [];
    const allIndices = [];

    for (let j = 0; j < flatMesh.geometries.size(); j++) {
      const placedGeom = flatMesh.geometries.get(j);
      const geom = ifcApi.GetGeometry(modelID, placedGeom.geometryExpressID);

      const vData = ifcApi.GetVertexArray(geom.GetVertexData(), geom.GetVertexDataSize());
      const iData = ifcApi.GetIndexArray(geom.GetIndexData(), geom.GetIndexDataSize());

      // web-ifc vertices are interleaved: x,y,z, nx,ny,nz per vertex (6 floats)
      // We extract only positions (x,y,z) for now
      const transform = placedGeom.flatTransformation;

      const baseIndex = allVerts.length / 3;
      for (let v = 0; v < vData.length; v += 6) {
        let x = vData[v], y = vData[v + 1], z = vData[v + 2];

        // Apply 4x4 transformation matrix (column-major)
        const tx = transform[0] * x + transform[4] * y + transform[8] * z + transform[12];
        const ty = transform[1] * x + transform[5] * y + transform[9] * z + transform[13];
        const tz = transform[2] * x + transform[6] * y + transform[10] * z + transform[14];

        allVerts.push(tx, ty, tz);
      }

      for (let idx = 0; idx < iData.length; idx++) {
        allIndices.push(iData[idx] + baseIndex);
      }

      geom.delete();
    }

    if (allVerts.length > 0 && allIndices.length > 0) {
      meshes.push({ name, vertices: allVerts, indices: allIndices });
    }
  }

  console.log(`Extracted ${meshes.length} meshes, building GLB...`);

  ifcApi.CloseModel(modelID);

  const glb = buildGLB(meshes);
  fs.writeFileSync(outputPath, glb);

  console.log(`GLB written: ${outputPath} (${(glb.length / 1024 / 1024).toFixed(1)} MB)`);
}

main().catch((err) => {
  console.error(`IFC conversion error: ${err.message || err}`);
  process.exit(1);
});
