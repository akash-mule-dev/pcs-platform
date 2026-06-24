/**
 * Unit tests for the pure station-utilization math.
 * Run directly (no Nest/TypeORM needed):
 *   node --experimental-strip-types src/stations/station-utilization-math.test.ts
 */
import assert from 'node:assert/strict';
import {
  round2,
  round1,
  secondsToHours,
  runSeconds,
  availableHours,
  utilizationPct,
  windowDaysInclusive,
  composeStationUtilization,
  withoutCost,
  type StationActivityInput,
} from './station-utilization-math.ts';

let passed = 0;
function ok(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

console.log('station-utilization-math');

const H = 3600;
const base: StationActivityInput = {
  attendedSeconds: 10 * H,
  setupSeconds: 1 * H,
  reworkSeconds: 1 * H,
  idleSeconds: 30 * 60,
  machineSeconds: 8 * H,
  machineCost: 680,
  entries: 12,
  operators: 3,
};

ok('rounding helpers', () => {
  assert.equal(round2(1.005), 1.01);
  assert.equal(round1(74.96), 75);
  assert.equal(secondsToHours(5400), 1.5);
  assert.equal(secondsToHours(-100), 0);
});

ok('run = attended − setup − rework, clamped', () => {
  assert.equal(runSeconds(10 * H, 1 * H, 1 * H), 8 * H);
  assert.equal(runSeconds(2 * H, 3 * H, 0), 0); // bad flags never go negative
});

ok('availableHours: null without a basis, else hpd × days', () => {
  assert.equal(availableHours(null, 7), null);
  assert.equal(availableHours(0, 7), null);
  assert.equal(availableHours(-5, 7), null);
  assert.equal(availableHours(16, 7), 112);
  assert.equal(availableHours(8, 1), 8);
});

ok('utilizationPct: null without a basis, percentage otherwise, uncapped', () => {
  assert.equal(utilizationPct(10 * H, { availableHoursPerDay: null, windowDays: 7 }), null);
  // 84 attended h ÷ 112 available h = 75%
  assert.equal(utilizationPct(84 * H, { availableHoursPerDay: 16, windowDays: 7 }), 75);
  // over-subscribed: 20 attended h ÷ 8 available h = 250% (not capped)
  assert.equal(utilizationPct(20 * H, { availableHoursPerDay: 8, windowDays: 1 }), 250);
});

ok('windowDaysInclusive: inclusive day span, never < 1', () => {
  assert.equal(windowDaysInclusive(new Date('2026-06-01'), new Date('2026-06-07')), 7);
  assert.equal(windowDaysInclusive(new Date('2026-06-10'), new Date('2026-06-10')), 1);
  // even mid-day timestamps count by calendar date
  assert.equal(windowDaysInclusive(new Date('2026-06-01T23:00:00Z'), new Date('2026-06-02T01:00:00Z')), 2);
  // reversed/degenerate range clamps to 1
  assert.equal(windowDaysInclusive(new Date('2026-06-07'), new Date('2026-06-01')), 1);
});

ok('composeStationUtilization: full shape with a capacity basis', () => {
  const u = composeStationUtilization(base, { availableHoursPerDay: 16, windowDays: 7 });
  assert.equal(u.attendedHours, 10);
  assert.equal(u.setupHours, 1);
  assert.equal(u.reworkHours, 1);
  assert.equal(u.runSeconds, 8 * H);
  assert.equal(u.runHours, 8);
  assert.equal(u.idleHours, 0.5);
  assert.equal(u.machineHours, 8);
  assert.equal(u.machineCost, 680);
  assert.equal(u.entries, 12);
  assert.equal(u.operators, 3);
  assert.equal(u.availableHours, 112);
  // 10 attended ÷ 112 available ≈ 8.9%
  assert.equal(u.utilizationPct, 8.9);
});

ok('composeStationUtilization: no basis ⇒ null utilization, hours still reported', () => {
  const u = composeStationUtilization(base, { availableHoursPerDay: null, windowDays: 7 });
  assert.equal(u.availableHours, null);
  assert.equal(u.utilizationPct, null);
  assert.equal(u.attendedHours, 10); // raw attended still shown
});

ok('withoutCost: strips machine cost/hours for the floor', () => {
  const u = composeStationUtilization(base, { availableHoursPerDay: 16, windowDays: 7 });
  const masked = withoutCost(u);
  assert.equal(masked.machineCost, 0);
  assert.equal(masked.machineHours, 0);
  assert.equal(masked.machineSeconds, 0);
  // non-cost figures untouched
  assert.equal(masked.attendedHours, 10);
  assert.equal(masked.utilizationPct, 8.9);
});

console.log(`\n${passed} assertions passed.`);
