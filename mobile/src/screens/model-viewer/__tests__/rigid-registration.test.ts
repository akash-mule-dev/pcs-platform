import { solveRigid, PointPair, V3 } from '../ar/rigid-registration';

// ── helpers ──
type Mat3 = [V3, V3, V3];
const applyR = (R: Mat3, v: V3): V3 => [
  R[0][0] * v[0] + R[0][1] * v[1] + R[0][2] * v[2],
  R[1][0] * v[0] + R[1][1] * v[1] + R[1][2] * v[2],
  R[2][0] * v[0] + R[2][1] * v[1] + R[2][2] * v[2],
];
const addV = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

// Rodrigues: rotation matrix (row-major) for a unit axis + angle.
function axisAngle(axis: V3, angle: number): Mat3 {
  const n = Math.hypot(...axis);
  const [x, y, z] = [axis[0] / n, axis[1] / n, axis[2] / n];
  const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
  return [
    [t * x * x + c, t * x * y - s * z, t * x * z + s * y],
    [t * x * y + s * z, t * y * y + c, t * y * z - s * x],
    [t * x * z - s * y, t * y * z + s * x, t * z * z + c],
  ];
}

// Deterministic PRNG so tests never flake.
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

// Apply the solved COLUMN-MAJOR 4×4 to a point.
function applyMatrix(m: number[], v: V3): V3 {
  return [
    m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
    m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
    m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14],
  ];
}

function makeModelPoints(rng: () => number, n: number, spread = 1): V3[] {
  return Array.from({ length: n }, () => [
    (rng() - 0.5) * 2 * spread,
    (rng() - 0.5) * 2 * spread,
    (rng() - 0.5) * 2 * spread,
  ]);
}

