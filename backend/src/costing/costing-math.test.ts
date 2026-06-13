/**
 * Unit tests for the pure costing math.
 * Run directly (no Nest/TypeORM needed):
 *   node --experimental-strip-types src/costing/costing-math.test.ts
 */
import assert from 'node:assert/strict';
import {
  normalizeSettings,
  DEFAULT_COSTING_SETTINGS,
  resolveRate,
  paidSeconds,
  laborCost,
  overheadCost,
  laborEstimate,
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
