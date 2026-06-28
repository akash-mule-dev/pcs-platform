import {
  metersPerUnit,
  realScaleMetersPerUnit,
  magnitudeMetersPerUnit,
  resolveRealScale,
} from '../realScale';
import { PartDimension } from '../dimensionExtractor';
import { MNode } from '../../../../services/projects.service';

function part(name: string, longest: number): PartDimension {
  return {
    name,
    min: [0, 0, 0],
    max: [longest, 0.1, 0.1],
    size: [longest, 0.1, 0.1],
    center: [longest / 2, 0.05, 0.05],
  };
}
function node(guid: string, lengthMm: number | null): MNode {
  return { id: guid, ifcGuid: guid, meshName: guid, lengthMm } as unknown as MNode;
}

describe('metersPerUnit', () => {
  it('recovers ÷1000 when the GLB is in mm (5000-unit beam == 5000 mm)', () => {
    const parts = [part('A', 5000), part('B', 3000)];
    const nodes = [node('A', 5000), node('B', 3000)];
    // length_m / edge = 5 / 5000 = 0.001 for both → median 0.001.
    expect(metersPerUnit(parts, nodes)).toBeCloseTo(0.001, 9);
  });

  it('recovers 1.0 when the GLB is already in metres (5-unit beam == 5000 mm)', () => {
    const parts = [part('A', 5), part('B', 3)];
    const nodes = [node('A', 5000), node('B', 3000)];
    expect(metersPerUnit(parts, nodes)).toBeCloseTo(1, 9);
  });

  it('takes the MEDIAN so one odd part does not skew the scale', () => {
    const parts = [part('A', 5000), part('B', 3000), part('C', 50)]; // C is a stubby plate
    const nodes = [node('A', 5000), node('B', 3000), node('C', 4000)]; // C length unrelated to its longest edge
    // ratios: 0.001, 0.001, 0.08 → median 0.001 (C ignored as the outlier).
    expect(metersPerUnit(parts, nodes)).toBeCloseTo(0.001, 9);
  });

  it('returns null when no part carries a length', () => {
    expect(metersPerUnit([part('A', 100)], [node('A', null)])).toBeNull();
    expect(metersPerUnit([], [])).toBeNull();
  });

  it('ignores zero-size parts and lengths with no matching part', () => {
    const degenerate: PartDimension = {
      name: 'Z', min: [0, 0, 0], max: [0, 0, 0], size: [0, 0, 0], center: [0, 0, 0],
    };
    const parts = [part('A', 5000), degenerate];
    // 'Q' has a length but no part geometry → ignored; 'Z' has zero edge → skipped.
    const nodes = [node('A', 5000), node('Z', 9999), node('Q', 1234)];
    expect(metersPerUnit(parts, nodes)).toBeCloseTo(0.001, 9);
  });
});

describe('realScaleMetersPerUnit (plausibility guard)', () => {
  it('accepts a plausible assembly size', () => {
    const parts = [part('A', 5000)];
    const nodes = [node('A', 5000)];
    // overall longest 6000 units × 0.001 = 6 m → plausible.
    expect(realScaleMetersPerUnit(6000, parts, nodes)).toBeCloseTo(0.001, 9);
  });

  it('rejects an implausibly huge calibration (→ fit fallback)', () => {
    const parts = [part('A', 5)];
    const nodes = [node('A', 5000)]; // mpu = 1.0
    // overall 5000 units × 1.0 = 5000 m → absurd → null.
    expect(realScaleMetersPerUnit(5000, parts, nodes)).toBeNull();
  });

  it('rejects an implausibly tiny calibration', () => {
    const parts = [part('A', 5000)];
    const nodes = [node('A', 5000)]; // mpu = 0.001
    // overall 5 units × 0.001 = 0.005 m → too small → null.
    expect(realScaleMetersPerUnit(5, parts, nodes)).toBeNull();
  });
});

