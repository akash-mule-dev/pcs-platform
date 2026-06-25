// Pure rigid-transform solver for AR point-pair registration — no native/Viro
// deps, jest-testable (cf. edgeTubes.ts). Given corresponding 3D point pairs — a
// point ON THE MODEL (at its current world pose) and the SAME physical point in
// the REAL world — it solves the best-fit RIGID transform T_fix (rotation +
// translation, scale forced to 1) such that real_i ≈ R · model_i + t.
//
// For QA the model must stay TRUE 1:1, so scale is NEVER applied: it is only
// reported as a sanity number (a large deviation ⇒ wrong piece loaded or a bad
// point pick). Alignment is a rigid 6DOF problem only.
//
//   N = 1 → translation only (snap one point).
//   N = 2 → align the single edge (minimal rotation) + report length ratio.
//   N ≥ 3 → Horn's closed-form quaternion solution: the optimal rotation is the
//           eigenvector of the largest eigenvalue of a symmetric 4×4 built from
//           the cross-covariance, found by cyclic Jacobi iteration (no SVD/deps).
//   N ≥ 4 → a light RANSAC over 3-point subsets rejects one mistapped pair before
//           the final solve.

export type V3 = [number, number, number];
export interface PointPair {
  model: V3; // world-space point on the model, at its CURRENT pose
  real: V3; // world-space matching point in reality
}

export interface RigidFit {
  /** 16 floats, COLUMN-MAJOR (drops straight into simd_float4x4): T_fix mapping
   *  current-world model points → real-world points. Rotation orthonormal, scale 1. */
  matrix: number[];
  rmsMm: number; // RMS residual after the fit, in mm
  maxErrMm: number; // worst single-pair residual, in mm
  scaleSanity: number; // implied model→real scale (≈1 good); REPORTED, not applied
  inlierCount: number; // pairs used in the final solve (RANSAC may drop some)
  ok: boolean; // false if degenerate (too few / coincident points)
}

/** Inlier threshold (metres) for the RANSAC pass when ≥4 pairs are given. */
const RANSAC_INLIER_M = 0.012;

// ── tiny vec3 helpers ──
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const len = (a: V3): number => Math.sqrt(dot(a, a));
const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];

function centroid(pts: V3[]): V3 {
  const c: V3 = [0, 0, 0];
  for (const p of pts) {
    c[0] += p[0];
    c[1] += p[1];
    c[2] += p[2];
  }
  const n = pts.length || 1;
  return [c[0] / n, c[1] / n, c[2] / n];
}

type Mat3 = [V3, V3, V3]; // row-major: M[row][col]
const IDENTITY3: Mat3 = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];
const applyR = (R: Mat3, v: V3): V3 => [dot(R[0], v), dot(R[1], v), dot(R[2], v)];

