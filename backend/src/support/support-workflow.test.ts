/**
 * Unit tests for the pure support workflow.
 *   node --experimental-strip-types src/support/support-workflow.test.ts
 */
import assert from 'node:assert/strict';
import {
  canTransition, isActive, isTerminal, isValidStatus, statusAfterCustomerReply, statusAfterSupportReply,
  TICKET_STATUSES, TICKET_PRIORITIES, TICKET_CATEGORIES, STATUS_LABELS,
} from './support-workflow.ts';

let passed = 0;
function ok(name: string, fn: () => void) { fn(); passed++; console.log(`  ✓ ${name}`); }

console.log('support-workflow');

ok('option lists are non-empty and labelled', () => {
  assert.ok(TICKET_STATUSES.length === 5 && TICKET_PRIORITIES.length === 4 && TICKET_CATEGORIES.length === 5);
  for (const s of TICKET_STATUSES) assert.ok(STATUS_LABELS[s], `label for ${s}`);
});

ok('active vs terminal classification', () => {
  assert.ok(isActive('open') && isActive('in_progress') && isActive('pending'));
  assert.ok(!isActive('resolved') && !isActive('closed'));
  assert.ok(isTerminal('resolved') && isTerminal('closed'));
});

ok('valid support transitions', () => {
  assert.ok(canTransition('open', 'in_progress'));
  assert.ok(canTransition('open', 'resolved'));
  assert.ok(canTransition('in_progress', 'pending'));
  assert.ok(canTransition('resolved', 'closed'));
  assert.ok(canTransition('closed', 'open')); // reopen
  assert.ok(canTransition('open', 'open')); // no-op allowed
});

ok('invalid transitions rejected', () => {
  assert.ok(!canTransition('closed', 'resolved'));
  assert.ok(!canTransition('closed', 'pending'));
  assert.ok(!canTransition('resolved', 'pending'));
});

ok('customer reply reopens pending/resolved/closed, else no change', () => {
  assert.equal(statusAfterCustomerReply('pending'), 'open');
  assert.equal(statusAfterCustomerReply('resolved'), 'open');
  assert.equal(statusAfterCustomerReply('closed'), 'open');
  assert.equal(statusAfterCustomerReply('open'), 'open');
  assert.equal(statusAfterCustomerReply('in_progress'), 'in_progress');
});

ok('support reply advances a brand-new ticket but never reopens', () => {
  assert.equal(statusAfterSupportReply('open'), 'in_progress');
  assert.equal(statusAfterSupportReply('pending'), 'pending');
  assert.equal(statusAfterSupportReply('resolved'), 'resolved');
  assert.equal(statusAfterSupportReply('closed'), 'closed');
});

ok('status validation guard', () => {
  assert.ok(isValidStatus('open'));
  assert.ok(!isValidStatus('frozen'));
});

console.log(`${passed} assertion groups passed`);
