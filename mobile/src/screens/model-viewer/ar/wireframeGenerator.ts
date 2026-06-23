// Ported verbatim from glb-viewer. Pure JS (no native deps) — runs on-device
// via @gltf-transform/core's WebIO over in-memory GLB bytes. Callers must treat
// failures as non-fatal (solid mode still works without a wireframe).
import { Document, WebIO } from '@gltf-transform/core';
import { buildEdgeTubes } from './edgeTubes';

const CREASE_ANGLE_DEG = 30;
const CREASE_ANGLE_RAD = (CREASE_ANGLE_DEG * Math.PI) / 180;
const CREASE_COS = Math.cos(CREASE_ANGLE_RAD);

// Parse "#rrggbb" (or "#rgb") → [r, g, b] in 0..1 for a glTF colour factor.
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  if (!Number.isFinite(n)) return [0, 0.9, 1]; // fallback ~cyan
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

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

// ── World-space geometry gathering (column-major mat4) ──
// The source GLB nests geometry under transform nodes (the converter's unit
// scale + partExtractor's `pcs-fit` normalize pivot). Edges must be extracted in
// the SAME world space the solid renders in, or the wireframe ends up at the raw
// local scale/offset and renders invisibly far from the model.
type Mat4 = number[];
function identityMat(): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}
function multiplyMat(a: Mat4, b: Mat4): Mat4 {
  const r = new Array(16);
  for (let c = 0; c < 4; c++) {
    for (let row = 0; row < 4; row++) {
      r[c * 4 + row] =
        a[row] * b[c * 4] +
        a[4 + row] * b[c * 4 + 1] +
        a[8 + row] * b[c * 4 + 2] +
        a[12 + row] * b[c * 4 + 3];
    }
  }
  return r;
}
function trsMat(
  t: [number, number, number],
  q: [number, number, number, number],
  s: [number, number, number],
): Mat4 {
  const [x, y, z, w] = q;
  const xx = x * x, yy = y * y, zz = z * z;
  const xy = x * y, xz = x * z, yz = y * z;
  const wx = w * x, wy = w * y, wz = w * z;
  return [
    (1 - 2 * (yy + zz)) * s[0], 2 * (xy + wz) * s[0], 2 * (xz - wy) * s[0], 0,
    2 * (xy - wz) * s[1], (1 - 2 * (xx + zz)) * s[1], 2 * (yz + wx) * s[1], 0,
    2 * (xz + wy) * s[2], 2 * (yz - wx) * s[2], (1 - 2 * (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
}

interface WorldPrimitive {
  positions: Float32Array; // world-space
  indices: Uint32Array;
}

// Walk the scene graph and return every TRIANGLE primitive with its vertices
// already transformed into world space (and synthetic indices for non-indexed
// meshes, so geometry that isn't indexed still yields edges).
function worldTriPrimitives(doc: Document): WorldPrimitive[] {
  const out: WorldPrimitive[] = [];
  const root = doc.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  if (!scene) return out;
  const visit = (node: any, parent: Mat4) => {
    const world = multiplyMat(
      parent,
      trsMat(node.getTranslation(), node.getRotation(), node.getScale()),
    );
    const mesh = node.getMesh();
    if (mesh) {
      for (const prim of mesh.listPrimitives()) {
        if (prim.getMode() !== 4) continue; // TRIANGLES only
        const local = prim.getAttribute('POSITION')?.getArray();
        if (!local) continue;
        const vc = local.length / 3;
        const wp = new Float32Array(local.length);
        for (let i = 0; i < vc; i++) {
          const px = local[i * 3], py = local[i * 3 + 1], pz = local[i * 3 + 2];
          wp[i * 3] = px * world[0] + py * world[4] + pz * world[8] + world[12];
          wp[i * 3 + 1] = px * world[1] + py * world[5] + pz * world[9] + world[13];
          wp[i * 3 + 2] = px * world[2] + py * world[6] + pz * world[10] + world[14];
        }
        const idx = prim.getIndices()?.getArray();
        let indices: Uint32Array;
        if (idx) {
          indices = idx instanceof Uint32Array ? idx : Uint32Array.from(idx as ArrayLike<number>);
        } else {
          indices = new Uint32Array(vc); // non-indexed → sequential triangles
          for (let i = 0; i < vc; i++) indices[i] = i;
        }
        out.push({ positions: wp, indices });
      }
    }
    for (const child of node.listChildren()) visit(child, world);
  };
  for (const node of scene.listChildren()) visit(node, identityMat());
  return out;
}

/**
 * Generate a wireframe-only GLB from a solid GLB.
 * Extracts hard/crease edges where adjacent face normals differ by more than CREASE_ANGLE.
 * Falls back to all edges if hard edge extraction produces too few edges.
 *
 * `radiusScale` multiplies the auto-derived edge-tube radius (the Edges panel's
 * line weight); 1 = the default thin line. `colorHex` is BAKED into the emissive
 * material so each colour is a genuinely different GLB — Viro caches a loaded GLB
 * by URI and won't re-apply a changed material prop, so a per-colour file is the
 * only reliable way to recolour the edge view.
 */
export async function generateWireframeGlb(
  glbData: Uint8Array,
  radiusScale = 1,
  colorHex = '#00e5ff',
): Promise<Uint8Array> {
  const [cr, cg, cb] = hexToRgb(colorHex);
  const io = new WebIO();
  const inputDoc = await io.readBinary(glbData);

  const outputDoc = new Document();
  const buffer = outputDoc.createBuffer('wireframe');
  const scene = outputDoc.createScene('Wireframe');

  // Bright emissive material in the requested colour (the bake that makes each
  // colour a distinct GLB). The scene also applies a Constant Viro material of
  // the same colour for unlit rendering; this embedded one keeps the bytes — and
  // therefore the URI's content — unique per colour.
  const wireMaterial = outputDoc
    .createMaterial(`wireframe_${colorHex.replace('#', '')}`)
    .setBaseColorFactor([cr, cg, cb, 1])
    .setEmissiveFactor([cr, cg, cb])
    .setMetallicFactor(0)
    .setRoughnessFactor(1);

  let globalAllEdgePositions: number[] = [];
  let globalHardEdgePositions: number[] = [];

  // Extract edges in WORLD space (positions already baked through every node's
  // transform), so the wireframe lines up with — and renders at the same scale
  // as — the solid model.
  for (const { positions, indices } of worldTriPrimitives(inputDoc)) {
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

  // Edge half-thickness, relative to model size so it reads as a thin line at any
  // scale (the model may be a normalized ~1 m part or a larger full assembly).
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < finalPositions.length; i += 3) {
    const x = finalPositions[i], y = finalPositions[i + 1], z = finalPositions[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const diag = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) || 1;
  const radius = Math.max(diag * 0.004 * radiusScale, 1e-5);

  const { positions: tubePositions, indices: tubeIndices } = buildEdgeTubes(
    finalPositions,
    radius,
  );

  const posAccessor = outputDoc
    .createAccessor('wireframe_positions')
    .setType('VEC3')
    .setArray(tubePositions)
    .setBuffer(buffer);

  const idxAccessor = outputDoc
    .createAccessor('wireframe_indices')
    .setType('SCALAR')
    .setArray(tubeIndices)
    .setBuffer(buffer);

  // TRIANGLES (mode 4) — Viro renders these; LINES (mode 1) it does not. The
  // scene applies a Constant unlit material, so the tubes need no normals.
  const prim = outputDoc
    .createPrimitive()
    .setAttribute('POSITION', posAccessor)
    .setIndices(idxAccessor)
    .setMaterial(wireMaterial)
    .setMode(4);

  const wireMesh = outputDoc.createMesh('wireframe').addPrimitive(prim);
  const node = outputDoc.createNode('wireframe_root').setMesh(wireMesh);
  scene.addChild(node);

  return await io.writeBinary(outputDoc);
}