// Unit quaternion [w,x,y,z] → rotation matrix (row-major).
function quatToMat3(q: [number, number, number, number]): Mat3 {
  const [w, x, y, z] = q;
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
    [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
    [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
  ];
}

// Minimal rotation quaternion taking unit vector a → unit vector b ([w,x,y,z]).
function quatFromTo(a: V3, b: V3): [number, number, number, number] {
  const d = dot(a, b);
  if (d > 0.999999) return [1, 0, 0, 0];
  if (d < -0.999999) {
    // Anti-parallel: 180° about any axis perpendicular to a.
    let axis = cross([1, 0, 0], a);
    if (len(axis) < 1e-4) axis = cross([0, 1, 0], a);
    const n = len(axis) || 1;
    return [0, axis[0] / n, axis[1] / n, axis[2] / n];
  }
  const c = cross(a, b);
  const s = Math.sqrt((1 + d) * 2);
  const inv = 1 / s;
  return [s * 0.5, c[0] * inv, c[1] * inv, c[2] * inv];
}

// Cyclic Jacobi eigen-decomposition of a symmetric n×n matrix. Returns eigenvalues
// and eigenvectors (vecs[k] is the k-th eigenvector). Used here for n = 4 (Horn).
function jacobiEigenSymmetric(
  Ain: number[][],
): { values: number[]; vectors: number[][] } {
  const n = Ain.length;
  const A = Ain.map((row) => row.slice());
  // V starts as identity; its columns accumulate the eigenvectors.
  const V: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  );
  for (let sweep = 0; sweep < 100; sweep++) {
    // Largest off-diagonal magnitude.
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += A[p][q] * A[p][q];
    if (off < 1e-20) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(A[p][q]) < 1e-18) continue;
        const theta = (A[q][q] - A[p][p]) / (2 * A[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        // Rotate A: zero out A[p][q].
        for (let k = 0; k < n; k++) {
          const akp = A[k][p];
          const akq = A[k][q];
          A[k][p] = c * akp - s * akq;
          A[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = A[p][k];
          const aqk = A[q][k];
          A[p][k] = c * apk - s * aqk;
          A[q][k] = s * apk + c * aqk;
        }
        // Accumulate the rotation into V.
        for (let k = 0; k < n; k++) {
          const vkp = V[k][p];
          const vkq = V[k][q];
          V[k][p] = c * vkp - s * vkq;
          V[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  const values = A.map((row, i) => row[i]);
  // vectors[k] = the k-th column of V.
  const vectors = values.map((_, k) => V.map((row) => row[k]));
  return { values, vectors };
}

// Optimal rotation (Horn) mapping centred model points → centred real points.
function hornRotation(modelC: V3[], realC: V3[]): Mat3 {
  // Cross-covariance H[a][b] = Σ model[a] · real[b].
  const H = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < modelC.length; i++) {
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) H[a][b] += modelC[i][a] * realC[i][b];
  }
  const Sxx = H[0][0], Sxy = H[0][1], Sxz = H[0][2];
  const Syx = H[1][0], Syy = H[1][1], Syz = H[1][2];
  const Szx = H[2][0], Szy = H[2][1], Szz = H[2][2];
  const N = [
    [Sxx + Syy + Szz, Syz - Szy, Szx - Sxz, Sxy - Syx],
    [Syz - Szy, Sxx - Syy - Szz, Sxy + Syx, Szx + Sxz],
    [Szx - Sxz, Sxy + Syx, -Sxx + Syy - Szz, Syz + Szy],
    [Sxy - Syx, Szx + Sxz, Syz + Szy, -Sxx - Syy + Szz],
  ];
  const { values, vectors } = jacobiEigenSymmetric(N);
  let maxi = 0;
  for (let i = 1; i < 4; i++) if (values[i] > values[maxi]) maxi = i;
  let q = vectors[maxi] as [number, number, number, number];
  const qn = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]) || 1;
  q = [q[0] / qn, q[1] / qn, q[2] / qn, q[3] / qn];
  return quatToMat3(q);
}

// Core least-squares rigid fit for a given set of pairs (no RANSAC).
function fitRigid(pairs: PointPair[]): { R: Mat3; t: V3; scaleSanity: number; ok: boolean } {
  const n = pairs.length;
  if (n === 0) return { R: IDENTITY3, t: [0, 0, 0], scaleSanity: 1, ok: false };

  if (n === 1) {
    return { R: IDENTITY3, t: sub(pairs[0].real, pairs[0].model), scaleSanity: 1, ok: true };
  }

  if (n === 2) {
    const dm = sub(pairs[1].model, pairs[0].model);
    const dr = sub(pairs[1].real, pairs[0].real);
    const lm = len(dm), lr = len(dr);
    if (lm < 1e-6 || lr < 1e-6) {
      // Coincident model/real points → fall back to pure translation.
      return { R: IDENTITY3, t: sub(pairs[0].real, pairs[0].model), scaleSanity: 1, ok: true };
    }
    const R = quatToMat3(quatFromTo(scale(dm, 1 / lm), scale(dr, 1 / lr)));
    const t = sub(pairs[0].real, applyR(R, pairs[0].model));
    return { R, t, scaleSanity: lr / lm, ok: true };
  }

  // N ≥ 3 — Horn.
  const mc = centroid(pairs.map((p) => p.model));
  const rc = centroid(pairs.map((p) => p.real));
  const modelC = pairs.map((p) => sub(p.model, mc));
  const realC = pairs.map((p) => sub(p.real, rc));
  let varM = 0, varR = 0;
  for (let i = 0; i < pairs.length; i++) {
    varM += dot(modelC[i], modelC[i]);
    varR += dot(realC[i], realC[i]);
  }
  if (varM < 1e-9) return { R: IDENTITY3, t: sub(rc, mc), scaleSanity: 1, ok: false };
  const R = hornRotation(modelC, realC);
  const t = sub(rc, applyR(R, mc));
  return { R, t, scaleSanity: Math.sqrt(varR / varM), ok: true };
}

function residualsM(pairs: PointPair[], R: Mat3, t: V3): { rms: number; max: number } {
  let sum = 0, max = 0;
  for (const p of pairs) {
    const pred = add(applyR(R, p.model), t);
    const e = len(sub(p.real, pred));
    sum += e * e;
    if (e > max) max = e;
  }
  return { rms: Math.sqrt(sum / (pairs.length || 1)), max };
}

// All 3-element index subsets of [0..n) (n is small for QA — a handful of corners).
function triples(n: number): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) for (let k = j + 1; k < n; k++) out.push([i, j, k]);
  return out;
}

function toMatrix(R: Mat3, t: V3): number[] {
  // Column-major for simd_float4x4.
  return [
    R[0][0], R[1][0], R[2][0], 0,
    R[0][1], R[1][1], R[2][1], 0,
    R[0][2], R[1][2], R[2][2], 0,
    t[0], t[1], t[2], 1,
  ];
}

/**
 * Solve the best-fit rigid transform for the given correspondences.
 * Scale is computed for sanity reporting only and is NEVER baked into `matrix`.
 */
export function solveRigid(pairs: PointPair[]): RigidFit {
  if (pairs.length === 0) {
    return { matrix: toMatrix(IDENTITY3, [0, 0, 0]), rmsMm: 0, maxErrMm: 0, scaleSanity: 1, inlierCount: 0, ok: false };
  }

  let chosen = pairs;

  // RANSAC: with ≥4 pairs, find the 3-subset whose fit has the most inliers, then
  // re-solve on the full inlier set — so one mistapped corner can't wreck the pose.
  if (pairs.length >= 4) {
    let bestInliers: PointPair[] = [];
    for (const [i, j, k] of triples(pairs.length)) {
      const sample = [pairs[i], pairs[j], pairs[k]];
      const { R, t, ok } = fitRigid(sample);
      if (!ok) continue;
      const inliers = pairs.filter((p) => {
        const pred = add(applyR(R, p.model), t);
        return len(sub(p.real, pred)) <= RANSAC_INLIER_M;
      });
      if (inliers.length > bestInliers.length) bestInliers = inliers;
    }
    if (bestInliers.length >= 3) chosen = bestInliers;
  }

  const { R, t, scaleSanity, ok } = fitRigid(chosen);
  const { rms, max } = residualsM(chosen, R, t);
  return {
    matrix: toMatrix(R, t),
    rmsMm: rms * 1000,
    maxErrMm: max * 1000,
    scaleSanity,
    inlierCount: chosen.length,
    ok,
  };
}
