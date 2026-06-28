import {
  PoseSample,
  computeRunMetrics,
  compareRuns,
  evalPose,
  rotAngleDeg,
} from '../ar/stability-benchmark';
import { Mat4, identity4, translation4, mat4FromQuatTranslation } from '../ar/mat4';

// ── helpers ──
function trans(x: number, y: number, z: number): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
}
function rotZ(deg: number, t: [number, number, number] = [0, 0, 0]): Mat4 {
  const r = (deg * Math.PI) / 180;
  return mat4FromQuatTranslation([Math.cos(r / 2), 0, 0, Math.sin(r / 2)], t); // [w,x,y,z]
}

describe('stability-benchmark — primitives', () => {
  it('evalPose returns the model pose in the reference marker frame', () => {
    const s: PoseSample = { t: 0, model: trans(1.5, 0, 0), refMarker: trans(1, 0, 0) };
    expect(translation4(evalPose(s))).toEqual([0.5, 0, 0]);
  });

  it('evalPose falls back to the raw world pose with no marker', () => {
    const s: PoseSample = { t: 0, model: trans(2, 3, 4) };
    expect(translation4(evalPose(s))).toEqual([2, 3, 4]);
  });

  it('rotAngleDeg measures the relative rotation', () => {
    expect(rotAngleDeg(identity4(), rotZ(90))).toBeCloseTo(90, 4);
    expect(rotAngleDeg(rotZ(30), rotZ(75))).toBeCloseTo(45, 4);
    expect(rotAngleDeg(identity4(), identity4())).toBeCloseTo(0, 6);
  });
});

describe('stability-benchmark — computeRunMetrics edge cases', () => {
  it('handles zero samples', () => {
    const m = computeRunMetrics([]);
    expect(m.sampleCount).toBe(0);
    expect(m.driftRmsMm).toBe(0);
    expect(m.jitterRmsMm).toBe(0);
  });

  it('handles a single sample (no drift/jitter yet)', () => {
    const m = computeRunMetrics([{ t: 0, model: trans(1, 1, 1), refMarker: identity4(), markerActive: true }]);
    expect(m.sampleCount).toBe(1);
    expect(m.driftRmsMm).toBe(0);
    expect(m.jitterRmsMm).toBe(0);
    expect(m.markerActiveFraction).toBe(1);
    expect(m.markerReferencedFraction).toBe(1);
  });

  it('a perfectly stable run reads ~0 drift and ~0 jitter', () => {
    const samples: PoseSample[] = [];
    for (let i = 0; i < 50; i++) samples.push({ t: i * 100, model: trans(0.4, 0, 0), refMarker: identity4(), markerActive: true });
    const m = computeRunMetrics(samples);
    expect(m.driftRmsMm).toBeCloseTo(0, 6);
    expect(m.jitterRmsMm).toBeCloseTo(0, 6);
    expect(m.rotDriftMaxDeg).toBeCloseTo(0, 6);
    expect(m.durationMs).toBe(4900);
  });
});

describe('stability-benchmark — drift & jitter', () => {
  // markers OFF: relative pose wanders 1 mm/sample (VIO drift), 100 samples.
  function driftingRun(): PoseSample[] {
    const s: PoseSample[] = [];
    for (let i = 0; i < 100; i++) s.push({ t: i * 100, model: trans(0.001 * i, 0, 0), refMarker: identity4(), markerActive: false });
    return s;
  }
  // markers ON: relative pose holds, with sub-mm dithering only.
  function stableRun(): PoseSample[] {
    const s: PoseSample[] = [];
    for (let i = 0; i < 100; i++) s.push({ t: i * 100, model: trans(0.0002 * (i % 2), 0, 0), refMarker: identity4(), markerActive: true });
    return s;
  }

  it('captures linear drift: max ≈ 97 mm, frame jitter = 1 mm', () => {
    const m = computeRunMetrics(driftingRun());
    expect(m.driftMaxMm).toBeCloseTo(97, 2);
    expect(m.jitterRmsMm).toBeCloseTo(1, 4); // each consecutive step is exactly 1 mm
    expect(m.jitterMaxMm).toBeCloseTo(1, 4);
    expect(m.driftRmsMm).toBeGreaterThan(40);
    expect(m.driftRmsMm).toBeLessThan(70);
  });

  it('the stable run is far steadier than the drifting one', () => {
    const off = computeRunMetrics(driftingRun());
    const on = computeRunMetrics(stableRun());
    expect(on.driftRmsMm).toBeLessThan(1);
    expect(on.driftRmsMm).toBeLessThan(off.driftRmsMm);
  });

  it('measures rotational drift relative to the marker', () => {
    const s: PoseSample[] = [];
    for (let i = 0; i < 10; i++) s.push({ t: i * 100, model: rotZ(i), refMarker: identity4() }); // 0..9 deg
    const m = computeRunMetrics(s);
    expect(m.rotDriftMaxDeg).toBeCloseTo(9, 3);
  });

  it('reports the marker-referenced fraction (warn when low)', () => {
    const s: PoseSample[] = [
      { t: 0, model: trans(0, 0, 0), refMarker: identity4() },
      { t: 100, model: trans(0, 0, 0) }, // no marker this tick
      { t: 200, model: trans(0, 0, 0), refMarker: identity4() },
      { t: 300, model: trans(0, 0, 0), refMarker: identity4() },
    ];
    expect(computeRunMetrics(s).markerReferencedFraction).toBeCloseTo(0.75, 6);
  });
});

