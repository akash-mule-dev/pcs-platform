/**
 * Unit tests for the pure NCR/CAPA workflow rules.
 * Run directly (no Nest/TypeORM needed):
 *   node --experimental-strip-types src/quality-ncr/ncr-workflow.test.ts
 */
import assert from 'node:assert/strict';
import {
  canTransitionCapa,
  canTransitionNcr,
  capaNextStatuses,
  capaTransitionError,
  isOpenNcr,
  ncrNextStatuses,
  ncrTransitionError,
  severityToPriority,
} from './ncr-workflow.ts';

let passed = 0;
function ok(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

console.log('ncr-workflow');

ok('happy path: open → investigation → disposition → closed', () => {
  assert.ok(canTransitionNcr('open', 'investigation'));
  assert.ok(canTransitionNcr('investigation', 'disposition'));
  assert.ok(canTransitionNcr('disposition', 'closed'));
});

ok('shortcut: open → disposition allowed (trivial NCRs)', () => {
  assert.ok(canTransitionNcr('open', 'disposition'));
});

ok('illegal jumps rejected', () => {
  assert.ok(!canTransitionNcr('open', 'closed'));
  assert.ok(!canTransitionNcr('investigation', 'closed'));
  assert.ok(!canTransitionNcr('investigation', 'open'));
  assert.ok(!canTransitionNcr('closed', 'closed'));
  assert.ok(!canTransitionNcr('open', 'open'));
});

ok('cancel allowed while open/investigating, not after disposition', () => {
  assert.ok(canTransitionNcr('open', 'cancelled'));
  assert.ok(canTransitionNcr('investigation', 'cancelled'));
  assert.ok(!canTransitionNcr('disposition', 'cancelled'));
  assert.ok(!canTransitionNcr('closed', 'cancelled'));
});

ok('cancelled is terminal; closed can only reopen to investigation', () => {
  assert.deepEqual(ncrNextStatuses('cancelled'), []);
  assert.deepEqual(ncrNextStatuses('closed'), ['investigation']);
});

ok('closing requires a disposition', () => {
  assert.equal(ncrTransitionError('disposition', 'closed', null)?.includes('disposition'), true);
  assert.equal(ncrTransitionError('disposition', 'closed', 'rework'), null);
});

ok('transition errors are descriptive; same-status is a no-op', () => {
  assert.match(ncrTransitionError('open', 'closed', 'rework')!, /allowed: investigation, disposition, cancelled/);
  assert.match(ncrTransitionError('cancelled', 'open', null)!, /terminal/);
  assert.equal(ncrTransitionError('open', 'open', null), null);
});

ok('unknown statuses yield no legal transitions', () => {
  assert.deepEqual(ncrNextStatuses('bogus'), []);
  assert.ok(!canTransitionNcr('bogus', 'closed'));
});

ok('CAPA: verify-before-close is enforced', () => {
  assert.ok(canTransitionCapa('open', 'in_progress'));
  assert.ok(canTransitionCapa('in_progress', 'verified'));
  assert.ok(canTransitionCapa('verified', 'closed'));
  assert.ok(!canTransitionCapa('open', 'closed'));
  assert.ok(!canTransitionCapa('in_progress', 'closed'));
  assert.match(capaTransitionError('in_progress', 'closed')!, /verified before it can be closed/);
  assert.equal(capaTransitionError('verified', 'closed'), null);
});

ok('CAPA: verification can be walked back, closed is terminal', () => {
  assert.ok(canTransitionCapa('verified', 'in_progress'));
  assert.deepEqual(capaNextStatuses('closed'), []);
});

ok('open-NCR gate statuses', () => {
  assert.ok(isOpenNcr('open') && isOpenNcr('investigation') && isOpenNcr('disposition'));
  assert.ok(!isOpenNcr('closed') && !isOpenNcr('cancelled'));
});

ok('severity → notification priority', () => {
  assert.equal(severityToPriority('critical'), 'critical');
  assert.equal(severityToPriority('high'), 'high');
  assert.equal(severityToPriority('medium'), 'medium');
  assert.equal(severityToPriority('low'), 'low');
  assert.equal(severityToPriority(null), 'medium');
});

console.log(`\nncr-workflow: ${passed} assertions passed`);
