/**
 * Unit tests for the pure costing math.
 * Run directly (no Nest/TypeORM needed):
 *   node --experimental-strip-types src/costing/costing-math.test.ts
 */
import assert from 'node:assert/strict';
import {
  normalizeSettings,
  DEFAULT_COSTING_SETTINGS,
  round2,
  resolveRate,
  resolveEntryRate,
  paidSeconds,
  laborCost,
  splitLabor,
  overheadCost,
  laborEstimate,
  machineEstimate,
  allocateProportionally,
  variance,
  composeTotals,
} from './costing-math.ts';

let passed = 0;
function ok(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

console.log('costing-math');

ok('settings: defaults when nothing stored', () => {
  assert.deepEqual(normalizeSettings(undefined), DEFAULT_COSTING_SETTINGS);
});

ok('settings: legacy org laborHourlyRate honored as fallback default rate', () => {
  assert.equal(normalizeSettings(undefined, 45).defaultLaborRate, 45);
  assert.equal(normalizeSettings({ defaultLaborRate: 50 }, 45).defaultLaborRate, 50); // explicit wins
});

ok('settings: sanitizes garbage', () => {
  const s = normalizeSettings({ defaultLaborRate: -3, overheadPercent: 9999, currency: 'dollars' });
  assert.equal(s.defaultLaborRate, DEFAULT_COSTING_SETTINGS.defaultLaborRate);
  assert.equal(s.overheadPercent, 500); // capped
  assert.equal(s.currency, 'USD');
  assert.equal(normalizeSettings({ currency: 'inr' }).currency, 'INR');
});

ok('rate resolution: worker → stage → default', () => {
  assert.equal(resolveRate(42, 35, 30), 42);
  assert.equal(resolveRate(null, 35, 30), 35);
  assert.equal(resolveRate(0, 0, 30), 30); // zero = not set
  assert.equal(resolveRate(undefined, undefined, 30), 30);
});

ok('paid seconds subtract breaks and never go negative', () => {
  assert.equal(paidSeconds({ durationSeconds: 3600, breakSeconds: 600 }), 3000);
  assert.equal(paidSeconds({ durationSeconds: 500, breakSeconds: 900 }), 0);
  assert.equal(paidSeconds({ durationSeconds: null, breakSeconds: 0 }), 0); // open entry
});

ok('labor cost resolves the rate per entry', () => {
  const l = laborCost(
    [
      { durationSeconds: 3600, breakSeconds: 0, workerRate: 40, stageRate: null }, // 1h @ 40
      { durationSeconds: 7200, breakSeconds: 3600, workerRate: null, stageRate: 60 }, // 1h paid @ 60
      { durationSeconds: 1800, breakSeconds: 0, workerRate: null, stageRate: null }, // 0.5h @ default 30
    ],
    30,
  );
  assert.equal(l.seconds, 3600 + 3600 + 1800);
  assert.equal(l.hours, 2.5);
  assert.equal(l.cost, 40 + 60 + 15);
});

ok('entry rate: stamped (frozen) rate wins, else falls through the live chain', () => {
  assert.equal(resolveEntryRate({ stampedRate: 55, workerRate: 90, stageRate: 70 }, 30), 55); // frozen wins
  assert.equal(resolveEntryRate({ stampedRate: 0, workerRate: 90, stageRate: 70 }, 30), 90);  // 0 = not stamped
  assert.equal(resolveEntryRate({ stampedRate: null, workerRate: null, stageRate: 70 }, 30), 70);
  assert.equal(resolveEntryRate({ stampedRate: null, workerRate: null, stageRate: null }, 30), 30);
});

ok('labor cost prefers the stamped rate so rate changes never rewrite history', () => {
  const l = laborCost(
    [{ durationSeconds: 3600, breakSeconds: 0, stampedRate: 55, workerRate: 90, stageRate: 70 }],
    30,
  );
  assert.equal(l.cost, 55); // 1h × frozen 55, not the now-current 90
});

ok('split labor: setup / rework / productive partition + idle overlay', () => {
  const s = splitLabor(
    [
      { durationSeconds: 3600, breakSeconds: 0, stampedRate: 40 },                       // 1h productive @40
      { durationSeconds: 1800, breakSeconds: 0, stampedRate: 40, isSetup: true },        // 0.5h setup @40
      { durationSeconds: 3600, breakSeconds: 0, stampedRate: 60, isRework: true, idleSeconds: 600 }, // 1h rework @60, 10min idle
      { durationSeconds: 3600, breakSeconds: 0, stampedRate: 60, isSetup: true, isRework: true },    // rework wins over setup
    ],
    30,
  );
  assert.equal(s.productive.seconds, 3600);
  assert.equal(s.productive.cost, 40);
  assert.equal(s.setup.seconds, 1800);
  assert.equal(s.setup.cost, 20);
  assert.equal(s.rework.seconds, 3600 + 3600); // both rework entries
  assert.equal(s.rework.cost, 60 + 60);
  assert.equal(s.idle.seconds, 600);
  assert.equal(s.idle.cost, 10); // 600s/3600 × 60
});

ok('overhead is a percentage on labor', () => {
  assert.equal(overheadCost(200, 15), 30);
  assert.equal(overheadCost(200, 0), 0);
  assert.equal(overheadCost(0, 50), 0);
});

ok('labor estimate: target time × planned units at stage/default rate, skipped excluded', () => {
  const e = laborEstimate(
    [
      { targetTimeSeconds: 1800, qtyTotal: 4, stageRate: null },    // 2h @ 30 = 60
      { targetTimeSeconds: 3600, qtyTotal: 2, stageRate: 45 },      // 2h @ 45 = 90
      { targetTimeSeconds: 7200, qtyTotal: 10, skipped: true },     // skipped
    ],
    30,
  );
  assert.equal(e.seconds, 1800 * 4 + 3600 * 2);
  assert.equal(e.cost, 150);
});

ok('machine estimate: machine time × units × stage machine rate, no-rate/skipped excluded', () => {
  const m = machineEstimate([
    { machineTimeSeconds: 600, qtyTotal: 6, machineRate: 120 },   // 1h @ 120 = 120
    { machineTimeSeconds: 1800, qtyTotal: 4, machineRate: null }, // no machine rate → excluded
    { machineTimeSeconds: 3600, qtyTotal: 2, machineRate: 90, skipped: true }, // skipped
  ]);
  assert.equal(m.seconds, 600 * 6);
  assert.equal(m.cost, 120);
});

ok('composed totals add machine: material + labor + machine + overhead(labor)', () => {
  const t = composeTotals(1000, 400, 25, 300);
  assert.equal(t.materialCost, 1000);
  assert.equal(t.laborCost, 400);
  assert.equal(t.machineCost, 300);
  assert.equal(t.overheadCost, 100); // 25% on labor only
  assert.equal(t.totalCost, 1800);
  assert.equal(composeTotals(1000, 400, 25).machineCost, 0); // machine defaults to 0
});

ok('composed totals accept an explicit (per-stage) overhead amount over the flat %', () => {
  // Per-stage overhead of 90 overrides the flat 25% (which would be 100).
  const t = composeTotals(1000, 400, 25, 300, 90);
  assert.equal(t.overheadCost, 90);
  assert.equal(t.totalCost, 1000 + 400 + 300 + 90);
  // Explicit 0 overhead is honored (not treated as "unset").
  assert.equal(composeTotals(0, 400, 25, 0, 0).overheadCost, 0);
});

ok('allocate proportionally: splits by basis and sums EXACTLY to the amount', () => {
  const a = allocateProportionally(100, [3, 1]); // 75 / 25
  assert.deepEqual(a, [75, 25]);
  // Penny-perfect under awkward thirds: 10.00 across equal thirds → 3.34/3.33/3.33
  const b = allocateProportionally(10, [1, 1, 1]);
  assert.equal(round2(b.reduce((s, v) => s + v, 0)), 10);
  assert.deepEqual(b, [3.34, 3.33, 3.33]);
  // Zero / no-basis cases
  assert.deepEqual(allocateProportionally(50, [0, 0]), [0, 0]); // caller falls back
  assert.deepEqual(allocateProportionally(0, [1, 2]), [0, 0]);
  assert.deepEqual(allocateProportionally(100, []), []);
});

ok('variance against an estimate', () => {
  assert.deepEqual(variance(120, 100), { amount: 20, percent: 20 });
  assert.deepEqual(variance(80, 100), { amount: -20, percent: -20 });
  assert.deepEqual(variance(50, 0), { amount: 50, percent: null }); // no estimate → no %
});

ok('composed totals = material + labor + overhead(labor)', () => {
  const t = composeTotals(1000, 400, 25);
  assert.equal(t.materialCost, 1000);
  assert.equal(t.laborCost, 400);
  assert.equal(t.overheadCost, 100);
  assert.equal(t.totalCost, 1500);
});

ok('composed totals tolerate zero/garbage', () => {
  const t = composeTotals(0, 0, 0);
  assert.equal(t.totalCost, 0);
});

console.log(`\ncosting-math: ${passed} assertions passed`);