describe('magnitudeMetersPerUnit (geometry-only unit snap)', () => {
  it('snaps a metre-unit model (6-unit beam) to mpu 1', () => {
    expect(magnitudeMetersPerUnit(6)).toBe(1);
  });
  it('snaps a mm-unit model (6000-unit beam) to mpu 0.001', () => {
    expect(magnitudeMetersPerUnit(6000)).toBe(0.001);
  });
  it('classifies a big 30 m truss as metres, not mm', () => {
    expect(magnitudeMetersPerUnit(30)).toBe(1);
  });
  it('returns null for an absurd magnitude (neither m nor mm plausible)', () => {
    expect(magnitudeMetersPerUnit(5_000_000)).toBeNull(); // 5000 km or 5 km — both absurd
    expect(magnitudeMetersPerUnit(0.001)).toBeNull(); // 1 mm or 1 µm — both too small
  });
  it('classifies a LARGE mm whole-model (130 m = 130000 units) as mm — no 120 m ceiling', () => {
    // Regression: the old [_,120] ceiling dropped 1:1 for big assemblies → 0.6 m fit.
    expect(magnitudeMetersPerUnit(130_000)).toBe(0.001);
  });
  it('returns null (NOT a 100 m render) for an ambiguous small isolated part', () => {
    // 100 units could be a 100 m metre-unit structure OR a 0.10 m mm-unit part —
    // both plausible → ambiguous → null so the caller never renders 1000× wrong.
    // (Regression: previously this snapped to metres and blew a 100 mm part up to 100 m.)
    expect(magnitudeMetersPerUnit(100)).toBeNull();
  });
  it('snaps unambiguously when only one reading is plausible', () => {
    expect(magnitudeMetersPerUnit(500)).toBe(0.001); // 500 m absurd; 0.5 m ok → mm
    expect(magnitudeMetersPerUnit(12)).toBe(1); // 12 m ok; 0.012 m too small → metres
  });
});

describe('resolveRealScale (robust 1:1 strategy)', () => {
  it('uses calibration when it agrees with the geometry magnitude', () => {
    // mm GLB: 6000-unit overall, parts carry good mm lengths → calib ≈ 0.001 == mag.
    const parts = [part('A', 5000), part('B', 3000)];
    const nodes = [node('A', 5000), node('B', 3000)];
    const r = resolveRealScale(6000, parts, nodes);
    expect(r.source).toBe('calibrated');
    expect(r.mpu).toBeCloseTo(0.001, 9);
  });

  it('falls back to the geometry estimate when length data is CORRUPT (the prod case)', () => {
    // 6000-unit (mm) model, but lengths are ~1000× too small (0.2 mm members) →
    // calibration would scale the model to a few cm. Geometry magnitude overrides.
    const parts = [part('A', 5000), part('B', 3000)];
    const nodes = [node('A', 0.2), node('B', 0.25)];
    const r = resolveRealScale(6000, parts, nodes);
    expect(r.source).toBe('estimated');
    expect(r.mpu).toBe(0.001); // mm snap → true 1:1
  });

  it('falls back to the geometry estimate when there are NO part lengths', () => {
    const parts = [part('A', 6000)];
    const nodes = [node('A', null)];
    const r = resolveRealScale(6000, parts, nodes);
    expect(r.source).toBe('estimated');
    expect(r.mpu).toBe(0.001);
  });

  it('returns mpu 0 (→ fit-scale) only when even the geometry is undeterminable', () => {
    const r = resolveRealScale(0.0005, [], []); // ~0.5 µm or 0.5 mm — both implausible
    expect(r.source).toBe('none');
    expect(r.mpu).toBe(0);
  });

  it('resolves an ambiguous magnitude via calibration when length data is present', () => {
    // 100-unit overall is ambiguous to the geometry snap, but good mm lengths pin it.
    const parts = [part('A', 100)];
    const nodes = [node('A', 100)]; // 100 mm part, 100-unit edge → calib 0.001
    const r = resolveRealScale(100, parts, nodes);
    expect(r.source).toBe('calibrated');
    expect(r.mpu).toBeCloseTo(0.001, 9);
  });

  it('keeps a large mm whole-model at 1:1 (regression: old 120 m ceiling)', () => {
    const r = resolveRealScale(130_000, [], []); // 130 m in mm units, no length data
    expect(r.source).toBe('estimated');
    expect(r.mpu).toBe(0.001);
  });
});
