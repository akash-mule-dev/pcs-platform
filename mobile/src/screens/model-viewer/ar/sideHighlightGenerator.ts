// Produces a recolored GLB that tints the assembly's VERTICAL faces (the
// "sides") a distinct accent color and leaves top/bottom faces neutral, to give
// clear visual segregation in the AR view.
//
// Viro renders a GLB with its embedded materials and can't recolor faces by
// orientation at runtime, so we bake it: each triangle is classified by its
// geometric face normal (a face is a "side" when its normal is nearly
// horizontal, i.e. |n.y| is small) and its indices are routed to one of two
// primitives — one bound to an accent material, one to a neutral material.
// Positions/normals are reused per source primitive, so the output is roughly
// the same size as the input (we only re-partition indices).
//
// Pure JS via @gltf-transform/core's WebIO; callers treat failure as non-fatal.
import { Document, WebIO } from '@gltf-transform/core';

// glTF is Y-up: a vertical side has a normal pointing roughly horizontally.
const VERTICAL_NY_THRESHOLD = 0.5; // |normal.y| < 0.5  → treat as a side
const SIDE_COLOR: [number, number, number, number] = [0.0, 0.62, 0.8, 1.0]; // teal
const FACE_COLOR: [number, number, number, number] = [0.78, 0.8, 0.83, 1.0]; // light grey

function isVerticalFace(
  positions: ArrayLike<number>,
  i0: number,
  i1: number,
  i2: number,
): boolean {
  const ax = positions[i0 * 3], ay = positions[i0 * 3 + 1], az = positions[i0 * 3 + 2];
  const bx = positions[i1 * 3], by = positions[i1 * 3 + 1], bz = positions[i1 * 3 + 2];
  const cx = positions[i2 * 3], cy = positions[i2 * 3 + 1], cz = positions[i2 * 3 + 2];

  const ux = bx - ax, uy = by - ay, uz = bz - az;
  const vx = cx - ax, vy = cy - ay, vz = cz - az;

  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;

  const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (len < 1e-12) return false;
  return Math.abs(ny / len) < VERTICAL_NY_THRESHOLD;
}

export async function generateSideHighlightGlb(glbData: Uint8Array): Promise<Uint8Array> {
  const io = new WebIO();
  const inputDoc = await io.readBinary(glbData);

  const outputDoc = new Document();
  const buffer = outputDoc.createBuffer('side-highlight');
  const scene = outputDoc.createScene('SideHighlight');
  const root = outputDoc.createNode('side_highlight_root');
  const mesh = outputDoc.createMesh('side_highlight');
  root.setMesh(mesh);
  scene.addChild(root);

  const sideMat = outputDoc
    .createMaterial('side_accent')
    .setBaseColorFactor(SIDE_COLOR)
    .setMetallicFactor(0)
    .setRoughnessFactor(0.85);
  const faceMat = outputDoc
    .createMaterial('face_neutral')
    .setBaseColorFactor(FACE_COLOR)
    .setMetallicFactor(0)
    .setRoughnessFactor(0.9);

  let emitted = 0;

  for (const inMesh of inputDoc.getRoot().listMeshes()) {
    for (const prim of inMesh.listPrimitives()) {
      if (prim.getMode() !== 4) continue; // TRIANGLES only

      const posAccessor = prim.getAttribute('POSITION');
      if (!posAccessor) continue;
      const positions = posAccessor.getArray();
      if (!positions) continue;

      const normalAccessor = prim.getAttribute('NORMAL');
      const normals = normalAccessor ? normalAccessor.getArray() : null;

      const idxAccessor = prim.getIndices();
      const vertexCount = positions.length / 3;
      const indices: ArrayLike<number> = idxAccessor?.getArray()
        ?? Array.from({ length: vertexCount }, (_, i) => i);
      const triCount = Math.floor(indices.length / 3);
      if (triCount === 0) continue;

      const sideIdx: number[] = [];
      const faceIdx: number[] = [];
      for (let t = 0; t < triCount; t++) {
        const i0 = indices[t * 3];
        const i1 = indices[t * 3 + 1];
        const i2 = indices[t * 3 + 2];
        const target = isVerticalFace(positions, i0, i1, i2) ? sideIdx : faceIdx;
        target.push(i0, i1, i2);
      }

      // One POSITION (+ NORMAL) accessor per source primitive, shared by the
      // side/face sub-primitives that index into it.
      const outPos = outputDoc
        .createAccessor()
        .setType('VEC3')
        .setArray(new Float32Array(positions))
        .setBuffer(buffer);
      const outNorm = normals
        ? outputDoc.createAccessor().setType('VEC3').setArray(new Float32Array(normals)).setBuffer(buffer)
        : null;

      const addPrim = (idx: number[], material: typeof sideMat) => {
        if (idx.length === 0) return;
        const idxAcc = outputDoc
          .createAccessor()
          .setType('SCALAR')
          .setArray(new Uint32Array(idx))
          .setBuffer(buffer);
        const outPrim = outputDoc
          .createPrimitive()
          .setMode(4)
          .setAttribute('POSITION', outPos)
          .setIndices(idxAcc)
          .setMaterial(material);
        if (outNorm) outPrim.setAttribute('NORMAL', outNorm);
        mesh.addPrimitive(outPrim);
        emitted++;
      };

      addPrim(sideIdx, sideMat);
      addPrim(faceIdx, faceMat);
    }
  }

  if (emitted === 0) {
    throw new Error('No triangle geometry found for side highlight');
  }

  return io.writeBinary(outputDoc);
}
