/**
 * Unit tests for the pure quality math/rules module.
 * Run directly (no Nest/TypeORM needed):
 *   node --experimental-strip-types src/quality-data/quality-math.test.ts
 */
import assert from 'node:assert/strict';
import {
  applyAutoFail,
  evaluateTolerance,
  isQualitySeverity,
  isQualityStatus,
  requiresSignoff,
} from './quality-math.ts';

let passed = 0;
function ok(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

console.log('quality-math');

ok('no measurement → in tolerance', () => {
  assert.deepEqual(evaluateTolerance(null, 1, 2), { inTolerance: true, breached: null, deviation: 0 });
  assert.deepEqual(evaluateTolerance(undefined, 1, 2).inTolerance, true);
  assert.deepEqual(evaluateTolerance('' as any, 1, 2).inTolerance, true);
  assert.deepEqual(evaluateTolerance('abc' as any, 1, 2).inTolerance, true);
});

ok('no bounds → in tolerance', () => {
  assert.equal(evaluateTolerance(99, null, null).inTolerance, true);
  assert.equal(evaluateTolerance(99, undefined, undefined).inTolerance, true);
});

ok('inclusive bounds', () => {
  assert.equal(evaluateTolerance(12, 12, 14).inTolerance, true);
  assert.equal(evaluateTolerance(14, 12, 14).inTolerance, true);
  assert.equal(evaluateTolerance(13, 12, 14).inTolerance, true);
});

ok('breaches report side + deviation', () => {
  assert.deepEqual(evaluateTolerance(11.5, 12, 14), { inTolerance: false, breached: 'min', deviation: -0.5 });
  assert.deepEqual(evaluateTolerance(14.25, 12, 14), { inTolerance: false, breached: 'max', deviation: 0.25 });
});

ok('one-sided bounds enforced independently', () => {
  assert.equal(evaluateTolerance(5, 10, null).inTolerance, false);
  assert.equal(evaluateTolerance(15, 10, null).inTolerance, true);
  assert.equal(evaluateTolerance(15, null, 10).inTolerance, false);
  assert.equal(evaluateTolerance(5, null, 10).inTolerance, true);
});

ok('decimal-as-string values (TypeORM decimals) are handled', () => {
  assert.equal(evaluateTolerance('13.5' as any, '12.0' as any, '14.0' as any).inTolerance, true);
  assert.equal(evaluateTolerance('20.0' as any, '12.0' as any, '14.0' as any).breached, 'max');
});

ok('auto-fail overrides pass/warning when out of tolerance', () => {
  assert.equal(applyAutoFail('pass', 20, 12, 14), 'fail');
  assert.equal(applyAutoFail('warning', 1, 12, 14), 'fail');
  assert.equal(applyAutoFail('pass', 13, 12, 14), 'pass');
  assert.equal(applyAutoFail('warning', 13, 12, 14), 'warning');
  assert.equal(applyAutoFail('fail', 13, 12, 14), 'fail');
  assert.equal(applyAutoFail('pass', null, 12, 14), 'pass');
});

ok('only failures require sign-off', () => {
  assert.equal(requiresSignoff('fail'), true);
  assert.equal(requiresSignoff('pass'), false);
  assert.equal(requiresSignoff('warning'), false);
  assert.equal(requiresSignoff(null), false);
});

ok('vocabulary guards', () => {
  assert.ok(isQualityStatus('pass') && isQualityStatus('fail') && isQualityStatus('warning'));
  assert.ok(!isQualityStatus('ok') && !isQualityStatus(1) && !isQualityStatus(null));
  assert.ok(isQualitySeverity('critical') && !isQualitySeverity('urgent'));
});

console.log(`\nquality-math: ${passed} assertions passed`);
