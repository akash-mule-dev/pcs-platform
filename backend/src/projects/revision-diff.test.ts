/**
 * Unit tests for the pure revision-diff module.
 *   node --experimental-strip-types src/projects/revision-diff.test.ts
 */
import { computeRevisionDiff, nodeDeltas, revisionSummaryMessage } from './revision-diff.ts';
import type { DiffIncomingNode, DiffExistingNode } from './revision-diff.ts';

let n = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) { console.error(`FAIL: ${msg}`); process.exit(1); }
  console.log(`ok ${++n} - ${msg}`);
}

const inc = (over: Partial<DiffIncomingNode> = {}): DiffIncomingNode => ({
  externalId: 'G1', type: 'part', name: 'Beam', mark: 'B-1', quantity: 1,
  profile: 'HEA200', materialGrade: 'S355', lengthMm: 6000, weightKg: 254.4, ...over,
});
const ex = (over: Partial<DiffExistingNode> = {}): DiffExistingNode => ({
  ifcGuid: 'G1', nodeType: 'part', name: 'Beam', mark: 'B-1', quantity: 1,
  profile: 'HEA200', materialGrade: 'S355', lengthMm: 6000, weightKg: 254.4, ...over,
});

// ── nodeDeltas ──
assert(nodeDeltas(ex(), inc()).length === 0, 'identical nodes produce no deltas');
assert(nodeDeltas(ex(), inc({ profile: 'HEA220' })).some((d) => d.field === 'profile'), 'profile change detected');
assert(nodeDeltas(ex(), inc({ lengthMm: 6000.3 })).length === 0, 'length within 0.5mm tolerance ignored (float noise)');
assert(nodeDeltas(ex(), inc({ lengthMm: 6010 })).some((d) => d.field === 'lengthMm'), 'real length change detected');
assert(nodeDeltas(ex(), inc({ weightKg: 254.42 })).length === 0, 'weight within tolerance ignored');
assert(nodeDeltas(ex({ mark: null }), inc({ mark: 'B-2' })).some((d) => d.field === 'mark'), 'mark set from null detected');
assert(nodeDeltas(ex(), inc({ quantity: 2 })).some((d) => d.field === 'quantity'), 'quantity change detected');

// ── computeRevisionDiff: initial import ──
const initial = computeRevisionDiff([inc(), inc({ externalId: 'G2', mark: 'B-2' })], []);
assert(initial.initial === true, 'empty tree marks the diff as initial');
assert(initial.counts.added === 2 && initial.counts.changed === 0 && initial.counts.missing === 0, 'initial import counts all nodes as added');
assert(revisionSummaryMessage(initial).startsWith('Initial import'), 'initial summary message');

// ── revision with add/change/missing/unchanged ──
const existing = [ex(), ex({ ifcGuid: 'G2', mark: 'B-2' }), ex({ ifcGuid: 'G3', mark: 'B-3' })];
const incoming = [
  inc(),                                              // unchanged
  inc({ externalId: 'G2', mark: 'B-2', profile: 'HEA240', weightKg: 300 }), // changed
  inc({ externalId: 'G4', mark: 'B-4' }),             // added
];
const diff = computeRevisionDiff(incoming, existing);
assert(diff.initial === false, 'non-empty tree is not initial');
assert(diff.counts.unchanged === 1, 'unchanged counted');
assert(diff.counts.added === 1 && diff.added[0].guid === 'G4', 'added piece identified');
assert(diff.counts.changed === 1 && diff.changed[0].guid === 'G2', 'changed piece identified');
assert(diff.changed[0].deltas!.length === 2, 'changed piece carries field deltas (profile + weight)');
assert(diff.counts.missing === 1 && diff.missing[0].guid === 'G3', 'piece absent from the file reported as missing');
assert(/\+1 new, ~1 changed/.test(revisionSummaryMessage(diff)), 'summary message reflects counts');

// ── identical re-import ──
const same = computeRevisionDiff([inc(), inc({ externalId: 'G2', mark: 'B-2' })], [ex(), ex({ ifcGuid: 'G2', mark: 'B-2' })]);
assert(same.counts.added === 0 && same.counts.changed === 0 && same.counts.missing === 0 && same.counts.unchanged === 2,
  'identical re-import: everything unchanged');
assert(/no design changes/.test(revisionSummaryMessage(same)), 'no-change summary message');

// ── cap keeps stored payload bounded but counts exact ──
const many: DiffIncomingNode[] = Array.from({ length: 700 }, (_, i) => inc({ externalId: `N${i}`, mark: `M${i}` }));
const capped = computeRevisionDiff(many, [], 500);
assert(capped.counts.added === 700 && capped.added.length === 500 && capped.capped === true,
  'entry lists capped at 500 while counts stay exact');

console.log(`\n${n} assertions passed - revision-diff`);
