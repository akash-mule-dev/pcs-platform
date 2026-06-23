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
  isFinalQcStage,
  qcGateMessage,
  finalQcNcrMessage,
  holdPointNcrMessage,
  stageQcGateError,
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

// ── Final-QC flag detection (prefers the explicit flag, falls back to name) ──

ok('isFinalQcStage: explicit flag wins, null falls back to name heuristic', () => {
  assert.equal(isFinalQcStage({ isFinalQc: true, name: 'Anything' }), true);   // explicit true
  assert.equal(isFinalQcStage({ isFinalQc: false, name: 'Quality Check' }), false); // explicit false suppresses the name match
  assert.equal(isFinalQcStage({ name: 'Quality Check' }), true);               // legacy: null flag + quality name
  assert.equal(isFinalQcStage({ name: 'Welding' }), false);                    // null flag + non-quality name
  assert.equal(isFinalQcStage({ isFinalQc: true, name: 'Final Sign-off' }), true); // renamed gate still recognised
});

ok('gate messages: final-QC vs hold-point wording', () => {
  assert.match(finalQcNcrMessage('B1001', 2), /Final QC: B1001 has 2 open NCR reports across its stages/);
  assert.match(holdPointNcrMessage('B1001', 1, 'Welding'), /Quality hold: B1001 has 1 open NCR report at the "Welding" stage/);
});

// ── Unified stage gate: final-QC rollup vs per-stage hold vs advisory ──

const noScope = { assemblyOpenNcrs: 0, assemblyInspections: [], stageOpenNcrs: 0, stageInspections: [] };

ok('stageQcGateError: plain / witness / review stages never block', () => {
  assert.equal(stageQcGateError({ itemLabel: 'B1', stage: { name: 'Welding' }, ...noScope, assemblyOpenNcrs: 5, stageOpenNcrs: 5 }), null);
  assert.equal(stageQcGateError({ itemLabel: 'B1', stage: { name: 'Inspect', inspectionType: 'witness' }, ...noScope, stageOpenNcrs: 5 }), null);
});

ok('stageQcGateError: FINAL QC consolidates the whole assembly (any open NCR blocks)', () => {
  const blocked = stageQcGateError({ itemLabel: 'B1', stage: { name: 'Final QC', isFinalQc: true, inspectionType: 'hold' }, ...noScope, assemblyOpenNcrs: 3 });
  assert.match(blocked!, /Final QC: B1 has 3 open NCR reports/);
  // No NCRs but a hold-type final QC requires an acceptable inspection on the assembly.
  assert.match(stageQcGateError({ itemLabel: 'B1', stage: { name: 'Final QC', isFinalQc: true, inspectionType: 'hold' }, ...noScope })!, /requires a recorded inspection/);
  assert.equal(stageQcGateError({ itemLabel: 'B1', stage: { name: 'Final QC', isFinalQc: true, inspectionType: 'hold' }, ...noScope, assemblyInspections: [{ status: 'pass' }] }), null);
});

ok('stageQcGateError: a final-QC stage ignores per-stage NCRs (rollup uses assembly scope)', () => {
  // stageOpenNcrs is the hold scope — a final-QC stage must NOT read it; only the assembly rollup.
  assert.equal(stageQcGateError({ itemLabel: 'B1', stage: { name: 'Final QC', isFinalQc: true }, ...noScope, stageOpenNcrs: 9, assemblyInspections: [{ status: 'pass' }] }), null);
});

ok('stageQcGateError: a HOLD point blocks only on ITS OWN stage NCRs', () => {
  const blocked = stageQcGateError({ itemLabel: 'B1', stage: { name: 'Welding', inspectionType: 'hold' }, ...noScope, stageOpenNcrs: 1, assemblyOpenNcrs: 0 });
  assert.match(blocked!, /Quality hold: B1 has 1 open NCR report at the "Welding" stage/);
  // An NCR elsewhere on the assembly (assemblyOpenNcrs) does NOT block a non-final hold stage that needs an inspection.
  assert.match(stageQcGateError({ itemLabel: 'B1', stage: { name: 'Welding', inspectionType: 'hold' }, ...noScope, assemblyOpenNcrs: 4 })!, /requires a recorded inspection/);
  assert.equal(stageQcGateError({ itemLabel: 'B1', stage: { name: 'Welding', inspectionType: 'hold' }, ...noScope, stageInspections: [{ status: 'pass' }] }), null);
});

console.log(`\nqc-gate: ${passed} assertions passed`);
