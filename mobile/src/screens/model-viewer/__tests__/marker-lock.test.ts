import {
  computeBindOffset,
  modelWorldFromMarker,
  selectActiveMarker,
  markerWeight,
  fuseMarkerPoses,
  isBindQualityOk,
  fuseBindOffsets,
  solveGlobalMarkerAlignment,
  viewAngleFactor,
  MarkerCorrespondence,
  MarkerObservation,
} from '../ar/marker-lock';
import {
  Mat4,
  V3,
  fromRotationTranslation,
  multiply4,
  invert4,
  identity4,
  maxAbsDiff4,
} from '../ar/mat4';

// Column-major rigid transform: rotation about world-Y by θ, then translation t.
function rotYTrans(thetaDeg: number, t: V3): Mat4 {
  const r = (thetaDeg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  // row-major rotation about Y
  const R = [
    [c, 0, s],
    [0, 1, 0],
    [-s, 0, c],
  ];
  return fromRotationTranslation(R, t);
}

describe('mat4 inverse', () => {
  it('inverts a rigid transform (M · M⁻¹ = I)', () => {
    const M = rotYTrans(37, [1.2, -0.4, 3.1]);
    const I = multiply4(M, invert4(M));
    expect(maxAbsDiff4(I, identity4())).toBeLessThan(1e-5);
  });
});

describe('marker bind offset round-trip', () => {
  it('reconstructs the model pose from the same marker pose', () => {
    const marker = rotYTrans(20, [0.5, 1.0, -2.0]);
    const model = rotYTrans(-65, [0.7, 0.2, -1.7]);
    const offset = computeBindOffset(marker, model);
    const recon = modelWorldFromMarker(marker, offset);
    expect(maxAbsDiff4(recon, model)).toBeLessThan(1e-4);
  });

  it('the model rides world drift exactly with the marker', () => {
    // Bind while the world is "true".
    const marker = rotYTrans(10, [0, 0, -1.5]);
    const model = rotYTrans(0, [0.1, 0.05, -1.4]);
    const offset = computeBindOffset(marker, model);

    // Now the VIO world drifts by D (a small yaw + shift). The physical marker is
    // fixed on the steel, so ARKit re-reports it at markerLive = D · marker, and the
    // model SHOULD end up at D · model — i.e. it rode the drift out, staying glued to
    // the real object rather than sliding off it.
    const D = rotYTrans(4, [0.08, -0.02, 0.05]);
    const markerLive = multiply4(D, marker);
    const expected = multiply4(D, model);
    const recon = modelWorldFromMarker(markerLive, offset);
    expect(maxAbsDiff4(recon, expected)).toBeLessThan(1e-4);
  });
});

describe('selectActiveMarker', () => {
  const obs = (name: string, pos: V3, tracked = true, lastSeen = 1000): MarkerObservation => ({
    name,
    transform: rotYTrans(0, pos),
    tracked,
    lastSeen,
  });

  it('picks the marker nearest the camera among bound, tracked ones', () => {
    const observations = [obs('A', [0, 0, 0]), obs('B', [5, 0, 0])];
    const sel = selectActiveMarker(observations, new Set(['A', 'B']), {
      now: 1000,
      cameraPos: [4.6, 0, 0],
      currentActive: null,
    });
    expect(sel.active).toBe('B');
  });

  it('ignores unbound, untracked, and stale markers', () => {
    const observations = [
      obs('unbound', [0, 0, 0]),
      obs('untracked', [0.1, 0, 0], false),
      obs('stale', [0.1, 0, 0], true, 0), // lastSeen far in the past
      obs('good', [2, 0, 0], true, 5000),
    ];
    const sel = selectActiveMarker(observations, new Set(['untracked', 'stale', 'good']), {
      now: 5000,
      cameraPos: [0, 0, 0],
      currentActive: null,
      staleMs: 1500,
    });
    expect(sel.active).toBe('good');
  });

  it('holds the current marker under hysteresis (no flip-flop)', () => {
    // Camera at x=0.6: A (x=0) is 0.6 m away, B (x=1) is 0.4 m away. B is nearest, but
    // only by 0.2 m — below the 0.25 m switch margin — so the current active A holds.
    const observations = [obs('A', [0, 0, 0]), obs('B', [1, 0, 0])];
    const sel = selectActiveMarker(observations, new Set(['A', 'B']), {
      now: 1000,
      cameraPos: [0.6, 0, 0],
      currentActive: 'A',
      switchMarginM: 0.25,
    });
    expect(sel.active).toBe('A');
    expect(sel.reason).toBe('held-by-hysteresis');
  });

  it('switches when a candidate is clearly closer than the current active', () => {
    const observations = [obs('A', [0, 0, 0]), obs('B', [3, 0, 0])];
    const sel = selectActiveMarker(observations, new Set(['A', 'B']), {
      now: 1000,
      cameraPos: [3, 0, 0], // right on B
      currentActive: 'A',
      switchMarginM: 0.25,
    });
    expect(sel.active).toBe('B');
    expect(sel.reason).toBe('switched-to-nearest');
  });

  it('returns null when nothing is usable', () => {
    const sel = selectActiveMarker([], new Set(), {
      now: 1000,
      cameraPos: [0, 0, 0],
      currentActive: 'A',
    });
    expect(sel.active).toBeNull();
  });
});

describe('markerWeight (quality gating, Item 2)', () => {
  const at = (pos: V3, tracked = true): MarkerObservation => ({
    name: 'm',
    transform: rotYTrans(0, pos),
    tracked,
    lastSeen: 0,
  });

  it('is 0 for an untracked marker', () => {
    expect(markerWeight(at([0, 0, 0], false), [0, 0, 0])).toBe(0);
  });

  it('is 0 beyond the max range', () => {
    expect(markerWeight(at([5, 0, 0]), [0, 0, 0], { maxRangeM: 3 })).toBe(0);
  });

  it('weights a near marker higher than a far one (monotonic falloff)', () => {
    const near = markerWeight(at([0.3, 0, 0]), [0, 0, 0]);
    const far = markerWeight(at([2.5, 0, 0]), [0, 0, 0]);
    expect(near).toBeGreaterThan(far);
    expect(far).toBeGreaterThan(0); // still contributes (not binary-lost)
  });
});

describe('fuseMarkerPoses (multi-marker fusion, Item 1)', () => {
  it('returns null when no positive weight (caller then holds — freeze)', () => {
    expect(fuseMarkerPoses([])).toBeNull();
    expect(fuseMarkerPoses([{ transform: rotYTrans(0, [1, 2, 3]), weight: 0 }])).toBeNull();
  });

  it('returns the single pose when only one contributes', () => {
    const m = rotYTrans(30, [1, 0.5, -2]);
    const f = fuseMarkerPoses([{ transform: m, weight: 0.8 }])!;
    expect(maxAbsDiff4(f, m)).toBeLessThan(1e-4);
  });

  it('averages two equal-weight poses to the midpoint translation', () => {
    const a = rotYTrans(0, [0, 0, 0]);
    const b = rotYTrans(0, [2, 4, -6]);
    const f = fuseMarkerPoses([
      { transform: a, weight: 1 },
      { transform: b, weight: 1 },
    ])!;
    expect(f[12]).toBeCloseTo(1, 5);
    expect(f[13]).toBeCloseTo(2, 5);
    expect(f[14]).toBeCloseTo(-3, 5);
  });

  it('biases toward the higher-weight pose', () => {
    const a = rotYTrans(0, [0, 0, 0]);
    const b = rotYTrans(0, [10, 0, 0]);
    const f = fuseMarkerPoses([
      { transform: a, weight: 3 },
      { transform: b, weight: 1 },
    ])!;
    // weighted avg x = (0*3 + 10*1)/4 = 2.5
    expect(f[12]).toBeCloseTo(2.5, 5);
  });

  it('fuses rotations to a valid (orthonormal) transform', () => {
    const a = rotYTrans(10, [0, 0, 0]);
    const b = rotYTrans(50, [0, 0, 0]);
    const f = fuseMarkerPoses([
      { transform: a, weight: 1 },
      { transform: b, weight: 1 },
    ])!;
    // Column 0 of the rotation should stay unit-length (no scale crept in).
    const c0 = Math.hypot(f[0], f[1], f[2]);
    expect(c0).toBeCloseTo(1, 5);
  });
});

describe('isBindQualityOk (bind-quality gate)', () => {
  const at = (pos: V3, tracked = true): MarkerObservation => ({
    name: 'm',
    transform: rotYTrans(0, pos),
    tracked,
    lastSeen: 0,
  });

  it('rejects an untracked marker', () => {
    expect(isBindQualityOk(at([0.4, 0, 0], false), [0, 0, 0])).toBe(false);
  });

  it('rejects a far / grazing marker (low weight)', () => {
    // 2.6 m away ⇒ weight ≈ 1/(1+(2.6/0.5)²) ≈ 0.036 < 0.2 default min.
    expect(isBindQualityOk(at([2.6, 0, 0]), [0, 0, 0])).toBe(false);
  });

  it('accepts a near, square-on, tracked marker', () => {
    // 0.4 m away ⇒ weight ≈ 1/(1+(0.4/0.5)²) ≈ 0.61 ≥ 0.2.
    expect(isBindQualityOk(at([0.4, 0, 0]), [0, 0, 0])).toBe(true);
  });

  it('honours a custom minWeight', () => {
    expect(isBindQualityOk(at([0.4, 0, 0]), [0, 0, 0], { minWeight: 0.9 })).toBe(false);
  });
});

describe('fuseBindOffsets (multi-frame bind averaging)', () => {
  it('averages noisy offset samples closer to truth than a single sample', () => {
    const truth = rotYTrans(0, [1, 0, 0]);
    // Two noisy reads straddling the truth in opposite directions.
    const a = rotYTrans(0, [1.02, 0, 0]);
    const b = rotYTrans(0, [0.98, 0, 0]);
    const fused = fuseBindOffsets([
      { transform: a, weight: 1 },
      { transform: b, weight: 1 },
    ])!;
    expect(fused[12]).toBeCloseTo(truth[12], 5);
  });
});

describe('viewAngleFactor (grazing-angle quality)', () => {
  // A marker lying in the X-Y plane with +Z normal, at the origin.
  const marker = rotYTrans(0, [0, 0, 0]);
  it('is ~1 looking square-on along the normal', () => {
    expect(viewAngleFactor(marker, [0, 0, 2], 'z')).toBeCloseTo(1, 3);
  });
  it('falls toward 0 at a grazing angle (camera in the marker plane)', () => {
    expect(viewAngleFactor(marker, [2, 0, 0], 'z')).toBeLessThan(0.05);
  });
  it('is monotonic: square-on > oblique', () => {
    const square = viewAngleFactor(marker, [0, 0, 2], 'z');
    const oblique = viewAngleFactor(marker, [2, 0, 2], 'z');
    expect(square).toBeGreaterThan(oblique);
  });
});

describe('solveGlobalMarkerAlignment (SpacePins / WLT analog)', () => {
  // Four bound markers spread over a ~2 m plane (well-conditioned for rotation).
  const bound: MarkerCorrespondence['bound'][] = [
    rotYTrans(0, [0, 0, 0]),
    rotYTrans(0, [2, 0, 0]),
    rotYTrans(0, [0, 0, 2]),
    rotYTrans(0, [2, 0, 2]),
  ];

  it('recovers a pure-translation world drift', () => {
    const D = rotYTrans(0, [0.1, -0.05, 0.2]);
    const corr: MarkerCorrespondence[] = bound.map((b) => ({
      bound: b,
      live: multiply4(D, b),
      weight: 1,
    }));
    const sol = solveGlobalMarkerAlignment(corr)!;
    expect(sol.wellConstrained).toBe(true);
    expect(maxAbsDiff4(sol.world, D)).toBeLessThan(1e-3);
  });

  it('recovers a yaw+translation world drift from the marker SPREAD', () => {
    const D = rotYTrans(8, [0.08, 0, -0.03]);
    const corr: MarkerCorrespondence[] = bound.map((b) => ({
      bound: b,
      live: multiply4(D, b),
      weight: 1,
    }));
    const sol = solveGlobalMarkerAlignment(corr)!;
    expect(sol.wellConstrained).toBe(true);
    // The recovered transform reproduces the drifted model pose end-to-end.
    const modelBound = rotYTrans(30, [1, 0.2, 1]);
    const modelLive = multiply4(sol.world, modelBound);
    const expected = multiply4(D, modelBound);
    expect(maxAbsDiff4(modelLive, expected)).toBeLessThan(2e-3);
  });

  it('returns null when no marker clears the weight gate', () => {
    const corr: MarkerCorrespondence[] = bound.map((b) => ({ bound: b, live: b, weight: 0 }));
    expect(solveGlobalMarkerAlignment(corr)).toBeNull();
  });

  it('is NOT well-constrained with only 2 markers (no rotation pin)', () => {
    const D = rotYTrans(5, [0.1, 0, 0]);
    const corr: MarkerCorrespondence[] = bound.slice(0, 2).map((b) => ({
      bound: b,
      live: multiply4(D, b),
      weight: 1,
    }));
    const sol = solveGlobalMarkerAlignment(corr)!;
    expect(sol.wellConstrained).toBe(false);
  });

  it('leans toward the high-weight (nearby) markers — piecewise/local accuracy', () => {
    // Three "near" markers drift by +0.1 in x; one "far" marker drifts by -0.2 in x.
    // A single rigid fit must compromise; weighting the near markers heavily pulls the
    // solved translation toward their local drift (the World-Locking "fragment" stand-in).
    const near = [bound[0], bound[1], bound[2]];
    const far = bound[3];
    const Dnear = rotYTrans(0, [0.1, 0, 0]);
    const Dfar = rotYTrans(0, [-0.2, 0, 0]);
    const mk = (b: MarkerCorrespondence['bound'], D: typeof Dnear, weight: number): MarkerCorrespondence => ({
      bound: b,
      live: multiply4(D, b),
      weight,
    });

    const weighted = solveGlobalMarkerAlignment([
      mk(near[0], Dnear, 1), mk(near[1], Dnear, 1), mk(near[2], Dnear, 1), mk(far, Dfar, 0.05),
    ])!;
    const equal = solveGlobalMarkerAlignment([
      mk(near[0], Dnear, 1), mk(near[1], Dnear, 1), mk(near[2], Dnear, 1), mk(far, Dfar, 1),
    ])!;

    // Weighted solve sits much closer to the near drift (+0.1) than the equal-weight one.
    expect(weighted.world[12]).toBeGreaterThan(equal.world[12]);
    expect(weighted.world[12]).toBeCloseTo(0.1, 1);
  });
});
