/**
 * Unit tests for the pure quality-gate helpers.
 * Run directly (no Nest/TypeORM needed):
 *   node --experimental-strip-types src/work-orders/qc-gate.test.ts
 */
import assert from 'node:assert/strict';
import {
  countUnresolvedFailures,
  hasAcceptableInspection,
  inspectionGateError,
  isQualityStageName,
  qcGateMessage,
  isHoldPoint,
} from './qc-gate.ts';

let passed = 0;
function ok(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

console.log('qc-gate');

ok('quality stage name detection', () => {
  for (const n of ['Quality Check', 'Final Inspection', 'QC', 'qa review', 'Inspect welds']) {
    assert.ok(isQualityStageName(n), n);
  }
  for (const n of ['Fit-up', 'Welding', 'Paint', null, undefined, '']) {
    assert.ok(!isQualityStageName(n as any), String(n));
  }
});

ok('NCR gate message pluralizes', () => {
  assert.match(qcGateMessage('B1001', 1), /1 open NCR report\./);
  assert.match(qcGateMessage('B1001', 2), /2 open NCR reports\./);
});

ok('unresolved failures: pending + rejected count, approved does not', () => {
  assert.equal(countUnresolvedFailures([
    { status: 'fail', signoffStatus: 'pending' },
    { status: 'fail', signoffStatus: 'rejected' },
    { status: 'fail', signoffStatus: 'approved' },
    { status: 'pass' },
  ]), 2);
  assert.equal(countUnresolvedFailures([]), 0);
});

ok('acceptable inspection: pass, warning, or approved concession', () => {
  assert.ok(hasAcceptableInspection([{ status: 'pass' }]));
  assert.ok(hasAcceptableInspection([{ status: 'warning' }]));
  assert.ok(hasAcceptableInspection([{ status: 'fail', signoffStatus: 'approved' }]));
  assert.ok(!hasAcceptableInspection([{ status: 'fail', signoffStatus: 'pending' }]));
  assert.ok(!hasAcceptableInspection([]));
});

ok('gate: unresolved failure always blocks', () => {
  const err = inspectionGateError('B1001', [{ status: 'fail', signoffStatus: 'pending' }], false);
  assert.match(err!, /awaiting sign-off/);
});

ok('gate: requiresInspection blocks empty history, passes with one pass', () => {
  assert.match(inspectionGateError('B1001', [], true)!, /requires a recorded inspection/);
  assert.equal(inspectionGateError('B1001', [{ status: 'pass' }], true), null);
  assert.equal(inspectionGateError('B1001', [], false), null);
});

ok('gate: approved concession satisfies requiresInspection', () => {
  assert.equal(inspectionGateError('B1001', [{ status: 'fail', signoffStatus: 'approved' }], true), null);
});

ok('gate: resolved failure + no other inspection still satisfies always-on rule', () => {
  assert.equal(inspectionGateError('B1001', [{ status: 'fail', signoffStatus: 'approved' }], false), null);
});

ok('ITP: hold blocks, witness/review advisory, legacy flag honoured', () => {
  assert.equal(isHoldPoint({ inspectionType: 'hold' }), true);
  assert.equal(isHoldPoint({ inspectionType: 'witness' }), false);
  assert.equal(isHoldPoint({ inspectionType: 'review' }), false);
  assert.equal(isHoldPoint({ requiresInspection: true }), true); // legacy
  assert.equal(isHoldPoint({ inspectionType: 'witness', requiresInspection: true }), false); // type wins
  assert.equal(isHoldPoint({}), false);
});

ok('ITP: a witness point does not block on inspection presence, but an unsigned fail still blocks', () => {
  assert.equal(inspectionGateError('B1', [], false), null); // witness/none + nothing recorded → OK
  assert.notEqual(inspectionGateError('B1', [{ status: 'fail', signoffStatus: 'pending' }], false), null);
});

console.log(`\nqc-gate: ${passed} assertions passed`);
