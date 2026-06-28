// stability-benchmark.ts
// Quantify how much image-marker lock improves the on-assembly stability of the
// projected model — the "is it worth the markers?" number for QA / benchmarking.
//
// METHOD (why this is a fair A/B). Marker DETECTION is always on in the LiDAR engine
// (`configureMarkerDetection`), independent of whether marker LOCK is armed. So in BOTH
// a markers-OFF run and a markers-ON run a tracked reference marker is available, and it
// is the drift-free ground truth: an `ARImageAnchor` is re-solved against the PHYSICAL
// marker every frame, so it stays glued to the real steel while ARKit's world frame
// slips under VIO drift. We therefore measure the model's pose IN THE REFERENCE MARKER'S
// FRAME (`marker⁻¹ · model`) — the model's position/orientation relative to the real
// object:
//   • LOCK OFF — the model is a fixed WORLD anchor, so as the world frame drifts the
//     marker (re-solved against reality) moves under it and the relative pose WANDERS.
//     That wander IS the visual drift of the overlay off the steel.
//   • LOCK ON  — the model is driven by the marker, so the relative pose is constant by
//     construction; only fusion/easing jitter remains.
// The delta between the two runs' wander (RMS, in mm) is the headline result.
//
// If a sample has no reference marker we fall back to the raw model WORLD pose (measures
// world-pose constancy, not visual drift) and flag it via `markerReferencedFraction` so
// the UI can warn that the run wasn't marker-referenced.
//
// Pure + dependency-free (jest-testable; repo convention — cf. rigid-registration.ts,
// drift-monitor.ts). Inputs are metres / column-major matrices; outputs are mm / degrees.
import { Mat4, multiply4, invert4, translation4 } from './mat4';

/** One pose tick streamed from the native view during a benchmark recording. */
export interface PoseSample {
  /** ms timestamp. */
  t: number;
  /** The model's rendered WORLD transform (column-major 16 — `simd_float4x4`). */
  model: Mat4;
  /** A tracked reference marker's WORLD transform this tick (the nearest tracked one),
   *  if any. Present ⇒ stability is measured in this marker's frame (the visual
   *  on-object error). Absent ⇒ raw world-pose constancy fallback. */
  refMarker?: Mat4;
  /** A marker was actively DRIVING the pose this tick (informational; true only with
   *  lock armed + a bound marker acceptable). */
  markerActive?: boolean;
  /** ARKit tracking state at this tick (informational). */
  tracking?: string;
}

/** Reduced stability metrics for one recording run. */
export interface RunMetrics {
  sampleCount: number;
  durationMs: number;
  /** RMS positional deviation from the run's reference pose (mm) — sustained drift/wander. */
  driftRmsMm: number;
  /** Worst positional deviation from the reference pose (mm). */
  driftMaxMm: number;
  /** RMS of frame-to-frame translation deltas (mm) — high-frequency jitter/shake. */
  jitterRmsMm: number;
  /** Worst single frame-to-frame translation delta (mm). */
  jitterMaxMm: number;
  /** RMS frame-to-frame rotational delta (deg) — angular jitter. */
  rotJitterRmsDeg: number;
  /** Worst angular deviation from the reference orientation (deg). */
  rotDriftMaxDeg: number;
  /** Fraction of samples where a marker was driving the pose (0..1). */
  markerActiveFraction: number;
  /** Fraction of samples that had a reference marker (0..1). 1 ⇒ fully marker-referenced
   *  (a trustworthy A/B); low ⇒ the run measured raw world pose, warn the user. */
  markerReferencedFraction: number;
}

export interface RunOptions {
  /** The reference pose is the mean of the first N samples' positions (default 5),
   *  robust to a single noisy first frame. */
  referenceWindowSamples?: number;
}

/** A/B comparison of a markers-OFF run vs a markers-ON run. */
export interface BenchmarkComparison {
  off: RunMetrics;
  on: RunMetrics;
  /** off.driftRmsMm − on.driftRmsMm (mm saved). Positive ⇒ markers steadier. */
  driftReductionMm: number;
  /** As a percentage of the OFF drift (0 when OFF drift is ~0). */
  driftReductionPct: number;
  jitterReductionMm: number;
  jitterReductionPct: number;
  /** True when the ON run's drift is lower than the OFF run's. */
  improved: boolean;
  /** One-line human verdict for the results card. */
  verdict: string;
}

