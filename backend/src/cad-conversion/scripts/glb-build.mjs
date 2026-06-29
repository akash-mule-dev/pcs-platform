/**
 * Minimal binary glTF (GLB) builder shared by the IFC and STEP converters.
 *
 * Takes a flat list of meshes `{ name, vertices:[x,y,z,…], indices:[…] }` and
 * packs them into a single-buffer GLB with ONE node per mesh, named by `name`.
 * The node name is the join key the 3D viewer uses to address/highlight a part
 * (it equals `assembly_nodes.ifc_guid` / `mesh_name`), so naming is the whole
 * point: every part gets its own named node, never merged.
 *
 * Positions only (no normals/UVs) — the downstream optimizer welds + the viewer
 * computes normals, matching the existing IFC pipeline output exactly.
 */
export function buildGLB(meshes) {
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

    const posViewIdx = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset, byteLength: vertBuf.length, target: 34962 /* ARRAY_BUFFER */ });
    byteOffset += vertBuf.length;

    const idxViewIdx = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset, byteLength: idxBuf.length, target: 34963 /* ELEMENT_ARRAY_BUFFER */ });
    byteOffset += idxBuf.length;

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

    const posAccIdx = accessors.length;
    accessors.push({
      bufferView: posViewIdx, componentType: 5126 /* FLOAT */, count: verts.length / 3,
      type: 'VEC3', min: [minX, minY, minZ], max: [maxX, maxY, maxZ],
    });

    const idxAccIdx = accessors.length;
    accessors.push({ bufferView: idxViewIdx, componentType: 5125 /* UNSIGNED_INT */, count: mesh.indices.length, type: 'SCALAR' });

    const meshIdx = meshDefs.length;
    meshDefs.push({ primitives: [{ attributes: { POSITION: posAccIdx }, indices: idxAccIdx, mode: 4 /* TRIANGLES */ }] });

    nodes.push({ mesh: meshIdx, name: mesh.name || `element_${i}` });
    buffers.push(vertBuf, idxBuf);
  }

  if (nodes.length === 0) {
    throw new Error('No geometry found to build GLB');
  }

  const binBuffer = Buffer.concat(buffers);
  const gltf = {
    asset: { version: '2.0', generator: 'pcs-cad-converter' },
    scene: 0,
    scenes: [{ nodes: nodes.map((_, i) => i) }],
    nodes,
    meshes: meshDefs,
    accessors,
    bufferViews,
    buffers: [{ byteLength: binBuffer.length }],
  };

  const jsonStr = JSON.stringify(gltf);
  const jsonPad = (4 - (jsonStr.length % 4)) % 4;
  const jsonChunk = Buffer.from(jsonStr + ' '.repeat(jsonPad), 'utf8');

  const binPad = (4 - (binBuffer.length % 4)) % 4;
  const binChunk = binPad > 0 ? Buffer.concat([binBuffer, Buffer.alloc(binPad)]) : binBuffer;

  const totalLen = 12 + 8 + jsonChunk.length + 8 + binChunk.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); // 'glTF'
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(totalLen, 8);

  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonChunk.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4); // 'JSON'

  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binChunk.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4); // 'BIN\0'

  return Buffer.concat([header, jsonHeader, jsonChunk, binHeader, binChunk]);
}
