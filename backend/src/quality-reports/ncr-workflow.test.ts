/**
 * Unit tests for the pure NCR lifecycle rules.
 * Run directly (no Nest/TypeORM needed):
 *   node --experimental-strip-types src/quality-reports/ncr-workflow.test.ts
 */
import assert from 'node:assert/strict';
import {
  canTransition,
  canRecordDisposition,
  requiresReinspection,
  isGateBlocking,
  isNcrDisposition,
  assertCloseable,
  NCR_DISPOSITION_VALUES,
  type NcrStatus,
} from './ncr-workflow.ts';

let passed = 0;
function ok(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

console.log('ncr-workflow');

ok('gate-blocking equals not-closed-and-not-cancelled', () => {
  assert.ok(isGateBlocking('open'));
  assert.ok(isGateBlocking('under_review'));
  assert.ok(isGateBlocking('dispositioned'));
  assert.ok(!isGateBlocking('closed'));
  assert.ok(!isGateBlocking('cancelled'));
});

ok('disposition vocabulary', () => {
  assert.deepEqual(NCR_DISPOSITION_VALUES, ['rework', 'repair', 'use_as_is', 'scrap', 'return_to_supplier']);
  assert.ok(isNcrDisposition('rework'));
  assert.ok(!isNcrDisposition('demolish'));
  assert.ok(!isNcrDisposition(null));
});

ok('only rework + repair need re-inspection', () => {
  assert.ok(requiresReinspection('rework'));
  assert.ok(requiresReinspection('repair'));
  for (const d of ['use_as_is', 'scrap', 'return_to_supplier', null, undefined]) {
    assert.ok(!requiresReinspection(d as any), String(d));
  }
});

ok('state machine transitions', () => {
  assert.ok(canTransition('open', 'dispositioned'));
  assert.ok(canTransition('open', 'under_review'));
  assert.ok(canTransition('open', 'cancelled'));
  assert.ok(canTransition('dispositioned', 'closed'));
  assert.ok(canTransition('dispositioned', 'under_review')); // revise
  assert.ok(canTransition('closed', 'under_review'));        // reopen
  assert.ok(!canTransition('open', 'closed'));               // must disposition first
  assert.ok(!canTransition('closed', 'open'));
  assert.ok(!canTransition('cancelled', 'closed'));
});

ok('disposition editable only while gate-blocking', () => {
  for (const s of ['open', 'under_review', 'dispositioned'] as NcrStatus[]) assert.ok(canRecordDisposition(s));
  for (const s of ['closed', 'cancelled'] as NcrStatus[]) assert.ok(!canRecordDisposition(s));
});

ok('cannot close without a disposition', () => {
  const r = assertCloseable({ status: 'dispositioned', disposition: null, hasPassingReinspection: true });
  assert.ok(!r.ok && /disposition/i.test(r.reason));
});

ok('rework cannot close without a passing re-inspection', () => {
  const blocked = assertCloseable({ status: 'dispositioned', disposition: 'rework', hasPassingReinspection: false });
  assert.ok(!blocked.ok && /re-inspection/i.test(blocked.reason));
  const okClose = assertCloseable({ status: 'dispositioned', disposition: 'rework', hasPassingReinspection: true });
  assert.ok(okClose.ok);
});

ok('scrap / use-as-is close without re-inspection', () => {
  assert.ok(assertCloseable({ status: 'dispositioned', disposition: 'scrap', hasPassingReinspection: false }).ok);
  assert.ok(assertCloseable({ status: 'dispositioned', disposition: 'use_as_is', hasPassingReinspection: false }).ok);
});

ok('already-closed / cancelled cannot be closed again', () => {
  assert.ok(!assertCloseable({ status: 'closed', disposition: 'scrap', hasPassingReinspection: true }).ok);
  assert.ok(!assertCloseable({ status: 'cancelled', disposition: 'scrap', hasPassingReinspection: true }).ok);
});

console.log(`\nncr-workflow: ${passed} checks passed`);
