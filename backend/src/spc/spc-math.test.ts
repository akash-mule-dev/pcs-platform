/**
 * Unit tests for the pure SPC (XmR) math.
 * Run directly (no Nest/TypeORM needed):
 *   node --experimental-strip-types src/spc/spc-math.test.ts
 */
import assert from 'node:assert/strict';
import { consensusSpec, westernElectric, xmrChart } from './spc-math.ts';
import type { SpcChart } from './spc-math.ts';

let passed = 0;
function ok(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

console.log('spc-math');

ok('empty series → message, no crash', () => {
  const r = xmrChart([]);
  assert.equal(r.count, 0);
  assert.ok('message' in r);
});

ok('sigma comes from the average moving range (MR-bar / 1.128)', () => {
  // values alternate ±1 around 10 → every moving range = 2 → sigma = 2/1.128
  const vals = [9, 11, 9, 11, 9, 11, 9, 11];
  const r = xmrChart(vals.map((v) => ({ value: v }))) as SpcChart;
  assert.equal(r.sigmaMethod, 'moving_range');
  assert.equal(r.mean, 10);
  assert.equal(r.sigma, Number((2 / 1.128).toFixed(4)));
  assert.equal(r.ucl, Number((10 + 3 * (2 / 1.128)).toFixed(4)));
});

ok('constant series falls back to sample stddev (zero) and stays in control', () => {
  const r = xmrChart([5, 5, 5, 5].map((v) => ({ value: v }))) as SpcChart;
  assert.equal(r.sigma, 0);
  assert.equal(r.sigmaMethod, 'sample_stddev');
  assert.equal(r.violations.length, 0);
});

ok('moving ranges reported per point', () => {
  const r = xmrChart([1, 4, 2].map((v) => ({ value: v }))) as SpcChart;
  assert.equal(r.points[0].movingRange, null);
  assert.equal(r.points[1].movingRange, 3);
  assert.equal(r.points[2].movingRange, 2);
});

ok('rule 1: beyond 3σ flagged + out of control', () => {
  const base = [10, 10.1, 9.9, 10, 10.1, 9.9, 10, 10.05];
  const r = xmrChart([...base, 14].map((v) => ({ value: v }))) as SpcChart;
  assert.ok(r.violations.some((v) => v.rule === 'beyond_3sigma' && v.index === 9));
  assert.ok(r.points[8].outOfControl);
  assert.equal(r.inControl, false);
});

ok('rule 4: run of 8 one side', () => {
  const v = westernElectric([11, 11, 11, 11, 11, 11, 11, 11, 9], 10, 1);
  assert.ok(v.some((x) => x.rule === 'run_of_8_one_side' && x.index === 8));
});

ok('rule 2: 2 of 3 beyond 2σ same side (opposite sides do not trigger)', () => {
  const v = westernElectric([12.5, 12.5, 10], 10, 1);
  assert.ok(v.some((x) => x.rule === '2_of_3_beyond_2sigma'));
  const opposite = westernElectric([12.5, 7.5, 10], 10, 1);
  assert.ok(!opposite.some((x) => x.rule === '2_of_3_beyond_2sigma'));
});

ok('rule 3: 4 of 5 beyond 1σ same side', () => {
  const v = westernElectric([11.5, 11.5, 11.5, 11.5, 10], 10, 1);
  assert.ok(v.some((x) => x.rule === '4_of_5_beyond_1sigma'));
});

ok('Cp/Cpk from two-sided spec; one-sided gives Cpk only', () => {
  const vals = [9, 11, 9, 11, 9, 11, 9, 11];
  const sigma = 2 / 1.128;
  const r = xmrChart(vals.map((v) => ({ value: v })), { lsl: 4, usl: 16 }) as SpcChart;
  assert.equal(r.cp, Number((12 / (6 * sigma)).toFixed(3)));
  assert.equal(r.cpk, Number((6 / (3 * sigma)).toFixed(3)));
  const one = xmrChart(vals.map((v) => ({ value: v })), { usl: 16 }) as SpcChart;
  assert.equal(one.cp, null);
  assert.ok(one.cpk !== null);
});

ok('out-of-spec flags use spec limits, not control limits', () => {
  const r = xmrChart([9, 11, 17].map((v) => ({ value: v })), { usl: 16, lsl: 2 }) as SpcChart;
  assert.ok(r.points[2].outOfSpec);
  assert.ok(!r.points[0].outOfSpec);
});

ok('consensusSpec picks the most common tolerance pair', () => {
  const spec = consensusSpec([
    { toleranceMin: 1, toleranceMax: 5 },
    { toleranceMin: 1, toleranceMax: 5 },
    { toleranceMin: 0, toleranceMax: 9 },
    { toleranceMin: null, toleranceMax: null },
  ]);
  assert.deepEqual(spec, { usl: 5, lsl: 1 });
  assert.deepEqual(consensusSpec([]), { usl: null, lsl: null });
});

console.log(`\nspc-math: ${passed} assertions passed`);
