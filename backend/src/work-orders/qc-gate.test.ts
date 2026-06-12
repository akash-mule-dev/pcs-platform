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
  isOpenNcrStatus,
  isQualityStageName,
  qcGateMessage,
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

ok('open NCR statuses', () => {
  assert.ok(isOpenNcrStatus('open') && isOpenNcrStatus('investigation') && isOpenNcrStatus('disposition'));
  assert.ok(!isOpenNcrStatus('closed') && !isOpenNcrStatus('cancelled'));
});

ok('NCR gate message pluralizes', () => {
  assert.match(qcGateMessage('B1001', 1), /1 open NCR\./);
  assert.match(qcGateMessage('B1001', 2), /2 open NCRs\./);
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

console.log(`\nqc-gate: ${passed} assertions passed`);
