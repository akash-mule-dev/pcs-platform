// Ported verbatim from glb-viewer. Walks the GLB node graph to compute an
// overall bounding box plus per-part boxes (used for the measurement overlays).
import { WebIO, Node as GltfNode } from '@gltf-transform/core';
import { Vec3 } from './types';

export interface BoundingBox {
  min: Vec3;
  max: Vec3;
  size: Vec3;
  center: Vec3;
}

export interface PartDimension extends BoundingBox {
  name: string;
}

export interface ModelDimensions {
  overall: BoundingBox;
  parts: PartDimension[];
}

type Mat4 = number[]; // 16 elements, column-major

function identity(): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function multiplyMat4(a: Mat4, b: Mat4): Mat4 {
  const r = new Array(16);
  for (let c = 0; c < 4; c++) {
    for (let row = 0; row < 4; row++) {
      r[c * 4 + row] =
        a[0 * 4 + row] * b[c * 4 + 0] +
        a[1 * 4 + row] * b[c * 4 + 1] +
        a[2 * 4 + row] * b[c * 4 + 2] +
        a[3 * 4 + row] * b[c * 4 + 3];
    }
  }
  return r;
}

function trsToMat4(
  t: [number, number, number],
  q: [number, number, number, number],
  s: [number, number, number]
): Mat4 {
  const [x, y, z, w] = q;
  const xx = x * x, yy = y * y, zz = z * z;
  const xy = x * y, xz = x * z, yz = y * z;
  const wx = w * x, wy = w * y, wz = w * z;

  return [
    (1 - 2 * (yy + zz)) * s[0], (2 * (xy + wz)) * s[0], (2 * (xz - wy)) * s[0], 0,
    (2 * (xy - wz)) * s[1], (1 - 2 * (xx + zz)) * s[1], (2 * (yz + wx)) * s[1], 0,
    (2 * (xz + wy)) * s[2], (2 * (yz - wx)) * s[2], (1 - 2 * (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
}

function transformPoint(p: Vec3, m: Mat4): Vec3 {
  const x = p[0] * m[0] + p[1] * m[4] + p[2] * m[8] + m[12];
  const y = p[0] * m[1] + p[1] * m[5] + p[2] * m[9] + m[13];
  const z = p[0] * m[2] + p[1] * m[6] + p[2] * m[10] + m[14];
  return [x, y, z];
}

function expandBox(
  min: Vec3,
  max: Vec3,
  pt: Vec3
): { min: Vec3; max: Vec3 } {
  return {
    min: [Math.min(min[0], pt[0]), Math.min(min[1], pt[1]), Math.min(min[2], pt[2])],
    max: [Math.max(max[0], pt[0]), Math.max(max[1], pt[1]), Math.max(max[2], pt[2])],
  };
}

function boxFromMinMax(min: Vec3, max: Vec3): BoundingBox {
  return {
    min,
    max,
    size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
    center: [
      (min[0] + max[0]) / 2,
      (min[1] + max[1]) / 2,
      (min[2] + max[2]) / 2,
    ],
  };
}

function cornersOfBox(min: Vec3, max: Vec3): Vec3[] {
  return [
    [min[0], min[1], min[2]],
    [max[0], min[1], min[2]],
    [min[0], max[1], min[2]],
    [max[0], max[1], min[2]],
    [min[0], min[1], max[2]],
    [max[0], min[1], max[2]],
    [min[0], max[1], max[2]],
    [max[0], max[1], max[2]],
  ];
}

function nodeLocalMatrix(node: GltfNode): Mat4 {
  const t = node.getTranslation() as [number, number, number];
  const r = node.getRotation() as [number, number, number, number];
  const s = node.getScale() as [number, number, number];
  return trsToMat4(t, r, s);
}

export async function extractDimensions(
  glbData: Uint8Array
): Promise<ModelDimensions> {
  const io = new WebIO();
  const doc = await io.readBinary(glbData);
  const root = doc.getRoot();

  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  if (!scene) throw new Error('GLB has no scene');

  const parts: PartDimension[] = [];
  let oMin: Vec3 = [Infinity, Infinity, Infinity];
  let oMax: Vec3 = [-Infinity, -Infinity, -Infinity];

  const visit = (node: GltfNode, parentMatrix: Mat4): void => {
    const world = multiplyMat4(parentMatrix, nodeLocalMatrix(node));

    const mesh = node.getMesh();
    if (mesh) {
      let nMin: Vec3 = [Infinity, Infinity, Infinity];
      let nMax: Vec3 = [-Infinity, -Infinity, -Infinity];
      let hasGeom = false;

      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute('POSITION');
        if (!pos) continue;
        const localMin = pos.getMin([0, 0, 0]) as Vec3;
        const localMax = pos.getMax([0, 0, 0]) as Vec3;
        for (const c of cornersOfBox(localMin, localMax)) {
          const wc = transformPoint(c, world);
          ({ min: nMin, max: nMax } = expandBox(nMin, nMax, wc));
          ({ min: oMin, max: oMax } = expandBox(oMin, oMax, wc));
          hasGeom = true;
        }
      }

      if (hasGeom) {
        parts.push({
          name: node.getName() || mesh.getName() || `Part ${parts.length + 1}`,
          ...boxFromMinMax(nMin, nMax),
        });
      }
    }

    for (const child of node.listChildren()) {
      visit(child, world);
    }
  };

  for (const node of scene.listChildren()) {
    visit(node, identity());
  }

  if (!isFinite(oMin[0])) {
    throw new Error('GLB has no geometry');
  }

  return {
    overall: boxFromMinMax(oMin, oMax),
    parts,
  };
}

export function formatMeters(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1) return `${v.toFixed(2)} m`;
  if (abs >= 0.01) return `${(v * 100).toFixed(1)} cm`;
  return `${(v * 1000).toFixed(0)} mm`;
}
