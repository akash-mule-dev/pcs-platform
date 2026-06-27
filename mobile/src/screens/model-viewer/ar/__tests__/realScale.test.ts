import { metersPerUnit, realScaleMetersPerUnit } from '../realScale';
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