type V3 = [number, number, number];

function sub(a: V3, b: V3): V3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function norm(a: V3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

/** The pose we actually score: model expressed in the reference marker's frame when a
 *  marker is present, else the raw model world pose. */
export function evalPose(s: PoseSample): Mat4 {
  return s.refMarker ? multiply4(invert4(s.refMarker), s.model) : s.model.slice();
}

/** Relative rotation angle (deg) between the upper-left 3×3 of two column-major rigid
 *  transforms: angle of `a⁻¹·b`, from its trace. */
export function rotAngleDeg(a: Mat4, b: Mat4): number {
  const rel = multiply4(invert4(a), b);
  const trace = rel[0] + rel[5] + rel[10]; // (0,0)+(1,1)+(2,2)
  const c = Math.max(-1, Math.min(1, (trace - 1) / 2));
  return (Math.acos(c) * 180) / Math.PI;
}

function emptyRun(): RunMetrics {
  return {
    sampleCount: 0,
    durationMs: 0,
    driftRmsMm: 0,
    driftMaxMm: 0,
    jitterRmsMm: 0,
    jitterMaxMm: 0,
    rotJitterRmsDeg: 0,
    rotDriftMaxDeg: 0,
    markerActiveFraction: 0,
    markerReferencedFraction: 0,
  };
}

/** Reduce a run of pose samples to stability metrics. Safe for 0/1 samples. */
export function computeRunMetrics(samples: PoseSample[], opts: RunOptions = {}): RunMetrics {
  const n = samples.length;
  if (n === 0) return emptyRun();

  const evals = samples.map(evalPose);
  const positions: V3[] = evals.map((m) => translation4(m));

  const markerActive = samples.filter((s) => s.markerActive).length / n;
  const markerReferenced = samples.filter((s) => !!s.refMarker).length / n;
  const durationMs = n >= 2 ? samples[n - 1].t - samples[0].t : 0;

  if (n === 1) {
    return {
      ...emptyRun(),
      sampleCount: 1,
      markerActiveFraction: markerActive,
      markerReferencedFraction: markerReferenced,
    };
  }

  // Reference position = mean of the first K positions (robust to a noisy first frame).
  const k = Math.max(1, Math.min(opts.referenceWindowSamples ?? 5, n));
  const refPos: V3 = [0, 0, 0];
  for (let i = 0; i < k; i++) {
    refPos[0] += positions[i][0];
    refPos[1] += positions[i][1];
    refPos[2] += positions[i][2];
  }
  refPos[0] /= k;
  refPos[1] /= k;
  refPos[2] /= k;

  // Drift = deviation from the reference pose; jitter = consecutive deltas.
  let driftSq = 0;
  let driftMax = 0;
  let jitterSq = 0;
  let jitterMax = 0;
  let rotJitterSq = 0;
  let rotDriftMax = 0;
  for (let i = 0; i < n; i++) {
    const d = norm(sub(positions[i], refPos));
    driftSq += d * d;
    if (d > driftMax) driftMax = d;
    const rd = rotAngleDeg(evals[0], evals[i]);
    if (rd > rotDriftMax) rotDriftMax = rd;
    if (i >= 1) {
      const j = norm(sub(positions[i], positions[i - 1]));
      jitterSq += j * j;
      if (j > jitterMax) jitterMax = j;
      const rj = rotAngleDeg(evals[i - 1], evals[i]);
      rotJitterSq += rj * rj;
    }
  }
  const mmsPerM = 1000;
  return {
    sampleCount: n,
    durationMs,
    driftRmsMm: Math.sqrt(driftSq / n) * mmsPerM,
    driftMaxMm: driftMax * mmsPerM,
    jitterRmsMm: Math.sqrt(jitterSq / (n - 1)) * mmsPerM,
    jitterMaxMm: jitterMax * mmsPerM,
    rotJitterRmsDeg: Math.sqrt(rotJitterSq / (n - 1)),
    rotDriftMaxDeg: rotDriftMax,
    markerActiveFraction: markerActive,
    markerReferencedFraction: markerReferenced,
  };
}

function pct(reduction: number, base: number): number {
  return base > 1e-6 ? (reduction / base) * 100 : 0;
}

/** Compare a markers-OFF run against a markers-ON run into a verdict for the card. */
export function compareRuns(off: RunMetrics, on: RunMetrics): BenchmarkComparison {
  const driftReductionMm = off.driftRmsMm - on.driftRmsMm;
  const jitterReductionMm = off.jitterRmsMm - on.jitterRmsMm;
  const driftReductionPct = pct(driftReductionMm, off.driftRmsMm);
  const jitterReductionPct = pct(jitterReductionMm, off.jitterRmsMm);
  const improved = on.driftRmsMm < off.driftRmsMm;

  let verdict: string;
  if (off.sampleCount < 2 || on.sampleCount < 2) {
    verdict = 'Record both a without-markers and a with-markers run to compare.';
  } else if (improved) {
    verdict =
      `Markers cut overlay drift ${off.driftRmsMm.toFixed(1)} → ${on.driftRmsMm.toFixed(1)} mm ` +
      `(${Math.round(driftReductionPct)}% steadier on the assembly).`;
  } else {
    verdict =
      `No drift improvement this run (${off.driftRmsMm.toFixed(1)} → ${on.driftRmsMm.toFixed(1)} mm). ` +
      `Keep a marker in clear view during both recordings.`;
  }

  return {
    off,
    on,
    driftReductionMm,
    driftReductionPct,
    jitterReductionMm,
    jitterReductionPct,
    improved,
    verdict,
  };
}

// ── Export (on-device benchmarking log) ──
// The user records an A/B on the iPad and exports the result for their benchmarking
// records (the "On-device card + exportable log" choice). These are pure so the
// payload shape + CSV are jest-testable; the RN layer only writes the file + shares it.

export interface BenchmarkRun {
  metrics: RunMetrics;
  samples: PoseSample[];
}

export interface BenchmarkExport {
  schema: 'pcs-ar-stability-benchmark/v1';
  generatedAt: string;
  context?: Record<string, unknown>;
  comparison: BenchmarkComparison | null;
  runs: { off: BenchmarkRun | null; on: BenchmarkRun | null };
}

export function buildBenchmarkExport(p: {
  off?: BenchmarkRun | null;
  on?: BenchmarkRun | null;
  context?: Record<string, unknown>;
  now?: number;
}): BenchmarkExport {
  const off = p.off ?? null;
  const on = p.on ?? null;
  return {
    schema: 'pcs-ar-stability-benchmark/v1',
    generatedAt: new Date(p.now ?? Date.now()).toISOString(),
    context: p.context,
    comparison: off && on ? compareRuns(off.metrics, on.metrics) : null,
    runs: { off, on },
  };
}

const CSV_ROWS: ReadonlyArray<readonly [keyof RunMetrics, string]> = [
  ['driftRmsMm', 'drift_rms_mm'],
  ['driftMaxMm', 'drift_max_mm'],
  ['jitterRmsMm', 'jitter_rms_mm'],
  ['jitterMaxMm', 'jitter_max_mm'],
  ['rotJitterRmsDeg', 'rot_jitter_rms_deg'],
  ['rotDriftMaxDeg', 'rot_drift_max_deg'],
  ['sampleCount', 'sample_count'],
  ['durationMs', 'duration_ms'],
  ['markerActiveFraction', 'marker_active_fraction'],
  ['markerReferencedFraction', 'marker_referenced_fraction'],
];

/** A compact summary CSV (one column per run) for a spreadsheet. */
export function benchmarkCsv(exp: BenchmarkExport): string {
  const off = exp.runs.off?.metrics;
  const on = exp.runs.on?.metrics;
  const cell = (m: RunMetrics | undefined, k: keyof RunMetrics) => (m ? String(m[k]) : '');
  const lines = ['metric,markers_off,markers_on'];
  for (const [key, label] of CSV_ROWS) lines.push(`${label},${cell(off, key)},${cell(on, key)}`);
  return lines.join('\n');
}
