/**
 * Unit tests for the pure BOM / material-requirements math.
 * Run directly (no Nest/TypeORM needed):
 *   node --experimental-strip-types src/projects/material-requirements-math.test.ts
 */
import assert from 'node:assert/strict';
import {
  aggregateRequirements,
  scaleRequirements,
  requirementKey,
  normalizeKeyPart,
  requiredQtyInUom,
  coverage,
} from './material-requirements-math.ts';

let passed = 0;
function ok(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

console.log('material-requirements-math');

ok('key normalization: trim, collapse spaces, case-fold', () => {
  assert.equal(normalizeKeyPart('  UC203x203x46 '), 'UC203X203X46');
  assert.equal(requirementKey('uc203x203x46', ' s355 '), 'UC203X203X46|S355');
  assert.equal(requirementKey(null, undefined), '|');
});

ok('aggregation groups parts by (profile, grade) and multiplies by node quantity', () => {
  const lines = aggregateRequirements([
    { profile: 'UC203x203x46', materialGrade: 'S355', lengthMm: 6000, weightKg: 276, quantity: 2 },
    { profile: 'uc203X203x46', materialGrade: ' s355', lengthMm: 4000, weightKg: 184, quantity: 1 },
    { profile: 'PL10', materialGrade: 'S275', lengthMm: 500, weightKg: 39.25, quantity: 4 },
  ]);
  assert.equal(lines.length, 2);
  const uc = lines.find((l) => l.key === 'UC203X203X46|S355')!;
  assert.equal(uc.pieceCount, 3);
  assert.equal(uc.totalLengthMm, 16000); // 6000×2 + 4000×1
  assert.equal(uc.totalWeightKg, 736);   // 276×2 + 184×1
  const pl = lines.find((l) => l.key === 'PL10|S275')!;
  assert.equal(pl.pieceCount, 4);
  assert.equal(pl.totalWeightKg, 157);
});

ok('aggregation sorts heaviest first and keeps unspecified parts', () => {
  const lines = aggregateRequirements([
    { profile: null, materialGrade: null, lengthMm: null, weightKg: 5, quantity: 1 },
    { profile: 'HEA200', materialGrade: 'S355', lengthMm: 1000, weightKg: 1000, quantity: 1 },
  ]);
  assert.equal(lines[0].key, 'HEA200|S355');
  assert.equal(lines[1].key, '|'); // unspecified bucket survives — tonnage is never dropped
});

ok('parts with zero/negative quantity are ignored', () => {
  assert.equal(aggregateRequirements([{ profile: 'X', materialGrade: 'Y', lengthMm: 1, weightKg: 1, quantity: 0 }]).length, 0);
});

ok('scaling multiplies counts, lengths and weights by the order quantity', () => {
  const [line] = scaleRequirements(
    aggregateRequirements([{ profile: 'IPE300', materialGrade: 'S355', lengthMm: 12000, weightKg: 507.6, quantity: 1 }]),
    3,
  );
  assert.equal(line.pieceCount, 3);
  assert.equal(line.totalLengthMm, 36000);
  assert.equal(line.totalWeightKg, 1522.8);
});

ok('scaling by zero empties the requirement', () => {
  const [line] = scaleRequirements(
    aggregateRequirements([{ profile: 'IPE300', materialGrade: 'S355', lengthMm: 100, weightKg: 10, quantity: 2 }]),
    0,
  );
  assert.equal(line.pieceCount, 0);
  assert.equal(line.totalWeightKg, 0);
});

ok('required quantity respects the material unit of measure', () => {
  const line = { pieceCount: 4, totalLengthMm: 24000, totalWeightKg: 1015.2 };
  assert.equal(requiredQtyInUom(line, 'kg'), 1015.2);
  assert.equal(requiredQtyInUom(line, 'm'), 24);
  assert.equal(requiredQtyInUom(line, 'ea'), 4);
  assert.equal(requiredQtyInUom(line, 'pcs'), 4);
  assert.equal(requiredQtyInUom(line, 't'), 1.015);
  assert.equal(requiredQtyInUom(line, 'sheet'), 1015.2); // unknown → weight fallback
  assert.equal(requiredQtyInUom(line, undefined), 1015.2);
});

ok('coverage: unmapped lines cannot be issued', () => {
  const c = coverage(100, 0, null, false);
  assert.equal(c.status, 'unmapped');
  assert.equal(c.remainingQty, 100);
  assert.equal(c.shortfallQty, 100);
});

ok('coverage: stock covers the remaining requirement', () => {
  const c = coverage(100, 40, 80, true);
  assert.equal(c.status, 'covered');
  assert.equal(c.remainingQty, 60);
  assert.equal(c.shortfallQty, 0);
});

ok('coverage: short when on-hand is below the remainder', () => {
  const c = coverage(100, 40, 25, true);
  assert.equal(c.status, 'short');
  assert.equal(c.remainingQty, 60);
  assert.equal(c.shortfallQty, 35);
});

ok('coverage: fully issued', () => {
  const c = coverage(100, 100, 0, true);
  assert.equal(c.status, 'issued');
  assert.equal(c.remainingQty, 0);
  // over-issue also reads as fully issued, never negative
  assert.equal(coverage(100, 130, 0, true).remainingQty, 0);
});

console.log(`\nmaterial-requirements-math: ${passed} assertions passed`);
