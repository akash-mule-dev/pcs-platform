// Ported verbatim from glb-viewer. Pure JS (no native deps) — runs on-device
// via @gltf-transform/core's WebIO over in-memory GLB bytes. Callers must treat
// failures as non-fatal (solid/ghost modes still work without a wireframe).
import { Document, WebIO } from '@gltf-transform/core';

const CREASE_ANGLE_DEG = 30;
const CREASE_ANGLE_RAD = (CREASE_ANGLE_DEG * Math.PI) / 180;
const CREASE_COS = Math.cos(CREASE_ANGLE_RAD);

// Blue emissive wireframe color
const WIREFRAME_COLOR: [number, number, number, number] = [0, 0, 1, 1]; // #0000FF

interface Vec3Array {
  x: number;
  y: number;
  z: number;
}

function computeFaceNormal(
  p0: Vec3Array,
  p1: Vec3Array,
  p2: Vec3Array,
): Vec3Array {
  const ux = p1.x - p0.x;
  const uy = p1.y - p0.y;
  const uz = p1.z - p0.z;
  const vx = p2.x - p0.x;
  const vy = p2.y - p0.y;
  const vz = p2.z - p0.z;

  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;

  const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (len < 1e-10) return { x: 0, y: 0, z: 0 };

  return { x: nx / len, y: ny / len, z: nz / len };
}

function dot(a: Vec3Array, b: Vec3Array): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function makeEdgeKey(a: number, b: number): string {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

/**
 * Generate a wireframe-only GLB from a solid GLB.
 * Extracts hard/crease edges where adjacent face normals differ by more than CREASE_ANGLE.
 * Falls back to all edges if hard edge extraction produces too few edges.
 */
export async function generateWireframeGlb(
  glbData: Uint8Array,
): Promise<Uint8Array> {
  const io = new WebIO();
  const inputDoc = await io.readBinary(glbData);

  const outputDoc = new Document();
  const buffer = outputDoc.createBuffer('wireframe');
  const scene = outputDoc.createScene('Wireframe');

  // Create unlit blue material
  const wireMaterial = outputDoc
    .createMaterial('wireframe_blue')
    .setBaseColorFactor(WIREFRAME_COLOR)
    .setEmissiveFactor([0, 0, 1])
    .setMetallicFactor(0)
    .setRoughnessFactor(1);

  const root = inputDoc.getRoot();
  const meshes = root.listMeshes();

  let globalAllEdgePositions: number[] = [];
  let globalHardEdgePositions: number[] = [];

  for (const mesh of meshes) {
    for (const primitive of mesh.listPrimitives()) {
      const mode = primitive.getMode();
      if (mode !== 4) continue; // Only process TRIANGLES

      const posAccessor = primitive.getAttribute('POSITION');
      const idxAccessor = primitive.getIndices();
      if (!posAccessor || !idxAccessor) continue;

      const positions = posAccessor.getArray();
      const indices = idxAccessor.getArray();
      if (!positions || !indices) continue;

      const triCount = indices.length / 3;

      // Build face normals and edge-to-face mapping
      const faceNormals: Vec3Array[] = [];
      const edgeFaces = new Map<string, number[]>();

      for (let f = 0; f < triCount; f++) {
        const i0 = indices[f * 3];
        const i1 = indices[f * 3 + 1];
        const i2 = indices[f * 3 + 2];

        const p0 = {
          x: positions[i0 * 3],
          y: positions[i0 * 3 + 1],
          z: positions[i0 * 3 + 2],
        };
        const p1 = {
          x: positions[i1 * 3],
          y: positions[i1 * 3 + 1],
          z: positions[i1 * 3 + 2],
        };
        const p2 = {
          x: positions[i2 * 3],
          y: positions[i2 * 3 + 1],
          z: positions[i2 * 3 + 2],
        };

        faceNormals.push(computeFaceNormal(p0, p1, p2));

        // Three edges per triangle
        const edges = [
          makeEdgeKey(i0, i1),
          makeEdgeKey(i1, i2),
          makeEdgeKey(i2, i0),
        ];

        for (const edgeKey of edges) {
          const faces = edgeFaces.get(edgeKey);
          if (faces) {
            faces.push(f);
          } else {
            edgeFaces.set(edgeKey, [f]);
          }
        }
      }

      // Collect all edges and hard edges
      const allEdgeSet = new Set<string>();
      const hardEdgeSet = new Set<string>();

      for (const [edgeKey, faces] of edgeFaces.entries()) {
        allEdgeSet.add(edgeKey);

        if (faces.length === 1) {
          // Boundary edge - always a hard edge
          hardEdgeSet.add(edgeKey);
        } else if (faces.length === 2) {
          const n0 = faceNormals[faces[0]];
          const n1 = faceNormals[faces[1]];
          const cosAngle = dot(n0, n1);
          if (cosAngle < CREASE_COS) {
            hardEdgeSet.add(edgeKey);
          }
        } else {
          // Non-manifold edge - treat as hard
          hardEdgeSet.add(edgeKey);
        }
      }

      // Convert edge sets to position arrays
      const addEdgePositions = (edgeSet: Set<string>, target: number[]) => {
        for (const edgeKey of edgeSet) {
          const [aStr, bStr] = edgeKey.split('_');
          const a = parseInt(aStr, 10);
          const b = parseInt(bStr, 10);
          target.push(
            positions[a * 3],
            positions[a * 3 + 1],
            positions[a * 3 + 2],
            positions[b * 3],
            positions[b * 3 + 1],
            positions[b * 3 + 2],
          );
        }
      };

      addEdgePositions(allEdgeSet, globalAllEdgePositions);
      addEdgePositions(hardEdgeSet, globalHardEdgePositions);
    }
  }

  // Use hard edges if they have a reasonable count, otherwise fall back to all edges
  const useHardEdges =
    globalHardEdgePositions.length > 0 &&
    globalHardEdgePositions.length >= globalAllEdgePositions.length * 0.05;

  const finalPositions = useHardEdges
    ? globalHardEdgePositions
    : globalAllEdgePositions;

  if (finalPositions.length === 0) {
    // No geometry found, return minimal empty GLB
    return await io.writeBinary(outputDoc);
  }

  const posArray = new Float32Array(finalPositions);
  const vertexCount = posArray.length / 3;

  // Create line indices (pairs)
  const lineIndices = new Uint32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) {
    lineIndices[i] = i;
  }

  const posAccessor = outputDoc
    .createAccessor('wireframe_positions')
    .setType('VEC3')
    .setArray(posArray)
    .setBuffer(buffer);

  const idxAccessor = outputDoc
    .createAccessor('wireframe_indices')
    .setType('SCALAR')
    .setArray(lineIndices)
    .setBuffer(buffer);

  const prim = outputDoc
    .createPrimitive()
    .setAttribute('POSITION', posAccessor)
    .setIndices(idxAccessor)
    .setMaterial(wireMaterial)
    .setMode(1); // LINES

  const wireMesh = outputDoc.createMesh('wireframe').addPrimitive(prim);
  const node = outputDoc.createNode('wireframe_root').setMesh(wireMesh);
  scene.addChild(node);

  return await io.writeBinary(outputDoc);
}