describe('solveRigid — rigid point-pair registration', () => {
  it('recovers a known rotation + translation exactly (N=4, noise-free)', () => {
    const rng = lcg(42);
    const R = axisAngle([0.3, 1, 0.2], 0.7);
    const t: V3 = [0.5, -0.2, 1.3];
    const model = makeModelPoints(rng, 4);
    const pairs: PointPair[] = model.map((m) => ({ model: m, real: addV(applyR(R, m), t) }));

    const fit = solveRigid(pairs);
    expect(fit.ok).toBe(true);
    expect(fit.rmsMm).toBeLessThan(0.01); // sub-micron in the noise-free case
    expect(fit.scaleSanity).toBeCloseTo(1, 4);
    // The solved matrix reproduces real = M·model.
    for (const p of pairs) {
      const pred = applyMatrix(fit.matrix, p.model);
      for (let i = 0; i < 3; i++) expect(pred[i]).toBeCloseTo(p.real[i], 5);
    }
  });

  it('produces an orthonormal rotation with det = +1 (no reflection/scale baked in)', () => {
    const rng = lcg(7);
    const R = axisAngle([1, 0.5, -0.4], 2.1);
    const t: V3 = [-1, 2, 0.3];
    const pairs: PointPair[] = makeModelPoints(rng, 5).map((m) => ({ model: m, real: addV(applyR(R, m), t) }));
    const m = solveRigid(pairs).matrix;
    const c0: V3 = [m[0], m[1], m[2]];
    const c1: V3 = [m[4], m[5], m[6]];
    const c2: V3 = [m[8], m[9], m[10]];
    const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    expect(Math.hypot(...c0)).toBeCloseTo(1, 5);
    expect(Math.hypot(...c1)).toBeCloseTo(1, 5);
    expect(Math.hypot(...c2)).toBeCloseTo(1, 5);
    expect(dot(c0, c1)).toBeCloseTo(0, 5);
    expect(dot(c0, c2)).toBeCloseTo(0, 5);
    // det via triple product = +1
    const cross: V3 = [c0[1] * c1[2] - c0[2] * c1[1], c0[2] * c1[0] - c0[0] * c1[2], c0[0] * c1[1] - c0[1] * c1[0]];
    expect(dot(cross, c2)).toBeCloseTo(1, 5);
  });

  it('stays robust with measurement noise (RMS small, not zero)', () => {
    const rng = lcg(99);
    const R = axisAngle([0.2, 0.7, 0.5], 1.0);
    const t: V3 = [0.1, 0.4, -0.6];
    const pairs: PointPair[] = makeModelPoints(rng, 6).map((m) => ({
      model: m,
      real: addV(addV(applyR(R, m), t), [(rng() - 0.5) * 0.004, (rng() - 0.5) * 0.004, (rng() - 0.5) * 0.004]),
    }));
    const fit = solveRigid(pairs);
    expect(fit.ok).toBe(true);
    expect(fit.rmsMm).toBeGreaterThan(0); // noise present
    expect(fit.rmsMm).toBeLessThan(5); // but a few mm at most
    expect(fit.scaleSanity).toBeCloseTo(1, 2);
  });

  it('REPORTS a scale mismatch but never bakes it into the matrix', () => {
    const rng = lcg(3);
    const R = axisAngle([0, 1, 0], 0.5);
    const factor = 1.08;
    const mc: V3 = [0.2, 0.1, -0.3];
    const model = makeModelPoints(rng, 5);
    // real = R · (model scaled about its centroid by `factor`) — i.e. a genuinely
    // bigger/smaller real piece.
    const cen: V3 = model.reduce((a, m) => addV(a, m), [0, 0, 0]).map((c) => c / model.length) as V3;
    const pairs: PointPair[] = model.map((m) => {
      const scaled: V3 = [
        cen[0] + (m[0] - cen[0]) * factor,
        cen[1] + (m[1] - cen[1]) * factor,
        cen[2] + (m[2] - cen[2]) * factor,
      ];
      return { model: m, real: addV(applyR(R, scaled), mc) };
    });
    const fit = solveRigid(pairs);
    expect(fit.scaleSanity).toBeCloseTo(factor, 2); // detected…
    // …but the matrix rotation is still orthonormal (no scale baked in): column norm ≈ 1
    expect(Math.hypot(fit.matrix[0], fit.matrix[1], fit.matrix[2])).toBeCloseTo(1, 4);
  });

  it('N=1 is a pure translation', () => {
    const fit = solveRigid([{ model: [1, 2, 3], real: [4, 6, 8] }]);
    expect(fit.ok).toBe(true);
    expect(applyMatrix(fit.matrix, [1, 2, 3])).toEqual([4, 6, 8]);
    // identity rotation
    expect(fit.matrix[0]).toBeCloseTo(1, 6);
    expect(fit.matrix[5]).toBeCloseTo(1, 6);
  });

  it('N=2 aligns the edge and reports the length ratio', () => {
    // model edge along +X (length 2); real edge along +Z (length 3) from origin.
    const pairs: PointPair[] = [
      { model: [0, 0, 0], real: [0, 0, 0] },
      { model: [2, 0, 0], real: [0, 0, 3] },
    ];
    const fit = solveRigid(pairs);
    expect(fit.ok).toBe(true);
    expect(fit.scaleSanity).toBeCloseTo(1.5, 4); // 3 / 2
    // first point maps to origin; second model end maps onto the real edge direction
    const p1 = applyMatrix(fit.matrix, [2, 0, 0]);
    // direction should be +Z; since scale isn't applied, |p1| stays 2 (model length)
    expect(Math.hypot(...p1)).toBeCloseTo(2, 4);
    expect(p1[2]).toBeCloseTo(2, 4); // pointing along +Z
    expect(Math.abs(p1[0])).toBeLessThan(1e-4);
  });

  it('RANSAC rejects a single grossly mistapped pair (N=4 → 3 inliers)', () => {
    const rng = lcg(2024);
    const R = axisAngle([0.4, 0.2, 1], 0.9);
    const t: V3 = [0.3, -0.5, 0.8];
    const model = makeModelPoints(rng, 4);
    const pairs: PointPair[] = model.map((m) => ({ model: m, real: addV(applyR(R, m), t) }));
    // Corrupt one correspondence by half a metre.
    pairs[2] = { model: pairs[2].model, real: addV(pairs[2].real, [0.5, -0.5, 0.5]) };

    const fit = solveRigid(pairs);
    expect(fit.inlierCount).toBe(3);
    expect(fit.rmsMm).toBeLessThan(1); // the 3 good pairs fit cleanly
  });
});
