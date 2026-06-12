/**
 * Pure SPC math for individuals (XmR) control charts. No NestJS/TypeORM
 * imports, so this is unit-testable in isolation
 * (`node --experimental-strip-types src/spc/spc-math.test.ts`).
 *
 * Sigma is estimated from the AVERAGE MOVING RANGE (MR-bar / d2, d2 = 1.128
 * for n=2), the textbook estimator for individuals charts — sample standard
 * deviation overstates limits when the process drifts. Violations implement
 * the first four Western Electric rules.
 */

export interface SpcPointInput {
  value: number;
  date?: Date | string | null;
}

export interface SpcViolation {
  index: number; // 1-based point index
  rule: 'beyond_3sigma' | '2_of_3_beyond_2sigma' | '4_of_5_beyond_1sigma' | 'run_of_8_one_side';
  value?: number;
}

export interface SpcChart {
  count: number;
  mean: number;
  sigma: number;          // MR-bar / 1.128 (falls back to sample stddev when < 2 ranges)
  sigmaMethod: 'moving_range' | 'sample_stddev';
  ucl: number;
  lcl: number;
  usl: number | null;
  lsl: number | null;
  cp: number | null;
  cpk: number | null;
  inControl: boolean;
  points: Array<{
    index: number;
    value: number;
    date: Date | string | null;
    movingRange: number | null;
    outOfControl: boolean;
    outOfSpec: boolean;
  }>;
  violations: SpcViolation[];
}

const r4 = (v: number) => Number(v.toFixed(4));

/** Build an individuals (XmR) chart from a measurement series. */
export function xmrChart(
  inputs: SpcPointInput[],
  spec: { usl?: number | null; lsl?: number | null } = {},
): SpcChart | { count: 0; points: never[]; violations: never[]; message: string } {
  const values = inputs.map((p) => Number(p.value)).filter((v) => Number.isFinite(v));
  const n = values.length;
  if (n === 0) return { count: 0, points: [], violations: [], message: 'No measurement data for this selection' };

  const mean = values.reduce((a, b) => a + b, 0) / n;

  // Moving ranges |x_i − x_{i−1}|
  const movingRanges: number[] = [];
  for (let i = 1; i < n; i++) movingRanges.push(Math.abs(values[i] - values[i - 1]));

  let sigma: number;
  let sigmaMethod: SpcChart['sigmaMethod'];
  if (movingRanges.length >= 1) {
    const mrBar = movingRanges.reduce((a, b) => a + b, 0) / movingRanges.length;
    sigma = mrBar / 1.128; // d2 for subgroup size 2
    sigmaMethod = 'moving_range';
  } else {
    sigma = 0;
    sigmaMethod = 'sample_stddev';
  }
  // Degenerate series (all identical / single point): fall back to sample stddev.
  if (!(sigma > 0)) {
    const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (n > 1 ? n - 1 : 1);
    sigma = Math.sqrt(variance);
    sigmaMethod = 'sample_stddev';
  }

  const ucl = mean + 3 * sigma;
  const lcl = mean - 3 * sigma;
  const usl = spec.usl ?? null;
  const lsl = spec.lsl ?? null;

  let cp: number | null = null;
  let cpk: number | null = null;
  if (usl !== null && lsl !== null && sigma > 0) {
    cp = (usl - lsl) / (6 * sigma);
    cpk = Math.min(usl - mean, mean - lsl) / (3 * sigma);
  } else if (sigma > 0 && (usl !== null || lsl !== null)) {
    cpk = usl !== null ? (usl - mean) / (3 * sigma) : (mean - (lsl as number)) / (3 * sigma);
  }

  const points = values.map((v, i) => ({
    index: i + 1,
    value: r4(v),
    date: inputs[i]?.date ?? null,
    movingRange: i > 0 ? r4(Math.abs(v - values[i - 1])) : null,
    outOfControl: sigma > 0 && (v > ucl || v < lcl),
    outOfSpec: (usl !== null && v > usl) || (lsl !== null && v < lsl),
  }));

  const violations = sigma > 0 ? westernElectric(values, mean, sigma) : [];

  return {
    count: n,
    mean: r4(mean),
    sigma: r4(sigma),
    sigmaMethod,
    ucl: r4(ucl),
    lcl: r4(lcl),
    usl,
    lsl,
    cp: cp !== null ? Number(cp.toFixed(3)) : null,
    cpk: cpk !== null ? Number(cpk.toFixed(3)) : null,
    inControl: violations.length === 0,
    points,
    violations,
  };
}

/** Western Electric rules 1–4 on an individuals series. */
export function westernElectric(values: number[], mean: number, sigma: number): SpcViolation[] {
  const out: SpcViolation[] = [];
  const z = values.map((v) => (v - mean) / sigma);

  // Rule 1: any point beyond 3σ.
  z.forEach((s, i) => {
    if (Math.abs(s) > 3) out.push({ index: i + 1, rule: 'beyond_3sigma', value: r4(values[i]) });
  });

  // Rule 2: 2 of 3 consecutive beyond 2σ on the SAME side.
  for (let i = 2; i < z.length + 0; i++) {
    const win = [z[i - 2], z[i - 1], z[i]];
    if (win.filter((s) => s > 2).length >= 2 || win.filter((s) => s < -2).length >= 2) {
      out.push({ index: i + 1, rule: '2_of_3_beyond_2sigma' });
    }
  }

  // Rule 3: 4 of 5 consecutive beyond 1σ on the SAME side.
  for (let i = 4; i < z.length; i++) {
    const win = z.slice(i - 4, i + 1);
    if (win.filter((s) => s > 1).length >= 4 || win.filter((s) => s < -1).length >= 4) {
      out.push({ index: i + 1, rule: '4_of_5_beyond_1sigma' });
    }
  }

  // Rule 4: 8 consecutive points on one side of the centre line.
  let run = 0;
  let side = 0;
  z.forEach((s, i) => {
    const cur = s >= 0 ? 1 : -1;
    if (cur === side) run++;
    else { side = cur; run = 1; }
    if (run >= 8) out.push({ index: i + 1, rule: 'run_of_8_one_side' });
  });

  return out;
}

/** Most common (min,max) tolerance pair in a series → the chart's spec limits. */
export function consensusSpec(
  rows: Array<{ toleranceMin?: number | string | null; toleranceMax?: number | string | null }>,
): { usl: number | null; lsl: number | null } {
  const counts = new Map<string, { lsl: number | null; usl: number | null; n: number }>();
  for (const r of rows) {
    const lsl = r.toleranceMin != null && r.toleranceMin !== '' ? Number(r.toleranceMin) : null;
    const usl = r.toleranceMax != null && r.toleranceMax !== '' ? Number(r.toleranceMax) : null;
    if (lsl === null && usl === null) continue;
    const key = `${lsl}|${usl}`;
    const cur = counts.get(key) ?? { lsl, usl, n: 0 };
    cur.n++;
    counts.set(key, cur);
  }
  let best: { lsl: number | null; usl: number | null; n: number } | null = null;
  for (const c of counts.values()) if (!best || c.n > best.n) best = c;
  return { usl: best?.usl ?? null, lsl: best?.lsl ?? null };
}