describe('stability-benchmark — compareRuns verdict', () => {
  function run(driftMm: number): PoseSample[] {
    // build a run whose per-sample relative offset grows to ~driftMm
    const s: PoseSample[] = [];
    const n = 100;
    for (let i = 0; i < n; i++) s.push({ t: i * 100, model: trans((driftMm / 1000) * (i / (n - 1)), 0, 0), refMarker: identity4() });
    return s;
  }

  it('flags an improvement and phrases the verdict', () => {
    const cmp = compareRuns(computeRunMetrics(run(40)), computeRunMetrics(run(4)));
    expect(cmp.improved).toBe(true);
    expect(cmp.driftReductionMm).toBeGreaterThan(0);
    expect(cmp.driftReductionPct).toBeGreaterThan(50);
    expect(cmp.verdict).toMatch(/steadier/);
  });

  it('does not claim improvement when markers did not help', () => {
    const cmp = compareRuns(computeRunMetrics(run(4)), computeRunMetrics(run(40)));
    expect(cmp.improved).toBe(false);
    expect(cmp.verdict).toMatch(/No drift improvement/);
  });

  it('asks for both runs when one is missing', () => {
    const cmp = compareRuns(computeRunMetrics([]), computeRunMetrics(run(10)));
    expect(cmp.verdict).toMatch(/Record both/);
  });
});

describe('stability-benchmark — export', () => {
  const { computeRunMetrics: crm } = require('../ar/stability-benchmark');
  function run(driftMm: number) {
    const s = [] as any[];
    for (let i = 0; i < 20; i++) s.push({ t: i * 100, model: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, (driftMm / 1000) * (i / 19), 0, 0, 1], refMarker: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] });
    return { metrics: crm(s), samples: s };
  }
  it('buildBenchmarkExport wraps both runs + a comparison', () => {
    const { buildBenchmarkExport } = require('../ar/stability-benchmark');
    const exp = buildBenchmarkExport({ off: run(40), on: run(3), context: { modelId: 'm1' }, now: 0 });
    expect(exp.schema).toBe('pcs-ar-stability-benchmark/v1');
    expect(exp.generatedAt).toBe('1970-01-01T00:00:00.000Z');
    expect(exp.comparison?.improved).toBe(true);
    expect(exp.runs.off?.samples.length).toBe(20);
    expect(exp.context).toEqual({ modelId: 'm1' });
  });
  it('null comparison until both runs exist', () => {
    const { buildBenchmarkExport } = require('../ar/stability-benchmark');
    expect(buildBenchmarkExport({ off: run(10) }).comparison).toBeNull();
  });
  it('benchmarkCsv emits a metric-per-row table', () => {
    const { buildBenchmarkExport, benchmarkCsv } = require('../ar/stability-benchmark');
    const csv = benchmarkCsv(buildBenchmarkExport({ off: run(40), on: run(3), now: 0 }));
    const lines = csv.split('\n');
    expect(lines[0]).toBe('metric,markers_off,markers_on');
    expect(lines.find((l: string) => l.startsWith('drift_rms_mm,'))).toBeTruthy();
    expect(lines.length).toBe(11); // header + 10 metrics
  });
});
